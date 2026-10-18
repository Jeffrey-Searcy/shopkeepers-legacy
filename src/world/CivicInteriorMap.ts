/**
 * CivicInteriorMap — turns a civic room's blueprint (config/CivicInteriors.ts) into its MapData.
 *
 * Painted rooms take collision straight from the painting's walk rows, arrive at the painted spawn and
 * leave through the painted door (its cells are walkable in the walk rows). The built clinic keeps its procedural layout: border walls, a 3-row
 * back wall, partition walls, home furniture, civic fixtures and features are solid.
 * Every room gets one 'entry' spawn, one warp back to town on the door row (BaseWorldScene carves warp
 * cells out of collision, so the clinic's solid bottom border still lets the keeper out), and reserves its whole floor
 * so the player can never build inside a civic room.
 */
import type { MapData } from './MapDef';
import { SceneKey } from '../config/AssetKeys';
import { furnitureCells, furnitureDefinition } from '../config/Furniture';
import type { TownBuilding } from '../config/TownBuildings';
import { CIVIC_FEATURES } from '../config/CivicFeatures';
import { civicInteriorBlueprint, type BuiltCivicBlueprint, type CivicTileRect } from '../config/CivicInteriors';

/**
 * Mark every cell of a rectangle solid.
 * @param solid the collision grid to change
 * @param rect the tiles to mark
 */
function fillSolid(solid: boolean[][], rect: CivicTileRect): void {
  for (let ty = rect.ty; ty < rect.ty + rect.h; ty++) for (let tx = rect.tx; tx < rect.tx + rect.w; tx++) solid[ty][tx] = true;
}

/**
 * Build the built clinic's collision: border, back wall, partitions, home furniture, fixtures and features.
 * @param building the clinic's building record (fixtures)
 * @param room the clinic blueprint
 */
function builtSolid(building: TownBuilding, room: BuiltCivicBlueprint): boolean[][] {
  const { w, h } = room;
  const solid = Array.from({ length: h }, (_, ty) => Array.from({ length: w }, (_, tx) => tx === 0 || tx === w - 1 || ty < 3 || ty === h - 1));
  for (const wall of room.staticWalls) fillSolid(solid, wall);
  for (const footprint of room.homeFootprints) fillSolid(solid, footprint);
  for (const fixture of building.room.fixtures) if (furnitureDefinition(fixture.item).blocking) {
    for (const cell of furnitureCells(fixture.item, fixture.tx, fixture.ty, fixture.rotation)) solid[cell.ty][cell.tx] = true;
  }
  for (const feature of CIVIC_FEATURES[building.id]) fillSolid(solid, feature);
  return solid;
}

/**
 * Build one detached civic room map.
 * @param building the building whose room to build; its room size must match its blueprint
 * @returns the room's MapData (door warp to town, 'entry' spawn, whole floor reserved)
 */
export function civicInteriorMap(building: TownBuilding): MapData {
  const room = civicInteriorBlueprint(building.id);
  const { w, h } = room;
  if (building.room.w !== w || building.room.h !== h) throw new Error(`Civic interior map: ${building.id} room size does not match its blueprint`);
  let solid: boolean[][];
  let reservedTiles: { tx: number; ty: number }[];
  if (room.layout === 'painted') {
    if (building.room.fixtures.length > 0 || CIVIC_FEATURES[building.id].length > 0) {
      throw new Error(`Civic interior map: painted ${building.id} must not have fixtures or features`);
    }
    solid = room.walk.map(row => [...row].map(cell => cell === '#'));
    // why: only painted floor can hold a placed item, so reserving the walkable tiles covers the whole room.
    reservedTiles = room.walk.flatMap((row, ty) => [...row].flatMap((cell, tx) => cell === '.' ? [{ tx, ty }] : []));
  } else {
    solid = builtSolid(building, room);
    reservedTiles = Array.from({ length: h - 2 }, (_, y) => Array.from({ length: w - 2 }, (_, x) => ({ tx: x + 1, ty: y + 1 }))).flat();
  }
  return { key: building.scene, w, h, ground: Array.from({ length: h }, () => Array.from({ length: w }, () => 'floor')),
    solid, buildable: Array.from({ length: h }, () => Array.from({ length: w }, () => false)),
    spawns: [{ id: 'entry', tx: room.spawn.tx, ty: room.spawn.ty }],
    warps: [{ tx: room.entryTx, ty: h - 1, w: room.entryW, h: 1, target: SceneKey.Town, spawn: `from_${building.id}`, doorFacing: 'south' }],
    objects: [], decor: [], buildings: [],
    interior: room.layout === 'painted' ? { kind: 'painted' } : { kind: 'built', wallHeight: 48 },
    reservedTiles };
}
