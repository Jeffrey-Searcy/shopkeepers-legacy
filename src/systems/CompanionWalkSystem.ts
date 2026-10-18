/**
 * CompanionWalkSystem — party members who walk beside the keeper outside combat.
 *
 * A resident in the adventuring party (GameState.social.party) can be asked to "Walk with me" from the
 * Together grid. While walking, the resident follows the keeper through every world scene except the
 * Dungeon and the Mines (they bring the whole party already, as fighters) and the Jail (the watch
 * house holds prisoners, not visitors). Their scheduled town body (TownResident) hides meanwhile, so
 * the resident is never in two places at once.
 *
 * The walk list lives in GameState.companionWalk and is never saved: loading a game or starting a new
 * one always begins with nobody following. A walk ends on its own when:
 *  - the clock reaches RESIDENT_HOME_DEADLINE (midnight) or a new day begins;
 *  - the resident leaves the party or is jailed;
 *  - the resident joins a private moment (CuddleSystem session), which then owns where they stand;
 *  - the keeper is arrested.
 * BaseWorldScene calls endExpiredWalks() once per frame and shows the toasts it returns.
 */
import { SceneKey } from '../config/AssetKeys';
import type { ResidentId } from '../config/ResidentRelationships';
import { RESIDENT_HOME_DEADLINE } from '../config/TownSchedules';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState } from '../state/GameState';
import { isResidentJailed } from './JusticeSystem';
import { closeDialogue } from './ResidentDialogueSystem';

/** Scenes where walking companions do not appear (see the file header for why). */
const NO_WALK_SCENES: ReadonlySet<SceneKey> = new Set([SceneKey.Dungeon, SceneKey.Mines, SceneKey.Jail]);

/** Result of asking a resident to start or stop walking: the line shown in their dialogue box. */
export interface CompanionWalkResult {
  ok: boolean;
  line: string;
}

/**
 * Display name for one resident.
 * @param id the resident
 * @throws when the id is not in the town catalog
 */
function nameOf(id: ResidentId): string {
  const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
  if (!resident) throw new Error(`Companion walk: resident "${id}" is missing from the town catalog`);
  return resident.name;
}

/**
 * True while the resident takes part in a private moment session (traveling, waiting, or busy).
 * @param id the resident
 */
function inPrivateMoment(id: ResidentId): boolean {
  const session = GameState.instance.cuddle.session;
  return session !== null && session.participants.some(entry => entry.kind === 'resident' && entry.residentId === id);
}

/**
 * Whether walking companions appear in a scene.
 * @param scene the world scene key
 */
function walksIn(scene: SceneKey): boolean {
  return !NO_WALK_SCENES.has(scene);
}

/**
 * Whether the resident is walking with the keeper today. Pure read: endExpiredWalks() does the cleanup.
 * @param id the resident
 */
function isWalking(id: ResidentId): boolean {
  const walk = GameState.instance.companionWalk;
  return walk.day === GameState.instance.day && walk.residents.includes(id);
}

/** The residents walking with the keeper today, in the order they joined. */
function walkers(): readonly ResidentId[] {
  const gs = GameState.instance;
  return gs.companionWalk.day === gs.day ? gs.companionWalk.residents : [];
}

/**
 * Ask a party member to walk with the keeper.
 * @param id the resident (must be in the party and not walking yet; the Together grid only offers it then)
 * @returns the line to show; ok is false when the resident cannot come right now
 * @throws when the resident is not in the party or is already walking (a stale button)
 */
function startWalk(id: ResidentId): CompanionWalkResult {
  const gs = GameState.instance;
  if (!gs.social.party.includes(id)) throw new Error(`Companion walk: ${id} is not in the party`);
  if (isWalking(id)) throw new Error(`Companion walk: ${id} is already walking with the keeper`);
  const name = nameOf(id);
  if (gs.timeOfDay >= RESIDENT_HOME_DEADLINE) return { ok: false, line: `${name}: "It is late. I am heading home."` };
  if (isResidentJailed(id)) return { ok: false, line: `${name} cannot leave the watch house today.` };
  if (inPrivateMoment(id)) return { ok: false, line: `${name} needs a private moment first.` };
  // why: a walk list from an earlier day is stale; start today's list fresh instead of appending to it.
  if (gs.companionWalk.day !== gs.day) gs.companionWalk = { day: gs.day, residents: [] };
  gs.companionWalk.residents.push(id);
  return { ok: true, line: `${name}: "Lead the way. I will stay close."` };
}

/**
 * Send a walking companion back to their own day.
 * @param id the resident (must be walking; the Together grid only offers it then)
 * @returns the line to show
 * @throws when the resident is not walking with the keeper
 */
function stopWalk(id: ResidentId): CompanionWalkResult {
  if (!isWalking(id)) throw new Error(`Companion walk: ${id} is not walking with the keeper`);
  const walk = GameState.instance.companionWalk;
  walk.residents = walk.residents.filter(member => member !== id);
  return { ok: true, line: `${nameOf(id)}: "Thanks for the company. See you around."` };
}

/**
 * Drop every walk that should end now. Call once per world frame.
 * Side effects: shortens GameState.companionWalk; closes the dialogue if it was with a resident who
 * just headed home.
 * @returns toast lines for walks that ended on their own (bedtime, new day)
 */
function endExpiredWalks(): string[] {
  const gs = GameState.instance, walk = gs.companionWalk, lines: string[] = [];
  if (walk.residents.length === 0) return lines;
  const newDay = walk.day !== gs.day, bedtime = gs.timeOfDay >= RESIDENT_HOME_DEADLINE;
  const kept: ResidentId[] = [];
  for (const id of walk.residents) {
    if (newDay || bedtime) {
      lines.push(`${nameOf(id)} heads home for the night.`);
      if (gs.dialogue?.residentId === id) closeDialogue();
      continue;
    }
    // why: leaving the party, a cell, or a private moment each come with their own message elsewhere,
    // so these walks end quietly.
    if (!gs.social.party.includes(id) || isResidentJailed(id) || inPrivateMoment(id)) continue;
    kept.push(id);
  }
  gs.companionWalk = { day: gs.day, residents: kept };
  return lines;
}

/**
 * End every walk because the keeper is being taken to the watch house.
 * @returns one toast line per companion who leaves
 */
function endAllWalks(): string[] {
  const lines = walkers().map(id => `${nameOf(id)} steps back as the watch takes you in.`);
  GameState.instance.companionWalk = { day: GameState.instance.day, residents: [] };
  return lines;
}

export const CompanionWalkSystem = Object.freeze({
  walksIn,
  isWalking,
  walkers,
  startWalk,
  stopWalk,
  endExpiredWalks,
  endAllWalks,
});
