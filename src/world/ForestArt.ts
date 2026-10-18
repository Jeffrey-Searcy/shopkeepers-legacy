/**
 * ForestArt — the painted Forest, as plain data.
 *
 * The Forest art (public/assets/forest/*.png, built by scripts/pack-forest-art.py from
 * docs/art-source/forest/forest.png) is 80x70 tiles and is the whole Forest map. This module is the single
 * place that ties the painting to the game:
 *  - FOREST_GRID: the ground and collision of every tile, traced over the painting. MapDef.buildForest turns
 *    it into the map's ground (water for fishing in the pond) and its solid tiles, so what you see is what
 *    you hit. scripts/pack-forest-art.py reads it too: a cleared tree or rock is rebuilt from walkable ground;
 *  - FOREST_ANCHORS: the arrival from the Farm and the Farm warp at the top of the trail, and the arrival
 *    from the Town and the Town warp at the east end of the road;
 *  - FOREST_NODES: the painted trees and rocks that are real resource nodes (chop, mine), plus the weeds.
 *    A tree or rock carries its frame in the node atlas: ResourceNode draws the painted pixels in their
 *    exact painted place, and the backdrop under it is plain ground, so a felled tree or mined rock leaves
 *    nothing behind;
 *  - FOREST_ART: the textures, the lamp post the keeper can walk behind, and the lamp's glow
 *    (PaintedRoomRenderer draws them);
 *  - FOREST_STYLE: tint and glow colours (as painted, with a warm lantern).
 *
 * No Phaser imports at runtime: MapDef and the Playwright specs import this file directly.
 * Coordinates: tiles are map tiles (0..79, 0..69); frames, pieces and lights are art texels (2 per world px).
 */
