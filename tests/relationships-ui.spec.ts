/** Town Bonds and face-to-face resident dialogue behavior with responsive visual evidence. */
import { expect, test } from '@playwright/test';
import { bootGame, getState, uiCanvasPoint } from './helpers/gameHarness';

/** Click one named UI control through the scaled Phaser canvas. */
async function clickControl(page: import('@playwright/test').Page, name: string): Promise<void> {
  const center = await page.evaluate(name => {
    type Node = { name: string; visible: boolean; list?: Node[]; getBounds(): { centerX: number; centerY: number } };
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const walk = (node: Node): Node | null => {
      if (node.name === name && node.visible) return node;
      for (const child of node.list ?? []) { const found = walk(child); if (found) return found; }
      return null;
    };
    for (const child of scene.children.list as unknown as Node[]) {
      const found = walk(child); if (found) { const bounds = found.getBounds(); return { x: bounds.centerX, y: bounds.centerY }; }
    }
    throw new Error(`Missing visible control ${name}`);
  }, name);
  const point = await uiCanvasPoint(page, center);
  await page.mouse.click(point.x, point.y);
}

test('Town Bonds shows base resident portraits and keeps message entry out of the menu', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { syncTownSocialLife } = await import('/src/systems/TownSocialLifeSystem.ts');
    SettingsSystem.update({ localNpcChat: false });
    syncTownSocialLife(1, 1440);
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.screenshot({ path: testInfo.outputPath('pause-daybook-1280.png') });
  await clickControl(page, 'pause-relationships');
  await expect.poll(async () => (await getState(page)).relationshipJournalOpen).toBe(true);
  const details = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const portrait = root.getByName('relationship-portrait') as Phaser.GameObjects.Sprite;
    const allText: string[] = [];
    const walk = (node: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      if (node instanceof Phaser.GameObjects.Text) allText.push(node.text);
      for (const child of node.list ?? []) walk(child as typeof node);
    };
    walk(root as typeof root & { list?: Phaser.GameObjects.GameObject[] });
    return { texture: portrait.texture.key, text: allText.join('\n'),
      hasDraft: Boolean(root.getByName('relationship-chat-draft')), hasOutput: Boolean(root.getByName('relationship-chat-output')) };
  });
  expect(details.texture).toBe('town-resident-nyra');
  expect(details.hasDraft).toBe(false); expect(details.hasOutput).toBe(false);
  expect(details.text).toContain('Authored Talk still works'); expect(details.text).not.toContain('Gift tastes');
  const profileBounds = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const root = scene.children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const ui = (scene as Phaser.Scene & { relationshipUI: { selectedIndex: number; refresh(): void } }).relationshipUI;
    return TOWN_RESIDENTS.map((resident: { id: string }, index: number) => {
      ui.selectedIndex = index;
      ui.refresh();
      const bounds = (name: string): { left: number; right: number; top: number; bottom: number } => {
        const value = (root.getByName(name) as Phaser.GameObjects.Text).getBounds();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
      };
      return { id: resident.id, name: bounds('relationship-name'), hearts: bounds('relationship-hearts'),
        traits: bounds('relationship-traits'), bio: bounds('relationship-bio'), status: bounds('relationship-status'),
        chat: bounds('relationship-chat-info'), interest: bounds('relationship-interest') };
    });
  });
  expect(profileBounds).toHaveLength(12);
  for (const profile of profileBounds) {
    expect(profile.name.right, profile.id).toBeLessThanOrEqual(755);
    expect(profile.name.bottom, profile.id).toBeLessThanOrEqual(profile.hearts.top);
    expect(profile.hearts.bottom, profile.id).toBeLessThanOrEqual(profile.traits.top);
    expect(profile.traits.bottom, profile.id).toBeLessThanOrEqual(profile.bio.top);
    expect(profile.bio.right, profile.id).toBeLessThanOrEqual(755);
    expect(profile.bio.bottom, profile.id).toBeLessThanOrEqual(profile.status.top);
    expect(profile.status.bottom, profile.id).toBeLessThanOrEqual(profile.interest.top);
    expect(profile.chat.bottom, profile.id).toBeLessThanOrEqual(490);
  }
  await clickControl(page, 'relationship-resident-tessa');
  expect(await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    return (root.getByName('relationship-name') as Phaser.GameObjects.Text).text;
  })).toBe('Tessa');
  await page.waitForTimeout(180);
  await page.screenshot({ path: testInfo.outputPath('bonds-hd-portrait-1280.png') });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: testInfo.outputPath('bonds-hd-portrait-800.png') });
  await clickControl(page, 'relationship-connections');
  const connections = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const connectionsPage = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
    const descendants: Phaser.GameObjects.GameObject[] = [];
    const walk = (node: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      descendants.push(node);
      for (const child of node.list ?? []) walk(child as typeof node);
    };
    walk(connectionsPage);
    const named = (name: string): Phaser.GameObjects.GameObject => {
      const match = descendants.find(child => child.name === name);
      if (!match) throw new Error(`Missing connection control ${name}`);
      return match;
    };
    return { visible: connectionsPage.visible,
      pairs: descendants.filter(child => child.name.startsWith('connection-pair-')).length,
      names: (named('connection-names') as Phaser.GameObjects.Text).text,
      stage: (named('connection-stage') as Phaser.GameObjects.Text).text,
      transcript: (named('connection-transcript') as Phaser.GameObjects.Text).text };
  });
  expect(connections.visible).toBe(true); expect(connections.pairs).toBe(11);
  expect(connections.names).toContain('Tessa');
  expect(['STRANGERS', 'ACQUAINTANCES']).toContain(connections.stage);
  await clickControl(page, 'connection-pair-tessa-bram');
  expect(await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const connectionsPage = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
    const detail = connectionsPage.list.flatMap(child => child instanceof Phaser.GameObjects.Container ? child.list : [child]);
    return (detail.find(child => child.name === 'connection-names') as Phaser.GameObjects.Text).text;
  })).toBe('Tessa & Bram');
  await page.screenshot({ path: testInfo.outputPath('town-connections-800.png') });
  if (process.env.TOWN_SOCIAL_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TOWN_SOCIAL_EVIDENCE_DIR}/town-connections-800.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('town-connections-1280.png') });
  if (process.env.TOWN_SOCIAL_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TOWN_SOCIAL_EVIDENCE_DIR}/town-connections-1280.png` });
  }
  await clickControl(page, 'connection-profiles');
  await clickControl(page, 'relationship-local-chat');
  expect(await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    return (await import('/src/systems/SettingsSystem.ts')).SettingsSystem.get().localNpcChat;
  })).toBe(true);
});

test('direct resident choice supports authored Talk and guarded typed Chat in the bottom panel', async ({ page }, testInfo) => {
  await bootGame(page);
  const before = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    SettingsSystem.update({ localNpcChat: true });
    const requests: unknown[] = [];
    (window as unknown as { __CHAT_REQUESTS__: unknown[] }).__CHAT_REQUESTS__ = requests;
    window.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const reply = requests.length === 1
        ? 'The kettle agrees. It rarely agrees this quickly.'
        : 'I remember. You asked what I thought of your shop, and I still think its warm shelves suit you. Add one bright blue sign near the door, and even hurried travelers will know they have found somewhere worth lingering.';
      return new Response(JSON.stringify({ reply, outcome: 'continue', intimateTopic: false, offer: 'none' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const gs = GameState.instance;
    const protectedState = JSON.stringify({ relationships: gs.relationships, inventory: gs.inventory, gold: gs.gold });
    openResidentDialogue('nyra');
    return protectedState;
  });
  await expect.poll(async () => (await getState(page)).dialogue?.kind).toBe('resident-choice');
  await page.keyboard.press('ArrowRight');
  expect((await getState(page)).dialogue?.choice).toBe('chat');
  await page.keyboard.press('Enter');
  await page.keyboard.type('What do you think of my shop?');
  expect((await getState(page)).dialogue?.draft).toBe('What do you think of my shop?');
  await page.screenshot({ path: testInfo.outputPath('resident-chat-typing.png') });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).dialogue?.chatPhase).toBe('reply');
  expect((await getState(page)).dialogue?.line).toContain('kettle agrees');
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    const box = window.__GAME__!.scene.getScene('UIScene').children.getByName('dialogue-box') as Phaser.GameObjects.Container;
    const portrait = box.getByName('dialogue-portrait') as Phaser.GameObjects.Sprite;
    // why: the base resident frame is 96x64 with see-through padding, so at 4x its frame box reaches past the
    // screen while the drawn character stays inside its card. Measure the visible panels without the portrait.
    const panels = box.list.filter(child => child !== portrait && (child as Phaser.GameObjects.Image).visible
      && 'getBounds' in child) as Phaser.GameObjects.Image[];
    const left = Math.min(...panels.map(child => child.getBounds().left));
    const right = Math.max(...panels.map(child => child.getBounds().right));
    return { protectedState: JSON.stringify({ relationships: GameState.instance.relationships,
      inventory: GameState.instance.inventory, gold: GameState.instance.gold }), portrait: portrait.texture.key,
      bounds: { left, right }, portraitAt: { x: portrait.x, y: portrait.y } };
  });
  // A good local reply adds one small, capped friendship gain (TownLifeSystem.grantChatFriendship) and nothing else.
  const expected = JSON.parse(before) as { relationships: { residents: Record<string, { points: number }> } };
  expected.relationships.residents.nyra.points += 5;
  expect(result.protectedState).toBe(JSON.stringify(expected)); expect(result.portrait).toBe('town-resident-nyra');
  expect(result.bounds.left).toBeGreaterThanOrEqual(0); expect(result.bounds.right).toBeLessThanOrEqual(960);
  // The portrait stays centred on its card (UIScene dialoguePortraitMat at 116, 122).
  expect(result.portraitAt).toEqual({ x: 116, y: 121 });
  await page.screenshot({ path: testInfo.outputPath('resident-chat-reply.png') });
  await page.keyboard.press('Enter');
  expect((await getState(page)).dialogue?.chatPhase).toBe('input');
  await page.keyboard.type('Do you remember what I just asked?');
  expect((await getState(page)).dialogue?.draft).toBe('Do you remember what I just asked?');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await getState(page)).dialogue?.chatPhase).toBe('reply');
  const remembered = await page.evaluate(() => ({
    requests: (window as unknown as { __CHAT_REQUESTS__: Array<{ history: unknown[] }> }).__CHAT_REQUESTS__,
    dialogue: window.__TEST__!.state().dialogue,
    lineBounds: (() => {
      const box = window.__GAME__!.scene.getScene('UIScene').children.getByName('dialogue-box') as Phaser.GameObjects.Container;
      const line = box.getByName('dialogue-line') as Phaser.GameObjects.Text;
      const bounds = line.getBounds();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    })(),
  }));
  expect(remembered.requests[1].history).toEqual([
    { role: 'player', text: 'What do you think of my shop?' },
    { role: 'resident', text: 'The kettle agrees. It rarely agrees this quickly.' },
  ]);
  expect(remembered.dialogue?.line).toContain('I remember');
  expect(remembered.dialogue?.history).toHaveLength(4);
  expect(remembered.lineBounds.right).toBeLessThanOrEqual(890);
  expect(remembered.lineBounds.bottom).toBeLessThanOrEqual(492);
  await page.screenshot({ path: testInfo.outputPath('resident-chat-remembers.png') });
  await page.keyboard.press('Escape');
  expect((await getState(page)).dialogue).toBeNull();

  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { openResidentDialogue } = await import('/src/systems/ResidentDialogueSystem.ts');
    openResidentDialogue('nyra');
  });
  await page.keyboard.press('Enter');
  expect((await getState(page)).dialogue?.kind).toBe('message');
  // Talk adds 20; the two good chat replies above added 5 each (under the daily chat cap of 15).
  expect((await getState(page)).relationships.residents.nyra.points).toBe(30);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await getState(page)).dialogue).toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  await page.waitForTimeout(180);
  await clickControl(page, 'pause-relationships');
  await expect.poll(async () => (await getState(page)).relationshipJournalOpen).toBe(true);
  await page.waitForTimeout(180);
  await clickControl(page, 'relationship-chat-log');
  const notes = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const chatNotes = root.getByName('relationship-chat-notes') as Phaser.GameObjects.Container;
    return {
      transcript: (chatNotes.getByName('relationship-chat-transcript') as Phaser.GameObjects.Text).text,
      visible: chatNotes.visible,
    };
  });
  expect(notes.visible).toBe(true);
  expect(notes.transcript).toContain('Do you remember what I just asked?');
  expect(notes.transcript).toContain('I remember');
  await page.waitForTimeout(180);
  await page.screenshot({ path: testInfo.outputPath('resident-chat-notes.png') });
  await page.evaluate(() => {
    window.fetch = (async () => new Response(JSON.stringify({ summary:
      'The player asked for Nyra’s opinion about the shop, and Nyra suggested a bright blue sign near the door.' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  });
  await clickControl(page, 'relationship-chat-compact');
  await expect.poll(async () => page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const chatNotes = root.getByName('relationship-chat-notes') as Phaser.GameObjects.Container;
    return (chatNotes.getByName('relationship-chat-summary') as Phaser.GameObjects.Text).text;
  })).toContain('bright blue sign');
  await page.screenshot({ path: testInfo.outputPath('resident-chat-compacted.png') });
  const chatDeleteState = () => page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentChatNotes } = await import('/src/systems/ResidentChatMemorySystem.ts');
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const notesRoot = root.getByName('relationship-chat-notes') as Phaser.GameObjects.Container;
    return {
      notes: residentChatNotes('nyra'),
      clearLabel: (notesRoot.getByName('relationship-chat-clear-summary-label') as Phaser.GameObjects.Text).text,
      deleteLabel: (notesRoot.getByName('relationship-chat-delete-exchange-label') as Phaser.GameObjects.Text).text,
      page: (notesRoot.getByName('relationship-chat-transcript') as Phaser.GameObjects.Text).text,
    };
  });
  await clickControl(page, 'relationship-chat-delete-exchange');
  expect((await chatDeleteState()).deleteLabel).toBe('CONFIRM DELETE');
  expect((await chatDeleteState()).notes.turns).toHaveLength(4);
  await clickControl(page, 'relationship-chat-older');
  expect((await chatDeleteState()).deleteLabel).toBe('DELETE CHAT');
  await clickControl(page, 'relationship-chat-newer');
  await clickControl(page, 'relationship-chat-delete-exchange');
  await clickControl(page, 'relationship-chat-delete-exchange');
  expect((await chatDeleteState()).notes.turns).toHaveLength(2);
  await clickControl(page, 'relationship-chat-clear-summary');
  expect((await chatDeleteState()).clearLabel).toBe('CONFIRM CLEAR');
  expect((await chatDeleteState()).notes.summary).toContain('bright blue sign');
  await clickControl(page, 'relationship-chat-clear-summary');
  const deleted = await chatDeleteState();
  expect(deleted.notes.summary).toBe(''); expect(deleted.notes.turns).toHaveLength(2);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: testInfo.outputPath('resident-chat-deleted-800.png') });
  if (process.env.TOWN_SOCIAL_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TOWN_SOCIAL_EVIDENCE_DIR}/resident-chat-deleted-800.png` });
  }
});

