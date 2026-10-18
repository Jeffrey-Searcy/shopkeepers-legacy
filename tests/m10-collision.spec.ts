/**
 * M10 — Collision precision regression gates. The designer reported possibly walking through a tree.
 * These specs push the player INTO solid things for a full second and assert they're stopped:
 *  - a tree's base tile (1-tile trunk collision; walking behind the canopy is allowed by design),
 *  - the shop wall behind its walkable porch, with its central walk-in door kept open,
 *  - a placed chest (the farm ships no pre-placed chest, so the test places one first).
 */
import { test, expect } from '@playwright/test';
import { bootGame, getState, teleport, give, act, nodes, sendInput, stopMove, advanceFrames, aimWorldTile, farmLayout, teleportAtFarmShop } from './helpers/gameHarness';
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

test('the player cannot walk through the inherited shop wall from its porch', async ({ page }) => {
  await bootGame(page);
  const { door } = await farmLayout(page);
  // The porch lies one tile south of the named door; the adjacent wall stays solid.
  // Start on the deck: approaching from grass now hits the raised stone face before the wall.
  await teleportAtFarmShop(page, -1, 1, 'up');
  await sendInput(page, 'move:up');
  await advanceFrames(page, 1000);
  await stopMove(page);

  const s = await getState(page);
  expect(Math.floor(s.player.y / TILE)).toBe(door.ty + 1);
});

test('walking up the path crosses the porch and enters the shop without the rejected legacy interior', async ({ page }) => {
  await bootGame(page);
  // Start on the path and walk naturally up the centered steps onto the porch.
  await teleportAtFarmShop(page, 0, 4, 'up');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready);
  } finally { await page.keyboard.up('w'); }
  expect((await getState(page)).activeScene).toBe('TavernScene');
  expect((await getState(page)).player).toMatchObject({ x: 232, y: 248 });
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('the player cannot walk through a chest', async ({ page }) => {
  await bootGame(page);
  // Place a chest at (60,61) via the placement seam (the m11 flow), stand left of it, push right.
  await give(page, 'chest', 1);
  await teleport(page, 60, 60, 'down');
  await page.evaluate(() => window.__TEST__!.startPlacing('chest'));
  await aimWorldTile(page, 60, 61);
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

  const { bin } = await farmLayout(page);
  const approaches = [
    { tx: bin.tx, ty: bin.ty + 2, facing: 'up', action: 'move:up', side: 'bottom' },
    { tx: bin.tx, ty: bin.ty - 3, facing: 'down', action: 'move:down', side: 'top' },
    { tx: bin.tx - 2, ty: bin.ty, facing: 'right', action: 'move:right', side: 'left' },
    { tx: bin.tx + 3, ty: bin.ty, facing: 'left', action: 'move:left', side: 'right' },
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
