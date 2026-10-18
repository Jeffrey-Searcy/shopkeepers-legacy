/**
 * BeachArt — the painted Beach, as plain data.
 *
 * The Beach art (public/assets/beach/*.png, built by scripts/pack-beach-art.py from
 * docs/art-source/beach/beach.png) is 80x50 tiles and is the whole Beach map. This module is the single
 * place that ties the painting to the game:
 *  - BEACH_GRID: the ground and collision of every tile, traced over the painting. MapDef.buildBeach turns
 *    it into the map's ground (sand for shells, water for fishing) and its solid tiles, so what you see is
 *    what you hit;
 *  - BEACH_ANCHORS: the arrival from the Town and the Town warp at the top of the path;
 *  - BEACH_NODES: the painted trees and rocks that are real resource nodes (chop, mine), plus the weeds.
 *    A tree or rock carries its frame in the node atlas: ResourceNode draws the painted pixels in their
 *    exact painted place, and the backdrop under it is plain ground, so a felled tree or mined rock leaves
 *    nothing behind;
 *  - BEACH_ART: the textures, the palms and the lamp post the keeper can walk behind, and the lamp's glow
 *    (PaintedRoomRenderer draws them);
 *  - BEACH_STYLE: tint and glow colours (as painted, with a warm lantern).
 *
 * No Phaser imports at runtime: MapDef and the Playwright specs import this file directly.
 * Coordinates: tiles are map tiles (0..79, 0..49); frames, pieces and lights are art texels (2 per world px).
 */
