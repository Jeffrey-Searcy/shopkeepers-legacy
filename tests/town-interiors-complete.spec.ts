/**
 * Civic-interior proof: old saves in the repainted rooms, room-fit services, live private gates, and shared UI.
 * Every room except the clinic is a painting (world/CivicRoomArt.ts); the clinic keeps its built room.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { bootGame, getState, teleport, uiCanvasPoint } from './helpers/gameHarness';

interface BaselineRoom {
  room: { w: number; h: number; fixtures: unknown[] };
  geometry: { w: number; h: number; solid: boolean[][]; spawns: Array<{ id: string; tx: number; ty: number }> };
  position: { x: number; y: number; facing: string; stamina: number };
  rawSave: string;
}
interface CompleteBaseline { rooms: Record<string, BaselineRoom> }
const baseline = JSON.parse(readFileSync(new URL('../planning_artifacts/town-interiors-complete/compatibility/baseline.json',
  import.meta.url), 'utf8')) as CompleteBaseline;
const BUILDINGS = Object.keys(baseline.rooms);
/** Enter a civic building through the same transition authority used by real doors. */
async function enterBuilding(page: Page, id: string): Promise<{ scene: string; owner: string }> {
  const result = await page.evaluate(async buildingId => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { townBuilding } = await import('/src/config/TownBuildings.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { residentForBuilding } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    const building = townBuilding(buildingId);
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), building.scene, 'entry');
    return { scene: building.scene as string, owner: residentForBuilding(buildingId).id as string };
  }, id);
  await page.waitForFunction(scene => window.__TEST__?.ready && window.__TEST__.activeScene() === scene, result.scene);
  await page.waitForTimeout(50);
  return result;
}

/** Wait until the parallel UI has rendered the newly opened civic service. */
async function waitForServicePanel(page: Page, building: string): Promise<void> {
  await page.waitForFunction(expected => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const panel = scene.children.getByName('civic-service-panel') as Phaser.GameObjects.Container;
    return panel?.visible === true && panel.getData('building') === expected;
  }, building);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('old saves keep the built clinic exactly and move a keeper in a repainted room to its door', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async frozen => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { townBuilding } = await import('/src/config/TownBuildings.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { GameState } = await import('/src/state/GameState.ts');
    const rows = [];
    for (const [id, old] of Object.entries(frozen.rooms)) {
      const building = townBuilding(id), room = civicInteriorBlueprint(id), map = getMapData(building.scene);
      localStorage.setItem(SaveSystem.storageKey(3), old.rawSave);
      SaveSystem.load(3);
      const notice = SaveSystem.consumeMigrationNotice();
      const state = GameState.instance, tx = Math.floor(state.player.x / 16), ty = Math.floor(state.player.y / 16);
      const entry = map.spawns.find((spawn: { id: string }) => spawn.id === 'entry');
      const row: Record<string, unknown> = { id, layout: room.layout, player: { ...state.player }, entry, notice,
        walkable: !map.solid[ty][tx], rawUnchanged: localStorage.getItem(SaveSystem.storageKey(3)) === old.rawSave };
      if (room.layout === 'built') {
        const regressions: string[] = [], opened: string[] = [];
        for (let y = 0; y < old.geometry.h; y++) for (let x = 0; x < old.geometry.w; x++) {
          if (!old.geometry.solid[y][x] && map.solid[y][x]) regressions.push(`${x},${y}`);
          if (old.geometry.solid[y][x] && !map.solid[y][x]) opened.push(`${x},${y}`);
        }
        Object.assign(row, { w: map.w, expectedW: old.geometry.w + 12, h: map.h, expectedH: old.geometry.h,
          oldEntry: old.geometry.spawns[0], fixtures: building.room.fixtures, oldFixtures: old.room.fixtures,
          regressions, opened, allowedOpened: [5, 6, 7].map(y => `${room.baseW - 1},${y}`), expectedPlayer: old.position });
      } else {
        Object.assign(row, { w: map.w, expectedW: room.w, h: map.h, expectedH: room.h,
          spawn: { id: 'entry', tx: room.spawn.tx, ty: room.spawn.ty } });
      }
      rows.push(row);
    }
    return rows;
  }, baseline);
  expect(result.map(row => row.layout).sort()).toEqual(['built', ...Array(10).fill('painted')]);
  for (const row of result) {
    expect(row.w, String(row.id)).toBe(row.expectedW); expect(row.h, String(row.id)).toBe(row.expectedH);
    expect(row.walkable, String(row.id)).toBe(true); expect(row.rawUnchanged, String(row.id)).toBe(true);
    if (row.layout === 'built') {
      expect(row.entry, String(row.id)).toEqual(row.oldEntry);
      expect(row.fixtures, String(row.id)).toEqual(row.oldFixtures);
      expect(row.regressions, String(row.id)).toEqual([]);
      expect(row.opened, String(row.id)).toEqual(row.allowedOpened);
      expect(row.player, String(row.id)).toEqual(row.expectedPlayer);
    } else {
      const entry = row.entry as { tx: number; ty: number };
      expect(row.entry, String(row.id)).toEqual(row.spawn);
      expect(row.player, String(row.id)).toMatchObject({ x: (entry.tx + 0.5) * 16, y: (entry.ty + 0.5) * 16, facing: 'up' });
      expect(row.notice, String(row.id)).toContain('new look inside, so your keeper starts at its door');
    }
  }
});

