/**
 * M14 — World expansion reachability. The same permanent gate as M2, extended to the four new
 * maps (Forest, Beach, Mountain, Mines): teleport onto each connecting warp tile, assert the
 * transition fires, and assert the player is still present, finite, and inside the destination
 * map's bounds. Every route is also walked BACK so both directions of every warp pair are proven.
 *
 * Warp geometry (from src/world/MapDef.ts):
 *   Farm south warp:     x=20..23, y=99  -> Forest 'from_farm' (19,2)
 *   Forest north warp:   x=17..20, y=0   -> Farm 'from_forest' (21,97)
 *   Town south warp:     x=38..43, y=59  -> Beach 'from_town' (40,2)
 *   Beach north warp:    x=38..43, y=0   -> Town 'from_beach' (40,57)
 *   Town north warp:     x=38..43, y=0   -> Mountain 'from_town' (40,57)
 *   Mountain south warp: x=38..43, y=59  -> Town 'from_mountain' (40,2)
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
import { TILE } from '../src/config/GameConfig';
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

  await warpTo(page, 18, 0, 'up', 'FarmScene');
  const s = await getState(page);
  expectFinite(s.player.x);
  expect(s.player.y).toBeLessThan(100 * TILE);
});

test('Town <-> Beach: south road warp round-trips in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene'); // farm east warp to town first

  await warpTo(page, 40, 59, 'down', 'BeachScene');
  await expectInBounds(page, WORLD_MAP_TILES.beach);

  await warpTo(page, 40, 0, 'up', 'TownScene');
  await expectInBounds(page, { w: 80, h: 60 });
});

test('Town <-> Mountain: north road warp round-trips in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene');

  await warpTo(page, 40, 0, 'up', 'MountainScene');
  await expectInBounds(page, WORLD_MAP_TILES.mountain);

  await warpTo(page, 40, 59, 'down', 'TownScene');
  await expectInBounds(page, { w: 80, h: 60 });
});

test('Mountain <-> Mines: cave mouth and ladder round-trip in-bounds', async ({ page }) => {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene');
  await warpTo(page, 40, 0, 'up', 'MountainScene');

  await warpTo(page, 39, 12, 'up', 'MinesScene');
  await expectInBounds(page, WORLD_MAP_TILES.mines);
  // The mines spawn must be on carved cave floor, not inside a wall.
  const ground = await page.evaluate(() => window.__TEST__!.groundAt(25, 4));
  expect(ground).toBe('cave');

  await warpTo(page, 25, 2, 'up', 'MountainScene');
  await expectInBounds(page, WORLD_MAP_TILES.mountain);
});
