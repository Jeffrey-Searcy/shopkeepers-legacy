/**
 * Town/Forest compatibility for old saves. Operates only on detached, validated save candidates.
 * Preserves records at legal positions, reserves them across categories, then moves conflicts
 * intact to deterministic reachable ground. Storage, interiors and the Farm are never edited here.
 * The chain for a Town save: pre-v11 80x60 Town -> v11 120x110 underlay (migrateTownLayout) -> v12 120x110
 * built Town (migrateTownBuildings) -> v27 82x75 painted Town (migratePaintedTown).
 */
import { SceneKey } from '../config/AssetKeys';
import { PLAYER_BODY, TILE } from '../config/GameConfig';
import { furnitureCells, furnitureDefinition } from '../config/Furniture';
import type { GameState } from '../state/GameState';
import { getAuthoredMapData, type MapData } from '../world/MapDef';
import { getAuthoredTownMap, getUnbuiltTownMap } from '../world/TownMap';

/** Tile anchors and footprint cells always use integers in the owning map. */
interface Cell { tx: number; ty: number }
/** One relocation unit; a soil/crop pair stays one unit, and furniture keeps its rotation. */
interface Entry extends Cell {
  label: string;
  kind: 'growing' | 'furniture' | 'building' | 'drop';
  blocking: boolean;
  cells(tx: number, ty: number): Cell[];
  remove(): void;
  move(tx: number, ty: number): void;
}

/** Return a canonical local tile key for set membership. */
function local(cell: Cell): string { return `${cell.tx},${cell.ty}`; }

/** Parse only exact scoped integer coordinates; malformed or old out-of-bounds records are corruption. */
function parseCell(key: string, map: MapData): Cell {
  const match = new RegExp(`^${map.key}:(0|[1-9]\\d*),(0|[1-9]\\d*)$`).exec(key);
  if (!match) throw new Error(`Town layout migration: invalid record key ${key}`);
  const cell = { tx: Number(match[1]), ty: Number(match[2]) };
  assertBounds(cell, map, key);
  return cell;
}

/** Reject corrupt original coordinates before any compatibility relocation can disguise them. */
function assertBounds(cell: Cell, map: MapData, label: string): void {
  if (!Number.isSafeInteger(cell.tx) || !Number.isSafeInteger(cell.ty) ||
      cell.tx < 0 || cell.ty < 0 || cell.tx >= map.w || cell.ty >= map.h) {
    throw new Error(`Town layout migration: ${label} is outside ${map.key} bounds`);
  }
}

/** Enumerate a bounded rectangular building footprint. */
function rectangle(tx: number, ty: number, w: number, h: number): Cell[] {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ({ tx: tx + x, ty: ty + y }))).flat();
}

/** Search nearest candidates by Manhattan distance, row, then column; no random or lossy recovery. */
function nearest(source: Cell, map: MapData, allowed: (cell: Cell) => boolean, label: string): Cell {
  for (let distance = 0; distance < map.w + map.h; distance++) {
    for (let ty = Math.max(1, source.ty - distance); ty <= Math.min(map.h - 2, source.ty + distance); ty++) {
      const dx = distance - Math.abs(ty - source.ty);
      for (const tx of dx === 0 ? [source.tx] : [source.tx - dx, source.tx + dx]) {
        if (tx > 0 && tx < map.w - 1 && allowed({ tx, ty })) return { tx, ty };
      }
    }
  }
  throw new Error(`Town layout migration: no safe space for ${label}; original save retained`);
}

/** Protect arrivals, warp openings and reserved roads from relocated furniture, crops and buildings. */
function reservations(map: MapData): Set<string> {
  const result = new Set(map.spawns.map(local));
  if (map.reservedTiles) for (const cell of map.reservedTiles) result.add(local(cell));
  for (const warp of map.warps) for (const cell of rectangle(warp.tx, warp.ty, warp.w, warp.h)) result.add(local(cell));
  return result;
}

/** Physics opens warp cells through the border; resource removal follows runtime's exact-key behavior. */
function staticBlocked(state: GameState, map: MapData): Set<string> {
  const blocked = new Set<string>(), openings = new Set<string>();
  for (const warp of map.warps) for (const cell of rectangle(warp.tx, warp.ty, warp.w, warp.h)) openings.add(local(cell));
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if ((map.solid[ty][tx] || map.ground[ty][tx] === 'water') && !openings.has(`${tx},${ty}`)) blocked.add(`${tx},${ty}`);
  }
  for (const object of map.objects) {
    if (!Object.prototype.hasOwnProperty.call(state.removedNodes, `${map.key}:${local(object)}`)) blocked.add(local(object));
  }
  for (const building of map.buildings) {
    for (const cell of rectangle(building.tx, building.ty - building.hSolid + 1, building.wTiles, building.hSolid)) {
      if (!openings.has(local(cell))) blocked.add(local(cell));
    }
  }
  return blocked;
}

