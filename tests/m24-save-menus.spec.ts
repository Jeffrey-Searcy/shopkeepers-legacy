/**
 * M24 — durable save slots, title menu, and pause menu.
 *
 * Canvas UI is exercised with real keyboard input. The seam and dynamic module imports are used
 * only for deterministic setup/inspection of state that a player cannot cheaply create by hand.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState } from './helpers/gameHarness';

const MENU_URL = '/?test=1&seed=42&menu=1';

/** Start each test with only the three application-owned save keys absent. */
async function clearSaveSlots(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__m24_save_slots_cleared__') === '1') return;
    for (let slot = 1; slot <= 3; slot++) {
      localStorage.removeItem(`shopkeeperslegacy.save.v1.slot.${slot}`);
    }
    sessionStorage.setItem('__m24_save_slots_cleared__', '1');
  });
}

/** Wait for the title scene without waiting for the world-only `ready` seam flag. */
async function waitForMenu(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
}

/** Start the selected empty/occupied slot with the menu's real Enter path. */
async function enterSelectedSlot(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    if (window.__TEST__?.ready === true) return true;
    const menu = window.__GAME__?.scene.getScene('MainMenuScene');
    return (menu?.children.getByName('origin-intro-root') as unknown as { visible?: boolean } | null)?.visible === true;
  });
  const introVisible = await page.evaluate(() => {
    const menu = window.__GAME__?.scene.getScene('MainMenuScene');
    return (menu?.children.getByName('origin-intro-root') as unknown as { visible?: boolean } | null)?.visible === true;
  });
  if (introVisible) {
    await page.keyboard.press('Enter'); // letter -> departure
    await page.keyboard.press('Enter'); // departure -> business choice
    await page.keyboard.press('Enter'); // Tavern / Inn
  }
  await page.waitForFunction(() => window.__TEST__?.ready === true);
}

