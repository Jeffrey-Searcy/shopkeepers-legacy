/** Native sold-out/broom controls and WebGL evidence for guest conversations, emotions and paired fights. */
import { expect, test, type Page } from '@playwright/test';
import { conversationFor, TAVERN_CONVERSATIONS } from '../src/config/TavernConversations';
import type { TavernGuest } from '../src/config/Tavern';
import { bootGame, getState, teleport, uiCanvasPoint } from './helpers/gameHarness';
import { enterFurnishedShop } from './helpers/hospitalityHarness';

/** Minimal typed social record; pure dialogue tests need no Phaser or inventory fixture. */
function chatting(id: number, elapsedMs: number): TavernGuest {
  return { id, visitorId: 'visitor-alder', kind: 'tavern', phase: 'chatting', elapsedMs,
    destinationId: 'social:1,1', product: null, roomId: null, route: [{ tx: 1, ty: 1 }], drinks: 0, orders: 0 };
}

test('paired dialogue has one speaker, alternating replies, distinct topics and a resting end', () => {
  const first = chatting(1, 1100), second = chatting(2, 0);
  const topics = new Set<string>();
  for (let day = 1; day <= 12; day++) topics.add(conversationFor(first, second, day, 0).topicId);
  expect(topics.size).toBe(12);
  for (let beat = 0; beat < 4; beat++) {
    first.elapsedMs = 1100 + beat * 1900; second.elapsedMs = beat * 1900;
    const a = conversationFor(first, second, 1, 0), b = conversationFor(second, first, 1, 0);
    expect(a.topicId).toBe(b.topicId); expect(a.beat).toBe(beat); expect(b.beat).toBe(beat);
    expect(a.speaking).toBe(beat % 2 === 0); expect(b.speaking).toBe(!a.speaking);
    expect([a.line, b.line].filter(Boolean)).toHaveLength(1);
    expect(TAVERN_CONVERSATIONS.find(topic => topic.id === a.topicId)!.lines[beat]).toBe(a.line || b.line);
  }
  first.elapsedMs = second.elapsedMs = 8000;
  expect(conversationFor(first, second, 1, 0).speaking).toBe(false);
  expect(conversationFor(second, first, 1, 0).speaking).toBe(false);
  const simultaneous = [0, 1, 2].map(pocket => conversationFor(chatting(pocket * 2 + 1, 0), chatting(pocket * 2 + 2, 0), 1, pocket).topicId);
  expect(new Set(simultaneous).size).toBe(3);
});

/** Arrange real empty-stock demand through the production admission/phase engine, not a fake UI callback. */
async function soldOutGuest(page: Page): Promise<{ id: number; tx: number; ty: number; facing: string }> {
  return page.evaluate(async () => {
    const [state, system] = await Promise.all([
      // @ts-expect-error Vite runtime module.
      import('/src/state/GameState.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/systems/TavernSystem.ts'),
    ]);
    const gs = state.GameState.instance;
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    if (!system.TavernSystem.open().ok) throw new Error('Could not open test tavern');
    for (let index = 0; index < 1800 && !gs.tavern.guests.some((guest: TavernGuest) => guest.phase === 'waiting' && guest.product === 'ale'); index++) {
      system.TavernSystem.tick(100);
    }
    const view = system.TavernSystem.guestViews().find((view: { guest: TavernGuest }) => view.guest.phase === 'waiting' && view.guest.product === 'ale');
    if (!view || !view.destination.keeper) throw new Error('No waiting bar guest in fixture');
    return { id: view.guest.id, ...view.destination.keeper };
  });
}

