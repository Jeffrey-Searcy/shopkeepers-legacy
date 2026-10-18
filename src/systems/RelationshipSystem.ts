/** Authoritative friendship, romance, gift, and resident-pair rules over serializable GameState data. */
import { ITEM_CATALOG } from '../config/Items';
import { RESIDENT_BONDS, RESIDENT_RELATIONSHIPS, residentBondId, residentGiftTaste, residentRelationshipProfile,
  validateResidentRelationships, type DialogueTier, type GiftTaste, type ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState } from '../state/GameState';

export const POINTS_PER_HEART = 250;
export const MAX_HEARTS = 10;
export const MAX_RELATIONSHIP_POINTS = POINTS_PER_HEART * MAX_HEARTS;
export const NPC_EXCLUSIVE_POINTS = 250;
export const GIFTS_PER_WEEK = 2;
export type RomanceStage = 'friends' | 'interested' | 'dating' | 'committed';
export type ResidentBondStage = 'Strangers' | 'Acquaintances' | 'Friends' | 'Close' | 'Attracted' | 'Best Friends'
  | 'Together' | 'Open Partners' | 'Hurt';

/** Durable player-to-resident progress. Day numbers replace reset-prone booleans. */
export interface ResidentRelationshipState {
  points: number;
  lastTalkDay: number | null;
  lastGiftDay: number | null;
  giftWeek: number;
  giftsThisWeek: number;
  conversationCount: number;
  romanceStage: RomanceStage;
  complicated: boolean;
}

/** Durable finite resident-to-resident chemistry. It never removes a player route. */
export interface ResidentBondState {
  points: number;
  lastAdvancedDay: number;
  exclusive: boolean;
  openAgreement: boolean;
  betrayalDay: number | null;
}

/** Complete durable relationship payload. Exact keys make missing current-save data corruption. */
export interface RelationshipsState {
  socialSeed: number;
  lastSocialDay: number;
  residents: Record<ResidentId, ResidentRelationshipState>;
  bonds: Record<string, ResidentBondState>;
}

/** One detached journal/chat view with no hidden taste lists. */
export interface RelationshipView {
  id: ResidentId;
  name: string;
  bio: string;
  traits: readonly [string, string, string];
  hearts: number;
  points: number;
  romanceStage: RomanceStage;
  relationshipStyle: 'exclusive' | 'open-minded';
  npcPartnerId: ResidentId | null;
  talkedToday: boolean;
  giftedToday: boolean;
  giftsThisWeek: number;
  complicated: boolean;
}

/** Detached NPC-to-NPC progress for the selected resident's Town Relationships journal. */
export interface ResidentBondView {
  id: string;
  residents: readonly [ResidentId, ResidentId];
  names: readonly [string, string];
  points: number;
  stage: ResidentBondStage;
  exclusive: boolean;
  openAgreement: boolean;
  secret: boolean;
  betrayalDay: number | null;
  lastMeetingDay: number;
}

export type ResidentMeetingOutcome = 'conversation' | 'became-partners' | 'secret-romance' | 'opened-relationship' | 'betrayal-discovered';
export type ResidentSocialAction = 'friendly-chat' | 'flirt' | 'embrace' | 'kiss' | 'define-relationship' | 'discuss-boundaries';

/** One exact bond update inside a meeting event. Witnessed cheating can update several bonds atomically. */
export interface ResidentBondMutation {
  bondId: string;
  before: ResidentBondState;
  after: ResidentBondState;
}

/** Exact event-first transition used by TownSocialLifeSystem and reload reconciliation. */
export interface ResidentMeetingEffect {
  bondId: string;
  day: number;
  outcome: ResidentMeetingOutcome;
  action: ResidentSocialAction;
  witnesses: readonly ResidentId[];
  mutations: readonly ResidentBondMutation[];
}

/** Result of a normal gift attempt. Rejections explain the rule and never consume the item. */
export interface GiftResult {
  accepted: boolean;
  line: string;
  taste: GiftTaste | null;
  points: number;
  hearts: number;
}

