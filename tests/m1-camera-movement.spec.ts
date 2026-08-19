/**
 * M1 — Big map + player + camera follow. Two permanent regression gates:
 *  - movement: holding a direction actually moves the player (input path works end to end).
 *  - camera-follow: after moving, the main camera has scrolled so the player stays roughly centered
 *    (this is the guard against the "camera didn't follow the player" failure).
 *  - map-bounds: the player cannot be pushed outside the (big) map.
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, sendInput, stopMove, advanceFrames, expectFinite } from './helpers/gameHarness';

test('holding a direction moves the player', async ({ page }) => {
  await bootGame(page);
  const before = await getState(page);

  await sendInput(page, 'move:right');
  await advanceFrames(page, 500);
  await stopMove(page);

  const after = await getState(page);
  expectFinite(after.player.x);
  expect(after.player.x).toBeGreaterThan(before.player.x);
});

test('camera follows the player (player stays near the center of the camera view)', async ({ page }) => {
  await bootGame(page);

  // Move a long way, then let the follow lerp settle.
  await sendInput(page, 'move:down');
  await sendInput(page, 'move:right');
  await advanceFrames(page, 1200);
  await stopMove(page);
  await advanceFrames(page, 1000); // let lerp settle onto the player

  // Use Phaser's worldView (the world rect the camera shows). "Camera follows player" means the
  // player sits near the center of that rect. This is the correct, zoom-safe way to assert it.
  const m = await page.evaluate(() => {
    const game = window.__GAME__!;
    const world = game.scene.getScenes(true).find((s) => s.scene.key !== 'UIScene')!;
    const cam = world.cameras.main;
    const st = window.__TEST__!.state() as unknown as { player: { x: number; y: number } };
    const wv = cam.worldView;
    return {
      contains: wv.contains(st.player.x, st.player.y),
      dx: Math.abs(st.player.x - wv.centerX),
      dy: Math.abs(st.player.y - wv.centerY),
      viewW: wv.width,
      viewH: wv.height,
    };
  });

  // The player is inside the camera view and within ~1/6 of the view size from its exact center
  // (allowing for the follow lerp's small trailing lag).
  expect(m.contains).toBe(true);
  expect(m.dx).toBeLessThan(m.viewW / 6);
  expect(m.dy).toBeLessThan(m.viewH / 6);
});

test('player cannot leave the map bounds', async ({ page }) => {
  await bootGame(page);

  // Shove up-left into the corner for a while; the world border collider must stop the player.
  await sendInput(page, 'move:up');
  await sendInput(page, 'move:left');
  await advanceFrames(page, 1500);
  await stopMove(page);

  const s = await getState(page);
  // With 16px tiles and a border tile at index 0, the player center stays >= ~1 tile in.
  expect(s.player.x).toBeGreaterThan(8);
  expect(s.player.y).toBeGreaterThan(8);
});
