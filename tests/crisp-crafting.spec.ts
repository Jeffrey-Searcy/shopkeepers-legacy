/** Real-device text rasterization and recipe-book input/atomic failure regression checks. */
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, uiCanvasPoint } from './helpers/gameHarness';

/** Open only the UI fixture; station access is covered by workbench and player-built-shop suites. */
async function openRecipes(page: Page, wood: number): Promise<void> {
  await page.evaluate(async wood => {
    // @ts-expect-error Vite serves runtime TypeScript to this isolated browser context.
    const { GameState } = await import('/src/state/GameState.ts');
    if (wood > 0) GameState.instance.addItem('wood', wood);
    GameState.instance.craftingOpen = true;
  }, wood);
  await page.waitForFunction(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('crafting-panel');
    return (root as unknown as { visible: boolean }).visible;
  });
}

/** Read named text within the visible recipe book, including its live detail container. */
async function recipeText(page: Page, name: string): Promise<string> {
  return page.evaluate(name => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('crafting-panel');
    type Node = { name: string; text?: string; list?: Node[] };
    const search = (node: Node): string | null => {
      if (node.name === name && typeof node.text === 'string') return node.text;
      if (node.list) for (const child of node.list) { const text = search(child); if (text !== null) return text; }
      return null;
    };
    const found = search(root as unknown as Node);
    if (found === null) throw new Error(`Recipe label ${name} is missing`);
    return found;
  }, name);
}

test('recipe selection previews ingredients; Enter crafts once and the modal shields world input', async ({ page }) => {
  await bootGame(page);
  await openRecipes(page, 44);
  await expect.poll(() => recipeText(page, 'crafting-ingredient-wood')).toBe('44 / 20');
  const before = await getState(page);
  // Clicking the table pocket selects it; it must not spend its12wood yet.
  const pocket = await uiCanvasPoint(page, { x: 262, y: 193 });
  await page.mouse.click(pocket.x, pocket.y);
  await expect.poll(() => recipeText(page, 'crafting-ingredient-wood')).toBe('44 / 12');
  expect((await getState(page)).inventory.wood).toBe(44);
  await page.keyboard.down('Enter');
  await expect.poll(async () => (await getState(page)).inventory.table).toBe(1);
  await page.keyboard.down('Enter'); // Native repeat must not create a second table.
  await page.keyboard.up('Enter');
  expect((await getState(page)).inventory.wood).toBe(32);
  await expect.poll(() => recipeText(page, 'crafting-note')).toContain('Made 1 Table');
  const shade = await uiCanvasPoint(page, { x: 30, y: 270 });
  await page.mouse.click(shade.x, shade.y);
  await page.mouse.wheel(0, 100);
  await page.keyboard.down('KeyW');
  await page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0;
    const frame = (): void => { if (++frames === 4) resolve(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  await page.keyboard.up('KeyW');
  const after = await getState(page);
  expect(after.player).toEqual(before.player);
  expect(after.hotbarIndex).toBe(before.hotbarIndex);
  expect(after.tiles).toEqual(before.tiles);
  expect(after.placedItems).toEqual(before.placedItems);
});

test('missing ingredients and full pockets give different messages without partial deductions', async ({ page }) => {
  await bootGame(page);
  await openRecipes(page, 0);
  await page.keyboard.press('Enter');
  await expect.poll(() => recipeText(page, 'crafting-note')).toContain('missing materials');
  await page.evaluate(async () => {
    // @ts-expect-error Vite runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite runtime module.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    // @ts-expect-error Vite runtime module.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    for (const item of Object.keys(ITEM_CATALOG)) {
      if (item !== 'chest' && item !== 'parsnip-seeds') gs.addItem(item, item === 'wood' ? 40 : 1);
    }
    for (let index = 0; index < gs.toolbeltSlots.length && gs.backpackSlots.includes(null); index++) {
      const entry = gs.toolbeltSlots[index];
      if (typeof entry === 'string' && entry.startsWith('tool:')) InventoryLayoutSystem.moveOrSwap(gs,
        { container: 'toolbelt', index }, { container: 'backpack', index: gs.backpackSlots.indexOf(null) });
    }
    if (gs.backpackSlots.includes(null)) throw new Error('Capacity fixture did not fill all backpack cells');
  });
  const before = await getState(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => recipeText(page, 'crafting-note')).toContain('pockets are full');
  const after = await getState(page);
  expect(after.inventory).toEqual(before.inventory);
  expect(after.backpackSlots).toEqual(before.backpackSlots);
  expect(after.toolbeltSlots).toEqual(before.toolbeltSlots);
});

for (const density of [1, 2]) test(`DPR${density} uses native backing pixels and sharp dynamic text through resize`, async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('DPR test requires the configured isolated game baseURL');
  const context = await browser.newContext({ baseURL, viewport: { width: 1200, height: 750 }, deviceScaleFactor: density });
  const page = await context.newPage();
  try {
    await bootGame(page);
    await page.evaluate(() => {
      const scene = window.__GAME__!.scene.getScene('UIScene');
      const text = scene.add.text(480, 270, 'Sharp text', { fontSize: '18px' }).setName('sharp-probe');
      scene.add.container(0, 0, [text]).setScale(1.25).setName('sharp-probe-parent');
    });
    /** Check actual glyph buffer density, physical canvas dimensions, and unchanged CSS world scale. */
    const check = async (width: number, height: number): Promise<void> => {
      await expect.poll(() => page.evaluate(() => {
        const game = window.__GAME__!;
        const scene = game.scene.getScene('UIScene');
        const parent = scene.children.getByName('sharp-probe-parent') as unknown as { list: Array<{ style: { resolution: number } }> };
        return parent.list[0].style.resolution;
      })).toBeCloseTo(Math.min(width / 960, height / 540) * density * 1.25, 5);
      const state = await page.evaluate(() => {
        const game = window.__GAME__!;
        const rect = game.canvas.getBoundingClientRect();
        return { width: game.canvas.width, height: game.canvas.height, cssWidth: rect.width, cssHeight: rect.height,
          worldZoom: game.scene.getScene('FarmScene').cameras.main.zoom,
          pixelArt: game.config.pixelArt, antialias: game.config.antialias };
      });
      expect(state).toEqual({ width: width * density, height: height * density, cssWidth: width, cssHeight: height,
        worldZoom: Math.max(1, Math.round(2 * Math.min(width / 960, height / 540))) * density,
        pixelArt: true, antialias: false });
    };
    await check(1200, 750);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => {
      const scene = window.__GAME__!.scene.getScene('UIScene');
      const parent = scene.children.getByName('sharp-probe-parent') as unknown as { list: Array<{ setText: (text: string) => void }> };
      parent.list[0].setText('Updated inventory count: 123');
    });
    await check(800, 600);
    await openRecipes(page, 20);
    const confirm = await uiCanvasPoint(page, { x: 642, y: 394 });
    await page.mouse.click(confirm.x, confirm.y);
    await expect.poll(async () => (await getState(page)).inventory.chest).toBe(1);
  } finally { await context.close(); }
});
