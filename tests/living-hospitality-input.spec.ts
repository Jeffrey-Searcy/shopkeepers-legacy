/** Native recipe and broom controls verify the visible tool reaches the same safe guest transaction. */
import { expect, test } from '@playwright/test';
import { getState, give, teleport, uiCanvasPoint } from './helpers/gameHarness';
import { enterFurnishedShop } from './helpers/hospitalityHarness';

test('craft a broom, carry it, and use Space to send a drunk lodger upstairs without taking their room', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await page.evaluate(() => window.__GAME__!.renderer.type)).toBe(2);
  await enterFurnishedShop(page, true);
  await give(page, 'fiber', 8);
  // Recipe-panel fixture only: station access has separate native workbench coverage.
  await page.evaluate(async () => {
    // @ts-expect-error Browser runtime module.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.craftingOpen = true;
  });
  await page.waitForFunction(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('crafting-panel') as any).visible);
  const recipe = await page.evaluate(() => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('crafting-panel') as any;
    const cell = panel.list.find((child: any) => child.name === 'crafting-recipe-broom');
    if (!cell) throw new Error('Crafted broom recipe is missing');
    const bounds = cell.getBounds(); return { x: bounds.centerX, y: bounds.centerY };
  });
  const point = await uiCanvasPoint(page, recipe);
  await page.mouse.click(point.x, point.y);
  const beforeCraft = await getState(page);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).inventory.broom).toBe(1);
  expect((await getState(page)).inventory.wood).toBe(beforeCraft.inventory.wood - 4);
  expect((await getState(page)).inventory.fiber).toBeUndefined();
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).craftingOpen).toBe(false);
  // Run real check-in and three real ale transactions in a bounded time fixture. The broom input below stays native.
  const target = await page.evaluate(async () => {
    const [state, system, slots] = await Promise.all([
      // @ts-expect-error Browser runtime module.
      import('/src/state/GameState.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/TavernSystem.ts'),
      // @ts-expect-error Browser runtime module.
      import('/src/systems/InventoryLayoutSystem.ts'),
    ]);
    const gs = state.GameState.instance, tavern = system.TavernSystem;
    /** Advance all real guest phases until the requested fixture point, failing on a stalled visit. */
    const until = (predicate: () => boolean): void => {
      for (let index = 0; !predicate() && index < 3000; index++) tavern.tick(100);
      if (!predicate()) throw new Error('Timed guest fixture did not reach its phase');
    };
    /** Equip an existing stack through the production inventory operation. */
    const equip = (item: string): void => {
      const source = slots.findEntrySlot(gs, item);
      if (!source) throw new Error('Missing fixture stack ' + item);
      slots.moveOrSwap(gs, source, { container: 'toolbelt', index: 0 }); gs.hotbarIndex = 0;
    };
    gs.player = { ...gs.player, x: 88, y: 152, facing: 'down' };
    gs.tavern.nextGuestId = 2;
    if (!tavern.openInn().ok) throw new Error('Could not open fixture inn');
    until(() => gs.tavern.guests.some((guest: any) => guest.phase === 'waiting'));
    const resident = gs.tavern.guests[0];
    if (!tavern.checkIn(resident.id).ok || !tavern.closeInn().ok || !tavern.open().ok) throw new Error('Could not admit fixture lodger');
    gs.addItem('ale', 3); equip('ale');
    for (let index = 0; index < 3; index++) {
      until(() => resident.phase === 'waiting' && resident.product === 'ale');
      const view = tavern.guestViews().find((view: any) => view.guest.id === resident.id);
      const keeper = view.destination.keeper;
      gs.player = keeper ? { ...gs.player, x: (keeper.tx + .5) * 16, y: (keeper.ty + .5) * 16, facing: keeper.facing }
        : { ...gs.player, x: (view.destination.tile.tx + .5) * 16, y: (view.destination.tile.ty + 1.5) * 16, facing: 'up' };
      if (!tavern.serve(resident.id).ok) throw new Error('Fixture ale sale failed');
    }
    equip('broom');
    const tile = resident.route[resident.route.length - 1];
    return { id: resident.id, tx: tile.tx, ty: tile.ty + 1, gold: gs.gold, roomId: resident.roomId };
  });
  await teleport(page, target.tx, target.ty, 'up');
  await page.keyboard.press('1');
  await page.waitForFunction(id => {
    const scene = window.__GAME__!.scene.getScene('TavernScene');
    const held = scene.children.getByName('player-held-item') as any;
    const guest = scene.children.getByName(`shop-guest-${id}`) as any;
    return held && held.visible && held.getData('item') === 'broom' && guest && guest.getData('mood') === 'drunk';
  }, target.id);
  await page.screenshot({ path: 'output/playwright/living-shop/drunk-broom.png' });
  await page.keyboard.press('Space');
  await expect.poll(async () => (await getState(page)).tavern.guests.find(guest => guest.id === target.id)!.phase).toBe('ascending');
  const after = await getState(page);
  expect(after.tavern.reservations.some(room => room.guestId === target.id && room.roomId === target.roomId)).toBe(true);
  expect(after.gold).toBe(target.gold);
  expect(after.inventory.broom).toBe(1);
  expect(errors).toEqual([]);
});
