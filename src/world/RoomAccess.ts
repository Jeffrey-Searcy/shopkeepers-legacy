/** Pure room circulation checks shared by furniture previews and current-version save validation. */
import { furnitureCells, furnitureDefinition, type PlacedFurniture } from '../config/Furniture';
import type { MapData } from './MapDef';

/** Whole floor coordinates; callers convert live or saved keeper positions before checking access. */
interface FloorCell { tx: number; ty: number }

/**
 * Require every authored door and named spawn to share one walkable area with the keeper, if
 * supplied. This reads only candidate data and never changes furniture, inventory or map solids.
 * Outdoor maps retain their changing-resource topology and only use direct entrance protection.
 */
export function hasRoomAccess(map: MapData, items: readonly PlacedFurniture[], keeper?: FloorCell): boolean {
  if (!map.interior) return true;
  const key = (tx: number, ty: number): string => `${tx},${ty}`;
  const blocked = new Set<string>();
  for (const placed of items) {
    if (placed.scene !== map.key || !furnitureDefinition(placed.item).blocking) continue;
    for (const cell of furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation)) blocked.add(key(cell.tx, cell.ty));
  }
  const doors: FloorCell[] = [];
  for (const warp of map.warps) {
    for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
      for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) doors.push({ tx, ty });
    }
  }
  const doorKeys = new Set(doors.map(cell => key(cell.tx, cell.ty)));
  const walkable = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h &&
    (!map.solid[ty][tx] || doorKeys.has(key(tx, ty))) && !blocked.has(key(tx, ty));
  const targets = [...map.spawns, ...doors];
  if (!targets.length) throw new Error(`RoomAccess: interior ${map.key} has no entrance`);
  const origin = keeper === undefined ? targets[0] : keeper;
  if (!walkable(origin.tx, origin.ty)) return false;
  const queue: FloorCell[] = [origin];
  const reached = new Set([key(origin.tx, origin.ty)]);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const tx = cell.tx + dx, ty = cell.ty + dy, id = key(tx, ty);
      if (!walkable(tx, ty) || reached.has(id)) continue;
      reached.add(id);
      queue.push({ tx, ty });
    }
  }
  return targets.every(cell => reached.has(key(cell.tx, cell.ty)));
}
