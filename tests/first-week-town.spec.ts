/**
 * First-week town proofs:
 *  - the task strip runs furnish → restore → meet three neighbors → first sale → run the shop;
 *  - an authored Talk remembers a recent gift and, on alternate talks, mentions a neighbor;
 *  - dungeon loot buys forge and alchemy upgrades and brews healing potions;
 *  - Seren's board pins one job for two days, pays gold and friendship, and rotates by day.
 */
import { expect, test, type Page } from '@playwright/test';
import { advanceFrames, bootGame, getState, give, setDay, setGold } from './helpers/gameHarness';

/** The collapsed task-strip text and its expanded title, read from the live UI. */
async function task(page: Page): Promise<{ text: string; title: string }> {
  await advanceFrames(page, 60);
  return page.evaluate(() => {
    const strip = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-objective') as Phaser.GameObjects.Container;
    const title = strip.list.find(child => (child as Phaser.GameObjects.Text).getData?.('objectiveTitle') !== undefined) as Phaser.GameObjects.Text;
    return { text: title.text, title: title.getData('objectiveTitle') as string };
  });
}

/** Do one authored Talk with a resident and return the line they said. */
async function talk(page: Page, id: string): Promise<string> {
  return page.evaluate(async residentId => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentDialogue, confirmResidentDialogueChoice, closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    openResidentDialogue(residentId);
    confirmResidentDialogueChoice();
    const line = GameState.instance.dialogue.line as string;
    closeDialogue();
    return line;
  }, id);
}

/** Run one civic service option and return its result. */
async function service(page: Page, building: string, option: string): Promise<{ ok: boolean; message: string }> {
  return page.evaluate(async ({ b, o }) => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { CivicServiceSystem } = await import('/src/systems/CivicServiceSystem.ts');
    return CivicServiceSystem.run(b, o, 1) as { ok: boolean; message: string };
  }, { b: building, o: option });
}

/** Read the first-week progress record. */
async function progress(page: Page): Promise<{ forgeLevel: number; alchemyLevel: number; board: { active: { id: string; dueDay: number } | null; completed: number } }> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return JSON.parse(JSON.stringify(GameState.instance.progress));
  });
}

test('the task strip walks the first-day chain through meeting three neighbors', async ({ page }) => {
  await bootGame(page);
  expect((await task(page)).text).toContain('Furnish the shop');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.placedItems.push({ item: 'register', scene: 'TavernScene', tx: 10, ty: 8, rotation: 0 });
  });
  expect((await task(page)).text).toContain('Restore the shop');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.tavern.level = 1;
  });
  expect(await task(page)).toEqual({ text: 'TASK  [J] Meet neighbors 0/3', title: 'NEW IN TOWN' });
  await talk(page, 'nyra');
  await talk(page, 'nyra'); // the same neighbor twice still counts once
  await talk(page, 'rhea');
  expect((await task(page)).text).toBe('TASK  [J] Meet neighbors 2/3');
  await talk(page, 'seren');
  expect(await task(page)).toEqual({ text: 'TASK  [J] Make your first sale', title: 'OPEN FOR BUSINESS' });
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.tavern.revenue = 12;
  });
  expect((await task(page)).text).toBe('TASK  [J] Run your shop');
});

test('residents remember a recent gift and mention their neighbors', async ({ page }) => {
  await bootGame(page);
  // First talk of the day with no gift: the authored line alone.
  const first = await talk(page, 'nyra');
  // Second talk: a neighbor mention is added at the end.
  const second = await talk(page, 'nyra');
  const names = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    return (TOWN_RESIDENTS as Array<{ id: string; name: string }>).filter(r => r.id !== 'nyra').map(r => r.name);
  });
  expect(names.some(name => second.includes(name))).toBe(true);
  expect(names.some(name => first.includes(name) && !first.startsWith(name))).toBe(false);

  // A gift Nyra liked yesterday comes up on today's first talk, and not after a week.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { recordAcceptedResidentGift } = await import('/src/systems/ResidentGiftMemorySystem.ts');
    recordAcceptedResidentGift('nyra', 'mushroom', 'like', 1);
  });
  await setDay(page, 2);
  expect(await talk(page, 'nyra')).toContain('Thank you again for the Forest Mushroom.');
  await setDay(page, 9);
  expect(await talk(page, 'nyra')).not.toContain('Forest Mushroom');
});

