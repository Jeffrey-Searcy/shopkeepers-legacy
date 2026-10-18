/**
 * CivicRoomArt — the painted town interiors and the painted watch-house cell, as plain data.
 *
 * Each civic room except the clinic is one hand-painted image (public/assets/civic-interiors/*.png,
 * built by scripts/pack-civic-interiors-art.py) at 32 texels per tile. This module is the single place
 * that ties each painting to the game:
 *  - walk rows: which tiles are walkable ('.') and which are wall, furniture or decor ('#').
 *    CivicInteriorMap turns them into the room's collision, so what you see is what you hit;
 *  - door: the painted entrance opening on the bottom row (the warp back to town);
 *  - anchors: arrival spawn, the service counter and the tile in front of it, the resident's home
 *    route anchor, the heart-gated doorway to the private wing, the bedroom and living-room areas,
 *    and the painted bed (Cuddle waits on the tile just below it);
 *  - art: the texture and its size for PaintedRoomRenderer. Room lighting is not here: InteriorLights
 *    owns the measured lamp, candle and stove positions for each painting.
 * CivicInteriors.ts adds each room's station name and checks every anchor against the walk rows at load.
 *
 * The jail block at the end describes the painted holding cell: its walk rows, the cot, the guard's
 * spot, one cell spot per resident, and a front layer so the iron bars draw over anyone in the cell.
 *
 * No Phaser imports at runtime: MapDef, the scenes and the Playwright specs import this file directly.
 * Coordinates: tiles are map tiles; art pieces are texels (2 texels per world px).
 */
