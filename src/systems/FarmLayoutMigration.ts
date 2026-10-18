/**
 * Version10 farm-layout compatibility, applied only to detached, already validated old saves.
 * Ordered authored objects retain identity when moved. Farm growing records relocate intact;
 * indoor state is never edited. This module performs no storage or live-state writes.
 */
import { SceneKey } from '../config/AssetKeys';
import { TILE, PLAYER_BODY } from '../config/GameConfig';
import { getShopGeometry, intersectsShopStructure } from '../config/Shop';
import type { GameState } from '../state/GameState';
import type { MapData } from '../world/MapDef';

/** Authored interior-rendering metadata does not classify rooms; only these five scenes are approved outdoor removals. */
const OUTDOOR_SCENES = new Set<SceneKey>([SceneKey.Farm, SceneKey.Town, SceneKey.Forest, SceneKey.Beach, SceneKey.Mountain]);

/** One source cell may own soil and its crop; they move together rather than losing their relationship. */
interface GrowingCell { key: string; tx: number; ty: number; tree: boolean }

/** Parse a canonical farm record key and reject malformed or out-of-bounds data instead of relocating corruption. */
function farmCell(key: string, map: MapData): { tx: number; ty: number } {
  const match = /^FarmScene:(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
  if (!match) throw new Error(`Farm layout migration: invalid farm record key ${key}`);
  const tx = Number(match[1]), ty = Number(match[2]);
  if (tx >= map.w || ty >= map.h) throw new Error(`Farm layout migration: farm record ${key} is outside the map`);
  return { tx, ty };
}

/** Test own keys, including removed-node markers whose values must not be confused with inherited properties. */
function owns(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

/** Plan both resource dictionaries together, preserving paired overrides and markers even when coordinates swap. */
function resourceRemap(state: GameState, oldMap: MapData, newMap: MapData, notices: string[]): Map<string, string> {
  const plan = new Map(oldMap.objects.map((object, index) => [
    `${SceneKey.Farm}:${object.tx},${object.ty}`,
    `${SceneKey.Farm}:${newMap.objects[index].tx},${newMap.objects[index].ty}`,
  ]));
  const targets = new Set(plan.values());
  const sources = new Set([...Object.keys(state.removedNodes), ...Object.keys(state.treeStages)]);
  let relocated = 0;
  for (const key of [...sources].sort()) {
    if (!key.startsWith(`${SceneKey.Farm}:`)) continue;
    const cell = farmCell(key, oldMap);
    if (plan.has(key)) continue;
    // Cleared player-planted trees can leave non-authored markers. A newly moved resource must
    // not inherit that unrelated removal or growth stage; retain the inert marker on unused ground.
    if (targets.has(key)) {
      const next = nearestCell({ key, ...cell, tree: false }, newMap, (tx, ty) => {
        const target = `${SceneKey.Farm}:${tx},${ty}`;
        return !targets.has(target) && !sources.has(target);
      });
      const target = `${SceneKey.Farm}:${next.tx},${next.ty}`;
      plan.set(key, target); targets.add(target); relocated++;
    } else plan.set(key, key);
  }
  if (relocated) notices.push(`${relocated} cleared player-tree marker locations moved off newly authored resources; no cleared resource or tree stage was lost.`);
  return plan;
}

/** Copy immutable source entries through a precomputed one-to-one plan; never mutate keys during iteration. */
function remapResources<T>(record: Record<string, T>, plan: Map<string, string>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    const target = plan.has(key) ? plan.get(key)! : key;
    if (owns(result, target)) throw new Error(`Farm layout migration: resource markers conflict at ${target}`);
    result[target] = value;
  }
  return result;
}

/** Build blocked growing tiles from current static geometry and remapped resource state. */
function growingBlocked(state: GameState, map: MapData): Set<string> {
  const blocked = new Set<string>();
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (map.solid[ty][tx] || (map.ground[ty][tx] !== 'grass' && map.ground[ty][tx] !== 'dirt')) blocked.add(`${tx},${ty}`);
  }
  for (const object of map.objects) {
    const removed = state.removedNodes[`${SceneKey.Farm}:${object.tx},${object.ty}`];
    if (removed && removed.kind === object.kind) continue;
    if (object.kind === 'bin') {
      // Its runtime 40×26 body extends beyond the anchor tile; growing records must clear the whole footprint.
      for (let ty = Math.floor(((object.ty + 1) * TILE - 26) / TILE); ty < object.ty + 1; ty++) {
        for (let tx = Math.floor(((object.tx + 0.5) * TILE - 20) / TILE);
          tx < Math.ceil(((object.tx + 0.5) * TILE + 20) / TILE); tx++) blocked.add(`${tx},${ty}`);
      }
    } else blocked.add(`${object.tx},${object.ty}`);
  }
  for (const spawn of map.spawns) blocked.add(`${spawn.tx},${spawn.ty}`);
  for (const warp of map.warps) for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
    for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) blocked.add(`${tx},${ty}`);
  }
  if (!map.reservedTiles || !map.shopOffset) throw new Error('Farm layout migration: farm shop geometry is missing');
  for (const cell of map.reservedTiles) blocked.add(`${cell.tx},${cell.ty}`);
  for (const building of map.buildings) for (let ty = building.ty - building.hSolid + 1; ty <= building.ty; ty++) {
    for (let tx = building.tx; tx < building.tx + building.wTiles; tx++) blocked.add(`${tx},${ty}`);
  }
  // The new facade must not hide a growing record, even where its upper art has no walk collider.
  const front = getShopGeometry(map.shopOffset).front;
  for (let ty = Math.floor(front.y / TILE); ty < Math.ceil((front.y + 160) / TILE); ty++) {
    for (let tx = Math.floor(front.x / TILE); tx < Math.ceil((front.x + front.width) / TILE); tx++) blocked.add(`${tx},${ty}`);
  }
  return blocked;
}

