/**
 * Server-free proofs for the painted Forest (world/ForestArt.ts):
 *  - the map built from the painting is whole: both arrivals and both warps sit on open ground, every walkable
 *    tile is reachable from the Farm arrival (MapDef checks this when it builds), and only open grass is
 *    buildable;
 *  - every painted tree and rock frame in the node atlas holds real painted pixels around its foot tile,
 *    frames never overlap, and the Forest textures are wired into the manifest;
 *  - a save made on the version 11-25 Forest (version 25) loads on the painted layout: old node records reset,
 *    soil off the meadow goes, furnishings and blocked drops wait at the top of the Farm trail, a building in
 *    what is now the pond moves to the nearest legal ground, and a keeper there starts at the trail top;
 *  - a version 29 save with furniture, a pickup or the keeper on one of the three trees made choppable in
 *    version 30 moves only those, and a version 29 save with nothing there loads untouched;
 *  - a save made on the first Forest (version 10) only loses its Forest node records here; the version 11
 *    Town move (tests/town-layout-migration.spec.ts) settles its things.
 */
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { SceneKey, TextureKey } from '../src/config/AssetKeys';
import { FOREST_ART, FOREST_GRID, FOREST_NODES } from '../src/world/ForestArt';
import type * as State from '../src/state/GameState';
import type * as Saves from '../src/systems/SaveSystem';
import type * as Maps from '../src/world/MapDef';

type API = typeof State & typeof Saves & typeof Maps;
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: [
  'export * from "./src/state/GameState";', 'export * from "./src/systems/SaveSystem";', 'export * from "./src/world/MapDef";',
].join('\n') }, bundle: true, write: false, format: 'cjs', platform: 'node',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Run the real save code against private in-memory storage (never browser storage). */
function runtime() {
  const bytes = new Map<string, string>();
  const storage = {
    /** Return the fixture bytes for a key. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Store one value. */
    setItem(key: string, value: string): void { bytes.set(key, value); },
    /** Delete one value. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundle)(module, module.exports, storage, { location: { search: '?test=1' } });
  return { api: module.exports as API, bytes };
}

/** First tile in the Forest grid (row-major) whose w x h block holds only the given legend character. */
function firstBlock(char: string, w = 1, h = 1): { tx: number; ty: number } {
  for (let ty = 0; ty + h <= FOREST_GRID.length; ty++) {
    for (let tx = 0; tx + w <= FOREST_GRID[ty].length; tx++) {
      let all = true;
      for (let y = ty; y < ty + h && all; y++) for (let x = tx; x < tx + w; x++) if (FOREST_GRID[y][x] !== char) all = false;
      if (all) return { tx, ty };
    }
  }
  throw new Error(`Forest grid has no ${w}x${h} block of "${char}"`);
}

test('the painted Forest map is whole: both arrivals and warps are open and only grass is buildable', () => {
  const { api } = runtime(), map = api.getMapData(SceneKey.Forest);
  expect([map.w, map.h]).toEqual([80, 70]);
  expect(map.spawns.map(spawn => [spawn.id, spawn.tx, spawn.ty])).toEqual([['from_farm', 21, 2], ['from_town', 77, 53]]);
  expect(map.warps).toEqual([
    expect.objectContaining({ tx: 20, ty: 0, w: 3, h: 1, target: SceneKey.Farm, spawn: 'from_forest' }),
    expect.objectContaining({ tx: 79, ty: 52, w: 1, h: 3, target: SceneKey.Town, spawn: 'from_forest' }),
  ]);
  for (const spawn of map.spawns) expect(map.solid[spawn.ty][spawn.tx], spawn.id).toBe(false);
  expect(map.objects.filter(obj => obj.painted)).toHaveLength(15);
  expect(map.objects.filter(obj => obj.kind === 'weed')).toHaveLength(20);
  // why: mushrooms and leeks spawn on open ground and the keeper fishes in the pond, so all three grounds exist.
  expect(map.ground.flat()).toEqual(expect.arrayContaining(['grass', 'dirt', 'water']));
  let buildable = 0;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!map.buildable[ty][tx]) continue;
    buildable++;
    expect(FOREST_GRID[ty][tx], `${tx},${ty}`).toBe(',');
  }
  expect(buildable).toBeGreaterThan(500);
  // The Farm and Town arrivals must find each other: the Town road is the second way home.
  const ends = api.getMapData(SceneKey.Town).warps.filter(warp => warp.target === SceneKey.Forest);
  expect(ends.map(warp => warp.spawn)).toEqual(['from_town']);
  expect(api.getMapData(SceneKey.Town).spawns.some(spawn => spawn.id === 'from_forest')).toBe(true);
  expect(api.getMapData(SceneKey.Farm).warps.filter(warp => warp.target === SceneKey.Forest).map(warp => warp.spawn)).toEqual(['from_farm']);
});

