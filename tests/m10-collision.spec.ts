/**
 * M10 — Collision precision regression gates. The designer reported possibly walking through a tree.
 * These specs push the player INTO solid things for a full second and assert they're stopped:
 *  - a tree's base tile (1-tile trunk collision; walking behind the canopy is allowed by design),
 *  - the Tavern wall behind its walkable porch,
 *  - a placed chest (the farm ships no pre-placed chest, so the test places one first).
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, give, act, nodes, sendInput, stopMove, advanceFrames } from './helpers/gameHarness';
import { TILE } from '../src/config/GameConfig';

test('the player cannot walk through a tree trunk', async ({ page }) => {
  await bootGame(page);
  const all = await nodes(page);
  const occupied = new Set(all.map((n) => `${n.tx},${n.ty}`));
  // A tree with a clear tile on its left to stand on.
  const tree = all.find((n) => n.kind === 'tree' && !occupied.has(`${n.tx - 1},${n.ty}`))!;
  expect(tree).toBeTruthy();

  await teleport(page, tree.tx - 1, tree.ty, 'right');
  await sendInput(page, 'move:right');
  await advanceFrames(page, 1000); // shove into the trunk for a second
  await stopMove(page);

  const s = await getState(page);
  // Player center must still be LEFT of the tree tile's left edge (blocked by the trunk body).
  expect(s.player.x).toBeLessThan(tree.tx * TILE);
  expect(Math.floor(s.player.x / TILE)).toBe(tree.tx - 1);
});

test('the player cannot walk through the inherited Tavern wall', async ({ page }) => {
  await bootGame(page);
  // The facade wall is rows 9..12; row 13 is the intentionally walkable porch.
  await teleport(page, 71, 15, 'up');
  await sendInput(page, 'move:up');
  await advanceFrames(page, 1000);
  await stopMove(page);

  const s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBe(13);
});

test('walking up the path reaches the porch without entering the deferred interior', async ({ page }) => {
  await bootGame(page);
  // Start on the path and walk naturally up the centered steps onto the porch.
  await teleport(page, 72, 16, 'up');
  await sendInput(page, 'move:up');
  await advanceFrames(page, 1000);
  await stopMove(page);
  expect(Math.floor((await getState(page)).player.y / TILE)).toBe(13);
  expect((await getState(page)).activeScene).toBe('FarmScene');
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('the player cannot walk through a chest', async ({ page }) => {
  await bootGame(page);
  // Place a chest at (60,61) via the placement seam (the m11 flow), stand left of it, push right.
  await give(page, 'chest', 1);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await act(page, 'use-tool');

  await teleport(page, 59, 61, 'right');
  await sendInput(page, 'move:right');
  await advanceFrames(page, 1000);
  await stopMove(page);

  const s = await getState(page);
  expect(Math.floor(s.player.x / TILE)).toBe(59);
});

test('the shipping deposit trunk collider matches its art and blocks all four approaches', async ({ page }) => {
  await bootGame(page);
  const trunk = await page.evaluate(() => {
    const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      children: { list: Array<{ texture?: { key: string }; displayWidth: number; displayHeight: number; body?: { x: number; y: number; width: number; height: number } }> };
    };
    const bin = farm.children.list.find((child) => child.texture?.key === 'shipping-bin');
    if (!bin?.body) throw new Error('M10: shipping-bin body missing');
    return {
      displayWidth: bin.displayWidth,
      displayHeight: bin.displayHeight,
      bodyWidth: bin.body.width,
      bodyHeight: bin.body.height,
    };
  });
  expect(trunk).toEqual({ displayWidth: 40, displayHeight: 26, bodyWidth: 40, bodyHeight: 26 });

  const approaches = [
    { tx: 80, ty: 15, facing: 'up', action: 'move:up', side: 'bottom' },
    { tx: 80, ty: 10, facing: 'down', action: 'move:down', side: 'top' },
    { tx: 78, ty: 13, facing: 'right', action: 'move:right', side: 'left' },
    { tx: 83, ty: 13, facing: 'left', action: 'move:left', side: 'right' },
  ] as const;

  for (const approach of approaches) {
    await teleport(page, approach.tx, approach.ty, approach.facing);
    await sendInput(page, approach.action);
    await advanceFrames(page, 900);
    await stopMove(page);
    const bounds = await page.evaluate(() => {
      const farm = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
        player: { body: { x: number; y: number; width: number; height: number } };
        children: { list: Array<{ texture?: { key: string }; body?: { x: number; y: number; width: number; height: number } }> };
      };
      const bin = farm.children.list.find((child) => child.texture?.key === 'shipping-bin');
      if (!bin?.body) throw new Error('M10: shipping-bin body missing after movement');
      return {
        player: {
          x: farm.player.body.x,
          y: farm.player.body.y,
          width: farm.player.body.width,
          height: farm.player.body.height,
        },
        bin: { x: bin.body.x, y: bin.body.y, width: bin.body.width, height: bin.body.height },
      };
    });
    if (approach.side === 'bottom') {
      expect(bounds.player.y).toBeGreaterThanOrEqual(bounds.bin.y + bounds.bin.height);
    } else if (approach.side === 'top') {
      expect(bounds.player.y + bounds.player.height).toBeLessThanOrEqual(bounds.bin.y);
    } else if (approach.side === 'left') {
      expect(bounds.player.x + bounds.player.width).toBeLessThanOrEqual(bounds.bin.x);
    } else {
      expect(bounds.player.x).toBeGreaterThanOrEqual(bounds.bin.x + bounds.bin.width);
    }
  }
});
