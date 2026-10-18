/**
 * GatePlazaArt — the painted Gate Plaza, as plain data.
 *
 * The plaza art (public/assets/gate-plaza/plaza*.png, built by scripts/pack-gate-plaza-art.py) is
 * 34x17 tiles and is the whole Gate Plaza map. This module is the single place that ties the painting
 * to the game:
 *  - GATE_PLAZA_WALK: which tiles are walkable ('.') and which are ruin, rock, tree, cliff, water or
 *    prop ('#'). MapDef.buildGatePlaza turns it into the map's collision, so what you see is what you hit;
 *  - GATE_PLAZA_ANCHORS: arrivals, the portal and farm warps, the signpost and the overflow tiles;
 *  - GATE_PLAZA_ART: the textures, the tall pieces the keeper can walk behind, the flame glows, the
 *    portal's swirl and its hum (PaintedRoomRenderer draws and plays them);
 *  - GATE_PLAZA_STYLE: tint and glow colours (as painted, with violet portal flames).
 *
 * No Phaser imports at runtime: MapDef, DungeonScene and the Playwright specs import this file directly.
 * Coordinates: tiles are map tiles (0..33, 0..16); pieces and lights are art texels (2 per world px).
 */
import { TextureKey } from '../config/AssetKeys';
import type { PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Size of the painted plaza in tiles (also the Gate Plaza map size). */
export const GATE_PLAZA_TILES = { w: 34, h: 17 } as const;

/**
 * Walkable ground of the painted plaza, one string per tile row, '.' walkable and '#' solid.
 * Traced over the painting: the portal steps (rows 6-8), the paved court with the rune (rows 9-12),
 * the west meadow, and the dirt path south (rows 13-16). Pillar and brazier FEET are solid; the tiles
 * behind a pillar's top are walkable, so the keeper can step behind it (the front pieces then draw
 * over the keeper). MapDef checks that every walkable tile connects to the farm arrival.
 */
export const GATE_PLAZA_WALK: readonly string[] = [
  '##################################', // 0  ruin wall, arch, trees
  '##################################', // 1
  '##################################', // 2  portal arch and banners
  '##################################', // 3
  '##################################', // 4
  '##################################', // 5
  '################...###############', // 6  the portal itself (the dungeon warp)
  '###......######.....##############', // 7  west meadow; portal steps
  '###...###.....#.....##....########', // 8  meadow blocks; behind the pillars; braziers (x 14, 20-21)
  '#.....######............##########', // 9  left pillar foot (x 9-10); right pillar foot (x 24-25)
  '#...#....#..............##########', // 10 the rune row; rocks (x 4)
  '#.....##...##.........############', // 11 sign posts (x 6-7); stone block (x 11-12)
  '#.##..#######.........############', // 12 rocks; sign board, lantern, block (x 6-12)
  '#......###.................#######', // 13 crates (x 7-9); the path widens south
  '##########..............##.#######', // 14 west cliff; rocks (x 24-25)
  '##########.##...........##.#######', // 15 rocks (x 11-12)
  '##########.................#######', // 16 the farm road (the farm warp)
];

/** Map tile anchors (see the file header). */
export const GATE_PLAZA_ANCHORS = {
  /** Arriving from the farm: on the path, facing the gate. */
  fromFarm: { tx: 17, ty: 14 },
  /** Coming home from the dungeon: on the rune in front of the portal. */
  fromDungeon: { tx: 17, ty: 10 },
  /** The painted portal: stepping into it starts a dungeon run. */
  portal: { tx: 16, ty: 6, w: 3, h: 1 },
  /** The south edge of the path: walking off it returns to the farm's north trail. */
  farmRoad: { tx: 16, ty: 16, w: 3, h: 1 },
  /** The signpost (board, posts and lantern): E on any of these tiles reads the dungeon rules. */
  signpost: { tx: 6, ty: 12, w: 5, h: 1 },
  /** Bag items the backpack cannot hold after a run wait here, on the court beside the rune. */
  overflow: [
    [14, 11], [15, 11], [16, 11], [18, 11], [19, 11],
    [14, 12], [15, 12], [16, 12], [18, 12], [19, 12],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

/** The plaza's textures, walk-behind pieces and flame glows (texel coordinates; 2 texels per world px). */
export const GATE_PLAZA_ART: PaintedRoomArt = {
  backdrop: TextureKey.GatePlaza,
  front: TextureKey.GatePlazaFront,
  widthTexels: 1088,
  heightTexels: 544,
  texelsPerPixel: 2,
  // Boxes hold the FRONT_SHAPES polygons in scripts/pack-gate-plaza-art.py; baseY is where each meets the ground.
  pieces: [
    { name: 'brazier-left', x: 437, y: 185, w: 46, h: 97, baseY: 282 },
    { name: 'brazier-right', x: 643, y: 185, w: 47, h: 97, baseY: 282 },
    { name: 'pillar-left', x: 283, y: 175, w: 75, h: 155, baseY: 328 },
    { name: 'pillar-right', x: 757, y: 183, w: 91, h: 163, baseY: 345 },
    { name: 'sign-left-post', x: 199, y: 363, w: 41, h: 49, baseY: 412 },
    { name: 'sign-board', x: 240, y: 354, w: 82, h: 83, baseY: 437 },
    { name: 'sign-lantern', x: 318, y: 364, w: 43, h: 56, baseY: 420 },
  ],
  // Centres are the brightest part of each painted flame (measured on plaza.png).
  lights: [
    { kind: 'brazier', x: 460, y: 213, size: 60 },
    { kind: 'brazier', x: 665, y: 213, size: 60 },
    { kind: 'torch', x: 349, y: 400, size: 28 },
  ],
  // The portal panel inside its stone frame; PORTAL_BOX and PORTAL_FRAMES in scripts/pack-gate-plaza-art.py.
  animations: [
    { name: 'portal-swirl', texture: TextureKey.GatePlazaPortal, x: 519, y: 97, frameWidth: 88, frameHeight: 124, frames: 24, fps: 10 },
  ],
  // The hum carries across the court and is faint where the farm path arrives and silent at the farm road (about 11 tiles away).
  sounds: [
    { kind: 'portal', x: 565, y: 163, radius: 180 },
  ],
};

/** The plaza as painted; the portal braziers burn violet, the lantern warm. */
export const GATE_PLAZA_STYLE: PaintedRoomStyle = { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xb070ff } };