/** Flood from one canonical arrival so separate entrances cannot hide a severed connection between them. */
function reachable(map: MapData, blocked: Set<string>): Set<string> {
  const root = map.spawns.find(spawn => spawn.id === (map.key === SceneKey.Town ? 'start' : 'from_farm'));
  if (!root || blocked.has(local(root))) throw new Error(`Town layout migration: ${map.key} root arrival is blocked`);
  const queue: Cell[] = [{ tx: root.tx, ty: root.ty }];
  const reached = new Set(queue.map(local));
  for (let index = 0; index < queue.length; index++) {
    const { tx, ty } = queue[index];
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const next = { tx: tx + dx, ty: ty + dy }, key = local(next);
      if (next.tx < 0 || next.ty < 0 || next.tx >= map.w || next.ty >= map.h || blocked.has(key) || reached.has(key)) continue;
      reached.add(key); queue.push(next);
    }
  }
  return reached;
}

/**
 * Keep matching Forest resource identities exact. Move orphan marker/stage pairs off unrelated
 * new resources together. Old Town had no authored resources, so none may claim a new tree.
 */
function protectResourceIdentity(state: GameState, oldMap: MapData, map: MapData, notices: string[]): void {
  const keys = new Set([...Object.keys(state.removedNodes), ...Object.keys(state.treeStages)]);
  const oldObjects = new Map(oldMap.objects.map(object => [local(object), object.kind]));
  const newObjects = new Map(map.objects.map(object => [local(object), object.kind]));
  const occupied = new Set(keys), reserved = reservations(map);
  let count = 0;
  for (const key of [...keys].filter(key => key.startsWith(map.key)).sort()) {
    const cell = parseCell(key, oldMap), name = local(cell), kind = newObjects.get(name);
    if (kind === undefined || oldObjects.get(name) === kind) continue;
    const target = nearest(cell, map, point => !map.solid[point.ty][point.tx] &&
      map.ground[point.ty][point.tx] !== 'water' && !newObjects.has(local(point)) &&
      !reserved.has(local(point)) && !occupied.has(`${map.key}:${local(point)}`), key);
    const destination = `${map.key}:${local(target)}`;
    if (Object.prototype.hasOwnProperty.call(state.removedNodes, key)) {
      state.removedNodes[destination] = state.removedNodes[key]; delete state.removedNodes[key];
    }
    if (Object.prototype.hasOwnProperty.call(state.treeStages, key)) {
      state.treeStages[destination] = state.treeStages[key]; delete state.treeStages[key];
    }
    occupied.add(destination); count++;
  }
  if (count) notices.push(`${count} old ${map.key === SceneKey.Town ? 'Town' : 'Forest'} resource markers moved off unrelated new trees.`);
}

/**
 * Join furniture whose footprints overlap (a legal stack, such as a table standing on a rug) into one unit.
 * why: each unit takes its own free ground when it moves, so separate units would pull a table off its rug.
 * A unit keeps every member's offset from the first member, so the stack lands exactly as it was built.
 * @param furniture one entry per placed piece, in saved order
 * @returns single pieces unchanged, plus one combined entry per stack (blocking when any member blocks)
 */
function furnitureStacks(furniture: Entry[]): Entry[] {
  // Union-find over pieces that share a cell; a chain (rug, table, second rug) becomes one stack.
  const parent = furniture.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const owner = new Map<string, number>();
  furniture.forEach((entry, index) => {
    for (const cell of entry.cells(entry.tx, entry.ty)) {
      const previous = owner.get(local(cell));
      if (previous === undefined) owner.set(local(cell), index);
      else parent[root(index)] = root(previous);
    }
  });
  const groups = new Map<number, Entry[]>();
  furniture.forEach((entry, index) => {
    const group = groups.get(root(index));
    if (group) group.push(entry); else groups.set(root(index), [entry]);
  });
  return [...groups.values()].map(members => {
    if (members.length === 1) return members[0];
    const [first] = members, offsets = members.map(member => ({ dx: member.tx - first.tx, dy: member.ty - first.ty }));
    return { tx: first.tx, ty: first.ty, label: members.map(member => member.label).join(' + '), kind: 'furniture',
      blocking: members.some(member => member.blocking),
      cells: (tx, ty) => {
        const seen = new Map<string, Cell>();
        members.forEach((member, index) => {
          for (const cell of member.cells(tx + offsets[index].dx, ty + offsets[index].dy)) seen.set(local(cell), cell);
        });
        return [...seen.values()];
      },
      remove: () => {},
      move: (tx, ty) => members.forEach((member, index) => member.move(tx + offsets[index].dx, ty + offsets[index].dy)) };
  });
}

