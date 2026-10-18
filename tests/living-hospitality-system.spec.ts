/** Living hospitality contracts: inventory transactions, saved pacing, room identity and guest agency. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

/** Load all modules before synchronous scenarios so the actual farm scene cannot overwrite test positions. */
async function prepare(page: Page): Promise<void> {
  await bootGame(page);
  await page.evaluate(async () => {
    const modules = await Promise.all([
      // @ts-expect-error Browser runtime module.
      import('/src/state/GameState.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/TavernSystem.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/config/Tavern.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/InventoryLayoutSystem.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/TavernLayout.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/world/MapDef.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/SaveSystem.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/config/Items.ts'),
    ]);
    const [state, system, config, inventory, layout, maps, saves, items] = modules;
    (window as any).__LIVING = { ...state, ...system, ...config, ...inventory, ...layout, ...maps, ...saves, ...items,
      /** Reset owned shop state without touching browser save slots. */
      reset() {
        const gs = state.GameState.instance;
        gs.activeScene = 'TavernScene'; gs.tavernPanel = null; gs.placingItem = null;
        gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
        gs.placedItems = [
          { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
          { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
          { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
          { item: 'table', scene: 'TavernScene', tx: 9, ty: 10, rotation: 0 },
          { item: 'chair', scene: 'TavernScene', tx: 9, ty: 11, rotation: 2 },
        ];
        gs.tavern = config.createTavernState(); gs.addItem('wood', 20); gs.addItem('stone', 10);
        if (!system.TavernSystem.repair().ok) throw new Error('Test shop repair failed');
        return gs;
      },
      /** Equip one existing stack using the same atomic slot swap as the inventory UI. */
      equip(item: string) {
        const gs = state.GameState.instance, source = inventory.findEntrySlot(gs, item);
        if (!source) throw new Error('Missing test item ' + item);
        inventory.moveOrSwap(gs, source, { container: 'toolbelt', index: 0 }); gs.hotbarIndex = 0;
      },
      /** Face a waiting guest using their derived seat or exact bar keeper lane. */
      approach(id: number) {
        const gs = state.GameState.instance, view = system.TavernSystem.guestViews().find((candidate: any) => candidate.guest.id === id);
        if (!view) throw new Error('Missing visible guest');
        const keeper = view.destination.keeper;
        gs.player = keeper ? { ...gs.player, x: (keeper.tx + .5) * 16, y: (keeper.ty + .5) * 16, facing: keeper.facing }
          : { ...gs.player, x: (view.destination.tile.tx + .5) * 16, y: (view.destination.tile.ty + 1.5) * 16, facing: 'up' };
      },
      /** Stop exactly at a selected guest phase, preserving all intermediate transitions. */
      until(predicate: () => boolean, limit = 120000) {
        let elapsed = 0;
        while (!predicate() && elapsed < limit) { system.TavernSystem.tick(100); elapsed += 100; }
        if (!predicate()) throw new Error('Guest phase did not arrive within test budget');
      },
    };
  });
}

test('admissions are paced, save-replay deterministic, and no stock never closes either service', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    h.applyInventoryDelta(gs, { stew: -gs.inventory.stew });
    const opened = system.open().ok && system.openInn().ok, immediate = gs.tavern.guests.length;
    system.tick(2799); const before = gs.tavern.guests.length; system.tick(1); const first = gs.tavern.guests.length;
    const saved = h.cloneTavernState(gs.tavern); system.tick(9000); const future = JSON.stringify(gs.tavern);
    gs.tavern = saved; for (let index = 0; index < 90; index++) system.tick(100);
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { opened, immediate, before, first, replay: JSON.stringify(gs.tavern) === future, open: gs.tavern.innOpen && gs.tavern.tavernOpen };
  });
  expect(result).toEqual({ opened: true, immediate: 0, before: 0, first: 1, replay: true, open: true });
});

