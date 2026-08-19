/**
 * M21 — Picnic Satchel inventory overhaul.
 *
 * These tests deliberately use real keyboard, wheel, and canvas pointer input for every player
 * path the redesign exposes. State assertions verify that the cute presentation did not create a
 * parallel inventory model or break the existing chest/shipping systems.
 */
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import {
  activeScene,
  advanceFrames,
  bootGame,
  getState,
  give,
  teleport,
} from './helpers/gameHarness';

const ALL_ITEMS = [
  'wood', 'stone', 'fiber', 'parsnip', 'potato', 'melon', 'parsnip-seeds',
  'potato-seeds', 'melon-seeds', 'chest', 'workbench', 'table', 'chair', 'rug',
  'fish-sardine', 'fish-bass', 'fish-carp', 'slime-gel', 'bat-wing',
] as const;

/** Click a point expressed in the game's fixed 960x540 coordinate system. */
async function clickGame(page: Page, gameX: number, gameY: number): Promise<void> {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('M21: game canvas has no bounding box');
  await page.mouse.click(box.x + (gameX / 960) * box.width, box.y + (gameY / 540) * box.height);
  await advanceFrames(page, 120);
}

/** Warp into the Mines using the real named-map route. */
async function enterMines(page: Page): Promise<void> {
  await teleport(page, 98, 30, 'right');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('TownScene');
  await teleport(page, 40, 0, 'up');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('MountainScene');
  await teleport(page, 39, 12, 'up');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('MinesScene');
  await advanceFrames(page, 250);
}

test('all eight real digit keys, wheel directions, and live hotbar clicks select tools', async ({ page }) => {
  await bootGame(page);
  for (let digit = 1; digit <= 8; digit++) {
    await page.keyboard.press(String(digit));
    await advanceFrames(page, 60);
    expect((await getState(page)).hotbarIndex).toBe(digit - 1);
  }

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('M21: game canvas has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await advanceFrames(page, 100);
  expect((await getState(page)).hotbarIndex).toBe(0);
  await page.mouse.wheel(0, -120);
  await advanceFrames(page, 100);
  expect((await getState(page)).hotbarIndex).toBe(7);

  await clickGame(page, 312, 510); // live hotbar slot 1
  expect((await getState(page)).hotbarIndex).toBe(0);
  await clickGame(page, 648, 510); // live hotbar slot 8
  expect((await getState(page)).hotbarIndex).toBe(7);

  await enterMines(page);
  for (let digit = 1; digit <= 8; digit++) {
    await page.keyboard.press(String(digit));
    await advanceFrames(page, 60);
    expect((await getState(page)).hotbarIndex).toBe(digit - 1);
  }
});

test('I and Tab toggle the 24-slot satchel; selection is inspect-first then explicit action', async ({ page }) => {
  await bootGame(page);
  for (const item of ALL_ITEMS) await give(page, item, 2);

  await page.keyboard.press('i');
  await advanceFrames(page, 150);
  expect((await getState(page)).inventoryOpen).toBe(true);

  // New stacks retain authoritative backpack positions. Potato seeds land in backpack slot 7
  // because the starter parsnip stack already lives in the toolbelt.
  await clickGame(page, 431, 237);
  expect((await getState(page)).selectedSeed).toBe('parsnip-seeds');
  await clickGame(page, 688, 385); // explicit "Equip Seeds" action
  expect((await getState(page)).selectedSeed).toBe('potato-seeds');
  expect((await getState(page)).inventoryOpen).toBe(true);

  // Chest is backpack slot 9 (second row, first column): select, then explicitly place.
  await clickGame(page, 149, 284);
  expect((await getState(page)).placingItem).toBeNull();
  await clickGame(page, 688, 385);
  const placing = await getState(page);
  expect(placing.placingItem).toBe('chest');
  expect(placing.inventoryOpen).toBe(false);

  // Cancel placement, then prove Tab opens and closes the same modal path.
  await page.keyboard.press('e');
  await advanceFrames(page, 100);
  await page.keyboard.press('Tab');
  await advanceFrames(page, 100);
  expect((await getState(page)).inventoryOpen).toBe(true);
  await page.keyboard.press('Tab');
  await advanceFrames(page, 100);
  expect((await getState(page)).inventoryOpen).toBe(false);
});

test('chest transfer uses real canvas clicks in both directions', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  await give(page, 'chest', 1);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await page.evaluate(() => window.__TEST__!.input('use-tool'));
  await advanceFrames(page, 150);
  await page.evaluate(() => window.__TEST__!.input('interact'));
  await advanceFrames(page, 150);
  expect((await getState(page)).chestOpen).toBe(true);

  await clickGame(page, 352, 308); // satchel wood -> chest
  let state = await getState(page);
  expect(state.inventory.wood ?? 0).toBe(0);
  expect(state.chest.wood).toBe(5);

  await clickGame(page, 352, 160); // chest wood -> satchel
  state = await getState(page);
  expect(state.inventory.wood).toBe(5);
  expect(state.chest.wood ?? 0).toBe(0);
});

