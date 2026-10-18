import { teleportAtFarmShop } from './helpers/gameHarness';
/** Authored furniture views preserve grid behavior; the interior viewport keeps exits above UI. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, teleport, aimWorldTile, getState, uiCanvasPoint, advanceFrames } from './helpers/gameHarness';

/** Walk through an actual doorway and wait for its input lock to end. */
async function travel(page: Page, key: string, scene: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(scene => window.__TEST__!.activeScene() === scene &&
      window.__TEST__!.ready && !window.__TEST__!.state().transitionActive, scene);
  } finally { await page.keyboard.up(key); }
}

/** Enter the inherited shop through normal movement; no direct scene start. */
async function enterShop(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 1, 'up');
  await travel(page, 'w', 'TavernScene');
}

for (const item of ['table', 'workbench']) {
  test(`${item} uses upright native views, reloads and works from its second tile`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootGame(page); await enterShop(page); await teleport(page, 14, 10, 'up');
    await page.evaluate(item => { window.__TEST__!.give(item, 1); window.__TEST__!.startPlacing(item); }, item);
    await aimWorldTile(page, 8, 8);
    await page.keyboard.press('r');
    await expect.poll(async () => (await getState(page)).placingRotation).toBe(1);
    const before = await page.evaluate(async item => {
      // @ts-expect-error Browser imports the actual Vite module, not a test duplicate.
      const { furnitureView } = await import('/src/config/Furniture.ts');
      const base = furnitureView(item, 0), turned = furnitureView(item, 1);
      const ghost = window.__GAME__!.scene.getScene('TavernScene').children.getByName('furniture-placement-preview') as Phaser.GameObjects.Image;
      const bounds = ghost.getBounds();
      return { sameTexture: base.texture === turned.texture, baseAngle: base.angle, viewAngle: turned.angle,
        angle: ghost.angle, scaleX: ghost.scaleX, scaleY: ghost.scaleY,
        width: bounds.width, height: bounds.height, bottom: bounds.bottom, centerX: bounds.centerX,
        sourceWidth: ghost.frame.realWidth, sourceHeight: ghost.frame.realHeight,
        baseWidth: base.displayW, baseHeight: base.displayH,
        turnedWidth: turned.displayW, turnedHeight: turned.displayH };
    }, item);
    // Jeff's latest direction reuses the table's source top; only workbenches use separate authored PNGs.
    expect(before).toMatchObject({ sameTexture: item === 'table', baseAngle: 0, viewAngle: 0, angle: 0,
      scaleX: 1, scaleY: 1, bottom: 160, centerX: 136 });
    expect(before.width).toBe(before.sourceWidth);
    expect(before.height).toBe(before.sourceHeight);
    expect(before.turnedWidth).toBeLessThan(before.baseWidth);
    expect(before.turnedHeight).toBeGreaterThan(before.baseHeight);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item, scene: 'TavernScene', tx: 8, ty: 8, rotation: 1 });
    const geometry = await page.evaluate(item => {
      const prop = window.__GAME__!.scene.getScene('TavernScene').children.getByName(`furniture-${item}-8-8`) as Phaser.Physics.Arcade.Image;
      const body = prop.body as Phaser.Physics.Arcade.StaticBody;
      return { angle: prop.angle, body: { x: body.x, y: body.y, w: body.width, h: body.height }, bounds: prop.getBounds() };
    }, item);
    expect(geometry.angle).toBe(0);
    expect(geometry.body).toEqual({ x: 128, y: 128, w: 16, h: 32 });
    expect(geometry.bounds.width).toBeCloseTo(before.width, 8);
    expect(geometry.bounds.height).toBeCloseTo(before.height, 8);
    for (const row of [8, 9]) {
      await teleport(page, 7, row, 'right');
      await page.keyboard.down('d'); await advanceFrames(page, 350); await page.keyboard.up('d');
      expect((await getState(page)).player.x, `solid footprint cell8,${row}`).toBeLessThanOrEqual(124.1);
    }
    await page.evaluate(async () => {
      // @ts-expect-error Browser imports the live save authority.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      SaveSystem.save(3, 999);
    });
    await page.goto('/?test=1&menu=1');
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TavernScene' && !window.__TEST__!.state().transitionActive);
    expect((await getState(page)).placedItems[0]).toMatchObject({ item, rotation: 1 });
    expect(await page.evaluate(item => (window.__GAME__!.scene.getScene('TavernScene').children
      .getByName(`furniture-${item}-8-8`) as Phaser.GameObjects.Image).angle, item)).toBe(0);
    if (item === 'workbench') {
      await teleport(page, 9, 9, 'left');
      await page.keyboard.press('e');
      await expect.poll(async () => (await getState(page)).craftingOpen).toBe(true);
      await page.keyboard.press('e');
      await expect.poll(async () => (await getState(page)).craftingOpen).toBe(false);
    }
    await teleport(page, 8, 10, 'up'); await page.mouse.move(0, 0);
    await page.keyboard.press('2'); await page.keyboard.press('Space');
    await expect.poll(async () => (await getState(page)).placedItems).toHaveLength(0);
    // Changing items must keep the reusable ghost's upright angle and bottom-center pivot.
    await page.evaluate(() => { window.__TEST__!.give('chair', 1); window.__TEST__!.startPlacing('chair'); });
    await aimWorldTile(page, 12, 9);
    expect(await page.evaluate(() => {
      const ghost = window.__GAME__!.scene.getScene('TavernScene').children.getByName('furniture-placement-preview') as Phaser.GameObjects.Image;
      return { angle: ghost.angle, x: ghost.originX, y: ghost.originY };
    })).toEqual({ angle: 0, x: 0.5, y: 1 });
  });
}

