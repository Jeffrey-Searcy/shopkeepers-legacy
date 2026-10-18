import { teleportAtFarmShop } from './helpers/gameHarness';
/**
 * M18 — Indoor furniture: craftable at the workbench, rug is walk-over,
 * a table can stand ON a rug, and the axe breaks furniture back into a collectible drop.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  give,
  act,
  sendInput,
  stopMove,
  advanceFrames,
  aimWorldTile,
} from './helpers/gameHarness';
import { TILE } from '../src/config/GameConfig';

/** Enter the shop through its real door before exercising indoor-only furniture. */
async function enterShop(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TavernScene' && !window.__TEST__!.state().transitionActive); }
  finally { await page.keyboard.up('w'); }
}

/** Invoke the recipe mutator with a deterministic resource fixture. */
async function craft(page: Page, id: string): Promise<boolean> {
  return page.evaluate(async (rid) => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/CraftingSystem.ts');
    return mod.CraftingSystem.craft(rid as string);
  }, id);
}

test('craft a table, place it (blocks), axe it back into a drop', async ({ page }) => {
  await bootGame(page);
  await enterShop(page);
  await give(page, 'wood', 12);
  expect(await craft(page, 'table')).toBe(true);
  let s = await getState(page);
  expect(s.inventory['table']).toBe(1);
  expect(s.inventory['wood'] ?? 0).toBe(0);

  // Place it on open shop floor at the facing tile (18,10).
  await teleport(page, 18, 9, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('table'));
  await aimWorldTile(page, 18, 10);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.placedItems).toContainEqual(expect.objectContaining({ item: 'table', tx: 18, ty: 10 }));

  // It has collision: pushing down into it leaves the feet in row 9.
  await sendInput(page, 'move:down');
  await advanceFrames(page, 800);
  await stopMove(page);
  s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBe(9);

  // Axe it: it drops as a pickup and magnets back into the bag.
  await act(page, 'hotbar:1');
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.placedItems).toHaveLength(0);
  await advanceFrames(page, 1200);
  s = await getState(page);
  expect(s.inventory['table']).toBe(1);
});

test('a rug is walk-over and a table can stand on it', async ({ page }) => {
  await bootGame(page);
  await enterShop(page);
  await give(page, 'rug', 1);
  await give(page, 'table', 1);

  // Place the rug at (18,10).
  await teleport(page, 18, 9, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('rug'));
  await aimWorldTile(page, 18, 10);
  await act(page, 'use-tool');
  let s = await getState(page);
  expect(s.placedItems).toContainEqual(expect.objectContaining({ item: 'rug', tx: 18, ty: 10 }));

  // Walk-over: pushing down crosses ONTO the rug tile (no collision).
  await sendInput(page, 'move:down');
  await advanceFrames(page, 600);
  await stopMove(page);
  s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBeGreaterThanOrEqual(10);

  // A table can be placed ON the rug tile (blocking-on-floor stack, like Stardew).
  await teleport(page, 18, 9, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('table'));
  await aimWorldTile(page, 18, 10);
  await act(page, 'use-tool');
  s = await getState(page);
  const atTile = s.placedItems.filter((p) => p.tx === 18 && p.ty === 10);
  expect(atTile.map((p) => p.item).sort()).toEqual(['rug', 'table']);
});
