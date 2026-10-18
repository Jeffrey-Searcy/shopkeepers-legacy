/** Derive shop destinations and paths from durable furniture; no second furniture registry exists. */
import { SceneKey } from '../config/AssetKeys';
import { furnitureCells, furnitureDefinition, type PlacedFurniture } from '../config/Furniture';
import { TAVERN_ARRIVAL_MS, TAVERN_LEAVING_MS, TAVERN_VISITORS, createV7TavernState, createTavernState, validateLegacyTavernState, validateV7TavernState, tavernPhaseDuration,
  TAVERN_EATING_MS, TAVERN_TILE_TRAVEL_MS, type TavernGuest, type TavernState, type V7TavernState, type V7TavernGuest } from '../config/Tavern';
import type { MapData } from '../world/MapDef';

/** One whole floor tile shared by route rendering and interaction checks. */
export interface TavernTile { tx: number; ty: number }
export type TavernFacing = 'down' | 'left' | 'up' | 'right';
/** One bar lane, including the player-only serving side. */
export interface TavernServiceLayout {
  bar: PlacedFurniture; counter: TavernTile; keeper: TavernTile & { facing: 'down' | 'right' };
  guest: TavernTile; path: TavernTile[];
}
/** Stable furniture-derived request destination. Seats end on their own chair tile only. */
export interface TavernDestination {
  id: string; kind: 'bar' | 'seat' | 'register' | 'social'; tile: TavernTile; facing: TavernFacing;
  path: TavernTile[]; keeper: (TavernTile & { facing: TavernFacing }) | null;
}
/** Incomplete layouts expose stations and separate inn/tavern readiness reasons. */
export interface TavernLayout {
  registers: PlacedFurniture[]; stoves: PlacedFurniture[]; service: TavernServiceLayout | null;
  destinations: TavernDestination[]; inn: TavernDestination | null; stairPath: TavernTile[] | null;
  checkoutPath: TavernTile[] | null; social: TavernDestination[]; ok: boolean; message: string; innOk: boolean; innMessage: string;
}
/** Map-local geometry input used by runtime and candidate-save validation. */
interface LayoutInput { placedItems: readonly PlacedFurniture[]; map: MapData }

