/**
 * Strict, detached weekly route drafts for the development route workshop.
 * Production schedules never read this document. Each stop stores optional via points; a stable
 * shortest-path compiler turns them into the exact cardinal route shown in the workshop.
 */
import { SceneKey } from '../config/AssetKeys';
import { RESIDENT_HOME_DEADLINE } from '../config/TownSchedules';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { socialMeetingForResident } from '../systems/TownScheduleSystem';
import { getMapData, type MapData } from '../world/MapDef';
import type { ResidentId } from '../config/ResidentRelationships';
import { authoredTownRouteDay, compileTownRouteSegment, isTownRoutePointPassable, townRouteHomePoint,
  TOWN_ROUTE_ACTIVITY_CATEGORIES, TOWN_ROUTE_WEEKDAYS, type TownRouteActivityCategory,
  type TownRoutePoint } from '../systems/TownRoutePlanSystem';

export const NPC_ROUTE_DRAFT_MAX_BYTES = 1_048_576;
export const NPC_ROUTE_WEEKDAYS = TOWN_ROUTE_WEEKDAYS;
export const NPC_ROUTE_ACTIVITY_CATEGORIES = TOWN_ROUTE_ACTIVITY_CATEGORIES;
const MAX_STOPS = 10;
const MAX_VIA_POINTS = 32;

/** Stable purpose shown in the editor and retained in route JSON. */
export type NpcRouteActivityCategory = TownRouteActivityCategory;

/** One visit or activity whose times use the game's minutes-since-06:00 clock. */
export interface NpcRouteStopDraft {
  id: string;
  category: NpcRouteActivityCategory;
  label: string;
  reason: string;
  arrive: number;
  leave: number;
  tx: number;
  ty: number;
  via: TownRoutePoint[];
}

/** One resident's ordered plan for one weekday. */
export interface NpcRouteDayDraft {
  weekday: number;
  note: string;
  stops: NpcRouteStopDraft[];
}

/** One stable resident identity and all seven plans. */
export interface NpcResidentRoutesDraft {
  residentId: ResidentId;
  days: NpcRouteDayDraft[];
}

/** Complete exchange document owned only by the route workshop. */
export interface NpcRouteDraft {
  version: 2;
  map: 'town-routes';
  townFingerprint: string;
  residents: NpcResidentRoutesDraft[];
}

/** Exact compiled segment plus its owning destination stop. */
export interface NpcRouteSegment {
  stopId: string;
  points: TownRoutePoint[];
}

/** Preview sample produced without changing either the draft or GameState. */
export interface NpcRoutePreview {
  x: number;
  y: number;
  facing: 'down' | 'up' | 'left' | 'right';
  moving: boolean;
  label: string;
}

/** Return the current authored Town map (routes are drawn on the painted Town). */
function townMap(): MapData {
  return getMapData(SceneKey.Town);
}

/** Bind drafts to the current Town dimensions, resident set, and building ownership. */
export function npcRouteTownFingerprint(): string {
  const map = townMap();
  return `town-routes-v3:${map.w}x${map.h}:${TOWN_RESIDENTS.map(resident => `${resident.id}@${resident.buildingId}`).join('|')}`;
}

/** Reject control characters, padded text, and overlong design notes. */
function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)
    || (!allowEmpty && value.length === 0)) throw new Error(`${label} is invalid.`);
  return value;
}

/** Require one safe integer without clamping imported or edited data. */
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

/** Test a route point against the same outdoor movement surfaces used by resident schedules. */
function passable(map: MapData, point: TownRoutePoint): boolean {
  return isTownRoutePointPassable(map, point);
}

/** Check one pointer-selected Town tile without constructing or mutating a route draft. */
export function isNpcRoutePointPassable(tx: number, ty: number): boolean {
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty)) return false;
  return passable(townMap(), { tx, ty });
}

/** Parse one exact passable Town point. */
function routePoint(value: unknown, map: MapData, label: string): TownRoutePoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'tx,ty') throw new Error(`${label} is invalid.`);
  const record = value as Record<string, unknown>;
  const point = { tx: integer(record.tx, 0, map.w - 1, `${label} x`), ty: integer(record.ty, 0, map.h - 1, `${label} y`) };
  if (!passable(map, point)) throw new Error(`${label} ${point.tx},${point.ty} is blocked.`);
  return point;
}

