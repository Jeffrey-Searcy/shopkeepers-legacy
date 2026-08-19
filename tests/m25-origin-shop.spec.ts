/**
 * M25 — inherited-shop origin, bounded business choice, Tavern facade, and Home compatibility.
 *
 * The canvas UI is driven through real Enter/Escape/pointer input. Dynamic imports are limited to
 * deterministic save/map setup and read-only inspection that would be prohibitively slow in play.
 */
import { test, expect, type Page } from '@playwright/test';
import { activeScene, getState, teleport, act } from './helpers/gameHarness';

const MENU_URL = '/?test=1&seed=42&menu=1';

/** Remove only the three application-owned save keys before a menu-path case. */
async function clearSaveSlots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__m25_save_slots_cleared__') === '1') return;
    for (let slot = 1; slot <= 3; slot++) {
      localStorage.removeItem(`shopkeeperslegacy.save.v1.slot.${slot}`);
    }
    sessionStorage.setItem('__m25_save_slots_cleared__', '1');
  });
}

/** Wait for the title scene without relying on the world-only ready flag. */
async function waitForMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
}

/** Whether the named intro overlay currently owns menu input. */
async function introVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const menu = window.__GAME__!.scene.getScene('MainMenuScene');
    return (menu.children.getByName('origin-intro-root') as unknown as { visible?: boolean } | null)?.visible === true;
  });
}

/** Click a point expressed in the game's fixed 960x540 canvas coordinate system. */
async function clickGame(page: Page, gameX: number, gameY: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('M25: game canvas has no bounding box');
  await page.mouse.click(box.x + (gameX / 960) * box.width, box.y + (gameY / 540) * box.height);
  await page.waitForTimeout(120);
}

/** Advance letter -> arrival -> choice with the real keyboard path. */
async function reachBusinessChoice(page: Page): Promise<void> {
  await page.keyboard.press('Enter'); // selected empty slot -> letter
  await expect.poll(() => introVisible(page)).toBe(true);
  await page.keyboard.press('Enter'); // letter -> leaving the city
  await page.keyboard.press('Enter'); // arrival -> choice
  await page.waitForFunction(() => {
    const menu = window.__GAME__!.scene.getScene('MainMenuScene');
    return (menu.children.getByName('origin-choice-root') as unknown as { visible?: boolean } | null)?.visible === true;
  });
}

