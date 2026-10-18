/**
 * iPad touch controls. Runs at iPad landscape size with a real touchscreen, sending native touch
 * events through the Chrome DevTools Protocol so several fingers can be down at once (the joystick
 * thumb and the Use/Action thumb). Verifies:
 *  - desktop (no touch yet) never shows the controls, and the first touch turns them on,
 *  - the floating joystick walks the player and a lifted thumb stops them,
 *  - Use holds the tool while the other thumb steers, and releases on lift,
 *  - Bag / Menu open panels and the Menu button turns into a × Back button that closes them,
 *  - furniture placement: Rotate, Use places at the aimed tile, Action cancels,
 *  - the Mines swap in a Dodge button that starts a dodge roll.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { advanceFrames, bootGame, getState, teleport, teleportAtFarmShop, uiCanvasPoint, activeScene } from './helpers/gameHarness';

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

/** One finger for CDP: page CSS pixel position plus a stable id for the whole gesture. */
interface Finger { x: number; y: number; id: number }

/**
 * Send one native touch event. touchStart/touchMove take every finger still on the glass.
 * touchEnd takes the fingers that lift (Chromium ends only those); an empty list lifts every finger.
 */
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', fingers: Finger[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: fingers.map(f => ({ x: f.x, y: f.y, id: f.id, radiusX: 4, radiusY: 4, force: 1 })),
  });
}

/** Page-pixel center of a named UIScene object (logical UI coordinates mapped through the UI camera). */
async function controlPoint(page: Page, name: string): Promise<{ x: number; y: number }> {
  const logical = await page.evaluate((n) => {
    const obj = window.__GAME__!.scene.getScene('UIScene').children.getByName(n) as Phaser.GameObjects.Arc | null;
    if (!obj) throw new Error(`No UI object named ${n}`);
    return { x: obj.x, y: obj.y };
  }, name);
  return uiCanvasPoint(page, logical);
}

/** Whether a named UIScene object is currently shown. */
async function controlVisible(page: Page, name: string): Promise<boolean> {
  return page.evaluate((n) => {
    const obj = window.__GAME__!.scene.getScene('UIScene').children.getByName(n) as Phaser.GameObjects.Arc | null;
    if (!obj) throw new Error(`No UI object named ${n}`);
    return obj.visible;
  }, name);
}

/** Current text of a touch button's label. */
async function controlLabel(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const obj = window.__GAME__!.scene.getScene('UIScene').children.getByName(`${n}-label`) as Phaser.GameObjects.Text | null;
    if (!obj) throw new Error(`No UI label named ${n}-label`);
    return obj.text;
  }, name);
}

/** Read the shared InputBus hold flag the world scenes use for "Use is held". */
async function toolHeld(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime modules.
    const { InputBus } = await import('/src/input/InputBus.ts');
    return InputBus.instance.toolHeld as boolean;
  });
}

/** Tap one on-screen control with a single finger. */
async function tapControl(page: Page, cdp: CDPSession, name: string): Promise<void> {
  const p = await controlPoint(page, name);
  await touch(cdp, 'touchStart', [{ ...p, id: 1 }]);
  await advanceFrames(page, 80);
  await touch(cdp, 'touchEnd', []);
  await advanceFrames(page, 80);
}

/**
 * First touch of the session: a tap in the empty upper-middle of the screen (far out of tool reach),
 * which turns on touch mode just like a player's first tap.
 */
async function enableTouch(page: Page, cdp: CDPSession): Promise<void> {
  const p = await uiCanvasPoint(page, { x: 480, y: 120 });
  await touch(cdp, 'touchStart', [{ ...p, id: 9 }]);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(() => controlVisible(page, 'touch-use')).toBe(true);
}

/** Put a fixture stack in a toolbelt slot through the authoritative slot transaction. */
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

test('controls stay hidden until the first touch, then the joystick walks and Use holds with a second finger', async ({ page }) => {
  await bootGame(page);
  const cdp = await page.context().newCDPSession(page);
  await advanceFrames(page, 200);
  expect(await controlVisible(page, 'touch-use')).toBe(false);
  expect(await controlVisible(page, 'touch-menu')).toBe(false);
  await enableTouch(page, cdp);
  expect(await controlVisible(page, 'touch-action')).toBe(true);
  expect(await controlVisible(page, 'touch-bag')).toBe(true);
  expect(await controlLabel(page, 'touch-menu')).toBe('MENU');

  // Open ground on the farm so the walk is not blocked.
  await teleportAtFarmShop(page, 0, 4, 'down');
  await advanceFrames(page, 200);
  const start = (await getState(page)).player;
  const stick = await controlPoint(page, 'touch-stick-base');
  await touch(cdp, 'touchStart', [{ ...stick, id: 1 }]);
  await touch(cdp, 'touchMove', [{ x: stick.x + 70, y: stick.y, id: 1 }]);
  await advanceFrames(page, 600);
  const walked = (await getState(page)).player;
  expect(walked.x).toBeGreaterThan(start.x + 8);
  expect(walked.facing).toBe('right');

  // Second finger on Use while the first still steers.
  const use = await controlPoint(page, 'touch-use');
  await touch(cdp, 'touchStart', [{ x: stick.x + 70, y: stick.y, id: 1 }, { ...use, id: 2 }]);
  await advanceFrames(page, 120);
  expect(await toolHeld(page)).toBe(true);
  // Lift only the Use finger: the hold ends, the joystick keeps walking.
  await touch(cdp, 'touchEnd', [{ ...use, id: 2 }]);
  await advanceFrames(page, 120);
  expect(await toolHeld(page)).toBe(false);
  const stillWalking = (await getState(page)).player.x;
  await advanceFrames(page, 300);
  expect((await getState(page)).player.x).toBeGreaterThan(stillWalking);

  // Lift the joystick thumb: the player stops.
  await touch(cdp, 'touchEnd', []);
  await advanceFrames(page, 200);
  const stopped = (await getState(page)).player.x;
  await advanceFrames(page, 400);
  expect((await getState(page)).player.x).toBe(stopped);
});