for (const density of [1, 2]) {
  test.describe(`interior clearance DPR${density}`, () => {
    test.use({ deviceScaleFactor: density });
    test('south exits stay above toolbar through resizing, bedroom travel and outdoor return', async ({ page }) => {
      await bootGame(page); await enterShop(page);
      for (const size of [{ width: 800, height: 500 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(size);
        await teleport(page, 14, 16, 'down'); await advanceFrames(page, 300);
        const clearance = await page.evaluate(() => {
          const game = window.__GAME__!, scene = game.scene.getScene('TavernScene');
          const camera = scene.cameras.main, ui = game.scene.getScene('UIScene').cameras.main;
          const top = ui.height / 2 + (477 - 270) * ui.zoom;
          const origin = camera.getWorldPoint(0, 0);
          const exitBottom = (18 * 16 - origin.y) * camera.zoom;
          return { viewportBottom: camera.y + camera.height, exitBottom, top, gap: 12 * ui.zoom, canvasHeight: game.scale.height };
        });
        expect(clearance.viewportBottom).toBeLessThanOrEqual(clearance.top - clearance.gap + 1);
        expect(clearance.exitBottom).toBeLessThanOrEqual(clearance.viewportBottom + 2);
        // Space still targets the pointer, so the non-world strip must explicitly reject it.
        await page.evaluate(() => { window.__TEST__!.give('table', 1); window.__TEST__!.startPlacing('table'); });
        const strip = await uiCanvasPoint(page, { x: 100, y: 530 });
        await page.mouse.move(strip.x, strip.y); await advanceFrames(page, 40);
        expect(await page.evaluate(() => (window.__GAME__!.scene.getScene('TavernScene').children
          .getByName('furniture-placement-preview') as Phaser.GameObjects.Image).visible)).toBe(false);
        await page.keyboard.press('Space');
        expect((await getState(page)).placedItems).toHaveLength(0);
        await page.keyboard.press('e');
      }
      await teleport(page, 22, 4, 'up'); await travel(page, 'w', 'BedroomScene');
      expect(await page.evaluate(() => {
        const game = window.__GAME__!;
        return game.scene.getScene('BedroomScene').cameras.main.height < game.scale.height;
      })).toBe(true);
      await teleport(page, 9, 11, 'down'); await travel(page, 's', 'TavernScene');
      await teleport(page, 14, 15, 'down'); await travel(page, 's', 'FarmScene');
      expect(await page.evaluate(() => {
        const game = window.__GAME__!;
        return game.scene.getScene('FarmScene').cameras.main.height === game.scale.height;
      })).toBe(true);
    });
  });
}