test('a pre-paint item drop moves to the door, and a current save inside a wall is still rejected', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async rawSave => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const old = JSON.parse(rawSave);
    // (0,0) is wall in every painting: an old drop there must move, never be dropped or kept in the wall.
    old.state.groundDrops = [...old.state.groundDrops, { item: 'wood', scene: 'TownBarScene', tx: 0, ty: 0 }];
    localStorage.setItem(SaveSystem.storageKey(3), JSON.stringify(old));
    const loaded = SaveSystem.load(3);
    const notice = SaveSystem.consumeMigrationNotice();
    const entry = getMapData('TownBarScene').spawns.find((spawn: { id: string }) => spawn.id === 'entry');
    const drop = loaded.groundDrops.find((item: { scene: string; item: string }) => item.scene === 'TownBarScene' && item.item === 'wood');
    // A save made by this version keeps its exact position, so a keeper inside a wall is an error, not a move.
    SaveSystem.save(3);
    const current = JSON.parse(localStorage.getItem(SaveSystem.storageKey(3))!);
    current.state.player = { ...current.state.player, x: 0.5 * 16, y: 0.5 * 16 };
    localStorage.setItem(SaveSystem.storageKey(3), JSON.stringify(current));
    let rejected = '';
    try { SaveSystem.load(3); } catch (error) { rejected = error instanceof Error ? error.message : String(error); }
    return { entry, drop, notice, version: current.version, saveVersion: SAVE_VERSION, rejected };
  }, baseline.rooms.bar.rawSave);
  expect(result.drop).toMatchObject({ tx: result.entry.tx, ty: result.entry.ty });
  expect(result.notice).toContain('1 items left inside a redecorated building now wait at its door');
  expect(result.version).toBe(result.saveVersion);
  expect(result.rejected).not.toBe('');
});

test('every room exposes a distinct role station only from its exact authored stance', async ({ page }) => {
  test.setTimeout(120_000);
  await bootGame(page);
  for (const id of BUILDINGS) {
    await enterBuilding(page, id);
    const setup = await page.evaluate(async buildingId => {
      // @ts-expect-error Vite resolves source modules in the browser test runtime.
      const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
      // @ts-expect-error Vite resolves source modules in the browser test runtime.
      const { getMapData } = await import('/src/world/MapDef.ts');
      // @ts-expect-error Vite resolves source modules in the browser test runtime.
      const { townBuilding } = await import('/src/config/TownBuildings.ts');
      const room = civicInteriorBlueprint(buildingId), map = getMapData(townBuilding(buildingId).scene);
      const options = [
        { tx: room.servicePoint.tx, ty: room.servicePoint.ty + 1, facing: 'up' },
        { tx: room.servicePoint.tx, ty: room.servicePoint.ty - 1, facing: 'down' },
        { tx: room.servicePoint.tx - 1, ty: room.servicePoint.ty, facing: 'right' },
        { tx: room.servicePoint.tx + 1, ty: room.servicePoint.ty, facing: 'left' },
        // why: a painted counter is often walled in on three sides, so the tiles beside the stand (facing the
        // same way, at a wall or the counter's end) are the wrong approaches to prove the exact-stance rule.
        { tx: room.serviceStand.tx - 1, ty: room.serviceStand.ty, facing: room.serviceStand.facing },
        { tx: room.serviceStand.tx + 1, ty: room.serviceStand.ty, facing: room.serviceStand.facing },
      ].filter(point => !map.solid[point.ty][point.tx]);
      const wrong = options.find(point => point.tx !== room.serviceStand.tx || point.ty !== room.serviceStand.ty ||
        point.facing !== room.serviceStand.facing);
      if (!wrong) throw new Error(`Civic test: ${buildingId} needs a second station approach`);
      const art = room.layout === 'painted'
        ? Boolean(window.__GAME__!.scene.getScene(townBuilding(buildingId).scene).children.getByName(`civic-${buildingId}-backdrop`))
        : null;
      return { stand: room.serviceStand, wrong, serviceSolid: map.solid[room.servicePoint.ty][room.servicePoint.tx],
        standOpen: !map.solid[room.serviceStand.ty][room.serviceStand.tx], station: room.station, art, layout: room.layout };
    }, id);
    // The painted rooms show their painting; only the clinic stays built.
    expect(setup.art, id).toBe(setup.layout === 'painted' ? true : null);
    expect(setup.serviceSolid, `${id}/${setup.station}`).toBe(true);
    expect(setup.standOpen, `${id}/${setup.station}`).toBe(true);
    await teleport(page, setup.wrong.tx, setup.wrong.ty, setup.wrong.facing);
    await page.keyboard.press('e');
    expect((await getState(page)).civicServiceBuilding, id).toBeNull();
    await teleport(page, setup.stand.tx, setup.stand.ty, setup.stand.facing);
    await page.keyboard.press('e');
    await expect.poll(async () => (await getState(page)).civicServiceBuilding).toBe(id);
    await waitForServicePanel(page, id);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await getState(page)).marketPanelOpen).toBe(false);
  }
});

