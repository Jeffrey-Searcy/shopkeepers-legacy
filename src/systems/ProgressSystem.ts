/**
 * ProgressSystem — the durable "first week" progress that is not owned by any other system.
 *
 * It records facts that cannot be worked out from other state: whether Mayor Hollis has already
 * walked the new keeper to the shop, the forge and alchemy upgrade levels, portal-dungeon records,
 * Seren's guild-board request, and which daily forage spots were already picked today.
 *
 * Things that CAN be worked out from other state stay derived and are never stored here:
 *  - first-day task steps (tavern level, met residents, total sales);
 *  - unlocked recipes (letters already read that enclose a recipe).
 *
 * Saves: version 18 adds this record. migrateProgressFromV17 builds it for older saves.
 * validateProgressState rejects any missing, extra or out-of-range field (a damaged save must fail
 * loudly, never be patched with defaults).
 */
import { guildRequestForDay } from '../config/GuildRequests';

/** Highest forge upgrade. Each level adds +1 sword damage (see DungeonScene). */
export const FORGE_MAX_LEVEL = 2;
/** Highest alchemy upgrade. Each level is one Vital Draught (+2 max HP, applied once on purchase). */
export const ALCHEMY_MAX_LEVEL = 2;
/**
 * Floor depths in the first portal dungeon below the Warden's pit: the fountain hall is floor 1 and the
 * side rooms count up to 3 (DungeonScene). The pit is DUNGEON_FLOORS + 1.
 */
export const DUNGEON_FLOORS = 3;

/** Seren's current guild-board request (ids come from config/GuildRequests.ts). */
export interface BoardRequest {
  /** Request id from GUILD_REQUESTS. */
  id: string;
  /** Day the request appeared on the board. */
  postedDay: number;
  /** Last day the request can be turned in (posted day + 1, a two-day job). */
  dueDay: number;
}

/** Guild-board record: at most one open request, plus history counters. */
export interface BoardState {
  active: BoardRequest | null;
  /** Day the board last posted a request (0 = never). Stops a second post on the same day. */
  lastPostedDay: number;
  /** Requests turned in over the whole game. Also picks the next request in the pool. */
  completed: number;
}

/** Portal-dungeon records. Runs are not saved mid-dungeon, so only finished facts live here. */
export interface DungeonRecord {
  /** Deepest floor reached (0 = never entered, DUNGEON_FLOORS + 1 = the boss room). */
  deepestFloor: number;
  bossBeaten: boolean;
  /** Runs started through the gate. */
  runs: number;
}

/** Daily forage: spot keys ("scene:tx,ty") picked on `day`. A new day empties the list. */
export interface ForageState {
  day: number;
  taken: string[];
}

/** Complete durable progress record (save version 18+). */
export interface ProgressState {
  /** True once Mayor Hollis has finished the day-1 walk to the shop. */
  mayorMet: boolean;
  forgeLevel: number;
  alchemyLevel: number;
  dungeon: DungeonRecord;
  board: BoardState;
  forage: ForageState;
}

/**
 * A brand-new game's progress: the mayor is still on his way and today's guild job is already
 * pinned (so the first look at the board is a pure read).
 * @param day the game day the record starts on
 */
export function createProgressState(day = 1): ProgressState {
  const request = guildRequestForDay(day);
  return {
    mayorMet: false,
    forgeLevel: 0,
    alchemyLevel: 0,
    dungeon: { deepestFloor: 0, bossBeaten: false, runs: 0 },
    board: { active: { id: request.id, postedDay: day, dueDay: day + 1 }, lastPostedDay: day, completed: 0 },
    forage: { day, taken: [] },
  };
}

/** Deep copy so snapshots and saves never share arrays with live state. */
export function cloneProgressState(state: ProgressState): ProgressState {
  return {
    mayorMet: state.mayorMet,
    forgeLevel: state.forgeLevel,
    alchemyLevel: state.alchemyLevel,
    dungeon: { ...state.dungeon },
    board: { active: state.board.active ? { ...state.board.active } : null, lastPostedDay: state.board.lastPostedDay, completed: state.board.completed },
    forage: { day: state.forage.day, taken: state.forage.taken.slice() },
  };
}

