/**
 * M23 — feedback, fishing presentation, and farming iteration polish.
 *
 * These tests inspect serialized gameplay authority and the actual Phaser display objects because
 * the game is one canvas: active/inspected slot treatments, held cast pose, line lifecycle, gated
 * tuning controls, and pickaxe soil restoration all need evidence beyond DOM assertions.
 */
import { test, expect } from '@playwright/test';
import { act, advanceFrames, bootGame, getState, teleport } from './helpers/gameHarness';

type TestFacing = 'up' | 'down' | 'left' | 'right';

/** Find a water tile whose opposite neighbor is safe land for the requested cast direction. */
async function castSpot(
  page: import('@playwright/test').Page,
  facing: TestFacing
): Promise<{ tx: number; ty: number }> {
  return page.evaluate((direction) => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      map: { ground: string[][]; solid: boolean[][] };
    };
    const delta = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    }[direction];
    for (let y = 34; y <= 52; y++) {
      for (let x = 66; x <= 86; x++) {
        if (farm.map.ground[y]?.[x] !== 'water') continue;
        const tx = x - delta.x;
        const ty = y - delta.y;
        if (farm.map.ground[ty]?.[tx] !== 'water' && farm.map.solid[ty]?.[tx] === false) {
          return { tx, ty };
        }
      }
    }
    throw new Error(`M23: no safe ${direction} cast spot found`);
  }, facing);
}

/** Cast with the same digit/Space keyboard path a player uses. */
async function keyboardCast(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('7');
  await page.keyboard.down('Space');
  await advanceFrames(page, 90);
  await page.keyboard.up('Space');
  await advanceFrames(page, 700);
}

/** Read all scene-owned cast visuals without mutating fishing state. */
async function fishingVisuals(page: import('@playwright/test').Page): Promise<{
  playerTexture: string;
  playerFrame: string | number;
  rodType: string | null;
  rodActive: boolean;
  lineActive: boolean;
  lineStyleCommands: number;
  bobberActive: boolean;
  rippleActive: boolean;
}> {
  return page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      player: { texture: { key: string }; frame: { name: string | number } };
      heldRod: { type: string; active: boolean; visible: boolean } | null;
      fishingLine: { active: boolean; visible: boolean; commandBuffer: number[] } | null;
      bobber: { active: boolean; visible: boolean } | null;
      bobberRipple: { active: boolean; visible: boolean } | null;
    };
    return {
      playerTexture: farm.player.texture.key,
      playerFrame: farm.player.frame.name,
      rodType: farm.heldRod?.type ?? null,
      rodActive: !!farm.heldRod?.active && farm.heldRod.visible,
      lineActive: !!farm.fishingLine?.active && farm.fishingLine.visible,
      // Phaser's Graphics command id 6 is lineStyle. There must be one tether stroke only.
      lineStyleCommands: farm.fishingLine?.commandBuffer.filter((command) => command === 6).length ?? 0,
      bobberActive: !!farm.bobber?.active && farm.bobber.visible,
      rippleActive: !!farm.bobberRipple?.active && farm.bobberRipple.visible,
    };
  });
}

/** Click a fixed 960x540 game coordinate through the responsive canvas transform. */
async function clickGame(page: import('@playwright/test').Page, x: number, y: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('M23: canvas has no bounding box');
  await page.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 540) * box.height);
  await advanceFrames(page, 100);
}

