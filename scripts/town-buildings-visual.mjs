/** Isolated production-renderer review: native civic doors, atlas props and residents at desktop/Retina sizes. */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const output = 'output/playwright/town-buildings-webgl';
mkdirSync(output, { recursive: true });
// Strict port ownership prevents attaching to or restarting the player's development server.
const server = await createServer({ cacheDir: 'output/personality-vite-cache', server: { port: 5276, strictPort: true } });
await server.listen();
const browser = await chromium.launch();

/** Hold a real movement key until the destination owns a ready player, always releasing that key. */
async function walk(page, key, target) {
  await page.keyboard.down(key);
  try { await page.waitForFunction(target => window.__TEST__.ready && window.__TEST__.activeScene() === target, target); }
  finally { await page.keyboard.up(key); }
}

try {
  for (const size of [{ width: 1280, height: 720, dpr: 1 }, { width: 800, height: 700, dpr: 2 }]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5276/?test=1&renderer=webgl&seed=42');
    await page.waitForFunction(() => window.__TEST__?.ready, undefined, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__GAME__.renderer.type), 2, 'Review must use WebGL');
    await page.evaluate(() => window.__TEST__.teleport(95, 30, 'right'));
    await walk(page, 'd', 'TownScene');
    const buildings = await page.evaluate(async () => (await import('/src/config/TownBuildings.ts')).TOWN_BUILDINGS);
    for (const building of buildings) {
      const door = await page.evaluate(async target => (await import('/src/world/MapDef.ts')).getMapData('TownScene').warps.find(warp => warp.target === target), building.scene);
      await page.evaluate(door => window.__TEST__.teleport(door.tx, door.ty + 2, 'up'), door);
      await page.waitForTimeout(650); // Presentation-only settling; transition assertions use readiness, never a sleep.
      await page.screenshot({ path: `${output}/${size.width}-${building.id}-exterior.png` });
      await walk(page, 'w', building.scene);
      await page.evaluate(building => window.__TEST__.teleport(Math.floor(building.room.w / 2), 7, 'up'), building);
      await page.waitForTimeout(650);
      await page.screenshot({ path: `${output}/${size.width}-${building.id}-interior.png` });
      const actor = await page.evaluate(async building => {
        const { residentForBuilding } = await import('/src/config/TownResidents.ts');
        const resident = residentForBuilding(building.id), scene = window.__GAME__.scene.getScene(building.scene);
        const sprite = scene.children.getByName(`town-resident-${resident.id}`);
        return { name: sprite.getData('residentName'), visible: sprite.visible, texture: sprite.texture.key };
      }, building);
      assert.equal(actor.visible, true); assert.match(actor.texture, /^town-resident-/);
      await page.evaluate(building => window.__TEST__.teleport(Math.floor(building.room.w / 2) - 1, building.room.h - 3, 'down'), building);
      await walk(page, 's', 'TownScene');
      console.log(`${size.width}px DPR${size.dpr}: ${building.id} native WebGL round trip and resident rendered`);
    }
    assert.deepEqual(errors, [], 'No browser runtime errors during the production-renderer review');
    await context.close();
  }
  console.log('PASS: 24 WebGL civic round trips, twelve residents at both sizes, 52 screenshots, no browser errors.');
} finally {
  await browser.close();
  await server.close();
}
