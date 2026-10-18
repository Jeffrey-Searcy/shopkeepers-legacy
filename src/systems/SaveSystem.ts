/**
 * SaveSystem — the sole authority for the game's three browser-local save slots.
 *
 * Each exact localStorage key stores one versioned envelope. Reads validate size, JSON, envelope,
 * and the complete detached GameState candidate before live state changes. Corrupt slots remain
 * visible and deletable from the title screen; they are never guessed, repaired, or partially loaded.
 */
import { GameState, type GameSaveData } from '../state/GameState';
import { TILE } from '../config/GameConfig';
import { getMapData, getLegacyFarmMapData, getLegacyTownRegionMapData } from '../world/MapDef';
import type { MapData } from '../world/MapDef';
import { SceneKey } from '../config/AssetKeys';
import { createLegacyTavernState, validateLegacyTavernState } from '../config/Tavern';
import { originalAppearance } from '../config/Appearance';
import { intersectsShopStructure } from '../config/Shop';
import { furnitureCells, furnitureDefinition } from '../config/Furniture';
import { mapEditorMode } from '../debug/MapEditorMode';
import { migrateFarmLayout } from './FarmLayoutMigration';
import { migratePaintedTown, migrateTownLayout, migrateTownBuildings, settleRepaintedRegion } from './TownLayoutMigration';
import { getAuthoredTownMap, getUnbuiltTownMap } from '../world/TownMap';
import { residentChatNotesStorageKey, residentGiftMemoryStorageKey } from './ResidentChatStorage';
import { townSocialNotesStorageKey } from './TownSocialStorage';
import { townBuilding } from '../config/TownBuildings';
import { CIVIC_ROOM_ART, type PaintedCivicId } from '../world/CivicRoomArt';
import { feetBoxHitsFineWall } from '../world/FineCollision';

export const SAVE_VERSION = 30;
export const SAVE_SLOT_COUNT = 3;
export const MAX_SAVE_BYTES = 2_000_000;
export type SaveSlot = 1 | 2 | 3;

interface SaveEnvelope {
  version: number;
  slot: SaveSlot;
  savedAt: number;
  state: GameSaveData;
}

/** Public metadata used to render one title-screen card without exposing the full payload. */
export type SaveSlotInfo =
  | { slot: SaveSlot; status: 'empty' }
  | {
      slot: SaveSlot;
      status: 'ready';
      savedAt: number;
      day: number;
      season: 'spring' | 'summer' | 'fall' | 'winter';
      gold: number;
      activeScene: string;
    }
  | { slot: SaveSlot; status: 'corrupt'; reason: string };

let activeSlot: SaveSlot | null = null;
/** Only successful load installs a notice; read-only slot inspection never changes this queue. */
let migrationNotice: string | null = null;

/** Deny gameplay save access before sandbox map validation can read, overwrite, or mislabel real slots. */
function assertGameplaySaveAccess(): void {
  if (mapEditorMode() !== null) {
    throw new Error('Gameplay saves are unavailable in the farm editor and its preview. Return to normal play to use save slots.');
  }
}

/** Assert and narrow a caller-provided slot number. */
function validSlot(slot: number): SaveSlot {
  if (!Number.isInteger(slot) || slot < 1 || slot > SAVE_SLOT_COUNT) {
    throw new Error(`SaveSystem: invalid slot ${slot}; expected 1..${SAVE_SLOT_COUNT}`);
  }
  return slot as SaveSlot;
}

/** Give each real adventure a distinct durable social network while tests remain reproducible. */
function newAdventureSocialSeed(slot: SaveSlot): number {
  const params = new URLSearchParams(window.location.search);
  if (params.get('test') === '1') {
    const requested = Number(params.get('seed'));
    if (!Number.isSafeInteger(requested)) throw new Error('SaveSystem: deterministic test seed is invalid');
    return ((requested >>> 0) ^ Math.imul(slot, 0x9e3779b1)) >>> 0 || slot;
  }
  if (!globalThis.crypto?.getRandomValues) throw new Error('SaveSystem: secure social seed generation is unavailable');
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0] || 0x9e3779b9;
}

/** Validate the queued feet position against its destination map before inspection or mutation. */
function assertResumePosition(slot: SaveSlot, candidate: GameState, farm: MapData = getMapData(SceneKey.Farm),
  region: ReadonlyMap<SceneKey, MapData> = new Map()): void {
  const snapshot = region.get(candidate.activeScene);
  const map = candidate.activeScene === SceneKey.Farm ? farm : snapshot === undefined ? getMapData(candidate.activeScene) : snapshot;
  const width = map.w * TILE;
  const height = map.h * TILE;
  const { x, y } = candidate.player;
  if (x < 0 || x > width || y < 0 || y > height) {
    throw new Error(
      `SaveSystem: Slot ${slot} player position (${x},${y}) is outside ${candidate.activeScene} bounds ${width}x${height}`
    );
  }
}

/**
 * Maps with fine walls (MapData.fineSolid), each with the save version that brought them in.
 *  - scene: the map;
 *  - version: saves older than this were made on whole-tile walls, so the keeper may stand where the fine
 *    walls now block part of the ground; such a keeper moves to the arrival. From this version up a keeper in
 *    a fine wall is a broken save and fails loudly;
 *  - arrival: the spawn the keeper moves to;
 *  - name, arrivalLabel: words for the load notice.
 * why: a map that gains fine walls, or whose wall edits change after saves exist, needs a new entry or a new
 * version here; validateFineWallPosition fails loudly for a map with fine walls and no entry.
 */
const FINE_WALL_AREAS: ReadonlyArray<{ scene: SceneKey; version: number; arrival: string; name: string; arrivalLabel: string }> = [
  // Save version 28 (October 2026): the painted Town's walls trimmed to a quarter tile (TOWN_WALL_EDITS).
  // Save version 29 (October 2026): the Town was redrawn as pixel art and its walls re-fitted to the new picture,
  // so a version 28 keeper may now stand in a wall; such a keeper moves to the plaza like an older one.
  { scene: SceneKey.Town, version: 29, arrival: 'start', name: 'Town', arrivalLabel: 'the plaza' },
];

/**
 * Check that the keeper's feet box is clear of the fine walls of the map it resumes on (see FINE_WALL_AREAS).
 * A save from before that map's fine walls moves a keeper who now stands in a wall to the arrival, with a
 * notice; a newer save with the keeper in a wall is rejected.
 * @param candidate the validated state, already moved onto today's maps (changed in place when it moves)
 * @param version the save envelope version (SAVE_VERSION when saving)
 * @param notices the load notices shown to the player (a line is added when the keeper moves)
 * @throws when the map has fine walls but no FINE_WALL_AREAS entry, when its arrival spawn is missing, or
 *   when a save at or after the entry's version has the keeper in a wall
 */