test('every service action commits its exact complete result and every rejection stays atomic', async ({ page }) => {
  await bootGame(page);
  const rows = await page.evaluate(async buildings => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { CIVIC_SERVICES } = await import('/src/config/CivicServices.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { CivicServiceSystem } = await import('/src/systems/CivicServiceSystem.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { FORGE_UPGRADES, ALCHEMY_UPGRADES, POTION_RECIPE } = await import('/src/config/Upgrades.ts');
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    const { GuildBoardSystem } = await import('/src/systems/GuildBoardSystem.ts');
    const results = [];
    for (const building of buildings) {
      for (const option of CIVIC_SERVICES[building].options) {
        GameState.reset();
        const gs = GameState.instance, action = option.action, quantity = option.supportsBatch ? 5 : 1;
        gs.gold = 10_000;
        if (action.kind === 'exchange') gs.addItem(action.item, action.itemQuantity * quantity);
        if (action.kind === 'tonic') { gs.hp = 1; gs.player.stamina = 1; gs.addItem(action.item, 1); }
        if (action.kind === 'restore') { gs.hp = 1; gs.player.stamina = 1; }
        // Loot-fed services: bring the first level's items, the potion recipe, or today's board job.
        if (action.kind === 'forge-upgrade') for (const [item, qty] of Object.entries(FORGE_UPGRADES[0].items)) gs.addItem(item, qty as number);
        if (action.kind === 'alchemy-upgrade') for (const [item, qty] of Object.entries(ALCHEMY_UPGRADES[0].items)) gs.addItem(item, qty as number);
        if (action.kind === 'brew-potion') for (const [item, qty] of Object.entries(POTION_RECIPE)) gs.addItem(item, qty as number);
        if (action.kind === 'guild-board') { const job = GuildBoardSystem.current(); gs.addItem(job.request.item, job.request.qty); }
        const before = gs.toSaveData(), outcome = CivicServiceSystem.run(building, option.id, quantity), after = gs.toSaveData();

        GameState.reset();
        const rejected = GameState.instance;
        if (action.kind === 'restore' || action.kind === 'tonic') { rejected.hp = 1; rejected.player.stamina = 1; }
        const rejectedBefore = JSON.stringify(rejected.toSaveData());
        const denied = action.kind === 'info' || action.kind === 'wardrobe'
          ? null : CivicServiceSystem.run(building, option.id, 1);
        const rejectedSame = rejectedBefore === JSON.stringify(rejected.toSaveData());

        GameState.reset();
        const invalidBefore = JSON.stringify(GameState.instance.toSaveData());
        let invalidError = '';
        try { CivicServiceSystem.run(building, option.id, 0); }
        catch (error) { invalidError = error instanceof Error ? error.message : String(error); }
        const invalidSame = invalidBefore === JSON.stringify(GameState.instance.toSaveData());
        results.push({ building, option: option.id, kind: action.kind, quantity, before, after, outcome,
          denied, rejectedSame, invalidError, invalidSame });
      }
    }
    GameState.reset();
    const unknownBefore = JSON.stringify(GameState.instance.toSaveData());
    let unknownError = '';
    try { CivicServiceSystem.run('guild', 'invented-contract', 1); }
    catch (error) { unknownError = error instanceof Error ? error.message : String(error); }
    return { results, unknownError, unknownSame: unknownBefore === JSON.stringify(GameState.instance.toSaveData()) };
  }, BUILDINGS);
  for (const row of rows.results) {
    expect(row.outcome.ok, `${row.building}/${row.option}`).toBe(true);
    expect(row.invalidError, `${row.building}/${row.option}`).not.toBe(''); expect(row.invalidSame).toBe(true);
    if (row.denied) { expect(row.denied.ok, `${row.building}/${row.option}`).toBe(false); expect(row.rejectedSame).toBe(true); }
    if (row.kind === 'buy') expect(row.after.gold, `${row.building}/${row.option}`).toBeLessThan(row.before.gold);
    if (row.kind === 'exchange') expect(row.after.gold, `${row.building}/${row.option}`).toBeGreaterThan(row.before.gold);
    if (row.kind === 'restore' || row.kind === 'tonic') expect(row.after.player.stamina, `${row.building}/${row.option}`).toBeGreaterThan(1);
    if (row.kind === 'info' || row.kind === 'wardrobe') expect(row.after).toEqual(row.before);
  }
  expect(rows.unknownError).not.toBe(''); expect(rows.unknownSame).toBe(true);
});

