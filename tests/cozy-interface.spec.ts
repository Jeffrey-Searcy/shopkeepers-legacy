/** Real-input wardrobe, save migration, viewport and storage regressions for the cozy UI pass. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, uiCanvasPoint, advanceFrames, teleport, give, aimWorldTile } from './helpers/gameHarness';

/** Enter the editor through the real third pause option; never call the editor directly. */
async function openEditor(page: Page): Promise<void> {
  if (!(await getState(page)).paused) await page.keyboard.press('Escape');
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  const logical = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const root = scene.children.getByName('pause-menu') as Phaser.GameObjects.Container;
    const options = root.getAll().find(value => value instanceof Phaser.GameObjects.Container) as Phaser.GameObjects.Container;
    const button = options.getByName('pause-option-2') as Phaser.GameObjects.Rectangle;
    if (!button) throw new Error('Missing Appearance pause option');
    const bounds = button.getBounds();
    return { x: bounds.centerX, y: bounds.centerY };
  });
  const point = await uiCanvasPoint(page, logical);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await getState(page)).appearanceEditorOpen).toBe(true);
}

/** Click one named canvas control by its actual world bounds and UI camera transform. */
async function clickNamed(page: Page, name: string): Promise<void> {
  const logical = await page.evaluate(name => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const root = scene.children.getByName('appearance-editor') as Phaser.GameObjects.Container;
    const object = root.getByName(name) as Phaser.GameObjects.Rectangle;
    if (!object) throw new Error(`Missing editor control ${name}`);
    return { x: object.x, y: object.y };
  }, name);
  const point = await uiCanvasPoint(page, logical);
  await page.mouse.click(point.x, point.y);
}

test('keyboard opens editor once; draft, Escape and Cancel preserve live appearance and frozen world', async ({ page }) => {
  await bootGame(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).appearanceEditorOpen).toBe(true);
  const before = await getState(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('d'); await advanceFrames(page, 300); await page.keyboard.up('d');
  const draft = await getState(page);
  expect(draft.appearance).toEqual(before.appearance);
  expect(draft.player).toEqual(before.player);
  expect(draft.timeOfDay).toBe(before.timeOfDay);
  await page.keyboard.press('Escape');
  expect((await getState(page)).appearanceEditorOpen).toBe(false);
  expect((await getState(page)).paused).toBe(true);
  await openEditor(page);
  await clickNamed(page, 'appearance-hat-next');
  await clickNamed(page, 'appearance-cancel');
  expect((await getState(page)).appearance).toEqual(before.appearance);
  expect((await getState(page)).paused).toBe(true);
});

test('Apply changes real player texture, survives save reload, and preview covers each facing/action', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this module to the browser.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    SaveSystem.beginNewGame(1);
  });
  await openEditor(page);
  for (const field of ['body', 'hairStyle', 'hat', 'facialHair', 'shirtStyle', 'garment', 'pantsStyle', 'eyeColor', 'skinTone', 'hairColor', 'shirtColor', 'pantsColor']) {
    await clickNamed(page, `appearance-${field}-next`);
  }
  for (let pose = 0; pose < 8; pose++) {
    await clickNamed(page, 'appearance-pose');
    for (let facing = 0; facing < 4; facing++) await clickNamed(page, `appearance-direction-${facing}`);
  }
  await clickNamed(page, 'appearance-apply');
  const applied = await getState(page);
  expect(applied.appearance).toMatchObject({ body: 'feminine', hairStyle: 'tousled', hat: 'knit', facialHair: 'mustache', shirtStyle: 'tee',
    garment: 'apron', pantsStyle: 'cuffed', eyeColor: 'brown' });
  expect(applied.appearanceEditorOpen).toBe(false);
  expect(applied.paused).toBe(true);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite module.
    const { GameState } = await import('/src/state/GameState.ts');
    const player = (window.__GAME__!.scene.getScene('FarmScene') as unknown as { player: Phaser.GameObjects.Sprite }).player;
    const texture = player.texture.key;
    SaveSystem.saveCurrent(123);
    const envelope = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    GameState.reset(); SaveSystem.load(1);
    return { texture, version: envelope.version, appearance: GameState.instance.appearance };
  });
  expect(result.texture).toContain('-appearance-active');
  expect(result.version).toBe(30); // Current saves keep the existing appearance data unchanged.
  expect(result.appearance).toEqual(applied.appearance);
});

