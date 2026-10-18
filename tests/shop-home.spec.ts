import { teleportAtFarmShop, farmLayout } from './helpers/gameHarness';
/** Real-input shop porch, guarded animated travel, and private bedroom save regressions. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, teleport, advanceFrames, uiCanvasPoint } from './helpers/gameHarness';

/** Browser-local evidence that every DOM input reaches the normal listener while travel owns input. */
interface DoorInputProbe {
  samples: number[];
  inputs: Array<{ name: string; atMs: number; lockedBefore: boolean; lockedAfter: boolean }>;
  burstDone: boolean;
}

/** Hold a real movement key until the destination has finished its arrival fade; always release it. */
async function walkThrough(page: Page, key: string, target: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(target => window.__GAME__!.scene.isActive(target) && window.__TEST__!.ready, target);
  } finally { await page.keyboard.up(key); }
  expect((await getState(page)).activeScene).toBe(target);
  expect((await getState(page)).transitionActive).toBe(false);
}

/** Enter from the actual steps, leaving room for the player to cross the porch and door sill. */
async function enterShop(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 3, 'up');
  await walkThrough(page, 'w', 'TavernScene');
}

/** Use the separate rear doorway, not the guest stair recess. */
async function enterBedroom(page: Page): Promise<void> {
  await teleport(page, 22, 4, 'up');
  await walkThrough(page, 'w', 'BedroomScene');
}

test('ten real walk-in round trips never need E, bounce, lose the player, or duplicate a transition', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page);
  const before = await getState(page);
  const { arrival } = await farmLayout(page);
  for (let trip = 0; trip < 10; trip++) {
    await enterShop(page);
    expect((await getState(page)).player).toMatchObject({ x: 232, y: 248 });
    await teleport(page, 14, 15, 'down');
    await walkThrough(page, 's', 'FarmScene');
    await advanceFrames(page, 180);
    expect((await getState(page)).activeScene).toBe('FarmScene');
    expect((await getState(page)).player).toMatchObject({ x: arrival.tx * 16 + 8, y: arrival.ty * 16 + 8 });
    expect(await page.evaluate(() => {
      const door = window.__GAME__!.scene.getScene('FarmScene').children.getByName('shop-door-leaf');
      if (!door) throw new Error('Farm is missing its door');
      return door.getData('phase');
    })).toBe('closed');
  }
  expect((await getState(page)).day).toBe(before.day);
  expect(errors).toEqual([]);
});

