/**
 * ItemPlacementSystem — Stardew-rule item placement: a held item (V1: chest) can be placed on ANY
 * tile that isn't blocked — not solid, not water, no resource node, no existing chest/item, no
 * soil/crop. Placed items persist in GameState.placedItems (scenes respawn them on entry) and can
 * be picked back up with an axe/pickaxe swing.
 *
 * Distinct from PlacementSystem (buildings): buildings use footprints + the buildable zone; items
 * use authored whole-tile footprints. Validation that needs live scene objects (nodes, chests) is
 * passed in via a blocked() callback so this module stays scene-free.
 */
import { GameState } from '../state/GameState';
import { SceneKey } from '../config/AssetKeys';
import type { MapData } from '../world/MapDef';
import { FURNITURE, furnitureAllowedInScene, furnitureCells, furnitureDefinition, furnitureView, type PlacedFurniture, type Rotation } from '../config/Furniture';
import { isHospitalityLayoutLocked } from '../config/Tavern';
import { worldToTile } from '../config/GameConfig';
import { hasRoomAccess } from '../world/RoomAccess';
import { isCivicInterior } from '../config/TownBuildings';

/** Preserve doors and the keeper's route while validating a candidate without mutating state. */
function preservesRoomAccess(map: MapData, candidate: PlacedFurniture): boolean {
  const gs = GameState.instance;
  const keeper = gs.activeScene === map.key ? worldToTile(gs.player.x, gs.player.y) : undefined;
  return hasRoomAccess(map, [...gs.placedItems, candidate], keeper);
}

/**
 * Placement rules per placeable item. `blocking: false` items (rugs) are floor decor: they don't
 * collide, and BLOCKING items may be placed ON TOP of them (a table on a rug — the Stardew combo);
 * only a second copy of the same floor item is rejected.
 */
export const PLACEABLE_DEF = FURNITURE;

export const ItemPlacementSystem = {
  /** Keep the active customer's derived route stable until the shop closes. Other scenes stay editable. */
  layoutLocked(scene: SceneKey): boolean {
    return isCivicInterior(scene) || (scene === SceneKey.Tavern && isHospitalityLayoutLocked(GameState.instance.tavern));
  },

  /** Is this tile placeable for `item`? Map-level checks + the scene's blocked() callback. */
  canPlace(
    map: MapData,
    tx: number,
    ty: number,
    blocked: (tx: number, ty: number) => boolean,
    item = 'chest',
    rotation: Rotation = 0
  ): boolean {
    if (this.layoutLocked(map.key) || !furnitureAllowedInScene(item, map.key)) return false;
    const cells = furnitureCells(item, tx, ty, rotation);
    const gs = GameState.instance;
    const clear = cells.every(cell => {
      if (cell.tx < 1 || cell.ty < 1 || cell.tx >= map.w - 1 || cell.ty >= map.h - 1) return false;
      if (map.solid[cell.ty][cell.tx] || map.ground[cell.ty][cell.tx] === 'water') return false;
      if (map.spawns.some(spawn => spawn.tx === cell.tx && spawn.ty === cell.ty)) return false;
      if (map.warps.some(warp => cell.tx >= warp.tx && cell.tx < warp.tx + warp.w && cell.ty >= warp.ty && cell.ty < warp.ty + warp.h)) return false;
      if (map.reservedTiles && map.reservedTiles.some(tile => tile.tx === cell.tx && tile.ty === cell.ty)) return false;
      const key = `${map.key}:${cell.tx},${cell.ty}`;
      if (gs.tiles[key] || gs.crops[key]) return false;
      const here = gs.placedItems.filter(placed => placed.scene === map.key &&
        furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation).some(tile => tile.tx === cell.tx && tile.ty === cell.ty));
      // Solid furniture can stand on an existing rug; rugs cannot slide under occupied furniture.
      if (here.some(placed => furnitureDefinition(placed.item).blocking || placed.item === item)) return false;
      return !blocked(cell.tx, cell.ty);
    });
    return clear && (!furnitureDefinition(item).blocking || preservesRoomAccess(map, { item, scene: map.key, tx, ty, rotation }));
  },

  /** Commit a placement: consume one item from the bag, record it. Caller pre-validates canPlace. */
  place(item: string, scene: SceneKey, tx: number, ty: number, rotation: Rotation = 0): boolean {
    if (this.layoutLocked(scene) || !furnitureAllowedInScene(item, scene)) return false;
    furnitureCells(item, tx, ty, rotation);
    const gs = GameState.instance;
    if (!Object.prototype.hasOwnProperty.call(gs.inventory, item)) return false;
    if (!gs.removeItem(item, 1)) {
      throw new Error(`ItemPlacementSystem: failed to consume available item "${item}"`);
    }
    gs.placedItems.push({ item, scene, tx, ty, rotation });
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
      if (q.scene !== scene) continue;
      const selected = furnitureView(q.item, q.rotation);
      if (tx < q.tx || tx >= q.tx + selected.w || ty < q.ty || ty >= q.ty + selected.h) continue;
      if (furnitureDefinition(q.item).blocking) return i; // blocking item wins immediately
      floorIdx = i;
    }
    return floorIdx;
  },

  /** The placed item at a tile in a scene, if any (blocking item first when stacked on a rug). */
  itemAt(scene: SceneKey, tx: number, ty: number): PlacedFurniture | null {
    const idx = this._indexAt(scene, tx, ty);
    return idx >= 0 ? { ...GameState.instance.placedItems[idx] } : null;
  },

  /** Pick a placed item back up into the bag. Returns the item id or null. */
  pickup(scene: SceneKey, tx: number, ty: number): string | null {
    if (this.layoutLocked(scene)) return null;
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
    if (this.layoutLocked(scene)) return null;
    const gs = GameState.instance;
    const idx = this._indexAt(scene, tx, ty);
    if (idx < 0) return null;
    const [p] = gs.placedItems.splice(idx, 1);
    return p.item;
  },
};
