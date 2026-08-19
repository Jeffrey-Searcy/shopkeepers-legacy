/**
 * screenshot2.mjs — capture the farm near the house/door, and a farming shot showing tilled soil +
 * a growing crop, so we can eyeball the real art in context (overlap/scale/z-order).
 */
import { chromium } from 'playwright';

const outHouse = process.argv[2];
const outFarm = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5273/?test=1&seed=42');
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });

// 1) Near the farmhouse (door warp at tile 12,12).
await page.evaluate(() => window.__TEST__.teleport(14, 16, 'up'));
await page.waitForTimeout(1200);
await page.screenshot({ path: outHouse });

// 2) Till + plant + grow a crop on a clear plot, then capture.
await page.evaluate(async () => {
  const t = window.__TEST__;
  t.teleport(30, 30, 'down');
  t.input('hotbar:0'); t.input('use-tool');           // till (30,31)
  t.input('hotbar:5'); t.input('use-tool');           // plant seeds
  t.input('hotbar:4'); t.input('use-tool');           // water
});
await page.waitForTimeout(300);
await page.evaluate(() => { window.__TEST__.sleep(); window.__TEST__.sleep(); }); // grow 2 stages
await page.waitForTimeout(500);
await page.evaluate(() => window.__TEST__.teleport(30, 30, 'down'));
await page.waitForTimeout(1000);
await page.screenshot({ path: outFarm });

console.log('saved', outHouse, 'and', outFarm);
await browser.close();
