/**
 * MapDef — data-driven map definitions.
 *
 * Maps are DATA (dimensions + ground grid + spawns/warps/objects/decor/buildings), consumed by
 * BaseWorldScene. A Tiled importer could replace this without touching scene code. Layouts are
 * DESIGNED (paths, clumps, clearings) with deterministic seeded scatter — the same map every run,
 * which the Playwright specs depend on.
 *
 * Coordinates are in TILES.
 * The approved farm is checked-in data compiled from farm-layout-approved.v1.json. The retained
 * deterministic farm builder is migration-only; editing it would invalidate old saves and drafts.
 */
import { SceneKey } from '../config/AssetKeys';
import { MAP_TILES, TILE } from '../config/GameConfig';
import type { ShopOffset } from '../config/Shop';
import { mapEditorMap, mapEditorMode } from '../debug/MapEditorMode';
import type { TownPlan } from './TownPlanning';
import { GUARDHOUSE_BUILDING, TOWN_BUILDINGS, townDoor } from '../config/TownBuildings';
import { civicInteriorMap } from './CivicInteriorMap';
import {
  DUNGEON_MAP_TILES, DUNGEON_ROOMS, DUNGEON_ROOM_IDS, dungeonRoomBounds, type AnyDungeonRoomDef, type TileRect,
} from './DungeonRooms';
import { GATE_PLAZA_ANCHORS, GATE_PLAZA_TILES, GATE_PLAZA_WALK } from './GatePlazaArt';
import { BEACH_ANCHORS, BEACH_GRID, BEACH_NODES, BEACH_TILES } from './BeachArt';
import { FOREST_ANCHORS, FOREST_GRID, FOREST_NODES, FOREST_TILES } from './ForestArt';
import { TOWN_ANCHORS, TOWN_GRID, TOWN_NODES, TOWN_TILES, TOWN_WALL_EDITS } from './TownArt';
import { assertFineWalk, buildFineSolid, type CollisionEdit } from './FineCollision';
import { JAIL_ANCHORS, JAIL_TILES, JAIL_WALK } from './CivicRoomArt';
import tavernMap from './maps/tavern.json' with { type: 'json' };
import bedroomMap from './maps/bedroom.json' with { type: 'json' };
import farmMap from './maps/farm.json' with { type: 'json' };

/** A named spawn point a transition can target (prevents implicit-(0,0) placement). */
export interface SpawnDef {
  id: string;
  tx: number;
  ty: number;
}

/** A warp trigger zone: stepping into it transitions to `target` scene at `spawn`. */
export interface WarpDef {
  tx: number;
  ty: number;
  w: number;
  h: number;
  target: SceneKey;
  spawn: string;
  /** Optional building doorway orientation; requires feet crossing with matching movement intent. */
  doorFacing?: 'north' | 'south';
}

/** A harvestable/interactive object placed on the map. */
export interface ObjectDef {
  kind:
    | 'tree'
    | 'rock'
    | 'weed'
    | 'chest'
    | 'bed'
    // A bed that is part of a painting (the jail cot): no sprite and no body, the walk rows make it
    // solid. It covers (tx, ty) and (tx + 1, ty) for E-to-sleep, like 'bed'.
    | 'painted-bed'
    | 'bin'
    // Interior furniture (Interior 2.0): all solid 1-tile props except the 3-tile counter;
    // 'tv' is also interactive (E = weather forecast).
    | 'table'
    | 'chair'
    | 'kitchen-counter'
    | 'shelf'
    | 'tv';
  tx: number;
  ty: number;
  /**
   * Only on a painted map's trees and rocks: the node's own painted pixels (see PaintedNodeArt). A full tree
   * or a rock then draws this frame; saplings, young trees and stumps keep the game's normal art.
   */
  painted?: PaintedNodeArt;
}

/**
 * Where a painted tree or rock sits in its atlas texture and in the painting it was cut from.
 * ResourceNode draws atlas box (frameX, frameY, w, h) so that its pixels land on painting texels
 * (roomX, roomY) .. (roomX + w, roomY + h), exactly where the artist painted them. All values are texels;
 * texelsPerPixel converts them to world px (2 for every painted map).
 */
export interface PaintedNodeArt {
  /** Texture key of the atlas (e.g. 'beach-nodes'). */
  readonly texture: string;
  readonly frameX: number;
  readonly frameY: number;
  readonly w: number;
  readonly h: number;
  /** Top-left of the frame in the painting (the map's texels, origin at the map's top-left). */
  readonly roomX: number;
  readonly roomY: number;
  readonly texelsPerPixel: number;
}

/**
 * Non-blocking decorative sprite. `kind` doubles as the texture key (BaseWorldScene renders
 * decor via `textures.exists(kind)` and skips silently-missing art, so new kinds only need a
 * manifest entry).
 */
export interface DecorDef {
  kind: 'bush' | 'flowers' | 'driftwood' | 'seashell' | 'mine-ladder' | 'rug';
  tx: number;
  ty: number;
}

/** A large static building facade: sprite bottom-left at (tx,ty); bottom hSolid rows are solid. */
export interface BuildingDef {
  tex: string;
  tx: number;
  ty: number;
  wTiles: number;
  hSolid: number;
}

/**
 * Ground tile types.
 * - grass/dirt/water/floor: the original farm/town/home set.
 * - sand: beach ground (Wang sand↔grass at the grass line, water↔sand at the shoreline).
 * - stone: rocky mountain ground — WALKABLE terrain outdoors; in the Mines it marks solid walls.
 * - cave: mines floor (interior; rendered via the cave↔stone Wang set).
 * - cliff: raised rock wall — ALWAYS solid. Rings the farm/town edges so map boundaries read as
 *   inaccessible Stardew-style cliffs instead of invisible borders (cliff↔grass Wang set).
 */
export type Ground = 'grass' | 'dirt' | 'water' | 'floor' | 'sand' | 'stone' | 'cave' | 'cliff';

/**
 * Carve a cliff ring around a map's edges: converts border-band GRASS tiles to 'cliff' (solid,
 * rendered as a raised rock wall). The band wobbles 2-3 tiles deep via deterministic sines — NOT
 * the map's lcg, so adding the ring never reshuffles the scatter streams below it in a builder.
 *
 * Safety rules baked in (both protect the Wang purity + reachability invariants):
 * - `isOpening(x,y)` tiles are skipped — carve these where roads/warps exit the map so every
 *   boundary crossing reads as a natural trail mouth (and warp tiles never get cliff art).
 * - A tile only becomes cliff if it IS grass and has no dirt/water within 1 tile (8-neighbor),
 *   so cliff only ever borders grass and every transition stays a pure two-terrain Wang pair.
 */
function carveCliffRing(
  ground: Ground[][],
  w: number,
  h: number,
  isOpening: (x: number, y: number) => boolean
): void {
  // 2 or 3 tiles deep, varying organically along the edge (i = position along the edge).
  const wobble = (i: number, phase: number): number =>
    Math.sin(i * 0.47 + phase) + Math.sin(i * 0.13 + phase * 2) > 0.5 ? 3 : 2;
  const nearNonGrass = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const g = ground[y + dy]?.[x + dx];
        if (g === 'dirt' || g === 'water') return true;
      }
    }
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inRing =
        y < wobble(x, 1) || x < wobble(y, 2) || w - 1 - x < wobble(y, 3) || h - 1 - y < wobble(x, 4);
      if (inRing && ground[y][x] === 'grass' && !isOpening(x, y) && !nearNonGrass(x, y)) {
        ground[y][x] = 'cliff';
      }
    }
  }
}

/**
 * Dimensions (in tiles) of the world-expansion maps. Lives here (not GameConfig.MAP_TILES) so the
 * expansion stays contained to world-owned files; specs import these for bounds assertions.
 */
export const WORLD_MAP_TILES = {
  forest: { w: 80, h: 70 },
  beach: { w: 80, h: 50 },
  mountain: { w: 80, h: 60 },
  mines: { w: 50, h: 40 },
  gatePlaza: { w: GATE_PLAZA_TILES.w, h: GATE_PLAZA_TILES.h },
  // The fountain hub and four painted rooms side by side (world/DungeonRooms.ts places them).
  dungeon: DUNGEON_MAP_TILES,
} as const;

/** Fully-resolved map data consumed by BaseWorldScene. */
export interface MapData {
  key: SceneKey;
  /**
   * Bridges and clearing metadata of the hand-built 120x110 Town (TownMap), which only old-save migration and
   * its retired workshop read; the painted Town has none. Never stored in adventure saves.
   */
  townPlan?: TownPlan;
  /** Farm-only translation shared by the facade, porch physics, door, and draft preview. */
  shopOffset?: ShopOffset;
  /** Authored guest-only circulation. Ordinary player collision never uses the stair exit. */
  hospitality?: { stairApproach: { tx: number; ty: number }; stairExit: { tx: number; ty: number } };
  w: number;
  h: number;
  ground: Ground[][];
  solid: boolean[][];
  buildable: boolean[][];
  spawns: SpawnDef[];
  warps: WarpDef[];
  objects: ObjectDef[];
  decor: DecorDef[];
  buildings: BuildingDef[];
  /** Authored circulation/interaction tiles that must stay clear of player-placed furniture. */
  reservedTiles?: Array<{ tx: number; ty: number }>;
  /**
   * Marks an indoor room. 'built': drawn by InteriorRenderer from tiles, with a north wall face of
   * wallHeight native pixels (its rows are authored in solid, not inferred from PNGs). 'painted': the
   * scene draws a painting (PaintedRoomRenderer), so the shared interior art is skipped.
   */
  interior?: { kind: 'built'; wallHeight: number } | { kind: 'painted' };
  /**
   * The keeper's walls at a quarter tile (FineCollision): (h * FINE_PER_TILE) rows of (w * FINE_PER_TILE)
   * cells, true = wall. Only painted outdoor maps whose walls were traced at that step have it; the keeper's
   * physics then uses it in place of the solid tiles. Everything tile-based still reads `solid`.
   */
  fineSolid?: boolean[][];
}

