/**
 * screenshot3.mjs — capture the empty town plaza, the player on the farm by day, and the farm at
 * night. Verifies the current world/player polish visually without relying on removed NPC seams.
 */
import { chromium } from 'playwright';

const outTown = process.argv[2];
const outPlayer = process.argv[3];
const outNight = process.argv[4];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5273/?test=1&seed=42');
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });

// Into town via the east warp.
await page.evaluate(() => window.__TEST__.teleport(98, 30, 'right'));
await page.waitForFunction(() => window.__TEST__.activeScene() === 'TownScene', undefined, { timeout: 15000 });
await page.waitForTimeout(600);

// Stand in the plaza so its current facade-free layout is in frame.
await page.evaluate(() => window.__TEST__.teleport(37, 29, 'up'));
await page.waitForTimeout(1200);
await page.screenshot({ path: outTown });

// Return to the farm and capture the current player sprite in daylight.
await page.evaluate(() => window.__TEST__.teleport(0, 30, 'left'));
await page.waitForFunction(() => window.__TEST__.activeScene() === 'FarmScene', undefined, { timeout: 15000 });
// Use the known-clear farmhouse doorstep spawn rather than a debris-filled farm tile.
await page.evaluate(() => window.__TEST__.teleport(72, 16, 'right'));
await page.waitForTimeout(900);
await page.screenshot({ path: outPlayer });

// Advance the farm clock to ~22:00 for the night-lighting check.
await page.evaluate(() => {
  window.__TEST__.stepTime(16 * 60); // 06:00 + 16h = 22:00
});
await page.waitForTimeout(900);
await page.screenshot({ path: outNight });

console.log('saved', outTown, outPlayer, outNight);
await browser.close();
