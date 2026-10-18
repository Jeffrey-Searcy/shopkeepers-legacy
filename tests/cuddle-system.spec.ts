/** Focused dialogue, activity, witness, jail, and v16 save proofs for the always-on private moments. */
import { expect, test } from '@playwright/test';
import { bootGame, getState } from './helpers/gameHarness';

test('intimate chat exposes both contextual choices and starts the accepted moment', async ({ page }, testInfo) => {
  await bootGame(page);
  const requestBodies = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const dialogue = await import('/src/systems/ResidentDialogueSystem.ts');
    SettingsSystem.update({ localNpcChat: true });
    GameState.instance.relationships.residents.nyra.points = 1800;
    GameState.instance.relationships.residents.nyra.romanceStage = 'dating';
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    window.fetch = (async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith('/cuddle')) return new Response(JSON.stringify({ accepted: true,
        reason: 'Yes. Stay close, and let us be reckless together.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ reply: 'Come closer. I would rather continue this somewhere private.',
        outcome: 'continue', intimateTopic: true, offer: 'none' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    dialogue.openResidentDialogue('nyra'); dialogue.selectResidentDialogueChoice('chat'); dialogue.confirmResidentDialogueChoice();
    for (const character of 'I want a private moment with you.') dialogue.typeResidentChat(character);
    await dialogue.sendResidentChat();
    return requests;
  });
  expect(requestBodies).toHaveLength(1);
  const state = await getState(page);
  expect(state.dialogue?.chatIsOnIntimateTopic).toBe(true);
  const controls = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const box = scene.children.getByName('dialogue-box') as Phaser.GameObjects.Container;
    const bedroom = box.getByName('dialogue-cuddle-bedroom') as Phaser.GameObjects.Rectangle;
    const standing = box.getByName('dialogue-cuddle-standing') as Phaser.GameObjects.Rectangle;
    const bedroomLabel = box.getByName('dialogue-cuddle-bedroom-label') as Phaser.GameObjects.Text;
    const standingLabel = box.getByName('dialogue-cuddle-standing-label') as Phaser.GameObjects.Text;
    const dialogueLine = box.getByName('dialogue-line') as Phaser.GameObjects.Text;
    const bounds = (object: Phaser.GameObjects.GameObject & { getBounds(): Phaser.Geom.Rectangle }) => object.getBounds();
    const bedroomBounds = bounds(bedroom), standingBounds = bounds(standing);
    const bedroomLabelBounds = bounds(bedroomLabel), standingLabelBounds = bounds(standingLabel);
    return { bedroom: bedroom.visible, standing: standing.visible, bedroomText: bedroomLabel.text, standingText: standingLabel.text,
      bedroomFits: bedroomLabelBounds.left >= bedroomBounds.left + 8 && bedroomLabelBounds.right <= bedroomBounds.right - 8
        && bedroomLabelBounds.top >= bedroomBounds.top + 4 && bedroomLabelBounds.bottom <= bedroomBounds.bottom - 4,
      standingFits: standingLabelBounds.left >= standingBounds.left + 8 && standingLabelBounds.right <= standingBounds.right - 8
        && standingLabelBounds.top >= standingBounds.top + 4 && standingLabelBounds.bottom <= standingBounds.bottom - 4,
      dialogueClearsButtons: bounds(dialogueLine).bottom <= bedroomBounds.top - 4 };
  });
  expect(controls).toEqual({ bedroom: true, standing: true,
    bedroomText: 'Should we head to the bedroom?', standingText: 'Do it right here',
    bedroomFits: true, standingFits: true, dialogueClearsButtons: true });
  await page.screenshot({ path: testInfo.outputPath('cuddle-contextual-dialogue.png') });
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { confirmResidentCuddleOffer } = await import('/src/systems/ResidentDialogueSystem.ts');
    await confirmResidentCuddleOffer('standing');
  });
  expect((await getState(page)).cuddle.session).toMatchObject({ kind: 'standing', phase: 'active' });
  expect((await getState(page)).dialogue?.line).toContain('reckless');
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => (window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()).children
    .getByName('cuddle-effect-standing') as Phaser.GameObjects.Container | null)?.visible)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cuddle-standing-effect.png') });
  await page.evaluate(async () => {
    // Visual-only swap proves the shared bed treatment without changing the accepted standing flow.
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    if (!GameState.instance.cuddle.session) throw new Error('Cuddle visual session is missing');
    GameState.instance.cuddle.session.kind = 'bedroom';
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => Boolean(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()).children
    .getByName('cuddle-effect-bed')))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cuddle-bed-effect.png') });
});