/** Return the deterministic seven-day bucket for a positive game day. */
function weekForDay(day: number): number {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Relationships: invalid day ${day}`);
  return Math.floor((day - 1) / 7);
}

/** Create exact empty progress for a new game or an explicit pre-v13 migration. */
export function createRelationshipsState(day: number, socialSeed: number): RelationshipsState {
  validateResidentRelationships();
  if (!Number.isSafeInteger(socialSeed) || socialSeed < 1 || socialSeed > 0xffffffff) throw new Error(`Relationships: invalid social seed ${socialSeed}`);
  const residents = Object.fromEntries(RESIDENT_RELATIONSHIPS.map(profile => [profile.id, {
    points: 0, lastTalkDay: null, lastGiftDay: null, giftWeek: weekForDay(day), giftsThisWeek: 0,
    conversationCount: 0, romanceStage: 'friends' as const, complicated: false,
  }])) as Record<ResidentId, ResidentRelationshipState>;
  const bonds = Object.fromEntries(RESIDENT_BONDS.map(bond => [bond.id, {
    points: 0, lastAdvancedDay: 0, exclusive: false, openAgreement: false, betrayalDay: null,
  }])) as Record<string, ResidentBondState>;
  return { socialSeed, lastSocialDay: day - 1, residents, bonds };
}

/** Validate and detach unknown saved relationship data without repairing current-version damage. */
export function validateRelationshipsState(value: unknown, currentDay: number): RelationshipsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Relationships save must be an object');
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(',') !== 'bonds,lastSocialDay,residents,socialSeed') throw new Error('Relationships save has unknown or missing fields');
  if (!Number.isSafeInteger(root.socialSeed) || (root.socialSeed as number) < 1 || (root.socialSeed as number) > 0xffffffff) {
    throw new Error('Relationships save socialSeed is invalid');
  }
  if (!Number.isSafeInteger(root.lastSocialDay) || (root.lastSocialDay as number) < 0 || (root.lastSocialDay as number) > currentDay) {
    throw new Error('Relationships save lastSocialDay is invalid');
  }
  if (!root.residents || typeof root.residents !== 'object' || Array.isArray(root.residents)) throw new Error('Relationships save residents must be an object');
  if (!root.bonds || typeof root.bonds !== 'object' || Array.isArray(root.bonds)) throw new Error('Relationships save bonds must be an object');
  const residentSource = root.residents as Record<string, unknown>, bondSource = root.bonds as Record<string, unknown>;
  const expectedResidents = RESIDENT_RELATIONSHIPS.map(profile => profile.id).sort();
  if (Object.keys(residentSource).sort().join(',') !== expectedResidents.join(',')) throw new Error('Relationships save must contain every resident exactly once');
  const residents = {} as Record<ResidentId, ResidentRelationshipState>;
  for (const id of expectedResidents) {
    const raw = residentSource[id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Relationships save ${id} must be an object`);
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'complicated,conversationCount,giftWeek,giftsThisWeek,lastGiftDay,lastTalkDay,points,romanceStage') throw new Error(`Relationships save ${id} has unknown or missing fields`);
    const integer = (field: string, min: number, max: number): number => {
      const item = record[field];
      if (!Number.isSafeInteger(item) || (item as number) < min || (item as number) > max) throw new Error(`Relationships save ${id}.${field} is invalid`);
      return item as number;
    };
    const dayValue = (field: string): number | null => record[field] === null ? null : integer(field, 1, currentDay);
    const romanceStage = record.romanceStage;
    if (typeof romanceStage !== 'string' || !['friends', 'interested', 'dating', 'committed'].includes(romanceStage)) {
      throw new Error(`Relationships save ${id}.romanceStage is invalid`);
    }
    if (typeof record.complicated !== 'boolean') throw new Error(`Relationships save ${id}.complicated is invalid`);
    residents[id as ResidentId] = { points: integer('points', 0, MAX_RELATIONSHIP_POINTS), lastTalkDay: dayValue('lastTalkDay'),
      lastGiftDay: dayValue('lastGiftDay'), giftWeek: integer('giftWeek', 0, weekForDay(currentDay)),
      giftsThisWeek: integer('giftsThisWeek', 0, GIFTS_PER_WEEK), conversationCount: integer('conversationCount', 0, Number.MAX_SAFE_INTEGER),
      romanceStage: romanceStage as RomanceStage, complicated: record.complicated };
  }
  const expectedBonds = RESIDENT_BONDS.map(bond => bond.id).sort();
  if (Object.keys(bondSource).sort().join(',') !== expectedBonds.join(',')) throw new Error('Relationships save must contain every NPC bond exactly once');
  const bonds: Record<string, ResidentBondState> = {};
  for (const id of expectedBonds) {
    const raw = bondSource[id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Relationships save bond ${id} must be an object`);
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'betrayalDay,exclusive,lastAdvancedDay,openAgreement,points') throw new Error(`Relationships save bond ${id} has unknown or missing fields`);
    if (!Number.isSafeInteger(record.points) || (record.points as number) < 0 || (record.points as number) > NPC_EXCLUSIVE_POINTS) throw new Error(`Relationships save bond ${id}.points is invalid`);
    if (!Number.isSafeInteger(record.lastAdvancedDay) || (record.lastAdvancedDay as number) < 0 || (record.lastAdvancedDay as number) > currentDay) throw new Error(`Relationships save bond ${id}.lastAdvancedDay is invalid`);
    if (typeof record.exclusive !== 'boolean' || typeof record.openAgreement !== 'boolean' || (record.openAgreement && !record.exclusive)) {
      throw new Error(`Relationships save bond ${id} partnership flags are invalid`);
    }
    const betrayalDay = record.betrayalDay === null ? null : record.betrayalDay;
    if (betrayalDay !== null && (!Number.isSafeInteger(betrayalDay) || (betrayalDay as number) < 1 || (betrayalDay as number) > currentDay)) {
      throw new Error(`Relationships save bond ${id}.betrayalDay is invalid`);
    }
    bonds[id] = { points: record.points as number, lastAdvancedDay: record.lastAdvancedDay as number,
      exclusive: record.exclusive, openAgreement: record.openAgreement, betrayalDay: betrayalDay as number | null };
  }
  return { socialSeed: root.socialSeed as number, lastSocialDay: root.lastSocialDay as number, residents, bonds };
}

/** Derive a stable nonzero social seed from legacy fields that no map or inventory migration changes. */
export function socialSeedFromLegacy(value: unknown): number {
  // Legacy candidates can pass through map, furniture, and inventory migrations more than once.
  // Day, gold, and appearance are validated unchanged across every supported schema, so using
  // only this identity avoids silently rerolling a town's relationships after those migrations.
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const source = { day: record.day, gold: record.gold, appearance: record.appearance };
  const raw = JSON.stringify(source);
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index++) hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619) >>> 0;
  return hash || 0x9e3779b9;
}

/** Expand the six v13 lanes into the complete 66-bond network without changing their earned points. */
export function migrateV13RelationshipsState(value: unknown, currentDay: number, socialSeed: number): RelationshipsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Relationships v13 save must be an object');
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(',') !== 'bonds,residents' || !root.bonds || typeof root.bonds !== 'object' || Array.isArray(root.bonds)) {
    throw new Error('Relationships v13 save has unknown or missing fields');
  }
  const source = root.bonds as Record<string, unknown>;
  const legacyPairs = ['nyra-cael', 'tessa-bram', 'rhea-dorian', 'sylvie-rowan', 'elowen-kit', 'seren-julian'].sort();
  if (Object.keys(source).sort().join(',') !== legacyPairs.join(',')) throw new Error('Relationships v13 save must contain the six original bonds');
  const expanded = createRelationshipsState(currentDay, socialSeed);
  let lastSocialDay = 0;
  for (const id of legacyPairs) {
    const raw = source[id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Relationships v13 bond ${id} must be an object`);
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'exclusive,lastAdvancedDay,points'
      || !Number.isSafeInteger(record.points) || (record.points as number) < 0 || (record.points as number) > NPC_EXCLUSIVE_POINTS
      || !Number.isSafeInteger(record.lastAdvancedDay) || (record.lastAdvancedDay as number) < 0 || (record.lastAdvancedDay as number) > currentDay
      || typeof record.exclusive !== 'boolean' || record.exclusive !== ((record.points as number) >= NPC_EXCLUSIVE_POINTS)) {
      throw new Error(`Relationships v13 bond ${id} is invalid`);
    }
    expanded.bonds[id] = { points: record.points as number, lastAdvancedDay: record.lastAdvancedDay as number,
      exclusive: record.exclusive, openAgreement: false, betrayalDay: null };
    lastSocialDay = Math.max(lastSocialDay, record.lastAdvancedDay as number);
  }
  expanded.lastSocialDay = lastSocialDay;
  return validateRelationshipsState({ ...expanded, residents: root.residents }, currentDay);
}

