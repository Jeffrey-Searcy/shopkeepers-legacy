/** Map-specific model adapter for the shared layout desk; farm documents keep their original format. */
import { SceneKey } from '../config/AssetKeys';
import { getAuthoredMapData, type MapData } from '../world/MapDef';
import {
  createFarmLayoutDraft, compileFarmLayoutDraft, getFarmLayoutEntities, moveFarmLayoutEntity,
  paintFarmLayoutTiles, parseFarmLayoutDraft, serializeFarmLayoutDraft, FARM_DRAFT_MAX_BYTES,
  type FarmLayoutDraft, type FarmLayoutEntity,
} from './FarmLayoutDraft';
import { readFarmLayoutDraft, writeFarmLayoutDraft, writeFarmLayoutPreviewSnapshot } from './FarmLayoutStorage';
import {
  createTownLayoutDraft, compileTownLayoutDraft, getTownLayoutEntities, moveTownLayoutEntity,
  paintTownLayoutTiles, parseTownLayoutDraft, serializeTownLayoutDraft, TOWN_DRAFT_MAX_BYTES,
  getTownWorkshopMapData, type TownLayoutDraft,
} from './TownLayoutDraft';
import { readTownLayoutDraft, writeTownLayoutDraft, writeTownLayoutPreviewSnapshot } from './TownLayoutStorage';

/** Distinct document formats are narrowed before reaching either map's strict validator. */
export type WorkshopDraft = FarmLayoutDraft | TownLayoutDraft;
/** Plot footprints share pointer geometry with existing objects, but have no image or collider. */
export type WorkshopEntity = Omit<FarmLayoutEntity, 'group'> & { group: FarmLayoutEntity['group'] | 'plot' };
/** The two authored maps offered by the development desk. */
export type WorkshopMap = 'farm' | 'town';

/** Narrow a farm document without accepting a town document into its legacy schema. */
function farm(draft: WorkshopDraft): FarmLayoutDraft {
  if (!('shop' in draft)) throw new Error('A town layout cannot be used in the farm workshop.');
  return draft;
}
/** Narrow a town document without silently coercing an imported farm document. */
function town(draft: WorkshopDraft): TownLayoutDraft {
  if (!('map' in draft) || draft.map !== 'town') throw new Error('A farm layout cannot be used in the town workshop.');
  return draft;
}

/** Dispatch validated model operations; owns no state, scene, history or browser routing. */
export class LayoutWorkshop {
  readonly base: MapData;
  readonly maxBytes: number;
  /** Select one known authored map for the lifetime of this editor page. */
  constructor(readonly map: WorkshopMap) {
    this.base = map === 'farm' ? getAuthoredMapData(SceneKey.Farm) : getTownWorkshopMapData();
    this.maxBytes = map === 'farm' ? FARM_DRAFT_MAX_BYTES : TOWN_DRAFT_MAX_BYTES;
  }
  /** Read only the selected map's draft namespace. */
  read(): WorkshopDraft { return this.map === 'farm' ? readFarmLayoutDraft() : readTownLayoutDraft(); }
  /** Create a detached authored baseline, not a gameplay save. */
  create(): WorkshopDraft { return this.map === 'farm' ? createFarmLayoutDraft() : createTownLayoutDraft(); }
  /** Compile a validated draft into detached terrain and geometry. */
  compile(draft: WorkshopDraft): MapData {
    return this.map === 'farm' ? compileFarmLayoutDraft(farm(draft)) : compileTownLayoutDraft(town(draft));
  }
  /** Return detached picking records for the selected model. */
  entities(draft: WorkshopDraft): WorkshopEntity[] {
    return this.map === 'farm' ? getFarmLayoutEntities(farm(draft)) : getTownLayoutEntities(town(draft));
  }
  /** Move one stable identity; validation rejects the entire candidate on failure. */
  move(draft: WorkshopDraft, id: string, tx: number, ty: number): WorkshopDraft {
    return this.map === 'farm' ? moveFarmLayoutEntity(farm(draft), id, tx, ty) : moveTownLayoutEntity(town(draft), id, tx, ty);
  }
  /** Paint one atomic path/grass stroke using the map's protected terrain rules. */
  paint(draft: WorkshopDraft, tiles: Array<{ tx: number; ty: number }>, ground: 'grass' | 'dirt'): WorkshopDraft {
    return this.map === 'farm' ? paintFarmLayoutTiles(farm(draft), tiles, ground) : paintTownLayoutTiles(town(draft), tiles, ground);
  }
  /** Persist only the map-specific editor key after strict validation. */
  save(draft: WorkshopDraft): void {
    if (this.map === 'farm') writeFarmLayoutDraft(farm(draft)); else writeTownLayoutDraft(town(draft));
  }
  /** Write the selected map's frozen preview handoff, never an adventure slot. */
  preview(draft: WorkshopDraft): void {
    if (this.map === 'farm') writeFarmLayoutPreviewSnapshot(farm(draft)); else writeTownLayoutPreviewSnapshot(town(draft));
  }
  /** Parse only the current map's bounded export format. */
  parse(text: string): WorkshopDraft { return this.map === 'farm' ? parseFarmLayoutDraft(text) : parseTownLayoutDraft(text); }
  /** Produce canonical JSON through the exact model validator. */
  serialize(draft: WorkshopDraft): string {
    return this.map === 'farm' ? serializeFarmLayoutDraft(farm(draft)) : serializeTownLayoutDraft(town(draft));
  }
}
