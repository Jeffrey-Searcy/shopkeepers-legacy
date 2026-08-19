/**
 * assemble-farmer.mjs — pack the 16 PixelLab walk frames into ONE spritesheet PNG.
 *
 * Layout expected by PreloadScene.buildPlayerAnimations(): 4 rows x 4 cols, each 48x48.
 *   row 0 = down (south), row 1 = up (north), row 2 = left (west), row 3 = right (east)
 *   cols  = walk frames 0..3
 * generateFrameNumbers indexes left-to-right, top-to-bottom, so row R frames are indices R*4..R*4+3,
 * which matches buildPlayerAnimations (perRow=4, start=row*perRow).
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const FRAME = 48;
const COLS = 4;
const ROWS = 4;
// Row order maps to down/up/left/right (PreloadScene row indices).
const ROW_DIR = ['south', 'north', 'west', 'east'];
const base = new URL('../public/assets/characters/walk/', import.meta.url);

const sheet = new PNG({ width: FRAME * COLS, height: FRAME * ROWS });

for (let row = 0; row < ROWS; row++) {
  const dir = ROW_DIR[row];
  for (let col = 0; col < COLS; col++) {
    const framePath = new URL(`${dir}/${col}.png`, base);
    const frame = PNG.sync.read(readFileSync(framePath));
    if (frame.width !== FRAME || frame.height !== FRAME) {
      throw new Error(`${dir}/${col}.png is ${frame.width}x${frame.height}, expected ${FRAME}x${FRAME}`);
    }
    // Blit the frame into its cell.
    PNG.bitblt(frame, sheet, 0, 0, FRAME, FRAME, col * FRAME, row * FRAME);
  }
}

const outPath = new URL('../public/assets/characters/farmer.png', import.meta.url);
writeFileSync(outPath, PNG.sync.write(sheet));
console.log(`wrote farmer.png (${FRAME * COLS}x${FRAME * ROWS}, 4x4 frames @ ${FRAME}px)`);
