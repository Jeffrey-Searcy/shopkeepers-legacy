/**
 * AssetKeys — the single string-const registry of every scene key, texture key, and animation key.
 *
 * Game code references these constants, NEVER raw filenames or literal strings (CLAUDE.md Hard
 * Rule 4). `manifest.json` maps texture keys to placeholder-or-PNG sources; the SceneKey enum lets
 * SceneTransitionSystem validate a warp target at compile time (a warp to a non-existent scene
 * won't type-check) — the structural guard against the "player vanished on a bad transition" bug.
 */

/** All scenes. Extend this as scenes are added; transitions validate against it. */
export enum SceneKey {
  Boot = 'BootScene',
  Preload = 'PreloadScene',
  MainMenu = 'MainMenuScene',
  Farm = 'FarmScene',
  Town = 'TownScene',
  Home = 'HomeInteriorScene',
  Forest = 'ForestScene',
  Beach = 'BeachScene',
  Mountain = 'MountainScene',
  Mines = 'MinesScene',
  UI = 'UIScene',
}

/** The set of world (walkable, player-bearing) scenes. Used to guard transition targets. */
export const WORLD_SCENE_KEYS: ReadonlySet<SceneKey> = new Set([
  SceneKey.Farm,
  SceneKey.Town,
  SceneKey.Home,
  SceneKey.Forest,
  SceneKey.Beach,
  SceneKey.Mountain,
  SceneKey.Mines,
]);

/** Texture/sprite keys. Each maps to an entry in public/assets/manifest.json. */
export enum TextureKey {
  Player = 'player',
  PlayerCardinal = 'player-cardinal',
  Tree = 'tree',
  Rock = 'rock',
  Weed = 'weed',
  Chest = 'chest',
  Bed = 'bed',
  House = 'house',
  TavernExterior = 'tavern-exterior',
  Crop = 'crop',
  // Per-growth-stage crop sprites (stage 0..3 -> crop-1..crop-4).
  Crop1 = 'crop-1',
  Crop2 = 'crop-2',
  Crop3 = 'crop-3',
  Crop4 = 'crop-4',
  // Terrain tile textures (placeholder solid colors until the PixelLab tileset lands).
  TileGrass = 'tile-grass',
  TileDirt = 'tile-dirt',
  TileWater = 'tile-water',
  TileFloor = 'tile-floor',
}

/**
 * Navigation keeps the approved Sunnyside side strips and adds cardinal keys only for generated
 * north/south views. Tool actions retain `player-<action>` keys for the existing one-shots.
 */
export enum AnimKey {
  PlayerWalk = 'player-walk',
  PlayerIdle = 'player-idle',
  PlayerWalkUp = 'player-walk-up',
  PlayerWalkDown = 'player-walk-down',
  PlayerIdleUp = 'player-idle-up',
  PlayerIdleDown = 'player-idle-down',
}
