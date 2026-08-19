/**
 * GameConfig — central world constants for ShopkeepersLegacy.
 *
 * Every magic number about tile size, map dimensions, camera, and physics lives here so the
 * whole game reads from one place. Critically (per CLAUDE.md Hard Rules 2 & 3): maps are BIG and
 * the camera follows the player within these bounds. Sprite origins / body sizes derive from
 * TILE and these constants — NEVER from an image's pixel dimensions — so swapping a placeholder
 * rect for a PixelLab PNG can never shift collision.
 */

/** Pixel size of one tile. All world math is in tiles * TILE. */
export const TILE = 16;

/**
 * Camera zoom. 2 shows ~30x17 tiles (Stardew-like framing; tall buildings fit in frame); the
 * Scale.FIT canvas then stretches to the window, keeping pixels crisp. Integer zooms only.
 */
export const ZOOM = 2;

/**
 * Map dimensions in TILES, per scene. Big by design (CLAUDE.md Hard Rule 3) so the camera-follow
 * and off-screen tile culling are exercised for real, not faked with a tiny map.
 */
export const MAP_TILES = {
  farm: { w: 100, h: 100 },
  town: { w: 80, h: 60 },
  home: { w: 30, h: 18 }, // Temporary upstairs shell fills the 960px viewport; full interior is next.
} as const;

/** Player movement speed in pixels/second. */
export const PLAYER_SPEED = 120;

/**
 * Camera follow lerp (0..1). NOTE: with roundPixels, any low lerp STALLS before centering (step
 * rounds to 0 once remaining distance < 0.5/lerp px) — 0.1 left the camera permanently ~9px
 * off-center (playtester finding F2). 0.5 keeps a hint of smoothing with a worst-case 1px rest.
 */
export const CAMERA_LERP = 0.5;

/**
 * Character collision body: a small box at the FEET (the Stardew model), not the torso. A
 * torso-centered body made the sprite's feet visually land ON TOP of objects below before the
 * body collided — "I end up on top of it instead of behind it". Offsets are within the Sunnyside
 * 96x64 frame, whose character content measures x 43..53, y 23..38 (feet bottom edge = 39):
 * body covers frame rows 33..39 and is centered on frame-center x=48 so the flipX mirror used for
 * facing left keeps collision symmetric (Arcade bodies do NOT mirror with the sprite).
 */
export const PLAYER_BODY = { w: 8, h: 6, offsetX: 44, offsetY: 33 };
/** How far the body (feet) center sits below the sprite center (row 36 vs frame center 32). */
export const FEET_CENTER_DY = 4;

/** Gameplay tuning. */
export const STAMINA_MAX = 100;
export const TOOL_STAMINA_COST = 2;
/** Watering-can capacity in uses; refilled to full by using the can while facing water. */
export const WATER_CAN_CAPACITY = 12;

/** Convert a tile coordinate to its pixel center. */
export function tileToWorld(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE + TILE / 2, y: tileY * TILE + TILE / 2 };
}

/** Convert a world/pixel coordinate to the tile it falls in. */
export function worldToTile(worldX: number, worldY: number): { tx: number; ty: number } {
  return { tx: Math.floor(worldX / TILE), ty: Math.floor(worldY / TILE) };
}