/** Require one known activity category from imported or edited route data. */
function routeCategory(value: unknown, label: string): NpcRouteActivityCategory {
  if (typeof value !== 'string' || !NPC_ROUTE_ACTIVITY_CATEGORIES.includes(value as NpcRouteActivityCategory)) {
    throw new Error(`${label} category is invalid.`);
  }
  return value as NpcRouteActivityCategory;
}

/** Compile a segment through every designer-supplied via point and remove shared joins. */
function compileSegment(map: MapData, start: TownRoutePoint, stop: NpcRouteStopDraft): TownRoutePoint[] {
  return compileTownRouteSegment(map, start, stop);
}

/** Resolve one resident's authored home-door arrival without reading an adventure save. */
function residentHome(id: ResidentId, map: MapData): TownRoutePoint {
  return townRouteHomePoint(id, map);
}

/** Validate one route stop and retain no references from untrusted input. */
function routeStop(value: unknown, map: MapData, label: string): NpcRouteStopDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'arrive,category,id,label,leave,reason,tx,ty,via') throw new Error(`${label} has unknown or missing fields.`);
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.via) || record.via.length > MAX_VIA_POINTS) throw new Error(`${label} has too many via points.`);
  const point = routePoint({ tx: record.tx, ty: record.ty }, map, label);
  return { id: text(record.id, `${label} id`, 48), category: routeCategory(record.category, label), label: text(record.label, `${label} label`, 48),
    reason: text(record.reason, `${label} reason`, 180, true), arrive: integer(record.arrive, 0, RESIDENT_HOME_DEADLINE, `${label} arrival`),
    leave: integer(record.leave, 0, RESIDENT_HOME_DEADLINE, `${label} departure`), ...point,
    via: record.via.map((entry, index) => routePoint(entry, map, `${label} via point ${index + 1}`)) };
}

/** Validate one complete day, including home endpoints, time order, and every compiled route. */
function routeDay(value: unknown, id: ResidentId, expectedDay: number, map: MapData): NpcRouteDayDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'note,stops,weekday') throw new Error(`${id} ${NPC_ROUTE_WEEKDAYS[expectedDay]} route is invalid.`);
  const record = value as Record<string, unknown>;
  if (record.weekday !== expectedDay || !Array.isArray(record.stops) || record.stops.length < 2 || record.stops.length > MAX_STOPS) {
    throw new Error(`${id} ${NPC_ROUTE_WEEKDAYS[expectedDay]} must keep 2 to ${MAX_STOPS} ordered stops.`);
  }
  const stops = record.stops.map((stop, index) => routeStop(stop, map, `${id} stop ${index + 1}`));
  if (new Set(stops.map(stop => stop.id)).size !== stops.length) throw new Error(`${id} ${NPC_ROUTE_WEEKDAYS[expectedDay]} has duplicate stop IDs.`);
  const home = residentHome(id, map), first = stops[0], last = stops[stops.length - 1];
  if (first.category !== 'home' || last.category !== 'home' || first.tx !== home.tx || first.ty !== home.ty || last.tx !== home.tx || last.ty !== home.ty
    || first.arrive !== 0 || last.leave !== RESIDENT_HOME_DEADLINE) {
    throw new Error(`${id} ${NPC_ROUTE_WEEKDAYS[expectedDay]} must begin at home at 6 AM and end at home by midnight.`);
  }
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (stop.arrive > stop.leave) throw new Error(`${stop.label} leaves before it arrives.`);
    if (index === 0) {
      if (stop.via.length) throw new Error(`${stop.label} cannot have an arrival path.`);
      continue;
    }
    const previous = stops[index - 1];
    if (stop.arrive < previous.leave) throw new Error(`${stop.label} overlaps ${previous.label}.`);
    const segment = compileSegment(map, previous, stop);
    if (segment.length > 1 && stop.arrive === previous.leave) throw new Error(`${stop.label} needs travel time after ${previous.label}.`);
  }
  return { weekday: expectedDay, note: text(record.note, `${id} route note`, 240, true), stops };
}

