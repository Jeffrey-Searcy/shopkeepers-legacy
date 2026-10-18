/**
 * Keeper social life: plans that residents really keep, the adventuring party, rounds, Wayfarer cards,
 * the Together menu, and the Wayfarer-night group table (authored backup and the local model, mocked).
 *
 * Every outcome is decided by KeeperSocialSystem. The model only writes words, so the model tests mock
 * POST /chat/group and check that the table shows the words, pre-generates the next quiet turn, and
 * cancels that pre-generated turn when the keeper acts first.
 */
import { expect, test, type Page } from '@playwright/test';
import { bootGame, uiCanvasPoint } from './helpers/gameHarness';

/** The Wayfarer is busy on day 3 (a tavern night); table A seats these four from about 820 to 900. */
const TAVERN_DAY = 3;
const TAVERN_MINUTE = 840;
const TABLE_A = ['tessa', 'seren', 'rowan', 'dorian'];

/**
 * Click one named, visible UIScene control through the scaled canvas.
 * @param page the game page
 * @param name the Phaser object name
 */
async function clickControl(page: Page, name: string): Promise<void> {
  const center = await page.evaluate(name => {
    type Node = { name: string; visible: boolean; list?: Node[]; getBounds(): { centerX: number; centerY: number } };
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const walk = (node: Node, parentVisible: boolean): Node | null => {
      const visible = parentVisible && node.visible;
      if (node.name === name && visible) return node;
      for (const child of node.list ?? []) { const found = walk(child, visible); if (found) return found; }
      return null;
    };
    for (const child of scene.children.list as unknown as Node[]) {
      const found = walk(child, true);
      if (found) { const bounds = found.getBounds(); return { x: bounds.centerX, y: bounds.centerY }; }
    }
    throw new Error(`Missing visible control ${name}`);
  }, name);
  const point = await uiCanvasPoint(page, center);
  await page.mouse.click(point.x, point.y);
}

/**
 * Check whether one named UIScene container is shown.
 * @param page the game page
 * @param name the Phaser object name of a top-level UIScene object
 * @returns true when the object is visible
 */
async function uiObjectVisible(page: Page, name: string): Promise<boolean> {
  return page.evaluate(name => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const found = scene.children.getByName(name) as unknown as { visible: boolean } | null;
    if (!found) throw new Error(`Missing UI object ${name}`);
    return found.visible;
  }, name);
}

/**
 * Click the table button with one id (the slot index comes from the live view).
 * @param page the game page
 * @param id table button id
 */
async function clickTableButton(page: Page, id: string): Promise<void> {
  const index = await page.evaluate(async id => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { wayfarerTableView } = await import('/src/systems/WayfarerTableSystem.ts');
    const view = wayfarerTableView();
    if (!view) throw new Error('No table is open');
    const found = view.buttons.findIndex((button: { id: string }) => button.id === id);
    if (found < 0) throw new Error(`No table button ${id}: ${view.buttons.map((button: { id: string }) => button.id).join(',')}`);
    return found;
  }, id);
  await clickControl(page, `wayfarer-table-button-${index}`);
}

/** Read the live table view (null when no table is open). */
async function tableView(page: Page): Promise<{
  guests: { id: string; hearts: number }[]; phase: string; draft: string; thinking: boolean; status: string;
  lines: { speaker: string; text: string }[]; buttons: { id: string; label: string; enabled: boolean }[];
} | null> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { wayfarerTableView } = await import('/src/systems/WayfarerTableSystem.ts');
    return wayfarerTableView();
  });
}

/** Read the keeper's gold. */
async function gold(page: Page): Promise<number> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.gold as number;
  });
}

/** Read the open dialogue's kind, choice row, and option ids. */
async function dialogue(page: Page): Promise<{ kind: string; line: string; choice?: string; choices?: string[];
  options?: string[]; optionIndex?: number; actionStep?: string } | null> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    const value = GameState.instance.dialogue;
    return value ? { kind: value.kind, line: value.line, choice: value.choice, choices: value.choices,
      options: value.options?.map((option: { id: string }) => option.id), optionIndex: value.optionIndex,
      actionStep: value.actionStep } : null;
  });
}

