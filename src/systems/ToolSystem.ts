/**
 * ToolSystem — tracks the active hotbar tool and resolves hotbar selection.
 *
 * The active tool is derived from the entry currently occupying GameState.hotbarIndex. Physical
 * tools use `tool:<id>` entries; a specific seed item maps to the Seeds action only while it sits
 * in the selected belt slot. Passive items and empty slots intentionally return null.
 */
import { GameState } from '../state/GameState';
import { PLACEABLE_ITEMS, type ToolId } from '../config/Items';
import { InventoryLayoutSystem, itemFromEntry, TOOLBELT_CAPACITY } from './InventoryLayoutSystem';

export const ToolSystem = {
  /** Return the selected physical inventory item, excluding built-in tools and empty slots. */
  activeItem(): string | null {
    const gs = GameState.instance;
    return itemFromEntry(gs.toolbeltSlots[gs.hotbarIndex]);
  },
  /** The currently-selected tool. */
  active(): ToolId | null {
    return InventoryLayoutSystem.activeTool(GameState.instance);
  },

  /** Specific seed stack selected on the toolbelt, or null when Seeds is not active. */
  activeSeed(): string | null {
    return InventoryLayoutSystem.activeSeed(GameState.instance);
  },

  /** Resolve furniture held in the active belt slot; quantities remain owned by inventory. */
  activeFurniture(): string | null {
    const gs = GameState.instance;
    const item = itemFromEntry(gs.toolbeltSlots[gs.hotbarIndex]);
    return item !== null && PLACEABLE_ITEMS.has(item) ? item : null;
  },

  /** Reconcile the preview after slot moves, depletion, load, or selection without resetting rotation. */
  syncPlacement(): void {
    const gs = GameState.instance;
    const active = this.activeFurniture();
    const entry = `${gs.hotbarIndex}:${String(active)}`;
    if (gs.placingCancelledEntry !== entry) gs.placingCancelledEntry = null;
    // Explicit bag placement temporarily owns the preview even when a different belt item is held.
    if (gs.placingSource === 'inventory' && gs.placingItem !== null) {
      if (Object.prototype.hasOwnProperty.call(gs.inventory, gs.placingItem)) return;
      gs.placingItem = null;
      gs.placingSource = null;
    }
    const selected = gs.placingCancelledEntry === entry ? null : active;
    if (gs.placingItem !== selected) gs.placingRotation = 0;
    gs.placingItem = selected;
    gs.placingSource = selected === null ? null : 'toolbelt';
  },

  /** Start the retained inventory shortcut without changing the player's selected belt slot. */
  placeFromInventory(item: string): void {
    const gs = GameState.instance;
    if (!PLACEABLE_ITEMS.has(item) || !Object.prototype.hasOwnProperty.call(gs.inventory, item)) {
      throw new Error(`ToolSystem: cannot equip unavailable furniture "${item}"`);
    }
    gs.placingItem = item;
    gs.placingRotation = 0;
    gs.placingSource = 'inventory';
    gs.placingCancelledEntry = null;
  },

  /** Cancel until an explicit reselection or a different active slot entry; never consume inventory. */
  cancelPlacement(): void {
    const gs = GameState.instance;
    gs.placingCancelledEntry = `${gs.hotbarIndex}:${String(this.activeFurniture())}`;
    gs.placingItem = null;
    gs.placingRotation = 0;
    gs.placingSource = null;
  },

  /** End one bag placement, or retain an equipped belt stack with its current orientation. */
  placementCommitted(): void {
    const gs = GameState.instance;
    if (gs.placingSource === 'inventory') this.cancelPlacement();
    else this.syncPlacement();
  },

  /** Select a hotbar slot by index (0-based). Ignores out-of-range indices (no-op, not an error). */
  select(index: number): void {
    if (index < 0 || index >= TOOLBELT_CAPACITY) return;
    const gs = GameState.instance;
    gs.hotbarIndex = index;
    gs.placingSource = null;
    gs.placingCancelledEntry = null;
    InventoryLayoutSystem.syncSelectedSeed(gs);
    this.syncPlacement();
  },
};