test('door has visible discrete frames and owns DOM keyboard, wheel and hotbar input delivered during travel', async ({ page }) => {
  await bootGame(page);
  await teleportAtFarmShop(page, 0, 1, 'up');
  const slot = await uiCanvasPoint(page, { x: 380, y: 505 });
  const before = await getState(page);
  await page.evaluate(slot => {
    const probe: DoorInputProbe = { samples: [], inputs: [], burstDone: false };
    (window as unknown as { doorInputProbe: DoorInputProbe }).doorInputProbe = probe;
    /** Use browser DOM listeners, never game-private actions, without protocol round trips between inputs. */
    const deliver = (name: string, target: EventTarget, event: Event): void => {
      const sample = { name, atMs: performance.now(), lockedBefore: window.__TEST__!.state().transitionActive,
        lockedAfter: false };
      target.dispatchEvent(event);
      sample.lockedAfter = window.__TEST__!.state().transitionActive;
      probe.inputs.push(sample);
    };
    /** Observe the actual door and send the whole burst on the first locked browser frame. */
    const observe = (): void => {
      const farm = window.__GAME__!.scene.getScene('FarmScene');
      if (!farm.scene.isActive()) return;
      const door = farm.children.getByName('shop-door-leaf');
      if (!door) throw new Error('Farm is missing its door');
      probe.samples.push(door.getData('leafWidth'));
      if (!probe.burstDone && window.__TEST__!.state().transitionActive) {
        probe.burstDone = true;
        const canvas = window.__GAME__!.canvas;
        const mouse = { bubbles: true, cancelable: true, view: window, clientX: slot.x, clientY: slot.y, button: 0 };
        deliver('mousemove', canvas, new MouseEvent('mousemove', { ...mouse, buttons: 0 }));
        for (const key of [
          { key: 'Escape', code: 'Escape', keyCode: 27 }, { key: 'i', code: 'KeyI', keyCode: 73 },
          { key: '3', code: 'Digit3', keyCode: 51 }, { key: ' ', code: 'Space', keyCode: 32 },
        ]) {
          deliver(`${key.code}:down`, window, new KeyboardEvent('keydown', { ...key, which: key.keyCode, bubbles: true, cancelable: true }));
          deliver(`${key.code}:up`, window, new KeyboardEvent('keyup', { ...key, which: key.keyCode, bubbles: true, cancelable: true }));
        }
        deliver('wheel', canvas, new WheelEvent('wheel', { ...mouse, deltaY: 120, deltaMode: 0 }));
        deliver('mousedown', canvas, new MouseEvent('mousedown', { ...mouse, buttons: 1 }));
        deliver('mouseup', canvas, new MouseEvent('mouseup', { ...mouse, buttons: 0 }));
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }, slot);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready);
  } finally { await page.keyboard.up('w'); }
  const probe = await page.evaluate(() => (window as unknown as { doorInputProbe: DoorInputProbe }).doorInputProbe);
  await test.info().attach('door-input-delivery.json', { body: JSON.stringify(probe), contentType: 'application/json' });
  expect(probe.burstDone).toBe(true);
  expect(probe.inputs.map(input => input.name)).toEqual([
    'mousemove', 'Escape:down', 'Escape:up', 'KeyI:down', 'KeyI:up', 'Digit3:down', 'Digit3:up',
    'Space:down', 'Space:up', 'wheel', 'mousedown', 'mouseup',
  ]);
  for (const input of probe.inputs) {
    expect(input.lockedBefore, `${input.name} arrives during the travel lock`).toBe(true);
    expect(input.lockedAfter, `${input.name} cannot release the travel lock`).toBe(true);
  }
  const after = await getState(page);
  expect(after.paused).toBe(false);
  expect(after.inventoryOpen).toBe(false);
  expect(after.hotbarIndex).toBe(before.hotbarIndex);
  expect(after.player.stamina).toBe(before.player.stamina);
  expect(after.placedItems).toEqual(before.placedItems);
  expect(new Set(probe.samples)).toEqual(new Set([22, 14, 5, 3]));
});

test('pause, inventory and a tool action cannot trigger the door, while sideways porch walking stays outside', async ({ page }) => {
  await bootGame(page);
  await teleportAtFarmShop(page, 0, 1, 'up');
  for (const panel of ['Escape', 'i']) {
    await page.keyboard.press(panel);
    await page.keyboard.down('w');
    await advanceFrames(page, 300);
    await page.keyboard.up('w');
    expect((await getState(page)).activeScene).toBe('FarmScene');
    expect((await getState(page)).transitionActive).toBe(false);
    await page.keyboard.press(panel);
  }
  await teleportAtFarmShop(page, 0, 0, 'up');
  // Space is sampled as held state by the game loop, so an instantaneous press can miss a frame.
  await page.keyboard.down('Space');
  await page.waitForFunction(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as { player: { busy: boolean } };
    return farm.player.busy;
  });
  await page.keyboard.up('Space');
  await page.keyboard.down('w');
  await advanceFrames(page, 50);
  await page.keyboard.up('w');
  expect((await getState(page)).transitionActive).toBe(false);
  await teleportAtFarmShop(page, -1, 1, 'right');
  await advanceFrames(page, 600);
  await page.keyboard.down('d');
  await advanceFrames(page, 400);
  await page.keyboard.up('d');
  expect((await getState(page)).activeScene).toBe('FarmScene');
});

test('bad destination rejects before input, readiness, active scene, or pending spawn changes', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Browser runtime modules are served by Vite.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    const before = window.__TEST__!.state();
    const errors: string[] = [];
    const from = window.__GAME__!.scene.getScene('FarmScene');
    for (const [scene, spawn] of [['NoSuchScene', 'entry'], ['TavernScene', 'missing']]) {
      try { transitionTo(from, scene, spawn); } catch (error) { errors.push(String(error)); }
    }
    return { errors, before, after: window.__TEST__!.state(), ready: window.__TEST__!.ready };
  });
  expect(result.errors).toHaveLength(2);
  expect(result.after).toEqual(result.before);
  expect(result.ready).toBe(true);
  // A successful real entry proves no invalid pending spawn poisoned the next scene.
  await enterShop(page);
});

