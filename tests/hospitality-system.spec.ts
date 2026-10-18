/** Room bookings, connected-table seats, independent stock, and strict migration contracts. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

/** Restore an isolated logical shop, including one chair facing a connected-table edge. */
async function readyShop(page: Page): Promise<void> {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
    const gs = GameState.instance;
    gs.placedItems = [
      { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
      { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
      { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
      { item: 'table', scene: 'TavernScene', tx: 9, ty: 10, rotation: 0 },
      { item: 'table', scene: 'TavernScene', tx: 11, ty: 10, rotation: 0 },
      { item: 'chair', scene: 'TavernScene', tx: 9, ty: 11, rotation: 2 },
    ];
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    gs.addItem('wood', 20); gs.addItem('stone', 10); TavernSystem.repair();
  });
}

test('three one-night rooms pay once, retain stays when closed, and checkout visibly frees capacity', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { validateTavernState } = await import('/src/config/Tavern.ts');
    const gs = GameState.instance, startGold = gs.gold;
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const opened = system.openInn(), duplicates: boolean[] = [], phases: string[] = [];
    for (let index = 0; index < 3; index++) {
      system.tick(10000);
      const guest = gs.tavern.guests.find((guest: { kind: string; phase: string }) => guest.kind === 'inn' && guest.phase === 'waiting');
      if (!system.checkIn(guest.id).ok) throw new Error('Expected room payment');
      phases.push(guest.phase);
      const before = JSON.stringify(gs.toSaveData());
      duplicates.push(!system.checkIn(guest.id).ok && before === JSON.stringify(gs.toSaveData()));
      system.tick(10000);
    }
    const full = { vacancies: system.stock().vacancies, rooms: gs.tavern.reservations.length, guests: gs.tavern.guests.length, paid: gs.gold - startGold };
    const closed = system.closeInn(), reopenFull = system.openInn(), locked = system.isLayoutLocked();
    const stayed = structuredClone(gs.tavern.reservations);
    const detached = gs.toSaveData(); detached.tavern.reservations[0].checkoutDay = 99;
    const detachedRoom = gs.tavern.reservations[0].checkoutDay === gs.day + 1;
    gs.day++; system.onNewDay(); validateTavernState(gs.tavern, gs.day);
    const dawn = { rooms: gs.tavern.reservations.length, vacancies: system.stock().vacancies,
      phases: gs.tavern.guests.map((guest: { phase: string }) => guest.phase), innOpen: gs.tavern.innOpen };
    const routes = system.guestViews().map((view: { path: { tx: number; ty: number }[] }) => ({ first: view.path[0], last: view.path[view.path.length - 1] }));
    system.tick(10000);
    const unlocked = !system.isLayoutLocked(), reopen = system.openInn();
    return { opened, duplicates, phases, full, closed, reopenFull, locked, stayed, detachedRoom, dawn, routes, unlocked, reopen };
  });
  expect(actual.opened.ok && actual.closed.ok && actual.reopen.ok && actual.detachedRoom && actual.locked && actual.unlocked).toBe(true);
  expect(actual.duplicates.every(Boolean)).toBe(true);
  expect(actual.phases).toEqual(['ascending', 'ascending', 'ascending']);
  expect(actual.full).toEqual({ vacancies: 0, rooms: 3, guests: 3, paid: 72 });
  expect(actual.reopenFull.ok).toBe(false);
  expect(actual.stayed).toHaveLength(3);
  expect(actual.dawn).toEqual({ rooms: 0, vacancies: 3, phases: ['leaving', 'leaving', 'leaving'], innOpen: false });
  for (const route of actual.routes) expect(route.last).toEqual({ tx: 14, ty: 15 });
});

test('empty stock leaves both services open and arriving orders do not fabricate products', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { applyInventoryDelta } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    applyInventoryDelta(gs, { stew: -gs.inventory.stew });
    const openedInn = system.openInn(), openedTavern = system.open(), immediate = gs.tavern.guests.length;
    system.tick(30000);
    return { openedInn, openedTavern, immediate, stock: system.stock(), waiting: gs.tavern.guests.some((guest: { phase: string }) => guest.phase === 'waiting'),
      open: gs.tavern.innOpen && gs.tavern.tavernOpen, sales: gs.tavern.totalServed };
  });
  expect(actual.openedInn.ok && actual.openedTavern.ok && actual.open && actual.waiting).toBe(true);
  expect(actual.immediate).toBe(0); expect(actual.sales).toBe(0);
  expect(actual.stock).toMatchObject({ food: 0, ale: 0, availableFood: 0, availableAle: 0 });
});

