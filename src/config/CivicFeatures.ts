/** Service-specific public fixtures share exact floor footprints between room collision and native decoration. */
import type { TownBuildingId } from './TownBuildings';

/** Decorative fixtures have no buying, crafting, sleeping, or pickup behavior. */
export type CivicFeatureKind = 'shelf' | 'books' | 'exhibit' | 'bed' | 'anvil' | 'kegs' | 'hay' | 'fabric' | 'herbs' | 'retort' | 'fish-rack' | 'lumber' | 'crystal' | 'armor' | 'tools' | 'rope' | 'mannequin' | 'coal';
/** Whole-tile solid footprint; tall artwork projects north of its floor base. */
export interface CivicFeature { kind: CivicFeatureKind; tx: number; ty: number; w: number; h: number }
/** Construct an explicit floor fixture; dimensions are not inferred from its texture. */
function prop(kind: CivicFeatureKind, tx: number, ty: number, w: number, h = 1): CivicFeature { return { kind, tx, ty, w, h }; }
/**
 * Each role gets practical cues; narrow pedestals use one floor tile so artwork never hides wide invisible barriers.
 * Painted rooms list none: their shelves, exhibits and beds are part of the painting and its walk rows.
 */
export const CIVIC_FEATURES: Readonly<Record<TownBuildingId, readonly CivicFeature[]>> = {
  market: [],
  magic: [],
  bar: [],
  carpenter: [],
  museum: [],
  guild: [],
  clinic: [prop('bed', 13, 10, 2, 2), prop('herbs', 3, 4, 3)],
  ranch: [],
  fishing: [],
  tailor: [],
  alchemy: [],
  forge: [],
};
