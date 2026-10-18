/** Deterministic hospitality personality contracts, using real sales before contact/save fixtures. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

/** Load production systems once; every scenario runs synchronously without a rendered-scene race. */
async function prepare(page: Page): Promise<void> {
  await bootGame(page);
  await page.evaluate(async () => {
    const modules = await Promise.all([
      // @ts-expect-error Vite browser import.
      import('/src/state/GameState.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/systems/TavernSystem.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/config/Tavern.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/systems/TavernLayout.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/systems/InventoryLayoutSystem.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/world/MapDef.ts'),
      // @ts-expect-error Vite browser import.
      import('/src/systems/SaveSystem.ts'),
    ]);
    const h: any = Object.assign({}, ...modules);
    /** Start an explicitly repaired shop with reachable stations and real inventory. */
    h.reset = () => {
      const gs = h.GameState.instance;
      gs.activeScene = 'TavernScene'; gs.tavernPanel = null; gs.placingItem = null;
      gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
      gs.placedItems = [
        { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
        { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
        { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
      ];
      gs.tavern = h.createTavernState(); gs.addItem('wood', 20); gs.addItem('stone', 10);
      if (!h.TavernSystem.repair().ok || !h.TavernSystem.open().ok) throw new Error('Fixture repair/open failed');
      return gs;
    };
    /** Advance production phase events to a named condition, rejecting exhausted fixture budgets. */
    h.until = (predicate: () => boolean) => {
      for (let elapsed = 0; !predicate() && elapsed < 180000; elapsed += 100) h.TavernSystem.tick(100);
      if (!predicate()) throw new Error('Personality fixture condition did not arrive');
    };
    /** Equip through the same inventory swap used by the player editor. */
    h.equip = (item: string) => {
      const gs = h.GameState.instance, source = h.findEntrySlot(gs, item);
      if (!source) throw new Error('Missing fixture item ' + item);
      h.moveOrSwap(gs, source, { container: 'toolbelt', index: 0 }); gs.hotbarIndex = 0;
    };
    /** Stand at the exact customer-specific serving edge. */
    h.approach = (guest: any) => {
      const gs = h.GameState.instance, destination = h.tavernDestination(guest.destinationId, h.TavernSystem.layout());
      const keeper = destination.keeper;
      gs.player = keeper ? { ...gs.player, x: (keeper.tx + .5) * 16, y: (keeper.ty + .5) * 16, facing: keeper.facing }
        : { ...gs.player, x: (destination.tile.tx + .5) * 16, y: (destination.tile.ty + 1.5) * 16, facing: 'up' };
    };
    /** Buy three ales through production serving, then place valid adjacent request routes for exact boundary tests. */
    h.pair = (paidRoom = false) => {
      const gs = h.reset(), system = h.TavernSystem;
      let ownerId: number | null = null;
      if (paidRoom) {
        system.close(); gs.tavern.nextGuestId = 2;
        if (!system.openInn().ok) throw new Error('Fixture inn did not open');
        h.until(() => gs.tavern.guests.some((guest: any) => guest.kind === 'inn' && guest.phase === 'waiting'));
        ownerId = gs.tavern.guests.find((guest: any) => guest.kind === 'inn' && guest.phase === 'waiting').id;
        if (!system.checkIn().ok || !system.closeInn().ok || !system.open().ok) throw new Error('Fixture room booking failed');
      }
      gs.addItem('ale', 10); gs.addItem('broom', 1);
      h.until(() => gs.tavern.guests.some((guest: any) => (ownerId === null ? guest.id % 2 === 0 : guest.id === ownerId) && guest.phase === 'waiting'));
      const drunk = gs.tavern.guests.find((guest: any) => (ownerId === null ? guest.id % 2 === 0 : guest.id === ownerId) && guest.phase === 'waiting');
      for (let sale = 0; sale < 3; sale++) {
        h.until(() => drunk.phase === 'waiting'); h.approach(drunk); h.equip('ale');
        if (!system.serve(drunk.id).ok) throw new Error('Fixture did not buy real ale');
      }
      const other = gs.tavern.guests.find((guest: any) => guest.id !== drunk.id);
      if (!other) throw new Error('Fixture lacks second guest');
      gs.tavern.guests = [drunk, other]; gs.tavern.fights = [];
      const destinations = system.layout().destinations;
      for (const [guest, destination] of [[drunk, destinations[0]], [other, destinations[1]]]) {
        guest.destinationId = destination.id; guest.route = [{ ...destination.tile }];
        guest.phase = 'waiting'; guest.product = guest === drunk ? 'ale' : 'food'; guest.elapsedMs = 0;
      }
      other.elapsedMs = h.TAVERN_ANGRY_MS - 50;
      h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
      return { gs, drunk, other };
    };
    (window as any).__PERSONALITY = h;
  });
}

test('anger boundary starts one shared fight identically across tick partitions and save replay', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk, other } = h.pair(), system = h.TavernSystem;
    const before = h.cloneTavernState(gs.tavern);
    system.tick(1000); const single = JSON.stringify(gs.tavern);
    const fight = gs.tavern.fights[0], frozen = [drunk.elapsedMs, other.elapsedMs];
    gs.tavern = h.cloneTavernState(before); for (let i = 0; i < 10; i++) system.tick(100);
    const partitions = single === JSON.stringify(gs.tavern);
    const saved = gs.toSaveData(); const candidate = h.GameState.candidateFromSaveData(saved);
    gs.tavern = candidate.tavern; system.tick(500); const reloaded = JSON.stringify(gs.tavern);
    gs.tavern = h.cloneTavernState(JSON.parse(single)); system.tick(500);
    const replay = reloaded === JSON.stringify(gs.tavern);
    const exported = h.cloneTavernState(gs.tavern); exported.fights[0].guestIds[0] = 999;
    return { partitions, replay, fightMs: fight.elapsedMs, frozen, isolated: gs.tavern.fights[0].guestIds[0] !== 999 };
  });
  expect(result).toEqual({ partitions: true, replay: true, fightMs: 950, frozen: [50, 45000], isolated: true });
});

