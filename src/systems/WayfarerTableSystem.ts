/**
 * WayfarerTableSystem — the keeper sits down at a table in The Wayfarer on its busy Wednesday night.
 *
 * What it does:
 *  - Seats the keeper with the 3-4 residents at one table (KeeperSocialSystem.wayfarerTableFor).
 *  - Runs a slow, readable group conversation: the local model writes 2-4 lines per turn, and the lines
 *    appear one at a time, like people taking turns to talk.
 *  - Offers game actions: say something, buy a round, hint for a drink, a hand of cards, get to know or
 *    flirt with one guest, make plans for tomorrow, and invite a guest to the adventuring party.
 *
 * Who decides what:
 *  - KeeperSocialSystem decides every outcome (gold, friendship, stamina, plans, party, card results).
 *    The result line is shown at once as a "game" line in the transcript.
 *  - The local model (chatInGroup) only writes how the table reacts, from the result's event sentence.
 *  - With Local chat off, or when the model fails, authored lines take its place. A model failure is
 *    shown in the transcript first, so it is never hidden.
 *
 * Why turns are pre-generated: the local model takes about 14-26 seconds. As soon as one turn arrives,
 * the next quiet turn (nobody acts) starts generating, so the table keeps talking while the keeper reads.
 * When the keeper acts first, that pre-generated turn is cancelled (the bridge then stops the model) and
 * a reaction to the action is requested instead. Quiet turns stop after MAX_IDLE_TURNS so an idle keeper
 * does not keep the model busy all night.
 *
 * Lifecycle: openWayfarerTable() creates the session and a 'wayfarer-table' dialogue entry with the same
 * revision. The dialogue entry is the modal marker (every dialogue guard applies; the clock keeps running
 * at Wayfarer-night speed because it has no residentId). If anything else closes the dialogue (Escape,
 * sleep), the next update() sees the revision gone, cancels the request, and drops the session.
 * The session is runtime only and never saved.
 */
import { SceneKey } from '../config/AssetKeys';
import { residentCharacterSheet, residentTopicForDay } from '../config/ResidentCharacterSheets';
import type { ResidentId } from '../config/ResidentRelationships';
import { GameState } from '../state/GameState';
import { CARD_STAKE, FLIRT_MIN_HEARTS, KeeperSocialSystem, ROUND_PRICE, type KeeperActionResult, type KeeperPlanOption,
  type WayfarerCardGame } from './KeeperSocialSystem';
import { chatInGroup, GROUP_CHAT_CANCELLED, MAX_GROUP_HISTORY_TURNS, MAX_MESSAGE_LENGTH, MIN_GROUP_RESIDENTS,
  type LocalGroupChatTurn, type LocalResidentSceneLine } from './LocalNpcChatSystem';
import { pointsToHearts } from './RelationshipSystem';
import { residentScheduleScene } from './TownScheduleSystem';
import { SettingsSystem } from './SettingsSystem';
import { TownLifeSystem, townClockLabel } from './TownLifeSystem';

/** Fewest residents a table needs (the group chat needs three voices). */
export const WAYFARER_TABLE_MIN_GUESTS = MIN_GROUP_RESIDENTS;
/** Real milliseconds between two resident lines appearing. */
export const TABLE_LINE_GAP_MS = 1800;
/** Real milliseconds of quiet before a pre-generated quiet turn appears. */
export const TABLE_IDLE_GAP_MS = 6000;
/** Quiet turns in a row before the table waits for the keeper. */
export const MAX_IDLE_TURNS = 3;
/** Transcript lines kept on screen. */
const MAX_TRANSCRIPT_LINES = 12;
/** Real milliseconds between checks that every guest is still in the bar. */
const GUEST_CHECK_MS = 1000;
/** Place name the model sees. */
const TABLE_PLACE = 'The Wayfarer tavern, busy Wednesday night';

