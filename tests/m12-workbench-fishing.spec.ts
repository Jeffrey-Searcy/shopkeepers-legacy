/**
 * M12 — Workbench-first crafting + fishing.
 *  - The bag crafts only a workbench; chest crafting happens via a PLACED workbench's panel.
 *  - Interacting with a placed workbench opens the crafting panel (E closes).
 *  - Fishing: cast the rod at water -> waiting -> bite -> hook -> a fish lands in the bag.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, give, act, advanceFrames, aimWorldTile } from './helpers/gameHarness';

async function craft(page: import('@playwright/test').Page, id: string): Promise<boolean> {
  return page.evaluate(async (rid) => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/CraftingSystem.ts');
    return mod.CraftingSystem.craft(rid as string);
  }, id);
}

test('workbench: craft from bag, place it, open its crafting panel, craft a chest there', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 35); // 15 workbench + 20 chest

  // Craft + place the workbench.
  expect(await craft(page, 'workbench')).toBe(true);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('workbench'));
  await aimWorldTile(page, 60, 61);
  await act(page, 'use-tool'); // places at (60,61)
  let s = await getState(page);
  expect(s.placedItems).toContainEqual(expect.objectContaining({ item: 'workbench', tx: 60, ty: 61 }));

  // E at the workbench opens the crafting panel.
  await act(page, 'interact');
  s = await getState(page);
  expect(s.craftingOpen).toBe(true);

  // Craft a chest via the panel's system call (station recipes live behind this panel).
  expect(await craft(page, 'chest')).toBe(true);
  s = await getState(page);
  expect(s.inventory['chest']).toBe(1);
  expect(s.inventory['wood'] ?? 0).toBe(0);

  // E closes the panel.
  await act(page, 'interact');
  expect((await getState(page)).craftingOpen).toBe(false);
});

test('fishing: cast, bite, hook, then WIN the reel minigame with a chasing bot', async ({ page }) => {
  await bootGame(page);

  // Find the pond's west edge (same robust scan as the placement spec).
  let waterTx = 68;
  for (let x = 66; x <= 82; x++) {
    const g = await page.evaluate((xx) => window.__TEST__!.groundAt(xx as number, 43), x);
    if (g === 'water') {
      waterTx = x;
      break;
    }
  }
  await teleport(page, waterTx - 1, 43, 'right'); // face the water

  await act(page, 'hotbar:6'); // rod
  await act(page, 'use-tool'); // cast
  expect((await getState(page)).fishing?.phase).toBe('waiting');

  // Wait for the bite (seeded wait is 1.2-3.6s), then hook -> the reel minigame starts.
  await expect
    .poll(async () => (await getState(page)).fishing?.phase, { timeout: 6_000, intervals: [100] })
    .toBe('bite');
  await act(page, 'use-tool');
  expect((await getState(page)).fishing?.phase).toBe('reeling');

  // Bang-bang controller: reel (push the zone up) when the fish is above the zone's center.
  // With the forgiving V1 tuning this reliably fills the progress bar.
  const deadline = Date.now() + 20_000;
  let fishing = (await getState(page)).fishing;
  while (fishing && Date.now() < deadline) {
    const chase = (fishing.fishPos ?? 50) > (fishing.zonePos ?? 0) + 14;
    await page.evaluate((on) => window.__TEST__!.input(on ? 'reel:on' : 'reel:off'), chase);
    await advanceFrames(page, 120);
    fishing = (await getState(page)).fishing;
  }
  await page.evaluate(() => window.__TEST__!.input('reel:off'));

  const s = await getState(page);
  expect(s.fishing).toBeNull();
  const fishCount =
    (s.inventory['fish-sardine'] ?? 0) + (s.inventory['fish-bass'] ?? 0) + (s.inventory['fish-carp'] ?? 0);
  expect(fishCount).toBe(1); // the bot keeps the fish in the zone -> caught, not escaped
});

test('moving reels in a live cast', async ({ page }) => {
  await bootGame(page);
  let waterTx = 68;
  for (let x = 66; x <= 82; x++) {
    const g = await page.evaluate((xx) => window.__TEST__!.groundAt(xx as number, 43), x);
    if (g === 'water') {
      waterTx = x;
      break;
    }
  }
  await teleport(page, waterTx - 1, 43, 'right');
  await act(page, 'hotbar:6');
  await act(page, 'use-tool');
  expect((await getState(page)).fishing?.phase).toBe('waiting');

  await page.evaluate(() => window.__TEST__!.input('move:left'));
  await advanceFrames(page, 300);
  await page.evaluate(() => window.__TEST__!.stopMove());
  expect((await getState(page)).fishing).toBeNull();
});