import { TextureKey } from '../config/AssetKeys';
import type { TownBuildingId } from '../config/TownBuildings';
import type { PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Every civic room that shows a painting. The clinic keeps its built (procedural) room. */
export type PaintedCivicId = Exclude<TownBuildingId, 'clinic'>;

/** A whole-tile point. */
export interface TilePoint { readonly tx: number; readonly ty: number }
/** A whole-tile rectangle. */
export interface TileRect extends TilePoint { readonly w: number; readonly h: number }

/**
 * One painted civic room.
 *  - walk: one string per tile row, '.' walkable, '#' solid; size equals the painting (w*32 x h*32 texels);
 *  - door: the painted opening on the bottom row (tx, width); the cells beside it are solid;
 *  - spawn: where the keeper arrives from town, just inside the door;
 *  - service: the solid counter tile the keeper faces to use the room's service; stand is the tile below it;
 *  - resident: the home-route anchor for the resident who lives here (their wander stays near it);
 *  - threshold: the walkable doorway row (h = 1) that seals the private wing; it needs 2 hearts;
 *  - bedroom / livingRoom: the private wing's two areas (the bedroom holds every tile past the threshold);
 *  - bed: the painted bed's solid footprint; Cuddle partners wait at (bed.tx + 1, bed.ty + bed.h).
 */
export interface PaintedCivicRoom {
  readonly walk: readonly string[];
  readonly door: { readonly tx: number; readonly w: number };
  readonly spawn: TilePoint;
  readonly service: TilePoint;
  readonly stand: TilePoint;
  readonly resident: TilePoint;
  readonly threshold: { readonly tx: number; readonly ty: number; readonly w: number };
  readonly bedroom: TileRect;
  readonly livingRoom: TileRect;
  readonly bed: TileRect;
  readonly art: PaintedRoomArt;
}

/** Texels per tile in every civic painting (16 world px per tile, 2 texels per world px). */
const TEXELS_PER_TILE = 32;

/**
 * Build the art record for one flat civic painting: no front layer, no walk-behind pieces, no painted
 * motion or place sounds, and no renderer glows (InteriorLights lights these rooms).
 * @param backdrop texture key of the painting
 * @param w room width in tiles
 * @param h room height in tiles
 */
function flatArt(backdrop: TextureKey, w: number, h: number): PaintedRoomArt {
  return {
    backdrop, front: null, widthTexels: w * TEXELS_PER_TILE, heightTexels: h * TEXELS_PER_TILE, texelsPerPixel: 2,
    pieces: [], lights: [], animations: [], sounds: [],
  };
}

/**
 * Walk rows, traced over each painting. Rows 0-2 (or 0-3) are the back wall. The bottom rows open only
 * at the painted door. The private wing sits on the east side behind the threshold doorway.
 */
const MAGIC_WALK: readonly string[] = [
  '##############################', // 0
  '##############################', // 1
  '##############################', // 2
  '##############################', // 3
  '####.....#....######...#######', // 4
  '####....####..####.....####.##', // 5
  '####....####.................#', // 6
  '####..........###.##.........#', // 7
  '####..###.....#########..#####', // 8
  '####..#####...#########..#####', // 9
  '###########......######..#####', // 10
  '###########.......####...#####', // 11
  '########....#.....##........##', // 12
  '########....##################', // 13
  '########....##################', // 14
  '########....##################', // 15
];

const FORGE_WALK: readonly string[] = [
  '####################################', // 0
  '####################################', // 1
  '####################################', // 2
  '####################################', // 3
  '########################...#########', // 4
  '#########............#.....######.##', // 5
  '####......##......###......##.....##', // 6
  '####.....####.....###..............#', // 7
  '#####....####....####.######..######', // 8
  '#####............####.######..######', // 9
  '#######..........####.######..######', // 10
  '########.........####.######..######', // 11
  '########.........#....######..######', // 12
  '######...............######...######', // 13
  '####....##....##.....###.........###', // 14
  '##########....######################', // 15
  '##########....######################', // 16
  '##########....######################', // 17
];

const MUSEUM_WALK: readonly string[] = [
  '########################################', // 0
  '########################################', // 1
  '########################################', // 2
  '########################################', // 3
  '#.....###...................############', // 4
  '#.##.####.........########......#####.##', // 5
  '#.##.####.........##########....#####.##', // 6
  '####.####....##...##########...........#', // 7
  '####........####.......#####...........#', // 8
  '####........####.......#####...........#', // 9
  '#####.......####......##########..######', // 10
  '#####..###........##..##########..######', // 11
  '#####..###........##..##########..######', // 12
  '###....###..###..........#######..######', // 13
  '###........######........######...######', // 14
  '#.........###..###........#####.......##', // 15
  '#.........................##.........###', // 16
  '############....########################', // 17
  '############....########################', // 18
  '############....########################', // 19
];

const GUILD_WALK: readonly string[] = [
  '##################################', // 0
  '##################################', // 1
  '##################################', // 2
  '##########################....####', // 3
  '###.#####...##############.#######', // 4
  '###........................#######', // 5
  '###......#....#.................##', // 6
  '####....########.....##.........##', // 7
  '####....########......#.........##', // 8
  '####....########...#######...#####', // 9
  '##.......#....#....######........#', // 10
  '###................######....#####', // 11
  '###..............########....#####', // 12
  '####...#......#########..........#', // 13
  '########......#########..........#', // 14
  '########......#########..........#', // 15
  '#########....#####################', // 16
  '##########..######################', // 17
];

const RANCH_WALK: readonly string[] = [
  '####################################', // 0
  '####################################', // 1
  '####################################', // 2
  '#####..######...#####.#####....#####', // 3
  '######.######.#######.#####.########', // 4
  '####.............####.......########', // 5
  '##########.......####..........##.##', // 6
  '#########.............##..........##', // 7
  '#########..............#..........##', // 8
  '#########....####...########..######', // 9
  '#########....####...########..######', // 10
  '#########...........#######....###.#', // 11
  '#########...........#######....###.#', // 12
  '#########..........#####.......###.#', // 13
  '#########..........#####...........#', // 14
  '#########..........#####...........#', // 15
  '##########...#######################', // 16
  '##########...#######################', // 17
];

// why: the strip at x 1-2, rows 8-12 is open floor in the painting; it lets the keeper reach table A's west chair.
const BAR_WALK: readonly string[] = [
  '####################################', // 0
  '####################################', // 1
  '####################################', // 2
  '############################....####', // 3
  '############################.#######', // 4
  '######.##############........#######', // 5
  '####...##############.............##', // 6
  '##......#.#.#.#..#.#....#.........##', // 7
  '#.#.#...........#....####.........##', // 8
  '#.#####.......#####..#######..######', // 9
  '#.####........####...######....#####', // 10
  '#..#............#..#....###....#####', // 11
  '##...###...........###..###....#####', // 12
  '###.#####.........#####.#..........#', // 13
  '###...#............###..#..........#', // 14
  '###.....................#..........#', // 15
  '#########....#######################', // 16
  '#########....#######################', // 17
];

const CARPENTER_WALK: readonly string[] = [
  '####################################', // 0
  '####################################', // 1
  '####################################', // 2
  '###########################....#####', // 3
  '###########################.########', // 4
  '########################....########', // 5
  '###.................####..........##', // 6
  '#####.............................##', // 7
  '#####....#######......##..........##', // 8
  '#####...##########..########..######', // 9
  '#####...##########..#######....###.#', // 10
  '######....##........#######....###.#', // 11
  '######...............######....###.#', // 12
  '######..........########...........#', // 13
  '########........########...........#', // 14
  '#######..............###...........#', // 15
  '#########....#######################', // 16
];

const FISHING_WALK: readonly string[] = [
  '################################', // 0
  '################################', // 1
  '################################', // 2
  '########################....####', // 3
  '######################...#######', // 4
  '######.###############...####.##', // 5
  '####...#######...#####........##', // 6
  '##.............##.............##', // 7
  '###...#.............#####..#####', // 8
  '###...####...#####..####....####', // 9
  '###...####...#####..####....####', // 10
  '####..####...#####..####....####', // 11
  '####...............##..........#', // 12
  '#####.............###..........#', // 13
  '########...#####################', // 14
  '########...#####################', // 15
];

const ALCHEMY_WALK: readonly string[] = [
  '##################################', // 0
  '##################################', // 1
  '##################################', // 2
  '##########################...#####', // 3
  '#######################....#######', // 4
  '#######################....####.##', // 5
  '####....########................##', // 6
  '####...............####.........##', // 7
  '####...##......#...####.........##', // 8
  '####...##......#...#######..######', // 9
  '#####......##.....#######....#####', // 10
  '#####................####....#####', // 11
  '###....##......#...######....#####', // 12
  '#####..............####..........#', // 13
  '#####.............#####..........#', // 14
  '###................####..........#', // 15
  '#########...######################', // 16
  '#########...######################', // 17
];

const TAILOR_WALK: readonly string[] = [
  '################################', // 0
  '################################', // 1
  '################################', // 2
  '########################....####', // 3
  '######################...#######', // 4
  '######################...####..#', // 5
  '#####...#######..#####.........#', // 6
  '####....#######................#', // 7
  '####....##.......#####.........#', // 8
  '####...########..########..#####', // 9
  '####...########..#######...#####', // 10
  '####..#########..#######...#####', // 11
  '####...########...###..........#', // 12
  '####.............####..........#', // 13
  '####.............####..........#', // 14
  '########...#####################', // 15
  '########...#####################', // 16
];

const MARKET_WALK: readonly string[] = [
  '##################################', // 0
  '##################################', // 1
  '##################################', // 2
  '##################################', // 3
  '###########...#####.##....########', // 4
  '###########.........##....########', // 5
  '####.......................###.###', // 6
  '####............................##', // 7
  '##.#####.......####.##..........##', // 8
  '#..#####.......####.######..######', // 9
  '#..#####.......####.######..######', // 10
  '##...............##.######..######', // 11
  '####................####.....#####', // 12
  '####...##....##.....####.......###', // 13
  '####...###..###.....##.........###', // 14
  '##########..######################', // 15
  '##########..######################', // 16
];

/** Shorthand for the anchor records below. */
const p = (tx: number, ty: number): TilePoint => ({ tx, ty });
const r = (tx: number, ty: number, w: number, h: number): TileRect => ({ tx, ty, w, h });

/** Every painted civic room. The anchors are checked against the walk rows in CivicInteriors.ts. */
export const CIVIC_ROOM_ART: Readonly<Record<PaintedCivicId, PaintedCivicRoom>> = {
  magic: {
    walk: MAGIC_WALK, door: { tx: 8, w: 4 }, spawn: p(9, 13), service: p(9, 6), stand: p(9, 7), resident: p(12, 7),
    threshold: { tx: 23, ty: 8, w: 2 }, bedroom: r(20, 9, 9, 4), livingRoom: r(20, 4, 9, 4), bed: r(20, 9, 2, 3),
    art: flatArt(TextureKey.CivicInteriorMagic, 30, 16),
  },
  forge: {
    walk: FORGE_WALK, door: { tx: 10, w: 4 }, spawn: p(12, 15), service: p(11, 8), stand: p(11, 9), resident: p(14, 10),
    threshold: { tx: 28, ty: 10, w: 2 }, bedroom: r(24, 11, 11, 4), livingRoom: r(24, 4, 11, 4), bed: r(24, 11, 3, 3),
    art: flatArt(TextureKey.CivicInteriorForge, 36, 18),
  },
  museum: {
    walk: MUSEUM_WALK, door: { tx: 12, w: 4 }, spawn: p(13, 16), service: p(13, 14), stand: p(13, 15), resident: p(10, 9),
    threshold: { tx: 32, ty: 10, w: 2 }, bedroom: r(28, 11, 11, 6), livingRoom: r(28, 3, 11, 7), bed: r(28, 11, 3, 5),
    art: flatArt(TextureKey.CivicInteriorMuseum, 40, 20),
  },
  guild: {
    walk: GUILD_WALK, door: { tx: 10, w: 2 }, spawn: p(10, 15), service: p(15, 4), stand: p(15, 5), resident: p(12, 12),
    threshold: { tx: 26, ty: 9, w: 3 }, bedroom: r(23, 10, 10, 6), livingRoom: r(23, 3, 9, 6), bed: r(23, 10, 2, 3),
    art: flatArt(TextureKey.CivicInteriorGuild, 34, 18),
  },
  ranch: {
    walk: RANCH_WALK, door: { tx: 10, w: 3 }, spawn: p(11, 15), service: p(14, 10), stand: p(14, 11), resident: p(11, 12),
    threshold: { tx: 28, ty: 10, w: 2 }, bedroom: r(24, 11, 11, 5), livingRoom: r(24, 3, 10, 6), bed: r(24, 11, 3, 2),
    art: flatArt(TextureKey.CivicInteriorRanch, 36, 18),
  },
  bar: {
    walk: BAR_WALK, door: { tx: 9, w: 4 }, spawn: p(10, 15), service: p(16, 6), stand: p(16, 7), resident: p(11, 11),
    threshold: { tx: 28, ty: 9, w: 2 }, bedroom: r(25, 10, 10, 6), livingRoom: r(25, 3, 9, 6), bed: r(25, 10, 2, 3),
    art: flatArt(TextureKey.CivicInteriorBar, 36, 18),
  },
  carpenter: {
    walk: CARPENTER_WALK, door: { tx: 9, w: 4 }, spawn: p(11, 15), service: p(13, 10), stand: p(13, 11), resident: p(14, 12),
    threshold: { tx: 28, ty: 9, w: 2 }, bedroom: r(24, 10, 11, 6), livingRoom: r(24, 3, 10, 6), bed: r(24, 10, 3, 3),
    art: flatArt(TextureKey.CivicInteriorCarpenter, 36, 17),
  },
  fishing: {
    walk: FISHING_WALK, door: { tx: 8, w: 3 }, spawn: p(9, 13), service: p(10, 6), stand: p(10, 7), resident: p(11, 12),
    threshold: { tx: 25, ty: 8, w: 2 }, bedroom: r(21, 9, 10, 5), livingRoom: r(22, 3, 8, 5), bed: r(21, 9, 3, 3),
    art: flatArt(TextureKey.CivicInteriorFishing, 32, 16),
  },
  alchemy: {
    walk: ALCHEMY_WALK, door: { tx: 9, w: 3 }, spawn: p(10, 14), service: p(11, 6), stand: p(11, 7), resident: p(12, 8),
    threshold: { tx: 26, ty: 9, w: 2 }, bedroom: r(23, 10, 10, 6), livingRoom: r(23, 3, 9, 6), bed: r(23, 10, 2, 3),
    art: flatArt(TextureKey.CivicInteriorAlchemy, 34, 18),
  },
  tailor: {
    walk: TAILOR_WALK, door: { tx: 8, w: 3 }, spawn: p(9, 13), service: p(10, 7), stand: p(10, 8), resident: p(16, 10),
    threshold: { tx: 25, ty: 9, w: 2 }, bedroom: r(21, 10, 10, 5), livingRoom: r(22, 3, 9, 6), bed: r(21, 10, 3, 2),
    art: flatArt(TextureKey.CivicInteriorTailor, 32, 17),
  },
  market: {
    walk: MARKET_WALK, door: { tx: 10, w: 2 }, spawn: p(10, 13), service: p(7, 5), stand: p(7, 6), resident: p(13, 7),
    threshold: { tx: 26, ty: 10, w: 2 }, bedroom: r(22, 11, 11, 4), livingRoom: r(22, 4, 11, 5), bed: r(22, 12, 2, 2),
    art: flatArt(TextureKey.CivicInteriorMarket, 34, 17),
  },
};

/** Civic paintings show as painted, with warm flame glows (unused today: InteriorLights lights the rooms). */
export const CIVIC_ROOM_STYLE: PaintedRoomStyle = { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xff9a3c } };

