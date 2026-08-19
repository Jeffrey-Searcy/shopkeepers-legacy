/**
 * M0 — Skeleton & seam. Verifies the game boots, the test seam is ready, and the starting world
 * scene is the Farm. This is the smallest possible "the machine turns on" gate.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, activeScene } from './helpers/gameHarness';

test('boots into FarmScene with the test seam ready', async ({ page }) => {
  await bootGame(page);
  expect(await activeScene(page)).toBe('FarmScene');

  const s = await getState(page);
  expect(s.activeScene).toBe('FarmScene');
  expect(s.day).toBe(1);
  expect(s.player.stamina).toBeGreaterThan(0);
});