function validateFineWallPosition(candidate: GameState, version: number, notices: string[]): void {
  const map = getMapData(candidate.activeScene);
  if (!map.fineSolid) return;
  const area = FINE_WALL_AREAS.find(entry => entry.scene === candidate.activeScene);
  if (!area) throw new Error(`SaveSystem: ${candidate.activeScene} has fine walls but no FINE_WALL_AREAS entry`);
  const { x, y } = candidate.player;
  if (!feetBoxHitsFineWall(map.fineSolid, x, y)) return;
  if (version >= area.version) {
    throw new Error(`SaveSystem: player position (${x},${y}) is inside a ${candidate.activeScene} wall`);
  }
  const spawn = map.spawns.find(entry => entry.id === area.arrival);
  if (!spawn) throw new Error(`SaveSystem: ${candidate.activeScene} is missing the fine wall arrival "${area.arrival}"`);
  candidate.player = { ...candidate.player, x: (spawn.tx + 0.5) * TILE, y: (spawn.ty + 0.5) * TILE, facing: 'down' };
  notices.push(`The ${area.name} walls now follow the painting more closely. Your keeper stood where there is now a wall, so they start at ${area.arrivalLabel}.`);
}

/** Redirect saves parked in the rejected temporary room before any world scene can render it. */
function normalizeLegacyHome(candidate: GameState, farm: MapData): void {
  if (candidate.activeScene !== SceneKey.Home) return;
  const spawn = farm.spawns.find((entry) => entry.id === 'from_home');
  if (!spawn) throw new Error('SaveSystem: Farm is missing required legacy Home redirect spawn "from_home"');
  candidate.activeScene = SceneKey.Farm;
  candidate.player = {
    ...candidate.player,
    x: spawn.tx * TILE + TILE / 2,
    y: spawn.ty * TILE + TILE / 2,
    facing: 'down',
  };
}

/**
 * Versions1–3 predate physical porch edges. Move only a keeper inside the newly solid geometry
 * to the existing named exterior arrival. Version4 already knows that geometry and rejects it.
 * Stored bytes are never rewritten by inspection/loading, and ordinary positions remain exact.
 */
function validatePorchPosition(candidate: GameState, version: number, farm: MapData = getMapData(SceneKey.Farm),
  arrivalFarm: MapData = farm): void {
  if (candidate.activeScene !== SceneKey.Farm) return;
  if (!farm.shopOffset) throw new Error('SaveSystem: validation farm is missing its explicit shop offset');
  if (!intersectsShopStructure(candidate.player.x, candidate.player.y, farm.shopOffset)) return;
  if (version >= 4) throw new Error('SaveSystem: player position intersects solid shop porch structure');
  const spawn = arrivalFarm.spawns.find(entry => entry.id === 'from_home');
  if (!spawn) throw new Error('SaveSystem: Farm is missing the porch migration spawn "from_home"');
  candidate.player = { ...candidate.player, x: (spawn.tx + 0.5) * TILE, y: (spawn.ty + 0.5) * TILE, facing: 'down' };
}

/**
 * Versions1–4 store one-cell furniture without orientation. Add only that known schema field;
 * leave every original record for strict candidate validation before any recovery occurs.
 */
function migrateLegacyFurnitureSchema(state: unknown): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('SaveSystem: legacy furniture state must be an object');
  }
  const record = state as Record<string, unknown>;
  if (!Array.isArray(record.placedItems)) throw new Error('SaveSystem: legacy placedItems must be an array');
  return { ...record, placedItems: record.placedItems.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('SaveSystem: legacy furniture entry must be an object');
    }
    return { ...entry, rotation: 0 };
  }) };
}

/** Exact newly-solid cells verified against the pre-v6 room maps; no general corruption recovery. */
function newlySolidRoomCell(scene: SceneKey, tx: number, ty: number): boolean {
  return (scene === SceneKey.Tavern && ((ty === 2 && tx >= 1 && tx <= 28) ||
    ((ty === 3 || ty === 4) && tx >= 26 && tx <= 28))) ||
    (scene === SceneKey.Bedroom && ty === 2 && tx >= 1 && tx <= 18);
}

/** The moved rear doorway also consumes two formerly legal floor cells below its threshold. */
function newlyReservedDoorCell(scene: SceneKey, tx: number, ty: number): boolean {
  return scene === SceneKey.Tavern && (tx === 22 || tx === 23) && (ty === 2 || ty === 3);
}

/** Physics carves authored warp openings even when the source solid grid contains wall tiles. */
function solidRoomCell(map: MapData, tx: number, ty: number): boolean {
  return map.solid[ty][tx] && !map.warps.some(warp => tx >= warp.tx && tx < warp.tx + warp.w && ty >= warp.ty && ty < warp.ty + warp.h);
}

/**
 * Versions 3–20 saved nine wardrobe fields. Version 21 adds body, garment and facialHair. Those older saves
 * always drew the original body with no outerwear and a bare face, so exactly those three values preserve
 * the saved look. The nine older fields are not touched here; GameState still validates every one of them.
 * @param state Parsed save state of a version 3–20 envelope.
 * @param slot Slot number, only for error messages.
 * Like every other version step here (see GameState.candidateFromSaveData: v17 mail, v18 progress, v20 social),
 * the envelope version decides the schema: a field that version 21 adds is set from the version, never read
 * from a version 3–20 payload.
 * @returns A shallow copy of the state whose appearance carries the three new fields.
 * @throws If the state or its appearance is not an object.
 */
function migrateWardrobeShapes(state: unknown, slot: SaveSlot): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`SaveSystem: Slot ${slot} pre-v21 state must be an object`);
  }
  const appearance: unknown = (state as { appearance?: unknown }).appearance;
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) {
    throw new Error(`SaveSystem: Slot ${slot} pre-v21 appearance must be an object`);
  }
  return { ...state, appearance: { ...appearance, body: 'original', garment: 'none', facialHair: 'none' } };
}

/** Named outdoor arrivals and warp cells become protected placement targets in version6. */
function outdoorArrivalCell(map: MapData, tx: number, ty: number): boolean {
  return map.spawns.some(spawn => spawn.tx === tx && spawn.ty === ty) ||
    map.warps.some(warp => tx >= warp.tx && tx < warp.tx + warp.w && ty >= warp.ty && ty < warp.ty + warp.h);
}

/**
 * Find nearby reachable ground for one recovered item when its bag is full. Search only through
 * walkable terrain, avoid surviving furniture/resources/soil and never occupy another arrival.
 * No safe ground means explicit load rejection, leaving the source bytes and live state intact.
 */
