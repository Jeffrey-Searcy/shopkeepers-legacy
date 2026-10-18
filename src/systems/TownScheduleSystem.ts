/**
 * Deterministic resident schedules and Town walking paths.
 * Positions derive from the game clock, so time jumps and scene re-entry cannot create duplicate actors.
 */
import { SceneKey } from '../config/AssetKeys';
import { DAYDREAM_ROUTE_LABEL } from '../config/TownRouteTemplates';
import { TILE } from '../config/GameConfig';
import { RESIDENT_BONDS, residentBondId, type ResidentId } from '../config/ResidentRelationships';
import { TOWN_SOCIAL_SPOTS, validateTownSchedules, type TownSocialSpot } from '../config/TownSchedules';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { townBuilding } from '../config/TownBuildings';
import { getMapData, type MapData } from '../world/MapDef';
import { GameState } from '../state/GameState';
import { residentBondChemistry, residentSocialRoll, type RelationshipsState } from './RelationshipSystem';
import { townBuildingAccess } from './TownBuildingAccessSystem';
import { keeperRoutePlanFor } from './KeeperSocialState';
import { validateWayfarerSeats } from '../config/WayfarerSeats';
import { authoredPrivateRouteWindow, authoredTownRouteDay, isTownRoutePointPassable, sampleTownRouteDay,
  townRouteDayPath, townRouteDestinationBuilding, townRouteHomePoint, townRouteSegmentTiming, townRouteWalkMinutes,
  townSpotStandingTiles, TOWN_ROUTE_MAX_STOPS, TOWN_ROUTE_MIN_STOPS,
  type TownRoutePlanDay, type TownRoutePlanStop, type TownRoutePoint } from './TownRoutePlanSystem';

export type { TownRoutePoint } from './TownRoutePlanSystem';

/** A schedule phase determines scene ownership and the label shown in the journal. */
export type ResidentScheduleActivity = 'home' | 'work' | 'traveling' | 'socializing';

/** Exact visible state for one scheduled Town actor. */
export interface ScheduledTownPresence {
  scene: SceneKey;
  activity: ResidentScheduleActivity;
  locationLabel: string;
  x: number;
  y: number;
  facing: 'down' | 'up' | 'left' | 'right';
  moving: boolean;
}

/** One active two-person conversation window. */
export interface ActiveTownMeeting {
  pair: DailyTownMeeting;
  minute: number;
  endsAt: number;
}

/** One of six save-specific pairings for a game day, with the exact minutes both residents stand together. */
export interface DailyTownMeeting {
  bondId: string;
  residents: readonly [ResidentId, ResidentId];
  spot: TownSocialSpot;
  meetingIndex: number;
  /** Clock minute (minutes since 06:00) both residents are standing at the spot. */
  startsAt: number;
  /** Clock minute both residents may walk away. */
  endsAt: number;
}

/** How long one daily meeting lasts, in game minutes. */
export const TOWN_MEETING_MINUTES = 45;

/**
 * Base meeting minutes. Four slots spread six meetings over the day, so the town never gathers all at once.
 * Weekdays meet at lunch and after work; weekends meet mid-morning through the afternoon.
 */
const WEEKDAY_MEETING_SLOTS = [300, 540, 630, 690] as const;
const WEEKEND_MEETING_SLOTS = [180, 330, 450, 570] as const;

/** One action location used by the shared interior and outdoor witness rule. */
export interface ResidentActionLocation {
  area: 'interior' | 'outdoor';
  scene: SceneKey;
  tx: number;
  ty: number;
}

/** One resident who could see an action. Invisible or off-scene residents never count. */
export interface ResidentWitnessPosition extends ResidentActionLocation {
  residentId: ResidentId;
  visible: boolean;
}

/** Detached route-ledger data for one resident, one day, and one clock minute. */
export interface ResidentRouteSnapshot {
  residentId: ResidentId;
  day: number;
  activity: ResidentScheduleActivity;
  locationLabel: string;
  inside: boolean;
  position: TownRoutePoint;
  path: readonly TownRoutePoint[];
  partnerId: ResidentId;
  meetingSpotId: TownSocialSpot['id'];
}