test('legacy v1/v2 migration is explicit; corrupt v3 rejects without changing state or slot', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite module. Historical envelopes require the historical tavern shape.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const state = GameState.instance.toSaveData();
    const migrated = [];
    for (const version of [1, 2]) {
      const legacy = { ...state, tavern: createLegacyTavernState() } as Record<string, unknown>;
      delete legacy.appearance; if (version === 1) delete legacy.tavern;
      localStorage.setItem(SaveSystem.storageKey(version), JSON.stringify({ version, slot: version, savedAt: 1, state: legacy }));
      SaveSystem.load(version); migrated.push({ ...GameState.instance.appearance });
    }
    const before = JSON.stringify(GameState.instance.toSaveData());
    const errors = [];
    for (const appearance of [undefined, {}, { ...state.appearance, hat: 'unknown' }]) {
      localStorage.setItem(SaveSystem.storageKey(3), JSON.stringify({ version: 3, slot: 3, savedAt: 1,
        state: { ...state, tavern: createLegacyTavernState(), appearance } }));
      try { SaveSystem.load(3); } catch (error) { errors.push(String(error)); }
    }
    return { migrated, errors, unchanged: before === JSON.stringify(GameState.instance.toSaveData()), slot: SaveSystem.currentSlot() };
  });
  expect(result.migrated[0]).toEqual(result.migrated[1]);
  expect(result.migrated[0].hat).toBe('none');
  expect(result.errors).toHaveLength(3);
  expect(result.unchanged).toBe(true); expect(result.slot).toBe(2);
});

test('v20 wardrobes load as the original body with no outerwear or facial hair; incomplete v21 wardrobes reject', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite module.
    const { GameState } = await import('/src/state/GameState.ts');
    const state = GameState.instance.toSaveData();
    // A v20 save holds the nine older fields only, here with a non-default look that must survive the upgrade.
    const nine = { hairStyle: 'bob', hat: 'straw', shirtStyle: 'tee', pantsStyle: 'cuffed', eyeColor: 'green',
      skinTone: state.appearance.skinTone, hairColor: state.appearance.hairColor,
      shirtColor: state.appearance.shirtColor, pantsColor: state.appearance.pantsColor };
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 20, slot: 2, savedAt: 1, state: { ...state, appearance: nine } }));
    SaveSystem.load(2);
    const migrated = { ...GameState.instance.appearance };
    const notice = SaveSystem.consumeMigrationNotice();
    const before = JSON.stringify(GameState.instance.toSaveData());
    const errors = [];
    for (const field of ['body', 'garment', 'facialHair']) {
      const appearance = { ...state.appearance, body: 'feminine', garment: 'robe', facialHair: 'beard' } as Record<string, unknown>;
      delete appearance[field];
      localStorage.setItem(SaveSystem.storageKey(3), JSON.stringify({ version: 21, slot: 3, savedAt: 1, state: { ...state, appearance } }));
      try { SaveSystem.load(3); } catch (error) { errors.push(String(error)); }
    }
    return { nine, migrated, notice, errors, unchanged: before === JSON.stringify(GameState.instance.toSaveData()), slot: SaveSystem.currentSlot() };
  });
  expect(result.migrated).toEqual({ ...result.nine, body: 'original', garment: 'none', facialHair: 'none' });
  expect(result.notice).toContain('second body shape');
  expect(result.errors).toHaveLength(3);
  expect(result.unchanged).toBe(true); expect(result.slot).toBe(2);
});

test('resize keeps wardrobe pointer controls aligned and all canvas edges fill the viewport', async ({ page }) => {
  await bootGame(page);
  await openEditor(page);
  for (const viewport of [{ width: 800, height: 500 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1080 }]) {
    await page.setViewportSize(viewport); await advanceFrames(page, 180);
    const bounds = await page.locator('canvas').boundingBox();
    expect(bounds).toEqual({ x: 0, y: 0, ...viewport });
    const previous = await page.evaluate(() => {
      const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as { appearanceUI: { draft: { hat: string } } };
      return ui.appearanceUI.draft.hat;
    });
    await clickNamed(page, 'appearance-hat-next');
    expect(await page.evaluate(() => {
      const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as { appearanceUI: { draft: { hat: string } } };
      return ui.appearanceUI.draft.hat;
    })).not.toBe(previous);
    expect((await getState(page)).appearanceEditorOpen).toBe(true);
    await page.screenshot({ path: `output/playwright/cozy-review/appearance-${viewport.width}.png` });
  }
  await clickNamed(page, 'appearance-cancel');
  expect((await getState(page)).appearance.hat).toBe('none');
});

