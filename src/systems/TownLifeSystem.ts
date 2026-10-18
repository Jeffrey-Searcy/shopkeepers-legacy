/**
 * TownLifeSystem — the rules that make neighbors remember, gossip, ask for help, and invite the keeper.
 *
 * It owns every change to GameState.townLife (the pure record lives in TownLifeState.ts):
 *  - News: each resident meeting first shares what both residents know, then adds the opener's topic
 *    of the day and any public relationship outcome. Talk and the local model read it back as gossip.
 *  - Favors: at most one open request. refreshDay() expires old ones and posts new ones each morning.
 *  - Invites: a resident with 3+ hearts may ask the keeper to meet at one of tomorrow's outdoor stops.
 *    TownScene checks the keeper and the resident are both there during the window.
 *  - Chat friendship: each good local-chat reply adds a little friendship, capped per resident per day.
 *
 * The game decides every outcome here. The local model only writes words.
 */
import { CHARACTER_SHEET_IDS, residentCharacterSheet, residentTopic, residentTopicForDay } from '../config/ResidentCharacterSheets';
import { FAVOR_DAYS, FAVOR_FRIENDSHIP, residentFavor, residentFavors, type ResidentFavor } from '../config/ResidentFavors';
import { ITEM_CATALOG } from '../config/Items';
import type { ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';
import { InventorySystem } from './InventorySystem';
import { grantResidentFriendship, pointsToHearts, type ResidentMeetingEffect } from './RelationshipSystem';
import { townRouteDestinationBuilding } from './TownRoutePlanSystem';
import { residentRoutePlanForDay } from './TownScheduleSystem';
import { CHAT_GAIN_DAILY_CAP, MAX_TOWN_NEWS, type TownInviteState, type TownNewsItem } from './TownLifeState';
import { VitalitySystem } from './VitalitySystem';

/** Friendship added by one good local-chat reply. */
export const CHAT_GAIN_PER_REPLY = 5;
/** Friendship added when the keeper keeps an invite. */
export const INVITE_FRIENDSHIP = 40;
/** Hearts a resident needs before inviting the keeper. */
export const INVITE_MIN_HEARTS = 3;
/** Days between invites, counted from the day the last one was made. */
const INVITE_GAP_DAYS = 3;
/** Shortest outdoor stop worth inviting the keeper to, in game minutes. */
const INVITE_MIN_MINUTES = 20;
/** Minutes before and after the stop that still count as showing up. */
export const INVITE_GRACE_MINUTES = 30;
/** Tiles from the meeting spot that still count as being there. */
export const INVITE_RADIUS_TILES = 3;
/** Days topic news and bigger news stay in circulation. */
const TOPIC_NEWS_DAYS = 6;
const BIG_NEWS_DAYS = 14;

/** What Talk should say about an open favor. */
export type FavorTalkResult =
  | { kind: 'none' }
  | { kind: 'done'; line: string; gold: number; points: number }
  | { kind: 'waiting'; line: string };

/** The open favor as menus and markers read it. */
export interface OpenFavorView {
  favor: ResidentFavor;
  dueDay: number;
}

/** Display name for gossip and prompts. */
function nameOf(id: ResidentId): string {
  return residentCharacterSheet(id).name;
}

/**
 * Format minutes since 06:00 as a 12-hour clock, e.g. 390 -> "12:30 pm".
 * @param minutes minutes since 06:00 on one game day
 */
export function townClockLabel(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error(`Town life: invalid clock minute ${minutes}`);
  const total = (6 * 60 + minutes) % (24 * 60), hour = Math.floor(total / 60), minute = total % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * Drop old news, then keep only the newest MAX_TOWN_NEWS items.
 * @param news live news list (changed in place)
 * @param day today
 */
function pruneNews(news: TownNewsItem[], day: number): void {
  const kept = news.filter(item => item.day >= day - (item.kind === 'topic' ? TOPIC_NEWS_DAYS : BIG_NEWS_DAYS));
  kept.sort((a, b) => a.day - b.day);
  news.splice(0, news.length, ...kept.slice(-MAX_TOWN_NEWS));
}

/**
 * Add one news item, or widen who knows it when the id already exists.
 * @param item the news to add
 */
function addNews(item: TownNewsItem): void {
  const life = GameState.instance.townLife, existing = life.news.find(entry => entry.id === item.id);
  if (existing) {
    existing.knownBy = [...new Set([...existing.knownBy, ...item.knownBy])];
    return;
  }
  life.news.push(item);
  pruneNews(life.news, GameState.instance.day);
}

/**
 * Bring favors and invites up to today: expire anything past its day and post a new favor when due.
 * Runs each morning from sleep and before Talk reads the favor (which also covers debug day jumps).
 */
function refreshDay(): void {
  const gs = GameState.instance, life = gs.townLife;
  if (life.favor && life.favor.dueDay < gs.day) life.favor = null;
  if (life.invite && life.invite.day < gs.day) life.invite = null;
  if (life.chatGain.day !== gs.day) life.chatGain = { day: gs.day, points: {} };
  pruneNews(life.news, gs.day);
  // why: one quiet day between favors keeps the "!" marker special instead of constant.
  if (life.favor === null && gs.day > life.lastFavorDay + 1) {
    const residentId = CHARACTER_SHEET_IDS[(gs.day * 7 + life.favorsDone * 5) % CHARACTER_SHEET_IDS.length];
    const pool = residentFavors(residentId), favor = pool[(gs.day + life.favorsDone) % pool.length];
    life.favor = { favorId: favor.id, postedDay: gs.day, dueDay: gs.day + FAVOR_DAYS - 1 };
    life.lastFavorDay = gs.day;
  }
}

/** The open favor, or null. Does not change state. */
function openFavor(): OpenFavorView | null {
  const favor = GameState.instance.townLife.favor;
  return favor ? { favor: residentFavor(favor.favorId), dueDay: favor.dueDay } : null;
}

/**
 * Talk with a resident who may have an open favor. With the items in the bag, the keeper hands
 * them over and is paid; without them, the resident repeats the ask with what is still needed.
 * @param id the resident being talked to
 */
function talkAboutFavor(id: ResidentId): FavorTalkResult {
  refreshDay();
  const gs = GameState.instance, open = openFavor();
  if (!open || open.favor.residentId !== id) return { kind: 'none' };
  const { favor } = open, label = ITEM_CATALOG[favor.item].label;
  const nextGold = gs.gold + favor.gold;
  if (!Number.isSafeInteger(nextGold)) throw new Error(`Town life: gold overflow ${nextGold}`);
  if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [favor.item]: -favor.count })) {
    const due = open.dueDay === gs.day ? 'by tonight' : 'by tomorrow night';
    return { kind: 'waiting', line: `${favor.ask} (${favor.count} ${label} ${due}. You have ${InventorySystem.count(favor.item)}.)` };
  }
  gs.gold = nextGold;
  gs.townLife.favor = null;
  gs.townLife.favorsDone += 1;
  const points = grantResidentFriendship(id, FAVOR_FRIENDSHIP);
  addNews({ id: `favor-done:${gs.day}:${favor.id}`, day: gs.day, kind: 'favor-done', subjects: [id], detail: favor.id, knownBy: [id] });
  return { kind: 'done', line: `${favor.thanks} (+${favor.gold} gold)`, gold: favor.gold, points };
}

