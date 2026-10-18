/** Copy verified native sprite bounds into fixed canvases. This never rescales or redraws pixels. */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target, widthText, heightText] = process.argv.slice(2);
const width = Number(widthText), height = Number(heightText);
if (!source || !target || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error('Expected input output width height');
const input = PNG.sync.read(readFileSync(source));
let left = input.width, top = input.height, right = -1, bottom = -1;
for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
  if (input.data[(y * input.width + x) * 4 + 3] === 0) continue;
  left = Math.min(left, x); right = Math.max(right, x);
  top = Math.min(top, y); bottom = Math.max(bottom, y);
}
const contentWidth = right - left + 1, contentHeight = bottom - top + 1;
if (contentWidth < 1 || contentHeight < 1 || contentWidth > width || contentHeight > height) throw new Error(`Content ${contentWidth}×${contentHeight} does not fit ${width}×${height}`);
const output = new PNG({ width, height });
PNG.bitblt(input, output, left, top, contentWidth, contentHeight, Math.floor((width - contentWidth) / 2), height - contentHeight);
writeFileSync(target, PNG.sync.write(output));
console.log(JSON.stringify({ source, target, sourceBounds: { left, top, right, bottom }, width, height, contentWidth, contentHeight }));
