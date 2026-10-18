/**
 * DungeonRooms — the first portal dungeon's five painted rooms and how a run links them, as plain data.
 *
 * The art (public/assets/dungeon-rooms/*, built by scripts/pack-dungeon-rooms-art.py) is five paintings:
 *  - the hub: the fountain hall the portal drops the keeper into (48x32 tiles), with three doors
 *    (left, right, bottom);
 *  - three side rooms (36x26 tiles each): the crystal cave, the moon library and the old sewer. Each has
 *    a way in (back to the hub) and a far door;
 *  - the Warden's lava pit (36x26 tiles), reached up the far door of ONE side room.
 * Every run shuffles them (planDungeonRun): the hub's three doors lead to the three side rooms in a
 * random order, and the Warden's stair sits behind a random side room's far door. The other two far
 * doors are walled up (each side room has a seal patch painted from its own doorframe stone).
 *
 * This module is the single place that ties the paintings to the game:
 *  - each room's walk mask ('.' floor, '#' wall, pillar, liquid or prop). MapDef turns it into ground
 *    and collision, so the walls you see are the walls you hit;
 *  - each room's doors, arrival tiles, escape altar, reward row (and the Warden's start and the exit swirl);
 *  - each room's PaintedRoomArt (textures, walk-behind pieces, flame glows, liquid animations, place
 *    sounds) and style;
 *  - where the rooms sit in the one dungeon map (DUNGEON_MAP_TILES, dungeonRoomBounds).
 *
 * No Phaser imports at runtime: MapDef and the Playwright specs import this file directly.
 * Coordinates: tiles are room-local unless a name says otherwise; art boxes and lights are texels
 * (2 per world px, 32 per tile).
 */
