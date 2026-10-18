/** Real-input coverage for the paused whole-world NPC route ledger. */
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, uiCanvasPoint } from './helpers/gameHarness';

/** Find and click one named Phaser control through the fitted UI camera. */
async function clickControl(page: Page, name: string): Promise<void> {
  const logical = await page.evaluate(controlName => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const descendants: Phaser.GameObjects.GameObject[] = [];
    const walk = (value: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      descendants.push(value);
      for (const child of value.list ?? []) walk(child as typeof value);
    };
    for (const child of scene.children.list) walk(child as typeof child);
    const control = descendants.find(value => value.name === controlName) as Phaser.GameObjects.Components.GetBounds | undefined;
    if (!control) throw new Error(`Missing route-map control ${controlName}`);
    const bounds = control.getBounds();
    return { x: bounds.centerX, y: bounds.centerY };
  }, name);
  const point = await uiCanvasPoint(page, logical);
  await page.mouse.click(point.x, point.y);
}

/** Read the serializable route-map inspection view exposed by its Phaser root. */
async function routeView(page: Page): Promise<import('../src/ui/WorldRoutesUI').WorldRoutesDebugView> {
  return page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('world-routes-map') as Phaser.GameObjects.Container;
    return root.getData('debugView');
  });
}

test('weekly atlas uses real routes, locates all residents, filters by click, and preserves the save', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.day = 4;
    GameState.instance.timeOfDay = 0;
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
  await page.screenshot({ path: testInfo.outputPath('world-routes-pause-entry-1280.png') });
  const before = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return JSON.stringify(GameState.instance.toSaveData());
  });
  await clickControl(page, 'pause-world-routes');
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  const monday = await routeView(page);
  expect(monday.selectedDay).toBe(4);
  expect(monday.dayLabel).toBe('Thursday');
  expect(monday.routes).toHaveLength(12);
  expect(new Set(monday.routes.map(route => route.color)).size).toBe(12);
  expect(monday.routes.every(route => route.visible && route.inside && route.pointCount > 1)).toBe(true);
  expect(monday.routes.every(route => Number.isFinite(route.marker.tx) && Number.isFinite(route.marker.ty))).toBe(true);
  expect(await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const values: Phaser.GameObjects.GameObject[] = [];
    const walk = (value: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      values.push(value); for (const child of value.list ?? []) walk(child as typeof value);
    };
    for (const child of scene.children.list) walk(child as typeof child);
    const portrait = values.find(value => value.name === 'world-route-portrait-nyra') as Phaser.GameObjects.Sprite;
    if (!portrait) throw new Error('Nyra route portrait is missing');
    return portrait.texture.key;
  })).toBe('town-resident-nyra');
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentRouteSnapshot } = await import('/src/systems/TownScheduleSystem.ts');
    const map = getMapData(SceneKey.Town);
    const first = residentRouteSnapshot('nyra', 4, 0, map);
    const expected = { ...first.path[0] };
    (first.path[0] as { tx: number }).tx = 999;
    const second = residentRouteSnapshot('nyra', 4, 0, map);
    return second.path[0].tx === expected.tx && second.path[0].ty === expected.ty
      && second.position.tx === expected.tx && second.position.ty === expected.ty;
  })).toBe(true);
  expect(await page.evaluate(async expected => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return JSON.stringify(GameState.instance.toSaveData()) === expected;
  }, before)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('world-routes-all-1280.png') });

  await page.evaluate(async () => {
    // Move only the test clock so the next redraw proves that pins follow the selected day's route.
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.timeOfDay = 510;
  });
  await clickControl(page, 'world-routes-day-next');
  const friday = await routeView(page);
  expect(friday.selectedDay).toBe(5);
  expect(friday.dayLabel).toBe('Friday');
  // The production schedule now has a real mix of indoor activities and outdoor travel at this time.
  expect(friday.routes.some(route => route.inside)).toBe(true);
  expect(friday.routes.some(route => !route.inside)).toBe(true);
  expect(friday.routes.some((route, index) => route.marker.tx !== monday.routes[index].marker.tx
    || route.marker.ty !== monday.routes[index].marker.ty)).toBe(true);
  await clickControl(page, 'world-route-legend-tessa');
  const isolated = await routeView(page);
  expect(isolated.isolatedResidentId).toBe('tessa');
  expect(isolated.routes.filter(route => route.visible).map(route => route.residentId)).toEqual(['tessa']);
  await page.screenshot({ path: testInfo.outputPath('world-routes-tessa-1280.png') });
  await clickControl(page, 'world-route-legend-tessa');
  expect((await routeView(page)).routes.every(route => route.visible)).toBe(true);

  await page.setViewportSize({ width: 800, height: 600 });
  const bounds = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('world-routes-map') as Phaser.GameObjects.Container;
    const values: Phaser.GameObjects.GameObject[] = [];
    const walk = (value: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      if (value.name.startsWith('world-route') && value.name !== 'world-routes-map'
        && value.name !== 'world-routes-map-layer' && value.name !== 'world-routes-legend') values.push(value);
      for (const child of value.list ?? []) walk(child as typeof value);
    };
    walk(root);
    const measured = values.filter(value => typeof (value as unknown as { getBounds?: unknown }).getBounds === 'function')
      .map(value => (value as unknown as Phaser.GameObjects.Components.GetBounds).getBounds());
    return { left: Math.min(...measured.map(value => value.left)), right: Math.max(...measured.map(value => value.right)),
      top: Math.min(...measured.map(value => value.top)), bottom: Math.max(...measured.map(value => value.bottom)) };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(960);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(540);
  await page.screenshot({ path: testInfo.outputPath('world-routes-all-800.png') });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene') as unknown as { worldRoutesUI: { isOpen: () => boolean } };
    return scene.worldRoutesUI.isOpen();
  })).toBe(false);
  expect((await getState(page)).paused).toBe(true);
  expect(errors).toEqual([]);
});