/** Build a w*h grid filled by `fn`. */
function grid<T>(w: number, h: number, fn: (x: number, y: number) => T): T[][] {
  const rows: T[][] = [];
  for (let y = 0; y < h; y++) {
    const row: T[] = [];
    for (let x = 0; x < w; x++) row.push(fn(x, y));
    rows.push(row);
  }
  return rows;
}

/**
 * Small deterministic LCG for map scatter. NOT the gameplay Rng (which is URL-seeded) — map layout
 * must be identical for every run/seed so tests and players see the same world.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * The Farm: grandpa's overgrown plot, laid out after Stardew's Standard Farm
 * (docs/references/Standard_Farm.png):
 * - Inherited Tavern/Inn (solid) top-RIGHT by the town road, with a door warp into the temporary
 *   upstairs sleeping shell and the shipping bin beside it.
 * - A dirt path from the door south to the east-west town road (rows 30-31).
 * - A big lumpy pond south-center + the small fishing pond on the east side.
 * - Debris (trees/rocks/weeds) buries everything outside the reserved clearings.
 */
function buildFarm(): MapData {
  const { w, h } = MAP_TILES.farm;
  const rand = lcg(1337);

  // --- Ground ---
  const ground = grid<Ground>(w, h, () => 'grass');
  // Big pond, south-center (the reference's signature landmark): two overlapping ellipses give a
  // lumpy, natural shoreline instead of a perfect oval.
  for (let y = 74; y <= 87; y++) {
    for (let x = 40; x <= 58; x++) {
      const a = ((x - 47) / 6.5) ** 2 + ((y - 79) / 4.5) ** 2 <= 1;
      const b = ((x - 52) / 5.0) ** 2 + ((y - 83) / 3.5) ** 2 <= 1;
      if (a || b) ground[y][x] = 'water';
    }
  }
  // Fishing pond (ellipse) on the east side. m11/m12 walk row 43 east from x=68 to find the
  // shoreline — this pond must keep covering row 43 there. Do not move it.
  for (let y = 39; y <= 48; y++) {
    for (let x = 68; x <= 81; x++) {
      const dx = (x - 74) / 5.4;
      const dy = (y - 43.5) / 3.8;
      if (dx * dx + dy * dy <= 1) ground[y][x] = 'water';
    }
  }
  // Dirt paths: from the house door (tile 72, row 13) south to the town road, then the road east
  // along rows 30-31 to the Town warp.
  for (let y = 14; y <= 31; y++) {
    ground[y][72] = 'dirt';
    ground[y][73] = 'dirt';
  }
  for (let x = 20; x <= w - 2; x++) {
    ground[30][x] = 'dirt';
    ground[31][x] = 'dirt';
  }
  // Forest trail: south from the east-west road to the south-edge warp.
  for (let y = 32; y < h; y++) {
    ground[y][21] = 'dirt';
    ground[y][22] = 'dirt';
  }

  // Cliff boundary ring (Stardew farm edges): raised rock walls instead of an invisible border.
  // Openings are carved at both exits so they read as trail mouths; the south is mostly lake
  // (water bounds it) and the causeway mouth stays open via the second opening + the built-in
  // dirt/water buffer rule.
  carveCliffRing(
    ground,
    w,
    h,
    (x, y) =>
      (x >= w - 4 && y >= 27 && y <= 34) || // east road to Town (warp x=98, y=28..33)
      (y >= h - 4 && x >= 18 && x <= 25) // south causeway to the Forest (warp x=20..23)
  );

  // --- Solids: border, water, cliffs, and the inherited Tavern wall mass. ---
  const solid = grid(
    w,
    h,
    (x, y) =>
      x === 0 ||
      y === 0 ||
      x === w - 1 ||
      y === h - 1 ||
      ground[y][x] === 'water' ||
      ground[y][x] === 'cliff'
  );
  // The neutral facade uses the same ten-tile envelope. Row13 is the walkable porch; row14 has
  // centered steps. FarmScene adds measured sub-tile post/plinth bodies from config/Shop.ts.
  // Keep the existing wall grid and carve only the authored door warp, independent of art alpha.
  for (let y = 9; y <= 12; y++) {
    for (let x = 69; x <= 76; x++) solid[y][x] = true;
  }

  // --- Reserved zones the scatter must avoid ---
  const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // Only the lawn, the dirt roads (ground-reserved), and a handful of small spec-anchor spots
  // stay clear — day 1 is the reference's "buried farm": everything else may need chopping,
  // mining, or scything to reach. The roads guarantee the town/forest routes never close.
  const reserved = (x: number, y: number): boolean =>
    ground[y][x] !== 'grass' || // paths/water/cliffs/etc.
    inRect(x, y, 66, 5, 82, 19) || // farmstead lawn: house + shipping bin + door approach
    inRect(x, y, 37, 37, 49, 49) || // placement-test / building zone kept clear
    inRect(x, y, 19, 94, 24, 99) || // trail mouth by the Forest warp stays open
    inRect(x, y, 10, 40, 13, 42) || // m4's first-clear-plot scan anchor stays clear
    inRect(x, y, 58, 58, 63, 63) || // m11/m12 item-placement spot (60,60)/(60,61) + margin
    inRect(x, y, 62, 41, 68, 45) || // pond west approach at row 43 (fishing/placement specs)
    inRect(x, y, 54, 59, 56, 61) || // m17 rain-check teleport spot (55,60) stays clear
    inRect(x, y, 52, 77, 56, 79); // south-pond shore stand tiles (m15's fishing teleport)

  // --- Buildable: interior grass away from the house ---
  const buildable = grid(
    w,
    h,
    (x, y) =>
      x > 2 && y > 2 && x < w - 3 && y < h - 3 && ground[y][x] === 'grass' && !inRect(x, y, 68, 6, 82, 15)
  );

  // --- Objects: designed scatter (clumps + singles), deterministic ---
  const objects: ObjectDef[] = [];
  const occupied = new Set<string>();
  /** True if any tile in `set` lies within Chebyshev distance < minDist of (tx,ty). */
  const nearAny = (set: Set<string>, tx: number, ty: number, minDist: number): boolean => {
    for (let dy = 1 - minDist; dy <= minDist - 1; dy++) {
      for (let dx = 1 - minDist; dx <= minDist - 1; dx++) {
        if (set.has(`${tx + dx},${ty + dy}`)) return true;
      }
    }
    return false;
  };
  const tryPlace = (kind: ObjectDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    // Breathing room (the designer's direction): debris gates the land but never stacks — every object
    // keeps min center distance 2 from any other, so no two are adjacent and the player can
    // always weave between them. Density comes from attempt volume, not from packing tighter.
    if (nearAny(occupied, tx, ty, 2)) return;
    occupied.add(`${tx},${ty}`);
    objects.push({ kind, tx, ty });
  };

  // Debris coverage tuned to the Standard_Farm reference: the plot is BURIED in clearable
  // trees/rocks/weeds (spaced, never stacked), and carving paths through it IS the early game.
  // Only the roads (dirt ground), the lawn, and the small spec-anchor spots stay open.
  //
  // Treeline band: a dense inner treeline hugging the cliff ring so the boundary reads as
  // "walled in by nature", thinning toward the interior. Now that the south lake is gone the
  // band wraps the south edge too (the reference's bottom treeline).
  for (let i = 0; i < 700; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 3 + Math.floor(rand() * (h - 8));
    const nearEdge = tx < 12 || tx > w - 13 || ty < 10 || ty > h - 12;
    if (nearEdge && rand() < 0.72) tryPlace('tree', tx, ty);
  }
  // Tree clumps: interior groves scattered across the whole plot.
  for (let c = 0; c < 30; c++) {
    const cx = 6 + Math.floor(rand() * (w - 12));
    const cy = 6 + Math.floor(rand() * 86);
    const count = 5 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      tryPlace('tree', cx + Math.floor(rand() * 7) - 3, cy + Math.floor(rand() * 5) - 2);
    }
  }
  // Rocky outcrop in the south-east (kept: it's the farm's mining landmark)...
  for (let c = 0; c < 5; c++) {
    const cx = 55 + Math.floor(rand() * 34);
    const cy = 52 + Math.floor(rand() * 26);
    const count = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 5) - 2, cy + Math.floor(rand() * 4) - 2);
    }
  }
  // ...plus loose rock clusters strewn across the rest of the plot (Stardew day-1 stones).
  for (let c = 0; c < 20; c++) {
    const cx = 5 + Math.floor(rand() * (w - 10));
    const cy = 5 + Math.floor(rand() * 88);
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 4) - 2, cy + Math.floor(rand() * 3) - 1);
    }
  }
  // Weeds: the overgrown-plot feel, everywhere. (Extra attempts offset spacing rejections.)
  for (let i = 0; i < 550; i++) {
    tryPlace('weed', 3 + Math.floor(rand() * (w - 6)), 3 + Math.floor(rand() * (h - 8)));
  }
  // Saturation fill: after the designed bands/groves, keep throwing mixed debris at the map
  // until the min-distance-2 rule rejects nearly everything. This is what buries the farm like
  // the reference — the spacing rule (not the attempt count) is the density ceiling, so open
  // walking lanes always remain between objects.
  for (let i = 0; i < 3500; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 3 + Math.floor(rand() * (h - 8));
    const r = rand();
    tryPlace(r < 0.34 ? 'tree' : r < 0.6 ? 'rock' : 'weed', tx, ty);
  }
  // The shipping bin beside the house — items dropped in auto-sell at day end (Stardew model).
  // (No pre-placed chest: Stardew farms don't start with one — the player crafts theirs.)
  objects.push({ kind: 'bin', tx: 80, ty: 13 });

  // --- Decor: bushes + flowers (non-blocking life). Same breathing-room rule as the scatter. ---
  const decor: DecorDef[] = [];
  for (let i = 0; i < 50; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 3 + Math.floor(rand() * (h - 8));
    if (!reserved(tx, ty) && !solid[ty][tx] && !nearAny(occupied, tx, ty, 2)) {
      decor.push({ kind: rand() < 0.4 ? 'bush' : 'flowers', tx, ty });
      occupied.add(`${tx},${ty}`);
    }
  }
  // A few flowers by the house.
  decor.push({ kind: 'flowers', tx: 67, ty: 14 }, { kind: 'flowers', tx: 78, ty: 14 });

  return {
    key: SceneKey.Farm,
    shopOffset: { tx: 0, ty: 0 },
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [
      // Day 1 begins below the centered steps, with the full porch in the opening camera frame.
      { id: 'start', tx: 72, ty: 15 },
      { id: 'from_town', tx: 96, ty: 30 },
      // Legacy Home saves and wake-up routes normalize to this safe exterior arrival.
      { id: 'from_home', tx: 72, ty: 15 },
      { id: 'from_forest', tx: 21, ty: 97 },
    ],
    warps: [
      { tx: 72, ty: 12, w: 2, h: 1, target: SceneKey.Tavern, spawn: 'entry', doorFacing: 'north' },
      { tx: w - 2, ty: 28, w: 1, h: 6, target: SceneKey.Town, spawn: 'from_farm' },
      // South edge, at the trail's foot -> Cindersap-style forest.
      { tx: 20, ty: h - 1, w: 4, h: 1, target: SceneKey.Forest, spawn: 'from_farm' },
    ],
    objects,
    decor,
    buildings: [],
    // The porch and the named arrival must stay usable after placing furniture nearby.
    reservedTiles: [
      ...[13, 14].flatMap(ty => Array.from({ length: 8 }, (_, offset) => ({ tx: 69 + offset, ty }))),
      { tx: 72, ty: 15 }, { tx: 73, ty: 15 },
    ],
  };
}

