/**
 * Companion walks: a party member asked to "Walk with me" from the Together grid follows the keeper
 * through ordinary world scenes (CompanionWalkSystem + BaseWorldScene.walkingParty), while their
 * scheduled town body (TownResident) steps aside so they are never in two places at once.
 *
 * Covered here: starting a walk through the real action menu, the hidden town body, carrying the
 * follower across a scene transition, talking to the follower with Interact (also after turning
 * around with real movement input, which must not send them around the keeper), the bedtime toast that
 * ends the walk, "Go about your day", the walk never reaching the save payload, and the Mines keeping
 * their own combat party instead of a walking follower.
 *
 * Scenes are entered through the real transition system (transitionTo); private scene state is read
 * through window.__GAME__, like the party-companions spec does.
 */
import { expect, test, type Page } from '@playwright/test';
import { advanceFrames, bootGame, sendInput, stopMove } from './helpers/gameHarness';

/** The resident who walks with the keeper in every case below. */
const WALKER = 'tessa';

/**
 * Travel to a world scene through the real transition and wait until it is controllable.
 * @param page the test page
 * @param target scene key to enter
 * @param spawn named spawn in that scene
 */
async function travel(page: Page, target: string, spawn: string): Promise<void> {
  await page.evaluate(async ({ target, spawn }) => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), target, spawn);
  }, { target, spawn });
  await page.waitForFunction(k => window.__TEST__?.ready === true && window.__TEST__.activeScene() === k, target, { timeout: 15_000 });
}

/**
 * Open the resident's Together grid and press the option with this id, the way a click would.
 * @param page the test page
 * @param optionId action id such as 'walk-start'
 * @returns the option ids the grid offered
 */
async function pressTogether(page: Page, optionId: string): Promise<string[]> {
  return page.evaluate(async ({ id, optionId }) => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves the live module to the test browser.
    const { openResidentActions, confirmResidentAction } = await import('/src/systems/ResidentDialogueSystem.ts');
    openResidentActions(id);
    const options = (GameState.instance.dialogue.options as Array<{ id: string }>).map(option => option.id);
    const index = options.indexOf(optionId);
    if (index < 0) throw new Error(`Together grid has no ${optionId}: ${options.join(',')}`);
    confirmResidentAction(index);
    return options;
  }, { id: WALKER, optionId });
}

/**
 * The residents walking with the keeper in a scene, read from BaseWorldScene's private walkingParty.
 * @param page the test page
 * @param sceneKey the world scene
 * @returns null when the scene has no walking party at all (Dungeon, Mines, Jail)
 */
async function walkingMembers(page: Page, sceneKey: string): Promise<Array<{ id: string; x: number; y: number }> | null> {
  return page.evaluate(k => {
    const scene = window.__GAME__!.scene.getScene(k) as unknown as {
      walkingParty: { members: Array<{ residentId: string; x: number; y: number }> } | null;
    };
    return scene.walkingParty ? scene.walkingParty.members.map(m => ({ id: m.residentId, x: m.x, y: m.y })) : null;
  }, sceneKey);
}

/** Read the walker's scheduled town body: whether it is active and what its schedule label says. */
async function townBody(page: Page): Promise<{ active: boolean; activity: string }> {
  return page.evaluate(id => {
    const scene = window.__GAME__!.scene.getScene('TownScene') as unknown as {
      residents: Map<string, { collider: { active: boolean; getData(key: string): string } }>;
    };
    const body = scene.residents.get(id);
    if (!body) throw new Error(`TownScene has no body for ${id}`);
    return { active: body.collider.active, activity: body.collider.getData('scheduleActivity') };
  }, WALKER);
}

/** Collect every toast line the game shows from now on, in window.__walkToasts. */
async function recordToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __walkToasts: string[] };
    store.__walkToasts = [];
    window.__GAME__!.events.on('toast', (line: string) => store.__walkToasts.push(line));
  });
}

/** Read the toast lines recorded since recordToasts. */
async function toasts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __walkToasts: string[] }).__walkToasts);
}

/** Boot, put the walker in the party, and arrive in town. */
async function townWithPartyMember(page: Page): Promise<void> {
  await bootGame(page);
  await page.evaluate(async id => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.social.party = [id];
  }, WALKER);
  await travel(page, 'TownScene', 'from_farm');
}

