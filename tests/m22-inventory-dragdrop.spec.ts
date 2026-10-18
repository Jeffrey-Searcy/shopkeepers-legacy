/**
 * M22 — authoritative draggable toolbelt/backpack.
 *
 * Real pointer gestures verify that the canvas UI moves whole slot entries, swaps occupied slots,
 * preserves quantities, and leaves state untouched for clicks and off-grid releases.
 */
import { test, expect, type Page } from '@playwright/test';
import { activeScene, advanceFrames, aimWorldTile, bootGame, getState, give, teleport, teleportAtFarmBin, teleportToExit, uiCanvasPoint } from './helpers/gameHarness';

const PANEL_X = 100;
const PANEL_Y = 69;

/** Center of a modal toolbelt slot in fixed 960x540 game coordinates. */
function beltCenter(index: number): { x: number; y: number } {
  return { x: PANEL_X + 173 + index * 49 + 21, y: PANEL_Y + 61 + 21 };
}

/** Center of a modal backpack slot in fixed 960x540 game coordinates. */
function bagCenter(index: number): { x: number; y: number } {
  return {
    x: PANEL_X + 29 + (index % 8) * 47 + 20,
    y: PANEL_Y + 148 + Math.floor(index / 8) * 47 + 20,
  };
}

/** Convert fixed game coordinates into the displayed canvas coordinates. */
async function canvasPoint(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return uiCanvasPoint(page, point);
}

/** Perform a pointer drag with enough distance/time to cross Phaser's drag threshold. */
async function dragSlot(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const start = await canvasPoint(page, from);
  const end = await canvasPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await advanceFrames(page, 150);
}

/** Click a point in the game's fixed coordinate system. */
async function clickGame(page: Page, point: { x: number; y: number }): Promise<void> {
  const target = await canvasPoint(page, point);
  await page.mouse.click(target.x, target.y);
  await advanceFrames(page, 120);
}

test('dragging to empty moves and dragging to occupied swaps without changing quantities', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  await give(page, 'stone', 3);
  await page.keyboard.press('i');
  await advanceFrames(page, 120);

  const before = await getState(page);
  expect(before.backpackSlots.slice(0, 2)).toEqual(['wood', 'stone']);

  await dragSlot(page, beltCenter(0), bagCenter(5));
  let state = await getState(page);
  expect(state.toolbeltSlots[0]).toBeNull();
  expect(state.backpackSlots[5]).toBe('tool:hoe');
  expect(state.inventory).toEqual(before.inventory);

  await dragSlot(page, bagCenter(0), beltCenter(1));
  state = await getState(page);
  expect(state.toolbeltSlots[1]).toBe('wood');
  expect(state.backpackSlots[0]).toBe('tool:axe');
  expect(state.inventory).toEqual(before.inventory);

  await page.keyboard.press('2');
  await advanceFrames(page, 80);
  expect((await getState(page)).hotbarIndex).toBe(1);
  const active = await page.evaluate(async () => {
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const mod = await import('/src/systems/ToolSystem.ts');
    return mod.ToolSystem.active();
  });
  expect(active).toBeNull();
});

test('short click, same-slot drag, and off-grid release are slot-state no-ops', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  await page.keyboard.press('i');
  await advanceFrames(page, 120);

  const before = await getState(page);
  const start = await canvasPoint(page, bagCenter(0));
  await page.mouse.click(start.x, start.y);
  await advanceFrames(page, 100);
  let state = await getState(page);
  expect(state.toolbeltSlots).toEqual(before.toolbeltSlots);
  expect(state.backpackSlots).toEqual(before.backpackSlots);
  expect(state.inventory).toEqual(before.inventory);

  await dragSlot(page, bagCenter(0), bagCenter(0));
  state = await getState(page);
  expect(state.toolbeltSlots).toEqual(before.toolbeltSlots);
  expect(state.backpackSlots).toEqual(before.backpackSlots);

  await dragSlot(page, bagCenter(0), { x: 850, y: 450 });
  state = await getState(page);
  expect(state.toolbeltSlots).toEqual(before.toolbeltSlots);
  expect(state.backpackSlots).toEqual(before.backpackSlots);
  expect(state.inventory).toEqual(before.inventory);
});

