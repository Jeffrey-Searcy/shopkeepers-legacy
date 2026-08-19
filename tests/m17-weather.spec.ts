/**
 * M17 — Weather: rain auto-waters overnight; rejected interior stays inaccessible.
 */
import { test, expect } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  act,
  setWeather,
  sleepInGame,
  activeScene,
} from './helpers/gameHarness';

const SLOT = { hoe: 0, seeds: 5 };

test('rain overnight waters unwatered crops and they grow', async ({ page }) => {
  await bootGame(page);

  // Till + plant on open farm grass — deliberately NEVER water it.
  await teleport(page, 55, 60, 'down');
  await act(page, `hotbar:${SLOT.hoe}`);
  await act(page, 'use-tool');
  await act(page, `hotbar:${SLOT.seeds}`);
  await act(page, 'use-tool');
  let s = await getState(page);
  const k = '55,61';
  expect(s.crops[k]).toBeTruthy();
  expect(s.crops[k].stage + s.crops[k].daysInStage).toBe(0); // no growth banked yet

  // Pin rain for tomorrow, then sleep.
  await setWeather(page, s.day + 1, 'rain');
  await sleepInGame(page);

  s = await getState(page);
  expect(s.weather).toBe('rain');
  // The crop grew overnight without manual watering (growth banked or stage advanced)...
  expect(s.crops[k].stage + s.crops[k].daysInStage).toBeGreaterThan(0);
  // ...and the morning rain has re-wet the soil (a free watering day).
  expect(s.tiles[k]).toBe('watered');
});

test('the Tavern door sleeps outside and never spawns the old farmhouse TV', async ({ page }) => {
  await bootGame(page);
  const day = (await getState(page)).day;
  await teleport(page, 72, 13, 'up');
  await act(page, 'interact');
  expect((await getState(page)).day).toBe(day + 1);
  expect(await activeScene(page)).toBe('FarmScene');
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
  expect(
    await page.evaluate(() =>
      window.__GAME__!.scene
        .getScene('FarmScene')
        .children.list.some((child) => (child as unknown as { texture?: { key?: string } }).texture?.key === 'tv')
    )
  ).toBe(false);
});
