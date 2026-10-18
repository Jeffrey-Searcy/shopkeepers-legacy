/**
 * Ground sound gates (cozy sound pass):
 *  - every world scene has a sound plan whose zones sit inside its map, every tile of every map resolves to a
 *    footstep surface without error, and every plan's water kind matches real water tiles on its map;
 *  - the Town's wooden bridges and docks sound like wood, its cobbled roads like stone, its lawns like grass;
 *  - the water area is loudest on the bank and silent beyond its hearing radius;
 *  - still water (the Farm and Forest ponds, the Mountain lake) is silent, though those maps have water tiles;
 *  - walking makes one footstep per 24 px actually walked (the first one at once), and standing makes none.
 */
import { buildSync } from 'esbuild';
import { expect, test } from '@playwright/test';
import { SceneKey, WORLD_SCENE_KEYS } from '../src/config/AssetKeys';
import { bootGame, sendInput, stopMove, advanceFrames } from './helpers/gameHarness';
import type * as Maps from '../src/world/MapDef';
import type * as Plans from '../src/world/SoundPlans';
import type * as Water from '../src/world/WaterSound';

type API = typeof Maps & typeof Plans & typeof Water;
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: [
  'export * from "./src/world/MapDef";', 'export * from "./src/world/SoundPlans";', 'export * from "./src/world/WaterSound";',
].join('\n') }, bundle: true, write: false, format: 'cjs', platform: 'node',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Load the real map and sound-plan code in Node, with test-mode browser globals and private storage. */
function runtime(): API {
  const bytes = new Map<string, string>();
  const storage = {
    /** Return a stored value. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Store one value. */
    setItem(key: string, value: string): void { bytes.set(key, value); },
    /** Delete one value. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundle)(module, module.exports, storage, { location: { search: '?test=1' } });
  return module.exports as API;
}

test('every world scene has a sound plan that fits its map and water', () => {
  const api = runtime();
  expect(Object.keys(api.SOUND_PLANS).sort()).toEqual([...WORLD_SCENE_KEYS].sort());
  for (const key of WORLD_SCENE_KEYS) {
    const map = api.getMapData(key), plan = api.soundPlan(key);
    for (const zone of plan.zones) {
      expect(zone.x0 >= 0 && zone.y0 >= 0 && zone.x1 <= map.w && zone.y1 <= map.h && zone.x0 < zone.x1 && zone.y0 < zone.y1,
        `${key} zone "${zone.why}" lies inside the ${map.w}x${map.h} map`).toBe(true);
    }
    // Every tile resolves (a floor tile on a plan without a floor surface would throw).
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) api.footSurfaceAt(key, map, tx, ty);
    const area = api.waterArea(key, map);
    expect(area?.kind ?? null, `${key} water`).toBe(plan.water);
  }
  expect(() => api.soundPlan(SceneKey.MainMenu)).toThrow(/not a world scene/);
  const town = api.getMapData(SceneKey.Town);
  expect(() => api.footSurfaceAt(SceneKey.Town, town, town.w, 0)).toThrow(/outside/);
});

test('the Town sounds like its painting: plank bridges, cobbled roads, grass lawns', () => {
  const api = runtime();
  const town = api.getMapData(SceneKey.Town);
  const at = (tx: number, ty: number) => api.footSurfaceAt(SceneKey.Town, town, tx, ty);
  expect(at(58, 41)).toBe('wood'); // middle bridge
  expect(at(30, 60)).toBe('wood'); // south bridge
  const counts = { road: new Set<string>(), lawn: new Set<string>() };
  for (let ty = 0; ty < town.h; ty++) for (let tx = 0; tx < town.w; tx++) {
    if (api.soundPlan(SceneKey.Town).zones.some((z) => tx >= z.x0 && tx < z.x1 && ty >= z.y0 && ty < z.y1)) continue;
    if (town.ground[ty][tx] === 'dirt') counts.road.add(at(tx, ty));
    if (town.ground[ty][tx] === 'grass') counts.lawn.add(at(tx, ty));
  }
  expect([...counts.road]).toEqual(['stone']);
  expect([...counts.lawn]).toEqual(['grass']);
});

test('water is heard from the nearest bank and fades to silence at its radius', () => {
  const api = runtime();
  const beach = api.getMapData(SceneKey.Beach);
  const sea = api.waterArea(SceneKey.Beach, beach)!;
  let wet: { tx: number; ty: number } | null = null;
  for (let ty = 0; ty < beach.h && !wet; ty++) for (let tx = 0; tx < beach.w && !wet; tx++) if (beach.ground[ty][tx] === 'water') wet = { tx, ty };
  expect(wet).not.toBeNull();
  // Inside a water tile the distance is 0; far beyond the radius nothing is in reach.
  expect(sea.distanceFrom(wet!.tx * 16 + 8, wet!.ty * 16 + 8)).toBe(0);
  const town = api.getMapData(SceneKey.Town);
  const river = api.waterArea(SceneKey.Town, town)!;
  expect(river.kind).toBe('river');
  let farthest = 0, silent = 0;
  for (let ty = 0; ty < town.h; ty++) for (let tx = 0; tx < town.w; tx++) {
    const d = river.distanceFrom(tx * 16 + 8, ty * 16 + 8);
    if (Number.isFinite(d)) {
      expect(d).toBeLessThanOrEqual(river.radius);
      farthest = Math.max(farthest, d);
    } else silent += 1;
  }
  expect(farthest).toBeGreaterThan(0);
  expect(silent, 'some Town tiles are out of earshot of the river').toBeGreaterThan(0);
  expect(api.waterArea(SceneKey.Mines, api.getMapData(SceneKey.Mines))).toBeNull();
});

test('ponds and lakes are still water and make no sound', () => {
  const api = runtime();
  for (const key of [SceneKey.Farm, SceneKey.Forest, SceneKey.Mountain]) {
    const map = api.getMapData(key);
    expect(map.ground.some((row) => row.includes('water')), `${key} has water tiles`).toBe(true);
    expect(api.soundPlan(key).water, `${key} water sound`).toBeNull();
    expect(api.waterArea(key, map), `${key} water area`).toBeNull();
  }
});

test('walking makes one footstep per stride walked, and standing makes none', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__: { scene: { getScenes(active: boolean): { player?: { on(e: string, f: () => void): void } }[] } } }).__GAME__;
    const scene = game.scene.getScenes(true).find((s) => s.player);
    if (!scene?.player) throw new Error('no active world scene with a keeper');
    const w = window as unknown as { steps: number };
    w.steps = 0;
    scene.player.on('player-footstep', () => { w.steps += 1; });
  });
  const steps = () => page.evaluate(() => (window as unknown as { steps: number }).steps);
  const sprite = () => page.evaluate(() => {
    const game = (window as unknown as { __GAME__: { scene: { getScenes(active: boolean): { player?: { x: number; y: number } }[] } } }).__GAME__;
    const p = game.scene.getScenes(true).find((s) => s.player)!.player!;
    return { x: p.x, y: p.y };
  });
  await advanceFrames(page, 300);
  expect(await steps()).toBe(0);
  const before = await sprite();
  await sendInput(page, 'move:right');
  await advanceFrames(page, 700);
  const walked = Math.hypot((await sprite()).x - before.x, (await sprite()).y - before.y);
  const heard = await steps();
  await stopMove(page);
  // The first step lands after 6 px, then one every 24 px.
  const expected = walked < 6 ? 0 : 1 + Math.floor((walked - 6) / 24);
  expect(walked).toBeGreaterThan(30);
  expect(Math.abs(heard - expected), `walked ${walked.toFixed(1)} px, heard ${heard}, expected about ${expected}`).toBeLessThanOrEqual(1);
  // The settle glide after the stop is silent.
  await advanceFrames(page, 600);
  expect(await steps()).toBe(heard);
});
