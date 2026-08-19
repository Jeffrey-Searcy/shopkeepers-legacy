/**
 * WeatherSystem — daily weather (sunny / rain), Stardew model.
 *
 * Weather for a given day is a PURE deterministic function of (URL seed, day number), so it never
 * consumes draws from the shared gameplay Rng stream (which would shift seeded outcomes other
 * specs assert on, e.g. harvest seed returns and fishing bite timing). Day 1 is always sunny
 * (the Stardew opener). Rain auto-waters all farmed soil overnight — that effect is applied by
 * BaseWorldScene.sleep() on day rollover, reading `forDay(newDay)`.
 *
 * The TV in the farmhouse (interact) reports TOMORROW's forecast via forecastLine().
 * Tests can pin a specific day's weather with override() (exposed on the seam as setWeather).
 *
 * This module intentionally does NOT import GameState (one-directional dependency: GameState's
 * serialize() derives weather/weatherTomorrow from here).
 */

export type Weather = 'sunny' | 'rain';

/** Chance any day (after day 1) is rainy. Roughly Stardew-spring-ish. */
const RAIN_CHANCE = 0.3;

/** The deterministic boot seed (same source main.ts feeds Rng.seed). Read once at module load. */
const BOOT_SEED = ((): number => {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get('seed') ?? '42') || 42;
})();

/** Test-only pinned weather per day (set via the seam's setWeather). */
const overrides = new Map<number, Weather>();

/**
 * A tiny stateless hash -> [0,1) for (seed, day). mulberry32-style mix so consecutive days are
 * uncorrelated. Deterministic across runs for the same URL seed.
 */
function hash01(seed: number, day: number): number {
  let t = (seed ^ Math.imul(day, 0x9e3779b1)) >>> 0;
  t = (t + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

export const WeatherSystem = {
  /** The weather on an absolute day. Day 1 is always sunny; test overrides win. */
  forDay(day: number): Weather {
    const pinned = overrides.get(day);
    if (pinned) return pinned;
    if (day <= 1) return 'sunny';
    return hash01(BOOT_SEED, day) < RAIN_CHANCE ? 'rain' : 'sunny';
  },

  /** Test-only: pin a specific day's weather (seam setWeather pins tomorrow). */
  override(day: number, weather: Weather): void {
    if (weather !== 'sunny' && weather !== 'rain') {
      throw new Error(`WeatherSystem.override: unknown weather "${weather as string}"`);
    }
    overrides.set(day, weather);
  },

  /** The TV weather report: tomorrow's forecast relative to `today`. */
  forecastLine(today: number): string {
    return this.forDay(today + 1) === 'rain'
      ? "...and tomorrow, rain moves in over the valley. Leave the watering can inside — the sky's got it covered."
      : '...and tomorrow looks clear and sunny across the valley. A fine day to work the land.';
  },
};