/** Deep-clone validated social state for saves and detached comparisons. */
export function cloneRelationshipsState(value: RelationshipsState, currentDay: number): RelationshipsState {
  return validateRelationshipsState(JSON.parse(JSON.stringify(value)) as unknown, currentDay);
}

/** Convert clamped points into whole display hearts. */
export function pointsToHearts(points: number): number {
  if (!Number.isFinite(points)) throw new Error('Relationships: points must be finite');
  return Math.floor(Math.max(0, Math.min(MAX_RELATIONSHIP_POINTS, points)) / POINTS_PER_HEART);
}

/** Select authored dialogue tier from current progress. */
function dialogueTier(points: number, romanceStage: RomanceStage): DialogueTier {
  if (romanceStage !== 'friends' && pointsToHearts(points) >= 6) return 'romantic';
  const hearts = pointsToHearts(points);
  return hearts >= 6 ? 'close' : hearts >= 3 ? 'friend' : 'new';
}

/** Resolve every current NPC partner. Several entries can exist during agreed openness or undiscovered cheating. */
export function npcPartnersFor(id: ResidentId, state = GameState.instance.relationships): ResidentId[] {
  residentRelationshipProfile(id);
  return RESIDENT_BONDS.filter(candidate => candidate.residents.includes(id) && state.bonds[candidate.id].exclusive)
    .map(bond => bond.residents[0] === id ? bond.residents[1] : bond.residents[0]);
}