/** Validate the full document atomically and return a canonical detached copy. */
export function validateNpcRouteDraft(input: unknown): NpcRouteDraft {
  const map = townMap();
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'map,residents,townFingerprint,version') throw new Error('NPC route draft has unknown or missing fields.');
  const record = input as Record<string, unknown>;
  if (record.version !== 2 || record.map !== 'town-routes' || record.townFingerprint !== npcRouteTownFingerprint()
    || !Array.isArray(record.residents) || record.residents.length !== TOWN_RESIDENTS.length) {
    throw new Error('NPC route draft belongs to a different Town version or resident set.');
  }
  const residents = record.residents.map((value, index): NpcResidentRoutesDraft => {
    const expected = TOWN_RESIDENTS[index].id as ResidentId;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'days,residentId') throw new Error(`NPC route entry ${index + 1} is invalid.`);
    const resident = value as Record<string, unknown>;
    if (resident.residentId !== expected || !Array.isArray(resident.days) || resident.days.length !== 7) {
      throw new Error(`NPC route draft must keep ${expected} and all seven weekdays in authored order.`);
    }
    return { residentId: expected, days: resident.days.map((day, weekday) => routeDay(day, expected, weekday, map)) };
  });
  return { version: 2, map: 'town-routes', townFingerprint: npcRouteTownFingerprint(), residents };
}

/** Expand one production-authored route day into the editor's destination-free exchange shape. */
function detailedRouteDay(residentId: ResidentId, _residentIndex: number, weekday: number, map: MapData): NpcRouteDayDraft {
  const day = weekday + 1, meeting = socialMeetingForResident(residentId, day);
  // why: the editor drafts the authored routine; keeper plans are live-game choices, not authored data.
  const plan = authoredTownRouteDay(residentId, day, map, meeting, null);
  return { weekday, note: plan.note, stops: plan.stops.map(({ destination: _destination, ...stop }) => stop) };
}

/** Build the first detached route draft from detailed personality-led weekly templates. */
export function createNpcRouteDraft(): NpcRouteDraft {
  const map = townMap();
  const residents = TOWN_RESIDENTS.map((resident, residentIndex): NpcResidentRoutesDraft => ({ residentId: resident.id as ResidentId,
    days: NPC_ROUTE_WEEKDAYS.map((_name, weekday) => detailedRouteDay(resident.id as ResidentId, residentIndex, weekday, map)) }));
  return validateNpcRouteDraft({ version: 2, map: 'town-routes', townFingerprint: npcRouteTownFingerprint(), residents });
}

/** Return a detached selected day or fail on an unknown stable identity. */
export function npcRouteDay(draft: NpcRouteDraft, residentId: ResidentId, weekday: number): NpcRouteDayDraft {
  const dayIndex = integer(weekday, 0, 6, 'Weekday'), map = townMap();
  if (draft.version !== 2 || draft.map !== 'town-routes' || draft.townFingerprint !== npcRouteTownFingerprint()
    || !Array.isArray(draft.residents)) throw new Error('NPC route draft belongs to a different Town version.');
  const resident = draft.residents.find(entry => entry.residentId === residentId);
  if (!resident) throw new Error(`NPC route draft has no resident ${residentId}.`);
  if (!Array.isArray(resident.days) || resident.days.length !== 7) throw new Error(`NPC route draft has an incomplete week for ${residentId}.`);
  // Read-heavy map rendering validates only the selected day. All writes and serialization still validate the complete document.
  return routeDay(resident.days[dayIndex], residentId, dayIndex, map);
}

/** Return every exact compiled segment for drawing and movement preview. */
export function npcRouteSegments(draft: NpcRouteDraft, residentId: ResidentId, weekday: number): NpcRouteSegment[] {
  const day = npcRouteDay(draft, residentId, weekday), map = townMap();
  return day.stops.map((stop, index) => ({ stopId: stop.id,
    points: index === 0 ? [{ tx: stop.tx, ty: stop.ty }] : compileSegment(map, day.stops[index - 1], stop) }));
}

/** Replace one stop's text or time fields and validate the complete candidate before returning it. */
export function updateNpcRouteStop(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  patch: Partial<Pick<NpcRouteStopDraft, 'category' | 'label' | 'reason' | 'arrive' | 'leave'>>): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const stop = day?.stops.find(entry => entry.id === stopId);
  if (!day || !stop) throw new Error(`NPC route stop ${stopId} does not exist.`);
  Object.assign(stop, patch);
  return validateNpcRouteDraft(candidate);
}

/** Replace one day's design note through the same full candidate validation. */
export function updateNpcRouteNote(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, note: string): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  if (!day) throw new Error(`NPC route day does not exist for ${residentId}.`);
  day.note = note;
  return validateNpcRouteDraft(candidate);
}

