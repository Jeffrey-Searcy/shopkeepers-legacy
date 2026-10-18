/**
 * TimeSystem — the in-game clock. `timeOfDay` is minutes elapsed since 06:00 (game start), running
 * 0..(DAY_MINUTES). It advances during play (fed real delta ms in the scene update) and via the
 * test seam's stepTime(). It also computes a day/night darkness factor the scene uses to tint the
 * world. Registers itself with DebugHooks so stepTime() maps to advance().
 */
import { GameState } from '../state/GameState';
import { registerTimeStepper } from '../debug/DebugHooks';
import { syncTownSocialLife } from './TownSocialLifeSystem';
import { isTavernNight, TAVERN_NIGHT } from './TownRoutePlanSystem';
import { SceneKey } from '../config/AssetKeys';
import { VitalitySystem } from './VitalitySystem';

/** A full game day is 20 real-ish minutes compressed; we model 24h as this many game-minutes. */
export const DAY_MINUTES = 24 * 60;
/**
 * Game-minutes that pass per real second of play. Stardew runs ~1.4 game-min/s (a full day ≈ 14
 * real minutes); the old value of 12 made days fly by ~8x too fast (the designer's report).
 */
const MINUTES_PER_SECOND = 1.5;
/**
 * Clock speed inside The Wayfarer during Wednesday night. The crowd is there only from 13:00 to 16:00
 * after 06:00 (19:00-22:00), so a slower clock gives the keeper time to sit, chat, and play cards.
 * Leaving the bar restores normal speed on the next frame.
 */
export const WAYFARER_NIGHT_CLOCK_FACTOR = 0.35;

/**
 * True while the keeper stands in The Wayfarer during its busy night window.
 * @param day absolute game day
 * @param timeOfDay minutes since 06:00
 * @param scene the keeper's current world scene
 */
export function isWayfarerNightSlowTime(day: number, timeOfDay: number, scene: SceneKey): boolean {
  return scene === SceneKey.TownBar && isTavernNight(day)
    && timeOfDay >= TAVERN_NIGHT.opensAt && timeOfDay < TAVERN_NIGHT.closesAt;
}

export const TimeSystem = {
  /** Advance the clock by `minutes` game-minutes, clamped within a single day. */
  advance(minutes: number): void {
    const gs = GameState.instance;
    // A direct resident conversation owns the player's attention. Freeze the authoritative clock
    // through choice, scripted reply, typing, model wait, and reply states until that panel closes.
    // Resident routes read this same clock, so freezing it also preserves the exact route position.
    if (gs.paused || gs.dialogue?.residentId !== undefined) return;
    const before = gs.timeOfDay;
    gs.timeOfDay = Math.min(DAY_MINUTES, gs.timeOfDay + minutes);
    // why: pass the minutes that really passed (the clock stops at DAY_MINUTES), so meditation at
    // 2am never trains on time that did not happen.
    VitalitySystem.meditate(gs.timeOfDay - before);
    // Process crossed meeting minutes immediately. Event ids and bond days make repeated frames harmless.
    syncTownSocialLife(gs.day, gs.timeOfDay);
  },

  /**
   * Feed real elapsed milliseconds (from the scene update loop) into the clock.
   * @param deltaMs real milliseconds since the last frame
   */
  tick(deltaMs: number): void {
    const gs = GameState.instance;
    const scale = gs.devTuning.clockScale;
    // Wayfarer night stretches only real-time play; stepTime() and sleep still move whole minutes.
    const place = isWayfarerNightSlowTime(gs.day, gs.timeOfDay, gs.activeScene) ? WAYFARER_NIGHT_CLOCK_FACTOR : 1;
    this.advance((deltaMs / 1000) * MINUTES_PER_SECOND * scale * place);
  },

  /**
   * Darkness factor 0..1 for the day/night tint. Morning/day ~0 (bright); it ramps up in the
   * evening toward night. Uses the absolute clock time (06:00 + timeOfDay).
   */
  darkness(): number {
    const gs = GameState.instance;
    const hour = (6 + gs.timeOfDay / 60) % 24;
    // Bright through the day (06:00 game start .. 17:00); darkening in the evening; full dark
    // overnight; lightening before dawn. 06:00 (game start) is fully bright.
    if (hour >= 6 && hour <= 17) return 0;
    if (hour > 17 && hour < 21) return (hour - 17) / 4; // 17:00-21:00 dusk: 0 -> 1
    if (hour >= 21 || hour < 4) return 1; // night
    return (6 - hour) / 2; // 04:00-06:00 dawn: 1 -> 0
  },

  /** Register the seam's stepTime -> advance mapping. Call once at boot. */
  install(): void {
    registerTimeStepper((minutes) => this.advance(minutes));
  },
};
