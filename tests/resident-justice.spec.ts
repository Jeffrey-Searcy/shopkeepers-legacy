/** Focused proofs for resident boundaries, guarded outcomes, the service guard, jail, and versioned saves. */
import { expect, test } from '@playwright/test';
import { bootGame, getState } from './helpers/gameHarness';

test('lesser conduct warns first, repeated conduct ends chat, and severe conduct requests arrest', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const justice = await import('/src/systems/JusticeSystem.ts');
    const gs = GameState.instance;
    gs.relationships.residents.tessa.points = 600;
    justice.applyResidentChatOutcome('tessa', 'warning');
    const warning = { boundary: { ...gs.justice.residents.tessa }, points: gs.relationships.residents.tessa.points,
      context: justice.residentBoundaryContext('tessa') };
    justice.applyResidentChatOutcome('tessa', 'end-conversation');
    const ended = { boundary: { ...gs.justice.residents.tessa }, points: gs.relationships.residents.tessa.points,
      refuses: justice.residentRefusesChatToday('tessa') };
    justice.applyResidentChatOutcome('tessa', 'call-guard');
    return { warning, ended, arrestRequested: gs.arrestRequested, incidents: gs.justice.incidents,
      finalPoints: gs.relationships.residents.tessa.points };
  });
  expect(result.warning).toMatchObject({ boundary: { warningDay: 1, refusalDay: null }, points: 575,
    context: { warningActive: true, refusedToday: false } });
  expect(result.ended).toMatchObject({ boundary: { warningDay: 1, refusalDay: 1 }, points: 525, refuses: true });
  expect(result.arrestRequested).toBe(true);
  expect(result.incidents.map((incident: { severity: string }) => incident.severity)).toEqual(['lesser', 'lesser', 'severe']);
  expect(result.finalPoints).toBe(275);
});

test('v14 save gains empty justice state and preserves exact bytes before its first v15 write', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const oldState = GameState.instance.toSaveData() as unknown as Record<string, unknown>;
    delete oldState.justice;
    const raw = JSON.stringify({ version: 14, slot: 1, savedAt: 44, state: oldState });
    localStorage.setItem(SaveSystem.storageKey(1), raw);
    const loaded = SaveSystem.load(1);
    SaveSystem.save(1, 45);
    const saved = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    const backup = localStorage.getItem(SaveSystem.justiceBackupKey(1));
    SaveSystem.delete(1);
    return { version: SAVE_VERSION, savedVersion: saved.version, loaded: loaded.justice,
      exactBackup: backup === raw, residents: Object.keys(saved.state.justice.residents).length };
  });
  expect(result).toMatchObject({ version: 30, savedVersion: 30, exactBackup: true, residents: 12 });
  expect(result.loaded.incidents).toEqual([]);
  expect(Object.values(result.loaded.residents)).toEqual(Array.from({ length: 12 }, () => ({ warningDay: null, refusalDay: null })));
});

test('severe outcome enters the locked jail and its bed releases the player next morning at half stamina', async ({ page }, testInfo) => {
  await bootGame(page);
  const before = await getState(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { applyResidentChatOutcome } = await import('/src/systems/JusticeSystem.ts');
    applyResidentChatOutcome('tessa', 'call-guard');
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownJailScene');
  const jailed = await getState(page);
  expect(jailed.activeScene).toBe('TownJailScene');
  expect(await page.evaluate(() => Boolean(window.__GAME__!.scene.getScene('TownJailScene').children.getByName('jail-cell-bars')))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('jail-cell.png') });
  await page.evaluate(() => window.__TEST__!.sleep());
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'FarmScene');
  const released = await getState(page);
  expect(released.day).toBe(before.day + 1);
  expect(released.player.stamina).toBe(50);
  const refusalDay = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.justice.residents.tessa.refusalDay;
  });
  expect(refusalDay).toBe(before.day);
});

test('guardhouse and Captain Maren exist without changing resident or bond counts', async ({ page }, testInfo) => {
  await bootGame(page);
  const catalog = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { RESIDENT_BONDS } = await import('/src/config/ResidentRelationships.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const town = getMapData(SceneKey.Town);
    return { residents: TOWN_RESIDENTS.length, bonds: RESIDENT_BONDS.length,
      jailWarp: town.warps.some((warp: { target: string }) => warp.target === SceneKey.Jail),
      guardSpawn: town.spawns.some((spawn: { id: string }) => spawn.id === 'from_guardhouse') };
  });
  expect(catalog).toEqual({ residents: 12, bonds: 66, jailWarp: true, guardSpawn: true });
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), SceneKey.Town, 'from_farm');
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  // why: the guardhouse is drawn into the painted Town (world/TownArt.ts); Maren stands by its stairs.
  const post = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { TOWN_ANCHORS, TOWN_DOORS } = await import('/src/world/TownArt.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const map = getMapData(SceneKey.Town), door = TOWN_DOORS.guardhouse;
    const jail = map.warps.find((warp: { target: string }) => warp.target === SceneKey.Jail);
    if (!jail || jail.tx !== door.tx || jail.ty !== door.ty) throw new Error('The jail door is not the painted guardhouse door');
    const arrival = map.spawns.find((spawn: { id: string }) => spawn.id === 'from_guardhouse');
    window.__TEST__!.teleport(arrival.tx, arrival.ty, 'up');
    return TOWN_ANCHORS.guard as { tx: number; ty: number };
  });
  await page.waitForTimeout(180);
  // why: TownGuard stands its container at the foot of the anchor tile (y = ty*16+16), so step up one pixel.
  expect(await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TownScene');
    const guard = scene.children.getByName('town-guard-captain-maren') as Phaser.GameObjects.Container | null;
    return guard ? [Math.floor(guard.x / 16), Math.floor((guard.y - 1) / 16)] : null;
  })).toEqual([post.tx, post.ty]);
  await page.screenshot({ path: testInfo.outputPath('guardhouse-captain-maren.png') });
});
