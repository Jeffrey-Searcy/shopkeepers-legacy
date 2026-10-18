/** Pack a generated transparent facade onto the original native canvas; no painted pixels or collision changes. */
import fs from 'node:fs';
import { PNG } from 'pngjs';

/** Find the actual alpha bounds and reject opaque generation results before importing game art. */
function bounds(png) {
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1, clear = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const alpha = png.data[(y * png.width + x) * 4 + 3];
    if (alpha === 0) clear++;
    // Near-transparent export specks must not shift the registration box of the visible building.
    if (alpha < 128) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (clear === 0 || x1 < x0) throw new Error('Facade must contain both artwork and genuine transparency.');
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const [input, output, replace] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/pack-shop-facade.mjs INPUT.png OUTPUT.png');
if (fs.existsSync(output) && replace !== '--replace') throw new Error(`Refusing to overwrite ${output}`);
const original = PNG.sync.read(fs.readFileSync('public/assets/objects/shop-facade.png'));
const source = PNG.sync.read(fs.readFileSync(input));
const from = bounds(source), to = bounds(original);
const result = new PNG({ width: 160, height: 160 });
// Register the content to the accepted facade, using nearest pixels to avoid blurred native edges.
for (let y = 0; y < to.h; y++) for (let x = 0; x < to.w; x++) {
  const sx = from.x + Math.min(from.w - 1, Math.floor((x + 0.5) * from.w / to.w));
  const sy = from.y + Math.min(from.h - 1, Math.floor((y + 0.5) * from.h / to.h));
  source.data.copy(result.data, ((y + to.y) * 160 + x + to.x) * 4, (sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4);
}
fs.writeFileSync(output, PNG.sync.write(result));
console.log(JSON.stringify({ input, output, source: from, native: bounds(result), width: 160, height: 160 }));
