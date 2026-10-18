/** Hospitality transaction regressions. Native station input lives in hospitality-playthrough.spec.ts. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame as bootBase } from './helpers/gameHarness';

/** Install placed stations without changing the active Phaser scene; tests advance the pure system. */
async function bootGame(page: Page): Promise<void> {
  await bootBase(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    const gs = GameState.instance;
    gs.placedItems = [
      { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
      { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
      { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
    ];
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
  });
}

test('station setup and both bar orientations derive stable reachable customer lanes', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { resolveTavernLayout } = await import('/src/systems/TavernLayout.ts');
    // @ts-expect-error Runtime module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance, map = getMapData('TavernScene'), fixture = structuredClone(gs.placedItems);
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
    gs.addItem('wood', 20); gs.addItem('stone', 10); TavernSystem.repair();
    const missing = ['register', 'bar', 'stove'].map(item => {
      gs.placedItems = fixture.filter((placed: { item: string }) => placed.item !== item);
      const before = JSON.stringify(gs.toSaveData()), ready = TavernSystem.canOpen();
      return { ok: ready.ok, atomic: before === JSON.stringify(gs.toSaveData()) };
    });
    gs.placedItems = fixture;
    const horizontal = TavernSystem.layout();
    gs.placedItems = fixture.map((item: { item: string }) => item.item === 'bar' ? { ...item, rotation: 1 } : item);
    const vertical = TavernSystem.layout();
    const stable = JSON.stringify(vertical) === JSON.stringify(resolveTavernLayout({ map, placedItems: [...gs.placedItems].reverse() }));
    const trapped = structuredClone(map); trapped.solid[15][14] = true;
    const blockedEntry = resolveTavernLayout({ map: trapped, placedItems: fixture }).ok;
    const blockers = [14, 15].map(tx => ({ item: 'chair', scene: 'TavernScene', tx, ty: 5, rotation: 0 }));
    const blockedKeeper = resolveTavernLayout({ map, placedItems: [...fixture, ...blockers] }).ok;
    return { missing, horizontal, vertical, stable, blockedEntry, blockedKeeper };
  });
  expect(actual.missing).toEqual([{ ok: false, atomic: true }, { ok: false, atomic: true }, { ok: false, atomic: true }]);
  expect(actual.horizontal).toMatchObject({ ok: true, innOk: true, service: { keeper: { tx: 14, ty: 5, facing: 'down' }, guest: { tx: 14, ty: 7 } } });
  expect(actual.vertical).toMatchObject({ ok: true, service: { keeper: { tx: 13, ty: 7, facing: 'right' }, guest: { tx: 15, ty: 7 } } });
  expect(actual.horizontal.destinations).toHaveLength(2);
  expect(actual.horizontal.service.path[0]).toEqual({ tx: 14, ty: 15 });
  expect(actual.stable).toBe(true);
  expect([actual.blockedEntry, actual.blockedKeeper]).toEqual([false, false]);
});

test('repair and food or ale batches are exact, capacity-safe, and atomic on refusal', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    const gs = GameState.instance;
    gs.addItem('wood', 20); gs.addItem('stone', 9);
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
    const before = JSON.stringify(gs.toSaveData()), identity = gs.inventory;
    const failed = system.repair(), atomic = before === JSON.stringify(gs.toSaveData()) && identity === gs.inventory;
    gs.addItem('stone', 1); const repaired = system.repair(), duplicate = system.repair();
    gs.tavernPanel = 'kitchen'; gs.player = { ...gs.player, x: 104, y: 104, facing: 'up' };
    gs.addItem('parsnip', 7);
    const five = system.cook('parsnip', 5), max = system.cook('parsnip', 'max');
    const cooked = gs.inventory.stew;
    const missingBefore = JSON.stringify(gs.toSaveData()), missing = system.cook('parsnip');
    const missingAtomic = missingBefore === JSON.stringify(gs.toSaveData());
    gs.addItem('wood', 7); gs.gold = 56;
    const brewedFive = system.brew(5), brewedMax = system.brew('max');
    const stock = { portions: gs.inventory.stew, ale: gs.inventory.ale, gold: gs.gold, wood: gs.inventory.wood };
    const noFuelBefore = JSON.stringify(gs.toSaveData()), noFuel = system.brew();
    const fuelAtomic = noFuelBefore === JSON.stringify(gs.toSaveData());
    gs.addItem('parsnip', 1); gs.inventory.stew = Number.MAX_SAFE_INTEGER - 2;
    const overflowBefore = JSON.stringify(gs.toSaveData()), overflow = system.cook('parsnip');
    const overflowAtomic = overflowBefore === JSON.stringify(gs.toSaveData());
    return { failed, atomic, repaired, duplicate, five, max, cooked, missing, missingAtomic, brewedFive, brewedMax,
      stock, noFuel, fuelAtomic, overflow, overflowAtomic, unsupported: system.cook('__proto__').ok };
  });
  expect(actual.atomic && actual.missingAtomic && actual.fuelAtomic && actual.overflowAtomic).toBe(true);
  expect(actual.repaired.ok && actual.five.ok && actual.max.ok && actual.brewedFive.ok && actual.brewedMax.ok).toBe(true);
  expect(actual.failed.ok || actual.duplicate.ok || actual.missing.ok || actual.noFuel.ok || actual.overflow.ok || actual.unsupported).toBe(false);
  expect(actual.cooked).toBe(32);
  expect(actual.stock).toEqual({ portions: 32, ale: 28, gold: 0, wood: undefined });
});