test('equipped slot uses a separate, stronger treatment than inspected inventory state', async ({ page }) => {
  await bootGame(page);
  await page.keyboard.press('i');
  await advanceFrames(page, 100);
  const visual = await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
      inventoryUI: {
        hotbarSlots: Array<{ activeRing: { visible: boolean }; marker: { visible: boolean }; bg: { getData: (key: string) => unknown } }>;
        toolbeltSlots: Array<{ activeRing: { visible: boolean }; marker: { visible: boolean }; bg: { getData: (key: string) => unknown } }>;
        backpackSlots: Array<{ activeRing: { visible: boolean }; bg: { getData: (key: string) => unknown } }>;
      };
    };
    const hot = ui.inventoryUI.hotbarSlots[0];
    const modal = ui.inventoryUI.toolbeltSlots[0];
    return {
      hotActiveRing: hot.activeRing.visible,
      hotMarker: hot.marker.visible,
      hotEquipped: hot.bg.getData('equipped'),
      modalActiveRing: modal.activeRing.visible,
      modalEquipped: modal.bg.getData('equipped'),
      backpackHasActiveRing: ui.inventoryUI.backpackSlots.some((slot) => slot.activeRing.visible),
    };
  });
  expect(visual).toEqual({
    hotActiveRing: true,
    hotMarker: true,
    hotEquipped: true,
    modalActiveRing: true,
    modalEquipped: true,
    backpackHasActiveRing: false,
  });
  // A real click on the axe switches the detail charm from the seed stack to tool metadata.
  await clickGame(page, 343, 151);
  const inspectedTool = await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
      inventoryUI: { detailName: { text: string }; detailCategory: { text: string }; detailDescription: { text: string } };
    };
    return {
      name: ui.inventoryUI.detailName.text,
      category: ui.inventoryUI.detailCategory.text,
      description: ui.inventoryUI.detailDescription.text,
    };
  });
  expect(inspectedTool).toMatchObject({ name: 'Axe', category: 'TOOL' });
  expect(inspectedTool.description).toContain('Chops trees');
  await page.screenshot({ path: '.frontend-loop/fishing-farming-feedback/screenshots/round-03-inventory-desktop.png' });
  await page.setViewportSize({ width: 760, height: 520 });
  await advanceFrames(page, 100);
  await page.screenshot({ path: '.frontend-loop/fishing-farming-feedback/screenshots/round-03-inventory-compact.png' });
});

test('all four fishing facings keep directional player art, a rod-only pose, and one tether', async ({ page }) => {
  await bootGame(page);
  const expectedTexture: Record<TestFacing, string> = {
    up: 'player-cardinal',
    down: 'player-cardinal',
    left: 'player-idle',
    right: 'player-idle',
  };
  const observedFrames = new Map<TestFacing, string | number>();

  for (const facing of ['up', 'down', 'left', 'right'] as const) {
    const spot = await castSpot(page, facing);
    await teleport(page, spot.tx, spot.ty, facing);
    await keyboardCast(page);
    const visual = await fishingVisuals(page);
    observedFrames.set(facing, visual.playerFrame);
    expect(visual).toMatchObject({
      playerTexture: expectedTexture[facing],
      rodType: 'Graphics',
      rodActive: true,
      lineActive: true,
      lineStyleCommands: 1,
      bobberActive: true,
      rippleActive: true,
    });
    expect(visual.playerTexture).not.toBe('player-cast');
    if (facing === 'down' || facing === 'right') {
      await page.screenshot({ path: `output/playwright/fixed-${facing}-fishing.png` });
    }

    // Pressing Space while waiting is the real reel-in/cancel path; no private cleanup helper.
    await page.keyboard.down('Space');
    await advanceFrames(page, 80);
    await page.keyboard.up('Space');
    await advanceFrames(page, 120);
    expect((await getState(page)).fishing).toBeNull();
    expect(await fishingVisuals(page)).toMatchObject({
      rodType: null,
      rodActive: false,
      lineActive: false,
      bobberActive: false,
      rippleActive: false,
    });
  }

  expect(observedFrames.get('up')).not.toBe(observedFrames.get('down'));
});

test('cast visuals clean up through real caught and escaped state transitions', async ({ page }) => {
  await bootGame(page);
  const spot = await castSpot(page, 'right');

  for (const outcome of ['caught', 'escaped'] as const) {
    await teleport(page, spot.tx, spot.ty, 'right');
    await keyboardCast(page);
    expect((await getState(page)).fishing?.phase).toBe('waiting');

    await page.evaluate(async (targetOutcome) => {
      // @ts-expect-error runtime module path is served by Vite in browser tests
      const fishing = await import('/src/systems/FishingSystem.ts');
      // @ts-expect-error runtime module path is served by Vite in browser tests
      const stateMod = await import('/src/state/GameState.ts');
      fishing.FishingSystem.bite();
      fishing.FishingSystem.startReel();
      const state = stateMod.GameState.instance.fishing;
      if (!state || state.phase !== 'reeling') throw new Error('M23: expected reeling state');
      state.fishId = 'fish-sardine';
      state.zoneVel = 0;
      if (targetOutcome === 'caught') {
        state.progress = 0.999;
        state.zonePos = 35;
        state.fishPos = 50;
        state.fishTarget = 50;
      } else {
        state.progress = 0.001;
        state.zonePos = 0;
        state.fishPos = 90;
        state.fishTarget = 0;
      }
    }, outcome);
    await advanceFrames(page, 180);
    expect((await getState(page)).fishing).toBeNull();
    expect(await fishingVisuals(page)).toMatchObject({
      rodType: null,
      rodActive: false,
      lineActive: false,
      bobberActive: false,
      rippleActive: false,
    });
  }
});

