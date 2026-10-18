/**
 * Extract12 reviewed Pro Flash crops at their native pixels. The generator's second and third
 * rows drift one pixel beyond their nominal16px cells; measured row bounds below preserve those
 * pixels. Alpha bounds must fit16×16 or the build fails, never rescaling or silently clipping.
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../public/assets/living-farm/', import.meta.url);
const source = PNG.sync.read(readFileSync(new URL('crops-pro-source.png', root)));
if (source.width !== 64 || source.height !== 64) throw new Error('Expected reviewed64×64 crop source');
const rows = [
  { type: 'parsnip', top: 0, bottom: 17, columns: [0, 16, 32, 46, 64] },
  { type: 'potato', top: 18, bottom: 34, columns: [0, 16, 32, 46, 64] },
  { type: 'melon', top: 35, bottom: 51, columns: [0, 16, 29, 46, 64] },
];
const report = [];
for (const row of rows) for (let stage = 0; stage < 4; stage++) {
  let left = 64, top = 64, right = -1, bottom = -1;
  for (let y = row.top; y <= row.bottom; y++) for (let x = row.columns[stage]; x < row.columns[stage + 1]; x++) {
    if (source.data[(y * 64 + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const width = right - left + 1, height = bottom - top + 1;
  if (width < 1 || height < 1 || width > 16 || height > 16) throw new Error(`${row.type} stage${stage}: invalid ${width}×${height}`);
  const out = new PNG({ width: 16, height: 16 });
  PNG.bitblt(source, out, left, top, width, height, Math.floor((16 - width) / 2), 16 - height);
  const file = `crop-${row.type}-${stage + 1}.png`;
  writeFileSync(new URL(file, root), PNG.sync.write(out));
  report.push({ file, sourceBounds: { left, top, right, bottom }, width, height });
}
writeFileSync(new URL('crop-bounds.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