/**
 * Put the keeper inside The Wayfarer on a tavern night, with gold and the local model set as asked.
 * @param page the game page
 * @param localNpcChat whether the local model is on
 */
async function enterTavernNight(page: Page, localNpcChat: boolean): Promise<void> {
  await page.evaluate(async ({ day, minute, localNpcChat }) => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    SettingsSystem.update({ localNpcChat });
    window.__TEST__!.setDay(day);
    const gs = GameState.instance;
    gs.timeOfDay = minute;
    gs.gold = 200;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), 'TownBarScene', 'entry');
  }, { day: TAVERN_DAY, minute: TAVERN_MINUTE, localNpcChat });
  await page.waitForFunction(() => window.__TEST__?.ready === true && window.__TEST__.activeScene() === 'TownBarScene',
    undefined, { timeout: 20_000 });
}

/**
 * Open Tessa's choice row, move to Join table with the keyboard, and confirm.
 * @param page the game page
 */
async function joinTessaTable(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    openResidentDialogue('tessa');
  });
  const row = await dialogue(page);
  expect(row?.choices).toEqual(['talk', 'chat', 'together', 'table']);
  await page.keyboard.press('ArrowLeft'); // why: the row wraps, so Left from Talk lands on Join table.
  await expect.poll(async () => (await dialogue(page))?.choice).toBe('table');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await dialogue(page))?.kind).toBe('wayfarer-table');
}

