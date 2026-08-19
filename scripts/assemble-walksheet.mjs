/**
 * assemble-walksheet.mjs — pack 16 downloaded walk frames into ONE 4x4 spritesheet PNG.
 *
 * Usage: node scripts/assemble-walksheet.mjs <framesDir> <outPng> [frameSize=48]
 * Expects <framesDir>/{south,north,west,east}/{0..3}.png (the PixelLab per-direction frames).
 * Output layout (PreloadScene.buildWalkAnims): row 0=down(south), 1=up(north), 2=left(west),
 * 3=right(east); columns = walk frames.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [framesDir, outPng, sizeArg] = process.argv.slice(2);
if (!framesDir || !outPng) {
  console.error('usage: node scripts/assemble-walksheet.mjs <framesDir> <outPng> [frameSize=48]');
  process.exit(1);
}
const FRAME = Number(sizeArg ?? 48);
const COLS = 4;
const ROW_DIR = ['south', 'north', 'west', 'east'];

const sheet = new PNG({ width: FRAME * COLS, height: FRAME * ROW_DIR.length });
ROW_DIR.forEach((dir, row) => {
  for (let col = 0; col < COLS; col++) {
    const p = resolve(join(framesDir, dir, `${col}.png`));
    const frame = PNG.sync.read(readFileSync(p));
    if (frame.width !== FRAME || frame.height !== FRAME) {
      throw new Error(`${p} is ${frame.width}x${frame.height}, expected ${FRAME}x${FRAME}`);
    }
    PNG.bitblt(frame, sheet, 0, 0, FRAME, FRAME, col * FRAME, row * FRAME);
  }
});
writeFileSync(resolve(outPng), PNG.sync.write(sheet));
console.log(`wrote ${outPng} (${FRAME * COLS}x${FRAME * ROW_DIR.length})`);