/** Size of the painted watch-house cell room in tiles (also the Jail map size). */
export const JAIL_TILES = { w: 18, h: 12 } as const;

/**
 * Walkable floor of the locked cell. Row 5 is the strip beside the cot and the bucket, row 6 the cell
 * middle, row 7 the floor just inside the front bars. Everything outside the bars is solid: the keeper
 * never leaves the cell (sleeping ends the sentence).
 */
export const JAIL_WALK: readonly string[] = [
  '##################', // 0  back wall, lanterns, banners
  '##################', // 1
  '##################', // 2  cell back bars and window
  '##################', // 3
  '##################', // 4  cot head, stool, bucket
  '#######....#######', // 5  beside the cot (x 7-10); bucket (x 11-12)
  '#######......#####', // 6  cell middle; the cot is x 5-6
  '#####........#####', // 7  inside the front bars (x 5-12)
  '##################', // 8  front bars
  '##################', // 9  watch-room floor and rug (outside the cell)
  '##################', // 10
  '##################', // 11
];

/**
 * Jail anchors (tiles):
 *  - entry: where the keeper arrives when arrested;
 *  - bed: left cell of the painted cot (a 2x1 'painted-bed'); the keeper sleeps from (5, 7) facing up;
 *  - guard: Captain Maren's post outside the bars, east of the cell;
 *  - slots: one spot per jailed resident, filled in TOWN_RESIDENTS order among the residents jailed today.
 *    There are 14 (every resident), and none is on row 7 west of x 10, so the keeper's walk from the
 *    entry to the cot stays clear however many residents share the cell. The last spot sits on the cot.
 */