test.describe('M24 save files and menus', () => {
  test('persistence round-trip keeps the full world and rejects corruption atomically', async ({ page }) => {
    await clearSaveSlots(page);
    await bootGame(page);

    const result = await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { GameState } = await import('/src/state/GameState.ts');
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');

      SaveSystem.beginNewGame(1);
      const gs = GameState.instance;
      gs.day = 18;
      gs.timeOfDay = 427;
      gs.activeScene = 'TownScene' as typeof gs.activeScene;
      gs.player = { x: 488, y: 344, facing: 'left', stamina: 73 };
      gs.gold = 912;
      gs.tiles['FarmScene:20,20'] = 'tilled';
      gs.tiles['TownScene:8,9'] = 'watered';
      gs.crops['FarmScene:20,20'] = {
        type: 'parsnip',
        stage: 2,
        maxStage: 3,
        watered: true,
        daysInStage: 1,
      };
      gs.crops['TownScene:8,9'] = {
        type: 'potato',
        stage: 1,
        maxStage: 3,
        watered: false,
        daysInStage: 0,
      };
      if (!gs.addItem('wood', 4)) throw new Error('test setup could not add wood');
      SaveSystem.saveCurrent(1_786_100_000_000);

      const savedSlots = SaveSystem.listSlots();
      GameState.reset();
      GameState.instance.gold = 7;
      SaveSystem.load(1);
      const restored = GameState.instance;
      const fullState = restored.toSaveData();

      const beforeCorrupt = JSON.stringify(fullState);
      localStorage.setItem(SaveSystem.storageKey(2), '{ definitely not json');
      let corruptError = '';
      try {
        SaveSystem.load(2);
      } catch (error) {
        corruptError = error instanceof Error ? error.message : String(error);
      }
      const afterCorrupt = JSON.stringify(GameState.instance.toSaveData());

      // A structurally-valid payload whose resume point is outside its destination map is corrupt
      // during inspection and must fail before replacing the live singleton or active slot.
      localStorage.setItem(
        SaveSystem.storageKey(2),
        JSON.stringify({
          version: 1,
          slot: 2,
          savedAt: 1,
          state: { ...fullState, activeScene: 'FarmScene', player: { ...fullState.player, x: 99_999 } },
        })
      );
      const outOfBoundsInfo = SaveSystem.inspectSlot(2);
      const beforeBoundsLoad = JSON.stringify(GameState.instance.toSaveData());
      let boundsError = '';
      try {
        SaveSystem.load(2);
      } catch (error) {
        boundsError = error instanceof Error ? error.message : String(error);
      }
      const boundsLoadWasAtomic = beforeBoundsLoad === JSON.stringify(GameState.instance.toSaveData());

      localStorage.setItem(
        SaveSystem.storageKey(3),
        JSON.stringify({ version: 999, slot: 3, savedAt: 1, state: fullState })
      );
      let versionError = '';
      try {
        SaveSystem.load(3);
      } catch (error) {
        versionError = error instanceof Error ? error.message : String(error);
      }

      let slotError = '';
      try {
        SaveSystem.storageKey(4 as 1);
      } catch (error) {
        slotError = error instanceof Error ? error.message : String(error);
      }

      return {
        savedSlots,
        currentSlot: SaveSystem.currentSlot(),
        state: fullState,
        corruptSlots: SaveSystem.listSlots(),
        corruptError,
        boundsError,
        boundsLoadWasAtomic,
        outOfBoundsInfo,
        versionError,
        slotError,
        rejectedLoadWasAtomic: beforeCorrupt === afterCorrupt,
        ownedKeys: Object.keys(localStorage).filter((key) => key.startsWith('shopkeeperslegacy.')).sort(),
      };
    });

    expect(result.savedSlots[0]).toMatchObject({ slot: 1, status: 'ready', day: 18, gold: 912 });
    expect(result.currentSlot).toBe(1);
    expect(result.state.tiles).toEqual({ 'FarmScene:20,20': 'tilled', 'TownScene:8,9': 'watered' });
    expect(Object.keys(result.state.crops).sort()).toEqual(['FarmScene:20,20', 'TownScene:8,9']);
    expect(result.state.inventory.wood).toBe(4);
    expect(result.state.player).toEqual({ x: 488, y: 344, facing: 'left', stamina: 73 });
    expect(result.rejectedLoadWasAtomic).toBe(true);
    expect(result.corruptSlots[1]).toMatchObject({ slot: 2, status: 'corrupt' });
    expect(result.corruptSlots[2]).toMatchObject({ slot: 3, status: 'corrupt' });
    expect(result.corruptError).toContain('Slot 2');
    expect(result.boundsError).toContain('outside FarmScene bounds');
    expect(result.boundsLoadWasAtomic).toBe(true);
    expect(result.outOfBoundsInfo).toMatchObject({ slot: 2, status: 'corrupt' });
    expect(result.versionError).toContain('version 999');
    expect(result.slotError).toContain('slot 4');
    expect(result.ownedKeys).toEqual([
      'shopkeeperslegacy.save.v1.slot.1',
      'shopkeeperslegacy.save.v1.slot.2',
      'shopkeeperslegacy.save.v1.slot.3',
    ]);
  });

  test('main-menu slots start, continue, confirmation-delete, and resume exact scene position', async ({ page }) => {
    await clearSaveSlots(page);
    await bootGame(page);
    await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { GameState } = await import('/src/state/GameState.ts');
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      SaveSystem.beginNewGame(1);
      const gs = GameState.instance;
      gs.activeScene = 'TownScene' as typeof gs.activeScene;
      gs.player = { x: 488, y: 344, facing: 'left', stamina: 73 };
      gs.day = 9;
      gs.gold = 246;
      SaveSystem.saveCurrent(1_786_100_000_000);
    });

    await page.goto(MENU_URL);
    await waitForMenu(page);
    await enterSelectedSlot(page);

    const resumed = await getState(page);
    expect(resumed.activeScene).toBe('TownScene');
    expect(resumed.day).toBe(9);
    expect(resumed.gold).toBe(246);
    expect(resumed.player).toMatchObject({ x: 488, y: 344, facing: 'left' });

    // Return to title via the real pause-menu flow: down, down, Enter, choose Yes, Enter.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape'); // cancel the first destructive confirmation
    expect((await getState(page)).paused).toBe(true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await waitForMenu(page);

    // Delete key also has a cancel/confirm barrier.
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(async () => {
        // @ts-expect-error runtime module paths are served by Vite in browser tests
        return (await import('/src/systems/SaveSystem.ts')).SaveSystem.listSlots()[0].status;
      })
    ).toBe('ready');
    await page.keyboard.press('Delete');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(async () => {
        // @ts-expect-error runtime module paths are served by Vite in browser tests
        return (await import('/src/systems/SaveSystem.ts')).SaveSystem.listSlots()[0].status;
      })
    ).toBe('empty');

    await enterSelectedSlot(page);
    const fresh = await getState(page);
    expect(fresh.activeScene).toBe('FarmScene');
    expect(fresh.day).toBe(1);
    expect(fresh.gold).toBe(0);
  });

  test('pause freezes all clocks and clears movement/reel latches while menus own input', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);
    await enterSelectedSlot(page);
    await page.waitForTimeout(120);
    expect(await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      return (await import('/src/systems/SaveSystem.ts')).SaveSystem.currentSlot();
    })).toBe(1);
    await page.keyboard.down('KeyD');
    await page.evaluate(() => window.__TEST__!.input('reel:on'));
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(100);

    const pausedBefore = await getState(page);
    expect(pausedBefore.paused).toBe(true);
    const inputAndHud = await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { InputBus } = await import('/src/input/InputBus.ts');
      const ui = window.__GAME__!.scene.getScene('UIScene');
      const toggle = ui.children.getByName('dev-tuning-toggle');
      return {
        held: InputBus.instance.getHeld().size,
        reelHeld: InputBus.instance.reelHeld,
        devToggleVisible: (toggle as unknown as { visible?: boolean } | null)?.visible ?? null,
      };
    });
    expect(inputAndHud).toEqual({ held: 0, reelHeld: false, devToggleVisible: false });

    await page.evaluate(() => window.__TEST__!.stepTime(120));
    await page.waitForTimeout(350);
    const pausedAfter = await getState(page);
    expect(pausedAfter.timeOfDay).toBe(pausedBefore.timeOfDay);
    expect(pausedAfter.player.x).toBeCloseTo(pausedBefore.player.x, 4);
    expect(pausedAfter.player.y).toBeCloseTo(pausedBefore.player.y, 4);

    // Save Game is the second pause option; it keeps the game paused.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(async () => {
        // @ts-expect-error runtime module paths are served by Vite in browser tests
        return (await import('/src/systems/SaveSystem.ts')).SaveSystem.listSlots()[0].status;
      })
    ).toBe('ready');
    expect((await getState(page)).paused).toBe(true);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const resumed = await getState(page);
    expect(resumed.paused).toBe(false);
    expect(resumed.player.x).toBeCloseTo(pausedAfter.player.x, 4);
    expect(resumed.player.y).toBeCloseTo(pausedAfter.player.y, 4);

    // A new pause session shows current-slot context, not stale success text from the prior open.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__TEST__?.state().paused === true);
    await page.waitForFunction(() => {
      const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
        pauseMenu: { slotText: { text: string } };
      };
      return ui.pauseMenu.slotText.text === 'Current file: Slot 1';
    });
    expect(
      await page.evaluate(() => {
        const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as {
          pauseMenu: { slotText: { text: string } };
        };
        return ui.pauseMenu.slotText.text;
      })
    ).toBe('Current file: Slot 1');
  });

  test('world shutdown completes before reset and sleep autosaves through the active slot', async ({ page }) => {
    await clearSaveSlots(page);
    await page.goto(MENU_URL);
    await waitForMenu(page);
    await enterSelectedSlot(page);

    await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { GameState } = await import('/src/state/GameState.ts');
      const originalReset = GameState.reset.bind(GameState);
      (window as unknown as { __RESET_SAW_WORLD__?: boolean }).__RESET_SAW_WORLD__ = false;
      GameState.reset = () => {
        const activeScenes = window.__GAME__!.scene.getScenes(true).map((scene) => scene.scene.key);
        (window as unknown as { __RESET_ACTIVE_SCENES__?: string[] }).__RESET_ACTIVE_SCENES__ = activeScenes;
        const worldStillActive = activeScenes.some((key) => !['UIScene', 'MainMenuScene'].includes(key));
        (window as unknown as { __RESET_SAW_WORLD__?: boolean }).__RESET_SAW_WORLD__ ||= worldStillActive;
        originalReset();
      };
    });

    const dayBefore = (await getState(page)).day;
    await page.evaluate(() => window.__TEST__!.sleep());
    const autosave = await page.evaluate(async () => {
      // @ts-expect-error runtime module paths are served by Vite in browser tests
      const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
      return SaveSystem.listSlots()[0];
    });
    expect(autosave).toMatchObject({ status: 'ready', day: dayBefore + 1 });

    // The overnight report is the top modal: first Escape dismisses it, second opens pause.
    await page.keyboard.press('Escape');
    expect((await getState(page)).daySummary).toBeNull();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await waitForMenu(page);
    expect(
      await page.evaluate(() => ({
        sawWorld: (window as unknown as { __RESET_SAW_WORLD__?: boolean }).__RESET_SAW_WORLD__,
        activeScenes: (window as unknown as { __RESET_ACTIVE_SCENES__?: string[] }).__RESET_ACTIVE_SCENES__,
      }))
    ).toEqual({ sawWorld: false, activeScenes: ['UIScene'] });
  });
});