/** Build relocation units without changing source arrays, keys or record values. */
function entries(state: GameState, oldMap: MapData): Entry[] {
  const result: Entry[] = [];
  const keys = new Set([...Object.keys(state.tiles), ...Object.keys(state.crops)].filter(key => key.startsWith(oldMap.key)));
  for (const key of [...keys].sort()) {
    const cell = parseCell(key, oldMap), soil = state.tiles[key], crop = state.crops[key];
    result.push({ ...cell, label: key, kind: 'growing', blocking: false,
      cells: (tx, ty) => [{ tx, ty }],
      remove: () => { delete state.tiles[key]; delete state.crops[key]; },
      move: (tx, ty) => {
        const destination = `${oldMap.key}:${tx},${ty}`;
        if (soil !== undefined) state.tiles[destination] = soil;
        if (crop !== undefined) state.crops[destination] = crop;
      } });
  }
  const furniture: Entry[] = [];
  for (const placed of state.placedItems.filter(item => item.scene === oldMap.key)) {
    furniture.push({ tx: placed.tx, ty: placed.ty, label: `${placed.item}@${local(placed)}`, kind: 'furniture',
      blocking: furnitureDefinition(placed.item).blocking,
      cells: (tx, ty) => furnitureCells(placed.item, tx, ty, placed.rotation),
      remove: () => {}, move: (tx, ty) => { placed.tx = tx; placed.ty = ty; } });
  }
  result.push(...furnitureStacks(furniture));
  for (const placed of state.placements.filter(item => item.scene === oldMap.key)) {
    // Check dimensions before allocating cells so a corrupt huge footprint fails with bounded work.
    assertBounds({ tx: placed.tx + placed.w - 1, ty: placed.ty + placed.h - 1 }, oldMap, placed.id);
    result.push({ tx: placed.tx, ty: placed.ty, label: placed.id, kind: 'building', blocking: true,
      cells: (tx, ty) => rectangle(tx, ty, placed.w, placed.h),
      remove: () => {}, move: (tx, ty) => { placed.tx = tx; placed.ty = ty; } });
  }
  for (const drop of state.groundDrops.filter(item => item.scene === oldMap.key)) {
    result.push({ tx: drop.tx, ty: drop.ty, label: `${drop.item} pickup@${local(drop)}`, kind: 'drop', blocking: false,
      cells: (tx, ty) => [{ tx, ty }], remove: () => {}, move: (tx, ty) => { drop.tx = tx; drop.ty = ty; } });
  }
  for (const entry of result) for (const cell of entry.cells(entry.tx, entry.ty)) assertBounds(cell, oldMap, entry.label);
  return result;
}

/** Test the full eight-by-six feet box against tile-sized physics bodies, not just the player's center tile. */
function playerBlocked(map: MapData, blocked: Set<string>, x: number, y: number): boolean {
  for (let ty = Math.floor((y - PLAYER_BODY.h / 2) / TILE); ty < Math.ceil((y + PLAYER_BODY.h / 2) / TILE); ty++) {
    for (let tx = Math.floor((x - PLAYER_BODY.w / 2) / TILE); tx < Math.ceil((x + PLAYER_BODY.w / 2) / TILE); tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || blocked.has(`${tx},${ty}`)) return true;
    }
  }
  return false;
}

/**
 * Reserve legal records of every category first, then relocate conflicts without taking a surviving record's space.
 * @param state the detached save candidate (changed in place)
 * @param oldMap the map the records were saved on (its key and bounds are read to parse them)
 * @param map today's map the records must fit
 * @param notices the load notices (a line is added when anything moves)
 * @param project only for a map of a different size: turns an old tile into the matching tile of `map`. Every
 *   record then moves, and its search for free ground starts at its projected tile. Buildings go first, then
 *   furniture, soil and pickups, so the largest footprints get the nearest space.
 * @throws when a record has no legal space left (the original save is kept)
 */
