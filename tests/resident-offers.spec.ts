/**
 * Resident chat offers and mana (playtester: "if the AI liked how I talked to it, cool things could
 * happen right there in game", e.g. Nyra teaching mana that grows by meditating about an hour).
 *
 * Pins, through real game paths:
 *  - a chat turn sends grounded world facts and only the offers that pass every gate;
 *  - an offered reply shows accept / "Not now" buttons; accept runs the authored effect once,
 *    decline (or moving on) stops the offer from being sent again in that conversation;
 *  - hearts, daily limits, `ready` rules, and a full bag gate offers; a refused effect is not used up;
 *  - the client rejects an offer it did not send and an offer that rides on a boundary outcome;
 *  - meditation: 60 game minutes give +1 max mana, any action stands the keeper up, Mend trades
 *    1 mana for stamina, and sleep refills mana; the HUD shows the mana row only after learning;
 *  - save version 23 keeps the offer record, version 22 migrates to none, damaged records fail loudly.
 */
import { test, expect, type Page } from '@playwright/test';
import { bootGame, getState, sendInput, stopMove, advanceFrames, stepTime, sleepInGame, uiCanvasPoint } from './helpers/gameHarness';

/** JSON reply the fake /chat endpoint returns for one turn. */
interface FakeReply {
  reply: string;
  outcome: 'continue' | 'warning' | 'end-conversation' | 'call-guard';
  intimateTopic: boolean;
  offer: string;
}

/**
 * Turn on local chat and replace fetch with a queue of fake /chat replies. Each request body is
 * kept on window.__OFFER_REQUESTS__ so a test can read what the game sent.
 * @param page The game page.
 * @param replies Replies in order; a request past the end fails the test.
 */
async function fakeChat(page: Page, replies: FakeReply[]): Promise<void> {
  await page.evaluate(async (queue) => {
    // @ts-expect-error Vite browser module.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    SettingsSystem.update({ localNpcChat: true });
    const requests: unknown[] = [];
    (window as unknown as { __OFFER_REQUESTS__: unknown[] }).__OFFER_REQUESTS__ = requests;
    window.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      const next = queue.shift();
      if (!next) throw new Error('fake chat: no reply left');
      return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  }, replies);
}

/**
 * Set one resident's friendship points (250 points per heart).
 * @param page The game page.
 * @param points Raw points.
 */
async function setNyraPoints(page: Page, points: number): Promise<void> {
  await page.evaluate(async (value) => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.relationships.residents.nyra.points = value;
  }, points);
}

/**
 * Open Nyra's typed chat, send one line, and wait for the reply.
 * @param page The game page.
 * @param line What the keeper types.
 * @param open true to open a new conversation first; false to continue the open one
 */
async function sayToNyra(page: Page, line: string, open: boolean): Promise<void> {
  await page.evaluate(async ([text, fresh]) => {
    // @ts-expect-error Vite browser module.
    const dialogue = await import('/src/systems/ResidentDialogueSystem.ts');
    if (fresh) {
      dialogue.openResidentDialogue('nyra');
      dialogue.selectResidentDialogueChoice('chat');
      dialogue.confirmResidentDialogueChoice();
    } else {
      dialogue.continueResidentChat();
    }
    dialogue.setResidentChatDraft(text);
    await dialogue.sendResidentChat();
  }, [line, open] as const);
  await expect.poll(async () => (await getState(page)).dialogue?.chatPhase).toBe('reply');
}

/** Context sent with the last fake /chat request. */
async function lastContext(page: Page): Promise<{ offers: string[]; world: Record<string, unknown> }> {
  return page.evaluate(() => {
    const requests = (window as unknown as { __OFFER_REQUESTS__: Array<{ context: { offers: string[]; world: Record<string, unknown> } }> }).__OFFER_REQUESTS__;
    return requests[requests.length - 1].context;
  });
}

/** Visibility and label of the offer row in the dialogue box. */
async function offerRow(page: Page): Promise<{ accept: boolean; decline: boolean; label: string }> {
  await advanceFrames(page, 60);
  return page.evaluate(() => {
    const box = window.__GAME__!.scene.getScene('UIScene').children.getByName('dialogue-box') as Phaser.GameObjects.Container;
    const accept = box.getByName('dialogue-offer-accept') as Phaser.GameObjects.Rectangle;
    const decline = box.getByName('dialogue-offer-decline') as Phaser.GameObjects.Rectangle;
    const label = box.getByName('dialogue-offer-accept-label') as Phaser.GameObjects.Text;
    return { accept: accept.visible, decline: decline.visible, label: label.text };
  });
}

