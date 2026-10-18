import { teleportAtFarmShop } from './helpers/gameHarness';
/** Build every service station through real menus and mouse placement, then cook and serve. */
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, give, teleport, uiCanvasPoint } from './helpers/gameHarness';

/** Hold a world key until its observable state changes, then release even if the assertion fails. */
async function keyUntil(page: Page, key: string, predicate: () => Promise<boolean>): Promise<void> {
  await page.keyboard.down(key);
  try { await expect.poll(predicate).toBe(true); }
  finally { await page.keyboard.up(key); }
}

/** Wait for actual menu rendering; state alone can change before the UI accepts its next key. */
async function panelVisible(page: Page, name: string, visible: boolean): Promise<void> {
  await page.waitForFunction(({ name, visible }) => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName(name) as unknown as { visible: boolean };
    return panel.visible === visible;
  }, { name, visible });
}

/** Wait for a crafting control to accept input, then click through the responsive UI camera. */
async function clickRecipeControl(page: Page, name: string): Promise<void> {
  // The opening frame sets visible before the fade leaves alpha zero. Phaser excludes that
  // parent and its children from hit testing until they can render; visible alone is not ready.
  await page.waitForFunction(name => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const root = scene.children.getByName('crafting-panel') as Phaser.GameObjects.Container;
    const control = root.getByName(name) as Phaser.GameObjects.Rectangle;
    if (!control) throw new Error(`Crafting control ${name} is missing`);
    const manager = scene.input.manager as unknown as {
      inputCandidate(object: Phaser.GameObjects.GameObject, camera: Phaser.Cameras.Scene2D.Camera): boolean;
    };
    return manager.inputCandidate(control, scene.cameras.main);
  }, name);
  const position = await page.evaluate(name => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('crafting-panel') as unknown as {
      list: Array<{ name: string; x: number; y: number }>;
    };
    const control = root.list.find(child => child.name === name);
    if (!control) throw new Error(`Crafting control ${name} is missing`);
    return { x: control.x, y: control.y };
  }, name);
  const point = await uiCanvasPoint(page, position);
  await page.mouse.click(point.x, point.y);
}

/** Select the actual backpack slot through arrows, release Space to place, and click remote floor. */
async function placeFromBag(page: Page, item: string, tx: number, ty: number): Promise<void> {
  if (!(await getState(page)).inventoryOpen) await keyUntil(page, 'i', async () => (await getState(page)).inventoryOpen);
  await panelVisible(page, 'inventory-panel', true);
  const index = (await getState(page)).backpackSlots.indexOf(item);
  expect(index, `${item} must occupy a real backpack slot`).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('ArrowDown'); // First downward move starts at backpack cell0.
  for (let offset = 0; offset < index; offset++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).placingItem).toBe(item);
  await panelVisible(page, 'inventory-panel', false);
  const pointer = await page.evaluate(({ tx, ty }) => {
    const game = window.__GAME__!;
    const camera = game.scene.getScene('TavernScene').cameras.main;
    const origin = camera.getWorldPoint(0, 0);
    const bounds = game.canvas.getBoundingClientRect();
    return {
      x: bounds.x + ((tx + 0.5) * 16 - origin.x) * camera.zoom * bounds.width / game.scale.width,
      y: bounds.y + ((ty + 0.5) * 16 - origin.y) * camera.zoom * bounds.height / game.scale.height,
    };
  }, { tx, ty });
  await page.mouse.move(pointer.x, pointer.y);
  const hudTargets = await page.evaluate(() => {
    const game = window.__GAME__!;
    const ui = game.scene.getScene('UIScene');
    return ui.input.hitTestPointer(ui.input.activePointer).map(object => object.name || object.type);
  });
  expect(hudTargets, `${item} placement must target visible floor, not a HUD control`).toEqual([]);
  await page.mouse.click(pointer.x, pointer.y);
  await expect.poll(async () => (await getState(page)).placedItems.some(placed =>
    placed.item === item && placed.scene === 'TavernScene' && placed.tx === tx && placed.ty === ty && placed.rotation === 0)).toBe(true);
  expect((await getState(page)).inventory[item]).toBeUndefined();
}

/** Approach a real station and wait for its owned menu, without invoking the station system. */
async function openStation(page: Page, tx: number, ty: number, kind: 'ledger' | 'kitchen'): Promise<void> {
  await teleport(page, tx, ty, 'up');
  await keyUntil(page, kind === 'ledger' ? 'm' : 'e', async () => (await getState(page)).tavernPanel === kind);
  await panelVisible(page, 'tavern-panel', true);
}

/** Close the station with actual input and wait until its pointer shield is gone. */
async function closeStation(page: Page): Promise<void> {
  await keyUntil(page, 'e', async () => (await getState(page)).tavernPanel === null);
  await panelVisible(page, 'tavern-panel', false);
}

