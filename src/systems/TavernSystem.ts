/** Hospitality transactions and bounded visitor lifecycle. Durable state lives only in GameState.tavern. */
import { SceneKey } from '../config/AssetKeys';
import { TILE, worldToTile } from '../config/GameConfig';
import {
  TAVERN_ALE_BATCH, TAVERN_MAX_DINERS, TAVERN_PRODUCTS, TAVERN_RECIPES, TAVERN_REPAIR_COST,
  TAVERN_ROOM_COUNT, TAVERN_ROOM_PRICE, TAVERN_UPGRADE_COST, TAVERN_UPGRADED_DINERS, TAVERN_VISITORS, TAVERN_WELCOME_PORTIONS,
  isHospitalityLayoutLocked, tavernVisitor, tavernPhaseDuration, TAVERN_IMPATIENT_MS, TAVERN_ANGRY_MS, TAVERN_FIGHT_MS, TAVERN_TILE_TRAVEL_MS, type TavernBatch, type TavernGuest, type TavernStation,
} from '../config/Tavern';
import { conversationFor, type GuestConversation } from '../config/TavernConversations';
import { GameState } from '../state/GameState';
import { applyInventoryDelta, itemFromEntry } from './InventoryLayoutSystem';
import { facingTile } from './InteractionSystem';
import { furnitureCells } from '../config/Furniture';
import { getMapData } from '../world/MapDef';
import { resolveTavernLayout, tavernGuestRoute, tavernGuestTile, tavernGuestsCanContact, tavernDestination, findTavernPath, type TavernTile, type TavernLayout } from './TavernLayout';

/** Player-facing action result; refused actions name the missing requirement. */
export interface TavernResult { ok: boolean; message: string }
/** Detached read-only rendering data. Geometry is derived rather than stored in each save. */
export interface TavernGuestView extends ReturnType<typeof tavernGuestRoute> {
  guest: TavernGuest; mood: 'calm' | 'impatient' | 'angry' | 'drunk'; patron: typeof TAVERN_VISITORS[number];
  /** A chat cue is visible only when a real adjacent visitor is currently facing this guest. */
  socialPartnerId: number | null;
  intoxicated: boolean;
  fight: { partnerId: number; elapsedMs: number; durationMs: number } | null;
  conversation: GuestConversation | null;
}
/** Read-only geometry cache; its key includes every placed footprint, not mutable array identity. */
let layoutCache: { state: GameState; key: string; layout: TavernLayout } | null = null;

/** Return whether the world owns input, allowing only the specified existing station panel. */
function available(panel: GameState['tavernPanel'] = null, allowHeldFurniture = false): boolean {
  const gs = GameState.instance;
  return gs.activeScene === SceneKey.Tavern && !gs.transitionActive && !gs.paused && !gs.pauseConfirmOpen &&
    !gs.inventoryOpen && !gs.chestOpen && !gs.craftingOpen && !gs.binOpen && gs.dialogue === null &&
    gs.daySummary === null && gs.fishing === null &&
    (gs.placingItem === null || (allowHeldFurniture && gs.placingSource === 'toolbelt')) &&
    (gs.tavernPanel === null || gs.tavernPanel === panel);
}
/** Construct explicit feedback without inferring success from side effects. */
function result(ok: boolean, message: string): TavernResult { return { ok, message }; }
/** Missing inventory keys mean no stack, as defined by the inventory's sparse-record contract. */
function count(item: string): number {
  const inventory = GameState.instance.inventory;
  return Object.prototype.hasOwnProperty.call(inventory, item) ? inventory[item] : 0;
}
/** Reject overflow before any inventory, stock, or gold mutation can happen. */
function safeSum(value: number, addition: number, field: string): void {
  if (!Number.isSafeInteger(value + addition) || value + addition < 0) throw new Error('TavernSystem: ' + field + ' exceeds safe capacity');
}
/** Resolve explicit batch choices; max is bounded by available inputs and output capacity. */
function batches(request: TavernBatch, maximum: number): number {
  if (request !== 1 && request !== 5 && request !== 'max') throw new Error('TavernSystem: batch count must be 1, 5, or max');
  return request === 'max' ? maximum : request;
}

