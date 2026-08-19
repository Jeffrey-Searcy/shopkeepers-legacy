/**
 * MapDef — data-driven map definitions.
 *
 * Maps are DATA (dimensions + ground grid + spawns/warps/objects/decor/buildings), consumed by
 * BaseWorldScene. A Tiled importer could replace this without touching scene code. Layouts are
 * DESIGNED (paths, clumps, clearings) with deterministic seeded scatter — the same map every run,
 * which the Playwright specs depend on.
 *
 * Coordinates are in TILES.
 */
import { SceneKey } from '../config/AssetKeys';
import { MAP_TILES } from '../config/GameConfig';

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
}

/** A harvestable/interactive object placed on the map. */
export interface ObjectDef {
  kind:
    | 'tree'
    | 'rock'
    | 'weed'
    | 'chest'
    | 'bed'
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
} as const;

/** Fully-resolved map data consumed by BaseWorldScene. */
export interface MapData {
  key: SceneKey;
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
  // The 160px (10-tile) facade is drawn from col 68 through 77. Only the six-by-four wall/plinth
  // mass blocks movement: row 13 is its walkable porch, row 14 its centered steps, and row 15 the
  // safe arrival lane. Collision is authored explicitly rather than inferred from transparent art.
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
      { tx: w - 2, ty: 28, w: 1, h: 6, target: SceneKey.Town, spawn: 'from_farm' },
      // South edge, at the trail's foot -> Cindersap-style forest.
      { tx: 20, ty: h - 1, w: 4, h: 1, target: SceneKey.Forest, spawn: 'from_farm' },
    ],
    objects,
    decor,
    buildings: [],
  };
}

/**
 * The Town: a grassy square with a dirt plaza and the road back to the farm. Building facades and
 * townsfolk were cut (2026-08-06) pending real Sunnyside-pack art — the road/plaza layout stays so
 * they have somewhere to return to.
 */
