/**
 * Browser-local sound, motion, facade and chat preferences; separate from character progress and save slots.
 * Stored as one JSON record under SETTINGS_STORAGE_KEY. Only the exact current key set is accepted: a record from an
 * older build fails loudly, and the title screen offers an explicit Reset Settings that leaves saves untouched.
 */
import { shopFacade, type ShopFacadeId } from '../config/ShopFacades';

/** Preferences retain exact sound gain, motion choice, facade preview and local chat. */
export interface GameSettings {
  soundVolume: number;
  reducedMotion: boolean;
  /** Browser-local facade preview; never changes business type or interior progress. */
  shopFacade: ShopFacadeId;
  /** Optional localhost-only character chat. It can speak, but never change gameplay state. */
  localNpcChat: boolean;
}

export const SETTINGS_STORAGE_KEY = 'shopkeeperslegacy.settings.v1';
export const SETTINGS_CHANGED_EVENT = 'shopkeeperslegacy-settings-changed';
/** The exact sorted key list of the current schema. */
const SETTINGS_KEYS = 'localNpcChat,reducedMotion,shopFacade,soundVolume';
let cachedRaw: string | null | undefined;
let cachedSettings: GameSettings | null = null;

/** Cache one validated read so per-frame resident rendering does not repeatedly parse local storage. */
function rememberSettings(raw: string | null, settings: GameSettings): GameSettings {
  cachedRaw = raw; cachedSettings = { ...settings };
  return { ...settings };
}

/** Reject malformed preferences before storage or running audio can change. */
function assertSettings(value: unknown): asserts value is GameSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== SETTINGS_KEYS) throw new Error('Settings contain unknown or missing fields.');
  if (typeof record.soundVolume !== 'number' || !Number.isFinite(record.soundVolume)
    || record.soundVolume < 0 || record.soundVolume > 1) throw new Error('Sound volume must be between 0 and 1.');
  if (typeof record.reducedMotion !== 'boolean') throw new Error('Reduced motion must be on or off.');
  shopFacade(record.shopFacade);
  if (typeof record.localNpcChat !== 'boolean') throw new Error('Local character chat must be on or off.');
}

/** Validated preference access; first launch uses full sound and the browser's accessibility choice. */
export const SettingsSystem = {
  /** Read preferences without writing; absence means this browser has not made a choice yet. */
  get(): GameSettings {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === cachedRaw && cachedSettings !== null) return { ...cachedSettings };
    if (raw === null) {
      const settings = { soundVolume: 1, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        shopFacade: 'original' as const, localNpcChat: false };
      return rememberSettings(raw, settings);
    }
    if (raw.length > 2048) throw new Error('Settings record is too large.');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Settings contain invalid JSON.'); }
    assertSettings(parsed);
    return rememberSettings(raw, parsed);
  },

  /** Validate and persist a partial user choice before notifying current UI/audio consumers. */
  update(change: Partial<GameSettings>): GameSettings {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Settings change must be an object.');
    const next = { ...this.get(), ...change };
    assertSettings(next);
    const raw = JSON.stringify(next);
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw);
    cachedRaw = raw; cachedSettings = { ...next };
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: { ...next } }));
    return next;
  },

  /** Explicit user recovery removes only preferences; character save keys remain untouched. */
  reset(): void {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    cachedRaw = undefined; cachedSettings = null;
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: this.get() }));
  },

  /** Resolve saved motion preference for all decorative UI animation. */
  prefersReducedMotion(): boolean {
    return this.get().reducedMotion;
  },
};