test('Bag and Menu open panels, and the Menu button becomes a Back button that closes them', async ({ page }) => {
  await bootGame(page);
  const cdp = await page.context().newCDPSession(page);
  await enableTouch(page, cdp);

  await tapControl(page, cdp, 'touch-bag');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(true);
  expect(await controlVisible(page, 'touch-use')).toBe(false);
  expect(await controlLabel(page, 'touch-menu')).toBe('×');
  await tapControl(page, cdp, 'touch-menu');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(false);

  await tapControl(page, cdp, 'touch-menu');
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  expect(await controlLabel(page, 'touch-menu')).toBe('×');
  expect(await controlVisible(page, 'touch-bag')).toBe(false);
  await tapControl(page, cdp, 'touch-menu');
  await expect.poll(async () => (await getState(page)).paused).toBe(false);
  expect(await controlVisible(page, 'touch-use')).toBe(true);
});

test('furniture placement: Rotate turns the ghost, Use places, Action cancels', async ({ page }) => {
  await bootGame(page);
  const cdp = await page.context().newCDPSession(page);
  await enableTouch(page, cdp);
  // Walk into the shop through the real animated entrance (keyboard only for fixture travel).
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => window.__TEST__!.activeScene() === 'TavernScene' && !window.__TEST__!.state().transitionActive); }
  finally { await page.keyboard.up('w'); }
  await teleport(page, 14, 10, 'left');
  await stockBelt(page, 'table', 3, 3);

  // Tap the fourth toolbelt slot (slots are 42 px wide, centered, starting near x 291).
  const slot = await uiCanvasPoint(page, { x: 291 + 42 * 3 + 21, y: 510 });
  await touch(cdp, 'touchStart', [{ ...slot, id: 1 }]);
  await touch(cdp, 'touchEnd', []);
  await expect.poll(async () => (await getState(page)).placingItem).toBe('table');
  await advanceFrames(page, 100);
  expect(await controlVisible(page, 'touch-rotate')).toBe(true);
  expect(await controlLabel(page, 'touch-use')).toBe('PLACE');
  expect(await controlLabel(page, 'touch-action')).toBe('CANCEL');

  await tapControl(page, cdp, 'touch-rotate');
  expect((await getState(page)).placingRotation).toBe(1);

  const before = (await getState(page)).placedItems.length;
  await tapControl(page, cdp, 'touch-use');
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(before + 1);
  expect((await getState(page)).placingItem).toBe('table');

  await tapControl(page, cdp, 'touch-action');
  await expect.poll(async () => (await getState(page)).placingItem).toBe(null);
  expect(await controlVisible(page, 'touch-rotate')).toBe(false);
});

test('the Mines show a Dodge button that starts a dodge roll', async ({ page }) => {
  await bootGame(page);
  const cdp = await page.context().newCDPSession(page);
  await enableTouch(page, cdp);
  expect(await controlVisible(page, 'touch-dodge')).toBe(false);
  // Fixture travel: warp the chain Farm → Town → Mountain → Mines (same route as m16).
  await teleport(page, 98, 30, 'right');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('TownScene');
  await advanceFrames(page, 300);
  const road = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the current map in the live browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const warp = getMapData('TownScene').warps.find((w: { target: string }) => w.target === 'MountainScene');
    if (!warp) throw new Error('Town has no mine road');
    return { tx: warp.tx + Math.floor(warp.w / 2), ty: warp.ty + Math.floor(warp.h / 2) };
  });
  await teleport(page, road.tx, road.ty, 'up');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('MountainScene');
  await advanceFrames(page, 300);
  await teleport(page, 39, 12, 'up');
  await expect.poll(() => activeScene(page), { timeout: 15_000 }).toBe('MinesScene');
  // The world ignores input during the scene fade; tap only once it has finished.
  await page.waitForFunction(() => !window.__TEST__!.state().transitionActive);
  await advanceFrames(page, 300);

  // Face sideways: a dash facing up from the entrance reaches the ladder warp and leaves the Mines
  // (see m16-dungeon), which resets the combat timers this test reads.
  // (25, 4) is the Mines entrance tile m16-dungeon uses.
  await teleport(page, 25, 4, 'right');
  await advanceFrames(page, 100);
  expect(await controlVisible(page, 'touch-dodge')).toBe(true);
  expect((await getState(page)).dodgeCooldownMs).toBe(0);
  await tapControl(page, cdp, 'touch-dodge');
  await expect.poll(async () => (await getState(page)).dodgeCooldownMs).toBeGreaterThan(0);
});
