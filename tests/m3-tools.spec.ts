/**
 * M3 — Tools + stamina + hotbar + interaction. Verifies:
 *  - hotbar selection changes the active tool index,
 *  - using the matching tool on a facing resource node clears it, drops its item, and costs stamina,
 *  - using the wrong tool does nothing (no drop, no stamina spent).
 * The player is teleported adjacent to a known node (via the test seam) for determinism.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, nodes, act, advanceFrames } from './helpers/gameHarness';

/** Hotbar order (matches src/config/Items.ts HOTBAR): 0 hoe,1 axe,2 pickaxe,3 scythe,4 water,5 seeds. */
const SLOT = { hoe: 0, axe: 1, pickaxe: 2, scythe: 3, water: 4, seeds: 5 };

test('hotbar selection sets the active tool', async ({ page }) => {
  await bootGame(page);
  await act(page, `hotbar:${SLOT.pickaxe}`);
  expect((await getState(page)).hotbarIndex).toBe(SLOT.pickaxe);
  await act(page, `hotbar:${SLOT.axe}`);
  expect((await getState(page)).hotbarIndex).toBe(SLOT.axe);
});

test('a full tree takes 3 chops, drops wood, leaves a stump, and costs stamina (Stardew multi-hit)', async ({ page }) => {
  await bootGame(page);
  // Pick a FULL tree whose left-neighbor tile is free of other nodes (safe stand spot in clumps).
  const all = await nodes(page);
  const occupied = new Set(all.map((n) => `${n.tx},${n.ty}`));
  const tree = all.find(
    (n) => n.kind === 'tree' && n.stage === 'full' && !occupied.has(`${n.tx - 1},${n.ty}`)
  );
  expect(tree, 'a full tree with a clear stand tile should exist').toBeTruthy();

  // Stand one tile to the LEFT of the tree, facing right at it.
  await teleport(page, tree!.tx - 1, tree!.ty, 'right');
  const before = await getState(page);
  await act(page, `hotbar:${SLOT.axe}`);

  // Two chops: tree still standing (hp 3), no wood yet.
  await act(page, 'use-tool');
  await act(page, 'use-tool');
  let at = (await nodes(page)).find((n) => n.tx === tree!.tx && n.ty === tree!.ty);
  expect(at?.kind).toBe('tree');
  expect(((await getState(page)).inventory['wood'] ?? 0)).toBe(before.inventory['wood'] ?? 0);

  // Third chop fells it: wood DROPS on the ground (Stardew rule) and a STUMP remains — standing
  // adjacent, the drops magnet to the player; wait for collection before asserting the bag.
  await act(page, 'use-tool');
  at = (await nodes(page)).find((n) => n.tx === tree!.tx && n.ty === tree!.ty);
  expect(at?.kind).toBe('stump');
  await advanceFrames(page, 1000); // drops hop, magnet, collect
  const after = await getState(page);
  const woodFromTree = (after.inventory['wood'] ?? 0) - (before.inventory['wood'] ?? 0);
  expect(woodFromTree).toBeGreaterThan(0);
  expect(after.player.stamina).toBeLessThanOrEqual(before.player.stamina - 6); // 3 swings x 2

  // The stump is chopped SEPARATELY (2 hits) for extra wood; the spot is then fully clear.
  await act(page, 'use-tool');
  await act(page, 'use-tool');
  const cleared = (await nodes(page)).some((n) => n.tx === tree!.tx && n.ty === tree!.ty);
  expect(cleared).toBe(false);
  await advanceFrames(page, 1000);
  const final = await getState(page);
  expect((final.inventory['wood'] ?? 0) - (after.inventory['wood'] ?? 0)).toBeGreaterThan(0);
});

test('using the wrong tool on a node does nothing', async ({ page }) => {
  await bootGame(page);
  const all = await nodes(page);
  const occupied = new Set(all.map((n) => `${n.tx},${n.ty}`));
  const rock = all.find((n) => n.kind === 'rock' && !occupied.has(`${n.tx - 1},${n.ty}`));
  expect(rock).toBeTruthy();

  await teleport(page, rock!.tx - 1, rock!.ty, 'right');
  const before = await getState(page);

  // Axe on a rock: no effect.
  await act(page, `hotbar:${SLOT.axe}`);
  await act(page, 'use-tool');

  const after = await getState(page);
  const stillThere = (await nodes(page)).some((n) => n.tx === rock!.tx && n.ty === rock!.ty);
  expect(stillThere).toBe(true); // rock survives
  expect(after.player.stamina).toBe(before.player.stamina); // no stamina spent on a no-op
});
