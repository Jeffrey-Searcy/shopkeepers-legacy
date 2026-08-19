/**
 * TerrainTileset — builds a single packed tileset texture for the placeholder terrain, and maps
 * Ground types to tile indices within it.
 *
 * WHY: a big map (100x100 = 10,000 tiles) must NOT be 10,000 GameObjects — that overwhelms WebGL
 * and the dev server (it caused parallel Playwright runs to time out). Phaser's TilemapLayer renders
 * the whole grid as ONE culled object from a tileset image, which is the correct approach for big
 * maps. This module bakes that tileset image once (a horizontal strip of solid-color 16px tiles)
 * so the placeholder terrain uses the same fast path the real PixelLab tileset will use in M8.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import type { Ground } from './MapDef';

/** The tileset texture key. */
export const TERRAIN_TILESET_KEY = 'terrain-tileset';

/** Ground type -> tile index in the packed tileset (order matches the strip built below). */
export const GROUND_INDEX: Record<Ground, number> = {
  grass: 0,
  dirt: 1,
  water: 2,
  floor: 3,
  sand: 4,
  stone: 5,
  cave: 6,
  cliff: 7,
};

/** Solid-color hex per ground type (placeholder look; matches manifest palette). */
const GROUND_COLOR: Record<Ground, string> = {
  grass: '#6ab04c',
  dirt: '#a9744f',
  water: '#4aa3c7',
  floor: '#c8a06a',
  sand: '#e2cf96',
  stone: '#8f9296',
  cave: '#584b40',
  cliff: '#6f675c',
};

const ORDER: Ground[] = ['grass', 'dirt', 'water', 'floor', 'sand', 'stone', 'cave', 'cliff'];

/**
 * Ensure the packed terrain tileset texture exists (idempotent). It is a 1-row strip: one 16x16
 * solid-color tile per ground type, in ORDER. Built once per scene via a Graphics -> texture bake.
 */
export function ensureTerrainTileset(scene: Phaser.Scene): void {
  // If the real PixelLab terrain strip was loaded (manifest key TERRAIN_TILESET_KEY), use it as-is.
  // The manifest loads terrain-strip.png (grass, dirt, water, floor, sand, stone, cave in
  // GROUND_INDEX order — built by scripts/build-terrain.mjs) — the exact index layout this baked
  // fallback would produce, so the tilemap code is unchanged either way.
  if (scene.textures.exists(TERRAIN_TILESET_KEY)) return;

  // Fallback: bake a flat-color strip (used only if the real art isn't present).
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  ORDER.forEach((ground, i) => {
    const num = Phaser.Display.Color.HexStringToColor(GROUND_COLOR[ground]).color;
    g.fillStyle(num, 1);
    g.fillRect(i * TILE, 0, TILE, TILE);
  });
  g.generateTexture(TERRAIN_TILESET_KEY, ORDER.length * TILE, TILE);
  g.destroy();
}