test('every painted Forest tree and rock frame holds real pixels around its foot and never overlaps another', () => {
  const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).textures;
  for (const [key, file] of [[TextureKey.Forest, 'forest/forest.png'], [TextureKey.ForestFront, 'forest/forest-front.png'], [TextureKey.ForestNodes, 'forest/forest-nodes.png']]) {
    expect(manifest[key]).toEqual({ type: 'image', file });
  }
  for (const file of ['forest.png', 'forest-front.png']) {
    const image = PNG.sync.read(readFileSync(`public/assets/forest/${file}`));
    expect([image.width, image.height], file).toEqual([FOREST_ART.widthTexels, FOREST_ART.heightTexels]);
  }
  const atlas = PNG.sync.read(readFileSync('public/assets/forest/forest-nodes.png'));
  const alpha = (x: number, y: number): number => atlas.data[(y * atlas.width + x) * 4 + 3];
  const frames = FOREST_NODES.filter(obj => obj.painted).map(obj => ({ obj, art: obj.painted! }));
  expect(frames.map(({ obj }) => obj.kind).sort()).toEqual([...Array(6).fill('rock'), ...Array(9).fill('tree')]);
  for (const { obj, art } of frames) {
    const label = `${obj.kind} ${obj.tx},${obj.ty}`;
    expect(art.texture, label).toBe(TextureKey.ForestNodes);
    expect(art.frameX + art.w <= atlas.width && art.frameY + art.h <= atlas.height, label).toBe(true);
    let solid = 0;
    for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) if (alpha(art.frameX + x, art.frameY + y) >= 128) solid++;
    expect(solid / (art.w * art.h), label).toBeGreaterThan(0.3);
    // The foot of the node (bottom centre of its tile) must sit on painted pixels, so the art is registered
    // to the tile the keeper chops or mines, not drawn somewhere nearby.
    const footX = Math.round((obj.tx + 0.5) * 32) - art.roomX, footY = (obj.ty + 1) * 32 - art.roomY;
    let near = 0;
    for (let y = Math.max(0, footY - 24); y < Math.min(art.h, footY + 4); y++) {
      for (let x = Math.max(0, footX - 12); x < Math.min(art.w, footX + 12); x++) if (alpha(art.frameX + x, art.frameY + y) >= 128) near++;
    }
    expect(near, label).toBeGreaterThan(100);
  }
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i].art, b = frames[j].art;
    const overlap = a.frameX < b.frameX + b.w && b.frameX < a.frameX + a.w && a.frameY < b.frameY + b.h && b.frameY < a.frameY + a.h;
    expect(overlap, `${i}/${j}`).toBe(false);
  }
});