import { TextureKey } from '../config/AssetKeys';
import type { Facing } from '../state/GameState';
import type { PaintedAnimation, PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Every room of the dungeon. */
export type DungeonRoomId = 'hub' | 'cave' | 'library' | 'sewer' | 'boss';
/** The three rooms the hub's doors shuffle between. */
export type SideRoomId = 'cave' | 'library' | 'sewer';
/** The hub's three doors. */
export type HubDoorId = 'left' | 'right' | 'bottom';
/** Every door id: the hub's three, and each other room's way in (towards the hub) and far door. */
export type DoorId = HubDoorId | 'way-in' | 'far';

export const SIDE_ROOM_IDS: readonly SideRoomId[] = ['cave', 'library', 'sewer'];
export const HUB_DOOR_IDS: readonly HubDoorId[] = ['left', 'right', 'bottom'];

/** A rectangle of tiles (room-local). */
export interface TileRect {
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
}

/** Where the keeper stands, and which way they face, after arriving in a room (room-local tile). */
export interface Arrival {
  readonly tx: number;
  readonly ty: number;
  readonly facing: Facing;
}

/**
 * One door of a room.
 * tiles: the door's mouth; the keeper's feet on any of these tiles go through it.
 * arrival: where the keeper appears when coming INTO this room through this door (a few steps inside,
 * so they do not walk straight back out).
 */
export interface DungeonDoor {
  readonly id: DoorId;
  readonly tiles: TileRect;
  readonly arrival: Arrival;
}

/**
 * A walled-up far door: tiles are the corridor behind the doorway (made solid while sealed);
 * texture, x, y: the patch of doorframe stone laid over the painted doorway (texels).
 */
export interface DoorSeal {
  readonly tiles: TileRect;
  readonly texture: string;
  readonly x: number;
  readonly y: number;
}

/** What every room has. */
export interface DungeonRoomDef {
  readonly id: DungeonRoomId;
  /** Toast shown on entry. */
  readonly title: string;
  /** Room size in tiles (the painting's size / 32). */
  readonly tiles: { readonly w: number; readonly h: number };
  /** Top-left tile of the room in the dungeon map. */
  readonly origin: { readonly tx: number; readonly ty: number };
  /** One string per tile row, '.' floor and '#' solid; traced over the painting. */
  readonly walk: readonly string[];
  readonly doors: readonly DungeonDoor[];
  /** The escape altar's tile; the keeper uses it from the tile to its right, facing left. */
  readonly altar: { readonly tx: number; readonly ty: number };
  /** The clear reward drops along this row, left to right, at most w items. */
  readonly reward: { readonly tx: number; readonly ty: number; readonly w: number };
  readonly art: PaintedRoomArt;
  readonly style: PaintedRoomStyle;
}

/** The hub: where the portal drops the keeper. */
export interface DungeonHubDef extends DungeonRoomDef {
  readonly portalArrival: Arrival;
}

/** A side room: its far door leads up to the Warden or is walled up. */
export interface DungeonSideRoomDef extends DungeonRoomDef {
  readonly seal: DoorSeal;
}

/** The Warden's pit. */
export interface DungeonBossRoomDef extends DungeonRoomDef {
  /** The Warden's start (centre of this tile). */
  readonly warden: { readonly tx: number; readonly ty: number };
  /** The way home that opens on the rune's eye once the Warden falls (a looping swirl). */
  readonly exit: PaintedAnimation;
}

/**
 * Any one room, as a union so `'seal' in room`, `'warden' in room` and `'portalArrival' in room` narrow
 * it to the matching room kind.
 */
export type AnyDungeonRoomDef = DungeonHubDef | DungeonSideRoomDef | DungeonBossRoomDef;

/** Size of the whole dungeon map in tiles: the hub, then the four other rooms, two solid tiles apart. */
export const DUNGEON_MAP_TILES = { w: 200, h: 32 } as const;

/** Torch and brazier glow sizes in world px (a candle is a small torch). */
const TORCH = 44, CANDLE = 28, BRAZIER = 60;

const HUB: DungeonHubDef = {
  id: 'hub',
  title: 'The Fountain Hall',
  tiles: { w: 48, h: 32 },
  origin: { tx: 0, ty: 0 },
  // The fountain court (rows 9-26). Pillar feet, the fountain and its pool, statues and urns are solid;
  // the tiles behind the two left pillars' tops are floor (the front pieces draw over the keeper there).
  walk: [
    '################################################', // 0  void and back wall
    '################################################', // 1
    '################################################', // 2
    '################################################', // 3
    '################################################', // 4
    '################################################', // 5
    '################################################', // 6
    '################################################', // 7
    '############...#################################', // 8
    '##########.......############......####.########', // 9  the altar alcove (left); back of the right wing
    '##########.......#############........#...######', // 10
    '#####.####.......#############.............#####', // 11
    '#####............###################.......#####', // 12
    '####...........#####################........####', // 13 the left door (x 4) and right door (x 43)
    '####.........#######################........####', // 14
    '#####........##..###################.......#####', // 15 left pillar foot (x 13-14)
    '##########.......###################...#########', // 16 the fountain pool fills the middle
    '##########.......###################...#########', // 17
    '##########.......###################...#########', // 18
    '##########.......###################...#########', // 19
    '##########.........####....#...........#########', // 20
    '##########........###.................##########', // 21
    '##########........###.................##########', // 22 the portal drops the keeper here (x 24)
    '#############.......................############', // 23 the reward row
    '#############......................#############', // 24
    '#############......................#############', // 25
    '#############.....#####...###......#############', // 26
    '#######################...######################', // 27 the bottom door (x 23-25)
    '################################################', // 28
    '################################################', // 29
    '################################################', // 30
    '################################################', // 31
  ],
  doors: [
    { id: 'left', tiles: { tx: 4, ty: 13, w: 1, h: 2 }, arrival: { tx: 6, ty: 13, facing: 'right' } },
    { id: 'right', tiles: { tx: 43, ty: 13, w: 1, h: 2 }, arrival: { tx: 41, ty: 13, facing: 'left' } },
    { id: 'bottom', tiles: { tx: 23, ty: 27, w: 3, h: 1 }, arrival: { tx: 24, ty: 25, facing: 'up' } },
  ],
  portalArrival: { tx: 24, ty: 22, facing: 'down' },
  altar: { tx: 10, ty: 9 },
  reward: { tx: 23, ty: 23, w: 3 },
  art: {
    backdrop: TextureKey.DungeonHub,
    front: TextureKey.DungeonHubFront,
    widthTexels: 1536,
    heightTexels: 1024,
    texelsPerPixel: 2,
    // Boxes hold the FRONT_SHAPES polygons in scripts/pack-dungeon-rooms-art.py; baseY is where each meets the floor.
    pieces: [
      { name: 'pillar-left', x: 398, y: 349, w: 85, h: 160, baseY: 509 },
      { name: 'pillar-bottom-left', x: 330, y: 644, w: 83, h: 157, baseY: 801 },
    ],
    // Centres are the brightest part of each painted flame (measured on hub.png).
    lights: [
      { kind: 'torch', x: 527, y: 198, size: TORCH },
      { kind: 'torch', x: 1008, y: 198, size: TORCH },
      { kind: 'torch', x: 136, y: 420, size: TORCH },
      { kind: 'torch', x: 1397, y: 420, size: TORCH },
      { kind: 'torch', x: 659, y: 840, size: TORCH },
      { kind: 'torch', x: 877, y: 838, size: TORCH },
      { kind: 'torch', x: 269, y: 680, size: CANDLE },
      { kind: 'torch', x: 1248, y: 700, size: CANDLE },
    ],
    // Boxes and frame sizes as printed by scripts/pack-dungeon-rooms-art.py.
    animations: [
      { name: 'fall', texture: TextureKey.DungeonHubFall, x: 736, y: 176, frameWidth: 68, frameHeight: 124, frames: 8, fps: 10 },
      { name: 'pool', texture: TextureKey.DungeonHubPool, x: 566, y: 296, frameWidth: 544, frameHeight: 320, frames: 8, fps: 6 },
    ],
    // The fountain trickles across the court; the fall behind it rushes nearer the back wall.
    sounds: [
      { kind: 'fountain', x: 850, y: 470, radius: 260 },
      { kind: 'waterfall', x: 770, y: 238, radius: 200 },
    ],
  },
  style: { tint: 0xffffff, glow: { torch: 0xffa040, brazier: 0xffa040 } },
};

const CAVE: DungeonSideRoomDef = {
  id: 'cave',
  title: 'Crystal Cave',
  tiles: { w: 36, h: 26 },
  origin: { tx: 50, ty: 0 },
  // Ledges between the falls; the blue water and the crystal clusters are solid.
  walk: [
    '####################################', // 0
    '####################################', // 1
    '####################################', // 2
    '#################..#################', // 3  the far door's corridor (x 17-18, rows 3-6)
    '#################..#################', // 4
    '#################..#################', // 5
    '#################..#################', // 6
    '############...........#############', // 7
    '#######......#.........#############', // 8
    '########......######################', // 9
    '########......######################', // 10
    '#####.........##########.###########', // 11 the altar ledge (x 5)
    '#####.........#########........#####', // 12
    '##########.#.............#.....#..##', // 13 the way in (x 33, rows 13-14)
    '##########...............#........##', // 14 the reward row (x 26-28)
    '##########...##########.........####', // 15
    '##########################..########', // 16 the campfire path down
    '#########################...########', // 17
    '#########################...########', // 18
    '#########################...########', // 19
    '#########################...########', // 20
    '####################################', // 21
    '####################################', // 22
    '####################################', // 23
    '####################################', // 24
    '####################################', // 25
  ],
  doors: [
    { id: 'way-in', tiles: { tx: 33, ty: 13, w: 1, h: 2 }, arrival: { tx: 30, ty: 14, facing: 'left' } },
    { id: 'far', tiles: { tx: 17, ty: 3, w: 2, h: 1 }, arrival: { tx: 17, ty: 8, facing: 'down' } },
  ],
  seal: { tiles: { tx: 17, ty: 3, w: 2, h: 4 }, texture: TextureKey.DungeonCaveSeal, x: 540, y: 90 },
  altar: { tx: 5, ty: 11 },
  reward: { tx: 26, ty: 14, w: 3 },
  art: {
    backdrop: TextureKey.DungeonCave,
    front: null,
    widthTexels: 1152,
    heightTexels: 832,
    texelsPerPixel: 2,
    pieces: [],
    lights: [
      { kind: 'torch', x: 204, y: 258, size: TORCH },
      { kind: 'torch', x: 669, y: 190, size: TORCH },
      { kind: 'torch', x: 1014, y: 367, size: TORCH },
      { kind: 'brazier', x: 940, y: 600, size: BRAZIER },
    ],
    animations: [
      { name: 'fall-right', texture: TextureKey.DungeonCaveFallRight, x: 846, y: 140, frameWidth: 54, frameHeight: 150, frames: 8, fps: 10 },
      { name: 'pool-right', texture: TextureKey.DungeonCavePoolRight, x: 796, y: 256, frameWidth: 172, frameHeight: 116, frames: 8, fps: 6 },
      { name: 'fall-mid', texture: TextureKey.DungeonCaveFallMid, x: 556, y: 326, frameWidth: 60, frameHeight: 274, frames: 8, fps: 10 },
      { name: 'fall-left', texture: TextureKey.DungeonCaveFallLeft, x: 140, y: 456, frameWidth: 48, frameHeight: 84, frames: 8, fps: 10 },
    ],
    sounds: [
      { kind: 'waterfall', x: 586, y: 463, radius: 220 },
      { kind: 'waterfall', x: 873, y: 215, radius: 180 },
    ],
  },
  // The campfire (a brazier light) burns orange; torches warm.
  style: { tint: 0xffffff, glow: { torch: 0xffb070, brazier: 0xff9a40 } },
};

const LIBRARY: DungeonSideRoomDef = {
  id: 'library',
  title: 'Moon Library',
  tiles: { w: 36, h: 26 },
  origin: { tx: 88, ty: 0 },
  // Aisles between the shelves; shelves, desks and the moon pedestal are solid.
  walk: [
    '####################################', // 0
    '####################################', // 1
    '####################################', // 2
    '#################..#################', // 3  the far door's corridor (x 17-18, rows 3-7)
    '#################..#################', // 4
    '#################..#################', // 5
    '#################..#################', // 6
    '#################..#################', // 7
    '###############......###############', // 8
    '######..######.......###############', // 9
    '######..######..........######..####', // 10
    '######..######..........######..####', // 11
    '#####...#................#####.#####', // 12
    '#####..........................#####', // 13
    '########........................####', // 14 the reward row (x 16-18)
    '########..................#####.####', // 15
    '########..................##########', // 16
    '#####...................############', // 17 the altar nook (x 5)
    '##########..............############', // 18
    '############.####..####.############', // 19
    '############.####..####.........####', // 20
    '#################..#################', // 21 the way in (x 17-18)
    '####################################', // 22
    '####################################', // 23
    '####################################', // 24
    '####################################', // 25
  ],
  doors: [
    { id: 'way-in', tiles: { tx: 17, ty: 21, w: 2, h: 1 }, arrival: { tx: 17, ty: 18, facing: 'up' } },
    { id: 'far', tiles: { tx: 17, ty: 3, w: 2, h: 1 }, arrival: { tx: 17, ty: 9, facing: 'down' } },
  ],
  seal: { tiles: { tx: 17, ty: 3, w: 2, h: 5 }, texture: TextureKey.DungeonLibrarySeal, x: 538, y: 88 },
  altar: { tx: 5, ty: 17 },
  reward: { tx: 16, ty: 14, w: 3 },
  art: {
    backdrop: TextureKey.DungeonLibrary,
    front: null,
    widthTexels: 1152,
    heightTexels: 832,
    texelsPerPixel: 2,
    pieces: [],
    lights: [
      { kind: 'torch', x: 451, y: 201, size: TORCH },
      { kind: 'torch', x: 699, y: 201, size: TORCH },
      { kind: 'torch', x: 153, y: 402, size: TORCH },
      { kind: 'torch', x: 1001, y: 400, size: TORCH },
      { kind: 'torch', x: 466, y: 632, size: TORCH },
      { kind: 'torch', x: 684, y: 632, size: TORCH },
    ],
    animations: [],
    sounds: [],
  },
  style: { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xffb060 } },
};

