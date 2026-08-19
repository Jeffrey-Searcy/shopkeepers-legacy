/**
 * M6 — Time / day-night + rollover. Verifies:
 *  - stepTime advances the in-game clock (timeOfDay),
 *  - the day/night darkness factor rises in the evening (via the exposed TimeSystem),
 *  - sleeping at the exterior Tavern doorstep rolls the day and restores stamina.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, stepTime, teleport, act } from './helpers/gameHarness';

test('stepTime advances the clock', async ({ page }) => {
  await bootGame(page);
  const t0 = (await getState(page)).timeOfDay;
  await stepTime(page, 180); // +3 hours
  const t1 = (await getState(page)).timeOfDay;
  expect(t1).toBeGreaterThan(t0);
  expect(t1 - t0).toBeGreaterThanOrEqual(180 - 1); // allow tiny per-frame tick drift
});

test('darkness factor increases toward evening', async ({ page }) => {
  await bootGame(page);
  const darkAt = async () =>
    page.evaluate(async () => {
      // @ts-expect-error runtime path resolved by Vite in the browser
      const mod = await import('/src/systems/TimeSystem.ts');
      return mod.TimeSystem.darkness();
    });

  // Morning: bright.
  const morning = await darkAt();
  expect(morning).toBeLessThan(0.1);

  // Jump to ~20:00 (14h after 06:00): should be partially dark.
  await stepTime(page, 14 * 60);
  const evening = await darkAt();
  expect(evening).toBeGreaterThan(morning);
  expect(evening).toBeGreaterThan(0.4);
});

test('the shared sleep rollover advances the day and restores stamina', async ({ page }) => {
  await bootGame(page);

  // Verify the rollover system independently through the deterministic seam. The following test
  // covers the real exterior-door interaction that now invokes the same authoritative sleep path.
  await stepTime(page, 300); // advance clock within the day
  const before = await getState(page);
  expect(before.timeOfDay).toBeGreaterThan(0);

  // Sleep via the seam (identical rollover authority to the exterior doorstep).
  await page.evaluate(() => window.__TEST__!.sleep());
  const after = await getState(page);
  expect(after.day).toBe(before.day + 1);
  // Reset to morning: the live clock keeps ticking (~0.2 game-min/frame), so assert the reset
  // happened (was >=300, now within a few minutes of 06:00) rather than an exact 0.
  expect(after.timeOfDay).toBeLessThan(10);
  expect(after.player.stamina).toBe(100);
});

test('interacting at the Tavern doorstep sleeps without rendering an interior', async ({ page }) => {
  await bootGame(page);
  const before = await getState(page);
  await teleport(page, 72, 13, 'up');
  await act(page, 'interact');
  const after = await getState(page);
  expect(after.day).toBe(before.day + 1);
  expect(after.player.stamina).toBe(100);
  expect(after.activeScene).toBe('FarmScene');
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});
