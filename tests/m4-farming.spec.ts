/**
 * M4 — Farming loop. Verifies the full cycle deterministically:
 *   till (hoe) -> plant (seeds, CONSUMING one from the bag) -> water (can) -> sleep N days ->
 *   crop matures -> harvest -> produce item (+ a seeded 0..2 seed return).
 * The player is teleported to a tile that is confirmed clear of resource nodes, then acts on the
 * tile directly below (its facing tile). Growth is driven by the seam's sleep() (day rollover).
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, nodes, act, sleepInGame } from './helpers/gameHarness';

const SLOT = { hoe: 0, axe: 1, pickaxe: 2, scythe: 3, water: 4, seeds: 5 };

/** Find a tile whose facing tile (below it) is clear of any node, in a safe interior band. */
async function pickClearPlot(page: import('@playwright/test').Page): Promise<{ px: number; py: number; tx: number; ty: number }> {
  const ns = await nodes(page);
  const occupied = new Set(ns.map((n) => `${n.tx},${n.ty}`));
  // Search an interior region away from the lake (rows < 85) and borders.
  for (let py = 40; py < 80; py++) {
    for (let px = 10; px < 90; px++) {
      const tx = px;
      const ty = py + 1; // the tile the player faces when facing 'down'
      if (!occupied.has(`${px},${py}`) && !occupied.has(`${tx},${ty}`)) {
        return { px, py, tx, ty };
      }
    }
  }
  throw new Error('no clear plot found');
}

test('till -> plant (consumes a seed) -> water -> grow -> harvest yields a crop', async ({ page }) => {
  await bootGame(page);
  const plot = await pickClearPlot(page);

  // Stand on (px,py) facing down at the target tile (tx,ty).
  await teleport(page, plot.px, plot.py, 'down');

  // The player STARTS with 15 parsnip seeds (seeds are consumable items, not unlimited).
  let s = await getState(page);
  expect(s.inventory['parsnip-seeds']).toBe(15);
  expect(s.selectedSeed).toBe('parsnip-seeds');

  // Till.
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.tiles[`${plot.tx},${plot.ty}`]).toBe('tilled');

  // Plant seeds — exactly ONE seed is consumed from the bag.
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${plot.tx},${plot.ty}`]).toBeTruthy();
  expect(s.crops[`${plot.tx},${plot.ty}`].stage).toBe(0);
  expect(s.crops[`${plot.tx},${plot.ty}`].type).toBe('parsnip');
  expect(s.inventory['parsnip-seeds']).toBe(14);

  // Water, then sleep a day; repeat until mature (parsnip = 3 watered days; loop 4 for margin).
  for (let day = 0; day < 4; day++) {
    await act(page, `hotbar:${SLOT.water}`);
    await act(page, 'use-tool');
    // Watering must set the crop's watered flag.
    s = await getState(page);
    expect(s.crops[`${plot.tx},${plot.ty}`]?.watered).toBe(true);
    await sleepInGame(page);
  }

  s = await getState(page);
  const crop = s.crops[`${plot.tx},${plot.ty}`];
  expect(crop, 'crop should still be planted before harvest').toBeTruthy();
  expect(crop.stage).toBe(crop.maxStage); // fully grown

  // Harvest (interact / E) — must yield a parsnip and clear the crop. (Harvest also returns a
  // seeded 0..2 bonus of seeds; that's covered in m15-farming-depth.)
  const beforeParsnip = s.inventory['parsnip'] ?? 0;
  await act(page, 'interact');
  s = await getState(page);
  expect(s.crops[`${plot.tx},${plot.ty}`]).toBeFalsy();
  expect(s.inventory['parsnip'] ?? 0).toBe(beforeParsnip + 1);
});

test('day rollover restores stamina', async ({ page }) => {
  await bootGame(page);
  const plot = await pickClearPlot(page);
  await teleport(page, plot.px, plot.py, 'down');

  // Spend stamina by tilling a few times (till, then re-till adjacent by re-facing is overkill;
  // one till + a chop is enough to drop stamina below max).
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  const spent = await getState(page);
  expect(spent.player.stamina).toBeLessThan(100);

  await sleepInGame(page);
  const rested = await getState(page);
  expect(rested.player.stamina).toBe(100);
  expect(rested.day).toBe(spent.day + 1);
});
