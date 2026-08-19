/**
 * M5 — Inventory + chest (Stardew-style transfer UI). Verifies:
 *  - interacting with the chest OPENS the transfer panel (GameState.chestOpen),
 *  - stack moves (the same InventorySystem calls the panel's click handlers use) round-trip counts,
 *  - E closes the panel,
 *  - over-withdraw is clamped, never invented.
 * The farm no longer starts with a chest (the player crafts theirs — Stardew rule), so the test
 * places one via the placement seam (the m11 flow), then drives the transfer UI against it.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, give, act } from './helpers/gameHarness';

test('chest opens a transfer UI; stack moves round-trip; E closes', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  // Place a chest on open grass at the facing tile (60,61), then face it.
  await give(page, 'chest', 1);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await act(page, 'use-tool');

  // E opens the chest panel.
  await act(page, 'interact');
  let s = await getState(page);
  expect(s.chestOpen).toBe(true);

  // Move the wood stack bag -> chest (the exact call the panel's bag-slot click makes).
  await page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/InventorySystem.ts');
    mod.InventorySystem.deposit('wood', Number.MAX_SAFE_INTEGER);
  });
  s = await getState(page);
  expect(s.inventory['wood'] ?? 0).toBe(0);
  expect(s.chest['wood']).toBe(5);

  // Move it back chest -> bag (the chest-slot click).
  await page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/InventorySystem.ts');
    mod.InventorySystem.withdraw('wood', Number.MAX_SAFE_INTEGER);
  });
  s = await getState(page);
  expect(s.inventory['wood']).toBe(5);
  expect(s.chest['wood'] ?? 0).toBe(0);

  // E closes the panel.
  await act(page, 'interact');
  s = await getState(page);
  expect(s.chestOpen).toBe(false);
});

test('cannot withdraw more than the chest holds (clamped, not invented)', async ({ page }) => {
  await bootGame(page);
  await give(page, 'stone', 3);

  const moved = await page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/InventorySystem.ts');
    mod.InventorySystem.deposit('stone', Number.MAX_SAFE_INTEGER); // stash 3
    return mod.InventorySystem.withdraw('stone', 999); // ask for far too many
  });
  expect(moved).toBe(3); // only what existed

  const s = await getState(page);
  expect(s.inventory['stone']).toBe(3);
  expect(s.chest['stone'] ?? 0).toBe(0);
});
