/**
 * Tile settle glide regression gates (playtester report: "the tile is not center when im playing").
 *
 * The keeper walks freely, but after every stop the feet glide onto a tile center so the facing-tile
 * highlight sits squarely in front of the body. These specs pin:
 *  - settleTarget math: nearest center, with a small lean toward the last walking direction.
 *  - real stops in each direction end with the feet exactly on a tile center and stay there.
 *  - the facing tile at rest is exactly one tile from the feet tile, matching the body.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, sendInput, stopMove, advanceFrames } from './helpers/gameHarness';

/** True when a feet coordinate sits on a 16px tile center (16k + 8), allowing float noise. */
function onCenter(v: number): boolean {
  return Math.abs(((v - 8) % 16 + 16) % 16) < 0.01;
}

/**
 * Walk one direction for a short time, release, and wait for the settle glide to finish.
 *
 * @param page The game page.
 * @param dir Movement direction suffix for `move:<dir>`.
 * @param ms How long the direction is held.
 * @returns Feet positions sampled twice after the glide, to prove the keeper stays put.
 */
async function walkAndSettle(page: Page, dir: string, ms: number): Promise<{ x: number; y: number }[]> {
  await sendInput(page, `move:${dir}`);
  await advanceFrames(page, ms);
  await stopMove(page);
  await advanceFrames(page, 600);
  const first = (await getState(page)).player;
  await advanceFrames(page, 200);
  const second = (await getState(page)).player;
  return [{ x: first.x, y: first.y }, { x: second.x, y: second.y }];
}

test('settleTarget picks the nearest center and leans toward the walk', async ({ page }) => {
  await bootGame(page);
  const cases = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { settleTarget } = await import('/src/entities/Player.ts');
    return [
      settleTarget(100, 100, 0, 0), // tile 6 spans 96..111 → center 104
      settleTarget(111.9, 96, 0, 0), // still tile 6 on x; y at a tile edge → 104
      settleTarget(109, 104, 1, 0), // 109 + 4 = 113 → next tile center 120
      settleTarget(107, 104, 1, 0), // 107 + 4 = 111 → stays at 104
      settleTarget(99, 104, -1, 0), // 99 - 4 = 95 → previous tile center 88
      settleTarget(104, 115, 0, 1), // 115 + 4 = 119 → 120
    ];
  });
  expect(cases).toEqual([
    { x: 104, y: 104 },
    { x: 104, y: 104 },
    { x: 120, y: 104 },
    { x: 104, y: 104 },
    { x: 88, y: 104 },
    { x: 104, y: 120 },
  ]);
});

test('stopping in any direction lands the feet exactly on a tile center', async ({ page }) => {
  await bootGame(page);
  for (const [dir, ms] of [['right', 230], ['down', 170], ['left', 300], ['up', 140]] as const) {
    const [first, second] = await walkAndSettle(page, dir, ms);
    expect(onCenter(first.x), `${dir}: feet x ${first.x}`).toBe(true);
    expect(onCenter(first.y), `${dir}: feet y ${first.y}`).toBe(true);
    // No drift or jitter after the glide ends.
    expect(second).toEqual(first);
  }
});

test('at rest the facing tile is exactly one tile in front of the feet', async ({ page }) => {
  await bootGame(page);
  await walkAndSettle(page, 'right', 230);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { facingTile } = await import('/src/systems/InteractionSystem.ts');
    const p = window.__TEST__!.state().player as unknown as { x: number; y: number };
    return { feet: { x: p.x, y: p.y }, facing: facingTile() };
  });
  expect(result.facing).toEqual({ tx: (result.feet.x - 8) / 16 + 1, ty: (result.feet.y - 8) / 16 });
});