test('broom ejects only the faced sober fighter and the remaining guest stays; invalid actions are atomic', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk, other } = h.pair(), system = h.TavernSystem;
    system.tick(50); h.equip('broom');
    const tile = h.tavernGuestTile(other); gs.player = { ...gs.player, x: (tile.tx + .5) * 16, y: (tile.ty + 1.5) * 16, facing: 'down' };
    const before = JSON.stringify(gs.toSaveData());
    const rejected = !system.eject(other.id).ok && !system.serve(other.id).ok && !system.declineOrder(other.id).ok;
    const atomic = before === JSON.stringify(gs.toSaveData()); gs.player.facing = 'up';
    const ejected = system.eject().ok;
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { rejected, atomic, ejected, target: other.phase, other: drunk.phase, calm: drunk.elapsedMs,
      fights: gs.tavern.fights.length, open: gs.tavern.tavernOpen };
  });
  expect(result).toEqual({ rejected: true, atomic: true, ejected: true, target: 'leaving', other: 'waiting', calm: 0, fights: 0, open: true });
});

test('moving contact starts at the route tile boundary and never reaches through a bar', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk, other } = h.pair(), system = h.TavernSystem;
    const layout = system.layout(), social = layout.social.find((destination: any) => destination.tile.tx === 17 && destination.tile.ty === 7);
    if (!social) throw new Error('Fixture social pocket missing');
    const bar = layout.destinations.find((destination: any) => destination.id === 'bar:14,6');
    other.destinationId = bar.id; other.route = [{ ...bar.tile }]; other.elapsedMs = h.TAVERN_ANGRY_MS;
    drunk.phase = 'wandering'; drunk.product = null; drunk.elapsedMs = 0; drunk.destinationId = social.id;
    drunk.route = [{ tx: 16, ty: 10 }, { tx: 16, ty: 9 }, { tx: 16, ty: 8 }, { tx: 16, ty: 7 }, { tx: 17, ty: 7 }];
    h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    const before = h.cloneTavernState(gs.tavern); system.tick(1000); const single = JSON.stringify(gs.tavern);
    const fightMs = gs.tavern.fights[0].elapsedMs;
    gs.tavern = h.cloneTavernState(before); for (let i = 0; i < 100; i++) system.tick(10);
    const same = single === JSON.stringify(gs.tavern);
    gs.tavern = h.cloneTavernState(before);
    const traveler = gs.tavern.guests.find((guest: any) => guest.id === drunk.id);
    traveler.route = h.findTavernPath({ placedItems: gs.placedItems, map: h.getMapData('TavernScene') }, { tx: 14, ty: 5 }, social.tile);
    if (!traveler.route) throw new Error('Fixture route around bar missing');
    system.tick(0);
    return { same, fightMs, wallBlocks: gs.tavern.fights.length === 0 };
  });
  expect(result).toEqual({ same: true, fightMs: 460, wallBlocks: true });
});

test('sold-out reply requires zero stock, matching proximity, and no modal; it changes no money or inventory', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, gs = h.reset(), system = h.TavernSystem;
    h.until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting' && guest.product === 'food'));
    const guest = gs.tavern.guests.find((guest: any) => guest.phase === 'waiting' && guest.product === 'food');
    h.approach(guest); const stocked = !system.canDeclineOrder(guest.id) && !system.declineOrder(guest.id).ok;
    h.applyInventoryDelta(gs, { stew: -gs.inventory.stew });
    gs.inventoryOpen = true; const modal = !system.declineOrder(guest.id).ok; gs.inventoryOpen = false;
    gs.player.facing = gs.player.facing === 'down' ? 'up' : 'down'; const facing = !system.declineOrder(guest.id).ok; h.approach(guest);
    const before = JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, sales: gs.tavern.revenue });
    const accepted = system.declineOrder(guest.id).ok;
    return { stocked, modal, facing, accepted, phase: guest.phase, open: gs.tavern.tavernOpen,
      unchanged: before === JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, sales: gs.tavern.revenue }) };
  });
  expect(result).toEqual({ stocked: true, modal: true, facing: true, accepted: true, phase: 'leaving', open: true, unchanged: true });
});

