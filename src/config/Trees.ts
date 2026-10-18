/**
 * Trees — species data and strict persistence checks for player-planted farm trees.
 * Authored trees stay oak except the pines listed in TREE_SPECIES; planted trees own species separately from map overrides.
 */
import { SceneKey } from './AssetKeys';
import { furnitureCells } from './Furniture';
import type { GameState } from '../state/GameState';
import { getMapData, type MapData } from '../world/MapDef';

export type TreeSpecies = 'oak' | 'pine';
/** A one-tile trunk with a durable species and growth/stump stage. */
export interface PlantedTree {
  species: TreeSpecies;
  stage: 'sapling' | 'small' | 'full' | 'stump';
  sinceDay: number;
}

/** Seed IDs deliberately match inventory items rather than introducing a second quantity store. */
export const TREE_SEEDS: Readonly<Record<TreeSpecies, string>> = Object.freeze({ oak: 'oak-seed', pine: 'pine-seed' });

/**
 * The authored map trees that are pines; every other map tree is an oak.
 * The five Forest pines and the two Beach pines are painted pines in the Forest and Beach art
 * (world/ForestArt.ts FOREST_NODES, world/BeachArt.ts BEACH_NODES), so their seeds, saplings and young trees are
 * pines too; chopping them supplies the first pine seeds.
 */
export const TREE_SPECIES: Readonly<Record<string, TreeSpecies>> = Object.freeze({
  'ForestScene:19,51': 'pine',
  'ForestScene:61,10': 'pine',
  'ForestScene:68,21': 'pine',
  'ForestScene:73,38': 'pine',
  'ForestScene:46,27': 'pine',
  'BeachScene:24,2': 'pine',
  'BeachScene:74,4': 'pine',
});

/** Native pine art sizes; the trunk remains one 16px tile at every stage. */
export const PINE_ART = Object.freeze({
  sapling: { texture: 'tree-pine-sapling', width: 16, height: 16 },
  small: { texture: 'tree-pine-small', width: 32, height: 32 },
  full: { texture: 'tree-pine-full', width: 32, height: 48 },
});

/** Resolve a tree seed item, returning null for unrelated inventory items. */
export function treeSpeciesForSeed(item: string): TreeSpecies | null {
  if (item === TREE_SEEDS.oak) return 'oak';
  if (item === TREE_SEEDS.pine) return 'pine';
  return null;
}

/** Check durable occupied/protected cells against the supplied map, including explicit legacy save validation. */
export function treeCellAvailable(state: GameState, tx: number, ty: number, map: MapData = getMapData(SceneKey.Farm)): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 1 || ty < 1 || tx >= map.w - 1 || ty >= map.h - 1) return false;
  if (map.ground[ty][tx] !== 'grass' || map.solid[ty][tx]) return false;
  const key = `${SceneKey.Farm}:${tx},${ty}`;
  if (state.tiles[key] || state.crops[key]) return false;
  if (map.spawns.some(p => p.tx === tx && p.ty === ty) || map.warps.some(p => tx >= p.tx && tx < p.tx + p.w && ty >= p.ty && ty < p.ty + p.h)) return false;
  if (map.reservedTiles && map.reservedTiles.some(p => p.tx === tx && p.ty === ty)) return false;
  if (map.buildings.some(p => tx >= p.tx && tx < p.tx + p.wTiles && ty > p.ty - p.hSolid && ty <= p.ty)) return false;
  if (state.placements.some(p => p.scene === SceneKey.Farm && tx >= p.tx && tx < p.tx + p.w && ty >= p.ty && ty < p.ty + p.h)) return false;
  if (state.placedItems.some(p => p.scene === SceneKey.Farm && furnitureCells(p.item, p.tx, p.ty, p.rotation).some(c => c.tx === tx && c.ty === ty))) return false;
  const authored = map.objects.find(p => p.tx === tx && p.ty === ty);
  if (authored) {
    const removed = state.removedNodes[key];
    if (!removed || removed.kind !== authored.kind) return false;
  }
  return true;
}

/** Validate and detach planted trees against an explicit farm without changing global map state. */
export function validatePlantedTrees(value: unknown, state: GameState, map: MapData = getMapData(SceneKey.Farm)): Record<string, PlantedTree> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GameState save: plantedTrees must be an object');
  const out: Record<string, PlantedTree> = {};
  for (const [key, raw] of Object.entries(value)) {
    const match = /^FarmScene:(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
    if (!match || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`GameState save: invalid plantedTrees entry ${key}`);
    const tree = raw as Record<string, unknown>;
    if (Object.keys(tree).length !== 3 || !['oak', 'pine'].includes(String(tree.species)) ||
      !['sapling', 'small', 'full', 'stump'].includes(String(tree.stage)) ||
      !Number.isSafeInteger(tree.sinceDay) || typeof tree.sinceDay !== 'number' || tree.sinceDay < 1 || tree.sinceDay > state.day) {
      throw new Error(`GameState save: invalid plantedTrees state ${key}`);
    }
    if (!treeCellAvailable(state, Number(match[1]), Number(match[2]), map) || state.treeStages[key]) {
      throw new Error(`GameState save: plantedTrees overlaps occupied terrain or a map-tree override at ${key}`);
    }
    out[key] = { species: tree.species as TreeSpecies, stage: tree.stage as PlantedTree['stage'], sinceDay: tree.sinceDay };
  }
  return out;
}
