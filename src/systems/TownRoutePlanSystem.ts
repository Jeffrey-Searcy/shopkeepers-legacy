/**
 * Compiles the authored seven-day resident routines into validated Town stops and paths.
 * Both the development route editor and live schedule consume this module so their starter routes stay identical.
 *
 * Movement model (why it looks like people, not sliders):
 * - Paths are weighted 8-direction searches that prefer dirt roads, avoid flowers and bushes, and never cross trunks.
 * - Every resident walks at one steady speed. A stop's `leave` is the exact minute the walk to the next stop starts.
 * - Days are planned from desired times plus anchors (the private-room window, the daily meeting, Wayfarer night,
 *   and any plan made with the keeper). Optional visits that cannot fit before an anchor are postponed or dropped,
 *   so a resident never has to sprint.
 * - Samples cut corners slightly and keep to the right of the path, so walkers pass each other instead of overlapping.
 */
import type { ResidentId } from '../config/ResidentRelationships';
import { TOWN_SOCIAL_SPOTS, RESIDENT_HOME_DEADLINE, type TownSocialSpot } from '../config/TownSchedules';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { townBuilding, townDoor, type TownBuildingId } from '../config/TownBuildings';
import { DAYDREAM_ROUTE_LABEL, townRouteProfile, type TownRouteDestinationId,
  type TownRouteVisitTemplate } from '../config/TownRouteTemplates';
import type { MapData } from '../world/MapDef';

export const TOWN_ROUTE_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const TOWN_ROUTE_ACTIVITY_CATEGORIES = ['home', 'private', 'work', 'meal', 'errand', 'social', 'leisure'] as const;

/** Steady resident walking speed: 2.5 tiles per game minute is about 60 px per real second at 1.5 game minutes/s. */
export const TOWN_WALK_TILES_PER_MINUTE = 2.5;

/** Fewest and most stops one compiled day may hold after optional visits are dropped. */
export const TOWN_ROUTE_MIN_STOPS = 6;
export const TOWN_ROUTE_MAX_STOPS = 10;

/** Latest minute a resident may get home; later plans drop optional visits instead. */
const LATEST_HOME_ARRIVAL = RESIDENT_HOME_DEADLINE - 60;

/**
 * Wayfarer night: on these weekdays (0 = Monday) every resident whose evening leisure is The Wayfarer goes at
 * the same fixed evening hour instead of whenever the day allows, so the bar is truly busy. Wednesday is the
 * night seven residents already chose the bar for leisure.
 */
export const TAVERN_NIGHT_WEEKDAYS: readonly number[] = [2];
/** Wayfarer night hours (minutes since 06:00): the crowd arrives from 7 pm and drifts home after 9 pm. */
export const TAVERN_NIGHT = { opensAt: 780, closesAt: 960 } as const;

