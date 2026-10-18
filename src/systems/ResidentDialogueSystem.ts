/**
 * Face-to-face resident conversation state, including authored talk and optional supervised local chat.
 * Talk (no model) works in this order:
 *  1. talkToResident applies the daily Talk friendship and returns the friendship-tier line.
 *  2. An open favor for this resident wins: the keeper hands over the items or hears what is still needed.
 *  3. Otherwise ResidentTalkSystem picks a line for the day (topic, time, weather, season, tier, gossip),
 *     followed by one optional ResidentMentionSystem sentence (a remembered gift or a neighbor).
 *  4. A close resident may add an invite to meet tomorrow (TownLifeSystem.offerInvite).
 * Each good local-chat reply adds a little friendship, capped per day (TownLifeSystem.grantChatFriendship).
 * A local-chat reply may also carry a real offer (ResidentOfferSystem), e.g. Nyra teaching mana. The game
 * re-checks it, shows accept/decline buttons under the reply, and runs the effect only on accept.
 * Together opens a grid of game-decided actions (KeeperSocialSystem): spend time, flirt, plans for
 * tomorrow, the adventuring party, a walk together for party members (CompanionWalkSystem), and a drink
 * inside The Wayfarer. On Wayfarer night a seated resident
 * also offers Table, which hands the keeper to WayfarerTableSystem.
 */
import type { ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState, type DialogueOption, type DialogueState, type ResidentDialogueChoice } from '../state/GameState';
import { SceneKey } from '../config/AssetKeys';
import { residentCharacterSheet } from '../config/ResidentCharacterSheets';
import { KeeperSocialSystem, ROUND_PRICE } from './KeeperSocialSystem';
import { openWayfarerTable, WAYFARER_TABLE_MIN_GUESTS } from './WayfarerTableSystem';
import { askResidentCuddle, chatWithResident, MAX_HISTORY_TURNS, MAX_MESSAGE_LENGTH } from './LocalNpcChatSystem';
import { giveGiftToResident, isGiftableItem, pointsToHearts, talkToResident } from './RelationshipSystem';
import { residentTalkLine } from './ResidentTalkSystem';
import { TownLifeSystem, townClockLabel } from './TownLifeSystem';
import { residentMentionLine } from './ResidentMentionSystem';
import { SettingsSystem } from './SettingsSystem';
import { assertResidentChatCapacity, recordResidentChatExchange, residentChatContext } from './ResidentChatMemorySystem';
import { recentResidentGifts, recordAcceptedResidentGift } from './ResidentGiftMemorySystem';
import { ToolSystem } from './ToolSystem';
import { CompanionWalkSystem } from './CompanionWalkSystem';
import { applyResidentChatOutcome, residentRefusesChatToday } from './JusticeSystem';
import type { CuddleKind } from '../config/Cuddle';
import { playerCuddleAvailable, startPlayerCuddle } from './CuddleSystem';
import { CHAT_OFFERS } from '../config/ResidentChatOffers';
import { ResidentOfferSystem } from './ResidentOfferSystem';

let requestGeneration = 0;
let dialogueRevision = 0;

/** Find the public resident definition or fail on an invalid interaction identity. */
function residentDefinition(id: ResidentId) {
  const resident = TOWN_RESIDENTS.find(entry => entry.id === id);
  if (!resident) throw new Error(`Resident dialogue: unknown resident ${id}`);
  return resident;
}

/**
 * The choices the row offers for one resident right now. Talk, Chat, and Together are always there;
 * Table appears only when the resident sits at a Wayfarer-night table with enough company for a group chat.
 * @param id the resident
 */
function residentChoices(id: ResidentId): ResidentDialogueChoice[] {
  const choices: ResidentDialogueChoice[] = ['talk', 'chat', 'together'];
  if (KeeperSocialSystem.wayfarerTableFor(id).length >= WAYFARER_TABLE_MIN_GUESTS) choices.push('table');
  return choices;
}

/** Open the Talk/Chat/Together(/Table) choice without granting friendship points. */
export function openResidentDialogue(id: ResidentId): void {
  const resident = residentDefinition(id);
  requestGeneration++;
  const revision = ++dialogueRevision;
  GameState.instance.dialogue = { kind: 'resident-choice', name: resident.name, line: 'How would you like to spend this moment?',
    residentId: id, choice: 'talk', choices: residentChoices(id), revision };
}

