/**
 * build-wang-luts.mjs — turn PixelLab Wang-tileset metadata into corner-lookup tables (LUTs).
 *
 * Each 16-tile Wang set covers every combination of its 4 corners being lower/upper terrain.
 * The dual-grid renderer (src/world/TerrainRenderer.ts) samples 4 map cells per rendered tile and
 * needs: cornerMask -> frame index in the 4x4 sheet (row-major, from each tile's bounding_box).
 *
 * Mask bits (1 = corner is LOWER terrain): bit0=NW, bit1=NE, bit2=SW, bit3=SE.
 *
 * Reads:  public/assets/tilesets/<name>-meta.json  (downloaded PixelLab metadata)
 * Writes: src/world/luts/<name>.json  ({ lut: number[16], fullLower, fullUpper })
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SETS = [
  { meta: 'terrain-meta.json', out: 'dirt-grass.json' },
  { meta: 'water-meta.json', out: 'water-grass.json' },
  // World-expansion sets (beach / mountain / mines).
  { meta: 'sand-meta.json', out: 'sand-grass.json' },
  { meta: 'stone-meta.json', out: 'stone-grass.json' },
  { meta: 'water-sand-meta.json', out: 'water-sand.json' },
  { meta: 'cave-meta.json', out: 'cave-stone.json' },
  // Cliff boundary walls around the farm/town edges.
  { meta: 'cliff-meta.json', out: 'cliff-grass.json' },
];

mkdirSync(new URL('../src/world/luts/', import.meta.url), { recursive: true });

for (const set of SETS) {
  let metaRaw;
  try {
    metaRaw = readFileSync(new URL(`../public/assets/tilesets/${set.meta}`, import.meta.url), 'utf8');
  } catch {
    console.log(`skip ${set.meta} (not downloaded yet)`);
    continue;
  }
  const meta = JSON.parse(metaRaw);
  const tiles = meta.tileset_data.tiles;
  const lut = new Array(16).fill(-1);
  let fullLower = -1;
  let fullUpper = -1;
  for (const t of tiles) {
    const bb = t.bounding_box;
    const frame = (bb.y / 16) * 4 + bb.x / 16; // row-major index in the 4x4 sheet
    const c = t.corners;
    const mask =
      (c.NW === 'lower' ? 1 : 0) |
      (c.NE === 'lower' ? 2 : 0) |
      (c.SW === 'lower' ? 4 : 0) |
      (c.SE === 'lower' ? 8 : 0);
    lut[mask] = frame;
    if (mask === 15) fullLower = frame;
    if (mask === 0) fullUpper = frame;
  }
  const missing = lut.filter((v) => v === -1).length;
  if (missing > 0) throw new Error(`${set.meta}: ${missing} corner combinations unmapped`);
  writeFileSync(
    new URL(`../src/world/luts/${set.out}`, import.meta.url),
    JSON.stringify({ lut, fullLower, fullUpper }, null, 2)
  );
  console.log(`wrote luts/${set.out} (fullLower=${fullLower}, fullUpper=${fullUpper})`);
}
