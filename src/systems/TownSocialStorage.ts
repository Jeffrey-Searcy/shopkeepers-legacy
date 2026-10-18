/** Stable browser-local storage key contract for witnessed resident-to-resident conversations. */
const TOWN_SOCIAL_STORAGE_PREFIX = 'shopkeepers-legacy:town-social-notes:v2';

/** Return one isolated Town social-notes key for a save slot or direct test scope. */
export function townSocialNotesStorageKey(scope: number | 'unslotted'): string {
  if (scope === 'unslotted') return `${TOWN_SOCIAL_STORAGE_PREFIX}:unslotted`;
  if (!Number.isInteger(scope) || scope < 1 || scope > 3) throw new Error(`Town social notes slot ${scope} is invalid.`);
  return `${TOWN_SOCIAL_STORAGE_PREFIX}:slot-${scope}`;
}