test.describe('M25 inherited shop origin', () => {
  test('origin: new slot shows the intro, Escape cancels, and Tavern starts at the named Farm doorstep', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);

    await page.keyboard.press('Enter');
    await expect.poll(() => introVisible(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => introVisible(page)).toBe(false);

    const cancelled = await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      return {
        currentSlot: SaveSystem.currentSlot(),
        slot: SaveSystem.inspectSlot(1),
        activeWorlds: window.__GAME__!.scene
          .getScenes(true)
          .map((scene) => scene.scene.key)
          .filter((key) => key !== 'MainMenuScene'),
      };
    });
    expect(cancelled.currentSlot).toBeNull();
    expect(cancelled.slot).toMatchObject({ slot: 1, status: 'empty' });
    expect(cancelled.activeWorlds).toEqual([]);

    await reachBusinessChoice(page);
    await page.keyboard.press('Enter'); // Tavern / Inn
    await page.waitForFunction(() => window.__TEST__?.ready === true);

    const state = await getState(page);
    expect(state.activeScene).toBe('FarmScene');
    expect(state.day).toBe(1);
    expect(Math.floor(state.player.x / 16)).toBe(72);
    expect(Math.floor(state.player.y / 16)).toBe(15);
    expect(
      await page.evaluate(async () => {
        // @ts-expect-error Vite serves runtime TS modules in browser tests.
        return (await import('/src/systems/SaveSystem.ts')).SaveSystem.currentSlot();
      })
    ).toBe(1);
  });

  test('disabled: Item Shop is visible but pointer attempts cannot create a session, write storage, or enter gameplay', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);
    await reachBusinessChoice(page);

    const itemShop = await page.evaluate(() => {
      const menu = window.__GAME__!.scene.getScene('MainMenuScene');
      const choice = menu.children.getByName('origin-choice-root') as unknown as {
        getByName(name: string): unknown;
      };
      const card = choice.getByName('origin-item-shop-card') as {
        visible: boolean;
        input?: unknown;
      } | null;
      return { exists: card !== null, visible: card?.visible === true, interactive: Boolean(card?.input) };
    });
    expect(itemShop).toEqual({ exists: true, visible: true, interactive: false });

    await clickGame(page, 650, 390);
    const after = await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      return {
        currentSlot: SaveSystem.currentSlot(),
        slot: SaveSystem.inspectSlot(1),
        introVisible:
          (window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('origin-intro-root') as unknown as { visible?: boolean } | null)?.visible === true,
        activeWorld: window.__GAME__!.scene
          .getScenes(true)
          .some((scene) => !['MainMenuScene', 'UIScene'].includes(scene.scene.key)),
      };
    });
    expect(after).toEqual({
      currentSlot: null,
      slot: { slot: 1, status: 'empty' },
      introVisible: true,
      activeWorld: false,
    });
  });

  test('origin: real pointer input can open the slot, turn both story pages, and choose Tavern', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);

    await clickGame(page, 205, 299); // selected SAVE 1 card
    await expect.poll(() => introVisible(page)).toBe(true);
    await clickGame(page, 480, 468); // letter: TURN THE PAGE
    await page.waitForFunction(() => {
      const menu = window.__GAME__!.scene.getScene('MainMenuScene') as unknown as { originPage: number };
      return menu.originPage === 1;
    });
    await clickGame(page, 480, 468); // departure: FOLLOW THE ROAD
    await page.waitForFunction(() => {
      const menu = window.__GAME__!.scene.getScene('MainMenuScene');
      return (menu.children.getByName('origin-choice-root') as unknown as { visible?: boolean } | null)?.visible === true;
    });
    await clickGame(page, 314, 306); // enabled Tavern card
    await page.waitForFunction(() => window.__TEST__?.ready === true);

    expect(await activeScene(page)).toBe('FarmScene');
    expect((await getState(page)).player).toMatchObject({ facing: 'down' });
  });

  test('origin: ready saves bypass the intro and resume their exact scene and position', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);
    await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { GameState } = await import('/src/state/GameState.ts');
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      SaveSystem.beginNewGame(1);
      GameState.instance.activeScene = 'TownScene' as typeof GameState.instance.activeScene;
      GameState.instance.player = { x: 488, y: 344, facing: 'left', stamina: 73 };
      SaveSystem.saveCurrent(1_786_100_000_000);
    });
    await page.reload();
    await waitForMenu(page);

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__TEST__?.ready === true);
    expect(await introVisible(page)).toBe(false);
    expect(await activeScene(page)).toBe('TownScene');
    expect((await getState(page)).player).toMatchObject({ x: 488, y: 344, facing: 'left' });
  });

  test('compatibility: Home saves normalize to the named Farm doorstep before any interior renders', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);

    const layout = await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { getMapData } = await import('/src/world/MapDef.ts');
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { SceneKey } = await import('/src/config/AssetKeys.ts');
      const farm = getMapData(SceneKey.Farm);
      return {
        homeWarps: farm.warps.filter((warp: { target: string }) => warp.target === SceneKey.Home),
        redirect: farm.spawns.find((spawn: { id: string }) => spawn.id === 'from_home'),
      };
    });
    expect(layout.homeWarps).toEqual([]);
    expect(layout.redirect).toMatchObject({ id: 'from_home', tx: 72, ty: 15 });

    await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { GameState } = await import('/src/state/GameState.ts');
      // @ts-expect-error Vite serves runtime TS modules in browser tests.
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      SaveSystem.beginNewGame(1);
      GameState.instance.activeScene = 'HomeInteriorScene' as typeof GameState.instance.activeScene;
      GameState.instance.player = { x: 168, y: 168, facing: 'up', stamina: 64 };
      SaveSystem.saveCurrent(1_786_100_000_000);
    });
    await page.reload();
    await waitForMenu(page);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__TEST__?.ready === true);

    expect(await activeScene(page)).toBe('FarmScene');
    expect((await getState(page)).player).toMatchObject({ x: 1160, y: 248, facing: 'down', stamina: 64 });
    expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
    const dayBefore = (await getState(page)).day;
    await teleport(page, 72, 13, 'up');
    await act(page, 'interact');
    expect((await getState(page)).day).toBe(dayBefore + 1);
    expect(await activeScene(page)).toBe('FarmScene');
  });
});