const SEWER: DungeonSideRoomDef = {
  id: 'sewer',
  title: 'Old Sewer',
  tiles: { w: 36, h: 26 },
  origin: { tx: 126, ty: 0 },
  // Walkways between the sludge channels; the sludge, grates and barrels are solid.
  walk: [
    '####################################', // 0
    '####################################', // 1
    '####################################', // 2
    '#################..#################', // 3  the far door's corridor (x 17-18, rows 3-5)
    '#################..#################', // 4
    '#################..#################', // 5
    '###############.....################', // 6
    '###############.....################', // 7
    '###############.....################', // 8
    '###.......#####.....##########...###', // 9  the altar (x 3)
    '####......#####.....##########...###', // 10
    '####................######......####', // 11
    '###.................######......####', // 12 the reward row (x 16-18)
    '#####.#########..................###', // 13
    '#####.#########................#####', // 14
    '#####....######.....######.....#####', // 15
    '#####....######.....######.....#####', // 16
    '###....########.....######.....#####', // 17
    '###....#####........######.....#####', // 18
    '###....#####.####..####..........###', // 19
    '#################..####....#########', // 20
    '#################..#################', // 21 the way in (x 17-18)
    '####################################', // 22
    '####################################', // 23
    '####################################', // 24
    '####################################', // 25
  ],
  doors: [
    { id: 'way-in', tiles: { tx: 17, ty: 21, w: 2, h: 1 }, arrival: { tx: 17, ty: 18, facing: 'up' } },
    { id: 'far', tiles: { tx: 17, ty: 3, w: 2, h: 1 }, arrival: { tx: 17, ty: 8, facing: 'down' } },
  ],
  seal: { tiles: { tx: 17, ty: 3, w: 2, h: 3 }, texture: TextureKey.DungeonSewerSeal, x: 540, y: 50 },
  altar: { tx: 3, ty: 9 },
  reward: { tx: 16, ty: 12, w: 3 },
  art: {
    backdrop: TextureKey.DungeonSewer,
    front: null,
    widthTexels: 1152,
    heightTexels: 832,
    texelsPerPixel: 2,
    pieces: [],
    lights: [
      { kind: 'torch', x: 115, y: 329, size: TORCH },
      { kind: 'torch', x: 1036, y: 378, size: TORCH },
      { kind: 'torch', x: 480, y: 632, size: TORCH },
      { kind: 'torch', x: 667, y: 632, size: TORCH },
    ],
    animations: [
      { name: 'fall-left', texture: TextureKey.DungeonSewerFallLeft, x: 364, y: 190, frameWidth: 62, frameHeight: 110, frames: 8, fps: 8 },
      { name: 'fall-right', texture: TextureKey.DungeonSewerFallRight, x: 726, y: 196, frameWidth: 60, frameHeight: 122, frames: 8, fps: 8 },
      { name: 'pool-top', texture: TextureKey.DungeonSewerPoolTop, x: 310, y: 250, frameWidth: 640, frameHeight: 160, frames: 8, fps: 5 },
      { name: 'pool-low', texture: TextureKey.DungeonSewerPoolLow, x: 186, y: 390, frameWidth: 636, frameHeight: 212, frames: 8, fps: 5 },
    ],
    sounds: [
      { kind: 'toxic', x: 600, y: 380, radius: 300 },
    ],
  },
  // The painted torches burn green.
  style: { tint: 0xffffff, glow: { torch: 0x8cff5a, brazier: 0x8cff5a } },
};

