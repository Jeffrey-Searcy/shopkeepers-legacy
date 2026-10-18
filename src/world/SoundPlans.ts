/**
 * SoundPlans — what each world scene sounds like underfoot and near its water.
 *
 * Footsteps: the map's Ground grid says grass/sand/stone/dirt/floor, but the painted art says more (the
 * Town's '=' roads are cobbles, its bridges and docks are planks, a forge floor is stone). Each scene's
 * plan maps the plain grounds to a FootSurface and adds authored zones (tile rectangles checked against
 * the art) where the painting differs from the ground grid. footSurfaceAt() resolves one feet tile.
 *
 * Water: `water` names the soft loop (AmbientSound 'river' | 'sea') that BaseWorldScene plays near the
 * map's water tiles, or null for a map whose water is still (ponds, lakes) or that has none. Still water
 * is silent on purpose: a cozy pond is quiet. Point sounds (a fountain, a waterfall) stay in each
 * painting's art data `sounds` list. Running water ('river', fountains, waterfalls) is silent for now
 * (AmbientSound SILENT_KINDS) until real recordings exist; only 'sea' plays.
 *
 * The Record covers every world scene, so a new scene fails to compile until it has a plan.
 */
import { SceneKey } from '../config/AssetKeys';
import type { FootSurface } from '../systems/SfxSystem';
import type { Ground, MapData } from './MapDef';

/** The scenes a keeper walks in (the same set as WORLD_SCENE_KEYS). */
export type WorldSceneKey = Exclude<SceneKey,
  SceneKey.Boot | SceneKey.Preload | SceneKey.MainMenu | SceneKey.MapEditor | SceneKey.RouteEditor | SceneKey.UI>;

/** One authored rectangle of tiles whose painted ground differs from the Ground grid. */
export interface SurfaceZone {
  /** First tile column. */
  x0: number;
  /** First tile row. */
  y0: number;
  /** Column after the last one (exclusive). */
  x1: number;
  /** Row after the last one (exclusive). */
  y1: number;
  surface: FootSurface;
  /** What is painted there, so a later art change can re-check the zone. */
  why: string;
}

/** The water loop a scene plays near its water tiles: a trickling stream or the sea's slow waves. */
export type WaterKind = 'river' | 'sea';

/** How one world scene sounds. */
export interface ScenePlan {
  /** The surface of 'dirt' ground: the painted path or road material. */
  path: FootSurface;
  /** The surface of 'floor' ground, or null on a map with no floor tiles (finding one then is a bug). */
  floor: FootSurface | null;
  /**
   * The surface of the dry part of a water or cliff tile. Fine walls open a shore tile's dry strip, so
   * the feet can stand on a tile whose ground is 'water'; that strip is the bank, not the water.
   */
  edge: FootSurface;
  /** Rectangles that override the ground mapping; the first match wins. */
  zones: readonly SurfaceZone[];
  /** The water loop near this map's water tiles, or null when its water is still (or it has none). */
  water: WaterKind | null;
}

/**
 * Plain outdoor maps: earth paths, no floors, grassy banks.
 * @param path the surface of the map's dirt paths
 * @param water the map's water loop, or null for still water or none
 * @param zones authored rectangles that override the ground mapping
 */
function outdoor(path: FootSurface, water: WaterKind | null, zones: readonly SurfaceZone[] = []): ScenePlan {
  return { path, floor: null, edge: 'grass', zones, water };
}

/** A wooden-floored room with no zones and no water. */
const WOOD_ROOM: ScenePlan = { path: 'wood', floor: 'wood', edge: 'wood', zones: [], water: null };

