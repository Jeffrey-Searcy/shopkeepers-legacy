/**
 * ItemPlacementSystem — Stardew-rule item placement: a held item (V1: chest) can be placed on ANY
 * tile that isn't blocked — not solid, not water, no resource node, no existing chest/item, no
 * soil/crop. Placed items persist in GameState.placedItems (scenes respawn them on entry) and can
 * be picked back up with an axe/pickaxe swing.
 *
 * Distinct from PlacementSystem (buildings): buildings use footprints + the buildable zone; items
 * are 1-tile and free-form. Validation that needs live scene objects (nodes, chest tiles) is
 * passed in via a blocked() callback so this module stays scene-free.
 */
import { GameState } from '../state/GameState';
import type { SceneKey } from '../config/AssetKeys';
import type { MapData } from '../world/MapDef';

/**
 * Placement rules per placeable item. `blocking: false` items (rugs) are floor decor: they don't
 * collide, and BLOCKING items may be placed ON TOP of them (a table on a rug — the Stardew combo);
 * only a second copy of the same floor item is rejected.
 */
export const PLACEABLE_DEF: Record<string, { blocking: boolean }> = {
  chest: { blocking: true },
  workbench: { blocking: true },
  table: { blocking: true },
  chair: { blocking: true },
  rug: { blocking: false },
};

export const ItemPlacementSystem = {
  /** Is this tile placeable for `item`? Map-level checks + the scene's blocked() callback. */
  canPlace(
    map: MapData,
    tx: number,
    ty: number,
    blocked: (tx: number, ty: number) => boolean,
    item = 'chest'
  ): boolean {
    if (tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) return false;
    if (map.solid[ty][tx]) return false;
    if (map.ground[ty][tx] === 'water') return false;
    const gs = GameState.instance;
    const k = `${tx},${ty}`;
    if (gs.tiles[k] || gs.crops[k]) return false; // no placing on soil/crops
    // Occupancy: a BLOCKING item bars everything; a floor item (rug) only bars another of itself.
    const here = gs.placedItems.filter((p) => p.scene === map.key && p.tx === tx && p.ty === ty);
    if (here.some((p) => PLACEABLE_DEF[p.item]?.blocking !== false)) return false;
    if (here.some((p) => p.item === item)) return false;
    // Floor items ignore live-object collision checks too? No — a rug under a tree reads wrong;
    // both kinds respect the scene's blocked() (nodes/chests/beds/player).
    return !blocked(tx, ty);
  },

  /** Commit a placement: consume one item from the bag, record it. Caller pre-validates canPlace. */
  place(item: string, scene: SceneKey, tx: number, ty: number): boolean {
    const gs = GameState.instance;
    if ((gs.inventory[item] ?? 0) < 1) return false;
    if (!gs.removeItem(item, 1)) {
      throw new Error(`ItemPlacementSystem: failed to consume available item "${item}"`);
    }
    gs.placedItems.push({ item, scene, tx, ty });
    return true;
  },

  /**
   * Index of the placed item at a tile, preferring BLOCKING items — when a table stands on a rug,
   * the axe takes the table first, then the rug (never yanks the rug out from under furniture).
   */
  _indexAt(scene: SceneKey, tx: number, ty: number): number {
    const items = GameState.instance.placedItems;
    let floorIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      if (q.scene !== scene || q.tx !== tx || q.ty !== ty) continue;
      if (PLACEABLE_DEF[q.item]?.blocking !== false) return i; // blocking item wins immediately
      floorIdx = i;
    }
    return floorIdx;
  },

  /** The placed item at a tile in a scene, if any (blocking item first when stacked on a rug). */
  itemAt(scene: SceneKey, tx: number, ty: number): { item: string } | null {
    const idx = this._indexAt(scene, tx, ty);
    return idx >= 0 ? { item: GameState.instance.placedItems[idx].item } : null;
  },

  /** Pick a placed item back up into the bag. Returns the item id or null. */
  pickup(scene: SceneKey, tx: number, ty: number): string | null {
    const gs = GameState.instance;
    const idx = this._indexAt(scene, tx, ty);
    if (idx < 0) return null;
    const p = gs.placedItems[idx];
    if (!gs.addItem(p.item, 1)) return null;
    gs.placedItems.splice(idx, 1);
    return p.item;
  },

  /** Remove a placed item WITHOUT banking it (the caller drops it on the ground instead). */
  remove(scene: SceneKey, tx: number, ty: number): string | null {
    const gs = GameState.instance;
    const idx = this._indexAt(scene, tx, ty);
    if (idx < 0) return null;
    const [p] = gs.placedItems.splice(idx, 1);
    return p.item;
  },
};
