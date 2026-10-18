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
 *    rocks stay cleared forever. Farm trees only return through player-planted species seeds.
 *  - A cleared tree spot the player has FARMED (tilled soil / a crop on that tile) never sprouts —
 *    the removal record is kept so the map tree also never respawns there.
 *
 * Pure GameState logic (no Phaser); the scene re-syncs visible nodes after sleep via
 * BaseWorldScene.respawnNodes().
 */
import { GameState } from '../state/GameState';
import { TREE_REGROW_DAYS, TREE_STAGE_DAYS, type TreeStage } from '../config/Items';
import { SceneKey } from '../config/AssetKeys';
import { TREE_SEEDS, TREE_SPECIES, treeCellAvailable, treeSpeciesForSeed, type TreeSpecies } from '../config/Trees';
import { worldToTile } from '../config/GameConfig';

/** The scene supplies live collision occupants; map and durable occupancy stay system-owned. */
export interface TreePlantingContext {
  nodeAt(tx: number, ty: number): unknown | null;
}

export const TreeSystem = {
  /**
   * The stage a map tree at `${scene}:${tx},${ty}` should currently be, or 'stump' when only its
   * stump remains. No override entry = full-grown (the map default).
   */
  stageAt(scene: SceneKey, tx: number, ty: number): TreeStage | 'stump' {
    const gs = GameState.instance;
    const planted = gs.plantedTrees[`${scene}:${tx},${ty}`];
    if (planted) return planted.stage;
    const t = gs.treeStages[`${scene}:${tx},${ty}`];
    return t ? t.stage : 'full';
  },

  /** Return planted species, the three authored forest pines, or the existing map's oak species. */
  speciesAt(scene: SceneKey, tx: number, ty: number): TreeSpecies {
    const key = `${scene}:${tx},${ty}`;
    const planted = GameState.instance.plantedTrees[key];
    if (planted) return planted.species;
    if (Object.prototype.hasOwnProperty.call(TREE_SPECIES, key)) return TREE_SPECIES[key];
    return 'oak';
  },

  /** Return one seed drop ID for a mature tree; the scene emits it only on the final axe hit. */
  seedAt(scene: SceneKey, tx: number, ty: number): string {
    return TREE_SEEDS[this.speciesAt(scene, tx, ty)];
  },

  /** Plant on a free farm grass tile, consuming exactly one seed only after every check passes. */
  plant(seedItem: string, tx: number, ty: number, context: TreePlantingContext): string {
    const gs = GameState.instance;
    const species = treeSpeciesForSeed(seedItem);
    if (!species) throw new Error(`TreeSystem.plant: unknown seed ${seedItem}`);
    if (gs.activeScene !== SceneKey.Farm) return 'wrong-scene';
    const key = `${SceneKey.Farm}:${tx},${ty}`;
    if (!treeCellAvailable(gs, tx, ty) || gs.plantedTrees[key] || context.nodeAt(tx, ty)) return 'blocked';
    // Old saves retained stale stage entries after removing a stump. Its removal is authoritative.
    if (gs.treeStages[key] && (!gs.removedNodes[key] || gs.removedNodes[key].kind !== 'tree')) return 'blocked';
    const feet = worldToTile(gs.player.x, gs.player.y);
    if (feet.tx === tx && feet.ty === ty) return 'blocked';
    if (!gs.removeItem(seedItem, 1)) return 'no-seeds';
    delete gs.treeStages[key];
    gs.plantedTrees[key] = { species, stage: 'sapling', sinceDay: gs.day };
    return 'planted';
  },

  /** Clear a stump or immature tree; the authored node tombstone prevents accidental resurrection. */
  clear(scene: SceneKey, tx: number, ty: number): void {
    const gs = GameState.instance;
    const key = `${scene}:${tx},${ty}`;
    const planted = gs.plantedTrees[key];
    delete gs.plantedTrees[key];
    delete gs.treeStages[key];
    // Keep a removed rock/weed's identity when a player tree occupied its old tile.
    if (!planted || !gs.removedNodes[key]) gs.removedNodes[key] = { kind: 'tree', day: gs.day };
  },

  /** Record that felling a full tree left a stump behind. */
  leaveStump(scene: SceneKey, tx: number, ty: number): void {
    const gs = GameState.instance;
    const planted = gs.plantedTrees[`${scene}:${tx},${ty}`];
    if (planted) {
      planted.stage = 'stump';
      planted.sinceDay = gs.day;
      return;
    }
    gs.treeStages[`${scene}:${tx},${ty}`] = { stage: 'stump', sinceDay: gs.day };
  },

  /**
   * Advance tree growth + node regrowth by one day. Call AFTER GameState.day has been
   * incremented (i.e. from sleep()).
   */
  advanceDay(): void {
    const gs = GameState.instance;

    for (const tree of Object.values(gs.plantedTrees)) {
      if (tree.stage === 'stump' || tree.stage === 'full' || gs.day - tree.sinceDay < TREE_STAGE_DAYS) continue;
      tree.stage = tree.stage === 'sapling' ? 'small' : 'full';
      tree.sinceDay = gs.day;
    }

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
        // A planted tree owns this former weed tile; retain its tombstone while the trunk exists.
        if (gs.plantedTrees[k]) continue;
        // Weeds regrow overnight (the original Stardew-style rule).
        delete gs.removedNodes[k];
        continue;
      }
      if (rec.kind === 'tree' && gs.day - rec.day >= TREE_REGROW_DAYS) {
        if (k.startsWith(`${SceneKey.Farm}:`)) continue;
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