/** Return whether an absolute game day is a Wayfarer night. */
export function isTavernNight(day: number): boolean {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town route plan: invalid day ${day}`);
  return TAVERN_NIGHT_WEEKDAYS.includes((day - 1) % 7);
}

/**
 * One plan the keeper made with a resident for a later day. The resident really walks there and stays for
 * the whole window; the route compiler treats it as a fixed anchor like the daily meeting.
 */
export interface TownRoutePlayerPlan {
  /** Stable plan id, also part of the route cache key. */
  id: string;
  destination: TownRouteDestinationId;
  label: string;
  startsAt: number;
  endsAt: number;
}

/** Why one route day could not be built. Only "does not fit" reasons appear here; bad input still throws. */
export type TownRouteDayResult = { ok: true; day: TownRoutePlanDay } | { ok: false; reason: string };

/** One immutable Town tile used by route planning and the atlas. */
export interface TownRoutePoint { tx: number; ty: number }

/** Stable purpose attached to every authored route stop. */
export type TownRouteActivityCategory = typeof TOWN_ROUTE_ACTIVITY_CATEGORIES[number];

/** One live-plan stop, including the destination identity omitted from editor exchange files. */
export interface TownRoutePlanStop {
  id: string;
  category: TownRouteActivityCategory;
  destination: TownRouteDestinationId;
  label: string;
  reason: string;
  arrive: number;
  leave: number;
  tx: number;
  ty: number;
  via: TownRoutePoint[];
}

/** One resident's complete authored plan for one absolute game day. */
export interface TownRoutePlanDay {
  residentId: ResidentId;
  day: number;
  weekday: number;
  note: string;
  stops: TownRoutePlanStop[];
}

/** Minimal dynamic meeting input keeps this compiler independent from the schedule owner. */
export interface TownRoutePlanMeeting {
  residents: readonly [ResidentId, ResidentId];
  spot: TownSocialSpot;
  /** Clock minute both residents must be standing at the spot. */
  startsAt: number;
  /** Clock minute both residents may start walking away. */
  endsAt: number;
}

/** Exact sampled route state at one game-clock minute. */
export interface TownRoutePlanSample {
  x: number;
  y: number;
  facing: 'down' | 'up' | 'left' | 'right';
  moving: boolean;
  label: string;
  stop: TownRoutePlanStop | null;
  target: TownRoutePlanStop;
}

/** Real walking window for one segment. Departure can be later than `previous.leave` after a filtered stop. */
export interface TownRouteSegmentTiming {
  departAt: number;
  travel: number;
  length: number;
}

/** Path tiles plus cumulative lengths so samples can move at one steady speed. */
interface CompiledSegment {
  points: readonly TownRoutePoint[];
  /** cumulative[i] is the walked distance in tiles at points[i]. */
  cumulative: readonly number[];
  length: number;
}

const PATH_CACHE = new WeakMap<MapData, Map<string, readonly TownRoutePoint[]>>();
const SEGMENT_CACHE = new WeakMap<MapData, Map<string, CompiledSegment>>();
const COST_CACHE = new WeakMap<MapData, Float32Array>();
const BLOCKED_OBJECTS_CACHE = new WeakMap<MapData, ReadonlySet<string>>();
const STANDING_CACHE = new WeakMap<MapData, Map<string, readonly TownRoutePoint[]>>();

/** Tiles around a spot, nearest first. The first two are the meeting pair's facing tiles. */
const STANDING_RING: readonly TownRoutePoint[] = (() => {
  const ring: TownRoutePoint[] = [{ tx: -1, ty: 0 }, { tx: 1, ty: 0 }];
  const rest: TownRoutePoint[] = [];
  for (let ty = -2; ty <= 2; ty++) for (let tx = -2; tx <= 2; tx++) {
    if ((tx === 0 && ty === 0) || (ty === 0 && Math.abs(tx) === 1)) continue;
    rest.push({ tx, ty });
  }
  // Nearest first, then below before above so idle visitors face the open plaza instead of hiding behind the pair.
  rest.sort((left, right) => Math.hypot(left.tx, left.ty) - Math.hypot(right.tx, right.ty) || right.ty - left.ty || left.tx - right.tx);
  return [...ring, ...rest];
})();

/**
 * Return the set of tile keys occupied by map objects (Town trees). Objects block the player at runtime even
 * though the authored solid grid leaves trunk tiles open, so routes must avoid them explicitly.
 */
function blockedObjectTiles(map: MapData): ReadonlySet<string> {
  const cached = BLOCKED_OBJECTS_CACHE.get(map);
  if (cached) return cached;
  const result = new Set(map.objects.map(object => `${object.tx},${object.ty}`));
  BLOCKED_OBJECTS_CACHE.set(map, result);
  return result;
}

/** Return whether one Town tile can be used by an authored resident route. */
export function isTownRoutePointPassable(map: MapData, point: TownRoutePoint): boolean {
  return point.tx > 0 && point.ty > 0 && point.tx < map.w - 1 && point.ty < map.h - 1
    && map.solid[point.ty][point.tx] === false && map.ground[point.ty][point.tx] !== 'water'
    && !blockedObjectTiles(map).has(`${point.tx},${point.ty}`)
    && !map.warps.some(warp => point.tx >= warp.tx && point.tx < warp.tx + warp.w
      && point.ty >= warp.ty && point.ty < warp.ty + warp.h);
}

/**
 * Build the per-tile walking cost grid once per map.
 * Dirt roads cost 1, grass 2.2, decor (flowers, bushes) adds 3, and tiles beside a trunk add 1.5,
 * so residents follow roads and walk around gardens the way people do. Blocked tiles are Infinity.
 */
function walkingCosts(map: MapData): Float32Array {
  const cached = COST_CACHE.get(map);
  if (cached) return cached;
  const costs = new Float32Array(map.w * map.h);
  const decor = new Set(map.decor.map(item => `${item.tx},${item.ty}`)), trunks = blockedObjectTiles(map);
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!isTownRoutePointPassable(map, { tx, ty })) { costs[ty * map.w + tx] = Number.POSITIVE_INFINITY; continue; }
    let cost = map.ground[ty][tx] === 'dirt' ? 1 : 2.2;
    if (decor.has(`${tx},${ty}`)) cost += 3;
    // Brushing past a trunk looks like clipping through the tree sprite.
    if (trunks.has(`${tx - 1},${ty}`) || trunks.has(`${tx + 1},${ty}`) || trunks.has(`${tx},${ty - 1}`)
      || trunks.has(`${tx},${ty + 1}`)) cost += 1.5;
    costs[ty * map.w + tx] = cost;
  }
  COST_CACHE.set(map, costs);
  return costs;
}

/**
 * Resolve one resident's exterior home arrival: the tile two rows below their building's painted door (townDoor).
 * @param id the resident
 * @param map the Town map (its collision decides whether the arrival is open)
 * @returns a copy of the arrival tile
 * @throws when the resident is unknown or the arrival is blocked
 */
export function townRouteHomePoint(id: ResidentId, map: MapData): TownRoutePoint {
  const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
  if (!resident) throw new Error(`Town route plan: missing resident home for ${id}`);
  const point = townDoor(townBuilding(resident.buildingId)).arrival;
  if (!isTownRoutePointPassable(map, point)) throw new Error(`Town route plan: blocked home arrival for ${id}`);
  return { ...point };
}

/**
 * Return the passable standing tiles around one outdoor place, nearest first.
 * Index 0 and 1 are the meeting pair's facing tiles; later indexes belong to individual visitors.
 * @throws when the pair tiles are blocked or too few tiles remain for every resident to stand apart.
 */
export function townSpotStandingTiles(map: MapData, center: TownRoutePoint, label: string): readonly TownRoutePoint[] {
  let cache = STANDING_CACHE.get(map);
  if (!cache) { cache = new Map(); STANDING_CACHE.set(map, cache); }
  const key = `${center.tx},${center.ty}`, cached = cache.get(key);
  if (cached) return cached;
  const tiles = STANDING_RING.map(offset => ({ tx: center.tx + offset.tx, ty: center.ty + offset.ty }));
  if (!isTownRoutePointPassable(map, tiles[0]) || !isTownRoutePointPassable(map, tiles[1])) {
    throw new Error(`Town route plan: ${label} needs open tiles on both sides for a conversation`);
  }
  const open = tiles.filter(point => isTownRoutePointPassable(map, point));
  if (open.length < 2 + TOWN_RESIDENTS.length) {
    throw new Error(`Town route plan: ${label} has only ${open.length} open standing tiles`);
  }
  cache.set(key, open);
  return open;
}

/** Return the authored center tile of one outdoor destination, or null for buildings. */
function outdoorCenter(destination: TownRouteDestinationId): { center: TownRoutePoint; label: string } | null {
  // why: the painted fishing dock below the bar has room for about ten people once its posts and the open water
  // are walls (save version 28), too few for every resident's own tile. The south half of the south bridge
  // stands over the same river with room for all of them, and its ring (rows 61-65) does not share tiles with
  // the South Bridge meeting spot (29,58, rows 56-60), so the two groups never stand on each other. The redrawn
  // deck (save version 29) is x 28-30 with its east rail on tile 31, so the centre is the deck's middle column.
  if (destination === 'fishing-bank') return { center: { tx: 29, ty: 63 }, label: 'Fishing rail on the south bridge' };
  const spot = TOWN_SOCIAL_SPOTS.find(candidate => candidate.id === destination);
  return spot ? { center: { tx: spot.tx, ty: spot.ty }, label: spot.label } : null;
}

/**
 * Resolve one authored destination to the tile where this resident stands.
 * Outdoor places give each resident their own tile so visitors never stack on one sprite.
 */
export function townRouteDestinationPoint(destination: TownRouteDestinationId, home: TownRoutePoint,
  map: MapData, residentIndex: number): TownRoutePoint {
  if (destination === 'home') return { ...home };
  const outdoor = outdoorCenter(destination);
  if (outdoor) {
    if (!Number.isSafeInteger(residentIndex) || residentIndex < 0 || residentIndex >= TOWN_RESIDENTS.length) {
      throw new Error(`Town route plan: invalid resident index ${residentIndex} for ${outdoor.label}`);
    }
    return { ...townSpotStandingTiles(map, outdoor.center, outdoor.label)[2 + residentIndex] };
  }
  const building = townBuilding(destination as TownBuildingId);
  const point = townDoor(building).arrival;
  if (!isTownRoutePointPassable(map, point)) throw new Error(`Town route plan: blocked ${building.name} arrival`);
  return { ...point };
}

/** Return the building represented by one destination, or null for outdoor landmarks. */
export function townRouteDestinationBuilding(destination: TownRouteDestinationId,
  homeBuilding: TownBuildingId): TownBuildingId | null {
  if (destination === 'home') return homeBuilding;
  if (destination === 'fishing-bank' || TOWN_SOCIAL_SPOTS.some(spot => spot.id === destination)) return null;
  townBuilding(destination as TownBuildingId);
  return destination as TownBuildingId;
}

/** Minimal binary heap keyed by f-cost, then insertion order, so equal-cost searches stay deterministic. */
class RouteHeap {
  private readonly items: Array<{ node: number; f: number; order: number }> = [];
  private counter = 0;

  /** Number of queued entries, including stale ones the caller skips. */
  get size(): number { return this.items.length; }

  /** Queue one node at one estimated total cost. */
  push(node: number, f: number): void {
    const items = this.items;
    items.push({ node, f, order: this.counter++ });
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(items[index], items[parent])) break;
      [items[index], items[parent]] = [items[parent], items[index]]; index = parent;
    }
  }

  /** Remove and return the cheapest entry. */
  pop(): { node: number; f: number } {
    const items = this.items, top = items[0], last = items.pop();
    if (!top || !last) throw new Error('Town route plan: path queue underflow');
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let best = index;
        if (left < items.length && this.less(items[left], items[best])) best = left;
        if (right < items.length && this.less(items[right], items[best])) best = right;
        if (best === index) break;
        [items[index], items[best]] = [items[best], items[index]]; index = best;
      }
    }
    return top;
  }

  /** Order by cost, then by queue order. */
  private less(left: { f: number; order: number }, right: { f: number; order: number }): boolean {
    return left.f < right.f || (left.f === right.f && left.order < right.order);
  }
}

/** Eight neighbor steps; diagonals are only used when both side tiles are open, so walkers never clip corners. */
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;

/** Build one deterministic cheapest 8-direction path between passable Town points. */
function pathBetween(map: MapData, start: TownRoutePoint, target: TownRoutePoint): TownRoutePoint[] {
  if (!isTownRoutePointPassable(map, start) || !isTownRoutePointPassable(map, target)) {
    throw new Error(`Town route plan: a path starts or ends on a blocked tile (${start.tx},${start.ty} > ${target.tx},${target.ty})`);
  }
  let cache = PATH_CACHE.get(map);
  if (!cache) { cache = new Map(); PATH_CACHE.set(map, cache); }
  const cacheKey = `${start.tx},${start.ty}>${target.tx},${target.ty}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached as TownRoutePoint[];
  const costs = walkingCosts(map), width = map.w;
  const startNode = start.ty * width + start.tx, targetNode = target.ty * width + target.tx;
  const best = new Float64Array(map.w * map.h).fill(Number.POSITIVE_INFINITY), previous = new Int32Array(map.w * map.h).fill(-1);
  const closed = new Uint8Array(map.w * map.h), heap = new RouteHeap();
  /** Octile distance at the cheapest tile cost keeps the estimate admissible. */
  const estimate = (node: number): number => {
    const dx = Math.abs(node % width - target.tx), dy = Math.abs(Math.floor(node / width) - target.ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  best[startNode] = 0; heap.push(startNode, estimate(startNode));
  while (heap.size) {
    const { node } = heap.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    if (node === targetNode) break;
    const tx = node % width, ty = Math.floor(node / width);
    for (const [dx, dy] of STEPS) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const next = ny * width + nx, tileCost = costs[next];
      if (!Number.isFinite(tileCost) || closed[next]) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!Number.isFinite(costs[ty * width + nx]) || !Number.isFinite(costs[ny * width + tx]))) continue;
      const total = best[node] + tileCost * (diagonal ? Math.SQRT2 : 1);
      if (total >= best[next]) continue;
      best[next] = total; previous[next] = node; heap.push(next, total + estimate(next));
    }
  }
  if (!closed[targetNode]) throw new Error(`Town route plan: no path from ${start.tx},${start.ty} to ${target.tx},${target.ty}`);
  const result: TownRoutePoint[] = [];
  for (let node = targetNode; node !== -1; node = previous[node]) result.push({ tx: node % width, ty: Math.floor(node / width) });
  result.reverse(); cache.set(cacheKey, result);
  return result;
}