test('station and modal guards reject remote transactions; held toolbar furniture does not freeze guests', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    const gs = GameState.instance;
    gs.addItem('wood', 20); gs.addItem('stone', 10);
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
    gs.activeScene = 'FarmScene'; const outside = system.repair();
    gs.activeScene = 'TavernScene'; gs.player.x = 400; const distant = system.repair();
    gs.player.x = 88; system.repair(); system.open();
    const fields = ['paused', 'transitionActive', 'pauseConfirmOpen', 'inventoryOpen', 'chestOpen', 'craftingOpen', 'binOpen'];
    const frozen = fields.map(field => {
      gs[field] = true;
      const before = JSON.stringify(gs.tavern); system.tick(1000); const denied = system.close();
      const same = before === JSON.stringify(gs.tavern) && !denied.ok; gs[field] = false; return same;
    });
    gs.tavernPanel = 'kitchen'; system.tick(1000); const panelFrozen = gs.tavern.guests.every((guest: { elapsedMs: number }) => guest.elapsedMs === 0);
    gs.tavernPanel = null; gs.placingItem = 'table'; gs.placingSource = 'toolbelt'; system.tick(900);
    const heldProgress = gs.tavern.admissionMs;
    gs.placingSource = 'inventory'; const before = JSON.stringify(gs.tavern); system.tick(900);
    return { outside, distant, frozen, panelFrozen, heldProgress, inventoryFrozen: before === JSON.stringify(gs.tavern) };
  });
  expect(actual.outside.ok || actual.distant.ok).toBe(false);
  expect(actual.frozen.every(Boolean) && actual.panelFrozen && actual.inventoryFrozen).toBe(true);
  expect(actual.heldProgress).toBe(900);
});

test('manual closure dismisses unpaid guests, keeps furniture locked until exit, and permits reopening', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { ItemPlacementSystem: placement } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Runtime module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance;
    gs.addItem('wood', 30); gs.addItem('stone', 10); gs.addItem('chair', 1);
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
    system.repair(); const early = system.upgrade();
    system.open(); system.tick(18000);
    const before = JSON.stringify(gs.toSaveData());
    const guards = [placement.canPlace(getMapData('TavernScene'), 10, 12, () => false, 'chair'),
      placement.place('chair', 'TavernScene', 10, 12), placement.pickup('TavernScene', 5, 10), placement.remove('TavernScene', 5, 10)];
    const atomic = before === JSON.stringify(gs.toSaveData()), accepted = gs.tavern.guests.length;
    const closed = system.close(), locked = system.isLayoutLocked(), leaving = gs.tavern.guests.every((guest: { phase: string }) => guest.phase === 'leaving');
    system.tick(20000); const unlocked = !system.isLayoutLocked(), reopened = system.open();
    return { early, guards, atomic, closed, accepted, locked, leaving, unlocked, reopened, sales: gs.tavern.totalServed };
  });
  expect(actual.guards).toEqual([false, false, null, null]);
  expect(actual.atomic && actual.locked && actual.unlocked && actual.leaving).toBe(true);
  expect(actual.early.ok).toBe(false);
  expect(actual.closed.ok && actual.reopened.ok).toBe(true);
  expect(actual.accepted).toBeGreaterThan(0);
  expect(actual.sales).toBe(0);
});

test('insufficient upgrade materials never spend gold and current saves detach every nested guest', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const gs = GameState.instance;
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 184, facing: 'up' };
    gs.addItem('wood', 20); gs.addItem('stone', 10); system.repair();
    gs.tavern.totalServed = 3; gs.tavern.foodSold = 3; gs.tavern.revenue = 36; gs.gold = 60;
    const before = JSON.stringify(gs.toSaveData()), identity = gs.inventory, denied = system.upgrade();
    const atomic = before === JSON.stringify(gs.toSaveData()) && identity === gs.inventory;
    system.open(); system.tick(3400); SaveSystem.save(2, 123);
    const original = structuredClone(gs.tavern), saved = gs.toSaveData();
    saved.tavern.guests[0].elapsedMs = 999;
    const detached = gs.tavern.guests[0].elapsedMs === 600;
    SaveSystem.load(2);
    const resumed = structuredClone(GameState.instance.tavern);
    const current = GameState.instance, corrupt = current.toSaveData();
    corrupt.placedItems = corrupt.placedItems.filter((item: { item: string }) => item.item !== 'bar');
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: SAVE_VERSION, slot: 2, savedAt: 124, state: corrupt }));
    let error = '';
    try { SaveSystem.load(2); } catch (caught) { error = String(caught); }
    return { denied, atomic, detached, original, resumed, rejected: error.includes('active tavern layout') && GameState.instance === current };
  });
  expect(actual.denied.ok).toBe(false);
  expect(actual.atomic && actual.detached && actual.rejected).toBe(true);
  expect(actual.resumed).toEqual(actual.original);
});
