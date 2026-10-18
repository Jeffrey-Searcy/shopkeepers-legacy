/**
 * Server-free v10→v11 save proofs: actual migration, scoped legacy maps, byte-exact backups and preserved content.
 * why: since save version 27 a v10 save goes on past the 120x110 built Town to the 82x75 painted Town
 * (migratePaintedTown), which moves every Town record again. So the v11 step's exact placements are checked by
 * running the same real steps the loader runs up to the built Town (builtTown below), while full loads check what
 * a player really gets: atomic, write-free reads and intact Farm, Forest and interior content.
 */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import { SceneKey } from '../src/config/AssetKeys';
import type { GameSaveData } from '../src/state/GameState';
import type { MapData } from '../src/world/MapDef';

/** Real module surface used by isolated migration fixtures. */
interface Runtime {
  GameState: typeof import('../src/state/GameState').GameState;
  SaveSystem: typeof import('../src/systems/SaveSystem').SaveSystem;
  getAuthoredMapData: typeof import('../src/world/MapDef').getAuthoredMapData;
  getLegacyTownRegionMapData: typeof import('../src/world/MapDef').getLegacyTownRegionMapData;
  furnitureCells: typeof import('../src/config/Furniture').furnitureCells;
  getAuthoredTownMap: typeof import('../src/world/TownMap').getAuthoredTownMap;
  getUnbuiltTownMap: typeof import('../src/world/TownMap').getUnbuiltTownMap;
  migrateTownLayout: typeof import('../src/systems/TownLayoutMigration').migrateTownLayout;
  migrateTownBuildings: typeof import('../src/systems/TownLayoutMigration').migrateTownBuildings;
}
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export {GameState} from './src/state/GameState';
  export {SaveSystem} from './src/systems/SaveSystem';
  export {getAuthoredMapData,getLegacyTownRegionMapData} from './src/world/MapDef';
  export {furnitureCells} from './src/config/Furniture';
  export {getAuthoredTownMap,getUnbuiltTownMap} from './src/world/TownMap';
  export {migrateTownLayout,migrateTownBuildings} from './src/systems/TownLayoutMigration';