/** Compile one segment through its via points with cumulative walked distance. */
function compiledSegment(map: MapData, start: TownRoutePoint, stop: Pick<TownRoutePlanStop, 'tx' | 'ty' | 'via'>): CompiledSegment {
  let cache = SEGMENT_CACHE.get(map);
  if (!cache) { cache = new Map(); SEGMENT_CACHE.set(map, cache); }
  const targets = [...stop.via, { tx: stop.tx, ty: stop.ty }];
  const cacheKey = [start, ...targets].map(point => `${point.tx},${point.ty}`).join('>');
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const points: TownRoutePoint[] = [{ tx: start.tx, ty: start.ty }];
  for (const target of targets) points.push(...pathBetween(map, points[points.length - 1], target).slice(1));
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    cumulative.push(cumulative[index - 1] + Math.hypot(points[index].tx - points[index - 1].tx, points[index].ty - points[index - 1].ty));
  }
  const result = { points, cumulative, length: cumulative[cumulative.length - 1] };
  cache.set(cacheKey, result);
  return result;
}

/** Compile one immutable stop segment once, then reuse it for live actors and the route atlas. */
export function compileTownRouteSegment(map: MapData, start: TownRoutePoint,
  stop: Pick<TownRoutePlanStop, 'tx' | 'ty' | 'via'>): TownRoutePoint[] {
  return compiledSegment(map, start, stop).points as TownRoutePoint[];
}