/** Encode a tile for deterministic graph traversal. */
function key(tile: TavernTile): string { return `${tile.tx},${tile.ty}`; }
/** Stable neighbor order makes equal-length routes reproducible after loading. */
function neighbors(tile: TavernTile): TavernTile[] {
  return [{ tx: tile.tx, ty: tile.ty - 1 }, { tx: tile.tx - 1, ty: tile.ty },
    { tx: tile.tx + 1, ty: tile.ty }, { tx: tile.tx, ty: tile.ty + 1 }];
}
/** Build shortest paths over authoritative solids. A seat endpoint is the sole furniture exception. */
export function findTavernPath(input: LayoutInput, start: TavernTile, target: TavernTile, chairEndpoint = false): TavernTile[] | null {
  const { map } = input;
  const blocked = new Set<string>();
  for (const item of input.placedItems) if (item.scene === SceneKey.Tavern && furnitureDefinition(item.item).blocking) {
    for (const cell of furnitureCells(item.item, item.tx, item.ty, item.rotation)) {
      if (!(chairEndpoint && item.item === 'chair' && (key(cell) === key(target) || key(cell) === key(start)))) blocked.add(key(cell));
    }
  }
  /** Reserved circulation stays walkable; tilemap solids never depend on art dimensions. */
  const walkable = (tile: TavernTile): boolean => tile.tx >= 0 && tile.ty >= 0 && tile.tx < map.w && tile.ty < map.h &&
    !map.solid[tile.ty][tile.tx] && !blocked.has(key(tile));
  if (!walkable(start) || !walkable(target)) return null;
  const queue = [{ tx: start.tx, ty: start.ty }];
  const previous = new Map<string, TavernTile | null>([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (key(current) === key(target)) {
      const path = [current];
      let cursor = previous.get(key(current));
      while (cursor) { path.push(cursor); cursor = previous.get(key(cursor)); }
      return path.reverse();
    }
    for (const next of neighbors(current)) if (walkable(next) && !previous.has(key(next))) {
      previous.set(key(next), current); queue.push(next);
    }
  }
  return null;
}

/** Resolve reachable bar lanes, inward-facing chairs, a register queue, and NPC-only stairs. */
export function resolveTavernLayout(input: LayoutInput, legacyRegisterApproach = false): TavernLayout {
  const { map } = input;
  if (map.key !== SceneKey.Tavern) throw new Error('TavernLayout: requires the shop map');
  const entry = map.spawns.find(spawn => spawn.id === 'entry');
  if (!entry) throw new Error('TavernLayout: shop entry spawn is missing');
  const items = input.placedItems.filter(item => item.scene === SceneKey.Tavern).slice()
    .sort((a, b) => a.ty - b.ty || a.tx - b.tx || a.rotation - b.rotation || a.item.localeCompare(b.item));
  /** Resolve entrance routes consistently for station edges and customer destinations. */
  const pathTo = (target: TavernTile, chair = false): TavernTile[] | null => findTavernPath(input, entry, target, chair);
  const registers = items.filter(item => item.item === 'register');
  const stoves = items.filter(item => item.item === 'stove');
  /** Return sorted reachable edge cells; shortest routes win, then row and column. */
  const approaches = (item: PlacedFurniture): TavernTile[][] => furnitureCells(item.item, item.tx, item.ty, item.rotation)
    .flatMap(cell => neighbors(cell)).map(tile => pathTo(tile)).filter((path): path is TavernTile[] => path !== null)
    .sort((a, b) => a.length - b.length || a[a.length - 1].ty - b[b.length - 1].ty || a[a.length - 1].tx - b[b.length - 1].tx);
  const candidates: TavernServiceLayout[] = [];
  const destinations: TavernDestination[] = [];
  for (const bar of items.filter(item => item.item === 'bar')) {
    for (const cell of furnitureCells(bar.item, bar.tx, bar.ty, bar.rotation)) {
      const keeper: TavernServiceLayout['keeper'] = bar.rotation === 0
        ? { tx: cell.tx, ty: cell.ty - 1, facing: 'down' } : { tx: cell.tx - 1, ty: cell.ty, facing: 'right' };
      const guest = bar.rotation === 0 ? { tx: cell.tx, ty: cell.ty + 1 } : { tx: cell.tx + 1, ty: cell.ty };
      const path = pathTo(guest);
      if (path && pathTo(keeper)) {
        candidates.push({ bar, keeper, guest, counter: cell, path });
        destinations.push({ id: 'bar:' + key(cell), kind: 'bar', tile: guest, facing: bar.rotation === 0 ? 'up' : 'left', path, keeper });
      }
    }
  }
  const tableCells = new Set(items.filter(item => item.item === 'table').flatMap(item => furnitureCells(item.item, item.tx, item.ty, item.rotation)).map(key));
  const facing: TavernFacing[] = ['down', 'left', 'up', 'right'];
  const delta = [{ tx: 0, ty: 1 }, { tx: -1, ty: 0 }, { tx: 0, ty: -1 }, { tx: 1, ty: 0 }];
  for (const chair of items.filter(item => item.item === 'chair')) {
    const front = { tx: chair.tx + delta[chair.rotation].tx, ty: chair.ty + delta[chair.rotation].ty };
    if (!tableCells.has(key(front))) continue;
    const tile = { tx: chair.tx, ty: chair.ty };
    const path = pathTo(tile, true);
    if (path) destinations.push({ id: 'seat:' + key(tile), kind: 'seat', tile, facing: facing[chair.rotation], path, keeper: null });
  }
  destinations.sort((a, b) => a.path.length - b.path.length || a.id.localeCompare(b.id));
  // Perpendicular bar lanes can point to one floor tile; only one physical customer fits there.
  const uniqueDestinations = destinations.filter((destination, index) =>
    destinations.findIndex(candidate => key(candidate.tile) === key(destination.tile)) === index);
  candidates.sort((a, b) => a.path.length - b.path.length || a.bar.ty - b.bar.ty || a.bar.tx - b.bar.tx || a.counter.ty - b.counter.ty || a.counter.tx - b.counter.tx);
  const service = candidates.length ? candidates[0] : null;
  let inn: TavernDestination | null = null;
  for (const register of registers) {
    if (legacyRegisterApproach) {
      const paths = approaches(register).filter(path => !uniqueDestinations.some(destination => key(destination.tile) === key(path[path.length - 1])));
      if (!paths.length) continue;
      const path = paths[0], tile = path[path.length - 1];
      inn = { id: 'register:' + key(register), kind: 'register', tile,
        facing: tile.ty > register.ty ? 'up' : tile.ty < register.ty ? 'down' : tile.tx > register.tx ? 'left' : 'right', path, keeper: null };
      break;
    }
    const tile = { tx: register.tx, ty: register.ty + 1 };
    const keeper = { tx: register.tx, ty: register.ty - 1, facing: 'down' as const };
    const path = pathTo(tile);
    if (!path || !pathTo(keeper) || uniqueDestinations.some(destination => key(destination.tile) === key(tile))) continue;
    inn = { id: 'register:' + key(register), kind: 'register', tile, facing: 'up', path, keeper };
    break;
  }
  let stairPath: TavernTile[] | null = null;
  let checkoutPath: TavernTile[] | null = null;
  if (map.hospitality) {
    const { stairApproach, stairExit } = map.hospitality;
    if (stairApproach.tx !== stairExit.tx || stairExit.ty >= stairApproach.ty) throw new Error('TavernLayout: authored stairs must ascend north in one column');
    const stairs: TavernTile[] = [];
    // Only this authored NPC stair segment can cross structural wall tiles.
    for (let ty = stairApproach.ty; ty >= stairExit.ty; ty--) stairs.push({ tx: stairApproach.tx, ty });
    const exitFloor = findTavernPath(input, stairApproach, entry);
    if (exitFloor) checkoutPath = [...stairs].reverse().concat(exitFloor.slice(1));
    // Paid residents use the entrance-to-stairs route even if a relocated register cannot admit new guests.
    if (checkoutPath) stairPath = [...checkoutPath].reverse();
    if (inn) {
      const floorPath = findTavernPath(input, inn.tile, stairApproach);
      if (floorPath) stairPath = floorPath.concat(stairs.slice(1));
    }
  }
  let message = '';
  if (!registers.length) message = 'Craft and place a register before opening.';
  else if (!registers.some(item => approaches(item).length)) message = 'Clear a path to your register before opening.';
  else if (!stoves.length) message = 'Craft and place a stove before opening.';
  else if (!stoves.some(item => approaches(item).length)) message = 'Clear a path to your stove before opening.';
  else if (!uniqueDestinations.length) message = 'Place a reachable bar, or a chair facing a table.';
  let innMessage = '';
  if (!inn) innMessage = 'Place a register with a clear guest approach.';
  else if (!stairPath) innMessage = 'Clear a path from the register to the stairs.';
  // Open floor pockets give each identity a different pause before choosing a seat.
  const social: TavernDestination[] = [];
  for (let ty = 7; ty < map.h - 3 && social.length < 8; ty += 3) {
    for (let tx = 5; tx < map.w - 4 && social.length < 8; tx += 4) {
      const left = { tx, ty }, right = { tx: tx + 1, ty }, leftPath = pathTo(left), rightPath = pathTo(right);
      if (!leftPath || !rightPath || [left, right].some(tile => uniqueDestinations.some(destination => key(destination.tile) === key(tile)) || (inn && key(inn.tile) === key(tile)))) continue;
      // Paired floor pockets let visitors face each other while leaving nearby circulation clear.
      social.push({ id: 'social:' + key(left), kind: 'social', tile: left, facing: 'right', path: leftPath, keeper: null },
        { id: 'social:' + key(right), kind: 'social', tile: right, facing: 'left', path: rightPath, keeper: null });
    }
  }
  return { registers, stoves, service, social, destinations: uniqueDestinations, inn, stairPath, checkoutPath, ok: !message, message, innOk: !innMessage, innMessage };
}


/** Resolve a furniture or social destination by stable id, refusing missing active geometry. */
export function tavernDestination(id: string, layout: TavernLayout): TavernDestination {
  const destination = [...layout.destinations, ...layout.social, ...(layout.inn ? [layout.inn] : [])].find(candidate => candidate.id === id);
  if (destination) return destination;
  if (id === 'stairs-exit' && layout.checkoutPath) {
    const path = layout.checkoutPath;
    return { id, kind: 'social', tile: path[path.length - 1], facing: 'down', path, keeper: null };
  }
  throw new Error('GameState save: active tavern layout lost a guest destination: ' + id);
}
/** Saved cardinal routes render identically before and after load, including interrupted movement. */
export function tavernGuestRoute(guest: TavernGuest, layout: TavernLayout): { destination: TavernDestination; path: TavernTile[]; durationMs: number } {
  return { destination: tavernDestination(guest.destinationId, layout), path: guest.route, durationMs: tavernPhaseDuration(guest) };
}
/** Resolve a guest's current whole route tile for shared contact and interruption rules. */
export function tavernGuestTile(guest: TavernGuest): TavernTile {
  const moving = ['arriving','wandering','ascending','descending','leaving'].includes(guest.phase);
  const index = moving ? Math.min(guest.route.length - 1, Math.floor(guest.elapsedMs / TAVERN_TILE_TRAVEL_MS)) : guest.route.length - 1;
  return { ...guest.route[index] };
}
/** Contact requires at most two traversable floor edges, never proximity through a wall or bar. */
export function tavernGuestsCanContact(first: TavernGuest, second: TavernGuest, input: LayoutInput): boolean {
  const a = tavernGuestTile(first), b = tavernGuestTile(second);
  if (Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) > 2) return false;
  const path = findTavernPath(input, a, b, true);
  return path !== null && path.length <= 3;
}
/** Legacy routes remain available solely for explicit v6/v7 migration and proportional timers. */
function v7Route(guest: V7TavernGuest, layout: TavernLayout): { path: TavernTile[]; durationMs: number } {
  let path: TavernTile[];
  if (guest.phase === 'descending') {
    if (!layout.checkoutPath) throw new Error('GameState save: active tavern layout lost its checkout route');
    path = layout.checkoutPath;
  } else {
    const destination = tavernDestination(guest.destinationId, layout);
    path = destination.path;
    if (guest.phase === 'ascending') {
      if (!layout.stairPath) throw new Error('GameState save: active tavern layout lost its stairs');
      path = layout.stairPath;
    } else if (guest.phase === 'leaving') path = [...path].reverse();
  }
  return { path, durationMs: guest.phase === 'waiting' ? 0 : guest.phase === 'eating' ? TAVERN_EATING_MS : Math.max(1, path.length - 1) * TAVERN_TILE_TRAVEL_MS };
}
/** Validate real route cells, cardinal edges and final targets before accepting a durable candidate. */
export function validateTavernLayoutState(state: TavernState, placedItems: readonly PlacedFurniture[], map: MapData): void {
  const layout = resolveTavernLayout({ placedItems, map });
  const entry = map.spawns.find(spawn => spawn.id === 'entry');
  if (!entry) throw new Error('GameState save: tavern entry spawn is missing');
  if (state.reservations.length && !layout.checkoutPath) throw new Error('GameState save: active tavern layout lost the paid-room checkout route');
  if ((state.tavernOpen || state.guests.some(guest => guest.kind === 'tavern' && guest.phase !== 'leaving')) && !layout.ok) throw new Error('GameState save: active tavern layout: ' + layout.message);
  if (state.innOpen && !layout.innOk) throw new Error('GameState save: active tavern layout: ' + layout.innMessage);
  const occupied = new Set<string>();
  const blocked = new Set(placedItems.filter(item => item.scene === SceneKey.Tavern && furnitureDefinition(item.item).blocking)
    .flatMap(item => furnitureCells(item.item, item.tx, item.ty, item.rotation)).map(key));
  for (const guest of state.guests) {
    const route = tavernGuestRoute(guest, layout), destination = route.destination;
    const last = guest.route[guest.route.length - 1];
    if (['waiting','eating','lingering','chatting','upstairs'].includes(guest.phase) && guest.route.length !== 1) throw new Error('GameState save: stationary tavern guest has a travel route');
    if (['ascending','upstairs'].includes(guest.phase) && (!map.hospitality || key(last) !== key(map.hospitality.stairExit))) throw new Error('GameState save: upstairs guest misses stair exit');
    if (guest.phase === 'leaving' && key(last) !== key(entry)) throw new Error('GameState save: departing route misses entry');
    if (guest.phase === 'descending' && (!map.hospitality || key(last) !== key(map.hospitality.stairApproach))) throw new Error('GameState save: downstairs guest misses stair approach');
    if (['wandering','chatting'].includes(guest.phase) && destination.kind !== 'social') throw new Error('GameState save: social guest has no floor pocket');
    if (['wandering','chatting','arriving','waiting','eating','lingering'].includes(guest.phase) && key(last) !== key(destination.tile)) throw new Error('GameState save: tavern route misses destination');
    if (['waiting','arriving','eating','lingering'].includes(guest.phase) && guest.product !== null && !['bar','seat'].includes(destination.kind)) throw new Error('GameState save: dining guest has no service destination');
    if (['waiting','arriving'].includes(guest.phase) && guest.product === null && destination.kind !== 'register') throw new Error('GameState save: room guest has no register destination');
    for (let index = 0; index < guest.route.length; index++) {
      const tile = guest.route[index], previous = guest.route[index - 1];
      if (tile.tx < 0 || tile.ty < 0 || tile.tx >= map.w || tile.ty >= map.h) throw new Error('GameState save: tavern route leaves map');
      const stairs = map.hospitality && tile.tx === map.hospitality.stairApproach.tx && tile.ty <= map.hospitality.stairApproach.ty && tile.ty >= map.hospitality.stairExit.ty;
      const allowedStairs = stairs && ['ascending','descending','upstairs','leaving'].includes(guest.phase) && guest.kind === 'inn';
      const chair = (destination.kind === 'seat' && key(destination.tile) === key(tile)) ||
        (index === 0 && placedItems.some(item => item.scene === SceneKey.Tavern && item.item === 'chair' && item.tx === tile.tx && item.ty === tile.ty));
      if ((map.solid[tile.ty][tile.tx] && !allowedStairs) || (blocked.has(key(tile)) && !chair)) throw new Error('GameState save: tavern route crosses blocked furniture');
      if (previous && Math.abs(tile.tx - previous.tx) + Math.abs(tile.ty - previous.ty) !== 1) throw new Error('GameState save: tavern route is not cardinal');
    }
    if (guest.elapsedMs >= route.durationMs) throw new Error('GameState save: tavern guest timer exceeds route duration');
    if (['wandering','chatting','waiting','eating','lingering','arriving'].includes(guest.phase)) {
      if (occupied.has(key(destination.tile))) throw new Error('GameState save: tavern destinations overlap');
      occupied.add(key(destination.tile));
      if (key(guest.route[guest.route.length - 1]) !== key(destination.tile)) throw new Error('GameState save: tavern route misses destination');
    }
  }
  for (const fight of state.fights) {
    const first = state.guests.find(guest => guest.id === fight.guestIds[0]);
    const second = state.guests.find(guest => guest.id === fight.guestIds[1]);
    if (!first || !second || !tavernGuestsCanContact(first, second, { placedItems, map })) throw new Error('GameState save: fight participants lack nearby floor access');
  }
}
/** Upgrade validated v7 guests without changing money, served inventory or accepted room identity. */
export function migrateV7TavernState(value: unknown, day: number, placedItems: readonly PlacedFurniture[], map: MapData): TavernState {
  const old = validateV7TavernState(value, day), layout = resolveTavernLayout({ placedItems, map });
  const oldLayout = resolveTavernLayout({ placedItems, map }, true);
  const { portions: _portions, ale: _ale, guests: _guests, ...base } = old;
  const state: TavernState = { ...createTavernState(), ...base, guests: [] };
  // The documented v8 migration closes only new bookings when front/back register access is blocked.
  if (!layout.innOk) state.innOpen = false;
  for (const guest of old.guests) {
    const oldRoute = v7Route(guest, oldLayout);
    if (guest.phase !== 'waiting' && guest.elapsedMs >= oldRoute.durationMs) throw new Error('GameState save: v7 tavern timer exceeds its route');
    // The first usable register may change when v8 requires clear front and back access.
    const relocated = guest.kind === 'inn' && guest.phase !== 'descending' && layout.innOk && layout.inn
      ? { ...guest, destinationId: layout.inn.id } : guest;
    const route = guest.kind === 'inn' && !layout.innOk ? oldRoute : v7Route(relocated, layout);
    const next: TavernGuest = { ...relocated, route: route.path.map(tile => ({ ...tile })), drinks: guest.product === 'ale' && ['eating','leaving'].includes(guest.phase) ? 1 : 0,
      orders: ['eating','leaving'].includes(guest.phase) && guest.kind === 'tavern' ? 1 : 0 };
    if (next.phase === 'descending') next.phase = 'leaving';
    if (guest.phase !== 'waiting') next.elapsedMs = guest.elapsedMs / oldRoute.durationMs * tavernPhaseDuration(next);
    if (guest.kind === 'inn' && !layout.innOk) {
      next.destinationId = 'stairs-exit';
      if (guest.phase === 'arriving' || guest.phase === 'waiting') {
        const index = guest.phase === 'waiting' ? oldRoute.path.length - 1 : Math.min(oldRoute.path.length - 1, Math.floor(guest.elapsedMs / TAVERN_TILE_TRAVEL_MS));
        next.phase = 'leaving'; next.elapsedMs = 0; next.roomId = null;
        next.route = oldRoute.path.slice(0, index + 1).reverse();
      }
    }
    if (next.phase === 'waiting') next.route = [{ ...next.route[next.route.length - 1] }];
    if (next.phase === 'eating') {
      next.elapsedMs = guest.elapsedMs / TAVERN_EATING_MS * tavernPhaseDuration(next);
      next.route = [{ ...next.route[next.route.length - 1] }];
    }
    state.guests.push(next);
  }
  for (const room of state.reservations) if (!state.guests.some(guest => guest.id === room.guestId)) {
    if (!layout.stairPath) throw new Error('GameState save: active tavern layout lost paid room stairs');
    state.guests.push({ id: room.guestId, visitorId: room.visitorId, kind: 'inn', phase: 'upstairs', elapsedMs: 0,
      destinationId: layout.inn ? layout.inn.id : 'stairs-exit', product: null, roomId: room.roomId, drinks: 0, orders: 0,
      route: [{ ...layout.stairPath[layout.stairPath.length - 1] }] });
  }
  return state;
}