/** A paid room remains associated with the same visible or upstairs guest record. */
function paid(guest: TavernGuest): boolean {
  return GameState.instance.tavern.reservations.some(room => room.guestId === guest.id);
}
/** Find room capacity, counting pending requests separately from paid stays. */
function freeRoom(): number | null {
  const state = GameState.instance.tavern;
  for (let roomId = 1; roomId <= TAVERN_ROOM_COUNT; roomId++) {
    if (!state.reservations.some(room => room.roomId === roomId) &&
        !state.guests.some(guest => guest.kind === 'inn' && guest.roomId === roomId)) return roomId;
  }
  return null;
}
/** Current route tile for interrupted movement; stationary phases store a single exact cell. */
function guestTile(guest: TavernGuest): TavernTile {
  return tavernGuestTile(guest);
}
/** Resolve membership without copying or changing the one durable fight record. */
function guestFight(guestId: number) {
  return GameState.instance.tavern.fights.find(fight => fight.guestIds.includes(guestId));
}
/** End a pair atomically; the untargeted waiting guest gets a fresh patience window. */
function releaseFight(guestId: number): void {
  const state = GameState.instance.tavern, fight = guestFight(guestId);
  if (!fight) return;
  state.fights = state.fights.filter(candidate => candidate !== fight);
  const partner = state.guests.find(guest => guest.id !== guestId && fight.guestIds.includes(guest.id));
  if (partner && partner.phase === 'waiting') partner.elapsedMs = 0;
}
/** Pair adjacent drunk and angry visitors in identity order, with no shared participants. */
function startFights(): void {
  const gs = GameState.instance;
  const eligible = gs.tavern.guests.filter(guest => !guestFight(guest.id) &&
    ['arriving','wandering','chatting','waiting','eating','lingering'].includes(guest.phase)).sort((a, b) => a.id - b.id);
  for (const first of eligible) for (const second of eligible) {
    if (first.id >= second.id || guestFight(first.id) || guestFight(second.id)) continue;
    const firstAngry = first.phase === 'waiting' && first.elapsedMs >= TAVERN_ANGRY_MS;
    const secondAngry = second.phase === 'waiting' && second.elapsedMs >= TAVERN_ANGRY_MS;
    if (!((first.drinks >= 3 && secondAngry) || (second.drinks >= 3 && firstAngry))) continue;
    if (tavernGuestsCanContact(first, second, { placedItems: gs.placedItems, map: getMapData(SceneKey.Tavern) })) {
      gs.tavern.fights.push({ guestIds: [first.id, second.id], elapsedMs: 0 });
    }
  }
}
/** Build one validated floor path from current feet, with only endpoint chairs allowed. */
function floorRoute(start: TavernTile, target: TavernTile): TavernTile[] {
  const gs = GameState.instance;
  const path = findTavernPath({ placedItems: gs.placedItems, map: getMapData(SceneKey.Tavern) }, start, target, true);
  if (!path) throw new Error('TavernSystem: guest route has become unreachable');
  return path;
}
/** Start a route without creating a second location or money store. */
function walk(guest: TavernGuest, phase: TavernGuest['phase'], route: TavernTile[]): void {
  releaseFight(guest.id);
  guest.phase = phase; guest.elapsedMs = 0; guest.route = route.map(tile => ({ ...tile }));
}
/** Enter a stationary phase at the last route tile. */
function pause(guest: TavernGuest, phase: TavernGuest['phase']): void {
  walk(guest, phase, [{ ...guest.route[guest.route.length - 1] }]);
}
/** Route a paid guest back to their room; other guests leave through the entrance. */
function depart(guest: TavernGuest, layout: TavernLayout): void {
  const current = guestTile(guest);
  guest.product = null;
  if (paid(guest)) {
    if (!layout.stairPath) throw new Error('TavernSystem: paid guest lost stairs');
    const stairs = layout.stairPath, map = getMapData(SceneKey.Tavern);
    if (!map.hospitality) throw new Error('TavernSystem: shop stairs metadata is missing');
    const split = stairs.findIndex(tile => tile.tx === map.hospitality!.stairApproach.tx && tile.ty === map.hospitality!.stairApproach.ty);
    walk(guest, 'ascending', floorRoute(current, stairs[split]).concat(stairs.slice(split + 1)));
  } else {
    const entry = getMapData(SceneKey.Tavern).spawns.find(spawn => spawn.id === 'entry');
    if (!entry) throw new Error('TavernSystem: shop entry is missing');
    walk(guest, 'leaving', floorRoute(current, entry));
  }
}
/** Choose a different reachable floor pocket, keeping standing visitors apart. */
function socialDestination(guest: TavernGuest, layout: TavernLayout): ReturnType<typeof tavernDestination> | null {
  const free = layout.social.filter(destination => !GameState.instance.tavern.guests.some(other => other.id !== guest.id &&
    other.destinationId === destination.id && !['upstairs','ascending','leaving'].includes(other.phase)));
  return chooseSocial(free, guest.id + guest.orders, layout);
}
/** Join a nearby social visitor before starting a new pair; stationary visitors take priority. */
function chooseSocial(free: TavernLayout['social'], sequence: number, layout: TavernLayout): TavernLayout['social'][number] | null {
  for (const phase of ['chatting', 'wandering']) {
    for (const other of GameState.instance.tavern.guests) if (other.phase === phase) {
      const occupied = layout.social.find(destination => destination.id === other.destinationId);
      if (!occupied) continue;
      const adjacent = free.find(destination => destination.tile.ty === occupied.tile.ty &&
        ((destination.facing === 'right' && occupied.facing === 'left' && destination.tile.tx + 1 === occupied.tile.tx) ||
         (destination.facing === 'left' && occupied.facing === 'right' && destination.tile.tx - 1 === occupied.tile.tx)));
      if (adjacent) return adjacent;
    }
  }
  return free.length ? free[sequence % free.length] : null;
}
/** Derive the actual adjacent conversation partner, never a simulated invisible speaker. */
function socialPartner(guest: TavernGuest, layout: TavernLayout): number | null {
  if (guest.phase !== 'chatting' || guestFight(guest.id)) return null;
  const destination = tavernDestination(guest.destinationId, layout);
  const partner = GameState.instance.tavern.guests.find(other => {
    if (other.id === guest.id || other.phase !== 'chatting' || guestFight(other.id)) return false;
    const otherDestination = tavernDestination(other.destinationId, layout);
    return destination.tile.ty === otherDestination.tile.ty &&
      ((destination.facing === 'right' && otherDestination.facing === 'left' && destination.tile.tx + 1 === otherDestination.tile.tx) ||
       (destination.facing === 'left' && otherDestination.facing === 'right' && destination.tile.tx - 1 === otherDestination.tile.tx));
  });
  return partner ? partner.id : null;
}
/** Move toward a social pocket before selecting a table or bar. */
function mingle(guest: TavernGuest, layout: TavernLayout): void {
  const destination = socialDestination(guest, layout);
  if (!destination) { depart(guest, layout); return; }
  guest.destinationId = destination.id; guest.product = null;
  walk(guest, 'wandering', floorRoute(guestTile(guest), destination.tile));
}
/** Choose an available physical seat or bar lane; stock never gates requests or admission. */
function requestOrder(guest: TavernGuest, layout: TavernLayout): void {
  const state = GameState.instance.tavern;
  const free = layout.destinations.filter(destination => !state.guests.some(other => other.id !== guest.id &&
    other.destinationId === destination.id && !['upstairs','ascending','leaving'].includes(other.phase)));
  if (!state.tavernOpen || !free.length) { depart(guest, layout); return; }
  const destination = free[(guest.id + guest.orders) % free.length];
  guest.destinationId = destination.id;
  guest.product = guest.id % 2 === 0 ? 'ale' : 'food';
  walk(guest, 'arriving', floorRoute(guestTile(guest), destination.tile));
}
/** Create a visitor only when a wardrobe identity is absent from all active guests and bookings. */
function newGuest(kind: TavernGuest['kind'], layout: TavernLayout, roomId: number | null): TavernGuest | null {
  const state = GameState.instance.tavern;
  const wardrobe = TAVERN_VISITORS.filter(visitor => !state.guests.some(guest => guest.visitorId === visitor.id));
  if (!wardrobe.length) return null;
  const social = layout.social.filter(destination => !state.guests.some(guest => guest.destinationId === destination.id &&
    !['upstairs','ascending','leaving'].includes(guest.phase)));
  if (kind === 'tavern' && !social.length) return null;
  safeSum(state.nextGuestId, 1, 'guest sequence');
  const id = state.nextGuestId++, destination = kind === 'inn' ? layout.inn : chooseSocial(social, id - 1, layout);
  if (!destination) throw new Error('TavernSystem: open shop lacks a guest destination');
  return { id, visitorId: wardrobe[(id - 1) % wardrobe.length].id, kind,
    phase: kind === 'inn' ? 'arriving' : 'wandering', elapsedMs: 0, destinationId: destination.id,
    product: null, roomId, route: destination.path.map(tile => ({ ...tile })), drinks: 0, orders: 0 };
}
/** Admit one guest per saved irregular interval, alternating inn and tavern demand. */
function admit(layout: TavernLayout): void {
  const state = GameState.instance.tavern;
  const room = freeRoom(), pendingInn = state.guests.some(guest => guest.kind === 'inn' && !paid(guest));
  const innReady = state.innOpen && room !== null && !pendingInn;
  const dinerReady = state.tavernOpen && layout.social.length > 0 &&
    state.guests.filter(guest => guest.kind === 'tavern').length < (state.level === 2 ? TAVERN_UPGRADED_DINERS : TAVERN_MAX_DINERS);
  const kind = innReady && (!dinerReady || state.nextGuestId % 2 === 1) ? 'inn' : dinerReady ? 'tavern' : null;
  if (kind) {
    const guest = newGuest(kind, layout, kind === 'inn' ? room : null);
    if (guest) state.guests.push(guest);
  }
  state.admissionWaitMs = 4000 + (state.nextGuestId * 1543 % 4400);
}
/** Advance a single phase boundary; all money changes remain explicit player actions. */
function advanceGuest(guest: TavernGuest, layout: TavernLayout): boolean {
  switch (guest.phase) {
    case 'arriving': pause(guest, 'waiting'); break;
    case 'wandering': pause(guest, 'chatting'); break;
    case 'chatting': requestOrder(guest, layout); break;
    case 'waiting': depart(guest, layout); break;
    case 'eating': pause(guest, 'lingering'); break;
    case 'lingering':
      // Early drink rounds keep the seat. Giving it away after every sip makes lodgers return
      // upstairs before they can finish a social drinking visit. Meals and tipsy rounds mingle.
      if (GameState.instance.tavern.tavernOpen && guest.orders < 4) {
        if (guest.drinks >= 3 || guest.product === 'food') mingle(guest, layout);
        else requestOrder(guest, layout);
      }
      else depart(guest, layout);
      break;
    case 'ascending': pause(guest, 'upstairs'); break;
    case 'upstairs':
      if (!layout.checkoutPath) throw new Error('TavernSystem: paid guest lost downstairs route');
      const map = getMapData(SceneKey.Tavern);
      if (!map.hospitality) throw new Error('TavernSystem: shop stairs metadata is missing');
      const approachIndex = layout.checkoutPath.findIndex(tile => tile.tx === map.hospitality!.stairApproach.tx && tile.ty === map.hospitality!.stairApproach.ty);
      if (approachIndex < 0) throw new Error('TavernSystem: downstairs route lacks its stair approach');
      // A rest starts a fresh downstairs visit; lifetime sale accounting stays untouched.
      guest.orders = 0; guest.drinks = 0;
      walk(guest, 'descending', layout.checkoutPath.slice(0, approachIndex + 1));
      break;
    case 'descending': mingle(guest, layout); break;
    case 'leaving': return true;
  }
  return false;
}