/** Whole game minutes needed to walk one path length at the steady resident speed. */
export function townRouteTravelMinutes(length: number): number {
  if (!Number.isFinite(length) || length < 0) throw new Error(`Town route plan: invalid path length ${length}`);
  return length === 0 ? 0 : Math.max(1, Math.ceil(length / TOWN_WALK_TILES_PER_MINUTE));
}

/**
 * Whole game minutes a resident needs to walk straight between two Town tiles: the same value the day planner
 * charges for that leg, so schedule owners can leave room for it before fixing a time.
 * @param map the Town map whose collision shapes the path
 * @param from the starting tile
 * @param to the destination tile
 * @returns walk minutes (0 when both tiles are the same)
 * @throws when either tile is blocked or no path joins them
 */
export function townRouteWalkMinutes(map: MapData, from: TownRoutePoint, to: TownRoutePoint): number {
  return townRouteTravelMinutes(compiledSegment(map, from, { tx: to.tx, ty: to.ty, via: [] }).length);
}

/**
 * Return when a resident really starts walking from `previous` to `stop`.
 * Normally that is `previous.leave`. When access filtering removed a stop in between, the resident lingers at
 * `previous` and leaves just in time. If a filtered plan leaves less time than the walk needs, the resident
 * starts at `previous.leave` and walks faster to keep the plan (documented rule, not a hidden fallback).
 */
export function townRouteSegmentTiming(map: MapData, previous: TownRoutePlanStop, stop: TownRoutePlanStop): TownRouteSegmentTiming {
  const segment = compiledSegment(map, previous, stop), travel = townRouteTravelMinutes(segment.length);
  return { departAt: Math.max(previous.leave, stop.arrive - travel), travel, length: segment.length };
}