test('bedroom wait, vision cone, report bands, and resident jail use deterministic game state', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const cuddle = await import('/src/systems/CuddleSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const justice = await import('/src/systems/JusticeSystem.ts');
    const gs = GameState.instance;
    gs.relationships.residents.tessa.points = 1800; gs.relationships.residents.tessa.romanceStage = 'dating';
    const bedroom = cuddle.startPlayerCuddle('tessa', 'bedroom', 'Yes. Meet me by the bed.');
    gs.timeOfDay += 20; cuddle.updateCuddle();
    const waiting = gs.cuddle.session?.phase;
    const began = cuddle.interactWithWaitingCuddle(bedroom.scene, bedroom.tx, bedroom.ty, 'tessa');
    const cone = {
      up: cuddle.inFacingVisionCone({ tx: 5, ty: 5, facing: 'up' }, { tx: 5, ty: 2 }, new Set()),
      side: cuddle.inFacingVisionCone({ tx: 5, ty: 5, facing: 'up' }, { tx: 6, ty: 3 }, new Set()),
      blocked: cuddle.inFacingVisionCone({ tx: 5, ty: 5, facing: 'right' }, { tx: 8, ty: 5 }, new Set(['7,5'])),
      right: cuddle.inFacingVisionCone({ tx: 5, ty: 5, facing: 'right' }, { tx: 8, ty: 5 }, new Set()),
    };
    gs.relationships.residents.kit.points = 1250;
    const friend = cuddle.cuddleReportChance('kit', [{ kind: 'player' }]);
    const strict = cuddle.cuddleReportChance('seren', [{ kind: 'player' }]);
    justice.reportCuddleIncident('seren', false, ['tessa']);
    const jailedNow = justice.isResidentJailed('tessa');
    gs.day += 1;
    const jailedNextDay = justice.isResidentJailed('tessa');
    return { waiting, began, active: gs.cuddle.session?.phase, cone, friend, strict, jailedNow, jailedNextDay };
  });
  expect(result).toEqual({ waiting: 'waiting', began: true, active: 'active',
    cone: { up: true, side: false, blocked: false, right: true }, friend: 10, strict: 90,
    jailedNow: true, jailedNextDay: false });
});

