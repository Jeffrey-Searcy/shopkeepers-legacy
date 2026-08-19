/**
 * .tmp-player-shots.mjs — TEMPORARY verification script (delete after review).
 * Screenshots the new Sunnyside player: idle, walk both flips, up-motion facing persistence,
 * each tool action mid-swing, plus the town (now facade/NPC-free). Camera zoomed via __GAME__.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5273/?test=1&seed=42');
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });

const zoom = (z) =>
  page.evaluate((zz) => {
    const game = window.__GAME__;
    game.scene.getScene(window.__TEST__.activeScene()).cameras.main.setZoom(zz);
  }, z);
const input = (a) => page.evaluate((x) => window.__TEST__.input(x), a);
const stop = () => page.evaluate(() => window.__TEST__.stopMove());
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
};

// Clear ground on the farm, camera close.
await page.evaluate(() => window.__TEST__.teleport(30, 40, 'down'));
await page.waitForTimeout(900);
await zoom(4);
await page.waitForTimeout(300);
await shot('1-idle');

await input('move:right');
await page.waitForTimeout(500);
await shot('2-walk-right');
await stop();

await input('move:left');
await page.waitForTimeout(500);
await shot('3-walk-left');
await stop();

// Moving up must KEEP the left flip (side-view art has no up frames).
await input('move:up');
await page.waitForTimeout(500);
await shot('4-walk-up-keeps-left');
await stop();
await page.waitForTimeout(400);
await shot('5-idle-after-left');

// Tool actions: hotbar 0=hoe(dig) 1=axe(chop) 2=pickaxe(mine) 4=can(water).
for (const [slot, name] of [
  [0, '6-dig'],
  [1, '7-chop'],
  [2, '8-mine'],
  [4, '9-water'],
]) {
  await input(`hotbar:${slot}`);
  await page.waitForTimeout(150);
  await input('use-tool');
  await page.waitForTimeout(200); // mid-swing (~420ms anims)
  await shot(name);
  await page.waitForTimeout(600); // let the swing finish
}

// Town: warp over and take a wide shot — no facades, no NPCs.
await page.evaluate(() => window.__TEST__.teleport(98, 30, 'right'));
await page.waitForFunction(() => window.__TEST__.activeScene() === 'TownScene', undefined, {
  timeout: 15000,
});
await page.waitForTimeout(600);
await page.evaluate(() => window.__TEST__.teleport(40, 12, 'down'));
await page.waitForTimeout(900);
await shot('10-town-wide');
await zoom(3);
await page.waitForTimeout(300);
await shot('11-town-close');

await browser.close();
