/** Capture deterministic visual QA evidence for the title/save and pause-menu surfaces. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDir = resolve('.frontend-loop/save-menus/screenshots');
const round = process.argv[2] ?? 'round-01';
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function openMenu(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5273/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  return { context, page };
}

const desktop = await openMenu({ width: 1100, height: 700 });
await desktop.page.evaluate(async () => {
  const { GameState } = await import('/src/state/GameState.ts');
  const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
  for (let slot = 1; slot <= 3; slot++) localStorage.removeItem(`shopkeeperslegacy.save.v1.slot.${slot}`);
  SaveSystem.beginNewGame(1);
  const gs = GameState.instance;
  gs.day = 12;
  gs.timeOfDay = 335;
  gs.gold = 1840;
  gs.activeScene = 'TownScene';
  gs.player = { x: 488, y: 344, facing: 'down', stamina: 68 };
  SaveSystem.saveCurrent(1_786_100_000_000);
  localStorage.setItem(SaveSystem.storageKey(2), '{ broken save');
});
await desktop.page.reload();
await desktop.page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
await desktop.page.screenshot({ path: `${outputDir}/${round}-title-mixed-desktop.png` });

await desktop.page.keyboard.press('ArrowRight');
await desktop.page.keyboard.press('Delete');
await desktop.page.screenshot({ path: `${outputDir}/${round}-delete-confirm-desktop.png` });
await desktop.page.keyboard.press('Escape');
await desktop.page.keyboard.press('ArrowLeft');
await desktop.page.keyboard.press('Enter');
await desktop.page.waitForFunction(() => window.__TEST__?.ready === true);
await desktop.page.keyboard.press('Escape');
await desktop.page.waitForFunction(() => window.__TEST__?.state().paused === true);
await desktop.page.screenshot({ path: `${outputDir}/${round}-pause-desktop.png` });
await desktop.page.keyboard.press('ArrowDown');
await desktop.page.keyboard.press('Enter');
await desktop.page.screenshot({ path: `${outputDir}/${round}-save-feedback-desktop.png` });
await desktop.page.keyboard.press('ArrowDown');
await desktop.page.keyboard.press('Enter');
await desktop.page.screenshot({ path: `${outputDir}/${round}-title-confirm-desktop.png` });

const narrow = await openMenu({ width: 620, height: 700 });
await narrow.page.evaluate(() => {
  localStorage.setItem(
    'shopkeeperslegacy.save.v1.slot.2',
    localStorage.getItem('shopkeeperslegacy.save.v1.slot.1') ?? '{ broken save'
  );
});
await narrow.page.reload();
await narrow.page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
await narrow.page.screenshot({ path: `${outputDir}/${round}-title-narrow.png` });

await desktop.context.close();
await narrow.context.close();
await browser.close();
