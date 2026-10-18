/**
 * Eat and drink gates (playtester: "I should be able to eat and drink, with effects like stamina").
 *
 * Pins the whole loop through real game paths:
 *  - using a held food eats one, restores stamina, and refuses (changing nothing) when already full;
 *  - stew starts Well Fed, which halves tool stamina cost until it runs out on the game clock;
 *  - the HUD shows a chip for each running buff and hides it when the buff ends;
 *  - the bag card offers "Eat" / "Drink" and runs the same rule;
 *  - Quick Step raises walking speed;
 *  - save version 22+ keeps buffs and mana, version 21 migrates to none, and damaged records fail loudly.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, sendInput, stopMove, advanceFrames, stepTime } from './helpers/gameHarness';

/**
 * Put `count` of `item` in the bag, move the stack to toolbelt slot 1, and select that slot.
 * @param page The game page.
 * @param item Item id.
 * @param count How many to give.
 */
async function holdItem(page: Page, item: string, count: number): Promise<void> {
  await page.evaluate(async ([id, n]) => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { findEntrySlot, moveOrSwap } = await import('/src/systems/InventoryLayoutSystem.ts');
    // @ts-expect-error Vite browser module.
    const { ToolSystem } = await import('/src/systems/ToolSystem.ts');
    const gs = GameState.instance;
    if (!gs.addItem(id, n)) throw new Error(`fixture could not add ${id}`);
    moveOrSwap(gs, findEntrySlot(gs, id), { container: 'toolbelt', index: 1 });
    ToolSystem.select(1);
  }, [item, count] as const);
}

/** Set the keeper's stamina directly. */
async function setStamina(page: Page, stamina: number): Promise<void> {
  await page.evaluate(async (value) => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.player.stamina = value;
  }, stamina);
}

test('using held food eats one and restores stamina; full stamina refuses plain food', async ({ page }) => {
  await bootGame(page);
  await holdItem(page, 'parsnip', 2);
  await setStamina(page, 50);
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 60);
  let state = await getState(page);
  expect(state.player.stamina).toBe(60);
  expect(state.inventory.parsnip).toBe(1);
  await setStamina(page, 100);
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 60);
  state = await getState(page);
  // Plain food at full stamina is refused: the parsnip stays in the bag.
  expect(state.player.stamina).toBe(100);
  expect(state.inventory.parsnip).toBe(1);
});

test('stew starts Well Fed: half tool cost and a HUD chip until it ends on the game clock', async ({ page }) => {
  await bootGame(page);
  await holdItem(page, 'stew', 1);
  await setStamina(page, 40);
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 60);
  const fed = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { StaminaSystem } = await import('/src/systems/StaminaSystem.ts');
    const gs = GameState.instance;
    const before = gs.player.stamina;
    StaminaSystem.spendForTool();
    // why: Phaser's GameObject type has no visible/text fields; the HUD objects here are Rectangles and Texts.
    const uiObjects = () => window.__GAME__!.scene.getScene('UIScene').children.list as unknown as
      Array<{ name: string; type: string; visible: boolean; text?: string }>;
    const objects = uiObjects();
    const chip = objects.find(child => child.name === 'hud-buff-chip-0')!;
    const texts = objects.filter(child => child.type === 'Text' && child.visible).map(child => child.text);
    return { before, after: gs.player.stamina, buffs: gs.vitality.buffs.map((b: { id: string }) => b.id), stew: gs.inventory.stew ?? 0,
      chip: chip.visible, chipText: texts.find(t => t?.startsWith('Well Fed')) };
  });
  expect(fed.before).toBe(75); // 40 + 35
  expect(fed.after).toBe(74); // Well Fed: tools cost 1 instead of 2
  expect(fed.buffs).toEqual(['well-fed']);
  expect(fed.stew).toBe(0);
  expect(fed.chip).toBe(true);
  expect(fed.chipText).toBe('Well Fed 3h 00m');

  await stepTime(page, 181);
  await advanceFrames(page, 60);
  const ended = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { StaminaSystem } = await import('/src/systems/StaminaSystem.ts');
    const gs = GameState.instance, before = gs.player.stamina;
    StaminaSystem.spendForTool();
    // why: Phaser's GameObject type has no visible/text fields; the HUD objects here are Rectangles and Texts.
    const uiObjects = () => window.__GAME__!.scene.getScene('UIScene').children.list as unknown as
      Array<{ name: string; type: string; visible: boolean; text?: string }>;
    const chip = uiObjects().find(child => child.name === 'hud-buff-chip-0')!;
    return { spent: before - gs.player.stamina, buffs: gs.vitality.buffs.length, chip: chip.visible };
  });
  expect(ended).toEqual({ spent: 2, buffs: 0, chip: false });
});