test('maximum player and resident dialogue lines stay separated at both browser sizes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootGame(page);
  const source = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    const playerLine = 'player detail '.repeat(10).slice(0, 120).trim();
    const residentLine = 'resident answer with a remembered detail '.repeat(10).slice(0, 320).trim();
    GameState.instance.dialogue = { kind: 'resident-chat', name: 'Nyra', residentId: 'nyra', chatPhase: 'reply',
      playerLine, line: residentLine, history: [], memorySummary: '' };
    return { playerLine, residentLine };
  });
  const readLayout = async () => page.evaluate(() => {
    const box = window.__GAME__!.scene.getScene('UIScene').children.getByName('dialogue-box') as Phaser.GameObjects.Container;
    const read = (name: string): { text: string; fontSize: string; left: number; right: number; top: number; bottom: number } => {
      const item = box.getByName(name) as Phaser.GameObjects.Text;
      const bounds = item.getBounds();
      return { text: item.text, fontSize: String(item.style.fontSize), left: bounds.left, right: bounds.right,
        top: bounds.top, bottom: bounds.bottom };
    };
    const boxBounds = box.getBounds();
    return { player: read('dialogue-player-line'), resident: read('dialogue-line'), hint: read('dialogue-hint'),
      box: { left: boxBounds.left, right: boxBounds.right, top: boxBounds.top, bottom: boxBounds.bottom } };
  });
  for (const viewport of [{ width: 1280, height: 720, file: 'dialogue-max-1280.png' },
    { width: 800, height: 600, file: 'dialogue-max-800.png' }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(120);
    const layout = await readLayout();
    expect(layout.player.text.replace(/\s+/g, ' ')).toContain(source.playerLine);
    expect(layout.resident.text.replace(/\s+/g, ' ')).toBe(source.residentLine);
    expect(Number.parseInt(layout.resident.fontSize, 10)).toBeGreaterThanOrEqual(10);
    expect(layout.player.bottom).toBeLessThanOrEqual(layout.resident.top - 4);
    expect(layout.resident.bottom).toBeLessThanOrEqual(layout.hint.top - 4);
    expect(layout.player.left).toBeGreaterThanOrEqual(layout.box.left);
    expect(layout.resident.right).toBeLessThanOrEqual(layout.box.right - 20);
    expect(layout.hint.bottom).toBeLessThanOrEqual(layout.box.bottom);
    await page.screenshot({ path: testInfo.outputPath(viewport.file) });
  }
});

