/**
 * DevTuningSystem — bounded developer controls for observing clocks and crop life cycles.
 *
 * The system is inert outside `isTestMode()` and keeps normal x1 behavior identical to production.
 * Accelerated crop modes create forced preview growth days on a short real-time cadence so an
 * artist/designer can watch every stage without sleeping repeatedly. The explicit step action uses
 * the same path. All chosen multipliers live in GameState for deterministic browser assertions.
 */
import { isTestMode } from '../debug/RuntimeMode';
import { GameState } from '../state/GameState';
import { CropSystem } from './CropSystem';

export const CLOCK_SCALES = [0.25, 1, 4, 16] as const;
export const CROP_SCALES = [1, 2, 4, 8] as const;
const PREVIEW_DAY_MS = 8_000;

let cropPreviewElapsedMs = 0;

/** Result from a tuning tick; scenes redraw crops only when a preview day actually occurred. */
export interface DevTuningTickResult {
  cropDaysAdvanced: number;
}

export const DevTuningSystem = {
  /** Apply a validated clock multiplier. Throws on values outside the intentionally small menu. */
  setClockScale(scale: number): void {
    if (!CLOCK_SCALES.includes(scale as (typeof CLOCK_SCALES)[number])) {
      throw new Error(`DevTuningSystem: unsupported clock scale ${scale}`);
    }
    GameState.instance.devTuning.clockScale = scale;
  },

  /** Apply a validated crop-preview multiplier and reset partial preview progress. */
  setCropScale(scale: number): void {
    if (!CROP_SCALES.includes(scale as (typeof CROP_SCALES)[number])) {
      throw new Error(`DevTuningSystem: unsupported crop scale ${scale}`);
    }
    GameState.instance.devTuning.cropScale = scale;
    cropPreviewElapsedMs = 0;
  },

  /** Cycle a scale using the fixed control order. */
  cycleClock(direction: -1 | 1): number {
    const current = GameState.instance.devTuning.clockScale;
    const index = CLOCK_SCALES.indexOf(current as (typeof CLOCK_SCALES)[number]);
    if (index < 0) throw new Error(`DevTuningSystem: invalid stored clock scale ${current}`);
    const next = CLOCK_SCALES[(index + direction + CLOCK_SCALES.length) % CLOCK_SCALES.length];
    this.setClockScale(next);
    return next;
  },

  /** Cycle the crop-preview scale using the fixed control order. */
  cycleCrops(direction: -1 | 1): number {
    const current = GameState.instance.devTuning.cropScale;
    const index = CROP_SCALES.indexOf(current as (typeof CROP_SCALES)[number]);
    if (index < 0) throw new Error(`DevTuningSystem: invalid stored crop scale ${current}`);
    const next = CROP_SCALES[(index + direction + CROP_SCALES.length) % CROP_SCALES.length];
    this.setCropScale(next);
    return next;
  },

  /** Force exactly one crop growth day for visual inspection, regardless of watering. */
  advanceCropDay(): void {
    if (!isTestMode()) throw new Error('DevTuningSystem: crop stepping is dev/test only');
    CropSystem.advanceDay({ forceGrowth: true });
  },

  /**
   * Advance the accelerated preview timer. x1 is deliberately inert: ordinary crop growth remains
   * owned by sleep/day rollover. At x2/x4/x8 one preview day takes 8/4/2 real seconds.
   */
  tick(deltaMs: number): DevTuningTickResult {
    if (!isTestMode()) return { cropDaysAdvanced: 0 };
    const scale = GameState.instance.devTuning.cropScale;
    if (scale <= 1) {
      cropPreviewElapsedMs = 0;
      return { cropDaysAdvanced: 0 };
    }
    cropPreviewElapsedMs += deltaMs;
    const interval = PREVIEW_DAY_MS / (scale / 2);
    let cropDaysAdvanced = 0;
    while (cropPreviewElapsedMs >= interval) {
      cropPreviewElapsedMs -= interval;
      CropSystem.advanceDay({ forceGrowth: true });
      cropDaysAdvanced++;
    }
    return { cropDaysAdvanced };
  },

  /** Reset module-local preview progress on a fresh game/test page. */
  resetPreviewClock(): void {
    cropPreviewElapsedMs = 0;
  },
};
