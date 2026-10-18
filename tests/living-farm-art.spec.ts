/** Native art invariants keep new farming assets crisp, bounded, and safe to compose. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const assetRoot = new URL('../public/assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assetRoot), 'utf8'));

/** Read an authored PNG through its runtime logical key, failing if the entry is absent. */
function texture(key: string): PNG {
  const entry = manifest.textures[key];
  if (!entry || typeof entry.file !== 'string') throw new Error(`Missing authored texture ${key}`);
  return PNG.sync.read(readFileSync(new URL(entry.file, assetRoot)));
}

test('carried items and seeds use native canvases with real alpha', () => {
  for (const key of ['icon-stew', 'icon-ale', 'icon-oak-seed', 'icon-pine-seed', 'icon-broom']) {
    const image = texture(key);
    expect(image.width, key).toBe(16);
    expect(image.height, key).toBe(key === 'icon-broom' ? 32 : 16);
    const alpha = image.data.filter((_, index) => index % 4 === 3);
    expect(alpha.some(value => value === 0), key).toBe(true);
    expect(alpha.some(value => value === 255), key).toBe(true);
  }
});

test('all81 soil states preserve outer silhouettes when watered', () => {
  const atlas = texture('wang-soil');
  expect([atlas.width, atlas.height]).toEqual([144, 144]);
  /** Locate one native pixel inside a base-three corner frame. */
  const pixel = (code: number, x: number, y: number): number =>
    ((Math.floor(code / 9) * 16 + y) * atlas.width + (code % 9) * 16 + x) * 4;
  const failures: string[] = [];
  for (let code = 0; code < 81; code++) {
    let remaining = code, dryCode = 0;
    for (let corner = 0; corner < 4; corner++) {
      if (remaining % 3 > 0) dryCode += 3 ** corner;
      remaining = Math.floor(remaining / 3);
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const at = pixel(code, x, y), dry = pixel(dryCode, x, y);
      if (atlas.data[at + 3] !== atlas.data[dry + 3]) failures.push(`frame${code} alpha ${x},${y}`);
      for (let channel = 0; channel < 3; channel++) {
        if (atlas.data[at + channel] > atlas.data[dry + channel]) failures.push(`frame${code} channel${channel}`);
      }
    }
  }
  expect(failures).toEqual([]);
  expect(atlas.data[pixel(80, 8, 8)]).toBeLessThan(atlas.data[pixel(40, 8, 8)]);
});

test('all12 growth stages stay native16px and use distinct authored pixels', () => {
  for (const crop of ['parsnip', 'potato', 'melon']) {
    const signatures = new Set<string>();
    for (let stage = 1; stage <= 4; stage++) {
      const image = texture(`crop-${crop}-${stage}`);
      expect([image.width, image.height]).toEqual([16, 16]);
      expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      signatures.add(image.data.toString('base64'));
    }
    expect(signatures.size).toBe(4);
  }
});

test.describe('authored farm in WebGL', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('24 crop sprites retain native pixels and foot-based depth on connected soil', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?test=1&seed=42&renderer=webgl');
    await page.waitForFunction(() => window.__TEST__?.ready === true);
    await page.evaluate(async () => {
      // @ts-expect-error Vite fixture imports the live game module.
      const { GameState } = await import('/src/state/GameState.ts');
      const gs = GameState.instance;
      const scene = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
        nodes: Map<string, { tx: number; ty: number; kind: string; destroy(): void }>;
        renderAllOverlay(): void;
      };
      // This isolated fixture represents a cleared plot; it never writes a browser save.
      for (const [key, node] of scene.nodes) {
        if (node.tx < 23 || node.tx > 35 || node.ty < 25 || node.ty > 35) continue;
        gs.removedNodes[`FarmScene:${key}`] = { kind: node.kind, day: gs.day };
        node.destroy();
        scene.nodes.delete(key);
      }
      for (let y = 27; y < 32; y++) for (let x = 26; x < 34; x++) {
        gs.tiles[`FarmScene:${x},${y}`] = x < 30 ? 'watered' : 'tilled';
        if (y % 2 === 1) {
          gs.crops[`FarmScene:${x},${y}`] = {
            type: ['parsnip', 'potato', 'melon'][(y - 27) / 2],
            stage: (x - 26) % 4, maxStage: 3, daysInStage: 0,
          };
        }
      }
      window.__TEST__!.teleport(24, 30, 'right');
      scene.renderAllOverlay();
    });
    // Wait for the real camera follow to settle, not an arbitrary screenshot delay.
    await page.waitForFunction(() => {
      const scene = window.__GAME__!.scene.getScene('FarmScene');
      const actor = (scene as unknown as { player: { x: number } }).player;
      return Math.abs(scene.cameras.main.midPoint.x - actor.x) < 1;
    });
    const crops = await page.evaluate(() => {
      const scene = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
        overlay: Map<string, { width: number; height: number; scaleX: number; scaleY: number;
          originX: number; originY: number; y: number; depth: number; texture: { key: string } }>;
      };
      return [...scene.overlay].map(([tile, sprite]) => ({ tile, width: sprite.width, height: sprite.height,
        scaleX: sprite.scaleX, scaleY: sprite.scaleY, originX: sprite.originX, originY: sprite.originY,
        y: sprite.y, depth: sprite.depth, texture: sprite.texture.key }));
    });
    expect(crops).toHaveLength(24);
    for (const crop of crops) {
      expect([crop.width, crop.height, crop.scaleX, crop.scaleY], crop.tile).toEqual([16, 16, 1, 1]);
      expect([crop.originX, crop.originY], crop.tile).toEqual([0.5, 1]);
      expect(crop.depth, crop.tile).toBe(crop.y - 1);
      expect(crop.texture).toMatch(/^crop-(parsnip|potato|melon)-[1-4]$/);
    }
    await page.screenshot({ path: 'output/living-farm-all-stages.png' });
    expect(errors).toEqual([]);
  });
});
