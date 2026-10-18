/** Pure farm-draft regression checks using the actual source bundle, without a browser or live server. */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import type * as DraftModule from '../src/debug/FarmLayoutDraft';
import type * as MapModule from '../src/world/MapDef';
import type * as ShopModule from '../src/config/Shop';
import type * as StorageModule from '../src/debug/FarmLayoutStorage';
import { SceneKey } from '../src/config/AssetKeys';
import approvedLayout from '../src/world/maps/farm-layout-approved.v1.json' with { type: 'json' };

type Model = typeof DraftModule & Pick<typeof MapModule, 'getAuthoredMapData' | 'getLegacyFarmMapData' | 'getMapData' | 'setFarmPreviewMap'> & typeof ShopModule & typeof StorageModule;

/** Bundle unchanged TypeScript with explicit Vite constants and a private URL fixture. */
function model(query = '', dev = true, storage?: Pick<Storage, 'getItem' | 'setItem'>): Model {
  const result = buildSync({ stdin: { contents: [
    'export * from "./src/debug/FarmLayoutDraft.ts";',
    'export { getAuthoredMapData, getLegacyFarmMapData, getMapData, setFarmPreviewMap } from "./src/world/MapDef.ts";',
    'export * from "./src/config/Shop.ts";',
    'export * from "./src/debug/FarmLayoutStorage.ts";',
  ].join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'import.meta.env.DEV': JSON.stringify(dev), 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } });
  const module = { exports: {} };
  new Function('module', 'exports', 'window', 'localStorage', result.outputFiles[0].text)(module, module.exports,
    { location: { search: query, href: `https://example.test/${query}` } }, storage);
  return module.exports as Model;
}

test('the original draft compiles exactly to the authored farm and every object retains a unique ID', () => {
  const api = model(), draft = api.createFarmLayoutDraft();
  expect(api.compileFarmLayoutDraft(draft)).toEqual(api.getAuthoredMapData(SceneKey.Farm));
  const records = api.getFarmLayoutEntities(draft);
  expect(new Set(records.map(record => record.id)).size).toBe(records.length);
  expect(draft.objects.length).toBeGreaterThan(1000);
  expect(api.parseFarmLayoutDraft(api.serializeFarmLayoutDraft(draft))).toEqual(draft);
});

test('shop movement translates wall, porch, entrance, arrivals, and reserved tiles without changing external exits', () => {
  const api = model(), original = api.createFarmLayoutDraft(), before = structuredClone(original);
  const draft = api.moveFarmLayoutEntity(original, 'shop', 78, 19), map = api.compileFarmLayoutDraft(draft);
  expect(original).toEqual(before);
  expect(map.shopOffset).toEqual({ tx: 10, ty: 14 });
  expect(map.solid[9][69]).toBe(false);
  expect(map.solid[22][79]).toBe(false);
  expect(map.solid[26][79]).toBe(true);
  expect(map.spawns.find(spawn => spawn.id === 'start')).toEqual({ id: 'start', tx: 82, ty: 29 });
  expect(map.spawns.find(spawn => spawn.id === 'from_home')).toEqual({ id: 'from_home', tx: 82, ty: 29 });
  expect(map.warps.find(warp => warp.target === SceneKey.Tavern)).toMatchObject({ tx: 82, ty: 26, w: 2, h: 1 });
  expect(map.reservedTiles).toContainEqual({ tx: 82, ty: 29 });
  const authored = api.getAuthoredMapData(SceneKey.Farm);
  expect(map.warps.filter(warp => warp.target !== SceneKey.Tavern)).toEqual(authored.warps.filter(warp => warp.target !== SceneKey.Tavern));
  expect(map.buildable[9][69]).toBe(true);
  expect(map.buildable[26][79]).toBe(false);
  const geometry = api.getShopGeometry({ tx: 10, ty: 14 });
  expect(geometry.front.x).toBe(api.SHOP_FRONT.x + 10 * 16);
  expect(geometry.front.y).toBe(api.SHOP_FRONT.y + 14 * 16);
  expect(geometry.bodies[0].y).toBe(api.SHOP_PORCH_BODIES[0].y + 14 * 16);
});