test('plans, party, rounds, and cards follow the game rules and survive a save check', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { KeeperSocialSystem, CARD_STAKE } = await import('/src/systems/KeeperSocialSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentRoutePlanForDay } = await import('/src/systems/TownScheduleSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { cloneKeeperSocialState, validateKeeperSocialState } = await import('/src/systems/KeeperSocialState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { POINTS_PER_HEART } = await import('/src/systems/RelationshipSystem.ts');
    const gs = GameState.instance, social = KeeperSocialSystem;
    const setHearts = (id: string, hearts: number) => { gs.relationships.residents[id].points = hearts * POINTS_PER_HEART; };
    gs.gold = 100;

    // Plans: refused below 2 hearts, then offered from tomorrow's real route and kept on the spot.
    setHearts('tessa', 1);
    const refused = social.planOptions('tessa');
    setHearts('tessa', 2);
    const offered = social.planOptions('tessa');
    if (!offered.ok) throw new Error(offered.line);
    const option = offered.options.find((candidate: { destination: string }) => candidate.destination !== 'bar') ?? null;
    if (!option) throw new Error('No outdoor plan was offered');
    const made = social.makePlan('tessa', option);
    const again = social.planOptions('tessa');
    const madeDay = gs.day;
    const route = residentRoutePlanForDay('tessa', madeDay + 1);
    const stop = route.stops.find((candidate: { id: string }) => candidate.id === 'plan');
    gs.day = madeDay + 1;
    gs.timeOfDay = option.startsAt;
    const early = social.checkPlans('TownScene', { tx: option.tx + 10, ty: option.ty }, () => ({ tx: option.tx, ty: option.ty }));
    const kept = social.checkPlans('TownScene', { tx: option.tx, ty: option.ty }, () => ({ tx: option.tx, ty: option.ty }));
    const keptTwice = social.checkPlans('TownScene', { tx: option.tx, ty: option.ty }, () => ({ tx: option.tx, ty: option.ty }));

    // Party: 3 hearts to join, at most two companions, and leaving works.
    setHearts('bram', 2); setHearts('kit', 3); setHearts('cael', 3); setHearts('seren', 3);
    const partyRefused = social.joinParty('bram');
    const partyKit = social.joinParty('kit'), partyCael = social.joinParty('cael'), partyFull = social.joinParty('seren');
    const partyLeft = social.leaveParty('kit');

    // Rounds: 6 gold a head, once per day per target; nobody buys the keeper a drink below 2 hearts.
    const goldBefore = gs.gold;
    const round = social.buyRound('table', ['bram', 'kit', 'cael']);
    const roundAgain = social.buyRound('table', ['bram', 'kit', 'cael']);
    const goldAfterRound = gs.gold;
    setHearts('rowan', 0); setHearts('dorian', 0);
    const noDrink = social.getRound(['rowan', 'dorian']);
    gs.player.stamina = 10;
    const drink = social.getRound(['rowan', 'kit']);
    const staminaAfter = gs.player.stamina;

    // Cards: the deal is seeded (dealing twice gives the same hand), the stake settles once, then the table is done.
    const dealA = social.dealCards(['bram', 'kit', 'cael']);
    const dealB = social.dealCards(['bram', 'kit', 'cael']);
    if (!dealA.ok || !dealB.ok) throw new Error('Cards were refused');
    const goldBeforeCards = gs.gold;
    const finish = social.finishCards(dealA.game, false);
    const goldAfterCards = gs.gold;
    const dealAfter = social.dealCards(['bram', 'kit', 'cael']);

    // Save check: the record passes the strict validator and copies cleanly.
    const validated = validateKeeperSocialState(cloneKeeperSocialState(gs.social), gs.day);
    let damaged = '';
    try { validateKeeperSocialState({ ...cloneKeeperSocialState(gs.social), party: ['kit', 'kit'] }, gs.day); }
    catch (error) { damaged = error instanceof Error ? error.message : String(error); }

    return { refused, offeredCount: offered.options.length, made, again, stop, option, early, kept, keptTwice,
      partyRefused, partyKit, partyCael, partyFull, partyLeft, party: [...gs.social.party],
      goldBefore, round, roundAgain, goldAfterRound, noDrink, drink, staminaAfter,
      sameDeal: JSON.stringify(dealA.game) === JSON.stringify(dealB.game), finish, goldBeforeCards, goldAfterCards,
      dealAfter, stake: CARD_STAKE, validated, social: cloneKeeperSocialState(gs.social), damaged };
  });

  expect(result.refused.ok).toBe(false);
  expect(result.offeredCount).toBeGreaterThan(0);
  expect(result.offeredCount).toBeLessThanOrEqual(3);
  expect(result.made.ok).toBe(true);
  expect(result.made.event).toContain('agreed to meet');
  expect(result.again.ok).toBe(false);
  expect(result.again.line).toContain('already plan');
  expect(result.stop, 'tomorrow\'s route holds the plan stop').toBeTruthy();
  expect(result.stop.tx).toBe(result.option.tx);
  expect(result.stop.ty).toBe(result.option.ty);
  expect(result.stop.arrive).toBe(result.option.startsAt);
  expect(result.early).toEqual([]);
  expect(result.kept).toHaveLength(1);
  expect(result.kept[0]).toContain('You made it');
  expect(result.keptTwice).toEqual([]);

  expect(result.partyRefused.ok).toBe(false);
  expect(result.partyKit.ok).toBe(true);
  expect(result.partyCael.ok).toBe(true);
  expect(result.partyFull.ok).toBe(false);
  expect(result.partyFull.line).toContain('party is full');
  expect(result.partyLeft.ok).toBe(true);
  expect(result.party).toEqual(['cael']);

  expect(result.round.ok).toBe(true);
  expect(result.goldBefore - result.goldAfterRound).toBe(18);
  expect(result.roundAgain.ok).toBe(false);
  expect(result.noDrink.ok).toBe(false);
  expect(result.drink.ok).toBe(true);
  expect(result.drink.line).toContain('Kit buys you a drink');
  expect(result.staminaAfter).toBe(35);

  expect(result.sameDeal).toBe(true);
  const expectedGold = result.finish.winner === 'keeper' ? result.goldBeforeCards + result.stake * 3
    : result.finish.winner === 'tie' ? result.goldBeforeCards : result.goldBeforeCards - result.stake;
  expect(result.goldAfterCards).toBe(expectedGold);
  expect(result.dealAfter.ok).toBe(false);

  expect(result.validated).toEqual(result.social);
  expect(result.damaged).toContain('repeats a resident');
});