test('world check-in requires keeper side, pays once, and same guest visits downstairs then checks out', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    system.openInn(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const guest = gs.tavern.guests[0], gold = gs.gold;
    gs.player = { ...gs.player, x: 72, y: 168, facing: 'right' }; const sideRejected = !system.checkIn(guest.id).ok;
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const paid = system.checkIn(guest.id).ok, duplicate = !system.checkIn(guest.id).ok; system.closeInn();
    h.until(() => guest.phase === 'upstairs'); const hidden = system.guestViews().every((view: any) => view.guest.id !== guest.id);
    gs.tavern = h.validateTavernState(h.cloneTavernState(gs.tavern), gs.day);
    const resident = gs.tavern.guests[0]; h.until(() => resident.phase === 'descending');
    const downstairsEndpoint = resident.route[resident.route.length - 1];
    h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    h.until(() => resident.phase === 'chatting'); const downstairs = resident.id === guest.id && gs.tavern.reservations[0].guestId === guest.id;
    h.until(() => resident.phase === 'upstairs'); const money = gs.gold - gold;
    gs.day++; system.onNewDay(); h.validateTavernState(gs.tavern, gs.day);
    const checkout = gs.tavern.reservations.length === 0 && resident.phase === 'leaving'; system.tick(20000);
    return { sideRejected, paid, duplicate, hidden, downstairs, downstairsEndpoint, money, checkout, left: gs.tavern.guests.length === 0 };
  });
  expect(result).toEqual({ sideRejected: true, paid: true, duplicate: true, hidden: true, downstairs: true, downstairsEndpoint: { tx: 27, ty: 5 }, money: 24, checkout: true, left: true });
});

test('serving needs the matching held stack, charges once, and patience causes anger then departure without closing', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    system.open(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const guest = gs.tavern.guests.find((guest: any) => guest.phase === 'waiting');
    h.approach(guest.id); const wrong = !system.serve(guest.id).ok;
    const item = guest.product === 'food' ? 'stew' : 'ale'; gs.addItem(item, 2); h.equip(item);
    const quantity = gs.inventory[item], gold = gs.gold; const served = system.serve(guest.id).ok, duplicate = !system.serve(guest.id).ok;
    const exact = gs.inventory[item] === quantity - 1 && gs.gold - gold === (item === 'stew' ? 12 : 8);
    h.until(() => gs.tavern.guests.some((candidate: any) => candidate.phase === 'waiting' && candidate.id !== guest.id));
    const impatient = gs.tavern.guests.find((candidate: any) => candidate.phase === 'waiting' && candidate.id !== guest.id);
    h.until(() => impatient.elapsedMs >= h.TAVERN_ANGRY_MS);
    const angry = system.guestViews().find((view: any) => view.guest.id === impatient.id).mood === 'angry';
    h.until(() => !gs.tavern.guests.some((candidate: any) => candidate.id === impatient.id));
    const sequence = gs.tavern.nextGuestId; system.tick(25000);
    return { wrong, served, duplicate, exact, angry, open: gs.tavern.tavernOpen, arrivalsContinue: gs.tavern.nextGuestId > sequence };
  });
  expect(result).toEqual({ wrong: true, served: true, duplicate: true, exact: true, angry: true, open: true, arrivalsContinue: true });
});

test('repeat ale orders become drunk and broom refuses sober guests but preserves a drunk lodger room', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    gs.tavern.nextGuestId = 2; system.openInn(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const resident = gs.tavern.guests[0]; system.checkIn(resident.id); system.closeInn(); system.open();
    gs.addItem('ale', 8); gs.addItem('broom', 1);
    h.until(() => resident.phase === 'waiting' && resident.product === 'ale');
    h.approach(resident.id); h.equip('broom'); const sober = !system.eject(resident.id).ok;
    for (let index = 0; index < 3; index++) {
      h.until(() => resident.phase === 'waiting' && resident.product === 'ale'); h.approach(resident.id); h.equip('ale');
      if (!system.serve(resident.id).ok) throw new Error('Expected held ale sale');
    }
    h.equip('broom'); const view = system.guestViews().find((candidate: any) => candidate.guest.id === resident.id);
    const drunk = view.mood === 'drunk', room = gs.tavern.reservations[0].roomId;
    const tile = resident.route[resident.route.length - 1]; gs.player = { ...gs.player, x: (tile.tx + .5) * 16, y: (tile.ty + 1.5) * 16, facing: 'up' };
    const ejected = system.eject(resident.id).ok;
    return { sober, drunk, ejected, phase: resident.phase, drinks: resident.drinks, roomKept: gs.tavern.reservations[0].roomId === room, bookings: gs.tavern.roomBookings };
  });
  expect(result).toEqual({ sober: true, drunk: true, ejected: true, phase: 'ascending', drinks: 3, roomKept: true, bookings: 1 });
});

