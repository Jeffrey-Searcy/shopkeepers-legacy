/** Native-input hospitality loops: finite batch production, independent openings and paid stays. */
import { expect, test } from '@playwright/test';
import { bootGame, getState, give, setGold, teleport } from './helpers/gameHarness';
import { clickHospitalityControl, closeHospitalityStation, enterFurnishedShop, openHospitalityStation } from './helpers/hospitalityHarness';

test('real batch controls cook and brew 1, 5 and max without inventing supplies', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page);
  await enterFurnishedShop(page);
  await give(page, 'parsnip', 9);
  await setGold(page, 104);
  await openHospitalityStation(page, 'kitchen');
  for (const [batch, portions, remaining] of [[1, 8, 8], [5, 28, 3], ['max', 40, 0]] as const) {
    await clickHospitalityControl(page, `tavern-batch-${batch}`);
    await clickHospitalityControl(page, 'tavern-action-cook-parsnip');
    await expect.poll(async () => (await getState(page)).inventory.stew).toBe(portions);
    const inventory = (await getState(page)).inventory;
    if (remaining === 0) expect(inventory.parsnip).toBeUndefined();
    else expect(inventory.parsnip).toBe(remaining);
  }
  for (const [batch, ale, gold, wood] of [[1, 4, 96, 19], [5, 24, 56, 14], ['max', 52, 0, 7]] as const) {
    await clickHospitalityControl(page, `tavern-batch-${batch}`);
    await clickHospitalityControl(page, 'tavern-action-brew');
    await expect.poll(async () => (await getState(page)).inventory.ale).toBe(ale);
    const state = await getState(page);
    expect(state.gold).toBe(gold);
    expect(state.inventory.wood).toBe(wood);
  }
  const before = await getState(page);
  await clickHospitalityControl(page, 'tavern-action-brew');
  await clickHospitalityControl(page, 'tavern-action-cook-parsnip');
  const after = await getState(page);
  expect(after.tavern).toEqual(before.tavern);
  expect(after.inventory).toEqual(before.inventory);
  expect(after.gold).toBe(before.gold);
  await page.screenshot({ path: '.frontend-loop/hospitality/screenshots/batch-kitchen.png' });
  expect(errors).toEqual([]);
});

test('direct check-in and equipped service work beside independent management controls', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await page.evaluate(() => window.__GAME__!.renderer.type)).toBe(2);
  await enterFurnishedShop(page, true);
  await openHospitalityStation(page, 'ledger');
  await clickHospitalityControl(page, 'tavern-action-open-inn');
  expect((await getState(page)).tavern).toMatchObject({ innOpen: true, tavernOpen: false });
  await clickHospitalityControl(page, 'tavern-action-open-tavern');
  expect((await getState(page)).tavern).toMatchObject({ innOpen: true, tavernOpen: true });
  await closeHospitalityStation(page);
  await expect.poll(async () => (await getState(page)).tavern.guests.some(guest => guest.kind === 'inn' && guest.phase === 'waiting'), { timeout: 12_000 }).toBe(true);
  await teleport(page, 5, 9, 'down');
  await page.screenshot({ path: 'output/playwright/living-shop/front-register.png' });
  await page.keyboard.press('e');
  const paid = await getState(page);
  expect(paid.gold).toBe(24);
  expect(paid.tavern.reservations).toHaveLength(1);
  expect(paid.tavern.reservations[0].checkoutDay).toBe(paid.day + 1);
  expect(paid.tavern.guests.find(guest => guest.kind === 'inn')!.phase).toBe('ascending');
  expect(paid.tavernPanel).toBe(null);
  await page.keyboard.press('e');
  expect((await getState(page)).gold).toBe(24);
  await page.keyboard.press('m');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe('ledger');
  await page.waitForFunction(() => (window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel') as any).visible);
  await clickHospitalityControl(page, 'tavern-action-close-inn');
  expect((await getState(page)).tavern).toMatchObject({ innOpen: false, tavernOpen: true, roomBookings: 1 });
  await closeHospitalityStation(page);
  const residentId = paid.tavern.reservations[0].guestId;
  await expect.poll(async () => (await getState(page)).tavern.guests.some(guest => guest.id === residentId && guest.phase === 'upstairs'), { timeout: 12_000 }).toBe(true);
  expect((await getState(page)).tavern.reservations).toHaveLength(1);
  await expect.poll(async () => (await getState(page)).tavern.guests.some(guest => guest.kind === 'tavern' && guest.phase === 'waiting'), { timeout: 20_000 }).toBe(true);
  const order = (await getState(page)).tavern.guests.find(guest => guest.kind === 'tavern' && guest.phase === 'waiting')!;
  await page.screenshot({ path: '.frontend-loop/hospitality/screenshots/seated-and-bar-orders.png' });
  {
    const spot = await page.evaluate(async id => {
      // @ts-expect-error Read-only location query; E performs the actual sale.
      const { TavernSystem } = await import('/src/systems/TavernSystem.ts');
      const view = TavernSystem.guestViews().find((view: { guest: { id: number } }) => view.guest.id === id);
      if (!view) throw new Error(`Accepted guest ${id} disappeared before service`);
      if (view.destination.kind === 'bar') return view.destination.keeper;
      return { tx: view.destination.tile.tx, ty: view.destination.tile.ty + 1, facing: 'up' };
    }, order.id);
    await teleport(page, spot.tx, spot.ty, spot.facing);
    // Empty hands cannot silently take goods out of storage.
    await page.keyboard.press('e');
    expect((await getState(page)).tavern.totalServed).toBe(0);
    const item = order.product === 'ale' ? 'ale' : 'stew';
    await give(page, item, 2);
    await page.evaluate(async item => {
      // @ts-expect-error Actual slot system sets up the stack; the real digit and E deliver it.
      const { InventoryLayoutSystem, findEntrySlot } = await import('/src/systems/InventoryLayoutSystem.ts');
      // @ts-expect-error Browser runtime module.
      const { GameState } = await import('/src/state/GameState.ts');
      const gs = GameState.instance, source = findEntrySlot(gs, item);
      if (!source) throw new Error('Expected prepared item in bag');
      InventoryLayoutSystem.moveOrSwap(gs, source, { container: 'toolbelt', index: 0 });
    }, item);
    await page.keyboard.press('1');
    await page.waitForFunction(item => {
      const held = window.__GAME__!.scene.getScene('TavernScene').children.getByName('player-held-item') as any;
      return held && held.visible && held.getData('item') === item;
    }, item);
    const before = await getState(page);
    await page.screenshot({ path: 'output/playwright/living-shop/held-service.png' });
    await page.keyboard.press('e');
    await expect.poll(async () => (await getState(page)).tavern.totalServed).toBe(1);
    const after = await getState(page);
    expect(after.inventory[item]).toBe(before.inventory[item] - 1);
    expect(after.gold - before.gold).toBe(item === 'stew' ? 12 : 8);
    await page.keyboard.press('e');
    expect((await getState(page)).gold).toBe(after.gold);
  }
  await openHospitalityStation(page, 'ledger');
  await clickHospitalityControl(page, 'tavern-action-close-tavern');
  await clickHospitalityControl(page, 'tavern-action-open-inn');
  const closing = await getState(page);
  expect(closing.tavern).toMatchObject({ tavernOpen: false, innOpen: true, roomBookings: 1 });
  expect(closing.tavern.reservations).toHaveLength(1);
  expect(closing.tavern.guests.filter(guest => guest.kind === 'tavern').every(guest => guest.phase === 'leaving' || guest.phase === 'eating')).toBe(true);
  expect(errors).toEqual([]);
});