test('every adult resident gets exactly one authored weekly self activity at their own bed', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const cuddle = await import('/src/systems/CuddleSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { createCuddleRuntimeState } = await import('/src/config/Cuddle.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { RESIDENT_RELATIONSHIPS } = await import('/src/config/ResidentRelationships.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { townBuilding } = await import('/src/config/TownBuildings.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { civicInteriorBlueprint } = await import('/src/config/CivicInteriors.ts');
    const gs = GameState.instance, seed = gs.relationships.socialSeed;
    const relationshipsBefore = JSON.stringify(gs.relationships), justiceBefore = JSON.stringify(gs.justice);
    const weekly = Object.fromEntries(RESIDENT_RELATIONSHIPS.map((profile: { id: string; adult: boolean }) => [profile.id, [] as string[]]));
    const beds: Array<{ id: string; scene: string; lagging: boolean; owned: boolean; centered: boolean; directed: boolean }> = [];
    for (let day = 1; day <= 7; day++) {
      gs.day = day; gs.cuddle = createCuddleRuntimeState(); cuddle.updateCuddle();
      for (const profile of RESIDENT_RELATIONSHIPS) weekly[profile.id].push(gs.cuddle.privateRooms[profile.id]!.activity);
    }
    for (const profile of RESIDENT_RELATIONSHIPS) {
      const selfDay = weekly[profile.id].findIndex((activity: string) => activity === 'daydreaming') + 1;
      gs.day = selfDay; gs.cuddle = createCuddleRuntimeState();
      const window = cuddle.residentDaydreamWindow(profile.id, selfDay); gs.timeOfDay = window.startsAt;
      cuddle.updateCuddle();
      const resident = TOWN_RESIDENTS.find((candidate: { id: string }) => candidate.id === profile.id)!;
      const target = cuddle.residentBedroom(profile.id), building = townBuilding(resident.buildingId);
      const feature = civicInteriorBlueprint(resident.buildingId).bed;
      // A schedule running one minute behind (after a long chat) is not pinned yet, and no effect shows.
      const behind = cuddle.residentCuddleDirective(profile.id, { activity: 'home', minute: window.startsAt - 1 });
      const behindView = cuddle.cuddleEffectView(target.scene);
      const directive = cuddle.residentCuddleDirective(profile.id, { activity: 'home', minute: window.startsAt });
      const view = cuddle.cuddleEffectView(target.scene);
      beds.push({ id: profile.id, scene: target.scene, lagging: behind === null && behindView === null,
        owned: target.scene === building.scene,
        centered: view?.x === (feature.tx + feature.w / 2) * 16 && view?.y === (feature.ty + feature.h / 2) * 16,
        directed: directive?.scene === target.scene && directive.x === view?.x && directive.y === view?.y });
    }
    const nonAdult = RESIDENT_RELATIONSHIPS.map((profile: { id: string }) => Array.from({ length: 7 }, (_entry, weekday) =>
      cuddle.residentPrivateActivityForDay(profile.id, weekday + 1, false, seed))).flat();
    return { weekly, beds, nonAdultHasSelf: nonAdult.includes('daydreaming'), saveHasCuddle: 'cuddle' in gs.toSaveData(),
      relationshipsUnchanged: relationshipsBefore === JSON.stringify(gs.relationships), justiceUnchanged: justiceBefore === JSON.stringify(gs.justice) };
  });
  for (const activities of Object.values(result.weekly) as string[][]) {
    expect(activities.filter(activity => activity === 'daydreaming')).toHaveLength(1);
  }
  expect(result.beds).toHaveLength(12);
  expect(result.beds.every(bed => bed.lagging && bed.owned && bed.centered && bed.directed)).toBe(true);
  expect(result).toMatchObject({ nonAdultHasSelf: false, saveHasCuddle: false,
    relationshipsUnchanged: true, justiceUnchanged: true });
});

test('authored self activity renders the blurred-heart effect on the resident bed', async ({ page }, testInfo) => {
  await bootGame(page);
  const scene = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { createCuddleRuntimeState } = await import('/src/config/Cuddle.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentDaydreamWindow } = await import('/src/systems/CuddleSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { townBuilding } = await import('/src/config/TownBuildings.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    const gs = GameState.instance, day = 3, privateWindow = residentDaydreamWindow('nyra', day);
    gs.day = day; gs.timeOfDay = privateWindow.startsAt;
    gs.cuddle = createCuddleRuntimeState();
    const target = townBuilding('magic').scene;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), target, 'entry');
    return target as string;
  });
  await page.waitForFunction(target => window.__TEST__!.ready && window.__TEST__!.activeScene() === target, scene);
  await expect.poll(() => page.evaluate(target => {
    const effect = window.__GAME__!.scene.getScene(target).children.getByName('cuddle-effect-bed') as Phaser.GameObjects.Container | null;
    return Boolean(effect?.visible);
  }, scene)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('nyra-authored-self-activity.png') });
});

test('v15 bytes stay untouched until one verified v16 backup and resident jail days round-trip', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const state = GameState.instance.toSaveData() as unknown as { justice: Record<string, unknown> };
    delete state.justice.residentJailUntilDay;
    const raw = JSON.stringify({ version: 15, slot: 1, savedAt: 100, state });
    localStorage.setItem(SaveSystem.storageKey(1), raw);
    const loaded = SaveSystem.load(1);
    const untouched = localStorage.getItem(SaveSystem.storageKey(1)) === raw;
    GameState.instance.justice.residentJailUntilDay.nyra = 3;
    SaveSystem.save(1, 101);
    const firstBackup = localStorage.getItem(SaveSystem.cuddleBackupKey(1));
    SaveSystem.save(1, 102);
    const saved = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    return { version: SAVE_VERSION, untouched, migrated: loaded.justice.residentJailUntilDay.nyra,
      backupExact: firstBackup === raw, backupStillExact: localStorage.getItem(SaveSystem.cuddleBackupKey(1)) === raw,
      savedVersion: saved.version, release: saved.state.justice.residentJailUntilDay.nyra };
  });
  expect(result).toEqual({ version: 30, untouched: true, migrated: null, backupExact: true,
    backupStillExact: true, savedVersion: 30, release: 3 });
});