test('a party member walks with the keeper, crosses scenes, talks, and steps aside again', async ({ page }) => {
  await townWithPartyMember(page);
  expect(await walkingMembers(page, 'TownScene'), 'nobody follows before the walk starts').toEqual([]);

  const offered = await pressTogether(page, 'walk-start');
  expect(offered).toContain('party-leave');
  const started = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.dialogue.line as string;
  });
  expect(started).toContain('Lead the way');
  await advanceFrames(page, 600);
  expect((await walkingMembers(page, 'TownScene'))!.map(m => m.id)).toEqual([WALKER]);
  expect(await townBody(page), 'the town body steps aside while walking').toEqual({ active: false, activity: 'walking with the keeper' });

  // The walk list is transient: it never reaches the save payload.
  const saved = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    return Object.keys(GameState.instance.toSaveData());
  });
  expect(saved).not.toContain('companionWalk');

  // The follower crosses into the farm with the keeper and stays close.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    closeDialogue();
  });
  await travel(page, 'FarmScene', 'from_town');
  await advanceFrames(page, 800);
  const onFarm = await walkingMembers(page, 'FarmScene');
  expect(onFarm!.map(m => m.id)).toEqual([WALKER]);
  const keeper = await page.evaluate(() => (window.__TEST__!.state() as unknown as { player: { x: number; y: number } }).player);
  expect(Math.hypot(onFarm![0].x - keeper.x, onFarm![0].y - keeper.y), 'the follower stays within a few tiles').toBeLessThan(48);

  // Face the follower and press Interact: the same Talk / Chat / Together row as their town self opens.
  await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('FarmScene') as unknown as {
      walkingParty: { members: Array<{ x: number; y: number }> };
    };
    const follower = scene.walkingParty.members[0];
    const tx = Math.floor(follower.x / 16), ty = Math.floor(follower.y / 16);
    // why: stand one tile below the follower facing up, then press Interact before they take a step.
    window.__TEST__!.teleport(tx, ty + 1, 'up');
    window.__TEST__!.input('interact');
  });
  await expect.poll(async () => page.evaluate(() => {
    const value = window.__TEST__!.state() as unknown as { dialogue: { kind?: string; residentId?: string } | null };
    return value.dialogue ? `${value.dialogue.kind}:${value.dialogue.residentId}` : null;
  })).toBe(`resident-choice:${WALKER}`);

  // "Go about your day" ends the walk; the follower leaves and the town body comes back on schedule.
  expect(await pressTogether(page, 'walk-stop')).not.toContain('walk-start');
  await advanceFrames(page, 400);
  expect(await walkingMembers(page, 'FarmScene')).toEqual([]);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    closeDialogue();
  });
  await travel(page, 'TownScene', 'from_farm');
  await advanceFrames(page, 400);
  expect((await townBody(page)).activity).not.toBe('walking with the keeper');
});

test('a walk ends with a toast at bedtime, and the Mines keep their own combat party', async ({ page }) => {
  await townWithPartyMember(page);
  await pressTogether(page, 'walk-start');
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { closeDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    closeDialogue();
  });
  await advanceFrames(page, 400);
  expect((await walkingMembers(page, 'TownScene'))!.map(m => m.id)).toEqual([WALKER]);

  // The Mines bring the whole party as fighters, so no walking follower is built there.
  await travel(page, 'MinesScene', 'entrance');
  await advanceFrames(page, 400);
  expect(await walkingMembers(page, 'MinesScene'), 'the Mines have no walking party').toBeNull();
  const fighters = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('MinesScene') as unknown as { party: { members: Array<{ residentId: string }> } };
    return scene.party.members.map(m => m.residentId);
  });
  expect(fighters).toEqual([WALKER]);

  await travel(page, 'TownScene', 'from_farm');
  await advanceFrames(page, 400);
  expect((await walkingMembers(page, 'TownScene'))!.map(m => m.id), 'the walk resumes outside the Mines').toEqual([WALKER]);

  await recordToasts(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves the live module to the test browser.
    const { RESIDENT_HOME_DEADLINE } = await import('/src/config/TownSchedules.ts');
    GameState.instance.timeOfDay = RESIDENT_HOME_DEADLINE;
  });
  await advanceFrames(page, 400);
  expect(await toasts(page)).toContain('Tessa heads home for the night.');
  expect(await walkingMembers(page, 'TownScene')).toEqual([]);
  const late = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { CompanionWalkSystem } = await import('/src/systems/CompanionWalkSystem.ts');
    return CompanionWalkSystem.startWalk(id);
  }, WALKER);
  expect(late).toEqual({ ok: false, line: 'Tessa: "It is late. I am heading home."' });
});

test('turning around to talk: a settled walker holds still, answers Interact, and stays put', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async id => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves the live module to the test browser.
    const { CompanionWalkSystem } = await import('/src/systems/CompanionWalkSystem.ts');
    GameState.instance.social.party = [id];
    CompanionWalkSystem.startWalk(id);
  }, WALKER);
  const scene = await page.evaluate(() => window.__TEST__!.activeScene());
  // Walk left with real movement input, stop, and let the walker settle on the trail spot.
  await sendInput(page, 'move:left');
  await advanceFrames(page, 1200);
  await stopMove(page);
  await advanceFrames(page, 800);
  const settled = (await walkingMembers(page, scene))![0];
  // A short tap to the right turns the keeper toward the walker, the way a player would.
  await sendInput(page, 'move:right');
  await advanceFrames(page, 120);
  await stopMove(page);
  await advanceFrames(page, 150);
  const afterTurn = (await walkingMembers(page, scene))![0];
  expect(afterTurn, 'turning toward the walker does not send them around the keeper').toEqual(settled);
  await sendInput(page, 'interact');
  await expect.poll(async () => page.evaluate(() => {
    const value = window.__TEST__!.state() as unknown as { dialogue: { kind?: string; residentId?: string } | null };
    return value.dialogue ? `${value.dialogue.kind}:${value.dialogue.residentId}` : null;
  })).toBe(`resident-choice:${WALKER}`);
  await advanceFrames(page, 1000);
  expect(await walkingMembers(page, scene), 'the walker stays put while the talk is open').toEqual([settled]);
});

test('stopping a walk that never started fails loudly', async ({ page }) => {
  await townWithPartyMember(page);
  const message = await page.evaluate(async id => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { CompanionWalkSystem } = await import('/src/systems/CompanionWalkSystem.ts');
    try { CompanionWalkSystem.stopWalk(id); return 'no error'; } catch (error) { return (error as Error).message; }
  }, WALKER);
  expect(message).toBe(`Companion walk: ${WALKER} is not walking with the keeper`);
});
