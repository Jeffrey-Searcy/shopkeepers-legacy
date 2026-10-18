/**
 * CivicInteriors — one blueprint per civic room: its size, entrance, service counter, resident route
 * anchor, private wing (living room, heart-gated threshold, bedroom) and bed.
 *
 * Two kinds of room share one shape:
 *  - painted (11 rooms): the room is one hand-painted image (src/world/CivicRoomArt.ts). Its walk rows
 *    are the collision, and every anchor below is checked against them when this module loads;
 *  - built (the clinic): the room is drawn from tiles by CivicInteriorRenderer, with a public room, an
 *    east home wing added beside it, static partition walls and furniture footprints.
 * CivicInteriorMap turns a blueprint into the room's MapData; CivicInteriorScene, InteriorLights,
 * TownResident and CuddleSystem read the anchors from here, so every system agrees on one layout.
 */
import type { Facing } from '../state/GameState';
import type { TownBuildingId } from './TownBuildings';
import { CIVIC_ROOM_ART, type PaintedCivicId, type PaintedCivicRoom } from '../world/CivicRoomArt';
import type { PaintedRoomArt } from '../world/PaintedRoomRenderer';

/** Rooms whose counter opens the shared civic service panel. The market counter opens the shop instead. */
export type ExpandedCivicId = Exclude<TownBuildingId, 'market'>;
export interface CivicTileRect { tx: number; ty: number; w: number; h: number }
export interface CivicServiceStand { tx: number; ty: number; facing: Facing }
export interface CivicInteriorTheme {
  floorA: number; floorB: number; wall: number; trim: number; accent: number; shadow: number;
}

/**
 * Fields every civic room has, in map tiles.
 *  - entryTx / entryW: the door opening on the bottom row (the warp back to town);
 *  - spawn: the arrival tile from town;
 *  - residentRoute: the home-route anchor for the resident who lives here;
 *  - privateThreshold: the one-row doorway into the private wing (needs requiredHearts with the resident);
 *  - bed: the bed's solid footprint; Cuddle partners wait at (bed.tx + 1, bed.ty + bed.h);
 *  - servicePoint: the solid counter tile; serviceStand: where the keeper stands to use it;
 *  - station: the counter's name in prompts and toasts.
 */
interface CivicRoomCommon {
  w: number;
  h: number;
  entryTx: number;
  entryW: number;
  spawn: { tx: number; ty: number };
  residentRoute: { tx: number; ty: number };
  livingRoom: CivicTileRect;
  bedroom: CivicTileRect;
  privateThreshold: CivicTileRect & { requiredHearts: number };
  bed: CivicTileRect;
  servicePoint: { tx: number; ty: number };
  serviceStand: CivicServiceStand;
  station: string;
}

/** A painted room: walk rows are the collision, art is the painting PaintedRoomRenderer draws. */
export interface PaintedCivicBlueprint extends CivicRoomCommon {
  layout: 'painted';
  id: PaintedCivicId;
  walk: readonly string[];
  art: PaintedRoomArt;
}

/**
 * A built room (the clinic): baseW is the public room's width; the home wing fills x = baseW..w-1.
 * staticWalls and homeFootprints are solid; theme colours the procedural floor and walls.
 */
export interface BuiltCivicBlueprint extends CivicRoomCommon {
  layout: 'built';
  id: 'clinic';
  baseW: number;
  publicRoom: CivicTileRect;
  staticWalls: readonly CivicTileRect[];
  homeFootprints: readonly (CivicTileRect & { id: string })[];
  theme: CivicInteriorTheme;
}

export type CivicInteriorBlueprint = PaintedCivicBlueprint | BuiltCivicBlueprint;

/** Hearts the keeper needs with a room's resident before the private-wing doorway lets them through. */
const PRIVATE_HEARTS = 2;

/**
 * Build the clinic: the old 20-tile public room plus a 12-tile east home wing.
 * The wing's living room (top) and bedroom (bottom) are split by a partition with a 2-tile doorway.
 */