test('storage keyboard navigation never moves player or opens a hidden inventory', async ({ page }) => {
  await bootGame(page);
  await give(page, 'chest', 1); await give(page, 'wood', 5);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, 60, 61);
  await page.evaluate(() => window.__TEST__!.input('use-tool'));
  await advanceFrames(page, 150); await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).chestOpen).toBe(true);
  await advanceFrames(page, 100);
  const before = await getState(page);
  await page.keyboard.press('Tab');
  await page.keyboard.down('ArrowRight'); await advanceFrames(page, 300); await page.keyboard.up('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const moved = await getState(page);
  expect(moved.inventoryOpen).toBe(false); expect(moved.player).toEqual(before.player);
  expect(moved.chest.wood).toBe(5);
  await page.screenshot({ path: 'output/playwright/cozy-review/storage-round1.png' });
  await page.keyboard.press('e'); expect((await getState(page)).chestOpen).toBe(false);
});

test('world mouse targeting uses the world camera after each viewport resize', async ({ page }) => {
  await bootGame(page);
  let tx = 60;
  for (const viewport of [{ width: 800, height: 500 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await teleport(page, tx, 60, 'down'); await advanceFrames(page, 800);
    const target = await page.evaluate(tx => {
      const cam = window.__GAME__!.scene.getScene('FarmScene').cameras.main;
      return { x: cam.x + (tx * 16 + 24 - cam.worldView.x) * cam.zoom, y: cam.y + (60 * 16 + 8 - cam.worldView.y) * cam.zoom };
    }, tx);
    await page.mouse.move(target.x, target.y); await page.mouse.down(); await advanceFrames(page, 160); await page.mouse.up();
    await expect.poll(async () => (await getState(page)).tiles[`${tx + 1},60`]).toBe('tilled');
    expect((await getState(page)).player.facing).toBe('right');
    tx += 3;
  }
});

test('failed Apply keeps the editor open with an explicit error and unchanged live appearance', async ({ page }) => {
  await bootGame(page); await openEditor(page);
  const before = (await getState(page)).appearance;
  await clickNamed(page, 'appearance-hat-next');
  await page.evaluate(async () => {
    // @ts-expect-error Vite module.
    const { AppearanceTextureSystem } = await import('/src/systems/AppearanceTextureSystem.ts');
    AppearanceTextureSystem.forGame(window.__GAME__!).prepareActive = (): never => { throw new Error('Outfit upload failed'); };
  });
  await clickNamed(page, 'appearance-apply');
  const after = await getState(page);
  expect(after.appearance).toEqual(before); expect(after.appearanceEditorOpen).toBe(true); expect(after.paused).toBe(true);
  expect(await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as { appearanceUI: { status: { text: string } } };
    return ui.appearanceUI.status.text;
  })).toBe('Outfit upload failed');
});

test('WebGL keyboard Apply commits the edited outfit instead of reopening the pause option', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready);
  await openEditor(page);
  // Rows run body, hair, hat: one step right on each gives the feminine body, tousled hair and a knit cap.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).appearanceEditorOpen).toBe(false);
  expect((await getState(page)).appearance).toMatchObject({ body: 'feminine', hairStyle: 'tousled', hat: 'knit' });
  await page.keyboard.press('Escape');
  await page.keyboard.down('ArrowRight'); await advanceFrames(page, 250); await page.keyboard.up('ArrowRight');
  await advanceFrames(page, 250);
  const texture = await page.evaluate(() => {
    const world = window.__GAME__!.scene.getScene('FarmScene') as unknown as { player: Phaser.GameObjects.Sprite };
    return world.player.texture.key;
  });
  expect(texture).toBe('player-navigation-appearance-active');
  await page.screenshot({ path: 'output/playwright/cozy-review/wardrobe-live-webgl.png' });
  expect(errors).toEqual([]);
});
