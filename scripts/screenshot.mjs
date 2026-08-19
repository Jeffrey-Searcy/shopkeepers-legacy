/**
 * screenshot.mjs — boot the game in a headless browser and capture the canvas so we can LOOK at the
 * real PixelLab art in-scene (ART_BIBLE: "look at what you generate"). Saves to scratch path arg.
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/tmp/shot.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5273/?test=1&seed=42');
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });
// Teleport near some trees/rocks so the screenshot shows objects + player + terrain together.
await page.evaluate(() => window.__TEST__.teleport(20, 20, 'down'));
await page.waitForTimeout(1500); // let camera settle + a couple frames render
await page.screenshot({ path: out });
console.log('screenshot saved to', out);
await browser.close();
