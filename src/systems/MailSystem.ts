/**
 * MailSystem — owns the farm mailbox: which letters have arrived, which are read, and opening one.
 *
 * Lifecycle:
 *  1. A new game starts with an empty mailbox; `deliverMail` runs at once so day-1 mail is waiting.
 *  2. Every morning (BaseWorldScene.sleep) `deliverMail` adds each letter whose trigger now holds.
 *  3. Pressing E at the mailbox calls `openNextLetter`: the oldest unread letter moves to `read`,
 *     its enclosed gift (if any) goes into the bag, and the caller shows it in the dialogue box.
 *
 * MailState is part of the durable save (version 17+). Letter text lives in config/Letters.ts.
 */
import { LETTERS, letterById, type LetterDef } from '../config/Letters';

/**
 * Saved mailbox contents.
 *  inbox  ids delivered but not yet read, oldest first (the mailbox flag shows while non-empty)
 *  read   ids already opened; a letter is never delivered twice
 */
export interface MailState {
  inbox: string[];
  read: string[];
}

/** The slice of game progress that letter triggers read. Kept small so tests can build it by hand. */
export interface MailProgress {
  day: number;
  /** Tavern level; 1 or more means the inherited shop is restored. */
  shopLevel: number;
  /** Whole friendship hearts per resident id. Must list every resident a letter waits on. */
  hearts: Readonly<Record<string, number>>;
}

/** A fresh, empty mailbox for a new game (deliverMail fills day-1 mail right after). */
export function createMailState(): MailState {
  return { inbox: [], read: [] };
}

/** Detached copy for serialize/save so callers can never mutate live mail by accident. */
export function cloneMailState(mail: MailState): MailState {
  return { inbox: [...mail.inbox], read: [...mail.read] };
}

/**
 * Validate unknown saved mail. Unknown fields, unknown letter ids or a letter in both lists mean
 * the save is damaged, so this throws instead of guessing.
 */
export function validateMailState(value: unknown): MailState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mail save must be an object');
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(',') !== 'inbox,read') throw new Error('Mail save has unknown or missing fields');
  const list = (raw: unknown, label: string): string[] => {
    if (!Array.isArray(raw)) throw new Error(`Mail save ${label} must be an array`);
    return raw.map((id, index) => {
      if (typeof id !== 'string') throw new Error(`Mail save ${label}.${index} must be a letter id`);
      letterById(id);
      return id;
    });
  };
  const inbox = list(root.inbox, 'inbox');
  const read = list(root.read, 'read');
  const all = [...inbox, ...read];
  if (new Set(all).size !== all.length) throw new Error('Mail save lists a letter more than once');
  return { inbox, read };
}

/**
 * Mail for a save written before the mailbox existed (version 16 and older). Letters whose day
 * has already passed are marked read so an old day-30 save is not buried under week-one mail;
 * only letters due on the save's current day (or later) can still arrive.
 */
export function migratePreMailState(currentDay: number): MailState {
  // why: friendship letters are not dated; an old save that already has the hearts should still
  // receive them, so they are never pre-marked read.
  return { inbox: [], read: LETTERS.filter(letter => !letter.trigger.hearts && letter.trigger.day < currentDay).map(letter => letter.id) };
}

/**
 * True when a letter's trigger holds for this progress.
 * @throws when a friendship letter's resident is missing from progress.hearts (a caller bug)
 */
function triggered(letter: LetterDef, progress: MailProgress): boolean {
  if (progress.day < letter.trigger.day) return false;
  if (letter.trigger.shopRestored && progress.shopLevel < 1) return false;
  const milestone = letter.trigger.hearts;
  if (milestone) {
    const hearts = progress.hearts[milestone.resident];
    if (hearts === undefined) throw new Error(`MailSystem: no heart count for ${milestone.resident}`);
    if (hearts < milestone.atLeast) return false;
  }
  return true;
}

/**
 * Deliver every letter that is due and not yet delivered or read.
 * @param mail     live mailbox, mutated in place
 * @param progress current day and shop progress
 * @returns the letters that arrived now (empty when nothing new), in authored order
 */
export function deliverMail(mail: MailState, progress: MailProgress): LetterDef[] {
  const known = new Set([...mail.inbox, ...mail.read]);
  const arrived = LETTERS.filter(letter => !known.has(letter.id) && triggered(letter, progress));
  for (const letter of arrived) mail.inbox.push(letter.id);
  return arrived;
}

/** Result of opening the mailbox. */
export type OpenLetterResult =
  | { kind: 'empty' }
  | { kind: 'bag-full'; letter: LetterDef }
  | { kind: 'opened'; letter: LetterDef };

/**
 * Open the oldest unread letter.
 * @param mail    live mailbox, mutated only when the letter is really opened
 * @param addItem grants the enclosed gift; returns false when the bag has no room
 * @returns 'empty' with no mail; 'bag-full' leaves the letter unread so the gift is never lost;
 *          'opened' after moving it to `read` and granting its gift
 */
export function openNextLetter(mail: MailState, addItem: (item: string, qty: number) => boolean): OpenLetterResult {
  const id = mail.inbox[0];
  if (id === undefined) return { kind: 'empty' };
  const letter = letterById(id);
  if (letter.gift && !addItem(letter.gift.item, letter.gift.qty)) return { kind: 'bag-full', letter };
  mail.inbox.shift();
  mail.read.push(id);
  return { kind: 'opened', letter };
}
