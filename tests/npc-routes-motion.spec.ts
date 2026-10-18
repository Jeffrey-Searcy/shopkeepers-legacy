/** Focused regressions for continuous outdoor travel and room-scale indoor resident roaming. */
import { expect, test } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';
import type { TownBuilding } from '../src/config/TownBuildings';

test('outdoor route sampling preserves fractional game time instead of snapping once per minute', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { residentRoutePlanForDay } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { compileTownRouteSegment, sampleTownRouteDay } = await import('/src/systems/TownRoutePlanSystem.ts');
    const map = getMapData(SceneKey.Town), plan = residentRoutePlanForDay('nyra', 1, map);
    const targetIndex = plan.stops.findIndex((stop: { arrive: number }, index: number) => index > 0
      && stop.arrive - plan.stops[index - 1].leave >= 10
      && compileTownRouteSegment(map, plan.stops[index - 1], stop).length >= 8);
    if (targetIndex < 1) throw new Error('Nyra needs one ten-minute travel segment');
    const previous = plan.stops[targetIndex - 1], target = plan.stops[targetIndex];
    const start = previous.leave + (target.arrive - previous.leave) * 0.35;
    const first = sampleTownRouteDay(plan, map, start);
    const second = sampleTownRouteDay(plan, map, start + 0.25);
    return { first, second, distance: Math.hypot(second.x - first.x, second.y - first.y) };
  });
  expect(result.first.moving).toBe(true);
  expect(result.second.moving).toBe(true);
  expect(result.distance).toBeGreaterThan(0);
  expect(result.distance).toBeLessThanOrEqual(2);
});

test('all civic rooms compile broad cardinal roaming loops with four pause destinations', async ({ page }) => {
  await bootGame(page);
  const routes = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { TOWN_BUILDINGS } = await import('/src/config/TownBuildings.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
    // @ts-expect-error Vite serves runtime source modules to browser tests.
    const { residentRoute } = await import('/src/entities/TownResident.ts');
    return TOWN_BUILDINGS.map((building: TownBuilding, index: number) => {
      const map = getMapData(building.scene);
      const anchor = civicInteriorBlueprint(building.id).residentRoute;
      const route = residentRoute(map, anchor, index);
      const unique = new Set(route.map((point: { tx: number; ty: number }) => `${point.tx},${point.ty}`));
      const minX = Math.min(...route.map((point: { tx: number }) => point.tx));
      const maxX = Math.max(...route.map((point: { tx: number }) => point.tx));
      const minY = Math.min(...route.map((point: { ty: number }) => point.ty));
      const maxY = Math.max(...route.map((point: { ty: number }) => point.ty));
      const invalid = route.filter((point: { tx: number; ty: number }) => map.solid[point.ty][point.tx]
        || map.ground[point.ty][point.tx] === 'water' || map.warps.some((warp: { tx: number; ty: number; w: number; h: number }) =>
          point.tx >= warp.tx && point.tx < warp.tx + warp.w && point.ty >= warp.ty && point.ty < warp.ty + warp.h)).length;
      const discontinuities = route.filter((point: { tx: number; ty: number }, routeIndex: number) => {
        const next = route[(routeIndex + 1) % route.length];
        return Math.abs(next.tx - point.tx) + Math.abs(next.ty - point.ty) !== 1;
      }).length;
      return { id: building.id, unique: unique.size, width: maxX - minX + 1, height: maxY - minY + 1,
        pauses: route.filter((point: { pauseMs: number }) => point.pauseMs > 0).length,
        invalidPauses: route.filter((point: { pauseMs: number }) => point.pauseMs < 0
          || (point.pauseMs > 0 && point.pauseMs < 1000)).length,
        invalid, discontinuities };
    });
  });
  expect(routes).toHaveLength(12);
  for (const route of routes) {
    expect(route.unique, route.id).toBeGreaterThanOrEqual(16);
    expect(route.width, route.id).toBeGreaterThanOrEqual(5);
    expect(route.height, route.id).toBeGreaterThanOrEqual(4);
    expect(route.pauses, route.id).toBe(4);
    expect(route.invalidPauses, route.id).toBe(0);
    expect(route.invalid, route.id).toBe(0);
    expect(route.discontinuities, route.id).toBe(0);
  }
});
