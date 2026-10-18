import { teleportAtFarmShop, farmLayout } from './helpers/gameHarness';
/** Real world furniture controls, native geometry and unobstructed room screenshots. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, teleport, getState, advanceFrames, uiCanvasPoint } from './helpers/gameHarness';

/** Reach the shop using actual movement through its animated entrance. */
async function enterShop(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready);
  await page.keyboard.up('w');
}

/** Convert a tile center through the world camera and canvas CSS bounds, including DPR2. */
async function worldCanvasPoint(page: Page, tx: number, ty: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ tx, ty }) => {
    const game = window.__GAME__!;
    const camera = game.scene.getScene(window.__TEST__!.activeScene()).cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    const bounds = game.canvas.getBoundingClientRect();
    return {
      x: bounds.x + ((tx + 0.5) * 16 - topLeft.x) * camera.zoom * bounds.width / game.scale.width,
      y: bounds.y + ((ty + 0.5) * 16 - topLeft.y) * camera.zoom * bounds.height / game.scale.height,
    };
  }, { tx, ty });
}

/** Aim the visible preview before pressing Space; keyboard confirmation keeps the mouse target. */
async function aimFurniture(page: Page, tx: number, ty: number): Promise<void> {
  await advanceFrames(page, 150);
  const point = await worldCanvasPoint(page, tx, ty);
  await page.mouse.move(point.x, point.y);
  await advanceFrames(page, 50);
}

test('walk-in door responds in the first visible frame and releases input within 450ms', async ({ page }) => {
  await bootGame(page); await teleportAtFarmShop(page, 0, 1, 'up');
  await page.evaluate(() => {
    const result = { start: 0, responseMs: -1, totalMs: -1, frames: [] as Array<{
      atMs: number; gapMs: number; world: string; locked: boolean; doorPhase: string | null;
    }> };
    (window as unknown as { entranceTiming: typeof result }).entranceTiming = result;
    let previousFrame = 0;
    /** Observe rendered frames across both scenes; no internal transition methods are called. */
    const sample = (): void => {
      const now = performance.now();
      const state = window.__TEST__!.state();
      if (state.transitionActive && result.start === 0) result.start = now;
      if (result.start > 0) {
        const farm = window.__GAME__!.scene.getScene('FarmScene');
        const door = farm.scene.isActive() ? farm.children.getByName('shop-door-leaf') : null;
        result.frames.push({ atMs: now - result.start, gapMs: previousFrame === 0 ? 0 : now - previousFrame,
          world: farm.scene.isActive() ? 'FarmScene' : 'TavernScene', locked: state.transitionActive,
          doorPhase: door ? door.getData('phase') as string : null });
        if (farm.scene.isActive()) {
          if (door && door.getData('leafWidth') !== 22 && result.responseMs < 0) result.responseMs = now - result.start;
        }
        if (!state.transitionActive && window.__GAME__!.scene.isActive('TavernScene')) {
          result.totalMs = now - result.start;
          return;
        }
      }
      previousFrame = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.down('w');
  await page.waitForFunction(() => (window as unknown as { entranceTiming: { totalMs: number } }).entranceTiming.totalMs >= 0);
  await page.keyboard.up('w');
  const timing = await page.evaluate(() => (window as unknown as { entranceTiming: { responseMs: number; totalMs: number } }).entranceTiming);
  // Preserve frame/phase evidence even when the strict response or wall-clock budget fails.
  await test.info().attach('door-timing.json', { body: JSON.stringify(timing), contentType: 'application/json' });
  expect(timing.responseMs).toBeGreaterThanOrEqual(0);
  expect(timing.responseMs).toBeLessThanOrEqual(80);
  expect(timing.totalMs).toBeLessThanOrEqual(450);
});

test('holding the place button never immediately breaks the newly placed furniture', async ({ page }) => {
  await bootGame(page); await enterShop(page); await teleport(page, 22, 8, 'down');
  await page.mouse.move(0, 0); await page.keyboard.press('2');
  await page.evaluate(() => { window.__TEST__!.give('chair', 1); window.__TEST__!.startPlacing('chair'); });
  await aimFurniture(page, 22, 9);
  await page.keyboard.down('Space'); await advanceFrames(page, 850);
  expect((await getState(page)).placedItems).toContainEqual({ item: 'chair', scene: 'TavernScene', tx: 22, ty: 9, rotation: 0 });
  // A fresh release/press in the same browser task is a new intent, even without a render between.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true }));
  });
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(0);
  await page.keyboard.up('Space');
});

test('inventory cancels rod charging without casting and held menu input cannot leak into the world', async ({ page }) => {
  await bootGame(page);
  const shore = await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as { map: { ground: string[][]; solid: boolean[][] } };
    for (let y = 34; y <= 52; y++) for (let x = 66; x <= 86; x++) {
      if (farm.map.ground[y][x] === 'water' && farm.map.ground[y - 1][x] !== 'water' && !farm.map.solid[y - 1][x]) return { tx: x, ty: y - 1 };
    }
    throw new Error('Expected a safe shore for the real rod-charge regression');
  });
  await teleport(page, shore.tx, shore.ty, 'down'); await page.keyboard.press('7');
  await page.keyboard.down('Space'); await advanceFrames(page, 150);
  await page.keyboard.press('i'); await advanceFrames(page, 100);
  expect((await getState(page)).inventoryOpen).toBe(true);
  expect((await getState(page)).fishing).toBeNull();
  expect(await page.evaluate(() => (window.__GAME__!.scene.getScene('FarmScene') as unknown as { castCharging: boolean }).castCharging)).toBe(false);
  await page.keyboard.up('Space'); await page.keyboard.press('i');
  await teleport(page, 60, 60, 'down'); await page.keyboard.press('1');
  await page.keyboard.press('i'); await page.keyboard.down('Space'); await advanceFrames(page, 80);
  await page.keyboard.press('i'); await advanceFrames(page, 180);
  expect((await getState(page)).inventoryOpen).toBe(false);
  expect((await getState(page)).tiles['60,61']).toBeUndefined();
  await page.keyboard.up('Space'); await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).tiles['60,61']).toBe('tilled');
});