/**
 * Frozen pre-v11 Town geometry. Only save compatibility reads this builder; ordinary Town uses
 * the checked-in workshop underlay and shared TownMap compositor. Never resize or reseed this map.
 */
function buildTown(): MapData {
  // Freeze the pre-v11 geometry: save validation must not reinterpret old coordinates as new terrain.
  const w = 80, h = 60;
  const rand = lcg(4242);

  const ground = grid<Ground>(w, h, () => 'grass');
  // A modest plaza (not a dirt sea) + the road to the west warp.
  for (let y = 25; y <= 36; y++) for (let x = 28; x <= 52; x++) ground[y][x] = 'dirt';
  for (let y = 28; y <= 33; y++) for (let x = 1; x <= 28; x++) ground[y][x] = 'dirt';
  // North road to the Mountain and south road to the Beach.
  for (let y = 1; y <= 25; y++) {
    ground[y][40] = 'dirt';
    ground[y][41] = 'dirt';
  }
  for (let y = 36; y < h; y++) {
    ground[y][40] = 'dirt';
    ground[y][41] = 'dirt';
  }
  // South lane: an east-west side street at row 46 that ties into the Beach road.
  for (let x = 32; x <= 49; x++) ground[46][x] = 'dirt';

  // Cliff boundary ring: the town sits in a rocky basin (Stardew Pelican Town backdrop) — every
  // edge is a raised rock wall except the three road mouths (west to the Farm, north to the
  // Mountain, south to the Beach).
  carveCliffRing(
    ground,
    w,
    h,
    (x, y) =>
      (x < 4 && y >= 26 && y <= 35) || // west road to the Farm (warp x=0, y=28..33)
      (y < 4 && x >= 37 && x <= 44) || // north road to the Mountain (warp x=38..43)
      (y >= h - 4 && x >= 37 && x <= 44) // south road to the Beach (warp x=38..43)
  );

  const solid = grid(
    w,
    h,
    (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1 || ground[y][x] === 'cliff'
  );
  const buildable = grid(
    w,
    h,
    (x, y) => x > 2 && y > 2 && x < w - 3 && y < h - 3 && !solid[y][x]
  );

  // Decor around the plaza: a seeded scatter for life, plus deliberate greenery — bushes flanking
  // the north/south roads and flower beds marking the plaza corners and the south lane.
  const decor: DecorDef[] = [];
  const decorTaken = new Set<string>();
  const tryDecor = (kind: DecorDef['kind'], tx: number, ty: number): void => {
    if (ground[ty]?.[tx] !== 'grass' || solid[ty][tx] || decorTaken.has(`${tx},${ty}`)) return;
    decorTaken.add(`${tx},${ty}`);
    decor.push({ kind, tx, ty });
  };
  for (let i = 0; i < 44; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 3 + Math.floor(rand() * (h - 6));
    tryDecor(rand() < 0.5 ? 'bush' : 'flowers', tx, ty);
  }
  for (let y = 5; y <= 55; y += 4) {
    tryDecor('bush', 38, y);
    tryDecor('bush', 43, y);
  }
  for (const [fx, fy] of [
    [27, 24], [53, 24], [27, 37], [53, 37], // plaza corners
    [36, 38], [45, 38], // plaza's south lip, flanking the road
    [30, 47], [51, 47], // ends of the south lane
  ] as const) {
    tryDecor('flowers', fx, fy);
  }

  return {
    key: SceneKey.Town,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [
      { id: 'from_farm', tx: 3, ty: 30 },
      { id: 'from_mountain', tx: 40, ty: 2 },
      { id: 'from_beach', tx: 40, ty: 57 },
    ],
    warps: [
      { tx: 0, ty: 28, w: 1, h: 6, target: SceneKey.Farm, spawn: 'from_town' },
      // North edge, at the road -> Mountain (lake + mines cave).
      { tx: 38, ty: 0, w: 6, h: 1, target: SceneKey.Mountain, spawn: 'from_town' },
      // South edge, at the road -> Beach.
      { tx: 38, ty: h - 1, w: 6, h: 1, target: SceneKey.Beach, spawn: 'from_town' },
    ],
    objects: [],
    decor,
    buildings: [],
  };
}

/** The temporary upstairs sleeping shell: bed + exit only until the full interior milestone. */
/**
 * The previous farmhouse furnishings were intentionally removed. SceneKey.Home, its named entry,
 * exit warp, and one bed remain as a compatibility shell for sleep, pass-out, knockout, and saves
 * parked indoors. The real Tavern/Inn ground floor and upstairs room are the next design milestone.
 */
function buildHome(): MapData {
  const { w, h } = MAP_TILES.home;
  const ground = grid<Ground>(w, h, () => 'floor');
  // Top wall band is TWO solid rows — the wall art is 2 tiles tall, and a walkable row 1 let the
  // player stand inside the dark wall strip (the designer's "walked up on the black part" bug).
  const solid = grid(w, h, (x, y) => x === 0 || y <= 1 || x === w - 1 || y === h - 1);
  const buildable = grid(w, h, () => false);
  return {
    key: SceneKey.Home,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [{ id: 'entry', tx: Math.floor(w / 2), ty: h - 3 }],
    warps: [{ tx: Math.floor(w / 2), ty: h - 1, w: 2, h: 1, target: SceneKey.Farm, spawn: 'from_home' }],
    objects: [{ kind: 'bed', tx: 3, ty: 3 }],
    decor: [],
    buildings: [],
  };
}

/**
 * The pre-painting Forest (south of the Farm — the Cindersap analogue): dense tree thickets around a winding
 * dirt trail that leads from the farm entrance down to a flower-ringed clearing with a small pond.
 * Generous weeds/fiber made it the forage map. Kept only to check saves made before version 11 (see
 * getLegacyTownRegionMapData); editing it would break those saves. The live Forest is buildForest.
 */
function buildLegacyForest(): MapData {
  const { w, h } = WORLD_MAP_TILES.forest;
  const rand = lcg(7777);

  const ground = grid<Ground>(w, h, () => 'grass');

  // Winding trail: enters at the north (aligned under the farm causeway) and meanders south-east
  // toward the clearing. cx(y) is deterministic so the same trail renders every run.
  const trailX = (y: number): number =>
    17 + Math.round((y / 64) * 30 + Math.sin(y * 0.22) * 5);
  for (let y = 1; y <= 52; y++) {
    const cx = trailX(y);
    ground[y][cx] = 'dirt';
    ground[y][cx + 1] = 'dirt';
  }
  // The trail's final bend: turns east into the clearing's south-west rim.
  for (let x = trailX(52); x <= 46; x++) {
    ground[52][x] = 'dirt';
    ground[53][x] = 'dirt';
  }

  // The clearing: an open glade at the trail's end with a small pond at its heart.
  const inClearing = (x: number, y: number): boolean => {
    const dx = (x - 52) / 9.5;
    const dy = (y - 48) / 6.5;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 44; y <= 51; y++) {
    for (let x = 48; x <= 56; x++) {
      const dx = (x - 52) / 4.2;
      const dy = (y - 47.5) / 2.6;
      if (dx * dx + dy * dy <= 1) ground[y][x] = 'water';
    }
  }

  const solid = grid(
    w,
    h,
    (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1 || ground[y][x] === 'water'
  );

  const nearTrail = (x: number, y: number): boolean =>
    y <= 53 && Math.abs(x - (trailX(Math.max(1, Math.min(52, y))) + 0.5)) <= 2.5;
  const reserved = (x: number, y: number): boolean =>
    ground[y][x] !== 'grass' ||
    nearTrail(x, y) ||
    inClearing(x, y) ||
    (x >= 14 && x <= 22 && y <= 5); // entry area under the farm warp stays open

  const buildable = grid(
    w,
    h,
    (x, y) => x > 2 && y > 2 && x < w - 3 && y < h - 3 && ground[y][x] === 'grass' && !nearTrail(x, y)
  );

  const objects: ObjectDef[] = [];
  const occupied = new Set<string>();
  const tryPlace = (kind: ObjectDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    occupied.add(`${tx},${ty}`);
    objects.push({ kind, tx, ty });
  };

  // Edge thickets: a dense tree band around the whole map reads as deep forest walls.
  for (let i = 0; i < 340; i++) {
    const tx = 2 + Math.floor(rand() * (w - 4));
    const ty = 2 + Math.floor(rand() * (h - 4));
    const nearEdge = tx < 9 || tx > w - 10 || ty < 7 || ty > h - 9;
    if (nearEdge && rand() < 0.75) tryPlace('tree', tx, ty);
  }
  // Interior clumps: dense but with walkable gaps between groves.
  for (let c = 0; c < 22; c++) {
    const cx = 8 + Math.floor(rand() * (w - 16));
    const cy = 6 + Math.floor(rand() * (h - 14));
    const count = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      tryPlace('tree', cx + Math.floor(rand() * 7) - 3, cy + Math.floor(rand() * 5) - 2);
    }
  }
  // Forage: generous weeds; a few rocks under the eastern treeline.
  for (let i = 0; i < 90; i++) {
    tryPlace('weed', 3 + Math.floor(rand() * (w - 6)), 3 + Math.floor(rand() * (h - 6)));
  }
  for (let c = 0; c < 3; c++) {
    const cx = 60 + Math.floor(rand() * 14);
    const cy = 12 + Math.floor(rand() * 30);
    for (let i = 0; i < 4; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 4) - 2, cy + Math.floor(rand() * 3) - 1);
    }
  }

  // Decor: flowers ring the clearing (the landmark); bushes/flowers scattered through the groves.
  const decor: DecorDef[] = [];
  for (let a = 0; a < 14; a++) {
    const ang = (a / 14) * Math.PI * 2;
    const tx = Math.round(52 + Math.cos(ang) * 8);
    const ty = Math.round(48 + Math.sin(ang) * 5.5);
    if (ground[ty][tx] === 'grass' && !occupied.has(`${tx},${ty}`)) {
      decor.push({ kind: 'flowers', tx, ty });
      occupied.add(`${tx},${ty}`);
    }
  }
  for (let i = 0; i < 40; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 3 + Math.floor(rand() * (h - 6));
    if (!reserved(tx, ty) && !solid[ty][tx] && !occupied.has(`${tx},${ty}`)) {
      decor.push({ kind: rand() < 0.45 ? 'bush' : 'flowers', tx, ty });
      occupied.add(`${tx},${ty}`);
    }
  }

  return {
    key: SceneKey.Forest,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [{ id: 'from_farm', tx: 19, ty: 2 }],
    warps: [{ tx: 17, ty: 0, w: 4, h: 1, target: SceneKey.Farm, spawn: 'from_forest' }],
    objects,
    decor,
    buildings: [],
  };
}