import { TextureKey } from '../config/AssetKeys';
import type { ObjectDef, PaintedNodeArt } from './MapDef';
import type { PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Size of the painted Beach in tiles (also the Beach map size). */
export const BEACH_TILES = { w: 80, h: 50 } as const;

/**
 * Ground and collision of the painted Beach, one string per tile row:
 *   '.' sand   ',' grass   '=' dirt (the town path and the east stairs)   walkable
 *   '#' solid sand (cliff, palm, driftwood, a rock pile in the painting)  '%' solid grass (hedge, tree, cliff)
 *   '~' water (the cave pool, the tidal pool and the sea; solid, and where the keeper fishes)
 * Traced over the painting. Tree and rock FEET are not marked here: they stand on walkable ground and
 * block as resource nodes, so the tile opens when the node is cleared. MapDef checks that every walkable
 * tile connects to the Town arrival and that every node can be reached.
 */
export const BEACH_GRID: readonly string[] = [
  '###################%%%%%%%%%%%%%%######%===####%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%###', // 0  map edge; the town path (x 40-42) is the Town warp
  '%%%%%%%%%%%%%##%%%%,,,,,,,,,,,,,,%%%%%%,===%%%%,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,%%%', // 1  north meadow between the west cliff and the east hedges
  '%%%%%%%%%%%%%##%%%%,,,,,,,,,,,,,,%%%%%%,===,,,,,,,,,,,,,,,,,,,%%%,,,,,,,,,,,,%%%', // 2  fern (x 62-64)
  '%%%%%%%%%%%%%%%,,,,%%%,,,,,,,,%%%##%%%%,===,,%%%,,,,,,,,,,,,,,%%%,,,,,,,,,,,,%%%', // 3
  '%%%%%%%%%%%%%%%,,,,%%%,,,,,%%%%%%##%%%%,===,,%%%,,,,,,,,,,,,,,%%%,%,,,%,,,,,,%%%', // 4
  '%%%%%%%%%%%%%%%,,,,,,,,,,,,,,,%%%%%,,,,,===,,%%%,,,,,,,,,,,,,,,,,,%===#%%%%%%%%%', // 5  stairs down from the east meadow (x 67-69)
  '%%%%%%%%%%%%%%%,,,,,,,,,,,,,,,%%%%%,,,,,===,,%%%,,,,,,,,,,,,%%%%%%%===%%%%%%%%%%', // 6
  '%%%%%%%%.......,,,,,,,,,,,,,,,%%%%%,,,,,===,,,,%%%,,,,%%%%%%%%%%%%%===%%%%%%%%%%', // 7  sand pocket under the west cliff
  '%%%%%%%%.....##,,,,,,,,,,,,,,,,,,,,,,,,,===,,,,%%%,,%%%%%%%%%%%%%%%===%%%%%%%%%%', // 8
  '%%%%%%%~~~...##,,,,,,,,,,,,,,,,,,%%%,,,,===,,,,%%%,,%%%%%%%%%%%%%%%===%%%%%%%%%%', // 9  cave pool (x 7-9)
  '%%%%%%%,.....##%%%%%%%,,,,,,%%%,,%%%,%,,===,%%##%%%%%%%%%###%%%%%%%===%%%%%%%%%%', // 10
  '%%%%%%%%####...%%%%%%%,,,,,,%%%,,%%%,,,,===,%%##%%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%', // 11
  '%%%%%#%%####...##%%%%%%%%#%%#%,,,,,,,,,.....%%##%%###%%#%#..##%%%##....,#%..####', // 12 the path reaches the sand (x 39-43)
  '#######........###################..........##############..............##..####', // 13 the strand
  '#######...........####...#########...........###.#######....................####', // 14
  '#######..................#########...............########......................#', // 15
  '#########......................###...............#######.......................#', // 16
  '#########.................................##...................................#', // 17
  '############........####...................##.##...........####...........##.###', // 18
  '############........####....................####........#######...........######', // 19
  '###########........#####.......................##.......#######........##...####', // 20 west palm and cliff (x 0-10)
  '###########.................######......................#######........####..###', // 21 east palms (x 72-79)
  '###########.................######......................#######.........########', // 22
  '###########.................######......................#######...........######', // 23
  '###########.................####........................####.......###.......###', // 24
  '#########..........~~~~~~~~........................................###.....#.###', // 25 the tidal pool (rows 25-29)
  '#..............###~~~~~~~~~##.....................................##.........###', // 26
  '#..............###~~~~~~~~~##................................................###', // 27
  '#..............####~~~~~~####..................................................#', // 28
  '#.##...........####.~~~~.~~##...........................#............##........#', // 29
  '###....#####.........................~~................##......###.##..##..###.#', // 30
  '#......#####........................~~~~..............##......##..........###..#', // 31
  '#......#####...~~~~~..............~~~~~~~.............#...................#....~', // 32
  '~~.....#####..~~~~~~~~.~~.......~~~~~~~~~............~~~~~~~..................~~', // 33 surf line
  '~~~....#####...~~~~~~~~~~~~~~~~~~~~~~~~~~.........~~~~~~~~~~..........~~~~~~~~~~', // 34
  '~~~~.........~~~~~~~~~~~~~~~~~~~~~~~~~~~~~.......~~~~~~~~~~~~~.......~~~~~~~~~~~', // 35
  '~~~~~......~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~....~~~~~~~~~~~~~~~.....~~~~~~~~~~~~', // 36
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 37 the sea
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 38
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 39
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 40
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 41
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 42
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 43
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 44
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 45
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 46
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 47
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 48
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~', // 49
];

/** Map tile anchors. */
export const BEACH_ANCHORS = {
  /** Arriving from the Town: on the dirt path, two tiles below the warp. */
  fromTown: { tx: 40, ty: 2 },
  /** The top of the path: walking off it returns to the Town's south road. */
  townRoad: { tx: 40, ty: 0, w: 3, h: 1 },
} as const;

/** Texels per world pixel of every Beach texture. */
const TEXELS_PER_PIXEL = 2;

/**
 * One painted resource node (see BEACH_NODES).
 * @param kind 'tree' or 'rock'
 * @param tx tile x of the node's foot
 * @param ty tile y of the node's foot
 * @param frame where the node's pixels sit in the atlas (frameX, frameY, w, h) and in the painting (roomX, roomY)
 * @returns the map object, carrying its atlas frame
 */
function node(kind: 'tree' | 'rock', tx: number, ty: number, frame: Omit<PaintedNodeArt, 'texture' | 'texelsPerPixel'>): ObjectDef {
  return { kind, tx, ty, painted: { texture: TextureKey.BeachNodes, texelsPerPixel: TEXELS_PER_PIXEL, ...frame } };
}

/**
 * The Beach's resource nodes.
 * Trees and rocks: the frames are printed by scripts/pack-beach-art.py (its NODES list); keep them in step.
 * The trees at (24,2) and (74,4) are painted pines (config/Trees.ts TREE_SPECIES), so a regrown sapling there
 * is a pine too. Weeds use the game's weed art on the meadow.
 */
export const BEACH_NODES: readonly ObjectDef[] = [
  node('tree', 24, 11, { frameX: 0, frameY: 0, w: 199, h: 247, roomX: 688, roomY: 157 }),
  node('tree', 24, 2, { frameX: 200, frameY: 0, w: 169, h: 109, roomX: 706, roomY: 0 }),
  node('tree', 51, 6, { frameX: 370, frameY: 0, w: 183, h: 224, roomX: 1555, roomY: 0 }),
  node('tree', 74, 4, { frameX: 554, frameY: 0, w: 161, h: 164, roomX: 2310, roomY: 0 }),
  node('rock', 18, 18, { frameX: 716, frameY: 0, w: 81, h: 66, roomX: 553, roomY: 555 }),
  node('rock', 37, 15, { frameX: 798, frameY: 0, w: 95, h: 65, roomX: 1140, roomY: 454 }),
  node('rock', 68, 3, { frameX: 894, frameY: 0, w: 88, h: 75, roomX: 2144, roomY: 49 }),
  node('rock', 31, 27, { frameX: 0, frameY: 248, w: 61, h: 53, roomX: 987, roomY: 839 }),
  node('rock', 34, 27, { frameX: 62, frameY: 248, w: 65, h: 72, roomX: 1062, roomY: 815 }),
  node('rock', 67, 23, { frameX: 128, frameY: 248, w: 52, h: 55, roomX: 2134, roomY: 701 }),
  node('rock', 69, 22, { frameX: 181, frameY: 248, w: 47, h: 54, roomX: 2198, roomY: 681 }),
  node('rock', 71, 27, { frameX: 229, frameY: 248, w: 82, h: 63, roomX: 2254, roomY: 838 }),
  node('rock', 57, 28, { frameX: 312, frameY: 248, w: 92, h: 65, roomX: 1787, roomY: 857 }),
  node('rock', 54, 29, { frameX: 405, frameY: 248, w: 94, h: 73, roomX: 1692, roomY: 898 }),
  { kind: 'weed', tx: 18, ty: 6 },
  { kind: 'weed', tx: 22, ty: 8 },
  { kind: 'weed', tx: 27, ty: 7 },
  { kind: 'weed', tx: 36, ty: 7 },
  { kind: 'weed', tx: 50, ty: 2 },
  { kind: 'weed', tx: 58, ty: 3 },
  { kind: 'weed', tx: 64, ty: 5 },
  { kind: 'weed', tx: 71, ty: 2 },
];

/** The Beach's textures, walk-behind pieces and the lantern glow (texel coordinates; 2 texels per world px). */
export const BEACH_ART: PaintedRoomArt = {
  backdrop: TextureKey.Beach,
  front: TextureKey.BeachFront,
  widthTexels: 2560,
  heightTexels: 1600,
  texelsPerPixel: TEXELS_PER_PIXEL,
  // Boxes hold the PIECES shapes in scripts/pack-beach-art.py (it prints these); baseY is where each meets the ground.
  pieces: [
    { name: 'palm-west', x: 196, y: 384, w: 184, h: 265, baseY: 646 },
    { name: 'palms-east', x: 2323, y: 452, w: 236, h: 272, baseY: 682 },
    { name: 'lamp-post', x: 1171, y: 221, w: 104, h: 125, baseY: 345 },
  ],
  // The candle inside the hanging lantern (measured on beach.png).
  lights: [
    { kind: 'torch', x: 1253, y: 291, size: 28 },
  ],
  animations: [],
  sounds: [],
};

/** The Beach as painted; the lantern burns warm (no brazier here, but the style names every light kind). */
export const BEACH_STYLE: PaintedRoomStyle = { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xffb060 } };