import { TextureKey } from '../config/AssetKeys';
import type { ObjectDef, PaintedNodeArt } from './MapDef';
import type { PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Size of the painted Forest in tiles (also the Forest map size). */
export const FOREST_TILES = { w: 80, h: 70 } as const;

/**
 * Ground and collision of the painted Forest, one string per tile row:
 *   ',' grass   '=' dirt (the trail from the Farm, the road to Town, the dock, the deer trail)   walkable
 *   '%' solid grass (thicket, tree, bush, fence, log, boulder, ruin wall)   '#' solid dirt (the cave mouth, and dirt
 *   under painted scenery)   '~' water (the pond; solid, and where the keeper fishes)
 * Traced over the painting. Tree and rock FEET are not marked here: they stand on walkable ground and
 * block as resource nodes, so the tile opens when the node is cleared. MapDef checks that every walkable
 * tile connects to the Farm arrival and that every node can be reached.
 * scripts/pack-forest-art.py reads these rows (between the brackets, one quoted row per line).
 */
export const FOREST_GRID: readonly string[] = [
  '%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 0  map edge; the trail (x 20-22) is the Farm warp
  '%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 1
  '%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 2  the Farm arrival (21,2)
  '%%%%%%%%%%%%%%%%%%%%,===%%%%%%%%%%%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%%%%%%%%%', // 3  north-east meadow (x 52-60)
  '%%%%%%%%%%%%%%%%%%%%,,===,%,,,%%%%%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%%%%%%%%%', // 4
  '%%%%%%%%%%%%%%%%%%%%,,====,,,,%%%%%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%%%%%%%%%', // 5
  '%%%%%%%%%%%%%%%%%%%%,,,===,,,,%%%%%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%%%%%%%%%', // 6
  '%%%%%%%%%%%###%%%%%%,,,%===,,,%%%%%%%%%%%%%%%%%%%%%%%%%,,,,,,%%%%%%%%%%%%%%%%%%%', // 7  the cave (x 11-13) is painted scenery and cannot be reached
  '%%%%%%%%%%%%%#%%%%%%,,,%====,,%%%%%%%%%%%%%%%%%%%%%%%%%,%%%%%%%%%%%%%%%%%%%%%%%%', // 8
  '%%%%%%%%%%%%%%#%%%%%,,,%====,,%%%%%%%%%%%%%%%,,,,,,,,,,,,,,,,%%%%%%%%%%%%%%%%%%%', // 9  the meadow path west to the old log
  '%%%%%%%%%%%%%%%%%%%%%%%%====,,,%%%%%%%%%%%%%%,,,,,,,,,,,,,,,,,%%%%%%%%%%%%%%%%%%', // 10
  '%%%%%%%%%%%%%%%%%%%%%%%%===,,,%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%,,,,,,,,%%%%%%%', // 11  east clearing below the ruins (x 64-72)
  '%%%%%%%%%%%%%%%%%%%%%%%====,,,%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%,,,,,,,,%%%%%%%', // 12
  '%%%%%%%%%%%%%%%%%%%%#%%===%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%', // 13
  '%%%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%,,,,,,,,%%%%%%%', // 14
  '%%%%%%%%%%%%%%%%,,,,,,===%%%%%%%%%%%%%%%%,,,,,,%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%', // 15  the west glade (x 16-21)
  '%%%%%%%%%%%%%%%%,,,,,,==,,%%%%%%%%%%%%%%%,,,,,,%%%%%%%%%%%%%%%%%,,,,,,,,%%%%%%%%', // 16
  '%%%%%%%%%%%%%%%%,,,,,===,,%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%%%,,,,,,,,%%%%%%%%', // 17
  '%%%%%%%%%%%%%%%%%%%%%===,,%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%,%%,,,,,,,,%%%%%%%%', // 18  pine T(68,21) and broadleaf T(61,18) stand in the east clearing
  '%%%%%%%%%%%%%%%%%%%%%%==,%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%,%%,,,,,,,,%%%%%%%%', // 19
  '%%%%%%%%%%%%%%%%%%%%%%==,%%%%%%%%%%%%%%%%%%,,%%%%%%%%%%%%%%%,,,,,,,%%%%%%%%%%%%%', // 20
  '%%%%%%%%%%%%%%%%%%%%%%===,%%%%%%%%%%%%%%%%%,,%%%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%', // 21
  '%%%%%%%%%%%%%%%%%%%%%%,==,,%%%%%%%%%%%%%%%%,,%%%%%%%%%%%%%%%,,,,,,,%%%%%%%%%%%%%', // 22
  '%%%%%%%%%%%%%%%%%%%%%%%===,,%%%%%%%%%%%%,,,,,%%%%%%%%%%%%%%%,,,,,,,%%%%%%%%%%%%%', // 23
  '%%%%%%%%%%%,,%%,,,,,,,,,====%,%%%%%%%%%%,,,,,%%%%%%%%%%%,,,,,,,,,,,%%%%%%,,,%%%%', // 24  the bunny clearing (x 11-23) and the deer clearing (x 70-76)
  '%%%%%%%%%%%,,,,,,,,,,,,,%====,,%%%%%%%%%,,,,%%%%%%%%%%%%,,,,%%,%%%%%%%,,,,,,,%%%', // 25
  '%%%%%%%%%%%,,,,,,,,,%%,%%%======%%,,,%%%,,,,%%%%%%%%%%%%,,,,%%%%%%%%%%,,,,,,,%%%', // 26
  '%%%%%%%%%%%,,,,,,%%%%%%%%%%%=========%%%,,,,,,,,,,,,,,,,,,,,%%%%%%%%%%,,,,=,,%%%', // 27  the lamp clearing and the log clearing (x 38-58)
  '%%%%%%%%%%%,,,,,,%%%%%%%%%%%%%%======%%,,,,,,,,,,,,,,,,,,,%%%%%%%%%%%%,,,,,,,%%%', // 28
  '%%%%%%%%%%%%%,%%,,,%%%%%%%%%%%%%%%=====,,,,,,,,,,,,,,,,,,,%%%%%%%%%%%%,,,,,,,%%%', // 29
  '%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%===,,,,,,,,,,,,,,,,,,,,%%%%%%%%%%%%,,,,,,,%%%', // 30
  '%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%==,,,,,,,,,,,,,%%%%%,,,%%%%%%%%%%%,,,,,,,%%%', // 31
  '%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%===,,%%,,,,,,,%%%%%%,,,%%%%%%%%%%,,,,,,,,%%%', // 32
  '%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%===,%%,,,,,,,%%%%%%,,,%%%%%%%%,,,,,,,,,,%%%', // 33
  '%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%====,%,,,,,,,%%%%%%,,,%%%%%%%%%%,,,,,,,,%%%', // 34
  '%%%%%%%%%%%%%%%%,,,,,,%%%%%%%%%%%%%%%====,%%%,,,%,%%%%%,,,%%%%%%%%%%%%,,,,,,%%%%', // 35
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%====,%%%%%%%%%%%%%%,,%%%%%%%%%%%%,,,,,,%%%%', // 36
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%====,%%%%%%%%%%%%%%,,%%%%%%%%%%%%,,,,,,%%%%', // 37
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%====%%%%%%%%%%%%%%%,,%%%%%%%%%%%%,%%==%%%%%', // 38
  '%%%%%%,,,,%%%%%%%%,,,,%%%%%%%%%%%%%%%====,%%%%%%%%%%%%%%,,%%%%%%%%%%%%,,%==%%%%%', // 39  the south-west clearing (x 6-20)
  '%%%%%%,,,,%%%%%%%%,,,,,%%%%%%%%%%%%%%====,%%%%%%%%~~~~%%==%%%%%%%%%%%%%,%==%%%%%', // 40  the pond (x 43-60) and its dock; the little trail up to the deer (x 73-74)
  '%%%%%%,,,,%%%%%%%%,,,,,%%%%%%%%%%%%%,===,%%%%~~~~~~~~~~~==%%%%%%%%%%%%%,%==%%%%%', // 41
  '%%%%%%,,,,,,,,,,,,,%%%%%%%%%%%%%%%%,,===%%%%~%~~~~~~~~~====%%%%%%%%%%%%%,==%%%%%', // 42
  '%%%%%%,,,,,,,,,,,,,,%%%%%%%%%%%%%%%,===%%%%%~~~~~~~~~~~====%%%%%%%%%%%%%%==%%%%%', // 43
  '%%%%%%,,,,,,,,==,,,,%%%%%%%%%%%%%%%,==,%%%%~~~~~~~~~~~~~~~%%%%%%%%%%%%%%%==%%%%%', // 44
  '%%%%%%%%,,,,,=,,,,,,%%%%%%%%%%%%%%%===,%%%%%%%~%~~~~~~~~~~%%%%%%%%%%%%%%%==%%%%%', // 45
  '%%%%%%%%,,,,,,%%%,,%%%%%%%%%%%%%%%%===%%%%%%%%%~~~~~~~~~~~~%%%%%%%%%%%%%%==%%%%%', // 46
  '%%%%%%%%,,,,,,%%%,,%%%%%%%%%%%%%%%%===%%%%%%%%%~%~~~~~~~~~~~~%%%,,,,,,%%%==%%%%%', // 47
  '%%%%%%%%,,,,,,,,,,,%%%%%%%%%%%%%%%%===%%%%%%%%%~~~~~~~~~~%%%%%%%,,,,,,%%%==%%%%%', // 48
  '%%%%%%%%,,,,,,,,,,,%%%%%%%%%%%%%%%%===,%%%%%%%%%~~%%~~~~%%%%%%%%,,,,,,%%%==%%%%%', // 49
  '%%%%%%%%,,,,,,,,,,,,,,%%%%%%%%%%%%%,==,,%%%%,,,,,,,,,~,,,,,%%%%%,,,,,,%%%==%%%%%', // 50
  '%%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%,=====%%,,,,,,,,,,,,,,,%%%%%,,,,,,%%%==%%%%%', // 51
  '%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%,,,,,===========================================', // 52  the road to Town (x 37-79); its east end (x 79, rows 52-54) is the Town warp
  '%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%,,,,,,,=========================================', // 53
  '%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%,,,,,,,,,,,,,====%%%%%%%%===,===%==%%%%%%%=%==%=', // 54
  '%%%%%%%%%%%%%%%%%%,,,,,,,,,%%%%%,,,,%,,,,,,,,,,%%%%%%%%,,,,,,,,%%%%%%%%%%%%%%%%%', // 55  the strip south of the road
  '%%%%%%%%%%%%%%%%%,,,,,,%%%%%%%%%,,,,%%,,,,,,,,,%%%%%%%%,,,,,,,,%%%%%%%%%%%%%%%%%', // 56
  '%%%%%%%%%%%%%%%%%%,,,,,%%%%%%%%%,,,,%%,,,,,,,,,%%%%%%%%,,,,,,,,%%%%%%%%%%%%%%%%%', // 57
  '%%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%,%%,%%%%%%%%%%%%%%%%%%%,%%%%%%%%%%%%%%%%%%', // 58  the south trail (x 18-21)
  '%%%%%%%%%%%%,,,,,,,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%,%%%%%%%%%%%%%%%%%%', // 59
  '%%%%%%%%%%%%%,,,,,,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 60
  '%%%%%%%%%%%%%,,,,,%,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 61
  '%%%%%%%%%%%%%,,,,,%,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 62
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 63
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 64
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 65
  '%%%%%%%%%%%%%%%%%%%,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 66
  '%%%%%%%%%%%%%%%%%%,,,,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 67
  '%%%%%%%%%%%%%%%%%%=%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 68
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', // 69  map edge
];

/** Map tile anchors. */
export const FOREST_ANCHORS = {
  /** Arriving from the Farm: on the trail, two tiles below the warp. */
  fromFarm: { tx: 21, ty: 2 },
  /** The top of the trail: walking off it returns to the Farm's south causeway. */
  farmTrail: { tx: 20, ty: 0, w: 3, h: 1 },
  /** Arriving from the Town: on the road, two tiles inside the east edge. */
  fromTown: { tx: 77, ty: 53 },
  /** The east end of the road: walking off it returns to the Town. */
  townRoad: { tx: 79, ty: 52, w: 1, h: 3 },
} as const;

/** Texels per world pixel of every Forest texture. */
const TEXELS_PER_PIXEL = 2;

/**
 * One painted resource node (see FOREST_NODES).
 * @param kind 'tree' or 'rock'
 * @param tx tile x of the node's foot
 * @param ty tile y of the node's foot
 * @param frame where the node's pixels sit in the atlas (frameX, frameY, w, h) and in the painting (roomX, roomY)
 * @returns the map object, carrying its atlas frame
 */
function node(kind: 'tree' | 'rock', tx: number, ty: number, frame: Omit<PaintedNodeArt, 'texture' | 'texelsPerPixel'>): ObjectDef {
  return { kind, tx, ty, painted: { texture: TextureKey.ForestNodes, texelsPerPixel: TEXELS_PER_PIXEL, ...frame } };
}

/**
 * The Forest's resource nodes.
 * Trees and rocks: the frames are printed by scripts/pack-forest-art.py (its NODES list); keep them in step.
 * The trees at (19,51), (61,10), (68,21), (73,38) and (46,27) are painted pines (config/Trees.ts TREE_SPECIES), so a
 * regrown sapling there is a pine too. Weeds use the game's weed art, spread over the clearings.
 */
export const FOREST_NODES: readonly ObjectDef[] = [
  node('tree', 19, 51, { frameX: 0, frameY: 0, w: 143, h: 231, roomX: 538, roomY: 1434 }),
  node('tree', 61, 10, { frameX: 144, frameY: 0, w: 127, h: 174, roomX: 1892, roomY: 177 }),
  node('tree', 68, 21, { frameX: 272, frameY: 0, w: 140, h: 181, roomX: 2122, roomY: 513 }),
  node('tree', 61, 18, { frameX: 413, frameY: 0, w: 136, h: 163, roomX: 1895, roomY: 462 }),
  node('tree', 73, 38, { frameX: 550, frameY: 0, w: 146, h: 216, roomX: 2289, roomY: 1031 }),
  node('tree', 20, 62, { frameX: 697, frameY: 0, w: 149, h: 211, roomX: 567, roomY: 1806 }),
  node('tree', 46, 27, { frameX: 847, frameY: 0, w: 167, h: 268, roomX: 1386, roomY: 618 }),
  node('tree', 11, 43, { frameX: 0, frameY: 269, w: 96, h: 150, roomX: 318, roomY: 1270 }),
  node('tree', 43, 57, { frameX: 97, frameY: 269, w: 93, h: 133, roomX: 1340, roomY: 1745 }),
  node('rock', 20, 24, { frameX: 191, frameY: 269, w: 90, h: 102, roomX: 601, roomY: 697 }),
  node('rock', 54, 3, { frameX: 282, frameY: 269, w: 66, h: 66, roomX: 1724, roomY: 63 }),
  node('rock', 64, 21, { frameX: 349, frameY: 269, w: 66, h: 69, roomX: 2036, roomY: 628 }),
  node('rock', 73, 13, { frameX: 416, frameY: 269, w: 69, h: 75, roomX: 2330, roomY: 374 }),
  node('rock', 41, 58, { frameX: 486, frameY: 269, w: 69, h: 72, roomX: 1287, roomY: 1809 }),
  node('rock', 71, 41, { frameX: 556, frameY: 269, w: 72, h: 59, roomX: 2239, roomY: 1300 }),
  { kind: 'weed', tx: 59, ty: 5 },
  { kind: 'weed', tx: 27, ty: 6 },
  { kind: 'weed', tx: 19, ty: 16 },
  { kind: 'weed', tx: 70, ty: 16 },
  { kind: 'weed', tx: 61, ty: 21 },
  { kind: 'weed', tx: 41, ty: 24 },
  { kind: 'weed', tx: 75, ty: 26 },
  { kind: 'weed', tx: 53, ty: 28 },
  { kind: 'weed', tx: 47, ty: 29 },
  { kind: 'weed', tx: 40, ty: 30 },
  { kind: 'weed', tx: 72, ty: 30 },
  { kind: 'weed', tx: 57, ty: 33 },
  { kind: 'weed', tx: 19, ty: 36 },
  { kind: 'weed', tx: 7, ty: 40 },
  { kind: 'weed', tx: 17, ty: 43 },
  { kind: 'weed', tx: 9, ty: 45 },
  { kind: 'weed', tx: 16, ty: 49 },
  { kind: 'weed', tx: 21, ty: 54 },
  { kind: 'weed', tx: 38, ty: 54 },
  { kind: 'weed', tx: 14, ty: 61 },
];

/** The Forest's textures, its walk-behind lamp post and the lantern glow (texel coordinates; 2 texels per world px). */
export const FOREST_ART: PaintedRoomArt = {
  backdrop: TextureKey.Forest,
  front: TextureKey.ForestFront,
  widthTexels: 2560,
  heightTexels: 2240,
  texelsPerPixel: TEXELS_PER_PIXEL,
  // The box holds the PIECES shapes in scripts/pack-forest-art.py (it prints it); baseY is where the post meets the ground.
  pieces: [
    { name: 'lamp-post', x: 1180, y: 798, w: 110, h: 113, baseY: 910 },
  ],
  // The candle inside the hanging lantern (measured on forest.png).
  lights: [
    { kind: 'torch', x: 1274, y: 851, size: 28 },
  ],
  animations: [],
  sounds: [],
};

/** The Forest as painted; the lantern burns warm (no brazier here, but the style names every light kind). */
export const FOREST_STYLE: PaintedRoomStyle = { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xffb060 } };