test('dungeon loot buys forge and alchemy upgrades and brews potions', async ({ page }) => {
  await bootGame(page);
  // Forge level 1: 3 shards + 50 gold.
  await setGold(page, 50);
  expect((await service(page, 'forge', 'temper-sword')).ok).toBe(false);
  await give(page, 'portal-shard', 3);
  const temper = await service(page, 'forge', 'temper-sword');
  expect(temper.ok).toBe(true);
  expect(temper.message).toContain('+1');
  let state = await getState(page);
  expect(state.gold).toBe(0);
  expect(state.inventory['portal-shard'] ?? 0).toBe(0);
  expect((await progress(page)).forgeLevel).toBe(1);
  // Level 2 needs the Warden core.
  await setGold(page, 500);
  await give(page, 'portal-shard', 6);
  const denied = await service(page, 'forge', 'temper-sword');
  expect(denied).toEqual({ ok: false, message: 'You need 1 Warden Core.' });
  expect((await getState(page)).gold).toBe(500);

  // Alchemy level 1: 2 shards + 2 gel + 60 gold raises max HP by 2 and heals fully.
  const hpBefore = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.hp = 1;
    return GameState.instance.maxHp as number;
  });
  await give(page, 'slime-gel', 3);
  expect((await service(page, 'alchemy', 'vital-draught')).ok).toBe(true);
  const hp = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return { hp: GameState.instance.hp as number, maxHp: GameState.instance.maxHp as number };
  });
  expect(hp).toEqual({ hp: hpBefore + 2, maxHp: hpBefore + 2 });
  expect((await progress(page)).alchemyLevel).toBe(1);

  // Brew: 1 gel + 1 mushroom → 1 healing potion.
  expect((await service(page, 'alchemy', 'healing-potion')).ok).toBe(false);
  await give(page, 'mushroom', 1);
  const potionsBefore = (await getState(page)).inventory['healing-potion'] ?? 0;
  expect((await service(page, 'alchemy', 'healing-potion')).ok).toBe(true);
  state = await getState(page);
  expect(state.inventory['healing-potion']).toBe(potionsBefore + 1);
  expect(state.inventory['slime-gel'] ?? 0).toBe(0);
  expect(state.inventory.mushroom ?? 0).toBe(0);
});

test('Seren pins one job for two days, pays for it, and rotates the board', async ({ page }) => {
  await bootGame(page);
  expect((await progress(page)).board.active).toEqual({ id: 'wall-stone', postedDay: 1, dueDay: 2 });
  const serenBefore = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.relationships.residents.seren.points as number;
  });
  expect((await service(page, 'guild', 'board-job')).ok).toBe(false);
  await setGold(page, 0);
  await give(page, 'stone', 12);
  const done = await service(page, 'guild', 'board-job');
  expect(done.ok).toBe(true);
  expect((await getState(page)).gold).toBe(60);
  const after = await progress(page);
  expect(after.board.active).toBeNull();
  expect(after.board.completed).toBe(1);
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.relationships.residents.seren.points as number;
  })).toBe(serenBefore + 60);
  // The same day the board stays empty.
  expect((await service(page, 'guild', 'board-job')).message).toContain('tomorrow');

  // Next morning a new job goes up; ignored, it stays through day 3 and comes down on day 4.
  await page.evaluate(() => window.__TEST__!.sleep());
  expect((await progress(page)).board.active).toEqual({ id: 'rope-fiber', postedDay: 2, dueDay: 3 });
  await page.evaluate(() => window.__TEST__!.sleep());
  expect((await progress(page)).board.active).toEqual({ id: 'rope-fiber', postedDay: 2, dueDay: 3 });
  await page.evaluate(() => window.__TEST__!.sleep());
  expect((await progress(page)).board.active).toEqual({ id: 'slime-samples', postedDay: 4, dueDay: 5 });
});
