/**
 * Player navigation art regression: one coherent sheet supplies every cardinal walk and idle.
 */
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import { advanceFrames, bootGame, sendInput, stopMove } from './helpers/gameHarness';

interface PlayerVisual {
  texture: string;
  animation: string | null;
  flipX: boolean;
  facing: string;
}

/** Read the live player sprite through the documented raw-game test escape hatch. */
async function playerVisual(page: Page): Promise<PlayerVisual> {
  return page.evaluate(() => {
    const game = window.__GAME__;
    if (!game) throw new Error('player-animation: window.__GAME__ is unavailable');
    const world = game.scene.getScenes(true).find((scene) => scene.scene.key !== 'UIScene');
    if (!world) throw new Error('player-animation: no active world scene');
    const sprite = world.children.list.find((child) => {
      const candidate = child as Phaser.Physics.Arcade.Sprite;
      return candidate.texture?.key.startsWith('player') && candidate.body !== null;
    }) as Phaser.Physics.Arcade.Sprite | undefined;
    if (!sprite) throw new Error('player-animation: player sprite not found');
    return {
      texture: sprite.texture.key,
      animation: sprite.anims.currentAnim?.key ?? null,
      flipX: sprite.flipX,
      facing: window.__TEST__!.state().player.facing,
    };
  });
}

/** Wait until animation state reaches the expected real runtime state without a fixed sleep guess. */
async function expectPlayerVisual(page: Page, expected: Partial<PlayerVisual>): Promise<void> {
  await expect
    .poll(() => playerVisual(page), { timeout: 1_000, intervals: [20, 40, 80] })
    .toMatchObject(expected);
}

test('up, down, left, and right use matching rows from one navigation sheet', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await bootGame(page);
  await advanceFrames(page, 100);
  let visual = await playerVisual(page);
  expect(visual).toMatchObject({ texture: 'player-navigation', animation: 'player-idle-down', flipX: false });

  await sendInput(page, 'move:up');
  await advanceFrames(page, 120);
  await expectPlayerVisual(page, { texture: 'player-navigation', animation: 'player-walk-up', facing: 'up', flipX: false });
  await page.screenshot({
    path: '.frontend-loop/inventory-dragdrop/screenshots/player-facing-up.png',
    clip: { x: 400, y: 190, width: 160, height: 160 },
  });
  await stopMove(page);
  await expectPlayerVisual(page, { texture: 'player-navigation', animation: 'player-idle-up' });

  await sendInput(page, 'move:down');
  await advanceFrames(page, 120);
  await expectPlayerVisual(page, { texture: 'player-navigation', animation: 'player-walk-down', facing: 'down' });
  await page.screenshot({
    path: '.frontend-loop/inventory-dragdrop/screenshots/player-facing-down.png',
    clip: { x: 400, y: 190, width: 160, height: 160 },
  });
  await stopMove(page);

  await sendInput(page, 'move:right');
  await advanceFrames(page, 120);
  await expectPlayerVisual(page, { texture: 'player-navigation', animation: 'player-walk-right', facing: 'right', flipX: false });
  await page.screenshot({
    path: '.frontend-loop/inventory-dragdrop/screenshots/player-facing-right.png',
    clip: { x: 400, y: 190, width: 160, height: 160 },
  });
  await stopMove(page);

  await sendInput(page, 'move:left');
  await advanceFrames(page, 120);
  await expectPlayerVisual(page, { texture: 'player-navigation', animation: 'player-walk-left', facing: 'left', flipX: false });
  await page.screenshot({
    path: '.frontend-loop/inventory-dragdrop/screenshots/player-facing-left.png',
    clip: { x: 400, y: 190, width: 160, height: 160 },
  });
  await stopMove(page);
});