test('an empty shop becomes a working business through bag crafting, recipe pockets and remote placement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // At1280×720 the3× camera crops the northwest floor beneath the task HUD when following
  // the southeast workbench. This viewport shows the whole room without bypassing HUD shielding.
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootGame(page);
  await teleportAtFarmShop(page, 0, 1, 'up');
  await keyUntil(page, 'w', async () => page.evaluate(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready));
  await expect.poll(async () => (await getState(page)).transitionActive).toBe(false);
  expect((await getState(page)).placedItems).toEqual([]);
  const fixed = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TavernScene') as unknown as { map: { objects: unknown[]; fixtures: unknown[] } };
    return { objects: scene.map.objects, fixtures: scene.map.fixtures };
  });
  expect(fixed).toEqual({ objects: [], fixtures: [] });

  // These are gathered-resource fixtures only. Every recipe and placement below uses native input.
  await give(page, 'wood', 57); await give(page, 'stone', 28);
  await keyUntil(page, 'i', async () => (await getState(page)).inventoryOpen);
  await panelVisible(page, 'inventory-panel', true);
  await page.keyboard.press('c');
  await expect.poll(async () => (await getState(page)).inventory.workbench).toBe(1);
  expect((await getState(page)).inventory.wood).toBe(42);
  await placeFromBag(page, 'workbench', 20, 12);

  // Verify both cells, not only the workbench anchor, open the same actual recipe book.
  await teleport(page, 20, 13, 'up');
  await keyUntil(page, 'e', async () => (await getState(page)).craftingOpen);
  await panelVisible(page, 'crafting-panel', true);
  await keyUntil(page, 'e', async () => !(await getState(page)).craftingOpen);
  await panelVisible(page, 'crafting-panel', false);
  await teleport(page, 21, 13, 'up');
  await keyUntil(page, 'e', async () => (await getState(page)).craftingOpen);
  await panelVisible(page, 'crafting-panel', true);
  for (const [item, wood, stone] of [['bar', 18, 24], ['register', 8, 20], ['stove', 0, 0]] as const) {
    await clickRecipeControl(page, `crafting-recipe-${item}`);
    await clickRecipeControl(page, 'crafting-confirm');
    await expect.poll(async () => (await getState(page)).inventory[item]).toBe(1);
    const inventory = (await getState(page)).inventory;
    expect(inventory.wood ?? 0).toBe(wood);
    expect(inventory.stone ?? 0).toBe(stone);
  }
  await keyUntil(page, 'e', async () => !(await getState(page)).craftingOpen);
  await panelVisible(page, 'crafting-panel', false);
  await placeFromBag(page, 'register', 5, 10);
  await placeFromBag(page, 'stove', 6, 5);
  await placeFromBag(page, 'bar', 14, 6);
  expect((await getState(page)).placedItems).toEqual([
    { item: 'workbench', scene: 'TavernScene', tx: 20, ty: 12, rotation: 0 },
    { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
    { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
    { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
  ]);

  await give(page, 'wood', 20); await give(page, 'stone', 10);
  await openStation(page, 5, 11, 'ledger');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).tavern.level).toBe(1);
  let state = await getState(page);
  expect(state.inventory.wood).toBeUndefined(); expect(state.inventory.stone).toBeUndefined();
  expect(state.inventory.stew).toBe(4); expect(state.gold).toBe(0);
  await closeStation(page);
  await give(page, 'parsnip', 1);
  await openStation(page, 6, 6, 'kitchen');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).inventory.stew).toBe(8);
  expect((await getState(page)).inventory.parsnip).toBeUndefined();
  await closeStation(page);
  await openStation(page, 5, 11, 'ledger');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).tavern.tavernOpen).toBe(true);
  await closeStation(page);
  await expect.poll(async () => (await getState(page)).tavern.guests.some(guest => guest.kind === 'tavern' && guest.phase === 'waiting' && guest.product === 'food' && guest.destinationId.startsWith('bar:')), { timeout: 30000 }).toBe(true);
  await page.evaluate(async () => {
    // @ts-expect-error Slot fixture only; selection and serving remain native keyboard actions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Slot fixture only; use the actual inventory transaction.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance, slot = InventoryLayoutSystem.findEntrySlot(gs, 'stew');
    if (!slot) throw new Error('Cooked stew must occupy an inventory slot');
    InventoryLayoutSystem.moveOrSwap(gs, slot, { container: 'toolbelt', index: 5 });
  });
  await page.keyboard.press('6');
  const order = (await getState(page)).tavern.guests.find(guest => guest.phase === 'waiting' && guest.product === 'food' && guest.destinationId.startsWith('bar:'));
  if (!order) throw new Error('Expected a waiting bar food order');
  await teleport(page, Number(order.destinationId.slice(4).split(',')[0]), 5, 'down');
  const canServe = await page.evaluate(async () => {
    // @ts-expect-error Read-only precondition; the actual sale is made only by E below.
    const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
    return TavernSystem.canInteract('counter');
  });
  expect(canServe).toBe(true);
  await keyUntil(page, 'e', async () => (await getState(page)).gold === 12);
  state = await getState(page);
  expect(state.tavern).toMatchObject({ servedToday: 1, totalServed: 1, revenue: 12 });
  expect(state.inventory.stew).toBe(7);
  expect(state.gold).toBe(12);
  expect(errors).toEqual([]);
});