/** Convert a validated legacy service after furniture validation; already-paid departure never charges twice. */
export function migrateLegacyTavernState(value: unknown, day: number, placedItems: readonly PlacedFurniture[], map: MapData): V7TavernState {
  const old = validateLegacyTavernState(value, day);
  const state: V7TavernState = { ...createV7TavernState(), level: old.level, portions: old.portions,
    welcomeClaimed: old.welcomeClaimed, serviceDay: old.serviceDay, servedToday: old.servedToday,
    totalServed: old.totalServed, foodSold: old.totalServed, revenue: old.revenue };
  if (old.phase !== 'closed') {
    const layout = resolveTavernLayout({ placedItems, map });
    if (!layout.service) throw new Error('GameState save: active tavern layout cannot migrate its service bar');
    const destination = layout.destinations.find(candidate => candidate.kind === 'bar' &&
      candidate.tile.tx === layout.service!.guest.tx && candidate.tile.ty === layout.service!.guest.ty);
    if (!destination) throw new Error('GameState save: active tavern layout lacks the legacy destination');
    const guest: V7TavernGuest = { id: 1, visitorId: TAVERN_VISITORS[old.servedToday % TAVERN_VISITORS.length].id,
      kind: 'tavern', phase: old.phase, elapsedMs: 0, destinationId: destination.id, product: 'food', roomId: null };
    if (old.phase !== 'waiting') {
      const oldDuration = old.phase === 'arriving' ? TAVERN_ARRIVAL_MS : TAVERN_LEAVING_MS;
      guest.elapsedMs = old.phaseElapsedMs / oldDuration * v7Route(guest, layout).durationMs;
    }
    state.nextGuestId = 2; state.guests = [guest]; state.tavernOpen = true;
  }
  validateV7TavernState(state, day);
  return state;
}
