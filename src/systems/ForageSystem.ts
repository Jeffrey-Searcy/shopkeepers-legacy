/**
 * ForageSystem — wild goods that appear on the ground each morning.
 *
 * Each outdoor scene in FORAGE_TABLE gets a few fresh spots per day (mushrooms and wild leeks in
 * the forest, leeks on the farm, shells on the beach). Spots are picked from the map alone (ground
 * type, solid grid, objects, buildings, warps), hashed with the day, so the same day always shows
 * the same spots and re-entering a scene never moves them. BaseWorldScene draws the spots and picks
 * one up when the keeper walks over it; picked spots go into progress.forage.taken and stay gone
 * until the next day, when the list empties.
 */
import { ITEM_CATALOG } from '../config/Items';
import { SceneKey } from '../config/AssetKeys';
import { GameState } from '../state/GameState';
import type { Ground, MapData } from '../world/MapDef';

/** One kind of forage in one scene: the item, how many spots per day, and where it grows. */
export interface ForageRule {
  readonly item: string;
  readonly perDay: number;
  readonly grounds: readonly Ground[];
}

/** One spot for today: the item lying at a tile. */
export interface ForageSpot {
  item: string;
  tx: number;
  ty: number;
}

/** Daily forage per scene. Scenes not listed have no forage. */
export const FORAGE_TABLE: Readonly<Partial<Record<SceneKey, readonly ForageRule[]>>> = {
  [SceneKey.Forest]: [
    { item: 'mushroom', perDay: 3, grounds: ['grass'] },
    { item: 'wild-leek', perDay: 2, grounds: ['grass', 'dirt'] },
  ],
  [SceneKey.Farm]: [{ item: 'wild-leek', perDay: 2, grounds: ['grass'] }],
  [SceneKey.Beach]: [{ item: 'seashell', perDay: 3, grounds: ['sand'] }],
};

/** Spots stay this many tiles away from map edges and warps, so they never sit in a doorway. */
const EDGE_MARGIN = 3;
const WARP_MARGIN = 3;
/** Two spots never sit closer than this (Chebyshev tiles), so they read as separate finds. */
const SPOT_SPACING = 3;

/**
 * Tiles a tree's canopy covers, relative to its trunk tile. A find there would hide under the
 * leaves, so these tiles never hold forage.
 */
export const CANOPY_OFFSETS: ReadonlyArray<readonly [number, number]> = (() => {
  const offsets: Array<readonly [number, number]> = [];
  for (let dy = -3; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) offsets.push([dx, dy]);
  return offsets;
})();

/** Check the table at module load: real items and positive counts. */
function validateTable(): void {
  for (const [scene, rules] of Object.entries(FORAGE_TABLE)) {
    if (!rules) continue;
    for (const rule of rules) {
      if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, rule.item)) throw new Error(`Forage: ${scene} uses unknown item ${rule.item}`);
      if (!Number.isSafeInteger(rule.perDay) || rule.perDay < 1) throw new Error(`Forage: ${scene} ${rule.item} needs a positive count`);
      if (rule.grounds.length === 0) throw new Error(`Forage: ${scene} ${rule.item} needs at least one ground type`);
    }
  }
}
validateTable();

/**
 * FNV-1a string hash: a stable number for a text, so spot picks repeat for the same day.
 * @param text the text to hash
 * @returns an unsigned 32-bit number
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The persistent key for a spot ("ForestScene:12,8"), shared with progress.forage.taken. */
export function forageKey(scene: SceneKey, tx: number, ty: number): string {
  return `${scene}:${tx},${ty}`;
}

/** Empty the picked list when the stored day is not today. */
function syncDay(): void {
  const gs = GameState.instance, forage = gs.progress.forage;
  if (forage.day !== gs.day) {
    forage.day = gs.day;
    forage.taken = [];
  }
}

/**
 * Tiles that never hold forage: solid tiles, map objects (trees, rocks, chests...), the canopy
 * around every map tree, building footprints, and the band around every warp.
 * @param map the scene's map
 * @returns a set of "tx,ty" keys
 */