function migrateRegion(state: GameState, oldMap: MapData, map: MapData, notices: string[], project?: (cell: Cell) => Cell): void {
  protectResourceIdentity(state, oldMap, map, notices);
  const all = entries(state, oldMap), blocked = staticBlocked(state, map), reserved = reservations(map);
  let reached = reachable(map, blocked);
  /** Static fit preserves pickup positions on roads; new relocation targets always avoid circulation. */
  const fits = (entry: Entry, point: Cell): boolean => entry.cells(point.tx, point.ty).every(cell =>
    cell.tx > 0 && cell.ty > 0 && cell.tx < map.w - 1 && cell.ty < map.h - 1 &&
    reached.has(local(cell)) && (entry.kind === 'drop' || !reserved.has(local(cell))) &&
    (entry.kind !== 'growing' || map.ground[cell.ty][cell.tx] === 'grass' || map.ground[cell.ty][cell.tx] === 'dirt') &&
    (entry.kind !== 'building' || map.buildable[cell.ty][cell.tx]));
  // why: old coordinates mean nothing on a map of another size, so no record may stay where its numbers point.
  const stationary = project ? [] : all.filter(entry => fits(entry, entry));
  const stationarySet = new Set(stationary), occupied = new Set<string>();
  // Test surviving blockers before accepting them. A formerly open placement may now close a
  // narrow bank beside the new river. Move that blocker, not the otherwise legal records it traps.
  for (const entry of stationary.filter(entry => entry.blocking)) {
    if (!preservesAccess(entry, entry, map, blocked, reached)) {
      stationarySet.delete(entry); continue;
    }
    for (const cell of entry.cells(entry.tx, entry.ty)) blocked.add(local(cell));
    reached = reachable(map, blocked);
  }
  for (const entry of stationarySet) for (const cell of entry.cells(entry.tx, entry.ty)) occupied.add(local(cell));
  // Pickups under surviving furniture or sealed behind it are not accessible even if terrain is clear.
  for (const entry of stationary.filter(entry => entry.kind === 'drop')) {
    if (!reached.has(local(entry))) stationarySet.delete(entry);
  }
  const moving = all.filter(entry => !stationarySet.has(entry));
  if (project) {
    const order: Record<Entry['kind'], number> = { building: 0, furniture: 1, growing: 2, drop: 3 };
    // Array.prototype.sort is stable, so records of one kind keep their saved order.
    moving.sort((left, right) => order[left.kind] - order[right.kind]);
  }
  // Clear every moving soil key before assigning targets: two conflicting source positions may swap.
  for (const entry of moving) entry.remove();
  for (const entry of moving) {
    const target = nearest(project ? project(entry) : entry, map, point => fits(entry, point) && entry.cells(point.tx, point.ty).every(cell =>
      !occupied.has(local(cell)) && !reserved.has(local(cell))) &&
      (!entry.blocking || preservesAccess(entry, point, map, blocked, reached)), entry.label);
    entry.move(target.tx, target.ty);
    for (const cell of entry.cells(target.tx, target.ty)) {
      occupied.add(local(cell)); if (entry.blocking) blocked.add(local(cell));
    }
    if (entry.blocking) reached = reachable(map, blocked);
  }
  if (moving.length) notices.push(`The new ${map.key === SceneKey.Town ? 'Town' : 'Forest trail'} moved ${moving.length} saved placements, growing cells or pickups to nearby free ground. Contents, counts and rotations are preserved.`);
  if (state.activeScene === map.key && (playerBlocked(map, blocked, state.player.x, state.player.y) ||
      !reached.has(`${Math.floor(state.player.x / TILE)},${Math.floor(state.player.y / TILE)}`))) {
    const spawn = map.spawns.find(point => point.id === (map.key === SceneKey.Town ? 'start' : 'from_town'));
    if (!spawn || playerBlocked(map, blocked, (spawn.tx + 0.5) * TILE, (spawn.ty + 0.5) * TILE)) {
      throw new Error('Town layout migration: required safe arrival is blocked');
    }
    state.player = { ...state.player, x: (spawn.tx + 0.5) * TILE, y: (spawn.ty + 0.5) * TILE, facing: 'down' };
    // why: the Forest settle (settleRepaintedRegion) sends the keeper to the Town road end, not a Town route.
    notices.push(map.key === SceneKey.Town ? 'Your keeper moved to a safe arrival beside the new Town routes.'
      : 'Your keeper moved to a safe arrival at the end of the Forest road to Town.');
  }
}

/** A moved blocker must not cut off any previously reachable tile except its own occupied footprint. */
function preservesAccess(entry: Entry, target: Cell, map: MapData, blocked: Set<string>, before: Set<string>): boolean {
  const footprint = new Set(entry.cells(target.tx, target.ty).map(local));
  const after = reachable(map, new Set([...blocked, ...footprint]));
  for (const key of before) if (!footprint.has(key) && !after.has(key)) return false;
  return true;
}

