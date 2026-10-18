/** Tavern data and durable-state validation, shared by gameplay, saves, and the interior UI. */
import type { Appearance } from './Appearance';

/** Interaction roles resolve to placed furniture, never authored action coordinates. */
export type TavernStation = 'ledger' | 'kitchen' | 'counter';
export const TAVERN_REPAIR_COST = { wood: 20, stone: 10 } as const;
export const TAVERN_UPGRADE_COST = { gold: 60, wood: 10 } as const;
export const TAVERN_MEAL_PRICE = 12;
export const TAVERN_WELCOME_PORTIONS = 4;
export const TAVERN_ARRIVAL_MS = 1800;
export const TAVERN_LEAVING_MS = 1200;
/**
 * One cooking recipe. Every recipe makes stew portions (the dish guests order).
 *  label        kitchen menu name
 *  ingredients  item id -> count used per batch
 *  portions     stew portions made per batch
 *  letter       null = known from the start; otherwise the letter id that teaches it (the recipe
 *               becomes known once that letter has been read; see TavernSystem.recipeKnown)
 */
export interface TavernRecipe {
  readonly label: string;
  readonly ingredients: Readonly<Record<string, number>>;
  readonly portions: number;
  readonly letter: string | null;
}

/**
 * The kitchen's recipe book, in menu order. The four starter ids match their main ingredient so
 * older saves, tests and menu names (tavern-action-cook-parsnip) keep working.
 * Letter-taught recipes are checked against config/Letters.ts when that module loads.
 */
export const TAVERN_RECIPES: Readonly<Record<string, TavernRecipe>> = {
  parsnip: { label: 'Parsnip stew', ingredients: { parsnip: 1 }, portions: 4, letter: null },
  'fish-sardine': { label: 'Sardine stew', ingredients: { 'fish-sardine': 1 }, portions: 5, letter: null },
  'fish-bass': { label: 'Bass stew', ingredients: { 'fish-bass': 1 }, portions: 5, letter: null },
  'fish-carp': { label: 'Carp stew', ingredients: { 'fish-carp': 1 }, portions: 5, letter: null },
  'potato-stew': { label: 'Potato stew', ingredients: { potato: 1 }, portions: 5, letter: 'tessa-potatoes' },
  'forest-stew': { label: 'Forest stew', ingredients: { mushroom: 2 }, portions: 8, letter: 'cael-forest-stew' },
  'garden-stew': { label: 'Garden stew', ingredients: { cabbage: 2 }, portions: 9, letter: 'tessa-hearts-3' },
  'hearty-stew': { label: 'Hearty stew', ingredients: { potato: 1, 'fish-trout': 1 }, portions: 12, letter: 'kit-hearts-3' },
};
/** Named neighbors arrive in this stable order during each day's service. */
export const TAVERN_PATRONS = [
  { id: 'rosa', name: 'Rosa', line: 'It smells like your grandfather’s kitchen again.' },
  { id: 'finn', name: 'Finn', line: 'A warm meal after work. That is what this town needs.' },
  { id: 'mara', name: 'Mara', line: 'You have made this place feel like home.' },
] as const;

/** Durable service progress; phaseElapsedMs places the patron on the same path after loading. */
export interface LegacyTavernState {
  level: 0 | 1 | 2;
  portions: number;
  welcomeClaimed: boolean;
  /** Zero means no service has opened today; a positive value must equal the current game day. */
  serviceDay: number;
  /** Snapshot taken when opening. Upgrading never adds patrons to an existing service. */
  quota: number;
  servedToday: number;
  totalServed: number;
  revenue: number;
  phase: 'closed' | 'arriving' | 'waiting' | 'leaving';
  phaseElapsedMs: number;
}

/** Create the explicitly unrepaired tavern for a new game or the version-one save migration. */
export function createLegacyTavernState(): LegacyTavernState {
  return {
    level: 0, portions: 0, welcomeClaimed: false, serviceDay: 0, quota: 0,
    servedToday: 0, totalServed: 0, revenue: 0, phase: 'closed', phaseElapsedMs: 0,
  };
}

