/** Browser proofs that the detailed route workshop starter is the live seven-day resident schedule. */
import { expect, test } from '@playwright/test';
import { bootGame, getState, teleport } from './helpers/gameHarness';
import type { TownRoutePlanStop } from '../src/systems/TownRoutePlanSystem';

test('all 84 detailed route days drive live scenes, travel, access, and the unchanged editor starter', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { residentBondId } = await import('/src/config/ResidentRelationships.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { townBuildingAccess } = await import('/src/systems/TownBuildingAccessSystem.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const schedules = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const routePlans = await import('/src/systems/TownRoutePlanSystem.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { createNpcRouteDraft } = await import('/src/debug/NpcRouteDraft.ts');
    GameState.reset();
    const map = getMapData(SceneKey.Town);
    schedules.validateTownScheduleRoutes(map);
    const draft = createNpcRouteDraft();
    let dayCount = 0, interiorStops = 0, outdoorStops = 0, movingSamples = 0, weekendMoving = 0;
    const categories = new Set<string>();
    for (let day = 1; day <= 7; day++) for (const resident of TOWN_RESIDENTS) {
      const plan = schedules.residentRoutePlanForDay(resident.id, day, map);
      const editorDay = draft.residents.find((entry: { residentId: string }) => entry.residentId === resident.id)!.days[(day - 1) % 7];
      const productionEditorShape = plan.stops.map((entry: TownRoutePlanStop) => {
        const { destination: _destination, ...stop } = entry;
        return stop;
      });
      if (JSON.stringify(productionEditorShape) !== JSON.stringify(editorDay.stops)) {
        throw new Error(`Editor and production differ for ${resident.id} day ${day}`);
      }
      dayCount++;
      for (const stop of plan.stops) {
        categories.add(stop.category);
        const schedule = schedules.residentScheduleScene(resident.id, day, (stop.arrive + stop.leave) / 2);
        if (schedule.scene === SceneKey.Town) outdoorStops++; else interiorStops++;
      }
      for (let index = 1; index < plan.stops.length; index++) {
        const previous = plan.stops[index - 1], stop = plan.stops[index];
        const segment = routePlans.compileTownRouteSegment(map, previous, stop);
        if (segment.length <= 1 || stop.arrive - previous.leave <= 1) continue;
        const minute = (previous.leave + stop.arrive) / 2;
        const presence = schedules.residentTownPresence(resident.id, day, minute, map);
        if (!presence?.moving) throw new Error(`Missing live travel for ${resident.id} day ${day} to ${stop.id}`);
        movingSamples++;
        if (day >= 6) weekendMoving++;
      }
    }
    const relationships = GameState.instance.relationships;
    const closed = townBuildingAccess('market', 15 * 60, { kind: 'resident', residentId: 'nyra' }, relationships);
    const open = townBuildingAccess('market', 6 * 60, { kind: 'resident', residentId: 'nyra' }, relationships);
    const owner = townBuildingAccess('market', 15 * 60, { kind: 'resident', residentId: 'tessa' }, relationships);
    const bond = relationships.bonds[residentBondId('nyra', 'tessa')];
    bond.exclusive = true;
    const partner = townBuildingAccess('market', 15 * 60, { kind: 'resident', residentId: 'nyra' }, relationships);
    return { dayCount, categories: [...categories].sort(), interiorStops, outdoorStops, movingSamples, weekendMoving,
      access: { closed: closed.reason, open: open.reason, owner: owner.reason, partner: partner.reason } };
  });
  expect(result.dayCount).toBe(84);
  expect(result.categories).toEqual(['errand', 'home', 'leisure', 'meal', 'private', 'social', 'work']);
  expect(result.interiorStops).toBeGreaterThan(300);
  expect(result.outdoorStops).toBeGreaterThan(20);
  expect(result.movingSamples).toBeGreaterThan(300);
  expect(result.weekendMoving).toBeGreaterThan(50);
  expect(result.access).toEqual({ closed: 'closed', open: 'open', owner: 'owner', partner: 'partner' });
});

test('a scheduled visitor appears and talks inside another resident building, then travels through Town', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await bootGame(page);
  // Planned days change with the route rules, so find the first real visit instead of naming one:
  // a non-work, non-home stop inside a building, reached by a walk from the stop before it.
  const visit = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { residentScheduleScene, residentRoutePlanForDay } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    for (let day = 1; day <= 7; day++) for (const resident of TOWN_RESIDENTS) {
      const stops: TownRoutePlanStop[] = residentRoutePlanForDay(resident.id, day).stops;
      for (let index = 1; index < stops.length; index++) {
        const stop = stops[index], previous = stops[index - 1];
        if (stop.category === 'work' || stop.destination === 'home' || previous.leave >= stop.arrive) continue;
        const minute = Math.round((stop.arrive + stop.leave) / 2);
        const scene = residentScheduleScene(resident.id, day, minute).scene;
        if (scene === 'TownScene') continue;
        GameState.instance.day = day; GameState.instance.timeOfDay = minute;
        return { id: resident.id as string, day, scene: scene as string, walkMinute: (previous.leave + stop.arrive) / 2 };
      }
    }
    throw new Error('No resident visits another building on days 1-7');
  });
  const target = visit.scene;
  await page.evaluate(async scene => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), scene, 'entry');
  }, target);
  await page.waitForFunction(scene => window.__TEST__!.ready && window.__TEST__!.activeScene() === scene, target);
  const visitor = await page.evaluate(id => {
    const scene = window.__GAME__!.scene.getScene(window.__TEST__!.activeScene());
    const sprite = scene.children.getByName(`town-resident-${id}`) as Phaser.GameObjects.Sprite;
    const visibleIds = scene.children.list.filter(child => child.type === 'Sprite'
      && child.name.startsWith('town-resident-') && (child as Phaser.GameObjects.Sprite).visible)
      .map(child => child.getData('residentId'));
    return { visible: sprite.visible, x: sprite.getData('feetX'), y: sprite.getData('feetY'), visibleIds };
  }, visit.id);
  expect(visitor.visible).toBe(true);
  expect(new Set(visitor.visibleIds).size).toBe(visitor.visibleIds.length);
  await teleport(page, Math.floor(visitor.x / 16), Math.floor(visitor.y / 16) + 1, 'up');
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).dialogue?.residentId).toBe(visit.id);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    closeDialogue();
  });

  // Jump to the middle of the walk that leads into the visit, then watch the visitor in Town.
  await page.evaluate(async walkMinute => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to browser tests.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    GameState.instance.timeOfDay = walkMinute;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), 'TownScene', 'from_farm');
  }, visit.walkMinute);
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  const traveler = await page.evaluate(id => {
    const sprite = window.__GAME__!.scene.getScene('TownScene').children.getByName(`town-resident-${id}`) as Phaser.GameObjects.Sprite;
    return { visible: sprite.visible, x: sprite.getData('feetX'), y: sprite.getData('feetY'),
      location: sprite.getData('scheduleLocation') };
  }, visit.id);
  expect(traveler.visible).toBe(true);
  expect(String(traveler.location)).toContain('Walking to');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.timeOfDay += 1;
  });
  await page.waitForTimeout(100);
  const moved = await page.evaluate(id => {
    const sprite = window.__GAME__!.scene.getScene('TownScene').children.getByName(`town-resident-${id}`) as Phaser.GameObjects.Sprite;
    return { x: sprite.getData('feetX'), y: sprite.getData('feetY') };
  }, visit.id);
  expect(moved.x !== traveler.x || moved.y !== traveler.y).toBe(true);
  expect(errors).toEqual([]);
});
