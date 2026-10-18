/**
 * KeeperSocialSystem — the rules for the keeper's own social life: plans for tomorrow, the adventuring
 * party, and small daily actions (befriend, flirt, rounds of drinks, and the Wayfarer card game).
 *
 * The saved record lives in GameState.social (shape and validation: KeeperSocialState.ts). This file is
 * the only writer. The game decides every outcome here; the local model may only describe it in words.
 *
 * How a plan "really happens": a plan is a fixed route stop for the resident on its day
 * (TownRoutePlanSystem builds it in). The options offered here come from building tomorrow's real route
 * with the plan in it, so the keeper can only pick a plan the resident can keep. On the day, TownScene
 * (outdoor places) and CivicInteriorScene (The Wayfarer) call checkPlans() to see whether both showed up.
 */
import { SceneKey } from '../config/AssetKeys';
import { STAMINA_MAX } from '../config/GameConfig';
import { residentCharacterSheet } from '../config/ResidentCharacterSheets';
import type { ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { TOWN_SOCIAL_SPOTS } from '../config/TownSchedules';
import type { TownRouteDestinationId } from '../config/TownRouteTemplates';
import { GameState } from '../state/GameState';
import { Rng } from '../state/Rng';
import { getMapData } from '../world/MapDef';
import { KEEPER_PLAN_DESTINATIONS, MAX_KEEPER_PLANS, MAX_PARTY_SIZE, type KeeperPlanOption, type KeeperPlanState,
  type KeeperSocialAction } from './KeeperSocialState';
import { expressInterestInResident, grantResidentFriendship, pointsToHearts, residentSocialRoll } from './RelationshipSystem';
import { townBuildingAccess } from './TownBuildingAccessSystem';
import { INVITE_FRIENDSHIP, INVITE_GRACE_MINUTES, INVITE_RADIUS_TILES, TownLifeSystem, townClockLabel } from './TownLifeSystem';
import { isTavernNight, TAVERN_NIGHT, tryAuthoredTownRouteDay } from './TownRoutePlanSystem';
import { wayfarerSeat, wayfarerSeatGroup } from '../config/WayfarerSeats';
import { residentScheduleScene, socialMeetingForResident } from './TownScheduleSystem';
import { CompanionWalkSystem } from './CompanionWalkSystem';

/** Hearts a resident needs before they agree to plans for tomorrow. */
export const PLAN_MIN_HEARTS = 2;
/** Hearts a resident needs before they join the keeper's adventuring party. */
export const PARTY_MIN_HEARTS = 3;
/** Hearts a resident needs before a flirt lands well. */
export const FLIRT_MIN_HEARTS = 2;
/** Friendship from one befriend action per resident per day. */
export const BEFRIEND_FRIENDSHIP = 15;
/** Friendship from one welcome flirt per resident per day. */
export const FLIRT_FRIENDSHIP = 20;
/** Gold for one drink. Buying a round costs this for every resident at the table. */
export const ROUND_PRICE = 6;
/** Friendship each resident gets from a round the keeper buys. */
export const ROUND_FRIENDSHIP = 15;
/** Stamina a round restores when a resident buys it for the keeper. */
export const ROUND_STAMINA = 25;
/** Gold the keeper puts in for one hand of Wayfarer cards. */
export const CARD_STAKE = 10;
/** Friendship each resident gets for playing cards with the keeper. */
export const CARD_FRIENDSHIP = 10;
/** Card values run 1..CARD_HIGH. */
const CARD_HIGH = 10;
/** Cards in one hand. */
export const CARD_HAND_SIZE = 3;
/** A resident swaps their lowest card when it is below this value. */
const RESIDENT_SWAP_BELOW = 4;
/** Length of every keeper plan, in game minutes. */
export const PLAN_MINUTES = 60;
/** Plan start times offered, in minutes since 06:00 (9 am, 11:30 am, 1:30 pm, 4 pm, 5:30 pm). */
const PLAN_STARTS = [180, 330, 450, 600, 690] as const;
/** Places tried per start time. Each try builds one full route day, so this bounds the work per click. */
const PLAN_PLACES_PER_START = 4;
/** Most options shown in one plan picker. */
const MAX_PLAN_OPTIONS = 3;

export type { KeeperPlanOption };

/** Result of asking for plan options: the list, or why there is none. */
export type KeeperPlanOptions = { ok: true; options: KeeperPlanOption[] } | { ok: false; line: string };

/** Result of any keeper social action. `ok` is false when nothing changed. */
export interface KeeperActionResult {
  ok: boolean;
  /** Line shown to the keeper (game wording, never model text). */
  line: string;
  /** Short event description passed to the group-chat model, e.g. "The keeper bought a round." */
  event: string;
}

/** One live hand of Wayfarer cards. Runtime only: the stake is paid when the hand finishes. */
export interface WayfarerCardGame {
  day: number;
  players: ResidentId[];
  keeperHand: number[];
  residentHands: Record<string, number[]>;
  /** Card each resident takes if their fixed rule makes them swap. */
  residentSwapCards: Record<string, number>;
  /** Next card the keeper gets if they swap their lowest one. */
  keeperSwapCard: number;
}

/** Display name of one resident. */
function nameOf(id: ResidentId): string {
  return residentCharacterSheet(id).name;
}

/** Current hearts with one resident. */
function heartsWith(id: ResidentId): number {
  return pointsToHearts(GameState.instance.relationships.residents[id].points);
}

/**
 * Bring the daily action record to today. Call before reading or writing it (sleep and Talk also call it).
 * Also drops plans from past days.
 */
function refreshDay(): void {
  const gs = GameState.instance, social = gs.social;
  if (social.daily.day !== gs.day) social.daily = { day: gs.day, done: [] };
  social.plans = social.plans.filter(plan => plan.day >= gs.day);
}

/** True when `action` was already used on `target` today. */
function usedToday(action: KeeperSocialAction, target: ResidentId | 'table'): boolean {
  refreshDay();
  return GameState.instance.social.daily.done.includes(`${action}:${target}`);
}

/** Record one daily action. Throws when it was already used, so a UI bug cannot pay twice. */
function markUsed(action: KeeperSocialAction, target: ResidentId | 'table'): void {
  refreshDay();
  const entry = `${action}:${target}`, done = GameState.instance.social.daily.done;
  if (done.includes(entry)) throw new Error(`Keeper social: ${entry} was already used today`);
  done.push(entry);
}

/** Display label of one plan place. */
function placeLabel(destination: TownRouteDestinationId): string {
  if (destination === 'bar') return 'The Wayfarer';
  if (destination === 'fishing-bank') return 'the fishing bank';
  const spot = TOWN_SOCIAL_SPOTS.find(candidate => candidate.id === destination);
  if (!spot) throw new Error(`Keeper social: ${destination} is not a plan place`);
  return spot.label;
}

/**
 * The plans the keeper could make with a resident for tomorrow. Each option is tested by building the
 * resident's real route for tomorrow with the plan in it; options that overlap another keeper plan, or
 * a closed Wayfarer, are left out.
 * @param id the resident
 */
function planOptions(id: ResidentId): KeeperPlanOptions {
  refreshDay();
  const gs = GameState.instance, social = gs.social, day = gs.day + 1;
  if (heartsWith(id) < PLAN_MIN_HEARTS) return { ok: false, line: `${nameOf(id)} smiles, but you are not close enough for plans yet.` };
  const existing = social.plans.find(plan => plan.residentId === id && plan.day === day);
  if (existing) {
    return { ok: false, line: `You already plan to meet at ${existing.label} around ${townClockLabel(existing.startsAt)} tomorrow.` };
  }
  if (social.plans.length >= MAX_KEEPER_PLANS) return { ok: false, line: 'Your day is full of plans already.' };
  const map = getMapData(SceneKey.Town), meeting = socialMeetingForResident(id, day), options: KeeperPlanOption[] = [];
  const myPlans = social.plans.filter(plan => plan.day === day);
  for (const startsAt of PLAN_STARTS) {
    if (options.length >= MAX_PLAN_OPTIONS) break;
    const endsAt = startsAt + PLAN_MINUTES;
    // why: the keeper cannot be in two places, so a window that touches another plan is never offered.
    if (myPlans.some(plan => startsAt < plan.endsAt && plan.startsAt < endsAt)) continue;
    // why: the seeded order gives each resident a few favorite places per day without any Math.random.
    const places = [...KEEPER_PLAN_DESTINATIONS].sort((left, right) =>
      residentSocialRoll(gs.relationships.socialSeed, day, `${id}:${left}:plan`)
      - residentSocialRoll(gs.relationships.socialSeed, day, `${id}:${right}:plan`)).slice(0, PLAN_PLACES_PER_START);
    for (const destination of places) {
      if (options.some(option => option.destination === destination)) continue;
      if (destination === 'bar' && (!townBuildingAccess('bar', startsAt, { kind: 'resident', residentId: id }, gs.relationships).allowed
        || !townBuildingAccess('bar', startsAt, { kind: 'player' }, gs.relationships).allowed)) continue;
      const label = placeLabel(destination);
      const result = tryAuthoredTownRouteDay(id, day, map, meeting, { id: `plan:${gs.day}:${id}`, destination, label, startsAt, endsAt });
      if (!result.ok) continue;
      const stop = result.day.stops.find(candidate => candidate.id === 'plan');
      if (!stop) throw new Error(`Keeper social: ${id} route for day ${day} lost its plan stop`);
      options.push({ destination, label, tx: stop.tx, ty: stop.ty, startsAt: stop.arrive, endsAt: stop.leave });
      break;
    }
  }
  if (!options.length) return { ok: false, line: `${nameOf(id)} checks their day. "Tomorrow is packed, sorry. Ask me again another day?"` };
  return { ok: true, options };
}

/**
 * Make one plan for tomorrow. The option must still be offered right now, so a stale button cannot
 * create a plan the resident's route cannot keep.
 * @param id the resident
 * @param option one option from planOptions(id)
 */
function makePlan(id: ResidentId, option: KeeperPlanOption): KeeperActionResult {
  const current = planOptions(id);
  if (!current.ok) return { ok: false, line: current.line, event: '' };
  const match = current.options.find(candidate => candidate.destination === option.destination && candidate.startsAt === option.startsAt);
  if (!match) throw new Error(`Keeper social: plan ${option.destination}@${option.startsAt} is not offered to ${id}`);
  const gs = GameState.instance;
  const plan: KeeperPlanState = { id: `plan:${gs.day}:${id}`, residentId: id, madeDay: gs.day, day: gs.day + 1,
    destination: match.destination, label: match.label, tx: match.tx, ty: match.ty, startsAt: match.startsAt,
    endsAt: match.endsAt, kept: false };
  gs.social.plans.push(plan);
  return { ok: true, line: `${nameOf(id)}: "${match.label} tomorrow, ${townClockLabel(match.startsAt)}. I will be there."`,
    event: `The keeper and ${nameOf(id)} agreed to meet at ${match.label} tomorrow at ${townClockLabel(match.startsAt)}.` };
}

/** Today's plans the keeper has not kept yet. */
function todaysPlans(): KeeperPlanState[] {
  refreshDay();
  const gs = GameState.instance;
  return gs.social.plans.filter(plan => plan.day === gs.day && !plan.kept);
}

/**
 * Check whether the keeper kept any plan due now. Outdoor plans need both within 3 tiles of the spot.
 * Wayfarer plans need the keeper inside and the resident's route to place them inside, or the resident
 * walking with the keeper (CompanionWalkSystem), since a walking companion is wherever the keeper is.
 * @param scene the keeper's scene
 * @param keeperTile the keeper's tile in that scene
 * @param residentTile the resident's live tile in Town (their follower tile while walking), or null when they
 *   are not in Town
 * @returns thank-you lines for plans kept just now
 */
function checkPlans(scene: SceneKey, keeperTile: { tx: number; ty: number },
  residentTile: (id: ResidentId) => { tx: number; ty: number } | null): string[] {
  const gs = GameState.instance, lines: string[] = [];
  for (const plan of todaysPlans()) {
    if (gs.timeOfDay < plan.startsAt - INVITE_GRACE_MINUTES || gs.timeOfDay > plan.endsAt + INVITE_GRACE_MINUTES) continue;
    if (plan.destination === 'bar') {
      const inside = CompanionWalkSystem.isWalking(plan.residentId)
        || residentScheduleScene(plan.residentId, gs.day, gs.timeOfDay).scene === SceneKey.TownBar;
      if (scene !== SceneKey.TownBar || !inside) continue;
    } else {
      if (scene !== SceneKey.Town) continue;
      const tile = residentTile(plan.residentId);
      const near = (point: { tx: number; ty: number }) => Math.hypot(point.tx - plan.tx, point.ty - plan.ty) <= INVITE_RADIUS_TILES;
      if (tile === null || !near(keeperTile) || !near(tile)) continue;
    }
    plan.kept = true;
    grantResidentFriendship(plan.residentId, INVITE_FRIENDSHIP);
    TownLifeSystem.recordKeptPlanNews(plan.residentId, plan.label);
    lines.push(`${nameOf(plan.residentId)}: "You made it! Right on time for ${plan.label}."`);
  }
  return lines;
}

/**
 * Ask a resident to join the adventuring party.
 * @param id the resident
 */
function joinParty(id: ResidentId): KeeperActionResult {
  const party = GameState.instance.social.party;
  if (party.includes(id)) return { ok: false, line: `${nameOf(id)} is already in your party.`, event: '' };
  if (heartsWith(id) < PARTY_MIN_HEARTS) {
    return { ok: false, line: `${nameOf(id)}: "Adventuring? Let us get to know each other first."`, event: '' };
  }
  if (party.length >= MAX_PARTY_SIZE) return { ok: false, line: `Your party is full (${MAX_PARTY_SIZE} companions).`, event: '' };
  party.push(id);
  return { ok: true, line: `${nameOf(id)} joins your party. They will fight beside you in the dungeon and the mines, and can walk with you around town.`,
    event: `${nameOf(id)} agreed to join the keeper's adventuring party.` };
}

/**
 * Let a resident leave the adventuring party.
 * @param id the resident
 */
function leaveParty(id: ResidentId): KeeperActionResult {
  const social = GameState.instance.social;
  if (!social.party.includes(id)) throw new Error(`Keeper social: ${id} is not in the party`);
  social.party = social.party.filter(member => member !== id);
  return { ok: true, line: `${nameOf(id)} leaves your party for now.`, event: `${nameOf(id)} left the keeper's adventuring party.` };
}

/**
 * Spend some easy time with one resident. Once per resident per day.
 * @param id the resident
 */
function befriend(id: ResidentId): KeeperActionResult {
  if (usedToday('befriend', id)) return { ok: false, line: `You already spent time with ${nameOf(id)} today.`, event: '' };
  markUsed('befriend', id);
  grantResidentFriendship(id, BEFRIEND_FRIENDSHIP);
  return { ok: true, line: `You and ${nameOf(id)} swap stories and laugh. (+friendship)`,
    event: `The keeper made a real effort to get to know ${nameOf(id)}.` };
}

/**
 * Flirt with one resident. Once per resident per day. A welcome flirt adds friendship and, when the
 * hearts are there, takes the next romance step (interested at 4 hearts, dating at 6).
 * @param id the resident
 */
function flirt(id: ResidentId): KeeperActionResult {
  if (usedToday('flirt', id)) return { ok: false, line: `You already flirted with ${nameOf(id)} today.`, event: '' };
  markUsed('flirt', id);
  if (heartsWith(id) < FLIRT_MIN_HEARTS) {
    return { ok: true, line: `${nameOf(id)} laughs politely and changes the subject.`,
      event: `The keeper flirted with ${nameOf(id)}, who politely brushed it off.` };
  }
  grantResidentFriendship(id, FLIRT_FRIENDSHIP);
  const stage = GameState.instance.relationships.residents[id].romanceStage;
  // why: flirting only opens and deepens romance; the committed step stays a deliberate journal choice.
  const step = stage === 'friends' || stage === 'interested' ? expressInterestInResident(id) : null;
  const extra = step?.changed ? ` ${step.line}` : '';
  return { ok: true, line: `${nameOf(id)} blushes and flirts right back. (+friendship)${extra}`,
    event: step?.changed ? `The keeper flirted with ${nameOf(id)}, and things turned romantic between them.`
      : `The keeper flirted with ${nameOf(id)}, who flirted back.` };
}

/**
 * Buy a round of drinks for a table or one resident. Once per target per day.
 * @param target 'table' for everyone in `residents`, or one resident id
 * @param residents residents who get a drink
 */
function buyRound(target: ResidentId | 'table', residents: readonly ResidentId[]): KeeperActionResult {
  if (!residents.length) throw new Error('Keeper social: a round needs at least one resident');
  if (usedToday('round-buy', target)) return { ok: false, line: 'You already bought this round today.', event: '' };
  const gs = GameState.instance, cost = ROUND_PRICE * residents.length;
  if (gs.gold < cost) return { ok: false, line: `A round costs ${cost} gold. You have ${gs.gold}.`, event: '' };
  markUsed('round-buy', target);
  gs.gold -= cost;
  for (const id of residents) grantResidentFriendship(id, ROUND_FRIENDSHIP);
  return { ok: true, line: `You buy a round for ${residents.length === 1 ? nameOf(residents[0]) : 'the table'} (-${cost} gold). Cheers all round!`,
    event: 'The keeper just bought everyone a round of drinks.' };
}

/**
 * See whether someone at the table buys the keeper a drink. The closest friend with 2+ hearts buys;
 * nobody buys when nobody is close yet (and the keeper may ask again later tonight).
 * @param residents residents at the table
 */
function getRound(residents: readonly ResidentId[]): KeeperActionResult {
  if (usedToday('round-get', 'table')) return { ok: false, line: 'Someone already bought you a drink tonight.', event: '' };
  const gs = GameState.instance;
  const buyers = residents.filter(id => heartsWith(id) >= 2).sort((left, right) => heartsWith(right) - heartsWith(left)
    || residentSocialRoll(gs.relationships.socialSeed, gs.day, `${left}:round`) - residentSocialRoll(gs.relationships.socialSeed, gs.day, `${right}:round`));
  if (!buyers.length) return { ok: false, line: 'Nobody offers yet. Make a few friends first.', event: 'The keeper hinted for a free drink, but nobody bit.' };
  markUsed('round-get', 'table');
  const buyer = buyers[0];
  gs.player.stamina = Math.min(STAMINA_MAX, gs.player.stamina + ROUND_STAMINA);
  grantResidentFriendship(buyer, ROUND_FRIENDSHIP);
  return { ok: true, line: `${nameOf(buyer)} buys you a drink. You feel refreshed (+${ROUND_STAMINA} stamina).`,
    event: `${nameOf(buyer)} bought the keeper a drink.` };
}

/**
 * Deal one hand of Wayfarer cards. The deal is seeded by save and day, so dealing again gives the same
 * cards and cannot be used to fish for a better hand.
 * @param residents residents at the table who play
 * @returns the hand, or a refusal line
 */
function dealCards(residents: readonly ResidentId[]): { ok: true; game: WayfarerCardGame } | { ok: false; line: string } {
  if (!residents.length) throw new Error('Keeper social: cards need at least one resident');
  if (usedToday('cards', 'table')) return { ok: false, line: 'The table already played a hand with you tonight.' };
  const gs = GameState.instance;
  if (gs.gold < CARD_STAKE) return { ok: false, line: `The stake is ${CARD_STAKE} gold. You have ${gs.gold}.` };
  const rng = new Rng(residentSocialRoll(gs.relationships.socialSeed, gs.day, `wayfarer-cards:${residents.join(',')}`));
  const hand = () => Array.from({ length: CARD_HAND_SIZE }, () => rng.int(1, CARD_HIGH));
  const keeperHand = hand(), residentHands: Record<string, number[]> = {}, residentSwapCards: Record<string, number> = {};
  for (const id of residents) { residentHands[id] = hand(); residentSwapCards[id] = rng.int(1, CARD_HIGH); }
  return { ok: true, game: { day: gs.day, players: [...residents], keeperHand, residentHands, residentSwapCards,
    keeperSwapCard: rng.int(1, CARD_HIGH) } };
}

/** Sum of one hand. */
function handTotal(hand: readonly number[]): number {
  return hand.reduce((sum, card) => sum + card, 0);
}

/** Copy a hand with its lowest card replaced. */
function swapLowest(hand: readonly number[], card: number): number[] {
  const copy = [...hand], low = copy.indexOf(Math.min(...copy));
  copy[low] = card;
  return copy;
}

/**
 * Finish a hand: the keeper keeps or swaps their lowest card, residents swap by a fixed rule, and the
 * highest total wins. The keeper pays the stake; a win pays the stake back from every player.
 * @param game the dealt hand from dealCards()
 * @param swap true to swap the keeper's lowest card for `keeperSwapCard`
 */
function finishCards(game: WayfarerCardGame, swap: boolean): KeeperActionResult & { keeperTotal: number; winner: ResidentId | 'keeper' | 'tie' } {
  const gs = GameState.instance;
  if (game.day !== gs.day) throw new Error('Keeper social: this card hand belongs to another day');
  if (gs.gold < CARD_STAKE) throw new Error('Keeper social: the stake is no longer in the purse');
  markUsed('cards', 'table');
  const keeperHand = swap ? swapLowest(game.keeperHand, game.keeperSwapCard) : [...game.keeperHand];
  const keeperTotal = handTotal(keeperHand);
  let best: { id: ResidentId; total: number } | null = null;
  const shown: string[] = [];
  for (const id of game.players) {
    const hand = game.residentHands[id], swapCard = game.residentSwapCards[id];
    if (!hand || swapCard === undefined) throw new Error(`Keeper social: ${id} has no card hand`);
    // why: residents follow one fixed, readable rule (swap anything below 4) so the keeper can learn to read the table.
    const final = Math.min(...hand) < RESIDENT_SWAP_BELOW ? swapLowest(hand, swapCard) : hand;
    const total = handTotal(final);
    shown.push(`${nameOf(id)} ${total}`);
    if (!best || total > best.total) best = { id, total };
    grantResidentFriendship(id, CARD_FRIENDSHIP);
  }
  const top = best as { id: ResidentId; total: number } | null;
  if (!top) throw new Error('Keeper social: card game had no resident players');
  const summary = `You ${keeperTotal} vs ${shown.join(', ')}.`;
  if (keeperTotal > top.total) {
    const winnings = CARD_STAKE * game.players.length;
    gs.gold += winnings;
    return { ok: true, keeperTotal, winner: 'keeper', line: `${summary} You win the pot (+${winnings} gold)!`,
      event: `The keeper won the hand of cards with ${keeperTotal}.` };
  }
  if (keeperTotal === top.total) {
    return { ok: true, keeperTotal, winner: 'tie', line: `${summary} A tie with ${nameOf(top.id)}. Stakes go back.`,
      event: `The hand of cards ended in a tie between the keeper and ${nameOf(top.id)}.` };
  }
  gs.gold -= CARD_STAKE;
  return { ok: true, keeperTotal, winner: top.id, line: `${summary} ${nameOf(top.id)} wins (-${CARD_STAKE} gold).`,
    event: `${nameOf(top.id)} won the hand of cards with ${top.total}; the keeper lost.` };
}

/**
 * True while The Wayfarer is having its busy night right now and the keeper is inside to see it.
 * Guests sit at fixed seats only in this window (see WayfarerSeats and TownResident).
 */
function wayfarerNightNow(): boolean {
  const gs = GameState.instance;
  return gs.activeScene === SceneKey.TownBar && isTavernNight(gs.day)
    && gs.timeOfDay >= TAVERN_NIGHT.opensAt && gs.timeOfDay < TAVERN_NIGHT.closesAt;
}

/**
 * The residents sitting at one resident's Wayfarer table right now, in seat order (that resident included).
 * A table is the seat group (table A, table B, or the bar stools) of the resident the keeper spoke to.
 * Julian runs the bar, so he never sits at a table. A resident walking with the keeper is not seated.
 * @param id the resident the keeper spoke to
 * @returns the table, or [] when it is not Wayfarer night, the keeper is elsewhere, or the resident has no seat
 */
function wayfarerTableFor(id: ResidentId): ResidentId[] {
  if (!wayfarerNightNow()) return [];
  const gs = GameState.instance, resident = TOWN_RESIDENTS.find(entry => entry.id === id);
  if (!resident) throw new Error(`Keeper social: unknown resident ${id}`);
  if (resident.buildingId === 'bar') return [];
  const group = wayfarerSeatGroup(wayfarerSeat(id));
  // why: a resident walking with the keeper follows the keeper instead of taking their seat, even on Wayfarer night.
  const seated = (other: ResidentId) => !CompanionWalkSystem.isWalking(other)
    && residentScheduleScene(other, gs.day, gs.timeOfDay).scene === SceneKey.TownBar;
  if (!seated(id)) return [];
  return TOWN_RESIDENTS
    .filter(entry => entry.buildingId !== 'bar' && wayfarerSeatGroup(wayfarerSeat(entry.id)) === group && seated(entry.id))
    .map(entry => entry.id);
}

/** Public API for dialogue, the Wayfarer table, scenes, and tests. */
export const KeeperSocialSystem = Object.freeze({
  refreshDay, usedToday, planOptions, makePlan, todaysPlans, checkPlans, joinParty, leaveParty, befriend, flirt,
  buyRound, getRound, dealCards, finishCards, wayfarerNightNow, wayfarerTableFor, handTotal,
});