/** Keep the previous single-partner query for player-route difficulty and profile text. */
export function npcPartnerFor(id: ResidentId, state = GameState.instance.relationships): ResidentId | null {
  return npcPartnersFor(id, state)[0] ?? null;
}

/** Stable per-save hash. It varies social outcomes without consuming the shared gameplay random stream. */
export function residentSocialRoll(seed: number, day: number, key: string): number {
  let value = (seed ^ Math.imul(day, 0x9e3779b1)) >>> 0;
  for (let index = 0; index < key.length; index++) value = Math.imul(value ^ key.charCodeAt(index), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d) >>> 0; value ^= value >>> 15;
  return value >>> 0;
}

/** Personality preferences and the save seed determine how quickly one friendship grows. */
export function residentBondChemistry(bondId: string, socialSeed: number): number {
  const profile = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
  if (!profile) throw new Error(`Relationships: unknown resident bond ${bondId}`);
  const first = residentRelationshipProfile(profile.residents[0]), second = residentRelationshipProfile(profile.residents[1]);
  const preference = (first.drawnTo.includes(second.id) ? 4 : 0) + (second.drawnTo.includes(first.id) ? 4 : 0);
  return 7 + preference + residentSocialRoll(socialSeed, 0, bondId) % 5;
}

/** Attraction is stable within a save, but different saves can turn the same bond romantic or platonic. */
export function residentBondHasRomanticPotential(bondId: string, socialSeed: number): boolean {
  const profile = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
  if (!profile) throw new Error(`Relationships: unknown resident bond ${bondId}`);
  const first = residentRelationshipProfile(profile.residents[0]), second = residentRelationshipProfile(profile.residents[1]);
  const preference = (first.drawnTo.includes(second.id) ? 22 : 0) + (second.drawnTo.includes(first.id) ? 22 : 0);
  return residentSocialRoll(socialSeed, 0, `${bondId}:romance`) % 100 < 14 + preference;
}