test('Nyra offers to teach mana in a grounded chat; accept runs it once; decline is not repeated', async ({ page }) => {
  await bootGame(page);
  await setNyraPoints(page, 500); // 2 hearts: both of Nyra's offers pass their gates
  await fakeChat(page, [
    { reply: 'You feel it too? Sit with me and I can teach you to sense your own mana.', outcome: 'continue', intimateTopic: false, offer: 'teach-mana' },
    { reply: 'Since you liked that, I could show you a little charm.', outcome: 'continue', intimateTopic: false, offer: 'show-magic' },
    { reply: 'Of course. Another time.', outcome: 'continue', intimateTopic: false, offer: 'none' },
  ]);
  await sayToNyra(page, 'I have always wanted to learn magic.', true);
  const first = await lastContext(page);
  expect(first.offers).toEqual(['teach-mana', 'show-magic']);
  expect(first.world).toMatchObject({ place: "the keeper's farm", indoors: false, day: 1, season: 'spring' });
  expect(Object.keys(first.world).sort()).toEqual(['activity', 'clock', 'day', 'indoors', 'news', 'place', 'places', 'season', 'weather', 'weekday']);
  expect(first.world.places).toContain('the town streets');
  let state = await getState(page);
  expect(state.dialogue?.chatOffer).toBe('teach-mana');
  expect(await offerRow(page)).toEqual({ accept: true, decline: true, label: 'Teach me to feel mana' });

  // Keyboard: Right moves to "Not now", Left back to accept, Enter answers.
  await page.keyboard.press('ArrowRight');
  expect((await getState(page)).dialogue?.offerChoice).toBe('decline');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  state = await getState(page);
  expect(state.dialogue?.chatOffer).toBeUndefined();
  expect(state.dialogue?.line).toContain('Feel that small warm hum');
  expect(state.dialogue?.line).toContain('You can feel mana now');
  const learned = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    return { mana: GameState.instance.vitality.mana, record: GameState.instance.residentOffers.lastDay };
  });
  expect(learned).toEqual({ mana: { current: 3, max: 3, practice: 0 }, record: { 'teach-mana': 1 } });
  expect((await offerRow(page)).accept).toBe(false);

  // Mana is learned, so only show-magic is sent next. Decline it; it is not sent again this conversation.
  await sayToNyra(page, 'That was amazing.', false);
  expect((await lastContext(page)).offers).toEqual(['show-magic']);
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { confirmResidentOffer } = await import('/src/systems/ResidentDialogueSystem.ts');
    confirmResidentOffer('decline');
  });
  state = await getState(page);
  expect(state.dialogue?.chatOffer).toBeUndefined();
  expect(state.dialogue?.declinedOffers).toEqual(['show-magic']);
  await sayToNyra(page, 'Maybe another day.', false);
  expect((await lastContext(page)).offers).toEqual([]);
  const buffs = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.vitality.buffs.length;
  });
  expect(buffs).toBe(0);
});