test('fight timeout, closure, and morning leave no dangling pair and never penalize future admissions', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs } = h.pair(), system = h.TavernSystem;
    system.tick(50); const snapshot = h.cloneTavernState(gs.tavern), gold = gs.gold;
    system.tick(h.TAVERN_FIGHT_MS); const timed = gs.tavern.fights.length === 0 && snapshot.fights[0].guestIds.every((id: number) => gs.tavern.guests.find((guest: any) => guest.id === id).phase === 'leaving');
    gs.tavern = h.cloneTavernState(snapshot); gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const closed = system.close().ok && gs.tavern.fights.length === 0;
    gs.tavern = h.cloneTavernState(snapshot); gs.day++; system.onNewDay();
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { timed, closed, morning: gs.tavern.fights.length === 0, gold: gs.gold === gold, reopened: system.open().ok };
  });
  expect(result).toEqual({ timed: true, closed: true, morning: true, gold: true, reopened: true });
});

test('v8 migration is exact, v9 fights are mandatory, and corrupt pair identities/timers/geometry reject', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs } = h.pair(); h.TavernSystem.tick(50);
    const data = gs.toSaveData(), old = structuredClone(data); delete old.tavern.fights;
    const migrated = h.GameState.candidateFromSaveData(old, 8).tavern.fights.length === 0;
    const cases = [
      () => h.GameState.candidateFromSaveData(old, 9),
      () => h.GameState.candidateFromSaveData(data, 8),
      ...[(state: any) => state.fights[0].guestIds.reverse(),
        (state: any) => state.fights.push(structuredClone(state.fights[0])),
        (state: any) => state.fights[0].guestIds[1] = 999,
        (state: any) => state.fights[0].elapsedMs = h.TAVERN_FIGHT_MS,
        (state: any) => state.guests.forEach((guest: any) => guest.drinks = 0),
      ].map(change => () => { const invalid = structuredClone(data); change(invalid.tavern); h.GameState.candidateFromSaveData(invalid); }),
    ];
    const rejected = cases.map(run => { try { run(); return false; } catch { return true; } });
    const clone = h.cloneTavernState(gs.tavern), distant = h.TavernSystem.layout().social.at(-1);
    clone.guests[0].phase = 'chatting'; clone.guests[0].elapsedMs = 0; clone.guests[0].product = null;
    clone.guests[0].destinationId = distant.id; clone.guests[0].route = [{ ...distant.tile }];
    let geometry = false; try { h.validateTavernLayoutState(clone, gs.placedItems, h.getMapData('TavernScene')); } catch { geometry = true; }
    return { migrated, rejected, geometry, version: h.SAVE_VERSION };
  });
  expect(result).toEqual({ migrated: true, rejected: Array(7).fill(true), geometry: true, version: 30 });
});

test('actual fight envelope reload preserves paid room identity and targeted broom sends only its owner upstairs', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk, other } = h.pair(true), system = h.TavernSystem;
    system.tick(1000); h.equip('broom');
    const tile = h.tavernGuestTile(drunk);
    gs.player = { ...gs.player, x: (tile.tx + .5) * 16, y: (tile.ty + 1.5) * 16, facing: 'up' };
    const before = JSON.stringify(gs.toSaveData()), room = JSON.stringify(gs.tavern.reservations), money = gs.gold;
    h.SaveSystem.save(1, 123); const bytes = localStorage.getItem(h.SaveSystem.storageKey(1)); h.SaveSystem.load(1);
    const loaded = h.GameState.instance, same = before === JSON.stringify(loaded.toSaveData());
    const ejected = system.eject(drunk.id).ok;
    h.validateTavernLayoutState(loaded.tavern, loaded.placedItems, h.getMapData('TavernScene'));
    return { same, ejected, roomKept: room === JSON.stringify(loaded.tavern.reservations), money: loaded.gold === money,
      targeted: loaded.tavern.guests.find((guest: any) => guest.id === drunk.id).phase,
      other: loaded.tavern.guests.find((guest: any) => guest.id === other.id).phase,
      calm: loaded.tavern.guests.find((guest: any) => guest.id === other.id).elapsedMs,
      bytesUnchanged: bytes === localStorage.getItem(h.SaveSystem.storageKey(1)), fights: loaded.tavern.fights.length };
  });
  expect(result).toEqual({ same: true, ejected: true, roomKept: true, money: true, targeted: 'ascending', other: 'waiting', calm: 0, bytesUnchanged: true, fights: 0 });
});