/** Ground and solidity of one painted-outdoor grid character. */
type PaintedCell = { ground: Ground; solid: boolean };

/** Ground of each BEACH_GRID character; '#', '%' and '~' are also solid (see BEACH_GRID). */
const BEACH_CELL: Readonly<Record<string, PaintedCell>> = {
  '.': { ground: 'sand', solid: false },
  ',': { ground: 'grass', solid: false },
  '=': { ground: 'dirt', solid: false },
  '#': { ground: 'sand', solid: true },
  '%': { ground: 'grass', solid: true },
  '~': { ground: 'water', solid: true },
};

/** Ground of each FOREST_GRID character; '#', '%' and '~' are also solid (see FOREST_GRID). */
const FOREST_CELL: Readonly<Record<string, PaintedCell>> = {
  ',': { ground: 'grass', solid: false },
  '=': { ground: 'dirt', solid: false },
  '#': { ground: 'dirt', solid: true },
  '%': { ground: 'grass', solid: true },
  '~': { ground: 'water', solid: true },
};

/** Ground of each TOWN_GRID character; '#', '%' and '~' are also solid (see TOWN_GRID). */
const TOWN_CELL: Readonly<Record<string, PaintedCell>> = {
  ',': { ground: 'grass', solid: false },
  '=': { ground: 'dirt', solid: false },
  '#': { ground: 'dirt', solid: true },
  '%': { ground: 'grass', solid: true },
  '~': { ground: 'water', solid: true },
};

/**
 * Everything one painted outdoor map is built from (see buildPaintedOutdoor).
 *  - builder: the calling function's name, the prefix of every error;
 *  - key, tiles: the scene and the painting's size in tiles (must match the map size);
 *  - rows, cells: the traced walk grid and the meaning of each of its characters;
 *  - nodes: the trees, rocks and weeds (painted trees and rocks carry their atlas frame);
 *  - spawns, warps: the arrivals and exits; every spawn and warp tile must be walkable, and the first spawn
 *    is the root that every walkable tile must connect to;
 *  - reserved: tiles kept clear of player-placed furniture and planted trees;
 *  - buildable: tiles a building placement may cover;
 *  - wallEdits: the quarter-tile wall edits (FineCollision) on top of the grid's solid tiles, or null for a map
 *    whose walls are still whole tiles (not yet traced at the finer step).
 */
interface PaintedOutdoorPlan {
  builder: string;
  key: SceneKey;
  tiles: { readonly w: number; readonly h: number };
  rows: readonly string[];
  cells: Readonly<Record<string, PaintedCell>>;
  nodes: readonly ObjectDef[];
  spawns: SpawnDef[];
  warps: WarpDef[];
  reserved: (x: number, y: number, solid: boolean[][]) => boolean;
  buildable: (x: number, y: number, solid: boolean[][]) => boolean;
  wallEdits: readonly CollisionEdit[] | null;
}

/**
 * Build one painted outdoor map (the Beach, the Forest) from its traced grid and its nodes.
 * The whole map is one painting, drawn by its scene through PaintedRoomRenderer; the tile terrain is still
 * built from the ground but hidden under the painting (as on the Gate Plaza).
 * @param plan the map's grid, nodes, anchors and placement rules
 * @returns the map
 * @throws when the grid has the wrong size or a stray character, a node is misplaced or its frame does not
 *   cover its foot, the walkable ground is split (see assertPaintedOutdoorConnected), or the wall edits are
 *   malformed or cut the keeper off from a walkable tile (see FineCollision)
 */
