/**
 * M18 — Furniture: craftable at the workbench, placeable anywhere not blocked, rug is walk-over,
 * a table can stand ON a rug, and the axe breaks furniture back into a collectible drop.
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  give,
  act,
  sendInput,
  stopMove,
  advanceFrames,
} from './helpers/gameHarness';
import { TILE } from '../src/config/GameConfig';

async function craft(page: import('@playwright/test').Page, id: string): Promise<boolean> {
  return page.evaluate(async (rid) => {
    // @ts-expect-error runtime path resolved by Vite in the browser, not by tsc
    const mod = await import('/src/systems/CraftingSystem.ts');
    return mod.CraftingSystem.craft(rid as string);
  }, id);
}

test('craft a table, place it (blocks), axe it back into a drop', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 12);
  expect(await craft(page, 'table')).toBe(true);
  let s = await getState(page);
  expect(s.inventory['table']).toBe(1);
  expect(s.inventory['wood'] ?? 0).toBe(0);

  // Place it on open grass at the facing tile (60,61).
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('table'));
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.placedItems).toContainEqual(expect.objectContaining({ item: 'table', tx: 60, ty: 61 }));

  // It has collision: pushing down into it leaves the feet in row 60.
  await sendInput(page, 'move:down');
  await advanceFrames(page, 800);
  await stopMove(page);
  s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBe(60);

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
  await give(page, 'rug', 1);
  await give(page, 'table', 1);

  // Place the rug at (60,61).
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('rug'));
  await act(page, 'use-tool');
  let s = await getState(page);
  expect(s.placedItems).toContainEqual(expect.objectContaining({ item: 'rug', tx: 60, ty: 61 }));

  // Walk-over: pushing down crosses ONTO the rug tile (no collision).
  await sendInput(page, 'move:down');
  await advanceFrames(page, 600);
  await stopMove(page);
  s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBeGreaterThanOrEqual(61);

  // A table can be placed ON the rug tile (blocking-on-floor stack, like Stardew).
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('table'));
  await act(page, 'use-tool');
  s = await getState(page);
  const atTile = s.placedItems.filter((p) => p.tx === 60 && p.ty === 61);
  expect(atTile.map((p) => p.item).sort()).toEqual(['rug', 'table']);
});