/** Move one non-home stop; segment paths recompile through its retained via points. */
export function moveNpcRouteStop(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  tx: number, ty: number): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const index = day?.stops.findIndex(entry => entry.id === stopId) ?? -1;
  if (!day || index < 0) throw new Error(`NPC route stop ${stopId} does not exist.`);
  if (index === 0 || index === day.stops.length - 1) throw new Error('Morning and night home stops stay at the resident home.');
  const point = routePoint({ tx, ty }, townMap(), 'Moved stop');
  day.stops[index].tx = point.tx; day.stops[index].ty = point.ty;
  return validateNpcRouteDraft(candidate);
}

/** Free gap (minutes) between two stops that a new activity can sit inside. */
const MIN_INSERT_MINUTES = 60;
/** Shortest stay (minutes) that can be split in thirds (stay, walk, new activity), so each keeps 10 minutes. */
const MIN_SPLIT_STAY_MINUTES = 30;

/**
 * Explain whether one selected stop can accept a new activity immediately after it.
 * why: authored days have no idle gaps (residents linger until they must walk on), so a new activity may also
 * take the last part of a stay that lasts at least half an hour. See addNpcRouteStop.
 */
export function npcRouteStopInsertionIssue(day: NpcRouteDayDraft, afterStopId: string): string | null {
  const index = day.stops.findIndex(entry => entry.id === afterStopId);
  if (index < 0 || index >= day.stops.length - 1) return 'Choose a stop before the final home stop.';
  if (day.stops.length >= MAX_STOPS) return `A day can contain at most ${MAX_STOPS} stops.`;
  const previous = day.stops[index], gap = day.stops[index + 1].arrive - previous.leave;
  if (gap < MIN_INSERT_MINUTES && previous.leave - previous.arrive < MIN_SPLIT_STAY_MINUTES) {
    return 'Leave one hour between these stops, or stay at least 30 minutes here, before adding another activity.';
  }
  return null;
}

/**
 * Add one activity after the selected stop with a unique identity and enough explicit time.
 * The new stop starts on the selected stop's tile. With a free gap of an hour or more it takes the middle third of
 * that gap. Otherwise the selected stay splits in thirds: the selected stop keeps the first third, the second third is
 * walking time (the designer usually drags the new stop elsewhere), and the new stop keeps the original departure.
 * @throws when npcRouteStopInsertionIssue reports a problem
 */
export function addNpcRouteStop(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, afterStopId: string): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  if (!day) throw new Error(`NPC route day does not exist for ${residentId}.`);
  const issue = npcRouteStopInsertionIssue(day, afterStopId);
  if (issue) throw new Error(issue);
  const index = day.stops.findIndex(entry => entry.id === afterStopId);
  const previous = day.stops[index], next = day.stops[index + 1], available = next.arrive - previous.leave;
  let arrive: number, leave: number;
  if (available >= MIN_INSERT_MINUTES) {
    arrive = previous.leave + Math.floor(available / 3); leave = previous.leave + Math.floor(available * 2 / 3);
  } else {
    // why: the validator needs real walking minutes before a stop on another tile, so the split leaves a middle third.
    const stay = previous.leave - previous.arrive;
    leave = previous.leave; arrive = previous.arrive + Math.floor(stay * 2 / 3);
    previous.leave = previous.arrive + Math.floor(stay / 3);
  }
  let sequence = 1;
  while (day.stops.some(stop => stop.id === `activity-${sequence}`)) sequence++;
  day.stops.splice(index + 1, 0, { id: `activity-${sequence}`, category: 'errand', label: 'New activity', reason: 'Describe why this stop belongs in the day.',
    arrive, leave, tx: previous.tx, ty: previous.ty, via: [] });
  return validateNpcRouteDraft(candidate);
}

/** Delete one non-home activity and keep both required home anchors. */
export function removeNpcRouteStop(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const index = day?.stops.findIndex(entry => entry.id === stopId) ?? -1;
  if (!day || index < 0) throw new Error(`NPC route stop ${stopId} does not exist.`);
  if (index === 0 || index === day.stops.length - 1) throw new Error('Morning and night home stops cannot be removed.');
  day.stops.splice(index, 1);
  return validateNpcRouteDraft(candidate);
}

/** Insert one passable bend point at an exact place in the selected arrival segment. */
export function insertNpcRouteWaypoint(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  waypointIndex: number, tx: number, ty: number): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const index = day?.stops.findIndex(entry => entry.id === stopId) ?? -1;
  if (!day || index <= 0) throw new Error('Choose a stop after the morning home stop.');
  if (day.stops[index].via.length >= MAX_VIA_POINTS) throw new Error(`A segment can contain at most ${MAX_VIA_POINTS} via points.`);
  if (!Number.isSafeInteger(waypointIndex) || waypointIndex < 0 || waypointIndex > day.stops[index].via.length) {
    throw new Error('That bend-point position does not exist.');
  }
  day.stops[index].via.splice(waypointIndex, 0, routePoint({ tx, ty }, townMap(), 'Bend point'));
  return validateNpcRouteDraft(candidate);
}