function buildPaintedOutdoor(plan: PaintedOutdoorPlan): MapData {
  const { builder, rows, cells } = plan;
  const { w, h } = plan.tiles;
  const legend = Object.keys(cells);
  if (rows.length !== h || rows.some(row => row.length !== w || [...row].some(cell => !legend.includes(cell)))) {
    throw new Error(`${builder}: the grid must be ${h} rows of ${w} ${legend.map(cell => `'${cell}'`).join(' ')}`);
  }
  const ground = grid<Ground>(w, h, (x, y) => cells[rows[y][x]].ground);
  const solid = grid(w, h, (x, y) => cells[rows[y][x]].solid);
  const objects: ObjectDef[] = plan.nodes.map(obj => ({ ...obj }));
  const seen = new Set<string>();
  for (const obj of objects) {
    const at = `${obj.tx},${obj.ty}`;
    if (obj.kind !== 'tree' && obj.kind !== 'rock' && obj.kind !== 'weed') throw new Error(`${builder}: node ${at} has kind ${obj.kind}`);
    if (seen.has(at)) throw new Error(`${builder}: two nodes at ${at}`);
    seen.add(at);
    if (solid[obj.ty]?.[obj.tx] !== false) throw new Error(`${builder}: node ${at} must stand on walkable ground`);
    if (obj.painted) {
      if (obj.kind === 'weed') throw new Error(`${builder}: weed ${at} cannot carry painted art`);
      // why: the frame must overlap the node's own tile (in painting texels) with the tile's centre column
      // inside it, or the frame was copied for another tile and the painted pixels would land in the wrong
      // place. A rock may end above its tile's bottom edge and a tree's shadow may run below it, so the
      // exact foot point is not required.
      const p = obj.painted, tileSize = TILE * p.texelsPerPixel, footX = (obj.tx + 0.5) * tileSize;
      const tileTop = obj.ty * tileSize, tileBottom = (obj.ty + 1) * tileSize;
      if (footX < p.roomX || footX > p.roomX + p.w || p.roomY >= tileBottom || p.roomY + p.h <= tileTop) {
        throw new Error(`${builder}: painted frame of ${obj.kind} ${at} does not cover its foot`);
      }
    } else if (obj.kind !== 'weed') {
      throw new Error(`${builder}: ${obj.kind} ${at} needs its painted frame (the painting has no hole for normal art)`);
    }
  }
  assertPaintedOutdoorConnected(plan, solid, objects);
  let fineSolid: boolean[][] | undefined;
  if (plan.wallEdits !== null) {
    fineSolid = buildFineSolid(builder, solid, plan.wallEdits);
    // why: the first spawn is the root the tile check above uses too; nodes block as bodies of their own.
    assertFineWalk(builder, fineSolid, solid, new Set(objects.map(obj => `${obj.tx},${obj.ty}`)), plan.spawns[0]);
  }
  const reservedTiles: Array<{ tx: number; ty: number }> = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (plan.reserved(x, y, solid)) reservedTiles.push({ tx: x, ty: y });
  return {
    key: plan.key,
    w,
    h,
    ground,
    solid,
    buildable: grid(w, h, (x, y) => plan.buildable(x, y, solid)),
    spawns: plan.spawns,
    warps: plan.warps,
    objects,
    decor: [],
    buildings: [],
    reservedTiles,
    ...(fineSolid ? { fineSolid } : {}),
  };
}

/**
 * Fail loudly unless every walkable tile of a painted outdoor map (nodes block) connects to its first
 * spawn, every spawn and every warp tile is walkable, and every node has a reachable side to swing a tool from.
 * why: a split grid or an unreachable rock means a tracing mistake, and the player could never get there.
 * @param plan the map's plan (builder name, spawns, warps)
 * @param solid the map's collision
 * @param objects the map's nodes (each blocks its own tile)
 */