/** Convert one bond into the selected resident's player-visible status. */
export function residentBondStage(state: ResidentBondState, romanticPotential: boolean): ResidentBondStage {
  if (state.betrayalDay !== null && !state.exclusive && state.points < 50) return 'Hurt';
  if (state.exclusive) return state.openAgreement ? 'Open Partners' : 'Together';
  if (state.points >= 175) return romanticPotential ? 'Attracted' : 'Best Friends';
  if (state.points >= 100) return 'Close';
  if (state.points >= 50) return 'Friends';
  if (state.points > 0) return 'Acquaintances';
  return 'Strangers';
}

/** Compare exact durable bond fields without relying on object identity. */
function sameBond(left: ResidentBondState, right: ResidentBondState): boolean {
  return left.points === right.points && left.lastAdvancedDay === right.lastAdvancedDay && left.exclusive === right.exclusive
    && left.openAgreement === right.openAgreement && left.betrayalDay === right.betrayalDay;
}

/** Return whether an action is romantic enough to violate an agreed closed relationship. */
export function isRomanticResidentAction(action: ResidentSocialAction): boolean {
  return action === 'flirt' || action === 'embrace' || action === 'kiss' || action === 'define-relationship';
}

/** Choose one visible action from the current bond without using a hidden caught-cheating roll. */
function residentMeetingAction(bondId: string, meetingDay: number, bond: ResidentBondState,
  nextPoints: number, romanticPotential: boolean): ResidentSocialAction {
  const gs = GameState.instance;
  if (bond.exclusive && !bond.openAgreement) {
    const pair = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
    if (!pair) throw new Error(`Relationships: unknown resident bond ${bondId}`);
    const openMindedCount = pair.residents.filter(id => residentRelationshipProfile(id).relationshipStyle === 'open-minded').length;
    // Style changes willingness, but never makes an honest boundaries conversation impossible.
    const openChance = openMindedCount === 2 ? 24 : openMindedCount === 1 ? 10 : 3;
    if (residentSocialRoll(gs.relationships.socialSeed, meetingDay, `${bondId}:open`) % 100 < openChance) {
      return 'discuss-boundaries';
    }
  }
  if (!bond.exclusive && nextPoints >= NPC_EXCLUSIVE_POINTS && romanticPotential) return 'define-relationship';
  if (!romanticPotential || nextPoints < 175) return 'friendly-chat';
  const roll = residentSocialRoll(gs.relationships.socialSeed, meetingDay, `${bondId}:action`) % 100;
  if (!bond.exclusive) return roll < 48 ? 'flirt' : 'friendly-chat';
  if (roll < 24) return 'kiss';
  if (roll < 54) return 'embrace';
  if (roll < 76) return 'flirt';
  return 'friendly-chat';
}

/** Find closed partner bonds that a witnessed romantic action betrays. */
function witnessedBetrayals(bondId: string, participants: readonly [ResidentId, ResidentId],
  action: ResidentSocialAction, witnesses: readonly ResidentId[]): string[] {
  if (!isRomanticResidentAction(action)) return [];
  const witnessSet = new Set(witnesses);
  return RESIDENT_BONDS.filter(candidate => candidate.id !== bondId && !candidate.residents.every(id => !participants.includes(id)))
    .filter(candidate => {
      const state = GameState.instance.relationships.bonds[candidate.id];
      if (!state.exclusive || state.openAgreement) return false;
      const actor = candidate.residents.find(id => participants.includes(id));
      const partner = candidate.residents.find(id => id !== actor);
      return partner !== undefined && witnessSet.has(partner);
    }).map(candidate => candidate.id);
}