test('all eleven visible bedrooms unlock live at two hearts', async ({ page }) => {
  test.setTimeout(120_000);
  await bootGame(page);
  for (const id of BUILDINGS) {
    const { scene, owner } = await enterBuilding(page, id);
    await page.evaluate(residentId => window.__TEST__!.setResidentPoints(residentId, 0), owner);
    const name = `civic-private-gate-${id}`;
    await expect.poll(async () => page.evaluate(({ sceneKey, gateName }) => {
      const gate = window.__GAME__!.scene.getScene(sceneKey).children.getByName(gateName) as Phaser.GameObjects.Zone;
      return (gate.body as Phaser.Physics.Arcade.StaticBody).enable;
    }, { sceneKey: scene, gateName: name })).toBe(true);
    await page.evaluate(residentId => window.__TEST__!.setResidentPoints(residentId, 500), owner);
    await expect.poll(async () => page.evaluate(({ sceneKey, gateName }) => {
      const gate = window.__GAME__!.scene.getScene(sceneKey).children.getByName(gateName) as Phaser.GameObjects.Zone;
      return (gate.body as Phaser.Physics.Arcade.StaticBody).enable;
    }, { sceneKey: scene, gateName: name })).toBe(false);
  }
});

test('shared service UI supports keyboard, pointer, and the Tailor wardrobe handoff', async ({ page }) => {
  await bootGame(page);
  await enterBuilding(page, 'bar');
  const bar = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    return (await import('/src/config/CivicInteriors.ts')).civicInteriorBlueprint('bar').serviceStand;
  });
  await page.evaluate(() => window.__TEST__!.setGold(500));
  await teleport(page, bar.tx, bar.ty, bar.facing); await page.keyboard.press('e');
  await waitForServicePanel(page, 'bar');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).gold).toBe(225);
  expect((await getState(page)).inventory.ale).toBe(5);
  await page.keyboard.press('Escape');

  await enterBuilding(page, 'ranch');
  const ranch = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    return (await import('/src/config/CivicInteriors.ts')).civicInteriorBlueprint('ranch').serviceStand;
  });
  await page.evaluate(() => window.__TEST__!.setGold(500));
  await teleport(page, ranch.tx, ranch.ty, ranch.facing); await page.keyboard.press('e');
  await waitForServicePanel(page, 'ranch');
  const pineRow = await uiCanvasPoint(page, { x: 600, y: 211 }); await page.mouse.click(pineRow.x, pineRow.y);
  const five = await uiCanvasPoint(page, { x: 628, y: 417 }); await page.mouse.click(five.x, five.y);
  const confirm = await uiCanvasPoint(page, { x: 756, y: 417 }); await page.mouse.click(confirm.x, confirm.y);
  await expect.poll(async () => (await getState(page)).gold).toBe(350);
  expect((await getState(page)).inventory['pine-seed']).toBe(5);
  await page.keyboard.press('Escape');

  await enterBuilding(page, 'tailor');
  const tailor = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves source modules in the browser test runtime.
    return (await import('/src/config/CivicInteriors.ts')).civicInteriorBlueprint('tailor').serviceStand;
  });
  await teleport(page, tailor.tx, tailor.ty, tailor.facing); await page.keyboard.press('e'); await waitForServicePanel(page, 'tailor');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).appearanceEditorOpen).toBe(true);
  const state = await getState(page);
  expect(state.paused).toBe(true); expect(state.marketPanelOpen).toBe(false); expect(state.civicServiceBuilding).toBeNull();
});