/** Return the exact authored private-room window for one resident and absolute day. */
export function authoredPrivateRouteWindow(id: ResidentId, day: number): { startsAt: number; endsAt: number } {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town route plan: invalid day ${day}`);
  const residentIndex = TOWN_RESIDENTS.findIndex(candidate => candidate.id === id);
  if (residentIndex < 0) throw new Error(`Town route plan: unknown resident ${id}`);
  const weekday = (day - 1) % 7, shift = ((residentIndex + weekday) % 3 - 1) * 15;
  const daydream = townRouteProfile(id).privateActivities[weekday] === DAYDREAM_ROUTE_LABEL;
  if (weekday < 5) return daydream ? { startsAt: 810 + shift, endsAt: 855 + shift }
    : { startsAt: 45 + shift, endsAt: 90 + shift };
  return daydream ? { startsAt: 720 + shift, endsAt: 765 + shift }
    : { startsAt: 75 + shift, endsAt: 120 + shift };
}

/** Small stable per-resident, per-day, per-item offset (0..span-1) so routines do not move in lockstep. */
function routeJitter(residentIndex: number, weekday: number, key: string, span: number): number {
  let hash = 2166136261 ^ (residentIndex * 7919 + weekday * 104729);
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) % span;
}

/**
 * One planned visit before times are fixed.
 * desired: earliest preferred arrival. minDwell: shortest stay. anchor: exact fixed window (private room, meeting).
 */
interface PlanItem {
  stop: TownRoutePlanStop;
  desired: number;
  minDwell: number;
  optional: boolean;
  anchor: { arrive: number; leave: number } | null;
}

/** Result of one scheduling attempt: fixed stops, or the item index that made the plan impossible. */
type ScheduleAttempt = { stops: TownRoutePlanStop[] } | { failedAt: number };

/**
 * Try to place every item in order at steady walking speed.
 * Items after an anchor start as soon as the walk allows; other items wait for their desired time.
 * Every non-anchor stop then lingers until it must leave for the next stop.
 */
function trySchedule(items: readonly PlanItem[], map: MapData): ScheduleAttempt {
  const arrive: number[] = [0], travel: number[] = [0];
  let free = items[0].minDwell;
  for (let index = 1; index < items.length; index++) {
    const item = items[index], previous = items[index - 1];
    travel[index] = townRouteTravelMinutes(compiledSegment(map, previous.stop, item.stop).length);
    const earliest = free + travel[index];
    if (item.anchor) {
      if (earliest > item.anchor.arrive) return { failedAt: index };
      arrive[index] = item.anchor.arrive; free = item.anchor.leave;
    } else {
      arrive[index] = previous.anchor ? earliest : Math.max(item.desired, earliest);
      free = arrive[index] + item.minDwell;
    }
  }
  if (arrive[items.length - 1] > LATEST_HOME_ARRIVAL) return { failedAt: items.length - 1 };
  const stops = items.map((item, index) => ({ ...item.stop, arrive: arrive[index],
    leave: index === items.length - 1 ? RESIDENT_HOME_DEADLINE : arrive[index + 1] - travel[index + 1] }));
  for (let index = 0; index < items.length; index++) {
    const anchor = items[index].anchor;
    // An anchor must end on time; a later departure would overrun the private window or the shared meeting.
    if (anchor && index < items.length - 1 && stops[index].leave !== anchor.leave && !items[index + 1].anchor) {
      throw new Error(`Town route plan: anchor ${stops[index].id} did not end on time`);
    }
  }
  return { stops };
}

/**
 * Place items until the day fits at walking speed.
 * When a fixed window (anchor) cannot be reached, first postpone the latest visit before it that has not moved
 * yet until just after that window, the way a person shifts an errand around an appointment. Each visit moves at
 * most once. Only when nothing can move (or the late stop is the night return) drop the latest optional visit.
 * why: dropping first left a third of the authored days without a meal or errand, so the route editor's detailed
 * days (every category, 8-10 stops) no longer matched the authored routines.
 * @returns the fixed stops, or the reason the day cannot fit (the caller decides whether that is an error).
 */
function scheduleDay(items: PlanItem[], map: MapData, label: string): { stops: TownRoutePlanStop[] } | { reason: string } {
  const working = [...items];
  const postponed = new Set<PlanItem>();
  for (let attempt = 0; attempt < items.length * 3; attempt++) {
    const result = trySchedule(working, map);
    if ('stops' in result) return { stops: result.stops };
    const failed = result.failedAt, blocker = working[failed];
    if (blocker.anchor) {
      let moveIndex = -1;
      for (let index = failed - 1; index > 0; index--) {
        if (!working[index].anchor && !postponed.has(working[index])) { moveIndex = index; break; }
      }
      if (moveIndex >= 0) {
        const [moved] = working.splice(moveIndex, 1);
        const later = { ...moved, desired: blocker.anchor.leave };
        postponed.add(later);
        // After the splice the blocker sits at failed - 1, so index `failed` is directly after it.
        working.splice(failed, 0, later);
        continue;
      }
    }
    let dropIndex = -1;
    for (let index = failed - 1; index > 0; index--) if (working[index].optional) { dropIndex = index; break; }
    if (dropIndex < 0) return { reason: `${label} cannot reach ${blocker.stop.id} on time` };
    working.splice(dropIndex, 1);
  }
  return { reason: `${label} could not settle its day` };
}

/** Create one stop from an authored visit without losing its destination identity. */
function visitStop(id: string, category: TownRouteActivityCategory, visit: TownRouteVisitTemplate,
  map: MapData, home: TownRoutePoint, residentIndex: number): TownRoutePlanStop {
  return { id, category, destination: visit.destination, label: visit.label, reason: visit.reason, arrive: 0, leave: 0,
    ...townRouteDestinationPoint(visit.destination, home, map, residentIndex), via: [] };
}

/**
 * Expand one personality profile into one complete, validated live route day.
 * @param playerPlan a plan the keeper made with this resident for this day, or null for the authored routine
 * @throws when the day cannot fit; use tryAuthoredTownRouteDay to test a new plan first
 */
export function authoredTownRouteDay(residentId: ResidentId, day: number, map: MapData,
  meeting: TownRoutePlanMeeting, playerPlan: TownRoutePlayerPlan | null): TownRoutePlanDay {
  const result = tryAuthoredTownRouteDay(residentId, day, map, meeting, playerPlan);
  if (!result.ok) throw new Error(`Town route plan: ${result.reason}`);
  return result.day;
}

/** True when two clock windows share at least one minute. */
function windowsOverlap(left: { startsAt: number; endsAt: number }, right: { startsAt: number; endsAt: number }): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

/**
 * Build one route day, or explain why it does not fit. The keeper's plan picker uses this to offer only plans
 * the resident can really keep. Invalid input (unknown resident, bad day, broken meeting) still throws.
 * @param playerPlan a plan made with the keeper for this day, or null
 */
export function tryAuthoredTownRouteDay(residentId: ResidentId, day: number, map: MapData,
  meeting: TownRoutePlanMeeting, playerPlan: TownRoutePlayerPlan | null): TownRouteDayResult {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town route plan: invalid day ${day}`);
  const residentIndex = TOWN_RESIDENTS.findIndex(candidate => candidate.id === residentId);
  if (residentIndex < 0 || !meeting.residents.includes(residentId)) {
    throw new Error(`Town route plan: invalid meeting for ${residentId}`);
  }
  if (!Number.isSafeInteger(meeting.startsAt) || !Number.isSafeInteger(meeting.endsAt) || meeting.startsAt >= meeting.endsAt) {
    throw new Error(`Town route plan: invalid meeting window for ${residentId}`);
  }
  const resident = TOWN_RESIDENTS[residentIndex], building = townBuilding(resident.buildingId);
  const weekday = (day - 1) % 7, weekend = weekday >= 5, profile = townRouteProfile(residentId);
  const home = townRouteHomePoint(residentId, map), label = `${residentId} ${TOWN_ROUTE_WEEKDAYS[weekday]}`;
  const socialPoint = townSpotStandingTiles(map, meeting.spot, meeting.spot.label)[meeting.residents[0] === residentId ? 0 : 1];
  const privateWindow = authoredPrivateRouteWindow(residentId, day);
  if (windowsOverlap(meeting, privateWindow)) {
    throw new Error(`Town route plan: ${label} meeting overlaps the private window`);
  }
  if (playerPlan && (!Number.isSafeInteger(playerPlan.startsAt) || !Number.isSafeInteger(playerPlan.endsAt)
    || playerPlan.startsAt < 0 || playerPlan.startsAt >= playerPlan.endsAt || playerPlan.endsAt > LATEST_HOME_ARRIVAL)) {
    throw new Error(`Town route plan: ${label} has an invalid keeper plan window`);
  }
  if (playerPlan && windowsOverlap(playerPlan, privateWindow)) return { ok: false, reason: `${label} plan overlaps private time` };
  if (playerPlan && windowsOverlap(playerPlan, meeting)) return { ok: false, reason: `${label} plan overlaps the daily meeting` };
  const shift = ((residentIndex + weekday) % 3 - 1) * 15;
  /** Desired time = shared base + personal shift + a small per-item offset. */
  const at = (base: number, key: string): number => base + shift + routeJitter(residentIndex, weekday, key, 20);
  const privateLabel = profile.privateActivities[weekday], daydream = privateLabel === DAYDREAM_ROUTE_LABEL;
  const roomVisit: TownRouteVisitTemplate = { destination: 'home', label: privateLabel,
    reason: daydream ? `${resident.name} has a private adult moment alone in their room.`
      : `${resident.name} spends private time alone in their room.` };
  const meal = profile.meals[(residentIndex + weekday) % profile.meals.length];
  /**
   * The evening leisure visit. On a Wayfarer night a bar-goer's visit becomes a fixed anchor at the shared
   * evening hour. Julian is excluded: The Wayfarer is his own home and workplace.
   */
  function tavernOrLeisure(): PlanItem {
    const leisure = visitStop('leisure', 'leisure', profile.leisure[weekday], map, home, residentIndex);
    if (!isTavernNight(day) || leisure.destination !== 'bar' || resident.buildingId === 'bar') {
      return { stop: leisure, desired: at(weekend ? 585 : 720, 'leisure'), minDwell: 45, optional: true, anchor: null };
    }
    // why: the meeting can end as late as ~760 across town, so arrival waits for that walk instead of failing.
    const walkFromMeeting = townRouteTravelMinutes(compiledSegment(map, socialPoint, leisure).length);
    const arrive = Math.max(TAVERN_NIGHT.opensAt + routeJitter(residentIndex, weekday, 'tavern', 30), meeting.endsAt + walkFromMeeting);
    const leave = TAVERN_NIGHT.opensAt + 120 + routeJitter(residentIndex, weekday, 'tavern-leave', 30);
    const window = { startsAt: arrive, endsAt: leave };
    if (leave - arrive < 60 || windowsOverlap(window, privateWindow) || leave > TAVERN_NIGHT.closesAt) {
      throw new Error(`Town route plan: ${label} Wayfarer night window ${arrive}-${leave} is invalid`);
    }
    return { stop: { ...leisure, reason: `Joins the ${TOWN_ROUTE_WEEKDAYS[weekday]} crowd at The Wayfarer.` },
      desired: arrive, minDwell: 0, optional: false, anchor: { arrive, leave } };
  }
  const partner = meeting.residents.find(id => id !== residentId);
  const partnerName = TOWN_RESIDENTS.find(candidate => candidate.id === partner)?.name;
  if (!partnerName) throw new Error(`Town route plan: missing meeting partner for ${residentId}`);
  const items: PlanItem[] = [
    { stop: { id: 'home-morning', category: 'home', destination: 'home', label: building.name,
      reason: weekend ? 'Takes a slower weekend morning at home.' : 'Wakes, gets ready, and starts the day at home.',
      arrive: 0, leave: 0, ...home, via: [] }, desired: 0, minDwell: 30, optional: false, anchor: null },
    { stop: { ...visitStop('private-room', 'private', roomVisit, map, home, residentIndex) },
      desired: privateWindow.startsAt, minDwell: 0, optional: false,
      anchor: { arrive: privateWindow.startsAt, leave: privateWindow.endsAt } },
    { stop: { id: 'social', category: 'social', destination: meeting.spot.id, label: meeting.spot.label,
      reason: `Spends unhurried time with ${partnerName}.`, arrive: 0, leave: 0, ...socialPoint, via: [] },
      desired: meeting.startsAt, minDwell: 0, optional: false, anchor: { arrive: meeting.startsAt, leave: meeting.endsAt } },
    { stop: visitStop('meal', 'meal', meal, map, home, residentIndex), desired: at(weekend ? 270 : 300, 'meal'),
      minDwell: 35, optional: true, anchor: null },
    { stop: visitStop('errand', 'errand', profile.errands[weekday], map, home, residentIndex),
      desired: at(weekend ? 360 : 540, 'errand'), minDwell: 30, optional: true, anchor: null },
    tavernOrLeisure(),
    { stop: { id: 'home-night', category: 'home', destination: 'home', label: building.name,
      reason: weekend ? 'Returns home for a quiet weekend evening.' : 'Returns home, settles in, and stays for the night.',
      arrive: 0, leave: 0, ...home, via: [] }, desired: at(weekend ? 750 : 840, 'home'), minDwell: 0, optional: false, anchor: null },
  ];
  if (playerPlan) {
    const tavern = items.find(item => item.stop.id === 'leisure' && item.anchor);
    if (tavern?.anchor && windowsOverlap(playerPlan, { startsAt: tavern.anchor.arrive, endsAt: tavern.anchor.leave })) {
      return { ok: false, reason: `${label} plan overlaps Wayfarer night` };
    }
    const planVisit: TownRouteVisitTemplate = { destination: playerPlan.destination, label: playerPlan.label,
      reason: `${resident.name} keeps a plan made with the shopkeeper.` };
    items.push({ stop: { ...visitStop('plan', 'social', planVisit, map, home, residentIndex) }, desired: playerPlan.startsAt,
      minDwell: 0, optional: false, anchor: { arrive: playerPlan.startsAt, leave: playerPlan.endsAt } });
  }
  if (weekend) {
    items.push({ stop: { id: 'weekend-work', category: 'work', destination: building.id, label: `Weekend chores at ${building.name}`,
      reason: 'Handles essential upkeep without keeping a full workday.', arrive: 0, leave: 0, ...home, via: [] },
    desired: at(150, 'work'), minDwell: 60, optional: false, anchor: null });
  } else {
    items.push(
      { stop: { id: 'work-morning', category: 'work', destination: building.id, label: `Morning at ${building.name}`,
        reason: `Handles the focused morning work at ${building.name}.`, arrive: 0, leave: 0, ...home, via: [] },
      desired: at(120, 'work-morning'), minDwell: 90, optional: false, anchor: null },
      { stop: { id: 'work-afternoon', category: 'work', destination: building.id, label: `Afternoon at ${building.name}`,
        reason: 'Returns for customers, upkeep, and unfinished work.', arrive: 0, leave: 0, ...home, via: [] },
      desired: at(375, 'work-afternoon'), minDwell: 60, optional: true, anchor: null },
    );
  }
  // Home stays first and last; everything else follows its desired time. Anchors win ties so a visit at the same
  // minute follows the fixed window instead of blocking it.
  const first = items[0], last = items.find(item => item.stop.id === 'home-night');
  if (!last) throw new Error(`Town route plan: ${label} lost its night stop`);
  const middle = items.filter(item => item !== first && item !== last)
    .sort((left, right) => left.desired - right.desired || Number(Boolean(right.anchor)) - Number(Boolean(left.anchor)));
  const scheduled = scheduleDay([first, ...middle, last], map, label);
  if ('reason' in scheduled) return { ok: false, reason: scheduled.reason };
  const stops = scheduled.stops;
  if (stops.length < TOWN_ROUTE_MIN_STOPS || stops.length > TOWN_ROUTE_MAX_STOPS || stops[0].arrive !== 0
    || stops[stops.length - 1].leave !== RESIDENT_HOME_DEADLINE) {
    throw new Error(`Town route plan: ${label} has an invalid stop count or home boundary`);
  }
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (stop.arrive > stop.leave || !isTownRoutePointPassable(map, stop)) throw new Error(`Town route plan: invalid ${label} stop ${stop.id}`);
    if (index === 0) continue;
    const previous = stops[index - 1], timing = townRouteSegmentTiming(map, previous, stop);
    if (stop.arrive < previous.leave) throw new Error(`Town route plan: ${stop.id} overlaps ${previous.id}`);
    if (stop.arrive - previous.leave !== timing.travel) throw new Error(`Town route plan: ${label} ${stop.id} has the wrong travel time`);
  }
  return { ok: true, day: { residentId, day, weekday,
    note: `${resident.name}'s detailed ${TOWN_ROUTE_WEEKDAYS[weekday]} ${weekend ? 'weekend routine' : 'workday'}.`, stops } };
}

