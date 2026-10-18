import { teleportAtFarmBin } from './helpers/gameHarness';
/**
 * M19 — The end-of-day sell screen: waking after shipping shows a per-item report (qty × unit =
 * total, grand total, new gold balance); E dismisses it and the day begins.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, give, act, sendInput, advanceFrames } from './helpers/gameHarness';

test('sleeping after shipping shows the itemized report; E dismisses it', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 3); // 3 x 2g = 6
  await give(page, 'parsnip', 2); // 2 x 35g = 70

  // Queue both stacks at the current authored shipping bin.
  await teleportAtFarmBin(page);
  await act(page, 'interact');
  expect((await getState(page)).binOpen).toBe(true);
  await page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/ShippingSystem.ts');
    mod.ShippingSystem.deposit('wood', 999);
    mod.ShippingSystem.deposit('parsnip', 999);
  });
  await act(page, 'interact'); // close the bin panel

  // Sleep via the seam and inspect the report BEFORE dismissing it.
  await page.evaluate(() => window.__TEST__!.sleep());
  let s = await getState(page);
  expect(s.daySummary).toBeTruthy();
  expect(s.daySummary!.lines).toHaveLength(2);
  const woodLine = s.daySummary!.lines.find((l) => l.item === 'wood')!;
  expect(woodLine).toMatchObject({ qty: 3, unit: 2, total: 6 });
  expect(s.daySummary!.total).toBe(76);
  expect(s.daySummary!.gold).toBe(76);
  expect(s.gold).toBe(76);

  // The report is a true morning gate: time, movement, and inventory remain frozen/closed.
  const frozenTime = s.timeOfDay;
  const frozenPlayer = { ...s.player };
  await sendInput(page, 'move:right');
  await sendInput(page, 'toggle-inventory');
  await advanceFrames(page, 300);
  await page.evaluate(() => window.__TEST__!.stopMove());
  s = await getState(page);
  expect(s.timeOfDay).toBe(frozenTime);
  expect(s.player.x).toBe(frozenPlayer.x);
  expect(s.player.y).toBe(frozenPlayer.y);
  expect(s.inventoryOpen).toBe(false);

  // E dismisses the report and the day starts.
  await sendInput(page, 'interact');
  await advanceFrames(page, 150);
  s = await getState(page);
  expect(s.daySummary).toBeNull();
});

test('a no-shipping morning still reports (empty) and dismisses cleanly', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(() => window.__TEST__!.sleep());
  let s = await getState(page);
  expect(s.daySummary).toBeTruthy();
  expect(s.daySummary!.lines).toHaveLength(0);
  expect(s.daySummary!.total).toBe(0);
  await sendInput(page, 'interact');
  await advanceFrames(page, 150);
  s = await getState(page);
  expect(s.daySummary).toBeNull();
});
