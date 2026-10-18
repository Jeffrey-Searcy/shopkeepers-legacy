/** Shared furniture footprints and native presentation, independent of image padding and orientation. */
import { TextureKey, SceneKey } from './AssetKeys';
import { TILE } from './GameConfig';

/** Saved floor-facing identifiers; all current views keep their art upright. */
export type Rotation = 0 | 1 | 2 | 3;
/** Durable furnishing anchored to the top-left tile of its floor footprint. */
export interface PlacedFurniture { item: string; scene: SceneKey; tx: number; ty: number; rotation: Rotation }
/** Native presentation centered over the footprint and anchored at its bottom edge. */
export interface FurnitureView {
  w: number; h: number; texture: string; displayW: number; displayH: number;
  /** Display dimensions are native image pixels before this clockwise turn. */
  angle: 0 | 90;
  originX: 0.5 | 1; originY: 1 | 0.5;
  /** Optional transparent-padding crop, applied as a Phaser frame without editing source pixels. */
  crop?: { x: number; y: number; w: number; h: number };
  frame?: string;
}
/** Collision behavior and the discrete authored views available to a furnishing. */
export interface FurnitureDefinition {
  /** Placement policy for new items; existing saved furniture keeps its location. */
  placement: 'indoors' | 'anywhere';
  blocking: boolean;
  rotations: readonly Rotation[];
  views: Partial<Record<Rotation, FurnitureView>>;
}
/** Build view data; footprint uses tiles, display dimensions use native pixels. */
function view(w: number, h: number, texture: string, displayW: number, displayH: number): FurnitureView {
  return { w, h, texture, displayW, displayH, angle: 0, originX: 0.5, originY: 1 };
}
/** Table surfaces repeat native art over their floor cells, with the same five-pixel height in both views. */
const TABLE_VIEW = view(2, 1, TextureKey.FurnitureTableHorizontal, 32, 21);
const TABLE_VERTICAL_VIEW = view(1, 2, TextureKey.FurnitureTableHorizontal, 16, 37);
/** Authored workbench crops keep the vise and feet upright, without changing their native pixels. */
const WORKBENCH_VIEW: FurnitureView = { ...view(2, 1, TextureKey.Workbench, 29, 18),
  frame: 'furniture-crop', crop: { x: 1, y: 9, w: 29, h: 18 } };
const WORKBENCH_VERTICAL_VIEW: FurnitureView = { ...view(1, 2, TextureKey.WorkbenchVertical, 16, 25),
  frame: 'furniture-crop', crop: { x: 9, y: 5, w: 16, h: 25 } };
/** Single geometry owner consumed by placement, previews, rendering and save validation. */
export const FURNITURE: Readonly<Record<string, FurnitureDefinition>> = {
  chest: { placement: 'anywhere', blocking: true, rotations: [0], views: { 0: view(1, 1, TextureKey.Chest, 20, 26) } },
  workbench: { placement: 'anywhere', blocking: true, rotations: [0, 1], views: { 0: WORKBENCH_VIEW, 1: WORKBENCH_VERTICAL_VIEW } },
  table: { placement: 'indoors', blocking: true, rotations: [0, 1], views: { 0: TABLE_VIEW, 1: TABLE_VERTICAL_VIEW } },
  // Side views use a 20px window placed so the seat's front pixel lands on the next tile's table
  // outline (tile-local x -2 for west, 17 for east). Their art then sits CHAIR_TUCK_PX toward the
  // table, whole-pixel aligned, and the table draws over the seat edge (see furnitureDepth).
  // why: centered 14/15px crops left a 1px and 3px gap to the tabletop, and the 15px east crop
  // landed on a half pixel, so chairs beside a table looked loose ("the chairs are off").
  chair: { placement: 'indoors', blocking: true, rotations: [0, 1, 2, 3], views: {
    0: { ...view(1, 1, TextureKey.FurnitureChairSouth, 16, 27), frame: 'furniture-crop', crop: { x: 9, y: 3, w: 16, h: 27 } },
    1: { ...view(1, 1, TextureKey.FurnitureChairWest, 20, 25), frame: 'furniture-crop', crop: { x: 11, y: 5, w: 20, h: 25 } },
    2: { ...view(1, 1, TextureKey.FurnitureChairNorth, 14, 23), frame: 'furniture-crop', crop: { x: 10, y: 6, w: 14, h: 23 } },
    3: { ...view(1, 1, TextureKey.FurnitureChairEast, 20, 26), frame: 'furniture-crop', crop: { x: 4, y: 4, w: 20, h: 26 } },
  } },
  bar: { placement: 'indoors', blocking: true, rotations: [0, 1], views: {
    0: { ...view(2, 1, TextureKey.FurnitureBarHorizontal, 34, 24), frame: 'furniture-crop', crop: { x: 0, y: 7, w: 34, h: 24 } },
    1: { ...view(1, 2, TextureKey.FurnitureBarVertical, 18, 31), frame: 'furniture-crop', crop: { x: 8, y: 2, w: 18, h: 31 } },
  } },
  register: { placement: 'indoors', blocking: true, rotations: [0], views: {
    0: { ...view(1, 1, TextureKey.FurnitureRegister, 18, 26), frame: 'furniture-crop', crop: { x: 1, y: 1, w: 18, h: 26 } },
  } },
  stove: { placement: 'indoors', blocking: true, rotations: [0], views: {
    0: { ...view(2, 1, TextureKey.FurnitureStove, 28, 36), frame: 'furniture-crop', crop: { x: 1, y: 2, w: 28, h: 36 } },
  } },
  rug: { placement: 'indoors', blocking: false, rotations: [0], views: { 0: view(2, 2, TextureKey.FurnitureRug, 32, 32) } },
};
/**
 * Pixels a side-facing chair's art (and anyone seated on it) sits toward the table it faces.
 * Matches the side-view crops above: the seat moved 3px from its old centered spot.
 */