/** Cache immutable authored days per Town map, save social seed, day, and resident. */
const ROUTE_DAY_CACHE = new WeakMap<MapData, Map<string, TownRoutePlanDay>>();
const MEETINGS_CACHE = new WeakMap<RelationshipsState, Map<number, readonly DailyTownMeeting[]>>();
const MEETING_WINDOW_CACHE = new Map<string, { minute: number; endsAt: number }>();

/** Resolve a fixed resident definition without substituting a random customer. */
function residentDefinition(id: ResidentId) {
  const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
  if (!resident) throw new Error(`Town schedules: unknown resident ${id}`);
  return resident;
}

/**
 * Move a meeting's base start just enough that both residents can walk between their room and the spot around
 * their private-room window.
 * why: on the painted Town a walk from a far shop to a far meadow takes up to ~65 minutes. The private window can
 * end at 135 on a weekend (first slot 180) and start at 795 on a weekday (last meeting ends near 760), so a fixed
 * slot alone could leave a resident unable to arrive or get home on time, and the day planner would throw.
 * The private window is always spent at home, so the only walk that matters is home <-> the resident's standing tile.
 * @param residents the meeting pair; index 0 stands on the spot's first facing tile, index 1 on the second
 * @param day absolute game day
 * @param spot the outdoor spot the pair meets at
 * @param base the slot start (slot + seeded jitter)
 * @param bondId the pair's bond id, for error messages
 * @returns the base start clamped into the window both walks allow (unchanged when the walks already fit)
 * @throws when the base start falls inside a private window, or when no start time leaves room for both walks
 */
function meetingStartWithinWalks(residents: readonly [ResidentId, ResidentId], day: number, spot: TownSocialSpot,
  base: number, bondId: string): number {
  const map = getMapData(SceneKey.Town), standing = townSpotStandingTiles(map, spot, spot.label);
  let lowest = Number.NEGATIVE_INFINITY, highest = Number.POSITIVE_INFINITY;
  residents.forEach((residentId, index) => {
    const room = authoredPrivateRouteWindow(residentId, day), home = townRouteHomePoint(residentId, map);
    if (room.endsAt <= base) {
      lowest = Math.max(lowest, room.endsAt + townRouteWalkMinutes(map, home, standing[index]));
    } else if (room.startsAt >= base + TOWN_MEETING_MINUTES) {
      highest = Math.min(highest, room.startsAt - townRouteWalkMinutes(map, standing[index], home) - TOWN_MEETING_MINUTES);
    } else {
      throw new Error(`Town schedules: ${bondId} meeting overlaps ${residentId}'s private time on day ${day}`);
    }
  });
  if (lowest > highest) {
    throw new Error(`Town schedules: ${bondId} has no meeting time on day ${day} that leaves room to walk to ${spot.label}`);
  }
  return Math.min(Math.max(base, lowest), highest);
}