test('the 40 by 26 shipping bin rejects overlaps even when object center tiles differ', () => {
  const api = model(), draft = api.createFarmLayoutDraft();
  const bin = draft.objects.find(object => object.kind === 'bin');
  if (!bin) throw new Error('Authored bin missing.');
  const moved = api.moveFarmLayoutEntity(draft, bin.id, 43, 38);
  expect(api.getFarmLayoutEntities(moved).find(entity => entity.id === bin.id)?.footprint).toEqual({ x: 676, y: 598, w: 40, h: 26 });
  expect(() => api.moveFarmLayoutEntity(moved, moved.objects[0].id, 44, 38)).toThrow('overlaps');
  expect(() => api.moveFarmLayoutEntity(moved, moved.objects[0].id, 45, 38)).not.toThrow();
  expect(() => api.moveFarmLayoutEntity(draft, bin.id, 1, 10)).toThrow('boundary');
});

test('shop facade, approach, decor, terrain, and external arrival footprints cannot overlap', () => {
  const api = model(), draft = api.createFarmLayoutDraft(), first = draft.objects[0].id;
  expect(() => api.moveFarmLayoutEntity(draft, first, 82, 28)).toThrow(/overlaps|approach/);
  expect(() => api.moveFarmLayoutEntity(draft, first, 74, 43)).toThrow('frozen');
  expect(() => api.moveFarmLayoutEntity(draft, first, 96, 30)).toThrow('external');
  expect(() => api.moveFarmLayoutEntity(draft, first, draft.decor[0].tx, draft.decor[0].ty)).toThrow('overlaps');
  expect(() => api.moveFarmLayoutEntity(draft, 'shop', 95, 90)).toThrow('boundary');
});

test('a fence around the forest arrival fails route validation despite individually legal footprints', () => {
  const api = model(), draft = api.createFarmLayoutDraft(), fence = structuredClone(draft);
  const positions: number[][] = [];
  for (let tx = 18; tx <= 25; tx++) positions.push([tx, 96]);
  for (let ty = 97; ty <= 98; ty++) positions.push([18, ty], [25, ty]);
  positions.forEach(([tx, ty], index) => Object.assign(fence.objects[index], { tx, ty }));
  expect(() => api.validateFarmLayoutDraft(fence)).toThrow('route to arrival from_forest');
  expect(api.createFarmLayoutDraft()).toEqual(draft);
});

test('brush edits are detached and sparse and cannot repaint immutable terrain or exits', () => {
  const api = model(), draft = api.createFarmLayoutDraft();
  const painted = api.paintFarmLayoutTiles(draft, [{ tx: 40, ty: 40 }, { tx: 41, ty: 40 }], 'dirt');
  expect(draft.ground).toEqual([]);
  expect(painted.ground).toHaveLength(2);
  expect(api.compileFarmLayoutDraft(painted).buildable[40][40]).toBe(false);
  const erased = api.paintFarmLayoutTiles(painted, [{ tx: 40, ty: 40 }, { tx: 41, ty: 40 }], 'grass');
  expect(erased).toEqual(draft);
  for (const [tx, ty] of [[74, 43], [0, 0], [98, 30]]) {
    expect(() => api.paintFarmLayoutTiles(draft, [{ tx, ty }], 'dirt')).toThrow('frozen');
  }
});

test('JSON rejects unknown fields, stale versions, changed IDs, duplicate ground, oversized input, and nonfinite coordinates', () => {
  const api = model(), draft = api.createFarmLayoutDraft();
  expect(() => api.validateFarmLayoutDraft({ ...draft, extra: true })).toThrow('unknown');
  expect(() => api.validateFarmLayoutDraft({ ...draft, version: 2 })).toThrow('version');
  expect(() => api.validateFarmLayoutDraft({ ...draft, baseFingerprint: 'stale' })).toThrow('different authored');
  const broken = structuredClone(draft); broken.objects[0].id = broken.objects[1].id;
  expect(() => api.validateFarmLayoutDraft(broken)).toThrow('identity');
  const duplicate = { tx: 40, ty: 40, ground: 'dirt' as const };
  expect(() => api.validateFarmLayoutDraft({ ...draft, ground: [duplicate, duplicate] })).toThrow('twice');
  expect(() => api.validateFarmLayoutDraft({ ...draft, shop: { ...draft.shop, tx: NaN } })).toThrow('whole tile');
  expect(() => api.parseFarmLayoutDraft('[')).toThrow('valid JSON');
  expect(() => api.parseFarmLayoutDraft(' '.repeat(api.FARM_DRAFT_MAX_BYTES + 1))).toThrow('1 MB');
  expect(() => api.moveFarmLayoutEntity(draft, '__proto__', 40, 40)).toThrow('Unknown');
});

test('preview installation is denied in ordinary, edit, and production sessions', () => {
  for (const [query, dev] of [['', true], ['?mapEditor=1', true], ['?mapPreview=1', false]] as const) {
    const api = model(query, dev), map = api.compileFarmLayoutDraft(api.createFarmLayoutDraft());
    expect(() => api.setFarmPreviewMap(map)).toThrow('preview session');
    expect(api.getMapData(SceneKey.Farm)).toEqual(api.getAuthoredMapData(SceneKey.Farm));
  }
});