/**
 * What pressing Interact on a resident does once the scene has decided the keeper may talk to them:
 * a giftable selected item is handed over, otherwise the Talk/Chat/Together row opens. Shared by the
 * scheduled town body (TownResident) and a party member walking with the keeper (PartyCompanion).
 * @param id the resident
 * Side effects: may change friendship and gift memory; always sets GameState.dialogue.
 */
export function meetResidentInPerson(id: ResidentId): void {
  const gs = GameState.instance, selectedItem = ToolSystem.activeItem();
  if (!isGiftableItem(selectedItem)) {
    openResidentDialogue(id);
    return;
  }
  const result = giveGiftToResident(id, selectedItem);
  if (result.accepted && result.taste !== null) recordAcceptedResidentGift(id, selectedItem, result.taste, gs.day);
  gs.dialogue = { kind: 'message', name: residentDefinition(id).name, line: result.line, residentId: id, hearts: result.hearts };
}

/**
 * Change the highlighted face-to-face action.
 * @param choice one of the choices the row shows
 * @throws when the row does not offer that choice (a hidden button cannot be pressed)
 */
export function selectResidentDialogueChoice(choice: ResidentDialogueChoice): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-choice') return;
  if (!dialogue.choices) throw new Error('Resident dialogue: the choice row has no choice list');
  if (!dialogue.choices.includes(choice)) throw new Error(`Resident dialogue: ${choice} is not offered right now`);
  dialogue.choice = choice;
}

/**
 * Move the highlight along the choice row, wrapping at the ends (arrow keys and Tab).
 * @param step +1 for the next choice, -1 for the previous one
 */
export function cycleResidentDialogueChoice(step: 1 | -1): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-choice') return;
  if (!dialogue.choices || !dialogue.choice) throw new Error('Resident dialogue: the choice row has no choice list');
  const index = dialogue.choices.indexOf(dialogue.choice);
  if (index < 0) throw new Error(`Resident dialogue: ${dialogue.choice} is not on the choice row`);
  dialogue.choice = dialogue.choices[(index + step + dialogue.choices.length) % dialogue.choices.length];
}

/**
 * Apply the highlighted action. Talk runs the order in the file header; Chat opens the local-model input;
 * Together opens the action grid; Table seats the keeper at the resident's Wayfarer table.
 */
export function confirmResidentDialogueChoice(): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-choice' || !dialogue.residentId) return;
  const resident = residentDefinition(dialogue.residentId as ResidentId);
  if (dialogue.choice === 'together') {
    openResidentActions(resident.id as ResidentId);
    return;
  }
  if (dialogue.choice === 'table') {
    requestGeneration++;
    openWayfarerTable(resident.id as ResidentId, ++dialogueRevision);
    return;
  }
  if (dialogue.choice === 'talk') {
    const before = GameState.instance.relationships.residents[resident.id as ResidentId];
    // why: read these before talkToResident updates them, so the mention sees "first talk today".
    const firstTalkToday = before.lastTalkDay !== GameState.instance.day;
    const conversationIndex = before.conversationCount;
    const id = resident.id as ResidentId, gs = GameState.instance;
    const result = talkToResident(id);
    const favor = TownLifeSystem.talkAboutFavor(id);
    let line: string;
    if (favor.kind !== 'none') line = favor.line;
    else {
      const talk = residentTalkLine({ id, day: gs.day, timeOfDay: gs.timeOfDay, tierLine: result.line, conversationIndex, firstTalkToday });
      // why: gossip already names a neighbor, so a second neighbor mention would crowd the box.
      const mention = talk.gossip ? null : residentMentionLine(id, firstTalkToday, conversationIndex);
      line = mention ? `${talk.line} ${mention}` : talk.line;
      const invite = TownLifeSystem.offerInvite(id);
      if (invite) line = `${line} ${invite}`;
    }
    gs.dialogue = { kind: 'message', name: resident.name, line, residentId: resident.id,
      hearts: pointsToHearts(gs.relationships.residents[id].points) };
    return;
  }
  if (!SettingsSystem.get().localNpcChat) {
    GameState.instance.dialogue = { kind: 'message', name: 'Local chat is off',
      line: 'Turn Local chat on in Town Bonds, then speak to me again.', residentId: resident.id };
    return;
  }
  if (residentRefusesChatToday(resident.id)) {
    GameState.instance.dialogue = { kind: 'message', name: resident.name,
      line: 'I am done talking for today. Please give me space.', residentId: resident.id };
    return;
  }
  requestGeneration++;
  let memory;
  try { memory = residentChatContext(resident.id); }
  catch (error) {
    GameState.instance.dialogue = { kind: 'message', name: 'Chat notes could not open',
      line: error instanceof Error ? error.message : String(error), residentId: resident.id };
    return;
  }
  GameState.instance.dialogue = { kind: 'resident-chat', name: resident.name,
    line: 'Type what you want to say.', residentId: resident.id, chatPhase: 'input', draft: '',
    history: memory.turns, memorySummary: memory.summary, revision: dialogue.revision ?? ++dialogueRevision,
    declinedOffers: [] };
}

