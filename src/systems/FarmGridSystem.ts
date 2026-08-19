/**
 * FarmGridSystem — per-tile soil state (tilled / watered), stored in GameState.tiles.
 *
 * Pure state transitions keyed by `${scene}:${tx},${ty}` — the scene is the ACTIVE one, because
 * tools only ever act where the player stands. Scene-scoped keys are what keep farm soil from
 * bleeding onto the town/forest at the same coordinates. The scene renders an overlay from this
 * (M4). Watering a tile also marks any crop on it as watered (crops advance on day rollover only
 * if watered — M6).
 */
import { GameState } from '../state/GameState';

const key = (tx: number, ty: number): string => `${GameState.instance.activeScene}:${tx},${ty}`;

export const FarmGridSystem = {
  /** Till a tile into soil (idempotent). */
  till(tx: number, ty: number): void {
    GameState.instance.tiles[key(tx, ty)] = 'tilled';
  },

  /** Restore an empty tilled/watered tile to its base map ground. Crop safety is caller-checked. */
  clear(tx: number, ty: number): void {
    delete GameState.instance.tiles[key(tx, ty)];
  },

  /** Water tilled soil; also flags any crop on the tile as watered. */
  water(tx: number, ty: number): void {
    const gs = GameState.instance;
    const k = key(tx, ty);
    if (gs.tiles[k]) gs.tiles[k] = 'watered';
    const crop = gs.crops[k];
    if (crop) crop.watered = true;
  },

  /** Soil state at a tile, or undefined if untilled. */
  stateAt(tx: number, ty: number): 'tilled' | 'watered' | undefined {
    return GameState.instance.tiles[key(tx, ty)];
  },
};
