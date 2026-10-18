/**
 * Crops.ts — the data catalog of crops and the season calendar.
 *
 * Content-is-data (CLAUDE.md): adding a crop = adding an entry here + its art keys in
 * manifest.json (`crop-<type>-1..N`, `icon-<type>`, `icon-<seed>`). No system code changes.
 *
 * Growth model: a crop advances through visual stages 0..maxStage (maxStage = stageDays.length).
 * Each WATERED day rollover adds one day toward the current stage; when the accumulated days
 * reach stageDays[stage], the crop moves to the next stage. Total watered days to maturity =
 * sum(stageDays), so crops share the same art-stage count but grow at different speeds
 * (parsnip 3 days, potato 6, melon 12 — Stardew-like pacing).
 *
 * Seasons: the year is four 28-day seasons (spring -> summer -> fall -> winter), derived purely
 * from GameState.day so it needs no extra mutable state. Planting is rejected off-season.
 */

/** The four seasons, in calendar order. Day 1 is Spring 1. */
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'fall', 'winter'];

/** Days per season (Stardew's 28-day months). */
export const SEASON_DAYS = 28;

/** The season a given absolute day (1-based) falls in. */
export function seasonForDay(day: number): Season {
  return SEASONS[Math.floor((day - 1) / SEASON_DAYS) % SEASONS.length];
}

/** The 1-based day-of-season for an absolute day (1..28), for the clock display. */
export function dayOfSeason(day: number): number {
  return ((day - 1) % SEASON_DAYS) + 1;
}

/** One crop's full definition: identity, season gate, items, and growth pacing. */
export interface CropDef {
  /** Crop type id — also the art key stem (`crop-<type>-1..stageDays.length+1`). */
  type: string;
  /** Display name for toasts/UI. */
  label: string;
  /** The only season this crop may be planted in. */
  season: Season;
  /** Seed item id consumed on planting (one per plant). */
  seed: string;
  /** Produce item id granted on harvest. */
  produce: string;
  /** Watered days required to LEAVE each stage; length = maxStage. */
  stageDays: number[];
}

/** The crop catalog, keyed by crop type. */
export const CROPS: Record<string, CropDef> = {
  parsnip: {
    type: 'parsnip',
    label: 'Parsnip',
    season: 'spring',
    seed: 'parsnip-seeds',
    produce: 'parsnip',
    stageDays: [1, 1, 1], // 3 watered days to maturity
  },
  potato: {
    type: 'potato',
    label: 'Potato',
    season: 'spring',
    seed: 'potato-seeds',
    produce: 'potato',
    stageDays: [2, 2, 2], // 6 watered days
  },
  melon: {
    type: 'melon',
    label: 'Melon',
    season: 'summer',
    seed: 'melon-seeds',
    produce: 'melon',
    stageDays: [4, 4, 4], // 12 watered days
  },
  cabbage: {
    type: 'cabbage',
    label: 'Cabbage',
    season: 'spring',
    seed: 'cabbage-seeds',
    produce: 'cabbage',
    stageDays: [1, 2, 1], // 4 watered days
  },
  strawberry: {
    type: 'strawberry',
    label: 'Strawberry',
    season: 'spring',
    seed: 'strawberry-seeds',
    produce: 'strawberry',
    stageDays: [2, 3, 3], // 8 watered days
  },
  tomato: {
    type: 'tomato',
    label: 'Tomato',
    season: 'summer',
    seed: 'tomato-seeds',
    produce: 'tomato',
    stageDays: [2, 2, 2], // 6 watered days
  },
};

/** Reverse lookup: seed item id -> crop def (null when the item isn't a seed). */
export function cropForSeed(seedItem: string): CropDef | null {
  for (const def of Object.values(CROPS)) {
    if (def.seed === seedItem) return def;
  }
  return null;
}

/** Fail-loud crop lookup by type. */
export function cropDef(type: string): CropDef {
  const def = CROPS[type];
  if (!def) throw new Error(`Crops: unknown crop type "${type}"`);
  return def;
}
