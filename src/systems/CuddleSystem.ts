/**
 * Authoritative always-on Cuddle, private-room, witness, and short activity controller. No setting turns it off.
 *
 * The local model can classify a topic and accept or deny an offer. Only this module can start,
 * advance, finish, or cancel gameplay state. All random choices use the save's social seed.
 */
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { RESIDENT_RELATIONSHIPS, residentBondId, residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { DAYDREAM_ROUTE_LABEL, townRouteProfile } from '../config/TownRouteTemplates';
import { townBuilding } from '../config/TownBuildings';
import { civicInteriorBlueprint } from '../config/CivicInteriors';
import { type PrivateRoomActivity, type CuddleKind, type CuddleParticipant,
  type CuddleSession } from '../config/Cuddle';
import { GameState, type Facing } from '../state/GameState';
import { MAX_RELATIONSHIP_POINTS, relationshipView, residentSocialRoll } from './RelationshipSystem';
import { isResidentJailed, reportCuddleIncident } from './JusticeSystem';
import { getMapData } from '../world/MapDef';
import { authoredPrivateRouteWindow } from './TownRoutePlanSystem';

const PLAYER_IS_VERIFIED_ADULT = true;
const BEDROOM_TRAVEL_MINUTES = 20;
const BEDROOM_WAIT_MINUTES = 90;
const ACTIVE_MINUTES = 10;
const PLAYER_ROMANCE_BOOST = 20;
const NPC_ROMANCE_BOOST = 8;
const MOOD_BOOST = 8;
const MAX_MOOD = 100;
const PRIVATE_ACTIVITIES: readonly Exclude<PrivateRoomActivity, 'daydreaming'>[] = ['reading', 'bathing', 'playing', 'resting'];

/** Passable staging tile plus the exact visual center of one resident's authored bed. */
export interface ResidentBedroomTarget {
  scene: SceneKey;
  tx: number;
  ty: number;
  effectX: number;
  effectY: number;
}

/** Scene-local position used by actors and the shared placeholder renderer. */
export interface CuddleDirective {
  scene: SceneKey;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  activity: string;
}

/** Minimal visible actor information used by the pure facing-cone witness pass. */
export interface CuddleObserver {
  residentId: ResidentId;
  scene: SceneKey;
  tx: number;
  ty: number;
  facing: Facing;
  visible: boolean;
}

/** Renderer-owned view. It contains no mutable Phaser objects. */
export interface CuddleEffectView {
  kind: CuddleKind;
  scene: SceneKey;
  x: number;
  y: number;
  participants: readonly CuddleParticipant[];
  selfActivity: boolean;
}

/**
 * Residents currently pinned to their own bed for daydreaming, keyed to the scene that holds the bed.
 * why: a resident's schedule can run behind the real clock after a long conversation, so the directive
 * (which uses the resident's own schedule minute) is the only authority. The blurred effect follows it.
 * Runtime only; never saved. Cleared when a world scene starts.
 */
const pinnedSelfActivity = new Map<ResidentId, SceneKey>();

/** Forget every self-activity pin. Each world scene calls this on create so a stale pin never flashes. */
export function resetPinnedSelfActivity(): void {
  pinnedSelfActivity.clear();
}

/** Convert the game calendar into a monotonic minute used only by transient activities. */
function absoluteMinute(): number {
  const gs = GameState.instance;
  return (gs.day - 1) * 1440 + gs.timeOfDay;
}

/**
 * Resolve one resident's bedroom target (the tile to wait on beside their bed) and owning scene.
 * @param id the resident whose home bed is used
 * @returns the scene, the wait tile, and the bed centre in world pixels for the effect
 * @throws for an unknown resident
 */
export function residentBedroom(id: ResidentId): ResidentBedroomTarget {
  const resident = TOWN_RESIDENTS.find(candidate => candidate.id === id);
  if (!resident) throw new Error(`Private moment: unknown resident ${id}`);
  const scene = townBuilding(resident.buildingId).scene;
  const bed = civicInteriorBlueprint(resident.buildingId).bed;
  // Wait one tile below the bed's solid lower edge so the actor never occupies collision geometry.
  // why: CivicInteriors checks at load that this wait tile is walkable bedroom floor in every painted room.
  return { scene, tx: bed.tx + 1, ty: bed.ty + bed.h,
    effectX: (bed.tx + bed.w / 2) * TILE, effectY: (bed.ty + bed.h / 2) * TILE };
}

/** Match the evening daydreaming window shown in the editable weekly route. */
export function residentDaydreamWindow(id: ResidentId, day: number): { startsAt: number; endsAt: number } {
  return authoredPrivateRouteWindow(id, day);
}

/** Derive a private activity without allowing a non-adult profile to enter daydreaming. */
export function residentPrivateActivityForDay(id: ResidentId, day: number, explicitAdult: unknown,
  socialSeed: number): PrivateRoomActivity {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Private moment: invalid day ${day}`);
  const weekday = (day - 1) % 7;
  if (explicitAdult === true && townRouteProfile(id).privateActivities[weekday] === DAYDREAM_ROUTE_LABEL) return 'daydreaming';
  return PRIVATE_ACTIVITIES[residentSocialRoll(socialSeed, day, `${id}:private-activity`) % PRIVATE_ACTIVITIES.length];
}

/** Build a real collision-aware route from the room entrance to the waiting tile. */
function bedroomPath(scene: SceneKey, target: { tx: number; ty: number }): readonly { tx: number; ty: number }[] {
  const map = getMapData(scene), spawn = map.spawns.find(candidate => candidate.id === 'from_town') ?? map.spawns[0];
  if (!spawn) throw new Error(`Private moment: ${scene} has no entry spawn`);
  const start = { tx: spawn.tx, ty: spawn.ty }, queue = [start], parents = new Map<string, string | null>([[`${start.tx},${start.ty}`, null]]);
  const targetKey = `${target.tx},${target.ty}`;
  for (let index = 0; index < queue.length && !parents.has(targetKey); index++) {
    const point = queue[index];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const tx = point.tx + dx, ty = point.ty + dy, key = `${tx},${ty}`;
      if (parents.has(key) || tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.solid[ty][tx]
        || map.ground[ty][tx] === 'water') continue;
      parents.set(key, `${point.tx},${point.ty}`); queue.push({ tx, ty });
    }
  }
  if (!parents.has(targetKey)) throw new Error(`Private moment: no bedroom path in ${scene}`);
  const reverse: { tx: number; ty: number }[] = [];
  let cursor: string | null = targetKey;
  while (cursor) {
    const [tx, ty] = cursor.split(',').map(Number); reverse.push({ tx, ty }); cursor = parents.get(cursor) ?? null;
  }
  return reverse.reverse();
}

/** Enforce role-specific adult and romanceable requirements without permissive defaults. */
function assertEligibleResident(id: ResidentId, role: 'partner' | 'pair' | 'self'): void {
  const profile = residentRelationshipProfile(id) as { adult?: unknown; romanceable?: unknown };
  if (profile.adult !== true) throw new Error(`Private moment: ${id} is not an explicitly authored adult`);
  if (role !== 'self' && profile.romanceable !== true) throw new Error(`Private moment: ${id} is not explicitly romanceable`);
}

/** Return whether the current local reply may expose both contextual choices. */
export function playerCuddleAvailable(id: ResidentId, chatIsOnIntimateTopic: boolean): boolean {
  if (!PLAYER_IS_VERIFIED_ADULT || chatIsOnIntimateTopic !== true) return false;
  try { assertEligibleResident(id, 'partner'); } catch { return false; }
  const stage = relationshipView(id).romanceStage;
  return stage === 'dating' || stage === 'committed';
}

/** Start one validated player-owned session after the local model accepts. */
export function startPlayerCuddle(id: ResidentId, kind: CuddleKind, spokenReason: string): CuddleSession {
  if (!PLAYER_IS_VERIFIED_ADULT) throw new Error('Private moments require a verified adult player.');
  assertEligibleResident(id, 'partner');
  if (!playerCuddleAvailable(id, true)) throw new Error('A private moment requires a dating or committed relationship.');
  if (GameState.instance.cuddle.session) throw new Error('Another private activity is already in progress.');
  const reason = spokenReason.trim();
  if (!reason || reason.length > 180 || /[{}\[\]\r\n]/.test(reason)) throw new Error('Private-moment acceptance reason is invalid.');
  const now = absoluteMinute();
  const target = kind === 'bedroom' ? residentBedroom(id) : {
    scene: GameState.instance.activeScene,
    tx: Math.floor(GameState.instance.player.x / TILE),
    ty: Math.floor(GameState.instance.player.y / TILE),
  };
  if (kind === 'bedroom') bedroomPath(target.scene, target);
  const session: CuddleSession = {
    id: `${GameState.instance.day}:${GameState.instance.timeOfDay}:${id}:${kind}`,
    kind,
    participants: [{ kind: 'player' }, { kind: 'resident', residentId: id }],
    phase: kind === 'bedroom' ? 'traveling' : 'active', scene: target.scene, tx: target.tx, ty: target.ty,
    createdDay: GameState.instance.day, createdMinute: GameState.instance.timeOfDay,
    phaseEndsAt: now + (kind === 'bedroom' ? BEDROOM_TRAVEL_MINUTES : ACTIVE_MINUTES),
    deadlineAt: now + (kind === 'bedroom' ? BEDROOM_TRAVEL_MINUTES + BEDROOM_WAIT_MINUTES : ACTIVE_MINUTES),
    spokenReason: reason, witnesses: [],
  };
  GameState.instance.cuddle.session = session;
  return session;
}

/** Start a waiting bedroom activity when the player interacts with its NPC or bed. */
export function interactWithWaitingCuddle(scene: SceneKey, tx: number, ty: number, residentId?: ResidentId): boolean {
  const session = GameState.instance.cuddle.session;
  if (!session || session.kind !== 'bedroom' || session.phase !== 'waiting' || session.scene !== scene ||
    !session.participants.some(participant => participant.kind === 'player')) return false;
  const residentMatches = residentId !== undefined && tx === session.tx && ty === session.ty && session.participants.some(participant =>
    participant.kind === 'resident' && participant.residentId === residentId);
  const bedMatches = Math.abs(tx - session.tx) <= 1 && Math.abs(ty - session.ty) <= 1;
  if (!residentMatches && !bedMatches) return false;
  session.phase = 'active';
  session.phaseEndsAt = absoluteMinute() + ACTIVE_MINUTES;
  return true;
}

/** Finish one short activity and apply bounded game-owned mood and relationship changes. */
function finishSession(session: CuddleSession): void {
  const gs = GameState.instance;
  const residents = session.participants.filter((participant): participant is { kind: 'resident'; residentId: ResidentId } =>
    participant.kind === 'resident').map(participant => participant.residentId);
  const hasPlayer = session.participants.some(participant => participant.kind === 'player');
  for (const id of residents) {
    if (hasPlayer) {
      const relationship = gs.relationships.residents[id];
      relationship.points = Math.min(MAX_RELATIONSHIP_POINTS, relationship.points + PLAYER_ROMANCE_BOOST);
    }
    gs.cuddle.moodBoosts[id] = Math.min(MAX_MOOD, (gs.cuddle.moodBoosts[id] ?? 0) + MOOD_BOOST);
  }
  if (!hasPlayer && residents.length === 2) {
    const bond = gs.relationships.bonds[residentBondId(residents[0], residents[1])];
    bond.points = Math.min(250, bond.points + NPC_ROMANCE_BOOST);
  }
  gs.cuddle.session = null;
}

/** Refresh deterministic private states once per day while Cuddle remains on. */
function refreshPrivateRoomStates(): void {
  const gs = GameState.instance;
  if (gs.cuddle.lastPrivateActivityDay === gs.day) return;
  gs.cuddle.privateRooms = {};
  for (const profile of RESIDENT_RELATIONSHIPS) {
    const target = residentBedroom(profile.id);
    const activity = residentPrivateActivityForDay(profile.id, gs.day, profile.adult, gs.relationships.socialSeed);
    const window = authoredPrivateRouteWindow(profile.id, gs.day);
    gs.cuddle.privateRooms[profile.id] = { residentId: profile.id, day: gs.day, activity, ...target, ...window };
  }
  gs.cuddle.lastPrivateActivityDay = gs.day;
}

/** Lowest NPC bond points at which a pair may choose private time together. */
const PAIR_PRIVATE_MIN_POINTS = 175;

/**
 * Evening home window for high-romance resident pairs (docs/RELATIONSHIPS.md).
 * During the first resident's private evening window, each eligible pair gets one seeded chance per day
 * to go to that resident's bedroom together. This runs from any world scene, so it happens off-screen too.
 * Pairs where either resident is jailed or has a self activity tonight are skipped.
 */
function tryEveningPairPrivateTime(): void {
  const gs = GameState.instance;
  if (gs.cuddle.session) return;
  const adults = RESIDENT_RELATIONSHIPS.filter(profile => (profile as { adult?: unknown }).adult === true
    && (profile as { romanceable?: unknown }).romanceable === true).map(profile => profile.id);
  for (let a = 0; a < adults.length; a++) for (let b = a + 1; b < adults.length; b++) {
    const first = adults[a], second = adults[b], bondId = residentBondId(first, second);
    const bond = gs.relationships.bonds[bondId];
    if (!bond) throw new Error(`Private moment: missing bond ${bondId}`);
    if (bond.points < PAIR_PRIVATE_MIN_POINTS || isResidentJailed(first) || isResidentJailed(second)) continue;
    if (gs.cuddle.privateRooms[first]?.activity === 'daydreaming' || gs.cuddle.privateRooms[second]?.activity === 'daydreaming') continue;
    const window = authoredPrivateRouteWindow(first, gs.day);
    if (gs.timeOfDay < window.startsAt || gs.timeOfDay >= window.endsAt) continue;
    if (tryStartNpcPairCuddle(`${gs.day}:evening:${bondId}`, first, second, undefined, 'bedroom')) return;
  }
}

/** Advance transient phases and commit reports only after their visible reaction delay. */
export function updateCuddle(): void {
  refreshPrivateRoomStates();
  tryEveningPairPrivateTime();
  const gs = GameState.instance, session = gs.cuddle.session, now = absoluteMinute();
  if (!session) return;
  if (session.phase === 'traveling' && now >= session.phaseEndsAt) {
    session.phase = 'waiting';
    session.phaseEndsAt = session.participants.some(participant => participant.kind === 'player') ? session.deadlineAt : now + 2;
  } else if (session.phase === 'waiting' && now >= session.deadlineAt) {
    gs.cuddle.session = null;
    return;
  } else if (session.phase === 'waiting' && !session.participants.some(participant => participant.kind === 'player')
    && now >= session.phaseEndsAt) {
    session.phase = 'active';
    session.phaseEndsAt = now + ACTIVE_MINUTES;
  } else if (session.phase === 'active' && now >= session.phaseEndsAt) {
    finishSession(session);
    return;
  }
  for (const witness of session.witnesses) {
    if (witness.committed || !witness.willReport) continue;
    const reportAt = Number((witness as typeof witness & { reportAt?: number }).reportAt);
    if (!Number.isFinite(reportAt) || now < reportAt) continue;
    if (GameState.instance.cuddle.session?.id !== session.id) return;
    witness.committed = true;
    const residents = session.participants.filter((participant): participant is { kind: 'resident'; residentId: ResidentId } =>
      participant.kind === 'resident').map(participant => participant.residentId);
    reportCuddleIncident(witness.residentId, session.participants.some(participant => participant.kind === 'player'), residents);
  }
}

/** The schedule a resident actor is following right now, at the minute that schedule was resolved for. */
export interface ResidentScheduleMoment {
  /** Schedule activity label, e.g. 'home'. */
  activity: string;
  /** Minutes since 06:00 the schedule was resolved at. Behind the real clock after a long conversation. */
  minute: number;
}

/**
 * Return a scene-owned movement override, including private-room schedule states.
 * The private window is checked against the same minute the schedule used, so the actor never mixes clocks.
 * @param id resident
 * @param scheduled the actor's current schedule activity and the minute it was resolved at
 * @returns where the actor must stand, or null when the normal schedule applies
 */
export function residentCuddleDirective(id: ResidentId, scheduled: ResidentScheduleMoment): CuddleDirective | null {
  if (!Number.isFinite(scheduled.minute) || scheduled.minute < 0) throw new Error(`Private moment: invalid schedule minute ${scheduled.minute}`);
  if (isResidentJailed(id)) { pinnedSelfActivity.delete(id); return null; }
  const gs = GameState.instance, session = gs.cuddle.session;
  if (session) {
    const participant = session.participants.some(entry => entry.kind === 'resident' && entry.residentId === id);
    if (participant) {
      pinnedSelfActivity.delete(id);
      let tx = session.tx, ty = session.ty, facing: Facing = 'down';
      if (session.phase === 'traveling') {
        const path = bedroomPath(session.scene, session);
        const createdAt = (session.createdDay - 1) * 1440 + session.createdMinute;
        const progress = Math.max(0, Math.min(1, (absoluteMinute() - createdAt) / BEDROOM_TRAVEL_MINUTES));
        const pathPosition = progress * Math.max(0, path.length - 1), index = Math.min(path.length - 1, Math.floor(pathPosition));
        const from = path[index], to = path[Math.min(path.length - 1, index + 1)], fraction = pathPosition - index;
        tx = from.tx + (to.tx - from.tx) * fraction; ty = from.ty + (to.ty - from.ty) * fraction;
        facing = to.tx > from.tx ? 'right' : to.tx < from.tx ? 'left' : to.ty > from.ty ? 'down' : to.ty < from.ty ? 'up' : 'down';
      }
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      return { scene: session.scene, x, y, facing, moving: session.phase === 'traveling',
        activity: session.phase === 'traveling' ? 'heading to the bedroom' : session.phase === 'waiting' ? 'waiting privately' : 'busy' };
    }
  }
  const privateState = gs.cuddle.privateRooms[id];
  if (scheduled.activity !== 'home' || !privateState || privateState.day !== gs.day
    || scheduled.minute < privateState.startsAt || scheduled.minute >= privateState.endsAt) {
    pinnedSelfActivity.delete(id);
    return null;
  }
  const self = privateState.activity === 'daydreaming';
  if (self) pinnedSelfActivity.set(id, privateState.scene);
  else pinnedSelfActivity.delete(id);
  const x = self ? privateState.effectX : (privateState.tx + 0.5) * TILE;
  const y = self ? privateState.effectY : (privateState.ty + 0.5) * TILE;
  return { scene: privateState.scene, x, y, facing: 'down', moving: false, activity: self ? 'do not disturb' : privateState.activity };
}

/** Return the one visible blurred effect for the active world scene. */
export function cuddleEffectView(scene: SceneKey): CuddleEffectView | null {
  const gs = GameState.instance, session = gs.cuddle.session;
  if (session?.phase === 'active' && session.scene === scene) {
    const resident = session.participants.find((participant): participant is { kind: 'resident'; residentId: ResidentId } =>
      participant.kind === 'resident');
    const bedroom = session.kind === 'bedroom' && resident ? residentBedroom(resident.residentId) : null;
    return { kind: session.kind, scene, x: bedroom ? bedroom.effectX : (session.tx + 0.5) * TILE,
      y: bedroom ? bedroom.effectY : (session.ty + 0.5) * TILE,
      participants: session.participants, selfActivity: false };
  }
  // why: the effect shows only where a resident actor is actually pinned to its bed (see pinnedSelfActivity).
  const pinned = [...pinnedSelfActivity].find(([, pinnedScene]) => pinnedScene === scene);
  if (!pinned) return null;
  const privateState = gs.cuddle.privateRooms[pinned[0]];
  if (!privateState || privateState.activity !== 'daydreaming') {
    throw new Error(`Private moment: ${pinned[0]} is pinned without a self activity today`);
  }
  return { kind: 'bedroom', scene, x: privateState.effectX, y: privateState.effectY,
    participants: [{ kind: 'resident', residentId: privateState.residentId }], selfActivity: true };
}

/** Return whether the player is inside a short active session and should not move or use tools. */
export function playerCuddleBusy(): boolean {
  const session = GameState.instance.cuddle.session;
  return Boolean(session?.phase === 'active' && session.participants.some(participant => participant.kind === 'player'));
}

/** Pure four-tile cardinal cone with opaque solid and closed-door cells. */
export function inFacingVisionCone(observer: Pick<CuddleObserver, 'tx' | 'ty' | 'facing'>, target: { tx: number; ty: number },
  blocked: ReadonlySet<string>, range = 4): boolean {
  if (!Number.isInteger(range) || range < 1 || range > 4) throw new Error('Private-moment vision range must be 1 to 4 tiles.');
  const vector = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[observer.facing];
  for (let step = 1; step <= range; step++) {
    const tx = observer.tx + vector[0] * step, ty = observer.ty + vector[1] * step;
    if (blocked.has(`${tx},${ty}`)) return false;
    if (tx === target.tx && ty === target.ty) return true;
  }
  return false;
}

/** Derive the strongest explicit witness report band. */
export function cuddleReportChance(witnessId: ResidentId, participants: readonly CuddleParticipant[]): 10 | 65 | 90 {
  const gs = GameState.instance, profile = residentRelationshipProfile(witnessId);
  if (profile.traits.some(trait => ['steadfast', 'direct', 'organized', 'meticulous', 'honest'].includes(trait))) return 90;
  let chance: 10 | 65 | 90 = 65;
  for (const participant of participants) {
    if (participant.kind === 'player') {
      if (relationshipView(witnessId).hearts >= 4) chance = 10;
      continue;
    }
    if (participant.residentId === witnessId) continue;
    const bond = gs.relationships.bonds[residentBondId(witnessId, participant.residentId)];
    if (bond.betrayalDay !== null) return 90;
    if (bond.points >= 100) chance = 10;
  }
  return chance;
}

/** Add one witness reaction, then defer any report long enough for that reaction to appear first. */
export function witnessActiveCuddle(observer: CuddleObserver, blocked: ReadonlySet<string>, sameRoom = true): boolean {
  if (!observer.visible || !sameRoom) return false;
  const session = GameState.instance.cuddle.session;
  if (!session || session.phase !== 'active' || session.scene !== observer.scene ||
    session.participants.some(participant => participant.kind === 'resident' && participant.residentId === observer.residentId) ||
    session.witnesses.some(witness => witness.residentId === observer.residentId)) return false;
  if (!inFacingVisionCone(observer, { tx: session.tx, ty: session.ty }, blocked)) return false;
  const chance = cuddleReportChance(observer.residentId, session.participants);
  const roll = residentSocialRoll(GameState.instance.relationships.socialSeed, GameState.instance.day,
    `${session.id}:${observer.residentId}:report`) % 100;
  const profile = residentRelationshipProfile(observer.residentId);
  const reaction = profile.traits.includes('funny') ? 'Well. That is one way to make a scene.'
    : chance === 10 ? 'I saw nothing. Please be more careful.'
      : chance === 90 ? 'This is unacceptable. I am calling the town watch.'
        : 'What are you doing? Everyone can see you!';
  session.witnesses.push(Object.assign({ residentId: observer.residentId, reaction, willReport: roll < chance, committed: false },
    { reportAt: absoluteMinute() + 2 }));
  return true;
}

/** One visible resident actor in a scene, in world pixels, as TownResident.observation() returns it. */
export interface CuddleSceneObserver {
  residentId: ResidentId;
  x: number;
  y: number;
  facing: Facing;
}

/**
 * Run the witness pass for every visible actor in one scene. Town and every interior share this.
 * @param scene the scene the actors stand in
 * @param observers visible actors (inactive actors must be left out by the caller)
 * @param blocked tiles that stop sight, keyed "tx,ty"
 * @returns the reaction line of each new witness, in observer order, for the scene to toast
 */
export function witnessCuddleInScene(scene: SceneKey, observers: readonly CuddleSceneObserver[], blocked: ReadonlySet<string>): string[] {
  const reactions: string[] = [];
  for (const observer of observers) {
    if (!witnessActiveCuddle({ residentId: observer.residentId, scene, tx: Math.floor(observer.x / TILE),
      ty: Math.floor(observer.y / TILE), facing: observer.facing, visible: true }, blocked)) continue;
    const witness = GameState.instance.cuddle.session?.witnesses.find(entry => entry.residentId === observer.residentId);
    if (!witness) throw new Error(`Private moment: witness ${observer.residentId} was not recorded`);
    reactions.push(witness.reaction);
  }
  return reactions;
}

/** Try one light deterministic NPC-pair event during an existing high-romance meeting. */
export function tryStartNpcPairCuddle(meetingId: string, first: ResidentId, second: ResidentId,
  location?: { scene: SceneKey; tx: number; ty: number }, onlyKind?: CuddleKind): CuddleSession | null {
  if (GameState.instance.cuddle.session || GameState.instance.cuddle.offeredMeetingIds.includes(meetingId)) return null;
  assertEligibleResident(first, 'pair'); assertEligibleResident(second, 'pair');
  const gs = GameState.instance, bond = gs.relationships.bonds[residentBondId(first, second)];
  gs.cuddle.offeredMeetingIds.push(meetingId);
  if (!bond || bond.points < 175 || residentSocialRoll(gs.relationships.socialSeed, gs.day, `${meetingId}:eligible-cuddle`) % 100 >= 25) return null;
  const kind: CuddleKind = onlyKind
    ?? (residentSocialRoll(gs.relationships.socialSeed, gs.day, `${meetingId}:cuddle-kind`) % 100 < 90 ? 'bedroom' : 'standing');
  if (kind === 'standing' && !location) throw new Error('Private moment: standing NPC pair requires its shared location');
  const now = absoluteMinute(), target = kind === 'bedroom' ? residentBedroom(first) : location as { scene: SceneKey; tx: number; ty: number };
  if (kind === 'bedroom') bedroomPath(target.scene, target);
  const session: CuddleSession = { id: `${meetingId}:cuddle`, kind,
    participants: [{ kind: 'resident', residentId: first }, { kind: 'resident', residentId: second }],
    phase: kind === 'bedroom' ? 'traveling' : 'active', scene: target.scene, tx: target.tx, ty: target.ty,
    createdDay: gs.day, createdMinute: gs.timeOfDay,
    phaseEndsAt: now + (kind === 'bedroom' ? BEDROOM_TRAVEL_MINUTES : ACTIVE_MINUTES),
    deadlineAt: now + (kind === 'bedroom' ? BEDROOM_TRAVEL_MINUTES + BEDROOM_WAIT_MINUTES : ACTIVE_MINUTES),
    spokenReason: 'They share a private look and slip away together.', witnesses: [] };
  gs.cuddle.session = session;
  return session;
}