/** Build one deterministic daily matching biased by personality, history, and current partners. */
export function townMeetingsForDay(day: number, state: RelationshipsState = GameState.instance.relationships): readonly DailyTownMeeting[] {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town schedules: invalid day ${day}`);
  let cachedDays = MEETINGS_CACHE.get(state);
  if (!cachedDays) { cachedDays = new Map(); MEETINGS_CACHE.set(state, cachedDays); }
  const cached = cachedDays.get(day);
  if (cached) return cached;
  const remaining = TOWN_RESIDENTS.map(resident => resident.id).sort((left, right) =>
    residentSocialRoll(state.socialSeed, day, `${left}:order`) - residentSocialRoll(state.socialSeed, day, `${right}:order`));
  const spots = [...TOWN_SOCIAL_SPOTS].sort((left, right) =>
    residentSocialRoll(state.socialSeed, day, `${left.id}:spot`) - residentSocialRoll(state.socialSeed, day, `${right.id}:spot`));
  const meetings: DailyTownMeeting[] = [];
  while (remaining.length) {
    const first = remaining.shift();
    if (!first) throw new Error('Town schedules: daily matching lost its first resident');
    let bestIndex = -1, bestScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((second, index) => {
      const bondId = residentBondId(first, second);
      if (!state.bonds[bondId]) throw new Error(`Town schedules: missing social bond ${bondId}`);
      // Only immutable seed/personality inputs choose the day. Meeting effects cannot reshuffle later pairs mid-day.
      const score = residentBondChemistry(bondId, state.socialSeed) * 8
        + residentSocialRoll(state.socialSeed, day, `${bondId}:meeting`) % 120;
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex < 0) throw new Error(`Town schedules: ${first} has no daily partner`);
    const second = remaining.splice(bestIndex, 1)[0], meetingIndex = meetings.length, bondId = residentBondId(first, second);
    const profile = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
    if (!profile) throw new Error(`Town schedules: missing social bond ${bondId}`);
    const slots = (day - 1) % 7 >= 5 ? WEEKEND_MEETING_SLOTS : WEEKDAY_MEETING_SLOTS;
    const startsAt = meetingStartWithinWalks(profile.residents, day, spots[meetingIndex], slots[meetingIndex % slots.length]
      + residentSocialRoll(state.socialSeed, day, `${bondId}:slot`) % 26, bondId);
    const endsAt = startsAt + TOWN_MEETING_MINUTES;
    for (const residentId of profile.residents) {
      const room = authoredPrivateRouteWindow(residentId, day);
      if (startsAt < room.endsAt && room.startsAt < endsAt) {
        throw new Error(`Town schedules: ${bondId} meeting overlaps ${residentId}'s private time on day ${day}`);
      }
    }
    meetings.push({ bondId, residents: profile.residents, spot: spots[meetingIndex], meetingIndex, startsAt, endsAt });
  }
  if (meetings.length !== 6 || new Set(meetings.flatMap(meeting => meeting.residents)).size !== TOWN_RESIDENTS.length) {
    throw new Error('Town schedules: daily matching must include every resident exactly once');
  }
  cachedDays.set(day, meetings);
  return meetings;
}

/** Resolve witnesses: the same visible interior shares the room; outdoors requires nearby tiles. */
export function residentActionWitnesses(action: ResidentActionLocation,
  candidates: readonly ResidentWitnessPosition[], outdoorRadius = 6): ResidentId[] {
  if (!Number.isFinite(outdoorRadius) || outdoorRadius <= 0) throw new Error(`Town schedules: invalid witness radius ${outdoorRadius}`);
  return candidates.filter(candidate => {
    if (!candidate.visible || candidate.scene !== action.scene || candidate.area !== action.area) return false;
    if (action.area === 'interior') return true;
    return Math.hypot(candidate.tx - action.tx, candidate.ty - action.ty) <= outdoorRadius;
  }).map(candidate => candidate.residentId);
}

/** Find every resident at a nearby meeting at the same time, excluding the two participants. */
export function townMeetingWitnesses(day: number, meeting: DailyTownMeeting,
  state: RelationshipsState = GameState.instance.relationships): ResidentId[] {
  const candidates = townMeetingsForDay(day, state).filter(candidate => candidate.bondId !== meeting.bondId
    && candidate.startsAt < meeting.endsAt && meeting.startsAt < candidate.endsAt)
    .flatMap(candidate => candidate.residents.map(residentId => ({ residentId, area: 'outdoor' as const,
      scene: SceneKey.Town, tx: candidate.spot.tx, ty: candidate.spot.ty, visible: true })));
  return residentActionWitnesses({ area: 'outdoor', scene: SceneKey.Town, tx: meeting.spot.tx, ty: meeting.spot.ty }, candidates);
}