function builtClinic(): BuiltCivicBlueprint {
  const baseW = 20, h = 17, w = baseW + 12, entryTx = Math.floor(baseW / 2) - 1;
  return {
    layout: 'built', id: 'clinic', baseW, w, h, entryTx, entryW: 2,
    spawn: { tx: entryTx, ty: h - 3 },
    residentRoute: { tx: Math.floor(baseW / 2), ty: 5 },
    publicRoom: { tx: 1, ty: 3, w: baseW - 2, h: h - 4 },
    livingRoom: { tx: baseW, ty: 3, w: 11, h: 7 },
    bedroom: { tx: baseW, ty: 11, w: 11, h: h - 12 },
    privateThreshold: { tx: baseW + 4, ty: 10, w: 2, h: 1, requiredHearts: PRIVATE_HEARTS },
    bed: { tx: baseW, ty: 13, w: 3, h: 1 },
    staticWalls: [
      { tx: baseW - 1, ty: 3, w: 1, h: 2 },
      { tx: baseW - 1, ty: 8, w: 1, h: h - 9 },
      { tx: baseW, ty: 10, w: 4, h: 1 },
      { tx: baseW + 6, ty: 10, w: 5, h: 1 },
    ],
    homeFootprints: [
      { id: 'home-stove', tx: baseW, ty: 4, w: 4, h: 1 },
      { id: 'home-pantry', tx: baseW + 7, ty: 5, w: 4, h: 1 },
      { id: 'home-table', tx: baseW + 4, ty: 6, w: 6, h: 1 },
      { id: 'bedroom-bed', tx: baseW, ty: 13, w: 3, h: 1 },
      { id: 'bedroom-dresser', tx: baseW + 6, ty: 13, w: 5, h: 1 },
    ],
    servicePoint: { tx: 13, ty: 11 },
    serviceStand: { tx: 12, ty: 11, facing: 'right' },
    station: 'Treatment Cot',
    theme: { floorA: 0x9a9875, floorB: 0x8c8d70, wall: 0x546652, trim: 0xe0d7a4, accent: 0x88b48a, shadow: 0x2d3a31 },
  };
}

/**
 * Build one painted room's blueprint from its painting data. Every painted counter is faced from below.
 * @param id the room
 * @param station the counter's name in prompts and toasts
 */
function painted(id: PaintedCivicId, station: string): PaintedCivicBlueprint {
  const room: PaintedCivicRoom = CIVIC_ROOM_ART[id];
  return {
    layout: 'painted', id, walk: room.walk, art: room.art,
    w: room.walk[0].length, h: room.walk.length,
    entryTx: room.door.tx, entryW: room.door.w, spawn: { ...room.spawn }, residentRoute: { ...room.resident },
    livingRoom: { ...room.livingRoom }, bedroom: { ...room.bedroom }, bed: { ...room.bed },
    privateThreshold: { ...room.threshold, h: 1, requiredHearts: PRIVATE_HEARTS },
    servicePoint: { ...room.service }, serviceStand: { ...room.stand, facing: 'up' }, station,
  };
}

/** Every civic room, keyed by building id. Station names match the services in CivicServices.ts. */
export const CIVIC_INTERIORS: Readonly<Record<TownBuildingId, CivicInteriorBlueprint>> = {
  market: painted('market', 'Register'),
  magic: painted('magic', 'Moonwell Shrine'),
  forge: painted('forge', 'Anvil Orders'),
  museum: painted('museum', 'Curator’s Plinth'),
  clinic: builtClinic(),
  guild: painted('guild', 'Portal Quest Board'),
  ranch: painted('ranch', 'Seed Ledger'),
  bar: painted('bar', 'Wayfarer Bar'),
  carpenter: painted('carpenter', 'Order Workbench'),
  fishing: painted('fishing', 'Tackle Scale'),
  alchemy: painted('alchemy', 'Brew Table'),
  tailor: painted('tailor', 'Fitting Table'),
};

/**
 * Resolve one civic room's blueprint, or throw for an unknown id.
 * @param id the building id
 */
export function civicInteriorBlueprint(id: TownBuildingId): CivicInteriorBlueprint {
  const result = CIVIC_INTERIORS[id];
  if (!result) throw new Error(`Civic interiors: unknown room ${id}`);
  return result;
}

/** Resident route rules shared with TownResident.roomRouteTile: Manhattan reach and minimum size. */
export const RESIDENT_ROUTE_REACH = 7;
export const RESIDENT_ROUTE_MIN_TILES = 16;

/**
 * Check one painted room's anchors against its walk rows. Throws with the room id and the first problem.
 * The rules keep the painting playable:
 *  1. the walk rows are rectangular, only '.' and '#', and match the painting's size;
 *  2. the door cells on the bottom row are walkable and the cells beside them are solid;
 *  3. every walkable tile connects to the spawn;
 *  4. spawn, stand and resident anchor are walkable; the counter is solid; the stand is just below it;
 *  5. the threshold cells are walkable, and with them blocked no bedroom tile is reachable from the
 *     spawn, and every tile past the threshold lies inside the bedroom rectangle;
 *  6. the bed is solid and its wait tile (bed.tx + 1, bed.ty + bed.h) is walkable, inside the bedroom;
 *  7. the resident's route (walkable tiles inside the border within RESIDENT_ROUTE_REACH of the anchor)
 *     has at least RESIDENT_ROUTE_MIN_TILES tiles and never enters the bedroom.
 * @param room the painted blueprint to check
 */