` }, bundle: true, write: false, platform: 'node', format: 'cjs',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Fresh singleton state plus injectable storage failures; never reads a real browser save. */
function runtime() {
  const bytes = new Map<string, string>(), writes: string[] = [];
  let failing: string | null = null;
  const storage = {
    /** Return exact previously stored bytes. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Fail before mutation when requested; otherwise record write order and bytes. */
    setItem(key: string, value: string): void {
      if (key === failing) throw new Error('Injected quota failure');
      writes.push(key); bytes.set(key, value);
    },
    /** Remove only a fixture-owned key. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundle)(module, module.exports, storage,
    { location: { search: '?test=1&seed=42' } });
  return { api: module.exports as Runtime, bytes, writes,
    /** Inject one write failure without modifying pre-existing bytes. */
    fail(key: string | null): void { failing = key; } };
}

/** Region fixtures always validate against exact detached v10 terrain, never global preview installation. */
function legacy(api: Runtime, source: GameSaveData): GameSaveData {
  const actualV10 = structuredClone(source) as Partial<GameSaveData>;
  delete actualV10.relationships;
  delete actualV10.justice;
  return api.GameState.candidateFromSaveData(actualV10, 10, api.getAuthoredMapData(SceneKey.Farm), new Map([
    [SceneKey.Town, api.getLegacyTownRegionMapData(SceneKey.Town)],
    [SceneKey.Forest, api.getLegacyTownRegionMapData(SceneKey.Forest)],
  ])).toSaveData();
}

/**
 * Run the loader's own v10 Town steps up to the 120x110 built Town: the v11 move (migrateTownLayout) and the civic
 * plots (migrateTownBuildings). The painted-Town step that follows is proven in painted-town.spec.ts.
 * @param api the isolated runtime
 * @param source a v10 save already checked against the legacy maps (see legacy())
 * @returns the save as it stands on the built Town
 */
function builtTown(api: Runtime, source: GameSaveData): GameSaveData {
  const notices: string[] = [], candidate = api.GameState.candidateFromSaveData(structuredClone(source), 10,
    api.getAuthoredMapData(SceneKey.Farm), new Map([
      [SceneKey.Town, api.getLegacyTownRegionMapData(SceneKey.Town)],
      [SceneKey.Forest, api.getLegacyTownRegionMapData(SceneKey.Forest)],
    ]));
  api.migrateTownLayout(candidate, api.getLegacyTownRegionMapData(SceneKey.Town), api.getLegacyTownRegionMapData(SceneKey.Forest), notices);
  api.migrateTownBuildings(candidate, api.getUnbuiltTownMap(), notices);
  return candidate.toSaveData();
}

/** The map a v10 region record is settled on: the 120x110 built Town for the Town, today's Forest for the Forest. */
function settledMap(api: Runtime, scene: SceneKey): MapData {
  return scene === SceneKey.Town ? api.getAuthoredTownMap() : api.getAuthoredMapData(scene);
}

/** A save with every Town record removed, so full loads can be compared outside the repainted Town. */
function withoutTown(save: GameSaveData): GameSaveData {
  const outside = (key: string) => !key.startsWith(`${SceneKey.Town}:`);
  return { ...save, placedItems: save.placedItems.filter(item => item.scene !== SceneKey.Town),
    placements: save.placements.filter(item => item.scene !== SceneKey.Town),
    groundDrops: save.groundDrops.filter(item => item.scene !== SceneKey.Town),
    tiles: Object.fromEntries(Object.entries(save.tiles).filter(([key]) => outside(key))),
    crops: Object.fromEntries(Object.entries(save.crops).filter(([key]) => outside(key))) };
}

/** Nontrivial protected Farm/interior state makes accidental reuse of the Farm cleanup observable. */
function base(api: Runtime): GameSaveData {
  const state = new api.GameState();
  state.day = 8; state.gold = 456; state.chest = { wood: 19 }; state.addItem('ale', 3);
  state.activeScene = SceneKey.Tavern;
  const arrival = api.getAuthoredMapData(SceneKey.Tavern).spawns.find(spawn => spawn.id === 'entry');
  if (!arrival) throw new Error('Missing Tavern fixture arrival');
  state.player = { x: arrival.tx * 16 + 8, y: arrival.ty * 16 + 8, facing: 'left', stamina: 71 };
  state.tavern = { ...state.tavern, level: 1, welcomeClaimed: true, foodSold: 2, totalServed: 2, revenue: 24 };
  state.placedItems = [
    { item: 'chest', scene: SceneKey.Farm, tx: 40, ty: 40, rotation: 0 },
    { item: 'chair', scene: SceneKey.Tavern, tx: 10, ty: 8, rotation: 3 },
    { item: 'chair', scene: SceneKey.Bedroom, tx: 6, ty: 6, rotation: 2 },
  ];
  state.tiles['FarmScene:42,42'] = 'watered';
  state.crops['FarmScene:42,42'] = { type: 'parsnip', stage: 1, maxStage: 3, watered: true, daysInStage: 1 };
  state.placements = [{ id: 'farm-stays', type: 'shop', scene: SceneKey.Farm, tx: 44, ty: 44, w: 2, h: 2 }];
  return legacy(api, state.toSaveData());
}

/** Write a legacy envelope directly so setup cannot accidentally migrate or normalize it. */
function store(env: ReturnType<typeof runtime>, source: GameSaveData): string {
  const actualV10 = structuredClone(source) as Partial<GameSaveData>;
  delete actualV10.relationships;
  delete actualV10.justice;
  const raw = JSON.stringify({ version: 10, slot: 1, savedAt: 12345, state: actualV10 }, null, 1);
  env.bytes.set(env.api.SaveSystem.storageKey(1), raw); return raw;
}

/** Whether a fixture tile is clear and unreserved in this exact map snapshot; historical building flags are separate. */
function free(map: MapData, tx: number, ty: number): boolean {
  return tx > 1 && ty > 1 && tx < map.w - 2 && ty < map.h - 2 && !map.solid[ty][tx] &&
    ['grass', 'dirt'].includes(map.ground[ty][tx]) &&
    !map.objects.some(object => object.tx === tx && object.ty === ty) &&
    !map.spawns.some(spawn => spawn.tx === tx && spawn.ty === ty) &&
    !(map.reservedTiles && map.reservedTiles.some(cell => cell.tx === tx && cell.ty === ty));
}

/** Pick separated old/new clear cells or old clear cells consumed by a new wall/road, without guessed coordinates. */
function cells(api: Runtime, scene: SceneKey, conflict: boolean, count: number): Array<{ tx: number; ty: number }> {
  const oldMap = api.getLegacyTownRegionMapData(scene), map = settledMap(api, scene), selected: Array<{ tx: number; ty: number }> = [];
  for (let ty = 3; ty < oldMap.h - 4; ty++) for (let tx = 3; tx < oldMap.w - 4; tx++) {
    if (selected.some(cell => Math.abs(cell.tx - tx) + Math.abs(cell.ty - ty) < 5)) continue;
    const footprint = [{ tx, ty }, { tx, ty: ty + 1 }, { tx: tx + 1, ty }, { tx: tx + 1, ty: ty + 1 }];
    if (!footprint.every(cell => free(oldMap, cell.tx, cell.ty))) continue;
    if (conflict ? free(map, tx, ty) : !footprint.every(cell => free(map, cell.tx, cell.ty))) continue;
    selected.push({ tx, ty }); if (selected.length === count) return selected;
  }
  throw new Error(`Not enough ${scene} ${conflict ? 'conflicting' : 'safe'} fixture cells`);
}

test('v10 preserves all legal Town/Forest content and protected Farm/interior state without read writes', () => {
  const env = runtime(), { api } = env, source = base(api);
  for (const scene of [SceneKey.Town, SceneKey.Forest]) {
    const [furniture, crop, building, drop] = cells(api, scene, false, 4);
    source.placedItems.push({ item: 'workbench', scene, ...furniture, rotation: 1 });
    const key = `${scene}:${crop.tx},${crop.ty}`;
    source.tiles[key] = 'watered'; source.crops[key] = { type: 'parsnip', stage: 2, maxStage: 3, watered: true, daysInStage: 2 };
    source.placements.push({ id: `${scene}-shop`, type: 'shop', scene, ...building, w: 2, h: 2 });
    source.groundDrops.push({ scene, item: 'ale', ...drop });
  }
  const valid = legacy(api, source), raw = store(env, valid), before = api.GameState.instance.toSaveData();
  expect(api.SaveSystem.inspectSlot(1).status).toBe('ready'); expect(api.SaveSystem.listSlots()[0].status).toBe('ready');
  expect(env.writes).toEqual([]); expect(api.GameState.instance.toSaveData()).toEqual(before);
  expect(builtTown(api, valid)).toEqual(valid);
  // The full load then repaints the Town: everything outside it is exact, and no Town record is lost.
  const loaded = api.SaveSystem.load(1);
  expect(withoutTown(loaded)).toEqual(withoutTown(valid));
  expect(loaded.placedItems).toHaveLength(valid.placedItems.length); expect(loaded.placements).toHaveLength(valid.placements.length);
  expect(loaded.groundDrops).toHaveLength(valid.groundDrops.length); expect(Object.keys(loaded.crops)).toHaveLength(Object.keys(valid.crops).length);
  expect(env.writes).toEqual([]); expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(raw);
});

test('legal table-over-rug layering survives the Town migration at the exact original anchors', () => {
  const env = runtime(), { api } = env, source = base(api), [cell] = cells(api, SceneKey.Town, false, 1);
  source.placedItems.push({ item: 'rug', scene: SceneKey.Town, ...cell, rotation: 0 },
    { item: 'table', scene: SceneKey.Town, ...cell, rotation: 1 });
  const valid = legacy(api, source);
  store(env, valid);
  expect(builtTown(api, valid)).toEqual(valid);
  // On the painted Town the pair still shares one anchor, so the table still sits on its rug.
  const town = api.SaveSystem.load(1).placedItems.filter(item => item.scene === SceneKey.Town);
  expect(town.map(item => item.item)).toEqual(['rug', 'table']);
  expect([town[1].tx, town[1].ty]).toEqual([town[0].tx, town[0].ty]);
});

test('a building with no fitting destination rejects without losing source bytes or replacing live state', () => {
  const env = runtime(), { api } = env, source = base(api);
  // This bounded legacy footprint fits the old dimensions but cannot fit the new river-separated terrain.
  source.placements.push({ id: 'too-wide-for-new-banks', type: 'shop', scene: SceneKey.Town,
    tx: 3, ty: 3, w: 70, h: 50 });
  const original = store(env, legacy(api, source)), before = api.GameState.instance.toSaveData();
  expect(() => api.SaveSystem.load(1)).toThrow('no safe space');
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(original);
  expect(env.writes).toEqual([]);
  expect(api.GameState.instance.toSaveData()).toEqual(before);
});

test('conflicting Town furniture, crops, buildings and pickups relocate intact while legal cross-category cells stay reserved', () => {
  const env = runtime(), { api } = env, source = base(api);
  const [furniture, crop, building, drop] = cells(api, SceneKey.Town, true, 4);
  source.placedItems.push({ item: 'workbench', scene: SceneKey.Town, ...furniture, rotation: 1 });
  const key = `TownScene:${crop.tx},${crop.ty}`, planted = { type: 'parsnip', stage: 2, maxStage: 3, watered: true, daysInStage: 2 };
  source.tiles[key] = 'watered'; source.crops[key] = planted;
  source.placements.push({ id: 'town-moves', type: 'shop', scene: SceneKey.Town, ...building, w: 2, h: 2 });
  // Pickups on a road remain legal; select an actual new wall to force pickup relocation too.
  const map = api.getAuthoredTownMap(), old = api.getLegacyTownRegionMapData(SceneKey.Town);
  let wall = drop;
  if (!map.solid[wall.ty][wall.tx] && !map.objects.some(object => object.tx === wall.tx && object.ty === wall.ty)) {
    const object = map.objects.find(object => object.tx > 1 && object.ty > 1 && object.tx < old.w - 2 && object.ty < old.h - 2 && free(old, object.tx, object.ty));
    if (!object) throw new Error('No newly blocked pickup fixture');
    wall = { tx: object.tx, ty: object.ty };
  }
  source.groundDrops.push({ scene: SceneKey.Town, item: 'ale', ...wall });
  const safe = cells(api, SceneKey.Town, false, 3);
  source.placedItems.push({ item: 'chest', scene: SceneKey.Town, ...safe[0], rotation: 0 });
  source.tiles[`TownScene:${safe[1].tx},${safe[1].ty}`] = 'tilled';
  source.placements.push({ id: 'town-stays', type: 'shop', scene: SceneKey.Town, ...safe[2], w: 1, h: 1 });
  const valid = legacy(api, source); store(env, valid); const moved = builtTown(api, valid);
  expect(moved.placedItems).toHaveLength(valid.placedItems.length); expect(moved.placements).toHaveLength(valid.placements.length);
  expect(moved.groundDrops).toHaveLength(valid.groundDrops.length); expect(Object.keys(moved.tiles)).toHaveLength(Object.keys(valid.tiles).length);
  const bench = moved.placedItems.find(item => item.scene === SceneKey.Town && item.item === 'workbench')!;
  expect(bench).toMatchObject({ item: 'workbench', scene: SceneKey.Town, rotation: 1 }); expect(bench).not.toMatchObject(furniture);
  const movedCrop = Object.entries(moved.crops).find(([name]) => name.startsWith('TownScene:'))!;
  expect(movedCrop[0]).not.toBe(key); expect(movedCrop[1]).toEqual(planted); expect(moved.tiles[movedCrop[0]]).toBe('watered');
  const shop = moved.placements.find(item => item.id === 'town-moves')!;
  expect(shop).toMatchObject({ id: 'town-moves', type: 'shop', w: 2, h: 2 }); expect(shop).not.toMatchObject(building);
  expect(moved.groundDrops[0]).toMatchObject({ item: 'ale', scene: SceneKey.Town }); expect(moved.groundDrops[0]).not.toMatchObject(wall);
  expect(moved.placedItems.find(item => item.scene === SceneKey.Town && item.item === 'chest')).toEqual(source.placedItems[source.placedItems.length - 1]);
  expect(moved.tiles[`TownScene:${safe[1].tx},${safe[1].ty}`]).toBe('tilled');
  expect(moved.placements.find(item => item.id === 'town-stays')).toEqual(source.placements[source.placements.length - 1]);
  for (const field of ['inventory', 'chest', 'tavern', 'gold', 'player', 'appearance', 'toolbeltSlots', 'backpackSlots'] as const) expect(moved[field]).toEqual(valid[field]);
  expect(moved.placedItems.filter(item => item.scene !== SceneKey.Town)).toEqual(valid.placedItems.filter(item => item.scene !== SceneKey.Town));
  expect(moved.crops['FarmScene:42,42']).toEqual(valid.crops['FarmScene:42,42']);
  // The full load carries every one of these records on to the painted Town without losing any.
  const loaded = api.SaveSystem.load(1);
  expect(loaded.placedItems).toHaveLength(valid.placedItems.length); expect(loaded.placements).toHaveLength(valid.placements.length);
  expect(loaded.groundDrops).toHaveLength(valid.groundDrops.length); expect(Object.keys(loaded.tiles)).toHaveLength(Object.keys(valid.tiles).length);
});

test('safe Town players remain exact; newly blocked players move to the named safe arrival', () => {
  for (const blocked of [false, true]) {
    const env = runtime(), { api } = env, source = base(api), old = api.getLegacyTownRegionMapData(SceneKey.Town), map = api.getAuthoredTownMap();
    const safe = cells(api, SceneKey.Town, false, 1)[0];
    const obstruction = map.objects.find(object => object.tx < old.w - 1 && object.ty < old.h - 1 && free(old, object.tx, object.ty));
    if (!obstruction) throw new Error('Missing new tree on old walkable ground');
    const position = blocked ? obstruction : safe;
    source.activeScene = SceneKey.Town; source.player = { ...source.player, x: position.tx * 16 + 8, y: position.ty * 16 + 8 };
    const loaded = builtTown(api, legacy(api, source));
    const start = map.spawns.find(spawn => spawn.id === 'start')!;
    expect(loaded.player).toEqual(blocked ? { ...source.player, x: start.tx * 16 + 8, y: start.ty * 16 + 8, facing: 'down' } : source.player);
  }
});

test('the new Forest return corridor relocates old furnishings, soil/crops and buildings without losing their contents', () => {
  const env = runtime(), { api } = env, source = base(api);
  const [bench, crop, building] = cells(api, SceneKey.Forest, true, 3), key = `ForestScene:${crop.tx},${crop.ty}`;
  source.placedItems.push({ item: 'workbench', scene: SceneKey.Forest, ...bench, rotation: 1 });
  source.tiles[key] = 'watered'; source.crops[key] = { type: 'parsnip', stage: 2, maxStage: 3, watered: true, daysInStage: 2 };
  source.placements.push({ id: 'forest-moves', type: 'shop', scene: SceneKey.Forest, ...building, w: 2, h: 2 });
  const original = legacy(api, source); store(env, original); const moved = api.SaveSystem.load(1);
  const furnishing = moved.placedItems.find(item => item.scene === SceneKey.Forest)!;
  expect(furnishing).toMatchObject({ item: 'workbench', rotation: 1 }); expect(furnishing).not.toMatchObject(bench);
  const growing = Object.entries(moved.crops).find(([name]) => name.startsWith('ForestScene:'))!;
  expect(growing[0]).not.toBe(key); expect(growing[1]).toEqual(original.crops[key]); expect(moved.tiles[growing[0]]).toBe('watered');
  const shop = moved.placements.find(item => item.id === 'forest-moves')!;
  expect(shop).toMatchObject({ id: 'forest-moves', type: 'shop', w: 2, h: 2 }); expect(shop).not.toMatchObject(building);
  expect(moved.placedItems).toHaveLength(original.placedItems.length); expect(moved.placements).toHaveLength(original.placements.length);
  expect(Object.keys(moved.crops)).toHaveLength(Object.keys(original.crops).length);
  expect(moved.placedItems.filter(item => item.scene !== SceneKey.Forest)).toEqual(original.placedItems.filter(item => item.scene !== SceneKey.Forest));
});

test('a moving crop cannot take the nearest legal cell already owned by stationary furniture', () => {
  const first = runtime(), source = base(first.api), [cell] = cells(first.api, SceneKey.Town, true, 1);
  const oldKey = `TownScene:${cell.tx},${cell.ty}`;
  source.tiles[oldKey] = 'watered'; source.crops[oldKey] = { type: 'parsnip', stage: 1, maxStage: 3, watered: true, daysInStage: 1 };
  const firstResult = builtTown(first.api, legacy(first.api, source));
  const firstKey = Object.keys(firstResult.crops).find(key => key.startsWith('TownScene:'))!;
  const [tx, ty] = firstKey.split(':')[1].split(',').map(Number);
  const second = runtime(); source.placedItems.push({ item: 'chest', scene: SceneKey.Town, tx, ty, rotation: 0 });
  const result = builtTown(second.api, legacy(second.api, source));
  expect(result.placedItems.find(item => item.scene === SceneKey.Town)).toEqual({ item: 'chest', scene: SceneKey.Town, tx, ty, rotation: 0 });
  expect(result.crops[firstKey]).toBeUndefined();
  const key = Object.keys(result.crops).find(key => key.startsWith('TownScene:'))!;
  expect(result.crops[key]).toEqual(source.crops[oldKey]); expect(result.tiles[key]).toBe('watered');
});

test('a formerly legal chest moves when new Town trees would make it trap a surviving crop', () => {
  const env = runtime(), { api } = env, source = base(api), map = api.getAuthoredTownMap();
  const crop = { tx: 11, ty: 5 }, chest = { tx: 10, ty: 5 }, key = 'TownScene:11,5';
  const old = api.getLegacyTownRegionMapData(SceneKey.Town);
  expect(free(old, crop.tx, crop.ty)).toBe(true); expect(free(old, chest.tx, chest.ty)).toBe(true);
  expect(free(map, crop.tx, crop.ty)).toBe(true); expect(free(map, chest.tx, chest.ty)).toBe(true);
  const approaches = [[10, 5], [12, 5], [11, 4], [11, 6]].filter(([tx, ty]) =>
    !map.solid[ty][tx] && !map.objects.some(object => object.tx === tx && object.ty === ty));
  expect(approaches).toEqual([[10, 5]]); // This is a real authored choke point, not a synthetic fake map.
  source.tiles[key] = 'watered'; source.crops[key] = { type: 'parsnip', stage: 1, maxStage: 3, watered: true, daysInStage: 1 };
  source.placedItems.push({ item: 'chest', scene: SceneKey.Town, ...chest, rotation: 0 });
  const result = builtTown(api, legacy(api, source));
  expect(result.crops[key]).toEqual(source.crops[key]); expect(result.tiles[key]).toBe('watered');
  const moved = result.placedItems.find(item => item.scene === SceneKey.Town)!;
  expect(moved).toMatchObject({ item: 'chest', rotation: 0 }); expect(moved).not.toMatchObject(chest);
  expect(result.placedItems).toHaveLength(source.placedItems.length);
});

test('old Town and Forest removal/stage markers reset with the painted Town and Forest instead of hiding new nodes', () => {
  const env = runtime(), { api } = env, source = base(api);
  // why: the painted Town (save version 27) and the painted Forest (version 26) replaced every old tree and rock,
  // so a pre-v11 marker names a node that no longer exists and is dropped rather than moved.
  // The pre-v11 Town had no trees, so its marker names an ordinary open tile, as the old saves did.
  const [townCell] = cells(api, SceneKey.Town, false, 1);
  const oldTree = api.getLegacyTownRegionMapData(SceneKey.Forest).objects.find(object => object.kind === 'tree')!;
  for (const [key, day] of [[`TownScene:${townCell.tx},${townCell.ty}`, 2], [`ForestScene:${oldTree.tx},${oldTree.ty}`, 3]] as const) {
    source.removedNodes[key] = { kind: 'tree', day }; source.treeStages[key] = { stage: 'stump', sinceDay: day };
  }
  store(env, legacy(api, source)); const loaded = api.SaveSystem.load(1);
  expect(Object.keys(loaded.removedNodes).filter(name => /^(Town|Forest)Scene:/.test(name))).toEqual([]);
  expect(Object.keys(loaded.treeStages).filter(name => /^(Town|Forest)Scene:/.test(name))).toEqual([]);
  const notice = api.SaveSystem.consumeMigrationNotice();
  expect(notice).toContain('The forest has a new look');
  expect(notice).toContain('The town has a new look');
});

test('malformed or out-of-bounds old regional records reject atomically instead of relocating corruption', () => {
  for (const kind of ['key', 'soil-bounds', 'drop-bounds', 'building-bounds', 'marker-key', 'player-bounds']) {
    const env = runtime(), { api } = env, source = base(api);
    if (kind === 'key') source.tiles['TownScene:01,2'] = 'tilled';
    if (kind === 'soil-bounds') source.tiles['TownScene:80,20'] = 'tilled';
    if (kind === 'drop-bounds') source.groundDrops.push({ scene: SceneKey.Forest, item: 'wood', tx: 80, ty: 20 });
    if (kind === 'building-bounds') source.placements.push({ id: 'broken', type: 'shop', scene: SceneKey.Town, tx: 78, ty: 20, w: 3, h: 2 });
    if (kind === 'marker-key') source.removedNodes['TownScene-no-colon'] = { kind: 'tree', day: 1 };
    if (kind === 'player-bounds') { source.activeScene = SceneKey.Town; source.player.x = 81 * 16; }
    const raw = store(env, source), live = api.GameState.instance.toSaveData();
    expect(api.SaveSystem.inspectSlot(1).status, kind).toBe('corrupt'); expect(() => api.SaveSystem.load(1), kind).toThrow();
    expect(api.GameState.instance.toSaveData()).toEqual(live); expect(env.writes).toEqual([]);
    expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(raw);
  }
});

test('current saves retain byte-exact Town backups, block backup failures, and round-trip without migrating', () => {
  const env = runtime(), { api } = env, original = store(env, base(api));
  const loaded = api.SaveSystem.load(1), backup = api.SaveSystem.townLayoutBackupKey(1), slot = api.SaveSystem.storageKey(1);
  env.bytes.set(backup, 'unrelated older bytes'); expect(() => api.SaveSystem.save(1)).toThrow('different pre-town backup');
  expect(env.bytes.get(backup)).toBe('unrelated older bytes'); expect(env.bytes.get(slot)).toBe(original); expect(env.writes).toEqual([]);
  env.bytes.delete(backup); env.fail(backup); expect(() => api.SaveSystem.save(1)).toThrow('quota');
  expect(env.bytes.get(slot)).toBe(original); expect(env.bytes.has(backup)).toBe(false);
  env.fail(slot); expect(() => api.SaveSystem.save(1)).toThrow('quota');
  expect(env.bytes.get(backup)).toBe(original); expect(env.bytes.get(slot)).toBe(original);
  env.fail(null); api.SaveSystem.save(1, 56789);
  const civicBackup = api.SaveSystem.townBuildingsBackupKey(1);
  const relationshipBackup = api.SaveSystem.relationshipsBackupKey(1);
  const socialBackup = api.SaveSystem.socialNetworkBackupKey(1);
  const justiceBackup = api.SaveSystem.justiceBackupKey(1);
  const cuddleBackup = api.SaveSystem.cuddleBackupKey(1);
  expect(env.writes).toEqual([backup, civicBackup, relationshipBackup, socialBackup, justiceBackup, cuddleBackup, slot]);
  expect(JSON.parse(env.bytes.get(slot)!).version).toBe(30);
  expect(env.bytes.get(civicBackup)).toBe(original);
  expect(env.bytes.get(relationshipBackup)).toBe(original);
  expect(env.bytes.get(socialBackup)).toBe(original);
  expect(env.bytes.get(justiceBackup)).toBe(original);
  expect(env.bytes.get(cuddleBackup)).toBe(original);
  expect(env.bytes.has(api.SaveSystem.farmLayoutBackupKey(1))).toBe(false);
  expect(api.SaveSystem.load(1)).toEqual(loaded); expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();
  api.SaveSystem.save(1, 56790); expect(env.bytes.get(backup)).toBe(original);
  expect(env.writes).toEqual([backup, civicBackup, relationshipBackup, socialBackup, justiceBackup, cuddleBackup, slot, slot]);
});