/** Resolve the selected resident's one social meeting for a specific day. */
export function socialMeetingForResident(id: ResidentId, day: number): DailyTownMeeting {
  const meeting = townMeetingsForDay(day).find(candidate => candidate.residents.includes(id));
  if (!meeting) throw new Error(`Town schedules: resident ${id} has no meeting on day ${day}`);
  return meeting;
}

/** Build or read one immutable authored route day before relationship-aware stop filtering. */
function authoredRouteDay(id: ResidentId, day: number, map: MapData): TownRoutePlanDay {
  if (map.key !== SceneKey.Town) throw new Error('Town schedules: detailed routes require the Town map');
  let cache = ROUTE_DAY_CACHE.get(map);
  if (!cache) { cache = new Map(); ROUTE_DAY_CACHE.set(map, cache); }
  // why: a keeper plan changes the route, so its id is part of the key; making or dropping a plan rebuilds the day.
  const keeperPlan = keeperRoutePlanFor(GameState.instance.social, id, day);
  const key = `${GameState.instance.relationships.socialSeed}:${day}:${id}:${keeperPlan?.id ?? 'none'}`, cached = cache.get(key);
  if (cached) return cached;
  const plan = authoredTownRouteDay(id, day, map, socialMeetingForResident(id, day), keeperPlan);
  cache.set(key, plan);
  return plan;
}

/** Filter only denied building visits; home, outdoor stops, and every allowed visit remain ordered. */
export function residentRoutePlanForDay(id: ResidentId, day: number, map: MapData = getMapData(SceneKey.Town)): TownRoutePlanDay {
  const authored = authoredRouteDay(id, day, map), resident = residentDefinition(id);
  const stops = authored.stops.filter(stop => {
    const buildingId = townRouteDestinationBuilding(stop.destination, resident.buildingId);
    return buildingId === null || townBuildingAccess(buildingId, stop.arrive,
      { kind: 'resident', residentId: id }, GameState.instance.relationships).allowed;
  });
  if (stops[0]?.id !== authored.stops[0].id || stops[stops.length - 1]?.id !== authored.stops[authored.stops.length - 1].id
    || !stops.some(stop => stop.id === 'social')) {
    throw new Error(`Town schedules: required route stops were filtered for ${id}`);
  }
  if (stops.length === authored.stops.length) return authored;
  return { ...authored, stops: stops.map(stop => ({ ...stop, via: stop.via.map(point => ({ ...point })) })) };
}

/** Resolve the world scene that owns one stationary route stop. */
function routeStopScene(id: ResidentId, stop: TownRoutePlanStop): SceneKey {
  const resident = residentDefinition(id), buildingId = townRouteDestinationBuilding(stop.destination, resident.buildingId);
  return buildingId === null ? SceneKey.Town : townBuilding(buildingId).scene;
}

/** Collapse detailed categories into the stable activity vocabulary used by actors and the journal. */
function routeActivity(stop: TownRoutePlanStop): ResidentScheduleActivity {
  if (stop.category === 'home' || stop.category === 'private') return 'home';
  if (stop.category === 'work') return 'work';
  return 'socializing';
}

/** Player-facing label for the private self-activity stop. The raw route label stays in the route editor only. */
const PRIVATE_SELF_ACTIVITY_LABEL = 'Do not disturb';

/**
 * Turn a route stop label into the label players see in the journal, the routes map, and actor data.
 * why: the editable weekly route names the adult private stop plainly; the game must never show that name.
 * @param stop the stop being visited or walked toward
 * @param walking true while the resident walks toward the stop
 */
function publicStopLabel(stop: TownRoutePlanStop, walking: boolean): string {
  const label = stop.label === DAYDREAM_ROUTE_LABEL ? PRIVATE_SELF_ACTIVITY_LABEL : stop.label;
  return walking ? `Walking to ${stop.label === DAYDREAM_ROUTE_LABEL ? 'their room' : label}` : label;
}

