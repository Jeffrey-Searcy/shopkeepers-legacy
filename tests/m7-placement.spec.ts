/**
 * M7 — Building placement (the seam Prompt-2 shops build on). Verifies:
 *  - a building placed on valid buildable tiles succeeds and persists in GameState.placements,
 *  - a second building overlapping the first is rejected,
 *  - placement off the buildable area (on the border) is rejected.
 * Placement is driven via the test seam (same call the carpenter/shop flow will use).
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, clearFarmResources } from './helpers/gameHarness';

/** Attempt a placement via the seam; returns whether it succeeded. */
async function place(
  page: import('@playwright/test').Page,
  type: string,
  tx: number,
  ty: number,
  w: number,
  h: number
): Promise<boolean> {
  return page.evaluate(([t, x, y, ww, hh]) => window.__TEST__!.place(t as string, x as number, y as number, ww as number, hh as number), [type, tx, ty, w, h] as const);
}

test('valid placement succeeds and persists', async ({ page }) => {
  await bootGame(page);
  // Prepare a harvested plot; approved authored trees are not implicitly empty test space.
  await clearFarmResources(page, { tx: 40, ty: 40, w: 3, h: 3 });
  const ok = await place(page, 'tavern', 40, 40, 3, 3);
  expect(ok).toBe(true);

  const s = await getState(page);
  const p = s.placements.find((p) => p.tx === 40 && p.ty === 40);
  expect(p).toBeTruthy();
  expect(p!.type).toBe('tavern');
  expect(p!.w).toBe(3);
  expect(p!.scene).toBe('FarmScene');
});

test('overlapping placement is rejected', async ({ page }) => {
  await bootGame(page);
  await clearFarmResources(page, { tx: 40, ty: 40, w: 3, h: 3 });
  expect(await place(page, 'tavern', 40, 40, 3, 3)).toBe(true);
  // Overlaps the first footprint (40..42) -> rejected.
  expect(await place(page, 'blacksmith', 41, 41, 3, 3)).toBe(false);

  const s = await getState(page);
  expect(s.placements.length).toBe(1); // only the first committed
});

test('placement on non-buildable border is rejected', async ({ page }) => {
  await bootGame(page);
  // Tile (0,0) is the solid border — not buildable.
  expect(await place(page, 'farm', 0, 0, 2, 2)).toBe(false);
  // Off the map entirely.
  expect(await place(page, 'farm', 999, 999, 2, 2)).toBe(false);

  const s = await getState(page);
  expect(s.placements.length).toBe(0);
});