/** Bounded service API. All player transactions check scene, modal ownership, and station proximity. */
export const TavernSystem = {
  /** Resolve current stations and routes without depending on a live Phaser scene. */
  layout(): TavernLayout {
    const state = GameState.instance;
    const geometryKey = state.placedItems.filter(item => item.scene === SceneKey.Tavern)
      .map(item => [item.item, item.tx, item.ty, item.rotation].join(':')).sort().join('|');
    if (layoutCache && layoutCache.state === state && layoutCache.key === geometryKey) return layoutCache.layout;
    const layout = resolveTavernLayout({ placedItems: state.placedItems, map: getMapData(SceneKey.Tavern) });
    layoutCache = { state, key: geometryKey, layout };
    return layout;
  },
  /** Freeze geometry while admission or an accepted guest still uses its routes. */
  isLayoutLocked(): boolean { return isHospitalityLayoutLocked(GameState.instance.tavern); },
  /** Report prepared inventory quantities and current room capacity without reserving unseen stock. */
  stock(): { food: number; ale: number; availableFood: number; availableAle: number; vacancies: number } {
    const state = GameState.instance.tavern;
    const taken = new Set(state.reservations.map(room => room.roomId));
    for (const guest of state.guests) if (guest.roomId !== null) taken.add(guest.roomId);
    return { food: count('stew'), ale: count('ale'), availableFood: count('stew'),
      availableAle: count('ale'), vacancies: TAVERN_ROOM_COUNT - taken.size };
  },
  /** Explain setup for one independent business without requiring register proximity. */
  canOpen(kind: 'inn' | 'tavern' = 'tavern'): TavernResult {
    const state = GameState.instance.tavern;
    if (state.level === 0) return result(false, 'Restore the shop at your register first.');
    const layout = this.layout();
    if (kind === 'inn') {
      if (state.innOpen) return result(false, 'The inn already accepts guests.');
      if (!layout.innOk) return result(false, layout.innMessage);
      if (freeRoom() === null) return result(false, 'All three rooms are occupied or reserved.');
      return result(true, 'The inn is ready to accept one-night stays.');
    }
    if (state.tavernOpen) return result(false, 'The tavern already takes orders.');
    if (!layout.ok) return result(false, layout.message);
    return result(true, 'The tavern is ready to take orders.');
  },
  /** Check a nearby waiting guest's seat or the exact keeper-side bar lane. */
  canServeGuest(guestId: number): boolean {
    if (!available()) return false;
    const guest = GameState.instance.tavern.guests.find(candidate => candidate.id === guestId);
    if (!guest || guest.product === null || guest.phase !== 'waiting' || guestFight(guest.id)) return false;
    const { destination } = tavernGuestRoute(guest, this.layout());
    const p = GameState.instance.player, feet = worldToTile(p.x, p.y), target = facingTile();
    if (destination.keeper) return feet.tx === destination.keeper.tx && feet.ty === destination.keeper.ty && p.facing === destination.keeper.facing;
    return target.tx === destination.tile.tx && target.ty === destination.tile.ty &&
      Math.hypot(p.x - (target.tx + 0.5) * TILE, p.y - (target.ty + 0.5) * TILE) <= TILE * 1.6;
  },
  /** Verify facing and feet distance to a placed station; dining orders use their specific destination. */
  canInteract(station: TavernStation): boolean {
    if (station === 'counter') return GameState.instance.tavern.guests.some(guest => this.canServeGuest(guest.id));
    if (!available(station)) return false;
    const tile = facingTile(), p = GameState.instance.player, layout = this.layout();
    const stations = station === 'ledger' ? layout.registers : layout.stoves;
    return stations.some(placed => furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation).some(target =>
      tile.tx === target.tx && tile.ty === target.ty &&
      Math.hypot(p.x - (target.tx + 0.5) * TILE, p.y - (target.ty + 0.5) * TILE) <= TILE * 1.6));
  },
  /** Spend repair materials atomically and grant the existing one-time welcome gift. */
  repair(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to restore the shop.');
    const state = GameState.instance.tavern;
    if (state.level !== 0) return result(false, 'The shop is already restored.');
    if (count('stew') > Number.MAX_SAFE_INTEGER - TAVERN_WELCOME_PORTIONS) return result(false, 'There is no safe stack space for the welcome stew.');
    if (!applyInventoryDelta(GameState.instance, { wood: -TAVERN_REPAIR_COST.wood, stone: -TAVERN_REPAIR_COST.stone, stew: TAVERN_WELCOME_PORTIONS })) return result(false, 'Restore with 20 wood, 10 stone, and space for welcome stew.');
    state.level = 1; state.welcomeClaimed = true;
    return result(true, 'Shop restored! Rosa left 4 welcome stew portions.');
  },
  /**
   * True when the keeper knows a recipe: starter recipes always, letter recipes once that letter
   * has been read from the farm mailbox.
   * @throws for an id that is not in the recipe book
   */
  recipeKnown(recipeId: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(TAVERN_RECIPES, recipeId)) throw new Error(`TavernSystem: unknown recipe ${recipeId}`);
    const letter = TAVERN_RECIPES[recipeId].letter;
    return letter === null || GameState.instance.mail.read.includes(letter);
  },
  /**
   * Consume an exact number of recipe batches, preserving all slots and stock on failure.
   * @param recipeId id from TAVERN_RECIPES (starter ids equal their ingredient id)
   * @param request 1, 5 or 'max' batches
   */
  cook(recipeId: string, request: TavernBatch = 1): TavernResult {
    if (!this.canInteract('kitchen')) return result(false, 'Face your stove to cook.');
    const state = GameState.instance.tavern;
    if (!state.level) return result(false, 'Restore the shop before cooking.');
    if (!Object.prototype.hasOwnProperty.call(TAVERN_RECIPES, recipeId)) return result(false, 'That is not a recipe in your book.');
    if (!this.recipeKnown(recipeId)) return result(false, 'You have not learned that recipe yet. Neighbors share recipes by letter.');
    const recipe = TAVERN_RECIPES[recipeId];
    const ingredients = Object.entries(recipe.ingredients);
    const maximum = Math.min(...ingredients.map(([item, need]) => Math.floor(count(item) / need)),
      Math.floor((Number.MAX_SAFE_INTEGER - count('stew')) / recipe.portions));
    const amount = batches(request, maximum);
    if (!amount || amount > maximum) return result(false, 'Not enough ingredients or prepared-stock space for that batch.');
    safeSum(count('stew'), amount * recipe.portions, 'prepared food');
    const delta: Record<string, number> = { stew: amount * recipe.portions };
    for (const [item, need] of ingredients) delta[item] = -amount * need;
    if (!applyInventoryDelta(GameState.instance, delta)) return result(false, 'Make room in your backpack for the stew. Ingredients stay untouched.');
    return result(true, `Prepared ${amount * recipe.portions} stew portions.`);
  },
  /** Buy measured malt for 8g and consume one wood fuel per four-ale batch, atomically. */
  brew(request: TavernBatch = 1): TavernResult {
    if (!this.canInteract('kitchen')) return result(false, 'Face your stove to brew ale.');
    const gs = GameState.instance, state = gs.tavern;
    if (!state.level) return result(false, 'Restore the shop before brewing.');
    const maximum = Math.min(count('wood'), Math.floor(gs.gold / TAVERN_ALE_BATCH.gold),
      Math.floor((Number.MAX_SAFE_INTEGER - count('ale')) / TAVERN_ALE_BATCH.yield));
    const amount = batches(request, maximum);
    if (!amount || amount > maximum) return result(false, 'Each batch needs 8g for malt and 1 wood fuel.');
    safeSum(count('ale'), amount * TAVERN_ALE_BATCH.yield, 'prepared ale');
    if (!applyInventoryDelta(gs, { wood: -amount, ale: amount * TAVERN_ALE_BATCH.yield })) return result(false, 'Make room in your backpack for the ale. Malt and fuel stay untouched.');
    gs.gold -= amount * TAVERN_ALE_BATCH.gold;
    return result(true, `Brewed ${amount * TAVERN_ALE_BATCH.yield} ales. Malt and fuel paid.`);
  },
  /** Open tavern admissions independently; same-day reopening has no artificial quota. */
  open(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to open the tavern.');
    const readiness = this.canOpen();
    if (!readiness.ok) return readiness;
    const gs = GameState.instance; gs.tavern.serviceDay = gs.day; gs.tavern.tavernOpen = true;
    return result(true, 'Tavern open. Visitors can arrive and order; you decide when to close.');
  },
  /** Stop admission and send unpaid diners out; paid meals finish and room guests return upstairs. */
  close(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to close the tavern.');
    const state = GameState.instance.tavern;
    if (!state.tavernOpen) return result(false, 'The tavern already takes no new orders.');
    state.tavernOpen = false;
    const fighters = state.fights.flatMap(fight => fight.guestIds);
    state.fights = [];
    for (const guest of state.guests) if (fighters.includes(guest.id)) depart(guest, this.layout());
    for (const guest of state.guests) if ((guest.kind === 'tavern' || paid(guest)) &&
      !['eating','lingering','ascending','upstairs','descending','leaving'].includes(guest.phase)) depart(guest, this.layout());
    return result(true, 'Tavern closed. Unserved guests leave; paid guests keep their rooms.');
  },
  /** Open room admissions without requiring a stove, bar, or prepared food. */
  openInn(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to open the inn.');
    const readiness = this.canOpen('inn');
    if (!readiness.ok) return readiness;
    const gs = GameState.instance; gs.tavern.serviceDay = gs.day; gs.tavern.innOpen = true;
    return result(true, 'Inn open. One-night rooms cost 24g; checkout is tomorrow morning.');
  },
  /** Stop new bookings and dismiss unpaid arrivals without cancelling any paid room. */
  closeInn(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to close the inn.');
    if (!GameState.instance.tavern.innOpen) return result(false, 'The inn already accepts no new guests.');
    GameState.instance.tavern.innOpen = false;
    for (const guest of GameState.instance.tavern.guests) if (guest.kind === 'inn' && !paid(guest) && guest.phase !== 'leaving') depart(guest, this.layout());
    return result(true, 'Inn closed to new arrivals. Paid stays remain booked.');
  },
  /** World check-in requires the keeper side and the guest at that register's front. */
  canCheckIn(guestId?: number): boolean {
    if (!available()) return false;
    const layout = this.layout();
    if (!layout.inn || !layout.inn.keeper) return false;
    const keeper = layout.inn.keeper, gs = GameState.instance, feet = worldToTile(gs.player.x, gs.player.y);
    return feet.tx === keeper.tx && feet.ty === keeper.ty && gs.player.facing === keeper.facing &&
      gs.tavern.guests.some(guest => guest.kind === 'inn' && !paid(guest) && guest.phase === 'waiting' &&
        !guestFight(guest.id) && guest.destinationId === layout.inn!.id && (guestId === undefined || guest.id === guestId));
  },
  /** Collect a waiting guest's room payment once, then let that guest walk upstairs. */
  checkIn(guestId?: number): TavernResult {
    if (!this.canCheckIn(guestId)) return result(false, 'Stand behind the register and face the guest waiting in front.');
    const gs = GameState.instance, state = gs.tavern;
    const guest = state.guests.find(candidate => candidate.kind === 'inn' && !paid(candidate) && candidate.phase === 'waiting' && (guestId === undefined || candidate.id === guestId));
    if (!guest || guest.roomId === null) return result(false, 'Wait for a guest at your register.');
    const registerTile = facingTile();
    if (guest.destinationId !== `register:${registerTile.tx},${registerTile.ty}`) return result(false, 'Use the register where this guest is waiting.');
    if (state.reservations.some(room => room.roomId === guest.roomId)) throw new Error('TavernSystem: room has already been paid for');
    if (!this.layout().stairPath) return result(false, 'Clear the path to the stairs first.');
    safeSum(gs.gold, TAVERN_ROOM_PRICE, 'gold'); safeSum(state.revenue, TAVERN_ROOM_PRICE, 'revenue');
    safeSum(state.roomBookings, 1, 'room bookings'); safeSum(gs.day, 1, 'checkout day');
    state.reservations.push({ roomId: guest.roomId, guestId: guest.id, visitorId: guest.visitorId, checkoutDay: gs.day + 1 });
    gs.gold += TAVERN_ROOM_PRICE; state.revenue += TAVERN_ROOM_PRICE; state.roomBookings++;
    depart(guest, this.layout());
    return result(true, `${tavernVisitor(guest.visitorId).name} booked room ${guest.roomId}. +24g`);
  },
  /** Fulfil one nearby unpaid request atomically; changing phase prevents a second payment. */
  serve(guestId?: number): TavernResult {
    const gs = GameState.instance, state = gs.tavern;
    const guest = state.guests.find(candidate => (guestId === undefined || candidate.id === guestId) && this.canServeGuest(candidate.id));
    if (!guest || guest.product === null) return result(false, 'Face a waiting guest’s chair, or serve from behind their bar space.');
    const product = guest.product, price = TAVERN_PRODUCTS[product].price;
    const item = product === 'food' ? 'stew' : 'ale';
    if (itemFromEntry(gs.toolbeltSlots[gs.hotbarIndex]) !== item || count(item) < 1) return result(false, 'Select ' + TAVERN_PRODUCTS[product].label + ' in your toolbelt to hand it over.');
    for (const [value, add, field] of [[gs.gold, price, 'gold'], [state.revenue, price, 'revenue'], [state.totalServed, 1, 'sales'], [state.servedToday, 1, 'daily sales']] as const) safeSum(value, add, field);
    safeSum(product === 'food' ? state.foodSold : state.aleSold, 1, 'product sales');
    safeSum(guest.orders, 1, 'guest orders'); if (product === 'ale') safeSum(guest.drinks, 1, 'guest drinks');
    if (!applyInventoryDelta(gs, { [item]: -1 })) return result(false, 'That prepared item is no longer in your bag.');
    if (product === 'food') state.foodSold++;
    else { state.aleSold++; guest.drinks++; }
    guest.orders++;
    state.totalServed++; state.servedToday++; state.revenue += price; gs.gold += price;
    pause(guest, 'eating');
    return result(true, `${tavernVisitor(guest.visitorId).name}: ${tavernVisitor(guest.visitorId).line} +${price}g`);
  },
  /** Offer an honest sold-out reply only at the same physical serving position as a handoff. */
  canDeclineOrder(guestId: number): boolean {
    if (!this.canServeGuest(guestId)) return false;
    const guest = GameState.instance.tavern.guests.find(candidate => candidate.id === guestId);
    return !!guest && guest.product !== null && count(guest.product === 'food' ? 'stew' : 'ale') === 0;
  },
  /** Dismiss one unavailable order without taking goods, payment, bookings, or opening control. */
  declineOrder(guestId?: number): TavernResult {
    const guest = GameState.instance.tavern.guests.find(candidate => (guestId === undefined || candidate.id === guestId) && this.canDeclineOrder(candidate.id));
    if (!guest) return result(false, 'Face a waiting guest whose requested item is out of stock.');
    depart(guest, this.layout());
    return result(true, `${tavernVisitor(guest.visitorId).name}: Thanks for letting me know.`);
  },
  /** Preserve the existing paid shop upgrade without adding a hidden daily guest quota. */
  upgrade(): TavernResult {
    if (!this.canInteract('ledger')) return result(false, 'Face your register to upgrade.');
    const gs = GameState.instance, state = gs.tavern;
    if (state.level !== 1) return result(false, !state.level ? 'Restore the shop first.' : 'The shop is already upgraded.');
    if (state.totalServed < 3) return result(false, 'Serve 3 guests before upgrading.');
    if (gs.gold < TAVERN_UPGRADE_COST.gold) return result(false, 'The upgrade costs 60g and 10 wood.');
    if (!applyInventoryDelta(gs, { wood: -TAVERN_UPGRADE_COST.wood })) return result(false, 'The upgrade costs 60g and 10 wood.');
    gs.gold -= TAVERN_UPGRADE_COST.gold; state.level = 2;
    return result(true, 'Shop expanded! Serve up to five guests at once when enough seats or bar spaces are ready.');
  },
  /** Read a stable visitor for older dialogue integrations; current rendering uses all guestViews. */
  currentPatron(): typeof TAVERN_VISITORS[number] | null {
    const guests = GameState.instance.tavern.guests;
    return guests.length ? tavernVisitor(guests[0].visitorId) : null;
  },
  /** Return detached guest records with derived routes, appearance, duration, and facing. */
  guestViews(): TavernGuestView[] {
    const layout = this.layout();
    return GameState.instance.tavern.guests.filter(guest => guest.phase !== 'upstairs').map(guest => {
      const fight = guestFight(guest.id), partnerId = socialPartner(guest, layout);
      const partner = partnerId === null ? null : GameState.instance.tavern.guests.find(candidate => candidate.id === partnerId);
      if (partnerId !== null && !partner) throw new Error('TavernSystem: conversation partner disappeared');
      return {
      guest: { ...guest, route: guest.route.map(tile => ({ ...tile })) },
      socialPartnerId: partnerId,
      intoxicated: guest.drinks >= 3,
      fight: fight ? { partnerId: fight.guestIds[0] === guest.id ? fight.guestIds[1] : fight.guestIds[0], elapsedMs: fight.elapsedMs, durationMs: TAVERN_FIGHT_MS } : null,
      conversation: partner ? conversationFor(guest, partner, GameState.instance.day,
        Math.floor(layout.social.findIndex(destination => destination.id === guest.destinationId) / 2)) : null,
      mood: guest.phase === 'waiting' && guest.elapsedMs >= TAVERN_ANGRY_MS ? 'angry' :
        guest.phase === 'waiting' && guest.elapsedMs >= TAVERN_IMPATIENT_MS ? 'impatient' : guest.drinks >= 3 ? 'drunk' : 'calm',
      patron: tavernVisitor(guest.visitorId), ...tavernGuestRoute(guest, layout), path: guest.route.map(tile => ({ ...tile })),
    }; });
  },

  /** Eject only the faced nearby drunk guest or fighter; their partner stays and paid rooms remain booked. */
  eject(guestId?: number): TavernResult {
    if (!available()) return result(false, 'Close the menu before using your broom.');
    const gs = GameState.instance;
    if (itemFromEntry(gs.toolbeltSlots[gs.hotbarIndex]) !== 'broom' || count('broom') < 1) return result(false, 'Select your crafted broom first.');
    const target = facingTile();
    const guest = gs.tavern.guests.filter(candidate => (guestId === undefined || candidate.id === guestId) &&
      (candidate.drinks >= 3 || guestFight(candidate.id)) && !['ascending','descending','upstairs','leaving'].includes(candidate.phase) &&
      guestTile(candidate).tx === target.tx && guestTile(candidate).ty === target.ty &&
      Math.hypot(gs.player.x - (target.tx + .5) * TILE, gs.player.y - (target.ty + .5) * TILE) <= TILE * 2)
      .sort((a, b) => a.id - b.id)[0];
    if (!guest) return result(false, 'Face a nearby fighter or drunk guest with your broom.');
    depart(guest, this.layout());
    return result(true, paid(guest) ? 'Time to sleep it off. Your guest keeps their room.' : 'Time to head home.');
  },
  /** Advance exact next-event boundaries, preserving pacing across different frame sizes and saves. */
  tick(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('TavernSystem.tick: delta must be finite and nonnegative');
    if (!available(null, true)) return;
    const gs = GameState.instance, state = gs.tavern;
    if (!isHospitalityLayoutLocked(state)) return;
    if (state.serviceDay !== gs.day) throw new Error('TavernSystem: onNewDay must advance hospitality before ticking');
    const layout = this.layout();
    let remaining = deltaMs, events = 0;
    startFights();
    while (remaining > 0) {
      if (++events > 100000) throw new Error('TavernSystem.tick: simulation interval exceeds bounded event capacity');
      const admitting = state.innOpen || state.tavernOpen;
      let step = admitting ? Math.min(remaining, state.admissionWaitMs - state.admissionMs) : remaining;
      for (const fight of state.fights) step = Math.min(step, TAVERN_FIGHT_MS - fight.elapsedMs);
      const advances: Array<{ guest: TavernGuest; boundary: number }> = [];
      for (const guest of state.guests) {
        if (guestFight(guest.id)) continue;
        let boundary = tavernPhaseDuration(guest);
        if (guest.phase === 'waiting' && guest.elapsedMs < TAVERN_ANGRY_MS) boundary = Math.min(boundary, TAVERN_ANGRY_MS);
        if (['arriving','wandering','ascending','descending','leaving'].includes(guest.phase)) {
          boundary = Math.min(boundary, (Math.floor(guest.elapsedMs / TAVERN_TILE_TRAVEL_MS) + 1) * TAVERN_TILE_TRAVEL_MS);
        }
        step = Math.min(step, boundary - guest.elapsedMs);
        advances.push({ guest, boundary });
      }
      if (step < 0) throw new Error('TavernSystem: guest timer exceeds its phase');
      for (const { guest, boundary } of advances) {
        const next = guest.elapsedMs + step;
        // Floating-point sums may land an ulp below a tile boundary. Snap only arithmetic dust,
        // so the next loop changes direction instead of taking a zero-length step.
        guest.elapsedMs = Math.abs(next - boundary) < 1e-7 ? boundary : next;
      }
      for (const fight of state.fights) fight.elapsedMs += step;
      if (admitting) state.admissionMs += step;
      remaining -= step;
      for (const fight of [...state.fights]) if (fight.elapsedMs >= TAVERN_FIGHT_MS) {
        const participants = state.guests.filter(guest => fight.guestIds.includes(guest.id));
        state.fights = state.fights.filter(candidate => candidate !== fight);
        for (const guest of participants) depart(guest, layout);
      }
      const finished = new Set<number>();
      for (const guest of state.guests) if (!guestFight(guest.id) && guest.elapsedMs >= tavernPhaseDuration(guest) && advanceGuest(guest, layout)) finished.add(guest.id);
      state.guests = state.guests.filter(guest => !finished.has(guest.id));
      if (admitting && state.admissionMs >= state.admissionWaitMs) { state.admissionMs = 0; admit(layout); }
      startFights();
      if (!state.guests.length && !admitting) break;
    }
  },
  /** Morning checkout removes only expired bookings; active guests walk from their actual position. */
  onNewDay(): void {
    const gs = GameState.instance, state = gs.tavern;
    if (state.serviceDay !== 0 && state.serviceDay >= gs.day) throw new Error('TavernSystem.onNewDay: advance the game day first');
    state.innOpen = false; state.tavernOpen = false; state.servedToday = 0;
    state.fights = [];
    const expired = new Set(state.reservations.filter(room => room.checkoutDay <= gs.day).map(room => room.guestId));
    state.reservations = state.reservations.filter(room => room.checkoutDay > gs.day);
    const layout = this.layout();
    for (const guest of state.guests) {
      if (expired.has(guest.id)) {
        guest.roomId = null; guest.product = null;
        if (['upstairs','ascending','descending'].includes(guest.phase)) {
          if (!layout.checkoutPath) throw new Error('TavernSystem: checkout route is missing');
          const current = guestTile(guest), route = layout.checkoutPath, index = route.findIndex(tile => tile.tx === current.tx && tile.ty === current.ty);
          if (index >= 0) walk(guest, 'leaving', route.slice(index));
          else depart(guest, layout);
        } else depart(guest, layout);
      } else if (guest.kind === 'tavern' && !['eating','lingering','leaving'].includes(guest.phase)) depart(guest, layout);
    }
    state.serviceDay = state.guests.length || state.reservations.length ? gs.day : 0;
    state.admissionMs = 0; state.admissionWaitMs = 2800;
  },
};
