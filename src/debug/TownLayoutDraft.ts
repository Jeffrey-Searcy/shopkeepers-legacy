/**
 * Pure town-workshop drafts. The checked-in terrain is an immutable underlay; movable clearings
 * composite quiet dirt over that underlay so moving a plot never erases an existing road.
 * This module owns no browser storage, live gameplay state, scene installation, or normal town.
 */
import { PLAYER_BODY, TILE } from '../config/GameConfig';
import type { DecorDef, MapData, ObjectDef } from '../world/MapDef';
import type { TownPlan, TownPlot } from '../world/TownPlanning';
import { composeTownClearings } from '../world/TownMap';
import authored from '../world/maps/town-workshop.json' with { type: 'json' };

/** Stable authored resource identity; kinds, order, and count cannot change in the workshop. */
export interface TownDraftObject extends ObjectDef { id: string }
/** Stable decoration identity; decorations stay nonblocking in walk previews. */
export interface TownDraftDecor extends DecorDef { id: string }
/** A sparse edit to the ground underneath the movable clearing layer. */
export interface TownGroundEdit { tx: number; ty: number; ground: 'grass' | 'dirt' }
/** Strict exported document. Water, cliffs, bridges, future sites, routes, and spawn definitions are not editable fields. */
export interface TownLayoutDraft {
  version: 1;
  map: 'town';
  baseFingerprint: string;
  objects: TownDraftObject[];
  decor: TownDraftDecor[];
  ground: TownGroundEdit[];
  plots: TownPlot[];
}
/** Fully compiled workshop map; this type does not install it in the normal town resolver. */
export interface TownWorkshopMap extends MapData { townPlan: TownPlan }
/** Pixel rectangle used by editor picking and real trunk/plot placement validation. */
export interface TownDraftFootprint { x: number; y: number; w: number; h: number }
/** Plot outlines are editing information, never phantom buildings or player collision. */
export interface TownLayoutEntity {
  id: string; kind: string; group: 'object' | 'decor' | 'plot'; tx: number; ty: number;
  footprint: TownDraftFootprint;
}

export const TOWN_DRAFT_MAX_BYTES = 1_000_000;
const BASE = structuredClone(authored) as TownWorkshopMap;
const ROOT_KEYS = ['version', 'map', 'baseFingerprint', 'objects', 'decor', 'ground', 'plots'];

/** Fingerprint all authored data so a stale export cannot silently target a different town. */
function fingerprint(): string {
  let hash = 2166136261;
  const text = JSON.stringify(BASE);
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `town-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
const BASE_FINGERPRINT = fingerprint();

/** Reject foreign fields, exotic objects, and getters before reading any untrusted object fields. */
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label}.${key} must be a data field.`);
  }
  return value as Record<string, unknown>;
}

