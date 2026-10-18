/**
 * Stable town businesses, measured entry geometry and room sizes. Painted rooms take their size from the
 * painting and have no fixtures; the built clinic keeps its authored public-room fixtures. No player save state lives here.
 */
import { SceneKey, TextureKey } from './AssetKeys';
import { TILE } from './GameConfig';
import type { Rotation } from './Furniture';
import type { TownPlot } from '../world/TownPlanning';
import { civicInteriorBlueprint } from './CivicInteriors';
import { JAIL_TILES } from '../world/CivicRoomArt';
import { TOWN_DOORS } from '../world/TownArt';

/** Stable content ID, independent of provisional owner names or appearance selection. */
export type TownBuildingId = 'market' | 'forge' | 'museum' | 'magic' | 'clinic' | 'guild' | 'ranch' | 'bar' | 'carpenter' | 'fishing' | 'alchemy' | 'tailor';
/** Service-only building IDs never become resident homes or romance identities. */
export type TownServiceBuildingId = 'guardhouse';
/** Authored public fixture: immutable furniture art, not an item the player owns or can collect. */
export interface CivicFixture { item: string; tx: number; ty: number; rotation: Rotation }
/** A business owns one permanent scene key; its exterior follows its existing plot. */
export interface TownBuildingFacade {
  id: TownBuildingId | TownServiceBuildingId; name: string; plotId: string; scene: SceneKey; texture: TextureKey; width: number;
  /** Optional source crop lets a service building reuse an approved architectural family. */
  artId?: TownBuildingId;
  /** Native-pixel aperture center from the facade's left edge; measured art registration never changes collision implicitly. */
  doorOffsetX: number;
  accent: number; room: { w: number; h: number; fixtures: readonly CivicFixture[] };
}
/** Resident-owned civic building. Service buildings use the facade contract without entering this type. */
export interface TownBuilding extends TownBuildingFacade { id: TownBuildingId }
/** Construct declarative fixtures while retaining explicit tile anchors and rotations. */
function fixture(item: string, tx: number, ty: number, rotation: Rotation = 0): CivicFixture { return { item, tx, ty, rotation }; }
/**
 * A painted room's size comes from its painting (CivicInteriors / CivicRoomArt). Painted rooms have no
 * fixtures: every counter, table and bed is part of the painting and of its walk rows.
 * @param id the painted building
 */
function paintedRoom(id: TownBuildingId): { w: number; h: number; fixtures: readonly CivicFixture[] } {
  const room = civicInteriorBlueprint(id);
  if (room.layout !== 'painted') throw new Error(`Town buildings: ${id} is not a painted room`);
  return { w: room.w, h: room.h, fixtures: [] };
}
/** The twelve approved architectural roles use different footprints, room plans and accents. */
export const TOWN_BUILDINGS: readonly TownBuilding[] = [
  { id: 'market', name: 'General Market', plotId: 'plot:01', scene: SceneKey.Market, texture: TextureKey.TownMarket, width: 160, doorOffsetX: 100, accent: 0xb47b43,
    room: paintedRoom('market') },
  { id: 'magic', name: 'Enchanter’s Cottage', plotId: 'plot:02', scene: SceneKey.Magic, texture: TextureKey.TownMagic, width: 128, doorOffsetX: 65, accent: 0x82649c,
    room: paintedRoom('magic') },
  { id: 'bar', name: 'The Wayfarer', plotId: 'plot:03', scene: SceneKey.TownBar, texture: TextureKey.TownBar, width: 160, doorOffsetX: 80, accent: 0x994f41,
    room: paintedRoom('bar') },
  { id: 'carpenter', name: 'Carpenter’s Workshop', plotId: 'plot:04', scene: SceneKey.Carpenter, texture: TextureKey.TownCarpenter, width: 176, doorOffsetX: 111, accent: 0xa07749,
    room: paintedRoom('carpenter') },
  { id: 'museum', name: 'Museum & Library', plotId: 'plot:05', scene: SceneKey.Museum, texture: TextureKey.TownMuseum, width: 176, doorOffsetX: 88, accent: 0x647c91,
    room: paintedRoom('museum') },
  { id: 'guild', name: 'Watch & Adventurers’ Lodge', plotId: 'plot:06', scene: SceneKey.Guild, texture: TextureKey.TownGuild, width: 160, doorOffsetX: 80, accent: 0x71808b,
    room: paintedRoom('guild') },
  { id: 'clinic', name: 'Garden Clinic', plotId: 'plot:07', scene: SceneKey.Clinic, texture: TextureKey.TownClinic, width: 144, doorOffsetX: 54, accent: 0x79906a,
    room: { w: civicInteriorBlueprint('clinic').w, h: civicInteriorBlueprint('clinic').h, fixtures: [fixture('table', 4, 6), fixture('chair', 5, 5), fixture('table', 14, 6, 1), fixture('chair', 3, 11), fixture('chair', 5, 11), fixture('rug', 9, 11)] } },
  { id: 'ranch', name: 'Meadow Ranch', plotId: 'plot:08', scene: SceneKey.Ranch, texture: TextureKey.TownRanch, width: 192, doorOffsetX: 85, accent: 0x9c794f,
    room: paintedRoom('ranch') },
  { id: 'fishing', name: 'Fishing & Tackle', plotId: 'plot:09', scene: SceneKey.FishingShop, texture: TextureKey.TownFishing, width: 160, doorOffsetX: 79, accent: 0x568b91,
    room: paintedRoom('fishing') },
  { id: 'tailor', name: 'Thread & Dye', plotId: 'plot:10', scene: SceneKey.Tailor, texture: TextureKey.TownTailor, width: 160, doorOffsetX: 84, accent: 0xb77b83,
    room: paintedRoom('tailor') },
  { id: 'alchemy', name: 'Alchemy House', plotId: 'plot:11', scene: SceneKey.Alchemy, texture: TextureKey.TownAlchemy, width: 176, doorOffsetX: 79, accent: 0x588a7e,
    room: paintedRoom('alchemy') },
  { id: 'forge', name: 'Ember Forge', plotId: 'plot:12', scene: SceneKey.Forge, texture: TextureKey.TownForge, width: 192, doorOffsetX: 86, accent: 0x996047,
    room: paintedRoom('forge') },
];

