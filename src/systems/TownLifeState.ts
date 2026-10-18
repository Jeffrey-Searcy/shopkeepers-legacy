/**
 * TownLifeState — the saved record of town news, the open favor, the open invite, and today's
 * chat friendship gains (save version 19+).
 *
 * This module is pure data: create, copy, migrate, and validate. TownLifeSystem owns every rule that
 * changes the record. Keeping the two apart lets GameState validate saves without importing the
 * runtime systems (which import GameState).
 *
 * Data shapes:
 *  - news: what residents know. Each item lists who knows it; meetings spread it.
 *  - favor: at most one open request from a resident (ids from config/ResidentFavors.ts).
 *  - invite: at most one meeting the keeper agreed to, on a later day at a fixed Town tile.
 *  - chatGain: friendship already granted today by local chat, per resident, for the daily cap.
 *
 * A damaged record fails loudly. Nothing is defaulted or repaired.
 */
import { residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { residentTopic } from '../config/ResidentCharacterSheets';
import { FAVOR_DAYS, residentFavor } from '../config/ResidentFavors';

/** Kinds of news residents pass along. */
export const TOWN_NEWS_KINDS = ['topic', 'became-partners', 'opened-relationship', 'betrayal-discovered',
  'favor-done', 'invite-kept'] as const;
export type TownNewsKind = typeof TOWN_NEWS_KINDS[number];

/** Most news items kept at once. The oldest are dropped first. */
export const MAX_TOWN_NEWS = 40;
/** Most friendship points local chat can add per resident per day. */
export const CHAT_GAIN_DAILY_CAP = 15;
/** Longest invite place label. */
const MAX_INVITE_LABEL = 60;

/** One piece of town news. */
export interface TownNewsItem {
  /** Stable id, e.g. "topic:4:rowan" or "became-partners:4:bram-rowan". */
  id: string;
  /** Day the news happened. */
  day: number;
  kind: TownNewsKind;
  /** One or two residents the news is about. */
  subjects: ResidentId[];
  /**
   * Kind-specific detail: the topic id for 'topic', the favor id for 'favor-done', the place label
   * for 'invite-kept', and null for relationship news.
   */
  detail: string | null;
  /** Residents who know this news. Never empty. */
  knownBy: ResidentId[];
}

/** The one open favor. Item, count, gold, and speech come from the favor config. */
export interface TownFavorState {
  favorId: string;
  postedDay: number;
  /** Last day the favor can be finished (postedDay + FAVOR_DAYS - 1). */
  dueDay: number;
}

/** The one invite the keeper accepted: meet `residentId` near tile (tx, ty) on `day`. */
export interface TownInviteState {
  residentId: ResidentId;
  /** Day the invite was made. The meeting is the next day. */
  offeredDay: number;
  day: number;
  /** Place name shown to the keeper, e.g. "Fishing Bank". */
  label: string;
  tx: number;
  ty: number;
  /** Clock window (minutes since 06:00) the resident stands there. */
  startsAt: number;
  endsAt: number;
  /** True once the keeper showed up. */
  kept: boolean;
}

/** Friendship granted by local chat on `day`, per resident. */
export interface TownChatGainState {
  day: number;
  points: Partial<Record<ResidentId, number>>;
}

/** Complete saved town-life record. */
export interface TownLifeState {
  news: TownNewsItem[];
  favor: TownFavorState | null;
  /** Day the last favor was posted (0 = never). */
  lastFavorDay: number;
  favorsDone: number;
  invite: TownInviteState | null;
  /** Day the last invite was made (0 = never). */
  lastInviteDay: number;
  chatGain: TownChatGainState;
}

/**
 * A new game's record: no news, no favor, no invite.
 * @param day the game day the record starts on
 */
export function createTownLifeState(day: number): TownLifeState {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Town life: invalid start day ${day}`);
  return { news: [], favor: null, lastFavorDay: 0, favorsDone: 0, invite: null, lastInviteDay: 0, chatGain: { day, points: {} } };
}

/** Deep copy so snapshots and saves never share arrays with live state. */
export function cloneTownLifeState(state: TownLifeState): TownLifeState {
  return {
    news: state.news.map(item => ({ ...item, subjects: [...item.subjects], knownBy: [...item.knownBy] })),
    favor: state.favor ? { ...state.favor } : null,
    lastFavorDay: state.lastFavorDay,
    favorsDone: state.favorsDone,
    invite: state.invite ? { ...state.invite } : null,
    lastInviteDay: state.lastInviteDay,
    chatGain: { day: state.chatGain.day, points: { ...state.chatGain.points } },
  };
}

/**
 * Build the record for a version-18-or-older save. Town news starts empty; nothing older is known.
 * @param day the save's current day
 */
export function migrateTownLifeFromV18(day: number): TownLifeState {
  return createTownLifeState(day);
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

/** Require a non-empty list of distinct residents with at most `max` entries. */
function residentList(value: unknown, label: string, max: number): ResidentId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error(`GameState save: "${label}" has an invalid size`);
  const ids = value.map((entry, index) => residentField(entry, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new Error(`GameState save: "${label}" repeats a resident`);
  return ids;
}

/**
 * Validate one news item's kind-specific detail.
 * @param kind news kind
 * @param subjects validated subjects
 * @param detail raw detail
 * @param label field path for errors
 */
function newsDetail(kind: TownNewsKind, subjects: readonly ResidentId[], detail: unknown, label: string): string | null {
  const relationshipNews = kind === 'became-partners' || kind === 'opened-relationship' || kind === 'betrayal-discovered';
  if (relationshipNews) {
    if (subjects.length !== 2 || detail !== null) throw new Error(`GameState save: "${label}" must name a pair and no detail`);
    return null;
  }
  if (subjects.length !== 1 || typeof detail !== 'string') throw new Error(`GameState save: "${label}" must name one resident and a detail`);
  if (kind === 'topic') return residentTopic(subjects[0], detail).id;
  if (kind === 'favor-done') {
    if (residentFavor(detail).residentId !== subjects[0]) throw new Error(`GameState save: "${label}" favor belongs to someone else`);
    return detail;
  }
  if (!detail.trim() || detail.length > MAX_INVITE_LABEL || /[{}\[\]\r\n]/.test(detail)) {
    throw new Error(`GameState save: "${label}" place is invalid`);
  }
  return detail;
}

/**
 * Validate and detach a saved town-life record.
 * @param value raw saved `townLife`
 * @param day the save's current day (no record may point past it, except tomorrow's invite)
 * @throws when any field is missing, extra, or out of range
 */
export function validateTownLifeState(value: unknown, day: number): TownLifeState {
  const data = exactObject(value, 'townLife', ['news', 'favor', 'lastFavorDay', 'favorsDone', 'invite', 'lastInviteDay', 'chatGain']);
  if (!Array.isArray(data.news) || data.news.length > MAX_TOWN_NEWS) throw new Error('GameState save: "townLife.news" has an invalid size');
  const news = data.news.map((raw, index): TownNewsItem => {
    const label = `townLife.news[${index}]`;
    const item = exactObject(raw, label, ['id', 'day', 'kind', 'subjects', 'detail', 'knownBy']);
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80) throw new Error(`GameState save: "${label}.id" is invalid`);
    if (!TOWN_NEWS_KINDS.includes(item.kind as TownNewsKind)) throw new Error(`GameState save: "${label}.kind" is invalid`);
    const kind = item.kind as TownNewsKind, subjects = residentList(item.subjects, `${label}.subjects`, 2);
    return { id: item.id, day: intField(item.day, `${label}.day`, 1, day), kind, subjects,
      detail: newsDetail(kind, subjects, item.detail, label), knownBy: residentList(item.knownBy, `${label}.knownBy`, 12) };
  });
  if (new Set(news.map(item => item.id)).size !== news.length) throw new Error('GameState save: "townLife.news" repeats an id');
  let favor: TownFavorState | null = null;
  if (data.favor !== null) {
    const raw = exactObject(data.favor, 'townLife.favor', ['favorId', 'postedDay', 'dueDay']);
    if (typeof raw.favorId !== 'string') throw new Error('GameState save: "townLife.favor.favorId" is invalid');
    const postedDay = intField(raw.postedDay, 'townLife.favor.postedDay', 1, day);
    favor = { favorId: residentFavor(raw.favorId).id, postedDay,
      dueDay: intField(raw.dueDay, 'townLife.favor.dueDay', postedDay + FAVOR_DAYS - 1, postedDay + FAVOR_DAYS - 1) };
  }
  let invite: TownInviteState | null = null;
  if (data.invite !== null) {
    const raw = exactObject(data.invite, 'townLife.invite',
      ['residentId', 'offeredDay', 'day', 'label', 'tx', 'ty', 'startsAt', 'endsAt', 'kept']);
    const offeredDay = intField(raw.offeredDay, 'townLife.invite.offeredDay', 1, day);
    const startsAt = intField(raw.startsAt, 'townLife.invite.startsAt', 0, 1439);
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > MAX_INVITE_LABEL || /[{}\[\]\r\n]/.test(raw.label)) {
      throw new Error('GameState save: "townLife.invite.label" is invalid');
    }
    if (typeof raw.kept !== 'boolean') throw new Error('GameState save: "townLife.invite.kept" must be true or false');
    invite = { residentId: residentField(raw.residentId, 'townLife.invite.residentId'), offeredDay,
      day: intField(raw.day, 'townLife.invite.day', offeredDay + 1, offeredDay + 1), label: raw.label,
      tx: intField(raw.tx, 'townLife.invite.tx', 0, 10_000), ty: intField(raw.ty, 'townLife.invite.ty', 0, 10_000),
      startsAt, endsAt: intField(raw.endsAt, 'townLife.invite.endsAt', startsAt + 1, 1440), kept: raw.kept };
  }
  const chat = exactObject(data.chatGain, 'townLife.chatGain', ['day', 'points']);
  const pointsRecord = chat.points;
  if (!pointsRecord || typeof pointsRecord !== 'object' || Array.isArray(pointsRecord)) {
    throw new Error('GameState save: "townLife.chatGain.points" must be an object');
  }
  const points: Partial<Record<ResidentId, number>> = {};
  for (const [id, amount] of Object.entries(pointsRecord as Record<string, unknown>)) {
    points[residentField(id, 'townLife.chatGain.points')] = intField(amount, `townLife.chatGain.points.${id}`, 1, CHAT_GAIN_DAILY_CAP);
  }
  return {
    news, favor,
    lastFavorDay: intField(data.lastFavorDay, 'townLife.lastFavorDay', 0, day),
    favorsDone: intField(data.favorsDone, 'townLife.favorsDone', 0, Number.MAX_SAFE_INTEGER),
    invite,
    lastInviteDay: intField(data.lastInviteDay, 'townLife.lastInviteDay', 0, day),
    chatGain: { day: intField(chat.day, 'townLife.chatGain.day', 1, day), points },
  };
}