/** Find nearest valid free ground by Manhattan distance, then row and column, with bounded deterministic work. */
function nearestCell(source: GrowingCell, map: MapData, allowed: (tx: number, ty: number) => boolean): { tx: number; ty: number } {
  for (let distance = 0; distance < map.w + map.h; distance++) {
    for (let ty = Math.max(1, source.ty - distance); ty <= Math.min(map.h - 2, source.ty + distance); ty++) {
      const dx = distance - Math.abs(ty - source.ty);
      for (const tx of dx === 0 ? [source.tx] : [source.tx - dx, source.tx + dx]) {
        if (tx >= 1 && tx < map.w - 1 && allowed(tx, ty)) return { tx, ty };
      }
    }
  }
  throw new Error(`Farm layout migration: no safe ground exists for ${source.key}; original save retained`);
}

/** Preserve every crop/soil/tree record, reserving already valid cells before relocating conflicts. */
function relocateGrowing(state: GameState, oldMap: MapData, newMap: MapData, notices: string[]): void {
  const blocked = growingBlocked(state, newMap), occupied = new Set<string>();
  const keys = new Set([...Object.keys(state.tiles), ...Object.keys(state.crops), ...Object.keys(state.plantedTrees)]
    .filter(key => key.startsWith(`${SceneKey.Farm}:`)));
  const cells = [...keys].map(key => ({ key, ...farmCell(key, oldMap), tree: owns(state.plantedTrees, key) }))
    .sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  /** Keep planted trees on grass and away from map-tree overrides; soil and crops permit authored dirt. */
  const allowed = (cell: GrowingCell, tx: number, ty: number): boolean => tx > 0 && ty > 0 && tx < newMap.w - 1 && ty < newMap.h - 1 &&
    !blocked.has(`${tx},${ty}`) && !occupied.has(`${tx},${ty}`) &&
    (!cell.tree || (newMap.ground[ty][tx] === 'grass' && !owns(state.treeStages, `${SceneKey.Farm}:${tx},${ty}`)));
  const moving: GrowingCell[] = [];
  for (const cell of cells) {
    if (allowed(cell, cell.tx, cell.ty)) occupied.add(`${cell.tx},${cell.ty}`);
    else moving.push(cell);
  }
  const tiles = { ...state.tiles }, crops = { ...state.crops }, trees = { ...state.plantedTrees };
  // Remove all source positions before writing destinations, including positions another relocation may reuse.
  for (const cell of moving) { delete tiles[cell.key]; delete crops[cell.key]; delete trees[cell.key]; }
  let soilCount = 0, cropCount = 0, treeCount = 0;
  for (const cell of moving) {
    const target = nearestCell(cell, newMap, (tx, ty) => allowed(cell, tx, ty));
    const key = `${SceneKey.Farm}:${target.tx},${target.ty}`;
    occupied.add(`${target.tx},${target.ty}`);
    if (owns(state.tiles, cell.key)) { tiles[key] = state.tiles[cell.key]; soilCount++; }
    if (owns(state.crops, cell.key)) { crops[key] = state.crops[cell.key]; cropCount++; }
    if (owns(state.plantedTrees, cell.key)) { trees[key] = state.plantedTrees[cell.key]; treeCount++; }
  }
  state.tiles = tiles; state.crops = crops; state.plantedTrees = trees;
  if (moving.length) notices.push(`The new farm moved ${soilCount} soil records, ${cropCount} crops and ${treeCount} planted trees to the nearest free ground. Species, growth and watering are preserved.`);
}

