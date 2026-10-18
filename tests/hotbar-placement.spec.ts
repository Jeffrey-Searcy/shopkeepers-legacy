import { teleportAtFarmShop } from './helpers/gameHarness';
/** Indoor policy and real toolbar placement share quantity, cancellation, and pointer ownership rules. */
import { expect, test, type Page } from '@playwright/test';
import { aimWorldTile, advanceFrames, bootGame, getState, teleport, uiCanvasPoint } from './helpers/gameHarness';

/** Put a fixture stack in a real belt slot through the authoritative slot transaction. */
async function stockBelt(page: Page, item: string, count: number, index: number): Promise<void> {
  await page.evaluate(async ({ item, count, index }) => {
    // @ts-expect-error Vite resolves browser runtime modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    if (!gs.addItem(item, count)) throw new Error('Fixture stack does not fit');
    const source = InventoryLayoutSystem.findEntrySlot(gs, item);
    if (!source) throw new Error('Fixture stack lacks an authoritative slot');
    InventoryLayoutSystem.moveOrSwap(gs, source, { container: 'toolbelt', index });
  }, { item, count, index });
}

/** Enter through the actual animated entrance while the player holds an ordinary tool. */
async function enterShop(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TavernScene' && !window.__TEST__!.state().transitionActive); }
  finally { await page.keyboard.up('w'); }
  await teleport(page, 14, 10, 'left');
}

test('data policies reject indoor furniture outdoors in preview and commit, without rewriting old placements', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime modules.
    const { FURNITURE, furnitureAllowedInScene } = await import('/src/config/Furniture.ts');
    // @ts-expect-error Vite resolves browser runtime modules.
    const { ItemPlacementSystem } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Vite resolves browser runtime modules.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance, map = getMapData('FarmScene');
    const policies = Object.keys(FURNITURE).map(item => {
      gs.addItem(item, 1);
      const before = JSON.stringify(gs.toSaveData());
      const allowed = furnitureAllowedInScene(item, 'FarmScene');
      const preview = ItemPlacementSystem.canPlace(map, 60, 61, () => false, item);
      const commit = allowed ? null : ItemPlacementSystem.place(item, 'FarmScene', 60, 61);
      return { item, allowed, preview, commit, unchanged: before === JSON.stringify(gs.toSaveData()),
        indoors: furnitureAllowedInScene(item, 'TavernScene') };
    });
    const source = gs.toSaveData();
    source.placedItems = [{ item: 'table', scene: 'FarmScene', tx: 60, ty: 61, rotation: 0 }];
    const restored = GameState.candidateFromSaveData(source);
    const saved = restored.placedItems.map((item: unknown) => ({ ...(item as Record<string, unknown>) }));
    gs.placedItems = restored.placedItems;
    const pickedUp = ItemPlacementSystem.pickup('FarmScene', 60, 61);
    const replacedOutside = ItemPlacementSystem.place('table', 'FarmScene', 60, 61);
    return { policies, saved, pickedUp, replacedOutside };
  });
  for (const entry of result.policies) {
    const anywhere = ['chest', 'workbench'].includes(entry.item);
    expect(entry).toMatchObject({ allowed: anywhere, preview: anywhere, commit: anywhere ? null : false, unchanged: true, indoors: true });
  }
  expect(result).toMatchObject({ pickedUp: 'table', replacedOutside: false });
  expect(result.saved).toEqual([{ item: 'table', scene: 'FarmScene', tx: 60, ty: 61, rotation: 0 }]);
});

test('real digits equip a stack, hold places once, and fresh clicks continue until the belt slot empties', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootGame(page); await enterShop(page);
  await stockBelt(page, 'table', 3, 3);
  await page.keyboard.press('4');
  await expect.poll(async () => (await getState(page)).placingItem).toBe('table');
  expect((await getState(page)).inventoryOpen).toBe(false);
  await page.keyboard.press('r');
  expect((await getState(page)).placingRotation).toBe(1);
  await aimWorldTile(page, 10, 8);
  await page.keyboard.down('Space');
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(1);
  await aimWorldTile(page, 12, 8);
  await advanceFrames(page, 650);
  expect((await getState(page)).placedItems.length).toBe(1);
  expect((await getState(page)).inventory.table).toBe(2);
  await page.keyboard.up('Space');
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(2);
  expect((await getState(page)).placingRotation).toBe(1);
  await aimWorldTile(page, 16, 8);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(3);
  const state = await getState(page);
  expect(state.inventory.table).toBeUndefined();
  expect(state.toolbeltSlots[3]).toBeNull();
  expect(state.placingItem).toBeNull();
});

test('hotbar clicks never place through the HUD; cancel and tool changes clear the preview until reselected', async ({ page }) => {
  await bootGame(page); await teleport(page, 60, 60, 'down');
  await stockBelt(page, 'workbench', 2, 3);
  const hotbar = await uiCanvasPoint(page, { x: 291 + 3 * 48 + 21, y: 504 });
  await page.mouse.click(hotbar.x, hotbar.y);
  await expect.poll(async () => (await getState(page)).placingItem).toBe('workbench');
  expect((await getState(page)).placedItems).toEqual([]);
  await page.keyboard.press('Space');
  expect((await getState(page)).placedItems).toEqual([]);
  await aimWorldTile(page, 60, 62);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(1);
  await page.keyboard.press('e');
  await advanceFrames(page, 100);
  expect((await getState(page)).placingItem).toBeNull();
  await page.keyboard.press('4');
  await expect.poll(async () => (await getState(page)).placingItem).toBe('workbench');
  await page.keyboard.press('1');
  expect((await getState(page)).placingItem).toBeNull();
  expect((await getState(page)).inventory.workbench).toBe(1);
});

test('selected furniture follows slot mutations while inventory input cannot leak a placement', async ({ page }) => {
  await bootGame(page); await teleport(page, 60, 60, 'down');
  await stockBelt(page, 'workbench', 2, 0);
  await expect.poll(async () => (await getState(page)).placingItem).toBe('workbench');
  await aimWorldTile(page, 60, 62);
  await page.keyboard.press('i');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(true);
  await page.keyboard.down('Space');
  await page.keyboard.press('i');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(false);
  await advanceFrames(page, 300);
  expect((await getState(page)).placedItems).toEqual([]);
  await page.keyboard.up('Space');
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    InventoryLayoutSystem.moveOrSwap(GameState.instance, { container: 'toolbelt', index: 0 }, { container: 'toolbelt', index: 1 });
  });
  await expect.poll(async () => (await getState(page)).placingItem).toBeNull();
  expect((await getState(page)).inventory.workbench).toBe(2);
});

test('carrying a selected indoor table does not block the walk-in door', async ({ page }) => {
  await bootGame(page);
  await stockBelt(page, 'table', 1, 3);
  await page.keyboard.press('4');
  await expect.poll(async () => (await getState(page)).placingItem).toBe('table');
  await enterShop(page);
  expect((await getState(page)).placingItem).toBe('table');
  expect((await getState(page)).inventory.table).toBe(1);
  expect((await getState(page)).placedItems).toEqual([]);
});