test('dev tuning is serialized, validates scales, advances time, and steps a crop life cycle', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(() => {
    window.__TEST__!.setTimeScale(16);
    window.__TEST__!.setCropScale(4);
  });
  let state = await getState(page);
  expect(state.devTuning).toEqual({ clockScale: 16, cropScale: 4 });
  const beforeTime = state.timeOfDay;
  await advanceFrames(page, 500);
  state = await getState(page);
  expect(state.timeOfDay - beforeTime).toBeGreaterThan(8);

  await page.evaluate(async () => {
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const cropMod = await import('/src/systems/CropSystem.ts');
    stateMod.GameState.instance.tiles['FarmScene:50,50'] = 'tilled';
    cropMod.CropSystem.plant(50, 50, 'parsnip');
    window.__TEST__!.advanceCropDay();
  });
  state = await getState(page);
  expect(state.crops['50,50']).toMatchObject({ type: 'parsnip', stage: 1, watered: false });
  await page.keyboard.press('F10');
  await advanceFrames(page, 80);
  const panelVisible = await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as { devPanel: { visible: boolean } | null };
    return ui.devPanel?.visible ?? false;
  });
  expect(panelVisible).toBe(true);
  await page.screenshot({ path: '.frontend-loop/fishing-farming-feedback/screenshots/round-03-growth-lab.png' });
});

test('crop preview renders larger plants, plant-foot shadows, and a lighter wet-soil sheen', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    const gs = stateMod.GameState.instance;
    for (let stage = 0; stage < 4; stage++) {
      const key = `FarmScene:${50 + stage},50`;
      gs.tiles[key] = stage % 2 === 0 ? 'watered' : 'tilled';
      gs.crops[key] = { type: 'parsnip', stage, maxStage: 3, watered: stage % 2 === 0, daysInStage: 0 };
    }
    window.__GAME__!.events.emit('dev-crops-advanced');
  });
  await teleport(page, 51, 52, 'up');
  await advanceFrames(page, 120);
  const visuals = await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      overlay: Map<string, { displayWidth: number }>;
      cropShadows: Map<string, unknown>;
      soil: { wet: Map<string, { fillAlpha: number }> };
    };
    return {
      cropWidths: [...farm.overlay.values()].map((crop) => crop.displayWidth),
      shadows: farm.cropShadows.size,
      wetAlpha: [...farm.soil.wet.values()][0]?.fillAlpha,
    };
  });
  expect(visuals.cropWidths).toHaveLength(4);
  expect(Math.min(...visuals.cropWidths)).toBeGreaterThan(16);
  expect(visuals.shadows).toBe(4);
  expect(visuals.wetAlpha).toBeCloseTo(0.22, 2);
  await page.screenshot({ path: '.frontend-loop/fishing-farming-feedback/screenshots/cute-crop-soil-preview.png' });
});

test('pickaxe restores empty tilled and watered soil but preserves occupied crop soil and stamina', async ({ page }) => {
  await bootGame(page);
  const tx = 50;
  const ty = 50;
  await teleport(page, tx - 1, ty, 'right');
  await act(page, 'hotbar:0');
  await act(page, 'use-tool');
  let state = await getState(page);
  expect(state.tiles[`${tx},${ty}`]).toBe('tilled');
  const afterHoe = state.player.stamina;

  await act(page, 'hotbar:2');
  await act(page, 'use-tool');
  state = await getState(page);
  expect(state.tiles[`${tx},${ty}`]).toBeUndefined();
  expect(state.player.stamina).toBeLessThan(afterHoe);

  await page.evaluate(async ([x, y]) => {
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const stateMod = await import('/src/state/GameState.ts');
    // @ts-expect-error runtime module path is served by Vite in browser tests
    const cropMod = await import('/src/systems/CropSystem.ts');
    stateMod.GameState.instance.tiles[`FarmScene:${x},${y}`] = 'watered';
    cropMod.CropSystem.plant(x, y, 'parsnip');
  }, [tx, ty] as const);
  const beforeDenied = (await getState(page)).player.stamina;
  await act(page, 'use-tool');
  state = await getState(page);
  expect(state.tiles[`${tx},${ty}`]).toBe('watered');
  expect(state.crops[`${tx},${ty}`]).toMatchObject({ type: 'parsnip', stage: 0 });
  expect(state.player.stamina).toBe(beforeDenied);
});
