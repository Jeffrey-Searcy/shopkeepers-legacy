import { teleportAtFarmShop } from './helpers/gameHarness';
/** Real-input tavern chapter tests: walk in, restore, cook, serve, save, sleep and return. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, give, teleport } from './helpers/gameHarness';
import { clickHospitalityControl } from './helpers/hospitalityHarness';
import type { TavernGuest } from '../src/config/Tavern';

/** Advance real guest transitions to a food order, then equip its cooked stack for native serving. */
async function waitingOrder(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Inventory placement fixture; actual selection and handoff remain keyboard input.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Use the real inventory transaction, never duplicate quantity records.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    // @ts-expect-error Vite resolves the same production guest simulation used by the scene.
    const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
    const gs = GameState.instance;
    const ready = {
      scene: gs.activeScene === 'TavernScene' && window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready,
      open: gs.tavern.tavernOpen && gs.tavern.serviceDay === gs.day,
      worldInput: !gs.transitionActive && !gs.paused && !gs.pauseConfirmOpen && !gs.inventoryOpen &&
        !gs.chestOpen && !gs.craftingOpen && !gs.binOpen && gs.dialogue === null && gs.daySummary === null &&
        gs.fishing === null && gs.tavernPanel === null &&
        (gs.placingItem === null || gs.placingSource === 'toolbelt'),
    };
    if (!Object.values(ready).every(Boolean)) throw new Error(`Food-order fixture is blocked: ${JSON.stringify(ready)}`);
    /** Read the actual guest state; never force a phase, route, admission, or order. */
    const hasOrder = (): boolean => gs.tavern.guests.some((guest: TavernGuest) => guest.kind === 'tavern' &&
      guest.product === 'food' && guest.destinationId.startsWith('bar:') && guest.phase === 'waiting');
    const initial = JSON.stringify(gs.tavern);
    let advancedMs = 0;
    // Native pacing has separate coverage. These tests cover serving and rendering, not wall-clock speed.
    while (!hasOrder() && advancedMs < 120_000) { TavernSystem.tick(100); advancedMs += 100; }
    if (!hasOrder()) throw new Error(`No food order after ${advancedMs}ms of production ticks; initial=${initial}; final=${JSON.stringify(gs.tavern)}`);
    const slot = InventoryLayoutSystem.findEntrySlot(gs, 'stew');
    if (!slot) throw new Error('The kitchen must supply a real stew stack');
    InventoryLayoutSystem.moveOrSwap(gs, slot, { container: 'toolbelt', index: 5 });
  });
  await page.keyboard.press('6');
}

/** Read the chosen food order's actual bar column; paced guests no longer fill a fixed lane first. */
async function orderColumn(page: Page): Promise<number> {
  const guest = (await getState(page)).tavern.guests.find(guest => guest.phase === 'waiting' && guest.product === 'food' && guest.destinationId.startsWith('bar:'));
  if (!guest) throw new Error('Expected a waiting bar food order');
  return Number(guest.destinationId.slice(4).split(',')[0]);
}

/** Wait until the live scene is created, not merely when a transition records its destination. */
async function inScene(page: Page, name: string): Promise<void> {
  await page.waitForFunction(key => window.__GAME__!.scene.isActive(key) && window.__TEST__!.ready, name);
  await expect.poll(async () => (await getState(page)).activeScene).toBe(name);
}

/** Walk through the animated farm door without E; teleport only skips the unrelated farm approach. */
async function enterTavern(page: Page): Promise<void> {
  // Crafting/placement here is fixture setup; the interactions under test use real E/Enter below.
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { CraftingSystem } = await import('/src/systems/CraftingSystem.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { ItemPlacementSystem } = await import('/src/systems/ItemPlacementSystem.ts');
    const gs = GameState.instance;
    if (gs.placedItems.some((item: { scene: string }) => item.scene === 'TavernScene')) return;
    gs.addItem('wood', 57); gs.addItem('stone', 28);
    for (const [item, tx, ty] of [['workbench', 20, 12], ['register', 5, 10], ['stove', 6, 5], ['bar', 14, 6]] as const) {
      if (!CraftingSystem.craft(item) || !ItemPlacementSystem.place(item, 'TavernScene', tx, ty, 0)) {
        throw new Error(`Could not prepare crafted station fixture: ${item}`);
      }
    }
  });
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try {
    await inScene(page, 'TavernScene');
  } finally {
    await page.keyboard.up('w');
  }
}