function assertPaintedOutdoorConnected(plan: PaintedOutdoorPlan, solid: boolean[][], objects: readonly ObjectDef[]): void {
  const { builder } = plan;
  const blocked = new Set(objects.map(obj => `${obj.tx},${obj.ty}`));
  const isFloor = (x: number, y: number): boolean =>
    y >= 0 && y < solid.length && x >= 0 && x < solid[y].length && !solid[y][x] && !blocked.has(`${x},${y}`);
  for (const spawn of plan.spawns) {
    if (!isFloor(spawn.tx, spawn.ty)) throw new Error(`${builder}: the ${spawn.id} arrival is not walkable`);
  }
  for (const warp of plan.warps) {
    for (let y = warp.ty; y < warp.ty + warp.h; y++) for (let x = warp.tx; x < warp.tx + warp.w; x++) {
      if (!isFloor(x, y)) throw new Error(`${builder}: ${warp.target} warp tile (${x},${y}) is not walkable`);
    }
  }
  const root = plan.spawns[0];
  if (!root) throw new Error(`${builder}: the map needs an arrival`);
  const seen = new Set<string>([`${root.tx},${root.ty}`]);
  const queue: Array<[number, number]> = [[root.tx, root.ty]];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const [x, y] = next;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!isFloor(nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  let floor = 0;
  for (let y = 0; y < solid.length; y++) for (let x = 0; x < solid[y].length; x++) if (isFloor(x, y)) floor++;
  if (seen.size !== floor) throw new Error(`${builder}: the ground is split (${seen.size} of ${floor} tiles reach the ${root.id} arrival)`);
  for (const obj of objects) {
    const sides = [[obj.tx + 1, obj.ty], [obj.tx - 1, obj.ty], [obj.tx, obj.ty + 1], [obj.tx, obj.ty - 1]];
    if (!sides.some(([x, y]) => seen.has(`${x},${y}`))) throw new Error(`${builder}: ${obj.kind} (${obj.tx},${obj.ty}) cannot be reached`);
  }
}

/**
 * The Beach (south of the Town): a meadow along the north with the town path, a sand strand with palms,
 * rocks and a tidal pool, and the sea along the south.
 *
 * The whole map is one painting (BEACH_ART, drawn by BeachScene). Ground and collision come from BEACH_GRID,
 * traced over the painting: sand is where shells wash up, water is where the keeper fishes (and is solid),
 * and cliffs, hedges, palms and driftwood block where they are drawn. The trees, rocks and weeds are
 * BEACH_NODES; the painted ones carry their atlas frame.
 * - the Town warp is the top of the dirt path and returns to the Town's south road ('from_beach').
 * - nothing is buildable.
 * @throws see buildPaintedOutdoor
 */
function buildBeach(): MapData {
  const { w, h } = WORLD_MAP_TILES.beach;
  if (BEACH_TILES.w !== w || BEACH_TILES.h !== h) throw new Error(`buildBeach: BEACH_TILES must be ${w}x${h}`);
  const a = BEACH_ANCHORS;
  return buildPaintedOutdoor({
    builder: 'buildBeach',
    key: SceneKey.Beach,
    tiles: BEACH_TILES,
    rows: BEACH_GRID,
    cells: BEACH_CELL,
    nodes: BEACH_NODES,
    spawns: [{ id: 'from_town', tx: a.fromTown.tx, ty: a.fromTown.ty }],
    warps: [{ ...a.townRoad, target: SceneKey.Town, spawn: 'from_beach' }],
    // why: keep player-placed furniture off the town path and the stairs, and off the sand where the path
    // comes down, so the way home and the way down to the strand can never be walled off.
    reserved: (x, y, solid) => BEACH_GRID[y][x] === '=' || (y === 12 && x >= 39 && x <= 43 && !solid[y][x]),
    buildable: () => false,
    wallEdits: null,
  });
}

/**
 * The Forest (south of the Farm): a dirt trail from the Farm gate in the north down through clearings,
 * a pond with a dock, old ruins and a lamp post, and the road that runs east to the Town.
 *
 * The whole map is one painting (FOREST_ART, drawn by ForestScene). Ground and collision come from
 * FOREST_GRID, traced over the painting: water is the pond (solid, where the keeper fishes), and thickets,
 * trees, bushes, fences, logs and ruin walls block where they are drawn. The trees, rocks and weeds are
 * FOREST_NODES; the painted ones carry their atlas frame.
 * - the Farm warp is the top of the trail and returns to the Farm's south causeway ('from_forest');
 * - the Town warp is the east end of the road and returns to the Town ('from_forest');
 * - open grass is buildable; the dirt (trail, road, dock) is reserved, so the routes can never be walled off.
 * @throws see buildPaintedOutdoor
 */
function buildForest(): MapData {
  const { w, h } = WORLD_MAP_TILES.forest;
  if (FOREST_TILES.w !== w || FOREST_TILES.h !== h) throw new Error(`buildForest: FOREST_TILES must be ${w}x${h}`);
  const a = FOREST_ANCHORS;
  return buildPaintedOutdoor({
    builder: 'buildForest',
    key: SceneKey.Forest,
    tiles: FOREST_TILES,
    rows: FOREST_GRID,
    cells: FOREST_CELL,
    nodes: FOREST_NODES,
    // why: from_farm comes first, so it is the root every walkable tile must connect to (the Farm is home).
    spawns: [{ id: 'from_farm', tx: a.fromFarm.tx, ty: a.fromFarm.ty }, { id: 'from_town', tx: a.fromTown.tx, ty: a.fromTown.ty }],
    warps: [
      { ...a.farmTrail, target: SceneKey.Farm, spawn: 'from_forest' },
      { ...a.townRoad, target: SceneKey.Town, spawn: 'from_forest' },
    ],
    reserved: (x, y) => FOREST_GRID[y][x] === '=',
    buildable: (x, y) => FOREST_GRID[y][x] === ',',
    wallEdits: null,
  });
}

/**
 * The Town (east of the Farm): the plaza and its market stalls in the middle, the river that winds through
 * it, and thirteen painted buildings (the twelve businesses and the watch house) along its roads.
 *
 * The whole map is one painting (TOWN_ART, drawn by TownScene). Ground and collision come from TOWN_GRID,
 * traced over the painting: water is the river (solid, where the keeper fishes), and walls, stalls, lamps,
 * fences, bushes and tree trunks block where they are drawn. TOWN_WALL_EDITS trims those walls to a quarter
 * tile for the keeper (fineSolid). The meadow stones are the one node (TOWN_NODES).
 * - 'start' (Day 1, and where a keeper with no safe spot lands) is the main road just south of the plaza;
 * - the Farm and Forest warps are the west ends of their roads, the Mountain and Beach warps the two ends of
 *   the main road; each returns to that map's 'from_town' arrival;
 * - each building's door is a 2-wide warp into its room (the watch house's leads to the Jail, which TownScene
 *   refuses), and its 'from_<id>' arrival is two tiles below the door (see townDoor);
 * - open grass is buildable; the roads are reserved, so no placed furniture can wall off a door or a road.
 * @throws when TOWN_TILES does not match MAP_TILES.town, and see buildPaintedOutdoor
 */
function buildPaintedTown(): MapData {
  const { w, h } = MAP_TILES.town;
  if (TOWN_TILES.w !== w || TOWN_TILES.h !== h) throw new Error(`buildPaintedTown: TOWN_TILES must be ${w}x${h}`);
  const a = TOWN_ANCHORS;
  const doors = [...TOWN_BUILDINGS, GUARDHOUSE_BUILDING].map(building => ({ building, door: townDoor(building) }));
  return buildPaintedOutdoor({
    builder: 'buildPaintedTown',
    key: SceneKey.Town,
    tiles: TOWN_TILES,
    rows: TOWN_GRID,
    cells: TOWN_CELL,
    nodes: TOWN_NODES,
    // why: 'start' comes first, so it is the root every walkable tile (every door, every road out) must connect to.
    spawns: [
      { id: 'start', tx: a.start.tx, ty: a.start.ty },
      { id: 'from_farm', tx: a.fromFarm.tx, ty: a.fromFarm.ty },
      { id: 'from_forest', tx: a.fromForest.tx, ty: a.fromForest.ty },
      { id: 'from_mountain', tx: a.fromMountain.tx, ty: a.fromMountain.ty },
      { id: 'from_beach', tx: a.fromBeach.tx, ty: a.fromBeach.ty },
      ...doors.map(({ door }) => ({ id: door.returnSpawn, ...door.arrival })),
    ],
    warps: [
      { ...a.farmRoad, target: SceneKey.Farm, spawn: 'from_town' },
      { ...a.forestRoad, target: SceneKey.Forest, spawn: 'from_town' },
      { ...a.mountainRoad, target: SceneKey.Mountain, spawn: 'from_town' },
      { ...a.beachRoad, target: SceneKey.Beach, spawn: 'from_town' },
      ...doors.map(({ building, door }) => ({
        tx: door.doorTx, ty: door.doorTy, w: 2, h: 1, target: building.scene, spawn: 'entry', doorFacing: 'north' as const,
      })),
    ],
    reserved: (x, y) => TOWN_GRID[y][x] === '=',
    buildable: (x, y) => TOWN_GRID[y][x] === ',',
    wallEdits: TOWN_WALL_EDITS,
  });
}

/**
 * The Mountain (north of the Town): rocky highlands. A stone shelf runs along the north with the
 * dark cave mouth into the Mines; a rock-rimmed lake dominates the east; the town road climbs the
 * whole map. Stone ground here is WALKABLE rocky terrain (only water/border/buildings are solid).
 */
function buildMountain(): MapData {
  const { w, h } = WORLD_MAP_TILES.mountain;
  const rand = lcg(5150);

  // North stone shelf with a wavy grass line (kept >=2 tiles from the road's dirt end).
  const stoneEdge = (x: number): number => 12 + Math.round(Math.sin(x * 0.35) * 2);
  const ground = grid<Ground>(w, h, (x, y) => (y <= stoneEdge(x) ? 'stone' : 'grass'));
  // Guarantee solid stone footing under and around the cave mouth.
  for (let y = 0; y <= 13; y++) {
    for (let x = 36; x <= 43; x++) ground[y][x] = 'stone';
  }
  // Scree patch in the south-east: a second stone pocket so the terrain reads varied.
  for (let y = 40; y <= 48; y++) {
    for (let x = 60; x <= 72; x++) {
      const dx = (x - 66) / 6.2;
      const dy = (y - 44) / 4.2;
      if (dx * dx + dy * dy <= 1) ground[y][x] = 'stone';
    }
  }
  // The lake: a broad ellipse in the eastern grass basin (water only ever touches grass).
  const lake = (x: number, y: number): number => {
    const dx = (x - 55) / 11;
    const dy = (y - 29) / 6.2;
    return dx * dx + dy * dy;
  };
  for (let y = 22; y <= 36; y++) {
    for (let x = 43; x <= 67; x++) {
      if (lake(x, y) <= 1) ground[y][x] = 'water';
    }
  }
  // Town road: climbs from the south gate to the stone shelf below the cave (dirt on grass only,
  // stopping 2+ tiles short of stone so dirt<->stone never meet directly).
  for (let y = 17; y < h; y++) {
    if (ground[y][40] === 'grass') ground[y][40] = 'dirt';
    if (ground[y][41] === 'grass') ground[y][41] = 'dirt';
  }

  const solid = grid(
    w,
    h,
    (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1 || ground[y][x] === 'water'
  );

  // The cave mouth facade: the art's stone arch spans EXACTLY 3 tiles (content 49px, rebaked
  // bottom-flush + centered on its 64px canvas, drawn centered on x38..40) so the solid footprint
  // matches the art with no phantom walls. Bottom 2 rows solid; the Mines warp carves the doorway.
  const buildings: BuildingDef[] = [{ tex: 'cave-entrance', tx: 38, ty: 12, wTiles: 3, hSolid: 2 }];
  for (const b of buildings) {
    for (let y = b.ty - b.hSolid + 1; y <= b.ty; y++) {
      for (let x = b.tx; x < b.tx + b.wTiles; x++) solid[y][x] = true;
    }
  }

  const roadX = (x: number): boolean => x >= 39 && x <= 42;
  const reserved = (x: number, y: number): boolean =>
    ground[y][x] === 'dirt' ||
    ground[y][x] === 'water' ||
    lake(x, y) <= 1.45 || // lake rim band is placed by hand below
    (roadX(x) && y >= 14) || // road shoulder
    (x >= 34 && x <= 45 && y >= 8 && y <= 16) || // cave approach + from_mines spawn
    (x >= 36 && x <= 45 && y >= 55); // south gate approach

  const buildable = grid(w, h, () => false);

  const objects: ObjectDef[] = [];
  const occupied = new Set<string>();
  const tryPlace = (kind: ObjectDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    occupied.add(`${tx},${ty}`);
    objects.push({ kind, tx, ty });
  };

  // The stone rim: rocks hand-rung around the lake so it reads "stone-rimmed" while the water
  // itself only borders grass (the water<->grass Wang set stays correct).
  for (let a = 0; a < 26; a++) {
    const ang = (a / 26) * Math.PI * 2;
    const tx = Math.round(55 + Math.cos(ang) * 12.4);
    const ty = Math.round(29 + Math.sin(ang) * 7.4);
    if (
      tx >= 2 && ty >= 2 && tx < w - 2 && ty < h - 2 &&
      ground[ty][tx] === 'grass' && !occupied.has(`${tx},${ty}`) && rand() < 0.72
    ) {
      occupied.add(`${tx},${ty}`);
      objects.push({ kind: 'rock', tx, ty });
    }
  }
  // Rock clusters: heavy on the north shelf and the scree patch (this is the mining overworld).
  for (let c = 0; c < 9; c++) {
    const cx = 4 + Math.floor(rand() * (w - 8));
    const cy = 2 + Math.floor(rand() * 12);
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 5) - 2, cy + Math.floor(rand() * 3) - 1);
    }
  }
  for (let c = 0; c < 4; c++) {
    const cx = 58 + Math.floor(rand() * 14);
    const cy = 40 + Math.floor(rand() * 8);
    for (let i = 0; i < 4; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 4) - 2, cy + Math.floor(rand() * 3) - 1);
    }
  }
  // Hardy trees in sparse clumps on the grass slopes; weeds throughout.
  for (let c = 0; c < 8; c++) {
    const cx = 5 + Math.floor(rand() * (w - 10));
    const cy = 17 + Math.floor(rand() * (h - 22));
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      tryPlace('tree', cx + Math.floor(rand() * 6) - 3, cy + Math.floor(rand() * 4) - 2);
    }
  }
  for (let i = 0; i < 40; i++) {
    tryPlace('weed', 3 + Math.floor(rand() * (w - 6)), 15 + Math.floor(rand() * (h - 18)));
  }

  // Decor: sparse alpine flowers/bushes on grass.
  const decor: DecorDef[] = [];
  for (let i = 0; i < 18; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 15 + Math.floor(rand() * (h - 18));
    if (!reserved(tx, ty) && !solid[ty][tx] && ground[ty][tx] === 'grass' && !occupied.has(`${tx},${ty}`)) {
      decor.push({ kind: rand() < 0.5 ? 'bush' : 'flowers', tx, ty });
      occupied.add(`${tx},${ty}`);
    }
  }

  return {
    key: SceneKey.Mountain,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [
      { id: 'from_town', tx: 40, ty: 57 },
      { id: 'from_mines', tx: 40, ty: 14 },
    ],
    warps: [
      // South edge, at the road -> back to Town.
      { tx: 38, ty: h - 1, w: 6, h: 1, target: SceneKey.Town, spawn: 'from_mountain' },
      // The dark doorway of the cave mouth -> Mines L1.
      { tx: 39, ty: 12, w: 2, h: 1, target: SceneKey.Mines, spawn: 'entrance' },
    ],
    objects,
    decor,
    buildings,
  };
}

/**
 * Mines L1 (interior; the proto-dungeon): stone walls with carved cave-floor chambers. The player
 * enters at a top alcove (ladder back up to the Mountain) and mines a rock-rich cavern system.
 * In this map 'stone' ground = SOLID wall; 'cave' ground = walkable floor.
 */