/**
 * Record what one finished resident meeting adds to town news. Call only when
 * recordResidentBondMeeting returned true, so a reload never records the same meeting twice.
 * @param effect the applied meeting effect
 * @param residents the meeting pair
 * @param opener the resident who started today's conversation (their topic becomes news)
 */
function recordMeetingNews(effect: ResidentMeetingEffect, residents: readonly [ResidentId, ResidentId], opener: ResidentId): void {
  if (!residents.includes(opener)) throw new Error(`Town life: opener ${opener} is not in meeting ${effect.bondId}`);
  const life = GameState.instance.townLife, [a, b] = residents;
  // why: share first, so the topic below is not counted as something the pair "passed on".
  for (const item of life.news) {
    if (item.knownBy.includes(a) || item.knownBy.includes(b)) item.knownBy = [...new Set([...item.knownBy, a, b])];
  }
  addNews({ id: `topic:${effect.day}:${opener}`, day: effect.day, kind: 'topic', subjects: [opener],
    detail: residentTopicForDay(opener, effect.day).id, knownBy: [a, b] });
  if (effect.outcome === 'became-partners' || effect.outcome === 'opened-relationship' || effect.outcome === 'betrayal-discovered') {
    addNews({ id: `${effect.outcome}:${effect.day}:${effect.bondId}`, day: effect.day, kind: effect.outcome,
      subjects: [a, b], detail: null, knownBy: [...new Set([a, b, ...effect.witnesses])] });
  }
}