/** Phases of the table. `idle` shows the main buttons; the others show one sub-step. */
export type WayfarerTablePhase = 'idle' | 'typing' | 'cards' | 'pick-target' | 'pick-plan';
/** Actions that need the keeper to pick one guest first. */
export type WayfarerTargetAction = 'befriend' | 'flirt' | 'plans' | 'party';
/** One transcript line: a resident, the keeper, or the game's own result line. */
export interface WayfarerTableLine {
  speaker: ResidentId | 'player' | 'game';
  text: string;
}
/** One button the UI draws. `enabled` false draws it greyed out; pressing it does nothing. */
export interface WayfarerTableButton {
  id: string;
  label: string;
  enabled: boolean;
}
/** Read-only view the UI draws each frame. */
export interface WayfarerTableView {
  guests: { id: ResidentId; name: string; hearts: number; inParty: boolean }[];
  phase: WayfarerTablePhase;
  lines: WayfarerTableLine[];
  draft: string;
  /** True while the local model is writing the table's next turn. */
  thinking: boolean;
  /** One short status line (model state or the last error). */
  status: string;
  buttons: WayfarerTableButton[];
  selection: number;
  /** The keeper's hand while a card hand is open. */
  hand: number[] | null;
}

/** Authored reaction kinds (used when the model is off or failed). */
type ReactionKind = 'join' | 'say' | 'round-buy' | 'round-get' | 'round-none' | 'cards-win' | 'cards-lose' | 'cards-tie'
  | 'befriend' | 'flirt' | 'flirt-rebuff' | 'plans' | 'party-join' | 'party-leave' | 'none';

/** Voice-neutral lines another guest says after each kind of action (authored backup). */
const TABLE_REACTIONS: Readonly<Record<Exclude<ReactionKind, 'say' | 'befriend' | 'none'>, readonly string[]>> = {
  join: ['Pull up a chair! We were just getting loud.', 'Look who finally found the good table.'],
  'round-buy': ['To the keeper!', 'Now that is how you make friends in this town.'],
  'round-get': ['Drink up. You earned it today.', 'Next one is on you, mind.'],
  'round-none': ['Ha! Nice try. Maybe next week.', 'Bold of you to ask.'],
  'cards-win': ['How did you pull that off? Rematch next week.', 'Remind me never to play you sober.'],
  'cards-lose': ['The cards love me tonight. Better luck next time!', 'Do not look so sad. It is only gold.'],
  'cards-tie': ['Nobody wins, nobody cries. Perfect.', 'A tie! Deal again next week.'],
  flirt: ['Oh, I see how it is.', 'Should the rest of us leave you two alone?'],
  'flirt-rebuff': ['Ouch. Maybe buy them a drink first.', 'Smooth. Very smooth. Not really.'],
  plans: ['Tomorrow, then. Do not be late.', 'Invite me next time!'],
  'party-join': ['An adventuring party? Bring back something shiny.', 'Watch their back down there.'],
  'party-leave': ['Fair enough. Call me when the dungeon gets lonely.', 'More peace and quiet for the rest of us.'],
};

/** Live table state. Runtime only. */
interface TableSession {
  revision: number;
  guests: ResidentId[];
  phase: WayfarerTablePhase;
  lines: WayfarerTableLine[];
  /** Turns the model sees: only lines already shown (never the waiting queue). */
  history: LocalGroupChatTurn[];
  /** Resident lines waiting to appear, oldest first. */
  queue: LocalResidentSceneLine[];
  nextLineAt: number;
  lastSpokeAt: number;
  draft: string;
  targetAction: WayfarerTargetAction | null;
  planTarget: ResidentId | null;
  planOptions: KeeperPlanOption[];
  cards: WayfarerCardGame | null;
  /** The request in flight (an action reaction or a pre-generated quiet turn). */
  request: { controller: AbortController; quiet: boolean } | null;
  /** A finished pre-generated quiet turn, waiting for TABLE_IDLE_GAP_MS of quiet. */
  prefetched: LocalResidentSceneLine[] | null;
  idleTurns: number;
  /** Rotation for authored lines, so the same guest does not always speak first. */
  authoredCursor: number;
  status: string;
  selection: number;
  nextGuestCheckAt: number;
  /** UI-clock time of the last update, so actions can schedule their lines without a scene clock. */
  now: number;
  /**
   * False until the first update. Before it, every time above counts from 0, because opening the table
   * has no UI clock to read. The first update moves them onto the UI clock.
   */
  clockBound: boolean;
}

