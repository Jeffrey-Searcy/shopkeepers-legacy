/**
 * ResidentOfferState — the saved record of which resident chat offers the keeper already received
 * (save version 23+).
 *
 * This module is pure data: create, copy, and validate. ResidentOfferSystem owns every rule that
 * reads or changes it. Keeping them apart lets GameState import the record without importing the
 * runtime system (which imports GameState).
 *
 * Data shape:
 *  - lastDay: offer id → the game day the keeper last accepted that offer. A missing id means never.
 *    'daily' offers compare it with today; 'once' offers are gated by their own effect state (for
 *    example, mana is no longer null), and the day is kept as a record.
 *
 * A damaged record fails loudly. Nothing is defaulted or repaired.
 */
import { CHAT_OFFER_IDS, isChatOfferId, type ChatOfferId } from '../config/ResidentChatOffers';

/** Complete saved offer record. */
export interface ResidentOfferState {
  lastDay: Partial<Record<ChatOfferId, number>>;
}

/** A new game's record, and the record for a version-22-or-older save: nothing received yet. */
export function createResidentOfferState(): ResidentOfferState {
  return { lastDay: {} };
}

/** Deep copy so snapshots and saves never share objects with live state. */
export function cloneResidentOfferState(state: ResidentOfferState): ResidentOfferState {
  return { lastDay: { ...state.lastDay } };
}

/**
 * Validate and detach a saved offer record.
 * @param value raw saved `residentOffers`
 * @param day the save's current day (no offer can be received after it)
 * @throws when the shape is wrong, an id is unknown, or a day is out of range
 */
export function validateResidentOfferState(value: unknown, day: number): ResidentOfferState {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'lastDay') {
    throw new Error('GameState save: "residentOffers" must have exactly lastDay');
  }
  const raw = (value as { lastDay: unknown }).lastDay;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GameState save: "residentOffers.lastDay" must be an object');
  const lastDay: Partial<Record<ChatOfferId, number>> = {};
  for (const [id, received] of Object.entries(raw as Record<string, unknown>)) {
    if (!isChatOfferId(id)) throw new Error(`GameState save: "residentOffers.lastDay.${id}" is not a known offer`);
    if (typeof received !== 'number' || !Number.isSafeInteger(received) || received < 1 || received > day) {
      throw new Error(`GameState save: "residentOffers.lastDay.${id}" is invalid`);
    }
    lastDay[id] = received;
  }
  // why: rebuild in catalog order so a saved file's key order never changes later save bytes.
  return { lastDay: Object.fromEntries(CHAT_OFFER_IDS.filter(id => lastDay[id] !== undefined).map(id => [id, lastDay[id]])) };
}
