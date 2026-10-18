/**
 * InputBus — the single channel through which ALL player intent flows.
 *
 * Both real keyboard handling and the Playwright test seam (window.__TEST__.input) emit the same
 * action strings here; systems/scenes subscribe. This is what lets tests drive the game exactly as
 * a human would (CLAUDE.md self-verification), with no separate "test-only" code path in gameplay.
 *
 * Actions are of two kinds:
 *  - Held movement: 'move:up' | 'move:down' | 'move:left' | 'move:right' (press/release semantics
 *    via setMove), plus discrete one-shot actions emitted through `emit`.
 *  - One-shot: 'use-tool', 'interact', 'hotbar:0'..'hotbar:9', 'toggle-inventory',
 *    'rotate-placement' (furniture ghost), 'dodge' (Mines roll).
 *  - Held tool: the on-screen Use button (touch play) holds the tool the same way Space does, via
 *    pressTool/releaseTool. World scenes read `toolHeld` and count presses with `toolPressCount`.
 */
import type { Facing } from '../state/GameState';

export type OneShotAction =
  | 'use-tool'
  | 'interact'
  | 'manage-shop'
  | 'toggle-inventory'
  | 'toggle-pause'
  | 'rotate-placement'
  | 'dodge'
  | `hotbar:${number}`;

type OneShotListener = (action: OneShotAction) => void;

export class InputBus {
  /** Currently-held movement directions (supports diagonals). */
  private held = new Set<Facing>();
  private listeners = new Set<OneShotListener>();
  /** Native keyboard events already normalized into intent (shared across active Phaser scenes). */
  private keyboardEvents = new WeakSet<KeyboardEvent>();

  /** Mark a movement direction held/released (called by keyboard handlers). */
  setMove(dir: Facing, isDown: boolean): void {
    if (isDown) this.held.add(dir);
    else this.held.delete(dir);
  }

  /** Snapshot of held movement directions. */
  getHeld(): ReadonlySet<Facing> {
    return this.held;
  }

  /** Subscribe to one-shot actions. Returns an unsubscribe fn. */
  onAction(fn: OneShotListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Emit a one-shot action to all listeners. */
  emit(action: OneShotAction): void {
    for (const fn of this.listeners) fn(action);
  }

  /** Emit once for a native key event even when multiple active Phaser plugins deliver it. */
  emitKeyboard(action: OneShotAction, event: KeyboardEvent): void {
    if (this.keyboardEvents.has(event)) return;
    this.keyboardEvents.add(event);
    this.emit(action);
  }

  /**
   * Handle a raw action string coming from the test seam. Movement actions are treated as a
   * one-frame tap (down then up next frame is awkward for tests), so tests that need sustained
   * movement should call `setMove` via the seam's dedicated helpers instead. `input('move:right')`
   * nudges the player by holding for the caller to release.
   */
  private static readonly MOVE_MAP: Record<string, Facing> = {
    'move:up': 'up',
    'move:down': 'down',
    'move:left': 'left',
    'move:right': 'right',
  };

  /** Held state of the fishing reel input (settable from the seam; real input ORs with this). */
  reelHeld = false;

  /** True while the on-screen Use button is held (touch play's Space bar). */
  toolHeld = false;
  /**
   * Count of Use-button presses since page load. A world scene compares it with the last count it saw
   * to detect a fresh press even when the press and release both land between two of its frames.
   */
  toolPressCount = 0;

  /** Start holding the tool (touch Use button down). */
  pressTool(): void {
    this.toolHeld = true;
    this.toolPressCount += 1;
  }

  /** Stop holding the tool (touch Use button up, or its finger vanished). */
  releaseTool(): void {
    this.toolHeld = false;
  }

  /** Route a seam action string to the right internal path. */
  handleSeamAction(action: string): void {
    const move = InputBus.MOVE_MAP[action];
    if (move) {
      // For test convenience, a bare move action holds the direction; the seam exposes
      // stopMove() to release. This lets a test do input('move:right') then step frames.
      this.held.add(move);
      return;
    }
    if (action === 'reel:on') {
      this.reelHeld = true;
      return;
    }
    if (action === 'reel:off') {
      this.reelHeld = false;
      return;
    }
    this.emit(action as OneShotAction);
  }

  /** Release all held movement (test seam helper). */
  stopMove(): void {
    this.held.clear();
  }

  /** Clear every process-wide input latch at a pause or play-session boundary. */
  clearAll(): void {
    this.held.clear();
    this.reelHeld = false;
    this.toolHeld = false;
  }

  /** The shared instance. */
  private static _instance: InputBus | null = null;
  static get instance(): InputBus {
    if (!InputBus._instance) InputBus._instance = new InputBus();
    return InputBus._instance;
  }
}
