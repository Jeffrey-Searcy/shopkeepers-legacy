import { teleportAtFarmShop } from './helpers/gameHarness';
/** Exercise connecting native art through real placement, removal, saves and scene texture cleanup. */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, teleport, aimWorldTile, getState } from './helpers/gameHarness';

/** Walk through the shop's actual threshold and wait until normal input is unlocked. */
async function enter(page: Page): Promise<void> {
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__TEST__!.activeScene() === 'TavernScene' && window.__TEST__!.ready &&
      !window.__TEST__!.state().transitionActive);
  } finally { await page.keyboard.up('w'); }
  await teleport(page, 14, 10, 'left');
}

/** Place one inventory piece using actual mouse/R input, not a direct scene or state insertion. */
async function place(page: Page, item: string, tx: number, ty: number, rotation = 0): Promise<void> {
  // A pickup plays the real axe swing; new clicks are intentionally ignored until it finishes.
  await page.waitForFunction(() => !(window.__GAME__!.scene.getScene('TavernScene') as Phaser.Scene &
    { player: { busy: boolean } }).player.busy);
  await page.evaluate(item => { window.__TEST__!.give(item, 1); window.__TEST__!.startPlacing(item); }, item);
  if (rotation) await page.keyboard.press('r');
  await aimWorldTile(page, tx, ty);
  await page.mouse.down(); await page.mouse.up();
  await expect.poll(async () => (await getState(page)).placedItems).toContainEqual({ item, tx, ty, rotation, scene: 'TavernScene' });
}

/** Read the real composed image's native pixels and body, rather than reproducing rendering in the test. */
async function surface(page: Page, item: string, tx: number, ty: number) {
  return page.evaluate(({ item, tx, ty }) => {
    const scene = window.__GAME__!.scene.getScene('TavernScene');
    const image = scene.children.getByName(`furniture-${item}-${tx}-${ty}`) as Phaser.GameObjects.Image;
    const texture = image.texture as Phaser.Textures.CanvasTexture;
    const data = texture.getContext().getImageData(0, 0, texture.width, texture.height).data;
    return { pixels: Array.from(data), width: texture.width, height: texture.height, scaleX: image.scaleX, scaleY: image.scaleY,
      textures: scene.textures.getTextureKeys().filter(key => key.startsWith('furniture-surface:TavernScene:')) };
  }, { item, tx, ty });
}

test('tabletop turns exactly90 degrees while its feet stay below the new front edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await bootGame(page); await enter(page);
  await place(page, 'table', 6, 8);
  await place(page, 'table', 10, 8, 1);
  const horizontal = await surface(page, 'table', 6, 8);
  const vertical = await surface(page, 'table', 10, 8);
  expect([horizontal.width, horizontal.height, vertical.width, vertical.height]).toEqual([32, 21, 16, 37]);
  const expectedTop: number[] = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
    const offset = ((15 - x) * 32 + y) * 4;
    expectedTop.push(...horizontal.pixels.slice(offset, offset + 4));
  }
  expect(vertical.pixels.slice(0, 16 * 32 * 4)).toEqual(expectedTop);
  // The apron/feet are outside the rotated top. Both sides have an upright support below it.
  for (const [start, end] of [[0, 8], [8, 16]]) {
    const footAlpha: number[] = [];
    for (let y = 33; y < 37; y++) for (let x = start; x < end; x++) footAlpha.push(vertical.pixels[(y * 16 + x) * 4 + 3]);
    expect(footAlpha).toContain(255);
  }
});

for (const item of ['table', 'rug']) {
  test(`${item} joins native edges, restores them after pickup, reloads a corner and releases textures`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await bootGame(page); await enter(page);
    await place(page, item, 6, 8);
    const isolated = await surface(page, item, 6, 8);
    expect(isolated.scaleX).toBe(1); expect(isolated.scaleY).toBe(1);
    expect(isolated.pixels[(8 * 32 + 31) * 4 + 3]).toBe(0);
    await place(page, item, 8, 8);
    const joined = await surface(page, item, 6, 8);
    expect(joined.pixels[(8 * 32 + 31) * 4 + 3]).toBe(255);
    expect((await surface(page, item, 8, 8)).pixels[(8 * 32) * 4 + 3]).toBe(255);
    if (item === 'table') {
      // The old perimeter condition accidentally planted legs at EVERY internal tile boundary.
      for (const x of [13, 18, 29]) expect(joined.pixels[(20 * 32 + x) * 4 + 3], `no inner foot at ${x}`).toBe(0);
    } else {
      // The inset border must not repeat as gold stripes inside the connected fabric.
      for (let y = 8; y < 24; y++) for (let x = 24; x < 32; x++) {
        expect(joined.pixels[(y * 32 + x) * 4 + 1]).toBeLessThan(100);
        expect(joined.pixels[(y * 32 + x) * 4 + 3]).toBe(255);
      }
    }
    await teleport(page, 9, item === 'table' ? 9 : 10, 'up');
    await page.mouse.move(0, 0); await page.keyboard.press('2'); await page.keyboard.press('Space');
    await expect.poll(async () => (await getState(page)).placedItems).toHaveLength(1);
    expect((await surface(page, item, 6, 8)).pixels).toEqual(isolated.pixels);
    expect((await surface(page, item, 6, 8)).textures).not.toContain(`furniture-surface:TavernScene:${item}:8:8`);
    await teleport(page, 14, 10, 'left');
    await place(page, item, 8, 8);
    await place(page, item, 6, item === 'table' ? 9 : 10, item === 'table' ? 1 : 0);
    const corner = await surface(page, item, 6, 8);
    if (item === 'rug') {
      // The inset trim must turn continuously around the missing southeast quarter of the block.
      for (let p = 25; p < 32; p++) {
        expect(corner.pixels[(25 * 32 + p) * 4 + 1]).toBeGreaterThan(120);
        expect(corner.pixels[(p * 32 + 25) * 4 + 1]).toBeGreaterThan(120);
      }
      for (let y = 28; y < 32; y++) for (let x = 28; x < 32; x++) {
        expect(corner.pixels[(y * 32 + x) * 4 + 3]).toBe(0);
      }
    }
    await page.evaluate(async () => {
      // @ts-expect-error Import the running Vite save authority, not a Node-side duplicate.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      SaveSystem.save(3, 999);
    });
    await page.goto('/?test=1&menu=1');
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TavernScene' &&
      !window.__TEST__!.state().transitionActive);
    expect((await getState(page)).placedItems).toHaveLength(3);
    expect((await surface(page, item, 6, 8)).pixels).toEqual(corner.pixels);
    await page.evaluate(item => { window.__TEST__!.give(item, 1); window.__TEST__!.startPlacing(item); }, item);
    for (const tx of [10, 11, 12, 13, 14]) await aimWorldTile(page, tx, 6);
    expect((await surface(page, item, 6, 8)).textures).toHaveLength(4); // Three placements, one reusable preview.
    await page.keyboard.press('e'); // E cancels placement; Escape opens the pause menu.
    await teleport(page, 14, 17, 'down'); await page.keyboard.down('s');
    try { await page.waitForFunction(() => window.__TEST__!.activeScene() === 'FarmScene' && window.__TEST__!.ready); }
    finally { await page.keyboard.up('s'); }
    expect(await page.evaluate(() => window.__GAME__!.textures.getTextureKeys()
      .filter(key => key.startsWith('furniture-surface:TavernScene:')))).toEqual([]);
  });
}