test('R changes native preview and footprint; Space places, load preserves, and a second-tile axe pickup removes the entity', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page); await enterShop(page);
  await teleport(page, 22, 8, 'down');
  await page.mouse.move(0, 0);
  await page.evaluate(() => { window.__TEST__!.give('table', 1); window.__TEST__!.startPlacing('table'); });
  await aimFurniture(page, 22, 9);
  await page.keyboard.press('r');
  await advanceFrames(page, 80);
  expect((await getState(page)).placingRotation).toBe(1);
  const preview = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TavernScene');
    const ghost = scene.children.getByName('furniture-placement-preview') as Phaser.GameObjects.Image;
    const outline = scene.children.getByName('target-tile-highlight') as Phaser.GameObjects.Rectangle;
    return { frame: ghost.frame.name, texture: ghost.texture.key,
      native: ghost.displayWidth === ghost.frame.realWidth && ghost.displayHeight === ghost.frame.realHeight,
      visible: ghost.visible, outline: { width: outline.width, height: outline.height } };
  });
  // Connecting surfaces use a native runtime canvas, not the previous padding-crop frame.
  expect(preview).toEqual({ frame: '__BASE', texture: 'furniture-surface:TavernScene:preview',
    native: true, visible: true, outline: { width: 14, height: 30 } });
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item: 'table', scene: 'TavernScene', tx: 22, ty: 9, rotation: 1 });
  const geometry = await page.evaluate(() => {
    const prop = window.__GAME__!.scene.getScene('TavernScene').children.getByName('furniture-table-22-9') as Phaser.Physics.Arcade.Image;
    const body = prop.body as Phaser.Physics.Arcade.StaticBody;
    return { x: body.x, y: body.y, width: body.width, height: body.height, frame: prop.frame.name, texture: prop.texture.key };
  });
  expect(geometry).toEqual({ x: 352, y: 144, width: 16, height: 32, frame: '__BASE',
    texture: 'furniture-surface:TavernScene:table:22:9' });
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module in this browser.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    SaveSystem.save(3, 123);
  });
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__!.ready && window.__GAME__!.scene.isActive('TavernScene'));
  expect((await getState(page)).placedItems[0].rotation).toBe(1);
  await teleport(page, 22, 11, 'up');
  await page.keyboard.press('2'); await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).placedItems.length).toBe(0);
  expect(await page.evaluate(() => !!window.__GAME__!.scene.getScene('TavernScene').children.getByName('furniture-table-22-9'))).toBe(false);
  await page.keyboard.down('w'); await advanceFrames(page, 320); await page.keyboard.up('w');
  await expect.poll(async () => (await getState(page)).inventory.table).toBe(1);
  expect(errors).toEqual([]);
});

test('pointer preview and committed furniture share the exact remote grid tile', async ({ page }) => {
  await bootGame(page); await enterShop(page); await teleport(page, 22, 8, 'down');
  await page.evaluate(() => { window.__TEST__!.give('chair', 1); window.__TEST__!.startPlacing('chair'); });
  await advanceFrames(page, 200);
  const point = await worldCanvasPoint(page, 8, 9);
  await page.mouse.move(point.x, point.y); await advanceFrames(page, 100);
  const target = await page.evaluate(() => {
    const ghost = window.__GAME__!.scene.getScene('TavernScene').children.getByName('furniture-placement-preview') as Phaser.GameObjects.Image;
    return { x: ghost.x, y: ghost.y, texture: ghost.texture.key };
  });
  expect(target).toEqual({ x: 136, y: 160, texture: 'furniture-chair-south' });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item: 'chair', scene: 'TavernScene', tx: 8, ty: 9, rotation: 0 });
});