/** Validate one nonnegative durable counter and return it without coercion. */
function counter(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GameState save: tavern.${field} must be a nonnegative safe integer`);
  }
  return value;
}

/** Validate and detach a version-two tavern payload, rejecting contradictory service histories. */
export function validateLegacyTavernState(value: unknown, day: number): LegacyTavernState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GameState save: tavern must be an object');
  }
  const raw = value as Record<string, unknown>;
  const level = counter(raw.level, 'level');
  if (level > 2) throw new Error('GameState save: tavern.level is invalid');
  if (typeof raw.welcomeClaimed !== 'boolean') throw new Error('GameState save: tavern.welcomeClaimed is invalid');
  if (!['closed', 'arriving', 'waiting', 'leaving'].includes(raw.phase as string)) {
    throw new Error('GameState save: tavern.phase is invalid');
  }
  if (typeof raw.phaseElapsedMs !== 'number' || !Number.isFinite(raw.phaseElapsedMs) || raw.phaseElapsedMs < 0) {
    throw new Error('GameState save: tavern.phaseElapsedMs is invalid');
  }
  const state: LegacyTavernState = {
    level: level as LegacyTavernState['level'], portions: counter(raw.portions, 'portions'),
    welcomeClaimed: raw.welcomeClaimed, serviceDay: counter(raw.serviceDay, 'serviceDay'),
    quota: counter(raw.quota, 'quota'), servedToday: counter(raw.servedToday, 'servedToday'),
    totalServed: counter(raw.totalServed, 'totalServed'), revenue: counter(raw.revenue, 'revenue'),
    phase: raw.phase as LegacyTavernState['phase'], phaseElapsedMs: raw.phaseElapsedMs,
  };
  /** Name contradictions so a corrupt save remains visible without being silently repaired. */
  const fail = (reason: string): never => { throw new Error(`GameState save: tavern ${reason}`); };
  if (state.welcomeClaimed !== (state.level > 0)) fail('repair and welcome gift disagree');
  if (state.totalServed < state.servedToday || state.revenue !== state.totalServed * TAVERN_MEAL_PRICE) fail('sales totals disagree');
  if (state.level === 2 && state.totalServed < 3) fail('upgrade requires three served patrons');
  if (state.level === 0 && (state.portions !== 0 || state.totalServed !== 0 || state.serviceDay !== 0)) fail('unrepaired tavern has progress');
  if (state.serviceDay === 0) {
    if (state.quota !== 0 || state.servedToday !== 0 || state.phase !== 'closed') fail('unopened service has progress');
  } else {
    if (state.serviceDay !== day || state.level === 0) fail('service day does not match the current day');
    if (state.quota !== 3 && !(state.level === 2 && state.quota === 5)) fail('service quota is invalid');
    if (state.servedToday > state.quota) fail('served count exceeds quota');
  }
  if ((state.phase === 'arriving' || state.phase === 'waiting') && (state.servedToday >= state.quota || state.portions === 0)) fail('active patron has no available meal or quota');
  if (state.phase === 'leaving' && state.servedToday === 0) fail('departing patron has not paid');
  if ((state.phase === 'closed' || state.phase === 'waiting') && state.phaseElapsedMs !== 0) fail('stationary phase has elapsed travel time');
  if (state.phase === 'arriving' && state.phaseElapsedMs >= TAVERN_ARRIVAL_MS) fail('arrival timer exceeds its duration');
  if (state.phase === 'leaving' && state.phaseElapsedMs >= TAVERN_LEAVING_MS) fail('departure timer exceeds its duration');
  return state;
}

/** Finite visitor wardrobe, deliberately separate from recurring named town residents. */
export const TAVERN_VISITORS: ReadonlyArray<{ id: string; name: string; appearance: Appearance; line: string }> = [
  { id: 'visitor-alder', name: 'Alder', line: 'Just what I needed.', appearance: { body: 'original', hairStyle: 'tousled', hat: 'none', facialHair: 'none', shirtStyle: 'tee', garment: 'none', pantsStyle: 'cuffed', eyeColor: 'green', skinTone: 'warm', hairColor: 'black', shirtColor: 'sage', pantsColor: 'earth' } },
  { id: 'visitor-iris', name: 'Iris', line: 'Lovely, thank you!', appearance: { body: 'feminine', hairStyle: 'bob', hat: 'none', facialHair: 'none', shirtStyle: 'striped', garment: 'none', pantsStyle: 'original', eyeColor: 'brown', skinTone: 'brown', hairColor: 'copper', shirtColor: 'cream', pantsColor: 'plum' } },
  { id: 'visitor-cedar', name: 'Cedar', line: 'A good place to rest.', appearance: { body: 'original', hairStyle: 'original', hat: 'knit', facialHair: 'mustache', shirtStyle: 'original', garment: 'none', pantsStyle: 'cuffed', eyeColor: 'grey', skinTone: 'ivory', hairColor: 'silver', shirtColor: 'blue', pantsColor: 'slate' } },
  { id: 'visitor-wren', name: 'Wren', line: 'Worth the journey.', appearance: { body: 'feminine', hairStyle: 'bob', hat: 'straw', facialHair: 'none', shirtStyle: 'tee', garment: 'none', pantsStyle: 'shorts', eyeColor: 'green', skinTone: 'deep', hairColor: 'black', shirtColor: 'rose', pantsColor: 'moss' } },
  { id: 'visitor-reed', name: 'Reed', line: 'I will tell my friends.', appearance: { body: 'original', hairStyle: 'tousled', hat: 'cap', facialHair: 'none', shirtStyle: 'striped', garment: 'none', pantsStyle: 'original', eyeColor: 'brown', skinTone: 'original', hairColor: 'blonde', shirtColor: 'blue', pantsColor: 'earth' } },
  { id: 'visitor-hazel', name: 'Hazel', line: 'So warm and welcoming.', appearance: { body: 'feminine', hairStyle: 'original', hat: 'knit', facialHair: 'none', shirtStyle: 'tee', garment: 'none', pantsStyle: 'cuffed', eyeColor: 'grey', skinTone: 'warm', hairColor: 'copper', shirtColor: 'cream', pantsColor: 'plum' } },
];
/** Catalog prices also define exact save-history accounting. */
export const TAVERN_PRODUCTS = { food: { label: 'Stew', price: 12 }, ale: { label: 'Ale', price: 8 } } as const;
export type TavernProduct = keyof typeof TAVERN_PRODUCTS;
export const TAVERN_ROOM_COUNT = 3;
export const TAVERN_ROOM_PRICE = 24;
export const TAVERN_TILE_TRAVEL_MS = 180;
export const TAVERN_EATING_MS = 2200;
export const TAVERN_MAX_DINERS = 3;
export const TAVERN_UPGRADED_DINERS = 5;
export const TAVERN_ALE_BATCH = { gold: 8, wood: 1, yield: 4 } as const;
export type TavernBatch = 1 | 5 | 'max';

/** One accepted request. Product stock and room capacity are reserved before this guest enters. */
export interface V7TavernGuest {
  id: number;
  visitorId: string;
  kind: 'inn' | 'tavern';
  phase: 'arriving' | 'waiting' | 'ascending' | 'descending' | 'eating' | 'leaving';
  elapsedMs: number;
  destinationId: string;
  product: TavernProduct | null;
  roomId: number | null;
}
/** A paid one-night stay; closing the inn never removes this booking. */
export interface TavernReservation { roomId: number; guestId: number; visitorId: string; checkoutDay: number }
/** Single durable hospitality engine. Portions and ale include units reserved by unpaid guests. */
export interface V7TavernState {
  level: 0 | 1 | 2;
  portions: number;
  ale: number;
  welcomeClaimed: boolean;
  serviceDay: number;
  servedToday: number;
  totalServed: number;
  foodSold: number;
  aleSold: number;
  roomBookings: number;
  revenue: number;
  innOpen: boolean;
  tavernOpen: boolean;
  nextGuestId: number;
  guests: V7TavernGuest[];
  reservations: TavernReservation[];
}

/** Explicit new-game values; migrations use their own conversion, never missing-field defaults. */
export function createV7TavernState(): V7TavernState {
  return { level: 0, portions: 0, ale: 0, welcomeClaimed: false, serviceDay: 0, servedToday: 0,
    totalServed: 0, foodSold: 0, aleSold: 0, roomBookings: 0, revenue: 0,
    innOpen: false, tavernOpen: false, nextGuestId: 1, guests: [], reservations: [] };
}

/** Detach every mutable guest and reservation so exported save data cannot edit the live game. */
export function cloneV7TavernState(state: V7TavernState): V7TavernState {
  return { ...state, guests: state.guests.map(guest => ({ ...guest })), reservations: state.reservations.map(room => ({ ...room })) };
}

/** Keep routes fixed until all accepted guests and paid stays finish, including morning checkout. */
export function isV7HospitalityLayoutLocked(state: V7TavernState): boolean {
  return state.innOpen || state.tavernOpen || state.guests.length > 0 || state.reservations.length > 0;
}

/** Resolve a stable visitor without accepting unknown saved identities. */
export function tavernVisitor(id: string): typeof TAVERN_VISITORS[number] {
  const visitor = TAVERN_VISITORS.find(candidate => candidate.id === id);
  if (!visitor) throw new Error('Tavern: unknown visitor ' + id);
  return visitor;
}

/** Validate and detach current accounting and reservation state; geometry is checked separately. */
export function validateV7TavernState(value: unknown, day: number): V7TavernState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GameState save: tavern must be an object');
  const raw = value as Record<string, unknown>;
  const fields = Object.keys(createV7TavernState());
  if (Object.keys(raw).length !== fields.length || fields.some(field => !(field in raw))) throw new Error('GameState save: tavern fields are invalid');
  for (const field of ['level', 'portions', 'ale', 'serviceDay', 'servedToday', 'totalServed', 'foodSold', 'aleSold', 'roomBookings', 'revenue', 'nextGuestId']) counter(raw[field], field);
  for (const field of ['welcomeClaimed', 'innOpen', 'tavernOpen']) if (typeof raw[field] !== 'boolean') throw new Error('GameState save: tavern.' + field + ' must be boolean');
  if (!Array.isArray(raw.guests) || !Array.isArray(raw.reservations)) throw new Error('GameState save: tavern guests and reservations must be arrays');
  const state = raw as unknown as V7TavernState;
  /** Reject contradictions before a candidate can replace the live singleton. */
  const fail = (reason: string): never => { throw new Error('GameState save: tavern ' + reason); };
  if (state.level > 2 || state.nextGuestId < 1 || state.welcomeClaimed !== (state.level > 0)) fail('repair state is invalid');
  if (state.serviceDay !== 0 && state.serviceDay !== day) fail('service day does not match the current day');
  if (state.totalServed !== state.foodSold + state.aleSold || state.servedToday > state.totalServed) fail('sales totals disagree');
  if (state.revenue !== state.foodSold * 12 + state.aleSold * 8 + state.roomBookings * TAVERN_ROOM_PRICE) fail('revenue disagrees with paid history');
  if (state.level === 2 && state.totalServed < 3) fail('upgrade requires three served patrons');
  if (state.level === 0 && (state.portions || state.ale || state.revenue || state.serviceDay || state.guests.length || state.reservations.length || state.innOpen || state.tavernOpen)) fail('unrepaired shop has progress');
  if (state.serviceDay === 0 && (state.servedToday || state.guests.length || state.innOpen || state.tavernOpen)) fail('unopened shop has active progress');
  const ids = new Set<number>();
  const destinations = new Set<string>();
  const pendingRooms = new Set<number>();
  for (const guest of state.guests) {
    if (!guest || typeof guest !== 'object' || Object.keys(guest).length !== 8) fail('guest fields are invalid');
    counter(guest.id, 'guest.id');
    if (!guest.id || guest.id >= state.nextGuestId || ids.has(guest.id)) fail('guest identity is invalid');
    ids.add(guest.id); tavernVisitor(guest.visitorId);
    if (guest.kind !== 'inn' && guest.kind !== 'tavern') fail('guest kind is invalid');
    if (!['arriving', 'waiting', 'ascending', 'descending', 'eating', 'leaving'].includes(guest.phase)) fail('guest phase is invalid');
    if (!Number.isFinite(guest.elapsedMs) || guest.elapsedMs < 0 || (guest.phase === 'waiting' && guest.elapsedMs !== 0)) fail('guest timer is invalid');
    if (typeof guest.destinationId !== 'string' || !guest.destinationId || (guest.phase !== 'descending' && destinations.has(guest.destinationId))) fail('guest destination is invalid');
    if (guest.phase !== 'descending') destinations.add(guest.destinationId);
    if (guest.kind === 'inn') {
      if (guest.phase === 'descending') {
        if (guest.product !== null || guest.roomId !== null || guest.destinationId !== 'stairs-exit') fail('checkout guest is invalid');
        continue;
      }
      if (guest.product !== null || !Number.isInteger(guest.roomId) || guest.roomId === null || guest.roomId < 1 || guest.roomId > TAVERN_ROOM_COUNT) fail('inn request is invalid');
      if (!['arriving', 'waiting', 'ascending'].includes(guest.phase)) fail('inn phase is invalid');
      if (pendingRooms.has(guest.roomId as number)) fail('room is promised twice');
      pendingRooms.add(guest.roomId as number);
    } else {
      if (guest.roomId !== null || (guest.product !== 'food' && guest.product !== 'ale') ||
          !['arriving', 'waiting', 'eating', 'leaving'].includes(guest.phase)) fail('dining request is invalid');
    }
  }
  if (state.guests.filter(guest => guest.kind === 'tavern').length > (state.level === 2 ? TAVERN_UPGRADED_DINERS : TAVERN_MAX_DINERS) ||
      state.guests.filter(guest => guest.kind === 'inn' && guest.phase !== 'descending').length > 1 ||
      state.guests.filter(guest => guest.phase === 'descending').length > TAVERN_ROOM_COUNT) fail('guest capacity exceeded');
  for (const product of ['food', 'ale'] as const) {
    const promised = state.guests.filter(guest => guest.product === product && (guest.phase === 'arriving' || guest.phase === 'waiting')).length;
    if (promised > (product === 'food' ? state.portions : state.ale)) fail('orders exceed available stock');
    const paid = state.guests.filter(guest => guest.product === product && (guest.phase === 'eating' || guest.phase === 'leaving')).length;
    if (paid > (product === 'food' ? state.foodSold : state.aleSold)) fail('paid diners exceed sales history');
  }
  const roomIds = new Set<number>();
  const bookingIds = new Set<number>();
  for (const room of state.reservations) {
    if (!room || typeof room !== 'object' || Object.keys(room).length !== 4) fail('reservation fields are invalid');
    counter(room.roomId, 'roomId'); counter(room.guestId, 'guestId'); counter(room.checkoutDay, 'checkoutDay');
    tavernVisitor(room.visitorId);
    if (room.roomId < 1 || room.roomId > TAVERN_ROOM_COUNT || roomIds.has(room.roomId) || bookingIds.has(room.guestId) || room.guestId < 1 || room.guestId >= state.nextGuestId || room.checkoutDay !== day + 1) fail('reservation is invalid');
    roomIds.add(room.roomId); bookingIds.add(room.guestId);
    const guest = state.guests.find(candidate => candidate.id === room.guestId);
    if (guest && (guest.phase !== 'ascending' || guest.roomId !== room.roomId || guest.visitorId !== room.visitorId)) fail('paid guest and booking disagree');
    if (pendingRooms.has(room.roomId) && (!guest || guest.phase !== 'ascending')) fail('occupied room is promised twice');
  }
  if (state.reservations.length > state.roomBookings) fail('reservations exceed paid bookings');
  if (state.guests.filter(guest => guest.phase === 'descending').length + state.reservations.length > state.roomBookings) fail('checked-out guests exceed paid bookings');
  if (state.guests.some(guest => guest.phase === 'ascending' && !bookingIds.has(guest.id))) fail('ascending guest has not paid');
  return cloneV7TavernState(state);
}

/** Living-service phases persist movement, social pauses, patience and paid upstairs stays. */
export type TavernPhase = 'arriving' | 'wandering' | 'chatting' | 'waiting' | 'eating' | 'lingering' | 'ascending' | 'upstairs' | 'descending' | 'leaving';
export const TAVERN_IMPATIENT_MS = 25000;
export const TAVERN_ANGRY_MS = 45000;
export const TAVERN_PATIENCE_MS = 65000;
/** A scuffle ends on its own without changing sales, reputation, or future admissions. */
export const TAVERN_FIGHT_MS = 20000;
/** Sorted, disjoint guest identities and the one shared scuffle clock. */
export interface TavernFight { guestIds: [number, number]; elapsedMs: number }
/** Current guest identity never changes during a room stay, including downstairs visits. */
export interface TavernGuest {
  id: number;
  visitorId: string;
  kind: 'inn' | 'tavern';
  phase: TavernPhase;
  elapsedMs: number;
  destinationId: string;
  product: TavernProduct | null;
  roomId: number | null;
  /** Current cardinal tile route; saved explicitly so interrupted departures do not teleport. */
  route: { tx: number; ty: number }[];
  drinks: number;
  orders: number;
}
/** Current state has no hidden pantry: all prepared products live in player inventory. */
export interface TavernState extends Omit<V7TavernState, 'guests' | 'portions' | 'ale'> {
  guests: TavernGuest[];
  admissionMs: number;
  admissionWaitMs: number;
  fights: TavernFight[];
}
/** New games explicitly start closed, with no active timers, guests or prepared products. */
export function createTavernState(): TavernState {
  const { portions: _portions, ale: _ale, guests: _guests, ...state } = createV7TavernState();
  return { ...state, guests: [], admissionMs: 0, admissionWaitMs: 2800, fights: [] };
}
/** Detach nested path cells as well as identities and bookings before exposing save data. */
export function cloneTavernState(state: TavernState): TavernState {
  return { ...state, guests: state.guests.map(guest => ({ ...guest, route: guest.route.map(tile => ({ ...tile })) })),
    reservations: state.reservations.map(room => ({ ...room })),
    fights: state.fights.map(fight => ({ elapsedMs: fight.elapsedMs, guestIds: [...fight.guestIds] })) };
}
/** Active services and paid stays protect their furniture routes from decoration edits. */
export function isHospitalityLayoutLocked(state: TavernState): boolean {
  return state.innOpen || state.tavernOpen || state.guests.length > 0 || state.reservations.length > 0;
}
/** Reproducible phase durations depend only on saved identity; no shared random stream is consumed. */
export function tavernPhaseDuration(guest: TavernGuest): number {
  switch (guest.phase) {
    case 'waiting': return TAVERN_PATIENCE_MS;
    case 'upstairs': return 12000 + (guest.id * 1777 % 11000);
    case 'chatting': return 8500 + (guest.id * 733 % 3200);
    case 'lingering': return 2600 + (guest.id * 419 % 2400);
    case 'eating': return 4200;
    default: return Math.max(1, guest.route.length - 1) * TAVERN_TILE_TRAVEL_MS;
  }
}
/** Validate the exact old shape before explicitly adding version-nine fight state. */
export function migrateV8TavernState(value: unknown, day: number): TavernState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GameState save: v8 tavern must be an object');
  const raw = value as Record<string, unknown>;
  const fields = Object.keys(createTavernState()).filter(field => field !== 'fights');
  if (Object.keys(raw).length !== fields.length || fields.some(field => !(field in raw))) throw new Error('GameState save: v8 tavern fields are invalid');
  return validateTavernState({ ...raw, fights: [] }, day);
}
/** Strict version-nine shape/accounting validation precedes furniture and path validation. */
export function validateTavernState(value: unknown, day: number): TavernState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GameState save: tavern must be an object');
  const raw = value as Record<string, unknown>, fields = Object.keys(createTavernState());
  const fail = (reason: string): never => { throw new Error('GameState save: tavern ' + reason); };
  if (Object.keys(raw).length !== fields.length || fields.some(field => !(field in raw))) fail('fields are invalid');
  for (const field of ['level', 'serviceDay', 'servedToday', 'totalServed', 'foodSold', 'aleSold', 'roomBookings', 'revenue', 'nextGuestId']) counter(raw[field], field);
  for (const field of ['welcomeClaimed', 'innOpen', 'tavernOpen']) if (typeof raw[field] !== 'boolean') fail(field + ' must be boolean');
  if (!Array.isArray(raw.guests) || !Array.isArray(raw.reservations) || !Array.isArray(raw.fights)) fail('guests, reservations, and fights must be arrays');
  const state = raw as unknown as TavernState;
  if (state.level > 2 || state.nextGuestId < 1 || state.welcomeClaimed !== (state.level > 0)) fail('repair state is invalid');
  if (state.serviceDay !== 0 && state.serviceDay !== day) fail('service day does not match the current day');
  if (state.totalServed !== state.foodSold + state.aleSold || state.servedToday > state.totalServed) fail('sales totals disagree');
  if (!Number.isSafeInteger(state.foodSold * 12 + state.aleSold * 8 + state.roomBookings * 24) ||
      state.revenue !== state.foodSold * 12 + state.aleSold * 8 + state.roomBookings * 24) fail('revenue disagrees with paid history');
  if (state.level === 2 && state.totalServed < 3) fail('upgrade requires three served patrons');
  if (state.level === 0 && (state.revenue || state.serviceDay || state.guests.length || state.reservations.length || state.innOpen || state.tavernOpen)) fail('unrepaired shop has progress');
  if (state.serviceDay === 0 && (state.servedToday || state.guests.length || state.innOpen || state.tavernOpen || state.reservations.length)) fail('unopened shop has active progress');
  if (!Number.isFinite(state.admissionMs) || state.admissionMs < 0 || !Number.isSafeInteger(state.admissionWaitMs) ||
      state.admissionWaitMs < 2800 || state.admissionWaitMs > 9000 || state.admissionMs >= state.admissionWaitMs) fail('admission timer is invalid');
  const ids = new Set<number>(), rooms = new Set<number>(), bookingIds = new Set<number>();
  for (const room of state.reservations) {
    if (!room || typeof room !== 'object' || Object.keys(room).length !== 4) fail('reservation fields are invalid');
    counter(room.roomId, 'roomId'); counter(room.guestId, 'guestId'); counter(room.checkoutDay, 'checkoutDay'); tavernVisitor(room.visitorId);
    if (room.roomId < 1 || room.roomId > 3 || rooms.has(room.roomId) || bookingIds.has(room.guestId) ||
        room.guestId < 1 || room.guestId >= state.nextGuestId || room.checkoutDay !== day + 1) fail('reservation is invalid');
    rooms.add(room.roomId); bookingIds.add(room.guestId);
  }
  for (const guest of state.guests) {
    if (!guest || typeof guest !== 'object' || Object.keys(guest).length !== 11) fail('guest fields are invalid');
    counter(guest.id, 'guest.id'); counter(guest.drinks, 'guest.drinks'); counter(guest.orders, 'guest.orders');
    if (!guest.id || guest.id >= state.nextGuestId || ids.has(guest.id)) fail('guest identity is invalid');
    // V7 recycled wardrobe appearances while rooms were occupied; guest IDs remain authoritative.
    ids.add(guest.id); tavernVisitor(guest.visitorId);
    if (guest.kind !== 'inn' && guest.kind !== 'tavern') fail('guest kind is invalid');
    if (!['arriving','wandering','chatting','waiting','eating','lingering','ascending','upstairs','descending','leaving'].includes(guest.phase)) fail('guest phase is invalid');
    if (typeof guest.destinationId !== 'string' || !guest.destinationId) fail('guest destination is invalid');
    if (guest.product !== null && guest.product !== 'food' && guest.product !== 'ale') fail('guest product is invalid');
    if (guest.drinks > guest.orders || guest.drinks > state.aleSold || guest.orders > state.totalServed) fail('guest consumption exceeds sales');
    if (!Array.isArray(guest.route) || !guest.route.length || guest.route.length > 2048 ||
        guest.route.some(tile => !tile || Object.keys(tile).length !== 2 || !Number.isSafeInteger(tile.tx) || !Number.isSafeInteger(tile.ty))) fail('guest route is invalid');
    if (!Number.isFinite(guest.elapsedMs) || guest.elapsedMs < 0 || guest.elapsedMs >= tavernPhaseDuration(guest)) fail('guest timer exceeds phase duration');
    const booking = state.reservations.find(room => room.guestId === guest.id);
    if (guest.product === null && (['eating','lingering'].includes(guest.phase) ||
      (['arriving','waiting'].includes(guest.phase) && (guest.kind === 'tavern' || booking)))) fail('dining phase has no requested product');
    if (guest.kind === 'tavern') {
      if (guest.roomId !== null || ['ascending','upstairs','descending'].includes(guest.phase)) fail('diner has room-only phase');
    } else if (booking) {
      if (guest.roomId !== booking.roomId || guest.visitorId !== booking.visitorId) fail('paid guest and booking disagree');
    } else if (guest.roomId !== null) {
      if (!Number.isInteger(guest.roomId) || guest.roomId < 1 || guest.roomId > 3 || rooms.has(guest.roomId) ||
          !['arriving','waiting','leaving'].includes(guest.phase) || guest.product !== null) fail('unpaid room request is invalid');
      rooms.add(guest.roomId);
    } else if (guest.phase !== 'leaving' || guest.product !== null) fail('checkout guest is invalid');
    if ((guest.phase === 'upstairs' || guest.phase === 'ascending' || guest.phase === 'descending') && !booking) fail('room movement has no paid booking');
    if ((guest.phase === 'eating' || guest.phase === 'lingering') && guest.orders === 0) fail('diner has not paid');
    if (guest.phase === 'waiting' && guest.product === null && (guest.kind !== 'inn' || booking)) fail('waiting request has no product');
  }
  if (state.reservations.length > state.roomBookings || state.reservations.some(room => {
    const guest = state.guests.find(candidate => candidate.id === room.guestId);
    return !guest || guest.kind !== 'inn' || guest.roomId !== room.roomId || guest.visitorId !== room.visitorId || guest.phase === 'leaving';
  })) fail('paid stay has no matching persistent inn guest');
  if (state.guests.filter(guest => guest.kind === 'tavern').length > (state.level === 2 ? 5 : 3) ||
      state.guests.filter(guest => guest.kind === 'inn' && guest.roomId !== null && !bookingIds.has(guest.id)).length > 1 ||
      state.guests.length > TAVERN_UPGRADED_DINERS + TAVERN_ROOM_COUNT) fail('guest capacity exceeded');
  const fighting = new Set<number>();
  for (const fight of state.fights) {
    if (!fight || typeof fight !== 'object' || Object.keys(fight).length !== 2 || !Array.isArray(fight.guestIds) || fight.guestIds.length !== 2 ||
        !Number.isFinite(fight.elapsedMs) || fight.elapsedMs < 0 || fight.elapsedMs >= TAVERN_FIGHT_MS) fail('fight fields or timer are invalid');
    const [first, second] = fight.guestIds;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first >= second) fail('fight identities must be sorted and distinct');
    const guests = fight.guestIds.map(id => state.guests.find(guest => guest.id === id));
    if (guests.some(guest => !guest || !['arriving','wandering','chatting','waiting','eating','lingering'].includes(guest.phase)) ||
        fight.guestIds.some(id => fighting.has(id))) fail('fight participant is absent, unavailable, or duplicated');
    const [a, b] = guests;
    if (!a || !b || !((a.drinks >= 3 && b.phase === 'waiting' && b.elapsedMs >= TAVERN_ANGRY_MS) ||
      (b.drinks >= 3 && a.phase === 'waiting' && a.elapsedMs >= TAVERN_ANGRY_MS))) fail('fight requires a drunk guest and a different angry guest');
    for (const id of fight.guestIds) fighting.add(id);
  }
  return cloneTavernState(state);
}