function validatePaintedRoom(room: PaintedCivicBlueprint): void {
  const fail = (problem: string): never => { throw new Error(`Civic interiors: ${room.id} ${problem}`); };
  const { w, h, walk } = room;
  if (walk.some(row => row.length !== w || /[^.#]/.test(row))) fail('walk rows are not a clean rectangle');
  if (room.art.widthTexels !== w * 32 || room.art.heightTexels !== h * 32) fail('walk rows do not match the painting size');
  const inside = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < w && ty < h;
  const walkable = (tx: number, ty: number): boolean => inside(tx, ty) && walk[ty][tx] === '.';
  const inRect = (rect: CivicTileRect, tx: number, ty: number): boolean =>
    tx >= rect.tx && tx < rect.tx + rect.w && ty >= rect.ty && ty < rect.ty + rect.h;
  const key = (tx: number, ty: number): string => `${tx},${ty}`;
  /** Flood fill over walkable tiles from a start, skipping blocked keys and tiles the filter rejects. */
  const flood = (start: { tx: number; ty: number }, blocked: ReadonlySet<string>,
    allow: (tx: number, ty: number) => boolean = () => true): Set<string> => {
    const seen = new Set([key(start.tx, start.ty)]);
    const queue: [number, number][] = [[start.tx, start.ty]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        const k = key(nx, ny);
        if (!walkable(nx, ny) || seen.has(k) || blocked.has(k) || !allow(nx, ny)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };
  const allWalkable = new Set<string>();
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) if (walkable(tx, ty)) allWalkable.add(key(tx, ty));

  // 2. door
  for (let i = 0; i < room.entryW; i++) if (!walkable(room.entryTx + i, h - 1)) fail(`door cell ${room.entryTx + i} is solid`);
  if (walkable(room.entryTx - 1, h - 1) || walkable(room.entryTx + room.entryW, h - 1)) fail('door is wider than its opening');
  // 3. one connected floor
  const reach = flood(room.spawn, new Set());
  if (reach.size !== allWalkable.size) fail(`has ${allWalkable.size - reach.size} walkable tiles cut off from the spawn`);
  // 4. anchors
  for (const [name, at] of [['spawn', room.spawn], ['stand', room.serviceStand], ['resident anchor', room.residentRoute]] as const) {
    if (!walkable(at.tx, at.ty)) fail(`${name} ${key(at.tx, at.ty)} is solid`);
  }
  if (walkable(room.servicePoint.tx, room.servicePoint.ty)) fail('service counter is walkable');
  if (room.serviceStand.tx !== room.servicePoint.tx || room.serviceStand.ty !== room.servicePoint.ty + 1) {
    fail('service stand is not just below the counter');
  }
  // 5. threshold seals the bedroom
  const threshold = new Set<string>();
  for (let i = 0; i < room.privateThreshold.w; i++) {
    const tx = room.privateThreshold.tx + i, ty = room.privateThreshold.ty;
    if (!walkable(tx, ty)) fail(`threshold cell ${key(tx, ty)} is solid`);
    threshold.add(key(tx, ty));
  }
  const publicSide = flood(room.spawn, threshold);
  for (const k of allWalkable) {
    if (publicSide.has(k) || threshold.has(k)) {
      const [tx, ty] = k.split(',').map(Number);
      if (publicSide.has(k) && inRect(room.bedroom, tx, ty)) fail(`bedroom tile ${k} is reachable without the threshold`);
      continue;
    }
    const [tx, ty] = k.split(',').map(Number);
    if (!inRect(room.bedroom, tx, ty)) fail(`private tile ${k} lies outside the bedroom`);
  }
  // 6. bed
  const bed = room.bed;
  for (let ty = bed.ty; ty < bed.ty + bed.h; ty++) for (let tx = bed.tx; tx < bed.tx + bed.w; tx++) {
    if (walkable(tx, ty)) fail(`bed cell ${key(tx, ty)} is walkable`);
  }
  const waitTx = bed.tx + 1, waitTy = bed.ty + bed.h;
  if (!walkable(waitTx, waitTy) || !inRect(room.bedroom, waitTx, waitTy)) fail(`bed wait tile ${key(waitTx, waitTy)} is not bedroom floor`);
  // 7. resident route
  const anchor = room.residentRoute;
  const route = flood(anchor, new Set(), (tx, ty) => tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1
    && Math.abs(tx - anchor.tx) + Math.abs(ty - anchor.ty) <= RESIDENT_ROUTE_REACH);
  if (route.size < RESIDENT_ROUTE_MIN_TILES) fail(`resident route has only ${route.size} tiles`);
  for (const k of route) {
    const [tx, ty] = k.split(',').map(Number);
    if (inRect(room.bedroom, tx, ty)) fail(`resident route enters the bedroom at ${k}`);
  }
}

for (const room of Object.values(CIVIC_INTERIORS)) if (room.layout === 'painted') validatePaintedRoom(room);