test('batch cooking and brewing atomically reject a full bag', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    h.applyInventoryDelta(gs, { stew: -gs.inventory.stew }); gs.addItem('parsnip', 3); gs.addItem('wood', 3); gs.gold = 24;
    let index = 0; while (gs.backpackSlots.includes(null)) gs.addItem('capacity-fixture-' + index++, 1);
    gs.player = { ...gs.player, x: 104, y: 104, facing: 'up' };
    const before = JSON.stringify({ inventory: gs.inventory, gold: gs.gold, slots: gs.backpackSlots });
    const cook = system.cook('parsnip').ok, brew = system.brew().ok;
    return { cook, brew, unchanged: JSON.stringify({ inventory: gs.inventory, gold: gs.gold, slots: gs.backpackSlots }) === before };
  });
  expect(result).toEqual({ cook: false, brew: false, unchanged: true });
});

test('prepared stack limits reject overflow while existing stacks accept output in a full bag', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    gs.addItem('parsnip', 3); gs.addItem('wood', 3); gs.addItem('ale', 1); gs.gold = 24;
    gs.inventory.stew = Number.MAX_SAFE_INTEGER - 2; gs.inventory.ale = Number.MAX_SAFE_INTEGER - 2;
    gs.player = { ...gs.player, x: 104, y: 104, facing: 'up' };
    const before = JSON.stringify({ inventory: gs.inventory, gold: gs.gold });
    const cooked = system.cook('parsnip').ok, brewed = system.brew().ok;
    const atomic = before === JSON.stringify({ inventory: gs.inventory, gold: gs.gold });
    gs.inventory.stew = 1; gs.inventory.ale = 1;
    let index = 0; while (gs.backpackSlots.includes(null)) gs.addItem('capacity-fixture-' + index++, 1);
    const existingStack = system.cook('parsnip').ok && system.brew().ok;
    gs.tavern = h.createTavernState(); gs.inventory.stew = Number.MAX_SAFE_INTEGER - 2;
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const repairBefore = JSON.stringify({ inventory: gs.inventory, tavern: gs.tavern });
    const repair = system.repair().ok, repairAtomic = repairBefore === JSON.stringify({ inventory: gs.inventory, tavern: gs.tavern });
    return { cooked, brewed, atomic, existingStack, repair, repairAtomic };
  });
  expect(result).toEqual({ cooked: false, brewed: false, atomic: true, existingStack: true, repair: false, repairAtomic: true });
});