function outdoorRecoveryDrop(candidate: GameState, map: MapData, anchor: { tx: number; ty: number }): { tx: number; ty: number } {
  if (map.key === SceneKey.Farm && !map.shopOffset) throw new Error('SaveSystem: recovery farm shop offset is missing');
  const blocked = new Set<string>();
  for (const placed of candidate.placedItems) {
    if (placed.scene === map.key && furnitureDefinition(placed.item).blocking) {
      for (const cell of furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation)) blocked.add(`${cell.tx},${cell.ty}`);
    }
  }
  for (const object of map.objects) {
    if (!Object.prototype.hasOwnProperty.call(candidate.removedNodes, `${map.key}:${object.tx},${object.ty}`)) {
      blocked.add(`${object.tx},${object.ty}`);
    }
  }
  /** Warp openings follow the same carved-solid rule as world physics. */
  const walkable = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h &&
    !solidRoomCell(map, tx, ty) && map.ground[ty][tx] !== 'water' && !blocked.has(`${tx},${ty}`) &&
    !(map.key === SceneKey.Farm && intersectsShopStructure((tx + 0.5) * TILE, (ty + 0.5) * TILE, map.shopOffset));
  const queue = [{ tx: anchor.tx, ty: anchor.ty }];
  const reached = new Set([`${anchor.tx},${anchor.ty}`]);
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index];
    const scoped = `${map.key}:${tile.tx},${tile.ty}`;
    if (walkable(tile.tx, tile.ty) && !outdoorArrivalCell(map, tile.tx, tile.ty) &&
      !(map.reservedTiles && map.reservedTiles.some(cell => cell.tx === tile.tx && cell.ty === tile.ty)) &&
      !candidate.tiles[scoped] && !candidate.crops[scoped]) return tile;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const tx = tile.tx + dx, ty = tile.ty + dy, key = `${tx},${ty}`;
      if (reached.has(key) || !walkable(tx, ty)) continue;
      reached.add(key);
      queue.push({ tx, ty });
    }
  }
  throw new Error(`SaveSystem: no safe ground for recovered outdoor furnishing in ${map.key}`);
}

/** Recover only pre-v6 furniture on newly protected outdoor arrivals; other placements stay exact. */
function recoverLegacyOutdoorArrivals(candidate: GameState, version: number, notices: string[], farm: MapData,
  region: ReadonlyMap<SceneKey, MapData>): void {
  const maps = new Map<SceneKey, MapData>();
  const recovered: GameState['placedItems'] = [];
  candidate.placedItems = candidate.placedItems.filter(placed => {
    if (!maps.has(placed.scene)) {
      const snapshot = region.get(placed.scene);
      maps.set(placed.scene, placed.scene === SceneKey.Farm ? farm : snapshot === undefined ? getMapData(placed.scene) : snapshot);
    }
    const map = maps.get(placed.scene);
    if (!map) throw new Error('SaveSystem: outdoor recovery map is missing');
    if (map.interior) return true;
    const cells = version <= 4 || placed.item === 'workbench' ? [{ tx: placed.tx, ty: placed.ty }] :
      furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation);
    if (!cells.some(cell => outdoorArrivalCell(map, cell.tx, cell.ty))) return true;
    recovered.push(placed);
    return false;
  });
  for (const placed of recovered) {
    if (candidate.inventory[placed.item] === Number.MAX_SAFE_INTEGER || !candidate.addItem(placed.item, 1)) {
      const map = maps.get(placed.scene);
      if (!map) throw new Error('SaveSystem: recovered furnishing map is missing');
      const tile = outdoorRecoveryDrop(candidate, map, placed);
      candidate.groundDrops.push({ item: placed.item, scene: placed.scene, ...tile });
    }
  }
  if (recovered.length) notices.push(`${recovered.length} furnishings on outdoor arrivals moved to your bag, or safe nearby ground when the bag is full.`);
}

/**
 * Expanded table/rug footprints cannot safely grow over old neighbors. Recover each validated
 * legacy item into the detached backpack, or preserve one persistent drop at its exact old anchor.
 * Loading/inspection never modifies stored bytes, so repeated reads cannot duplicate live items.
 */
function recoverLegacyExpandedFurniture(candidate: GameState, version: number, notices: string[]): void {
  let count = 0;
  candidate.placedItems = candidate.placedItems.filter(placed => {
    if (!(version <= 4 && (placed.item === 'table' || placed.item === 'rug')) &&
      !(version <= 5 && placed.item === 'workbench')) return true;
    if (placed.scene === SceneKey.Tavern || placed.scene === SceneKey.Bedroom) {
      const map = getMapData(placed.scene);
      if (solidRoomCell(map, placed.tx, placed.ty) && !newlySolidRoomCell(placed.scene, placed.tx, placed.ty)) {
        throw new Error('SaveSystem: legacy furnishing intersects pre-existing room architecture');
      }
    }
    // A maximum-sized valid legacy stack cannot accept another exact integer either. Preserve
    // that item as a drop rather than producing a candidate that the next save would reject.
    if (candidate.inventory[placed.item] === Number.MAX_SAFE_INTEGER || !candidate.addItem(placed.item, 1)) {
      candidate.groundDrops.push({ item: placed.item, scene: placed.scene, tx: placed.tx, ty: placed.ty });
    }
    count += 1;
    return false;
  });
  if (count) notices.push(`${count} expanded furnishings moved to your bag, or to their original floor tile when the bag is full.`);
}

/**
 * The rebuilt north wall/stairs consume previously legal floor. Recover only pre-v6 furniture
 * intersecting these newly solid shop cells. A caught keeper resumes at the named entry; no bytes
 * are rewritten and the notice makes this compatibility relocation explicit.
 */
function migrateShopArchitecture(candidate: GameState, version: number, notices: string[]): void {
  for (const scene of [SceneKey.Tavern, SceneKey.Bedroom]) migrateRoomArchitecture(candidate, version, notices, scene);
}

/**
 * Scenes whose floor plan was replaced by a painted room in save version 24 (October 2026): every painted
 * civic interior and the jail. Old tile positions in these scenes point at a different room, so they mean
 * nothing in the new art.
 * why: a function, not a module constant, so the building table is read at load time and never during
 * module start-up, where an import cycle could see it unset.
 */
function repaintedScenes(): SceneKey[] {
  return [...(Object.keys(CIVIC_ROOM_ART) as PaintedCivicId[]).map(id => townBuilding(id).scene), SceneKey.Jail];
}

