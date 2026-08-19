/**
 * Capture the inherited-shop origin pages, Tavern arrival, and temporary upstairs for visual QA.
 * Usage: node scripts/visual-origin-shop.mjs round-01
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const round = process.argv[2] ?? 'round-01';
const output = '.frontend-loop/inherited-shop-origin/screenshots';
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });

/** Open a fresh empty-slot title context at one viewport. */
async function openMenu(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    for (let slot = 1; slot <= 3; slot++) localStorage.removeItem(`shopkeeperslegacy.save.v1.slot.${slot}`);
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5273/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  return { context, page };
}

const desktop = await openMenu(960, 540);
await desktop.page.keyboard.press('Enter');
await desktop.page.waitForFunction(() => {
  const menu = window.__GAME__.scene.getScene('MainMenuScene');
  return menu.children.getByName('origin-intro-root')?.visible === true;
});
await desktop.page.screenshot({ path: `${output}/${round}-letter-desktop.png` });
await desktop.page.keyboard.press('Enter');
await desktop.page.waitForTimeout(120);
await desktop.page.screenshot({ path: `${output}/${round}-departure-desktop.png` });
await desktop.page.keyboard.press('Enter');
await desktop.page.waitForTimeout(120);
await desktop.page.screenshot({ path: `${output}/${round}-choice-desktop.png` });
await desktop.page.keyboard.press('Enter');
await desktop.page.waitForFunction(() => window.__TEST__?.ready === true);
await desktop.page.evaluate(() => window.__TEST__.teleport(72, 15, 'up'));
await desktop.page.waitForTimeout(350);
await desktop.page.screenshot({ path: `${output}/${round}-tavern-exterior.png` });
await desktop.page.evaluate(() => window.__TEST__.teleport(72, 13, 'up'));
await desktop.page.waitForFunction(() => window.__TEST__?.activeScene() === 'HomeInteriorScene');
await desktop.page.waitForTimeout(250);
await desktop.page.screenshot({ path: `${output}/${round}-temporary-upstairs.png` });
await desktop.context.close();

const narrow = await openMenu(720, 540);
await narrow.page.keyboard.press('Enter');
await narrow.page.keyboard.press('Enter');
await narrow.page.keyboard.press('Enter');
await narrow.page.waitForTimeout(120);
await narrow.page.waitForFunction(() => {
  const menu = window.__GAME__.scene.getScene('MainMenuScene');
  return menu.children.getByName('origin-choice-root')?.visible === true;
});
await narrow.page.screenshot({ path: `${output}/${round}-choice-narrow.png` });
await narrow.context.close();

await browser.close();
console.log(`captured ${round} inherited-shop visual set`);
