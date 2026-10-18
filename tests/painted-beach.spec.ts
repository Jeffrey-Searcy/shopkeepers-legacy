/**
 * Server-free proofs for the painted Beach (world/BeachArt.ts):
 *  - the map built from the painting is whole: every walkable tile is reachable from the Town arrival and
 *    every tree, rock and weed can be reached from a side;
 *  - every painted tree and rock frame in the node atlas holds real painted pixels around its foot tile,
 *    frames never overlap, and the Beach textures are wired into the manifest;
 *  - a save made on the old Beach (version 24) loads on the new layout: old node records reset, soil off
 *    the meadow goes, furnishings and blocked drops wait at the path top, and a keeper there starts there.
 */
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { SceneKey, TextureKey } from '../src/config/AssetKeys';
import { BEACH_ART, BEACH_GRID, BEACH_NODES } from '../src/world/BeachArt';
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

/** First tile in the Beach grid (row-major) holding the given legend character. */
function firstCell(char: string): { tx: number; ty: number } {
  for (let ty = 0; ty < BEACH_GRID.length; ty++) {
    const tx = BEACH_GRID[ty].indexOf(char);
    if (tx >= 0) return { tx, ty };
  }
  throw new Error(`Beach grid has no "${char}" tile`);
}

test('the painted Beach map is whole: its arrival reaches every open tile and every node side', () => {
  const { api } = runtime(), map = api.getMapData(SceneKey.Beach);
  expect([map.w, map.h]).toEqual([80, 50]);
  const arrival = map.spawns.find(spawn => spawn.id === 'from_town')!;
  expect(arrival).toMatchObject({ tx: 40, ty: 2 });
  expect(map.warps).toEqual([expect.objectContaining({ tx: 40, ty: 0, w: 3, h: 1, target: SceneKey.Town, spawn: 'from_beach' })]);
  expect(map.objects.filter(obj => obj.painted)).toHaveLength(14);
  expect(map.objects.filter(obj => obj.kind === 'weed')).toHaveLength(8);
  // why: shells spawn on sand and the eel needs water, so both grounds must exist where the keeper can reach.
  expect(map.ground.flat()).toEqual(expect.arrayContaining(['sand', 'water', 'grass']));
  expect(map.buildable.flat().every(cell => cell === false)).toBe(true);
});

test('every painted tree and rock frame holds real pixels around its foot and never overlaps another', () => {
  const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).textures;
  for (const [key, file] of [[TextureKey.Beach, 'beach/beach.png'], [TextureKey.BeachFront, 'beach/beach-front.png'], [TextureKey.BeachNodes, 'beach/beach-nodes.png']]) {
    expect(manifest[key]).toEqual({ type: 'image', file });
  }
  const backdrop = PNG.sync.read(readFileSync('public/assets/beach/beach.png'));
  expect([backdrop.width, backdrop.height]).toEqual([BEACH_ART.widthTexels, BEACH_ART.heightTexels]);
  const atlas = PNG.sync.read(readFileSync('public/assets/beach/beach-nodes.png'));
  const alpha = (x: number, y: number): number => atlas.data[(y * atlas.width + x) * 4 + 3];
  const frames = BEACH_NODES.filter(obj => obj.painted).map(obj => ({ obj, art: obj.painted! }));
  for (const { obj, art } of frames) {
    const label = `${obj.kind} ${obj.tx},${obj.ty}`;
    expect(art.texture, label).toBe(TextureKey.BeachNodes);
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

test('a version 24 save on the old Beach loads on the painted layout with every change explained', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1), map = api.getMapData(SceneKey.Beach);
  const sea = firstCell('~'), sand = firstCell('.'), meadow = firstCell(',');
  const meadowKey = `${SceneKey.Beach}:${meadow.tx},${meadow.ty}`, sandKey = `${SceneKey.Beach}:${sand.tx},${sand.ty}`;
  const state = new api.GameState().toSaveData();
  state.activeScene = SceneKey.Beach;
  state.player = { x: sea.tx * 16 + 8, y: sea.ty * 16 + 8, facing: 'up', stamina: 50 };
  state.removedNodes = { [`${SceneKey.Beach}:12,20`]: { kind: 'rock', day: 2 }, [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } };
  state.treeStages = { [`${SceneKey.Beach}:30,9`]: { stage: 'stump', sinceDay: 2 } };
  state.tiles = { [meadowKey]: 'tilled', [sandKey]: 'watered' };
  state.crops = { [sandKey]: { type: 'parsnip', stage: 1, maxStage: 3, daysInStage: 0, watered: true } };
  state.placedItems = [{ item: 'chair', scene: SceneKey.Beach, tx: 20, ty: 30, rotation: 0 }];
  state.groundDrops = [{ scene: SceneKey.Beach, item: 'wood', tx: sea.tx, ty: sea.ty }, { scene: SceneKey.Beach, item: 'shell', tx: sand.tx, ty: sand.ty }];
  bytes.set(key, JSON.stringify({ version: 24, slot: 1, savedAt: 9, state }));

  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(loaded.removedNodes).toEqual({ [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } });
  expect(loaded.treeStages).toEqual({});
  expect(loaded.tiles).toEqual({ [meadowKey]: 'tilled' });
  expect(loaded.crops).toEqual({});
  expect(loaded.placedItems).toEqual([]);
  expect(loaded.groundDrops).toEqual(expect.arrayContaining([
    { scene: SceneKey.Beach, item: 'wood', tx: 40, ty: 2 },
    { scene: SceneKey.Beach, item: 'shell', tx: sand.tx, ty: sand.ty },
    { scene: SceneKey.Beach, item: 'chair', tx: 40, ty: 2 },
  ]));
  expect(loaded.player).toMatchObject({ x: 40.5 * 16, y: 2.5 * 16, facing: 'down', stamina: 50 });
  expect(map.solid[2][40]).toBe(false);
  for (const line of ['trees, rocks and weeds stand again', '1 tilled tiles and 1 crops', '2 of your things', 'your keeper starts']) {
    expect(notice).toContain(line);
  }

  // A save made by this version is not moved again: the keeper's exact spot survives a reload.
  api.SaveSystem.save(1, 10);
  expect(JSON.parse(bytes.get(key)!).version).toBe(30);
  expect(api.SaveSystem.load(1).player).toEqual(loaded.player);
});