test('offer gates: hearts, daily limit, ready rules, a full bag, and client checks on the reply', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { ResidentOfferSystem } = await import('/src/systems/ResidentOfferSystem.ts');
    // @ts-expect-error Vite browser module.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite browser module.
    const { chatWithResident } = await import('/src/systems/LocalNpcChatSystem.ts');
    // @ts-expect-error Vite browser module.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    const gs = GameState.instance, residents = gs.relationships.residents;
    residents.nyra.points = 0;
    const noHearts = ResidentOfferSystem.eligibleOffers('nyra', []);
    residents.nyra.points = 250;
    const oneHeart = ResidentOfferSystem.eligibleOffers('nyra', []);
    let notEligible = '';
    try { ResidentOfferSystem.accept('nyra', 'teach-mana'); } catch (error) { notEligible = String(error); }
    let foreign = '';
    try { ResidentOfferSystem.accept('nyra', 'herbal-tea'); } catch (error) { foreign = String(error); }
    const magic = ResidentOfferSystem.accept('nyra', 'show-magic');
    const quickStep = gs.vitality.buffs.map((buff: { id: string }) => buff.id);
    const sameDay = ResidentOfferSystem.isEligible('nyra', 'show-magic');
    gs.day += 1;
    const nextDay = ResidentOfferSystem.isEligible('nyra', 'show-magic');

    residents.sylvie.points = 250;
    gs.player.stamina = 100;
    const teaAtFull = ResidentOfferSystem.isEligible('sylvie', 'herbal-tea');
    gs.player.stamina = 80;
    const tea = ResidentOfferSystem.accept('sylvie', 'herbal-tea');
    const staminaAfterTea = gs.player.stamina;

    residents.tessa.points = 250;
    // why: fill every free slot with distinct items (same fixture as furniture-footprints) so the berries have nowhere to go.
    for (const item of Object.keys(ITEM_CATALOG)) if (item !== 'strawberry') gs.addItem(item, 1);
    const bagFull = !gs.addItem('strawberry', 1);
    const berries = ResidentOfferSystem.accept('tessa', 'fresh-berries');
    const berriesStillOffered = ResidentOfferSystem.isEligible('tessa', 'fresh-berries');

    SettingsSystem.update({ localNpcChat: true });
    const reply = (offer: string, outcome = 'continue') => {
      window.fetch = (async () => new Response(JSON.stringify({ reply: 'Here you go.', outcome, intimateTopic: false, offer }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    };
    reply('teach-mana');
    let unsent = '';
    try { await chatWithResident('nyra', 'Hello', [], '', [], ['show-magic']); } catch (error) { unsent = String(error); }
    reply('show-magic', 'warning');
    let onWarning = '';
    try { await chatWithResident('nyra', 'Hello', [], '', [], ['show-magic']); } catch (error) { onWarning = String(error); }
    let tooMany = '';
    try { await chatWithResident('nyra', 'Hello', [], '', [], ['show-magic', 'show-magic']); } catch (error) { tooMany = String(error); }
    return { noHearts, oneHeart, notEligible, foreign, magic, sameDay, nextDay, teaAtFull, tea, staminaAfterTea, bagFull,
      berries, berriesStillOffered, record: gs.residentOffers.lastDay, quickStep,
      unsent, onWarning, tooMany };
  });
  expect(result.noHearts).toEqual([]);
  expect(result.oneHeart).toEqual(['show-magic']); // teach-mana needs 2 hearts
  expect(result.notEligible).toContain('teach-mana is not available from nyra');
  expect(result.foreign).toContain('herbal-tea is not available from nyra');
  expect(result.magic).toEqual({ ok: true, message: 'Quick Step: you walk faster' });
  expect(result.quickStep).toEqual(['quick-step']);
  expect(result.sameDay).toBe(false);
  expect(result.nextDay).toBe(true);
  expect(result.teaAtFull).toBe(false);
  expect(result.tea).toEqual({ ok: true, message: '+20 stamina' });
  expect(result.staminaAfterTea).toBe(100);
  expect(result.bagFull).toBe(true);
  expect(result.berries).toEqual({ ok: false, message: 'Your bag is full. Make room for the Strawberries first.' });
  expect(result.berriesStillOffered).toBe(true); // a refused effect is not used up
  expect(result.record).toEqual({ 'show-magic': 1, 'herbal-tea': 2 });
  expect(result.unsent).toContain('an offer it was not allowed');
  expect(result.onWarning).toContain('paired an offer with a boundary outcome');
  expect(result.tooMany).toContain('Chat offers are invalid');
});