const BOSS: DungeonBossRoomDef = {
  id: 'boss',
  title: 'The Warden\'s Pit',
  tiles: { w: 36, h: 26 },
  origin: { tx: 164, ty: 0 },
  // The rune platform over the lava; the stair down (x 16-19, rows 18-23) leads back.
  walk: [
    '####################################', // 0
    '####################################', // 1
    '####################################', // 2
    '####################################', // 3
    '####################################', // 4
    '####################################', // 5
    '####################################', // 6
    '###############......###############', // 7  below the Warden's statue
    '############............############', // 8
    '############............############', // 9
    '###########..............###########', // 10 the Warden starts here (x 17); the altar (x 11)
    '###########..............###########', // 11 the rune's eye (x 17-18, rows 11-12)
    '##########.................#########', // 12
    '##########.................#########', // 13
    '##########.................#########', // 14 the reward row (x 16-18)
    '###########..............###########', // 15
    '###########.##.........#############', // 16
    '##############........##############', // 17
    '################....################', // 18 the stair
    '################....################', // 19
    '################....################', // 20
    '################....################', // 21
    '################....################', // 22
    '################....################', // 23 the way in (x 16-19)
    '####################################', // 24
    '####################################', // 25
  ],
  doors: [
    { id: 'way-in', tiles: { tx: 16, ty: 23, w: 4, h: 1 }, arrival: { tx: 17, ty: 18, facing: 'up' } },
  ],
  warden: { tx: 17, ty: 10 },
  exit: { name: 'exit', texture: TextureKey.DungeonBossExit, x: 528, y: 357, frameWidth: 96, frameHeight: 68, frames: 16, fps: 10 },
  altar: { tx: 11, ty: 10 },
  reward: { tx: 16, ty: 14, w: 3 },
  art: {
    backdrop: TextureKey.DungeonBoss,
    front: null,
    widthTexels: 1152,
    heightTexels: 832,
    texelsPerPixel: 2,
    pieces: [],
    lights: [
      { kind: 'brazier', x: 444, y: 167, size: BRAZIER },
      { kind: 'brazier', x: 704, y: 167, size: BRAZIER },
      { kind: 'brazier', x: 311, y: 480, size: BRAZIER },
      { kind: 'brazier', x: 835, y: 483, size: BRAZIER },
      { kind: 'brazier', x: 458, y: 675, size: BRAZIER },
      { kind: 'brazier', x: 691, y: 675, size: BRAZIER },
    ],
    animations: [
      { name: 'lava-left', texture: TextureKey.DungeonBossLavaLeft, x: 6, y: 124, frameWidth: 334, frameHeight: 666, frames: 8, fps: 4 },
      { name: 'lava-right', texture: TextureKey.DungeonBossLavaRight, x: 812, y: 254, frameWidth: 332, frameHeight: 536, frames: 8, fps: 4 },
      { name: 'fall-bl', texture: TextureKey.DungeonBossFallBl, x: 316, y: 654, frameWidth: 38, frameHeight: 138, frames: 8, fps: 6 },
      { name: 'fall-br', texture: TextureKey.DungeonBossFallBr, x: 798, y: 654, frameWidth: 38, frameHeight: 138, frames: 8, fps: 6 },
      { name: 'fall-back', texture: TextureKey.DungeonBossFallBack, x: 116, y: 124, frameWidth: 34, frameHeight: 216, frames: 8, fps: 6 },
    ],
    // Lava rumbles on both sides of the platform.
    sounds: [
      { kind: 'lava', x: 170, y: 460, radius: 220 },
      { kind: 'lava', x: 980, y: 520, radius: 220 },
    ],
  },
  style: { tint: 0xffffff, glow: { torch: 0xff6a30, brazier: 0xff5a28 } },
};