/** Test the full keeper feet box against current solid tiles, resource bodies, planted trunks and porch edges. */
function playerBlocked(state: GameState, map: MapData, x: number, y: number): boolean {
  const halfW = PLAYER_BODY.w / 2, halfH = PLAYER_BODY.h / 2;
  /** Strict rectangle intersection matches physics: touching outside edges remains legal. */
  const intersects = (left: number, top: number, width: number, height: number): boolean =>
    x + halfW > left && x - halfW < left + width && y + halfH > top && y - halfH < top + height;
  for (let ty = Math.floor((y - halfH) / TILE); ty <= Math.floor((y + halfH - 0.001) / TILE); ty++) {
    for (let tx = Math.floor((x - halfW) / TILE); tx <= Math.floor((x + halfW - 0.001) / TILE); tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
      const doorway = map.warps.some(warp => tx >= warp.tx && tx < warp.tx + warp.w && ty >= warp.ty && ty < warp.ty + warp.h);
      if (!doorway && (map.solid[ty][tx] || map.ground[ty][tx] === 'water')) return true;
    }
  }
  if (!map.shopOffset) throw new Error('Farm layout migration: new shop offset is missing');
  if (intersectsShopStructure(x, y, map.shopOffset)) return true;
  for (const object of map.objects) {
    const removed = state.removedNodes[`${SceneKey.Farm}:${object.tx},${object.ty}`];
    if (removed && removed.kind === object.kind) continue;
    if (object.kind === 'bin' ? intersects((object.tx + 0.5) * TILE - 20, (object.ty + 1) * TILE - 26, 40, 26) :
      intersects(object.tx * TILE, object.ty * TILE, TILE, TILE)) return true;
  }
  for (const key of Object.keys(state.plantedTrees)) {
    const cell = farmCell(key, map);
    if (intersects(cell.tx * TILE, cell.ty * TILE, TILE, TILE)) return true;
  }
  return false;
}

/** Move only inaccessible farm pickups, retaining one unchanged item record per pickup and leaving other maps exact. */
function relocateGroundDrops(state: GameState, oldMap: MapData, newMap: MapData, notices: string[]): void {
  const blocked = growingBlocked(state, newMap);
  const occupied = new Set(state.groundDrops.filter(drop => drop.scene === SceneKey.Farm).map(drop => `${drop.tx},${drop.ty}`));
  for (const key of Object.keys(state.plantedTrees)) {
    const tile = farmCell(key, newMap); blocked.add(`${tile.tx},${tile.ty}`);
  }
  let count = 0;
  state.groundDrops = state.groundDrops.map(drop => {
    if (drop.scene !== SceneKey.Farm) return drop;
    const key = `${SceneKey.Farm}:${drop.tx},${drop.ty}`;
    farmCell(key, oldMap);
    if (!playerBlocked(state, newMap, (drop.tx + 0.5) * TILE, (drop.ty + 0.5) * TILE)) return drop;
    const target = nearestCell({ key, tx: drop.tx, ty: drop.ty, tree: false }, newMap,
      (tx, ty) => !blocked.has(`${tx},${ty}`) && !occupied.has(`${tx},${ty}`) &&
        !playerBlocked(state, newMap, (tx + 0.5) * TILE, (ty + 0.5) * TILE));
    occupied.add(`${target.tx},${target.ty}`); count++;
    return { ...drop, ...target };
  });
  if (count) notices.push(`${count} farm pickups hidden by new obstacles moved to the nearest free ground; every item is preserved.`);
}

/** Apply the approved old-to-new farm move to a detached candidate and report all compatibility changes. */
export function migrateFarmLayout(state: GameState, oldMap: MapData, newMap: MapData, notices: string[]): void {
  if (oldMap.key !== SceneKey.Farm || newMap.key !== SceneKey.Farm || oldMap.w !== newMap.w || oldMap.h !== newMap.h ||
    oldMap.objects.length !== newMap.objects.length || oldMap.objects.some((object, index) => object.kind !== newMap.objects[index].kind)) {
    throw new Error('Farm layout migration: authored object identities or dimensions changed');
  }
  const resourcePlan = resourceRemap(state, oldMap, newMap, notices);
  state.removedNodes = remapResources(state.removedNodes, resourcePlan);
  state.treeStages = remapResources(state.treeStages, resourcePlan);
  const furnitureCount = state.placedItems.filter(item => OUTDOOR_SCENES.has(item.scene)).length;
  const placementCount = state.placements.filter(item => OUTDOOR_SCENES.has(item.scene)).length;
  state.placedItems = state.placedItems.filter(item => !OUTDOOR_SCENES.has(item.scene));
  state.placements = state.placements.filter(item => !OUTDOOR_SCENES.has(item.scene));
  notices.push(`Your saved farm now uses the approved layout. Removed ${furnitureCount} outdoor furnishings and ${placementCount} outdoor building placements. Interiors, inventory and hospitality are unchanged.`);
  relocateGrowing(state, oldMap, newMap, notices);
  relocateGroundDrops(state, oldMap, newMap, notices);
  if (state.activeScene === SceneKey.Farm && playerBlocked(state, newMap, state.player.x, state.player.y)) {
    const spawn = newMap.spawns.find(entry => entry.id === 'from_home');
    if (!spawn || playerBlocked(state, newMap, (spawn.tx + 0.5) * TILE, (spawn.ty + 0.5) * TILE)) {
      throw new Error('Farm layout migration: the required safe shop arrival is blocked');
    }
    state.player = { ...state.player, x: (spawn.tx + 0.5) * TILE, y: (spawn.ty + 0.5) * TILE, facing: 'down' };
    notices.push('The new farm moved your keeper to the safe shop arrival.');
  }
}