test('the bag card offers Drink for ale and runs the same rule', async ({ page }) => {
  await bootGame(page);
  await setStamina(page, 20);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    const gs = GameState.instance;
    gs.addItem('ale', 2);
    gs.inventoryOpen = true;
    const ui = window.__GAME__!.scene.getScene('UIScene') as unknown as { inventoryUI: { selectItem(item: string): void;
      actionLabel: { text: string }; actionButton: { emit(event: string, ...args: unknown[]): void } } };
    ui.inventoryUI.selectItem('ale');
    const label = ui.inventoryUI.actionLabel.text;
    ui.inventoryUI.actionButton.emit('pointerdown', {}, 0, 0, { stopPropagation() {} });
    return { label, stamina: gs.player.stamina, ale: gs.inventory.ale, buffs: gs.vitality.buffs.map((b: { id: string }) => b.id) };
  });
  expect(result).toEqual({ label: 'Drink · +10 stamina · Cheer', stamina: 30, ale: 1, buffs: ['cheer'] });
});

test('Quick Step from a melon raises walking speed', async ({ page }) => {
  await bootGame(page);
  /** Walk right briefly and read the keeper's top horizontal speed. */
  const topSpeed = async (): Promise<number> => {
    await sendInput(page, 'move:right');
    await advanceFrames(page, 250);
    const speed = await page.evaluate(() => {
      const scene = window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()) as unknown as { player: { body: { velocity: { x: number } } } };
      return scene.player.body.velocity.x;
    });
    await stopMove(page);
    await advanceFrames(page, 600);
    return speed;
  };
  const normal = await topSpeed();
  await holdItem(page, 'melon', 1);
  await sendInput(page, 'use-tool');
  await advanceFrames(page, 60);
  const quick = await topSpeed();
  expect(normal).toBeCloseTo(96, 0);
  expect(quick).toBeCloseTo(96 * 1.2, 0);
});

test('save version 22+ keeps vitality; version 21 migrates to none; damaged records fail loudly', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const gs = GameState.instance;
    gs.vitality = { buffs: [{ id: 'cheer', until: 100 }], mana: { current: 2, max: 4, practice: 12.5 } };
    SaveSystem.save(1, 1);
    const saved = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    const kept = SaveSystem.load(1).vitality;
    const old = JSON.parse(JSON.stringify(saved.state)) as Record<string, unknown>;
    delete old.vitality;
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 21, slot: 2, savedAt: 1, state: old }));
    const migrated = SaveSystem.load(2).vitality;
    const notice = SaveSystem.consumeMigrationNotice();
    const bad = [
      { buffs: [{ id: 'flying', until: 10 }], mana: null },
      { buffs: [{ id: 'cheer', until: 10 }, { id: 'cheer', until: 20 }], mana: null },
      { buffs: [{ id: 'cheer', until: 100_000 }], mana: null },
      { buffs: [], mana: { current: 5, max: 4, practice: 0 } },
      { buffs: [], mana: { current: 1, max: 4, practice: 60 } },
      { buffs: [] },
    ];
    const errors = bad.map(vitality => {
      try { GameState.candidateFromSaveData({ ...saved.state, vitality }, SAVE_VERSION); return null; } catch (error) { return String(error); }
    });
    return { version: saved.version, savedVitality: saved.state.vitality, kept, migrated, notice, errors };
  });
  expect(result.version).toBe(30);
  expect(result.savedVitality).toEqual({ buffs: [{ id: 'cheer', until: 100 }], mana: { current: 2, max: 4, practice: 12.5 } });
  expect(result.kept).toEqual(result.savedVitality);
  expect(result.migrated).toEqual({ buffs: [], mana: null });
  expect(result.notice).toContain('eat and drink');
  for (const error of result.errors) expect(error).toContain('vitality');
});