/** Cross the rear doorway with real movement; teleport skips unrelated shop-floor travel. */
async function enterBedroom(page: Page): Promise<void> {
  await teleport(page, 22, 4, 'up');
  await page.keyboard.down('w');
  try {
    await inScene(page, 'BedroomScene');
  } finally {
    await page.keyboard.up('w');
  }
}

/** Leave the private bedroom through its south doorway before resuming tavern service. */
async function returnFromBedroom(page: Page): Promise<void> {
  await teleport(page, 9, 11, 'down');
  await page.keyboard.down('s');
  try {
    await inScene(page, 'TavernScene');
  } finally {
    await page.keyboard.up('s');
  }
}

/**
 * Walk toward a tile center through native keyboard events and verify the settled feet tile.
 * Both observation and release run in the browser frame: a busy test runner must not delay keyup.
 * This uses Phaser's normal DOM keyboard path, never position writes or the movement seam.
 */
async function walkAxis(page: Page, axis: 'x' | 'y', target: number): Promise<void> {
  const trace = await page.evaluate(async ({ axis, target }) => {
    // @ts-expect-error Vite resolves the live movement constants in this browser test.
    const { TILE, PLAYER_SPEED, PLAYER_BRAKING, PLAYER_SETTLE_LEAN_PX } = await import('/src/config/GameConfig.ts');
    const scene = window.__GAME__!.scene.getScenes(true).find(s => 'player' in s) as unknown as {
      player: { body: { center: { x: number; y: number }; velocity: { x: number; y: number } } };
    };
    const body = scene.player.body;
    const center = (target + 0.5) * TILE;
    const direction = center > body.center[axis] ? 1 : -1;
    // why: after keyup the feet still brake forward (v^2 / 2a px), and the settle picks its tile from the feet
    // pushed PLAYER_SETTLE_LEAN_PX further along. Releasing exactly at the center lands about 9px on, in the
    // next tile, so release that far early; the feet then settle within a frame's step of the target center.
    const lead = PLAYER_SPEED * PLAYER_SPEED / (2 * PLAYER_BRAKING) + PLAYER_SETTLE_LEAN_PX;
    const key = axis === 'x' ? (direction > 0 ? 'd' : 'a') : (direction > 0 ? 's' : 'w');
    const code = `Key${key.toUpperCase()}`;
    const keyCode = key.toUpperCase().charCodeAt(0);
    /** Deliver a native DOM event through the same window target Phaser uses for human input. */
    const dispatch = (type: 'keydown' | 'keyup'): void => {
      window.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true }));
    };
    /** Record physical feet and velocity for failure evidence without altering either. */
    const sample = (): { feet: number; velocity: number } => ({
      feet: body.center[axis], velocity: body.velocity[axis],
    });
    const start = sample();
    let release: ReturnType<typeof sample> | null = null;
    let frameId = 0;
    let timerId = 0;
    try {
      return await new Promise<{ start: typeof start; release: ReturnType<typeof sample> | null; stopped: typeof start; tile: number }>((resolve, reject) => {
        /** Sample once per rendered frame and release once the braked, leaned stop would reach the center. */
        const tick = (): void => {
          if (release === null && direction * (body.center[axis] - center) >= -lead) {
            release = sample();
            dispatch('keyup');
          }
          if (release !== null && Math.hypot(body.velocity.x, body.velocity.y) === 0) {
            resolve({ start, release, stopped: sample(), tile: Math.floor(body.center[axis] / TILE) });
            return;
          }
          frameId = requestAnimationFrame(tick);
        };
        timerId = window.setTimeout(() => reject(new Error(`walkAxis stalled: ${JSON.stringify({ axis, target, start, release, current: sample() })}`)), 5000);
        dispatch('keydown');
        frameId = requestAnimationFrame(tick);
      });
    } finally {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      dispatch('keyup');
    }
  }, { axis, target });
  expect(trace.tile, JSON.stringify(trace)).toBe(target);
}