function buildMines(): MapData {
  const { w, h } = WORLD_MAP_TILES.mines;
  const rand = lcg(2222);

  const ground = grid<Ground>(w, h, () => 'stone');
  const carve = (x: number, y: number): void => {
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) ground[y][x] = 'cave';
  };
  const carveEllipse = (cx: number, cy: number, rx: number, ry: number): void => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) carve(x, y);
      }
    }
  };
  const carveRect = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) carve(x, y);
  };

  carveRect(23, 2, 27, 6); // entrance alcove (holds the exit ladder)
  carveRect(24, 6, 26, 12); // shaft down to the main cavern
  carveEllipse(25, 20, 15, 9); // main cavern
  carveEllipse(9, 30, 6.5, 5); // west chamber
  carveRect(7, 28, 18, 31); // west corridor
  carveEllipse(41, 28, 6, 6); // east chamber
  carveRect(33, 27, 42, 29); // east corridor
  carveEllipse(38, 9, 5, 3.2); // north-east nook
  carveRect(36, 10, 38, 16); // nook corridor

  // Walls are the stone ground itself; the border ring stays stone regardless.
  const solid = grid(w, h, (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1 || ground[y][x] === 'stone');

  const buildable = grid(w, h, () => false);

  const reserved = (x: number, y: number): boolean => x >= 22 && x <= 28 && y <= 7; // entrance stays open

  // Rock-rich floor: this is where the stone economy lives. Clusters plus singles, never sealing
  // a corridor (corridors are 3 wide; clusters land in the open chambers).
  const objects: ObjectDef[] = [];
  const occupied = new Set<string>();
  const tryPlace = (kind: ObjectDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    occupied.add(`${tx},${ty}`);
    objects.push({ kind, tx, ty });
  };
  for (let c = 0; c < 14; c++) {
    const cx = 4 + Math.floor(rand() * (w - 8));
    const cy = 4 + Math.floor(rand() * (h - 8));
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 5) - 2, cy + Math.floor(rand() * 4) - 2);
    }
  }
  for (let i = 0; i < 30; i++) {
    tryPlace('rock', 3 + Math.floor(rand() * (w - 6)), 3 + Math.floor(rand() * (h - 6)));
  }

  return {
    key: SceneKey.Mines,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [{ id: 'entrance', tx: 25, ty: 4 }],
    // The ladder tile at the alcove's top edge climbs back out to the Mountain.
    warps: [{ tx: 25, ty: 2, w: 1, h: 1, target: SceneKey.Mountain, spawn: 'from_mines' }],
    objects,
    decor: [{ kind: 'mine-ladder', tx: 25, ty: 2 }],
    buildings: [],
  };
}

/**
 * The Gate Plaza: the painted ruin beyond the farm's north trail that holds the first portal gate.
 *
 * The whole map is one painting (GATE_PLAZA_ART, drawn by GatePlazaScene through PaintedRoomRenderer),
 * so the tile ground only matters for collision and is plain grass. Solid tiles come from
 * GATE_PLAZA_WALK, traced over the painting, so walls, rocks and pillars block where they are drawn.
 * - the portal warp sits in the painted arch and starts a dungeon run;
 * - the farm warp is the south end of the dirt path and returns to the farm's north trail.
 * @throws when the walk mask has the wrong size or a stray character, or its walkable ground is split
 */
function buildGatePlaza(): MapData {
  const { w, h } = WORLD_MAP_TILES.gatePlaza;
  const walk = GATE_PLAZA_WALK;
  if (walk.length !== h || walk.some(row => row.length !== w || /[^.#]/.test(row))) {
    throw new Error(`buildGatePlaza: GATE_PLAZA_WALK must be ${h} rows of ${w} '.'/'#'`);
  }
  assertGatePlazaConnected();
  const a = GATE_PLAZA_ANCHORS;
  // why: reserve the path, the court and the portal approach (columns 14-20 from the portal down),
  // so player-placed furniture can never block the way to the gate or home.
  const reservedTiles: Array<{ tx: number; ty: number }> = [];
  for (let y = a.portal.ty; y < h; y++) {
    for (let x = 14; x <= 20; x++) if (walk[y][x] === '.') reservedTiles.push({ tx: x, ty: y });
  }
  return {
    key: SceneKey.GatePlaza,
    w,
    h,
    ground: grid<Ground>(w, h, () => 'grass'),
    solid: grid(w, h, (x, y) => walk[y][x] === '#'),
    buildable: grid(w, h, () => false),
    spawns: [
      { id: 'from_farm', tx: a.fromFarm.tx, ty: a.fromFarm.ty },
      { id: 'from_dungeon', tx: a.fromDungeon.tx, ty: a.fromDungeon.ty },
    ],
    warps: [
      { ...a.farmRoad, target: SceneKey.Farm, spawn: 'from_north' },
      { ...a.portal, target: SceneKey.Dungeon, spawn: 'entry' },
    ],
    objects: [],
    decor: [],
    buildings: [],
    reservedTiles,
  };
}

/**
 * Fail loudly unless every walkable plaza tile connects to the farm arrival, and every tile the keeper
 * must reach (arrivals, both warps, the tile north of the signpost, the overflow drops) is walkable.
 * why: an unreachable overflow tile would strand dungeon loot; a split mask means a tracing mistake.
 */
function assertGatePlazaConnected(): void {
  const walk = GATE_PLAZA_WALK;
  const isFloor = (x: number, y: number): boolean =>
    y >= 0 && y < walk.length && x >= 0 && x < walk[y].length && walk[y][x] === '.';
  const a = GATE_PLAZA_ANCHORS;
  const mustBeFloor: Array<readonly [string, number, number]> = [
    ['fromFarm', a.fromFarm.tx, a.fromFarm.ty], ['fromDungeon', a.fromDungeon.tx, a.fromDungeon.ty],
    ['signpost reading tile', a.signpost.tx + 2, a.signpost.ty - 1],
  ];
  for (let i = 0; i < a.portal.w; i++) mustBeFloor.push(['portal', a.portal.tx + i, a.portal.ty]);
  for (let i = 0; i < a.farmRoad.w; i++) mustBeFloor.push(['farmRoad', a.farmRoad.tx + i, a.farmRoad.ty]);
  for (const [x, y] of a.overflow) mustBeFloor.push(['overflow', x, y]);
  for (const [label, x, y] of mustBeFloor) {
    if (!isFloor(x, y)) throw new Error(`buildGatePlaza: plaza anchor ${label} (${x},${y}) is not walkable`);
  }
  for (let i = 0; i < a.signpost.w; i++) {
    if (isFloor(a.signpost.tx + i, a.signpost.ty)) {
      throw new Error(`buildGatePlaza: signpost tile (${a.signpost.tx + i},${a.signpost.ty}) must be solid`);
    }
  }
  const seen = new Set<string>([`${a.fromFarm.tx},${a.fromFarm.ty}`]);
  const queue: Array<[number, number]> = [[a.fromFarm.tx, a.fromFarm.ty]];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const [x, y] = next;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!isFloor(nx, ny) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
  }
  const floor = walk.reduce((sum, row) => sum + [...row].filter(c => c === '.').length, 0);
  if (seen.size !== floor) throw new Error(`buildGatePlaza: plaza ground is split (${seen.size} of ${floor} tiles reach the farm arrival)`);
}

/**
 * The first portal dungeon: the fountain hub and four painted rooms in one map (world/DungeonRooms.ts).
 *
 * Like the Mines, 'stone' is solid wall and 'cave' is walkable floor. Each room's floor comes from its
 * walk mask, traced over its painting, so collision matches what PaintedRoomRenderer draws. The rooms
 * do not touch: DungeonScene moves the keeper between them when they step into a door, following the
 * run's shuffled plan. The map has no static warps, because every way out (the Warden's exit, the escape
 * altar, a knockout) is a scripted choice. The only spawn is 'entry', where the Gate Plaza portal drops
 * the keeper in the hub.
 * @throws when a walk mask has the wrong size or a stray character, rooms overlap or leave the map, or
 *   a room's anchors or floor are broken (assertDungeonRoomSound)
 */
function buildDungeon(): MapData {
  const { w, h } = WORLD_MAP_TILES.dungeon;
  const ground = grid<Ground>(w, h, () => 'stone');
  const claimed = grid(w, h, () => false);
  for (const id of DUNGEON_ROOM_IDS) {
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[id];
    const { walk } = room;
    if (walk.length !== room.tiles.h || walk.some(row => row.length !== room.tiles.w || /[^.#]/.test(row))) {
      throw new Error(`buildDungeon: ${id} walk mask must be ${room.tiles.h} rows of ${room.tiles.w} '.'/'#'`);
    }
    const b = dungeonRoomBounds(id);
    if (b.x0 < 0 || b.y0 < 0 || b.x1 >= w || b.y1 >= h) throw new Error(`buildDungeon: ${id} lies outside the ${w}x${h} map`);
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        if (claimed[y][x]) throw new Error(`buildDungeon: ${id} overlaps another room at (${x},${y})`);
        claimed[y][x] = true;
        if (walk[y - b.y0][x - b.x0] === '.') ground[y][x] = 'cave';
      }
    }
    assertDungeonRoomSound(room);
  }
  const hub = DUNGEON_ROOMS.hub;
  const spawns: SpawnDef[] = [{ id: 'entry', tx: hub.origin.tx + hub.portalArrival.tx, ty: hub.origin.ty + hub.portalArrival.ty }];
  const solid = grid(w, h, (x, y) => ground[y][x] === 'stone');
  return {
    key: SceneKey.Dungeon,
    w,
    h,
    ground,
    solid,
    buildable: grid(w, h, () => false),
    spawns,
    warps: [],
    objects: [],
    decor: [],
    buildings: [],
  };
}

/**
 * Fail loudly unless one room's anchors and floor make sense (room-local tiles):
 *  - every door tile, arrival, the tile beside the altar, the reward row, and the room's special tiles
 *    (portal arrival, the Warden's start, the exit swirl's tiles) are floor;
 *  - every door's arrival is off every door's tiles (or the keeper would bounce straight back);
 *  - a side room's seal covers its far door;
 *  - with the altar solid (it is a physics block) and the far-door corridor walled up, every other
 *    floor tile connects to the room's first arrival, and still does with the corridor open.
 * why: an island of floor would let a monster spawn where the keeper can never reach it.
 * @param room the room to check
 */
function assertDungeonRoomSound(room: AnyDungeonRoomDef): void {
  const { walk, id } = room;
  const isMaskFloor = (x: number, y: number): boolean =>
    y >= 0 && y < walk.length && x >= 0 && x < walk[y].length && walk[y][x] === '.';
  const rectTiles = (r: TileRect): Array<[number, number]> => {
    const tiles: Array<[number, number]> = [];
    for (let y = r.ty; y < r.ty + r.h; y++) for (let x = r.tx; x < r.tx + r.w; x++) tiles.push([x, y]);
    return tiles;
  };
  const mustBeFloor: Array<readonly [string, number, number]> = [];
  for (const door of room.doors) {
    for (const [x, y] of rectTiles(door.tiles)) mustBeFloor.push([`door ${door.id}`, x, y]);
    mustBeFloor.push([`door ${door.id} arrival`, door.arrival.tx, door.arrival.ty]);
    for (const other of room.doors) {
      const t = other.tiles;
      const a = door.arrival;
      if (a.tx >= t.tx && a.tx < t.tx + t.w && a.ty >= t.ty && a.ty < t.ty + t.h) {
        throw new Error(`buildDungeon: ${id} door ${door.id} arrival (${a.tx},${a.ty}) is on door ${other.id}`);
      }
    }
  }
  mustBeFloor.push(['altar', room.altar.tx, room.altar.ty], ['altar use', room.altar.tx + 1, room.altar.ty]);
  for (let i = 0; i < room.reward.w; i++) mustBeFloor.push(['reward', room.reward.tx + i, room.reward.ty]);
  let start: readonly [number, number] = [room.doors[0].arrival.tx, room.doors[0].arrival.ty];
  const sealed = new Set<string>();
  if ('portalArrival' in room) {
    mustBeFloor.push(['portal arrival', room.portalArrival.tx, room.portalArrival.ty]);
    start = [room.portalArrival.tx, room.portalArrival.ty];
  }
  if ('warden' in room) {
    mustBeFloor.push(['warden', room.warden.tx, room.warden.ty]);
    const scale = 1 / room.art.texelsPerPixel / TILE;
    const e = room.exit;
    const ex = Math.floor((e.x + e.frameWidth / 2) * scale), ey = Math.floor((e.y + e.frameHeight / 2) * scale);
    mustBeFloor.push(['exit swirl centre', ex, ey]);
  }
  if ('seal' in room) {
    const far = room.doors.find(door => door.id === 'far');
    if (!far) throw new Error(`buildDungeon: ${id} has a seal but no far door`);
    const sealTiles = rectTiles(room.seal.tiles);
    for (const [x, y] of sealTiles) {
      mustBeFloor.push(['seal', x, y]);
      sealed.add(`${x},${y}`);
    }
    for (const [x, y] of rectTiles(far.tiles)) {
      if (!sealed.has(`${x},${y}`)) throw new Error(`buildDungeon: ${id} seal does not cover far door tile (${x},${y})`);
    }
  }
  for (const [label, x, y] of mustBeFloor) {
    if (!isMaskFloor(x, y)) throw new Error(`buildDungeon: ${id} anchor ${label} (${x},${y}) is not floor`);
  }
  const altarKey = `${room.altar.tx},${room.altar.ty}`;
  for (const sealedOff of [true, false]) {
    const isFloor = (x: number, y: number): boolean =>
      isMaskFloor(x, y) && `${x},${y}` !== altarKey && !(sealedOff && sealed.has(`${x},${y}`));
    const seen = new Set<string>([`${start[0]},${start[1]}`]);
    const queue: Array<[number, number]> = [[start[0], start[1]]];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      const [x, y] = next;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (!isFloor(nx, ny) || seen.has(`${nx},${ny}`)) continue;
        seen.add(`${nx},${ny}`);
        queue.push([nx, ny]);
      }
    }
    let floor = 0;
    for (let y = 0; y < walk.length; y++) for (let x = 0; x < walk[y].length; x++) if (isFloor(x, y)) floor += 1;
    if (seen.size !== floor) {
      throw new Error(`buildDungeon: ${id} floor is split${sealedOff ? ' with the far door walled up' : ''} ` +
        `(${seen.size} of ${floor} tiles reach the arrival)`);
    }
  }
}

