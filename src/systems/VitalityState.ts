/**
 * VitalityState — the saved record of the keeper's body: timed food buffs and mana (save version 22+).
 *
 * This module is pure data: create, copy, migrate, and validate. VitalitySystem owns every rule that
 * changes the record. Keeping them apart lets GameState import the record without importing the
 * runtime system (which imports GameState).
 *
 * Data shapes:
 *  - buffs: at most one entry per buff id. `until` is the absolute game minute when the buff ends,
 *    counted as (day - 1) * 1440 + timeOfDay. Sleeping jumps the clock to the next morning, so
 *    food buffs never carry past a night.
 *  - mana: null until a resident teaches the keeper to feel mana (Nyra, through chat). Then
 *    `current` and `max` are whole points and `practice` is meditation minutes toward the next
 *    max point (0 up to but not including MEDITATION_MINUTES_PER_POINT).
 *
 * A damaged record fails loudly. Nothing is defaulted or repaired.
 */
import { BUFF_IDS, MAX_BUFF_MINUTES, type BuffId } from '../config/Consumables';

/** Game minutes in one day. Matches TimeSystem.DAY_MINUTES (not imported: TimeSystem imports GameState). */
const DAY_MINUTES = 24 * 60;
/** Max mana right after the keeper is taught. */
export const MANA_START_MAX = 3;
/** Highest max mana meditation can reach. */
export const MANA_MAX_CAP = 30;
/** Meditation game minutes that raise max mana by one point (the playtester asked for about an hour). */
export const MEDITATION_MINUTES_PER_POINT = 60;

/** One running buff. */
export interface ActiveBuff {
  id: BuffId;
  /** Absolute game minute when the buff ends (see absoluteMinute). */
  until: number;
}

/** The keeper's mana once taught. */
export interface ManaState {
  current: number;
  max: number;
  /** Meditation minutes toward the next max point, in [0, MEDITATION_MINUTES_PER_POINT). */
  practice: number;
}

/** Complete saved vitality record. */
export interface VitalityState {
  buffs: ActiveBuff[];
  mana: ManaState | null;
}

/**
 * The absolute game minute for a day and clock time. It only grows, even across sleep.
 * @param day absolute game day (1-based)
 * @param timeOfDay minutes since 06:00 on that day
 */
export function absoluteMinute(day: number, timeOfDay: number): number {
  return (day - 1) * DAY_MINUTES + timeOfDay;
}

/** A new game's record: no buffs and no mana yet. */
export function createVitalityState(): VitalityState {
  return { buffs: [], mana: null };
}

/** Deep copy so snapshots and saves never share objects with live state. */
export function cloneVitalityState(state: VitalityState): VitalityState {
  return { buffs: state.buffs.map(buff => ({ ...buff })), mana: state.mana === null ? null : { ...state.mana } };
}

/** Build the record for a version-21-or-older save. The keeper had no buffs or mana before v22. */
export function migrateVitalityFromV21(): VitalityState {
  return createVitalityState();
}

/** Require a plain object with exactly the named keys. */
function exactObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`GameState save: "${label}" must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`GameState save: "${label}" must have exactly ${[...keys].sort().join(', ')}`);
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

/**
 * Validate and detach a saved vitality record.
 * @param value raw saved `vitality`
 * @param day the save's current day
 * @param timeOfDay the save's clock, minutes since 06:00
 * @throws when any field is missing, extra, repeated, or out of range
 */
export function validateVitalityState(value: unknown, day: number, timeOfDay: number): VitalityState {
  const data = exactObject(value, 'vitality', ['buffs', 'mana']);
  if (!Array.isArray(data.buffs) || data.buffs.length > BUFF_IDS.length) throw new Error('GameState save: "vitality.buffs" has an invalid size');
  // why: a buff can end at most MAX_BUFF_MINUTES after the latest moment it could have started (now).
  const latest = Math.ceil(absoluteMinute(day, timeOfDay)) + MAX_BUFF_MINUTES;
  const buffs = data.buffs.map((raw, index): ActiveBuff => {
    const label = `vitality.buffs[${index}]`;
    const buff = exactObject(raw, label, ['id', 'until']);
    if (!BUFF_IDS.includes(buff.id as BuffId)) throw new Error(`GameState save: "${label}.id" is invalid`);
    return { id: buff.id as BuffId, until: intField(buff.until, `${label}.until`, 0, latest) };
  });
  if (new Set(buffs.map(buff => buff.id)).size !== buffs.length) throw new Error('GameState save: "vitality.buffs" repeats a buff');
  if (data.mana === null) return { buffs, mana: null };
  const mana = exactObject(data.mana, 'vitality.mana', ['current', 'max', 'practice']);
  const max = intField(mana.max, 'vitality.mana.max', MANA_START_MAX, MANA_MAX_CAP);
  const practice = mana.practice;
  if (typeof practice !== 'number' || !Number.isFinite(practice) || practice < 0 || practice >= MEDITATION_MINUTES_PER_POINT) {
    throw new Error('GameState save: "vitality.mana.practice" is invalid');
  }
  return { buffs, mana: { current: intField(mana.current, 'vitality.mana.current', 0, max), max, practice } };
}
