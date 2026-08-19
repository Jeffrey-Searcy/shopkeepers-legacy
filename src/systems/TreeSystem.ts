/**
 * TreeSystem — tree growth stages, stumps, and node regrowth on day rollover.
 *
 * Model (extends the GameState.removedNodes weed-regrowth pattern):
 *  - A map tree is FULL-grown by default. GameState.treeStages holds the exceptions, keyed by
 *    `${scene}:${tx},${ty}`: growing trees ('sapling' -> 'small' -> full/deleted, one step per
 *    TREE_STAGE_DAYS) and 'stump' entries left behind when a full tree is felled (stumps never
 *    grow; chopping one clears the spot).
 *  - GameState.removedNodes records cleared nodes with the day they were cleared. On each day
 *    rollover: weeds regrow immediately (entry deleted, node respawns), cleared TREE spots sprout
 *    a fresh sapling after TREE_REGROW_DAYS (entry deleted + a sapling treeStages entry), and
 *    rocks stay cleared forever.
 *  - A cleared tree spot the player has FARMED (tilled soil / a crop on that tile) never sprouts —
 *    the removal record is kept so the map tree also never respawns there.
 *
 * Pure GameState logic (no Phaser); the scene re-syncs visible nodes after sleep via
 * BaseWorldScene.respawnNodes().
 */
import { GameState } from '../state/GameState';
import { TREE_REGROW_DAYS, TREE_STAGE_DAYS, type TreeStage } from '../config/Items';
import { SceneKey } from '../config/AssetKeys';

export const TreeSystem = {
  /**
   * The stage a map tree at `${scene}:${tx},${ty}` should currently be, or 'stump' when only its
   * stump remains. No override entry = full-grown (the map default).
   */
  stageAt(scene: SceneKey, tx: number, ty: number): TreeStage | 'stump' {
    const t = GameState.instance.treeStages[`${scene}:${tx},${ty}`];
    return t ? t.stage : 'full';
  },

  /** Record that felling a full tree left a stump behind. */
  leaveStump(scene: SceneKey, tx: number, ty: number): void {
    const gs = GameState.instance;
    gs.treeStages[`${scene}:${tx},${ty}`] = { stage: 'stump', sinceDay: gs.day };
  },

  /**
   * Advance tree growth + node regrowth by one day. Call AFTER GameState.day has been
   * incremented (i.e. from sleep()).
   */
  advanceDay(): void {
    const gs = GameState.instance;

    // Growing trees advance one stage per TREE_STAGE_DAYS; reaching full deletes the override
    // (full is the default). Stumps never grow.
    for (const [k, t] of Object.entries(gs.treeStages)) {
      if (t.stage === 'stump') continue;
      if (gs.day - t.sinceDay < TREE_STAGE_DAYS) continue;
      if (t.stage === 'sapling') {
        gs.treeStages[k] = { stage: 'small', sinceDay: gs.day };
      } else if (t.stage === 'small') {
        delete gs.treeStages[k]; // full-grown again
      }
    }

    // Regrowth of cleared nodes.
    for (const [k, rec] of Object.entries(gs.removedNodes)) {
      if (rec.kind === 'weed') {
        // Weeds regrow overnight (the original Stardew-style rule).
        delete gs.removedNodes[k];
        continue;
      }
      if (rec.kind === 'tree' && gs.day - rec.day >= TREE_REGROW_DAYS) {
        // why: removedNodes, tiles, and crops all share `${scene}:${tx},${ty}` keys now, so the
        // removal key indexes soil/crops directly. A farmed tile is the player's land; keep the
        // removal record so neither a sapling nor the original map tree pops through their crops.
        if (gs.tiles[k] || gs.crops[k]) continue;
        delete gs.removedNodes[k];
        gs.treeStages[k] = { stage: 'sapling', sinceDay: gs.day };
      }
      // rocks: cleared forever (no regrowth).
    }
  },
};