test('Together menu runs game actions and lists plans for tomorrow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    SettingsSystem.update({ localNpcChat: false });
    GameState.instance.relationships.residents.bram.points = 500;
    openResidentDialogue('bram');
  });
  const row = await dialogue(page);
  expect(row?.choices, 'outside The Wayfarer there is no table choice').toEqual(['talk', 'chat', 'together']);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await dialogue(page))?.choice).toBe('chat');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await dialogue(page))?.choice).toBe('together');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await dialogue(page))?.kind).toBe('resident-actions');
  expect((await dialogue(page))?.options).toEqual(['befriend', 'flirt', 'plans', 'party-join', 'back']);

  // Spend time by clicking the first option.
  await clickControl(page, 'dialogue-option-0');
  await expect.poll(async () => (await dialogue(page))?.kind).toBe('message');
  expect((await dialogue(page))?.line).toContain('swap stories');

  // Plans: the grid turns into tomorrow's real options, and picking one makes the plan.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentActions } = await import('/src/systems/ResidentDialogueSystem.ts');
    openResidentActions('bram');
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await dialogue(page))?.optionIndex).toBe(2);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await dialogue(page))?.actionStep).toBe('plans');
  const plans = await dialogue(page);
  expect(plans?.options?.[plans.options.length - 1]).toBe('back');
  expect(plans?.options?.length).toBeGreaterThan(1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await dialogue(page))?.kind).toBe('message');
  expect((await dialogue(page))?.line).toContain('I will be there');
  const planCount = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.social.plans.filter((plan: { residentId: string }) => plan.residentId === 'bram').length;
  });
  expect(planCount).toBe(1);
});

test('Wayfarer table works with Local chat off: usual chatter, rounds, befriend, Say, Escape', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootGame(page);
  await enterTavernNight(page, false);
  await joinTessaTable(page);

  const opened = await tableView(page);
  expect(opened?.guests.map(guest => guest.id)).toEqual(TABLE_A);
  expect(opened?.status).toContain('Local chat is off');
  expect(opened?.lines[0].text).toContain('You pull up a chair');
  await expect.poll(async () => (await tableView(page))?.lines.some(line => TABLE_A.includes(line.speaker)),
    { timeout: 5_000 }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('wayfarer-table-1280.png') });

  // H folds the panel to a one-line strip; a tap on the strip opens it again.
  await page.keyboard.press('h');
  await expect.poll(async () => uiObjectVisible(page, 'wayfarer-table-folded')).toBe(true);
  expect(await uiObjectVisible(page, 'wayfarer-table')).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('wayfarer-table-folded-1280.png') });
  await clickControl(page, 'wayfarer-table-strip');
  await expect.poll(async () => uiObjectVisible(page, 'wayfarer-table')).toBe(true);
  expect(await uiObjectVisible(page, 'wayfarer-table-folded')).toBe(false);
  // The Hide tab folds it too, and H opens it again.
  await clickControl(page, 'wayfarer-table-hide');
  await expect.poll(async () => uiObjectVisible(page, 'wayfarer-table-folded')).toBe(true);
  await page.keyboard.press('h');
  await expect.poll(async () => uiObjectVisible(page, 'wayfarer-table')).toBe(true);

  // Buy a round for four guests: 24 gold, then the button is used up for the night.
  const goldBefore = await gold(page);
  await clickTableButton(page, 'round-buy');
  await expect.poll(async () => gold(page)).toBe(goldBefore - 24);
  expect((await tableView(page))?.buttons.find(button => button.id === 'round-buy')?.enabled).toBe(false);

  // Get to know Seren: pick a target, then the action is used up for her today.
  await clickTableButton(page, 'befriend');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('pick-target');
  await clickTableButton(page, 'guest-seren');
  await expect.poll(async () => (await tableView(page))?.lines.some(line => line.text.includes('swap stories'))).toBe(true);
  await clickTableButton(page, 'befriend');
  expect((await tableView(page))?.buttons.find(button => button.id === 'guest-seren')?.enabled).toBe(false);
  await clickTableButton(page, 'back');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('idle');

  // Say something with the keyboard.
  await page.keyboard.press('Enter'); // the highlight is on "Say something" after Back
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await page.keyboard.type('Hello table');
  await expect.poll(async () => (await tableView(page))?.draft).toBe('Hello table');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await tableView(page))?.lines.some(line => line.speaker === 'player' && line.text === 'Hello table')).toBe(true);
  expect((await tableView(page))?.phase).toBe('idle');

  // Escape while typing drops the line and keeps the table open; the next Escape leaves the table.
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await page.keyboard.type('Never mind');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('idle');
  expect((await tableView(page))?.draft).toBe('');
  expect((await tableView(page))?.lines.some(line => line.text === 'Never mind')).toBe(false);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await dialogue(page))).toBeNull();
  expect(await tableView(page)).toBeNull();
});

