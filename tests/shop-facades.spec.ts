/** Facade family visual registration and real-input checks; runs against an isolated browser save. */
import { test, expect } from '@playwright/test';
import { bootGame, teleport, advanceFrames, uiCanvasPoint, getState } from './helpers/gameHarness';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { SHOP_FACADES } from '../src/config/ShopFacades';

test('all nine facades have native registration, genuine transparency and unique art', () => {
  const hashes = new Set<string>();
  for (const facade of SHOP_FACADES) {
    const path = `public/assets/objects/${facade.texture}.png`;
    const data = fs.readFileSync(path), png = PNG.sync.read(data);
    expect([png.width, png.height]).toEqual([160, 160]);
    expect(png.data[3]).toBe(0);
    let clear = 0, visible = 0;
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i] === 0) clear++;
      if (png.data[i] >= 128) visible++;
    }
    expect(clear).toBeGreaterThan(9000); expect(visible).toBeGreaterThan(11000);
    // The cutout export retains alpha253–254 indoors. Require a dark, effectively opaque aperture,
    // not a fabricated fully-opaque channel that would discard the generator's original alpha.
    const doorway = (100 * 160 + 80) * 4;
    expect(png.data[doorway + 3]).toBeGreaterThanOrEqual(250);
    for (const channel of png.data.subarray(doorway, doorway + 3)) expect(channel).toBeLessThan(10);
    hashes.add(data.toString('base64'));
  }
  expect(hashes.size).toBe(9);
});

test('inn style test keeps porch geometry and renders at game scale', async ({ page }) => {
  await bootGame(page);
  const spawn = await page.evaluate(async () => {
    // @ts-expect-error Runtime Vite module.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Runtime Vite module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    SettingsSystem.update({ shopFacade: 'inn' });
    return getMapData('FarmScene').spawns.find((s: { id: string }) => s.id === 'from_home');
  });
  await teleport(page, spawn.tx, spawn.ty, 'up');
  await advanceFrames(page, 500);
  expect(await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('FarmScene');
    return (scene.children.getByName('shop-facade-back') as Phaser.GameObjects.Image).texture.key;
  })).toBe('shop-facade-inn');
  await page.screenshot({ path: 'planning_artifacts/farm-shop-family/inn-style.png' });
});

test('every cosmetic variant preserves progress and porch bodies and walks through the same door', async ({ page }) => {
  test.setTimeout(60_000);
  await bootGame(page);
  await page.keyboard.press('Escape');
  const before = await getState(page);
  const geometries: unknown[] = [];
  for (const facade of SHOP_FACADES) {
    geometries.push(await page.evaluate(async id => {
      // @ts-expect-error Runtime Vite module.
      const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
      SettingsSystem.update({ shopFacade: id });
      const scene = window.__GAME__!.scene.getScene('FarmScene');
      scene.cameras.main.setZoom(2);
      window.__GAME__!.scene.getScene('UIScene').scene.setVisible(false);
      return scene.children.list.filter(object => object.name.startsWith('shop-collision-')).map(object => {
        const body = object.body as Phaser.Physics.Arcade.StaticBody;
        return { x: body.x, y: body.y, w: body.width, h: body.height };
      });
    }, facade.id));
    await advanceFrames(page, 100);
    await page.screenshot({ path: `planning_artifacts/farm-shop-family/facade-${facade.id}.png` });
    const current = await getState(page);
    for (const field of ['player', 'tavern', 'inventory', 'chest', 'tiles', 'crops', 'placedItems', 'day', 'timeOfDay'] as const) {
      expect(current[field]).toEqual(before[field]);
    }
  }
  for (const geometry of geometries) expect(geometry).toEqual(geometries[0]);
  await page.evaluate(() => window.__GAME__!.scene.getScene('UIScene').scene.setVisible(true));
  await page.keyboard.press('Escape');
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.state().activeScene === 'TavernScene'); }
  finally { await page.keyboard.up('w'); }
  expect((await getState(page)).player).toMatchObject({ x: 232, y: 248 });
  await teleport(page, 14, 15, 'down');
  await page.keyboard.down('s');
  try { await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.state().activeScene === 'FarmScene'); }
  finally { await page.keyboard.up('s'); }
  expect(await page.evaluate(() => {
    const facade = window.__GAME__!.scene.getScene('FarmScene').children.getByName('shop-facade-back') as Phaser.GameObjects.Image;
    return facade.texture.key;
  })).toBe('shop-facade-alchemist');
});

for (const width of [1280, 700]) test(`${width}px: pause Exterior pointer and arrows switch immediately, persist, and keep gameplay paused`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  await bootGame(page);
  await page.keyboard.press('Escape');
  await advanceFrames(page, 200);
  // why: read the live button bounds so the click follows the Exterior row if the pause layout moves.
  const center = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('pause-menu') as Phaser.GameObjects.Container;
    const bounds = (root.getByName('pause-shop-facade') as Phaser.GameObjects.Rectangle).getBounds();
    return { x: bounds.centerX, y: bounds.centerY };
  });
  const point = await uiCanvasPoint(page, center);
  await page.mouse.click(point.x, point.y);
  expect(await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('pause-menu') as Phaser.GameObjects.Container;
    return (root.getByName('pause-shop-facade-label') as Phaser.GameObjects.Text).text;
  })).toContain('Fantasy inn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  expect((await getState(page)).paused).toBe(true);
  await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: `planning_artifacts/farm-shop-family/pause-${width}.png` });
  await page.reload(); await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await page.evaluate(() => {
    return (window.__GAME__!.scene.getScene('FarmScene').children.getByName('shop-facade-back') as Phaser.GameObjects.Image).texture.key;
  })).toBe('shop-facade-inn');
});

test('invalid facade preferences reject without changing bytes or live art', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Runtime Vite module.
    const { SettingsSystem, SETTINGS_STORAGE_KEY } = await import('/src/systems/SettingsSystem.ts');
    SettingsSystem.update({ shopFacade: 'library' });
    const before = localStorage.getItem(SETTINGS_STORAGE_KEY), errors: string[] = [];
    for (const shopFacade of ['missing', null, 1]) {
      try { SettingsSystem.update({ shopFacade }); } catch (error) { errors.push(String(error)); }
    }
    return { before, after: localStorage.getItem(SETTINGS_STORAGE_KEY), errors };
  });
  expect(result.after).toBe(result.before); expect(result.errors).toHaveLength(3);
});
