/**
 * M9 — Polish pass. These specs drive the game like a HUMAN does (real keyboard events), not just
 * through the test seam — the seam-only M3 test missed that digit keys never worked in real play.
 *  - digit keys switch tools (the bug the designer hit)
 *  - I toggles the inventory panel
 *  - holding Space chains chops (hold-to-chop)
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, advanceFrames } from './helpers/gameHarness';

test('pressing digit keys switches tools (real keyboard)', async ({ page }) => {
  await bootGame(page);
  expect((await getState(page)).hotbarIndex).toBe(0);

  await page.keyboard.press('2'); // axe = slot index 1
  await advanceFrames(page, 150);
  expect((await getState(page)).hotbarIndex).toBe(1);

  await page.keyboard.press('5'); // watering can = slot index 4
  await advanceFrames(page, 150);
  expect((await getState(page)).hotbarIndex).toBe(4);
});

test('I toggles the inventory panel (real keyboard)', async ({ page }) => {
  await bootGame(page);
  expect((await getState(page)).inventoryOpen).toBeFalsy();

  await page.keyboard.press('i');
  await advanceFrames(page, 150);
  expect((await getState(page)).inventoryOpen).toBe(true);

  await page.keyboard.press('i');
  await advanceFrames(page, 150);
  expect((await getState(page)).inventoryOpen).toBe(false);
});

test('holding Space fells a tree AND clears its stump without re-pressing (hold-to-chop)', async ({ page }) => {
  await bootGame(page);
  const all = await page.evaluate(() => window.__TEST__!.nodes());
  const occupied = new Set(all.map((n) => `${n.tx},${n.ty}`));
  const tree = all.find(
    (n) => n.kind === 'tree' && n.stage === 'full' && !occupied.has(`${n.tx - 1},${n.ty}`)
  )!;
  expect(tree).toBeTruthy();

  await teleport(page, tree.tx - 1, tree.ty, 'right');
  await page.keyboard.press('2'); // axe
  await advanceFrames(page, 150);

  // HOLD space: a full tree is 3 chops + its leftover stump 2 more = 5 swings at ~320ms cadence;
  // holding for ~3s must clear the whole spot without ever re-pressing.
  await page.keyboard.down('Space');
  await advanceFrames(page, 3000);
  await page.keyboard.up('Space');

  const there = (await page.evaluate(() => window.__TEST__!.nodes())).some(
    (n) => n.tx === tree.tx && n.ty === tree.ty
  );
  expect(there).toBe(false);
  await advanceFrames(page, 1000); // felled wood drops, then magnets to the adjacent player
  expect(((await getState(page)).inventory['wood'] ?? 0)).toBeGreaterThan(0);
});