test('meditation grows max mana each hour, stops on movement, Mend trades mana for stamina, sleep refills', async ({ page }) => {
  await bootGame(page);
  const hudBefore = await page.evaluate(() =>
    (window.__GAME__!.scene.getScene('UIScene').children.getByName('hud-mana-bar') as Phaser.GameObjects.Rectangle).visible);
  expect(hudBefore).toBe(false);
  await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { VitalitySystem } = await import('/src/systems/VitalitySystem.ts');
    VitalitySystem.learnMana();
  });
  await advanceFrames(page, 60);
  // Layout: the left column stacks the mana row, then the task strip below it (a probe found the strip
  // covering a fixed mana row and eating Meditate taps).
  const layout = await page.evaluate(() => {
    const ui = window.__GAME__!.scene.getScene('UIScene');
    const strip = ui.children.getByName('tavern-objective') as Phaser.GameObjects.Container;
    const button = ui.children.getByName('hud-meditate') as Phaser.GameObjects.Rectangle;
    return { stripY: strip.y, stripVisible: strip.visible, button: { x: button.x, y: button.y, w: button.width, h: button.height } };
  });
  expect(layout.stripVisible).toBe(true);
  expect(layout.button.y).toBe(88);
  expect(layout.stripY).toBeGreaterThan(layout.button.y + layout.button.h);
  // Start meditating through a real tap on the HUD button, not a direct system call.
  const tap = await uiCanvasPoint(page, { x: layout.button.x + layout.button.w / 2, y: layout.button.y + layout.button.h / 2 });
  await page.mouse.click(tap.x, tap.y);
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.meditating;
  })).toBe(true);
  await stepTime(page, 60);
  const exact = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    return { ...GameState.instance.vitality.mana };
  });
  // One hour: +1 max mana; two half-hours of sitting restore 2 current (capped at the new max).
  // why: the live clock adds a few real frames of time between calls, so practice is near 0, not exactly 0.
  expect(exact).toMatchObject({ current: 4, max: 4 });
  expect(exact.practice).toBeLessThan(1);
  await advanceFrames(page, 60);
  const sitting = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    const ui = window.__GAME__!.scene.getScene('UIScene');
    return { meditating: GameState.instance.meditating,
      bar: (ui.children.getByName('hud-mana-bar') as Phaser.GameObjects.Rectangle).visible,
      text: (ui.children.getByName('hud-mana-text') as Phaser.GameObjects.Text).text,
      button: (ui.children.getByName('hud-meditate-label') as Phaser.GameObjects.Text).text };
  });
  // The clock keeps running during the frames, so a sub-minute of practice may show as 0/60m.
  expect(sitting).toEqual({ meditating: true, bar: true,
    text: 'Mana 4/4 · 0/60m', button: 'Meditating · Stand' });

  await stepTime(page, 30);
  await sendInput(page, 'move:right');
  await advanceFrames(page, 120);
  await stopMove(page);
  const stood = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    return { meditating: GameState.instance.meditating, practice: GameState.instance.vitality.mana.practice };
  });
  expect(stood.meditating).toBe(false);
  expect(stood.practice).toBeGreaterThanOrEqual(30); // progress already counted is kept

  const mend = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { VitalitySystem } = await import('/src/systems/VitalitySystem.ts');
    const gs = GameState.instance;
    gs.player.stamina = 100;
    const full = VitalitySystem.castMend();
    gs.player.stamina = 50;
    const cast = VitalitySystem.castMend();
    const after = { stamina: gs.player.stamina, current: gs.vitality.mana.current };
    gs.vitality.mana.current = 0;
    const empty = VitalitySystem.castMend();
    return { full, cast, after, empty, staminaAfterEmpty: gs.player.stamina };
  });
  expect(mend.full).toEqual({ ok: false, message: 'You are full of energy already.' });
  expect(mend.cast).toEqual({ ok: true, message: 'Mend · +10 stamina · 3/4 mana' });
  expect(mend.after).toEqual({ stamina: 60, current: 3 });
  expect(mend.empty.ok).toBe(false);
  expect(mend.staminaAfterEmpty).toBe(60);

  await sleepInGame(page);
  const slept = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { VitalitySystem } = await import('/src/systems/VitalitySystem.ts');
    const gs = GameState.instance;
    const refilled = gs.vitality.mana.current;
    gs.vitality.mana = { current: 30, max: 30, practice: 0 };
    VitalitySystem.startMeditating();
    VitalitySystem.meditate(120);
    const capped = { ...gs.vitality.mana };
    VitalitySystem.stopMeditating();
    let twice = '';
    try { VitalitySystem.learnMana(); } catch (error) { twice = String(error); }
    return { refilled, capped, twice };
  });
  expect(slept.refilled).toBe(4);
  expect(slept.capped).toEqual({ current: 30, max: 30, practice: 0 });
  expect(slept.twice).toContain('already knows mana');
});

test('save version 23 keeps the offer record; version 22 migrates to none; damaged records fail loudly', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite browser module.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const gs = GameState.instance;
    gs.day = 4;
    gs.residentOffers = { lastDay: { 'show-magic': 4, 'teach-mana': 2 } };
    gs.meditating = true;
    SaveSystem.save(1, 1);
    const saved = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    gs.meditating = false;
    const kept = SaveSystem.load(1).residentOffers;
    const old = JSON.parse(JSON.stringify(saved.state)) as Record<string, unknown>;
    delete old.residentOffers;
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 22, slot: 2, savedAt: 1, state: old }));
    const migrated = SaveSystem.load(2).residentOffers;
    const notice = SaveSystem.consumeMigrationNotice();
    const bad = [
      { lastDay: { 'free-gold': 1 } },
      { lastDay: { 'show-magic': 5 } },
      { lastDay: { 'show-magic': 0 } },
      { lastDay: {}, extra: true },
      { lastDay: [] },
    ];
    const errors = bad.map(residentOffers => {
      try { GameState.candidateFromSaveData({ ...saved.state, residentOffers }, SAVE_VERSION); return null; } catch (error) { return String(error); }
    });
    let missing = '';
    try { GameState.candidateFromSaveData(old, SAVE_VERSION); } catch (error) { missing = String(error); }
    return { version: saved.version, savedOffers: saved.state.residentOffers, meditatingSaved: 'meditating' in saved.state,
      kept, migrated, notice, errors, missing };
  });
  expect(result.version).toBe(30);
  expect(result.savedOffers).toEqual({ lastDay: { 'teach-mana': 2, 'show-magic': 4 } });
  expect(result.meditatingSaved).toBe(false);
  expect(result.kept).toEqual(result.savedOffers);
  expect(result.migrated).toEqual({ lastDay: {} });
  expect(result.notice).toContain('Neighbors who like how you talk');
  expect(result.errors.every(error => error !== null && error.includes('residentOffers'))).toBe(true);
  expect(result.missing).toContain('residentOffers');
});
