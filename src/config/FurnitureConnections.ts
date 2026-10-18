/** Derive table and rug surface joins from durable footprints without merging or changing placements. */
import type { SceneKey } from './AssetKeys';
import { furnitureCells, type PlacedFurniture } from './Furniture';

/** One occupied surface tile. Mask bits are N1, E2, S4, W8, NE16, SE32, SW64, NW128. */
export interface ConnectedFurnitureCell {
  item: 'table' | 'rug';
  tx: number;
  ty: number;
  /** Same-item neighbors only; diagonal bits remain independent for concave corner rendering. */
  mask: number;
}

/** Native grid directions; diagonals distinguish an inside corner from a filled surface. */
const NEIGHBORS = [
  { dx: 0, dy: -1, bit: 1 }, { dx: 1, dy: 0, bit: 2 },
  { dx: 0, dy: 1, bit: 4 }, { dx: -1, dy: 0, bit: 8 },
  { dx: 1, dy: -1, bit: 16 }, { dx: 1, dy: 1, bit: 32 },
  { dx: -1, dy: 1, bit: 64 }, { dx: -1, dy: -1, bit: 128 },
] as const;

/** Encode item and whole-tile coordinates so a table above a rug retains separate surface joins. */
function cellKey(item: ConnectedFurnitureCell['item'], tx: number, ty: number): string {
  return `${item}:${tx},${ty}`;
}

/**
 * Expand table/rug footprints in one scene and derive their eight-neighbor masks.
 * @param items Durable individual placements; these records are never modified or combined.
 * @param scene Only this scene contributes cells or neighbors.
 * @returns Cells sorted by row, column, then item, independent of placement order.
 * @throws When a footprint is invalid or same-item footprints occupy the same cell.
 */
export function connectedFurnitureCells(
  items: readonly PlacedFurniture[], scene: SceneKey
): readonly ConnectedFurnitureCell[] {
  const cells: ConnectedFurnitureCell[] = [];
  const occupied = new Set<string>();
  for (const placed of items) {
    if (placed.scene !== scene || (placed.item !== 'table' && placed.item !== 'rug')) continue;
    for (const cell of furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation)) {
      const key = cellKey(placed.item, cell.tx, cell.ty);
      // Duplicate cells would hide an invalid placement and make pickup ownership ambiguous.
      if (occupied.has(key)) throw new Error(`FurnitureConnections: duplicate ${placed.item} cell at ${scene}:${cell.tx},${cell.ty}`);
      occupied.add(key);
      cells.push({ item: placed.item, tx: cell.tx, ty: cell.ty, mask: 0 });
    }
  }
  for (const cell of cells) {
    for (const neighbor of NEIGHBORS) {
      if (occupied.has(cellKey(cell.item, cell.tx + neighbor.dx, cell.ty + neighbor.dy))) cell.mask |= neighbor.bit;
    }
  }
  return cells.sort((a, b) => a.ty - b.ty || a.tx - b.tx || a.item.localeCompare(b.item));
}
