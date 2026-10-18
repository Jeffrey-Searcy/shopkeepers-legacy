/** General Market proof: the painted room's anchors, private access, atomic purchases, and old-save compatibility. */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, teleport, uiCanvasPoint } from './helpers/gameHarness';

/** Minimal stable shape consumed from the frozen pre-rebuild artifact. */
interface CompatibilityBaseline {
  market: { rawSave: string; position: { x: number; y: number; facing: string; stamina: number } };
  roomSignatures: Record<string, string>;
}

const baseline = JSON.parse(readFileSync(new URL('../planning_artifacts/town-interiors-market-proof/compatibility/baseline.json',
  import.meta.url), 'utf8')) as CompatibilityBaseline;

/** Hold a real movement key until the requested scene owns a controllable player. */
async function walkToScene(page: Page, key: string, scene: string): Promise<void> {
  await page.keyboard.down(key);
  try { await page.waitForFunction(target => window.__TEST__?.ready && window.__TEST__.activeScene() === target, scene); }
  finally { await page.keyboard.up(key); }
}

/** Enter the Market through its real Farm, Town, and civic-door travel path. */
async function enterMarket(page: Page): Promise<void> {
  await bootGame(page);
  await page.evaluate(() => window.__TEST__!.stepTime(180));
  await teleport(page, 95, 30, 'right');
  await walkToScene(page, 'd', 'TownScene');
  const door = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const warp = getMapData('TownScene').warps.find((candidate: { target: string }) => candidate.target === 'TownMarketScene');
    if (!warp) throw new Error('Market test: Town entrance is missing');
    return { tx: warp.tx, ty: warp.ty };
  });
  await teleport(page, door.tx, door.ty + 2, 'up');
  await walkToScene(page, 'w', 'TownMarketScene');
}

/** Walk with a real held key for a bounded time, then release it even if an assertion later fails. */
async function walkFor(page: Page, key: string, milliseconds: number): Promise<void> {
  await page.keyboard.down(key);
  try { await page.waitForTimeout(milliseconds); }
  finally { await page.keyboard.up(key); }
}

test('painted Market map matches its painting and connects the door, counter and private wing', async ({ page }) => {
  await enterMarket(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData('TownMarketScene'), room = civicInteriorBlueprint('market');
    const start = map.spawns.find((spawn: { id: string }) => spawn.id === 'entry');
    if (!start) throw new Error('Market test: entry spawn is missing');
    const target = room.serviceStand;
    const queue = [{ tx: start.tx, ty: start.ty }], seen = new Set([`${start.tx},${start.ty}`]);
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tx = point.tx + dx, ty = point.ty + dy, key = `${tx},${ty}`;
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || seen.has(key) || map.solid[ty][tx]) continue;
        seen.add(key); queue.push({ tx, ty });
      }
    }
    const bedSolid = Array.from({ length: room.bed.h }, (_, y) => Array.from({ length: room.bed.w }, (_, x) =>
      map.solid[room.bed.ty + y][room.bed.tx + x])).flat().every(Boolean);
    const backdrop = window.__GAME__!.scene.getScene('TownMarketScene').children.getByName('civic-market-backdrop');
    return { layout: room.layout, w: map.w, h: map.h, entry: start, reachesCounter: seen.has(`${target.tx},${target.ty}`),
      reachesBedroom: seen.has(`${room.bed.tx + 1},${room.bed.ty + room.bed.h}`), bedSolid, painted: Boolean(backdrop),
      counterSolid: map.solid[room.servicePoint.ty][room.servicePoint.tx], customerTileOpen: !map.solid[target.ty][target.tx],
      zones: { livingRoom: room.livingRoom, bedroom: room.bedroom, threshold: room.privateThreshold } };
  });
  expect(result).toEqual({ layout: 'painted', w: 34, h: 17, entry: { id: 'entry', tx: 10, ty: 13 }, reachesCounter: true,
    reachesBedroom: true, bedSolid: true, painted: true, counterSolid: true, customerTileOpen: true,
    zones: { livingRoom: { tx: 22, ty: 4, w: 11, h: 5 }, bedroom: { tx: 22, ty: 11, w: 11, h: 4 },
      threshold: { tx: 26, ty: 10, w: 2, h: 1, requiredHearts: 2 } } });
});

test('Tessa bedroom blocks below two hearts, opens live at two hearts, and never traps an occupant', async ({ page }) => {
  await enterMarket(page);
  await page.evaluate(() => window.__TEST__!.setResidentPoints('tessa', 0));
  await teleport(page, 26, 9, 'down');
  await walkFor(page, 's', 700);
  expect(Math.floor((await getState(page)).player.y / 16)).toBeLessThanOrEqual(10);

  await page.evaluate(() => window.__TEST__!.setResidentPoints('tessa', 500));
  await teleport(page, 26, 9, 'down');
  await expect.poll(async () => page.evaluate(() => {
    const gate = window.__GAME__!.scene.getScene('TownMarketScene').children.getByName('civic-private-gate-market') as Phaser.GameObjects.Zone;
    return { points: window.__TEST__!.state().relationships.residents.tessa.points,
      enabled: (gate.body as Phaser.Physics.Arcade.StaticBody).enable };
  })).toEqual({ points: 500, enabled: false });
  await walkFor(page, 's', 700);
  expect(Math.floor((await getState(page)).player.y / 16)).toBeGreaterThan(10);

  await teleport(page, 26, 12, 'up');
  await page.evaluate(() => window.__TEST__!.setResidentPoints('tessa', 0));
  await walkFor(page, 'w', 700);
  expect(Math.floor((await getState(page)).player.y / 16)).toBeLessThanOrEqual(10);
  await teleport(page, 26, 9, 'down');
  await expect.poll(async () => page.evaluate(() => {
    const gate = window.__GAME__!.scene.getScene('TownMarketScene').children.getByName('civic-private-gate-market') as Phaser.GameObjects.Zone;
    return (gate.body as Phaser.Physics.Arcade.StaticBody).enable;
  })).toBe(true);
  await walkFor(page, 's', 700);
  expect(Math.floor((await getState(page)).player.y / 16)).toBeLessThanOrEqual(10);
});