test('v7 blocked-front migration preserves paid rooms and recycled wardrobes while unpaid queue leaves', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), map = h.getMapData('TavernScene');
    gs.placedItems.push({ item: 'chair', scene: 'TavernScene', tx: 5, ty: 11, rotation: 0 });
    const old = { ...h.createV7TavernState(), level: 1, welcomeClaimed: true, serviceDay: gs.day, portions: 3, ale: 2,
      roomBookings: 1, totalServed: 1, foodSold: 1, revenue: 36, innOpen: true, tavernOpen: true, nextGuestId: 9,
      reservations: [{ roomId: 1, guestId: 1, visitorId: 'visitor-alder', checkoutDay: gs.day + 1 }],
      guests: [
        { id: 7, visitorId: 'visitor-alder', kind: 'tavern', phase: 'waiting', elapsedMs: 0, destinationId: 'bar:14,6', product: 'food', roomId: null },
        { id: 8, visitorId: 'visitor-iris', kind: 'inn', phase: 'waiting', elapsedMs: 0, destinationId: 'register:5,10', product: null, roomId: 2 },
      ] };
    const before = JSON.stringify(old), migrated = h.migrateV7TavernState(old, gs.day, gs.placedItems, map);
    h.validateTavernState(migrated, gs.day); h.validateTavernLayoutState(migrated, gs.placedItems, map);
    return { unchanged: JSON.stringify(old) === before, innOpen: migrated.innOpen, room: migrated.reservations[0],
      occupant: migrated.guests.find((guest: any) => guest.id === 1).phase, pending: migrated.guests.find((guest: any) => guest.id === 8).phase,
      foodOrder: migrated.guests.find((guest: any) => guest.id === 7).product, revenue: migrated.revenue };
  });
  expect(result).toMatchObject({ unchanged: true, innOpen: false, occupant: 'upstairs', pending: 'leaving', foodOrder: 'food', revenue: 36 });
  expect(result.room).toMatchObject({ roomId: 1, guestId: 1, visitorId: 'visitor-alder' });
});

test('strict saved routes and room owners reject contradictions, and guest rendering views are detached', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    system.openInn(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const pending = h.cloneTavernState(gs.tavern); pending.guests[0].route = [{ tx: 14, ty: 15 }];
    let wrongPosition = false;
    try { h.validateTavernLayoutState(pending, gs.placedItems, h.getMapData('TavernScene')); } catch { wrongPosition = true; }
    system.checkIn(); const owner = h.cloneTavernState(gs.tavern);
    owner.guests[0].kind = 'tavern'; owner.guests[0].roomId = null; owner.guests[0].phase = 'leaving';
    let wrongOwner = false;
    try { h.validateTavernState(owner, gs.day); } catch { wrongOwner = true; }
    const wrongProducts = ['arriving', 'waiting', 'eating', 'lingering'].map(phase => {
      const invalid = h.cloneTavernState(gs.tavern);
      invalid.totalServed = 1; invalid.foodSold = 1; invalid.revenue += 12;
      invalid.guests[0].phase = phase; invalid.guests[0].product = null; invalid.guests[0].orders = 1;
      try { h.validateTavernState(invalid, gs.day); return false; } catch { return true; }
    });
    const before = JSON.stringify(gs.tavern), view = system.guestViews()[0];
    view.path[0].tx = 999; view.guest.route[0].ty = 999;
    return { wrongPosition, wrongOwner, wrongProducts: wrongProducts.every(Boolean), detached: before === JSON.stringify(gs.tavern) };
  });
  expect(result).toEqual({ wrongPosition: true, wrongOwner: true, wrongProducts: true, detached: true });
});

test('tavern-only departures save without requiring access to inn stairs', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    gs.placedItems.push({ item: 'chair', scene: 'TavernScene', tx: 27, ty: 5, rotation: 0 });
    const layout = system.layout(), opened = system.open().ok;
    system.tick(18000); system.close();
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { opened, tavernReady: layout.ok, innReady: layout.innOk, leaving: gs.tavern.guests.every((guest: any) => guest.phase === 'leaving') };
  });
  expect(result).toEqual({ opened: true, tavernReady: true, innReady: false, leaving: true });
});

