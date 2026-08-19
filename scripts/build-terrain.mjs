/**
 * build-terrain.mjs — build the game's flat terrain tile strip from the PixelLab Wang tilesets.
 *
 * TerrainTileset.ts expects a horizontal strip of 16px tiles in GROUND_INDEX order:
 *   0=grass, 1=dirt, 2=water, 3=floor, 4=sand, 5=stone, 6=cave, 7=cliff.
 * The strip backs the invisible collision layer and the flat fallback for interiors (Home floor)
 * or when Wang art is missing. Full-terrain tiles are extracted from each Wang sheet by reading
 * its metadata (the tile whose 4 corners are all lower/upper), so this never breaks when a sheet's
 * layout differs. Water and floor have no dedicated full tile in our sheets, so they stay solid
 * colors. Output replaces public/assets/tilesets/terrain-strip.png.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const T = 16;

/** Read a Wang sheet PNG + its metadata from public/assets/tilesets/. */
function loadSet(pngName, metaName) {
  const base = new URL('../public/assets/tilesets/', import.meta.url);
  const png = PNG.sync.read(readFileSync(new URL(pngName, base)));
  const meta = JSON.parse(readFileSync(new URL(metaName, base), 'utf8'));
  return { png, meta };
}

/** Find the (col,row) of the full-`which` tile ('lower'|'upper') in a Wang sheet's metadata. */
function fullTile(meta, which) {
  for (const t of meta.tileset_data.tiles) {
    const c = t.corners;
    if (c.NW === which && c.NE === which && c.SW === which && c.SE === which) {
      return { col: t.bounding_box.x / T, row: t.bounding_box.y / T };
    }
  }
  throw new Error(`no full-${which} tile found in metadata`);
}

// Strip layout must match TerrainTileset.GROUND_INDEX exactly.
const strip = new PNG({ width: T * 8, height: T });

/** Copy a 16x16 tile from a Wang sheet at (col,row) into the strip at column `dst`. */
function copyTile(src, { col, row }, dst) {
  PNG.bitblt(src, strip, col * T, row * T, T, T, dst * T, 0);
}

/** Fill a strip column with a solid RGBA color. */
function fillTile(dst, r, g, b) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const idx = (y * strip.width + (dst * T + x)) << 2;
      strip.data[idx] = r;
      strip.data[idx + 1] = g;
      strip.data[idx + 2] = b;
      strip.data[idx + 3] = 255;
    }
  }
}

const dirtGrass = loadSet('terrain.png', 'terrain-meta.json'); // dirt(lower) <-> grass(upper)
copyTile(dirtGrass.png, fullTile(dirtGrass.meta, 'upper'), 0); // 0 = grass
copyTile(dirtGrass.png, fullTile(dirtGrass.meta, 'lower'), 1); // 1 = dirt
fillTile(2, 0x4a, 0xa3, 0xc7); // 2 = water (solid blue; Wang water draws over it outdoors)
fillTile(3, 0xc8, 0xa0, 0x6a); // 3 = floor (warm wood; the Home interior's flat look)

const sandGrass = loadSet('sand.png', 'sand-meta.json'); // sand(lower) <-> grass(upper)
copyTile(sandGrass.png, fullTile(sandGrass.meta, 'lower'), 4); // 4 = sand

const stoneGrass = loadSet('stone.png', 'stone-meta.json'); // stone(lower) <-> grass(upper)
copyTile(stoneGrass.png, fullTile(stoneGrass.meta, 'lower'), 5); // 5 = stone

const caveStone = loadSet('cave.png', 'cave-meta.json'); // cave(lower) <-> stone(upper)
copyTile(caveStone.png, fullTile(caveStone.meta, 'lower'), 6); // 6 = cave floor

const cliffGrass = loadSet('cliff.png', 'cliff-meta.json'); // cliff(lower) <-> grass(upper)
copyTile(cliffGrass.png, fullTile(cliffGrass.meta, 'lower'), 7); // 7 = cliff rock

writeFileSync(new URL('../public/assets/tilesets/terrain-strip.png', import.meta.url), PNG.sync.write(strip));
console.log('wrote terrain-strip.png (128x16, 8 tiles: grass, dirt, water, floor, sand, stone, cave, cliff)');
