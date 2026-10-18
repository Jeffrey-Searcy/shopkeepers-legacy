/**
 * Pack generated Wang soil into 81 empty/dry/wet corner combinations without rescaling pixels.
 * Chroma-key grass becomes transparent to preserve the world below. Water darkens the same
 * authored pixels and stays clipped to the bed silhouette, replacing square watering overlays.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../public/assets/living-farm/', import.meta.url);
const source = PNG.sync.read(readFileSync(new URL('soil-dry-v2.png', root)));
const metadata = JSON.parse(readFileSync(new URL('soil-dry-v2-meta.json', root), 'utf8'));
const boxes = new Array(16);
for (const tile of metadata.tileset_data.tiles) {
  const c = tile.corners;
  const mask = (c.NW === 'lower' ? 1 : 0) | (c.NE === 'lower' ? 2 : 0)
    | (c.SW === 'lower' ? 4 : 0) | (c.SE === 'lower' ? 8 : 0);
  boxes[mask] = tile.bounding_box;
}
if (boxes.filter(Boolean).length !== 16 || source.width !== 64 || source.height !== 64) {
  throw new Error('Expected complete native 16px Wang source');
}
const atlas = new PNG({ width: 144, height: 144 });
// Normalize orange generated earth to the art bible's quieter warm brown ramp.
const EARTH_GAIN = [0.8, 1.05, 1.2];
const EARTH_OFFSET = [8, 16, 20];

/** Return the source byte offset for a pixel (x,y) within an authored corner mask. */
function offset(mask, x, y) {
  const box = boxes[mask];
  return ((box.y + y) * source.width + box.x + x) * 4;
}

/** Return whether the pixel at a source byte offset belongs to brown earth rather than grass. */
function isEarth(at) {
  return source.data[at + 3] > 0 && source.data[at] >= source.data[at + 1];
}

for (let code = 1; code < 81; code++) {
  let digits = code, soilMask = 0, wetMask = 0;
  for (let corner = 0; corner < 4; corner++) {
    const state = digits % 3;
    digits = Math.floor(digits / 3);
    if (state > 0) soilMask |= 1 << corner;
    if (state === 2) wetMask |= 1 << corner;
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const from = offset(soilMask, x, y);
    if (!isEarth(from)) continue;
    const to = (((Math.floor(code / 9) * 16 + y) * 144) + (code % 9) * 16 + x) * 4;
    const wet = wetMask !== 0 && isEarth(offset(wetMask, x, y));
    // One warm ramp keeps wet and dry art aligned; no blue wash or shifted silhouette.
    for (let channel = 0; channel < 3; channel++) {
      const warm = Math.min(255, Math.round(source.data[from + channel] * EARTH_GAIN[channel] + EARTH_OFFSET[channel]));
      atlas.data[to + channel] = Math.round(warm * (wet ? 0.60 : 1));
    }
    atlas.data[to + 3] = source.data[from + 3];
  }
}
writeFileSync(new URL('soil-connected.png', root), PNG.sync.write(atlas));
console.log('Packed 81 native 16×16 soil states into a 144×144 atlas.');
