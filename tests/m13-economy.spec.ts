/**
 * M13 — Economy + day-cycle rules from the designer's playtest:
 *  - the unfinished Tavern sleeps from its exterior doorstep without exposing an interior,
 *  - the shipping bin queues items and pays out gold at day end,
 *  - staying up past 2:00 makes you pass out: wake outside on a new day with half stamina.
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  give,
  act,
  activeScene,
} from './helpers/gameHarness';

test('the Tavern doorstep sleeps outside without activating the rejected interior', async ({ page }) => {
  await bootGame(page);
  const before = await getState(page);
  await teleport(page, 72, 13, 'up');
  await act(page, 'interact');
  expect((await getState(page)).day).toBe(before.day + 1);
  expect(await activeScene(page)).toBe('FarmScene');
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('shipping bin: queue items, take one back, gold arrives at day end', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 10); // 10 x 2g
  await give(page, 'parsnip', 2); // 2 x 35g

  // The farm bin is at (80,13), beside the wider Tavern facade; stand left facing right.
  await teleport(page, 79, 13, 'right');
  await act(page, 'interact');
  expect((await getState(page)).binOpen).toBe(true);

  // Queue both stacks (the same calls the panel's clicks make), then take the wood back out.
  await page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/ShippingSystem.ts');
    mod.ShippingSystem.deposit('wood', 999);
    mod.ShippingSystem.deposit('parsnip', 999);
    mod.ShippingSystem.withdraw('wood', 999);
  });
  let s = await getState(page);
  expect(s.bin['parsnip']).toBe(2);
  expect(s.inventory['wood']).toBe(10);

  await act(page, 'interact'); // close the panel
  await page.evaluate(() => window.__TEST__!.sleep());
  s = await getState(page);
  expect(s.gold).toBe(70); // 2 parsnips x 35g
  expect(Object.keys(s.bin)).toHaveLength(0);
});

test('staying up past 2am: pass out, wake outside with half stamina on a new day', async ({ page }) => {
  await bootGame(page);
  const before = await getState(page);

  // Jump the clock to 2:00 (20h past 06:00 = 1200 game-minutes); the update loop triggers the
  // pass-out: forced sleep at half stamina + a named exterior wake-up.
  await page.evaluate(() => window.__TEST__!.stepTime(1200));
  await expect
    .poll(async () => (await getState(page)).day, { timeout: 10_000, intervals: [200] })
    .toBe(before.day + 1);
  await expect
    .poll(async () => activeScene(page), { timeout: 10_000, intervals: [200] })
    .toBe('FarmScene');

  const s = await getState(page);
  expect(s.player.stamina).toBe(50); // rough night
  expect(s.timeOfDay).toBeLessThan(10); // it's morning
});
