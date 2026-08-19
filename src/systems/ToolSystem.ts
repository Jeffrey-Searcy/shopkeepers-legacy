/**
 * ToolSystem — tracks the active hotbar tool and resolves hotbar selection.
 *
 * The active tool is derived from the entry currently occupying GameState.hotbarIndex. Physical
 * tools use `tool:<id>` entries; a specific seed item maps to the Seeds action only while it sits
 * in the selected belt slot. Passive items and empty slots intentionally return null.
 */
import { GameState } from '../state/GameState';
import type { ToolId } from '../config/Items';
import { InventoryLayoutSystem, TOOLBELT_CAPACITY } from './InventoryLayoutSystem';

export const ToolSystem = {
  /** The currently-selected tool. */
  active(): ToolId | null {
    return InventoryLayoutSystem.activeTool(GameState.instance);
  },

  /** Specific seed stack selected on the toolbelt, or null when Seeds is not active. */
  activeSeed(): string | null {
    return InventoryLayoutSystem.activeSeed(GameState.instance);
  },

  /** Select a hotbar slot by index (0-based). Ignores out-of-range indices (no-op, not an error). */
  select(index: number): void {
    if (index < 0 || index >= TOOLBELT_CAPACITY) return;
    const gs = GameState.instance;
    gs.hotbarIndex = index;
    InventoryLayoutSystem.syncSelectedSeed(gs);
  },
};