/**
 * Build progress for a version-17-or-older save. The mayor only walks on day 1, so a later save
 * counts him as met. Everything else starts empty, except today's guild job, which is pinned.
 * @param day the save's current day
 */
export function migrateProgressFromV17(day: number): ProgressState {
  const state = createProgressState(day);
  state.mayorMet = day > 1;
  return state;
}

/** Require a plain object with exactly the named keys. */
function exactObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`GameState save: "${label}" must be an object`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`GameState save: "${label}" must have exactly ${expected.join(', ')}`);
  }
  return record;
}

/** Require a safe integer in [min, max]. */
function intField(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`GameState save: "${label}" is invalid`);
  }
  return value;
}

/** Require a boolean. */
function boolField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`GameState save: "${label}" must be true or false`);
  return value;
}

/**
 * Validate and detach a saved progress record.
 * @param value raw saved `progress`
 * @param day the save's current day (no record may point to a future day)
 * @param knownRequest returns true for request ids that exist in the guild pool
 * @throws when any field is missing, extra, or out of range
 */
export function validateProgressState(value: unknown, day: number, knownRequest: (id: string) => boolean): ProgressState {
  const data = exactObject(value, 'progress', ['mayorMet', 'forgeLevel', 'alchemyLevel', 'dungeon', 'board', 'forage']);
  const dungeon = exactObject(data.dungeon, 'progress.dungeon', ['deepestFloor', 'bossBeaten', 'runs']);
  const board = exactObject(data.board, 'progress.board', ['active', 'lastPostedDay', 'completed']);
  const forage = exactObject(data.forage, 'progress.forage', ['day', 'taken']);
  let active: BoardRequest | null = null;
  if (board.active !== null) {
    const request = exactObject(board.active, 'progress.board.active', ['id', 'postedDay', 'dueDay']);
    if (typeof request.id !== 'string' || !knownRequest(request.id)) throw new Error('GameState save: "progress.board.active.id" is not a guild request');
    const postedDay = intField(request.postedDay, 'progress.board.active.postedDay', 1, day);
    active = { id: request.id, postedDay, dueDay: intField(request.dueDay, 'progress.board.active.dueDay', postedDay, Number.MAX_SAFE_INTEGER) };
  }
  if (!Array.isArray(forage.taken) || forage.taken.some(key => typeof key !== 'string' || !/^[A-Za-z]+Scene:\d+,\d+$/.test(key))) {
    throw new Error('GameState save: "progress.forage.taken" must list scene:tx,ty keys');
  }
  if (new Set(forage.taken).size !== forage.taken.length) throw new Error('GameState save: "progress.forage.taken" repeats a spot');
  const runs = intField(dungeon.runs, 'progress.dungeon.runs', 0, Number.MAX_SAFE_INTEGER);
  const deepestFloor = intField(dungeon.deepestFloor, 'progress.dungeon.deepestFloor', 0, DUNGEON_FLOORS + 1);
  const bossBeaten = boolField(dungeon.bossBeaten, 'progress.dungeon.bossBeaten');
  if (deepestFloor > 0 && runs === 0) throw new Error('GameState save: "progress.dungeon" reached a floor without a run');
  if (bossBeaten && deepestFloor !== DUNGEON_FLOORS + 1) throw new Error('GameState save: "progress.dungeon" beat the boss without reaching it');
  return {
    mayorMet: boolField(data.mayorMet, 'progress.mayorMet'),
    forgeLevel: intField(data.forgeLevel, 'progress.forgeLevel', 0, FORGE_MAX_LEVEL),
    alchemyLevel: intField(data.alchemyLevel, 'progress.alchemyLevel', 0, ALCHEMY_MAX_LEVEL),
    dungeon: { deepestFloor, bossBeaten, runs },
    board: {
      active,
      lastPostedDay: intField(board.lastPostedDay, 'progress.board.lastPostedDay', 0, day),
      completed: intField(board.completed, 'progress.board.completed', 0, Number.MAX_SAFE_INTEGER),
    },
    forage: { day: intField(forage.day, 'progress.forage.day', 1, day), taken: (forage.taken as string[]).slice() },
  };
}
