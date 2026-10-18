/** Deterministic proofs for resident schedules, Town actors, meeting progress, notes, and local voice limits. */
import { expect, test } from '@playwright/test';
import { bootGame, getState, teleport } from './helpers/gameHarness';

test('all twelve weekday and weekend schedules resolve to valid rooms or passable Town paths', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const schedules = await import('/src/systems/TownScheduleSystem.ts');
    const map = getMapData('TownScene');
    schedules.validateTownScheduleRoutes(map);
    const samples = [];
    // Routes are planned per day, so find Nyra's first outdoor walk instead of hard-coding a clock minute.
    let travelMinute = -1;
    for (let minute = 0; minute <= 1080 && travelMinute < 0; minute += 0.25) {
      if (schedules.residentTownPresence('nyra', 1, minute, map)?.moving) travelMinute = minute;
    }
    if (travelMinute < 0) throw new Error('Nyra needs one outdoor walk on day 1');
    const travel = schedules.residentScheduleScene('nyra', 1, travelMinute);
    samples.push({ id: 'nyra', day: 1, minute: -1, scene: travel.scene, activity: travel.activity, moving: true });
    for (const resident of TOWN_RESIDENTS) for (const day of [1, 6]) for (const minute of [0, 150, 210, 500, 580, 640, 700, 800]) {
      const scene = schedules.residentScheduleScene(resident.id, day, minute);
      const presence = schedules.residentTownPresence(resident.id, day, minute, map);
      if (scene.scene === 'TownScene' && !presence) throw new Error(`Missing ${resident.id} at ${day}/${minute}`);
      if (presence) {
        const tx = Math.floor(presence.x / 16), ty = Math.floor(presence.y / 16);
        if (map.solid[ty][tx] || map.ground[ty][tx] === 'water') throw new Error(`Blocked ${resident.id} at ${tx},${ty}`);
      }
      samples.push({ id: resident.id, day, minute, scene: scene.scene, activity: scene.activity, moving: presence?.moving ?? false });
    }
    return { count: TOWN_RESIDENTS.length, samples };
  });
  expect(result.count).toBe(12);
  expect(result.samples.find(sample => sample.id === 'nyra' && sample.day === 1 && sample.minute === 150)).toMatchObject({ activity: 'work' });
  expect(result.samples.find(sample => sample.id === 'nyra' && sample.day === 1 && sample.minute === -1)).toMatchObject({ scene: 'TownScene', activity: 'traveling', moving: true });
  expect(result.samples.find(sample => sample.id === 'nyra' && sample.day === 6 && sample.minute === 150)).toMatchObject({ activity: 'work' });
  expect(result.samples.find(sample => sample.id === 'nyra' && sample.day === 6 && sample.minute === 210)).toMatchObject({ scene: 'TownMagicScene', activity: 'work', moving: false });
});

test('home deadlines and relationship-aware visiting hours are exact', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentDayTiming, RESIDENT_HOME_DEADLINE } = await import('/src/config/TownSchedules.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentForBuilding } = await import('/src/config/TownResidents.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const access = await import('/src/systems/TownBuildingAccessSystem.ts');
    const state = GameState.instance.relationships, owner = residentForBuilding('market');
    const homes = [1, 6].flatMap(day => Array.from({ length: 6 }, (_, index) => residentDayTiming(day, index).home));
    const closedPlayer = access.townBuildingAccess('market', 840, { kind: 'player' }, state);
    state.residents[owner.id].romanceStage = 'dating';
    const partnerPlayer = access.townBuildingAccess('market', 840, { kind: 'player' }, state);
    state.residents[owner.id].romanceStage = 'friends';
    const ownerAccess = access.townBuildingAccess('market', 1000, { kind: 'resident', residentId: owner.id }, state);
    const visitorId = owner.id === 'nyra' ? 'tessa' : 'nyra';
    const bondId = [owner.id, visitorId].sort().join('-');
    state.bonds[bondId].exclusive = true;
    const npcPartner = access.townBuildingAccess('market', 1000, { kind: 'resident', residentId: visitorId }, state);
    state.bonds[bondId].exclusive = false;
    const skipped = access.accessibleTownBuildingStops(['market', 'bar'], 900,
      { kind: 'resident', residentId: visitorId }, state);
    return { deadline: RESIDENT_HOME_DEADLINE, homes, market: [119, 120, 839, 840].map(minute => access.townBuildingIsOpen('market', minute)),
      bar: [119, 120, 1079, 1080].map(minute => access.townBuildingIsOpen('bar', minute)),
      closedPlayer, partnerPlayer, ownerAccess, npcPartner, skipped };
  });
  expect(result.deadline).toBe(1080); expect(result.homes.every((minute: number) => minute <= result.deadline)).toBe(true);
  expect(result.market).toEqual([false, true, true, false]); expect(result.bar).toEqual([false, true, true, false]);
  expect(result.closedPlayer).toMatchObject({ allowed: false, reason: 'closed' });
  expect(result.partnerPlayer).toMatchObject({ allowed: true, reason: 'partner' });
  expect(result.ownerAccess).toMatchObject({ allowed: true, reason: 'owner' });
  expect(result.npcPartner).toMatchObject({ allowed: true, reason: 'partner' });
  expect(result.skipped).toEqual(['bar']);
});

