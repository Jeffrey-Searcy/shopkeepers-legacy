/** Server-free save-migration proofs using the actual bundled game modules and isolated in-memory storage. */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import { SceneKey } from '../src/config/AssetKeys';
import type { GameSaveData, GameState as State } from '../src/state/GameState';
import type { MapData } from '../src/world/MapDef';

/** Actual module surface under test, not a rewritten migration model. */
interface Runtime {
  GameState: typeof import('../src/state/GameState').GameState;
  SaveSystem: typeof import('../src/systems/SaveSystem').SaveSystem;
  getLegacyFarmMapData: typeof import('../src/world/MapDef').getLegacyFarmMapData;
  getAuthoredMapData: typeof import('../src/world/MapDef').getAuthoredMapData;
  migrateFarmLayout: typeof import('../src/systems/FarmLayoutMigration').migrateFarmLayout;
  treeCellAvailable: typeof import('../src/config/Trees').treeCellAvailable;
  createLegacyTavernState: typeof import('../src/config/Tavern').createLegacyTavernState;
  createV7TavernState: typeof import('../src/config/Tavern').createV7TavernState;
}

const bundled = buildSync({ stdin: { resolveDir: process.cwd(), contents: `
  export {GameState} from './src/state/GameState';
  export {SaveSystem} from './src/systems/SaveSystem';
  export {migrateFarmLayout} from './src/systems/FarmLayoutMigration';
  export {getLegacyFarmMapData,getAuthoredMapData} from './src/world/MapDef';
  export {treeCellAvailable} from './src/config/Trees';
  export {createLegacyTavernState,createV7TavernState} from './src/config/Tavern';
` }, bundle: true, write: false, platform: 'node', format: 'cjs',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Give each proof fresh module state and exact storage bytes; injected failures emulate browser quota denial. */
function runtime(): { api: Runtime; bytes: Map<string, string>; writes: string[]; failWritesTo(key: string | null): void } {
  const bytes = new Map<string, string>(), writes: string[] = [];
  let failedKey: string | null = null;
  const storage = {
    /** Read one test-owned key without touching the user's browser. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Record successful writes, or throw before changing bytes when this key is under failure injection. */
    setItem(key: string, value: string): void {
      if (key === failedKey) throw new Error('Injected storage quota failure');
      writes.push(key); bytes.set(key, value);
    },
    /** Remove one test-owned key. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundled)(module, module.exports, storage,
    { location: { search: '?test=1&seed=42' } });
  return { api: module.exports as Runtime, bytes, writes,
    /** Configure the next failing storage key; null restores normal in-memory writes. */
    failWritesTo(key): void { failedKey = key; } };
}

/** Create a nontrivial current hospitality save parked indoors, where farm migration must preserve exact positions. */
function indoorState(api: Runtime): GameSaveData {
  const state = new api.GameState();
  state.day = 8; state.gold = 432; state.chest = { wood: 17, stone: 4 };
  state.addItem('ale', 3);
  state.activeScene = SceneKey.Tavern;
  const entry = api.getAuthoredMapData(SceneKey.Tavern).spawns.find(value => value.id === 'entry');
  if (!entry) throw new Error('Missing indoor entry fixture');
  state.player = { x: (entry.tx + 0.5) * 16, y: (entry.ty + 0.5) * 16, facing: 'left', stamina: 72 };
  state.tavern = { ...state.tavern, level: 1, welcomeClaimed: true, foodSold: 2, totalServed: 2, revenue: 24 };
  state.placedItems = [{ item: 'chair', scene: SceneKey.Tavern, tx: 10, ty: 8, rotation: 1 },
    { item: 'chair', scene: SceneKey.Bedroom, tx: 6, ty: 6, rotation: 2 },
    { item: 'chest', scene: SceneKey.Home, tx: 10, ty: 10, rotation: 0 },
    { item: 'chest', scene: SceneKey.Mines, tx: 10, ty: 10, rotation: 0 }];
  state.placements = [{ id: 'old-indoor', type: 'shop', scene: SceneKey.Home, tx: 12, ty: 10, w: 1, h: 1 },
    { id: 'old-mine', type: 'shop', scene: SceneKey.Mines, tx: 12, ty: 10, w: 1, h: 1 }];
  state.tiles['TownScene:8,9'] = 'watered';
  state.crops['TownScene:8,9'] = { type: 'parsnip', stage: 1, maxStage: 3, watered: true, daysInStage: 1 };
  return api.GameState.candidateFromSaveData(state.toSaveData(), 9, api.getLegacyFarmMapData()).toSaveData();
}

/**
 * Split a save's soil and crop records into the Town part and the rest.
 * why: since save version 27 the Town is a painting of another size, so every old Town record is carried to new
 * ground (TownLayoutMigration.migratePaintedTown). Its cell changes; its contents must not.
 * @param save a loaded or source save
 * @returns `other`: the non-Town tiles and crops by key; `town`: the Town soil records without their cells
 */
function splitTownSoil(save: GameSaveData): {
  other: { tiles: GameSaveData['tiles']; crops: GameSaveData['crops'] };
  town: Array<{ tile: GameSaveData['tiles'][string] | undefined; crop: GameSaveData['crops'][string] | undefined }>;
} {
  const isTown = (key: string): boolean => key.startsWith(`${SceneKey.Town}:`);
  const keys = [...new Set([...Object.keys(save.tiles), ...Object.keys(save.crops)])].sort();
  return {
    other: { tiles: Object.fromEntries(Object.entries(save.tiles).filter(([key]) => !isTown(key))),
      crops: Object.fromEntries(Object.entries(save.crops).filter(([key]) => !isTown(key))) },
    town: keys.filter(isTown).map(key => ({ tile: save.tiles[key], crop: save.crops[key] })),
  };
}

/** Install exact legacy JSON without invoking any migration or save write. */
function storeLegacy(env: ReturnType<typeof runtime>, state: unknown, version = 9): string {
  const text = JSON.stringify({ version, slot: 1, savedAt: 12345, state }, null, 1);
  env.bytes.set(env.api.SaveSystem.storageKey(1), text);
  return text;
}

/** Select real old grass that becomes a new wall, explicitly clearing its old resource before planting. */
function collisionCell(api: Runtime, state: State, oldMap: MapData, newMap: MapData): { tx: number; ty: number } {
  for (let ty = 1; ty < oldMap.h - 1; ty++) for (let tx = 1; tx < oldMap.w - 1; tx++) {
    if (!newMap.solid[ty][tx] || oldMap.solid[ty][tx] || oldMap.ground[ty][tx] !== 'grass') continue;
    const key = `${SceneKey.Farm}:${tx},${ty}`, object = oldMap.objects.find(value => value.tx === tx && value.ty === ty);
    if (object) state.removedNodes[key] = { kind: object.kind, day: 1 };
    if (api.treeCellAvailable(state, tx, ty, oldMap) && !state.plantedTrees[key]) return { tx, ty };
  }
  throw new Error('Missing old-grass/new-wall fixture');
}

test('v9 migration preserves interiors and hospitality; inspection/load do not write, first overwrite backs up exact raw bytes', () => {
  const env = runtime(), { api } = env, source = indoorState(api);
  source.placedItems.push({ item: 'chair', scene: SceneKey.Farm, tx: 40, ty: 40, rotation: 0 });
  source.placements.push({ id: 'outdoor-shop', type: 'shop', scene: SceneKey.Town, tx: 10, ty: 10, w: 2, h: 2 });
  const original = storeLegacy(env, source), live = JSON.stringify(api.GameState.instance.toSaveData());
  expect(api.SaveSystem.listSlots()[0].status).toBe('ready');
  expect(env.writes).toEqual([]);
  expect(JSON.stringify(api.GameState.instance.toSaveData())).toBe(live);
  const migrated = api.SaveSystem.load(1);
  expect(env.writes).toEqual([]);
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(original);
  for (const field of ['player', 'inventory', 'chest', 'tavern', 'appearance', 'gold', 'toolbeltSlots', 'backpackSlots'] as const) {
    expect(migrated[field]).toEqual(source[field]);
  }
  // The Town soil moves onto the painted Town as one intact record; everything else keeps its exact cell.
  expect(splitTownSoil(migrated)).toEqual(splitTownSoil(source));
  expect(splitTownSoil(source).town).toHaveLength(1);
  expect(migrated.placedItems).toEqual(source.placedItems.filter(item => item.scene !== SceneKey.Farm));
  expect(migrated.placements).toEqual(source.placements.filter(item => item.scene !== SceneKey.Town));
  expect(api.SaveSystem.consumeMigrationNotice()).toContain('Removed 1 outdoor furnishings and 1 outdoor building placements');
  api.SaveSystem.saveCurrent(54321);
  expect(env.writes).toEqual([api.SaveSystem.farmLayoutBackupKey(1), api.SaveSystem.townLayoutBackupKey(1),
    api.SaveSystem.townBuildingsBackupKey(1), api.SaveSystem.relationshipsBackupKey(1),
    api.SaveSystem.socialNetworkBackupKey(1), api.SaveSystem.justiceBackupKey(1), api.SaveSystem.cuddleBackupKey(1),
    api.SaveSystem.storageKey(1)]);
  expect(env.bytes.get(api.SaveSystem.farmLayoutBackupKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.townLayoutBackupKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.townBuildingsBackupKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.relationshipsBackupKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.socialNetworkBackupKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.justiceBackupKey(1))).toBe(original);
  expect(JSON.parse(env.bytes.get(api.SaveSystem.storageKey(1))!).version).toBe(30);
  expect(api.SaveSystem.load(1)).toEqual(migrated);
  expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();
  api.SaveSystem.saveCurrent(54322);
  expect(env.bytes.get(api.SaveSystem.farmLayoutBackupKey(1))).toBe(original);
});

test('crop/soil bundles and planted species relocate intact; other valid cells and indoor player remain exact', () => {
  const env = runtime(), { api } = env, oldMap = api.getLegacyFarmMapData(), newMap = api.getAuthoredMapData(SceneKey.Farm);
  const state = api.GameState.candidateFromSaveData(indoorState(api), 9, oldMap);
  const cropCell = collisionCell(api, state, oldMap, newMap), cropKey = `${SceneKey.Farm}:${cropCell.tx},${cropCell.ty}`;
  const crop = { type: 'parsnip', stage: 2, maxStage: 3, watered: true, daysInStage: 2 };
  state.tiles[cropKey] = 'watered'; state.crops[cropKey] = crop;
  const treeCell = collisionCell(api, state, oldMap, newMap), treeKey = `${SceneKey.Farm}:${treeCell.tx},${treeCell.ty}`;
  const tree = { species: 'pine' as const, stage: 'small' as const, sinceDay: 3 };
  state.plantedTrees[treeKey] = tree;
  const safePickup = newMap.spawns.find(value => value.id === 'from_home')!;
  state.groundDrops = [{ scene: SceneKey.Farm, item: 'wood', ...cropCell },
    { scene: SceneKey.Town, item: 'stone', tx: 8, ty: 9 }, { scene: SceneKey.Farm, item: 'ale', tx: safePickup.tx, ty: safePickup.ty }];
  const source = api.GameState.candidateFromSaveData(state.toSaveData(), 9, oldMap).toSaveData();
  const original = storeLegacy(env, source), first = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(first.crops[cropKey]).toBeUndefined(); expect(first.plantedTrees[treeKey]).toBeUndefined();
  const movedCrop = Object.entries(first.crops).find(([key]) => key.startsWith('FarmScene:'));
  expect(movedCrop).toBeDefined(); expect(movedCrop![1]).toEqual(crop); expect(first.tiles[movedCrop![0]]).toBe('watered');
  expect(Object.values(first.plantedTrees)).toEqual([tree]);
  expect(Object.keys(first.crops)).toHaveLength(Object.keys(source.crops).length);
  expect(Object.keys(first.tiles)).toHaveLength(Object.keys(source.tiles).length);
  expect(first.player).toEqual(source.player); expect(splitTownSoil(first).town).toEqual(splitTownSoil(source).town);
  expect(notice).toContain('1 soil records, 1 crops and 1 planted trees');
  expect(notice).toContain('1 farm pickups');
  expect(first.groundDrops.map(drop => drop.item)).toEqual(source.groundDrops.map(drop => drop.item));
  expect(first.groundDrops[0]).not.toEqual(source.groundDrops[0]);
  // The Town stone moves onto the painted Town (save version 27) as the same pickup; the Farm ale stays exact.
  expect(first.groundDrops[1]).toMatchObject({ scene: SceneKey.Town, item: 'stone' });
  expect(first.groundDrops[2]).toEqual(source.groundDrops[2]);
  expect(api.SaveSystem.load(1)).toEqual(first);
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(original);
});

test('authored resource remapping is swap-safe and orphan markers never clear newly authored resources', () => {
  const { api } = runtime(), oldMap = api.getLegacyFarmMapData(), newMap = structuredClone(oldMap);
  const treeIndices = oldMap.objects.map((object, index) => ({ object, index })).filter(value => value.object.kind === 'tree').slice(0, 2);
  const [a, b] = treeIndices;
  newMap.objects[a.index] = { ...a.object, tx: b.object.tx, ty: b.object.ty };
  newMap.objects[b.index] = { ...b.object, tx: a.object.tx, ty: a.object.ty };
  const state = api.GameState.candidateFromSaveData(indoorState(api), 9, oldMap);
  const aKey = `FarmScene:${a.object.tx},${a.object.ty}`, bKey = `FarmScene:${b.object.tx},${b.object.ty}`;
  state.removedNodes[aKey] = { kind: 'tree', day: 1 }; state.removedNodes[bKey] = { kind: 'tree', day: 2 };
  state.treeStages[aKey] = { stage: 'stump', sinceDay: 1 }; state.treeStages[bKey] = { stage: 'small', sinceDay: 2 };
  const notices: string[] = [];
  api.migrateFarmLayout(state, oldMap, newMap, notices);
  expect(state.removedNodes[aKey].day).toBe(2); expect(state.removedNodes[bKey].day).toBe(1);
  expect(state.treeStages[aKey].stage).toBe('small'); expect(state.treeStages[bKey].stage).toBe('stump');
  const movedMap = structuredClone(oldMap), orphanKey = 'FarmScene:40,40';
  expect(oldMap.objects.some(object => object.tx === 40 && object.ty === 40)).toBe(false);
  movedMap.objects[a.index] = { ...a.object, tx: 40, ty: 40 };
  const orphanState = api.GameState.candidateFromSaveData(indoorState(api), 9, oldMap);
  orphanState.removedNodes[orphanKey] = { kind: 'tree', day: 3 };
  api.migrateFarmLayout(orphanState, oldMap, movedMap, notices);
  expect(orphanState.removedNodes[orphanKey]).toBeUndefined();
  expect(Object.values(orphanState.removedNodes)).toEqual([{ kind: 'tree', day: 3 }]);
  expect(notices.join(' ')).toContain('player-tree marker');
});

test('a keeper caught by the new farm wall resumes safely while v11 round trips do not migrate again', () => {
  const env = runtime(), { api } = env, oldMap = api.getLegacyFarmMapData(), newMap = api.getAuthoredMapData(SceneKey.Farm);
  const state = api.GameState.candidateFromSaveData(indoorState(api), 9, oldMap), cell = collisionCell(api, state, oldMap, newMap);
  state.activeScene = SceneKey.Farm; state.player.x = cell.tx * 16 + 8; state.player.y = cell.ty * 16 + 8;
  storeLegacy(env, state.toSaveData());
  const saved = api.SaveSystem.load(1), spawn = newMap.spawns.find(value => value.id === 'from_home')!;
  expect(saved.player.x).toBe(spawn.tx * 16 + 8); expect(saved.player.y).toBe(spawn.ty * 16 + 8);
  expect(api.SaveSystem.consumeMigrationNotice()).toContain('safe shop arrival');
  api.SaveSystem.save(1); expect(api.SaveSystem.load(1)).toEqual(saved);
});

test('invalid legacy state and failed backup writes preserve original bytes and never partially install a candidate', () => {
  const env = runtime(), { api } = env, source = indoorState(api);
  const bad = { ...source, plantedTrees: { 'FarmScene:40,40': { species: 'pine', stage: 'small', sinceDay: 999 } } };
  const invalid = storeLegacy(env, bad), live = JSON.stringify(api.GameState.instance.toSaveData());
  expect(api.SaveSystem.inspectSlot(1).status).toBe('corrupt'); expect(() => api.SaveSystem.load(1)).toThrow();
  expect(JSON.stringify(api.GameState.instance.toSaveData())).toBe(live);
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(invalid); expect(env.writes).toEqual([]);
  const original = storeLegacy(env, source); api.SaveSystem.load(1);
  env.failWritesTo(api.SaveSystem.farmLayoutBackupKey(1));
  expect(() => api.SaveSystem.save(1)).toThrow('quota');
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(original); expect(env.bytes.has(api.SaveSystem.farmLayoutBackupKey(1))).toBe(false);
  env.failWritesTo(api.SaveSystem.storageKey(1));
  expect(() => api.SaveSystem.save(1)).toThrow('quota');
  expect(env.bytes.get(api.SaveSystem.storageKey(1))).toBe(original);
  expect(env.bytes.get(api.SaveSystem.farmLayoutBackupKey(1))).toBe(original);
  env.failWritesTo(null); api.SaveSystem.save(1);
  expect(env.bytes.get(api.SaveSystem.townLayoutBackupKey(1))).toBe(original);
  expect(JSON.parse(env.bytes.get(api.SaveSystem.storageKey(1))!).version).toBe(30);
});

test('every explicit old schema version still passes its existing schema migration before the farm move', () => {
  for (let version = 1; version <= 9; version++) {
    const env = runtime(), { api } = env, state = new api.GameState().toSaveData();
    const spawn = api.getLegacyFarmMapData().spawns.find(value => value.id === 'from_home')!;
    state.player.x = spawn.tx * 16 + 8; state.player.y = spawn.ty * 16 + 8;
    const payload: Record<string, unknown> = { ...state };
    if (version <= 6) payload.tavern = api.createLegacyTavernState();
    else if (version === 7) payload.tavern = api.createV7TavernState();
    else if (version === 8) { const { fights: _fights, ...oldTavern } = state.tavern; payload.tavern = oldTavern; }
    if (version <= 7) delete payload.plantedTrees;
    if (version <= 2) delete payload.appearance;
    if (version === 1) delete payload.tavern;
    storeLegacy(env, payload, version);
    expect(api.SaveSystem.inspectSlot(1).status, `source version ${version}`).toBe('ready');
    api.SaveSystem.load(1); api.SaveSystem.save(1);
    expect(JSON.parse(env.bytes.get(api.SaveSystem.storageKey(1))!).version).toBe(30);
  }
});

test('historical porch and removed Home redirects target the current named arrival, not the old shop site', () => {
  for (const home of [false, true]) {
    const env = runtime(), { api } = env, state = new api.GameState().toSaveData();
    const payload = { ...state, tavern: api.createLegacyTavernState(),
      activeScene: home ? SceneKey.Home : SceneKey.Farm,
      player: { ...state.player, x: home ? 168 : 1120, y: home ? 168 : 228 } };
    storeLegacy(env, payload, 3);
    const result = api.SaveSystem.load(1), spawn = api.getAuthoredMapData(SceneKey.Farm).spawns.find(value => value.id === 'from_home')!;
    expect(result.activeScene).toBe(SceneKey.Farm);
    expect(result.player.x).toBe(spawn.tx * 16 + 8); expect(result.player.y).toBe(spawn.ty * 16 + 8);
  }
});
