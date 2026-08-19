/**
 * SaveSystem — the sole authority for the game's three browser-local save slots.
 *
 * Each exact localStorage key stores one versioned envelope. Reads validate size, JSON, envelope,
 * and the complete detached GameState candidate before live state changes. Corrupt slots remain
 * visible and deletable from the title screen; they are never guessed, repaired, or partially loaded.
 */
import { GameState, type GameSaveData } from '../state/GameState';
import { TILE } from '../config/GameConfig';
import { getMapData } from '../world/MapDef';
import { SceneKey } from '../config/AssetKeys';

export const SAVE_VERSION = 1;
export const SAVE_SLOT_COUNT = 3;
export const MAX_SAVE_BYTES = 2_000_000;
export type SaveSlot = 1 | 2 | 3;

interface SaveEnvelope {
  version: number;
  slot: SaveSlot;
  savedAt: number;
  state: GameSaveData;
}

/** Public metadata used to render one title-screen card without exposing the full payload. */
export type SaveSlotInfo =
  | { slot: SaveSlot; status: 'empty' }
  | {
      slot: SaveSlot;
      status: 'ready';
      savedAt: number;
      day: number;
      season: 'spring' | 'summer' | 'fall' | 'winter';
      gold: number;
      activeScene: string;
    }
  | { slot: SaveSlot; status: 'corrupt'; reason: string };

let activeSlot: SaveSlot | null = null;

/** Assert and narrow a caller-provided slot number. */
function validSlot(slot: number): SaveSlot {
  if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) {
    throw new Error(`SaveSystem: invalid slot ${slot}; expected 1..${SAVE_SLOT_COUNT}`);
  }
  return slot as SaveSlot;
}

/** Validate the queued feet position against its destination map before inspection or mutation. */
function assertResumePosition(slot: SaveSlot, candidate: GameState): void {
  const map = getMapData(candidate.activeScene);
  const width = map.w * TILE;
  const height = map.h * TILE;
  const { x, y } = candidate.player;
  if (x < 0 || x > width || y < 0 || y > height) {
    throw new Error(
      `SaveSystem: Slot ${slot} player position (${x},${y}) is outside ${candidate.activeScene} bounds ${width}x${height}`
    );
  }
}

/** Redirect saves parked in the rejected temporary room before any world scene can render it. */
function normalizeLegacyHome(candidate: GameState): void {
  if (candidate.activeScene !== SceneKey.Home) return;
  const farm = getMapData(SceneKey.Farm);
  const spawn = farm.spawns.find((entry) => entry.id === 'from_home');
  if (!spawn) throw new Error('SaveSystem: Farm is missing required legacy Home redirect spawn "from_home"');
  candidate.activeScene = SceneKey.Farm;
  candidate.player = {
    ...candidate.player,
    x: spawn.tx * TILE + TILE / 2,
    y: spawn.ty * TILE + TILE / 2,
    facing: 'down',
  };
}