test('a full backpack rejects a new external stack atomically but still merges an existing stack', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error runtime module paths are served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    // @ts-expect-error runtime module paths are served by Vite in browser tests
    const layoutMod = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = stateMod.GameState.instance;
    for (let index = 0; index < 24; index++) {
      if (!gs.addItem(`test-stack-${index}`, 1)) throw new Error(`failed to fill backpack slot ${index}`);
    }
    const source: Record<string, number> = { 'brand-new-stack': 4, 'test-stack-0': 3 };
    const beforeNew = { ...source };
    const rejected = layoutMod.InventoryLayoutSystem.transferToPlayer(gs, source, 'brand-new-stack', 4);
    const unchangedAfterReject = { ...source };
    const merged = layoutMod.InventoryLayoutSystem.transferToPlayer(gs, source, 'test-stack-0', 2);
    return {
      rejected,
      merged,
      beforeNew,
      unchangedAfterReject,
      source,
      inventory: { ...gs.inventory },
      backpackSlots: [...gs.backpackSlots],
    };
  });

  expect(result.rejected).toBe(0);
  expect(result.unchangedAfterReject).toEqual(result.beforeNew);
  expect(result.inventory['brand-new-stack']).toBeUndefined();
  expect(result.backpackSlots).toHaveLength(24);
  expect(result.backpackSlots.every((entry) => entry !== null)).toBe(true);
  expect(result.merged).toBe(2);
  expect(result.inventory['test-stack-0']).toBe(3);
  expect(result.source['test-stack-0']).toBe(1);
});

test('an item stack dragged onto the toolbelt remains transferable through chest and shipping UIs', async ({ page }) => {
  await bootGame(page);
  await give(page, 'wood', 5);
  await give(page, 'chest', 1);
  await page.keyboard.press('i');
  await advanceFrames(page, 100);
  await dragSlot(page, bagCenter(0), beltCenter(0));
  expect((await getState(page)).toolbeltSlots[0]).toBe('wood');
  await page.keyboard.press('i');

  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, 60, 61);
  await page.evaluate(() => window.__TEST__!.input('use-tool'));
  await advanceFrames(page, 150);
  await page.evaluate(() => window.__TEST__!.input('interact'));
  await advanceFrames(page, 120);
  expect((await getState(page)).chestOpen).toBe(true);
  await clickGame(page, { x: 525, y: 226 });
  let state = await getState(page);
  expect(state.inventory.wood ?? 0).toBe(0);
  expect(state.chest.wood).toBe(5);
  await clickGame(page, { x: 145, y: 226 });
  state = await getState(page);
  expect(state.inventory.wood).toBe(5);

  await page.keyboard.press('e');
  await teleportAtFarmBin(page);
  await page.evaluate(() => window.__TEST__!.input('interact'));
  await advanceFrames(page, 120);
  expect((await getState(page)).binOpen).toBe(true);
  await clickGame(page, { x: 525, y: 226 });
  state = await getState(page);
  expect(state.inventory.wood ?? 0).toBe(0);
  expect(state.bin.wood).toBe(5);
});

test('full-backpack harvest leaves the mature crop and soil untouched', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error runtime module paths are served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    // @ts-expect-error runtime module paths are served by Vite in browser tests
    const cropMod = await import('/src/systems/CropSystem.ts');
    const gs = stateMod.GameState.instance;
    for (let index = 0; index < 24; index++) {
      if (!gs.addItem(`full-stack-${index}`, 1)) throw new Error(`failed to fill backpack ${index}`);
    }
    const key = 'FarmScene:50,50';
    gs.tiles[key] = 'watered';
    gs.crops[key] = { type: 'potato', stage: 3, maxStage: 3, watered: true, daysInStage: 0 };
    const attempt = cropMod.CropSystem.harvest(50, 50);
    return {
      attempt,
      crop: gs.crops[key],
      soil: gs.tiles[key],
      potato: gs.inventory.potato,
      backpackSlots: [...gs.backpackSlots],
    };
  });
  expect(result.attempt.status).toBe('full');
  expect(result.crop).toMatchObject({ type: 'potato', stage: 3, maxStage: 3 });
  expect(result.soil).toBe('watered');
  expect(result.potato).toBeUndefined();
  expect(result.backpackSlots.every((entry) => entry !== null)).toBe(true);
});

test('full-bag ground drops survive a scene transition and respawn on return', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    const gs = stateMod.GameState.instance;
    for (let index = 0; index < 24; index++) {
      if (!gs.addItem(`drop-fill-${index}`, 1)) throw new Error(`failed to fill backpack ${index}`);
    }
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      spawnDrops: (item: string, n: number, tx: number, ty: number) => void;
    };
    farm.spawnDrops('brand-new-drop', 1, 60, 60);
  });

  await teleport(page, 98, 30, 'right');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('TownScene');
  let state = await getState(page);
  expect(state.groundDrops).toHaveLength(1);
  expect(state.groundDrops[0]).toMatchObject({ scene: 'FarmScene', item: 'brand-new-drop', tx: 60 });
  expect(state.groundDrops[0].ty).toBeGreaterThanOrEqual(59); // the drop may be mid-hop at shutdown
  expect(state.groundDrops[0].ty).toBeLessThanOrEqual(60);

  // why: the Town road home moves whenever the Town is redrawn, so read it from the live map.
  await teleportToExit(page, 'FarmScene', 'left');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('FarmScene');
  state = await getState(page);
  expect(state.groundDrops).toEqual([]);
  const restored = await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene');
    return farm.children.list.some((child) => (child as { item?: string }).item === 'brand-new-drop');
  });
  expect(restored).toBe(true);
});
