/**
 * SceneTransitionSystem — the SINGLE authority for changing scenes (CLAUDE.md Hard Rule 1).
 *
 * This is the structural fix for the "player vanished walking to town" bug. No scene ever calls
 * this.scene.start() directly. Every warp goes through transitionTo(target, spawnId), which:
 *   1. Validates the target is a known WORLD scene (compile-time via SceneKey enum + runtime check).
 *   2. Records the destination spawn id in GameState so the destination scene spawns the player at a
 *      NAMED spawn — never at implicit (0,0).
 *   3. Fades out, stops the old world scene, starts the new one, and fades in.
 * The destination scene (BaseWorldScene) is responsible for creating the player at the pending
 * spawn and calling camera.startFollow — so the player always exists and is on-screen after a warp.
 *
 * Fail-loud: an unknown target or a missing spawn id throws immediately (in dev/test) rather than
 * dropping the player into the void.
 */
import type Phaser from 'phaser';
import { SceneKey, WORLD_SCENE_KEYS } from '../config/AssetKeys';
import { GameState, type PlayerState } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { getMapData } from '../world/MapDef';
import { SaveSystem } from './SaveSystem';
import { markNotReady } from '../debug/DebugHooks';

/** The spawn the next world scene should use, set just before a transition. */
let pendingSpawnId: string | null = null;
/** Exact saved feet position applied only after a validated named staging spawn exists. */
let pendingResumePlayer: PlayerState | null = null;

/** Read (and consume) the pending spawn id. Returns 'start' the very first time (initial boot). */
export function consumePendingSpawn(): string {
  const id = pendingSpawnId ?? 'start';
  pendingSpawnId = null;
  return id;
}

/** Consume the optional exact saved player state queued by title-screen Continue. */
export function consumePendingResumePlayer(): PlayerState | null {
  const player = pendingResumePlayer ? { ...pendingResumePlayer } : null;
  pendingResumePlayer = null;
  return player;
}

/** Shared runtime validation for every world-entry path. */
function assertWorldTarget(target: SceneKey): void {
  if (!WORLD_SCENE_KEYS.has(target)) {
    throw new Error(`SceneTransitionSystem: "${target}" is not a valid world scene target`);
  }
}

/**
 * Transition from the current world scene to `target`, placing the player at `spawnId` in the
 * destination. `from` is the scene initiating the warp (used to stop it cleanly).
 */
export function transitionTo(from: Phaser.Scene, target: SceneKey, spawnId: string): void {
  // (1) Validate target is a real world scene. WORLD_SCENE_KEYS is the runtime half of the guard;
  // the SceneKey type is the compile-time half (you can't pass a string that isn't a SceneKey).
  assertWorldTarget(target);
  if (!spawnId) {
    throw new Error(`SceneTransitionSystem: missing spawnId for transition to "${target}"`);
  }

  // (2) Record intent so the destination scene spawns the player correctly.
  pendingSpawnId = spawnId;
  GameState.instance.activeScene = target;

  // (3) Framed transition: fade out, swap scenes, fade in. The camera fade is purely cosmetic;
  // the important part is that we stop the old scene and start the new one via the scene manager.
  const cam = from.cameras.main;
  cam.fadeOut(150, 0, 0, 0);
  cam.once('camerafadeoutcomplete', () => {
    from.scene.start(target); // start() stops `from` and starts `target`
  });
}

/**
 * Enter gameplay from the title screen. A loaded game still stages through a real named spawn,
 * then BaseWorldScene applies the exact validated saved position after its player exists.
 */
export function enterWorldFromMenu(from: Phaser.Scene, target: SceneKey, resumePlayer: PlayerState | null): void {
  assertWorldTarget(target);
  const map = getMapData(target);
  const stagingSpawn = resumePlayer ? map.spawns[0] : map.spawns.find((spawn) => spawn.id === 'start') ?? map.spawns[0];
  if (!stagingSpawn) throw new Error(`SceneTransitionSystem: "${target}" has no named spawn`);
  pendingSpawnId = stagingSpawn.id;
  pendingResumePlayer = resumePlayer ? { ...resumePlayer } : null;
  GameState.instance.activeScene = target;
  InputBus.instance.clearAll();
  markNotReady();
  from.scene.launch(SceneKey.UI);
  from.scene.start(target);
}

/**
 * Return from the paused world to title. Active world scenes are stopped first so their shutdown
 * hooks finish against the old state; only then are GameState and save-session ownership reset.
 */
export function returnToMainMenu(from: Phaser.Scene): void {
  InputBus.instance.clearAll();
  markNotReady();
  const activeWorlds = from.scene.manager
    .getScenes(true)
    .filter((scene) => WORLD_SCENE_KEYS.has(scene.scene.key as SceneKey));
  // ScenePlugin.stop() only queues shutdown for the next manager tick. Call the manager's public
  // stop directly so every world SHUTDOWN hook completes against the old state before reset.
  for (const world of activeWorlds) from.scene.manager.stop(world.scene.key);
  GameState.reset();
  SaveSystem.endSession();
  pendingSpawnId = null;
  pendingResumePlayer = null;
  from.scene.start(SceneKey.MainMenu);
}
