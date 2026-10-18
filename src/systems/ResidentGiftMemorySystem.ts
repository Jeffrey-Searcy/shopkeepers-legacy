/**
 * ResidentGiftMemorySystem — verified, browser-local gift facts for local resident speech.
 *
 * RelationshipSystem remains the only owner of gift mechanics. This store records accepted gifts
 * after that transaction and exposes a small factual window that the speech model may reference.
 */
import { ITEM_CATALOG } from '../config/Items';
import { residentRelationshipProfile, type GiftTaste, type ResidentId } from '../config/ResidentRelationships';
import { SaveSystem } from './SaveSystem';
import { residentGiftMemoryStorageKey } from './ResidentChatStorage';

const MAX_GIFTS_PER_RESIDENT = 12;
const GIFT_TASTES: readonly GiftTaste[] = ['love', 'like', 'neutral', 'dislike', 'hate'];

/** One accepted gift fact. The display label derives from the authoritative item catalog. */
export interface ResidentGiftMemory {
  itemId: string;
  label: string;
  taste: GiftTaste;
  day: number;
}

interface StoredGift { itemId: string; taste: GiftTaste; day: number }
interface ResidentGiftStore { version: 1; residents: Partial<Record<ResidentId, StoredGift[]>> }

/** Bind optional speech memory to one active adventure. */
function storageKey(): string {
  return residentGiftMemoryStorageKey(SaveSystem.currentSlot() ?? 'unslotted');
}

/** Validate one stored accepted gift without repairing unknown items or fields. */
function storedGift(value: unknown, residentId: ResidentId, index: number): StoredGift {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Gift memory ${residentId}/${index} is invalid.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'day,itemId,taste' || typeof record.itemId !== 'string'
    || !Object.prototype.hasOwnProperty.call(ITEM_CATALOG, record.itemId) || !GIFT_TASTES.includes(record.taste as GiftTaste)
    || !Number.isSafeInteger(record.day) || (record.day as number) < 1) {
    throw new Error(`Gift memory ${residentId}/${index} is invalid.`);
  }
  return { itemId: record.itemId, taste: record.taste as GiftTaste, day: record.day as number };
}

/** Parse the complete versioned gift store. Corrupt optional memory remains visible as an error. */
function readStore(): ResidentGiftStore {
  const raw = localStorage.getItem(storageKey());
  if (raw === null) return { version: 1, residents: {} };
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error('Resident gift memory is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resident gift memory is invalid.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'residents,version' || record.version !== 1
    || !record.residents || typeof record.residents !== 'object' || Array.isArray(record.residents)) {
    throw new Error('Resident gift memory has an unsupported format.');
  }
  const residents: Partial<Record<ResidentId, StoredGift[]>> = {};
  for (const [rawId, rawGifts] of Object.entries(record.residents as Record<string, unknown>)) {
    const id = residentRelationshipProfile(rawId as ResidentId).id;
    if (!Array.isArray(rawGifts) || rawGifts.length > MAX_GIFTS_PER_RESIDENT) throw new Error(`Gift memory for ${id} is invalid.`);
    const gifts = rawGifts.map((gift, index) => storedGift(gift, id, index));
    if (gifts.some((gift, index) => index > 0 && gift.day <= gifts[index - 1].day)) {
      throw new Error(`Gift memory for ${id} is not chronological.`);
    }
    residents[id] = gifts;
  }
  return { version: 1, residents };
}

/** Persist and verify one complete gift-memory write. */
function writeStore(store: ResidentGiftStore): void {
  const raw = JSON.stringify(store);
  localStorage.setItem(storageKey(), raw);
  if (localStorage.getItem(storageKey()) !== raw) throw new Error('Resident gift memory write verification failed.');
}

/** Record one gift only after RelationshipSystem confirms that it was accepted and consumed. */
export function recordAcceptedResidentGift(id: ResidentId, itemId: string, taste: GiftTaste, day: number): void {
  residentRelationshipProfile(id);
  const item = ITEM_CATALOG[itemId];
  if (!item) throw new Error(`Gift memory item ${itemId} is unknown.`);
  if (item.category === 'Placeable' || itemId === 'broom') throw new Error(`Gift memory item ${itemId} cannot be gifted.`);
  if (!GIFT_TASTES.includes(taste) || !Number.isSafeInteger(day) || day < 1) throw new Error('Accepted gift memory is invalid.');
  const store = readStore(), gifts = store.residents[id] ?? [];
  const latest = gifts[gifts.length - 1];
  if (latest && day <= latest.day) throw new Error(`Gift memory for ${id} already contains day ${day}.`);
  store.residents[id] = [...gifts, { itemId, taste, day }].slice(-MAX_GIFTS_PER_RESIDENT);
  writeStore(store);
}

/** Return a detached factual window for the next local-model conversation. */
export function recentResidentGifts(id: ResidentId): ResidentGiftMemory[] {
  residentRelationshipProfile(id);
  return (readStore().residents[id] ?? []).slice(-6).map(gift => ({ ...gift, label: ITEM_CATALOG[gift.itemId].label }));
}