/** Return the point at one walked distance along a compiled segment, clamped to its ends. */
function pointAtDistance(segment: CompiledSegment, distance: number): { x: number; y: number } {
  const points = segment.points, cumulative = segment.cumulative;
  if (distance <= 0) return { x: points[0].tx, y: points[0].ty };
  if (distance >= segment.length) return { x: points[points.length - 1].tx, y: points[points.length - 1].ty };
  let low = 0, high = cumulative.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] <= distance) low = middle; else high = middle;
  }
  const span = cumulative[high] - cumulative[low], local = span === 0 ? 0 : (distance - cumulative[low]) / span;
  return { x: points[low].tx + (points[high].tx - points[low].tx) * local, y: points[low].ty + (points[high].ty - points[low].ty) * local };
}

/** Distance (tiles) over which corners are rounded off. */
const CORNER_SMOOTHING = 0.35;
/** Sideways offset (tiles) to the walker's right, so people walking opposite ways pass each other. */
const LANE_OFFSET = 0.3;

/**
 * Sample a walker on one segment at one walked distance.
 * Position averages two nearby path points (rounded corners) and shifts to the walker's right, fading the shift in
 * and out near both ends so arrivals land exactly on the standing tile.
 */
function walkerAt(segment: CompiledSegment, distance: number): { x: number; y: number; facing: TownRoutePlanSample['facing'] } {
  const behind = pointAtDistance(segment, distance - CORNER_SMOOTHING), ahead = pointAtDistance(segment, distance + CORNER_SMOOTHING);
  const back = pointAtDistance(segment, distance - 0.5), front = pointAtDistance(segment, distance + 0.5);
  let dx = front.x - back.x, dy = front.y - back.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 0) { dx /= magnitude; dy /= magnitude; }
  const lane = LANE_OFFSET * Math.max(0, Math.min(1, distance / 0.8, (segment.length - distance) / 0.8));
  // Screen y points down, so the walker's right-hand side is (-dy, dx).
  const x = (behind.x + ahead.x) / 2 - dy * lane, y = (behind.y + ahead.y) / 2 + dx * lane;
  // Slight horizontal bias keeps 45-degree walks from flickering between two facings.
  const facing = Math.abs(dx) >= Math.abs(dy) * 0.9 ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
  return { x, y, facing };
}