test('private bedroom save and autosleep survive reload; guest stairs and old public bed never sleep or warp', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Browser runtime module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    SaveSystem.beginNewGame(1);
  });
  await enterShop(page);
  const before = await getState(page);
  await teleport(page, 24, 5, 'up');
  await page.keyboard.press('e');
  expect((await getState(page)).day).toBe(before.day);
  await teleport(page, 27, 6, 'up');
  await page.keyboard.down('w'); await advanceFrames(page, 500); await page.keyboard.up('w');
  expect((await getState(page)).activeScene).toBe('TavernScene');
  expect((await getState(page)).player.y).toBeGreaterThanOrEqual(80);
  await enterBedroom(page);
  await teleport(page, 14, 5, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).day).toBe(before.day + 1);
  const saved = await page.evaluate(async () => {
    // @ts-expect-error Browser runtime module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    return JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
  });
  expect(saved.state.activeScene).toBe('BedroomScene');
  expect(saved.state.player).toMatchObject({ x: 232, y: 88, stamina: 100 });
  expect(saved.state).not.toHaveProperty('transitionActive');
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('BedroomScene') && window.__TEST__!.ready);
  expect((await getState(page)).player).toMatchObject({ x: 232, y: 88, stamina: 100 });
  await teleport(page, 9, 11, 'down');
  await walkThrough(page, 's', 'TavernScene');
  expect((await getState(page)).player).toMatchObject({ x: 360, y: 72 });
  expect((await getState(page)).tavern.totalServed).toBe(before.tavern.totalServed);
});

test('new shop has no fixed stations, station solids, or permanent world placards', async ({ page }) => {
  await bootGame(page); await enterShop(page);
  const room = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TavernScene');
    const map = (scene as unknown as { map: { objects: unknown[]; fixtures: unknown[]; solid: boolean[][] } }).map;
    return {
      objects: map.objects, fixtures: map.fixtures,
      oldStationSolids: [{ tx: 5, ty: 3 }, { tx: 11, ty: 6 }, { tx: 4, ty: 10 }, { tx: 18, ty: 10 }].map(tile => map.solid[tile.ty][tile.tx]),
      labels: scene.children.list.filter(object => object.type === 'Text').map(object => (object as Phaser.GameObjects.Text).text).filter(Boolean),
    };
  });
  expect(room).toEqual({ objects: [], fixtures: [], oldStationSolids: [false, false, false, false], labels: [] });
  expect((await getState(page)).placedItems).toEqual([]);
  for (const tile of [{ tx: 5, ty: 4 }, { tx: 4, ty: 11 }, { tx: 18, ty: 11 }]) {
    await teleport(page, tile.tx, tile.ty, 'up'); await page.keyboard.press('e');
    expect((await getState(page)).tavernPanel).toBeNull();
    expect((await getState(page)).craftingOpen).toBe(false);
  }
});

test('porch fills the browser; bedroom centers when it fits and follows the south edge in a compact view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  for (const viewport of [{ width: 800, height: 500 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await teleportAtFarmShop(page, -1, 1, 'left');
    await advanceFrames(page, 200);
    expect(await page.locator('canvas').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    await page.screenshot({ path: `output/playwright/shop-home/porch-${viewport.width}.png` });
  }
  await enterShop(page);
  await enterBedroom(page);
  for (const viewport of [{ width: 800, height: 500 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await advanceFrames(page, 200);
    const centered = await page.evaluate(() => {
      const camera = window.__GAME__!.scene.getScene('BedroomScene').cameras.main;
      // midPoint is the optical center. worldView is a separately rounded culling rectangle;
      // its odd pixel height can put centerY half a pixel away from the camera's real center.
      return { x: camera.midPoint.x, y: camera.midPoint.y, height: camera.height / camera.zoom };
    });
    expect(centered.x).toBeCloseTo(160, 0);
    // The keeper enters near the south edge. A short viewport follows that edge instead of
    // hiding it behind the toolbar; when the whole224px room fits, retain its centered framing.
    expect(centered.y).toBeCloseTo(Math.max(112, 224 - centered.height / 2), 0);
    await page.screenshot({ path: `output/playwright/shop-home/bedroom-${viewport.width}.png` });
  }
  expect(errors).toEqual([]);
});

test('stone face and post feet block walking, central stairs stay open, and foreground depth changes across the porch', async ({ page }) => {
  test.setTimeout(60_000);
  await bootGame(page);
  const { offset } = await farmLayout(page);
  await teleportAtFarmShop(page, -2, 3, 'up');
  await page.keyboard.down('w'); await advanceFrames(page, 600); await page.keyboard.up('w');
  expect((await getState(page)).player.y).toBeGreaterThanOrEqual(234.9 + offset.ty * 16);
  expect((await getState(page)).activeScene).toBe('FarmScene');
  await teleportAtFarmShop(page, -3, 1, 'down');
  await page.keyboard.down('s'); await advanceFrames(page, 300); await page.keyboard.up('s');
  expect((await getState(page)).player.y).toBeLessThanOrEqual(217.1 + offset.ty * 16);
  const behind = await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene');
    const post = farm.children.getByName('shop-porch-post-0') as Phaser.GameObjects.TileSprite;
    const player = (farm as unknown as { player: Phaser.GameObjects.Sprite }).player;
    return post.depth > player.depth;
  });
  expect(behind).toBe(true);
  await page.evaluate(() => window.__GAME__!.scene.getScene('UIScene').scene.setVisible(false));
  await page.screenshot({ path: 'output/playwright/shop-home/porch-behind-post-clean.png' });
  await teleportAtFarmShop(page, -3, 3, 'up');
  await advanceFrames(page, 200);
  expect(await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene');
    const post = farm.children.getByName('shop-porch-post-0') as Phaser.GameObjects.TileSprite;
    return (farm as unknown as { player: Phaser.GameObjects.Sprite }).player.depth > post.depth;
  })).toBe(true);
  await page.screenshot({ path: 'output/playwright/shop-home/porch-front-clean.png' });
  await page.evaluate(() => window.__TEST__!.stepTime(14 * 60));
  await advanceFrames(page, 200);
  await page.screenshot({ path: 'output/playwright/shop-home/porch-night-clean.png' });
  await enterShop(page);
  await page.screenshot({ path: 'output/playwright/shop-home/shop-room-clean.png' });
});

