/**
 * First-week forage proofs: the farm, forest and beach lay out a fixed number of wild finds each
 * morning; the same day always shows the same spots (re-entry never moves them); walking over a
 * find puts it in the bag and keeps it gone for the rest of the day; a full bag leaves it on the
 * ground; and the next morning brings a fresh set.
 */
import { expect, test, type Page } from '@playwright/test';
import { activeScene, advanceFrames, bootGame, getState, teleport, teleportToExit } from './helpers/gameHarness';

/** The forage finds drawn in a live scene, as "item@tx,ty" strings in draw order. */
async function finds(page: Page, key: string): Promise<string[]> {
  return page.evaluate(k => {
    // Test-only: read the private forage list through the live scene.
    const scene = window.__GAME__!.scene.getScene(k) as unknown as { forage: Array<{ spot: { item: string; tx: number; ty: number } }> };
    return scene.forage.map(f => `${f.spot.item}@${f.spot.tx},${f.spot.ty}`);
  }, key);
}

/** Wait until the named world scene is active and controllable. */
async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(k => window.__TEST__?.ready === true && window.__TEST__.activeScene() === k, key, { timeout: 10_000 });
}

/** Split "item@tx,ty" into parts. */
function parse(find: string): { item: string; tx: number; ty: number } {
  const [item, at] = find.split('@');
  const [tx, ty] = at.split(',').map(Number);
  return { item, tx, ty };
}

test('each outdoor scene lays out its daily finds', async ({ page }) => {
  await bootGame(page);
  const farm = await finds(page, 'FarmScene');
  expect(farm.filter(f => f.startsWith('wild-leek@')).length).toBe(2);

  await teleportToExit(page, 'ForestScene', 'left');
  await waitForScene(page, 'ForestScene');
  const forest = await finds(page, 'ForestScene');
  expect(forest.filter(f => f.startsWith('mushroom@')).length).toBe(3);
  expect(forest.filter(f => f.startsWith('wild-leek@')).length).toBe(2);

  // The beach map holds three shells on sand every day of the first week.
  const shells = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { ForageSystem } = await import('/src/systems/ForageSystem.ts');
    const map = getMapData('BeachScene');
    const days = [1, 2, 3, 4, 5, 6, 7].map(day => ForageSystem.spotsForDay(map, day, () => false) as Array<{ item: string; tx: number; ty: number }>);
    return days.map(spots => spots.filter(s => s.item === 'seashell' && map.ground[s.ty][s.tx] === 'sand').length);
  });
  expect(shells).toEqual([3, 3, 3, 3, 3, 3, 3]);
});

test('walking over a find picks it up and it stays gone today, then the next day brings new ones', async ({ page }) => {
  await bootGame(page);
  const before = await finds(page, 'FarmScene');
  const first = parse(before[0]);
  const bagBefore = (await getState(page)).inventory[first.item] ?? 0;
  await teleport(page, first.tx, first.ty, 'down');
  await advanceFrames(page, 200);
  expect((await getState(page)).inventory[first.item]).toBe(bagBefore + 1);
  expect(await finds(page, 'FarmScene')).toEqual(before.slice(1));

  // Re-entering the farm the same day: the picked find stays gone, the rest stay put.
  await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').scene.restart());
  await waitForScene(page, 'FarmScene');
  expect(await finds(page, 'FarmScene')).toEqual(before.slice(1));

  // A night lays out a fresh set.
  await page.evaluate(() => window.__TEST__!.sleep());
  await advanceFrames(page, 100);
  const nextDay = await finds(page, 'FarmScene');
  expect(nextDay.length).toBe(2);
  expect(nextDay).not.toEqual(before);
});

test('a full bag leaves the find on the ground', async ({ page }) => {
  await bootGame(page);
  const before = await finds(page, 'FarmScene');
  const first = parse(before[0]);
  // Fill every free slot with single items that cannot stack with the find.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    const gs = GameState.instance;
    for (const id of Object.keys(ITEM_CATALOG)) {
      if (id === 'wild-leek') continue;
      if (!gs.addItem(id, 1)) break;
    }
  });
  const bag = await getState(page);
  test.skip((bag.inventory['wild-leek'] ?? 0) > 0, 'the default bag already holds a leek stack');
  await teleport(page, first.tx, first.ty, 'down');
  await advanceFrames(page, 200);
  expect((await getState(page)).inventory[first.item] ?? 0).toBe(0);
  expect(await finds(page, 'FarmScene')).toEqual(before);
  expect(await activeScene(page)).toBe('FarmScene');
});