/** Append one printable character to the active local-chat input. */
export function typeResidentChat(character: string): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'input') return;
  if (character.length !== 1 || dialogue.draft === undefined || dialogue.draft.length >= 120) return;
  dialogue.draft += character;
}

/**
 * Replace the whole local-chat line at once. The touch text box (TouchTextEntry) uses this, because a
 * phone keyboard edits the line as a whole (autocorrect, paste, swipe typing), not one key at a time.
 * @param text the full line from the text box
 * @throws when the chat input is not open, or the text is longer than the limit or has a line break
 */
export function setResidentChatDraft(text: string): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'input') throw new Error('Resident chat: the input is not open');
  // why: the text box has the same maxlength and is one line, so a longer or multi-line value is a real bug.
  if (text.length > MAX_MESSAGE_LENGTH || /[\r\n]/.test(text)) throw new Error('Resident chat: the line is too long or has a line break');
  dialogue.draft = text;
}

/** Remove the last character from the active local-chat input. */
export function backspaceResidentChat(): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'input') return;
  dialogue.draft = (dialogue.draft ?? '').slice(0, -1);
}

/** Send one guarded speech turn and ignore replies after the conversation closes or changes. */
export async function sendResidentChat(): Promise<void> {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'input' || !dialogue.residentId) return;
  const message = (dialogue.draft ?? '').trim();
  if (!message) return;
  const residentId = dialogue.residentId as ResidentId;
  const declined = dialogue.declinedOffers;
  if (!declined) throw new Error('Resident chat: the conversation has no declined-offer list');
  try { assertResidentChatCapacity(residentId); }
  catch (error) {
    GameState.instance.dialogue = { ...dialogue, chatPhase: 'reply',
      line: error instanceof Error ? error.message : String(error) };
    return;
  }
  const generation = ++requestGeneration;
  GameState.instance.dialogue = { ...dialogue, draft: '', playerLine: message, chatPhase: 'waiting', line: 'Thinking…' };
  try {
    const result = await chatWithResident(residentId, message, dialogue.history ?? [], dialogue.memorySummary ?? '',
      recentResidentGifts(residentId), ResidentOfferSystem.eligibleOffers(residentId, declined));
    const current = GameState.instance.dialogue;
    if (generation !== requestGeneration || !current || current.kind !== 'resident-chat' || current.residentId !== residentId) return;
    const memory = recordResidentChatExchange(residentId, message, result.reply);
    const history = memory.turns.slice(-MAX_HISTORY_TURNS);
    applyResidentChatOutcome(residentId, result.outcome);
    // why: only a reply that stayed friendly counts toward friendship; the daily cap stops farming.
    if (result.outcome === 'continue') TownLifeSystem.grantChatFriendship(residentId);
    // why: the gates are checked again after the wait; the clock or bag may have changed meanwhile.
    const chatOffer = result.offer !== 'none' && ResidentOfferSystem.isEligible(residentId, result.offer) ? result.offer : undefined;
    GameState.instance.dialogue = { ...current, chatPhase: 'reply', line: result.reply, history,
      memorySummary: memory.summary, chatOutcome: result.outcome, chatIsOnIntimateTopic: result.intimateTopic,
      cuddleChoice: result.intimateTopic ? 'bedroom' : undefined, cuddleDecisionPhase: undefined,
      chatOffer, offerChoice: chatOffer ? 'accept' : undefined };
  } catch (error) {
    const current = GameState.instance.dialogue;
    if (generation !== requestGeneration || !current || current.kind !== 'resident-chat' || current.residentId !== residentId) return;
    GameState.instance.dialogue = { ...current, chatPhase: 'reply', line: error instanceof Error ? error.message : String(error) };
  }
}