for (const density of [1, 2]) {
  test.describe(`remote placement at DPR${density}`, () => {
    test.use({ deviceScaleFactor: density, viewport: { width: 1440, height: 900 } });

    test('rotation, HUD shielding and invalid targets preserve exact pointer placement', async ({ page }) => {
      await bootGame(page); await enterShop(page); await teleport(page, 22, 8, 'down');
      await page.evaluate(() => { window.__TEST__!.give('table', 2); window.__TEST__!.startPlacing('table'); });
      await aimFurniture(page, 8, 8);
      await page.keyboard.press('r'); await advanceFrames(page, 50);
      const preview = await page.evaluate(() => {
        const scene = window.__GAME__!.scene.getScene('TavernScene');
        const ghost = scene.children.getByName('furniture-placement-preview') as Phaser.GameObjects.Image;
        const outline = scene.children.getByName('target-tile-highlight') as Phaser.GameObjects.Rectangle;
        return { x: ghost.x, y: ghost.y, visible: ghost.visible, width: outline.width, height: outline.height };
      });
      expect(preview).toEqual({ x: 136, y: 160, visible: true, width: 14, height: 30 });
      const target = await worldCanvasPoint(page, 8, 8);
      await page.mouse.click(target.x, target.y);
      await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item: 'table', scene: 'TavernScene', tx: 8, ty: 8, rotation: 1 });
      expect((await getState(page)).inventory.table).toBe(1);
      expect((await getState(page)).player).toMatchObject({ x: 360, y: 136, facing: 'down' });

      await page.evaluate(() => window.__TEST__!.startPlacing('table'));
      // The first slot spans x291–333; the paper starts at x285. Both must shield the world.
      // x280 is outside the visible panel and is intentionally not treated as a HUD target.
      for (const x of [312, 286]) {
        const hotbar = await uiCanvasPoint(page, { x, y: 505 });
        await page.mouse.move(hotbar.x, hotbar.y); await advanceFrames(page, 50);
        expect(await page.evaluate(() => (window.__GAME__!.scene.getScene('TavernScene').children
          .getByName('furniture-placement-preview') as Phaser.GameObjects.Image).visible)).toBe(false);
        await page.mouse.click(hotbar.x, hotbar.y); await page.keyboard.press('Space');
        await advanceFrames(page, 100);
        expect((await getState(page)).placedItems).toHaveLength(1);
        expect((await getState(page)).inventory.table).toBe(1);
      }

      // A full footprint cannot cover the keeper, another table, a stair solid, or either doorway.
      for (const tile of [{ tx: 22, ty: 8 }, { tx: 8, ty: 8 }, { tx: 26, ty: 4 }, { tx: 22, ty: 3 }, { tx: 14, ty: 15 }]) {
        await aimFurniture(page, tile.tx, tile.ty);
        const point = await worldCanvasPoint(page, tile.tx, tile.ty);
        await page.mouse.click(point.x, point.y); await advanceFrames(page, 60);
        expect((await getState(page)).placedItems).toHaveLength(1);
        expect((await getState(page)).inventory.table).toBe(1);
      }
      const modalTrace: unknown[] = [];
      /** Record actual modal and input ownership after each player action. */
      const traceModal = async (label: string): Promise<void> => {
        modalTrace.push(await page.evaluate((label) => {
          const gs = window.__TEST__!.state();
          const ui = window.__GAME__!.scene.getScene('UIScene');
          const panel = ui.children.getByName('inventory-panel') as Phaser.GameObjects.Container;
          const pointer = ui.input.activePointer;
          const point = ui.cameras.main.getWorldPoint(pointer.x, pointer.y);
          return { label, inventoryOpen: gs.inventoryOpen, visible: panel.visible, alpha: panel.alpha,
            point: { x: point.x, y: point.y }, placedItems: gs.placedItems,
            placingItem: gs.placingItem, hotbarIndex: gs.hotbarIndex };
        }, label));
      };
      await traceModal('before I');
      await page.keyboard.press('i');
      // I is queued by Phaser. The opening panel also fades from alpha0, when its backdrop can
      // receive clicks. Verify the actual visible bag before testing its shield, not elapsed time.
      await page.waitForFunction(() => {
        const panel = window.__GAME__!.scene.getScene('UIScene').children
          .getByName('inventory-panel') as Phaser.GameObjects.Container;
        return window.__TEST__!.state().inventoryOpen && panel.visible && panel.alpha === 1;
      });
      await traceModal('bag ready');
      const floor = await worldCanvasPoint(page, 10, 10);
      await page.mouse.click(floor.x, floor.y);
      await traceModal('after click');
      expect((await getState(page)).inventoryOpen).toBe(true);
      await page.keyboard.press('Space');
      await traceModal('after Space');
      await advanceFrames(page, 60);
      await traceModal('settled');
      await test.info().attach('modal-input-trace.json', { body: JSON.stringify(modalTrace), contentType: 'application/json' });
      expect((await getState(page)).inventoryOpen).toBe(true);
      expect((await getState(page)).placedItems).toHaveLength(1);
      expect((await getState(page)).inventory.table).toBe(1);
    });
  });
}

