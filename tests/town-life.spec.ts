/**
 * Town life proofs: favors with the "!" marker, news that spreads through meetings into gossip,
 * the daily cap on chat friendship, and the save v19 round trip of the town-life record.
 * Kept small on purpose: one rules test and one Town marker test.
 */
import { expect, test } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

test('favors pay once, news spreads through meetings into gossip, chat gain is capped, and town life saves', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { TownLifeSystem } = await import('/src/systems/TownLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentTopicForDay } = await import('/src/config/ResidentCharacterSheets.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    const gs = GameState.instance;

    // Favor: none on the quiet first day, then posted on refresh, ignored by others, waits without items, pays once.
    TownLifeSystem.refreshDay();
    const firstDay = TownLifeSystem.openFavor();
    gs.day = 2;
    TownLifeSystem.refreshDay();
    const open = TownLifeSystem.openFavor();
    if (!open) throw new Error('Expected a favor on day 2');
    const owner = open.favor.residentId, other = owner === 'nyra' ? 'tessa' : 'nyra';
    const ignored = TownLifeSystem.talkAboutFavor(other).kind;
    const waiting = TownLifeSystem.talkAboutFavor(owner).kind;
    if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [open.favor.item]: open.favor.count })) throw new Error('Bag is full');
    const goldBefore = gs.gold;
    const done = TownLifeSystem.talkAboutFavor(owner);
    const again = TownLifeSystem.talkAboutFavor(owner).kind;

    // News: Rowan tells Bram his topic; Bram meets Kit, so Kit can now gossip about Rowan.
    const effect = (bondId: string) => ({ bondId, day: gs.day, outcome: 'conversation', action: 'chat', witnesses: [], mutations: [] });
    const kitBefore = TownLifeSystem.gossipLine('kit');
    TownLifeSystem.recordMeetingNews(effect('rowan-bram'), ['rowan', 'bram'], 'rowan');
    TownLifeSystem.recordMeetingNews(effect('bram-kit'), ['bram', 'kit'], 'kit');
    const kitAfter = TownLifeSystem.gossipLine('kit');
    const rowanTopic = residentTopicForDay('rowan', gs.day).summary;
    const context = TownLifeSystem.newsContext(['bram', 'kit']);

    // Chat gain: 5 per good reply, capped at 15 per resident per day.
    const gains = [1, 2, 3, 4].map(() => {
      const before = gs.relationships.residents.seren.points;
      TownLifeSystem.grantChatFriendship('seren');
      return gs.relationships.residents.seren.points - before;
    });

    // Save round trip keeps the record exactly.
    const saved = JSON.stringify(gs.townLife);
    SaveSystem.save(1, 123);
    const version = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!).version;
    SaveSystem.load(1);
    return { firstDay, ignored, waiting, done: done.kind, paid: GameState.instance.gold - goldBefore, gold: done.kind === 'done' ? done.gold : -1,
      again, favorsDone: GameState.instance.townLife.favorsDone, kitBefore, kitAfter, rowanTopic, context, gains,
      version, roundTrip: JSON.stringify(GameState.instance.townLife) === saved };
  });
  expect(result.firstDay).toBeNull();
  expect(result.ignored).toBe('none');
  expect(result.waiting).toBe('waiting');
  expect(result.done).toBe('done');
  expect(result.paid).toBe(result.gold);
  expect(result.again).toBe('none');
  expect(result.favorsDone).toBe(1);
  expect(result.kitBefore).toBeNull();
  expect(result.kitAfter!.toLowerCase()).toContain(result.rowanTopic.toLowerCase());
  expect(result.context.some((line: string) => line === result.rowanTopic)).toBe(true);
  expect(result.gains).toEqual([5, 5, 5, 0]);
  expect(result.version).toBe(30);
  expect(result.roundTrip).toBe(true);
});

test('the favor owner shows a "!" marker in Town', async ({ page }) => {
  await bootGame(page);
  const owner = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { TownLifeSystem } = await import('/src/systems/TownLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentTownPresence } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    // The first favor posts on day 2 (day 1 stays quiet).
    GameState.instance.day = 2;
    TownLifeSystem.refreshDay();
    const open = TownLifeSystem.openFavor();
    if (!open) throw new Error('Expected a favor on day 2');
    const id = open.favor.residentId;
    // Pick a minute when the owner stands outdoors in Town.
    const map = getMapData('TownScene');
    let minute = 0;
    while (minute <= 1080 && !residentTownPresence(id, 2, minute, map)) minute += 5;
    if (minute > 1080) throw new Error(`${id} never goes outdoors on day 2`);
    GameState.instance.devTuning.clockScale = 0;
    GameState.instance.timeOfDay = minute;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), 'TownScene', 'from_farm');
    return id as string;
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  await expect.poll(() => page.evaluate(id => {
    const mark = window.__GAME__!.scene.getScene('TownScene').children.getByName(`town-favor-${id}`) as Phaser.GameObjects.Text | null;
    return mark?.visible ?? false;
  }, owner)).toBe(true);
});