test('unknown-input validation rejects sparse entity arrays rather than dropping authored objects', () => {
  const api = model(), draft = api.createFarmLayoutDraft();
  const missingObject = structuredClone(draft);
  delete missingObject.objects[0];
  expect(() => api.validateFarmLayoutDraft(missingObject)).toThrow('objects entry 0 must be an object');
  const missingDecor = structuredClone(draft);
  delete missingDecor.decor[0];
  expect(() => api.validateFarmLayoutDraft(missingDecor)).toThrow('decor entry 0 must be an object');
});

test('explicit preview installation copies both its input and every returned map', () => {
  const api = model('?mapPreview=1'), draft = api.moveFarmLayoutEntity(api.createFarmLayoutDraft(), 'shop', 78, 19);
  const map = api.compileFarmLayoutDraft(draft); api.setFarmPreviewMap(map);
  map.objects[0].tx = 99;
  const view = api.getMapData(SceneKey.Farm);
  expect(view.shopOffset).toEqual({ tx: 10, ty: 14 });
  expect(view.objects[0].tx).not.toBe(99);
  view.objects[0].tx = 98;
  expect(api.getMapData(SceneKey.Farm).objects[0].tx).not.toBe(98);
  expect(api.getAuthoredMapData(SceneKey.Farm).shopOffset).toEqual({ tx: 10, ty: 13 });
  api.setFarmPreviewMap(null);
  expect(api.getMapData(SceneKey.Farm)).toEqual(api.getAuthoredMapData(SceneKey.Farm));
});

test('the approved legacy export becomes the exact new baseline without changing any authored identity', () => {
  const api = model(), authored = api.getAuthoredMapData(SceneKey.Farm), draft = api.createFarmLayoutDraft();
  expect(draft.shop).toEqual({ id: 'shop', tx: 78, ty: 18 });
  expect(draft.baseFingerprint).not.toBe(approvedLayout.baseFingerprint);
  expect(api.validateFarmLayoutDraft(approvedLayout)).toEqual(draft);
  expect(api.compileFarmLayoutDraft(approvedLayout as DraftModule.FarmLayoutDraft)).toEqual(authored);
  expect(authored.shopOffset).toEqual({ tx: 10, ty: 13 });
  expect(authored.objects.map(object => object.kind)).toEqual(api.getLegacyFarmMapData().objects.map(object => object.kind));
  expect(authored.objects).toEqual(approvedLayout.objects.map(({ kind, tx, ty }) => ({ kind, tx, ty })));
  expect(authored.decor).toEqual(approvedLayout.decor.map(({ kind, tx, ty }) => ({ kind, tx, ty })));
  expect(authored.spawns.find(spawn => spawn.id === 'start')).toEqual({ id: 'start', tx: 82, ty: 28 });
  expect(authored.warps.find(warp => warp.target === SceneKey.Tavern)).toMatchObject({ tx: 82, ty: 25 });
});

/**
 * The legacy farm as an old draft realizes it today: every tile it could paint stays as it was,
 * but the north gate trail (warp, its one-tile approach band, and the arrival tile) is frozen
 * authored terrain on the current farm, so it comes from the authored map.
 */
function withNorthTrail(legacy: MapModule.MapData, authored: MapModule.MapData): MapModule.MapData {
  const result = structuredClone(legacy);
  const gate = authored.warps.find(warp => warp.target === SceneKey.GatePlaza);
  const arrival = authored.spawns.find(spawn => spawn.id === 'from_north');
  if (!gate || !arrival) throw new Error('The authored farm is missing its north gate trail.');
  const tiles = [{ tx: arrival.tx, ty: arrival.ty }];
  for (let ty = Math.max(0, gate.ty - 1); ty <= gate.ty + gate.h; ty++) {
    for (let tx = gate.tx - 1; tx <= gate.tx + gate.w; tx++) tiles.push({ tx, ty });
  }
  for (const { tx, ty } of tiles) {
    result.ground[ty][tx] = authored.ground[ty][tx];
    result.solid[ty][tx] = authored.solid[ty][tx];
    result.buildable[ty][tx] = authored.buildable[ty][tx];
  }
  result.warps.push(structuredClone(gate));
  result.spawns.push(structuredClone(arrival));
  return result;
}

