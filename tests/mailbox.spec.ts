/**
 * Mailbox proofs: authored letters validate, mail arrives by date and shop progress, reading grants
 * enclosed gifts exactly once (never lost to a full bag), the farm mailbox works through real E
 * input, and version-16 saves migrate without burying old games under week-one mail.
 */
import { expect, test } from '@playwright/test';
import { act, bootGame, getState, sleepInGame, teleport } from './helpers/gameHarness';

test('mail arrives by date and shop progress, and gifts are granted once without loss', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const mail = await import('/src/systems/MailSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    const fresh = GameState.instance.mail.inbox.slice();
    // No friendship yet: every resident at zero hearts.
    const hearts = GameState.instance.mailProgress().hearts;
    const box = mail.createMailState();
    const day2 = mail.deliverMail(box, { day: 2, shopLevel: 0, hearts }).map((letter: { id: string }) => letter.id);
    const again = mail.deliverMail(box, { day: 2, shopLevel: 0, hearts }).length;
    const restored = mail.deliverMail(box, { day: 2, shopLevel: 1, hearts }).map((letter: { id: string }) => letter.id);
    // Three hearts with Kit brings the 3-heart letter (and its recipe), not the 7-heart one.
    const kitThree = mail.deliverMail(box, { day: 2, shopLevel: 1, hearts: { ...hearts, kit: 3 } }).map((letter: { id: string }) => letter.id);
    let missingHearts = '';
    try { mail.deliverMail(mail.createMailState(), { day: 2, shopLevel: 0, hearts: {} }); } catch (error) { missingHearts = String(error); }
    // A full bag keeps the gift letter unread; a later read grants it once.
    const giftBox = { inbox: ['kit-pond'], read: [] };
    const blocked = mail.openNextLetter(giftBox, () => false).kind;
    const blockedInbox = giftBox.inbox.slice();
    const granted: string[] = [];
    const opened = mail.openNextLetter(giftBox, (item: string, qty: number) => { granted.push(`${item}x${qty}`); return true; }).kind;
    const emptyAfter = mail.openNextLetter(giftBox, () => true).kind;
    let unknownError = '';
    try { mail.validateMailState({ inbox: ['not-a-letter'], read: [] }); } catch (error) { unknownError = String(error); }
    let duplicateError = '';
    try { mail.validateMailState({ inbox: ['kit-pond'], read: ['kit-pond'] }); } catch (error) { duplicateError = String(error); }
    return { fresh, day2, again, restored, kitThree, missingHearts, blocked, blockedInbox, opened, granted, read: giftBox.read, emptyAfter,
      unknownError, duplicateError, migrated: mail.migratePreMailState(5) };
  });
  expect(result.fresh).toEqual(['mayor-welcome']);
  expect(result.day2).toEqual(['mayor-welcome', 'kit-pond']);
  expect(result.again).toBe(0);
  expect(result.restored).toEqual(['julian-lights-on']);
  expect(result.kitThree).toEqual(['kit-hearts-3']);
  expect(result.missingHearts).toContain('no heart count');
  expect(result.blocked).toBe('bag-full');
  expect(result.blockedInbox).toEqual(['kit-pond']);
  expect(result.opened).toBe('opened');
  expect(result.granted).toEqual(['fish-sardinex2']);
  expect(result.read).toEqual(['kit-pond']);
  expect(result.emptyAfter).toBe('empty');
  expect(result.unknownError).toContain('unknown letter');
  expect(result.duplicateError).toContain('more than once');
  // Day-5 save: letters due on days 1-4 count as read; day 5 and later can still arrive.
  expect(result.migrated.inbox).toEqual([]);
  expect(result.migrated.read).toEqual(['mayor-welcome', 'kit-pond', 'bram-timber', 'tessa-potatoes', 'julian-lights-on']);
});

test('the farm mailbox flags new mail, reads it with E, and delivers the next morning', async ({ page }) => {
  await bootGame(page);
  // Stand just south of the mailbox, facing it.
  await teleport(page, 89, 27, 'up');
  const before = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('FarmScene');
    const box = scene.children.getByName('mailbox') as Phaser.GameObjects.Image | null;
    return { exists: box !== null, texture: box?.texture.key };
  });
  expect(before).toEqual({ exists: true, texture: 'farm-mailbox-flag' });
  await act(page, 'interact');
  const reading = await getState(page);
  expect(reading.dialogue?.name).toBe('Mayor Hollis — Welcome to Willowbrook');
  await act(page, 'interact'); // close the letter
  await act(page, 'interact'); // nothing left
  expect((await getState(page)).dialogue?.line).toBe('No new mail today.');
  await act(page, 'interact');
  const flagDown = await page.evaluate(() => {
    return (window.__GAME__!.scene.getScene('FarmScene').children.getByName('mailbox') as Phaser.GameObjects.Image).texture.key;
  });
  expect(flagDown).toBe('farm-mailbox');
  const sardinesBefore = (await getState(page)).inventory['fish-sardine'] ?? 0;
  await sleepInGame(page);
  const morning = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.mail.inbox.slice();
  });
  expect(morning).toEqual(['kit-pond']);
  await teleport(page, 89, 27, 'up');
  await act(page, 'interact');
  const kit = await getState(page);
  expect(kit.dialogue?.name).toBe('Kit — The pond is biting');
  expect(kit.inventory['fish-sardine']).toBe(sardinesBefore + 2);
});

test('version-16 saves load with a migrated mailbox and save as the current version', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const oldState = GameState.instance.toSaveData() as unknown as Record<string, unknown>;
    delete oldState.mail; oldState.day = 3;
    localStorage.setItem(SaveSystem.storageKey(1), JSON.stringify({ version: 16, slot: 1, savedAt: 1, state: oldState }));
    const loaded = SaveSystem.load(1);
    const notice = SaveSystem.consumeMigrationNotice();
    SaveSystem.save(1, 2);
    const saved = JSON.parse(localStorage.getItem(SaveSystem.storageKey(1))!);
    return { version: SAVE_VERSION, savedVersion: saved.version, mail: loaded.mail, savedMail: saved.state.mail, notice };
  });
  expect(result.version).toBe(30);
  expect(result.savedVersion).toBe(30);
  expect(result.mail).toEqual({ inbox: [], read: ['mayor-welcome', 'kit-pond', 'julian-lights-on'] });
  expect(result.savedMail).toEqual(result.mail);
  expect(result.notice).toContain('mailbox');
});