test('shipping transfer uses real canvas clicks in both directions', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 4);
  await teleport(page, 79, 13, 'right');
  await page.evaluate(() => window.__TEST__!.input('interact'));
  await advanceFrames(page, 150);
  expect((await getState(page)).binOpen).toBe(true);

  await clickGame(page, 352, 308); // satchel wood -> shipping crate
  let state = await getState(page);
  expect(state.inventory.wood ?? 0).toBe(0);
  expect(state.bin.wood).toBe(4);

  await clickGame(page, 352, 160); // shipping crate wood -> satchel
  state = await getState(page);
  expect(state.inventory.wood).toBe(4);
  expect(state.bin.wood ?? 0).toBe(0);
});

test('visual evidence: all 19 item stacks fit at desktop and compact viewports', async ({ page }) => {
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => requestFailures.push(`${request.url()}: ${request.failure()?.errorText}`));

  await page.setViewportSize({ width: 960, height: 540 });
  await bootGame(page);
  for (const item of ALL_ITEMS) await give(page, item, 2);
  await page.keyboard.press('i');
  await advanceFrames(page, 180);
  await clickGame(page, 478, 237); // show the explicit seed CTA in scored evidence
  await page.screenshot({ path: '.frontend-loop/inventory-overhaul/screenshots/round-02-desktop.png' });

  await page.setViewportSize({ width: 720, height: 405 });
  await advanceFrames(page, 180);
  await page.screenshot({ path: '.frontend-loop/inventory-overhaul/screenshots/round-02-compact.png' });

  // Phaser keeps a 960x540 logical game and FIT-scales it to 720x405. Assert both the logical
  // satchel bounds and their mapped CSS coordinates so a future oversized panel cannot hide
  // behind a screenshot-only test.
  const layout = await page.evaluate(() => {
    const game = window.__GAME__!;
    const uiScene = game.scene.getScene('UIScene') as unknown as {
      inventoryUI: { panel: Phaser.GameObjects.Container };
    };
    const bounds = uiScene.inventoryUI.panel.getBounds();
    const canvasBounds = game.canvas.getBoundingClientRect();
    const labels = uiScene.inventoryUI.panel.list
      .filter((child): child is Phaser.GameObjects.Text => 'text' in child && typeof child.text === 'string')
      .map((child) => child.text);
    return {
      logical: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      css: {
        left: canvasBounds.left + (bounds.left / 960) * canvasBounds.width,
        top: canvasBounds.top + (bounds.top / 540) * canvasBounds.height,
        right: canvasBounds.left + (bounds.right / 960) * canvasBounds.width,
        bottom: canvasBounds.top + (bounds.bottom / 540) * canvasBounds.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
      labels,
    };
  });
  expect(layout.logical.left).toBeGreaterThanOrEqual(0);
  expect(layout.logical.top).toBeGreaterThanOrEqual(0);
  expect(layout.logical.right).toBeLessThanOrEqual(960);
  expect(layout.logical.bottom).toBeLessThanOrEqual(540);
  expect(layout.css.left).toBeGreaterThanOrEqual(0);
  expect(layout.css.top).toBeGreaterThanOrEqual(0);
  expect(layout.css.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.css.bottom).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.labels).toEqual(expect.arrayContaining(['TOOLBELT', 'BACKPACK · 24 SLOTS', 'SELECTED CHARM']));

  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
  expect(Object.keys((await getState(page)).inventory).filter((item) => ALL_ITEMS.includes(item as typeof ALL_ITEMS[number]))).toHaveLength(19);
});