function buildTown(): MapData {
  const { w, h } = MAP_TILES.town;
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
 * The Forest (south of the Farm — the Cindersap analogue): dense tree thickets around a winding
 * dirt trail that leads from the farm entrance down to a flower-ringed clearing with a small pond.
 * Generous weeds/fiber make it the forage map.
 */
function buildForest(): MapData {
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

/**
 * The Beach (south of the Town): a grass bluff at the top gives way to a wide sand strand and the
 * open ocean along the south. A tidal pool, rock clusters, and driftwood break up the sand.
 */
function buildBeach(): MapData {
  const { w, h } = WORLD_MAP_TILES.beach;
  const rand = lcg(9090);

  // Wavy grass->sand and sand->ocean lines. The design keeps >=2 tiles of sand between grass and
  // water everywhere so every Wang transition is pure (grass<->sand, then sand<->water).
  const grassEdge = (x: number): number =>
    12 + Math.round(Math.sin(x * 0.23) * 2 + Math.sin(x * 0.07) * 1.5);
  const waterEdge = (x: number): number =>
    36 + Math.round(Math.sin(x * 0.19) * 2 + Math.sin(x * 0.31) * 1.3);
  const ground = grid<Ground>(w, h, (x, y) => {
    if (y >= waterEdge(x)) return 'water';
    if (y >= grassEdge(x)) return 'sand';
    return 'grass';
  });
  // Tidal pool: a small ocean-left-behind pool in the western sand.
  for (let y = 25; y <= 30; y++) {
    for (let x = 17; x <= 27; x++) {
      const dx = (x - 22) / 5.2;
      const dy = (y - 27.5) / 2.4;
      if (dx * dx + dy * dy <= 1) ground[y][x] = 'water';
    }
  }
  // Road from the town gate down through the bluff; ends 2+ tiles shy of the sand so dirt never
  // touches sand (their Wang sets are both grass-mediated).
  for (let y = 1; y <= 6; y++) {
    ground[y][40] = 'dirt';
    ground[y][41] = 'dirt';
  }

  const solid = grid(
    w,
    h,
    (x, y) => x === 0 || y === 0 || x === w - 1 || y === h - 1 || ground[y][x] === 'water'
  );

  const reserved = (x: number, y: number): boolean =>
    ground[y][x] === 'dirt' ||
    ground[y][x] === 'water' ||
    (x >= 36 && x <= 45 && y <= 5) || // town gate approach
    (x >= 15 && x <= 29 && y >= 23 && y <= 32); // tidal pool + margin

  const buildable = grid(w, h, () => false);

  const objects: ObjectDef[] = [];
  const occupied = new Set<string>();
  const tryPlace = (kind: ObjectDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    occupied.add(`${tx},${ty}`);
    objects.push({ kind, tx, ty });
  };

  // Rock clusters on the strand (mineable), heaviest around the eastern outcrop landmark.
  for (let c = 0; c < 5; c++) {
    const cx = 8 + Math.floor(rand() * (w - 16));
    const cy = 20 + Math.floor(rand() * 12);
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      tryPlace('rock', cx + Math.floor(rand() * 5) - 2, cy + Math.floor(rand() * 3) - 1);
    }
  }
  for (let i = 0; i < 9; i++) {
    tryPlace('rock', 64 + Math.floor(rand() * 10), 22 + Math.floor(rand() * 8));
  }
  // Sparse weeds on the grass bluff only.
  for (let i = 0; i < 24; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 2 + Math.floor(rand() * 12);
    if (ground[ty][tx] === 'grass') tryPlace('weed', tx, ty);
  }

  // Decor: driftwood + seashells strewn along the shore band, bushes/flowers up on the bluff.
  const decor: DecorDef[] = [];
  const tryDecor = (kind: DecorDef['kind'], tx: number, ty: number): void => {
    if (tx < 2 || ty < 2 || tx >= w - 2 || ty >= h - 2) return;
    if (reserved(tx, ty) || solid[ty][tx] || occupied.has(`${tx},${ty}`)) return;
    occupied.add(`${tx},${ty}`);
    decor.push({ kind, tx, ty });
  };
  for (let i = 0; i < 12; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = waterEdge(3 + Math.floor(rand() * (w - 6))) - 2 - Math.floor(rand() * 4);
    if (ground[ty]?.[tx] === 'sand') tryDecor('driftwood', tx, ty);
  }
  for (let i = 0; i < 16; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 17 + Math.floor(rand() * 16);
    if (ground[ty]?.[tx] === 'sand') tryDecor('seashell', tx, ty);
  }
  for (let i = 0; i < 12; i++) {
    const tx = 3 + Math.floor(rand() * (w - 6));
    const ty = 2 + Math.floor(rand() * 11);
    if (ground[ty][tx] === 'grass') tryDecor(rand() < 0.5 ? 'bush' : 'flowers', tx, ty);
  }

  return {
    key: SceneKey.Beach,
    w,
    h,
    ground,
    solid,
    buildable,
    spawns: [{ id: 'from_town', tx: 40, ty: 2 }],
    warps: [{ tx: 38, ty: 0, w: 6, h: 1, target: SceneKey.Town, spawn: 'from_beach' }],
    objects,
    decor,
    buildings: [],
  };
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

/** Resolve a scene key to its map data. Fail-loud on an unknown key. */
export function getMapData(key: SceneKey): MapData {
  switch (key) {
    case SceneKey.Farm:
      return buildFarm();
    case SceneKey.Town:
      return buildTown();
    case SceneKey.Home:
      return buildHome();
    case SceneKey.Forest:
      return buildForest();
    case SceneKey.Beach:
      return buildBeach();
    case SceneKey.Mountain:
      return buildMountain();
    case SceneKey.Mines:
      return buildMines();
    default:
      throw new Error(`getMapData: no map defined for scene "${key}"`);
  }
}