for (const action of ['keyboard', 'pointer'] as const) test(`native ${action} sold-out reply is deliberate, guarded and charges nothing`, async ({ page }) => {
  await bootGame(page); await enterFurnishedShop(page);
  const guest = await soldOutGuest(page);
  await teleport(page, 20, 14, 'up'); await page.keyboard.press('q');
  expect((await getState(page)).tavern.guests.find(candidate => candidate.id === guest.id)!.phase).toBe('waiting');
  await teleport(page, guest.tx, guest.ty, guest.facing);
  await page.waitForFunction(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('guest-sold-out') as Phaser.GameObjects.Text).visible);
  await page.keyboard.press('i'); await page.keyboard.press('q');
  expect((await getState(page)).tavern.guests.find(candidate => candidate.id === guest.id)!.phase).toBe('waiting');
  await page.keyboard.press('i');
  // Closing the bag clears state immediately; the contextual button becomes visible on the next UI frame.
  // Native pointer input must wait for the rendered control, not click its still-hidden bounds.
  await page.waitForFunction(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('guest-sold-out') as Phaser.GameObjects.Text).visible);
  const before = await getState(page);
  if (action === 'keyboard') await page.keyboard.press('q');
  else {
    const point = await page.evaluate(() => {
      const button = window.__GAME__!.scene.getScene('UIScene').children.getByName('guest-sold-out') as Phaser.GameObjects.Text;
      const bounds = button.getBounds(); return { x: bounds.centerX, y: bounds.centerY };
    });
    const screen = await uiCanvasPoint(page, point); await page.mouse.click(screen.x, screen.y);
  }
  await expect.poll(async () => (await getState(page)).tavern.guests.find(candidate => candidate.id === guest.id)!.phase).toBe('leaving');
  const after = await getState(page);
  expect(after.gold).toBe(before.gold); expect(after.inventory).toEqual(before.inventory);
  expect(after.player.stamina).toBe(before.player.stamina); expect(after.tavern.tavernOpen).toBe(true);
  await page.keyboard.press('q'); expect((await getState(page)).gold).toBe(before.gold);
});