/** Append one bend point for callers that do not need line-relative insertion. */
export function addNpcRouteWaypoint(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  tx: number, ty: number): NpcRouteDraft {
  const stop = npcRouteDay(draft, residentId, weekday).stops.find(entry => entry.id === stopId);
  if (!stop) throw new Error(`NPC route stop ${stopId} does not exist.`);
  return insertNpcRouteWaypoint(draft, residentId, weekday, stopId, stop.via.length, tx, ty);
}

/** Move one existing via point and validate every affected compiled segment. */
export function moveNpcRouteWaypoint(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  waypointIndex: number, tx: number, ty: number): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const stop = day?.stops.find(entry => entry.id === stopId);
  if (!stop || !Number.isSafeInteger(waypointIndex) || waypointIndex < 0 || waypointIndex >= stop.via.length) {
    throw new Error('That route via point does not exist.');
  }
  stop.via[waypointIndex] = routePoint({ tx, ty }, townMap(), 'Moved via point');
  return validateNpcRouteDraft(candidate);
}

/** Remove one exact via point without changing its destination stop. */
export function removeNpcRouteWaypoint(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, stopId: string,
  waypointIndex: number): NpcRouteDraft {
  const candidate = validateNpcRouteDraft(draft), day = candidate.residents.find(entry => entry.residentId === residentId)?.days[weekday];
  const stop = day?.stops.find(entry => entry.id === stopId);
  if (!stop || !Number.isSafeInteger(waypointIndex) || waypointIndex < 0 || waypointIndex >= stop.via.length) {
    throw new Error('That route via point does not exist.');
  }
  stop.via.splice(waypointIndex, 1);
  return validateNpcRouteDraft(candidate);
}

/** Sample the selected route at one clock minute for the workshop's live marker. */
export function sampleNpcRoute(draft: NpcRouteDraft, residentId: ResidentId, weekday: number, minute: number): NpcRoutePreview {
  const day = npcRouteDay(draft, residentId, weekday), segments = npcRouteSegments(draft, residentId, weekday);
  const time = integer(Math.floor(minute), 0, RESIDENT_HOME_DEADLINE, 'Preview time');
  for (let index = 0; index < day.stops.length; index++) {
    const stop = day.stops[index];
    if (time >= stop.arrive && time <= stop.leave) return { x: stop.tx, y: stop.ty, facing: 'down', moving: false, label: stop.label };
    if (index > 0) {
      const previous = day.stops[index - 1];
      if (time > previous.leave && time < stop.arrive) {
        const path = segments[index].points, fraction = (time - previous.leave) / (stop.arrive - previous.leave);
        const distance = fraction * Math.max(0, path.length - 1), pointIndex = Math.min(path.length - 2, Math.floor(distance));
        if (path.length === 1) return { x: path[0].tx, y: path[0].ty, facing: 'down', moving: false, label: `Walking to ${stop.label}` };
        const from = path[Math.max(0, pointIndex)], to = path[Math.min(path.length - 1, pointIndex + 1)], local = distance - Math.floor(distance);
        return { x: from.tx + (to.tx - from.tx) * local, y: from.ty + (to.ty - from.ty) * local,
          facing: to.tx > from.tx ? 'right' : to.tx < from.tx ? 'left' : to.ty > from.ty ? 'down' : 'up',
          moving: true, label: `Walking to ${stop.label}` };
      }
    }
  }
  const last = day.stops[day.stops.length - 1];
  return { x: last.tx, y: last.ty, facing: 'down', moving: false, label: last.label };
}

/** Parse bounded untrusted JSON before any caller can replace its current draft. */
export function parseNpcRouteDraft(source: string): NpcRouteDraft {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > NPC_ROUTE_DRAFT_MAX_BYTES) {
    throw new Error('NPC route draft exceeds the 1 MB limit.');
  }
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('NPC route draft is not valid JSON.'); }
  return validateNpcRouteDraft(value);
}

/** Serialize one canonical validated draft for browser storage or download. */
export function serializeNpcRouteDraft(draft: NpcRouteDraft): string {
  return JSON.stringify(validateNpcRouteDraft(draft), null, 2);
}
