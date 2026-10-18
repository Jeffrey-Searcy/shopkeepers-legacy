/**
 * Detached, versioned farm-layout authoring data. Import and every edit validate before returning.
 * This module owns no browser storage, live scene, save state, or gameplay entity instances.
 * Tree canopies intentionally overlap; placement uses their real one-tile trunk bodies.
 */
import { SceneKey } from '../config/AssetKeys';
import { PLAYER_BODY, TILE } from '../config/GameConfig';
import { getShopGeometry } from '../config/Shop';
import { getAuthoredMapData, getLegacyFarmMapData, type DecorDef, type MapData, type ObjectDef } from '../world/MapDef';

/** A persistent editor identity tied to an authored object and this draft's base fingerprint. */
export interface FarmDraftObject extends ObjectDef { id: string }
/** A persistent editor identity for non-blocking decoration; moving it never creates a collider. */
export interface FarmDraftDecor extends DecorDef { id: string }
/** Sparse ground edits; frozen terrain and external exits never appear here. */
export interface FarmGroundEdit { tx: number; ty: number; ground: 'grass' | 'dirt' }
/** The JSON document is a complete movable-entity list plus sparse terrain changes. */
export interface FarmLayoutDraft {
  version: 1;
  baseFingerprint: string;
  shop: { id: 'shop'; tx: number; ty: number };
  objects: FarmDraftObject[];
  decor: FarmDraftDecor[];
  ground: FarmGroundEdit[];
}
/** Pixel rectangle used by editor picking and collision checks; fractional tile sizes remain exact. */
export interface FarmDraftFootprint { x: number; y: number; w: number; h: number }
/** Read-only presentation record; shop coordinates are its tile anchor, not the entrance tile. */
export interface FarmLayoutEntity {
  id: string;
  kind: string;
  group: 'shop' | 'object' | 'decor';
  tx: number;
  ty: number;
  footprint: FarmDraftFootprint;
}

export const FARM_DRAFT_MAX_BYTES = 1_000_000;
const BASE = getAuthoredMapData(SceneKey.Farm);
const LEGACY_BASE = getLegacyFarmMapData();
// This one published baseline has a lossless conversion. Unknown fingerprints still fail closed.
const LEGACY_FINGERPRINT = 'farm-v1-af059b10';
// Artwork coordinates always refer to the original facade, not the latest authored layout.
const SHOP_ANCHOR = { tx: 68, ty: 5 };
const ROOT_KEYS = ['version', 'baseFingerprint', 'shop', 'objects', 'decor', 'ground'];