/** Resolve a detailed plan and its exact sample once for schedule readers. */
function resolvedRoute(id: ResidentId, day: number, timeOfDay: number, map: MapData): {
  plan: TownRoutePlanDay;
  sample: ReturnType<typeof sampleTownRouteDay>;
  schedule: { scene: SceneKey; activity: ResidentScheduleActivity; locationLabel: string };
} {
  if (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay > 24 * 60) throw new Error(`Town schedules: invalid time ${timeOfDay}`);
  const plan = residentRoutePlanForDay(id, day, map), sample = sampleTownRouteDay(plan, map, timeOfDay);
  const traveling = sample.stop === null && sample.moving;
  const schedule = traveling
    ? { scene: SceneKey.Town, activity: 'traveling' as const, locationLabel: publicStopLabel(sample.target, true) }
    : { scene: routeStopScene(id, sample.stop ?? sample.target), activity: routeActivity(sample.stop ?? sample.target),
      locationLabel: publicStopLabel(sample.stop ?? sample.target, false) };
  return { plan, sample, schedule };
}

/** Return the current live scene and detailed location label. */
export function residentScheduleScene(id: ResidentId, day: number, timeOfDay: number,
  map: MapData = getMapData(SceneKey.Town)): {
  scene: SceneKey; activity: ResidentScheduleActivity; locationLabel: string;
} {
  return resolvedRoute(id, day, timeOfDay, map).schedule;
}

/**
 * What the resident's authored plan has them doing at one clock minute, in plain words, for the
 * local chat model: the stop label (e.g. "Testing a harmless charm") or "walking to <place>".
 * @param id resident
 * @param day absolute game day
 * @param timeOfDay minutes since 06:00
 * @param map Town map the routes are compiled on
 */
export function residentActivityLabel(id: ResidentId, day: number, timeOfDay: number,
  map: MapData = getMapData(SceneKey.Town)): string {
  const { sample, schedule } = resolvedRoute(id, day, timeOfDay, map);
  return sample.stop !== null ? sample.stop.label : `walking to ${schedule.locationLabel}`;
}

/** Resolve an exact outdoor position. Return null while the resident belongs to an interior. */
export function residentTownPresence(id: ResidentId, day: number, timeOfDay: number, map: MapData): ScheduledTownPresence | null {
  const { sample, schedule } = resolvedRoute(id, day, timeOfDay, map);
  if (schedule.scene !== SceneKey.Town) return null;
  const meeting = socialMeetingForResident(id, day), social = sample.stop?.id === 'social';
  const facing = social ? (meeting.residents[0] === id ? 'right' : 'left')
    : sample.moving ? sample.facing : idleTownFacing(id, timeOfDay);
  return { ...schedule, x: (sample.x + 0.5) * TILE, y: (sample.y + 0.5) * TILE, facing, moving: sample.moving };
}

/** Directions a standing resident glances toward, in order. */
const IDLE_GLANCES = ['left', 'right', 'up', 'left', 'right'] as const;

/**
 * Return where a standing (non-meeting) resident looks at one clock minute.
 * Residents face the street, then glance around for about three minutes in every ~16, so nobody stands frozen.
 * The result is a pure function of the clock, so scene re-entry shows the same pose.
 */
function idleTownFacing(id: ResidentId, timeOfDay: number): ScheduledTownPresence['facing'] {
  const residentIndex = TOWN_RESIDENTS.findIndex(candidate => candidate.id === id);
  if (residentIndex < 0) throw new Error(`Town schedules: unknown resident ${id}`);
  // Offsetting by resident keeps a crowd from turning their heads in unison.
  const shifted = timeOfDay + residentIndex * 5.3, cycle = Math.floor(shifted / 16);
  if (shifted % 16 >= 3) return 'down';
  return IDLE_GLANCES[(cycle + residentIndex) % IDLE_GLANCES.length];
}