test('direct resident talk freezes the town clock and routes, then closing resumes the path home', async ({ page }) => {
  await bootGame(page);
  const routeMinute = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentTownPresence } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData('TownScene');
    let minute = 0;
    for (let candidate = 0; candidate <= 1080; candidate += 0.25) {
      const presence = residentTownPresence('nyra', 1, candidate, map);
      if (presence?.moving) { minute = candidate; break; }
    }
    if (minute === 0) throw new Error('Nyra needs one outdoor travel segment for the conversation pause proof');
    GameState.instance.devTuning.clockScale = 0;
    GameState.instance.timeOfDay = minute;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), 'TownScene', 'from_farm');
    return minute;
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  const anchor = await page.evaluate(async () => {
    // Freeze ordinary ticking and interact in the same update. This avoids testing a stale tile from a moving actor.
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    const gs = GameState.instance;
    gs.devTuning.clockScale = 0;
    const scene = window.__GAME__!.scene.getScene('TownScene') as Phaser.Scene & {
      residents: Map<string, { position(): { x: number; y: number } | null; interact(tx: number, ty: number): boolean }>;
    };
    scene.update(0, 0);
    const actor = scene.residents.get('nyra');
    const position = actor?.position();
    if (!actor || !position) throw new Error('Expected Nyra to be visible on her outdoor route');
    const tx = Math.floor(position.x / 16), ty = Math.floor(position.y / 16);
    gs.player.x = position.x;
    gs.player.y = position.y + 16;
    gs.player.facing = 'up';
    if (!actor.interact(tx, ty)) throw new Error('Expected Nyra to accept a direct adjacent interaction');
    return { tx, ty, x: position.x, y: position.y };
  });
  await expect.poll(async () => (await getState(page)).dialogue?.residentId).toBe('nyra');
  const frozen = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    const gs = GameState.instance, scene = window.__GAME__!.scene.getScene('TownScene');
    const other = TOWN_RESIDENTS.find((resident: { id: string }) => resident.id !== 'nyra'
      && (scene.children.getByName(`town-resident-${resident.id}`) as Phaser.GameObjects.Sprite).visible);
    if (!other) throw new Error('Expected another visible resident while Nyra talks');
    const actor = scene.children.getByName(`town-resident-${other.id}`) as Phaser.GameObjects.Sprite;
    const nyra = scene.children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite;
    const before = { time: gs.timeOfDay, otherX: actor.getData('feetX'), otherY: actor.getData('feetY'),
      nyraX: nyra.getData('feetX'), nyraY: nyra.getData('feetY') };
    scene.update(0, 10_000);
    return { before, after: { time: gs.timeOfDay, otherX: actor.getData('feetX'), otherY: actor.getData('feetY'),
      nyraX: nyra.getData('feetX'), nyraY: nyra.getData('feetY') } };
  });
  expect(frozen.after).toEqual(frozen.before);
  const released = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    closeDialogue();
    const scene = window.__GAME__!.scene.getScene('TownScene'); scene.update(0, 0);
    const actor = scene.children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite;
    return { visible: actor.visible, x: actor.getData('feetX'), y: actor.getData('feetY') };
  });
  expect(released.visible).toBe(true);
  expect(Math.hypot(released.x - anchor.x, released.y - anchor.y)).toBeLessThan(1);
  const resumed = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    const before = GameState.instance.timeOfDay;
    window.__TEST__!.stepTime(1);
    const scene = window.__GAME__!.scene.getScene('TownScene'); scene.update(0, 0);
    const actor = scene.children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite;
    return { clockAdvanced: GameState.instance.timeOfDay > before,
      visible: actor.visible, x: actor.getData('feetX'), y: actor.getData('feetY') };
  });
  expect(resumed.clockAdvanced).toBe(true); expect(resumed.visible).toBe(true);
  expect(Math.hypot(resumed.x - released.x, resumed.y - released.y)).toBeGreaterThan(0);
  const midnight = await page.evaluate(async minute => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { openResidentDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    const scene = window.__GAME__!.scene.getScene('TownScene');
    GameState.instance.timeOfDay = minute; scene.update(0, 0); openResidentDialogue('nyra'); scene.update(0, 0);
    GameState.instance.timeOfDay = 1079; scene.update(0, 0);
    const before = (scene.children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite).visible;
    GameState.instance.timeOfDay = 1080; scene.update(0, 0);
    return { before, dialogue: GameState.instance.dialogue };
  }, routeMinute);
  expect(midnight).toEqual({ before: true, dialogue: null });
  // Residents fade out instead of popping, so the sprite hides within the short fade.
  await expect.poll(() => page.evaluate(() =>
    (window.__GAME__!.scene.getScene('TownScene').children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite).visible)).toBe(false);
});

