/**
 * M2 — Scene transitions. THE permanent regression gate for the "player vanished walking to town"
 * bug. Rather than walk the player across the whole (big) map — slow and flaky under parallel test
 * load — we teleport the player onto the warp tile (deterministic + instant) and assert the
 * transition fires with the player still present, finite, and in-bounds in the destination.
 *
 * Warp geometry (from src/world/MapDef.ts):
 *   Farm east warp: tiles x=98, y=28..33  -> Town spawn 'from_farm' (3,30)
 *   Town west warp: tiles x=0,  y=28..33  -> Farm spawn 'from_town' (96,30)
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

test('warp Farm -> Town keeps the player present and in-bounds', async ({ page }) => {
  await bootGame(page);
  expect(await activeScene(page)).toBe('FarmScene');

  // Teleport onto the farm's east warp tile; the overlap fires the transition.
  await teleport(page, 98, 30, 'right');
  await expect
    .poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] })
    .toBe('TownScene');
  await advanceFrames(page, 300);

  const s = await getState(page);
  expect(s.activeScene).toBe('TownScene');
  // The player must NOT have vanished: coordinates are finite and inside the Town map.
  expectFinite(s.player.x);
  expectFinite(s.player.y);
  expect(s.player.x).toBeGreaterThan(0);
  expect(s.player.y).toBeGreaterThan(0);
  expect(s.player.x).toBeLessThan(MAP_TILES.town.w * TILE);
  expect(s.player.y).toBeLessThan(MAP_TILES.town.h * TILE);
});

test('warp Town -> Farm returns the player to the farm in-bounds', async ({ page }) => {
  await bootGame(page);

  // Get to Town via the farm east warp.
  await teleport(page, 98, 30, 'right');
  await expect.poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] }).toBe('TownScene');
  await advanceFrames(page, 300);

  // Now step onto Town's west warp tile to return.
  await teleport(page, 0, 30, 'left');
  await expect.poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] }).toBe('FarmScene');
  await advanceFrames(page, 300);

  const s = await getState(page);
  expect(s.activeScene).toBe('FarmScene');
  expectFinite(s.player.x);
  expect(s.player.x).toBeGreaterThan(0);
  expect(s.player.x).toBeLessThan(MAP_TILES.farm.w * TILE);
});