/** Return one detached full-day route and the same current position used by live actors. */
export function residentRouteSnapshot(id: ResidentId, day: number, timeOfDay: number, map: MapData): ResidentRouteSnapshot {
  const { plan, sample, schedule } = resolvedRoute(id, day, timeOfDay, map), meeting = socialMeetingForResident(id, day);
  const path = townRouteDayPath(plan, map).map(point => ({ ...point }));
  return { residentId: id, day, activity: schedule.activity, locationLabel: schedule.locationLabel,
    inside: schedule.scene !== SceneKey.Town, position: { tx: sample.x, ty: sample.y }, path,
    partnerId: meeting.residents[0] === id ? meeting.residents[1] : meeting.residents[0], meetingSpotId: meeting.spot.id };
}

/**
 * Return the minutes both residents stand together. Route planning anchors both social stops to the meeting,
 * so this is the meeting's own window; the check guards against a route that drifted from it.
 */
export function residentMeetingWindow(day: number, pair: DailyTownMeeting): { minute: number; endsAt: number } {
  const cacheKey = `${GameState.instance.relationships.socialSeed}:${day}:${pair.bondId}`;
  const cached = MEETING_WINDOW_CACHE.get(cacheKey);
  if (cached) return cached;
  const map = getMapData(SceneKey.Town);
  for (const id of pair.residents) {
    const stop = residentRoutePlanForDay(id, day, map).stops.find(candidate => candidate.id === 'social');
    if (!stop || stop.arrive !== pair.startsAt || stop.leave < pair.endsAt) {
      throw new Error(`Town schedules: ${id} is not at the ${pair.bondId} meeting on day ${day}`);
    }
  }
  const result = { minute: pair.startsAt, endsAt: pair.endsAt };
  MEETING_WINDOW_CACHE.set(cacheKey, result);
  return result;
}

/** Return only meetings inside both residents' shared authored social window. */
export function activeTownMeetings(day: number, timeOfDay: number): readonly ActiveTownMeeting[] {
  return townMeetingsForDay(day).flatMap(pair => {
    const window = residentMeetingWindow(day, pair);
    return timeOfDay >= window.minute && timeOfDay < window.endsAt ? [{ pair, ...window }] : [];
  });
}

/** Validate all 84 detailed days, paths, scene stops, travel samples, and meeting overlaps before actors spawn. */
export function validateTownScheduleRoutes(map: MapData): void {
  validateTownSchedules();
  validateWayfarerSeats();
  for (let day = 1; day <= 7; day++) {
    for (const resident of TOWN_RESIDENTS) {
      const id = resident.id as ResidentId, plan = residentRoutePlanForDay(id, day, map), path = townRouteDayPath(plan, map);
      if (plan.stops.length < TOWN_ROUTE_MIN_STOPS || plan.stops.length > TOWN_ROUTE_MAX_STOPS
        || path.some(point => !isTownRoutePointPassable(map, point))) {
        throw new Error(`Town schedules: invalid detailed route for ${id} on day ${day}`);
      }
      for (let index = 0; index < plan.stops.length; index++) {
        const stop = plan.stops[index], schedule = residentScheduleScene(id, day, (stop.arrive + stop.leave) / 2);
        if (schedule.scene !== routeStopScene(id, stop)) throw new Error(`Town schedules: wrong stop scene for ${id} ${stop.id}`);
        if (index === 0) continue;
        const previous = plan.stops[index - 1], timing = townRouteSegmentTiming(map, previous, stop);
        if (timing.length > 0) {
          // Sample the middle of the real walk; a filtered stop can leave a lingering gap before departure.
          const presence = residentTownPresence(id, day, (timing.departAt + stop.arrive) / 2, map);
          if (!presence?.moving) throw new Error(`Town schedules: missing travel for ${id} to ${stop.id}`);
        }
      }
    }
    for (const meeting of townMeetingsForDay(day)) residentMeetingWindow(day, meeting);
  }
}

/** Resolve the named place used by journal and model context. */
export function socialSpotLabel(locationId: string): string {
  const spot = TOWN_SOCIAL_SPOTS.find(candidate => candidate.id === locationId);
  if (!spot) throw new Error(`Town schedules: missing spot ${locationId}`);
  return spot.label;
}