export const JAIL_ANCHORS = {
  entry: p(9, 7),
  bed: p(5, 6),
  guard: p(15, 6),
  slots: [
    p(7, 6), p(8, 6), p(9, 6), p(10, 6), p(11, 6), p(12, 6),
    p(7, 5), p(8, 5), p(9, 5), p(10, 5),
    p(10, 7), p(11, 7), p(12, 7),
    p(6, 6),
  ] as readonly TilePoint[],
} as const;

/** The cell painting plus its front layer: the iron bars, drawn over anyone standing in the cell. */
export const JAIL_ART: PaintedRoomArt = {
  backdrop: TextureKey.CivicInteriorJail,
  front: TextureKey.CivicInteriorJailFront,
  widthTexels: JAIL_TILES.w * TEXELS_PER_TILE,
  heightTexels: JAIL_TILES.h * TEXELS_PER_TILE,
  texelsPerPixel: 2,
  // why: baseY 274 is the foot of the front bars (row 8.55), below every cell tile, so the whole cage draws over the cell.
  pieces: [{ name: 'cell-bars', x: 136, y: 73, w: 291, h: 195, baseY: 274 }],
  lights: [], animations: [], sounds: [],
};

/**
 * Check the jail data once at load: the walk rows match the painting, the entry, the sleep tile and every
 * slot are walkable (except the cot slot, which is the cot), slots are unique, and the keeper can walk from
 * the entry to the sleep tile while every slot is taken.
 */