/** The north-gate watch house is a service location, not a thirteenth romanceable home. */
export const GUARDHOUSE_BUILDING: Readonly<TownBuildingFacade> = {
  id: 'guardhouse', name: 'Town Watch House', plotId: 'future:transit', scene: SceneKey.Jail,
  texture: TextureKey.TownGuild, artId: 'guild', width: 128, doorOffsetX: 64, accent: 0x6f4a43,
  room: { w: JAIL_TILES.w, h: JAIL_TILES.h, fixtures: [] },
};

/** Resolve a stable building or fail before scene travel can mutate player state. */
export function townBuilding(id: TownBuildingId): TownBuilding {
  const result = TOWN_BUILDINGS.find(building => building.id === id);
  if (!result) throw new Error(`Town buildings: unknown building ${id}`);
  return result;
}
/** Public interiors are fixed town property, not player-owned decorating space. */
export function isCivicInterior(scene: SceneKey): boolean { return TOWN_BUILDINGS.some(building => building.scene === scene); }
/**
 * The door of one building on the painted Town (see TOWN_DOORS in TownArt): what the Town scene, the resident
 * routes and the world-routes atlas all need to find it.
 * @param building the business or the watch house
 * @returns doorTx/doorTy, the left of the two door tiles (the door warp); centerX/sillY, the world pixel at the
 *   middle of the door's bottom edge; arrival, the tile two rows below the door where the keeper and residents
 *   come back out; returnSpawn, the Town spawn id of that arrival
 */
export function townDoor(building: TownBuildingFacade) {
  const door = TOWN_DOORS[building.id];
  const centerX = (door.tx + 1) * TILE, sillY = (door.ty + 1) * TILE;
  return { doorTx: door.tx, doorTy: door.ty, centerX, sillY, arrival: { tx: door.tx, ty: door.ty + 2 }, returnSpawn: `from_${building.id}` };
}
/**
 * Geometry of a building on the hand-built 120x110 Town (save version 26 and older), derived from its plot,
 * never image alpha; all returned coordinates use whole native pixels/tiles. Only TownMap (kept for old-save
 * migration) uses it; the painted Town uses townDoor.
 */
export function townBuildingGeometry(building: TownBuildingFacade, plot: TownPlot) {
  if (building.plotId !== plot.id || building.width > plot.w * TILE) throw new Error(`Town buildings: invalid plot for ${building.id}`);
  if (!Number.isInteger(building.doorOffsetX) || building.doorOffsetX < 24 || building.doorOffsetX > building.width - 24) {
    throw new Error(`Town buildings: invalid native door registration for ${building.id}`);
  }
  const facadeLeft = plot.tx * TILE + Math.floor((plot.w * TILE - building.width) / 2);
  const doorTx = Math.round((facadeLeft + building.doorOffsetX) / TILE) - 1, doorTy = plot.ty + plot.h - 4;
  const centerX = (doorTx + 1) * TILE, sillY = (doorTy + 1) * TILE;
  return { doorTx, doorTy, centerX, sillY, x: centerX - building.doorOffsetX,
    wall: { tx: Math.floor((centerX - building.doorOffsetX) / TILE) + 1, ty: doorTy - 2, w: building.width / TILE - 2, h: 3 },
    porch: { x: centerX - 40, y: sillY, w: 80, h: 16 },
    arrival: { tx: doorTx, ty: doorTy + 3 }, returnSpawn: `from_${building.id}` };
}
