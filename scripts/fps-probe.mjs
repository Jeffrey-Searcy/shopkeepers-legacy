/**
 * fps-probe.mjs — measure real FPS in the WebGL (non-test-renderer) path, like actual play.
 * The dev build still installs the seam (DEV mode), so we can read Phaser's loop.actualFps.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5273/?seed=42'); // NO test=1 -> WebGL renderer, real play path
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });
// Move around while sampling, like a player would.
await page.evaluate(() => window.__TEST__.input('move:right'));
const samples = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  samples.push(await page.evaluate(() => window.__GAME__.loop.actualFps));
}
await page.evaluate(() => window.__TEST__.stopMove());
console.log('FPS samples:', samples.map((s) => s.toFixed(1)).join(', '));
console.log('avg:', (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1));
await browser.close();