/** Turn through native DOM input, releasing in the same browser frame that observes the facing. */
async function face(page: Page, direction: 'up' | 'down'): Promise<void> {
  await page.evaluate(async direction => {
    const key = direction === 'up' ? 'w' : 's';
    const keyCode = key.toUpperCase().charCodeAt(0);
    const scene = window.__GAME__!.scene.getScenes(true).find(s => 'player' in s) as unknown as {
      player: { body: { velocity: { x: number; y: number } } };
    };
    /** Use Phaser's DOM keyboard listener, not direct game intent or facing writes. */
    const dispatch = (type: 'keydown' | 'keyup'): void => {
      window.dispatchEvent(new KeyboardEvent(type, { key, code: `Key${key.toUpperCase()}`, keyCode, which: keyCode, bubbles: true }));
    };
    let released = false;
    let frameId = 0;
    let timerId = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        /** Release as soon as the game observes direction and wait for real braking to finish. */
        const tick = (): void => {
          if (!released && window.__TEST__!.state().player.facing === direction) {
            released = true;
            dispatch('keyup');
          }
          if (released && Math.hypot(scene.player.body.velocity.x, scene.player.body.velocity.y) === 0) {
            resolve();
            return;
          }
          frameId = requestAnimationFrame(tick);
        };
        timerId = window.setTimeout(() => reject(new Error(`face stalled turning ${direction}`)), 5000);
        dispatch('keydown');
        frameId = requestAnimationFrame(tick);
      });
    } finally {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
      dispatch('keyup');
    }
  }, direction);
}

/** Wait for the UI frame to remove the menu before collecting a room screenshot. */
async function waitForClosedPanel(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel');
    return (panel as unknown as { visible: boolean }).visible === false;
  });
}

/** Restore with real E/Enter input; resource setup is isolated from the interaction being tested. */
async function restore(page: Page): Promise<void> {
  await give(page, 'wood', 30);
  await give(page, 'stone', 10);
  await teleport(page, 5, 11, 'up');
  await page.keyboard.press('m');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('ledger');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).tavern.level).toBe(1);
  await page.keyboard.press('e');
}

/** Open service with the first action at the crafted register, then return input to the world. */
async function openShop(page: Page): Promise<void> {
  await teleport(page, 5, 11, 'up');
  await page.keyboard.press('m');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('ledger');
  await page.keyboard.press('Enter');
  await page.keyboard.press('e');
}

test('real keys reach the ledger, preserve failed repair, block modal input, and restore the room', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page);
  await enterTavern(page);
  await walkAxis(page, 'x', 9);
  // Approach from open floor, then walk toward the ledger; do not graze its collision corner.
  await walkAxis(page, 'y', 12);
  await walkAxis(page, 'x', 5);
  await walkAxis(page, 'y', 11);
  await face(page, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('ledger');
  await page.keyboard.press('Enter');
  expect((await getState(page)).tavern.level).toBe(0);
  const before = await getState(page);
  await page.keyboard.down('d');
  await page.keyboard.press('Space');
  await page.keyboard.press('i');
  await page.keyboard.up('d');
  const after = await getState(page);
  expect(after.player.x).toBeCloseTo(before.player.x, 2);
  expect(after.player.stamina).toBe(before.player.stamina);
  expect(after.inventoryOpen).toBe(false);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/ledger-before.png' });
  await give(page, 'wood', 20);
  await give(page, 'stone', 10);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).tavern.level).toBe(1);
  expect((await getState(page)).inventory.stew).toBe(4);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/ledger-restored.png' });
  await page.keyboard.press('Escape');
  expect((await getState(page)).tavernPanel).toBe(null);
  expect((await getState(page)).paused).toBe(false);
  await waitForClosedPanel(page);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/room-restored.png' });
  expect(errors).toEqual([]);
});