/** Sample one validated day at one clock minute, including travel between stops. */
export function sampleTownRouteDay(day: TownRoutePlanDay, map: MapData, minute: number): TownRoutePlanSample {
  if (!Number.isFinite(minute) || minute < 0 || minute > 24 * 60) throw new Error(`Town route plan: invalid time ${minute}`);
  // Keep fractional game-minutes. Rounding here held actors still for a full minute, then teleported them forward.
  const time = minute, stops = day.stops;
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (time >= stop.arrive && time <= stop.leave) {
      return { x: stop.tx, y: stop.ty, facing: 'down', moving: false, label: stop.label, stop, target: stop };
    }
    if (index === 0) continue;
    const previous = stops[index - 1];
    if (time <= previous.leave || time >= stop.arrive) continue;
    const timing = townRouteSegmentTiming(map, previous, stop);
    if (time < timing.departAt || timing.length === 0) {
      // Lingering: a filtered stop left spare time, so the resident stays put until the walk must start.
      return { x: previous.tx, y: previous.ty, facing: 'down', moving: false, label: previous.label, stop: previous, target: stop };
    }
    const segment = compiledSegment(map, previous, stop);
    const fraction = (time - timing.departAt) / (stop.arrive - timing.departAt);
    const walker = walkerAt(segment, fraction * segment.length);
    return { ...walker, moving: true, label: `Walking to ${stop.label}`, stop: null, target: stop };
  }
  const last = stops[stops.length - 1];
  return { x: last.tx, y: last.ty, facing: 'down', moving: false, label: last.label, stop: last, target: last };
}

/** Flatten every compiled arrival segment into the exact full-day atlas path. */
export function townRouteDayPath(day: TownRoutePlanDay, map: MapData): TownRoutePoint[] {
  const result: TownRoutePoint[] = [{ tx: day.stops[0].tx, ty: day.stops[0].ty }];
  for (let index = 1; index < day.stops.length; index++) {
    result.push(...compileTownRouteSegment(map, day.stops[index - 1], day.stops[index]).slice(1));
  }
  return result;
}
