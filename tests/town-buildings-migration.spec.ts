/** Server-free civic-building proofs: geometry, v11 compatibility, immutable backups and durable room identities. */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import { SceneKey } from '../src/config/AssetKeys';
import type * as State from '../src/state/GameState';
import type * as Saves from '../src/systems/SaveSystem';
import type * as Maps from '../src/world/MapDef';
import type * as Town from '../src/world/TownMap';
import type * as Buildings from '../src/config/TownBuildings';

type API = typeof State & typeof Saves & typeof Maps & typeof Town & typeof Buildings;
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: [
  'export * from "./src/state/GameState";', 'export * from "./src/systems/SaveSystem";',
  'export * from "./src/world/MapDef";', 'export * from "./src/world/TownMap";', 'export * from "./src/config/TownBuildings";',
].join('\n') }, bundle: true, write: false, format: 'cjs', platform: 'node',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Run real save code with private in-memory storage; injected failures occur before any mutation. */
function runtime() {
  const bytes = new Map<string, string>(), writes: string[] = []; let failure: string | null = null;
  const storage = {
    /** Return exact fixture bytes, never browser storage. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Record write ordering after checking the requested failure key. */
    setItem(key: string, value: string): void { if (key === failure) throw new Error('Injected civic quota failure'); writes.push(key); bytes.set(key, value); },
    /** Delete one test-owned value. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundle)(module, module.exports, storage, { location: { search: '?test=1' } });
  return { api: module.exports as API, bytes, writes, fail(key: string | null): void { failure = key; } };
}

/** Build an explicit v11 fixture with protected shop/farm content and multiple conflicting town record types. */
function source(api: API) {
  const state = new api.GameState(); state.day = 5; state.gold = 348; state.chest = { wood: 23 };
  state.activeScene = SceneKey.Town; state.player = { x: 18 * 16 + 8, y: 42 * 16 + 8, facing: 'right', stamina: 67 };
  state.placedItems = [{ item: 'workbench', scene: SceneKey.Town, tx: 20, ty: 42, rotation: 1 },
    { item: 'chair', scene: SceneKey.Tavern, tx: 10, ty: 8, rotation: 3 },
    { item: 'chest', scene: SceneKey.Farm, tx: 40, ty: 40, rotation: 0 }];
  state.tiles['TownScene:23,41'] = 'watered'; state.crops['TownScene:23,41'] = { type: 'parsnip', stage: 2, maxStage: 3, daysInStage: 2, watered: true };
  state.placements = [{ id: 'keep-my-shop', type: 'shop', scene: SceneKey.Town, tx: 17, ty: 39, w: 2, h: 2 }];
  state.groundDrops = [{ scene: SceneKey.Town, item: 'ale', tx: 24, ty: 42 }];
  return api.GameState.candidateFromSaveData(state.toSaveData(), 11, api.getAuthoredMapData(SceneKey.Farm),
    new Map([[SceneKey.Town, api.getUnbuiltTownMap()]])).toSaveData();
}

test('all twelve distinct public rooms have durable keys, accessible entries and an untouched v11 underlay', () => {
  const { api } = runtime(), town = api.getAuthoredMapData(SceneKey.Town), old = api.getUnbuiltTownMap();
  // why: since save version 27 the live Town is the painting, but v11-v26 saves still load through the built
  // 120x110 Town, which must keep the v11 terrain under its buildings so those saves validate unchanged.
  const built = api.getAuthoredTownMap();
  expect(api.TOWN_BUILDINGS).toHaveLength(12); expect(new Set(api.TOWN_BUILDINGS.map(building => building.scene)).size).toBe(12);
  expect(town.warps).toHaveLength(17); expect(built.warps).toHaveLength(17); expect(old.warps).toHaveLength(4);
  expect(built.ground).toEqual(old.ground); expect(built.objects).toEqual(old.objects); expect(built.townPlan).toEqual(old.townPlan);
  for (const building of api.TOWN_BUILDINGS) {
    const room = api.getAuthoredMapData(building.scene), state = new api.GameState(), entry = room.spawns[0];
    expect(room.warps[0]).toMatchObject({ target: SceneKey.Town, spawn: `from_${building.id}`, doorFacing: 'south' });
    for (const map of [town, built]) expect(map.spawns.some(spawn => spawn.id === `from_${building.id}`), building.id).toBe(true);
    state.activeScene = building.scene; state.player.x = entry.tx * 16 + 8; state.player.y = entry.ty * 16 + 8;
    expect(api.GameState.candidateFromSaveData(state.toSaveData()).activeScene).toBe(building.scene);
    expect(room.solid[entry.ty][entry.tx]).toBe(false);
    // why: painted rooms may set furniture straight above the door (the Tailor's cutting table), so the
    // proof is that the keeper can step off the entry into the room, not that the step is straight north.
    const steps = [room.solid[entry.ty - 1][entry.tx], room.solid[entry.ty][entry.tx - 1], room.solid[entry.ty][entry.tx + 1]];
    expect(steps.includes(false), building.id).toBe(true);
  }
});

test('v11 conflicts move intact before current validation; public architecture never touches shop or Farm records', () => {
  const env = runtime(), original = source(env.api), key = env.api.SaveSystem.storageKey(1);
  const raw = JSON.stringify({ version: 11, slot: 1, savedAt: 7, state: original }, null, 2);
  env.bytes.set(key, raw);
  expect(env.api.SaveSystem.inspectSlot(1).status).toBe('ready'); expect(env.writes).toEqual([]);
  const loaded = env.api.SaveSystem.load(1);
  expect(env.writes).toEqual([]); expect(env.bytes.get(key)).toBe(raw);
  expect(loaded.placedItems).toHaveLength(original.placedItems.length);
  expect(loaded.placedItems[0]).toMatchObject({ item: 'workbench', rotation: 1 });
  expect(loaded.placedItems[0]).not.toEqual(original.placedItems[0]);
  expect(loaded.placedItems.slice(1)).toEqual(original.placedItems.slice(1));
  expect(loaded.placements[0]).toMatchObject({ id: 'keep-my-shop', type: 'shop', w: 2, h: 2 });
  expect(loaded.placements[0]).not.toEqual(original.placements[0]);
  expect(Object.values(loaded.crops)).toEqual(Object.values(original.crops));
  expect(Object.values(loaded.tiles)).toEqual(Object.values(original.tiles));
  expect(loaded.groundDrops).toHaveLength(1); expect(loaded.groundDrops[0]).toMatchObject({ scene: SceneKey.Town, item: 'ale' });
  expect(loaded.groundDrops[0]).not.toEqual(original.groundDrops[0]);
  expect(loaded.player).not.toEqual(original.player);
  for (const field of ['inventory', 'gold', 'tavern', 'chest', 'appearance', 'toolbeltSlots', 'backpackSlots'] as const) expect(loaded[field]).toEqual(original[field]);
  env.api.SaveSystem.save(1, 8);
  expect(env.bytes.get(env.api.SaveSystem.townBuildingsBackupKey(1))).toBe(raw);
  expect(JSON.parse(env.bytes.get(key)!).version).toBe(30);
  expect(env.api.SaveSystem.load(1)).toEqual(loaded);
});

test('failed civic backup never overwrites old bytes or disguises an existing recovery copy', () => {
  for (const kind of ['quota', 'different-backup']) {
    const env = runtime(), original = source(env.api), key = env.api.SaveSystem.storageKey(1), backup = env.api.SaveSystem.townBuildingsBackupKey(1);
    const raw = JSON.stringify({ version: 11, slot: 1, savedAt: 7, state: original }); env.bytes.set(key, raw);
    env.api.SaveSystem.load(1);
    if (kind === 'quota') env.fail(backup); else env.bytes.set(backup, 'older recovery copy');
    expect(() => env.api.SaveSystem.save(1)).toThrow(kind === 'quota' ? 'quota failure' : 'different pre-building backup');
    expect(env.bytes.get(key)).toBe(raw); expect(env.writes).toEqual([]);
    if (kind === 'different-backup') expect(env.bytes.get(backup)).toBe('older recovery copy');
  }
});

test('save and reload from each civic interior retain its exact room and feet position', () => {
  for (const building of runtime().api.TOWN_BUILDINGS) {
    const env = runtime(), state = new env.api.GameState(), room = env.api.getMapData(building.scene), spawn = room.spawns[0];
    state.activeScene = building.scene; state.player = { x: spawn.tx * 16 + 9, y: spawn.ty * 16 + 8, facing: 'left', stamina: 64 };
    env.api.GameState.installCandidate(state); env.api.SaveSystem.save(1, 44);
    expect(env.api.SaveSystem.load(1)).toEqual(state.toSaveData());
    const corrupted = state.toSaveData(); corrupted.player.x = 16; corrupted.player.y = 16;
    expect(() => env.api.GameState.candidateFromSaveData(corrupted)).toThrow('blocks a required room route');
  }
});

test('malformed public building placements reject before storage or live state can change', () => {
  const env = runtime(), source = new env.api.GameState().toSaveData(), key = env.api.SaveSystem.storageKey(1);
  source.placements.push({ id: 'illegal-public-shop', type: 'shop', scene: SceneKey.Market, tx: 8, ty: 8, w: 2, h: 2 });
  const raw = JSON.stringify({ version: 12, slot: 1, savedAt: 1, state: source }); env.bytes.set(key, raw);
  const before = env.api.GameState.instance.toSaveData();
  expect(() => env.api.SaveSystem.load(1)).toThrow('public interiors cannot contain player building placements');
  expect(env.api.GameState.instance.toSaveData()).toEqual(before); expect(env.bytes.get(key)).toBe(raw); expect(env.writes).toEqual([]);
});
