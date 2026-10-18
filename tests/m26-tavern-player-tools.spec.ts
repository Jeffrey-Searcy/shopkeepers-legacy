import { teleportAtFarmShop, farmLayout } from './helpers/gameHarness';
/**
 * M26 — walk-in shop flow, porch physics, directional actions, and exhaustive tool details.
 *
 * These cases use real canvas/keyboard input for player-facing paths. Runtime module access is
 * limited to deterministic save setup and read-only inspection of Phaser objects/data.
 */
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import {
  activeScene,
  advanceFrames,
  bootGame,
  getState,
  sendInput,
  teleport,
  teleportToExit,
} from './helpers/gameHarness';

const MENU_URL = '/?test=1&seed=42&menu=1';

/** Click fixed game coordinates through Phaser's responsive canvas scaling. */
async function clickGame(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('M26: canvas has no bounding box');
  await page.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height);
  await advanceFrames(page, 100);
}

/** Read the live player texture/animation without changing state. */
async function playerVisual(page: Page): Promise<{ texture: string; animation: string | null }> {
  return page.evaluate(() => {
    const world = window.__GAME__!.scene
      .getScenes(true)
      .find((scene) => !['UIScene', 'MainMenuScene'].includes(scene.scene.key));
    if (!world) throw new Error('M26: no active world scene');
    const player = world.children.list.find((child) => {
      const sprite = child as Phaser.Physics.Arcade.Sprite;
      return sprite.texture?.key.startsWith('player') && sprite.body !== null;
    }) as Phaser.Physics.Arcade.Sprite | undefined;
    if (!player) throw new Error('M26: live player sprite not found');
    return { texture: player.texture.key, animation: player.anims.currentAnim?.key ?? null };
  });
}

test('interior: the public door is not a Home warp and the enlarged facade has explicit walkable porch geometry', async ({ page }) => {
  await bootGame(page);
  const layout = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const farm = getMapData(SceneKey.Farm);
    const { tx: dx, ty: dy } = farm.shopOffset;
    return {
      homeWarps: farm.warps.filter((warp: { target: string }) => warp.target === SceneKey.Home),
      wall: [farm.solid[9 + dy][69 + dx], farm.solid[12 + dy][76 + dx]],
      porch: [farm.solid[13 + dy][70 + dx], farm.solid[13 + dy][72 + dx], farm.solid[13 + dy][75 + dx]],
      steps: [farm.solid[14 + dy][72 + dx], farm.solid[14 + dy][73 + dx]],
      spawns: farm.spawns.filter((spawn: { id: string }) => ['start', 'from_home'].includes(spawn.id)),
    };
  });
  expect(layout.homeWarps).toEqual([]);
  expect(layout.wall).toEqual([true, true]);
  expect(layout.porch).toEqual([false, false, false]);
  expect(layout.steps).toEqual([false, false]);
  const { arrival } = await farmLayout(page);
  expect(layout.spawns).toEqual([
    expect.objectContaining({ id: 'start', ...arrival }),
    expect.objectContaining({ id: 'from_home', ...arrival }),
  ]);

  // Hold a real movement key across the porch and threshold; no interact action enters the shop.
  const before = await getState(page);
  await teleportAtFarmShop(page, 0, 3, 'up');
  await page.screenshot({
    path: '.frontend-loop/tavern-player-tools-polish/screenshots/round-01-tavern-porch.png',
  });
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready);
  } finally {
    await page.keyboard.up('w');
  }
  expect((await getState(page)).day).toBe(before.day);
  await expect.poll(() => activeScene(page)).toBe('TavernScene');
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('interior: pass-out wakes outside and a legacy Home save is normalized before any Home render', async ({ page }) => {
  await bootGame(page);
  const before = await getState(page);
  await page.evaluate(() => window.__TEST__!.stepTime(1200));
  await expect.poll(async () => (await getState(page)).day).toBe(before.day + 1);
  await expect.poll(() => activeScene(page)).toBe('FarmScene');
  expect((await getState(page)).player.stamina).toBe(50);
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);

  await page.goto(MENU_URL);
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.evaluate(async () => {
    for (let slot = 1; slot <= 3; slot++) localStorage.removeItem(`shopkeeperslegacy.save.v1.slot.${slot}`);
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    SaveSystem.beginNewGame(1);
    GameState.instance.activeScene = 'HomeInteriorScene' as typeof GameState.instance.activeScene;
    GameState.instance.player = { x: 168, y: 168, facing: 'up', stamina: 64 };
    SaveSystem.saveCurrent(1_786_100_000_000);
  });
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await activeScene(page)).toBe('FarmScene');
  expect((await getState(page)).player).toMatchObject({ facing: 'down', stamina: 64 });
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('animation: down and right scythe actions differ, and scythe/sword no longer share an asset', async ({ page }) => {
  await bootGame(page);
  const manifest = await page.evaluate(() => {
    const textures = window.__GAME__!.cache.json.get('manifest').textures as Record<string, { file?: string }>;
    return { sweep: textures['player-sweep'].file, sword: textures['player-sword'].file };
  });
  expect(manifest.sweep).toBe('characters/player-sweep-v3.png');
  expect(manifest.sword).toBe('characters/player-sword-v3.png');
  expect(manifest.sweep).not.toBe(manifest.sword);

  await teleport(page, 50, 50, 'down');
  await advanceFrames(page, 500);
  await sendInput(page, 'hotbar:3');
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 80);
  expect(await playerVisual(page)).toMatchObject({ texture: 'player-sweep', animation: 'player-sweep-down' });
  await page.screenshot({
    path: '.frontend-loop/tavern-player-tools-polish/screenshots/round-01-scythe-down.png',
  });
  await advanceFrames(page, 500);

  await teleport(page, 50, 50, 'right');
  await advanceFrames(page, 500);
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 80);
  expect(await playerVisual(page)).toMatchObject({ texture: 'player-sweep', animation: 'player-sweep-right' });
  await page.screenshot({
    path: '.frontend-loop/tavern-player-tools-polish/screenshots/round-01-scythe-right.png',
  });
  await advanceFrames(page, 500);

  // Reach the Mines through named warps, then exercise the real slot-8 + Space combat path.
  await teleport(page, 98, 30, 'right');
  await expect.poll(() => activeScene(page)).toBe('TownScene');
  await teleportToExit(page, 'MountainScene', 'up');
  await expect.poll(() => activeScene(page)).toBe('MountainScene');
  await teleport(page, 39, 12, 'up');
  await expect.poll(() => activeScene(page)).toBe('MinesScene');
  await teleport(page, 25, 8, 'down');
  await advanceFrames(page, 500);
  await page.keyboard.press('8');
  await page.keyboard.down('Space');
  await expect
    .poll(() => playerVisual(page), { timeout: 1_000, intervals: [20, 40, 80] })
    .toMatchObject({ texture: 'player-sword', animation: 'player-sword-down' });
  await page.screenshot({
    path: '.frontend-loop/tavern-player-tools-polish/screenshots/round-01-sword-down.png',
  });
  await page.keyboard.up('Space');
});

