/**
 * DebugHooks — the Playwright test seam for a canvas game.
 *
 * The game renders to a single <canvas>, so DOM assertions are useless. Instead, when the page is
 * loaded with `?test=1` (or in dev), we attach a tiny, STABLE surface to `window`:
 *   window.__GAME__  -> the raw Phaser.Game (escape hatch)
 *   window.__TEST__  -> { ready, state(), input(action), stepTime(minutes), stopMove(), activeScene() }
 *
 * Tests read serialized GameState and drive input exactly as a human would. This is the ONLY
 * bridge between tests and the game; keep its shape stable (specs assert against it).
 */
import type Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { cropForSeed } from '../config/Crops';
import { WeatherSystem, type Weather } from '../systems/WeatherSystem';
import { InventoryLayoutSystem, itemFromEntry } from '../systems/InventoryLayoutSystem';
import { ToolSystem } from '../systems/ToolSystem';
import { DevTuningSystem } from '../systems/DevTuningSystem';
export { isTestMode } from './RuntimeMode';
import { isTestMode } from './RuntimeMode';

/** The shape exposed on window.__TEST__. Kept intentionally small and stable. */
export interface TestApi {
  ready: boolean;
  state: () => ReturnType<GameState['serialize']>;
  input: (action: string) => void;
  stopMove: () => void;
  stepTime: (minutes: number) => void;
  activeScene: () => string;
  /** Test-only: place the player at a tile and (optionally) set facing. */
  teleport: (tx: number, ty: number, facing?: string) => void;
  /** Test-only: list resource-node tiles in the active scene (trees include their growth stage). */
  nodes: () => Array<{ tx: number; ty: number; kind: string; stage?: string }>;
  /** Test-only: sleep in place (advance to next day) — used by farming/day tests. */
  sleep: () => void;
  /** Test-only: add items to the player's bag (deterministic setup for inventory tests). */
  give: (item: string, n: number) => void;
  /** Test-only: switch the seed the Seeds slot plants (same state the bag-panel click sets). */
  selectSeed: (item: string) => void;
  /** Test-only: jump the day counter (e.g. into another season). Growth does NOT run — this only
   *  moves the calendar; use sleep() to exercise rollover logic. */
  setDay: (day: number) => void;
  /** Test-only: pin a specific day's weather ('sunny' | 'rain') for deterministic weather specs. */
  setWeather: (day: number, weather: string) => void;
  /** Test-only: live enemies in the Mines (empty array outside the Mines). */
  enemies: () => Array<{ kind: string; tx: number; ty: number; hp: number }>;
  /** Test-only: set the player's combat hp directly (death-penalty specs). */
  setHp: (hp: number) => void;
  /** Test-only: set the player's gold directly (death-penalty specs assert the 20% loss). */
  setGold: (gold: number) => void;
  /** Test-only: set one known resident's bounded relationship points. */
  setResidentPoints: (residentId: string, points: number) => void;
  /** Test-only: attempt to place a building; returns whether it succeeded. */
  place: (type: string, tx: number, ty: number, w: number, h: number) => boolean;
  /** Test-only: ground type at a tile (grass/dirt/water/floor). */
  groundAt: (tx: number, ty: number) => string;
  /** Test-only: enter item-placement mode (same state the bag-panel click sets). */
  startPlacing: (item: string) => void;
  /** Test/dev-only: set a validated real-time clock multiplier. */
  setTimeScale: (scale: number) => void;
  /** Test/dev-only: set a validated crop-preview multiplier. */
  setCropScale: (scale: number) => void;
  /** Test/dev-only: force one crop growth day for lifecycle inspection. */
  advanceCropDay: () => void;
}

/** Scene-provided test hooks, registered by the active world scene (kept out of DebugHooks). */
export interface SceneTestHooks {
  teleport: (tx: number, ty: number, facing?: string) => void;
  nodes: () => Array<{ tx: number; ty: number; kind: string; stage?: string }>;
  sleep: () => void;
  place: (type: string, tx: number, ty: number, w: number, h: number) => boolean;
  groundAt: (tx: number, ty: number) => string;
}
/** Live-enemy provider, registered by the MinesScene while it runs (combat is Mines-only). */
export type EnemyInfo = { kind: string; tx: number; ty: number; hp: number };
let enemyProvider: (() => EnemyInfo[]) | null = null;
export function registerEnemyProvider(fn: (() => EnemyInfo[]) | null): void {
  enemyProvider = fn;
}

let sceneHooks: SceneTestHooks | null = null;
export function registerSceneTestHooks(hooks: SceneTestHooks): void {
  sceneHooks = hooks;
}
function requireSceneHooks(): SceneTestHooks {
  if (!sceneHooks) throw new Error('scene test hooks not registered yet');
  return sceneHooks;
}

declare global {
  interface Window {
    __GAME__?: Phaser.Game;
    __TEST__?: TestApi;
  }
}

/** True when the game should expose the test seam (test param or dev build). */
/**
 * A callback the TimeSystem registers so the seam's stepTime() advances the real clock. We keep it
 * as a settable hook rather than importing TimeSystem here to avoid a circular dependency and so
 * M0 can install the seam before TimeSystem exists.
 */