test('remote furniture rejects a keeper body straddling the neighboring tile, then permits cleared floor', async ({ page }) => {
  await bootGame(page); await enterShop(page);
  // Feet center x174 remains in column10, but the eight-pixel body extends into column11.
  await teleport(page, 10.375, 8, 'down');
  await page.evaluate(() => { window.__TEST__!.give('chair', 1); window.__TEST__!.startPlacing('chair'); });
  await aimFurniture(page, 11, 8);
  const geometry = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TavernScene') as unknown as { player: Phaser.Physics.Arcade.Sprite };
    const body = scene.player.body as Phaser.Physics.Arcade.Body;
    return { feetColumn: Math.floor(window.__TEST__!.state().player.x / 16), left: body.x, right: body.right };
  });
  expect(geometry.feetColumn).toBe(10);
  expect(geometry.left).toBeLessThan(176);
  expect(geometry.right).toBeGreaterThan(176);
  const blocked = await worldCanvasPoint(page, 11, 8);
  await page.mouse.click(blocked.x, blocked.y); await advanceFrames(page, 100);
  expect((await getState(page)).placedItems).toEqual([]);
  expect((await getState(page)).inventory.chair).toBe(1);
  await teleport(page, 20, 8, 'down'); await aimFurniture(page, 11, 8);
  const cleared = await worldCanvasPoint(page, 11, 8);
  await page.mouse.click(cleared.x, cleared.y);
  await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item: 'chair', scene: 'TavernScene', tx: 11, ty: 8, rotation: 0 });
});

test('remote furniture cannot occupy the Farm arrival tile outside the shop', async ({ page }) => {
  await bootGame(page); await teleportAtFarmShop(page, 0, 6, 'up');
  const { arrival } = await farmLayout(page);
  await page.evaluate(() => { window.__TEST__!.give('chair', 1); window.__TEST__!.startPlacing('chair'); });
  await aimFurniture(page, arrival.tx, arrival.ty);
  const point = await worldCanvasPoint(page, arrival.tx, arrival.ty);
  await page.mouse.click(point.x, point.y); await advanceFrames(page, 100);
  expect((await getState(page)).placedItems).toEqual([]);
  expect((await getState(page)).inventory.chair).toBe(1);
  expect((await getState(page)).placingItem).toBe('chair');
});

test('real HUD stays compact and the open room uses native surfaces at small and large browser sizes', async ({ page }) => {
  await bootGame(page); await enterShop(page);
  await teleport(page, 22, 12, 'up');
  for (const viewport of [{ width: 800, height: 500 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport); await advanceFrames(page, 220);
    expect(await page.locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    const surface = await page.evaluate(() => {
      const world = window.__GAME__!.scene.getScene('TavernScene');
      const ui = window.__GAME__!.scene.getScene('UIScene');
      const objective = ui.children.getByName('tavern-objective') as Phaser.GameObjects.Container;
      const background = objective.list[0] as Phaser.GameObjects.Rectangle;
      return { floor: !!world.children.getByName('interior-native-floor'), wall: !!world.children.getByName('interior-stone-wall'),
        objective: { x: objective.x, y: objective.y, visible: objective.visible, height: background.height },
        stairs: !!world.children.getByName('guest-only-stairs') };
    });
    expect(surface).toEqual({ floor: true, wall: true, stairs: true, objective: { x: 12, y: 88, visible: true, height: 25 } });
    await page.screenshot({ path: `output/playwright/interior-foundation/room-hud-${viewport.width}.png` });
  }
  await page.keyboard.press('j'); await advanceFrames(page, 50);
  expect(await page.evaluate(() => {
    const objective = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-objective') as Phaser.GameObjects.Container;
    return (objective.list[0] as Phaser.GameObjects.Rectangle).height;
  })).toBeGreaterThan(25);
  await page.keyboard.press('j');
});
