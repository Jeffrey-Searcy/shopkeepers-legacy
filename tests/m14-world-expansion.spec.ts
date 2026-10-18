/**
 * M14 — World expansion reachability. The same permanent gate as M2, extended to the four new
 * maps (Forest, Beach, Mountain, Mines): teleport onto each connecting warp tile, assert the
 * transition fires, and assert the player is still present, finite, and inside the destination
 * map's bounds. Every route is also walked BACK so both directions of every warp pair are proven.
 *
 * Warp geometry (from src/world/MapDef.ts):
 *   Farm south warp:     x=20..23, y=99  -> Forest 'from_farm' (21,2)
 *   Forest north warp:   x=20..22, y=0   -> Farm 'from_forest' (21,97)
 *   Town south/north:    resolve authored road centers -> Beach / outdoor Mountain respectively
 *   Beach north warp:    x=40..42, y=0   -> Town 'from_beach' (painted Beach path)
 *   Mountain south warp: x=38..43, y=59  -> Town 'from_mountain'
 *   Mountain cave warp:  x=39..40, y=12  -> Mines 'entrance' (25,4)
 *   Mines ladder warp:   x=25, y=2       -> Mountain 'from_mines' (40,14)
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  advanceFrames,
  activeScene,
  expectFinite,
} from './helpers/gameHarness';
import { MAP_TILES, TILE } from '../src/config/GameConfig';
import { WORLD_MAP_TILES } from '../src/world/MapDef';

/** Teleport onto a warp tile and wait for the destination scene to become active. */
async function warpTo(
  page: import('@playwright/test').Page,
  tx: number,
  ty: number,
  facing: string,
  scene: string
): Promise<void> {
  await teleport(page, tx, ty, facing);
  await expect
    .poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] })
    .toBe(scene);
  await advanceFrames(page, 300);
}

/** Resolve the live Town road by its expected destination so resized geometry cannot leave stale fixture coordinates. */
async function townRoad(page: import('@playwright/test').Page, target: string, facing: string): Promise<void> {
  const warp = await page.evaluate(async target => {
    // @ts-expect-error Vite resolves the current authored module in the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const route = getMapData('TownScene').warps.find((warp: { target: string }) => warp.target === target);
    if (!route) throw new Error(`Missing Town road to ${target}`);
    return { tx: route.tx + Math.floor(route.w / 2), ty: route.ty + Math.floor(route.h / 2) };
  }, target);
  await warpTo(page, warp.tx, warp.ty, facing, target);
}

/** Assert the player exists, is finite, and is inside the given map dimensions. */
async function expectInBounds(
  page: import('@playwright/test').Page,
  dims: { w: number; h: number }
): Promise<void> {
  const s = await getState(page);
  expectFinite(s.player.x);
  expectFinite(s.player.y);
  expect(s.player.x).toBeGreaterThan(0);
  expect(s.player.y).toBeGreaterThan(0);
  expect(s.player.x).toBeLessThan(dims.w * TILE);
  expect(s.player.y).toBeLessThan(dims.h * TILE);
}

test('Farm <-> Forest: south causeway warp round-trips in-bounds', async ({ page }) => {
  await bootGame(page);
  expect(await activeScene(page)).toBe('FarmScene');

  await warpTo(page, 21, 99, 'down', 'ForestScene');
  await expectInBounds(page, WORLD_MAP_TILES.forest);

  await warpTo(page, 21, 0, 'up', 'FarmScene');
  const s = await getState(page);
  expectFinite(s.player.x);
  expect(s.player.y).toBeLessThan(100 * TILE);
});

test('Town <-> Beach: south road warp round-trips in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene'); // farm east warp to town first

  await townRoad(page, 'BeachScene', 'down');
  await expectInBounds(page, WORLD_MAP_TILES.beach);

  await warpTo(page, 40, 0, 'up', 'TownScene');
  await expectInBounds(page, MAP_TILES.town);
});

test('Town <-> Mountain: north road warp round-trips in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene');

  await townRoad(page, 'MountainScene', 'up');
  await expectInBounds(page, WORLD_MAP_TILES.mountain);

  await warpTo(page, 40, 59, 'down', 'TownScene');
  await expectInBounds(page, MAP_TILES.town);
});

test('Mountain <-> Mines: cave mouth and ladder round-trip in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene');
  await townRoad(page, 'MountainScene', 'up');

  await warpTo(page, 39, 12, 'up', 'MinesScene');
  await expectInBounds(page, WORLD_MAP_TILES.mines);
  // The mines spawn must be on carved cave floor, not inside a wall.
  const ground = await page.evaluate(() => window.__TEST__!.groundAt(25, 4));
  expect(ground).toBe('cave');

  await warpTo(page, 25, 2, 'up', 'MountainScene');
  await expectInBounds(page, WORLD_MAP_TILES.mountain);
});
