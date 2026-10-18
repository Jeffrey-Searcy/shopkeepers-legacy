/**
 * WaterSound — the soft loop of a map's running water (a river or the sea), heard from the nearest water tile.
 * Still water (ponds, lakes) is silent: its plan names no water kind, so waterArea() returns null.
 *
 * SoundPlans names each world scene's water kind. waterArea() turns the map's 'water' Ground tiles into
 * one AmbientArea: its distance is from the keeper to the edge of the nearest water tile, so the sound
 * grows as the keeper walks to any bank and fades away from all of them. BaseWorldScene plays it in its
 * own AmbientSoundscape. Point sounds (a fountain, a waterfall) stay in each painting's `sounds` list.
 * River water is in SILENT_KINDS for now (no recording yet), so a river area builds no audio; only the sea plays.
 */
import { TILE } from '../config/GameConfig';
import type { SceneKey } from '../config/AssetKeys';
import type { AmbientArea } from '../systems/AmbientSound';
import type { MapData } from './MapDef';
import { soundPlan, type WaterKind } from './SoundPlans';

/** How far (tiles) each water kind is heard: a stream is close, the open sea carries far. */
const HEARING_TILES: Readonly<Record<WaterKind, number>> = { river: 6, sea: 12 };

/**
 * The water sound of one map, or null when the plan names no water kind (still water or a dry map).
 * @param key the world scene
 * @param map its map data
 * @throws when the plan names a water kind but the map has no water tiles (the plan and map disagree)
 */
export function waterArea(key: SceneKey, map: MapData): AmbientArea | null {
  const kind = soundPlan(key).water;
  if (!kind) return null;
  const wet = map.ground.map((row) => row.map((ground) => ground === 'water'));
  if (!wet.some((row) => row.includes(true))) {
    throw new Error(`WaterSound: ${key}'s sound plan has ${kind} water, but its map has no water tiles`);
  }
  const reach = HEARING_TILES[kind];
  const radius = reach * TILE;
  return {
    kind,
    radius,
    /** World px from (x, y) to the nearest water tile's edge; Infinity when none is within the radius. */
    distanceFrom(x: number, y: number): number {
      const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
      let best = Infinity;
      // why: only tiles within the hearing radius can be heard, so scan that window, not the whole map.
      for (let ty = Math.max(0, cy - reach); ty <= Math.min(map.h - 1, cy + reach); ty++) {
        const row = wet[ty];
        for (let tx = Math.max(0, cx - reach); tx <= Math.min(map.w - 1, cx + reach); tx++) {
          if (!row[tx]) continue;
          const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE);
          const dy = Math.max(ty * TILE - y, 0, y - (ty + 1) * TILE);
          const d = Math.hypot(dx, dy);
          if (d < best) best = d;
        }
      }
      // why: the scanned window is square, so its corners reach past the round hearing radius.
      return best <= radius ? best : Infinity;
    },
  };
}