/** Validated visual fixture: only two current guests, with three paid ales represented in exact accounting. */
async function visiblePair(page: Page, kind: 'chat' | 'angry' | 'fight'): Promise<{ target: number; other: number; tx: number; ty: number }> {
  return page.evaluate(async kind => {
    const [state, system, config, slots, layout, maps] = await Promise.all([
      // @ts-expect-error Vite runtime module.
      import('/src/state/GameState.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/systems/TavernSystem.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/config/Tavern.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/systems/InventoryLayoutSystem.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/systems/TavernLayout.ts'),
      // @ts-expect-error Vite runtime module.
      import('/src/world/MapDef.ts'),
    ]);
    const gs = state.GameState.instance, resolved = system.TavernSystem.layout();
    const destinations = kind === 'chat' ? resolved.social : resolved.destinations;
    let pair = [destinations[0], destinations[1]];
    if (kind === 'chat') {
      const first = resolved.social.find((entry: { facing: string; tile: { tx: number; ty: number } }) => entry.facing === 'right' &&
        resolved.social.some((other: { facing: string; tile: { tx: number; ty: number } }) => other.facing === 'left' && other.tile.tx === entry.tile.tx + 1 && other.tile.ty === entry.tile.ty));
      if (!first) throw new Error('No real conversation pocket');
      const second = resolved.social.find((entry: { tile: { tx: number; ty: number } }) => entry.tile.tx === first.tile.tx + 1 && entry.tile.ty === first.tile.ty);
      if (!second) throw new Error('No real conversation partner pocket');
      pair = [first, second];
    }
    gs.tavern.serviceDay = gs.day; gs.tavern.nextGuestId = 3; gs.tavern.tavernOpen = true;
    gs.tavern.admissionMs = 0; gs.tavern.admissionWaitMs = 9000; gs.tavern.fights = [];
    gs.tavern.totalServed = 3; gs.tavern.servedToday = 3; gs.tavern.aleSold = 3; gs.tavern.foodSold = 0; gs.tavern.revenue = 24;
    gs.tavern.guests = pair.map((destination, index) => ({
      id: index + 1, visitorId: config.TAVERN_VISITORS[index].id, kind: 'tavern',
      phase: kind === 'chat' ? 'chatting' : 'waiting', elapsedMs: kind === 'chat' ? 0 : index === 0 ? config.TAVERN_ANGRY_MS : 0,
      destinationId: destination.id, product: kind === 'chat' ? null : index === 0 ? 'food' : 'ale', roomId: null,
      route: [{ ...destination.tile }], drinks: kind === 'fight' && index === 1 ? 3 : 0, orders: index === 1 ? 3 : 0,
    }));
    if (kind === 'fight') system.TavernSystem.tick(1);
    config.validateTavernState(gs.tavern, gs.day);
    layout.validateTavernLayoutState(gs.tavern, gs.placedItems, maps.getMapData('TavernScene'));
    gs.addItem('broom', 1);
    const source = slots.findEntrySlot(gs, 'broom');
    if (!source) throw new Error('No fixture broom');
    slots.moveOrSwap(gs, source, { container: 'toolbelt', index: 0 }); gs.hotbarIndex = 0;
    return { target: 1, other: 2, tx: pair[0].tile.tx, ty: pair[0].tile.ty + 1 };
  }, kind);
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 800, height: 600 }]) test.describe(`${viewport.width}px WebGL`, () => {
  test.use({ viewport });
  test('real paired speech, steam and cartoon fight render; native broom removes only faced sober fighter', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?test=1&seed=42&renderer=webgl');
    await page.waitForFunction(() => window.__TEST__?.ready === true);
    await enterFurnishedShop(page);
    const chat = await visiblePair(page, 'chat'); await teleport(page, chat.tx, chat.ty + 2, 'up');
    await page.waitForFunction(() => {
      const scene = window.__GAME__!.scene.getScene('TavernScene');
      return scene.children.list.filter(node => node.name.startsWith('shop-order-') && (node as Phaser.GameObjects.Container).visible).length === 1;
    });
    await page.screenshot({ path: `output/personality/chat-${viewport.width}.png` });
    expect(await page.evaluate(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-objective') as Phaser.GameObjects.Container).visible)).toBe(false);
    await page.keyboard.press('j');
    await page.waitForFunction(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-objective') as Phaser.GameObjects.Container).visible);
    await page.keyboard.press('j');
    await page.waitForFunction(() => !(window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-objective') as Phaser.GameObjects.Container).visible);
    const speaker = await page.evaluate(() => window.__GAME__!.scene.getScene('TavernScene').children.list.find(node => node.name.startsWith('shop-order-') && (node as Phaser.GameObjects.Container).visible)!.name);
    await expect.poll(async () => page.evaluate(() => window.__GAME__!.scene.getScene('TavernScene').children.list.find(node => node.name.startsWith('shop-order-') && (node as Phaser.GameObjects.Container).visible)!.name)).not.toBe(speaker);
    const angry = await visiblePair(page, 'angry'); await teleport(page, angry.tx, angry.ty + 1, 'up');
    await page.waitForFunction(() => window.__GAME__!.scene.getScene('TavernScene').children.getByName('guest-emotion-1')!.getData('steam') === true);
    await page.screenshot({ path: `output/personality/anger-${viewport.width}.png` });
    const fight = await visiblePair(page, 'fight'); await teleport(page, fight.tx, fight.ty, 'up');
    await page.waitForFunction(() => window.__GAME__!.scene.getScene('TavernScene').children.getByName('guest-fight-1-2') !== null);
    await page.screenshot({ path: `output/personality/fight-${viewport.width}.png` });
    await page.keyboard.press('1'); await page.keyboard.press('Space');
    await expect.poll(async () => (await getState(page)).tavern.guests.find(guest => guest.id === fight.target)!.phase).toBe('leaving');
    const after = await getState(page);
    expect(after.tavern.guests.find(guest => guest.id === fight.other)!.phase).toBe('waiting');
    expect(after.tavern.fights).toEqual([]); expect(after.tavern.tavernOpen).toBe(true);
    await page.waitForFunction(() => window.__GAME__!.scene.getScene('TavernScene').children.getByName('guest-fight-1-2') === null);
    await page.screenshot({ path: `output/personality/broom-${viewport.width}.png` });
    expect(errors).toEqual([]);
  });
});