/**
 * A save made before version 24 may have the keeper, or a dropped item, at a tile from the old room layout
 * of a repainted scene. That tile may now be a wall, a table or a private bedroom. Move all of them to the
 * scene's door and say so in a notice. Saves from version 24 on are not touched, so a broken position in a
 * new save stays an error in the full save check.
 * why: this runs on the raw saved state, before GameState.candidateFromSaveData, because that check rejects a
 * keeper who stands inside a wall. It only reads fields it needs; the full check still validates every one.
 * @param state the raw saved state (not changed; a moved copy is returned)
 * @param version the save envelope version; only versions 23 and older are moved
 * @param notices the load notices shown to the player (a line is added when something moves)
 * @returns the state to validate, with the keeper and drops in repainted scenes moved to each door
 */
function migratePaintedRooms(state: unknown, version: number, notices: string[]): unknown {
  if (version >= 24) return state;
  // why: a broken shape is left for the full save check, which reports it with a precise message.
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  const entries = new Map<unknown, { tx: number; ty: number }>();
  for (const scene of repaintedScenes()) {
    const map = getMapData(scene);
    const entry = map.spawns.find(spawn => spawn.id === 'entry');
    if (!entry) throw new Error(`SaveSystem: ${scene} painted-room migration entry is missing`);
    if (map.solid[entry.ty][entry.tx]) throw new Error(`SaveSystem: ${scene} painted-room migration entry is blocked`);
    entries.set(scene, entry);
  }
  let next = record, movedDrops = 0;
  if (Array.isArray(record.groundDrops)) {
    const drops = record.groundDrops.map((drop: unknown) => {
      if (!drop || typeof drop !== 'object') return drop;
      const fields = drop as Record<string, unknown>;
      const entry = entries.get(fields.scene);
      if (!entry) return drop;
      movedDrops += 1;
      return { ...fields, tx: entry.tx, ty: entry.ty };
    });
    if (movedDrops) {
      next = { ...next, groundDrops: drops };
      notices.push(`${movedDrops} items left inside a redecorated building now wait at its door.`);
    }
  }
  const player = record.player;
  const entry = entries.get(record.activeScene);
  if (entry && player && typeof player === 'object' && !Array.isArray(player)) {
    next = { ...next, player: { ...(player as Record<string, unknown>), x: (entry.tx + 0.5) * TILE, y: (entry.ty + 0.5) * TILE, facing: 'up' } };
    notices.push('This building has a new look inside, so your keeper starts at its door.');
  }
  return next;
}

/**
 * Outdoor maps replaced by a painting, each with the save version that brought the painting in.
 * The painting moved the map's trees, rocks, paths and water, so tile records made on the old layout point
 * at the wrong things.
 *  - scene: the repainted map;
 *  - version: saves older than this were made on the old layout;
 *  - movedFrom: saves from this version up have their soil, things and keeper moved by migratePaintedOutdoor;
 *    older saves only lose their tree and rock records (resetPaintedNodes), because an older migration
 *    already moves their things onto today's map;
 *  - arrival: the spawn where the keeper and their moved things go;
 *  - name, arrivalLabel: words for the load notices.
 */
const REPAINTED_OUTDOORS: ReadonlyArray<{
  scene: SceneKey; version: number; movedFrom: number; arrival: string; name: string; arrivalLabel: string;
}> = [
  // Save version 25 (October 2026): the painted Beach (world/BeachArt.ts).
  { scene: SceneKey.Beach, version: 25, movedFrom: 1, arrival: 'from_town', name: 'beach', arrivalLabel: 'the top of its path' },
  // Save version 26 (October 2026): the painted Forest (world/ForestArt.ts). why: saves before version 11 were
  // made on the first Forest, and migrateTownLayout moves their things onto today's Forest after the full
  // save check (which reads them against that first Forest), so only their node records are reset here.
  { scene: SceneKey.Forest, version: 26, movedFrom: 11, arrival: 'from_farm', name: 'forest', arrivalLabel: 'the top of the Farm trail' },
  // Save version 27 (October 2026): the painted Town (world/TownArt.ts). why: the painting is 82x75 tiles, not
  // 120x110, so no old Town record can be checked against it. Every old save only loses its Town node records
  // here; the full save check reads the rest against the old Town, and migratePaintedTown then moves them.
  { scene: SceneKey.Town, version: 27, movedFrom: 27, arrival: 'start', name: 'town', arrivalLabel: 'the plaza' },
];

/**
 * Bring a save made before an outdoor map was repainted onto the new layout (see REPAINTED_OUTDOORS).
 * why: this runs on the raw saved state, before GameState.candidateFromSaveData, because that check rejects a
 * keeper standing in what is now the sea. It only reads the fields it needs; the full check validates them all.
 * @param state the raw saved state (not changed; a moved copy is returned)
 * @param version the save envelope version
 * @param notices the load notices shown to the player (a line is added for every change)
 * @returns the state to validate
 */
function migratePaintedOutdoors(state: unknown, version: number, notices: string[]): unknown {
  // why: a broken shape is left for the full save check, which reports it with a precise message.
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  let next = state as Record<string, unknown>;
  for (const area of REPAINTED_OUTDOORS) {
    if (version >= area.version) continue;
    next = version >= area.movedFrom ? migratePaintedOutdoor(next, area, notices) : resetPaintedNodes(next, area, notices);
  }
  return next;
}

/** True for a plain JSON object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Drop one repainted map's cleared-node and tree-stage records: they named the old trees and rocks, so
 * every new node stands again.
 * @param record the raw saved state
 * @param area the REPAINTED_OUTDOORS entry
 * @param notices the load notices (a line is added when any record was dropped)
 * @returns a changed copy (the input is not changed)
 */
function resetPaintedNodes(record: Record<string, unknown>, area: (typeof REPAINTED_OUTDOORS)[number], notices: string[]): Record<string, unknown> {
  const prefix = `${area.scene}:`;
  const next = { ...record };
  let clearedNodes = 0;
  for (const field of ['removedNodes', 'treeStages'] as const) {
    const value = record[field];
    if (!isRecord(value)) continue;
    const kept = Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith(prefix)));
    clearedNodes += Object.keys(value).length - Object.keys(kept).length;
    next[field] = kept;
  }
  if (clearedNodes) notices.push(`The ${area.name} has a new look, so all of its trees, rocks and weeds stand again.`);
  return next;
}

/**
 * Move one save onto one repainted outdoor map:
 *  - its cleared-node and tree-stage records are dropped (they named the old trees and rocks; every new
 *    node stands again);
 *  - tilled soil and crops stay where the new map still has open meadow, and are dropped elsewhere;
 *  - dropped items on a tile that is now blocked, and every placed furnishing (the new art can put sea or
 *    cliff under any of its cells), wait at the arrival as dropped items;
 *  - player buildings are left alone here: they are settled after the full save check (settleRepaintedRegion);
 *  - a keeper on this map starts at the arrival.
 * @param record the raw saved state
 * @param area the REPAINTED_OUTDOORS entry
 * @param notices the load notices (one line per kind of change)
 * @returns a changed copy (the input is not changed)
 * @throws when the arrival spawn is missing or blocked in the new map
 */