/** Every room by id. */
export const DUNGEON_ROOMS = {
  hub: HUB,
  cave: CAVE,
  library: LIBRARY,
  sewer: SEWER,
  boss: BOSS,
} as const satisfies Record<DungeonRoomId, DungeonRoomDef>;

export const DUNGEON_ROOM_IDS = Object.keys(DUNGEON_ROOMS) as DungeonRoomId[];

/**
 * Inclusive map-tile bounds of one room: the whole painting, walls included.
 * @param id room id
 */
export function dungeonRoomBounds(id: DungeonRoomId): { x0: number; x1: number; y0: number; y1: number } {
  const room: DungeonRoomDef = DUNGEON_ROOMS[id];
  const { tx, ty } = room.origin;
  return { x0: tx, x1: tx + room.tiles.w - 1, y0: ty, y1: ty + room.tiles.h - 1 };
}

/**
 * Find one door of a room.
 * @throws when the room has no such door
 */
export function dungeonDoor(id: DungeonRoomId, door: DoorId): DungeonDoor {
  const found = DUNGEON_ROOMS[id].doors.find(candidate => candidate.id === door);
  if (!found) throw new Error(`DungeonRooms: room ${id} has no door ${door}`);
  return found;
}

/**
 * One run's layout: which side room each hub door opens into, and which side room's far door
 * climbs to the Warden (the other two far doors are walled up).
 */