test('known old browser drafts preserve every realized ground tile and absolute object position', () => {
  const api = model(), legacy = withNorthTrail(api.getLegacyFarmMapData(), api.getAuthoredMapData(SceneKey.Farm));
  const old: DraftModule.FarmLayoutDraft = { version: 1, baseFingerprint: 'farm-v1-af059b10',
    shop: { id: 'shop', tx: 68, ty: 5 }, ground: [],
    objects: legacy.objects.map((object, index) => ({ id: `object:${String(index).padStart(4, '0')}`, ...object })),
    decor: legacy.decor.map((decor, index) => ({ id: `decor:${String(index).padStart(4, '0')}`, ...decor })),
  };
  const before = structuredClone(old), converted = api.validateFarmLayoutDraft(old);
  expect(old).toEqual(before);
  // The approved layout repaints 72,2 (now the frozen north arrival tile), so one edit fewer carries over.
  expect(converted.ground.length).toBe(approvedLayout.ground.length - 1);
  expect(api.compileFarmLayoutDraft(converted)).toEqual(legacy);
  old.ground.push({ tx: 40, ty: 40, ground: 'dirt' });
  old.objects[1167].tx = 40; old.objects[1167].ty = 40;
  const altered = api.compileFarmLayoutDraft(api.parseFarmLayoutDraft(JSON.stringify(old)));
  legacy.ground[40][40] = 'dirt'; legacy.buildable[40][40] = false;
  legacy.objects[1167] = { kind: 'bin', tx: 40, ty: 40 };
  expect(altered).toEqual(legacy);
  const invalid = structuredClone(old); delete invalid.objects[0];
  expect(() => api.validateFarmLayoutDraft(invalid)).toThrow('objects entry 0');
});

test('approved terrain stays exact and the north path opens only the gate-plaza trail', () => {
  const api = model(), authored = api.getAuthoredMapData(SceneKey.Farm), legacy = api.getLegacyFarmMapData();
  const expectedGround = structuredClone(legacy.ground);
  for (const edit of approvedLayout.ground) expectedGround[edit.ty][edit.tx] = edit.ground as MapModule.Ground;
  // The north trail cuts the cliff at rows 0-1: a dirt lane (72-73) with a grass verge each side.
  for (const ty of [0, 1]) {
    expectedGround[ty][71] = 'grass'; expectedGround[ty][72] = 'dirt'; expectedGround[ty][73] = 'dirt'; expectedGround[ty][74] = 'grass';
  }
  expect(authored.ground).toEqual(expectedGround);
  const gate = { tx: 72, ty: 0, w: 2, h: 1, target: SceneKey.GatePlaza, spawn: 'from_farm' };
  expect(authored.warps.filter(warp => warp.target !== SceneKey.Tavern))
    .toEqual([...legacy.warps.filter(warp => warp.target !== SceneKey.Tavern), gate]);
  expect(authored.warps.filter(warp => warp.ty < 2)).toEqual([gate]);
  expect(authored.spawns.find(spawn => spawn.id === 'from_north')).toEqual({ id: 'from_north', tx: 72, ty: 2 });
  for (let ty = 2; ty <= 13; ty++) for (const tx of [72, 73]) expect(authored.ground[ty][tx]).toBe('dirt');
  // Detached reads protect both migration reference data and checked-in authored data from callers.
  legacy.objects[0].tx = 99; authored.ground[40][40] = 'water';
  expect(api.getLegacyFarmMapData().objects[0].tx).not.toBe(99);
  expect(api.getAuthoredMapData(SceneKey.Farm).ground[40][40]).toBe('grass');
});

test('reading known legacy browser bytes converts only in memory and corrupt reads retain the stored bytes', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string): string | null => values.has(key) ? values.get(key)! : null,
    setItem: (key: string, value: string): void => { values.set(key, value); } };
  const api = model('?mapEditor=1', true, storage), bytes = JSON.stringify(approvedLayout);
  storage.setItem(api.FARM_LAYOUT_DRAFT_STORAGE_KEY, bytes);
  expect(api.readFarmLayoutDraft()).toEqual(api.createFarmLayoutDraft());
  expect(storage.getItem(api.FARM_LAYOUT_DRAFT_STORAGE_KEY)).toBe(bytes);
  expect(api.FARM_LAYOUT_DRAFT_STORAGE_KEY).toBe('skl-map-editor.farm-draft.v1');
  const corrupt = '{invalid'; storage.setItem(api.FARM_LAYOUT_DRAFT_STORAGE_KEY, corrupt);
  expect(() => api.readFarmLayoutDraft()).toThrow('valid JSON');
  expect(storage.getItem(api.FARM_LAYOUT_DRAFT_STORAGE_KEY)).toBe(corrupt);
});