test('touch players type at the table through the on-screen text box', async ({ page }) => {
  await bootGame(page);
  await enterTavernNight(page, false);
  await joinTessaTable(page);
  const box = page.getByTestId('touch-text-entry');
  // Desktop never sees the box, even while the Say line is open.
  await clickTableButton(page, 'say');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await expect(box).toBeHidden();
  await clickTableButton(page, 'cancel');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('idle');

  // why: TouchMode turns on at the first touchstart on window, exactly as a finger does on an iPad.
  await page.evaluate(() => window.dispatchEvent(new Event('touchstart')));
  // iOS opens the keyboard only from a real tap, so the closed Say line waits in the box without focus.
  await expect(box).toBeVisible();
  const field = box.getByRole('textbox', { name: 'What you say' });
  await expect(field).toHaveAttribute('placeholder', 'Tap here to say something…');
  await expect(field).not.toBeFocused();
  expect((await tableView(page))?.phase).toBe('idle');
  // The player's own tap on the box opens the Say line inside that tap.
  await field.click();
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await expect(field).toBeFocused();
  await field.fill('Who wants cards?');
  // One source of truth: the box writes the whole line into the table, and keys never type twice.
  await expect.poll(async () => (await tableView(page))?.draft).toBe('Who wants cards?');
  await field.press('Enter');
  await expect.poll(async () => (await tableView(page))?.lines.some(line => line.speaker === 'player' && line.text === 'Who wants cards?')).toBe(true);
  expect((await tableView(page))?.phase).toBe('idle');
  // After Say the box closes the keyboard and goes back to waiting, empty, for the next tap.
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue('');
  // The game's own Say button still opens the line, and the box follows it.
  await clickTableButton(page, 'say');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await expect(field).toHaveAttribute('placeholder', 'Say something to the table');
  // The box's Say button on a closed line opens the line instead of sending an empty one.
  await clickTableButton(page, 'cancel');
  await expect.poll(async () => (await tableView(page))?.phase).toBe('idle');
  await box.getByRole('button', { name: 'Say' }).click();
  await expect.poll(async () => (await tableView(page))?.phase).toBe('typing');
  await expect(field).toBeFocused();
});

test('touch players chat with one resident through the on-screen text box', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    SettingsSystem.update({ localNpcChat: true });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/chat') return realFetch(input, init);
      const body = JSON.parse(String(init?.body)) as { message: string };
      return new Response(JSON.stringify({ reply: `You said: ${body.message}`, outcome: 'continue', intimateTopic: false, offer: 'none' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    window.dispatchEvent(new Event('touchstart'));
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const dialogue = await import('/src/systems/ResidentDialogueSystem.ts');
    dialogue.openResidentDialogue('nyra'); dialogue.selectResidentDialogueChoice('chat'); dialogue.confirmResidentDialogueChoice();
  });
  const box = page.getByTestId('touch-text-entry');
  const field = box.getByRole('textbox', { name: 'What you say' });
  await expect(box).toBeVisible();
  await expect(field).toHaveAttribute('placeholder', /Say something to Nyra/);
  await field.fill('How is the shop going?');
  await box.getByRole('button', { name: 'Say' }).click();
  // The reply hides the box; the game owns the line and the model only writes words.
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.dialogue?.line;
  })).toBe('You said: How is the shop going?');
  // Continuing opens a new input line, which reloads the box empty.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    (await import('/src/systems/ResidentDialogueSystem.ts')).continueResidentChat();
  });
  await expect(box).toBeVisible();
  await expect(field).toHaveValue('');
});

