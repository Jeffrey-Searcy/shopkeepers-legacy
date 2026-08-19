/**
 * TerrainRenderer — renders the ground using the FULL 16-tile PixelLab Wang tilesets with
 * dual-grid corner autotiling (grass↔dirt/sand/stone transitions, water shorelines, and the
 * cave↔stone interior of the Mines).
 *
 * Dual-grid technique: a rendered layer of size (w+1)x(h+1), offset by (-TILE/2, -TILE/2), where
 * the tile at vertex (vx,vy) covers the corners of map cells (vx-1,vy-1)..(vx,vy). Each rendered
 * tile's frame is picked from a LUT keyed by which of its 4 corners touch the "lower" terrain.
 * LUTs are generated from the PixelLab tileset metadata by scripts/build-wang-luts.mjs.
 *
 * Water is special: it can border grass (farm/forest/mountain lakes) OR sand (the beach). Each
 * water vertex picks its sheet from what its own corners touch, so both can coexist on one map.
 * The design rule that makes this clean: different "lower" terrains (dirt/sand/stone) never touch
 * each other directly — there is always >=1 tile of grass (or, for water on the beach, sand)
 * between them, so every transition is a pure two-terrain Wang tile.
 *
 * Rendering is purely visual — collision stays on the (invisible) index layer built by
 * BaseWorldScene, so gameplay/tests are unaffected by how pretty the ground is.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import type { MapData, Ground } from './MapDef';
import dirtGrass from './luts/dirt-grass.json';
import waterGrass from './luts/water-grass.json';
import sandGrass from './luts/sand-grass.json';
import stoneGrass from './luts/stone-grass.json';
import waterSand from './luts/water-sand.json';
import caveStone from './luts/cave-stone.json';
import cliffGrass from './luts/cliff-grass.json';

/** Texture keys for the raw 4x4 Wang sheets (loaded via the manifest). */
export const WANG_DIRT_KEY = 'wang-dirt';
export const WANG_WATER_KEY = 'wang-water';
export const WANG_SAND_KEY = 'wang-sand';
export const WANG_STONE_KEY = 'wang-stone';
export const WANG_WATER_SAND_KEY = 'wang-water-sand';
export const WANG_CAVE_KEY = 'wang-cave';
export const WANG_CLIFF_KEY = 'wang-cliff';

interface WangLut {
  lut: number[];
  fullLower: number;
  fullUpper: number;
}

/**
 * Depths for the terrain stack (all far below entities; soil overlay sits at -9).
 * Sand/stone sit between the base and dirt; water always paints on top of its shore terrain.
 * Cliff sits lowest of the transitions — it only ever borders grass (MapDef's carveCliffRing
 * enforces the 1-tile grass buffer), so nothing should ever need to draw beneath it.
 */
const DEPTH_BASE = -15;
const DEPTH_CLIFF = -14.8;
const DEPTH_SAND = -14.7;
const DEPTH_STONE = -14.6;
const DEPTH_DIRT = -14;
const DEPTH_CAVE = -14;
const DEPTH_WATER = -13;

/**
 * Render the Wang terrain stack for a map. Returns false (no-op) when any Wang sheet the map's
 * terrain needs isn't loaded, or when the map has no autotiled base (e.g. the Home interior's
 * plain floor) — callers then keep the flat index-strip fallback, which is visible and obvious
 * rather than a half-rendered world.
 */
export function renderWangTerrain(scene: Phaser.Scene, map: MapData): boolean {
  const has = (g: Ground): boolean => map.ground.some((row) => row.includes(g));
  const loaded = (key: string): boolean => scene.textures.exists(key);

  // Interior branch: the Mines (cave floor carved into stone walls). Base = full stone from the
  // cave<->stone sheet, then the cave-floor transitions on top.
  if (has('cave')) {
    if (!loaded(WANG_CAVE_KEY)) return false;
    fillBase(scene, map, WANG_CAVE_KEY, (caveStone as WangLut).fullUpper);
    buildDualLayer(scene, map, 'cave', caveStone as WangLut, WANG_CAVE_KEY, DEPTH_CAVE);
    return true;
  }

  if (!has('grass')) return false; // plain-floor interiors keep the flat strip

  // Outdoor branch: every sheet this map's terrain actually needs must be loaded (all-or-nothing;
  // a missing sheet must not silently render wrong art).
  if (!loaded(WANG_DIRT_KEY)) return false;
  if (has('sand') && (!loaded(WANG_SAND_KEY) || (has('water') && !loaded(WANG_WATER_SAND_KEY)))) return false;
  if (has('stone') && !loaded(WANG_STONE_KEY)) return false;
  if (has('water') && !loaded(WANG_WATER_KEY)) return false;
  if (has('cliff') && !loaded(WANG_CLIFF_KEY)) return false;

  // Base: full-grass everywhere (transitions draw on top).
  fillBase(scene, map, WANG_DIRT_KEY, (dirtGrass as WangLut).fullUpper);

  // Lower-terrain transitions (dual grid), each vs grass.
  if (has('cliff')) buildDualLayer(scene, map, 'cliff', cliffGrass as WangLut, WANG_CLIFF_KEY, DEPTH_CLIFF);
  if (has('sand')) buildDualLayer(scene, map, 'sand', sandGrass as WangLut, WANG_SAND_KEY, DEPTH_SAND);
  if (has('stone')) buildDualLayer(scene, map, 'stone', stoneGrass as WangLut, WANG_STONE_KEY, DEPTH_STONE);
  buildDualLayer(scene, map, 'dirt', dirtGrass as WangLut, WANG_DIRT_KEY, DEPTH_DIRT);

  // Water shorelines: per-vertex sheet choice (grass shore vs sand shore).
  if (has('water')) buildWaterLayers(scene, map, has('sand'));

  return true;
}