/** Return the detached pre-layout farm for explicit save and editor-draft migration only. */
export function getLegacyFarmMapData(): MapData {
  return buildFarm();
}

/** Return detached pre-v11 Town/Forest geometry exclusively for save compatibility checks. */
export function getLegacyTownRegionMapData(key: SceneKey): MapData {
  if (key === SceneKey.Town) return buildTown();
  if (key === SceneKey.Forest) return buildLegacyForest();
  throw new Error(`No legacy Town-region map exists for ${key}`);
}

/**
 * Build the locked watch-house cell from the painted cell's walk rows (CivicRoomArt). It has one painted
 * cot and intentionally has no exit warp: sleeping ends the sentence.
 */
function buildJail(): MapData {
  const { w, h } = JAIL_TILES;
  return {
    key: SceneKey.Jail,
    w,
    h,
    ground: Array.from({ length: h }, () => Array.from({ length: w }, () => 'floor')),
    solid: JAIL_WALK.map(row => [...row].map(cell => cell === '#')),
    buildable: Array.from({ length: h }, () => Array.from({ length: w }, () => false)),
    spawns: [{ id: 'entry', tx: JAIL_ANCHORS.entry.tx, ty: JAIL_ANCHORS.entry.ty }],
    warps: [],
    objects: [{ kind: 'painted-bed', tx: JAIL_ANCHORS.bed.tx, ty: JAIL_ANCHORS.bed.ty }],
    decor: [],
    buildings: [],
    interior: { kind: 'painted' },
    reservedTiles: JAIL_WALK.flatMap((row, ty) => [...row].flatMap((cell, tx) => cell === '.' ? [{ tx, ty }] : [])),
  };
}

/** Resolve untouched authored data; farm.json is the approved layout, never a browser draft. */
export function getAuthoredMapData(key: SceneKey): MapData {
  const civic = TOWN_BUILDINGS.find(building => building.scene === key);
  if (civic) return civicInteriorMap(civic);
  switch (key) {
    case SceneKey.Farm:
      return structuredClone(farmMap) as MapData;
    case SceneKey.Town:
      return buildPaintedTown();
    case SceneKey.Home:
      return buildHome();
    case SceneKey.Tavern:
      // The authored room uses the same MapData pipeline as the existing world. No scatter or
      // gameplay code chooses its layout, and callers receive an independent map instance.
      return structuredClone(tavernMap) as MapData;
    case SceneKey.Bedroom:
      return structuredClone(bedroomMap) as MapData;
    case SceneKey.Forest:
      return buildForest();
    case SceneKey.Beach:
      return buildBeach();
    case SceneKey.Mountain:
      return buildMountain();
    case SceneKey.Mines:
      return buildMines();
    case SceneKey.Jail:
      return buildJail();
    case SceneKey.GatePlaza:
      return buildGatePlaza();
    case SceneKey.Dungeon:
      return buildDungeon();
    default:
      throw new Error(`getMapData: no map defined for scene "${key}"`);
  }
}

/** A detached development preview shared by every ordinary map consumer; never persisted here. */
let farmPreviewMap: MapData | null = null;
/** Install or clear a compiled farm preview in development; callers retain no mutable reference. */
export function setFarmPreviewMap(map: MapData | null): void {
  if (!import.meta.env.DEV || mapEditorMode() !== 'preview' || mapEditorMap() !== 'farm') {
    throw new Error('Farm maps can change only inside a development preview session.');
  }
  if (map !== null && (map.key !== SceneKey.Farm || map.w !== MAP_TILES.farm.w ||
    map.h !== MAP_TILES.farm.h || !map.shopOffset ||
    !Number.isSafeInteger(map.shopOffset.tx) || !Number.isSafeInteger(map.shopOffset.ty))) {
    throw new Error('Farm preview must be a compiled farm map with a valid shop offset.');
  }
  farmPreviewMap = map === null ? null : structuredClone(map);
}

/** Resolve a detached map, using the explicitly installed development draft only for the farm. */
export function getMapData(key: SceneKey): MapData {
  if (key === SceneKey.Farm && farmPreviewMap !== null && mapEditorMode() === 'preview') return structuredClone(farmPreviewMap);
  return getAuthoredMapData(key);
}
