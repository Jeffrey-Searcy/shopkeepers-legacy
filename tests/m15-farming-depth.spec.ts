/**
 * M15 — Farming depth overhaul. Verifies:
 *  - watering can capacity: 12 uses, empty can denies (no water, no stamina), refills facing water;
 *  - seeds as items: planting consumes one, zero seeds = rejected, harvest returns 0..2 seeds;
 *  - seasons: 28-day calendar on state, off-season planting rejected, in-season accepted;
 *  - crop catalog: parsnip vs potato grow at different speeds;
 *  - tree stages: full tree -> stump -> cleared -> sapling regrows after N days -> small -> full;
 *  - REAL keyboard input for the watering flow (seam-only tests once masked broken digit keys).
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  nodes,
  act,
  sleepInGame,
  give,
  selectSeed,
  setDay,
  advanceFrames,
} from './helpers/gameHarness';

const SLOT = { hoe: 0, axe: 1, pickaxe: 2, scythe: 3, water: 4, seeds: 5 };

/**
 * Find `count` horizontally-adjacent GRASS tiles (row ty) clear of nodes, with the stand row
 * above them also clear — so the player can face down at each from (tx, ty-1). Scans entirely
 * in-browser (per-tile page.evaluate round-trips would take seconds).
 */
async function pickGrassRow(
  page: import('@playwright/test').Page,
  count: number
): Promise<{ tx: number; ty: number }> {
  const spot = await page.evaluate((n) => {
    const t = window.__TEST__!;
    const occupied = new Set(t.nodes().map((node) => `${node.tx},${node.ty}`));
    for (let ty = 41; ty < 80; ty++) {
      for (let tx = 10; tx < 90 - n; tx++) {
        let ok = true;
        for (let i = 0; i < n; i++) {
          if (
            occupied.has(`${tx + i},${ty}`) ||
            occupied.has(`${tx + i},${ty - 1}`) ||
            t.groundAt(tx + i, ty) !== 'grass'
          ) {
            ok = false;
            break;
          }
        }
        if (ok) return { tx, ty };
      }
    }
    return null;
  }, count);
  if (!spot) throw new Error(`no clear ${count}-tile grass row found`);
  return spot;
}

/** Find a water tile with a grass tile directly above it (a shoreline to stand on). */
async function pickShore(page: import('@playwright/test').Page): Promise<{ tx: number; ty: number }> {
  const spot = await page.evaluate(() => {
    const t = window.__TEST__!;
    for (let ty = 80; ty < 99; ty++) {
      for (let tx = 5; tx < 95; tx++) {
        if (t.groundAt(tx, ty) === 'water' && t.groundAt(tx, ty - 1) === 'grass') {
          return { tx, ty };
        }
      }
    }
    return null;
  });
  if (!spot) throw new Error('no shoreline found');
  return spot;
}

