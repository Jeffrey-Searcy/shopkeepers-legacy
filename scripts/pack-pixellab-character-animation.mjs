/**
 * Pack one downloaded PixelLab character animation into the game's 4x4, 96x64 sheet.
 *
 * PixelLab keeps every 48x48 frame on one direction-specific pivot. We derive the vertical shift
 * from that direction's idle rotation, then apply the same shift to every action frame. This keeps
 * feet stable even when a tool extends below them.
 *
 * Usage: node scripts/pack-pixellab-character-animation.mjs <stateDir> <animationName> <out.png> [--normalize-frame-bottom]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const [stateDirArg, animationName, outputPath, alignmentFlag] = process.argv.slice(2);
if (!stateDirArg || !animationName || !outputPath) {
  throw new Error(
    'usage: node scripts/pack-pixellab-character-animation.mjs <stateDir> <animationName> <out.png> [--normalize-frame-bottom]'
  );
}
if (alignmentFlag !== undefined && alignmentFlag !== '--normalize-frame-bottom') {
  throw new Error(`pack-pixellab-character-animation: unknown option ${alignmentFlag}`);
}
const normalizeFrameBottom = alignmentFlag === '--normalize-frame-bottom';

const stateDir = resolve(stateDirArg);
const idleFrameSize = 48;
const outputFrameWidth = 96;
const outputFrameHeight = 64;
const outputFeetRow = 39;
const directions = ['south', 'north', 'west', 'east'];
const frameCount = 4;
const sheet = new PNG({ width: outputFrameWidth * frameCount, height: outputFrameHeight * directions.length });

/** Return the last opaque row in a frame; idle rotations use it as the visible feet line. */
function opaqueBottom(frame, label) {
  for (let y = frame.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (frame.data[(y * frame.width + x) * 4 + 3] !== 0) return y;
    }
  }
  throw new Error(`pack-pixellab-character-animation: ${label} is empty`);
}

/** Copy one RGBA frame into a sheet cell while safely clipping transparent canvas margins. */
function copyFrame(frame, cellColumn, cellRow, shiftY) {
  const baseX = cellColumn * outputFrameWidth + (outputFrameWidth - frame.width) / 2;
  const baseY = cellRow * outputFrameHeight + shiftY;
  for (let y = 0; y < frame.height; y += 1) {
    const targetY = baseY + y;
    if (targetY < cellRow * outputFrameHeight || targetY >= (cellRow + 1) * outputFrameHeight) continue;
    for (let x = 0; x < frame.width; x += 1) {
      const targetX = baseX + x;
      const sourceOffset = (y * frame.width + x) * 4;
      const targetOffset = (targetY * sheet.width + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sheet.data[targetOffset + channel] = frame.data[sourceOffset + channel];
      }
    }
  }
}

for (let row = 0; row < directions.length; row += 1) {
  const direction = directions[row];
  const idlePath = join(stateDir, 'rotations', `${direction}.png`);
  if (!existsSync(idlePath)) throw new Error(`pack-pixellab-character-animation: missing ${idlePath}`);
  const idle = PNG.sync.read(readFileSync(idlePath));
  if (idle.width !== idleFrameSize || idle.height !== idleFrameSize) {
    throw new Error(`pack-pixellab-character-animation: ${idlePath} must be 48x48`);
  }
  const idleBottom = opaqueBottom(idle, idlePath);

  for (let column = 0; column < frameCount; column += 1) {
    const framePath = join(
      stateDir,
      'animations',
      animationName,
      direction,
      `frame_${String(column).padStart(3, '0')}.png`
    );
    if (!existsSync(framePath)) throw new Error(`pack-pixellab-character-animation: missing ${framePath}`);
    const frame = PNG.sync.read(readFileSync(framePath));
    if (frame.width > outputFrameWidth || frame.height > outputFrameHeight) {
      throw new Error(
        `pack-pixellab-character-animation: ${framePath} exceeds the ${outputFrameWidth}x${outputFrameHeight} cell`
      );
    }
    // PixelLab may expand a directional canvas to keep a raised tool visible. Re-center the idle
    // pivot inside that canvas before aligning its feet, so larger frames do not jump on screen.
    const idleBottomInFrame = (frame.height - idleFrameSize) / 2 + idleBottom;
    // Navigation has no tool pixels below the body, so align each step to remove generated foot
    // bob. Actions must keep the shared pivot because tools can legitimately extend below the feet.
    const shiftY = normalizeFrameBottom
      ? outputFeetRow - opaqueBottom(frame, framePath)
      : outputFeetRow - idleBottomInFrame;
    copyFrame(frame, column, row, shiftY);
  }
}

writeFileSync(resolve(outputPath), PNG.sync.write(sheet));
console.log(`wrote ${outputPath} (${sheet.width}x${sheet.height}, feet row ${outputFeetRow})`);