test('v7 check-in queue moves to the next usable register front without changing its identity or price', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), map = h.getMapData('TavernScene');
    gs.placedItems.push({ item: 'chair', scene: 'TavernScene', tx: 5, ty: 11, rotation: 0 },
      { item: 'register', scene: 'TavernScene', tx: 20, ty: 12, rotation: 0 });
    const old = { ...h.createV7TavernState(), level: 1, welcomeClaimed: true, serviceDay: gs.day, portions: 4,
      innOpen: true, nextGuestId: 2, guests: [{ id: 1, visitorId: 'visitor-alder', kind: 'inn', phase: 'arriving',
        elapsedMs: 600, destinationId: 'register:5,10', product: null, roomId: 1 }] };
    const state = h.migrateV7TavernState(old, gs.day, gs.placedItems, map);
    h.validateTavernState(state, gs.day); h.validateTavernLayoutState(state, gs.placedItems, map);
    return { open: state.innOpen, guest: state.guests[0], bookings: state.roomBookings, revenue: state.revenue };
  });
  expect(result.open).toBe(true); expect(result.bookings).toBe(0); expect(result.revenue).toBe(0);
  expect(result.guest).toMatchObject({ id: 1, visitorId: 'visitor-alder', destinationId: 'register:20,12', roomId: 1 });
  expect(result.guest.elapsedMs).toBeGreaterThan(0);
  expect(result.guest.route.at(-1)).toEqual({ tx: 20, ty: 13 });
});

test('actual v9 envelope reload retains a paid dining lodger, consumed item and once-only money after closure', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    system.openInn(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const resident = gs.tavern.guests[0], gold = gs.gold;
    system.checkIn(resident.id); system.closeInn(); system.open();
    h.until(() => resident.phase === 'waiting' && resident.product !== null);
    const item = resident.product === 'food' ? 'stew' : 'ale'; gs.addItem(item, 2); h.equip(item); h.approach(resident.id);
    const stock = gs.inventory[item], price = resident.product === 'food' ? 12 : 8;
    if (!system.serve(resident.id).ok) throw new Error('Expected paid room guest to buy a held item');
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' }; system.close();
    const before = JSON.stringify(gs.toSaveData()); h.SaveSystem.save(2, 200);
    const bytes = localStorage.getItem(h.SaveSystem.storageKey(2)); h.SaveSystem.load(2);
    const current = h.GameState.instance, sameState = before === JSON.stringify(current.toSaveData());
    h.approach(resident.id); const duplicate = system.serve(resident.id).ok, duplicateRoom = system.checkIn(resident.id).ok;
    system.tick(15000);
    return { version: JSON.parse(bytes!).version, sameState, duplicate, duplicateRoom, stock: current.inventory[item], expectedStock: stock - 1,
      gold: current.gold - gold, expectedGold: 24 + price, room: current.tavern.reservations[0].guestId,
      identity: resident.id, bookings: current.tavern.roomBookings, sales: current.tavern.totalServed,
      bytesUnchanged: localStorage.getItem(h.SaveSystem.storageKey(2)) === bytes };
  });
  expect(result.version).toBe(30); expect(result.sameState && result.bytesUnchanged).toBe(true);
  expect(result.duplicate || result.duplicateRoom).toBe(false);
  expect(result.stock).toBe(result.expectedStock); expect(result.gold).toBe(result.expectedGold);
  expect(result.room).toBe(result.identity); expect(result.bookings).toBe(1); expect(result.sales).toBe(1);
});

test('actual v7 full-bag migration transfers every pantry item to shared chest and leaves source bytes untouched', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset();
    h.applyInventoryDelta(gs, { stew: -gs.inventory.stew });
    for (const item of Object.keys(h.ITEM_CATALOG)) {
      if (!gs.backpackSlots.includes(null)) break;
      if (item !== 'stew' && item !== 'ale' && !Object.prototype.hasOwnProperty.call(gs.inventory, item)) gs.addItem(item, 1);
    }
    if (gs.backpackSlots.includes(null)) throw new Error('Expected a full valid-item backpack');
    gs.chest.stew = 2; gs.chest.ale = 3;
    const source = gs.toSaveData(); source.tavern = { ...h.createV7TavernState(), level: 1, welcomeClaimed: true, portions: 7, ale: 9 };
    const bytes = JSON.stringify({ version: 7, slot: 1, savedAt: 77, state: source });
    localStorage.setItem(h.SaveSystem.storageKey(1), bytes); h.SaveSystem.load(1);
    const current = h.GameState.instance;
    return { stew: current.chest.stew, ale: current.chest.ale, noPantry: !('portions' in current.tavern) && !('ale' in current.tavern),
      bagSame: JSON.stringify(current.inventory) === JSON.stringify(source.inventory),
      bytesUnchanged: localStorage.getItem(h.SaveSystem.storageKey(1)) === bytes };
  });
  expect(result).toEqual({ stew: 9, ale: 12, noPantry: true, bagSame: true, bytesUnchanged: true });
});

