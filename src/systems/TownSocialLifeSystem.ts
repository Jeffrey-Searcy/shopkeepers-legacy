/**
 * Bounded social history and event-first reconciliation for the dynamic resident network.
 *
 * Each daily meeting becomes one stored event: the exact relationship transition plus a short scene
 * (2-6 alternating lines; new scenes have 4-6). The opener brings up their topic of the day from
 * ResidentCharacterSheets.json and the listener reacts in their own voice, so the authored backup reads
 * like a real chat. The optional local model may rewrite only the words, never the outcome.
 *
 * To hide model delay, pregenerateUpcomingVoices() asks the model for scenes up to an hour before a
 * meeting starts. A matching result is used when the event is written; a failure is written as the
 * event's visible voice error. When a meeting is applied for the first time, its news goes to
 * TownLifeSystem so residents can gossip about it later.
 */
import { seasonForDay } from '../config/Crops';
import { residentTopicForDay } from '../config/ResidentCharacterSheets';
import { residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { townSocialPair, validateTownSchedules } from '../config/TownSchedules';
import { GameState } from '../state/GameState';
import { chatBetweenResidents, type LocalResidentSceneContext } from './LocalNpcChatSystem';
import { previewResidentBondMeeting, recordResidentBondMeeting, type ResidentBondMutation, type ResidentBondState,
  type ResidentMeetingEffect, type ResidentMeetingOutcome, type ResidentSocialAction } from './RelationshipSystem';
import { SaveSystem } from './SaveSystem';
import { SettingsSystem } from './SettingsSystem';
import { residentMeetingWindow, socialSpotLabel, townMeetingWitnesses, townMeetingsForDay,
  type DailyTownMeeting } from './TownScheduleSystem';
import { TownLifeSystem } from './TownLifeSystem';
import { townSocialNotesStorageKey } from './TownSocialStorage';
import { WeatherSystem } from './WeatherSystem';

export const MAX_TOWN_SOCIAL_EVENTS = 72;
export const MAX_TOWN_SOCIAL_LINE_LENGTH = 180;
/** Stored scenes may hold 2 lines (older saves) up to 6 lines. */
export const MIN_TOWN_SOCIAL_LINES = 2;
export const MAX_TOWN_SOCIAL_LINES = 6;
/** How early, in game minutes, a meeting's scene may be requested from the local model. */
export const TOWN_VOICE_LEAD_MINUTES = 60;

/** One line spoken by its exact resident. */
export interface TownSocialLine { residentId: ResidentId; text: string }

/** One logged meeting plus the exact authoritative transition that follows its write. */
export interface TownSocialEvent extends ResidentMeetingEffect {
  id: string;
  minute: number;
  locationId: string;
  /** 2-6 lines. Speakers alternate; the first speaker may be either pair member. */
  lines: readonly TownSocialLine[];
  source: 'authored' | 'local';
  voiceError: string | null;
}

interface TownSocialNotesStore { events: TownSocialEvent[] }

let activeVoiceEvent: string | null = null;
let syncedMinutesByState = new WeakMap<object, Map<number, number>>();
const attemptedVoiceEvents = new Set<string>();
const runtimeEnsuredEvents = new Set<string>();
/**
 * Model scenes fetched before their meeting started, keyed by voiceCacheKey(). Each holds either the
 * finished lines or the request's error, and is used once when the event is written.
 */
const pregeneratedVoices = new Map<string, { lines: readonly TownSocialLine[] } | { error: string }>();
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Bind optional words to the active save slot. */
function storageKey(): string {
  return townSocialNotesStorageKey(SaveSystem.currentSlot() ?? 'unslotted');
}

/** Scope process guards to one adventure. */
function runtimeEventKey(eventId: string): string {
  return `${storageKey()}::${eventId}`;
}

/** Validate one exact bond snapshot. */
function eventBondState(value: unknown, label: string, eventDay: number): ResidentBondState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Town social notes ${label} is invalid`);
  const state = value as Record<string, unknown>;
  if (Object.keys(state).sort().join(',') !== 'betrayalDay,exclusive,lastAdvancedDay,openAgreement,points'
    || !Number.isSafeInteger(state.points) || (state.points as number) < 0 || (state.points as number) > 250
    || !Number.isSafeInteger(state.lastAdvancedDay) || (state.lastAdvancedDay as number) < 0 || (state.lastAdvancedDay as number) > eventDay
    || typeof state.exclusive !== 'boolean' || typeof state.openAgreement !== 'boolean' || (state.openAgreement && !state.exclusive)) {
    throw new Error(`Town social notes ${label} is invalid`);
  }
  const betrayalDay = state.betrayalDay;
  if (betrayalDay !== null && (!Number.isSafeInteger(betrayalDay) || (betrayalDay as number) < 1 || (betrayalDay as number) > eventDay)) {
    throw new Error(`Town social notes ${label} betrayal day is invalid`);
  }
  return { points: state.points as number, lastAdvancedDay: state.lastAdvancedDay as number,
    exclusive: state.exclusive, openAgreement: state.openAgreement, betrayalDay: betrayalDay as number | null };
}

/** Validate one bond mutation and its canonical pair ID. */
function eventBondMutation(value: unknown, eventDay: number): ResidentBondMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Town social notes contain an invalid bond mutation');
  const mutation = value as Record<string, unknown>;
  if (Object.keys(mutation).sort().join(',') !== 'after,before,bondId' || typeof mutation.bondId !== 'string') {
    throw new Error('Town social notes contain an invalid bond mutation');
  }
  const pair = townSocialPair(mutation.bondId);
  return { bondId: pair.id, before: eventBondState(mutation.before, 'mutation before state', eventDay),
    after: eventBondState(mutation.after, 'mutation after state', eventDay) };
}

/**
 * Validate a scene's lines: 2-6 lines, alternating between the pair, opener either member.
 * @param value raw lines
 * @param residents the meeting pair
 */
function socialLines(value: unknown, residents: readonly [ResidentId, ResidentId]): TownSocialLine[] {
  if (!Array.isArray(value) || value.length < MIN_TOWN_SOCIAL_LINES || value.length > MAX_TOWN_SOCIAL_LINES) {
    throw new Error('Town social notes contain an invalid line count');
  }
  const first = value[0] && typeof value[0] === 'object' ? (value[0] as Record<string, unknown>).residentId : null;
  if (first !== residents[0] && first !== residents[1]) throw new Error('Town social notes contain an invalid line');
  const second = first === residents[0] ? residents[1] : residents[0];
  return value.map((line, index) => socialLine(line, index % 2 === 0 ? first as ResidentId : second));
}

/** Validate a speech line and its speaker. */
function socialLine(value: unknown, expected: ResidentId): TownSocialLine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Town social notes contain an invalid line');
  const line = value as Record<string, unknown>;
  if (Object.keys(line).sort().join(',') !== 'residentId,text' || line.residentId !== expected
    || typeof line.text !== 'string' || !line.text.trim() || line.text.length > MAX_TOWN_SOCIAL_LINE_LENGTH
    || /[{}\[\]\r\n]/.test(line.text)) throw new Error('Town social notes contain an invalid line');
  return { residentId: expected, text: line.text.trim() };
}

/** Validate one stored event without repairing unknown fields or residents. */
function socialEvent(value: unknown): TownSocialEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Town social notes contain an invalid event');
  const event = value as Record<string, unknown>;
  const fields = Object.keys(event).sort().join(',');
  if (fields === 'after,before,bondId,day,id,lines,locationId,minute,outcome,source,voiceError') {
    const actionByOutcome: Record<string, ResidentSocialAction> = {
      conversation: 'friendly-chat', 'became-partners': 'define-relationship', 'secret-romance': 'define-relationship',
      'opened-relationship': 'discuss-boundaries', 'betrayal-discovered': 'flirt',
    };
    const action = actionByOutcome[String(event.outcome)];
    if (!action) throw new Error('Town social notes legacy event outcome is invalid');
    const { before, after, ...shared } = event;
    return socialEvent({ ...shared, action, witnesses: [], mutations: [{ bondId: event.bondId, before, after }] });
  }
  if (fields !== 'action,bondId,day,id,lines,locationId,minute,mutations,outcome,source,voiceError,witnesses') {
    throw new Error('Town social notes event has unknown or missing fields');
  }
  if (typeof event.bondId !== 'string') throw new Error('Town social notes bond is invalid');
  const pair = townSocialPair(event.bondId);
  if (!Number.isSafeInteger(event.day) || (event.day as number) < 1 || event.id !== `${event.day}:${event.bondId}`
    || !Number.isSafeInteger(event.minute) || (event.minute as number) < 0 || (event.minute as number) > 1440
    || typeof event.locationId !== 'string' || !Array.isArray(event.lines)
    || !['conversation', 'became-partners', 'secret-romance', 'opened-relationship', 'betrayal-discovered'].includes(String(event.outcome))
    || !['friendly-chat', 'flirt', 'embrace', 'kiss', 'define-relationship', 'discuss-boundaries'].includes(String(event.action))
    || !Array.isArray(event.witnesses) || !Array.isArray(event.mutations) || event.mutations.length < 1
    || (event.source !== 'authored' && event.source !== 'local')
    || (event.voiceError !== null && (typeof event.voiceError !== 'string' || !event.voiceError.trim() || event.voiceError.length > 160))) {
    throw new Error('Town social notes event content is invalid');
  }
  socialSpotLabel(event.locationId);
  const witnesses = event.witnesses.map(value => {
    if (typeof value !== 'string') throw new Error('Town social notes contain an invalid witness');
    return residentRelationshipProfile(value as ResidentId).id;
  });
  if (new Set(witnesses).size !== witnesses.length || witnesses.some(id => pair.residents.includes(id))) {
    throw new Error('Town social notes contain duplicate or participating witnesses');
  }
  const mutations = event.mutations.map(value => eventBondMutation(value, event.day as number));
  if (mutations[0].bondId !== pair.id || new Set(mutations.map(mutation => mutation.bondId)).size !== mutations.length) {
    throw new Error('Town social notes contain unordered or duplicate bond mutations');
  }
  return { id: event.id as string, bondId: pair.id, day: event.day as number, minute: event.minute as number,
    locationId: event.locationId, outcome: event.outcome as ResidentMeetingOutcome,
    action: event.action as ResidentSocialAction, witnesses, mutations,
    lines: socialLines(event.lines, pair.residents),
    source: event.source as 'authored' | 'local', voiceError: event.voiceError as string | null };
}

/** Read one detached strict store. A missing valid store means no recorded conversations. */
function readStore(): TownSocialNotesStore {
  validateTownSchedules();
  const raw = localStorage.getItem(storageKey());
  if (raw === null) return { events: [] };
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error('Town social notes are not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Town social notes must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).join(',') !== 'events' || !Array.isArray(record.events) || record.events.length > MAX_TOWN_SOCIAL_EVENTS) {
    throw new Error('Town social notes have unknown, missing, or excessive events');
  }
  const events = record.events.map(socialEvent);
  if (new Set(events.map(event => event.id)).size !== events.length) throw new Error('Town social notes contain duplicate events');
  for (let index = 1; index < events.length; index++) {
    if (events[index - 1].day > events[index].day || (events[index - 1].day === events[index].day
      && events[index - 1].minute > events[index].minute)) throw new Error('Town social notes are not chronological');
  }
  return { events };
}

/** Validate and verify one complete bounded write. */
function writeStore(candidate: TownSocialNotesStore): TownSocialNotesStore {
  const detached = { events: candidate.events.map(socialEvent) };
  if (detached.events.length > MAX_TOWN_SOCIAL_EVENTS) throw new Error('Town social notes exceed their event limit');
  const raw = JSON.stringify(detached);
  localStorage.setItem(storageKey(), raw);
  if (localStorage.getItem(storageKey()) !== raw) throw new Error('Town social notes write verification failed');
  return detached;
}

/**
 * The resident who starts a meeting's conversation. Alternates by day so both get to lead.
 * @param meeting the meeting
 * @param day game day
 */
function sceneOpener(meeting: DailyTownMeeting, day: number): ResidentId {
  return meeting.residents[(day + meeting.meetingIndex) % 2];
}

/** Four authored lines (opener, listener, opener, listener) for each outcome that changes a bond. */
const OUTCOME_LINES: Partial<Record<ResidentMeetingOutcome, readonly [string, string, string, string]>> = {
  'became-partners': ['Can I tell you something? I have been thinking about us.', 'I was hoping you would bring it up. Go on.',
    'I do not want to keep pretending this is only friendship.', 'Good. Neither do I.'],
  'secret-romance': ['Can we stand somewhere a little quieter?', 'This is about us, is it not?',
    'This is becoming more than we planned.', 'Then we need to decide who deserves the truth.'],
  'opened-relationship': ['I have been thinking about what we want. Honestly.', 'Me too. Say it plainly.',
    'I want honesty, even when our hearts make room for someone else.', 'Then honesty is the promise we keep.'],
  'betrayal-discovered': ['You make an ordinary afternoon feel unusually interesting.', 'Careful. I might think you mean that.',
    'Someone saw us. We cannot pretend this changes nothing.', 'I should have been honest before now.'],
};

/** Closing pair (opener, listener) for romantic actions inside an ordinary conversation. */
const ACTION_CLOSERS: Partial<Record<ResidentSocialAction, readonly [string, string]>> = {
  flirt: ['You make an ordinary afternoon feel unusually interesting.', 'Careful. I might think you mean that.'],
  embrace: ['Stay here for one more moment.', 'I was hoping you would ask.'],
  kiss: ['I have wanted to do that all afternoon.', 'Then perhaps we should stop wasting daylight.'],
};

/**
 * Authored scene for one meeting. The opener tells today's topic in three beats and the listener
 * answers each beat with that topic's authored replies, so the scene stays on subject.
 * Bond-changing outcomes use their own four lines instead.
 * @param meeting the meeting
 * @param day game day
 * @param outcome the game-decided outcome
 * @param action the game-decided action
 * @returns 4 or 6 alternating lines, opener first
 */
function authoredLines(meeting: DailyTownMeeting, day: number, outcome: ResidentMeetingOutcome,
  action: ResidentSocialAction): TownSocialLine[] {
  const opener = sceneOpener(meeting, day), listener = meeting.residents[0] === opener ? meeting.residents[1] : meeting.residents[0];
  const speak = (texts: readonly string[]): TownSocialLine[] =>
    texts.map((text, index) => ({ residentId: index % 2 === 0 ? opener : listener, text }));
  const special = OUTCOME_LINES[outcome];
  if (special) return speak(special);
  const topic = residentTopicForDay(opener, day);
  const closer = ACTION_CLOSERS[action];
  // why: generic reactions ("Ask for help early...") answered a goat latch story with nonsense; topic replies fit.
  if (closer) return speak([topic.lines[0], topic.replies[0], topic.lines[1], topic.replies[1], closer[0], closer[1]]);
  return speak([topic.lines[0], topic.replies[0], topic.lines[1], topic.replies[1], topic.lines[2], topic.replies[2]]);
}

/**
 * Key for one pregenerated scene. It includes the outcome and action, so a scene written for a
 * different result (for example after an earlier meeting changed a bond) is never used.
 */
function voiceCacheKey(eventId: string, outcome: ResidentMeetingOutcome, action: ResidentSocialAction): string {
  return `${runtimeEventKey(eventId)}::${outcome}:${action}`;
}

/**
 * Build an event from the current pre-meeting state. A matching pregenerated model scene replaces
 * the authored lines; a matching pregenerated failure is kept as the visible voice error.
 */
function authoredEvent(meeting: DailyTownMeeting, day: number): TownSocialEvent {
  const effect = previewResidentBondMeeting(meeting.bondId, day, townMeetingWitnesses(day, meeting));
  const timing = residentMeetingWindow(day, meeting), id = `${day}:${meeting.bondId}`;
  const cacheKey = voiceCacheKey(id, effect.outcome, effect.action), cached = pregeneratedVoices.get(cacheKey);
  pregeneratedVoices.delete(cacheKey);
  const authored = { ...effect, id, minute: timing.minute, locationId: meeting.spot.id,
    lines: authoredLines(meeting, day, effect.outcome, effect.action), source: 'authored', voiceError: null };
  if (!cached) return socialEvent(authored);
  // why: the model already had its one try for this event; do not ask again when the keeper walks by.
  attemptedVoiceEvents.add(runtimeEventKey(id));
  if ('lines' in cached) return socialEvent({ ...authored, lines: cached.lines, source: 'local' });
  return socialEvent({ ...authored, voiceError: `Local voice unavailable: ${cached.error}`.slice(0, 160) });
}

/** Ensure one event exists. Event 73 removes the oldest event only. */
function ensureEvent(meeting: DailyTownMeeting, day: number): TownSocialEvent {
  const store = readStore(), id = `${day}:${meeting.bondId}`, existing = store.events.find(event => event.id === id);
  if (existing) return existing;
  const event = authoredEvent(meeting, day);
  const events = [...store.events, event].sort((left, right) => left.day - right.day || left.minute - right.minute);
  writeStore({ events: events.length > MAX_TOWN_SOCIAL_EVENTS ? events.slice(-MAX_TOWN_SOCIAL_EVENTS) : events });
  return event;
}

/** Write first, then apply the exact stored transition once. */
function reconcileMeeting(meeting: DailyTownMeeting, day: number): void {
  const id = `${day}:${meeting.bondId}`, runtimeKey = runtimeEventKey(id);
  if (runtimeEnsuredEvents.has(runtimeKey)
    && GameState.instance.relationships.bonds[meeting.bondId].lastAdvancedDay === day) return;
  let event: TownSocialEvent;
  if (runtimeEnsuredEvents.has(runtimeKey) && localStorage.getItem(storageKey()) !== null) event = townSocialEvent(id);
  else {
    if (localStorage.getItem(storageKey()) === null) {
      for (const key of runtimeEnsuredEvents) if (key.startsWith(`${storageKey()}::`)) runtimeEnsuredEvents.delete(key);
    }
    event = ensureEvent(meeting, day);
    runtimeEnsuredEvents.add(runtimeKey);
  }
  // why: true only on the first apply, so a reload never adds the same news twice.
  if (recordResidentBondMeeting(event)) {
    TownLifeSystem.recordMeetingNews(event, townSocialPair(event.bondId).residents, event.lines[0].residentId);
  }
}

/** Process missed full days and every meeting reached on the current day. */
export function syncTownSocialLife(day: number, timeOfDay: number): void {
  const gs = GameState.instance;
  if (day !== gs.day || !Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay > 1440) {
    throw new Error(`Town social life: invalid calendar ${day}/${timeOfDay}`);
  }
  let syncedDays = syncedMinutesByState.get(gs.relationships);
  if (!syncedDays) { syncedDays = new Map(); syncedMinutesByState.set(gs.relationships, syncedDays); }
  const minute = Math.floor(timeOfDay), previousMinute = syncedDays.get(day);
  if (previousMinute !== undefined && minute <= previousMinute) return;
  for (let missedDay = gs.relationships.lastSocialDay + 1; missedDay < day; missedDay++) {
    for (const meeting of townMeetingsForDay(missedDay)) reconcileMeeting(meeting, missedDay);
    gs.relationships.lastSocialDay = missedDay;
  }
  const meetings = townMeetingsForDay(day);
  for (const meeting of meetings) if (timeOfDay >= residentMeetingWindow(day, meeting).minute) reconcileMeeting(meeting, day);
  const finalMinute = Math.max(...meetings.map(meeting => residentMeetingWindow(day, meeting).minute));
  if (timeOfDay >= finalMinute) gs.relationships.lastSocialDay = day;
  syncedDays.set(day, minute);
}

/** Return detached newest-first events for any valid pair. */
export function townSocialEventsForBond(bondId: string): TownSocialEvent[] {
  townSocialPair(bondId);
  return readStore().events.filter(event => event.mutations.some(mutation => mutation.bondId === bondId)).reverse()
    .map(event => detachEvent(event));
}

/** Deep-detach one event so UI callers cannot mutate the validated store. */
function detachEvent(event: TownSocialEvent): TownSocialEvent {
  return { ...event, witnesses: [...event.witnesses], mutations: event.mutations.map(mutation => ({ bondId: mutation.bondId,
    before: { ...mutation.before }, after: { ...mutation.after } })),
  lines: event.lines.map(line => ({ ...line })) };
}

/** Return one detached event or fail if that meeting has not occurred. */
export function townSocialEvent(eventId: string): TownSocialEvent {
  const event = readStore().events.find(candidate => candidate.id === eventId);
  if (!event) throw new Error(`Town social notes event ${eventId} does not exist`);
  return detachEvent(event);
}

/** Replace only the scene lines after the guarded local endpoint validates them. */
function writeLocalLines(eventId: string, lines: readonly TownSocialLine[]): TownSocialEvent {
  const store = readStore(), index = store.events.findIndex(event => event.id === eventId);
  if (index < 0) throw new Error(`Town social notes event ${eventId} does not exist`);
  const current = store.events[index];
  const next = socialEvent({ ...current, lines, source: 'local', voiceError: null });
  const events = [...store.events]; events[index] = next; writeStore({ events }); return next;
}

/** Persist a visible failure while retaining complete authored lines. */
function writeVoiceError(eventId: string, message: string): void {
  const store = readStore(), index = store.events.findIndex(event => event.id === eventId);
  if (index < 0) throw new Error(`Town social notes event ${eventId} does not exist`);
  const events = [...store.events], bounded = `Local voice unavailable: ${message}`.slice(0, 160);
  events[index] = socialEvent({ ...events[index], source: 'authored', voiceError: bounded });
  writeStore({ events });
}

/**
 * Build a short shared-history window so the next model scene continues this pair's real past.
 * @param bondId the pair
 * @param day the new scene's day
 * @param minute the new scene's start minute (only earlier meetings count)
 */
function sharedConversationHistory(bondId: string, day: number, minute: number): string[] {
  return readStore().events.filter(event => event.bondId === bondId
    && (event.day < day || (event.day === day && event.minute < minute)))
    .slice(-3).map(event => {
      const place = socialSpotLabel(event.locationId), last = event.lines[event.lines.length - 1].text;
      return `Day ${event.day} at ${place}: ${event.lines[0].text} ... ${last}`.slice(0, 360);
    });
}

/** Describe the authoritative post-meeting bond without giving speech permission to change it. */
function sceneBondStatus(event: ResidentMeetingEffect): LocalResidentSceneContext['bondStatus'] {
  const state = event.mutations.find(mutation => mutation.bondId === event.bondId)?.after;
  if (!state) throw new Error(`Town social notes event ${event.bondId} has no primary bond mutation`);
  if (state.betrayalDay !== null && !state.exclusive && state.points < 50) return 'hurt';
  if (state.exclusive) return state.openAgreement ? 'open-partners' : 'partners';
  if (state.points >= 175) return 'attracted';
  if (state.points >= 100) return 'close-friends';
  if (state.points >= 50) return 'friends';
  return 'new-neighbors';
}

/**
 * Everything the local model needs for one scene. The opener and topic match the authored backup,
 * so a model scene and the gossip it creates tell the same story.
 * @param effect the game-decided meeting result
 * @param minute meeting start minute
 * @param locationId social spot id
 * @param opener who speaks first
 */
function sceneContext(effect: ResidentMeetingEffect, minute: number, locationId: string,
  opener: ResidentId): LocalResidentSceneContext {
  const pair = townSocialPair(effect.bondId);
  return {
    day: effect.day, weekday: WEEKDAYS[(effect.day - 1) % WEEKDAYS.length], bondStatus: sceneBondStatus(effect),
    stage: effect.outcome, action: effect.action, location: socialSpotLabel(locationId),
    sharedHistory: sharedConversationHistory(effect.bondId, effect.day, minute), opener,
    topicId: residentTopicForDay(opener, effect.day).id, townNews: TownLifeSystem.newsContext(pair.residents),
    weather: WeatherSystem.forDay(effect.day), season: seasonForDay(effect.day),
  };
}

/**
 * Send one scene request and convert the reply into stored lines.
 * @param bondId the pair
 * @param context scene facts
 */
async function requestScene(bondId: string, context: LocalResidentSceneContext): Promise<TownSocialLine[]> {
  const pair = townSocialPair(bondId);
  const lines = await chatBetweenResidents(bondId, pair.residents[0], pair.residents[1], context);
  return socialLines(lines, pair.residents);
}

/** Run at most one speech-only local request for one witnessed event. */
export async function requestLocalVoiceForEvent(eventId: string): Promise<TownSocialEvent | null> {
  if (!SettingsSystem.get().localNpcChat) return null;
  const event = townSocialEvent(eventId), runtimeKey = runtimeEventKey(eventId);
  // A saved error may come from an older bridge process. Retry it once in a fresh runtime,
  // while attemptedVoiceEvents still prevents a broken service from creating a request loop.
  if (event.source === 'local' || attemptedVoiceEvents.has(runtimeKey) || activeVoiceEvent !== null) return null;
  attemptedVoiceEvents.add(runtimeKey); activeVoiceEvent = runtimeKey;
  try {
    const lines = await requestScene(event.bondId,
      sceneContext(event, event.minute, event.locationId, event.lines[0].residentId));
    return writeLocalLines(eventId, lines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeVoiceError(eventId, message);
    throw error;
  } finally { activeVoiceEvent = null; }
}

/**
 * Ask the local model, one request at a time, for the next meeting that starts within
 * TOWN_VOICE_LEAD_MINUTES and has no event yet. The result waits in memory until authoredEvent()
 * writes the event. If the event was written while the request ran, the result goes straight into it.
 * @param day today (must be the live day)
 * @param timeOfDay minutes since 06:00
 * @returns the event id requested, or null when nothing was due
 * @throws the request error, after it is recorded where the player can see it
 */
export async function pregenerateUpcomingVoices(day: number, timeOfDay: number): Promise<string | null> {
  if (!SettingsSystem.get().localNpcChat || activeVoiceEvent !== null) return null;
  if (day !== GameState.instance.day) throw new Error(`Town social life: pregeneration day ${day} is not today`);
  const events = readStore().events;
  for (const meeting of townMeetingsForDay(day)) {
    const timing = residentMeetingWindow(day, meeting), id = `${day}:${meeting.bondId}`, runtimeKey = runtimeEventKey(id);
    if (timeOfDay >= timing.minute || timing.minute - timeOfDay > TOWN_VOICE_LEAD_MINUTES) continue;
    if (events.some(event => event.id === id) || attemptedVoiceEvents.has(runtimeKey)) continue;
    const effect = previewResidentBondMeeting(meeting.bondId, day, townMeetingWitnesses(day, meeting));
    const cacheKey = voiceCacheKey(id, effect.outcome, effect.action);
    if (pregeneratedVoices.has(cacheKey)) continue;
    attemptedVoiceEvents.add(runtimeKey); activeVoiceEvent = runtimeKey;
    try {
      const lines = await requestScene(meeting.bondId, sceneContext(effect, timing.minute, meeting.spot.id, sceneOpener(meeting, day)));
      const written = readStore().events.find(event => event.id === id);
      if (!written) pregeneratedVoices.set(cacheKey, { lines });
      else if (written.source === 'authored' && written.outcome === effect.outcome && written.action === effect.action) {
        writeLocalLines(id, lines);
      }
      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (readStore().events.some(event => event.id === id)) writeVoiceError(id, message);
      else pregeneratedVoices.set(cacheKey, { error: message });
      throw error;
    } finally { activeVoiceEvent = null; }
  }
  return null;
}

/** Clear in-memory request guards for tests and a fresh runtime. */
export function resetTownSocialVoiceRuntime(): void {
  activeVoiceEvent = null; attemptedVoiceEvents.clear(); runtimeEnsuredEvents.clear(); pregeneratedVoices.clear();
  syncedMinutesByState = new WeakMap();
}