export interface DungeonRunPlan {
  readonly doors: Readonly<Record<HubDoorId, SideRoomId>>;
  readonly bossBehind: SideRoomId;
}

/**
 * Shuffle a new run: the three side rooms onto the three hub doors (a Fisher-Yates shuffle), and the
 * Warden's stair behind one of them.
 * @param rand returns a number in [0, 1); the scene passes the gameplay Rng
 * @throws when rand returns anything outside [0, 1)
 */
export function planDungeonRun(rand: () => number): DungeonRunPlan {
  const pick = (count: number): number => {
    const r = rand();
    if (!(r >= 0 && r < 1)) throw new Error(`planDungeonRun: rand() gave ${r}, expected [0, 1)`);
    return Math.floor(r * count);
  };
  const rooms = [...SIDE_ROOM_IDS];
  for (let i = rooms.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
  }
  return {
    doors: { left: rooms[0], right: rooms[1], bottom: rooms[2] },
    bossBehind: SIDE_ROOM_IDS[pick(SIDE_ROOM_IDS.length)],
  };
}

/** Where a door leads this run: a room and the door the keeper comes out of there, or 'sealed'. */
export type DoorTarget = { readonly room: DungeonRoomId; readonly door: DoorId } | 'sealed';

/**
 * Follow one door under a run plan.
 *  - hub door -> that side room's way in;
 *  - side room way in -> the hub door that leads to it;
 *  - side room far door -> the Warden's stair when the boss is behind it, else walled up;
 *  - the Warden's stair -> the far door of the room it is behind.
 * @throws for a door the room does not have
 */
export function doorTarget(plan: DungeonRunPlan, room: DungeonRoomId, door: DoorId): DoorTarget {
  dungeonDoor(room, door);
  if (room === 'hub') {
    if (door !== 'left' && door !== 'right' && door !== 'bottom') throw new Error(`doorTarget: hub has no door ${door}`);
    return { room: plan.doors[door], door: 'way-in' };
  }
  if (room === 'boss') return { room: plan.bossBehind, door: 'far' };
  if (door === 'way-in') {
    const back = HUB_DOOR_IDS.find(id => plan.doors[id] === room);
    if (!back) throw new Error(`doorTarget: no hub door leads to ${room}`);
    return { room: 'hub', door: back };
  }
  return plan.bossBehind === room ? { room: 'boss', door: 'way-in' } : 'sealed';
}
