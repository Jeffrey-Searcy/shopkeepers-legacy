/** Optional local character chat client (same-origin `/chat`, forwarded by the dev server) with strict speech-only response validation. */
import { residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { townSocialPairForResidents } from '../config/TownSchedules';
import { GameState } from '../state/GameState';
import { SettingsSystem } from './SettingsSystem';
import { relationshipView, type ResidentSocialAction } from './RelationshipSystem';
import { residentBoundaryContext, type ResidentChatOutcome } from './JusticeSystem';
import type { CuddleKind } from '../config/Cuddle';
import type { ResidentGiftMemory } from './ResidentGiftMemorySystem';
import { isChatOfferId, type ChatOfferId } from '../config/ResidentChatOffers';
import { residentChatWorld } from './ResidentChatContextSystem';

/**
 * Same-origin chat path. The dev server forwards `/chat*` to the local chat bridge, so the game works
 * the same on the Mac (localhost) and on the iPad (Tailscale HTTPS) without cross-origin requests.
 */
const LOCAL_CHAT_URL = '/chat';
export const MAX_MESSAGE_LENGTH = 120;
export const MAX_REPLY_LENGTH = 320;
export const MAX_HISTORY_TURNS = 6;
export const MAX_CHAT_SUMMARY_LENGTH = 600;
export const MAX_SOCIAL_LINE_LENGTH = 180;
/** Fewest and most lines in one model-written resident scene. */
export const MIN_SCENE_LINES = 4;
export const MAX_SCENE_LINES = 6;
/** Fewest and most resident lines in one model-written group-chat turn. */
export const MIN_GROUP_LINES = 2;
export const MAX_GROUP_LINES = 4;
/** Smallest and largest group seated for one group chat. Pairs use chatBetweenResidents instead. */
export const MIN_GROUP_RESIDENTS = 3;
export const MAX_GROUP_RESIDENTS = 5;
/** Most recent group turns sent with one request. Trimming older turns is the caller's job. */
export const MAX_GROUP_HISTORY_TURNS = 8;

/** One prior line in the active face-to-face conversation. */
export interface LocalChatTurn {
  role: 'player' | 'resident';
  text: string;
}

/** Strict response consumed by resident dialogue. Speech and the game-owned outcome stay separate. */
export interface LocalResidentChatReply {
  reply: string;
  outcome: ResidentChatOutcome;
  intimateTopic: boolean;
  /**
   * An offer the resident made in this reply's words, or 'none'. Always one of the ids the game
   * sent; the game still re-checks it before showing buttons (see ResidentOfferSystem).
   */
  offer: ChatOfferId | 'none';
}

/** Most offers sent with one turn. Matches MAX_RESIDENT_OFFERS in scripts/npc-chat-supervisor.mjs. */
export const MAX_CHAT_OFFERS = 4;

/** Strict in-character decision returned by the existing local bridge. */
export interface LocalCuddleDecision {
  accepted: boolean;
  reason: string;
}

/**
 * Read-only context for one witnessed resident-to-resident scene. The supervisor reads both
 * residents' character sheets itself; the game sends only what changes day to day.
 */
export interface LocalResidentSceneContext {
  day: number;
  weekday: string;
  bondStatus: 'new-neighbors' | 'friends' | 'close-friends' | 'attracted' | 'partners' | 'open-partners' | 'hurt';
  stage: 'conversation' | 'became-partners' | 'secret-romance' | 'opened-relationship' | 'betrayal-discovered';
  action: ResidentSocialAction;
  location: string;
  /** Up to three short summaries of this pair's earlier meetings. */
  sharedHistory: readonly string[];
  /** Pair member who speaks first. */
  opener: ResidentId;
  /** Kebab-case id of the opener's topic of the day (see ResidentCharacterSheets.json). */
  topicId: string;
  /** Up to three short town-news sentences either resident knows. */
  townNews: readonly string[];
  weather: 'sunny' | 'rain';
  season: 'spring' | 'summer' | 'fall' | 'winter';
}

/** One model-written scene line, already checked for speaker order. */
export interface LocalResidentSceneLine { residentId: ResidentId; text: string }

/** Read-only facts for one evening group chat. The supervisor reads each resident's persona itself. */
export interface LocalGroupChatContext {
  /** Where the group sits, 1-60 characters. */
  place: string;
  /** What just happened, 0-180 characters (empty when nothing notable did). */
  event: string;
  /** Up to five short one-line topics the group may pick from. */
  topics: string[];
  /** Up to three short town-news sentences the group may know. */
  news: string[];
}

/** One earlier line in the group conversation, spoken by the player or a seated resident. */
export interface LocalGroupChatTurn { speaker: ResidentId | 'player'; text: string }

/** Error text chatInGroup throws when its caller cancelled the request on purpose. */
export const GROUP_CHAT_CANCELLED = 'Local group chat was cancelled.';

/**
 * Check one short model-visible sentence list.
 * @param value list to check
 * @param max most entries allowed
 * @param maxLength longest entry allowed
 */
function safeTextList(value: unknown, max: number, maxLength: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every(line => typeof line === 'string' && line.trim().length > 0
    && line.length <= maxLength && !/[{}\[\]\r\n]/.test(line));
}

/** Validate model-visible gift facts that came from the game's verified accepted-gift store. */
function cleanGiftMemory(gifts: readonly ResidentGiftMemory[]): ResidentGiftMemory[] {
  if (!Array.isArray(gifts) || gifts.length > 6) throw new Error('Resident gift context is invalid.');
  return gifts.map(gift => {
    if (!gift || typeof gift !== 'object' || Object.keys(gift).sort().join(',') !== 'day,itemId,label,taste'
      || typeof gift.itemId !== 'string' || !gift.itemId.trim() || gift.itemId.length > 80
      || typeof gift.label !== 'string' || !gift.label.trim() || gift.label.length > 80
      || !['love', 'like', 'neutral', 'dislike', 'hate'].includes(gift.taste)
      || !Number.isSafeInteger(gift.day) || gift.day < 1 || /[{}\[\]\r\n]/.test(`${gift.itemId}${gift.label}`)) {
      throw new Error('Resident gift context is invalid.');
    }
    return { itemId: gift.itemId.trim(), label: gift.label.trim(), taste: gift.taste, day: gift.day };
  });
}

/** Snapshot model-protected state only around synchronous response parsing, never across world time. */
function protectedGameplaySnapshot(): string {
  const gs = GameState.instance;
  return JSON.stringify({ relationships: gs.relationships, inventory: gs.inventory, gold: gs.gold });
}

/**
 * Ensure local model output is short dialogue and not a command-shaped payload.
 * @param value parsed response body
 * @param offers offer ids this request allowed; the reply may name only one of these, or 'none'
 */
function validateReply(value: unknown, offers: readonly ChatOfferId[]): LocalResidentChatReply {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'intimateTopic,offer,outcome,reply') {
    throw new Error('Local character chat returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const reply = record.reply;
  if (typeof reply !== 'string' || !reply.trim() || reply.length > MAX_REPLY_LENGTH || /[{}\[\]\r\n]/.test(reply)) {
    throw new Error('Local character chat returned invalid dialogue.');
  }
  const outcome = record.outcome;
  if (outcome !== 'continue' && outcome !== 'warning' && outcome !== 'end-conversation' && outcome !== 'call-guard') {
    throw new Error('Local character chat returned an invalid outcome.');
  }
  if (typeof record.intimateTopic !== 'boolean') throw new Error('Local character chat returned an invalid topic check.');
  const offer = record.offer;
  if (offer !== 'none' && !(isChatOfferId(offer) && offers.includes(offer))) throw new Error('Local character chat returned an offer it was not allowed.');
  // why: the server already forces 'none' when the resident warns or leaves; a mismatch means a broken bridge.
  if (offer !== 'none' && outcome !== 'continue') throw new Error('Local character chat paired an offer with a boundary outcome.');
  return { reply: reply.trim(), outcome, intimateTopic: record.intimateTopic, offer };
}

/** Validate an offer decision without accepting narration, commands, or missing reasons. */
function validateCuddleDecision(value: unknown): LocalCuddleDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'accepted,reason') {
    throw new Error('Local character returned an invalid private-moment response.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.accepted !== 'boolean' || typeof record.reason !== 'string' || !record.reason.trim()
    || record.reason.length > 180 || /[{}\[\]\r\n]/.test(record.reason)) {
    throw new Error('Local character returned invalid private-moment dialogue.');
  }
  return { accepted: record.accepted, reason: record.reason.trim() };
}

/**
 * Ask the optional local model for speech. This function never writes progress, inventory, or romance state.
 * @param id resident to talk to
 * @param message the keeper's newest line
 * @param history completed earlier exchanges in this conversation
 * @param summary condensed memory of older conversations
 * @param recentGifts verified gifts the resident may remember
 * @param offers real offers the game allows this turn (ResidentOfferSystem.eligibleOffers); empty means none
 * @returns validated speech, outcome, topic flag, and the offer named in words (or 'none')
 */
export async function chatWithResident(id: ResidentId, message: string, history: readonly LocalChatTurn[] = [], summary = '',
  recentGifts: readonly ResidentGiftMemory[] = [], offers: readonly ChatOfferId[] = []): Promise<LocalResidentChatReply> {
  if (!SettingsSystem.get().localNpcChat) throw new Error('Local character chat is off. Turn it on in Relationships.');
  residentRelationshipProfile(id);
  const clean = message.trim();
  if (!clean || clean.length > MAX_MESSAGE_LENGTH) throw new Error(`Say between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  if (history.length > MAX_HISTORY_TURNS) throw new Error(`Chat history exceeds ${MAX_HISTORY_TURNS} turns.`);
  const cleanHistory = history.map((turn, index) => {
    const expectedRole = index % 2 === 0 ? 'player' : 'resident';
    if (turn.role !== expectedRole || typeof turn.text !== 'string' || !turn.text.trim()) {
      throw new Error('Chat history is invalid.');
    }
    const limit = turn.role === 'player' ? MAX_MESSAGE_LENGTH : MAX_REPLY_LENGTH;
    if (turn.text.length > limit || /[\r\n]/.test(turn.text)) throw new Error('Chat history is invalid.');
    return { role: turn.role, text: turn.text.trim() };
  });
  if (cleanHistory.length % 2 !== 0) throw new Error('Chat history must contain completed exchanges.');
  const cleanSummary = summary.trim();
  if (cleanSummary.length > MAX_CHAT_SUMMARY_LENGTH || /[{}\[\]\r\n]/.test(cleanSummary)) throw new Error('Chat memory summary is invalid.');
  const gifts = cleanGiftMemory(recentGifts);
  if (offers.length > MAX_CHAT_OFFERS || new Set(offers).size !== offers.length || offers.some(offer => !isChatOfferId(offer))) {
    throw new Error('Chat offers are invalid.');
  }
  const world = residentChatWorld(id);
  const controller = new AbortController();
  // The first local turn may load several gigabytes into unified memory; later turns stay warm.
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  let payload: unknown = null;
  let errorBody = '';
  try {
    response = await fetch(LOCAL_CHAT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ residentId: id, message: clean, history: cleanHistory,
        summary: cleanSummary, context: { ...relationshipView(id), ...residentBoundaryContext(id), recentGifts: gifts,
          world, offers: [...offers] } }),
    });
    if (response.ok) payload = await response.json() as unknown;
    else errorBody = await response.text();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Local character chat returned invalid JSON.');
    throw new Error('Local character chat is unavailable. Start it with npm run npc-chat:local.');
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`Local character chat failed (${response.status}): ${errorBody.slice(0, 160)}`);
  }
  // World time and authored social events may change state while fetch waits. Guard only the
  // synchronous payload-validation boundary, where model output is consumed as speech.
  const before = protectedGameplaySnapshot();
  const reply = validateReply(payload, offers);
  const after = protectedGameplaySnapshot();
  if (after !== before) throw new Error('Local character chat changed protected game state.');
  return reply;
}

/** Ask the current NPC to accept or deny one contextual Cuddle offer. Game code owns all effects. */
export async function askResidentCuddle(id: ResidentId, kind: CuddleKind, history: readonly LocalChatTurn[],
  dialogueRevision: number): Promise<LocalCuddleDecision> {
  const settings = SettingsSystem.get();
  if (!settings.localNpcChat) throw new Error('Local character chat is off. Turn it on in Relationships.');
  const profile = residentRelationshipProfile(id);
  if (profile.adult !== true || profile.romanceable !== true) throw new Error('This resident is not eligible for a private moment.');
  if (!Number.isSafeInteger(dialogueRevision) || dialogueRevision < 1) throw new Error('Private-moment dialogue revision is invalid.');
  const relation = relationshipView(id);
  if (relation.romanceStage !== 'dating' && relation.romanceStage !== 'committed') {
    throw new Error('This private moment requires a dating or committed relationship.');
  }
  if (history.length > MAX_HISTORY_TURNS || history.length % 2 !== 0) throw new Error('Private-moment chat history is invalid.');
  const cleanHistory = history.map((turn, index) => {
    const expectedRole = index % 2 === 0 ? 'player' : 'resident';
    if (turn.role !== expectedRole || typeof turn.text !== 'string' || !turn.text.trim()) throw new Error('Private-moment chat history is invalid.');
    return { role: turn.role, text: turn.text.trim() };
  });
  const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  let payload: unknown = null;
  let errorBody = '';
  try {
    response = await fetch(`${LOCAL_CHAT_URL}/cuddle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ residentId: id, dialogueRevision, history: cleanHistory, offer: kind,
        context: { hearts: relation.hearts, romanceStage: relation.romanceStage,
          mood: GameState.instance.cuddle.moodBoosts[id] ?? 0, risky: kind === 'standing' } }),
    });
    if (response.ok) payload = await response.json() as unknown;
    else errorBody = await response.text();
  } catch {
    throw new Error('Local character chat is unavailable. Start it with npm run npc-chat:local.');
  } finally { window.clearTimeout(timeout); }
  if (!response.ok) {
    if (response.status === 404) throw new Error('The local voice bridge is out of date. Restart it to enable private-moment decisions.');
    throw new Error(`Local private-moment decision failed (${response.status}): ${errorBody.slice(0, 140)}`);
  }
  const before = protectedGameplaySnapshot(), decision = validateCuddleDecision(payload), after = protectedGameplaySnapshot();
  if (after !== before) throw new Error('Local private-moment decision changed protected game state.');
  return decision;
}