function validateJail(): void {
  const { w, h } = JAIL_TILES;
  if (JAIL_WALK.length !== h || JAIL_WALK.some(row => row.length !== w || /[^.#]/.test(row))) {
    throw new Error('CivicRoomArt: jail walk rows do not match the 18x12 painting');
  }
  const walkable = (t: TilePoint): boolean => JAIL_WALK[t.ty]?.[t.tx] === '.';
  const sleepTile = p(JAIL_ANCHORS.bed.tx, JAIL_ANCHORS.bed.ty + 1);
  for (const cell of [JAIL_ANCHORS.bed, p(JAIL_ANCHORS.bed.tx + 1, JAIL_ANCHORS.bed.ty)]) {
    if (walkable(cell)) throw new Error(`CivicRoomArt: jail cot cell ${cell.tx},${cell.ty} must be solid`);
  }
  if (!walkable(JAIL_ANCHORS.entry) || !walkable(sleepTile)) throw new Error('CivicRoomArt: jail entry or sleep tile is solid');
  const taken = new Set<string>();
  for (const slot of JAIL_ANCHORS.slots) {
    const key = `${slot.tx},${slot.ty}`;
    if (taken.has(key)) throw new Error(`CivicRoomArt: jail slot ${key} is listed twice`);
    taken.add(key);
    const onCot = slot.ty === JAIL_ANCHORS.bed.ty && (slot.tx === JAIL_ANCHORS.bed.tx || slot.tx === JAIL_ANCHORS.bed.tx + 1);
    if (!onCot && !walkable(slot)) throw new Error(`CivicRoomArt: jail slot ${key} is solid`);
  }
  // Flood from the entry with every slot blocked: the sleep tile must still be reachable.
  const seen = new Set([`${JAIL_ANCHORS.entry.tx},${JAIL_ANCHORS.entry.ty}`]);
  const queue: TilePoint[] = [JAIL_ANCHORS.entry];
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i];
    for (const next of [p(tx + 1, ty), p(tx - 1, ty), p(tx, ty + 1), p(tx, ty - 1)]) {
      const key = `${next.tx},${next.ty}`;
      if (!walkable(next) || taken.has(key) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  if (!seen.has(`${sleepTile.tx},${sleepTile.ty}`)) throw new Error('CivicRoomArt: a full cell would block the keeper from the cot');
}
validateJail();