export const CHAIR_TUCK_PX = 3;

/**
 * Horizontal offset for someone seated on a chair, so their body stays on the tucked-in seat.
 *
 * @param facing The way the seated person faces (the chair's facing).
 * @returns World pixels to add to the tile-center x: -3 facing left, +3 facing right, else 0.
 */
export function seatedOffsetX(facing: 'up' | 'down' | 'left' | 'right'): number {
  if (facing === 'left') return -CHAIR_TUCK_PX;
  if (facing === 'right') return CHAIR_TUCK_PX;
  return 0;
}

/**
 * Draw depth for a blocking furnishing: the bottom edge of its footprint. Chairs sit one unit
 * lower, so a table in the same row draws over a tucked-in seat instead of tying with it.
 *
 * @param item Furniture item id.
 * @param ty Top tile row of the footprint.
 * @param h Footprint height in tiles.
 * @returns Phaser depth value.
 */
export function furnitureDepth(item: string, ty: number, h: number): number {
  const bottom = (ty + h) * TILE;
  return item === 'chair' ? bottom - 1 : bottom;
}

/** Buildings count as interiors; caves are not furnished rooms. Extend this set when adding rooms. */
const FURNISHED_INTERIORS: ReadonlySet<SceneKey> = new Set([SceneKey.Home, SceneKey.Tavern, SceneKey.Bedroom]);
/** Read new-placement policy without rejecting historical furniture during save restoration. */
export function furnitureAllowedInScene(item: string, scene: SceneKey): boolean {
  return furnitureDefinition(item).placement === 'anywhere' || FURNISHED_INTERIORS.has(scene);
}
/** Return a known definition or reject the item before inventory mutation. */
export function furnitureDefinition(item: string): FurnitureDefinition {
  if (!Object.prototype.hasOwnProperty.call(FURNITURE, item)) throw new Error(`Furniture: unknown item "${item}"`);
  return FURNITURE[item];
}
/** Validate and resolve an authored orientation; missing or unsupported rotations are corruption. */
export function furnitureView(item: string, rotation: number): FurnitureView {
  const definition = furnitureDefinition(item);
  if (!Number.isInteger(rotation) || !definition.rotations.includes(rotation as Rotation)) {
    throw new Error(`Furniture: unsupported rotation ${String(rotation)} for "${item}"`);
  }
  const selected = definition.views[rotation as Rotation];
  if (!selected) throw new Error(`Furniture: missing view ${rotation} for "${item}"`);
  return selected;
}
/** Cycle through distinct authored views; symmetric furniture does not expose duplicate turns. */
export function nextFurnitureRotation(item: string, rotation: Rotation): Rotation {
  furnitureView(item, rotation);
  const rotations = furnitureDefinition(item).rotations;
  return rotations[(rotations.indexOf(rotation) + 1) % rotations.length];
}
/** Enumerate all footprint cells and reject fractional anchors before any placement operation. */
export function furnitureCells(item: string, tx: number, ty: number, rotation: number): Array<{ tx: number; ty: number }> {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new Error('Furniture: anchor must use whole tiles');
  const selected = furnitureView(item, rotation);
  const cells: Array<{ tx: number; ty: number }> = [];
  for (let y = ty; y < ty + selected.h; y++) {
    for (let x = tx; x < tx + selected.w; x++) cells.push({ tx: x, ty: y });
  }
  return cells;
}
