/**
 * CropSystem — planting, growth, and harvest of crops (GameState.crops keyed by
 * `${scene}:${tx},${ty}` — scene-scoped like soil, so farm crops never render in town).
 *
 * The crop CATALOG (types, seasons, seeds, growth pacing) is data in src/config/Crops.ts. A crop
 * accumulates one growth day per WATERED day rollover (advanceDay, called on sleep) and advances
 * a visual stage whenever it has banked that stage's `stageDays` — so parsnips (3 days) and
 * melons (12 days) share the same 4-stage art pipeline at different speeds. A crop is
 * harvestable at maxStage; harvesting removes it, yields its produce, and rolls a seeded 0..2
 * bonus of its own seeds (Stardew-style seed return). All state is serializable so tests assert
 * growth deterministically.
 */
import { GameState } from '../state/GameState';
import { cropDef } from '../config/Crops';
import { Rng } from '../state/Rng';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';

// why: the active scene — planting/watering/harvesting always happen where the player stands.
// advanceDay deliberately iterates ALL scenes' crops, so sleeping indoors still grows the farm.
const key = (tx: number, ty: number): string => `${GameState.instance.activeScene}:${tx},${ty}`;

/** What a harvest yields: the produce item plus a seeded 0..2 seed return. */
export interface HarvestResult {
  produce: string;
  seedItem: string;
  seeds: number;
}

/** Atomic harvest outcome: a full bag leaves the mature crop planted. */
export type HarvestAttempt =
  | { status: 'nothing' }
  | { status: 'full' }
  | { status: 'harvested'; result: HarvestResult };

export const CropSystem = {
  /**
   * Plant a crop of `type` on a tile. Returns true if planted (tile must be free of a crop).
   * Season/seed-count validation happens in InteractionSystem BEFORE this is called; unknown
   * crop types throw (fail loud).
   */
  plant(tx: number, ty: number, type: string): boolean {
    const gs = GameState.instance;
    const k = key(tx, ty);
    if (gs.crops[k]) return false;
    const def = cropDef(type);
    gs.crops[k] = {
      type: def.type,
      stage: 0,
      maxStage: def.stageDays.length,
      watered: false,
      daysInStage: 0,
    };
    return true;
  },

  /** Is the crop on this tile fully grown? */
  isMature(tx: number, ty: number): boolean {
    const crop = GameState.instance.crops[key(tx, ty)];
    return !!crop && crop.stage >= crop.maxStage;
  },

  /**
   * Harvest a mature crop atomically. Rewards are capacity-checked and committed before the crop
   * is removed; a full backpack returns `full` and leaves crop + soil untouched.
   */
  harvest(tx: number, ty: number): HarvestAttempt {
    const gs = GameState.instance;
    const k = key(tx, ty);
    const crop = gs.crops[k];
    if (!crop || crop.stage < crop.maxStage) return { status: 'nothing' };
    const def = cropDef(crop.type);
    const result: HarvestResult = {
      produce: def.produce,
      seedItem: def.seed,
      seeds: Rng.instance.int(0, 2),
    };
    const deltas: Record<string, number> = { [result.produce]: 1 };
    if (result.seeds > 0) deltas[result.seedItem] = result.seeds;
    if (!InventoryLayoutSystem.applyInventoryDelta(gs, deltas)) return { status: 'full' };
    delete gs.crops[k];
    // Free the soil back to plain tilled so it can be replanted.
    if (gs.tiles[k] === 'watered') gs.tiles[k] = 'tilled';
    return { status: 'harvested', result };
  },

  /**
   * Advance all crops by one day. A watered crop banks a growth day (and advances a stage once it
   * has this stage's `stageDays`); an unwatered crop simply doesn't advance. Water dries either
   * way. Called on day rollover (sleep). DevTuningSystem may pass `forceGrowth` to preview the
   * lifecycle without repeated watering; production sleep calls omit it and keep the normal rule.
   */
  advanceDay(options?: { forceGrowth?: boolean }): void {
    const gs = GameState.instance;
    for (const k of Object.keys(gs.crops)) {
      const crop = gs.crops[k];
      if ((crop.watered || options?.forceGrowth === true) && crop.stage < crop.maxStage) {
        const def = cropDef(crop.type);
        crop.daysInStage += 1;
        // why: stageDays is per-stage pacing — a melon spends 4 days in each stage, a parsnip 1.
        if (crop.daysInStage >= def.stageDays[crop.stage]) {
          crop.stage += 1;
          crop.daysInStage = 0;
        }
      }
      crop.watered = false;
      // Watered soil dries overnight.
      if (gs.tiles[k] === 'watered') gs.tiles[k] = 'tilled';
    }
  },
};
