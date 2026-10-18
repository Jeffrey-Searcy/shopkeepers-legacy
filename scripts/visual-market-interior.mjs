/** Capture fixed 1280x720 WebGL views for the General Market design-review loop. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const OUTPUT = '.frontend-loop/town-market-interior-2026-09-14/screenshots';
const ROUND = process.argv[2];
if (!ROUND || !/^round-\d{2}$/.test(ROUND)) throw new Error('visual-market-interior: pass a round name such as round-02');
await mkdir(OUTPUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

/** Hold a real movement key until the requested destination becomes controllable. */
async function walk(key, target) {
  await page.keyboard.down(key);
  try { await page.waitForFunction(scene => window.__TEST__?.ready && window.__TEST__.activeScene() === scene, target); }
  finally { await page.keyboard.up(key); }
}

/** Place the keeper at a fixed review tile and capture after the follow camera settles. */
async function capture(name, tx, ty, facing) {
  await page.evaluate(({ tx, ty, facing }) => window.__TEST__.teleport(tx, ty, facing), { tx, ty, facing });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUTPUT}/${name}.png` });
}

try {
  await page.goto('http://127.0.0.1:5273/?test=1&renderer=webgl&seed=42');
  await page.waitForFunction(() => window.__TEST__?.ready, undefined, { timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__GAME__.renderer.type), 2, 'Market review requires WebGL');
  await page.evaluate(() => window.__TEST__.stepTime(180));
  await page.evaluate(() => window.__TEST__.teleport(95, 30, 'right'));
  await walk('d', 'TownScene');
  const door = await page.evaluate(async () => (await import('/src/world/MapDef.ts')).getMapData('TownScene')
    .warps.find(warp => warp.target === 'TownMarketScene'));
  if (!door) throw new Error('Market visual: Town entrance is missing');
  await page.evaluate(({ tx, ty }) => window.__TEST__.teleport(tx, ty + 2, 'up'), door);
  await walk('w', 'TownMarketScene');
  await capture(`${ROUND}-entry`, 10, 13, 'up');
  await capture(`${ROUND}-center`, 12, 9, 'right');
  await page.evaluate(() => window.__TEST__.setResidentPoints('tessa', 500));
  await capture(`${ROUND}-private-threshold`, 26, 9, 'down');
  await page.evaluate(() => window.__TEST__.setGold(200));
  await capture(`${ROUND}-counter-position`, 7, 6, 'up');
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__TEST__.state().marketPanelOpen === true);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUTPUT}/${ROUND}-seed-counter.png` });
  assert.deepEqual(errors, [], 'Market visual review encountered browser errors');
  process.stdout.write(`PASS: ${OUTPUT}\n`);
} finally {
  await browser.close();
}