test('daily pairings vary by save and witness rules use the whole visible room or six outdoor tiles', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { createRelationshipsState } = await import('/src/systems/RelationshipSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const schedules = await import('/src/systems/TownScheduleSystem.ts');
    const first = schedules.townMeetingsForDay(3, createRelationshipsState(3, 1001));
    const second = schedules.townMeetingsForDay(3, createRelationshipsState(3, 2002));
    type Meeting = { bondId: string; residents: readonly string[]; spot: { id: string; label: string; tx: number; ty: number }; meetingIndex: number };
    const outdoor = schedules.residentActionWitnesses({ area: 'outdoor', scene: 'TownScene', tx: 10, ty: 10 }, [
      { residentId: 'nyra', area: 'outdoor', scene: 'TownScene', tx: 16, ty: 10, visible: true },
      { residentId: 'tessa', area: 'outdoor', scene: 'TownScene', tx: 17, ty: 10, visible: true },
      { residentId: 'rhea', area: 'outdoor', scene: 'TownScene', tx: 10, ty: 10, visible: false },
    ]);
    const interior = schedules.residentActionWitnesses({ area: 'interior', scene: 'TownBarScene', tx: 2, ty: 2 }, [
      { residentId: 'sylvie', area: 'interior', scene: 'TownBarScene', tx: 50, ty: 50, visible: true },
      { residentId: 'elowen', area: 'interior', scene: 'TownBarScene', tx: 3, ty: 3, visible: false },
      { residentId: 'seren', area: 'interior', scene: 'TownClinicScene', tx: 2, ty: 2, visible: true },
    ]);
    return { first: first.map((meeting: Meeting) => meeting.bondId),
      second: second.map((meeting: Meeting) => meeting.bondId),
      firstCount: new Set(first.flatMap((meeting: Meeting) => meeting.residents)).size,
      spots: first.map((meeting: Meeting) => meeting.spot.id),
      nearby: first.map((meeting: Meeting) => ({ pair: meeting.residents,
        witnesses: schedules.townMeetingWitnesses(3, meeting, createRelationshipsState(3, 1001)) })),
      outdoor, interior };
  });
  expect(result.first).toHaveLength(6); expect(result.firstCount).toBe(12);
  expect(result.second).not.toEqual(result.first);
  // Each pair meets at its own spot, so residents do not all crowd one square, and a pair never witnesses itself.
  expect(new Set(result.spots).size).toBe(result.spots.length);
  expect(result.nearby.every((entry: { pair: string[]; witnesses: string[] }) =>
    entry.witnesses.every(id => !entry.pair.includes(id)))).toBe(true);
  expect(result.outdoor).toEqual(['nyra']);
  expect(result.interior).toEqual(['sylvie']);
});