/** Accept a bounded dense data array only; sparse slots, accessor entries, and extra properties fail. */
function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} exceeds its allowed size.`);
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`${label} must be a dense array without extra fields.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label} must contain every authored data slot.`);
  }
  return value;
}

/** Require an in-bounds integer tile; never clamp or infer an imported coordinate. */
function coordinate(value: unknown, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= maximum) {
    throw new Error(`${label} must be a whole tile from 0 to ${maximum - 1}.`);
  }
  return value;
}

/** Derive stable identities from authored order rather than movable coordinates. */
function entityId(group: 'object' | 'decor', index: number): string {
  return `${group}:${String(index).padStart(4, '0')}`;
}

/** Enumerate all touched tiles; shared outside edges do not count as overlaps. */
function rectangleTiles(rect: TownDraftFootprint): Array<{ tx: number; ty: number }> {
  const result: Array<{ tx: number; ty: number }> = [];
  for (let ty = Math.floor(rect.y / TILE); ty < Math.ceil((rect.y + rect.h) / TILE); ty++) {
    for (let tx = Math.floor(rect.x / TILE); tx < Math.ceil((rect.x + rect.w) / TILE); tx++) result.push({ tx, ty });
  }
  return result;
}

/** Compare exact pixel rectangles, permitting neighbors to share an edge. */
function overlaps(a: TownDraftFootprint, b: TownDraftFootprint): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Cache fixed approaches, bridge decks and landings, named arrivals, and inert future-site space. */
function reservedTiles(): Set<string> {
  if (!BASE.reservedTiles) throw new Error('Authored town route reservations are missing.');
  return new Set(BASE.reservedTiles.map(tile => `${tile.tx},${tile.ty}`));
}
const RESERVED = reservedTiles();

/** Identify immutable terrain and authored circulation; roads elsewhere may still be repainted. */
function isFrozen(tx: number, ty: number): boolean {
  return tx < 1 || ty < 1 || tx >= BASE.w - 1 || ty >= BASE.h - 1 || RESERVED.has(`${tx},${ty}`) ||
    BASE.ground[ty][tx] === 'water' || BASE.ground[ty][tx] === 'cliff';
}

/** Refuse edits on fixed river/cliff cells, bridge decks, route mouths, and named arrivals. */
function assertPaintable(tx: number, ty: number): void {
  if (isFrozen(tx, ty)) throw new Error(`Tile ${tx},${ty} is frozen terrain or reserved circulation.`);
}

/** Build detached presentation records without constructing Phaser sprites or changing collision. */
function entities(draft: TownLayoutDraft): TownLayoutEntity[] {
  return [
    ...draft.plots.map(plot => ({ id: plot.id, kind: 'plot', group: 'plot' as const, tx: plot.tx, ty: plot.ty,
      footprint: { x: plot.tx * TILE, y: plot.ty * TILE, w: plot.w * TILE, h: plot.h * TILE } })),
    ...draft.objects.map(object => ({ ...object, group: 'object' as const,
      footprint: object.kind === 'bin'
        ? { x: object.tx * TILE + TILE / 2 - 20, y: (object.ty + 1) * TILE - 26, w: 40, h: 26 }
        : { x: object.tx * TILE, y: object.ty * TILE, w: TILE, h: TILE } })),
    ...draft.decor.map(decor => ({ ...decor, group: 'decor' as const,
      footprint: { x: decor.tx * TILE, y: decor.ty * TILE, w: TILE, h: TILE } })),
  ];
}

/** Compile already validated data: paths remain underneath dirt clearing overlays; solids never contain plots. */
function compile(draft: TownLayoutDraft): TownWorkshopMap {
  const map = structuredClone(BASE);
  for (const edit of draft.ground) map.ground[edit.ty][edit.tx] = edit.ground;
  map.objects = draft.objects.map(({ kind, tx, ty }) => ({ kind, tx, ty }));
  map.decor = draft.decor.map(({ kind, tx, ty }) => ({ kind, tx, ty }));
  map.townPlan.plots = draft.plots.map(plot => ({ ...plot }));
  return composeTownClearings(map);
}

/** Validate real pixel footprints with tile buckets, keeping each drag O(map area + occupied cells). */
function validatePlacement(draft: TownLayoutDraft): TownLayoutEntity[] {
  const items = entities(draft), buckets = new Map<string, TownLayoutEntity[]>();
  for (const item of items) {
    const rect = item.footprint;
    if (rect.x < TILE || rect.y < TILE || rect.x + rect.w > (BASE.w - 1) * TILE || rect.y + rect.h > (BASE.h - 1) * TILE) {
      throw new Error(`${item.id} extends onto the map boundary.`);
    }
    const touched = rectangleTiles(rect), compared = new Set<string>();
    for (const { tx, ty } of touched) {
      const key = `${tx},${ty}`;
      if (isFrozen(tx, ty)) throw new Error(`${item.id} overlaps frozen terrain or reserved circulation at ${key}.`);
      const neighbors = buckets.get(key);
      if (neighbors) for (const other of neighbors) if (!compared.has(other.id)) {
        compared.add(other.id);
        if (overlaps(rect, other.footprint)) throw new Error(`${item.id} overlaps ${other.id}.`);
      }
    }
    for (const { tx, ty } of touched) {
      const key = `${tx},${ty}`, bucket = buckets.get(key);
      if (bucket) bucket.push(item); else buckets.set(key, [item]);
    }
  }
  return items;
}

/** Reject mixed lower-terrain corners that the native two-terrain Wang artwork cannot render. */
function validateTerrain(map: TownWorkshopMap): void {
  for (let ty = 0; ty < map.h - 1; ty++) for (let tx = 0; tx < map.w - 1; tx++) {
    const lower = new Set([map.ground[ty][tx], map.ground[ty][tx + 1], map.ground[ty + 1][tx], map.ground[ty + 1][tx + 1]]);
    lower.delete('grass');
    if (lower.size > 1) throw new Error(`Terrain at ${tx},${ty} needs a grass buffer between dirt, water, and cliffs.`);
  }
}

/** Flood player-sized routes through actual terrain and trunks; clearings themselves stay walkable. */
function validateRoutes(map: TownWorkshopMap, items: TownLayoutEntity[]): void {
  const blocked = map.solid.map(row => row.slice());
  for (const warp of map.warps) for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
    for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) blocked[ty][tx] = false;
  }
  for (const item of items.filter(item => item.group === 'object')) {
    const body = item.footprint;
    const expanded = { x: body.x - PLAYER_BODY.w / 2, y: body.y - PLAYER_BODY.h / 2,
      w: body.w + PLAYER_BODY.w, h: body.h + PLAYER_BODY.h };
    for (const { tx, ty } of rectangleTiles(expanded)) if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) {
      const feet = { x: tx * TILE + TILE / 2 - PLAYER_BODY.w / 2, y: ty * TILE + TILE / 2 - PLAYER_BODY.h / 2,
        w: PLAYER_BODY.w, h: PLAYER_BODY.h };
      if (overlaps(feet, body)) blocked[ty][tx] = true;
    }
  }
  const start = map.spawns.find(spawn => spawn.id === 'start');
  if (!start || blocked[start.ty][start.tx]) throw new Error('The town start is blocked.');
  const visited = new Uint8Array(map.w * map.h), queue = new Int32Array(map.w * map.h);
  let read = 0, write = 1;
  queue[0] = start.ty * map.w + start.tx; visited[queue[0]] = 1;
  while (read < write) {
    const index = queue[read++], tx = index % map.w, ty = Math.floor(index / map.w);
    for (const [nx, ny] of [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || blocked[ny][nx]) continue;
      const next = ny * map.w + nx;
      if (!visited[next]) { visited[next] = 1; queue[write++] = next; }
    }
  }
  for (const spawn of map.spawns) if (!visited[spawn.ty * map.w + spawn.tx]) throw new Error(`The route to arrival ${spawn.id} is blocked.`);
  for (const warp of map.warps) {
    let reachable = false;
    for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) {
      if (visited[ty * map.w + tx]) reachable = true;
    }
    if (!reachable) throw new Error(`The route to ${warp.target} is blocked.`);
  }
  // A second bridge must not hide an isolated first crossing; every planning area stays accessible.
  for (const area of [...map.townPlan.plots, ...map.townPlan.bridges, ...map.townPlan.futureSites]) {
    for (let ty = area.ty; ty < area.ty + area.h; ty++) for (let tx = area.tx; tx < area.tx + area.w; tx++) {
      if (!visited[ty * map.w + tx]) throw new Error(`The route to ${area.id} is blocked.`);
    }
  }
}

/** Strictly validate unknown input and return detached canonical data; every rejected edit leaves its source intact. */
export function validateTownLayoutDraft(input: unknown): TownLayoutDraft {
  const root = record(input, ROOT_KEYS, 'Town draft');
  if (root.version !== 1 || root.map !== 'town') throw new Error('Unsupported town draft version or map.');
  if (root.baseFingerprint !== BASE_FINGERPRINT) throw new Error('Town draft belongs to a different authored town version.');
  const draft: TownLayoutDraft = { version: 1, map: 'town', baseFingerprint: BASE_FINGERPRINT,
    objects: [], decor: [], plots: [], ground: [] };
  for (const group of ['objects', 'decor'] as const) {
    const list = array(root[group], 4096, `Town ${group}`), source = BASE[group];
    if (list.length !== source.length) throw new Error(`Town ${group} must retain all ${source.length} authored entries.`);
    for (let index = 0; index < list.length; index++) {
      const entry = record(list[index], ['id', 'kind', 'tx', 'ty'], `${group} entry ${index}`);
      const id = entityId(group === 'objects' ? 'object' : 'decor', index);
      if (entry.id !== id || entry.kind !== source[index].kind) throw new Error(`${id} identity, kind, or order changed.`);
      const tx = coordinate(entry.tx, BASE.w, `${id} x`), ty = coordinate(entry.ty, BASE.h, `${id} y`);
      if (group === 'objects') draft.objects.push({ id, kind: BASE.objects[index].kind, tx, ty });
      else draft.decor.push({ id, kind: BASE.decor[index].kind, tx, ty });
    }
  }
  const plots = array(root.plots, 64, 'Town plots');
  if (plots.length !== BASE.townPlan.plots.length) throw new Error('Town plots must retain all authored clearings.');
  for (let index = 0; index < plots.length; index++) {
    const entry = record(plots[index], ['id', 'tx', 'ty', 'w', 'h'], `Plot ${index}`), source = BASE.townPlan.plots[index];
    if (entry.id !== source.id || entry.w !== source.w || entry.h !== source.h) throw new Error(`${source.id} identity, size, or order changed.`);
    draft.plots.push({ id: source.id, w: source.w, h: source.h,
      tx: coordinate(entry.tx, BASE.w, `${source.id} x`), ty: coordinate(entry.ty, BASE.h, `${source.id} y`) });
  }
  const edits = array(root.ground, BASE.w * BASE.h, 'Town ground edits'), seen = new Set<string>();
  for (const value of edits) {
    const edit = record(value, ['tx', 'ty', 'ground'], 'Ground edit');
    const tx = coordinate(edit.tx, BASE.w, 'Ground x'), ty = coordinate(edit.ty, BASE.h, 'Ground y');
    if (edit.ground !== 'grass' && edit.ground !== 'dirt') throw new Error('Ground brush must be grass or dirt.');
    assertPaintable(tx, ty);
    const key = `${tx},${ty}`;
    if (seen.has(key)) throw new Error(`Ground tile ${key} appears twice.`);
    seen.add(key);
    if (BASE.ground[ty][tx] !== edit.ground) draft.ground.push({ tx, ty, ground: edit.ground });
  }
  draft.ground.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  const items = validatePlacement(draft), map = compile(draft);
  validateTerrain(map); validateRoutes(map, items);
  return draft;
}

/** Create the workshop's validated initial layout, never the normal town or a browser storage value. */
export function createTownLayoutDraft(): TownLayoutDraft {
  return validateTownLayoutDraft({ version: 1, map: 'town', baseFingerprint: BASE_FINGERPRINT, ground: [],
    objects: BASE.objects.map((object, index) => ({ id: entityId('object', index), ...object })),
    decor: BASE.decor.map((decor, index) => ({ id: entityId('decor', index), ...decor })),
    plots: BASE.townPlan.plots.map(plot => ({ ...plot })),
  });
}

/** Return a fully composited detached initial workshop map for explicit preview setup only. */
export function getTownWorkshopMapData(): TownWorkshopMap { return compile(createTownLayoutDraft()); }

/** Compile a validated town document into an independent runtime map without installing it. */
export function compileTownLayoutDraft(draft: TownLayoutDraft): TownWorkshopMap { return compile(validateTownLayoutDraft(draft)); }

/** Return detached picking records for an entire valid draft, including full clearing footprints. */
export function getTownLayoutEntities(draft: TownLayoutDraft): TownLayoutEntity[] { return entities(validateTownLayoutDraft(draft)); }

/** Move one existing plot or greenery identity; invalid whole-layout candidates throw atomically. */
export function moveTownLayoutEntity(draft: TownLayoutDraft, id: string, tx: number, ty: number): TownLayoutDraft {
  const candidate = validateTownLayoutDraft(draft);
  const item = [...candidate.objects, ...candidate.decor, ...candidate.plots].find(entity => entity.id === id);
  if (!item) throw new Error(`Unknown town entity ${id}.`);
  item.tx = coordinate(tx, BASE.w, 'Move x'); item.ty = coordinate(ty, BASE.h, 'Move y');
  return validateTownLayoutDraft(candidate);
}

/** Paint underlying grass/dirt in one atomic stroke while preserving movable clearing overlays. */
export function paintTownLayoutTiles(draft: TownLayoutDraft, tiles: Array<{ tx: number; ty: number }>, ground: 'grass' | 'dirt'): TownLayoutDraft {
  const candidate = validateTownLayoutDraft(draft), stroke = array(tiles, BASE.w * BASE.h, 'Town brush');
  if (stroke.length < 1) throw new Error('Town brush must contain at least one tile.');
  if (ground !== 'grass' && ground !== 'dirt') throw new Error('Ground brush must be grass or dirt.');
  const edits = new Map(candidate.ground.map(edit => [`${edit.tx},${edit.ty}`, edit]));
  for (const value of stroke) {
    const tile = record(value, ['tx', 'ty'], 'Brush tile');
    const tx = coordinate(tile.tx, BASE.w, 'Brush x'), ty = coordinate(tile.ty, BASE.h, 'Brush y');
    assertPaintable(tx, ty);
    const key = `${tx},${ty}`;
    if (BASE.ground[ty][tx] === ground) edits.delete(key); else edits.set(key, { tx, ty, ground });
  }
  candidate.ground = [...edits.values()];
  return validateTownLayoutDraft(candidate);
}

/** Parse bounded untrusted town JSON; cross-map, stale, corrupt, and invalid geometry imports fail visibly. */
export function parseTownLayoutDraft(text: string): TownLayoutDraft {
  if (typeof text !== 'string' || text.length > TOWN_DRAFT_MAX_BYTES || new TextEncoder().encode(text).length > TOWN_DRAFT_MAX_BYTES) {
    throw new Error('Town draft JSON exceeds the 1 MB limit.');
  }
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { throw new Error('Town draft is not valid JSON.'); }
  return validateTownLayoutDraft(input);
}

/** Serialize only canonical town data; runtime IDs and adventure saves never enter an export. */
export function serializeTownLayoutDraft(draft: TownLayoutDraft): string {
  const text = JSON.stringify(validateTownLayoutDraft(draft), null, 2);
  if (new TextEncoder().encode(text).length > TOWN_DRAFT_MAX_BYTES) throw new Error('Town draft JSON exceeds the 1 MB limit.');
  return text;
}
