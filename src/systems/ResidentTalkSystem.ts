/**
 * ResidentTalkSystem — picks what a resident says when the keeper chooses Talk (no local model).
 *
 * Before this, Talk only cycled the friendship-tier lines in ResidentRelationships. Now one line is
 * chosen from a pool that knows the resident and the day:
 *  - today's topic opener (the same topic the resident brings up with neighbors, see
 *    residentTopicForDay), always used on the first Talk of the day;
 *  - character-sheet lines for the time of day, rain, weekends, and the season;
 *  - the friendship-tier line (so relationship progress still shows);
 *  - town gossip the resident has heard (TownLifeSystem.gossipLine).
 *
 * This module only reads state. ResidentDialogueSystem applies Talk effects (friendship, favors,
 * invites) and joins the lines.
 */
import { seasonForDay } from '../config/Crops';
import { residentCharacterSheet, residentTopicForDay } from '../config/ResidentCharacterSheets';
import type { ResidentId } from '../config/ResidentRelationships';
import { TownLifeSystem } from './TownLifeSystem';
import { TOWN_ROUTE_WEEKDAYS } from './TownRoutePlanSystem';
import { WeatherSystem } from './WeatherSystem';

/** Clock minute (since 06:00) when morning lines stop: noon. */
const AFTERNOON_STARTS = 360;
/** Clock minute when afternoon lines stop: 6 pm. */
const EVENING_STARTS = 720;

/** Inputs for one Talk line. */
export interface ResidentTalkInput {
  id: ResidentId;
  day: number;
  /** Minutes since 06:00 (may be fractional). */
  timeOfDay: number;
  /** The friendship-tier line talkToResident returned. */
  tierLine: string;
  /** Talks with this resident before this one (rotates the pool so repeat talks vary). */
  conversationIndex: number;
  /** True when this is the first Talk with this resident today. */
  firstTalkToday: boolean;
}

/** The chosen line and whether it is gossip (gossip already names a neighbor, so no extra mention). */
export interface ResidentTalkLine {
  line: string;
  gossip: boolean;
}

/**
 * Every line the resident could say right now, in a fixed order.
 * @param input Talk inputs
 * @returns the pool; the first entry is always today's topic opener
 */
export function residentTalkPool(input: ResidentTalkInput): { lines: string[]; gossip: string | null } {
  const { id, day, timeOfDay } = input;
  // why: the game clock advances in fractional minutes, so only finiteness and range are checked.
  if (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay > 1440) {
    throw new Error(`Resident talk: invalid clock minute ${timeOfDay}`);
  }
  const sheet = residentCharacterSheet(id), talk = sheet.talk;
  const bucket = timeOfDay < AFTERNOON_STARTS ? talk.morning : timeOfDay < EVENING_STARTS ? talk.afternoon : talk.evening;
  const weekday = TOWN_ROUTE_WEEKDAYS[(day - 1) % TOWN_ROUTE_WEEKDAYS.length];
  const lines = [residentTopicForDay(id, day).lines[0], ...bucket];
  if (WeatherSystem.forDay(day) === 'rain') lines.push(...talk.rain);
  if (weekday === 'Saturday' || weekday === 'Sunday') lines.push(...talk.weekend);
  lines.push(...talk[seasonForDay(day)], input.tierLine);
  return { lines, gossip: TownLifeSystem.gossipLine(id) };
}

/**
 * Choose one Talk line. The first Talk of the day opens with today's topic, so what the keeper hears
 * matches what the resident tells neighbors. Later Talks rotate through the pool, with gossip in it.
 * @param input Talk inputs
 */
export function residentTalkLine(input: ResidentTalkInput): ResidentTalkLine {
  if (!Number.isSafeInteger(input.conversationIndex) || input.conversationIndex < 0) {
    throw new Error(`Resident talk: invalid conversation index ${input.conversationIndex}`);
  }
  const pool = residentTalkPool(input);
  if (input.firstTalkToday) return { line: pool.lines[0], gossip: false };
  const choices = pool.gossip === null ? pool.lines : [...pool.lines, pool.gossip];
  const index = input.conversationIndex % choices.length;
  return { line: choices[index], gossip: pool.gossip !== null && index === choices.length - 1 };
}
