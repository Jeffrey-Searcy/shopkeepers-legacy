/**
 * TimeSystem — the in-game clock. `timeOfDay` is minutes elapsed since 06:00 (game start), running
 * 0..(DAY_MINUTES). It advances during play (fed real delta ms in the scene update) and via the
 * test seam's stepTime(). It also computes a day/night darkness factor the scene uses to tint the
 * world. Registers itself with DebugHooks so stepTime() maps to advance().
 */
import { GameState } from '../state/GameState';
import { registerTimeStepper } from '../debug/DebugHooks';

/** A full game day is 20 real-ish minutes compressed; we model 24h as this many game-minutes. */
export const DAY_MINUTES = 24 * 60;
/**
 * Game-minutes that pass per real second of play. Stardew runs ~1.4 game-min/s (a full day ≈ 14
 * real minutes); the old value of 12 made days fly by ~8x too fast (the designer's report).
 */
const MINUTES_PER_SECOND = 1.5;

export const TimeSystem = {
  /** Advance the clock by `minutes` game-minutes, clamped within a single day. */
  advance(minutes: number): void {
    const gs = GameState.instance;
    if (gs.paused) return;
    gs.timeOfDay = Math.min(DAY_MINUTES, gs.timeOfDay + minutes);
  },

  /** Feed real elapsed milliseconds (from the scene update loop) into the clock. */
  tick(deltaMs: number): void {
    const scale = GameState.instance.devTuning.clockScale;
    this.advance((deltaMs / 1000) * MINUTES_PER_SECOND * scale);
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