test('real cooking and counter input pays once, preserves a visit across exit, and resets on sleep', async ({ page }) => {
  test.setTimeout(180_000); // Paced arrivals, social stops, and repeat orders span two native services.
  await bootGame(page);
  await enterTavern(page);
  await restore(page);
  await give(page, 'parsnip', 1);
  await teleport(page, 6, 6, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('kitchen');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).inventory.stew).toBe(8);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/kitchen.png' });
  await page.keyboard.press('e');
  await openShop(page);
  await waitingOrder(page);
  // Serving from the guest side must fail; the player works behind the bar.
  await teleport(page, await orderColumn(page), 7, 'up');
  await page.keyboard.press('e');
  expect((await getState(page)).gold).toBe(0);
  // Reach the keeper side through the real collision layout, around the left end of the bar.
  await walkAxis(page, 'x', 9);
  await walkAxis(page, 'y', 5);
  await walkAxis(page, 'x', await orderColumn(page));
  await face(page, 'down');
  const counterApproach = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this runtime diagnostic module.
    const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
    return { player: window.__TEST__!.state().player, canServe: TavernSystem.canInteract('counter') };
  });
  expect(counterApproach.canServe, JSON.stringify(counterApproach)).toBe(true);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/first-customer.png' });
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).gold).toBe(12);
  expect((await getState(page)).tavern.servedToday).toBe(1);
  await waitingOrder(page);
  await teleport(page, 14, 15, 'down');
  await page.keyboard.down('s');
  try { await inScene(page, 'FarmScene'); } finally { await page.keyboard.up('s'); }
  expect((await getState(page)).tavern.servedToday).toBe(1);
  await enterTavern(page);
  expect((await getState(page)).tavern.guests.some(guest => guest.phase === 'waiting')).toBe(true);
  await teleport(page, await orderColumn(page), 5, 'down');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavern.servedToday).toBe(2);
  await waitingOrder(page);
  await teleport(page, await orderColumn(page), 5, 'down');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavern.servedToday).toBe(3);
  expect((await getState(page)).gold).toBe(36);
  // Service no longer ends at an arbitrary daily quota. Close it explicitly before sleeping.
  await openShop(page);
  expect((await getState(page)).tavern.tavernOpen).toBe(false);
  await enterBedroom(page);
  await teleport(page, 14, 5, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).day).toBe(2);
  expect((await getState(page)).tavern).toMatchObject({ innOpen: false, tavernOpen: false, servedToday: 0, totalServed: 3 });
  expect((await getState(page)).inventory.stew).toBe(5);
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).daySummary).toBe(null);
  await returnFromBedroom(page);
  await openShop(page);
  for (let i = 0; i < 3; i++) {
    await waitingOrder(page);
    await teleport(page, await orderColumn(page), 5, 'down');
    await page.keyboard.press('e');
    await expect.poll(async () => (await getState(page)).tavern.servedToday).toBe(i + 1);
  }
  await openShop(page);
  expect((await getState(page)).tavern.tavernOpen).toBe(false);
  await teleport(page, 5, 11, 'up');
  await page.keyboard.press('m');
  // The upgrade needs 60 gold, 10 wood and 3 guests served; record them so a refusal names what was short.
  const beforeUpgrade = await getState(page);
  const upgradeInputs = JSON.stringify({ gold: beforeUpgrade.gold, wood: beforeUpgrade.inventory.wood ?? 0,
    totalServed: beforeUpgrade.tavern.totalServed, panel: beforeUpgrade.tavernPanel, day: beforeUpgrade.day });
  await clickHospitalityControl(page, 'tavern-action-upgrade');
  await expect.poll(async () => (await getState(page)).tavern.level, { message: `upgrade refused; before the click ${upgradeInputs}` }).toBe(2);
  expect((await getState(page)).gold).toBe(12);
  await page.keyboard.press('e');
  await waitForClosedPanel(page);
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/room-upgraded.png' });
});

test('pause Save Game and title Continue restore a waiting order and its payment history', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const intro = window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('origin-intro-root');
    return (intro as unknown as { visible: boolean }).visible;
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await inScene(page, 'FarmScene');
  // A new adventure opens with Mayor Hollis's greeting; close it before walking to the shop.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await getState(page)).dialogue).toBeNull();
  await enterTavern(page);
  await restore(page);
  await openShop(page);
  await waitingOrder(page);
  await teleport(page, await orderColumn(page), 5, 'down');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavern.servedToday).toBe(1);
  await waitingOrder(page);
  const before = await getState(page);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('shopkeeperslegacy.save.v1.slot.1');
    return raw !== null && JSON.parse(raw).state.tavern.servedToday === 1;
  });
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.keyboard.press('Enter');
  await inScene(page, 'TavernScene');
  const resumed = await getState(page);
  // Moving departures advance with real frames; order identity and payment history stay durable.
  expect(resumed.tavern.guests.filter(guest => guest.phase === 'waiting').map(({ elapsedMs: _elapsed, ...guest }) => guest))
    .toEqual(before.tavern.guests.filter(guest => guest.phase === 'waiting').map(({ elapsedMs: _elapsed, ...guest }) => guest));
  expect(resumed.tavern).toMatchObject({ totalServed: 1, servedToday: 1, revenue: 12, tavernOpen: true });
  expect(resumed.inventory.stew).toBe(3);
  expect(resumed.gold).toBe(12);
  expect(resumed.player).toEqual(before.player);
  expect(resumed.tavernPanel).toBe(null);
  await teleport(page, await orderColumn(page), 5, 'down');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).gold).toBe(24);
  expect((await getState(page)).tavern.servedToday).toBe(2);
});