test('connected table seats face inward and perpendicular bars never double-book a physical tile', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { resolveTavernLayout } = await import('/src/systems/TavernLayout.ts');
    // @ts-expect-error Runtime module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance, map = getMapData('TavernScene'), fixture = structuredClone(gs.placedItems);
    const seats = resolveTavernLayout({ map, placedItems: fixture }).destinations.filter((destination: { kind: string }) => destination.kind === 'seat');
    const backwards = fixture.map((item: { item: string }) => item.item === 'chair' ? { ...item, rotation: 0 } : item);
    const noSeats = resolveTavernLayout({ map, placedItems: backwards }).destinations.filter((destination: { kind: string }) => destination.kind === 'seat').length;
    const perpendicular = fixture.filter((item: { item: string }) => item.item !== 'bar' && item.item !== 'stove').concat([
      { item: 'stove', scene: 'TavernScene', tx: 20, ty: 5, rotation: 0 },
      { item: 'bar', scene: 'TavernScene', tx: 5, ty: 5, rotation: 0 },
      { item: 'bar', scene: 'TavernScene', tx: 5, ty: 6, rotation: 1 },
    ]);
    const joined = resolveTavernLayout({ map, placedItems: perpendicular });
    const keys = joined.destinations.map((destination: { tile: { tx: number; ty: number } }) => destination.tile.tx + ',' + destination.tile.ty);
    return { seats, noSeats, unique: new Set(keys).size === keys.length, sharedTile: keys.filter((key: string) => key === '6,6').length };
  });
  expect(actual.seats).toHaveLength(1);
  expect(actual.seats[0]).toMatchObject({ id: 'seat:9,11', facing: 'up', tile: { tx: 9, ty: 11 } });
  expect(actual.noSeats).toBe(0);
  expect(actual.unique).toBe(true);
  expect(actual.sharedTile).toBe(1);
});

test('legacy v6 arrivals and paid departures migrate without duplicate money; corrupt current guests reject', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { migrateLegacyTavernState, migrateV7TavernState, validateTavernLayoutState } = await import('/src/systems/TavernLayout.ts');
    // @ts-expect-error Runtime module.
    const { validateTavernState } = await import('/src/config/Tavern.ts');
    // @ts-expect-error Runtime module.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance, map = getMapData('TavernScene');
    const base = { level: 1, portions: 3, welcomeClaimed: true, serviceDay: gs.day, quota: 3,
      servedToday: 1, totalServed: 1, revenue: 12, phase: 'leaving', phaseElapsedMs: 400 };
    const paid = migrateV7TavernState(migrateLegacyTavernState(base, gs.day, gs.placedItems, map), gs.day, gs.placedItems, map);
    const waiting = migrateV7TavernState(migrateLegacyTavernState({ ...base, phase: 'waiting', phaseElapsedMs: 0 }, gs.day, gs.placedItems, map), gs.day, gs.placedItems, map);
    const arriving = migrateV7TavernState(migrateLegacyTavernState({ ...base, phase: 'arriving', phaseElapsedMs: 900 }, gs.day, gs.placedItems, map), gs.day, gs.placedItems, map);
    validateTavernState(paid, gs.day); validateTavernState(waiting, gs.day); validateTavernState(arriving, gs.day);
    const malformed = [null, {}, { ...paid, revenue: 13 }, { ...paid, portions: -1 },
      { ...paid, guests: [{ ...paid.guests[0], kind: 'tavern', phase: 'descending', product: 'food', roomId: null, destinationId: 'stairs-exit' }] },
      { ...waiting, portions: 0 }, { ...paid, nextGuestId: 1 },
      { ...paid, guests: [{ ...paid.guests[0], visitorId: 'rosa' }] },
      { ...paid, guests: [{ ...paid.guests[0], elapsedMs: Infinity }] }];
    const rejected = malformed.map(value => { try { validateTavernState(value, gs.day); return false; } catch { return true; } });
    const booked = { ...paid, guests: [], tavernOpen: false, roomBookings: 1, revenue: 36,
      reservations: [{ roomId: 1, guestId: 1, visitorId: paid.guests[0].visitorId, checkoutDay: gs.day + 1 }] };
    const blocked = structuredClone(map); blocked.solid[5][27] = true;
    let blockedCheckout = false;
    try { validateTavernLayoutState(booked, gs.placedItems, blocked); } catch (error) { blockedCheckout = String(error).includes('checkout route'); }
    return { paid, waiting, arriving, rejected, blockedCheckout };
  });
  expect(actual.paid).toMatchObject({ totalServed: 1, foodSold: 1, revenue: 12 });
  expect(actual.paid.guests[0]).toMatchObject({ phase: 'leaving', product: 'food' });
  expect(actual.waiting.guests[0].phase).toBe('waiting');
  expect(actual.arriving.guests[0].elapsedMs).toBeGreaterThan(0);
  expect(actual.rejected.every(Boolean) && actual.blockedCheckout).toBe(true);
});