/**
 * Plain sentence for one news item, written about its subjects.
 * @param item news item
 */
function newsSummary(item: TownNewsItem): string {
  const [first, second] = item.subjects;
  switch (item.kind) {
    case 'topic': return residentTopic(first, item.detail as string).summary;
    case 'became-partners': return `${nameOf(first)} and ${nameOf(second)} are a couple now`;
    case 'opened-relationship': return `${nameOf(first)} and ${nameOf(second)} talked it through and opened up their relationship`;
    case 'betrayal-discovered': return `someone caught ${nameOf(first)} and ${nameOf(second)} getting close, and a partner found out`;
    case 'favor-done': return `the shopkeeper helped ${nameOf(first)} with ${ITEM_CATALOG[residentFavor(item.detail as string).item].label.toLowerCase()}`;
    case 'invite-kept': return `${nameOf(first)} met the shopkeeper at ${item.detail as string}`;
  }
}

/**
 * The newest news a resident would pass on: known by them, not about them, from the last few days.
 * @param id the resident speaking
 * @returns one gossip sentence, or null when they know nothing new
 */
function gossipLine(id: ResidentId): string | null {
  const gs = GameState.instance;
  const known = gs.townLife.news.filter(item => item.knownBy.includes(id) && !item.subjects.includes(id));
  if (!known.length) return null;
  const item = known[known.length - 1], summary = newsSummary(item);
  const templates = ['Did you hear? {s}.', 'Word around town: {s}.', 'Between us, {s}.'];
  const sentence = templates[(gs.day + item.id.length) % templates.length].replace('{s}', summary);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Up to three short news sentences a meeting pair or a Wayfarer table could bring up, for the local model.
 * Keeper favors and invites stay out: the model should talk about the town, not the player.
 * @param residents the residents talking (news any of them knows counts)
 */
function newsContext(residents: readonly ResidentId[]): string[] {
  return GameState.instance.townLife.news
    .filter(item => item.kind !== 'favor-done' && item.kind !== 'invite-kept'
      && residents.some(id => item.knownBy.includes(id)))
    .slice(-3)
    .map(newsSummary);
}

/**
 * Add friendship for one good local-chat reply, up to the daily cap per resident. Cheer adds a small bonus.
 * @param id resident chatted with
 * @returns points actually applied (0 once the cap is reached)
 */
function grantChatFriendship(id: ResidentId): number {
  const gs = GameState.instance, life = gs.townLife;
  if (life.chatGain.day !== gs.day) life.chatGain = { day: gs.day, points: {} };
  const used = life.chatGain.points[id] ?? 0;
  // why: Cheer (from ale) adds a little per reply; the daily cap still holds.
  const amount = Math.min(CHAT_GAIN_PER_REPLY + VitalitySystem.chatFriendshipBonus(), CHAT_GAIN_DAILY_CAP - used);
  if (amount <= 0) return 0;
  life.chatGain.points[id] = used + amount;
  return grantResidentFriendship(id, amount);
}

/**
 * Maybe invite the keeper to meet tomorrow at one of the resident's outdoor stops.
 * @param id resident being talked to
 * @returns the invite line, or null when no invite is due
 */
function offerInvite(id: ResidentId): string | null {
  const gs = GameState.instance, life = gs.townLife;
  if (life.invite !== null || gs.day < life.lastInviteDay + INVITE_GAP_DAYS) return null;
  if (pointsToHearts(gs.relationships.residents[id].points) < INVITE_MIN_HEARTS) return null;
  const home = TOWN_RESIDENTS.find(resident => resident.id === id);
  if (!home) throw new Error(`Town life: ${id} has no Town home`);
  const stop = residentRoutePlanForDay(id, gs.day + 1).stops.find(candidate =>
    (candidate.category === 'leisure' || candidate.category === 'meal' || candidate.category === 'errand')
    && townRouteDestinationBuilding(candidate.destination, home.buildingId) === null
    && candidate.leave - candidate.arrive >= INVITE_MIN_MINUTES);
  // why: no outdoor stop tomorrow simply means no invite today; nothing is invented.
  if (!stop) return null;
  const invite: TownInviteState = { residentId: id, offeredDay: gs.day, day: gs.day + 1, label: stop.label,
    tx: stop.tx, ty: stop.ty, startsAt: stop.arrive, endsAt: stop.leave, kept: false };
  life.invite = invite;
  life.lastInviteDay = gs.day;
  return `If you are free tomorrow, I will be at ${stop.label} around ${townClockLabel(stop.arrive)}. Come find me?`;
}

/** Today's open invite that the keeper has not kept yet, or null. */
function activeInvite(): TownInviteState | null {
  const gs = GameState.instance, invite = gs.townLife.invite;
  return invite && invite.day === gs.day && !invite.kept ? invite : null;
}

/**
 * Check whether the keeper kept today's invite. Both the keeper and the resident must stand near the
 * spot during the window, so a changed route can never count as a meeting.
 * @param timeOfDay minutes since 06:00
 * @param keeperTile keeper's tile in Town
 * @param residentTile the invited resident's tile, or null when they are not in Town
 * @returns the thank-you line when the invite was just kept, else null
 */
function checkInvite(timeOfDay: number, keeperTile: { tx: number; ty: number },
  residentTile: { tx: number; ty: number } | null): string | null {
  const invite = activeInvite();
  if (!invite || residentTile === null) return null;
  if (timeOfDay < invite.startsAt - INVITE_GRACE_MINUTES || timeOfDay > invite.endsAt + INVITE_GRACE_MINUTES) return null;
  const near = (tile: { tx: number; ty: number }) =>
    Math.hypot(tile.tx - invite.tx, tile.ty - invite.ty) <= INVITE_RADIUS_TILES;
  if (!near(keeperTile) || !near(residentTile)) return null;
  const gs = GameState.instance;
  invite.kept = true;
  grantResidentFriendship(invite.residentId, INVITE_FRIENDSHIP);
  addNews({ id: `invite-kept:${gs.day}:${invite.residentId}`, day: gs.day, kind: 'invite-kept',
    subjects: [invite.residentId], detail: invite.label, knownBy: [invite.residentId] });
  return `${nameOf(invite.residentId)}: You came! It is nice to have company at ${invite.label}.`;
}

/**
 * Record that the keeper kept a plan they made with a resident. It reuses the invite-kept news kind, so
 * gossip and saves read it the same way as a kept invite.
 * @param id the resident met
 * @param label the place name (at most 60 characters)
 */
function recordKeptPlanNews(id: ResidentId, label: string): void {
  const gs = GameState.instance;
  addNews({ id: `invite-kept:${gs.day}:${id}`, day: gs.day, kind: 'invite-kept', subjects: [id], detail: label, knownBy: [id] });
}

/** Public API for sleep, Talk, TownSocialLifeSystem, TownScene, KeeperSocialSystem, and tests. */
export const TownLifeSystem = Object.freeze({
  refreshDay, openFavor, talkAboutFavor, recordMeetingNews, gossipLine, newsContext, grantChatFriendship,
  offerInvite, activeInvite, checkInvite, recordKeptPlanNews,
});