let session: TableSession | null = null;

/** Display name of one resident. */
function nameOf(id: ResidentId): string {
  return residentCharacterSheet(id).name;
}

/** "A, B and C" */
function nameList(ids: readonly ResidentId[]): string {
  const names = ids.map(nameOf);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The live session, or null when the table dialogue is gone (closed by Escape, sleep, or a scene change). */
function liveSession(): TableSession | null {
  const dialogue = GameState.instance.dialogue;
  if (!session) return null;
  if (!dialogue || dialogue.kind !== 'wayfarer-table' || dialogue.revision !== session.revision) {
    session.request?.controller.abort();
    session = null;
    return null;
  }
  return session;
}

/** The live session for an input handler. */
function requireSession(): TableSession {
  const live = liveSession();
  if (!live) throw new Error('Wayfarer table: no table is open');
  return live;
}

/** Add one transcript line, keeping only the newest lines. */
function pushLine(table: TableSession, line: WayfarerTableLine): void {
  table.lines.push(line);
  if (table.lines.length > MAX_TRANSCRIPT_LINES) table.lines.splice(0, table.lines.length - MAX_TRANSCRIPT_LINES);
}

/** Add one model-visible turn, keeping only what the model accepts. */
function pushHistory(table: TableSession, turn: LocalGroupChatTurn): void {
  table.history.push(turn);
  if (table.history.length > MAX_GROUP_HISTORY_TURNS) table.history.splice(0, table.history.length - MAX_GROUP_HISTORY_TURNS);
}

/** True when the keeper turned Local chat on. */
function modelOn(): boolean {
  return SettingsSystem.get().localNpcChat;
}

/** Stop the request in flight and forget any pre-generated quiet turn. */
function cancelTurns(table: TableSession): void {
  table.request?.controller.abort();
  table.request = null;
  table.prefetched = null;
}

/**
 * Pick the next authored speaker, skipping one resident when asked.
 * @param table live session
 * @param not resident who should not speak this line
 */
function authoredSpeaker(table: TableSession, not: ResidentId | null): ResidentId {
  for (let step = 0; step < table.guests.length; step++) {
    const id = table.guests[(table.authoredCursor + step) % table.guests.length];
    if (id !== not) { table.authoredCursor += step + 1; return id; }
  }
  throw new Error('Wayfarer table: no guest can speak');
}

/**
 * Authored reaction lines for one action, used when the model is off or failed.
 * @param table live session
 * @param kind which action happened
 * @param target the guest the action was about, if any
 */
function authoredReaction(table: TableSession, kind: ReactionKind, target: ResidentId | null): LocalResidentSceneLine[] {
  const day = GameState.instance.day;
  if (kind === 'none') return [];
  if (kind === 'say') {
    const speaker = authoredSpeaker(table, null), curious = residentCharacterSheet(speaker).reactions.curious;
    return [{ residentId: speaker, text: curious[(day + table.authoredCursor) % curious.length] }];
  }
  if (kind === 'befriend') {
    if (!target) throw new Error('Wayfarer table: befriend needs a target');
    const warm = residentCharacterSheet(target).reactions.warm;
    return [{ residentId: target, text: warm[day % warm.length] }];
  }
  const lines = TABLE_REACTIONS[kind], speaker = authoredSpeaker(table, target);
  return [{ residentId: speaker, text: lines[(day + table.authoredCursor) % lines.length] }];
}

/**
 * One authored quiet turn: a guest brings up today's topic and a neighbor answers it.
 * @param table live session
 */
function authoredQuietTurn(table: TableSession): LocalResidentSceneLine[] {
  const day = GameState.instance.day, speaker = authoredSpeaker(table, null), listener = authoredSpeaker(table, speaker);
  const topic = residentTopicForDay(speaker, day), beat = table.idleTurns % topic.lines.length;
  return [{ residentId: speaker, text: topic.lines[beat] }, { residentId: listener, text: topic.replies[beat] }];
}

/** Model context: the place, what just happened, the guests' topics today, and town news they know. */
function chatContext(table: TableSession, event: string) {
  const day = GameState.instance.day;
  return { place: TABLE_PLACE, event, topics: table.guests.map(id => residentTopicForDay(id, day).summary).slice(0, 5),
    news: TownLifeSystem.newsContext(table.guests) };
}

/**
 * Put lines in the waiting queue. Lines appear one at a time from update().
 * @param table live session
 * @param lines lines to add
 */
function enqueue(table: TableSession, lines: readonly LocalResidentSceneLine[]): void {
  if (!table.queue.length) table.nextLineAt = Math.max(table.nextLineAt, table.now + 400);
  table.queue.push(...lines);
}

/**
 * Start a pre-generated quiet turn so the table keeps talking while the keeper reads.
 * @param table live session
 */
function startQuietTurn(table: TableSession): void {
  if (!modelOn() || table.idleTurns >= MAX_IDLE_TURNS || table.request || table.prefetched) return;
  // why: the model must see the lines still waiting to appear, or it would repeat them.
  const history = [...table.history, ...table.queue.map(line => ({ speaker: line.residentId, text: line.text }))]
    .slice(-MAX_GROUP_HISTORY_TURNS);
  const controller = new AbortController(), request = { controller, quiet: true };
  table.request = request;
  chatInGroup(table.guests, chatContext(table, ''), history, '', controller.signal).then(lines => {
    if (session !== table || table.request !== request) return;
    table.request = null;
    table.prefetched = lines;
  }, (error: unknown) => {
    if (session !== table || table.request !== request) return;
    table.request = null;
    const message = error instanceof Error ? error.message : String(error);
    if (message === GROUP_CHAT_CANCELLED) return;
    // why: the failure is shown, then the authored quiet turn keeps the table alive.
    table.status = `Local voice failed: ${message}`;
    pushLine(table, { speaker: 'game', text: `(Local voice failed: ${message} Using the usual chatter.)` });
    table.prefetched = authoredQuietTurn(table);
  });
}

/**
 * Ask the table to react to something the keeper did or said. Any quiet turn is cancelled first.
 * @param table live session
 * @param event the game's event sentence ('' when the keeper only spoke)
 * @param playerLine what the keeper said ('' when they acted)
 * @param kind authored reaction used when the model is off or fails
 * @param target the guest the action was about, if any
 */
function startReaction(table: TableSession, event: string, playerLine: string, kind: ReactionKind, target: ResidentId | null): void {
  cancelTurns(table);
  table.idleTurns = 0;
  // why: lines still waiting were never seen by the keeper; dropping them keeps the talk on what just happened.
  table.queue = [];
  const history = table.history.slice(-MAX_GROUP_HISTORY_TURNS);
  if (playerLine) pushHistory(table, { speaker: 'player', text: playerLine });
  if (!modelOn()) {
    table.status = 'Local chat is off. The table uses its usual chatter.';
    enqueue(table, authoredReaction(table, kind, target));
    return;
  }
  const controller = new AbortController(), request = { controller, quiet: false };
  table.request = request;
  table.status = '';
  let streamed = 0;
  // why: the keeper is waiting on this turn, so each line is queued the moment the bridge streams it
  // (the first speaker talks after about 5 s instead of after the whole 20 s turn).
  const onLine = (line: LocalResidentSceneLine) => {
    if (session !== table || table.request !== request) return;
    streamed++;
    enqueue(table, [line]);
  };
  chatInGroup(table.guests, chatContext(table, event), history, playerLine, controller.signal, onLine).then(() => {
    if (session !== table || table.request !== request) return;
    table.request = null;
    startQuietTurn(table);
  }, (error: unknown) => {
    if (session !== table || table.request !== request) return;
    table.request = null;
    const message = error instanceof Error ? error.message : String(error);
    if (message === GROUP_CHAT_CANCELLED) return;
    table.status = `Local voice failed: ${message}`;
    // why: when some model lines already reached the table, it did react; authored lines on top would talk over them.
    if (streamed > 0) {
      pushLine(table, { speaker: 'game', text: `(Local voice failed: ${message})` });
      return;
    }
    pushLine(table, { speaker: 'game', text: `(Local voice failed: ${message} Using the usual chatter.)` });
    enqueue(table, authoredReaction(table, kind, target));
  });
}

/**
 * Show a game result and, when something happened, ask the table to react.
 * @param table live session
 * @param result the KeeperSocialSystem result
 * @param kind authored reaction kind
 * @param target the guest the action was about, if any
 */
function applyResult(table: TableSession, result: KeeperActionResult, kind: ReactionKind, target: ResidentId | null): void {
  pushLine(table, { speaker: 'game', text: result.line });
  table.phase = 'idle';
  table.selection = 0;
  if (result.event) startReaction(table, result.event, '', kind, target);
}

/**
 * Seat the keeper at a resident's Wayfarer table and open the table dialogue.
 * @param id the resident the keeper spoke to
 * @param revision the dialogue revision the table belongs to
 * @throws when the resident's table has fewer than WAYFARER_TABLE_MIN_GUESTS guests (the choice was not offered)
 */
export function openWayfarerTable(id: ResidentId, revision: number): void {
  const guests = KeeperSocialSystem.wayfarerTableFor(id);
  if (guests.length < WAYFARER_TABLE_MIN_GUESTS) throw new Error(`Wayfarer table: ${id} has no table to join right now`);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Wayfarer table: invalid dialogue revision');
  session?.request?.controller.abort();
  // why: update() runs on the UI scene clock, which is not performance.now(); times start at 0 until it binds them.
  const now = 0;
  const table: TableSession = { revision, guests, phase: 'idle', lines: [], history: [], queue: [], nextLineAt: now,
    lastSpokeAt: now, draft: '', targetAction: null, planTarget: null, planOptions: [], cards: null, request: null,
    prefetched: null, idleTurns: 0, authoredCursor: guests.indexOf(id) + 1, status: '', selection: 0,
    nextGuestCheckAt: now + GUEST_CHECK_MS, now, clockBound: false };
  session = table;
  GameState.instance.dialogue = { kind: 'wayfarer-table', name: 'The Wayfarer', line: '', revision };
  pushLine(table, { speaker: 'game', text: `You pull up a chair with ${nameList(guests)}.` });
  startReaction(table, 'The keeper just pulled up a chair and joined the table.', '', 'join', id);
}

/**
 * End the table with one closing message (guests left, or the night ended).
 * @param line the closing message
 */
function endTable(table: TableSession, line: string): void {
  table.request?.controller.abort();
  session = null;
  GameState.instance.dialogue = { kind: 'message', name: 'The Wayfarer', line };
}

/**
 * Advance the table: show waiting lines one at a time, release pre-generated quiet turns, and let guests
 * who head home leave the table. Call every frame while the table is open.
 * @param now real time in milliseconds (the UI scene clock)
 */
export function updateWayfarerTable(now: number): void {
  const table = liveSession();
  if (!table) return;
  if (!table.clockBound) {
    table.clockBound = true;
    table.nextLineAt += now; table.lastSpokeAt += now; table.nextGuestCheckAt += now;
  }
  table.now = now;
  if (now >= table.nextGuestCheckAt) {
    table.nextGuestCheckAt = now + GUEST_CHECK_MS;
    if (!KeeperSocialSystem.wayfarerNightNow()) { endTable(table, 'Last call! The Wayfarer crowd heads home for the night.'); return; }
    const gs = GameState.instance;
    const leaving = table.guests.filter(id => residentScheduleScene(id, gs.day, gs.timeOfDay).scene !== SceneKey.TownBar);
    if (leaving.length) {
      table.guests = table.guests.filter(id => !leaving.includes(id));
      for (const id of leaving) pushLine(table, { speaker: 'game', text: `${nameOf(id)} says goodnight and heads home.` });
      if (table.guests.length < WAYFARER_TABLE_MIN_GUESTS) {
        endTable(table, `${nameList(leaving)} ${leaving.length === 1 ? 'heads' : 'head'} home, and the table breaks up for the night.`);
        return;
      }
      // why: the model only accepts speakers who are seated, so a leaver's lines and turns are dropped.
      cancelTurns(table);
      table.queue = table.queue.filter(line => table.guests.includes(line.residentId));
      table.history = table.history.filter(turn => turn.speaker === 'player' || table.guests.includes(turn.speaker));
      if (table.phase === 'pick-target' || table.phase === 'cards' || table.phase === 'pick-plan') {
        table.phase = 'idle'; table.cards = null; table.selection = 0;
      }
    }
  }
  if (table.queue.length && now >= table.nextLineAt) {
    const line = table.queue.shift() as LocalResidentSceneLine;
    pushLine(table, { speaker: line.residentId, text: line.text });
    pushHistory(table, { speaker: line.residentId, text: line.text });
    table.nextLineAt = now + TABLE_LINE_GAP_MS;
    table.lastSpokeAt = now;
    return;
  }
  if (table.queue.length || table.request || now - table.lastSpokeAt < TABLE_IDLE_GAP_MS || table.idleTurns >= MAX_IDLE_TURNS) return;
  if (modelOn()) {
    if (!table.prefetched) { startQuietTurn(table); return; }
    enqueue(table, table.prefetched);
    table.prefetched = null;
    table.idleTurns++;
    startQuietTurn(table);
    return;
  }
  enqueue(table, authoredQuietTurn(table));
  table.idleTurns++;
}

/** Buttons for the current phase. */
function buttonsFor(table: TableSession): WayfarerTableButton[] {
  const gs = GameState.instance;
  switch (table.phase) {
    case 'typing':
      return [{ id: 'send', label: 'Say it', enabled: table.draft.trim().length > 0 }, { id: 'cancel', label: 'Never mind', enabled: true }];
    case 'cards':
      return [{ id: 'keep', label: 'Keep my cards', enabled: true }, { id: 'swap', label: 'Swap lowest', enabled: true }];
    case 'pick-plan':
      return [...table.planOptions.map((plan, index) => ({ id: `plan-${index}`,
        label: `${plan.label} · ${townClockLabel(plan.startsAt)}`, enabled: true })),
      { id: 'back', label: 'Back', enabled: true }];
    case 'pick-target':
      return [...table.guests.map(id => {
        const inParty = gs.social.party.includes(id);
        const used = (table.targetAction === 'befriend' || table.targetAction === 'flirt') && KeeperSocialSystem.usedToday(table.targetAction, id);
        return { id: `guest-${id}`, label: table.targetAction === 'party' && inParty ? `${nameOf(id)} (leave)` : nameOf(id), enabled: !used };
      }), { id: 'back', label: 'Back', enabled: true }];
    case 'idle':
      return [
        { id: 'say', label: 'Say something', enabled: true },
        { id: 'round-buy', label: `Buy a round (${ROUND_PRICE * table.guests.length}g)`, enabled: !KeeperSocialSystem.usedToday('round-buy', 'table') },
        { id: 'round-get', label: 'Hint for a drink', enabled: !KeeperSocialSystem.usedToday('round-get', 'table') },
        { id: 'cards', label: `Play cards (${CARD_STAKE}g)`, enabled: !KeeperSocialSystem.usedToday('cards', 'table') },
        { id: 'befriend', label: 'Get to know…', enabled: true },
        { id: 'flirt', label: 'Flirt with…', enabled: true },
        { id: 'plans', label: 'Plans with…', enabled: true },
        { id: 'party', label: 'Party…', enabled: true },
        { id: 'leave', label: 'Leave table', enabled: true },
      ];
    default: {
      const never: never = table.phase;
      throw new Error(`Wayfarer table: unknown phase ${String(never)}`);
    }
  }
}

/** The view the UI draws, or null when no table is open. */
export function wayfarerTableView(): WayfarerTableView | null {
  const table = liveSession();
  if (!table) return null;
  const gs = GameState.instance;
  return {
    guests: table.guests.map(id => ({ id, name: nameOf(id), hearts: pointsToHearts(gs.relationships.residents[id].points),
      inParty: gs.social.party.includes(id) })),
    phase: table.phase, lines: [...table.lines], draft: table.draft, thinking: table.request !== null && !table.request.quiet,
    status: table.request && !table.request.quiet ? 'The table is talking…' : table.status,
    buttons: buttonsFor(table), selection: table.selection, hand: table.cards ? [...table.cards.keeperHand] : null,
  };
}

/**
 * Move the button highlight, wrapping at the ends.
 * @param step buttons to move (negative moves back)
 */
export function moveWayfarerTableSelection(step: number): void {
  const table = requireSession(), count = buttonsFor(table).length;
  table.selection = ((table.selection + step) % count + count) % count;
}

/**
 * Press one button by id, or the highlighted one. Disabled buttons do nothing.
 * @param id optional button id (a click passes it; Enter and E use the highlight)
 * @throws when the id is not a button of the current phase
 */
export function pressWayfarerTableButton(id?: string): void {
  const table = requireSession(), buttons = buttonsFor(table);
  const button = id === undefined ? buttons[table.selection] : buttons.find(candidate => candidate.id === id);
  if (!button) throw new Error(`Wayfarer table: ${id ?? table.selection} is not a button right now`);
  if (!button.enabled) return;
  table.selection = buttons.indexOf(button);
  const gs = GameState.instance;
  if (table.phase === 'typing') {
    if (button.id === 'cancel') { cancelWayfarerTableTyping(); return; }
    sendWayfarerTableLine();
    return;
  }
  if (table.phase === 'cards') {
    const game = table.cards;
    if (!game) throw new Error('Wayfarer table: the card hand is missing');
    table.cards = null;
    const result = KeeperSocialSystem.finishCards(game, button.id === 'swap');
    applyResult(table, result, result.winner === 'keeper' ? 'cards-win' : result.winner === 'tie' ? 'cards-tie' : 'cards-lose', null);
    return;
  }
  if (table.phase === 'pick-plan') {
    if (button.id === 'back') { table.phase = 'pick-target'; table.selection = 0; return; }
    const target = table.planTarget, plan = table.planOptions[buttons.indexOf(button)];
    if (!target || !plan) throw new Error('Wayfarer table: the plan picker lost its plan');
    table.planTarget = null; table.planOptions = [];
    applyResult(table, KeeperSocialSystem.makePlan(target, plan), 'plans', target);
    return;
  }
  if (table.phase === 'pick-target') {
    if (button.id === 'back') { table.phase = 'idle'; table.targetAction = null; table.selection = 0; return; }
    const target = button.id.slice('guest-'.length) as ResidentId, action = table.targetAction;
    if (!table.guests.includes(target) || !action) throw new Error(`Wayfarer table: ${button.id} is not at the table`);
    table.targetAction = null;
    if (action === 'befriend') { applyResult(table, KeeperSocialSystem.befriend(target), 'befriend', target); return; }
    if (action === 'flirt') {
      // why: the hearts before the flirt decide whether it lands, so the table reacts to the same rule.
      const welcome = pointsToHearts(gs.relationships.residents[target].points) >= FLIRT_MIN_HEARTS;
      applyResult(table, KeeperSocialSystem.flirt(target), welcome ? 'flirt' : 'flirt-rebuff', target);
      return;
    }
    if (action === 'party') {
      const leaving = gs.social.party.includes(target);
      applyResult(table, leaving ? KeeperSocialSystem.leaveParty(target) : KeeperSocialSystem.joinParty(target),
        leaving ? 'party-leave' : 'party-join', target);
      return;
    }
    const plans = KeeperSocialSystem.planOptions(target);
    if (!plans.ok) { pushLine(table, { speaker: 'game', text: plans.line }); table.phase = 'idle'; table.selection = 0; return; }
    table.planTarget = target; table.planOptions = plans.options; table.phase = 'pick-plan'; table.selection = 0;
    return;
  }
  switch (button.id) {
    case 'say': table.phase = 'typing'; table.draft = ''; table.selection = 0; return;
    case 'round-buy': applyResult(table, KeeperSocialSystem.buyRound('table', table.guests), 'round-buy', null); return;
    case 'round-get': {
      const result = KeeperSocialSystem.getRound(table.guests);
      applyResult(table, result, result.ok ? 'round-get' : 'round-none', null);
      return;
    }
    case 'cards': {
      const deal = KeeperSocialSystem.dealCards(table.guests);
      if (!deal.ok) { pushLine(table, { speaker: 'game', text: deal.line }); return; }
      table.cards = deal.game; table.phase = 'cards'; table.selection = 0;
      pushLine(table, { speaker: 'game', text: `${nameOf(table.guests[0])} deals. Your cards: ${deal.game.keeperHand.join(' · ')} `
        + `(total ${KeeperSocialSystem.handTotal(deal.game.keeperHand)}). Keep them, or swap your lowest card for a new one?` });
      return;
    }
    case 'befriend': case 'flirt': case 'plans': case 'party':
      table.targetAction = button.id; table.phase = 'pick-target'; table.selection = 0; return;
    case 'leave': {
      table.request?.controller.abort();
      session = null;
      gs.dialogue = null;
      return;
    }
    default: throw new Error(`Wayfarer table: unknown button ${button.id}`);
  }
}

/**
 * Type one character into the Say line.
 * @param character one printable character
 */
export function typeWayfarerTable(character: string): void {
  const table = requireSession();
  if (table.phase !== 'typing' || character.length !== 1 || table.draft.length >= MAX_MESSAGE_LENGTH) return;
  table.draft += character;
}

/** Remove the last character of the Say line. */
export function backspaceWayfarerTable(): void {
  const table = requireSession();
  if (table.phase !== 'typing') return;
  table.draft = table.draft.slice(0, -1);
}

/**
 * Replace the whole Say line at once. The touch text box (TouchTextEntry) uses this, because a phone
 * keyboard edits the line as a whole (autocorrect, paste, swipe typing), not one key at a time.
 * @param text the full line from the text box
 * @throws when the Say line is not open, or the text is longer than the limit or has a line break
 */
export function setWayfarerTableDraft(text: string): void {
  const table = requireSession();
  if (table.phase !== 'typing') throw new Error('Wayfarer table: the Say line is not open');
  // why: the text box has the same maxlength and is one line, so a longer or multi-line value is a real bug.
  if (text.length > MAX_MESSAGE_LENGTH || /[\r\n]/.test(text)) throw new Error('Wayfarer table: the Say line is too long or has a line break');
  table.draft = text;
}

/** Close the Say line without saying anything and return to the table's buttons (Escape while typing). */
export function cancelWayfarerTableTyping(): void {
  const table = requireSession();
  if (table.phase !== 'typing') throw new Error('Wayfarer table: the Say line is not open');
  table.phase = 'idle'; table.draft = ''; table.selection = 0;
}

/** Say the typed line to the table. An empty line just closes the input. */
export function sendWayfarerTableLine(): void {
  const table = requireSession();
  if (table.phase !== 'typing') return;
  const line = table.draft.trim();
  table.draft = ''; table.phase = 'idle'; table.selection = 0;
  if (!line) return;
  pushLine(table, { speaker: 'player', text: line });
  startReaction(table, '', line, 'say', null);
}

/** True while the Say line is open (the UI sends letters to it). */
export function wayfarerTableTyping(): boolean {
  return liveSession()?.phase === 'typing';
}
