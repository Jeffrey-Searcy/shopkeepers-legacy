/**
 * Authored Town meeting places and speech seeds for the dynamic resident social network.
 * TownScheduleSystem chooses each day's partners from save-owned state and personality affinity.
 */
import { RESIDENT_BONDS, residentBondId, type ResidentBondProfile, type ResidentId } from './ResidentRelationships';
import { TOWN_RESIDENTS } from './TownResidents';

/** Stable ids for every named outdoor meeting place. Saved social events reference these ids. */
export const TOWN_SOCIAL_SPOT_IDS = ['market-green', 'market-steps', 'west-garden', 'garden-path', 'east-commons', 'east-fountain',
  'north-bridge', 'south-bridge', 'river-bend', 'north-crossroads', 'old-oak', 'south-row'] as const;

/** One stable meeting-place id. */
export type TownSocialSpotId = typeof TOWN_SOCIAL_SPOT_IDS[number];

/** A named passable Town tile tied to a real map feature (lawn, bridge, bank, tree, or road corner). */
export interface TownSocialSpot { id: TownSocialSpotId; label: string; tx: number; ty: number }

/** Legacy fixed travel windows. Live routes now use TownRoutePlanSystem; tests still read this table. */
export interface ResidentDayTiming { workStart: number; depart: number; arrive: number; meeting: number; leave: number; home: number }

/** Midnight in the game's minutes-since-06:00 clock; no resident schedule may return later. */
export const RESIDENT_HOME_DEADLINE = 18 * 60;

/**
 * Twelve dispersed places, each placed on a real feature of the painted Town (TownArt).
 * Each day uses six of them, so twelve residents never collect in one plaza.
 * The ids are saved (social events name their place), so they never change; the tiles and labels moved
 * with the painted Town (save version 27), so some ids no longer match their label. Each tile has open
 * ground on both sides for the meeting pair and at least 14 open tiles within two steps (townSpotStandingTiles).
 */
export const TOWN_SOCIAL_SPOTS: readonly TownSocialSpot[] = [
  { id: 'market-green', label: 'Fountain Plaza', tx: 24, ty: 34 },
  { id: 'market-steps', label: 'General Market Steps', tx: 16, ty: 32 },
  { id: 'west-garden', label: 'Lodge Steps', tx: 41, ty: 11 },
  // why: the redrawn Town (save version 29) puts hedges and lamp posts around 18,52, leaving 12 standing tiles;
  // 21,53 is the cobble plaza at the foot of The Wayfarer's steps, with 16.
  { id: 'garden-path', label: 'Garden Path by The Wayfarer', tx: 21, ty: 53 },
  { id: 'east-commons', label: 'East Meadow', tx: 72, ty: 58 },
  { id: 'east-fountain', label: 'East Riverbank', tx: 61, ty: 58 },
  { id: 'north-bridge', label: 'Hilltop Shrine', tx: 73, ty: 9 },
  // why: the redrawn south bridge deck is three tiles wide (x 28-30) with its east rail on tile 31, so 30,58 had
  // no open tile on its east side (save version 29); 29,58 is the middle of the deck.
  { id: 'south-bridge', label: 'South Bridge', tx: 29, ty: 58 },
  { id: 'river-bend', label: 'Ranch Lawn', tx: 68, ty: 41 },
  { id: 'north-crossroads', label: 'Museum Steps', tx: 44, ty: 33 },
  { id: 'old-oak', label: 'Old Oak by the Notice Board', tx: 35, ty: 21 },
  // why: 44,71 lost two standing tiles when the sign post and hedge west of the alchemy shop became walls
  // (save version 28); 42,71 sits on the same road in front of the shop doors with 16 open tiles.
  { id: 'south-row', label: 'South Row', tx: 42, ty: 71 },
] as const;

/** Resolve weekday or weekend travel hours for one of six daily meetings. */
export function residentDayTiming(day: number, meetingIndex: number): ResidentDayTiming {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town schedules: invalid day ${day}`);
  if (!Number.isSafeInteger(meetingIndex) || meetingIndex < 0 || meetingIndex >= TOWN_SOCIAL_SPOTS.length) {
    throw new Error(`Town schedules: invalid meeting index ${meetingIndex}`);
  }
  const weekend = (day - 1) % 7 >= 5;
  return weekend
    ? { workStart: 0, depart: 180, arrive: 240, meeting: 280 + meetingIndex * 8, leave: 600, home: 660 }
    : { workStart: 120, depart: 480, arrive: 540, meeting: 565 + meetingIndex * 8, leave: 660, home: 720 };
}

/** Resolve any canonical pair in the complete resident graph. */
export function townSocialPair(bondId: string): ResidentBondProfile {
  const pair = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
  if (!pair) throw new Error(`Town schedules: unknown social bond ${bondId}`);
  return pair;
}

/** Resolve any two distinct known residents into their canonical pair. */
export function townSocialPairForResidents(first: string, second: string): ResidentBondProfile {
  const ids = TOWN_RESIDENTS.map(resident => resident.id);
  if (!ids.includes(first as ResidentId)) throw new Error(`Town schedules: unknown resident ${first}`);
  if (!ids.includes(second as ResidentId)) throw new Error(`Town schedules: unknown resident ${second}`);
  return townSocialPair(residentBondId(first as ResidentId, second as ResidentId));
}

/** Fail before schedules or model prompts use incomplete social content. */
export function validateTownSchedules(): void {
  // Each day needs one place per pair; a larger pool lets the day spread out across Town.
  if (TOWN_SOCIAL_SPOTS.length < TOWN_RESIDENTS.length / 2 || TOWN_SOCIAL_SPOTS.length !== TOWN_SOCIAL_SPOT_IDS.length
    || TOWN_SOCIAL_SPOTS.some((spot, index) => spot.id !== TOWN_SOCIAL_SPOT_IDS[index])
    || new Set(TOWN_SOCIAL_SPOTS.map(spot => spot.id)).size !== TOWN_SOCIAL_SPOTS.length) {
    throw new Error('Town schedules: social spots must match the stable id list exactly once each');
  }
  for (const day of [1, 6]) for (let meetingIndex = 0; meetingIndex < TOWN_SOCIAL_SPOTS.length; meetingIndex++) {
    const timing = residentDayTiming(day, meetingIndex);
    if (!(timing.workStart <= timing.depart && timing.depart < timing.arrive && timing.arrive <= timing.meeting
      && timing.meeting < timing.leave && timing.leave < timing.home && timing.home <= RESIDENT_HOME_DEADLINE)) {
      throw new Error(`Town schedules: invalid timing order for day ${day}, meeting ${meetingIndex}`);
    }
  }
}