test('long bond notes stay readable through pointer, wheel, and keyboard pages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { residentChatNotesStorageKey } = await import('/src/systems/ResidentChatStorage.ts');
    const summary = 'memory '.repeat(85).trim();
    const player = 'player question '.repeat(7).trim();
    const reply = 'resident answer with remembered detail '.repeat(8).trim();
    localStorage.setItem(residentChatNotesStorageKey('unslotted'), JSON.stringify({
      version: 1,
      residents: { nyra: { summary, turns: [
        { role: 'player', text: 'An older short question.' },
        { role: 'resident', text: 'An older short answer.' },
        { role: 'player', text: player },
        { role: 'resident', text: reply },
      ] } },
    }));
    const ui = (window.__GAME__!.scene.getScene('UIScene') as Phaser.Scene & {
      relationshipUI: { open(): void };
    }).relationshipUI;
    ui.open();
  });
  await clickControl(page, 'relationship-chat-log');
  const pages = async () => page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const notes = root.getByName('relationship-chat-notes') as Phaser.GameObjects.Container;
    return {
      summary: (notes.getByName('relationship-chat-summary-page') as Phaser.GameObjects.Text).text,
      transcript: (notes.getByName('relationship-chat-transcript-page') as Phaser.GameObjects.Text).text,
      transcriptText: (notes.getByName('relationship-chat-transcript') as Phaser.GameObjects.Text).text,
    };
  });
  expect((await pages()).summary).toMatch(/^1 \/ [2-9]/);
  expect((await pages()).transcript).toMatch(/^1 \/ [2-9]/);

  const summaryCount = Number((await pages()).summary.split(' / ')[1]);
  for (let expected = 2; expected <= summaryCount; expected++) {
    await clickControl(page, 'relationship-chat-summary-next-page');
    expect((await pages()).summary).toBe(`${expected} / ${summaryCount}`);
  }
  for (let expected = summaryCount - 1; expected >= 1; expected--) {
    await clickControl(page, 'relationship-chat-summary-previous-page');
    expect((await pages()).summary).toBe(`${expected} / ${summaryCount}`);
  }
  const transcriptCount = Number((await pages()).transcript.split(' / ')[1]);
  for (let expected = 2; expected <= transcriptCount; expected++) {
    await clickControl(page, 'relationship-chat-transcript-next-page');
    expect((await pages()).transcript).toBe(`${expected} / ${transcriptCount}`);
  }
  for (let expected = transcriptCount - 1; expected >= 1; expected--) {
    await clickControl(page, 'relationship-chat-transcript-previous-page');
    expect((await pages()).transcript).toBe(`${expected} / ${transcriptCount}`);
  }
  const transcriptPoint = await uiCanvasPoint(page, { x: 700, y: 310 });
  await page.mouse.move(transcriptPoint.x, transcriptPoint.y);
  await page.mouse.wheel(0, 200);
  expect((await pages()).transcript).toMatch(/^2 \/ [2-9]/);
  await page.keyboard.press('ArrowDown');
  expect(Number((await pages()).transcript.split(' / ')[0])).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Shift+ArrowDown');
  expect((await pages()).summary).toMatch(/^2 \/ [2-9]/);
  await page.keyboard.press('ArrowLeft');
  expect((await pages()).transcript).toMatch(/^1 \/ 1$/);
  expect((await pages()).transcriptText).toContain('older short question');

  await page.screenshot({ path: testInfo.outputPath('long-chat-notes-1280.png') });
  await page.setViewportSize({ width: 800, height: 600 });
  const bounds = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const notes = root.getByName('relationship-chat-notes') as Phaser.GameObjects.Container;
    const names = ['relationship-chat-summary', 'relationship-chat-transcript',
      'relationship-chat-summary-previous-page', 'relationship-chat-summary-next-page',
      'relationship-chat-transcript-previous-page', 'relationship-chat-transcript-next-page'];
    return names.map(name => {
      const item = notes.getByName(name) as Phaser.GameObjects.GameObject & { getBounds(): Phaser.Geom.Rectangle };
      const value = item.getBounds();
      return { name, left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    });
  });
  for (const item of bounds) {
    expect(item.left, item.name).toBeGreaterThanOrEqual(508);
    expect(item.right, item.name).toBeLessThanOrEqual(880);
    expect(item.top, item.name).toBeGreaterThanOrEqual(109);
    expect(item.bottom, item.name).toBeLessThanOrEqual(395);
  }
  await page.screenshot({ path: testInfo.outputPath('long-chat-notes-800.png') });

  await clickControl(page, 'relationship-chat-profile');
  const targetBond = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { syncTownSocialLife } = await import('/src/systems/TownSocialLifeSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { townSocialNotesStorageKey } = await import('/src/systems/TownSocialStorage.ts');
    syncTownSocialLife(1, 1440);
    const key = townSocialNotesStorageKey('unslotted');
    const store = JSON.parse(localStorage.getItem(key)!) as { events: Array<{
      bondId: string; lines: Array<{ residentId: string; text: string }>;
    }> };
    const event = store.events.find(value => value.bondId.includes('nyra'));
    if (!event) throw new Error('Test fixture expected one Nyra social event');
    event.lines[0].text = 'First remembered town detail '.repeat(6).trim();
    event.lines[1].text = 'Second remembered town detail '.repeat(6).trim();
    localStorage.setItem(key, JSON.stringify(store));
    return event.bondId;
  });
  await clickControl(page, 'relationship-connections');
  await clickControl(page, `connection-pair-${targetBond}`);
  const connection = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const connections = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
    const descendants: Phaser.GameObjects.GameObject[] = [];
    const walk = (node: Phaser.GameObjects.GameObject & { list?: Phaser.GameObjects.GameObject[] }): void => {
      descendants.push(node);
      for (const child of node.list ?? []) walk(child as typeof node);
    };
    walk(connections);
    const statuses = descendants.filter(child => child.name.startsWith('connection-row-status-')) as Phaser.GameObjects.Text[];
    return {
      page: (connections.getByName('connection-transcript-page') as Phaser.GameObjects.Text).text,
      statusRights: statuses.map(status => status.getBounds().right),
    };
  });
  expect(connection.page).toMatch(/^1 \/ [2-9]/);
  expect(connection.statusRights).toHaveLength(11);
  for (const right of connection.statusRights) expect(right).toBeLessThanOrEqual(425);
  const connectionCount = Number(connection.page.split(' / ')[1]);
  for (let expected = 2; expected <= connectionCount; expected++) {
    await clickControl(page, 'connection-transcript-next-page');
    const current = await page.evaluate(() => {
      const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
      const connections = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
      return (connections.getByName('connection-transcript-page') as Phaser.GameObjects.Text).text;
    });
    expect(current).toBe(`${expected} / ${connectionCount}`);
  }
  for (let expected = connectionCount - 1; expected >= 1; expected--) {
    await clickControl(page, 'connection-transcript-previous-page');
    const current = await page.evaluate(() => {
      const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
      const connections = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
      return (connections.getByName('connection-transcript-page') as Phaser.GameObjects.Text).text;
    });
    expect(current).toBe(`${expected} / ${connectionCount}`);
  }
  await page.keyboard.press('PageDown');
  expect(await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('relationship-journal') as Phaser.GameObjects.Container;
    const connections = root.getByName('relationship-connections-page') as Phaser.GameObjects.Container;
    return (connections.getByName('connection-transcript-page') as Phaser.GameObjects.Text).text;
  })).toMatch(/^2 \/ [2-9]/);
  await page.screenshot({ path: testInfo.outputPath('long-town-moment-800.png') });
});
