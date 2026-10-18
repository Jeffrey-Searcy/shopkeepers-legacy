/** Asset evidence for the twelve installed facades: real alpha, exact source crops and registered native doors. */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { TextureKey } from '../src/config/AssetKeys';
import { TOWN_BUILDINGS } from '../src/config/TownBuildings';
import bounds from '../src/world/maps/town-building-art.json' with { type: 'json' };

test('all twelve manifest facades are distinct transparent images with exact content bounds and aligned apertures', () => {
  const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).textures;
  const hashes = new Set<string>();
  expect(Object.keys(bounds).sort()).toEqual(TOWN_BUILDINGS.map(building => building.id).sort());
  for (const building of TOWN_BUILDINGS) {
    expect(Object.values(TextureKey)).toContain(building.texture);
    const entry = manifest[building.texture];
    expect(entry).toEqual({ type: 'image', file: `objects/town-${building.id}.png` });
    const bytes = readFileSync(`public/assets/${entry.file}`), image = PNG.sync.read(bytes), box = bounds[building.id];
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
    let clear = 0, left = image.width, top = image.height, right = -1, bottom = -1;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const alpha = image.data[(y * image.width + x) * 4 + 3];
      if (alpha === 0) clear++;
      if (alpha >= 128) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    expect(clear / (image.width * image.height), building.id).toBeGreaterThan(0.2);
    expect(clear / (image.width * image.height), building.id).toBeLessThan(0.8);
    expect(box, building.id).toEqual({ x: left, y: top, w: right - left + 1, h: bottom - top + 1 });
    // Sample inside the authored source doorway, not a roof/window. A displaced overlay fails this registration check.
    const sourceX = Math.round(box.x + building.doorOffsetX * box.w / building.width);
    const sourceY = bottom - Math.round(8 * box.w / building.width);
    const index = (sourceY * image.width + sourceX) * 4;
    expect(image.data[index + 3], building.id).toBeGreaterThan(200);
    expect(Math.max(image.data[index], image.data[index + 1], image.data[index + 2]), building.id).toBeLessThan(75);
  }
  expect(hashes.size).toBe(12);
});