test('morning closes unpaid dinner orders and upgraded service admits five visitors gradually', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { validateTavernState } = await import('/src/config/Tavern.ts');
    const gs = GameState.instance;
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    gs.placedItems.push({ item: 'bar', scene: 'TavernScene', tx: 19, ty: 10, rotation: 0 });
    gs.tavern.level = 2; gs.tavern.totalServed = 3; gs.tavern.foodSold = 3; gs.tavern.revenue = 36; gs.inventory.stew = 12;
    system.open(); system.tick(35000); const admitted = gs.tavern.guests.length;
    system.tick(10000);
    const before = structuredClone(gs.tavern.guests);
    gs.day++; system.onNewDay(); validateTavernState(gs.tavern, gs.day);
    return { admitted, before, after: gs.tavern.guests, open: gs.tavern.tavernOpen, reserved: system.stock().availableFood };
  });
  expect(actual.admitted).toBe(5);
  expect(actual.after.every((guest: { phase: string }) => guest.phase === 'leaving')).toBe(true);
  expect(actual.open).toBe(false);
  expect(actual.reserved).toBe(12);
});

test('room payment requires the register where that guest waits, not another register across the room', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    const gs = GameState.instance;
    gs.activeScene = 'TavernScene'; gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    gs.placedItems.push({ item: 'register', scene: 'TavernScene', tx: 20, ty: 12, rotation: 0 });
    system.openInn(); system.tick(10000);
    gs.player = { ...gs.player, x: 328, y: 216, facing: 'up' };
    const canManage = system.canInteract('ledger'), before = JSON.stringify(gs.toSaveData());
    const refused = system.checkIn(), atomic = before === JSON.stringify(gs.toSaveData());
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const paid = system.checkIn();
    return { canManage, refused, atomic, paid, bookings: gs.tavern.roomBookings };
  });
  expect(actual.canManage && actual.atomic && actual.paid.ok).toBe(true);
  expect(actual.refused.ok).toBe(false);
  expect(actual.bookings).toBe(1);
});

test('current saves resume paid stair travel and morning checkout without collecting room payment again', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const initial = GameState.instance;
    initial.activeScene = 'TavernScene'; initial.player = { ...initial.player, x: 88, y: 152, facing: 'down' };
    const initialGold = initial.gold;
    if (!system.openInn().ok) throw new Error('Persistence fixture cannot open its inn');
    system.tick(10000);
    const guestId = GameState.instance.tavern.guests[0].id;
    if (!system.checkIn(guestId).ok || !system.closeInn().ok) throw new Error('Persistence fixture cannot book and close its inn');
    system.tick(400);
    const ascending = structuredClone(GameState.instance.tavern);
    SaveSystem.save(1, 100);
    const paidBytes = localStorage.getItem(SaveSystem.storageKey(1));
    if (paidBytes === null) throw new Error('Expected paid-room save bytes');
    const paidVersion = JSON.parse(paidBytes).version;
    SaveSystem.load(1);
    const resumedAscending = structuredClone(GameState.instance.tavern);
    const beforeDuplicate = JSON.stringify(GameState.instance.toSaveData());
    const duplicate = system.checkIn(guestId);
    const duplicateAtomic = beforeDuplicate === JSON.stringify(GameState.instance.toSaveData());
    system.tick(10000);
    const occupied = { rooms: GameState.instance.tavern.reservations.length, visitors: GameState.instance.tavern.guests.length,
      gold: GameState.instance.gold, bookings: GameState.instance.tavern.roomBookings };
    GameState.instance.day += 1; system.onNewDay(); system.tick(360);
    const descending = structuredClone(GameState.instance.tavern);
    SaveSystem.save(1, 200);
    SaveSystem.load(1);
    const resumedDescending = structuredClone(GameState.instance.tavern);
    system.tick(10000);
    const completed = { gold: GameState.instance.gold, bookings: GameState.instance.tavern.roomBookings,
      revenue: GameState.instance.tavern.revenue, guests: GameState.instance.tavern.guests.length,
      vacancies: system.stock().vacancies, locked: system.isLayoutLocked() };
    return { initialGold, paidVersion, currentVersion: SAVE_VERSION, ascending, resumedAscending, duplicate, duplicateAtomic,
      occupied, descending, resumedDescending, completed };
  });
  expect(actual.paidVersion).toBe(30);
  expect(actual.currentVersion).toBe(30);
  expect(actual.ascending.guests[0]).toMatchObject({ phase: 'ascending', elapsedMs: 400 });
  expect(actual.resumedAscending).toEqual(actual.ascending);
  expect(actual.duplicate.ok).toBe(false);
  expect(actual.duplicateAtomic).toBe(true);
  expect(actual.occupied).toEqual({ rooms: 1, visitors: 1, gold: actual.initialGold + 24, bookings: 1 });
  expect(actual.descending.guests[0]).toMatchObject({ phase: 'leaving', elapsedMs: 360 });
  expect(actual.resumedDescending).toEqual(actual.descending);
  expect(actual.completed).toEqual({ gold: actual.initialGold + 24, bookings: 1, revenue: 24, guests: 0, vacancies: 3, locked: false });
});

