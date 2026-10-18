/** Stable browser-local storage key contract for optional resident chat notes. */
const RESIDENT_CHAT_STORAGE_PREFIX = 'shopkeepers-legacy:resident-chat-notes:v1';
const RESIDENT_GIFT_STORAGE_PREFIX = 'shopkeepers-legacy:resident-gift-memory:v1';

/** Return one isolated note key for a save slot or the explicit direct-test scope. */
export function residentChatNotesStorageKey(scope: number | 'unslotted'): string {
  if (scope === 'unslotted') return `${RESIDENT_CHAT_STORAGE_PREFIX}:unslotted`;
  if (!Number.isInteger(scope) || scope < 1 || scope > 3) throw new Error(`Chat notes slot ${scope} is invalid.`);
  return `${RESIDENT_CHAT_STORAGE_PREFIX}:slot-${scope}`;
}

/** Return one isolated verified-gift key for a save slot or the explicit direct-test scope. */
export function residentGiftMemoryStorageKey(scope: number | 'unslotted'): string {
  if (scope === 'unslotted') return `${RESIDENT_GIFT_STORAGE_PREFIX}:unslotted`;
  if (!Number.isInteger(scope) || scope < 1 || scope > 3) throw new Error(`Gift memory slot ${scope} is invalid.`);
  return `${RESIDENT_GIFT_STORAGE_PREFIX}:slot-${scope}`;
}
