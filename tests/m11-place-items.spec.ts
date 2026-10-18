/**
 * M11 — Craft + place-anywhere items (Stardew rule). Verifies:
 *  - crafting a chest consumes 20 wood,
 *  - a chest can be placed on any clear tile (not just the buildable zone) and works as storage,
 *  - placement is rejected on blocked tiles (water) without consuming the item,
 *  - an axe swing picks a placed chest back up,
 *  - placed items persist across scene transitions.
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  teleportToExit,
  give,
  act,
  activeScene,
  advanceFrames,
  aimWorldTile,
} from './helpers/gameHarness';

/** Craft via the same system call the bag panel's button makes. */
async function craftChest(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(async () => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/CraftingSystem.ts');
    return mod.CraftingSystem.craft('chest');
  });
}

test('craft a chest from 20 wood, place it on open grass, use it, pick it back up', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 20);
  expect(await craftChest(page)).toBe(true);
  let s = await getState(page);
  expect(s.inventory['wood'] ?? 0).toBe(0);
  expect(s.inventory['chest']).toBe(1);

  // Stand on open grass far from the buildable-zone rules (place-anywhere!) facing down.
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, 60, 61);
  await act(page, 'use-tool'); // the swing places it at the facing tile (60,61)

  s = await getState(page);
  expect(s.placingItem).toBeNull();
  expect(s.inventory['chest'] ?? 0).toBe(0);
  expect(s.placedItems).toHaveLength(1);
  expect(s.placedItems[0]).toMatchObject({ item: 'chest', tx: 60, ty: 61 });

  // It's a working chest: E opens the transfer UI.
  await act(page, 'interact');
  expect((await getState(page)).chestOpen).toBe(true);
  await act(page, 'interact'); // close

  // Axe swing BREAKS it: the chest drops as a ground pickup (Stardew rule) and magnets to the
  // adjacent player for collection.
  await act(page, 'hotbar:1'); // axe
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.placedItems).toHaveLength(0); // no longer placed
  await advanceFrames(page, 1000); // drop hops, magnets, collects
  s = await getState(page);
  expect(s.inventory['chest']).toBe(1);
});

test('placement is rejected on water and the item is kept', async ({ page }) => {
  await bootGame(page);
  await give(page, 'chest', 1);

  // The pond spans ~(69..80, 40..47); stand just left of it facing right into water.
  await teleport(page, 67, 43, 'right');
  const ground = await page.evaluate(() => window.__TEST__!.groundAt(68, 43));
  // Find the actual water edge robustly: walk the facing tile eastward until water.
  let waterTx = 68;
  for (let x = 68; x <= 82; x++) {
    const g = await page.evaluate((xx) => window.__TEST__!.groundAt(xx as number, 43), x);
    if (g === 'water') {
      waterTx = x;
      break;
    }
  }
  await teleport(page, waterTx - 1, 43, 'right'); // face the water tile
  void ground;

  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, waterTx, 43);
  await act(page, 'use-tool');

  const s = await getState(page);
  expect(s.placedItems).toHaveLength(0); // rejected
  expect(s.inventory['chest']).toBe(1); // item kept
  expect(s.placingItem).toBe('chest'); // still placing — player can pick another spot
});

test('placed chests persist across scene transitions', async ({ page }) => {
  await bootGame(page);
  await give(page, 'chest', 1);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, 60, 61);
  await act(page, 'use-tool');
  expect((await getState(page)).placedItems).toHaveLength(1);

  // Warp to town and back.
  await teleport(page, 98, 30, 'right');
  await expect.poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] }).toBe('TownScene');
  // why: the Town road home moves whenever the Town is redrawn, so read it from the live map.
  await teleportToExit(page, 'FarmScene', 'left');
  await expect.poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] }).toBe('FarmScene');
  await advanceFrames(page, 400);

  // Still there, still functional.
  const s = await getState(page);
  expect(s.placedItems).toHaveLength(1);
  await teleport(page, 60, 60, 'down'); // face (60,61) where the chest sits
  await act(page, 'interact');
  expect((await getState(page)).chestOpen).toBe(true);
});
