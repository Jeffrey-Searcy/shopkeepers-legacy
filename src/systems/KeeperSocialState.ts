/**
 * KeeperSocialState — the saved record of the keeper's own social life with residents (save version 20+).
 *
 * This module is pure data: create, copy, migrate, validate, and one read-only lookup that route planning
 * uses. KeeperSocialSystem owns every rule that changes the record. Keeping them apart lets GameState and
 * TownScheduleSystem read the record without importing the runtime systems (which import GameState).
 *
 * Data shapes:
 *  - plans: hangouts the keeper arranged with a resident for tomorrow. Each plan is a real route anchor:
 *    the resident walks to the place and waits for the whole window (see TownRoutePlanSystem).
 *  - party: up to two residents who travel with the keeper into the portal dungeon and the mines.
 *  - daily: social actions already used today ("action:target"), so rounds, cards, and compliments
 *    stay limited per day.
 *
 * A damaged record fails loudly. Nothing is defaulted or repaired.
 */
import { residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { TOWN_SOCIAL_SPOT_IDS } from '../config/TownSchedules';
import type { TownRouteDestinationId } from '../config/TownRouteTemplates';
import type { TownRoutePlayerPlan } from './TownRoutePlanSystem';

/** Places a keeper plan may use: every named outdoor spot, the fishing bank, and The Wayfarer. */
export const KEEPER_PLAN_DESTINATIONS: readonly TownRouteDestinationId[] = ['bar', 'fishing-bank', ...TOWN_SOCIAL_SPOT_IDS];
/** Most open plans at once, across all residents. */
export const MAX_KEEPER_PLANS = 4;
/** Most residents in the keeper's adventuring party. */
export const MAX_PARTY_SIZE = 2;
/** Daily social actions the record can hold. */
export const KEEPER_SOCIAL_ACTIONS = ['round-buy', 'round-get', 'befriend', 'flirt', 'cards'] as const;
export type KeeperSocialAction = typeof KEEPER_SOCIAL_ACTIONS[number];
/** Most daily entries kept (12 residents x 5 actions, plus table entries). */
const MAX_DAILY_ENTRIES = 80;
/** Longest plan label. */
const MAX_PLAN_LABEL = 60;

/** One hangout the keeper arranged. The resident's route for `day` includes it as a fixed stop. */
export interface KeeperPlanState {
  /** Stable id "plan:<madeDay>:<residentId>". It is also part of the route cache key. */
  id: string;
  residentId: ResidentId;
  madeDay: number;
  /** Always madeDay + 1. */
  day: number;
  destination: TownRouteDestinationId;
  /** Place name shown to the keeper, e.g. "Old Oak". */
  label: string;
  /** Tile where the resident waits (Town tiles; for The Wayfarer this is its doorway). */
  tx: number;
  ty: number;
  /** Clock window, in minutes since 06:00. */
  startsAt: number;
  endsAt: number;
  /** True once the keeper showed up. */
  kept: boolean;
}

/** One plan the keeper may pick. Times and tile come from tomorrow's real route with the plan in it. */
export interface KeeperPlanOption {
  destination: TownRouteDestinationId;
  label: string;
  tx: number;
  ty: number;
  startsAt: number;
  endsAt: number;
}

/** Social actions already used on `day`. Each entry is "action:target"; target is a resident id or "table". */
export interface KeeperDailyState {
  day: number;
  done: string[];
}

/** Complete saved keeper-social record. */
export interface KeeperSocialState {
  plans: KeeperPlanState[];
  party: ResidentId[];
  daily: KeeperDailyState;
}

/**
 * A new game's record: no plans, no party.
 * @param day the game day the record starts on
 */
export function createKeeperSocialState(day: number): KeeperSocialState {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Keeper social: invalid start day ${day}`);
  return { plans: [], party: [], daily: { day, done: [] } };
}

/** Deep copy so snapshots and saves never share arrays with live state. */
export function cloneKeeperSocialState(state: KeeperSocialState): KeeperSocialState {
  return { plans: state.plans.map(plan => ({ ...plan })), party: [...state.party],
    daily: { day: state.daily.day, done: [...state.daily.done] } };
}

/**
 * Build the record for a version-19-or-older save. The keeper had no plans or party before v20.
 * @param day the save's current day
 */
export function migrateKeeperSocialFromV19(day: number): KeeperSocialState {
  return createKeeperSocialState(day);
}

/**
 * The route anchor for one resident's day, or null when the keeper made no plan with them.
 * TownScheduleSystem calls this while building routes, so it must stay pure.
 * @param state the live record
 * @param residentId resident whose route is being built
 * @param day absolute game day of the route
 */
export function keeperRoutePlanFor(state: KeeperSocialState, residentId: ResidentId, day: number): TownRoutePlayerPlan | null {
  const plan = state.plans.find(candidate => candidate.residentId === residentId && candidate.day === day);
  return plan ? { id: plan.id, destination: plan.destination, label: plan.label, startsAt: plan.startsAt, endsAt: plan.endsAt } : null;
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

/** Require a known resident id. */
function residentField(value: unknown, label: string): ResidentId {
  if (typeof value !== 'string') throw new Error(`GameState save: "${label}" is not a resident`);
  return residentRelationshipProfile(value as ResidentId).id;
}

/**
 * Check one "action:target" daily entry.
 * @param value raw entry
 * @param label field path for errors
 */
function dailyEntry(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`GameState save: "${label}" is invalid`);
  const [action, target, extra] = value.split(':');
  if (extra !== undefined || !KEEPER_SOCIAL_ACTIONS.includes(action as KeeperSocialAction)) {
    throw new Error(`GameState save: "${label}" is invalid`);
  }
  if (target !== 'table') residentField(target, label);
  return value;
}

/**
 * Validate and detach a saved keeper-social record.
 * @param value raw saved `social`
 * @param day the save's current day (plans may point at most one day ahead)
 * @throws when any field is missing, extra, or out of range
 */
export function validateKeeperSocialState(value: unknown, day: number): KeeperSocialState {
  const data = exactObject(value, 'social', ['plans', 'party', 'daily']);
  if (!Array.isArray(data.plans) || data.plans.length > MAX_KEEPER_PLANS) throw new Error('GameState save: "social.plans" has an invalid size');
  const plans = data.plans.map((raw, index): KeeperPlanState => {
    const label = `social.plans[${index}]`;
    const plan = exactObject(raw, label, ['id', 'residentId', 'madeDay', 'day', 'destination', 'label', 'tx', 'ty', 'startsAt', 'endsAt', 'kept']);
    const residentId = residentField(plan.residentId, `${label}.residentId`);
    const madeDay = intField(plan.madeDay, `${label}.madeDay`, 1, day);
    const planDay = intField(plan.day, `${label}.day`, madeDay + 1, madeDay + 1);
    if (plan.id !== `plan:${madeDay}:${residentId}`) throw new Error(`GameState save: "${label}.id" is invalid`);
    if (!KEEPER_PLAN_DESTINATIONS.includes(plan.destination as TownRouteDestinationId)) {
      throw new Error(`GameState save: "${label}.destination" is invalid`);
    }
    if (typeof plan.label !== 'string' || !plan.label.trim() || plan.label.length > MAX_PLAN_LABEL || /[{}\[\]\r\n]/.test(plan.label)) {
      throw new Error(`GameState save: "${label}.label" is invalid`);
    }
    if (typeof plan.kept !== 'boolean') throw new Error(`GameState save: "${label}.kept" must be true or false`);
    const startsAt = intField(plan.startsAt, `${label}.startsAt`, 0, 1439);
    return { id: plan.id, residentId, madeDay, day: planDay, destination: plan.destination as TownRouteDestinationId,
      label: plan.label, tx: intField(plan.tx, `${label}.tx`, 0, 10_000), ty: intField(plan.ty, `${label}.ty`, 0, 10_000),
      startsAt, endsAt: intField(plan.endsAt, `${label}.endsAt`, startsAt + 1, 1440), kept: plan.kept };
  });
  if (new Set(plans.map(plan => plan.id)).size !== plans.length
    || new Set(plans.map(plan => `${plan.residentId}:${plan.day}`)).size !== plans.length) {
    throw new Error('GameState save: "social.plans" repeats a resident day');
  }
  if (!Array.isArray(data.party) || data.party.length > MAX_PARTY_SIZE) throw new Error('GameState save: "social.party" has an invalid size');
  const party = data.party.map((entry, index) => residentField(entry, `social.party[${index}]`));
  if (new Set(party).size !== party.length) throw new Error('GameState save: "social.party" repeats a resident');
  const daily = exactObject(data.daily, 'social.daily', ['day', 'done']);
  if (!Array.isArray(daily.done) || daily.done.length > MAX_DAILY_ENTRIES) throw new Error('GameState save: "social.daily.done" has an invalid size');
  const done = daily.done.map((entry, index) => dailyEntry(entry, `social.daily.done[${index}]`));
  if (new Set(done).size !== done.length) throw new Error('GameState save: "social.daily.done" repeats an entry');
  return { plans, party, daily: { day: intField(daily.day, 'social.daily.day', 1, day), done } };
}