/** Fill a full-map layer with one frame of a Wang sheet (the "base" terrain under transitions). */
function fillBase(scene: Phaser.Scene, map: MapData, texKey: string, frame: number): void {
  const row = new Array<number>(map.w).fill(frame);
  const data: number[][] = new Array(map.h).fill(0).map(() => [...row]);
  makeLayer(scene, data, texKey, 0, 0, DEPTH_BASE);
}

/** Create a static tilemap layer from index data. */
function makeLayer(
  scene: Phaser.Scene,
  data: number[][],
  texKey: string,
  x: number,
  y: number,
  depth: number
): void {
  const map = scene.make.tilemap({
    data,
    tileWidth: TILE,
    tileHeight: TILE,
    width: data[0].length,
    height: data.length,
  });
  const tiles = map.addTilesetImage(texKey, texKey, TILE, TILE, 0, 0);
  if (!tiles) throw new Error(`TerrainRenderer: tileset texture "${texKey}" failed to attach`);
  const layer = map.createLayer(0, tiles, x, y);
  if (!layer) throw new Error(`TerrainRenderer: layer creation failed for "${texKey}"`);
  layer.setDepth(depth);
}

/** Clamp-to-edge ground sampler so borders continue their edge terrain instead of inventing seams. */
function groundAt(map: MapData, x: number, y: number): Ground {
  const cx = Math.max(0, Math.min(map.w - 1, x));
  const cy = Math.max(0, Math.min(map.h - 1, y));
  return map.ground[cy][cx];
}

/** Build one dual-grid transition layer for the given lower-terrain type. */
function buildDualLayer(
  scene: Phaser.Scene,
  map: MapData,
  lower: Ground,
  wang: WangLut,
  texKey: string,
  depth: number
): void {
  const isLower = (x: number, y: number): boolean => groundAt(map, x, y) === lower;

  const data: number[][] = [];
  for (let vy = 0; vy <= map.h; vy++) {
    const row: number[] = [];
    for (let vx = 0; vx <= map.w; vx++) {
      const mask =
        (isLower(vx - 1, vy - 1) ? 1 : 0) | // NW
        (isLower(vx, vy - 1) ? 2 : 0) | // NE
        (isLower(vx - 1, vy) ? 4 : 0) | // SW
        (isLower(vx, vy) ? 8 : 0); // SE
      // mask 0 = all-upper: leave empty (-1) so the base layer shows through.
      row.push(mask === 0 ? -1 : wang.lut[mask]);
    }
    data.push(row);
  }
  makeLayer(scene, data, texKey, -TILE / 2, -TILE / 2, depth);
}

/**
 * Water shoreline layers with a per-vertex sheet choice: a vertex whose non-water corners touch
 * sand uses the water<->sand sheet; otherwise the water<->grass sheet. Interior all-water vertices
 * follow the map's dominant shore (sand on the beach, grass elsewhere) so open water is one art
 * family per map. The two layers never overlap (each vertex lands in exactly one).
 */
function buildWaterLayers(scene: Phaser.Scene, map: MapData, mapHasSand: boolean): void {
  const grassData: number[][] = [];
  const sandData: number[][] = [];
  let anyGrass = false;
  let anySand = false;

  for (let vy = 0; vy <= map.h; vy++) {
    const grassRow: number[] = [];
    const sandRow: number[] = [];
    for (let vx = 0; vx <= map.w; vx++) {
      const corners: Ground[] = [
        groundAt(map, vx - 1, vy - 1), // NW
        groundAt(map, vx, vy - 1), // NE
        groundAt(map, vx - 1, vy), // SW
        groundAt(map, vx, vy), // SE
      ];
      const mask =
        (corners[0] === 'water' ? 1 : 0) |
        (corners[1] === 'water' ? 2 : 0) |
        (corners[2] === 'water' ? 4 : 0) |
        (corners[3] === 'water' ? 8 : 0);
      if (mask === 0) {
        grassRow.push(-1);
        sandRow.push(-1);
        continue;
      }
      const sandShore =
        mask === 15 ? mapHasSand : corners.some((c) => c === 'sand');
      if (sandShore) {
        sandRow.push((waterSand as WangLut).lut[mask]);
        grassRow.push(-1);
        anySand = true;
      } else {
        grassRow.push((waterGrass as WangLut).lut[mask]);
        sandRow.push(-1);
        anyGrass = true;
      }
    }
    grassData.push(grassRow);
    sandData.push(sandRow);
  }

  if (anyGrass) makeLayer(scene, grassData, WANG_WATER_KEY, -TILE / 2, -TILE / 2, DEPTH_WATER);
  if (anySand) makeLayer(scene, sandData, WANG_WATER_SAND_KEY, -TILE / 2, -TILE / 2, DEPTH_WATER);
}