test('Wayfarer table shows model words, pre-generates the next turn, and cancels it when the keeper acts', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(() => {
    // why: the mock records each request and holds every request after the first open until it is aborted,
    // so the test can see the pre-generated quiet turn being cancelled.
    type Call = { body: { residentIds: string[]; playerLine: string; context: { event: string }; history: unknown[] }; aborted: boolean };
    const calls: Call[] = [];
    (window as unknown as { __GROUP_CALLS__: Call[] }).__GROUP_CALLS__ = calls;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/chat/group') return realFetch(input, init);
      const call: Call = { body: JSON.parse(String(init?.body)), aborted: false };
      calls.push(call);
      // The bridge streams one NDJSON event per line, then a done marker.
      const reply = () => new Response([
        { line: { residentId: 'seren', text: `Mock line ${calls.length} from Seren.` } },
        { line: { residentId: 'rowan', text: `Mock line ${calls.length} from Rowan.` } },
        { done: true },
      ].map(event => `${JSON.stringify(event)}\n`).join(''), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
      if (call.body.context.event) return reply();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { call.aborted = true; reject(new DOMException('aborted', 'AbortError')); });
      });
    };
  });
  await enterTavernNight(page, true);
  await joinTessaTable(page);

  type Calls = { body: { residentIds: string[]; playerLine: string; context: { event: string }; history: { speaker: string }[] }; aborted: boolean }[];
  const calls = () => page.evaluate(() => (window as unknown as { __GROUP_CALLS__: Calls }).__GROUP_CALLS__);
  await expect.poll(async () => (await tableView(page))?.lines.some(line => line.text === 'Mock line 1 from Seren.')).toBe(true);
  await expect.poll(async () => (await calls()).length, { message: 'a quiet turn is pre-generated' }).toBe(2);
  const [join, quiet] = await calls();
  expect(join.body.residentIds).toEqual(TABLE_A);
  expect(join.body.context.event).toContain('pulled up a chair');
  expect(quiet.body.context.event).toBe('');
  expect(quiet.body.history.map(turn => turn.speaker)).toEqual(['seren', 'rowan']);

  await clickTableButton(page, 'round-buy');
  await expect.poll(async () => (await calls())[1].aborted, { message: 'the pending quiet turn is cancelled' }).toBe(true);
  await expect.poll(async () => (await calls()).length).toBeGreaterThanOrEqual(3);
  expect((await calls())[2].body.context.event).toContain('bought everyone a round');
  await expect.poll(async () => (await tableView(page))?.lines.some(line => line.text === 'Mock line 3 from Seren.')).toBe(true);
});

test('Wayfarer table closes when guests head home or the night ends', async ({ page }) => {
  await bootGame(page);
  await enterTavernNight(page, false);
  await joinTessaTable(page);
  // Find the first minute when someone at table A heads home (from the real schedule).
  const leave = await page.evaluate(async ({ guests, from }) => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentScheduleScene } = await import('/src/systems/TownScheduleSystem.ts');
    const day = GameState.instance.day;
    for (let minute = from; minute < 960; minute++) {
      const staying = guests.filter((id: string) => residentScheduleScene(id, day, minute).scene === 'TownBarScene');
      if (staying.length < guests.length) { GameState.instance.timeOfDay = minute; return { minute, staying }; }
    }
    throw new Error('Nobody at table A heads home before closing');
  }, { guests: TABLE_A, from: TAVERN_MINUTE });
  const leavers = TABLE_A.filter(id => !leave.staying.includes(id));
  if (leave.staying.length >= 3) {
    await expect.poll(async () => (await tableView(page))?.guests.map(guest => guest.id), { timeout: 5_000 }).toEqual(leave.staying);
    expect((await tableView(page))?.lines.some(line => line.text.includes('says goodnight and heads home'))).toBe(true);
    await page.evaluate(async () => {
      // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
      const { GameState } = await import('/src/state/GameState.ts');
      GameState.instance.timeOfDay = 960;
    });
    await expect.poll(async () => (await dialogue(page))?.line, { timeout: 5_000 }).toContain('Last call!');
  } else {
    await expect.poll(async () => (await dialogue(page))?.line, { timeout: 5_000 }).toContain('the table breaks up for the night');
    expect(leavers.length).toBeGreaterThan(0);
  }
  expect((await dialogue(page))?.kind).toBe('message');
  expect(await tableView(page)).toBeNull();
});