/** Compute one complete action transition before TownSocialLifeSystem writes its event. */
export function previewResidentBondMeeting(bondId: string, meetingDay: number,
  witnesses: readonly ResidentId[]): ResidentMeetingEffect {
  const profile = RESIDENT_BONDS.find(candidate => candidate.id === bondId);
  if (!profile) throw new Error(`Relationships: unknown resident bond ${bondId}`);
  const gs = GameState.instance, bond = gs.relationships.bonds[bondId];
  if (!Number.isSafeInteger(meetingDay) || meetingDay < 1 || meetingDay > gs.day) throw new Error(`Relationships: invalid meeting day ${meetingDay}`);
  if (bond.lastAdvancedDay >= meetingDay) throw new Error(`Relationships: bond ${bondId} already met on day ${meetingDay}`);
  const uniqueWitnesses = [...new Set(witnesses)];
  for (const id of uniqueWitnesses) residentRelationshipProfile(id);
  if (uniqueWitnesses.some(id => profile.residents.includes(id))) throw new Error('Relationships: meeting participants cannot witness themselves');
  const hasClosedPartner = (id: ResidentId): boolean => RESIDENT_BONDS.some(candidate => candidate.id !== bondId
    && candidate.residents.includes(id) && gs.relationships.bonds[candidate.id].exclusive
    && !gs.relationships.bonds[candidate.id].openAgreement);
  const gained = residentBondChemistry(bondId, gs.relationships.socialSeed);
  const romanticPotential = residentBondHasRomanticPotential(bondId, gs.relationships.socialSeed);
  const nextPoints = Math.min(NPC_EXCLUSIVE_POINTS, bond.points + gained);
  const action = residentMeetingAction(bondId, meetingDay, bond, nextPoints, romanticPotential);
  const after = { ...bond, points: nextPoints, lastAdvancedDay: meetingDay };
  let outcome: ResidentMeetingOutcome = 'conversation';
  if (action === 'discuss-boundaries') {
    after.openAgreement = true;
    outcome = 'opened-relationship';
  } else if (action === 'define-relationship') {
    after.exclusive = true;
    after.openAgreement = false;
    after.betrayalDay = null;
    outcome = profile.residents.some(resident => hasClosedPartner(resident)) ? 'secret-romance' : 'became-partners';
  }
  const mutations: ResidentBondMutation[] = [{ bondId, before: { ...bond }, after }];
  const betrayedBonds = witnessedBetrayals(bondId, profile.residents, action, uniqueWitnesses);
  for (const betrayedBondId of betrayedBonds) {
    const betrayed = gs.relationships.bonds[betrayedBondId];
    mutations.push({ bondId: betrayedBondId, before: { ...betrayed }, after: {
      points: 0, lastAdvancedDay: betrayed.lastAdvancedDay, exclusive: false, openAgreement: false, betrayalDay: meetingDay,
    } });
  }
  if (betrayedBonds.length) outcome = 'betrayal-discovered';
  return { bondId, day: meetingDay, outcome, action, witnesses: uniqueWitnesses, mutations };
}

/** Apply all previously logged meeting mutations atomically, or accept their exact already-applied state. */
export function recordResidentBondMeeting(effect: ResidentMeetingEffect): boolean {
  const states = effect.mutations.map(mutation => {
    const current = GameState.instance.relationships.bonds[mutation.bondId];
    if (!current) throw new Error(`Relationships: unknown resident bond ${mutation.bondId}`);
    return { mutation, current };
  });
  if (states.every(({ mutation, current }) => sameBond(current, mutation.after))) return false;
  if (states.some(({ mutation, current }) => !sameBond(current, mutation.before))) {
    throw new Error(`Relationships: meeting ${effect.day}:${effect.bondId} conflicts with bond state`);
  }
  for (const { mutation } of states) GameState.instance.relationships.bonds[mutation.bondId] = { ...mutation.after };
  return true;
}

/** Apply positive points with the deliberate NPC-partner difficulty while negative reactions remain exact. */
function applyPoints(id: ResidentId, delta: number): number {
  const state = GameState.instance.relationships.residents[id];
  const adjusted = delta > 0 && npcPartnerFor(id) !== null ? Math.max(1, Math.round(delta * 0.5)) : delta;
  state.points = Math.max(0, Math.min(MAX_RELATIONSHIP_POINTS, state.points + adjusted));
  return adjusted;
}

/**
 * Add friendship earned outside Talk and gifts (for example a finished guild-board job).
 * @param id the resident
 * @param points positive whole points to add (partner rules in applyPoints still apply)
 * @returns the points actually applied
 */