/** Ask the localhost model to condense old speech into factual, bounded character memory. */
export async function compactResidentChat(id: ResidentId, summary: string, history: readonly LocalChatTurn[]): Promise<string> {
  if (!SettingsSystem.get().localNpcChat) throw new Error('Local character chat is off. Turn it on in Town Bonds.');
  residentRelationshipProfile(id);
  const cleanSummary = summary.trim();
  if (cleanSummary.length > MAX_CHAT_SUMMARY_LENGTH || /[{}\[\]\r\n]/.test(cleanSummary)) throw new Error('Chat memory summary is invalid.');
  if (history.length === 0 || history.length > 40 || history.length % 2 !== 0) throw new Error('Chat notes cannot be compacted.');
  const cleanHistory = history.map((turn, index) => {
    const expectedRole = index % 2 === 0 ? 'player' : 'resident';
    const limit = expectedRole === 'player' ? MAX_MESSAGE_LENGTH : MAX_REPLY_LENGTH;
    if (turn.role !== expectedRole || typeof turn.text !== 'string' || !turn.text.trim()
      || turn.text.length > limit || /[\r\n]/.test(turn.text)) throw new Error('Chat notes cannot be compacted.');
    return { role: turn.role, text: turn.text.trim() };
  });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  let payload: unknown = null;
  let errorBody = '';
  try {
    response = await fetch(`${LOCAL_CHAT_URL}/compact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ residentId: id, summary: cleanSummary, history: cleanHistory }),
    });
    if (response.ok) payload = await response.json() as unknown;
    else errorBody = await response.text();
  } catch {
    throw new Error('Local character chat is unavailable. Start it with npm run npc-chat:local.');
  } finally { window.clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Chat compaction failed (${response.status}): ${errorBody.slice(0, 160)}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).join(',') !== 'summary') {
    throw new Error('Chat compaction returned an invalid response.');
  }
  const compacted = (payload as Record<string, unknown>).summary;
  if (typeof compacted !== 'string' || !compacted.trim() || compacted.length > MAX_CHAT_SUMMARY_LENGTH
    || /[{}\[\]\r\n]/.test(compacted)) throw new Error('Chat compaction returned an invalid summary.');
  return compacted.trim();
}

/**
 * Ask the shared local model for one 4-6 line scene between two residents, without granting any
 * game authority. Lines alternate speakers and start with `context.opener`.
 * @param bondId canonical pair id
 * @param first pair member listed first in the pair id
 * @param second pair member listed second
 * @param context today's facts for the scene
 * @returns the validated lines in speaking order
 * @throws when the bridge is off, unreachable, or returns anything outside the contract
 */
export async function chatBetweenResidents(bondId: string, first: ResidentId, second: ResidentId,
  context: LocalResidentSceneContext): Promise<LocalResidentSceneLine[]> {
  if (!SettingsSystem.get().localNpcChat) throw new Error('Local character chat is off. Turn it on in Town Bonds.');
  const pair = townSocialPairForResidents(first, second);
  if (pair.id !== bondId || pair.residents[0] !== first || pair.residents[1] !== second) {
    throw new Error(`Local resident scene does not match social bond ${bondId}.`);
  }
  if (!Number.isSafeInteger(context.day) || context.day < 1 || typeof context.weekday !== 'string'
    || !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(context.weekday)
    || !['new-neighbors', 'friends', 'close-friends', 'attracted', 'partners', 'open-partners', 'hurt'].includes(context.bondStatus)
    || !['conversation', 'became-partners', 'secret-romance', 'opened-relationship', 'betrayal-discovered'].includes(context.stage)
    || !['friendly-chat', 'flirt', 'embrace', 'kiss', 'define-relationship', 'discuss-boundaries'].includes(context.action)
    || typeof context.location !== 'string' || !context.location.trim() || context.location.length > 80
    || /[{}\[\]\r\n]/.test(context.location) || !safeTextList(context.sharedHistory, 3, 360)
    || (context.opener !== first && context.opener !== second)
    || typeof context.topicId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(context.topicId) || context.topicId.length > 48
    || !safeTextList(context.townNews, 3, 160) || !['sunny', 'rain'].includes(context.weather)
    || !['spring', 'summer', 'fall', 'winter'].includes(context.season)) throw new Error('Local resident scene context is invalid.');
  const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  let payload: unknown = null;
  let errorBody = '';
  try {
    response = await fetch(`${LOCAL_CHAT_URL}/scene`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ bondId, first, second, context: { ...context, location: context.location.trim(),
        sharedHistory: context.sharedHistory.map(line => line.trim()), townNews: context.townNews.map(line => line.trim()) } }),
    });
    if (response.ok) payload = await response.json() as unknown;
    else errorBody = await response.text();
  } catch {
    throw new Error('Local resident conversation is unavailable. Start it with npm run npc-chat:local.');
  } finally { window.clearTimeout(timeout); }
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('The local voice bridge is out of date. Restart it with npm run npc-chat:local.');
    }
    throw new Error(`Local resident conversation failed (${response.status}): ${errorBody.slice(0, 120)}`);
  }
  // A meeting request can overlap normal world updates. Only parsing the returned speech must be
  // state-neutral; comparing across the network wait would reject legitimate schedule progress.
  const before = protectedGameplaySnapshot();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).join(',') !== 'lines') {
    throw new Error('Local resident conversation returned an invalid response.');
  }
  const lines = (payload as Record<string, unknown>).lines;
  if (!Array.isArray(lines) || lines.length < MIN_SCENE_LINES || lines.length > MAX_SCENE_LINES) {
    throw new Error('Local resident conversation returned invalid lines.');
  }
  const listener = context.opener === first ? second : first;
  const parsed = lines.map((line, index): LocalResidentSceneLine => {
    // why: speakers must alternate, opener first, so the bubble above each head matches the words.
    const expected = index % 2 === 0 ? context.opener : listener;
    if (!line || typeof line !== 'object' || Array.isArray(line) || Object.keys(line).sort().join(',') !== 'residentId,text') {
      throw new Error('Local resident conversation returned an invalid line.');
    }
    const record = line as Record<string, unknown>;
    if (record.residentId !== expected || typeof record.text !== 'string' || !record.text.trim()
      || record.text.length > MAX_SOCIAL_LINE_LENGTH || /[{}\[\]\r\n]/.test(record.text)) {
      throw new Error('Local resident conversation returned invalid dialogue.');
    }
    return { residentId: expected, text: record.text.trim() };
  });
  const after = protectedGameplaySnapshot();
  if (after !== before) throw new Error('Local resident conversation changed protected game state.');
  return parsed;
}

/**
 * Ask the shared local model for 2-4 lines of one evening group chat between 3-5 residents with the
 * player present. The model only writes words; the game owns every outcome.
 * @param residentIds 3-5 distinct residents seated in the group
 * @param context the place, what just happened, and optional topics and news
 * @param history at most the last 8 turns (the caller trims older turns)
 * @param playerLine what the player says this turn, or '' when the player says nothing
 * @param cancel optional signal; aborting it stops the request and throws GROUP_CHAT_CANCELLED
 * @param onLine optional callback that gets each checked line as soon as the bridge streams it, so the
 *   table can show the first speaker while the model still writes the rest. When the call later throws,
 *   the lines already passed to onLine stay valid on their own; the caller decides how to show the failure.
 * @returns the validated lines in speaking order; the same resident never speaks twice in a row
 * @throws when the bridge is off, unreachable, the inputs are invalid, or the reply breaks the contract
 */
export async function chatInGroup(residentIds: readonly ResidentId[], context: LocalGroupChatContext,
  history: readonly LocalGroupChatTurn[], playerLine: string, cancel?: AbortSignal,
  onLine?: (line: LocalResidentSceneLine) => void): Promise<LocalResidentSceneLine[]> {
  if (!SettingsSystem.get().localNpcChat) throw new Error('Local character chat is off. Turn it on in Town Bonds.');
  if (!Array.isArray(residentIds) || residentIds.length < MIN_GROUP_RESIDENTS || residentIds.length > MAX_GROUP_RESIDENTS
    || new Set(residentIds).size !== residentIds.length) {
    throw new Error(`Local group chat needs ${MIN_GROUP_RESIDENTS}-${MAX_GROUP_RESIDENTS} distinct residents.`);
  }
  residentIds.forEach(id => residentRelationshipProfile(id));
  if (!context || typeof context !== 'object' || Object.keys(context).sort().join(',') !== 'event,news,place,topics'
    || typeof context.place !== 'string' || !context.place.trim() || context.place.length > 60 || /[{}\[\]\r\n]/.test(context.place)
    || typeof context.event !== 'string' || context.event.length > 180 || /[{}\[\]\r\n]/.test(context.event)
    || !safeTextList(context.topics, 5, 180) || !safeTextList(context.news, 3, 180)) {
    throw new Error('Local group chat context is invalid.');
  }
  if (history.length > MAX_GROUP_HISTORY_TURNS) throw new Error(`Local group chat history exceeds ${MAX_GROUP_HISTORY_TURNS} turns.`);
  const cleanHistory = history.map(turn => {
    const limit = turn.speaker === 'player' ? MAX_MESSAGE_LENGTH : MAX_SOCIAL_LINE_LENGTH;
    if ((turn.speaker !== 'player' && !residentIds.includes(turn.speaker)) || typeof turn.text !== 'string' || !turn.text.trim()
      || turn.text.length > limit || /[\r\n]/.test(turn.text)) {
      throw new Error('Local group chat history is invalid.');
    }
    return { speaker: turn.speaker, text: turn.text.trim() };
  });
  // why: '' is the explicit "the player said nothing this turn" signal, so only a non-empty line is length-checked.
  if (typeof playerLine !== 'string' || playerLine.trim().length > MAX_MESSAGE_LENGTH || /[\r\n]/.test(playerLine)) {
    throw new Error(`Say at most ${MAX_MESSAGE_LENGTH} characters.`);
  }
  const cleanLine = playerLine.trim();
  if (cancel?.aborted) throw new Error(GROUP_CHAT_CANCELLED);
  // why: the timeout covers the whole stream, not just the first byte, so a stalled model still fails loudly.
  const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 45_000);
  // why: the Wayfarer table cancels a pre-generated turn when the keeper acts first; the bridge then stops the model.
  const onCancel = () => controller.abort();
  cancel?.addEventListener('abort', onCancel, { once: true });
  /** Turn a network failure into the cancel signal or one clear "unavailable" message. */
  const networkError = (message: string) => cancel?.aborted ? new Error(GROUP_CHAT_CANCELLED) : new Error(message);
  try {
    let response: Response;
    try {
      response = await fetch(`${LOCAL_CHAT_URL}/group`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ residentIds: [...residentIds], history: cleanHistory, playerLine: cleanLine,
          context: { place: context.place.trim(), event: context.event.trim(),
            topics: context.topics.map(line => line.trim()), news: context.news.map(line => line.trim()) } }),
      });
    } catch { throw networkError('Local group chat is unavailable. Start it with npm run npc-chat:local.'); }
    if (!response.ok) {
      let errorBody: string;
      try { errorBody = await response.text(); } catch { throw networkError('Local group chat broke off before it answered.'); }
      if (response.status === 404) {
        throw new Error('The local voice bridge is out of date. Restart it with npm run npc-chat:local.');
      }
      throw new Error(`Local group chat failed (${response.status}): ${errorBody.slice(0, 120)}`);
    }
    if (response.headers.get('Content-Type') !== 'application/x-ndjson' || !response.body) {
      throw new Error('The local voice bridge is out of date. Restart it with npm run npc-chat:local.');
    }
    const parsed: LocalResidentSceneLine[] = [];
    let finished = false;
    /**
     * Check one NDJSON event from the bridge: a line, the done marker, or a late error.
     * A group request can overlap normal world updates, so only the parsing of each line must be
     * state-neutral; comparing across the network wait would reject legitimate schedule progress.
     */
    const handleEvent = (raw: string) => {
      if (!raw.trim()) return;
      if (finished) throw new Error('Local group chat sent data after it finished.');
      let event: unknown;
      try { event = JSON.parse(raw) as unknown; } catch { throw new Error('Local group chat returned an invalid response.'); }
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Local group chat returned an invalid response.');
      const record = event as Record<string, unknown>;
      const keys = Object.keys(record).join(',');
      if (keys === 'error' && typeof record.error === 'string') throw new Error(`Local group chat failed: ${record.error.slice(0, 120)}`);
      if (keys === 'done' && record.done === true) {
        if (parsed.length < MIN_GROUP_LINES) throw new Error('Local group chat returned invalid lines.');
        finished = true;
        return;
      }
      if (keys !== 'line') throw new Error('Local group chat returned an invalid response.');
      const before = protectedGameplaySnapshot();
      const line = record.line;
      if (!line || typeof line !== 'object' || Array.isArray(line) || Object.keys(line).sort().join(',') !== 'residentId,text') {
        throw new Error('Local group chat returned an invalid line.');
      }
      const fields = line as Record<string, unknown>;
      const speaker = residentIds.find(id => id === fields.residentId);
      if (speaker === undefined || typeof fields.text !== 'string' || !fields.text.trim()
        || fields.text.length > MAX_SOCIAL_LINE_LENGTH || /[{}\[\]\r\n]/.test(fields.text)) {
        throw new Error('Local group chat returned invalid dialogue.');
      }
      // why: each line shows above one head in turn; a repeat speaker means the model broke the turn order.
      if (parsed.length > 0 && parsed[parsed.length - 1].residentId === speaker) {
        throw new Error('Local group chat repeated the same speaker twice in a row.');
      }
      if (parsed.length >= MAX_GROUP_LINES) throw new Error('Local group chat returned invalid lines.');
      const checked = { residentId: speaker, text: fields.text.trim() };
      if (protectedGameplaySnapshot() !== before) throw new Error('Local group chat changed protected game state.');
      parsed.push(checked);
      onLine?.(checked);
    };
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch { throw networkError('Local group chat broke off mid-turn.'); }
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        handleEvent(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    }
    handleEvent(buffered + decoder.decode());
    if (!finished) throw new Error('Local group chat ended before the turn was complete.');
    return parsed;
  } catch (error) {
    // why: stop the bridge (and so the model) when the game rejects a line mid-stream.
    controller.abort();
    throw error;
  } finally { window.clearTimeout(timeout); cancel?.removeEventListener('abort', onCancel); }
}