/** Start another local speech turn after reading the current reply. */
export function continueResidentChat(): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'reply') return;
  if (dialogue.chatOutcome === 'end-conversation' || dialogue.chatOutcome === 'call-guard') {
    closeDialogue();
    return;
  }
  // why: moving on without answering an offer counts as "not now", so the model is not asked to repeat it.
  const declinedOffers = dialogue.chatOffer ? [...(dialogue.declinedOffers ?? []), dialogue.chatOffer] : dialogue.declinedOffers;
  GameState.instance.dialogue = { ...dialogue, chatPhase: 'input', draft: '', playerLine: undefined,
    line: 'Type what you want to say.', chatOutcome: undefined, chatIsOnIntimateTopic: false,
    cuddleChoice: undefined, cuddleDecisionPhase: undefined, chatOffer: undefined, offerChoice: undefined, declinedOffers };
}

/** Return whether the accept/decline buttons for a resident's offer belong in the bottom panel. */
export function residentOfferVisible(): boolean {
  const dialogue = GameState.instance.dialogue;
  return !!dialogue && dialogue.kind === 'resident-chat' && dialogue.chatPhase === 'reply'
    && dialogue.residentId !== undefined && dialogue.chatOffer !== undefined;
}

/**
 * Change the highlighted offer answer for keyboard control.
 * @param choice 'accept' or 'decline'
 */
export function selectResidentOfferChoice(choice: 'accept' | 'decline'): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || !residentOfferVisible()) return;
  dialogue.offerChoice = choice;
}

/**
 * Answer the shown offer. Accept runs the authored effect and shows the resident's authored line with
 * the result; a refused effect (e.g. a full bag) shows why and changes nothing. Decline keeps chatting.
 * @param choice the answer; omitted means the highlighted one (keyboard Enter)
 * @throws when the shown offer is no longer allowed (it is re-checked when the reply arrives)
 */
export function confirmResidentOffer(choice?: 'accept' | 'decline'): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || !residentOfferVisible()) return;
  const residentId = dialogue.residentId as ResidentId, offerId = dialogue.chatOffer!;
  const answer = choice ?? dialogue.offerChoice;
  if (answer !== 'accept' && answer !== 'decline') throw new Error('Resident chat: the offer has no highlighted answer');
  if (answer === 'decline') {
    GameState.instance.dialogue = { ...dialogue, chatOffer: undefined, offerChoice: undefined,
      declinedOffers: [...(dialogue.declinedOffers ?? []), offerId] };
    return;
  }
  const result = ResidentOfferSystem.accept(residentId, offerId);
  // why: a refused effect (full bag) is not used up, so it is not added to declinedOffers; the resident may offer again.
  GameState.instance.dialogue = { ...dialogue, chatOffer: undefined, offerChoice: undefined,
    line: result.ok ? `${CHAT_OFFERS[offerId].acceptLine}\n\n${result.message}` : result.message };
}

/** Return whether the two contextual Cuddle buttons belong in the active bottom panel. */
export function residentCuddleChoicesVisible(): boolean {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-chat' || dialogue.chatPhase !== 'reply' || !dialogue.residentId
    || dialogue.cuddleDecisionPhase === 'waiting' || dialogue.chatOffer !== undefined) return false;
  return playerCuddleAvailable(dialogue.residentId as ResidentId, dialogue.chatIsOnIntimateTopic === true);
}

/** Change the highlighted contextual Cuddle offer for keyboard control. */
export function selectResidentCuddleChoice(choice: CuddleKind): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || !residentCuddleChoicesVisible()) return;
  dialogue.cuddleChoice = choice;
}