test('reserved customer and spawn routes reject furniture and the bag blocks station purchases', async ({ page }) => {
  await bootGame(page);
  await enterTavern(page);
  const blocked = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live game module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite resolves the live game module.
    const { ItemPlacementSystem } = await import('/src/systems/ItemPlacementSystem.ts');
    const map = getMapData('TavernScene');
    return [[14, 15], [14, 16], [22, 2], [22, 3], [22, 4], [27, 3], [5, 2]]
      .map(([x, y]) => ItemPlacementSystem.canPlace(map, x, y, () => false, 'chest'));
  });
  expect(blocked).toEqual([false, false, false, false, false, false, false]);
  await give(page, 'wood', 20);
  await give(page, 'stone', 10);
  await teleport(page, 5, 11, 'up');
  await page.evaluate(async () => {
    // Count delivered intent, not just the final boolean, to catch duplicate native key handling.
    // @ts-expect-error Vite resolves the live game module.
    const { InputBus } = await import('/src/input/InputBus.ts');
    const probe = { toggles: 0, interactions: 0 };
    (window as unknown as { tavernInputProbe: typeof probe }).tavernInputProbe = probe;
    InputBus.instance.onAction((action: string) => {
      if (action === 'toggle-inventory') probe.toggles++;
      if (action === 'interact') probe.interactions++;
    });
  });
  await page.keyboard.press('i');
  await expect.poll(async () => (await getState(page)).inventoryOpen).toBe(true);
  await page.keyboard.press('e');
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { tavernInputProbe: { interactions: number } }).tavernInputProbe.interactions)).toBe(1);
  expect(await page.evaluate(() =>
    (window as unknown as { tavernInputProbe: { toggles: number } }).tavernInputProbe.toggles)).toBe(1);
  expect((await getState(page)).tavernPanel).toBe(null);
  expect((await getState(page)).tavern.level).toBe(0);
});

test('WebGL tavern room and menu render without errors at desktop and compact sizes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&renderer=webgl&seed=42');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  await enterTavern(page);
  await restore(page);
  await openShop(page);
  await waitingOrder(page);
  await teleport(page, await orderColumn(page), 5, 'down');
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/webgl-service.png' });
  await page.setViewportSize({ width: 800, height: 500 });
  await teleport(page, 5, 11, 'up');
  await page.keyboard.press('m');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('ledger');
  await page.screenshot({ path: '.frontend-loop/tavern-opening/screenshots/compact-ledger.png' });
  expect(errors).toEqual([]);
});

test('replayed native management and bag events produce one action, while separate presses still work', async ({ page }) => {
  await bootGame(page);
  await enterTavern(page);
  await restore(page);
  await teleport(page, 5, 11, 'up');
  const actual = await page.evaluate(() => {
    const world = window.__GAME__!.scene.getScene('TavernScene');
    const keyboard = world.input.keyboard!;
    /** Replay the exact same native event through Phaser's bound key, as parallel plugins do. */
    const replay = (code: number, letter: string): void => {
      const key = keyboard.keys[code];
      const event = new KeyboardEvent('keydown', { key: letter });
      key.emit('down', key, event);
      key.emit('down', key, event);
    };
    replay(77, 'm');
    const firstPanel = window.__TEST__!.state().tavernPanel;
    replay(69, 'e');
    const secondPanel = window.__TEST__!.state().tavernPanel;
    replay(73, 'i');
    const firstBag = window.__TEST__!.state().inventoryOpen;
    replay(9, 'Tab');
    const secondBag = window.__TEST__!.state().inventoryOpen;
    const tavern = window.__TEST__!.state().tavern;
    return { firstPanel, secondPanel, firstBag, secondBag, innOpen: tavern.innOpen, tavernOpen: tavern.tavernOpen };
  });
  expect(actual).toEqual({ firstPanel: 'ledger', secondPanel: null, firstBag: true, secondBag: false, innOpen: false, tavernOpen: false });
});

test('mouse confirms restoration without swinging a tool behind the ledger', async ({ page }) => {
  await bootGame(page);
  await enterTavern(page);
  await give(page, 'wood', 20);
  await give(page, 'stone', 10);
  await teleport(page, 5, 11, 'up');
  await page.keyboard.press('e');
  await page.waitForFunction(() => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel');
    return (panel as unknown as { visible: boolean }).visible;
  });
  const before = await getState(page);
  await clickHospitalityControl(page, 'tavern-action-restore');
  await expect.poll(async () => (await getState(page)).tavern.level).toBe(1);
  expect((await getState(page)).player.stamina).toBe(before.player.stamina);
  expect((await getState(page)).inventory.stew).toBe(4);
});