test('sold-out meal sends a paid lodger upstairs without touching the room booking or inventory', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, gs = h.reset(), system = h.TavernSystem;
    if (!system.close().ok || !system.openInn().ok) throw new Error('Fixture inn setup failed');
    h.until(() => gs.tavern.guests.some((guest: any) => guest.kind === 'inn' && guest.phase === 'waiting'));
    const resident = gs.tavern.guests.find((guest: any) => guest.kind === 'inn');
    if (!system.checkIn(resident.id).ok || !system.closeInn().ok || !system.open().ok) throw new Error('Fixture room purchase failed');
    h.until(() => resident.phase === 'waiting' && resident.product === 'food');
    h.applyInventoryDelta(gs, { stew: -gs.inventory.stew }); h.approach(resident);
    const before = JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, revenue: gs.tavern.revenue });
    const declined = system.declineOrder(resident.id).ok;
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { declined, phase: resident.phase, product: resident.product, same: before === JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, revenue: gs.tavern.revenue }),
      open: gs.tavern.tavernOpen, innClosed: !gs.tavern.innOpen, booking: gs.tavern.reservations[0].guestId === resident.id };
  });
  expect(result).toEqual({ declined: true, phase: 'ascending', product: null, same: true, open: true, innClosed: true, booking: true });
});

test('closing the inn dissolves an unpaid room fighter pair and leaves the other guest inside', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk, other } = h.pair(), system = h.TavernSystem;
    other.elapsedMs = 0;
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    if (!system.openInn().ok) throw new Error('Fixture inn did not open');
    h.until(() => gs.tavern.guests.some((guest: any) => guest.kind === 'inn' && guest.phase === 'waiting'));
    const pending = gs.tavern.guests.find((guest: any) => guest.kind === 'inn' && guest.phase === 'waiting');
    const social = system.layout().social[0], start = { tx: 5, ty: 12 };
    gs.tavern.guests = [drunk, pending]; gs.tavern.fights = [];
    drunk.phase = 'wandering'; drunk.product = null; drunk.elapsedMs = 0; drunk.destinationId = social.id;
    drunk.route = h.findTavernPath({ placedItems: gs.placedItems, map: h.getMapData('TavernScene') }, start, social.tile);
    if (!drunk.route) throw new Error('Fixture social route missing');
    pending.elapsedMs = h.TAVERN_ANGRY_MS;
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    system.tick(0); const started = gs.tavern.fights.length === 1;
    const before = JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, revenue: gs.tavern.revenue });
    const checkInRefused = !system.checkIn(pending.id).ok, closed = system.closeInn().ok;
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { started, checkInRefused, closed, fights: gs.tavern.fights.length, pending: pending.phase, survivor: drunk.phase,
      open: gs.tavern.tavernOpen, same: before === JSON.stringify({ inventory: gs.inventory, gold: gs.gold, rooms: gs.tavern.reservations, revenue: gs.tavern.revenue }) };
  });
  expect(result).toEqual({ started: true, checkInRefused: true, closed: true, fights: 0, pending: 'leaving', survivor: 'wandering', open: true, same: true });
});

test('closing service keeps a paid fighter room, while morning checks out that same fighter without penalties', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const h = (window as any).__PERSONALITY, { gs, drunk } = h.pair(true), system = h.TavernSystem;
    system.tick(50); const snapshot = h.cloneTavernState(gs.tavern), money = gs.gold;
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    const closed = system.close().ok;
    const roomKept = JSON.stringify(snapshot.reservations) === JSON.stringify(gs.tavern.reservations);
    const upstairs = drunk.phase === 'ascending';
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    gs.tavern = h.cloneTavernState(snapshot); gs.day++; system.onNewDay();
    const resident = gs.tavern.guests.find((guest: any) => guest.id === drunk.id);
    h.validateTavernState(gs.tavern, gs.day); h.validateTavernLayoutState(gs.tavern, gs.placedItems, h.getMapData('TavernScene'));
    return { closed, roomKept, upstairs, checkout: resident.phase === 'leaving' && resident.roomId === null,
      rooms: gs.tavern.reservations.length, fights: gs.tavern.fights.length, money: gs.gold === money,
      bookings: gs.tavern.roomBookings === snapshot.roomBookings, revenue: gs.tavern.revenue === snapshot.revenue,
      sales: gs.tavern.totalServed === snapshot.totalServed };
  });
  expect(result).toEqual({ closed: true, roomKept: true, upstairs: true, checkout: true, rooms: 0, fights: 0, money: true, bookings: true, revenue: true, sales: true });
});