/** Parse and fully validate one stored envelope into a detached candidate. */
function readEnvelope(slot: SaveSlot): { envelope: SaveEnvelope; candidate: GameState } {
  const raw = localStorage.getItem(SaveSystem.storageKey(slot));
  if (raw === null) throw new Error(`SaveSystem: Slot ${slot} is empty`);
  if (new Blob([raw]).size > MAX_SAVE_BYTES) {
    throw new Error(`SaveSystem: Slot ${slot} exceeds the ${MAX_SAVE_BYTES}-byte safety limit`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`SaveSystem: Slot ${slot} contains invalid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`SaveSystem: Slot ${slot} envelope must be an object`);
  }
  const envelope = value as Partial<SaveEnvelope>;
  if (envelope.version !== SAVE_VERSION) {
    throw new Error(`SaveSystem: Slot ${slot} uses unsupported version ${String(envelope.version)}`);
  }
  if (envelope.slot !== slot) {
    throw new Error(`SaveSystem: Slot ${slot} envelope claims slot ${String(envelope.slot)}`);
  }
  if (typeof envelope.savedAt !== 'number' || !Number.isFinite(envelope.savedAt) || envelope.savedAt < 0) {
    throw new Error(`SaveSystem: Slot ${slot} has an invalid savedAt timestamp`);
  }
  const candidate = GameState.candidateFromSaveData(envelope.state);
  normalizeLegacyHome(candidate);
  assertResumePosition(slot, candidate);
  return { envelope: envelope as SaveEnvelope, candidate };
}

/** Derive display metadata from a fully validated envelope/candidate. */
function readyInfo(slot: SaveSlot, envelope: SaveEnvelope, candidate: GameState): SaveSlotInfo {
  return {
    slot,
    status: 'ready',
    savedAt: envelope.savedAt,
    day: candidate.day,
    season: candidate.season,
    gold: candidate.gold,
    activeScene: candidate.activeScene,
  };
}

export const SaveSystem = {
  /** Return the one exact storage key owned by a slot. */
  storageKey(slot: number): string {
    return `shopkeeperslegacy.save.v1.slot.${validSlot(slot)}`;
  },

  /** The slot bound to the current play session, or null for direct test/dev world boot. */
  currentSlot(): SaveSlot | null {
    return activeSlot;
  },

  /**
   * Begin a fresh session in an empty slot. Occupied/corrupt slots require explicit deletion first,
   * so a New Adventure action can never overwrite progress.
   */
  beginNewGame(slotNumber: number): void {
    const slot = validSlot(slotNumber);
    const info = this.inspectSlot(slot);
    if (info.status !== 'empty') {
      throw new Error(`SaveSystem: Slot ${slot} must be deleted before starting a new game`);
    }
    GameState.reset();
    activeSlot = slot;
  },

  /** Write one validated v1 snapshot. `savedAt` is injectable for deterministic tests. */
  save(slotNumber: number, savedAt = Date.now()): SaveSlotInfo {
    const slot = validSlot(slotNumber);
    if (!Number.isFinite(savedAt) || savedAt < 0) throw new Error(`SaveSystem: invalid savedAt ${savedAt}`);
    const state = GameState.instance.toSaveData();
    // Re-validate the detached payload before touching storage so a corrupted live invariant cannot
    // become a save file that only fails later on Continue.
    const candidate = GameState.candidateFromSaveData(state);
    assertResumePosition(slot, candidate);
    const envelope: SaveEnvelope = { version: SAVE_VERSION, slot, savedAt, state };
    const raw = JSON.stringify(envelope);
    if (new Blob([raw]).size > MAX_SAVE_BYTES) {
      throw new Error(`SaveSystem: Slot ${slot} exceeds the ${MAX_SAVE_BYTES}-byte safety limit`);
    }
    localStorage.setItem(this.storageKey(slot), raw);
    return readyInfo(slot, envelope, candidate);
  },

  /** Save the active session, or return null when direct test/dev boot has no slot ownership. */
  saveCurrent(savedAt = Date.now()): SaveSlotInfo | null {
    return activeSlot === null ? null : this.save(activeSlot, savedAt);
  },

  /** Validate a slot completely, then atomically install its detached state candidate. */
  load(slotNumber: number): GameSaveData {
    const slot = validSlot(slotNumber);
    const { candidate } = readEnvelope(slot);
    GameState.installCandidate(candidate);
    activeSlot = slot;
    return candidate.toSaveData();
  },

  /** Inspect one slot without mutating storage or live state. */
  inspectSlot(slotNumber: number): SaveSlotInfo {
    const slot = validSlot(slotNumber);
    if (localStorage.getItem(this.storageKey(slot)) === null) return { slot, status: 'empty' };
    try {
      const { envelope, candidate } = readEnvelope(slot);
      return readyInfo(slot, envelope, candidate);
    } catch (error) {
      return {
        slot,
        status: 'corrupt',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** List exactly three cards in stable ascending order. */
  listSlots(): SaveSlotInfo[] {
    return ([1, 2, 3] as SaveSlot[]).map((slot) => this.inspectSlot(slot));
  },

  /** Remove exactly one application-owned slot key. UI confirmation is intentionally caller-owned. */
  delete(slotNumber: number): void {
    const slot = validSlot(slotNumber);
    localStorage.removeItem(this.storageKey(slot));
    if (activeSlot === slot) activeSlot = null;
  },

  /** End slot ownership after old world scenes have shut down during return-to-title. */
  endSession(): void {
    activeSlot = null;
  },
};