export function grantResidentFriendship(id: ResidentId, points: number): number {
  residentRelationshipProfile(id);
  if (!Number.isSafeInteger(points) || points <= 0) throw new Error(`Relationships: invalid friendship grant ${points}`);
  return applyPoints(id, points);
}

/** Talk on any day; only the first conversation that day earns friendship points. */
export function talkToResident(id: ResidentId): { line: string; points: number; hearts: number } {
  const gs = GameState.instance, profile = residentRelationshipProfile(id), state = gs.relationships.residents[id];
  const gained = state.lastTalkDay === gs.day ? 0 : applyPoints(id, 20);
  if (state.lastTalkDay !== gs.day) state.lastTalkDay = gs.day;
  const lines = profile.dialogue[dialogueTier(state.points, state.romanceStage)];
  const line = lines[state.conversationCount % lines.length];
  state.conversationCount++;
  return { line, points: gained, hearts: pointsToHearts(state.points) };
}

/** Give one selected inventory item after every quota and data check succeeds. */
export function giveGiftToResident(id: ResidentId, item: string): GiftResult {
  const gs = GameState.instance, profile = residentRelationshipProfile(id), state = gs.relationships.residents[id];
  const itemDef = ITEM_CATALOG[item];
  if (!itemDef) throw new Error(`Relationships: unknown item ${item}`);
  if (itemDef.category === 'Placeable' || item === 'broom') throw new Error(`${profile.id} cannot receive ${itemDef.label} as a gift`);
  if (!Object.prototype.hasOwnProperty.call(gs.inventory, item) || gs.inventory[item] < 1) throw new Error(`Relationships: ${itemDef.label} is not in the bag`);
  if (state.lastGiftDay === gs.day) return { accepted: false, line: 'We already exchanged a gift today.', taste: null,
    points: 0, hearts: pointsToHearts(state.points) };
  const week = weekForDay(gs.day);
  const used = state.giftWeek === week ? state.giftsThisWeek : 0;
  if (used >= GIFTS_PER_WEEK) return { accepted: false, line: 'Let us wait until next week before another gift.', taste: null,
    points: 0, hearts: pointsToHearts(state.points) };
  const taste = residentGiftTaste(id, item);
  const delta = { love: 80, like: 45, neutral: 10, dislike: -30, hate: -60 }[taste];
  if (!gs.removeItem(item, 1)) throw new Error(`Relationships: failed to remove ${itemDef.label}`);
  state.giftWeek = week; state.giftsThisWeek = used + 1; state.lastGiftDay = gs.day;
  const applied = applyPoints(id, delta);
  const reaction = { love: `I love this. You remembered.`, like: `This is lovely. Thank you.`, neutral: `Thank you. That was thoughtful.`,
    dislike: `I appreciate the thought, but this is not really for me.`, hate: `Please do not bring me this again.` }[taste];
  return { accepted: true, line: reaction, taste, points: applied, hearts: pointsToHearts(state.points) };
}

/** Return whether a selected belt item is a valid gift category. */
export function isGiftableItem(item: string | null): item is string {
  if (item === null) return false;
  const definition = ITEM_CATALOG[item];
  if (!definition) throw new Error(`Relationships: unknown selected item ${item}`);
  return definition.category !== 'Placeable' && item !== 'broom';
}

/** Advance one explicit romance step. NPC exclusivity raises requirements but never closes the route. */
export function expressInterestInResident(id: ResidentId): { changed: boolean; line: string; stage: RomanceStage } {
  const state = GameState.instance.relationships.residents[id], partner = npcPartnerFor(id);
  const hearts = pointsToHearts(state.points), offset = partner === null ? 0 : 3;
  const next: Record<RomanceStage, { stage: RomanceStage; hearts: number }> = {
    friends: { stage: 'interested', hearts: 4 + offset }, interested: { stage: 'dating', hearts: 6 + offset },
    dating: { stage: 'committed', hearts: 10 }, committed: { stage: 'committed', hearts: 10 },
  };
  const target = next[state.romanceStage];
  if (state.romanceStage === 'committed') return { changed: false, line: 'You are already committed to each other.', stage: state.romanceStage };
  if (hearts < target.hearts) return { changed: false,
    line: partner === null ? `Grow closer first. This step needs ${target.hearts} hearts.`
      : `This route stays open, but their relationship makes it harder. Reach ${target.hearts} hearts first.`, stage: state.romanceStage };
  state.romanceStage = target.stage;
  if (target.stage === 'committed') {
    const committed = Object.values(GameState.instance.relationships.residents).filter(record => record.romanceStage === 'committed');
    if (committed.length > 1) for (const record of committed) record.complicated = true;
  }
  return { changed: true, line: target.stage === 'interested' ? 'They understand that your feelings are more than friendly.'
    : target.stage === 'dating' ? 'You agree to begin seeing each other.' : 'You choose a committed relationship together.', stage: target.stage };
}