/** Every world scene's plan. Zones are in tiles, checked against crops of the painted art. */
export const SOUND_PLANS: Readonly<Record<WorldSceneKey, ScenePlan>> = {
  // why: the Farm's two ponds, the Forest pond and the Mountain lake are still water, so they are silent.
  [SceneKey.Farm]: outdoor('dirt', null),
  [SceneKey.Town]: outdoor('stone', 'river', [
    { x0: 55, y0: 23, x1: 65, y1: 25, surface: 'wood', why: 'north-east plank bridge over the river' },
    { x0: 52, y0: 40, x1: 64, y1: 43, surface: 'wood', why: 'middle plank bridge' },
    { x0: 28, y0: 56, x1: 32, y1: 66, surface: 'wood', why: 'south plank bridge' },
    { x0: 11, y0: 55, x1: 18, y1: 63, surface: 'wood', why: 'west dock and its wooden stairs' },
    { x0: 3, y0: 63, x1: 6, y1: 74, surface: 'wood', why: 'south-west pier stairs' },
    { x0: 4, y0: 63, x1: 23, y1: 67, surface: 'wood', why: 'south-west boardwalk' },
    { x0: 50, y0: 55, x1: 56, y1: 60, surface: 'wood', why: 'east fishing pier' },
  ]),
  [SceneKey.Forest]: outdoor('dirt', null, [
    { x0: 55, y0: 40, x1: 59, y1: 44, surface: 'wood', why: 'the pond dock' },
  ]),
  [SceneKey.Beach]: { path: 'dirt', floor: null, edge: 'sand', water: 'sea', zones: [
    { x0: 67, y0: 5, x1: 70, y1: 11, surface: 'wood', why: 'wooden stairs down the cliff' },
  ] },
  [SceneKey.Mountain]: outdoor('dirt', null),
  [SceneKey.Mines]: { path: 'stone', floor: 'stone', edge: 'stone', zones: [], water: null },
  [SceneKey.Dungeon]: { path: 'stone', floor: 'stone', edge: 'stone', zones: [], water: null },
  [SceneKey.GatePlaza]: outdoor('dirt', null, [
    { x0: 12, y0: 6, x1: 24, y1: 13, surface: 'stone', why: 'the portal steps and the paved court' },
    { x0: 14, y0: 13, x1: 22, y1: 17, surface: 'dirt', why: 'the dirt path south to the farm' },
  ]),
  [SceneKey.Home]: WOOD_ROOM,
  [SceneKey.Tavern]: WOOD_ROOM,
  [SceneKey.Bedroom]: WOOD_ROOM,
  [SceneKey.Jail]: WOOD_ROOM,
  [SceneKey.Market]: WOOD_ROOM,
  [SceneKey.Museum]: WOOD_ROOM,
  [SceneKey.Clinic]: WOOD_ROOM,
  [SceneKey.Guild]: WOOD_ROOM,
  [SceneKey.Ranch]: WOOD_ROOM,
  [SceneKey.TownBar]: WOOD_ROOM,
  [SceneKey.Carpenter]: WOOD_ROOM,
  [SceneKey.FishingShop]: WOOD_ROOM,
  [SceneKey.Alchemy]: WOOD_ROOM,
  [SceneKey.Tailor]: WOOD_ROOM,
  [SceneKey.Forge]: { ...WOOD_ROOM, zones: [
    { x0: 0, y0: 0, x1: 23, y1: 18, surface: 'stone', why: 'the smithy floor and the stone exit steps (the living room east is wood)' },
  ] },
  [SceneKey.Magic]: { ...WOOD_ROOM, zones: [
    { x0: 0, y0: 0, x1: 18, y1: 16, surface: 'stone', why: 'the flagstone shop floor (the private wing east is wood)' },
  ] },
};

/**
 * The plan of one scene.
 * @throws when the key is not a world scene (a caller bug: only world scenes have keepers walking)
 */
export function soundPlan(key: SceneKey): ScenePlan {
  const plan = (SOUND_PLANS as Partial<Record<SceneKey, ScenePlan>>)[key];
  if (!plan) throw new Error(`SoundPlans: ${key} is not a world scene and has no sound plan`);
  return plan;
}

/** The surface of each plain ground, given the plan's choices for paths, floors and banks. */
function groundSurface(ground: Ground, plan: ScenePlan, key: SceneKey): FootSurface {
  switch (ground) {
    case 'grass': return 'grass';
    case 'sand': return 'sand';
    case 'stone':
    case 'cave': return 'stone';
    case 'dirt': return plan.path;
    case 'water':
    case 'cliff': return plan.edge;
    case 'floor':
      if (!plan.floor) throw new Error(`SoundPlans: ${key} has floor ground but its plan has no floor surface`);
      return plan.floor;
  }
}

/**
 * The footstep surface at one tile.
 * @param key the scene the keeper walks in
 * @param map that scene's map data (its Ground grid)
 * @param tx tile column of the feet
 * @param ty tile row of the feet
 * @throws when the tile is outside the map (the feet are always on the map)
 */
export function footSurfaceAt(key: SceneKey, map: MapData, tx: number, ty: number): FootSurface {
  const ground = map.ground[ty]?.[tx];
  if (ground === undefined) throw new Error(`SoundPlans: feet tile (${tx},${ty}) is outside ${key} (${map.w}x${map.h})`);
  const plan = soundPlan(key);
  for (const zone of plan.zones) {
    if (tx >= zone.x0 && tx < zone.x1 && ty >= zone.y0 && ty < zone.y1) return zone.surface;
  }
  return groundSurface(ground, plan, key);
}