/** Apply the approved version11 migration to a detached candidate; report changes, never write browser storage. */
export function migrateTownLayout(state: GameState, oldTown: MapData, oldForest: MapData, notices: string[]): void {
  if (oldTown.key !== SceneKey.Town || oldTown.w !== 80 || oldTown.h !== 60 || oldForest.key !== SceneKey.Forest) {
    throw new Error('Town layout migration: explicit pre-v11 Town and Forest snapshots are required');
  }
  migrateRegion(state, oldTown, getUnbuiltTownMap(), notices);
  migrateRegion(state, oldForest, getAuthoredMapData(SceneKey.Forest), notices);
  notices.push('Your save now uses the new Town and its four routes. Farm and interiors are unchanged by the Town update.');
}

/**
 * Settle a save's records on an outdoor map that was repainted at the same size (save version 26: the painted
 * Forest), or that gained new resource nodes on open ground (save version 30: three more choppable Forest
 * trees). Records that are still legal stay exactly where they are; the rest (above all player buildings, which
 * cannot wait at an arrival as dropped items) move intact to the nearest legal, reachable ground.
 * why: the old map is the new map here, because only the key and the bounds of the old map are read once the
 * repaint has dropped the old node records (SaveSystem.resetPaintedNodes).
 * @param state the detached, validated save candidate (changed in place)
 * @param map today's authored map for the repainted scene
 * @param notices the load notices (a line is added when anything moves)
 * @throws when a record has no legal space left on the new map (the original save is kept)
 */
export function settleRepaintedRegion(state: GameState, map: MapData, notices: string[]): void {
  migrateRegion(state, map, map, notices);
}

/**
 * Move only records caught by the newly built civic plots; the v11 underlay remains an explicit validation snapshot.
 * why: the target is the frozen 120x110 built Town (getAuthoredTownMap), not today's map: since save version 27
 * the Town is a painting of another size, and migratePaintedTown carries the records on from this step.
 * @param state the detached save candidate (changed in place)
 * @param oldTown the building-free version11 Town (getUnbuiltTownMap)
 * @param notices the load notices
 */
export function migrateTownBuildings(state: GameState, oldTown: MapData, notices: string[]): void {
  if (oldTown.key !== SceneKey.Town || oldTown.w !== 120 || oldTown.h !== 110 || oldTown.warps.length !== 4) {
    throw new Error('Town buildings migration requires the building-free version11 Town snapshot');
  }
  migrateRegion(state, oldTown, getAuthoredTownMap(), notices);
  notices.push('Town buildings are now open. Items caught by their new footprints move nearby intact; your shop and bedroom stay unchanged.');
}

/**
 * Move a save from the 120x110 built Town (save versions 12-26, and older saves once migrateTownBuildings ran)
 * onto the 82x75 painted Town (save version 27, world/TownArt.ts).
 *  - every Town record (soil, crops, furniture, player buildings, pickups) moves intact to the nearest legal,
 *    reachable ground around its projected tile; contents, counts and rotations are kept;
 *  - the keeper moves to their projected spot, or to the plaza ('start') when that spot is blocked or cut off.
 * A tile projects by its center: new = floor((old + 0.5) * newSize / oldSize), so every old tile lands inside
 * the new map. The caller has already dropped the old tree and rock records (SaveSystem.resetPaintedNodes).
 * @param state the detached, validated save candidate (changed in place)
 * @param oldTown the 120x110 built Town the records were saved on (getAuthoredTownMap)
 * @param notices the load notices (lines are added for the new look and for anything that moved)
 * @throws when oldTown is not the 120x110 Town, or a record has no legal space left (the original save is kept)
 */
export function migratePaintedTown(state: GameState, oldTown: MapData, notices: string[]): void {
  if (oldTown.key !== SceneKey.Town || oldTown.w !== 120 || oldTown.h !== 110) {
    throw new Error('Painted Town migration requires the 120x110 built Town snapshot');
  }
  const map = getAuthoredMapData(SceneKey.Town);
  const sx = map.w / oldTown.w, sy = map.h / oldTown.h;
  const project = (cell: Cell): Cell => ({ tx: Math.floor((cell.tx + 0.5) * sx), ty: Math.floor((cell.ty + 0.5) * sy) });
  if (state.activeScene === SceneKey.Town) {
    // why: the keeper's feet are a point, not a tile, so they scale directly; migrateRegion then checks the
    // whole body box and sends a blocked or cut-off keeper to the plaza.
    state.player = { ...state.player, x: state.player.x * sx, y: state.player.y * sy };
  }
  migrateRegion(state, oldTown, map, notices, project);
  notices.push('Willowbrook has a new painted look. Its buildings, roads and river moved, so your things in Town now sit on the nearest open ground.');
}
