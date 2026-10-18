/** Pure town-workshop model gates; no browser or server is needed to validate authored geometry. */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import type * as TownModule from '../src/debug/TownLayoutDraft';
import underlying from '../src/world/maps/town-workshop.json' with { type: 'json' };

/** Load the actual pure model in isolation; a browser URL or normal map resolver cannot affect its base. */
function model(): typeof TownModule {
  const result = buildSync({ entryPoints: ['src/debug/TownLayoutDraft.ts'], bundle: true,
    write: false, format: 'cjs', platform: 'node' });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports as typeof TownModule;
}

test('town baseline has the agreed size, four named exits, three bridges, twelve unassigned plots and no buildings', () => {
  const api = model(), draft = api.createTownLayoutDraft(), map = api.getTownWorkshopMapData();
  expect(map).toMatchObject({ key: 'TownScene', w: 120, h: 110, buildings: [] });
  expect(map.warps.map(warp => [warp.target, warp.spawn])).toEqual([
    ['FarmScene', 'from_town'], ['ForestScene', 'from_town'], ['MountainScene', 'from_town'], ['BeachScene', 'from_town'],
  ]);
  expect(map.spawns.map(spawn => spawn.id)).toEqual(['start', 'from_farm', 'from_forest', 'from_mountain', 'from_beach']);
  expect(map.townPlan.plots).toHaveLength(12); expect(map.townPlan.bridges).toHaveLength(3);
  for (const plot of map.townPlan.plots) {
    const cells = underlying.ground.slice(plot.ty, plot.ty + plot.h).flatMap(row => row.slice(plot.tx, plot.tx + plot.w));
    expect(cells.every(ground => ground === 'grass'), `${plot.id} must not sit on its access road`).toBe(true);
  }
  expect(map.townPlan.futureSites).toHaveLength(2);
  for (const site of map.townPlan.futureSites) {
    expect(map.warps.some(warp => warp.tx >= site.tx && warp.tx < site.tx + site.w && warp.ty >= site.ty && warp.ty < site.ty + site.h)).toBe(false);
  }
  expect(new Set(map.townPlan.plots.map(plot => `${plot.w},${plot.h}`)).size).toBeGreaterThan(5);
  expect(map.objects.length).toBeGreaterThan(150);
  expect(new Set(map.objects.map(object => object.kind))).toEqual(new Set(['tree']));
  expect(api.compileTownLayoutDraft(draft)).toEqual(map);
  expect(api.parseTownLayoutDraft(api.serializeTownLayoutDraft(draft))).toEqual(draft);
  const items = api.getTownLayoutEntities(draft);
  expect(new Set(items.map(item => item.id)).size).toBe(items.length);
});

test('a clearing moves as one unit while its old underlay and path edits remain exact', () => {
  const api = model(), original = api.createTownLayoutDraft(), saved = structuredClone(original);
  const plot = original.plots[0], moved = api.moveTownLayoutEntity(original, plot.id, plot.tx + 1, plot.ty);
  const map = api.compileTownLayoutDraft(moved);
  expect(original).toEqual(saved);
  expect(moved.plots[0]).toEqual({ ...plot, tx: plot.tx + 1 });
  expect(api.getTownLayoutEntities(moved).find(item => item.id === plot.id)?.footprint).toEqual({
    x: (plot.tx + 1) * 16, y: plot.ty * 16, w: plot.w * 16, h: plot.h * 16,
  });
  expect(map.ground[plot.ty][plot.tx]).toBe(underlying.ground[plot.ty][plot.tx]);
  expect(map.ground[plot.ty][plot.tx + plot.w]).toBe('dirt');
  const painted = api.paintTownLayoutTiles(original, [{ tx: plot.tx, ty: plot.ty }], 'dirt');
  const shiftedPainted = api.moveTownLayoutEntity(painted, plot.id, plot.tx + 1, plot.ty);
  expect(api.compileTownLayoutDraft(shiftedPainted).ground[plot.ty][plot.tx]).toBe('dirt');
  expect(map.solid).toEqual(underlying.solid);
  // Production adoption derives build zones; moving a clearing must preserve that compiled baseline.
  expect(map.buildable).toEqual(api.getTownWorkshopMapData().buildable);
  expect(map.warps).toEqual(underlying.warps); expect(map.spawns).toEqual(underlying.spawns);
});

test('plots reject resources, other plots, immutable terrain, bridge approaches, and boundary footprints', () => {
  const api = model(), draft = api.createTownLayoutDraft(), plot = draft.plots[0];
  expect(() => api.moveTownLayoutEntity(draft, draft.objects[0].id, plot.tx, plot.ty)).toThrow('overlaps');
  expect(() => api.moveTownLayoutEntity(draft, plot.id, draft.plots[1].tx, draft.plots[1].ty)).toThrow('overlaps');
  expect(() => api.moveTownLayoutEntity(draft, plot.id, 88, 10)).toThrow('frozen');
  expect(() => api.moveTownLayoutEntity(draft, plot.id, 79, 34)).toThrow(/frozen|reserved/);
  expect(() => api.moveTownLayoutEntity(draft, plot.id, 115, 96)).toThrow('boundary');
  expect(() => api.moveTownLayoutEntity(draft, draft.decor[0].id, plot.tx, plot.ty)).toThrow('overlaps');
});