test('inventory: every starter slot can be inspected and a tool remains inspectable after moving to the backpack', async ({ page }) => {
  await bootGame(page);
  await page.keyboard.press('i');
  await advanceFrames(page, 100);

  const expected = ['Hoe', 'Axe', 'Pickaxe', 'Scythe', 'Watering Can', 'Parsnip Seeds', 'Fishing Rod', 'Sword'];
  for (let index = 0; index < 8; index++) {
    await clickGame(page, 294 + index * 49, 151);
    const detail = await page.evaluate(() => {
      const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
        inventoryUI: {
          detailIcon: { visible: boolean; texture: { key: string } };
          detailName: { text: string };
          detailCategory: { text: string };
          detailCount: { text: string };
          detailDescription: { text: string };
          actionLabel: { text: string };
        };
      };
      const inventory = ui.inventoryUI;
      return {
        iconVisible: inventory.detailIcon.visible,
        icon: inventory.detailIcon.texture.key,
        name: inventory.detailName.text,
        category: inventory.detailCategory.text,
        count: inventory.detailCount.text,
        description: inventory.detailDescription.text,
        action: inventory.actionLabel.text,
      };
    });
    expect(detail.name).toBe(expected[index]);
    expect(detail.iconVisible).toBe(true);
    expect(detail.icon).toMatch(/^icon-/);
    expect(detail.description.length).toBeGreaterThan(12);
    if (index === 5) {
      expect(detail.category).toBe('SEED');
      expect(detail.action).toBe('Equip Seeds');
    } else {
      expect(detail.category).toBe('TOOL');
      expect(detail.count).toBe('In toolbelt');
      expect(detail.action).toContain('INSPECTED');
    }
  }

  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    InventoryLayoutSystem.moveOrSwap(GameState.instance, { container: 'toolbelt', index: 3 }, { container: 'backpack', index: 0 });
  });
  await advanceFrames(page, 80);
  await clickGame(page, 149, 237);
  const moved = await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
      inventoryUI: { detailName: { text: string }; detailCount: { text: string } };
    };
    return { name: ui.inventoryUI.detailName.text, count: ui.inventoryUI.detailCount.text };
  });
  expect(moved).toEqual({ name: 'Scythe', count: 'In backpack' });
  await page.screenshot({
    path: '.frontend-loop/tavern-player-tools-polish/screenshots/round-01-inventory-tool.png',
  });
});
