/**
 * PlacementSystem — validates and commits building placements (M7). This is the seam the Prompt-2
 * shop-empire buys into: buying a shop from the carpenter will call `tryPlace` with a shop type.
 *
 * A placement is valid only if EVERY tile in its footprint is: inside the map, on a `buildable`
 * tile, not solid, and not overlapping an existing placement. Validation reads the resolved MapData
 * (buildable grid) so it is engine-agnostic and unit-testable via GameState. Commit appends to
 * GameState.placements (serializable, save-able, testable).
 */
import { GameState, type Placement } from '../state/GameState';
import type { MapData } from '../world/MapDef';
import type { SceneKey } from '../config/AssetKeys';

/** Result of a placement attempt: ok, or a reason it was rejected (fail-loud, not silent). */
export type PlacementResult =
  | { ok: true; placement: Placement }
  | { ok: false; reason: 'out-of-bounds' | 'not-buildable' | 'occupied' };

/** Does the WxH footprint at (tx,ty) fit entirely on buildable, unoccupied tiles of `map`? */
export function validatePlacement(
  map: MapData,
  scene: SceneKey,
  tx: number,
  ty: number,
  w: number,
  h: number
): PlacementResult {
  // Every footprint tile must be in-bounds and buildable (buildable implies non-solid in MapDef).
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) {
        return { ok: false, reason: 'out-of-bounds' };
      }
      if (!map.buildable[y][x]) {
        return { ok: false, reason: 'not-buildable' };
      }
    }
  }

  // Must not overlap an existing placement in the same scene.
  const overlaps = GameState.instance.placements.some(
    (p) =>
      p.scene === scene &&
      tx < p.tx + p.w &&
      tx + w > p.tx &&
      ty < p.ty + p.h &&
      ty + h > p.ty
  );
  if (overlaps) return { ok: false, reason: 'occupied' };

  const placement: Placement = {
    id: `${scene}:${tx},${ty}`,
    type: 'building',
    tx,
    ty,
    w,
    h,
    scene,
  };
  return { ok: true, placement };
}

export const PlacementSystem = {
  /**
   * Attempt to place a building of the given type + footprint at a tile. On success, records it in
   * GameState.placements and returns the placement; on failure, returns the reason (no state change).
   */
  tryPlace(
    map: MapData,
    scene: SceneKey,
    type: string,
    tx: number,
    ty: number,
    w: number,
    h: number
  ): PlacementResult {
    const res = validatePlacement(map, scene, tx, ty, w, h);
    if (!res.ok) return res;
    res.placement.type = type;
    GameState.instance.placements.push(res.placement);
    return res;
  },
};