test('a version 25 save on the old Forest loads on the painted layout with every change explained', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1), map = api.getMapData(SceneKey.Forest);
  const pond = firstBlock('~', 2, 2), trail = firstBlock('='), meadow = { tx: 18, ty: 50 };
  expect(FOREST_GRID[meadow.ty][meadow.tx]).toBe(',');
  const meadowKey = `${SceneKey.Forest}:${meadow.tx},${meadow.ty}`, trailKey = `${SceneKey.Forest}:${trail.tx},${trail.ty}`;
  const state = new api.GameState().toSaveData();
  state.activeScene = SceneKey.Forest;
  state.player = { x: pond.tx * 16 + 8, y: pond.ty * 16 + 8, facing: 'up', stamina: 50 };
  state.removedNodes = { [`${SceneKey.Forest}:15,6`]: { kind: 'tree', day: 2 }, [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } };
  state.treeStages = { [`${SceneKey.Forest}:15,6`]: { stage: 'stump', sinceDay: 2 } };
  state.tiles = { [meadowKey]: 'tilled', [trailKey]: 'watered' };
  state.crops = { [trailKey]: { type: 'parsnip', stage: 1, maxStage: 3, daysInStage: 0, watered: true } };
  state.placedItems = [{ item: 'chair', scene: SceneKey.Forest, tx: 30, ty: 30, rotation: 0 }];
  state.placements = [{ id: 'pond-shop', type: 'shop', scene: SceneKey.Forest, tx: pond.tx, ty: pond.ty, w: 2, h: 2 }];
  state.groundDrops = [{ scene: SceneKey.Forest, item: 'wood', tx: pond.tx, ty: pond.ty }, { scene: SceneKey.Forest, item: 'mushroom', tx: meadow.tx, ty: meadow.ty - 1 }];
  bytes.set(key, JSON.stringify({ version: 25, slot: 1, savedAt: 9, state }));

  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(loaded.removedNodes).toEqual({ [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } });
  expect(loaded.treeStages).toEqual({});
  expect(loaded.tiles).toEqual({ [meadowKey]: 'tilled' });
  expect(loaded.crops).toEqual({});
  expect(loaded.placedItems).toEqual([]);
  expect(loaded.groundDrops).toEqual(expect.arrayContaining([
    { scene: SceneKey.Forest, item: 'wood', tx: 21, ty: 2 },
    { scene: SceneKey.Forest, item: 'mushroom', tx: meadow.tx, ty: meadow.ty - 1 },
    { scene: SceneKey.Forest, item: 'chair', tx: 21, ty: 2 },
  ]));
  // The building keeps its id, type and size, and now stands wholly on buildable ground.
  const shop = loaded.placements.find(placement => placement.id === 'pond-shop')!;
  expect(shop).toMatchObject({ type: 'shop', scene: SceneKey.Forest, w: 2, h: 2 });
  expect(shop).not.toMatchObject({ tx: pond.tx, ty: pond.ty });
  for (let y = shop.ty; y < shop.ty + 2; y++) for (let x = shop.tx; x < shop.tx + 2; x++) expect(map.buildable[y][x], `${x},${y}`).toBe(true);
  expect(loaded.player).toMatchObject({ x: 21.5 * 16, y: 2.5 * 16, facing: 'down', stamina: 50 });
  for (const line of ['forest has a new look, so all of its trees, rocks and weeds stand again', '1 tilled tiles and 1 crops',
    '2 of your things at the forest now wait at the top of the Farm trail', 'your keeper starts at the top of the Farm trail',
    'moved 1 saved placements']) {
    expect(notice).toContain(line);
  }

  // A save made by this version is not moved again: the keeper's spot and the building survive a reload.
  api.SaveSystem.save(1, 10);
  expect(JSON.parse(bytes.get(key)!).version).toBe(30);
  const again = api.SaveSystem.load(1);
  expect(again.player).toEqual(loaded.player);
  expect(again.placements).toEqual(loaded.placements);
  expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();
});

