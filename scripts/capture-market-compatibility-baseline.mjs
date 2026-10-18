/**
 * Capture the pre-rebuild civic-room contract and one exact Market save envelope.
 * Run this once before changing Market geometry. The resulting artifact is test input, not save data.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const GAME_URL = 'http://127.0.0.1:5273';
const OUTPUT = new URL('../planning_artifacts/town-interiors-market-proof/compatibility/baseline.json', import.meta.url);

/** Return a stable SHA-256 signature for a JSON-safe value. */
function signature(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Capture exact browser-served data so Vite resolves the same TypeScript modules as the game. */
async function capture() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${GAME_URL}/?test=1&seed=42`);
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 20_000 });
    const data = await page.evaluate(async () => {
      const { TOWN_BUILDINGS } = await import('/src/config/TownBuildings.ts');
      const { CIVIC_FEATURES } = await import('/src/config/CivicFeatures.ts');
      const { getMapData } = await import('/src/world/MapDef.ts');
      const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');

      const rooms = Object.fromEntries(TOWN_BUILDINGS.filter(building => building.id !== 'market').map(building => {
        const map = getMapData(building.scene);
        return [building.id, {
          room: building.room,
          features: CIVIC_FEATURES[building.id],
          geometry: { w: map.w, h: map.h, solid: map.solid, buildable: map.buildable,
            spawns: map.spawns, warps: map.warps, reservedTiles: map.reservedTiles },
        }];
      }));

      transitionTo(window.__GAME__.scene.getScene(window.__TEST__.activeScene()), 'TownMarketScene', 'entry');
      return rooms;
    });
    await page.waitForFunction(() => window.__TEST__?.ready && window.__TEST__.activeScene() === 'TownMarketScene');
    await page.evaluate(() => window.__TEST__.teleport(10, 12, 'down'));
    const market = await page.evaluate(async () => {
      const { GameState } = await import('/src/state/GameState.ts');
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      const { townBuilding } = await import('/src/config/TownBuildings.ts');
      const { CIVIC_FEATURES } = await import('/src/config/CivicFeatures.ts');
      const { getMapData } = await import('/src/world/MapDef.ts');
      const building = townBuilding('market'), map = getMapData(building.scene);
      SaveSystem.save(3, 946684800000);
      const rawSave = localStorage.getItem(SaveSystem.storageKey(3));
      if (rawSave === null) throw new Error('Compatibility baseline: Market save was not written');
      return {
        position: { ...GameState.instance.player },
        rawSave,
        room: building.room,
        features: CIVIC_FEATURES.market,
        geometry: { w: map.w, h: map.h, solid: map.solid, buildable: map.buildable,
          spawns: map.spawns, warps: map.warps, reservedTiles: map.reservedTiles },
      };
    });
    return { capturedAt: new Date().toISOString(), viewport: { width: 1280, height: 720 }, market, rooms: data };
  } finally {
    await browser.close();
  }
}

const baseline = await capture();
const roomSignatures = Object.fromEntries(Object.entries(baseline.rooms).map(([id, value]) => [id, signature(value)]));
const artifact = { ...baseline, roomSignatures };
await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${OUTPUT.pathname}\n${JSON.stringify(roomSignatures, null, 2)}\n`);