test('only legacy keepers inside new porch structure migrate; v4 corruption rejects without changing state or stored bytes', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Browser runtime module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Browser runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Historical envelopes must carry their actual historical service schema.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const base = GameState.instance.toSaveData();
    const migrated: Array<{ x: number; y: number; facing: string }> = [];
    const preserved: Array<{ x: number; y: number; facing: string }> = [];
    let bytesUnchanged = true;
    for (const version of [1, 2, 3]) {
      for (const point of [{ x: 1120, y: 228 }, { x: 1109, y: 222 }, { x: 1160, y: 216 }]) {
        const state = structuredClone(base) as Record<string, unknown>;
        state.tavern = createLegacyTavernState();
        state.player = { ...base.player, ...point };
        if (version < 3) delete state.appearance;
        if (version === 1) delete state.tavern;
        const raw = JSON.stringify({ version, slot: 1, savedAt: 1, state });
        localStorage.setItem(SaveSystem.storageKey(1), raw);
        SaveSystem.load(1);
        bytesUnchanged &&= localStorage.getItem(SaveSystem.storageKey(1)) === raw;
        (point.x === 1160 ? preserved : migrated).push({ ...GameState.instance.player });
      }
    }
    const before = JSON.stringify(GameState.instance.toSaveData());
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 4, slot: 2, savedAt: 1,
      state: { ...base, tavern: createLegacyTavernState(), player: { ...base.player, x: 1120, y: 228 } } }));
    let error = '';
    try { SaveSystem.load(2); } catch (failure) { error = String(failure); }
    const unchanged = before === JSON.stringify(GameState.instance.toSaveData());
    const priorBytes = localStorage.getItem(SaveSystem.storageKey(1));
    // Current writes validate the moved porch; historical envelopes above retain their old coordinates.
    GameState.instance.player.x = 1120 + 10 * 16;
    GameState.instance.player.y = 228 + 13 * 16;
    let saveError = '';
    try { SaveSystem.save(1); } catch (failure) { saveError = String(failure); }
    return { migrated, preserved, bytesUnchanged, error, unchanged, saveError,
      saveBytesUnchanged: priorBytes === localStorage.getItem(SaveSystem.storageKey(1)), slot: SaveSystem.currentSlot() };
  });
  expect(result.migrated).toHaveLength(6);
  for (const player of result.migrated) expect(player).toMatchObject({ x: 1320, y: 456, facing: 'down' });
  for (const player of result.preserved) expect(player).toMatchObject({ x: 1160, y: 216 });
  expect(result.bytesUnchanged).toBe(true);
  expect(result.error).toContain('solid shop porch');
  expect(result.unchanged).toBe(true);
  expect(result.saveError).toContain('solid shop porch');
  expect(result.saveBytesUnchanged).toBe(true);
  expect(result.slot).toBe(1);
});