test('a version 29 save with things on the three new Forest trees moves only those things', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1), map = api.getMapData(SceneKey.Forest);
  // Version 30 made these painted trees choppable; before that their tiles were open grass.
  const [pine, oakWest, oakSouth] = [{ tx: 46, ty: 27 }, { tx: 11, ty: 43 }, { tx: 43, ty: 57 }];
  for (const cell of [pine, oakWest, oakSouth]) {
    expect(map.objects.find(obj => obj.tx === cell.tx && obj.ty === cell.ty)?.kind, `${cell.tx},${cell.ty}`).toBe('tree');
  }
  const meadow = { tx: 18, ty: 50 };
  const state = new api.GameState().toSaveData();
  state.activeScene = SceneKey.Forest;
  state.player = { x: oakSouth.tx * 16 + 8, y: oakSouth.ty * 16 + 8, facing: 'up', stamina: 50 };
  state.placedItems = [{ item: 'chair', scene: SceneKey.Forest, tx: pine.tx, ty: pine.ty, rotation: 0 }];
  state.groundDrops = [{ scene: SceneKey.Forest, item: 'wood', tx: oakWest.tx, ty: oakWest.ty },
    { scene: SceneKey.Forest, item: 'mushroom', tx: meadow.tx, ty: meadow.ty }];
  bytes.set(key, JSON.stringify({ version: 29, slot: 1, savedAt: 9, state }));

  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  const trunks = new Set([pine, oakWest, oakSouth].map(cell => `${cell.tx},${cell.ty}`));
  // The chair keeps its item and rotation and stands on free ground off every new trunk.
  expect(loaded.placedItems).toHaveLength(1);
  expect(loaded.placedItems[0]).toMatchObject({ item: 'chair', scene: SceneKey.Forest, rotation: 0 });
  expect(trunks.has(`${loaded.placedItems[0].tx},${loaded.placedItems[0].ty}`)).toBe(false);
  // The wood under the west oak moves; the mushroom on open meadow stays exactly where it was.
  const wood = loaded.groundDrops.find(drop => drop.item === 'wood')!;
  expect(trunks.has(`${wood.tx},${wood.ty}`)).toBe(false);
  expect(loaded.groundDrops).toContainEqual({ scene: SceneKey.Forest, item: 'mushroom', tx: meadow.tx, ty: meadow.ty });
  // The keeper stood on the south oak's trunk, so the keeper starts at the road end to Town.
  const fromTown = map.spawns.find(spawn => spawn.id === 'from_town')!;
  expect(loaded.player).toMatchObject({ x: (fromTown.tx + 0.5) * 16, y: (fromTown.ty + 0.5) * 16, facing: 'down', stamina: 50 });
  expect(notice).toContain('The new Forest trail moved 2 saved placements');
  expect(notice).toContain('Your keeper moved to a safe arrival at the end of the Forest road to Town.');
  // Nothing else about the Forest changed, so its node records were not reset.
  expect(notice).not.toContain('new look');

  // A version 29 save with nothing on the new trunks loads untouched and with no notice.
  const clean = new api.GameState().toSaveData();
  clean.activeScene = SceneKey.Forest;
  clean.player = { x: meadow.tx * 16 + 8, y: meadow.ty * 16 + 8, facing: 'left', stamina: 40 };
  clean.removedNodes = { [`${SceneKey.Forest}:19,51`]: { kind: 'tree', day: 2 } };
  clean.placedItems = [{ item: 'chair', scene: SceneKey.Forest, tx: 16, ty: 48, rotation: 0 }];
  bytes.set(key, JSON.stringify({ version: 29, slot: 1, savedAt: 9, state: clean }));
  const kept = api.SaveSystem.load(1);
  expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();
  expect(kept.player).toEqual(clean.player);
  expect(kept.placedItems).toEqual(clean.placedItems);
  expect(kept.removedNodes).toEqual(clean.removedNodes);
});

test('a version 10 save made on the first Forest only resets its Forest node records here', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1);
  const oldTree = api.getLegacyTownRegionMapData(SceneKey.Forest).objects.find(obj => obj.kind === 'tree')!;
  const treeKey = `${SceneKey.Forest}:${oldTree.tx},${oldTree.ty}`;
  const state = new api.GameState().toSaveData() as Partial<State.GameSaveData>;
  // why: version 10 predates these fields; the loader rejects them on such an old save.
  delete state.relationships;
  delete state.justice;
  state.removedNodes = { [treeKey]: { kind: 'tree', day: 2 } };
  state.treeStages = { [treeKey]: { stage: 'stump', sinceDay: 2 } };
  bytes.set(key, JSON.stringify({ version: 10, slot: 1, savedAt: 9, state }));

  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(loaded.removedNodes).toEqual({});
  expect(loaded.treeStages).toEqual({});
  expect(notice).toContain('The forest has a new look, so all of its trees, rocks and weeds stand again.');
  // The keeper was on the Farm, so no Forest arrival move is reported.
  expect(notice).not.toContain('top of the Farm trail');
});
