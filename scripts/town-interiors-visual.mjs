/** Capture fixed world and Retina panel views for every expanded civic interior. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const OUTPUT = '.frontend-loop/town-interiors-complete-2026-09-15/screenshots';
const BUILDINGS = ['magic', 'forge', 'museum', 'clinic', 'guild', 'ranch', 'bar', 'carpenter', 'fishing', 'alchemy', 'tailor'];
await mkdir(OUTPUT, { recursive: true });
const server = await createServer({ cacheDir: 'output/town-interiors-vite-cache',
  server: { host: '127.0.0.1', port: 5278, strictPort: true } });
await server.listen();
const REVIEW_URL = 'http://127.0.0.1:5278/?test=1&renderer=webgl&seed=42';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

/** Enter one civic scene through the production transition system. */
async function enter(buildingId) {
  const scene = await page.evaluate(async id => {
    const { townBuilding } = await import('/src/config/TownBuildings.ts');
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    const building = townBuilding(id);
    transitionTo(window.__GAME__.scene.getScene(window.__TEST__.activeScene()), building.scene, 'entry');
    return building.scene;
  }, buildingId);
  await page.waitForFunction(key => window.__TEST__?.ready && window.__TEST__.activeScene() === key, scene);
  await page.waitForTimeout(50);
  return scene;
}

/** Move the keeper to a stable camera anchor before taking a WebGL screenshot. */
async function capture(name, tx, ty, facing) {
  await page.evaluate(point => window.__TEST__.teleport(point.tx, point.ty, point.facing), { tx, ty, facing });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUTPUT}/${name}.png` });
}

try {
  await page.goto(REVIEW_URL);
  await page.waitForFunction(() => window.__TEST__?.ready, undefined, { timeout: 20_000 });
  assert.equal(await page.evaluate(() => window.__GAME__.renderer.type), 2, 'Visual review requires WebGL');
  await page.evaluate(() => window.__TEST__.stepTime(180));
  for (const id of BUILDINGS) {
    const scene = await enter(id);
    const room = await page.evaluate(async buildingId => {
      const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
      const value = civicInteriorBlueprint(buildingId);
      return { spawn: value.spawn, serviceStand: value.serviceStand,
        threshold: value.privateThreshold, owner: (await import('/src/config/TownResidents.ts')).residentForBuilding(buildingId).id };
    }, id);
    await capture(`${id}-entry`, room.spawn.tx, room.spawn.ty, 'up');
    await capture(`${id}-service`, room.serviceStand.tx, room.serviceStand.ty, room.serviceStand.facing);
    await page.evaluate(owner => window.__TEST__.setResidentPoints(owner, 500), room.owner);
    await capture(`${id}-private-threshold`, room.threshold.tx, room.threshold.ty - 1, 'down');
    await page.evaluate(point => window.__TEST__.teleport(point.tx, point.ty, point.facing), room.serviceStand);
    await page.keyboard.press('e');
    await page.waitForFunction(buildingId => window.__TEST__.state().civicServiceBuilding === buildingId, id);
    await page.waitForFunction(buildingId => {
      const panel = window.__GAME__.scene.getScene('UIScene').children.getByName('civic-service-panel');
      return panel?.visible === true && panel.getData('building') === buildingId;
    }, id);
    await page.screenshot({ path: `${OUTPUT}/${id}-service-panel.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__TEST__.state().marketPanelOpen === false);
    assert.equal(await page.evaluate(key => window.__GAME__.scene.isActive(key), scene), true);
  }

  const retina = await browser.newContext({ viewport: { width: 800, height: 720 }, deviceScaleFactor: 2 });
  const retinaPage = await retina.newPage();
  retinaPage.on('pageerror', error => errors.push(`retina: ${error.message}`));
  await retinaPage.goto(REVIEW_URL);
  await retinaPage.waitForFunction(() => window.__TEST__?.ready, undefined, { timeout: 20_000 });
  for (const id of BUILDINGS) {
    const scene = await retinaPage.evaluate(async buildingId => {
      const { townBuilding } = await import('/src/config/TownBuildings.ts');
      const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
      const building = townBuilding(buildingId);
      transitionTo(window.__GAME__.scene.getScene(window.__TEST__.activeScene()), building.scene, 'entry');
      return building.scene;
    }, id);
    await retinaPage.waitForFunction(key => window.__TEST__?.ready && window.__TEST__.activeScene() === key, scene);
    await retinaPage.waitForTimeout(50);
    const stand = await retinaPage.evaluate(async buildingId => (await import('/src/config/CivicInteriors.ts'))
      .civicInteriorBlueprint(buildingId).serviceStand, id);
    await retinaPage.evaluate(point => window.__TEST__.teleport(point.tx, point.ty, point.facing), stand);
    await retinaPage.keyboard.press('e');
    await retinaPage.waitForFunction(buildingId => window.__TEST__.state().civicServiceBuilding === buildingId, id);
    await retinaPage.waitForFunction(buildingId => {
      const panel = window.__GAME__.scene.getScene('UIScene').children.getByName('civic-service-panel');
      return panel?.visible === true && panel.getData('building') === buildingId;
    }, id);
    await retinaPage.screenshot({ path: `${OUTPUT}/${id}-service-panel-retina.png` });
    await retinaPage.keyboard.press('Escape');
    await retinaPage.waitForFunction(() => window.__TEST__.state().marketPanelOpen === false);
  }
  await retina.close();
  assert.deepEqual(errors, [], 'Civic visual review encountered browser errors');
  process.stdout.write(`PASS: ${OUTPUT}\n`);
} finally {
  await browser.close();
  await server.close();
}
