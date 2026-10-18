/** Real-input checks for the soft-pocket inventory's keyboard, pointer, and motion behavior. */
import { test, expect, type Page } from '@playwright/test';
import { advanceFrames, bootGame, getState, give, uiCanvasPoint } from './helpers/gameHarness';

/** Open the inventory and wait until its visibility synchronization has run. */
async function openPockets(page: Page): Promise<void> {
  await page.keyboard.press('i');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(true);
  await advanceFrames(page, 180);
}

/** Read the second tool slot's visual state without modifying any gameplay objects. */
async function hoverState(page: Page): Promise<{ hovered: boolean; fill: number; iconY: number }> {
  return page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene') as unknown as {
      inventoryUI: { toolbeltSlots: Array<{ hovered: boolean; inset: { fillColor: number }; icon: { y: number } }> };
    };
    const slot = scene.inventoryUI.toolbeltSlots[1];
    return { hovered: slot.hovered, fill: slot.inset.fillColor, iconY: slot.icon.y };
  });
}

test('blank panel clicks stay inside the menu and keyboard moves preserve item quantities', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootGame(page);
  await openPockets(page);
  const blank = await uiCanvasPoint(page, { x: 115, y: 400 });
  await page.mouse.click(blank.x, blank.y);
  expect((await getState(page)).inventoryOpen).toBe(true);
  const before = await getState(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).backpackSlots[0]).toBe('tool:hoe');
  expect((await getState(page)).toolbeltSlots[0]).toBeNull();
  expect((await getState(page)).inventory).toEqual(before.inventory);
  await page.keyboard.press('Enter');
  await page.keyboard.press('i');
  await advanceFrames(page, 80);
  await openPockets(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  expect((await getState(page)).backpackSlots[0]).toBe('tool:hoe');
});

test('keyboard crafting uses the same recipe and Space runs the inspected item action', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 20);
  await openPockets(page);
  await page.keyboard.press('c');
  await expect.poll(async () => (await getState(page)).inventory.workbench).toBe(1);
  expect((await getState(page)).inventory.wood).toBe(5);
  await page.keyboard.press('ArrowDown'); // backpack 0: remaining wood
  await page.keyboard.press('ArrowRight'); // backpack 1: workbench
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).placingItem).toBe('workbench');
  expect((await getState(page)).inventoryOpen).toBe(false);
});

test('hover survives frame refresh and clears when the pointer leaves', async ({ page }) => {
  await bootGame(page);
  await openPockets(page);
  const before = await hoverState(page);
  const slot = await uiCanvasPoint(page, { x: 343, y: 151 });
  await page.mouse.move(slot.x, slot.y);
  await advanceFrames(page, 250);
  const hovered = await hoverState(page);
  expect(hovered.hovered).toBe(true);
  expect(hovered.fill).not.toBe(before.fill);
  expect(hovered.iconY).toBeLessThan(before.iconY);
  const blank = await uiCanvasPoint(page, { x: 115, y: 400 });
  await page.mouse.move(blank.x, blank.y);
  await expect.poll(async () => (await hoverState(page)).hovered).toBe(false);
  expect((await hoverState(page)).iconY).toBe(before.iconY);
});

test('closing mid-drag destroys the ghost and cancels the transfer', async ({ page }) => {
  await bootGame(page);
  await openPockets(page);
  const before = await getState(page);
  const start = await uiCanvasPoint(page, { x: 294, y: 151 });
  const finish = await uiCanvasPoint(page, { x: 149, y: 237 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(finish.x, finish.y, { steps: 12 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__GAME__!.scene.getScene('UIScene').children.getByName('inventory-drag-ghost')))).toBe(true);
  await page.keyboard.press('i');
  await advanceFrames(page, 100);
  await page.mouse.up();
  expect(await page.evaluate(() => Boolean(window.__GAME__!.scene.getScene('UIScene').children.getByName('inventory-drag-ghost')))).toBe(false);
  const after = await getState(page);
  expect(after.toolbeltSlots).toEqual(before.toolbeltSlots);
  expect(after.backpackSlots).toEqual(before.backpackSlots);
  expect(after.inventory).toEqual(before.inventory);
});

test('reduced motion keeps hover and opening feedback static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bootGame(page);
  await openPockets(page);
  const before = await hoverState(page);
  const slot = await uiCanvasPoint(page, { x: 343, y: 151 });
  await page.mouse.move(slot.x, slot.y);
  await advanceFrames(page, 180);
  expect((await hoverState(page)).hovered).toBe(true);
  expect((await hoverState(page)).iconY).toBe(before.iconY);
  expect(await page.evaluate(() => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('inventory-panel') as unknown as { alpha: number };
    return panel.alpha;
  })).toBe(1);
});

test('only the inspected item has an inspection outline among populated pockets', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  await give(page, 'stone', 3);
  await openPockets(page);
  const target = await uiCanvasPoint(page, { x: 149, y: 237 });
  await page.mouse.click(target.x, target.y);
  await advanceFrames(page, 100);
  expect(await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene') as unknown as {
      inventoryUI: { backpackSlots: Array<{ bg: { getData(key: string): unknown } }> };
    };
    return scene.inventoryUI.backpackSlots.slice(0, 2).map(slot => slot.bg.getData('inspected'));
  })).toEqual([true, false]);
});