let timeStepper: (minutes: number) => void = () => {
  throw new Error('stepTime called before TimeSystem registered a stepper');
};
export function registerTimeStepper(fn: (minutes: number) => void): void {
  timeStepper = fn;
}

/**
 * Install window.__GAME__ and window.__TEST__. Called once from main.ts after the Phaser.Game is
 * created. `ready` starts false and is flipped true once the first world scene has created the
 * player (see markReady).
 */
export function installDebugHooks(game: Phaser.Game): void {
  if (!isTestMode()) return;

  const api: TestApi = {
    ready: false,
    state: () => GameState.instance.serialize(),
    input: (action: string) => InputBus.instance.handleSeamAction(action),
    stopMove: () => InputBus.instance.stopMove(),
    stepTime: (minutes: number) => timeStepper(minutes),
    activeScene: () => {
      const active = game.scene.getScenes(true);
      // Return the first non-UI running scene (the world scene the player is in).
      const world = active.find((s) => s.scene.key !== 'UIScene');
      return world ? world.scene.key : '';
    },
    teleport: (tx, ty, facing) => requireSceneHooks().teleport(tx, ty, facing),
    nodes: () => requireSceneHooks().nodes(),
    sleep: () => requireSceneHooks().sleep(),
    give: (item, n) => {
      if (!GameState.instance.addItem(item, n)) {
        throw new Error(`give: no backpack capacity for new stack "${item}"`);
      }
    },
    place: (type, tx, ty, w, h) => requireSceneHooks().place(type, tx, ty, w, h),
    groundAt: (tx, ty) => requireSceneHooks().groundAt(tx, ty),
    startPlacing: (item: string) => {
      if ((GameState.instance.inventory[item] ?? 0) < 1) {
        throw new Error(`startPlacing: no "${item}" in inventory`);
      }
      GameState.instance.placingItem = item;
      GameState.instance.placingSource = 'inventory';
      GameState.instance.placingCancelledEntry = null;
      GameState.instance.placingRotation = 0;
    },
    setTimeScale: (scale: number) => DevTuningSystem.setClockScale(scale),
    setCropScale: (scale: number) => DevTuningSystem.setCropScale(scale),
    advanceCropDay: () => {
      DevTuningSystem.advanceCropDay();
      game.events.emit('dev-crops-advanced');
    },
    selectSeed: (item: string) => {
      if (!cropForSeed(item)) throw new Error(`selectSeed: "${item}" is not a seed item`);
      const gs = GameState.instance;
      if ((gs.inventory[item] ?? 0) < 1) throw new Error(`selectSeed: no "${item}" in inventory`);
      const source = InventoryLayoutSystem.findEntrySlot(gs, item);
      if (!source) throw new Error(`selectSeed: "${item}" has no player slot`);
      if (source.container === 'toolbelt') {
        ToolSystem.select(source.index);
      } else {
        const seedIndex = gs.toolbeltSlots.findIndex((entry) => {
          const beltItem = itemFromEntry(entry);
          return beltItem !== null && cropForSeed(beltItem) !== null;
        });
        const targetIndex = seedIndex >= 0 ? seedIndex : gs.hotbarIndex;
        InventoryLayoutSystem.moveOrSwap(gs, source, { container: 'toolbelt', index: targetIndex });
        ToolSystem.select(targetIndex);
      }
      gs.selectedSeed = item;
    },
    setDay: (day: number) => {
      if (!Number.isInteger(day) || day < 1) throw new Error(`setDay: invalid day ${day}`);
      GameState.instance.day = day;
    },
    enemies: () => (enemyProvider ? enemyProvider() : []),
    setHp: (hp: number) => {
      if (!Number.isFinite(hp)) throw new Error(`setHp: invalid hp ${hp}`);
      GameState.instance.hp = Math.max(0, Math.min(GameState.instance.maxHp, hp));
    },
    setGold: (gold: number) => {
      if (!Number.isInteger(gold) || gold < 0) throw new Error(`setGold: invalid gold ${gold}`);
      GameState.instance.gold = gold;
    },
    setResidentPoints: (residentId: string, points: number) => {
      const record = GameState.instance.relationships.residents[residentId as keyof typeof GameState.instance.relationships.residents];
      if (!record) throw new Error(`setResidentPoints: unknown resident ${residentId}`);
      if (!Number.isInteger(points) || points < 0 || points > 2500) throw new Error(`setResidentPoints: invalid points ${points}`);
      record.points = points;
    },
    setWeather: (day: number, weather: string) => {
      WeatherSystem.override(day, weather as Weather);
    },
  };

  window.__GAME__ = game;
  window.__TEST__ = api;
}

/** Flip the seam's `ready` flag. Called by a world scene once the player exists and is controllable. */
export function markReady(): void {
  if (window.__TEST__) window.__TEST__.ready = true;
}

/** Clear readiness while title/transition owns control so tests never observe a stale world. */
export function markNotReady(): void {
  if (window.__TEST__) window.__TEST__.ready = false;
}