/** Fingerprint all authored geometry so stale documents cannot silently target a changed farm. */
function fingerprint(value: MapData): string {
  let hash = 2166136261;
  const text = JSON.stringify(value);
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `farm-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
const BASE_FINGERPRINT = fingerprint(BASE);
if (fingerprint(LEGACY_BASE) !== LEGACY_FINGERPRINT) throw new Error('Legacy farm migration baseline changed.');

/** Resolve an authored anchor from its explicit art offset; missing geometry is an authoring error. */
function baseAnchor(base: MapData): { tx: number; ty: number } {
  if (!base.shopOffset) throw new Error('Authored farm shop offset is missing.');
  return { tx: SHOP_ANCHOR.tx + base.shopOffset.tx, ty: SHOP_ANCHOR.ty + base.shopOffset.ty };
}

/** Produce a stable authored identity; imported lists must preserve the original ordering and kinds. */
function entityId(group: 'object' | 'decor', index: number): string {
  return `${group}:${index.toString().padStart(4, '0')}`;
}

/** Reject arrays, unexpected keys, accessors, and exotic objects before reading untrusted fields. */
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

/** Require a whole tile inside the authored dimensions; no clamping or implicit default occurs. */
function coordinate(value: unknown, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= maximum) {
    throw new Error(`${label} must be a whole tile from 0 to ${maximum - 1}.`);
  }
  return value;
}

/** Enumerate every tile touched by a pixel footprint; touching its outside edge does not overlap. */
function rectangleTiles(rect: FarmDraftFootprint): Array<{ tx: number; ty: number }> {
  const result: Array<{ tx: number; ty: number }> = [];
  for (let ty = Math.floor(rect.y / TILE); ty < Math.ceil((rect.y + rect.h) / TILE); ty++) {
    for (let tx = Math.floor(rect.x / TILE); tx < Math.ceil((rect.x + rect.w) / TILE); tx++) result.push({ tx, ty });
  }
  return result;
}

/** Compare actual pixel rectangles; shared boundaries are legal. */
function overlaps(a: FarmDraftFootprint, b: FarmDraftFootprint): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Keep all external warp cells, their one-tile approaches, and external arrival tiles unchanged.
 * @param base the farm whose exits are frozen (the current authored farm or the legacy baseline)
 * @returns "tx,ty" keys no draft may paint or cover
 */
function exteriorTiles(base: MapData): Set<string> {
  const tiles = new Set<string>();
  for (const warp of base.warps.filter(warp => warp.target !== SceneKey.Tavern)) {
    for (let ty = Math.max(0, warp.ty - 1); ty <= Math.min(base.h - 1, warp.ty + warp.h); ty++) {
      for (let tx = Math.max(0, warp.tx - 1); tx <= Math.min(base.w - 1, warp.tx + warp.w); tx++) tiles.add(`${tx},${ty}`);
    }
  }
  for (const spawn of base.spawns.filter(spawn => spawn.id !== 'start' && spawn.id !== 'from_home')) {
    tiles.add(`${spawn.tx},${spawn.ty}`);
  }
  return tiles;
}
const EXTERIOR_TILES = exteriorTiles(BASE);
const LEGACY_EXTERIOR_TILES = exteriorTiles(LEGACY_BASE);

/**
 * True when a tile is water, cliff, the map boundary, or fixed external circulation on that base.
 * @param base the farm the tile belongs to; a legacy draft is judged by the legacy farm's exits
 */
function isFrozen(base: MapData, tx: number, ty: number): boolean {
  if (base !== BASE && base !== LEGACY_BASE) throw new Error('Farm draft base must be the authored or legacy farm.');
  const exterior = base === BASE ? EXTERIOR_TILES : LEGACY_EXTERIOR_TILES;
  return tx === 0 || ty === 0 || tx === base.w - 1 || ty === base.h - 1 || exterior.has(`${tx},${ty}`) ||
    (base.ground[ty][tx] !== 'grass' && base.ground[ty][tx] !== 'dirt');
}

/** Reject terrain edits on frozen tiles of the given base (see isFrozen). */
function assertPaintable(base: MapData, tx: number, ty: number): void {
  if (isFrozen(base, tx, ty)) throw new Error(`Tile ${tx},${ty} is frozen terrain or an external exit.`);
}

/** Build detached picking records from already structurally valid data, without spawning game objects. */
function entities(draft: FarmLayoutDraft): FarmLayoutEntity[] {
  const offset = { tx: draft.shop.tx - SHOP_ANCHOR.tx, ty: draft.shop.ty - SHOP_ANCHOR.ty };
  const { front } = getShopGeometry(offset);
  return [
    { ...draft.shop, kind: 'shop', group: 'shop', footprint: { x: front.x, y: front.y, w: 160, h: 160 } },
    ...draft.objects.map(object => ({ ...object, group: 'object' as const,
      footprint: object.kind === 'bin'
        ? { x: object.tx * TILE + TILE / 2 - 20, y: (object.ty + 1) * TILE - 26, w: 40, h: 26 }
        : { x: object.tx * TILE, y: object.ty * TILE, w: TILE, h: TILE } })),
    ...draft.decor.map(decor => ({ ...decor, group: 'decor' as const,
      footprint: { x: decor.tx * TILE, y: decor.ty * TILE, w: TILE, h: TILE } })),
  ];
}

/** Compile an already validated document into detached map data; object IDs remain editor-only. */
function compile(draft: FarmLayoutDraft, base: MapData = BASE): MapData {
  const map = structuredClone(base), anchor = baseAnchor(base);
  const dx = draft.shop.tx - anchor.tx, dy = draft.shop.ty - anchor.ty;
  const artDx = draft.shop.tx - SHOP_ANCHOR.tx, artDy = draft.shop.ty - SHOP_ANCHOR.ty;
  map.shopOffset = { tx: artDx, ty: artDy };
  for (const edit of draft.ground) map.ground[edit.ty][edit.tx] = edit.ground;
  map.objects = draft.objects.map(({ kind, tx, ty }) => ({ kind, tx, ty }));
  map.decor = draft.decor.map(({ kind, tx, ty }) => ({ kind, tx, ty }));
  // Clear this baseline's walls, not the historical facade position; art stays original-relative.
  const baseDx = anchor.tx - SHOP_ANCHOR.tx, baseDy = anchor.ty - SHOP_ANCHOR.ty;
  for (let ty = 9 + baseDy; ty <= 12 + baseDy; ty++) for (let tx = 69 + baseDx; tx <= 76 + baseDx; tx++) map.solid[ty][tx] = false;
  for (let ty = 9 + artDy; ty <= 12 + artDy; ty++) for (let tx = 69 + artDx; tx <= 76 + artDx; tx++) map.solid[ty][tx] = true;
  for (const spawn of map.spawns) if (spawn.id === 'start' || spawn.id === 'from_home') { spawn.tx += dx; spawn.ty += dy; }
  for (const warp of map.warps) if (warp.target === SceneKey.Tavern) { warp.tx += dx; warp.ty += dy; }
  if (!map.reservedTiles) throw new Error('Authored farm circulation is missing.');
  map.reservedTiles = map.reservedTiles.map(tile => ({ tx: tile.tx + dx, ty: tile.ty + dy }));
  // Reuse the original buildable rule, translated with the same farmstead exclusion rectangle.
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    map.buildable[ty][tx] = tx > 2 && ty > 2 && tx < map.w - 3 && ty < map.h - 3 && map.ground[ty][tx] === 'grass' &&
      !(tx >= 68 + artDx && tx <= 82 + artDx && ty >= 6 + artDy && ty <= 15 + artDy);
  }
  return map;
}

/** Validate real placement footprints with tile buckets, avoiding pairwise scans on each pointer move. */
function validatePlacement(draft: FarmLayoutDraft, base: MapData): FarmLayoutEntity[] {
  const items = entities(draft);
  const buckets = new Map<string, FarmLayoutEntity[]>();
  for (const item of items) {
    const rect = item.footprint;
    if (rect.x < TILE || rect.y < TILE || rect.x + rect.w > (BASE.w - 1) * TILE || rect.y + rect.h > (BASE.h - 1) * TILE) {
      throw new Error(`${item.id} extends onto the map boundary.`);
    }
    const touched = rectangleTiles(rect);
    const compared = new Set<string>();
    for (const { tx, ty } of touched) {
      const key = `${tx},${ty}`;
      if (EXTERIOR_TILES.has(key) || BASE.ground[ty][tx] === 'water' || BASE.ground[ty][tx] === 'cliff') {
        throw new Error(`${item.id} overlaps frozen terrain or an external exit at ${key}.`);
      }
      const neighbors = buckets.get(key);
      if (neighbors) for (const neighbor of neighbors) if (!compared.has(neighbor.id)) {
        compared.add(neighbor.id);
        if (overlaps(rect, neighbor.footprint)) throw new Error(`${item.id} overlaps ${neighbor.id}.`);
      }
    }
    for (const { tx, ty } of touched) {
      const key = `${tx},${ty}`, bucket = buckets.get(key);
      if (bucket) bucket.push(item); else buckets.set(key, [item]);
    }
  }
  const anchor = baseAnchor(base), dx = draft.shop.tx - anchor.tx, dy = draft.shop.ty - anchor.ty;
  if (!base.reservedTiles) throw new Error('Authored farm circulation is missing.');
  for (const tile of base.reservedTiles) {
    const tx = tile.tx + dx, ty = tile.ty + dy;
    if (tx < 1 || ty < 1 || tx >= BASE.w - 1 || ty >= BASE.h - 1 ||
      EXTERIOR_TILES.has(`${tx},${ty}`) || BASE.ground[ty][tx] === 'water' || BASE.ground[ty][tx] === 'cliff') {
      throw new Error('The shop approach overlaps frozen terrain or an external exit.');
    }
    const approach = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    const nearby = buckets.get(`${tx},${ty}`);
    if (nearby) for (const item of nearby) if (item.group !== 'shop' && overlaps(approach, item.footprint)) {
      throw new Error(`${item.id} blocks the shop approach.`);
    }
  }
  return items;
}

/** Check player-sized routes to every entrance and fixed arrival; decoration never blocks movement. */
function validateRoutes(map: MapData, items: FarmLayoutEntity[]): void {
  const blocked = map.solid.map(row => row.slice());
  // Runtime tile collision carves every warp, including the south border exit and shop door.
  for (const warp of map.warps) for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
    for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) blocked[ty][tx] = false;
  }
  if (!map.shopOffset) throw new Error('Compiled shop geometry is missing.');
  const colliders = [
    ...items.filter(item => item.group === 'object').map(item => item.footprint),
    ...getShopGeometry(map.shopOffset).bodies.map(body => ({ x: body.x, y: body.y, w: body.width, h: body.height })),
  ];
  // Expand collider testing by half a player body, then test exact tile-center feet rectangles.
  for (const collider of colliders) {
    const expanded = { x: collider.x - PLAYER_BODY.w / 2, y: collider.y - PLAYER_BODY.h / 2,
      w: collider.w + PLAYER_BODY.w, h: collider.h + PLAYER_BODY.h };
    for (const { tx, ty } of rectangleTiles(expanded)) if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) {
      const feet = { x: tx * TILE + TILE / 2 - PLAYER_BODY.w / 2, y: ty * TILE + TILE / 2 - PLAYER_BODY.h / 2,
        w: PLAYER_BODY.w, h: PLAYER_BODY.h };
      if (overlaps(feet, collider)) blocked[ty][tx] = true;
    }
  }
  const start = map.spawns.find(spawn => spawn.id === 'start');
  if (!start || blocked[start.ty][start.tx]) throw new Error('The shop arrival is blocked.');
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
  for (const spawn of map.spawns) if (!visited[spawn.ty * map.w + spawn.tx]) {
    throw new Error(`The route to arrival ${spawn.id} is blocked.`);
  }
  for (const warp of map.warps) {
    let reachable = false;
    for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) {
      if (visited[ty * map.w + tx]) reachable = true;
    }
    if (!reachable) throw new Error(`The route to ${warp.target} is blocked.`);
  }
}

/** Validate a document against its exact known baseline; return detached data without rebasing it. */
function validateAgainstBase(input: unknown, base: MapData, baseFingerprint: string): FarmLayoutDraft {
  const root = record(input, ROOT_KEYS, 'Farm draft');
  if (root.version !== 1) throw new Error('Unsupported farm draft version.');
  if (root.baseFingerprint !== baseFingerprint) throw new Error('Farm draft belongs to a different authored farm version.');
  const shop = record(root.shop, ['id', 'tx', 'ty'], 'Shop');
  if (shop.id !== 'shop') throw new Error('Shop identity cannot change.');
  const draft: FarmLayoutDraft = { version: 1, baseFingerprint,
    shop: { id: 'shop', tx: coordinate(shop.tx, BASE.w, 'Shop x'), ty: coordinate(shop.ty, BASE.h, 'Shop y') },
    objects: [], decor: [], ground: [] };
  for (const group of ['objects', 'decor'] as const) {
    const inputList: unknown = root[group], authored = base[group];
    if (!Array.isArray(inputList) || inputList.length !== authored.length || inputList.length > 4096) {
      throw new Error(`Farm ${group} must retain all ${authored.length} authored entries.`);
    }
    for (let index = 0; index < inputList.length; index++) {
      // Index every authored slot: Array.forEach would silently skip a sparse-array hole.
      const entry = record(inputList[index], ['id', 'kind', 'tx', 'ty'], `${group} entry ${index}`);
      const id = entityId(group === 'objects' ? 'object' : 'decor', index);
      if (entry.id !== id || entry.kind !== authored[index].kind) throw new Error(`${id} identity, kind, or order changed.`);
      const tx = coordinate(entry.tx, BASE.w, `${id} x`), ty = coordinate(entry.ty, BASE.h, `${id} y`);
      if (group === 'objects') draft.objects.push({ id, kind: BASE.objects[index].kind, tx, ty });
      else draft.decor.push({ id, kind: BASE.decor[index].kind, tx, ty });
    }
  }
  if (!Array.isArray(root.ground) || root.ground.length > BASE.w * BASE.h) throw new Error('Ground edits exceed the farm size.');
  const groundIds = new Set<string>();
  for (const value of root.ground as unknown[]) {
    const edit = record(value, ['tx', 'ty', 'ground'], 'Ground edit');
    const tx = coordinate(edit.tx, BASE.w, 'Ground x'), ty = coordinate(edit.ty, BASE.h, 'Ground y');
    if (edit.ground !== 'grass' && edit.ground !== 'dirt') throw new Error('Ground brush must be grass or dirt.');
    assertPaintable(base, tx, ty);
    const id = `${tx},${ty}`;
    if (groundIds.has(id)) throw new Error(`Ground tile ${id} appears twice.`);
    groundIds.add(id);
    if (base.ground[ty][tx] !== edit.ground) draft.ground.push({ tx, ty, ground: edit.ground });
  }
  draft.ground.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  const items = validatePlacement(draft, base);
  validateRoutes(compile(draft, base), items);
  return draft;
}

/** Validate current drafts or explicitly rebase the known v1 farm, preserving its complete realized layout. */
export function validateFarmLayoutDraft(input: unknown): FarmLayoutDraft {
  const root = record(input, ROOT_KEYS, 'Farm draft');
  if (root.baseFingerprint !== LEGACY_FINGERPRINT) return validateAgainstBase(input, BASE, BASE_FINGERPRINT);
  const legacy = validateAgainstBase(input, LEGACY_BASE, LEGACY_FINGERPRINT);
  const realized = compile(legacy, LEGACY_BASE);
  const converted: FarmLayoutDraft = { ...legacy, baseFingerprint: BASE_FINGERPRINT, ground: [] };
  // Sparse edits mean different things on different bases. Compare complete terrain so an old
  // empty draft preserves its old paths too; merely copying its edit list would lose user intent.
  for (let ty = 0; ty < BASE.h; ty++) for (let tx = 0; tx < BASE.w; tx++) {
    const ground = realized.ground[ty][tx];
    if (ground === BASE.ground[ty][tx]) continue;
    // why: tiles frozen on the current farm (new exits such as the north gate trail) belong to the
    // authored farm. No draft can paint them, so an old draft never carries intent there.
    if (isFrozen(BASE, tx, ty)) continue;
    if (ground !== 'grass' && ground !== 'dirt') throw new Error('Legacy farm changes frozen terrain.');
    converted.ground.push({ tx, ty, ground });
  }
  return validateAgainstBase(converted, BASE, BASE_FINGERPRINT);
}

/** Create a validated copy of the original farm, ignoring any installed preview or saved game state. */
export function createFarmLayoutDraft(): FarmLayoutDraft {
  return validateFarmLayoutDraft({ version: 1, baseFingerprint: BASE_FINGERPRINT,
    shop: { id: 'shop', ...baseAnchor(BASE) }, ground: [],
    objects: BASE.objects.map((object, index) => ({ id: entityId('object', index), ...object })),
    decor: BASE.decor.map((decor, index) => ({ id: entityId('decor', index), ...decor })),
  });
}

/** Return picking footprints for a validated detached draft; the rectangles never redefine tree canopy collision. */
export function getFarmLayoutEntities(draft: FarmLayoutDraft): FarmLayoutEntity[] {
  return entities(validateFarmLayoutDraft(draft));
}

/** Compile a strict draft to independent runtime map data without installing it or mutating the source. */
export function compileFarmLayoutDraft(draft: FarmLayoutDraft): MapData {
  return compile(validateFarmLayoutDraft(draft));
}

/** Move exactly one existing editor identity; invalid candidates throw and leave the input untouched. */
export function moveFarmLayoutEntity(draft: FarmLayoutDraft, id: string, tx: number, ty: number): FarmLayoutDraft {
  const candidate = validateFarmLayoutDraft(draft);
  const item = id === 'shop' ? candidate.shop : [...candidate.objects, ...candidate.decor].find(entity => entity.id === id);
  if (!item) throw new Error(`Unknown farm entity ${id}.`);
  item.tx = coordinate(tx, BASE.w, 'Move x'); item.ty = coordinate(ty, BASE.h, 'Move y');
  return validateFarmLayoutDraft(candidate);
}

/** Paint a bounded set of existing grass/dirt tiles; the whole brush stroke commits or throws together. */
export function paintFarmLayoutTiles(draft: FarmLayoutDraft, tiles: Array<{ tx: number; ty: number }>, ground: 'grass' | 'dirt'): FarmLayoutDraft {
  const candidate = validateFarmLayoutDraft(draft);
  if (!Array.isArray(tiles) || tiles.length < 1 || tiles.length > BASE.w * BASE.h) throw new Error('Brush must contain 1–10000 tiles.');
  if (ground !== 'grass' && ground !== 'dirt') throw new Error('Ground brush must be grass or dirt.');
  const edits = new Map(candidate.ground.map(edit => [`${edit.tx},${edit.ty}`, edit]));
  for (const value of tiles) {
    const tile = record(value, ['tx', 'ty'], 'Brush tile');
    const tx = coordinate(tile.tx, BASE.w, 'Brush x'), ty = coordinate(tile.ty, BASE.h, 'Brush y');
    assertPaintable(BASE, tx, ty);
    const id = `${tx},${ty}`;
    if (BASE.ground[ty][tx] === ground) edits.delete(id); else edits.set(id, { tx, ty, ground });
  }
  candidate.ground = [...edits.values()];
  return validateFarmLayoutDraft(candidate);
}

/** Parse bounded untrusted JSON and reject corrupt, stale, unknown, or geometrically invalid documents. */
export function parseFarmLayoutDraft(text: string): FarmLayoutDraft {
  if (typeof text !== 'string' || text.length > FARM_DRAFT_MAX_BYTES || new TextEncoder().encode(text).length > FARM_DRAFT_MAX_BYTES) {
    throw new Error('Farm draft JSON exceeds the 1 MB limit.');
  }
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { throw new Error('Farm draft is not valid JSON.'); }
  return validateFarmLayoutDraft(input);
}

/** Export only canonical validated data; no runtime IDs, saves, or storage keys enter the document. */
export function serializeFarmLayoutDraft(draft: FarmLayoutDraft): string {
  const text = JSON.stringify(validateFarmLayoutDraft(draft), null, 2);
  if (new TextEncoder().encode(text).length > FARM_DRAFT_MAX_BYTES) throw new Error('Farm draft JSON exceeds the 1 MB limit.');
  return text;
}