function migratePaintedOutdoor(record: Record<string, unknown>, area: (typeof REPAINTED_OUTDOORS)[number], notices: string[]): Record<string, unknown> {
  const map = getMapData(area.scene);
  const arrival = map.spawns.find(spawn => spawn.id === area.arrival);
  if (!arrival) throw new Error(`SaveSystem: ${area.scene} repaint migration arrival "${area.arrival}" is missing`);
  if (map.solid[arrival.ty][arrival.tx]) throw new Error(`SaveSystem: ${area.scene} repaint migration arrival is blocked`);
  const prefix = `${area.scene}:`;
  const nodeTiles = new Set(map.objects.map(obj => `${obj.tx},${obj.ty}`));
  const inside = (tx: number, ty: number): boolean => Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < map.w && ty < map.h;
  const open = (tx: number, ty: number): boolean => inside(tx, ty) && !map.solid[ty][tx] && !nodeTiles.has(`${tx},${ty}`);
  /** Tile of a "Scene:tx,ty" key on this map, or null for another map's key (malformed keys are kept for the full check). */
  const cellOf = (key: string): { tx: number; ty: number } | null => {
    const match = key.startsWith(prefix) ? /^[^:]+:(\d+),(\d+)$/.exec(key) : null;
    return match ? { tx: Number(match[1]), ty: Number(match[2]) } : null;
  };
  const next = resetPaintedNodes(record, area, notices);

  // why: soil is only ever tilled on grass, so a cell that is no longer open meadow cannot keep its soil or crop.
  const meadow = (key: string): boolean => {
    const cell = cellOf(key);
    return !cell || (inside(cell.tx, cell.ty) && !map.solid[cell.ty][cell.tx] && map.ground[cell.ty][cell.tx] === 'grass');
  };
  let lostSoil = 0, lostCrops = 0;
  if (isRecord(record.tiles)) {
    const kept = Object.fromEntries(Object.entries(record.tiles).filter(([key]) => meadow(key)));
    lostSoil = Object.keys(record.tiles).length - Object.keys(kept).length;
    next.tiles = kept;
  }
  if (isRecord(record.crops)) {
    const kept = Object.fromEntries(Object.entries(record.crops).filter(([key]) => meadow(key)));
    lostCrops = Object.keys(record.crops).length - Object.keys(kept).length;
    next.crops = kept;
  }
  if (lostSoil || lostCrops) {
    notices.push(`${lostSoil} tilled tiles and ${lostCrops} crops at the ${area.name} are no longer on open meadow in its new look, so they are gone.`);
  }

  let movedThings = 0;
  const drops: unknown[] = [];
  if (Array.isArray(record.groundDrops)) {
    for (const drop of record.groundDrops as unknown[]) {
      const blocked = isRecord(drop) && drop.scene === area.scene && !open(Number(drop.tx), Number(drop.ty));
      if (blocked) movedThings += 1;
      drops.push(blocked ? { ...(drop as Record<string, unknown>), tx: arrival.tx, ty: arrival.ty } : drop);
    }
  }
  if (Array.isArray(record.placedItems)) {
    next.placedItems = (record.placedItems as unknown[]).filter(placed => {
      if (!isRecord(placed) || placed.scene !== area.scene) return true;
      drops.push({ scene: area.scene, item: placed.item, tx: arrival.tx, ty: arrival.ty });
      movedThings += 1;
      return false;
    });
  }
  if (Array.isArray(record.groundDrops) || movedThings) next.groundDrops = drops;
  if (movedThings) notices.push(`${movedThings} of your things at the ${area.name} now wait at ${area.arrivalLabel}.`);

  if (record.activeScene === area.scene && isRecord(record.player)) {
    next.player = { ...record.player, x: (arrival.tx + 0.5) * TILE, y: (arrival.ty + 0.5) * TILE, facing: 'down' };
    notices.push(`The ${area.name} has a new look, so your keeper starts at ${area.arrivalLabel}.`);
  }
  return next;
}

/** Recover only the named room's wall conflicts and report every compatibility move explicitly. */
function migrateRoomArchitecture(candidate: GameState, version: number, notices: string[], scene: SceneKey): void {
  const map = getMapData(scene);
  const entry = map.spawns.find(spawn => spawn.id === 'entry');
  if (!entry) throw new Error(`SaveSystem: ${scene} migration entry is missing`);
  let recovered = 0;
  candidate.placedItems = candidate.placedItems.filter(placed => {
    if (placed.scene !== scene) return true;
    const intersections = furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation)
      .filter(cell => solidRoomCell(map, cell.tx, cell.ty) || newlyReservedDoorCell(scene, cell.tx, cell.ty));
    if (!intersections.length) return true;
    if (version >= 6 || intersections.some(cell => !newlySolidRoomCell(scene, cell.tx, cell.ty) && !newlyReservedDoorCell(scene, cell.tx, cell.ty))) {
      throw new Error('SaveSystem: furniture intersects solid shop architecture');
    }
    if (candidate.inventory[placed.item] === Number.MAX_SAFE_INTEGER || !candidate.addItem(placed.item, 1)) {
      candidate.groundDrops.push({ item: placed.item, scene: placed.scene, tx: placed.tx, ty: placed.ty });
    }
    recovered += 1;
    return false;
  });
  if (recovered) notices.push(`${recovered} furnishings in the rebuilt wall moved to your bag or their original floor tile.`);
  let movedDrops = 0;
  if (version <= 5) {
    candidate.groundDrops = candidate.groundDrops.map(drop => {
      if (drop.scene !== scene || drop.ty < 0 || drop.tx < 0 || drop.ty >= map.h || drop.tx >= map.w ||
        !((solidRoomCell(map, drop.tx, drop.ty) && newlySolidRoomCell(scene, drop.tx, drop.ty)) ||
          newlyReservedDoorCell(scene, drop.tx, drop.ty))) return drop;
      movedDrops += 1;
      return { ...drop, tx: entry.tx, ty: entry.ty };
    });
  }
  if (movedDrops) notices.push(`${movedDrops} items caught in the rebuilt wall now wait at the ${scene === SceneKey.Tavern ? 'shop' : 'bedroom'} entrance.`);
  if (candidate.activeScene !== scene) return;
  const tx = Math.floor(candidate.player.x / TILE);
  const ty = Math.floor(candidate.player.y / TILE);
  if (ty >= map.h || tx >= map.w || ty < 0 || tx < 0 || !solidRoomCell(map, tx, ty)) return;
  if (version >= 6 || !newlySolidRoomCell(scene, tx, ty)) throw new Error('SaveSystem: player position intersects solid shop architecture');
  if (map.solid[entry.ty][entry.tx] || candidate.placedItems.some(item => item.scene === scene &&
    furnitureDefinition(item.item).blocking && furnitureCells(item.item, item.tx, item.ty, item.rotation)
      .some(cell => cell.tx === entry.tx && cell.ty === entry.ty))) {
    throw new Error('SaveSystem: shop migration entry is blocked');
  }
  candidate.player = { ...candidate.player, x: (entry.tx + 0.5) * TILE, y: (entry.ty + 0.5) * TILE, facing: 'up' };
  notices.push(`The rebuilt north wall moved your keeper to the ${scene === SceneKey.Tavern ? 'shop' : 'bedroom'} entrance.`);
}

