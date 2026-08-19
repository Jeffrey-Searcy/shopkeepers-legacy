/**
 * shoot-world.mjs — walk the new world graph via the test seam and screenshot each new map at
 * player eye level (spawn areas, landmarks, warp mouths). Usage: node shoot-world.mjs <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5273/?test=1&seed=42');
await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30000 });

async function warp(tx, ty, facing, scene) {
  await page.evaluate(([x, y, f]) => window.__TEST__.teleport(x, y, f), [tx, ty, facing]);
  await page.waitForFunction(
    (s) => window.__TEST__.activeScene() === s,
    scene,
    { timeout: 15000 }
  );
  await page.waitForTimeout(600);
}

async function shot(tx, ty, facing, name) {
  await page.evaluate(([x, y, f]) => window.__TEST__.teleport(x, y, f), [tx, ty, facing]);
  await page.waitForTimeout(900); // camera lerp settles
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}

// Farm: the new causeway + south warp mouth.
await shot(21, 88, 'down', 'farm-causeway');

// Forest.
await warp(21, 99, 'down', 'ForestScene');
await shot(20, 6, 'down', 'forest-entry');
await shot(38, 30, 'down', 'forest-trail');
await shot(50, 46, 'down', 'forest-clearing');

// Back to farm, over to town.
await warp(18, 0, 'up', 'FarmScene');
await warp(98, 30, 'right', 'TownScene');
await shot(40, 8, 'up', 'town-north-road');

// Beach.
await warp(40, 59, 'down', 'BeachScene');
await shot(40, 6, 'down', 'beach-entry');
await shot(30, 26, 'down', 'beach-tidalpool');
await shot(55, 30, 'down', 'beach-shoreline');

// Mountain.
await warp(40, 0, 'up', 'TownScene');
await warp(40, 0, 'up', 'MountainScene');
await shot(40, 20, 'up', 'mountain-cave-approach');
await shot(48, 29, 'right', 'mountain-lake');
await shot(40, 50, 'down', 'mountain-south-road');

// Mines.
await warp(39, 12, 'up', 'MinesScene');
await shot(25, 5, 'up', 'mines-entrance');
await shot(25, 18, 'down', 'mines-cavern');
await shot(41, 28, 'down', 'mines-east-chamber');

// And climb back out to prove the ladder works.
await warp(25, 2, 'up', 'MountainScene');
console.log('ladder exit OK — back on the mountain');

await browser.close();