test('routes use tree collision and reject a complete ring around a walkable clearing', () => {
  const api = model(), draft = api.createTownLayoutDraft(), plot = draft.plots[0];
  const positions: Array<{ tx: number; ty: number }> = [];
  for (let tx = plot.tx - 1; tx <= plot.tx + plot.w; tx++) {
    positions.push({ tx, ty: plot.ty - 1 }, { tx, ty: plot.ty + plot.h });
  }
  for (let ty = plot.ty; ty < plot.ty + plot.h; ty++) {
    positions.push({ tx: plot.tx - 1, ty }, { tx: plot.tx + plot.w, ty });
  }
  positions.forEach((position, index) => Object.assign(draft.objects[index], position));
  expect(() => api.validateTownLayoutDraft(draft)).toThrow(`route to ${plot.id}`);
});

test('dirt painting is sparse, atomic and reversible, with grass buffers beside water and cliffs', () => {
  const api = model(), draft = api.createTownLayoutDraft();
  const painted = api.paintTownLayoutTiles(draft, [{ tx: 30, ty: 35 }, { tx: 31, ty: 35 }], 'dirt');
  expect(painted.ground).toHaveLength(2); expect(draft.ground).toEqual([]);
  expect(api.paintTownLayoutTiles(painted, [{ tx: 30, ty: 35 }, { tx: 31, ty: 35 }], 'grass')).toEqual(draft);
  for (const tile of [{ tx: 88, ty: 10 }, { tx: 80, ty: 35 }, { tx: 0, ty: 30 }, { tx: 57, ty: 8 }]) {
    expect(() => api.paintTownLayoutTiles(draft, [tile], 'dirt')).toThrow(/frozen|reserved/);
  }
  expect(() => api.paintTownLayoutTiles(draft, [{ tx: 84, ty: 10 }], 'dirt')).toThrow('grass buffer');
  expect(() => api.paintTownLayoutTiles(draft, [{ tx: 30, ty: 35 }, { tx: 88, ty: 10 }], 'dirt')).toThrow('frozen');
  expect(api.createTownLayoutDraft()).toEqual(draft);
});

test('compiled ground uses native two-terrain transitions and every bridge stays genuinely walkable', () => {
  const api = model(), map = api.getTownWorkshopMapData();
  for (let ty = 0; ty < map.h - 1; ty++) for (let tx = 0; tx < map.w - 1; tx++) {
    const lower = new Set([map.ground[ty][tx], map.ground[ty][tx + 1], map.ground[ty + 1][tx], map.ground[ty + 1][tx + 1]]);
    lower.delete('grass'); expect(lower.size).toBeLessThanOrEqual(1);
  }
  for (const bridge of map.townPlan.bridges) {
    for (let ty = bridge.ty; ty < bridge.ty + bridge.h; ty++) for (let tx = bridge.tx; tx < bridge.tx + bridge.w; tx++) {
      expect(['grass', 'dirt']).toContain(map.ground[ty][tx]); expect(map.solid[ty][tx]).toBe(false);
    }
  }
});

test('untrusted input rejects changed identity, map, version, size, foreign keys and unknown fingerprints', () => {
  const api = model(), draft = api.createTownLayoutDraft();
  for (const bad of [{ ...draft, extra: true }, { ...draft, shop: {} }, { ...draft, map: 'farm' },
    { ...draft, version: 2 }, { ...draft, baseFingerprint: 'town-v1-stale' }]) expect(() => api.validateTownLayoutDraft(bad)).toThrow();
  const changed = structuredClone(draft); changed.plots[0].w++;
  expect(() => api.validateTownLayoutDraft(changed)).toThrow('identity, size');
  const identity = structuredClone(draft); identity.objects[0].id = identity.objects[1].id;
  expect(() => api.validateTownLayoutDraft(identity)).toThrow('identity');
  const position = structuredClone(draft); position.plots[0].tx = NaN;
  expect(() => api.validateTownLayoutDraft(position)).toThrow('whole tile');
  const edit = { tx: 30, ty: 35, ground: 'dirt' as const };
  expect(() => api.validateTownLayoutDraft({ ...draft, ground: [edit, edit] })).toThrow('twice');
  expect(() => api.moveTownLayoutEntity(draft, '__proto__', 20, 30)).toThrow('Unknown');
  expect(() => api.parseTownLayoutDraft('{')).toThrow('valid JSON');
  expect(() => api.parseTownLayoutDraft(' '.repeat(api.TOWN_DRAFT_MAX_BYTES + 1))).toThrow('1 MB');
});

test('sparse arrays, array accessors and exotic records cannot bypass strict document validation', () => {
  const api = model(), draft = api.createTownLayoutDraft();
  for (const group of ['objects', 'decor', 'plots'] as const) {
    const sparse = structuredClone(draft); delete sparse[group][0];
    expect(() => api.validateTownLayoutDraft(sparse)).toThrow('dense array');
  }
  const sparseGround = new Array(1);
  expect(() => api.validateTownLayoutDraft({ ...draft, ground: sparseGround })).toThrow('dense array');
  const accessor = structuredClone(draft);
  Object.defineProperty(accessor.objects, '0', { get: () => { throw new Error('Getter ran'); } });
  expect(() => api.validateTownLayoutDraft(accessor)).toThrow('authored data slot');
  expect(() => api.validateTownLayoutDraft(new Date())).toThrow('plain object');
});

test('every map and entity read is detached from caller mutations', () => {
  const api = model(), draft = api.createTownLayoutDraft(), map = api.getTownWorkshopMapData();
  map.townPlan.plots[0].tx = 118; map.ground[35][30] = 'water'; map.objects[0].tx = 119;
  const items = api.getTownLayoutEntities(draft); items[0].footprint.x = 0;
  expect(api.createTownLayoutDraft()).toEqual(draft);
  expect(api.getTownWorkshopMapData().ground[35][30]).toBe('grass');
  expect(api.getTownWorkshopMapData().objects[0].tx).not.toBe(119);
  expect(api.getTownLayoutEntities(draft)[0].footprint.x).not.toBe(0);
});