test('actual v6 save envelopes preserve pending orders and already-paid departures without rewriting source bytes', async ({ page }) => {
  await readyShop(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module.
    const { TavernSystem: system } = await import('/src/systems/TavernSystem.ts');
    // @ts-expect-error Runtime module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Runtime module.
    const { applyInventoryDelta, moveOrSwap, findEntrySlot } = await import('/src/systems/InventoryLayoutSystem.ts');
    const initial = GameState.instance;
    initial.activeScene = 'TavernScene'; initial.player = { ...initial.player, x: 88, y: 152, facing: 'down' };
    applyInventoryDelta(initial, { stew: -initial.inventory.stew });
    const template = initial.toSaveData();
    const results = [];
    for (const phase of ['arriving', 'waiting', 'leaving']) {
      const elapsed = phase === 'arriving' ? 900 : phase === 'leaving' ? 400 : 0;
      const source = { ...template, gold: 112, tavern: { level: 1, portions: 3, welcomeClaimed: true,
        serviceDay: template.day, quota: 3, servedToday: 1, totalServed: 1, revenue: 12,
        phase, phaseElapsedMs: elapsed } };
      const bytes = JSON.stringify({ version: 6, slot: 2, savedAt: 50, state: source });
      localStorage.setItem(SaveSystem.storageKey(2), bytes);
      SaveSystem.load(2);
      const loaded = structuredClone(GameState.instance.tavern);
      const loadedGold = GameState.instance.gold;
      const identityBefore = GameState.instance;
      const detached = GameState.instance.toSaveData(); detached.tavern.guests[0].elapsedMs = 12345;
      const detachedGuest = GameState.instance.tavern.guests[0].elapsedMs !== 12345;
      if (phase === 'arriving') system.tick(2000);
      let sold = false;
      if (phase !== 'leaving') {
        const view = system.guestViews()[0], keeper = view.destination.keeper;
        if (keeper === null) throw new Error('Migrated order must still use its real service bar');
        GameState.instance.player = { ...GameState.instance.player, x: (keeper.tx + .5) * 16,
          y: (keeper.ty + .5) * 16, facing: keeper.facing };
        const sourceSlot = findEntrySlot(GameState.instance, 'stew');
        moveOrSwap(GameState.instance, sourceSlot, { container: 'toolbelt', index: 0 }); GameState.instance.hotbarIndex = 0;
        sold = system.serve(view.guest.id).ok;
      }
      const paid = JSON.stringify(GameState.instance.toSaveData());
      const duplicate = system.serve();
      const duplicateAtomic = paid === JSON.stringify(GameState.instance.toSaveData());
      GameState.instance.player = { ...GameState.instance.player, x: 88, y: 152, facing: 'down' };
      if (!system.close().ok) throw new Error('Migrated service could not close new admissions');
      system.tick(20000);
      results.push({ phase, loaded, loadedGold, sold, duplicate: duplicate.ok, duplicateAtomic, detachedGuest,
        sameInstalledInstance: GameState.instance === identityBefore,
        bytesUnchanged: localStorage.getItem(SaveSystem.storageKey(2)) === bytes,
        final: { gold: GameState.instance.gold, portions: GameState.instance.inventory.stew,
          revenue: GameState.instance.tavern.revenue, totalServed: GameState.instance.tavern.totalServed,
          guests: GameState.instance.tavern.guests.length } });
    }
    return results;
  });
  expect(actual).toHaveLength(3);
  for (const result of actual) {
    expect(result.loadedGold).toBe(112);
    expect(result.loaded.guests[0].phase).toBe(result.phase);
    expect(result.loaded).toMatchObject({ revenue: 12, totalServed: 1, foodSold: 1 });
    expect(result.bytesUnchanged && result.detachedGuest && result.duplicateAtomic && result.sameInstalledInstance).toBe(true);
    expect(result.duplicate).toBe(false);
    const pending = result.phase !== 'leaving';
    expect(result.sold).toBe(pending);
    expect(result.final).toEqual(pending
      ? { gold: 124, portions: 2, revenue: 24, totalServed: 2, guests: 0 }
      : { gold: 112, portions: 3, revenue: 12, totalServed: 1, guests: 0 });
  }
});