/** Send one contextual offer to the current NPC and reject stale or duplicated replies. */
export async function confirmResidentCuddleOffer(choice?: CuddleKind): Promise<void> {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || !dialogue.residentId || !residentCuddleChoicesVisible()) return;
  const residentId = dialogue.residentId as ResidentId, revision = dialogue.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw new Error('Resident dialogue has no valid revision.');
  const offer = choice ?? dialogue.cuddleChoice ?? 'bedroom';
  const generation = ++requestGeneration;
  GameState.instance.dialogue = { ...dialogue, cuddleChoice: offer, cuddleDecisionPhase: 'waiting',
    line: offer === 'bedroom' ? 'They consider going somewhere private…' : 'They consider the risky suggestion…' };
  try {
    const decision = await askResidentCuddle(residentId, offer, dialogue.history ?? [], revision as number);
    const current = GameState.instance.dialogue;
    if (generation !== requestGeneration || !current || current.kind !== 'resident-chat'
      || current.residentId !== residentId || current.revision !== revision || current.cuddleDecisionPhase !== 'waiting') return;
    if (!decision.accepted) {
      GameState.instance.dialogue = { ...current, chatPhase: 'reply', line: decision.reason,
        cuddleDecisionPhase: 'denied', cuddleChoice: offer };
      return;
    }
    startPlayerCuddle(residentId, offer, decision.reason);
    requestGeneration++;
    GameState.instance.dialogue = { kind: 'message', name: residentDefinition(residentId).name,
      line: decision.reason, residentId, revision, cuddleDecisionPhase: 'accepted' };
  } catch (error) {
    const current = GameState.instance.dialogue;
    if (generation !== requestGeneration || !current || current.kind !== 'resident-chat'
      || current.residentId !== residentId || current.revision !== revision) return;
    GameState.instance.dialogue = { ...current, chatPhase: 'reply', cuddleDecisionPhase: undefined,
      line: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The Together grid for one resident: game-decided actions. Buy a drink shows only inside The Wayfarer.
 * @param id the resident
 */
function actionMenuOptions(id: ResidentId): DialogueOption[] {
  const gs = GameState.instance, inParty = gs.social.party.includes(id);
  const options: DialogueOption[] = [
    { id: 'befriend', label: 'Spend time' },
    { id: 'flirt', label: 'Flirt' },
    { id: 'plans', label: 'Plans for tomorrow' },
    inParty ? { id: 'party-leave', label: 'Leave my party' } : { id: 'party-join', label: 'Join my party' },
  ];
  // why: only party members walk with the keeper; the walk ends when they leave the party.
  if (inParty) {
    options.push(CompanionWalkSystem.isWalking(id) ? { id: 'walk-stop', label: 'Go about your day' }
      : { id: 'walk-start', label: 'Walk with me' });
  }
  if (gs.activeScene === SceneKey.TownBar) options.push({ id: 'drink', label: `Buy a drink (${ROUND_PRICE}g)` });
  options.push({ id: 'back', label: 'Back' });
  return options;
}

/**
 * Open the Together grid for one resident.
 * @param id the resident
 */
export function openResidentActions(id: ResidentId): void {
  const resident = residentDefinition(id), gs = GameState.instance;
  requestGeneration++;
  gs.dialogue = { kind: 'resident-actions', name: resident.name, line: `What would you like to do with ${resident.name}?`,
    residentId: id, hearts: pointsToHearts(gs.relationships.residents[id].points), options: actionMenuOptions(id),
    optionIndex: 0, actionStep: 'menu', revision: ++dialogueRevision };
}

/**
 * Highlight one button of the Together grid.
 * @param index button index
 * @throws when the index is outside the grid
 */
export function selectResidentAction(index: number): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-actions') return;
  if (!dialogue.options || !Number.isSafeInteger(index) || index < 0 || index >= dialogue.options.length) {
    throw new Error(`Resident actions: option ${index} does not exist`);
  }
  dialogue.optionIndex = index;
}

/**
 * Move the highlight through the Together grid, wrapping at the ends.
 * @param step how many buttons to move (negative moves back)
 */
export function cycleResidentAction(step: number): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-actions') return;
  if (!dialogue.options || dialogue.optionIndex === undefined) throw new Error('Resident actions: the grid has no options');
  const count = dialogue.options.length;
  dialogue.optionIndex = ((dialogue.optionIndex + step) % count + count) % count;
}