test('counter opens only from its exact customer-side tile and completes an exact seed purchase', async ({ page }) => {
  await enterMarket(page);
  await page.evaluate(() => window.__TEST__!.setGold(200));
  // (8,6) is beside the customer tile, facing the wall next to the counter: it must not open the shop.
  await teleport(page, 8, 6, 'up');
  await page.keyboard.press('e');
  expect((await getState(page)).marketPanelOpen).toBe(false);
  await teleport(page, 7, 6, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).marketPanelOpen).toBe(true);
  const before = await getState(page);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).gold).toBe(before.gold - 20);
  const after = await getState(page);
  expect(after.inventory['parsnip-seeds']).toBe(before.inventory['parsnip-seeds'] + 1);
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).marketPanelOpen).toBe(false);
});

test('pointer controls select stock and quantity before a separate confirmed purchase', async ({ page }) => {
  await enterMarket(page);
  await page.evaluate(() => window.__TEST__!.setGold(500));
  await teleport(page, 7, 6, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).marketPanelOpen).toBe(true);
  const before = await getState(page);
  // Potato is the second row: rows start at y 147 on a 43px pitch and are 38px tall (MarketUI.buildRows).
  const potatoRow = await uiCanvasPoint(page, { x: 600, y: 147 + 43 + 19 });
  await page.mouse.click(potatoRow.x, potatoRow.y);
  expect((await getState(page)).gold).toBe(before.gold);
  const fivePackets = await uiCanvasPoint(page, { x: 628, y: 417 });
  await page.mouse.click(fivePackets.x, fivePackets.y);
  const confirm = await uiCanvasPoint(page, { x: 756, y: 417 });
  await page.mouse.click(confirm.x, confirm.y);
  await expect.poll(async () => (await getState(page)).gold).toBe(before.gold - 250);
  const after = await getState(page);
  const beforePotatoes = Object.prototype.hasOwnProperty.call(before.inventory, 'potato-seeds')
    ? before.inventory['potato-seeds'] : 0;
  expect(after.inventory['potato-seeds']).toBe(beforePotatoes + 5);
});

test('rejected Market purchases leave gold, counts, and slot locations unchanged', async ({ page }) => {
  await enterMarket(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { MarketSystem } = await import('/src/systems/MarketSystem.ts');
    const gs = GameState.instance;
    const invalid = [0, -1, 0.5, Number.MAX_SAFE_INTEGER].map(quantity => {
      const before = JSON.stringify(gs.toSaveData());
      let error = '';
      try { MarketSystem.buy('parsnip-seeds', quantity); }
      catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
      return { error, same: before === JSON.stringify(gs.toSaveData()) };
    });
    gs.gold = 0;
    const poorBefore = JSON.stringify(gs.toSaveData());
    const poor = MarketSystem.buy('potato-seeds', 1);
    const poorAfter = JSON.stringify(gs.toSaveData());

    gs.gold = 9999;
    gs.backpackSlots = Array.from({ length: 24 }, (_, index) => `test-full-${index}`);
    for (const entry of gs.backpackSlots) if (entry) gs.inventory[entry] = 1;
    const fullBefore = JSON.stringify(gs.toSaveData());
    const full = MarketSystem.buy('melon-seeds', 1);
    const fullAfter = JSON.stringify(gs.toSaveData());
    const unknownBefore = fullAfter;
    const unknown = MarketSystem.buy('not-stock', 1);
    const unknownAfter = JSON.stringify(gs.toSaveData());
    return { invalid, poor, poorSame: poorBefore === poorAfter, full, fullSame: fullBefore === fullAfter,
      unknown, unknownSame: unknownBefore === unknownAfter };
  });
  expect(result.invalid).toHaveLength(4);
  for (const invalid of result.invalid) { expect(invalid.error).not.toBe(''); expect(invalid.same).toBe(true); }
  expect(result.poor.ok).toBe(false); expect(result.poorSame).toBe(true);
  expect(result.full.ok).toBe(false); expect(result.fullSame).toBe(true);
  expect(result.unknown.ok).toBe(false); expect(result.unknownSame).toBe(true);
});

test('pre-paint Market save resumes at the painted door with a notice and no byte change', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(({ raw }) => localStorage.setItem('shopkeeperslegacy.save.v1.slot.3', raw), { raw: baseline.market.rawSave });
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__!.scene.isActive('MainMenuScene'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__?.ready && window.__TEST__.activeScene() === 'TownMarketScene');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live source module inside the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const state = window.__TEST__!.state(), map = getMapData('TownMarketScene');
    const entry = map.spawns.find((spawn: { id: string }) => spawn.id === 'entry');
    return { player: state.player, entry, raw: localStorage.getItem('shopkeeperslegacy.save.v1.slot.3') };
  });
  expect(result.player).toMatchObject({ x: (result.entry.tx + 0.5) * 16, y: (result.entry.ty + 0.5) * 16,
    stamina: baseline.market.position.stamina });
  expect(result.raw).toBe(baseline.market.rawSave);
});
