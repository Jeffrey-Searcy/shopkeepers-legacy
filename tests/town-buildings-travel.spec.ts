/** Native-key civic entrance/exit coverage plus isolated game-scale exterior and room evidence. */
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, teleport } from './helpers/gameHarness';
import { TOWN_BUILDINGS } from '../src/config/TownBuildings';

/** Cross with real keyboard input until shared transition authority reports a controllable destination. */
async function walk(page: Page, key: string, target: string): Promise<void> {
  await page.keyboard.down(key);
  try { await page.waitForFunction(target => window.__TEST__?.ready && window.__TEST__.activeScene() === target, target); }
  finally { await page.keyboard.up(key); }
  await expect.poll(async () => (await getState(page)).transitionActive).toBe(false);
}

test('all twelve buildings support grounded walk-in doors, distinct rooms and exact Town returns without E', async ({ page }, info) => {
  test.setTimeout(180_000); await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.timeOfDay = 300;
  });
  await teleport(page, 95, 30, 'right'); await walk(page, 'd', 'TownScene');
  for (const building of TOWN_BUILDINGS) {
    await page.evaluate(async () => {
      // @ts-expect-error Vite serves source modules to the browser test.
      const { GameState } = await import('/src/state/GameState.ts');
      GameState.instance.timeOfDay = 300;
    });
    const door = await page.evaluate(async target => {
      // @ts-expect-error Vite module import is resolved by the isolated browser.
      const { getMapData } = await import('/src/world/MapDef.ts');
      const warp = getMapData('TownScene').warps.find((candidate: { target: string }) => candidate.target === target);
      if (!warp) throw new Error('Missing civic entrance'); return { tx: warp.tx, ty: warp.ty };
    }, building.scene);
    await teleport(page, door.tx, door.ty + 2, 'up');
    await page.waitForTimeout(600); // Screenshot-only delay lets the actual follow camera settle after a distant test teleport.
    await page.screenshot({ path: info.outputPath(`${building.id}-exterior.png`) });
    await walk(page, 'w', building.scene);
    const entered = await getState(page); expect(entered.activeScene).toBe(building.scene);
    await page.waitForTimeout(600);
    await page.screenshot({ path: info.outputPath(`${building.id}-interior.png`) });
    await teleport(page, Math.floor(building.room.w / 2), 7, 'up');
    await page.waitForTimeout(600);
    await page.screenshot({ path: info.outputPath(`${building.id}-interior-north.png`) });
    await teleport(page, Math.floor(entered.player.x / 16), Math.floor(entered.player.y / 16), 'down');
    await page.keyboard.down('s');
    try { await page.waitForFunction(() => window.__TEST__?.ready && window.__TEST__.activeScene() === 'TownScene'); }
    finally { await page.keyboard.up('s'); }
    const returned = await getState(page);
    expect(returned.player.x).toBeCloseTo(door.tx * 16 + 8, 0);
    // The painted Town's return arrival (from_<building>) stands two tiles below each door.
    expect(returned.player.y).toBeCloseTo((door.ty + 2) * 16 + 8, 0);
  }
});

test('walking sideways across a civic landing cannot trigger its north doorway', async ({ page }) => {
  await bootGame(page); await teleport(page, 95, 30, 'right'); await walk(page, 'd', 'TownScene');
  const door = await page.evaluate(async () => {
    // @ts-expect-error Vite module import is resolved by the isolated browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    return getMapData('TownScene').warps.find((warp: { target: string }) => warp.target === 'TownMarketScene');
  });
  await teleport(page, door.tx - 1, door.ty + 1, 'right'); await page.keyboard.down('d');
  // The redrawn market (save version 29) closes the landing's east end with its flower stall (x 16.75), so the
  // keeper crosses under both door tiles and stops there: the 8 px feet box must be fully past the left door
  // column (left edge = x - 4 beyond the right door tile's west edge).
  try { await expect.poll(async () => (await getState(page)).player.x).toBeGreaterThanOrEqual((door.tx + 1) * 16 + 4); }
  finally { await page.keyboard.up('d'); }
  expect((await getState(page)).activeScene).toBe('TownScene');
});

test('closed doors block one held-contact notice while a resident partner may enter', async ({ page }) => {
  await bootGame(page);
  const door = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the shared transition authority.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    // @ts-expect-error Vite resolves runtime source modules in the browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime source modules in the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    GameState.instance.timeOfDay = 900;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), 'TownScene', 'from_farm');
    const warp = getMapData('TownScene').warps.find((candidate: { target: string }) => candidate.target === 'TownMarketScene');
    if (!warp) throw new Error('Missing market door');
    return { tx: warp.tx, ty: warp.ty };
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  await page.evaluate(() => {
    const game = window.__GAME__!; game.registry.set('closed-door-notices', 0);
    game.events.on('toast', (message: string) => {
      if (message.includes('General Market is closed')) game.registry.set('closed-door-notices', game.registry.get('closed-door-notices') + 1);
    });
  });
  await teleport(page, door.tx, door.ty + 2, 'up');
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  expect((await getState(page)).activeScene).toBe('TownScene');
  expect(await page.evaluate(() => window.__GAME__!.registry.get('closed-door-notices'))).toBe(1);
  await teleport(page, door.tx, door.ty + 5, 'up'); await page.waitForTimeout(50);
  await teleport(page, door.tx, door.ty + 2, 'up');
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  expect(await page.evaluate(() => window.__GAME__!.registry.get('closed-door-notices'))).toBe(2);
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime source modules in the browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime source modules in the browser.
    const { residentForBuilding } = await import('/src/config/TownResidents.ts');
    GameState.instance.relationships.residents[residentForBuilding('market').id].romanceStage = 'dating';
  });
  await teleport(page, door.tx, door.ty + 5, 'up'); await page.waitForTimeout(50);
  await teleport(page, door.tx, door.ty + 2, 'up'); await walk(page, 'w', 'TownMarketScene');
  expect((await getState(page)).activeScene).toBe('TownMarketScene');
});

test('title Continue resumes inside a civic room and public fixtures never become player-owned placements', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the shared transition authority.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    transitionTo(window.__GAME__!.scene.getScene('FarmScene'), 'TownMuseumScene', 'entry');
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownMuseumScene');
  await teleport(page, 10, 12, 'left');
  const before = await getState(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the actual save module.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves the actual placement module.
    const { ItemPlacementSystem } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Vite resolves the authored public room.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData('TownMuseumScene');
    const canPlace = ItemPlacementSystem.canPlace(map, 10, 11, () => false, 'workbench');
    SaveSystem.save(1, 100);
    return { canPlace, raw: localStorage.getItem(SaveSystem.storageKey(1)) };
  });
  expect(result.canPlace).toBe(false); expect(JSON.parse(result.raw!).state.placedItems).toEqual(before.placedItems);
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownMuseumScene');
  const restored = await getState(page);
  expect(restored.player).toEqual(before.player); expect(restored.placedItems).toEqual(before.placedItems);
});
