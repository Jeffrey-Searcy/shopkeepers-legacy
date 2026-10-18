/**
 * Transient contracts for the always-on Cuddle feature (private moments; no player setting).
 *
 * This state never enters a save file. GameState exposes it only so scenes, systems, and tests
 * share one authority instead of keeping hidden activity flags on Phaser objects.
 */
import type { SceneKey } from './AssetKeys';
import type { ResidentId } from './ResidentRelationships';

export type CuddleKind = 'bedroom' | 'standing';
export type CuddlePhase = 'traveling' | 'waiting' | 'active';
export type PrivateRoomActivity = 'reading' | 'bathing' | 'playing' | 'resting' | 'daydreaming';

/** One player or resident participant in a short game-owned activity. */
export type CuddleParticipant = { kind: 'player' } | { kind: 'resident'; residentId: ResidentId };

/** A witnessed reaction is queued before any report may reach JusticeSystem. */
export interface CuddleWitnessState {
  residentId: ResidentId;
  reaction: string;
  willReport: boolean;
  committed: boolean;
}

/** The only active Cuddle session. One global session prevents overlapping path ownership. */
export interface CuddleSession {
  id: string;
  kind: CuddleKind;
  participants: readonly CuddleParticipant[];
  phase: CuddlePhase;
  scene: SceneKey;
  tx: number;
  ty: number;
  createdDay: number;
  createdMinute: number;
  phaseEndsAt: number;
  deadlineAt: number;
  spokenReason: string;
  witnesses: CuddleWitnessState[];
}

/** One resident's derived private schedule state for the current day. */
export interface PrivateRoomState {
  residentId: ResidentId;
  day: number;
  activity: PrivateRoomActivity;
  scene: SceneKey;
  /** Passable floor tile used by ordinary private room activities. */
  tx: number;
  ty: number;
  /** Exact game-clock range for this day's private activity. */
  startsAt: number;
  endsAt: number;
  /** Pixel center of the authored bed, used only by the blurred-heart presentation. */
  effectX: number;
  effectY: number;
}

/** Complete transient runtime. Mood is deliberately bounded and resets with a load/new game. */
export interface CuddleRuntimeState {
  session: CuddleSession | null;
  privateRooms: Partial<Record<ResidentId, PrivateRoomState>>;
  moodBoosts: Partial<Record<ResidentId, number>>;
  lastPrivateActivityDay: number;
  offeredMeetingIds: string[];
}

/** Create an empty, JSON-safe runtime. */
export function createCuddleRuntimeState(): CuddleRuntimeState {
  return { session: null, privateRooms: {}, moodBoosts: {}, lastPrivateActivityDay: 0, offeredMeetingIds: [] };
}
