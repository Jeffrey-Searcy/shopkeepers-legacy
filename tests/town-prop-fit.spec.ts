/** Public furnishing art stays close to its actual tile collision, preventing invisible wide barriers. */
import { expect, test } from '@playwright/test';
import { TOWN_BUILDINGS } from '../src/config/TownBuildings';
import { bootGame } from './helpers/gameHarness';

test('every civic atlas prop fits its solid floor footprint without broad invisible side margins', async ({ page }) => {
  await bootGame(page);
  for (const building of TOWN_BUILDINGS) {
    await page.evaluate(async target => {
      // @ts-expect-error Vite resolves runtime modules in the isolated game.
      const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
      transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), target, 'entry');
    }, building.scene);
    await page.waitForFunction(scene => window.__TEST__!.ready && window.__TEST__!.activeScene() === scene, building.scene);
    const measurements = await page.evaluate(async ({ id, key }) => {
      // @ts-expect-error Vite resolves the actual public feature catalog.
      const { CIVIC_FEATURES } = await import('/src/config/CivicFeatures.ts');
      // @ts-expect-error Vite resolves the actual collision map.
      const { getMapData } = await import('/src/world/MapDef.ts');
      const map = getMapData(key), scene = window.__GAME__!.scene.getScene(key);
      return CIVIC_FEATURES[id].filter((feature: { kind: string }) => !['bed', 'shelf'].includes(feature.kind))
        .map((feature: { kind: string; tx: number; ty: number; w: number; h: number }) => {
          const sprite = scene.children.getByName(`civic-feature-${id}-${feature.kind}-${feature.tx}`) as Phaser.GameObjects.Image;
          let solid = true;
          for (let y = feature.ty; y < feature.ty + feature.h; y++) for (let x = feature.tx; x < feature.tx + feature.w; x++) solid &&= map.solid[y][x];
          return { kind: feature.kind, solid, gap: feature.w * 16 - sprite.displayWidth,
            x: sprite.x, expectedX: (feature.tx + feature.w / 2) * 16,
            bottom: sprite.y, expectedBottom: (feature.ty + feature.h) * 16,
            height: sprite.displayHeight, texture: sprite.texture.key };
        });
    }, { id: building.id, key: building.scene });
    for (const measure of measurements) {
      expect(measure.texture).toBe('town-interior-props');
      expect(measure.solid).toBe(true);
      expect(measure.gap, `${building.id}/${measure.kind} invisible side width`).toBeLessThanOrEqual(8);
      expect(measure.gap).toBeGreaterThanOrEqual(0);
      expect(measure.height).toBeLessThanOrEqual(44);
      expect(measure.x).toBe(measure.expectedX); expect(measure.bottom).toBe(measure.expectedBottom);
    }
  }
});