test('Town owns one scheduled actor per resident, movement changes position, and outdoor interaction works', async ({ page }, testInfo) => {
  await bootGame(page);
  const walkMinute = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { residentTownPresence } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // Start at the beginning of Nyra's first outdoor walk (routes are planned per day, not fixed minutes).
    const map = getMapData('TownScene');
    let minute = 0;
    while (minute <= 1080 && !residentTownPresence('nyra', 1, minute, map)?.moving) minute += 0.25;
    if (minute > 1080) throw new Error('Nyra needs one outdoor walk on day 1');
    GameState.instance.devTuning.clockScale = 0;
    GameState.instance.timeOfDay = minute;
    const current = window.__GAME__!.scene.getScene(window.__TEST__!.activeScene());
    transitionTo(current, 'TownScene', 'from_farm');
    return minute;
  });
  await page.waitForFunction(() => window.__TEST__!.ready && window.__TEST__!.activeScene() === 'TownScene');
  const first = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('TownScene');
    const actors = scene.children.list.filter(child => child.name.startsWith('town-resident-') && !child.name.includes('body')) as Phaser.GameObjects.Sprite[];
    const positions = Object.fromEntries(actors.map(actor => [actor.getData('residentId'), { x: actor.getData('feetX'), y: actor.getData('feetY') }]));
    return { count: actors.length, visible: actors.filter(actor => actor.visible).length, positions };
  });
  expect(first.count).toBe(12);
  expect(first.visible).toBeGreaterThan(0);
  expect(first.visible).toBeLessThan(12);
  await page.evaluate(async minute => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.timeOfDay = minute + 2;
    window.__GAME__!.scene.getScene('TownScene').update(0, 0);
  }, walkMinute);
  const moved = await page.evaluate(() => {
    const actor = window.__GAME__!.scene.getScene('TownScene').children.getByName('town-resident-nyra') as Phaser.GameObjects.Sprite;
    return { x: actor.getData('feetX'), y: actor.getData('feetY'), moving: actor.getData('moving') };
  });
  expect(moved.moving).toBe(true);
  expect(moved.x !== first.positions.nyra.x || moved.y !== first.positions.nyra.y).toBe(true);

  const anchor = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { activeTownMeetings, residentMeetingWindow, townMeetingsForDay } = await import('/src/systems/TownScheduleSystem.ts');
    const firstMeeting = townMeetingsForDay(1)[0];
    const minute = residentMeetingWindow(1, firstMeeting).minute + 1;
    GameState.instance.timeOfDay = minute;
    const scene = window.__GAME__!.scene.getScene('TownScene'); scene.update(0, 0);
    const meeting = activeTownMeetings(1, minute)[0];
    if (!meeting) throw new Error('Expected an active meeting');
    const actor = scene.children.getByName(`town-resident-${meeting.pair.residents[0]}`) as Phaser.GameObjects.Sprite;
    return { tx: Math.floor(actor.getData('feetX') / 16), ty: Math.floor(actor.getData('feetY') / 16), bondId: meeting.pair.bondId };
  });
  await teleport(page, anchor.tx, anchor.ty + 1, 'up');
  await expect.poll(async () => page.evaluate(bondId => {
    const bubble = window.__GAME__!.scene.getScene('TownScene').children.getByName(`town-conversation-${bondId}`) as Phaser.GameObjects.Container;
    return Boolean(bubble?.visible);
  }, anchor.bondId)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('town-conversation-bubble.png') });
  if (process.env.TOWN_SOCIAL_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TOWN_SOCIAL_EVIDENCE_DIR}/town-conversation-bubble.png` });
  }
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).dialogue?.kind).toBe('resident-choice');
});

test('meeting logs precede exactly-once bond progress and reconcile an event-first reload', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const social = await import('/src/systems/TownSocialLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townSocialNotesStorageKey } = await import('/src/systems/TownSocialStorage.ts');
    localStorage.removeItem(townSocialNotesStorageKey('unslotted'));
    GameState.reset(); social.resetTownSocialVoiceRuntime();
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townMeetingsForDay, residentMeetingWindow } = await import('/src/systems/TownScheduleSystem.ts');
    const meeting = townMeetingsForDay(1)[0], minute = residentMeetingWindow(1, meeting).minute;
    const beforeMeeting = GameState.instance.toSaveData();
    social.syncTownSocialLife(1, minute);
    const first = { ...GameState.instance.relationships.bonds[meeting.bondId] };
    social.syncTownSocialLife(1, minute + 20);
    const repeated = { ...GameState.instance.relationships.bonds[meeting.bondId] };
    const firstEvents = social.townSocialEventsForBond(meeting.bondId);
    GameState.installCandidate(GameState.candidateFromSaveData(beforeMeeting));
    social.resetTownSocialVoiceRuntime();
    social.syncTownSocialLife(1, minute);
    const reconciled = { ...GameState.instance.relationships.bonds[meeting.bondId] };
    return { bondId: meeting.bondId, first, repeated, reconciled, eventCount: firstEvents.length, eventId: firstEvents[0].id };
  });
  expect(result.first).toMatchObject({ lastAdvancedDay: 1, exclusive: false, openAgreement: false });
  expect(result.first.points).toBeGreaterThan(0);
  expect(result.repeated).toEqual(result.first);
  expect(result.reconciled).toEqual(result.first);
  expect(result).toMatchObject({ eventCount: 1, eventId: `1:${result.bondId}` });
});

test('social notes are strict, slot-isolated, FIFO bounded, and local voice does not loop retries', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const social = await import('/src/systems/TownSocialLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townSocialNotesStorageKey } = await import('/src/systems/TownSocialStorage.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    const unslotted = townSocialNotesStorageKey('unslotted');
    localStorage.removeItem(unslotted); GameState.reset(); social.resetTownSocialVoiceRuntime();
    const empty = social.townSocialEventsForBond('nyra-cael');
    let unauthored = '';
    try { social.townSocialEventsForBond('nyra-unknown'); } catch (error) { unauthored = (error as Error).message; }
    localStorage.setItem(unslotted, '{bad');
    let malformed = '';
    try { social.townSocialEventsForBond('nyra-cael'); } catch (error) { malformed = (error as Error).message; }
    localStorage.removeItem(unslotted); GameState.reset(); GameState.instance.day = 13; social.resetTownSocialVoiceRuntime();
    social.syncTownSocialLife(13, 1440);
    const bounded = JSON.parse(localStorage.getItem(unslotted)!).events as Array<{ id: string }>;

    localStorage.removeItem(unslotted); GameState.reset(); social.resetTownSocialVoiceRuntime();
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townMeetingsForDay, residentMeetingWindow } = await import('/src/systems/TownScheduleSystem.ts');
    const firstMeeting = townMeetingsForDay(1)[0], firstMinute = residentMeetingWindow(1, firstMeeting).minute;
    social.syncTownSocialLife(1, firstMinute);
    SettingsSystem.update({ localNpcChat: true });
    let requests = 0;
    const originalFetch = window.fetch;
    const sceneReply = (init?: RequestInit, texts = ['A local first line.', 'A local second line.', 'A local third line.', 'A local fourth line.']) => {
      // Scenes alternate speakers starting with the opener the game picked (context.opener).
      const request = JSON.parse(String(init?.body)) as { first: string; second: string; context: { opener: string } };
      const listener = request.context.opener === request.first ? request.second : request.first;
      return new Response(JSON.stringify({ lines: texts.map((text, index) => ({ residentId: index % 2 === 0 ? request.context.opener : listener, text })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    window.fetch = (async (_url, init) => { requests++; return sceneReply(init); }) as typeof fetch;
    const protectedBefore = JSON.stringify(GameState.instance.relationships);
    await social.requestLocalVoiceForEvent(`1:${firstMeeting.bondId}`);
    const protectedAfter = JSON.stringify(GameState.instance.relationships);
    const local = social.townSocialEvent(`1:${firstMeeting.bondId}`);

    GameState.instance.day = 2; social.syncTownSocialLife(2, 0);
    const failedMeeting = townMeetingsForDay(2)[0], failedMinute = residentMeetingWindow(2, failedMeeting).minute;
    social.syncTownSocialLife(2, failedMinute); social.resetTownSocialVoiceRuntime();
    let failedRequests = 0;
    window.fetch = (async () => { failedRequests++; throw new Error('offline'); }) as typeof fetch;
    await social.requestLocalVoiceForEvent(`2:${failedMeeting.bondId}`).catch(() => undefined);
    await social.requestLocalVoiceForEvent(`2:${failedMeeting.bondId}`).catch(() => undefined);
    const failed = social.townSocialEvent(`2:${failedMeeting.bondId}`);
    window.fetch = originalFetch;

    localStorage.removeItem(SaveSystem.storageKey(1));
    SaveSystem.beginNewGame(1); social.resetTownSocialVoiceRuntime();
    const slotMeeting = townMeetingsForDay(1)[0], slotMinute = residentMeetingWindow(1, slotMeeting).minute;
    social.syncTownSocialLife(1, slotMinute);
    const slotKey = townSocialNotesStorageKey(1), slotWritten = localStorage.getItem(slotKey) !== null;
    SaveSystem.delete(1);
    SaveSystem.beginNewGame(1);
    const rewrittenMeeting = townMeetingsForDay(1)[0], rewrittenMinute = residentMeetingWindow(1, rewrittenMeeting).minute;
    social.syncTownSocialLife(1, rewrittenMinute);
    const rewrittenWithoutRuntimeReset = localStorage.getItem(slotKey) !== null;
    SaveSystem.delete(1);
    return { empty, unauthored, malformed, boundedCount: bounded.length, oldest: bounded[0].id,
      protectedEqual: protectedBefore === protectedAfter, requests, localSource: local.source,
      failedRequests, failedSource: failed.source, voiceError: failed.voiceError, slotWritten,
      rewrittenWithoutRuntimeReset, slotRemoved: localStorage.getItem(slotKey) === null };
  });
  expect(result.empty).toEqual([]);
  expect(result.unauthored).toContain('unknown social bond');
  expect(result.malformed).toContain('not valid JSON');
  expect(result.boundedCount).toBe(72); expect(result.oldest.startsWith('2:')).toBe(true);
  expect(result).toMatchObject({ protectedEqual: true, requests: 1,
    localSource: 'local', failedRequests: 1, failedSource: 'authored', slotWritten: true,
    rewrittenWithoutRuntimeReset: true, slotRemoved: true });
  expect(result.voiceError).toContain('unavailable');
});

test('a failed local resident scene retries once in a fresh runtime and clears its saved error', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const social = await import('/src/systems/TownSocialLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townMeetingsForDay, residentMeetingWindow } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townSocialNotesStorageKey } = await import('/src/systems/TownSocialStorage.ts');
    localStorage.removeItem(townSocialNotesStorageKey('unslotted'));
    GameState.reset(); social.resetTownSocialVoiceRuntime(); SettingsSystem.update({ localNpcChat: true });
    const meeting = townMeetingsForDay(1)[0], minute = residentMeetingWindow(1, meeting).minute;
    social.syncTownSocialLife(1, minute);
    const eventId = `1:${meeting.bondId}`, nativeFetch = window.fetch;
    let failedRequests = 0, recoveryRequests = 0;
    try {
      window.fetch = (async () => { failedRequests++; throw new Error('offline'); }) as typeof fetch;
      await social.requestLocalVoiceForEvent(eventId).catch(() => undefined);
      await social.requestLocalVoiceForEvent(eventId).catch(() => undefined);
      const failed = social.townSocialEvent(eventId);
      social.resetTownSocialVoiceRuntime();
      const sceneReply = (init?: RequestInit, texts = ['A local first line.', 'A local second line.', 'A local third line.', 'A local fourth line.']) => {
      // Scenes alternate speakers starting with the opener the game picked (context.opener).
      const request = JSON.parse(String(init?.body)) as { first: string; second: string; context: { opener: string } };
      const listener = request.context.opener === request.first ? request.second : request.first;
      return new Response(JSON.stringify({ lines: texts.map((text, index) => ({ residentId: index % 2 === 0 ? request.context.opener : listener, text })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
      window.fetch = (async (_url, init) => { recoveryRequests++; return sceneReply(init, ['The local voice recovered.',
        'Then let us continue.', 'Where were we?', 'Right where we stopped.']); }) as typeof fetch;
      await social.requestLocalVoiceForEvent(eventId);
      const recovered = social.townSocialEvent(eventId);
      return { failedRequests, failedSource: failed.source, failedError: failed.voiceError,
        recoveryRequests, recoveredSource: recovered.source, recoveredError: recovered.voiceError };
    } finally { window.fetch = nativeFetch; localStorage.removeItem(townSocialNotesStorageKey('unslotted')); }
  });
  expect(result).toMatchObject({ failedRequests: 1, failedSource: 'authored', recoveryRequests: 1,
    recoveredSource: 'local', recoveredError: null });
  expect(result.failedError).toContain('unavailable');
});

test('a later local resident scene receives that pair shared history and current bond context', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source modules to the browser test.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const social = await import('/src/systems/TownSocialLifeSystem.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { townSocialNotesStorageKey } = await import('/src/systems/TownSocialStorage.ts');
    // @ts-expect-error Vite serves source modules to the browser test.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    const key = townSocialNotesStorageKey('unslotted');
    localStorage.removeItem(key); GameState.reset(); GameState.instance.day = 13; social.resetTownSocialVoiceRuntime();
    social.syncTownSocialLife(13, 1440);
    const events = JSON.parse(localStorage.getItem(key)!).events as Array<{ id: string; bondId: string }>;
    const current = [...events].reverse().find(event => events.some(prior => prior.bondId === event.bondId && prior.id !== event.id));
    if (!current) throw new Error('Expected one repeated social pair in the bounded thirteen-day fixture.');
    SettingsSystem.update({ localNpcChat: true }); social.resetTownSocialVoiceRuntime();
    let body: Record<string, unknown> | null = null;
    const nativeFetch = window.fetch;
    const sceneReply = (init?: RequestInit, texts = ['A local first line.', 'A local second line.', 'A local third line.', 'A local fourth line.']) => {
      // Scenes alternate speakers starting with the opener the game picked (context.opener).
      const request = JSON.parse(String(init?.body)) as { first: string; second: string; context: { opener: string } };
      const listener = request.context.opener === request.first ? request.second : request.first;
      return new Response(JSON.stringify({ lines: texts.map((text, index) => ({ residentId: index % 2 === 0 ? request.context.opener : listener, text })) }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    window.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sceneReply(init, ['You kept thinking about that unfinished story too.',
        'Only because you stopped before the interesting part.', 'Then I will finish it tonight.', 'I will hold you to that.']);
    }) as typeof fetch;
    await social.requestLocalVoiceForEvent(current.id); window.fetch = nativeFetch;
    const source = social.townSocialEvent(current.id).source;
    localStorage.removeItem(key);
    return { body, source };
  });
  const context = (result.body as unknown as { context: { sharedHistory: string[]; weekday: string; bondStatus: string;
    opener: string; topicId: string; townNews: string[] } }).context;
  // The opener's topic of the day steers the model; town news is bounded.
  expect(context.topicId).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  expect(context.townNews.length).toBeLessThanOrEqual(3);
  expect(context.sharedHistory.length).toBeGreaterThan(0);
  expect(context.sharedHistory.length).toBeLessThanOrEqual(3);
  expect(context.sharedHistory[0]).toContain('Day ');
  expect(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']).toContain(context.weekday);
  expect(['new-neighbors', 'friends', 'close-friends', 'attracted', 'partners', 'open-partners', 'hurt']).toContain(context.bondStatus);
  expect(result.source).toBe('local');
});