/**
 * Show the game's result of one Together action as a message from the resident.
 * @param id the resident
 * @param line the game's result line
 */
function showActionResult(id: ResidentId, line: string): void {
  const gs = GameState.instance;
  gs.dialogue = { kind: 'message', name: residentDefinition(id).name, line, residentId: id,
    hearts: pointsToHearts(gs.relationships.residents[id].points) };
}

/**
 * Run the highlighted (or given) Together button. Every outcome comes from KeeperSocialSystem.
 * @param index optional button index (a click passes it; Enter and E use the highlight)
 */
export function confirmResidentAction(index?: number): void {
  const dialogue = GameState.instance.dialogue;
  if (!dialogue || dialogue.kind !== 'resident-actions' || !dialogue.residentId) return;
  if (index !== undefined) selectResidentAction(index);
  const id = dialogue.residentId as ResidentId, options = dialogue.options, chosen = dialogue.optionIndex;
  if (!options || chosen === undefined) throw new Error('Resident actions: the grid has no options');
  const option = options[chosen];
  if (dialogue.actionStep === 'plans') {
    if (option.id === 'back') { openResidentActions(id); return; }
    const plans = dialogue.planOptions;
    if (!plans || !plans[chosen]) throw new Error(`Resident actions: plan ${chosen} does not exist`);
    showActionResult(id, KeeperSocialSystem.makePlan(id, plans[chosen]).line);
    return;
  }
  switch (option.id) {
    case 'back': openResidentDialogue(id); return;
    case 'befriend': {
      const result = KeeperSocialSystem.befriend(id);
      // why: a short authored reaction gives each resident their own voice here without the local model.
      const sheet = residentCharacterSheet(id), gs = GameState.instance;
      const reaction = result.ok ? ` "${sheet.reactions.curious[gs.day % sheet.reactions.curious.length]}"` : '';
      showActionResult(id, `${result.line}${reaction}`);
      return;
    }
    case 'flirt': showActionResult(id, KeeperSocialSystem.flirt(id).line); return;
    case 'party-join': showActionResult(id, KeeperSocialSystem.joinParty(id).line); return;
    case 'party-leave': showActionResult(id, KeeperSocialSystem.leaveParty(id).line); return;
    case 'walk-start': showActionResult(id, CompanionWalkSystem.startWalk(id).line); return;
    case 'walk-stop': showActionResult(id, CompanionWalkSystem.stopWalk(id).line); return;
    case 'drink': showActionResult(id, KeeperSocialSystem.buyRound(id, [id]).line); return;
    case 'plans': {
      const plans = KeeperSocialSystem.planOptions(id);
      if (!plans.ok) { showActionResult(id, plans.line); return; }
      dialogue.actionStep = 'plans';
      dialogue.planOptions = plans.options;
      dialogue.options = [...plans.options.map((plan, planIndex) => ({ id: `plan-${planIndex}`,
        label: `${plan.label} · ${townClockLabel(plan.startsAt)}` })), { id: 'back', label: 'Back' }];
      dialogue.optionIndex = 0;
      dialogue.line = `Where should you meet ${dialogue.name} tomorrow? They will really be there.`;
      return;
    }
    default: throw new Error(`Resident actions: unknown action ${option.id}`);
  }
}

/** Close any dialogue and invalidate its pending local request. */
export function closeDialogue(): void {
  requestGeneration++;
  GameState.instance.dialogue = null;
}

/**
 * Keep the letter E inside the resident panel for its whole lifetime, including delayed key replay.
 * The Wayfarer table also owns every key while it is open (its own handler reads E, Enter, and typing).
 */
export function residentChatCapturesTyping(): boolean {
  const dialogue: DialogueState | null = GameState.instance.dialogue;
  return dialogue?.kind === 'resident-chat' || dialogue?.kind === 'wayfarer-table';
}