/**
 * Legacy-compatible direct day advancement used by tests and old callers.
 * New world flow records an authored social event before calling recordResidentBondMeeting.
 */
export function advanceRelationshipsToDay(day: number): void {
  weekForDay(day);
  const gs = GameState.instance;
  if (day !== gs.day) throw new Error(`Relationships: calendar ${gs.day} does not match requested day ${day}`);
  throw new Error('Relationships: direct all-bond advancement is unavailable; sync the authored daily Town meetings instead');
}

/** Return one resident's eleven bonds in Town resident order without exposing hidden tastes. */
export function residentBondJournal(selectedId: ResidentId): ResidentBondView[] {
  residentRelationshipProfile(selectedId);
  const state = GameState.instance.relationships;
  return TOWN_RESIDENTS.filter(resident => resident.id !== selectedId).map(other => {
    const id = residentBondId(selectedId, other.id);
    const profile = RESIDENT_BONDS.find(candidate => candidate.id === id);
    if (!profile) throw new Error(`Relationships: missing resident bond ${id}`);
    const names = profile.residents.map(id => {
      const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
      if (!resident) throw new Error(`Relationships: missing resident ${id}`);
      return resident.name;
    }) as [string, string];
    const bond = state.bonds[profile.id];
    const romanticPotential = residentBondHasRomanticPotential(profile.id, state.socialSeed);
    const secret = bond.exclusive && !bond.openAgreement && profile.residents.some(residentId => RESIDENT_BONDS.some(other =>
      other.id !== profile.id && other.residents.includes(residentId) && state.bonds[other.id].exclusive
      && !state.bonds[other.id].openAgreement));
    return { id: profile.id, residents: [...profile.residents] as [ResidentId, ResidentId], names,
      points: bond.points, stage: residentBondStage(bond, romanticPotential), exclusive: bond.exclusive,
      openAgreement: bond.openAgreement, secret, betrayalDay: bond.betrayalDay, lastMeetingDay: bond.lastAdvancedDay };
  });
}

/** Return detached public progress for journal and guarded local-chat context. */
export function relationshipView(id: ResidentId): RelationshipView {
  const gs = GameState.instance, profile = residentRelationshipProfile(id), resident = RESIDENT_RELATIONSHIPS.find(entry => entry.id === id);
  if (!resident) throw new Error(`Relationships: missing public profile ${id}`);
  const definition = TOWN_RESIDENTS.find(entry => entry.id === id);
  if (!definition) throw new Error(`Relationships: missing town resident ${id}`);
  const state = gs.relationships.residents[id], week = weekForDay(gs.day);
  return { id, name: definition.name, bio: profile.bio, traits: [...profile.traits] as [string, string, string],
    hearts: pointsToHearts(state.points), points: state.points, romanceStage: state.romanceStage,
    relationshipStyle: profile.relationshipStyle, npcPartnerId: npcPartnerFor(id), talkedToday: state.lastTalkDay === gs.day,
    giftedToday: state.lastGiftDay === gs.day, giftsThisWeek: state.giftWeek === week ? state.giftsThisWeek : 0,
    complicated: state.complicated };
}

/** Return all journal entries in the stable authored town order. */
export function relationshipJournal(): RelationshipView[] {
  return RESIDENT_RELATIONSHIPS.map(profile => relationshipView(profile.id));
}