test('watering can: 12 uses, empty can denies without spending, refills facing water', async ({ page }) => {
  await bootGame(page);
  const row = await pickGrassRow(page, 1);
  await teleport(page, row.tx, row.ty - 1, 'down');

  // Till, then water once: capacity drops from 12 to 11.
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  let s = await getState(page);
  expect(s.canWater).toBe(12);
  await act(page, `hotbar:${SLOT.water}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.canWater).toBe(11);
  expect(s.tiles[`${row.tx},${row.ty}`]).toBe('watered');

  // Drain the rest (re-watering a watered tile still consumes — Stardew lets you waste water).
  for (let i = 0; i < 11; i++) {
    await act(page, 'use-tool');
  }
  s = await getState(page);
  expect(s.canWater).toBe(0);

  // Empty can: the attempt is DENIED — no capacity change and no stamina spent.
  const before = await getState(page);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.canWater).toBe(0);
  expect(s.player.stamina).toBe(before.player.stamina);

  // Refill: face a water tile and use the can.
  const shore = await pickShore(page);
  await teleport(page, shore.tx, shore.ty - 1, 'down');
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.canWater).toBe(12);
});

test('seeds are items: planting consumes one, none = rejected, harvest returns 0..2 seeds', async ({ page }) => {
  await bootGame(page);
  const row = await pickGrassRow(page, 2);
  await teleport(page, row.tx, row.ty - 1, 'down');

  // Till the first tile, equip a single POTATO seed, and consume it exactly once.
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await give(page, 'potato-seeds', 1);
  await selectSeed(page, 'potato-seeds');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  let s = await getState(page);
  expect(s.crops[`${row.tx},${row.ty}`]?.type).toBe('potato');
  expect(s.inventory['potato-seeds'] ?? 0).toBe(0);

  // Depletion clears that belt slot, so the same selected index cannot plant an unlimited seed
  // on the neighboring tilled tile.
  await teleport(page, row.tx + 1, row.ty - 1, 'down');
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${row.tx + 1},${row.ty}`]).toBeFalsy();

  // A newly acquired stack must be explicitly equipped again; planting consumes one.
  await give(page, 'potato-seeds', 3);
  await selectSeed(page, 'potato-seeds');
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${row.tx + 1},${row.ty}`]?.type).toBe('potato');
  expect(s.inventory['potato-seeds']).toBe(2);

  // Grow the first potato to maturity (6 watered days) and harvest: produce + 0..2 seeds back.
  await teleport(page, row.tx, row.ty - 1, 'down');
  await act(page, `hotbar:${SLOT.water}`);
  for (let day = 0; day < 6; day++) {
    await act(page, 'use-tool');
    await sleepInGame(page);
  }
  s = await getState(page);
  expect(s.crops[`${row.tx},${row.ty}`]?.stage).toBe(s.crops[`${row.tx},${row.ty}`]?.maxStage);
  const seedsBefore = s.inventory['potato-seeds'] ?? 0;
  await act(page, 'interact');
  s = await getState(page);
  expect(s.inventory['potato']).toBe(1);
  const seedReturn = (s.inventory['potato-seeds'] ?? 0) - seedsBefore;
  expect(seedReturn).toBeGreaterThanOrEqual(0);
  expect(seedReturn).toBeLessThanOrEqual(2);
});

test('seasons: 28-day calendar, off-season planting rejected, in-season accepted', async ({ page }) => {
  await bootGame(page);
  const row = await pickGrassRow(page, 2);
  await teleport(page, row.tx, row.ty - 1, 'down');

  // Day 1 = spring.
  let s = await getState(page);
  expect(s.day).toBe(1);
  expect(s.season).toBe('spring');

  // Melon is a SUMMER crop: planting in spring is rejected and consumes nothing.
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await give(page, 'melon-seeds', 5);
  await selectSeed(page, 'melon-seeds');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${row.tx},${row.ty}`]).toBeFalsy();
  expect(s.inventory['melon-seeds']).toBe(5);

  // Jump the calendar into summer: melon plants; parsnip (spring crop) is now rejected.
  await setDay(page, 30);
  s = await getState(page);
  expect(s.season).toBe('summer');
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${row.tx},${row.ty}`]?.type).toBe('melon');
  expect(s.inventory['melon-seeds']).toBe(4);

  // Parsnip on the second tile: till it, then the spring seed is refused in summer.
  await teleport(page, row.tx + 1, row.ty - 1, 'down');
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await selectSeed(page, 'parsnip-seeds');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  s = await getState(page);
  expect(s.crops[`${row.tx + 1},${row.ty}`]).toBeFalsy();
  expect(s.inventory['parsnip-seeds']).toBe(15); // untouched
});

test('crop catalog: parsnip and potato grow at different speeds', async ({ page }) => {
  await bootGame(page);
  const row = await pickGrassRow(page, 2);
  await give(page, 'potato-seeds', 1);

  // Tile A: parsnip. Tile B: potato.
  await teleport(page, row.tx, row.ty - 1, 'down');
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool'); // parsnip (default selected seed)
  await teleport(page, row.tx + 1, row.ty - 1, 'down');
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await selectSeed(page, 'potato-seeds');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');

  // Water both and sleep twice. Parsnip (1 day/stage) should be at stage 2; potato (2 days/stage)
  // only at stage 1.
  for (let day = 0; day < 2; day++) {
    await act(page, `hotbar:${SLOT.water}`);
    await teleport(page, row.tx, row.ty - 1, 'down');
    await act(page, 'use-tool');
    await teleport(page, row.tx + 1, row.ty - 1, 'down');
    await act(page, 'use-tool');
    await sleepInGame(page);
  }
  const s = await getState(page);
  expect(s.crops[`${row.tx},${row.ty}`]?.stage).toBe(2);
  expect(s.crops[`${row.tx + 1},${row.ty}`]?.stage).toBe(1);
});

test('tree lifecycle: full -> stump -> cleared -> sapling regrows -> small -> full', async ({ page }) => {
  await bootGame(page);
  const all = await nodes(page);
  const occupied = new Set(all.map((n) => `${n.tx},${n.ty}`));
  const tree = all.find(
    (n) => n.kind === 'tree' && n.stage === 'full' && !occupied.has(`${n.tx - 1},${n.ty}`)
  )!;
  expect(tree).toBeTruthy();
  await teleport(page, tree.tx - 1, tree.ty, 'right');
  await act(page, `hotbar:${SLOT.axe}`);

  // Fell the full tree (3 chops) -> a stump stands in its place.
  for (let i = 0; i < 3; i++) await act(page, 'use-tool');
  let at = (await nodes(page)).find((n) => n.tx === tree.tx && n.ty === tree.ty);
  expect(at?.kind).toBe('stump');

  // Chop the stump (2 hits) -> the spot is fully cleared and recorded for regrowth.
  for (let i = 0; i < 2; i++) await act(page, 'use-tool');
  at = (await nodes(page)).find((n) => n.tx === tree.tx && n.ty === tree.ty);
  expect(at).toBeFalsy();
  let s = await getState(page);
  expect(s.removedNodes[`FarmScene:${tree.tx},${tree.ty}`]?.kind).toBe('tree');

  // After TREE_REGROW_DAYS (3) nights, a sapling sprouts on the cleared spot.
  for (let i = 0; i < 3; i++) await sleepInGame(page);
  at = (await nodes(page)).find((n) => n.tx === tree.tx && n.ty === tree.ty);
  expect(at?.kind).toBe('tree');
  expect(at?.stage).toBe('sapling');
  s = await getState(page);
  expect(s.removedNodes[`FarmScene:${tree.tx},${tree.ty}`]).toBeFalsy();

  // Two more nights per stage: sapling -> small -> full (TREE_STAGE_DAYS = 2).
  for (let i = 0; i < 2; i++) await sleepInGame(page);
  at = (await nodes(page)).find((n) => n.tx === tree.tx && n.ty === tree.ty);
  expect(at?.stage).toBe('small');
  for (let i = 0; i < 2; i++) await sleepInGame(page);
  at = (await nodes(page)).find((n) => n.tx === tree.tx && n.ty === tree.ty);
  expect(at?.stage).toBe('full');
});

test('REAL keyboard: till with 1+Space, water with 5+Space, meter drains (real input path)', async ({ page }) => {
  await bootGame(page);
  const row = await pickGrassRow(page, 1);
  await teleport(page, row.tx, row.ty - 1, 'down');

  // Hoe via digit key + Space hold (the hold-to-use loop drives real swings).
  await page.keyboard.press('1');
  await advanceFrames(page, 150);
  await page.keyboard.down('Space');
  await advanceFrames(page, 250);
  await page.keyboard.up('Space');
  await expect
    .poll(async () => (await getState(page)).tiles[`${row.tx},${row.ty}`], { timeout: 5_000 })
    .toBe('tilled');

  // Watering can via digit key + Space: the tile waters and the meter drains below 12.
  await page.keyboard.press('5');
  await advanceFrames(page, 150);
  await page.keyboard.down('Space');
  await advanceFrames(page, 250);
  await page.keyboard.up('Space');
  await expect
    .poll(async () => (await getState(page)).tiles[`${row.tx},${row.ty}`], { timeout: 5_000 })
    .toBe('watered');
  const s = await getState(page);
  expect(s.canWater).toBeLessThan(12);
});