/**
 * Cancel the keeper's open Town meetings (accepted invites and plans not yet kept) after the Town was repainted.
 * why: each meeting stores the Town tile and the clock window of a route walked on the old Town. The painted Town
 * moves every place and every walk, so the resident would wait somewhere else, at another time, and the meeting
 * could never count. The player is told, and can make a new plan.
 * @param candidate the detached save candidate (changed in place)
 * @param notices the load notices (a line is added when anything was cancelled)
 */
function cancelTownMeetings(candidate: GameState, notices: string[]): void {
  const open = (meeting: { day: number; kept: boolean }): boolean => !meeting.kept && meeting.day >= candidate.day;
  const before = candidate.social.plans.length;
  candidate.social.plans = candidate.social.plans.filter(plan => !open(plan));
  let cancelled = before - candidate.social.plans.length;
  const invite = candidate.townLife.invite;
  if (invite && open(invite)) {
    candidate.townLife.invite = null;
    cancelled += 1;
  }
  if (cancelled) notices.push(`The Town has moved, so ${cancelled} meeting${cancelled === 1 ? '' : 's'} you agreed to in Town ${cancelled === 1 ? 'is' : 'are'} cancelled. Ask again to make a new plan.`);
}

/** Parse and fully validate one stored envelope into a detached candidate. */
function readEnvelope(slot: SaveSlot): { envelope: SaveEnvelope; candidate: GameState; notices: string[] } {
  assertGameplaySaveAccess();
  const raw = localStorage.getItem(SaveSystem.storageKey(slot));
  if (raw === null) throw new Error(`SaveSystem: Slot ${slot} is empty`);
  if (new Blob([raw]).size > MAX_SAVE_BYTES) {
    throw new Error(`SaveSystem: Slot ${slot} exceeds the ${MAX_SAVE_BYTES}-byte safety limit`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`SaveSystem: Slot ${slot} contains invalid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`SaveSystem: Slot ${slot} envelope must be an object`);
  }
  const envelope = value as Partial<SaveEnvelope>;
  if (envelope.version !== 1 && envelope.version !== 2 && envelope.version !== 3 && envelope.version !== 4 && envelope.version !== 5 && envelope.version !== 6 && envelope.version !== 7 && envelope.version !== 8 && envelope.version !== 9 && envelope.version !== 10 && envelope.version !== 11 && envelope.version !== 12 && envelope.version !== 13 && envelope.version !== 14 && envelope.version !== 15 && envelope.version !== 16 && envelope.version !== 17 && envelope.version !== 18 && envelope.version !== 19 && envelope.version !== 20 && envelope.version !== 21 && envelope.version !== 22 && envelope.version !== 23 && envelope.version !== 24 && envelope.version !== 25 && envelope.version !== 26 && envelope.version !== 27 && envelope.version !== 28 && envelope.version !== 29 && envelope.version !== SAVE_VERSION) {
    throw new Error(`SaveSystem: Slot ${slot} uses unsupported version ${String(envelope.version)}`);
  }
  if (envelope.slot !== slot) {
    throw new Error(`SaveSystem: Slot ${slot} envelope claims slot ${String(envelope.slot)}`);
  }
  if (typeof envelope.savedAt !== 'number' || !Number.isFinite(envelope.savedAt) || envelope.savedAt < 0) {
    throw new Error(`SaveSystem: Slot ${slot} has an invalid savedAt timestamp`);
  }
  // Version one predates tavern ownership. Migrate that known schema explicitly; never supply
  // missing tavern fields for version two, where absence means a damaged payload.
  let state: unknown = envelope.state;
  if (envelope.version === 1) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error(`SaveSystem: Slot ${slot} version-one state must be an object`);
    }
    state = { ...state, tavern: createLegacyTavernState() };
  }
  // Versions one and two predate cosmetics. Preserve their exact original rendered appearance.
  // Versions three and later must carry all fields: a missing wardrobe is corruption, never a migration.
  if (envelope.version === 1 || envelope.version === 2) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error(`SaveSystem: Slot ${slot} legacy state must be an object`);
    }
    state = { ...state, appearance: originalAppearance() };
  }
  if (envelope.version >= 3 && envelope.version <= 20) state = migrateWardrobeShapes(state, slot);
  if (envelope.version <= 4) state = migrateLegacyFurnitureSchema(state);
  const validationFarm = envelope.version <= 9 ? getLegacyFarmMapData() : getMapData(SceneKey.Farm);
  const validationRegion = new Map<SceneKey, MapData>();
  if (envelope.version <= 10) {
    for (const key of [SceneKey.Town, SceneKey.Forest]) validationRegion.set(key, getLegacyTownRegionMapData(key));
  } else if (envelope.version === 11) {
    validationRegion.set(SceneKey.Town, getUnbuiltTownMap());
  } else if (envelope.version <= 26) {
    // why: versions 12-26 were saved on the 120x110 built Town; migratePaintedTown moves them after the checks.
    validationRegion.set(SceneKey.Town, getAuthoredTownMap());
  }
  const notices: string[] = [];
  state = migratePaintedRooms(state, envelope.version, notices);
  state = migratePaintedOutdoors(state, envelope.version, notices);
  const candidate = GameState.candidateFromSaveData(state, envelope.version, validationFarm, validationRegion);
  if (envelope.version <= 7) {
    notices.push('Prepared meals and ale are now items in your bag. Any overflow is in chest storage. Paid rooms and money are preserved. Queued guests now wait at register fronts. Farm trees now require planting after clearing.');
    // v7 allowed side-only access. The new front queue cannot safely admit guests in that layout.
    const oldTavern = (state as GameSaveData).tavern;
    const queueDismissed = envelope.version === 7 && oldTavern.guests.some(guest =>
      guest.kind === 'inn' && (guest.phase === 'arriving' || guest.phase === 'waiting') &&
      candidate.tavern.guests.some(current => current.id === guest.id && current.phase === 'leaving'));
    if (envelope.version === 7 && ((oldTavern.innOpen && !candidate.tavern.innOpen) || queueDismissed)) {
      notices.push('Inn admissions closed because the front or back of your register is blocked. Unpaid visitors are leaving; paid rooms stay booked. Clear both sides, then reopen the inn.');
    }
  }
  if (envelope.version <= 6) {
    notices.push('Your shop now supports separate inn and tavern service. Money, prepared meals and sales are preserved.');
  }
  if (envelope.version <= 5) {
    recoverLegacyOutdoorArrivals(candidate, envelope.version, notices, validationFarm, validationRegion);
    recoverLegacyExpandedFurniture(candidate, envelope.version, notices);
    const legacy = validateLegacyTavernState((state as Record<string, unknown>).tavern, candidate.day);
    if (legacy.phase !== 'closed') {
      notices.push('Your old service closed because its fixed stations no longer exist. Money, meals and sales are preserved. Craft and place your stations to reopen.');
    }
  }
  assertResumePosition(slot, candidate, validationFarm, validationRegion);
  validatePorchPosition(candidate, envelope.version, validationFarm, getMapData(SceneKey.Farm));
  migrateShopArchitecture(candidate, envelope.version, notices);
  // Reject broken legacy occupancy before the approved move can remove or relocate outdoor records.
  GameState.candidateFromSaveData(candidate.toSaveData(), SAVE_VERSION, validationFarm, validationRegion);
  if (envelope.version <= 9) migrateFarmLayout(candidate, validationFarm, getMapData(SceneKey.Farm), notices);
  if (envelope.version <= 10) {
    const oldTown = validationRegion.get(SceneKey.Town), oldForest = validationRegion.get(SceneKey.Forest);
    if (!oldTown || !oldForest) throw new Error('SaveSystem: pre-Town migration snapshots are missing');
    migrateTownLayout(candidate, oldTown, oldForest, notices);
  }
  if (envelope.version <= 11) migrateTownBuildings(candidate, getUnbuiltTownMap(), notices);
  if (envelope.version <= 26) {
    migratePaintedTown(candidate, getAuthoredTownMap(), notices);
    cancelTownMeetings(candidate, notices);
  }
  // why: the painted Forest (REPAINTED_OUTDOORS, version 26) can put pond or thicket under a building from a
  // version 11-25 save, and a building cannot wait at the arrival like furniture; older saves were settled on
  // today's Forest by migrateTownLayout above. Save version 30 (October 2026) made three more painted Forest
  // trees choppable, at (46,27), (11,43) and (43,57), on what was open grass, so a version 26-29 save may hold
  // a building, furniture, a pickup or the keeper on a new trunk; the same settle moves only those.
  if (envelope.version >= 11 && envelope.version <= 29) {
    settleRepaintedRegion(candidate, getMapData(SceneKey.Forest), notices);
  }
  if (envelope.version <= 14) notices.push('Town residents now remember boundary warnings, and the town watch can respond to severe conduct.');
  if (envelope.version <= 15) notices.push('Witnessed private conduct can now send town residents to the watch house until the next day.');
  if (envelope.version <= 16) notices.push('A mailbox now stands beside your shop. Neighbors will write to you there.');
  if (envelope.version <= 17) notices.push('The north trail, the portal gate, Seren\'s guild board, forge and alchemy upgrades, and friendship letters are now part of Willowbrook.');
  if (envelope.version <= 18) notices.push('Neighbors now share town news, ask the keeper for small favors, and sometimes invite the keeper to meet.');
  if (envelope.version <= 19) notices.push('The Wayfarer now hosts a Wednesday night crowd, and neighbors can make plans or join your adventuring party.');
  if (envelope.version <= 20) notices.push('The wardrobe now offers a second body shape, outerwear and facial hair.');
  if (envelope.version <= 21) notices.push('You can now eat and drink from your bag. Some food gives a short boost.');
  if (envelope.version <= 22) notices.push('Neighbors who like how you talk may now offer real help in a chat.');
  normalizeLegacyHome(candidate, getMapData(SceneKey.Farm));
  // why: last, so it reads the keeper's spot on today's maps after every older migration has moved it.
  validateFineWallPosition(candidate, envelope.version, notices);
  // Check the migrated result under today's contract before it can replace live state.
  GameState.candidateFromSaveData(candidate.toSaveData());
  return { envelope: envelope as SaveEnvelope, candidate, notices };
}

/** Derive display metadata from a fully validated envelope/candidate. */
function readyInfo(slot: SaveSlot, envelope: SaveEnvelope, candidate: GameState): SaveSlotInfo {
  return {
    slot,
    status: 'ready',
    savedAt: envelope.savedAt,
    day: candidate.day,
    season: candidate.season,
    gold: candidate.gold,
    activeScene: candidate.activeScene,
  };
}

export const SaveSystem = {
  /** Consume explicit compatibility feedback after successful load; inspections never enqueue it. */
  consumeMigrationNotice(): string | null {
    const notice = migrationNotice;
    migrationNotice = null;
    return notice;
  },
  /** Return the one exact storage key owned by a slot. */
  storageKey(slot: number): string {
    return `shopkeeperslegacy.save.v1.slot.${validSlot(slot)}`;
  },

  /** Return the immutable raw pre-v10 backup key; ordinary slot deletion never removes this recovery copy. */
  farmLayoutBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-farm-v10.slot.${validSlot(slot)}`;
  },

  /** Preserve the exact pre-v11 envelope separately from the earlier Farm backup; slot deletion leaves it intact. */
  townLayoutBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-town-v11.slot.${validSlot(slot)}`;
  },

  /** Keep exact pre-building bytes separately; deleting a gameplay slot never removes its recovery copy. */
  townBuildingsBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-town-buildings-v12.slot.${validSlot(slot)}`;
  },

  /** Preserve exact saves from before durable relationships; slot deletion leaves the recovery copy intact. */
  relationshipsBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-relationships-v13.slot.${validSlot(slot)}`;
  },

  /** Preserve exact v13 fixed-pair saves before writing the dynamic v14 social network. */
  socialNetworkBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-social-network-v14.slot.${validSlot(slot)}`;
  },

  /** Preserve exact pre-v15 saves before writing durable resident boundary and incident state. */
  justiceBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-justice-v15.slot.${validSlot(slot)}`;
  },

  /** Preserve exact v15 bytes before resident jail release days enter the v16 justice payload. */
  cuddleBackupKey(slot: number): string {
    return `shopkeeperslegacy.save.backup.pre-cuddle-v16.slot.${validSlot(slot)}`;
  },

  /** The slot bound to the current play session, or null for direct test/dev world boot. */
  currentSlot(): SaveSlot | null {
    return activeSlot;
  },

  /**
   * Begin a fresh session in an empty slot. Occupied/corrupt slots require explicit deletion first,
   * so a New Adventure action can never overwrite progress.
   */
  beginNewGame(slotNumber: number): void {
    assertGameplaySaveAccess();
    const slot = validSlot(slotNumber);
    const info = this.inspectSlot(slot);
    if (info.status !== 'empty') {
      throw new Error(`SaveSystem: Slot ${slot} must be deleted before starting a new game`);
    }
    // An empty adventure must never inherit optional speech notes from an older deleted slot.
    localStorage.removeItem(residentChatNotesStorageKey(slot));
    localStorage.removeItem(residentGiftMemoryStorageKey(slot));
    localStorage.removeItem(townSocialNotesStorageKey(slot));
    GameState.resetWithSocialSeed(newAdventureSocialSeed(slot));
    migrationNotice = null;
    activeSlot = slot;
  },

  /** Write one validated gameplay snapshot to its slot; editor sessions reject writes before touching live state. */
  save(slotNumber: number, savedAt = Date.now()): SaveSlotInfo {
    assertGameplaySaveAccess();
    const slot = validSlot(slotNumber);
    if (!Number.isFinite(savedAt) || savedAt < 0) throw new Error(`SaveSystem: invalid savedAt ${savedAt}`);
    const state = GameState.instance.toSaveData();
    // why: portal runs are never saved; the run ends at the escape altar, the exit portal or a knockout.
    if (state.activeScene === SceneKey.Dungeon) throw new Error('You cannot save inside the portal. Leave through the exit portal or the escape altar first.');
    // Re-validate the detached payload before touching storage so a corrupted live invariant cannot
    // become a save file that only fails later on Continue.
    const candidate = GameState.candidateFromSaveData(state);
    assertResumePosition(slot, candidate);
    validatePorchPosition(candidate, SAVE_VERSION);
    validateFineWallPosition(candidate, SAVE_VERSION, []);
    migrateShopArchitecture(candidate, SAVE_VERSION, []);
    const envelope: SaveEnvelope = { version: SAVE_VERSION, slot, savedAt, state };
    const raw = JSON.stringify(envelope);
    if (new Blob([raw]).size > MAX_SAVE_BYTES) {
      throw new Error(`SaveSystem: Slot ${slot} exceeds the ${MAX_SAVE_BYTES}-byte safety limit`);
    }
    const original = localStorage.getItem(this.storageKey(slot));
    if (original !== null) {
      // Validate the exact old bytes before backing them up; reads and listing never enter this write path.
      const previous = readEnvelope(slot);
      if (previous.envelope.version <= 9) {
        const backupKey = this.farmLayoutBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-farm backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        // Storage failures propagate before the gameplay key is overwritten. Existing backups are never replaced.
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-farm save backup verification failed');
      }
      if (previous.envelope.version <= 10) {
        const backupKey = this.townLayoutBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-town backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-town save backup verification failed');
      }
      if (previous.envelope.version <= 11) {
        const backupKey = this.townBuildingsBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-building backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-building save backup verification failed');
      }
      if (previous.envelope.version <= 12) {
        const backupKey = this.relationshipsBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-relationship backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-relationship save backup verification failed');
      }
      if (previous.envelope.version <= 13) {
        const backupKey = this.socialNetworkBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-social-network backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-social-network save backup verification failed');
      }
      if (previous.envelope.version <= 14) {
        const backupKey = this.justiceBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-justice backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-justice save backup verification failed');
      }
      if (previous.envelope.version <= 15) {
        const backupKey = this.cuddleBackupKey(slot), backup = localStorage.getItem(backupKey);
        if (backup !== null && backup !== original) throw new Error('SaveSystem: a different pre-Cuddle backup already exists; preserve it before replacing this old slot');
        if (backup === null) localStorage.setItem(backupKey, original);
        if (localStorage.getItem(backupKey) !== original) throw new Error('SaveSystem: raw pre-Cuddle save backup verification failed');
      }
    }
    localStorage.setItem(this.storageKey(slot), raw);
    return readyInfo(slot, envelope, candidate);
  },

  /** Save the active gameplay session; editor sandboxes explicitly support autosave calls as a no-write null result. */
  saveCurrent(savedAt = Date.now()): SaveSlotInfo | null {
    if (mapEditorMode() !== null) return null;
    return activeSlot === null ? null : this.save(activeSlot, savedAt);
  },

  /** Reject sandbox loads, otherwise validate a slot completely before atomically installing its state. */
  load(slotNumber: number): GameSaveData {
    assertGameplaySaveAccess();
    const slot = validSlot(slotNumber);
    const { candidate, notices } = readEnvelope(slot);
    GameState.installCandidate(candidate);
    activeSlot = slot;
    migrationNotice = notices.length ? notices.join(' ') : null;
    return candidate.toSaveData();
  },

  /** Inspect a gameplay slot without writes; reject sandbox reads outside the corruption-reporting catch. */
  inspectSlot(slotNumber: number): SaveSlotInfo {
    assertGameplaySaveAccess();
    const slot = validSlot(slotNumber);
    if (localStorage.getItem(this.storageKey(slot)) === null) return { slot, status: 'empty' };
    try {
      const { envelope, candidate } = readEnvelope(slot);
      return readyInfo(slot, envelope, candidate);
    } catch (error) {
      return {
        slot,
        status: 'corrupt',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /** List exactly three gameplay cards; sandbox modes must never read or classify the player's saves. */
  listSlots(): SaveSlotInfo[] {
    assertGameplaySaveAccess();
    return ([1, 2, 3] as SaveSlot[]).map((slot) => this.inspectSlot(slot));
  },

  /** Remove one gameplay slot only outside editor sandboxes; UI confirmation remains caller-owned. */
  delete(slotNumber: number): void {
    assertGameplaySaveAccess();
    const slot = validSlot(slotNumber);
    localStorage.removeItem(this.storageKey(slot));
    localStorage.removeItem(residentChatNotesStorageKey(slot));
    localStorage.removeItem(residentGiftMemoryStorageKey(slot));
    localStorage.removeItem(townSocialNotesStorageKey(slot));
    if (activeSlot === slot) activeSlot = null;
  },

  /** End slot ownership after old world scenes have shut down during return-to-title. */
  endSession(): void {
    activeSlot = null;
    migrationNotice = null;
  },
};