test('actual closed v7 inn reports blocked-front queue cancellation while preserving its paid room', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset();
    gs.placedItems.push({ item: 'chair', scene: 'TavernScene', tx: 5, ty: 11, rotation: 0 });
    const source = gs.toSaveData();
    source.tavern = { ...h.createV7TavernState(), level: 1, welcomeClaimed: true, serviceDay: gs.day, portions: 4,
      innOpen: false, roomBookings: 1, revenue: 24, nextGuestId: 3,
      reservations: [{ roomId: 1, guestId: 1, visitorId: 'visitor-alder', checkoutDay: gs.day + 1 }],
      guests: [{ id: 2, visitorId: 'visitor-iris', kind: 'inn', phase: 'waiting', elapsedMs: 0,
        destinationId: 'register:5,10', product: null, roomId: 2 }] };
    const bytes = JSON.stringify({ version: 7, slot: 1, savedAt: 88, state: source });
    localStorage.setItem(h.SaveSystem.storageKey(1), bytes); h.SaveSystem.load(1);
    const current = h.GameState.instance, notice = h.SaveSystem.consumeMigrationNotice();
    return { phase: current.tavern.guests.find((guest: any) => guest.id === 2).phase,
      booked: current.tavern.reservations.length, guest: current.tavern.guests.find((guest: any) => guest.id === 1).phase,
      gold: current.gold, expectedGold: source.gold, notice, unchanged: localStorage.getItem(h.SaveSystem.storageKey(1)) === bytes };
  });
  expect(result).toMatchObject({ phase: 'leaving', booked: 1, guest: 'upstairs', unchanged: true });
  expect(result.gold).toBe(result.expectedGold);
  expect(result.notice).toContain('Unpaid visitors are leaving');
});

test('social visitors join adjacent facing pairs and solo pauses never invent a conversation partner', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__LIVING, gs = h.reset(), system = h.TavernSystem;
    system.open(); h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'chatting'));
    const solo = system.guestViews().find((view: any) => view.guest.phase === 'chatting');
    const alone = solo.socialPartnerId === null;
    h.until(() => system.guestViews().some((view: any) => view.socialPartnerId !== null));
    const pair = system.guestViews().filter((view: any) => view.socialPartnerId !== null);
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    const corrupt = h.cloneTavernState(gs.tavern), first = corrupt.guests.find((guest: any) => guest.id === pair[0].guest.id), second = corrupt.guests.find((guest: any) => guest.id === pair[1].guest.id);
    second.destinationId = first.destinationId; second.route = first.route.map((tile: any) => ({ ...tile }));
    let duplicateRejected = false;
    try { h.validateTavernLayoutState(corrupt, gs.placedItems, h.getMapData('TavernScene')); } catch { duplicateRejected = true; }
    return { alone, duplicateRejected, pair: pair.map((view: any) => ({ id: view.guest.id, partner: view.socialPartnerId,
      tile: view.destination.tile, facing: view.destination.facing })) };
  });
  expect(result.alone && result.duplicateRejected).toBe(true); expect(result.pair).toHaveLength(2);
  const [first, second] = result.pair;
  expect(first.partner).toBe(second.id); expect(second.partner).toBe(first.id);
  expect(first.tile.ty).toBe(second.tile.ty); expect(Math.abs(first.tile.tx - second.tile.tx)).toBe(1);
  expect(new Set([first.facing, second.facing])).toEqual(new Set(['left', 'right']));
});