function blockedTiles(map: MapData): Set<string> {
  const blocked = new Set<string>();
  for (const obj of map.objects) {
    blocked.add(`${obj.tx},${obj.ty}`);
    if (obj.kind === 'tree') for (const [dx, dy] of CANOPY_OFFSETS) blocked.add(`${obj.tx + dx},${obj.ty + dy}`);
  }
  for (const b of map.buildings) {
    // why: a building's art rises above its solid rows; block a generous box so no shell hides behind a wall.
    for (let y = b.ty - 4; y <= b.ty + b.hSolid; y++) for (let x = b.tx - 1; x <= b.tx + b.wTiles; x++) blocked.add(`${x},${y}`);
  }
  for (const warp of map.warps) {
    for (let y = warp.ty - WARP_MARGIN; y < warp.ty + warp.h + WARP_MARGIN; y++) {
      for (let x = warp.tx - WARP_MARGIN; x < warp.tx + warp.w + WARP_MARGIN; x++) blocked.add(`${x},${y}`);
    }
  }
  return blocked;
}

/**
 * Today's forage spots for a scene, before any are picked.
 * @param map the scene's map
 * @param day the game day the spots belong to
 * @param skip extra tiles the caller rules out (tilled soil, crops, placed furniture)
 * @returns spots in table order; fewer than asked only when the map has no room
 */
function spotsForDay(map: MapData, day: number, skip: (tx: number, ty: number) => boolean): ForageSpot[] {
  const rules = FORAGE_TABLE[map.key];
  if (!rules) return [];
  const blocked = blockedTiles(map);
  const spots: ForageSpot[] = [];
  for (const rule of rules) {
    const candidates: Array<{ tx: number; ty: number; rank: number }> = [];
    for (let ty = EDGE_MARGIN; ty < map.h - EDGE_MARGIN; ty++) {
      for (let tx = EDGE_MARGIN; tx < map.w - EDGE_MARGIN; tx++) {
        if (map.solid[ty][tx] || !rule.grounds.includes(map.ground[ty][tx])) continue;
        if (blocked.has(`${tx},${ty}`) || skip(tx, ty)) continue;
        candidates.push({ tx, ty, rank: hash(`${map.key}:${day}:${rule.item}:${tx},${ty}`) });
      }
    }
    candidates.sort((a, b) => a.rank - b.rank);
    let placed = 0;
    for (const c of candidates) {
      if (placed === rule.perDay) break;
      if (spots.some(s => Math.max(Math.abs(s.tx - c.tx), Math.abs(s.ty - c.ty)) < SPOT_SPACING)) continue;
      spots.push({ item: rule.item, tx: c.tx, ty: c.ty });
      placed++;
    }
  }
  return spots;
}

/**
 * Today's spots that are still on the ground in this scene.
 * @param map the scene's map
 * @param skip extra tiles the caller rules out (tilled soil, crops, placed furniture)
 */
function liveSpots(map: MapData, skip: (tx: number, ty: number) => boolean): ForageSpot[] {
  syncDay();
  const gs = GameState.instance;
  const taken = new Set(gs.progress.forage.taken);
  return spotsForDay(map, gs.day, skip).filter(s => !taken.has(forageKey(map.key, s.tx, s.ty)));
}

/**
 * Pick up one spot: add the item to the bag and mark the spot taken for today.
 * @returns false when the bag has no room (the spot stays on the ground)
 */
function pick(scene: SceneKey, spot: ForageSpot): boolean {
  syncDay();
  const key = forageKey(scene, spot.tx, spot.ty);
  const forage = GameState.instance.progress.forage;
  if (forage.taken.includes(key)) throw new Error(`Forage: ${key} was already picked today`);
  if (!GameState.instance.addItem(spot.item, 1)) return false;
  forage.taken.push(key);
  return true;
}

/** Public API for world scenes and tests. */
export const ForageSystem = Object.freeze({ spotsForDay, liveSpots, pick });
