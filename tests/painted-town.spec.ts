/**
 * Proofs for the painted Town (world/TownArt.ts, save version 27):
 *  - the map built from the painting is whole: the Day 1 start, the four road arrivals and the thirteen door
 *    returns sit on open ground, the four road warps and thirteen door warps point where they should, only
 *    open grass is buildable, roads are kept clear, and the meadow stones are the only resource node;
 *  - the Town textures are wired into the manifest at the painting's size, and the meadow-stone frame holds
 *    real painted pixels around its foot tile;
 *  - a version 26 save made on the 120x110 Town loads on the painting: its Town tree and rock records reset,
 *    every soil cell, crop, furnishing, building and pickup moves intact onto legal ground, the keeper is
 *    carried to their projected spot (or the plaza when that spot is blocked), and open Town meetings are
 *    cancelled with a notice;
 *  - every resident can keep every daily meeting: no meeting starts before both residents can walk there.
 *  - a version 27 or 28 save whose keeper stands where today's walls (the quarter-tile walls of save version 28,
 *    re-fitted to the pixel-art Town in save version 29) now block moves to the plaza with a notice; a version
 *    29 save with the keeper in a wall is rejected.
 * The four roads out of Town are walked with the real keyboard in town-adoption-travel.spec.ts.
 */
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { SceneKey, TextureKey } from '../src/config/AssetKeys';
import { TOWN_ART, TOWN_DOORS, TOWN_GRID, TOWN_NODES } from '../src/world/TownArt';
import { feetBoxHitsFineWall } from '../src/world/FineCollision';
import type * as State from '../src/state/GameState';
import type * as Saves from '../src/systems/SaveSystem';
import type * as Maps from '../src/world/MapDef';
import type * as OldTown from '../src/world/TownMap';
import type * as Schedules from '../src/systems/TownScheduleSystem';
import type * as Routes from '../src/systems/TownRoutePlanSystem';

type API = typeof State & typeof Saves & typeof Maps & typeof OldTown & typeof Schedules & typeof Routes;
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), contents: [
  'export * from "./src/state/GameState";', 'export * from "./src/systems/SaveSystem";', 'export * from "./src/world/MapDef";',
  'export * from "./src/world/TownMap";', 'export * from "./src/systems/TownScheduleSystem";',
  'export * from "./src/systems/TownRoutePlanSystem";',
].join('\n') }, bundle: true, write: false, format: 'cjs', platform: 'node',
define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } }).outputFiles[0].text;

/** Run the real save code against private in-memory storage (never browser storage). */
function runtime() {
  const bytes = new Map<string, string>();
  const storage = {
    /** Return the fixture bytes for a key. */
    getItem(key: string): string | null { return bytes.has(key) ? bytes.get(key)! : null; },
    /** Store one value. */
    setItem(key: string, value: string): void { bytes.set(key, value); },
    /** Delete one value. */
    removeItem(key: string): void { bytes.delete(key); },
  };
  const module = { exports: {} };
  new Function('module', 'exports', 'localStorage', 'window', bundle)(module, module.exports, storage, { location: { search: '?test=1' } });
  return { api: module.exports as API, bytes };
}

/** The 82x75 tile a 120x110 Town tile lands on (migratePaintedTown projects tile centres). */
function project(tx: number, ty: number): { tx: number; ty: number } {
  return { tx: Math.floor((tx + 0.5) * 82 / 120), ty: Math.floor((ty + 0.5) * 75 / 110) };
}

test('the painted Town map is whole: arrivals, roads and doors are open and only grass is buildable', () => {
  const { api } = runtime(), map = api.getMapData(SceneKey.Town);
  expect([map.w, map.h]).toEqual([82, 75]);
  expect(TOWN_GRID).toHaveLength(75);
  for (const row of TOWN_GRID) expect(row).toHaveLength(82);
  const spawn = (id: string) => map.spawns.find(point => point.id === id);
  expect(spawn('start')).toMatchObject({ tx: 29, ty: 39 });
  expect(spawn('from_farm')).toMatchObject({ tx: 2, ty: 20 });
  expect(spawn('from_forest')).toMatchObject({ tx: 2, ty: 50 });
  expect(spawn('from_mountain')).toMatchObject({ tx: 29, ty: 2 });
  expect(spawn('from_beach')).toMatchObject({ tx: 29, ty: 72 });
  for (const point of map.spawns) expect(map.solid[point.ty][point.tx], point.id).toBe(false);
  expect(map.warps.filter(warp => !warp.doorFacing)).toEqual([
    expect.objectContaining({ tx: 0, ty: 20, w: 1, h: 1, target: SceneKey.Farm, spawn: 'from_town' }),
    expect.objectContaining({ tx: 0, ty: 50, w: 1, h: 1, target: SceneKey.Forest, spawn: 'from_town' }),
    expect.objectContaining({ tx: 29, ty: 0, w: 2, h: 1, target: SceneKey.Mountain, spawn: 'from_town' }),
    expect.objectContaining({ tx: 29, ty: 74, w: 2, h: 1, target: SceneKey.Beach, spawn: 'from_town' }),
  ]);
  // Every painted door is a 2-wide north-facing warp on open ground, and its return arrival is two tiles below.
  const doors = map.warps.filter(warp => warp.doorFacing);
  expect(doors).toHaveLength(Object.keys(TOWN_DOORS).length);
  for (const [id, door] of Object.entries(TOWN_DOORS)) {
    const warp = doors.find(entry => entry.tx === door.tx && entry.ty === door.ty);
    expect(warp, id).toMatchObject({ w: 2, h: 1, spawn: 'entry', doorFacing: 'north' });
    for (let x = door.tx; x < door.tx + 2; x++) expect(map.solid[door.ty][x], `${id} door ${x}`).toBe(false);
    expect(map.spawns.some(point => point.id === `from_${id}` && point.tx === door.tx && point.ty === door.ty + 2), id).toBe(true);
  }
  // Each road out of Town is answered by a road back on the neighbouring map.
  for (const target of [SceneKey.Farm, SceneKey.Forest, SceneKey.Mountain, SceneKey.Beach]) {
    expect(api.getMapData(target).warps.filter(warp => warp.target === SceneKey.Town).length, target).toBeGreaterThan(0);
  }
  let buildable = 0;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (!map.buildable[ty][tx]) continue;
    buildable++;
    expect(TOWN_GRID[ty][tx], `${tx},${ty}`).toBe(',');
  }
  expect(buildable).toBeGreaterThan(200);
  // why: roads carry the residents' routes, so the keeper may never build on them.
  if (!map.reservedTiles) throw new Error('the painted Town must list its reserved road tiles');
  const reserved = new Set(map.reservedTiles.map(cell => `${cell.tx},${cell.ty}`));
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (TOWN_GRID[ty][tx] === '=') expect(reserved.has(`${tx},${ty}`), `${tx},${ty}`).toBe(true);
  }
  expect(map.objects.map(obj => [obj.kind, obj.tx, obj.ty])).toEqual([['rock', 64, 57]]);
  expect(map.ground.flat()).toEqual(expect.arrayContaining(['grass', 'dirt', 'water']));
});

test('the Town textures match the painting and the meadow-stone frame sits on its foot tile', () => {
  const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')).textures;
  for (const [key, file] of [[TextureKey.Town, 'town/town.png'], [TextureKey.TownFront, 'town/town-front.png'], [TextureKey.TownNodes, 'town/town-nodes.png']]) {
    expect(manifest[key]).toEqual({ type: 'image', file });
  }
  for (const file of ['town.png', 'town-front.png']) {
    const image = PNG.sync.read(readFileSync(`public/assets/town/${file}`));
    expect([image.width, image.height], file).toEqual([TOWN_ART.widthTexels, TOWN_ART.heightTexels]);
  }
  expect([TOWN_ART.widthTexels, TOWN_ART.heightTexels]).toEqual([82 * 32, 75 * 32]);
  const atlas = PNG.sync.read(readFileSync('public/assets/town/town-nodes.png'));
  const alpha = (x: number, y: number): number => atlas.data[(y * atlas.width + x) * 4 + 3];
  expect(TOWN_NODES).toHaveLength(1);
  const [stones] = TOWN_NODES, art = stones.painted!;
  expect(art.texture).toBe(TextureKey.TownNodes);
  expect(art.frameX + art.w <= atlas.width && art.frameY + art.h <= atlas.height).toBe(true);
  let solid = 0;
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) if (alpha(art.frameX + x, art.frameY + y) >= 128) solid++;
  expect(solid / (art.w * art.h)).toBeGreaterThan(0.3);
  const footX = Math.round((stones.tx + 0.5) * 32) - art.roomX, footY = (stones.ty + 1) * 32 - art.roomY;
  let near = 0;
  for (let y = Math.max(0, footY - 24); y < Math.min(art.h, footY + 4); y++) {
    for (let x = Math.max(0, footX - 12); x < Math.min(art.w, footX + 12); x++) if (alpha(art.frameX + x, art.frameY + y) >= 128) near++;
  }
  expect(near).toBeGreaterThan(100);
});

test('a version 26 save on the 120x110 Town loads on the painting with every change explained', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1);
  const oldTown = api.getAuthoredTownMap(), map = api.getMapData(SceneKey.Town);
  expect([oldTown.w, oldTown.h]).toEqual([120, 110]);
  /** First old-Town tile (row-major) whose w x h block passes the test. */
  const firstOld = (test: (tx: number, ty: number) => boolean, w = 1, h = 1, after = 0): { tx: number; ty: number } => {
    for (let ty = 1; ty + h < oldTown.h; ty++) for (let tx = 1; tx + w < oldTown.w; tx++) {
      if (ty * oldTown.w + tx < after) continue;
      let all = true;
      for (let y = ty; y < ty + h && all; y++) for (let x = tx; x < tx + w; x++) if (!test(x, y)) all = false;
      if (all) return { tx, ty };
    }
    throw new Error('old Town has no such block');
  };
  const oldBuildable = (tx: number, ty: number) => oldTown.buildable[ty][tx];
  const shopAt = firstOld(oldBuildable, 2, 2), soil = firstOld(oldBuildable, 1, 1, (shopAt.ty + 3) * oldTown.w);
  const chairAt = firstOld(oldBuildable, 1, 1, (soil.ty + 2) * oldTown.w), dropAt = firstOld(oldBuildable, 1, 1, (chairAt.ty + 2) * oldTown.w);
  // The keeper stands where the old Town was open but the painting is solid, so they go to the plaza.
  const keeper = firstOld((tx, ty) => !oldTown.solid[ty][tx] && map.solid[project(tx, ty).ty][project(tx, ty).tx]);
  const soilKey = `${SceneKey.Town}:${soil.tx},${soil.ty}`;
  const state = new api.GameState().toSaveData();
  state.day = 3;
  state.activeScene = SceneKey.Town;
  state.player = { x: keeper.tx * 16 + 8, y: keeper.ty * 16 + 8, facing: 'up', stamina: 50 };
  state.removedNodes = { [`${SceneKey.Town}:40,40`]: { kind: 'tree', day: 2 }, [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } };
  state.treeStages = { [`${SceneKey.Town}:40,40`]: { stage: 'stump', sinceDay: 2 } };
  state.tiles = { [soilKey]: 'tilled' };
  state.crops = { [soilKey]: { type: 'parsnip', stage: 1, maxStage: 3, daysInStage: 0, watered: false } };
  state.placedItems = [{ item: 'chair', scene: SceneKey.Town, tx: chairAt.tx, ty: chairAt.ty, rotation: 1 }];
  state.placements = [{ id: 'town-shop', type: 'shop', scene: SceneKey.Town, tx: shopAt.tx, ty: shopAt.ty, w: 2, h: 2 }];
  state.groundDrops = [{ scene: SceneKey.Town, item: 'wood', tx: dropAt.tx, ty: dropAt.ty }];
  state.social = { ...state.social, plans: [
    { id: 'plan:1:tessa', residentId: 'tessa', madeDay: 1, day: 2, destination: 'market-green', label: 'Fountain Plaza', tx: 50, ty: 50, startsAt: 400, endsAt: 445, kept: true },
    { id: 'plan:3:rhea', residentId: 'rhea', madeDay: 3, day: 4, destination: 'old-oak', label: 'Old Oak', tx: 60, ty: 60, startsAt: 500, endsAt: 545, kept: false },
  ] };
  state.townLife = { ...state.townLife, invite: { residentId: 'kit', offeredDay: 3, day: 4, label: 'Fishing Bank', tx: 20, ty: 90, startsAt: 300, endsAt: 360, kept: false } };
  bytes.set(key, JSON.stringify({ version: 26, slot: 1, savedAt: 9, state }));

  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(loaded.removedNodes).toEqual({ [`${SceneKey.Mountain}:5,5`]: { kind: 'rock', day: 3 } });
  expect(loaded.treeStages).toEqual({});
  /** True when a tile is inside the painting and open. */
  const open = (tx: number, ty: number) => tx > 0 && ty > 0 && tx < map.w - 1 && ty < map.h - 1 && !map.solid[ty][tx];
  // Soil and its crop move together as one record (so the notice counts 4 records), intact, onto grass or dirt.
  const [newSoilKey] = Object.keys(loaded.tiles);
  expect(Object.values(loaded.tiles)).toEqual(['tilled']);
  expect(loaded.crops).toEqual({ [newSoilKey]: { type: 'parsnip', stage: 1, maxStage: 3, daysInStage: 0, watered: false } });
  const [soilX, soilY] = newSoilKey.replace(`${SceneKey.Town}:`, '').split(',').map(Number);
  expect(open(soilX, soilY)).toBe(true);
  expect(['grass', 'dirt']).toContain(map.ground[soilY][soilX]);
  // The building keeps its id, type and size, and stands wholly on buildable ground.
  const shop = loaded.placements.find(placement => placement.id === 'town-shop')!;
  expect(shop).toMatchObject({ type: 'shop', scene: SceneKey.Town, w: 2, h: 2 });
  for (let y = shop.ty; y < shop.ty + 2; y++) for (let x = shop.tx; x < shop.tx + 2; x++) expect(map.buildable[y][x], `${x},${y}`).toBe(true);
  // The chair keeps its rotation and the pickup its item; both stand on open, unreserved ground.
  if (!map.reservedTiles) throw new Error('the painted Town must list its reserved road tiles');
  const reserved = new Set(map.reservedTiles.map(cell => `${cell.tx},${cell.ty}`));
  expect(loaded.placedItems).toEqual([expect.objectContaining({ item: 'chair', scene: SceneKey.Town, rotation: 1 })]);
  const chair = loaded.placedItems[0];
  expect(open(chair.tx, chair.ty) && !reserved.has(`${chair.tx},${chair.ty}`)).toBe(true);
  const drops = loaded.groundDrops.filter(drop => drop.scene === SceneKey.Town);
  expect(drops).toEqual([expect.objectContaining({ item: 'wood' })]);
  expect(open(drops[0].tx, drops[0].ty)).toBe(true);
  // The keeper's projected spot is solid, so they start in the plaza.
  expect(loaded.player).toMatchObject({ x: 29.5 * 16, y: 39.5 * 16, facing: 'down', stamina: 50 });
  // The kept plan from the past stays as history; the open plan and the open invite are cancelled.
  expect(loaded.social.plans.map(plan => plan.id)).toEqual(['plan:1:tessa']);
  expect(loaded.townLife.invite).toBeNull();
  for (const line of ['The town has a new look, so all of its trees, rocks and weeds stand again.',
    'Willowbrook has a new painted look', 'The new Town moved 4 saved placements', 'Your keeper moved to a safe arrival',
    'The Town has moved, so 2 meetings you agreed to in Town are cancelled.']) {
    expect(notice).toContain(line);
  }

  // A save made by this version is not moved again.
  api.SaveSystem.save(1, 10);
  expect(JSON.parse(bytes.get(key)!).version).toBe(30);
  const again = api.SaveSystem.load(1);
  expect(again.player).toEqual(loaded.player);
  expect(again.placements).toEqual(loaded.placements);
  expect(again.tiles).toEqual(loaded.tiles);
  expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();
});

test('a version 26 keeper on an open Town tile is carried to the matching spot on the painting', () => {
  const { api, bytes } = runtime(), key = api.SaveSystem.storageKey(1);
  const oldTown = api.getAuthoredTownMap(), map = api.getMapData(SceneKey.Town);
  // why: the keeper's 8x6 body box may poke into a neighbour tile, so the projected tile and all eight
  // neighbours must be open; every open painted tile is reachable (town-adoption-travel.spec.ts proves it).
  const openAround = (tx: number, ty: number): boolean => {
    for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if (map.solid[y][x]) return false;
    return true;
  };
  let oldSpot: { tx: number; ty: number } | null = null;
  for (let ty = 2; ty < oldTown.h - 2 && !oldSpot; ty++) for (let tx = 2; tx < oldTown.w - 2 && !oldSpot; tx++) {
    const target = project(tx, ty);
    if (!oldTown.solid[ty][tx] && target.tx > 0 && target.ty > 0 && openAround(target.tx, target.ty)) oldSpot = { tx, ty };
  }
  if (!oldSpot) throw new Error('no old Town tile projects onto open painted ground');
  const state = new api.GameState().toSaveData();
  state.activeScene = SceneKey.Town;
  state.player = { x: (oldSpot.tx + 0.5) * 16, y: (oldSpot.ty + 0.5) * 16, facing: 'left', stamina: 40 };
  bytes.set(key, JSON.stringify({ version: 26, slot: 1, savedAt: 9, state }));
  const loaded = api.SaveSystem.load(1), notice = api.SaveSystem.consumeMigrationNotice();
  expect(loaded.player.x).toBeCloseTo((oldSpot.tx + 0.5) * 16 * 82 / 120, 6);
  expect(loaded.player.y).toBeCloseTo((oldSpot.ty + 0.5) * 16 * 75 / 110, 6);
  expect(loaded.player).toMatchObject({ facing: 'left', stamina: 40 });
  expect(notice).toContain('Willowbrook has a new painted look');
  expect(notice).not.toContain('Your keeper moved');
});

test('every daily meeting leaves both residents time to walk there and back', () => {
  const { api } = runtime(), map = api.getMapData(SceneKey.Town);
  const base = new api.GameState().relationships;
  let checked = 0;
  // why: meetings and spots are drawn from the save's social seed, so a spread of seeds covers far pairings.
  for (const socialSeed of [1, 7, 42, 99, 123, 2024, 31337, 65535]) {
    const relationships = { ...base, socialSeed };
    for (let day = 1; day <= 28; day++) {
      for (const meeting of api.townMeetingsForDay(day, relationships)) {
        for (const residentId of meeting.residents) {
          const result = api.tryAuthoredTownRouteDay(residentId, day, map, meeting, null);
          expect(result.ok ? 'ok' : result.reason, `seed ${socialSeed} day ${day} ${residentId}`).toBe('ok');
          checked++;
        }
      }
    }
  }
  expect(checked).toBe(8 * 28 * 12);
});

test('a keeper saved where the quarter-tile walls now block moves to the plaza, and a new save there is rejected', () => {
  const { api, bytes } = runtime(), map = api.getMapData(SceneKey.Town), key = api.SaveSystem.storageKey(1);
  if (!map.fineSolid) throw new Error('the painted Town must have fine walls');
  const fine = map.fineSolid;
  // why: a feet point 3 px into an open tile whose left edge is wall keeps the feet tile open (so the tile
  // checks pass) while the 8 px feet box reaches into the wall.
  const spots: Array<{ x: number; y: number }> = [];
  for (let ty = 1; ty < map.h - 1; ty++) for (let tx = 1; tx < map.w - 1; tx++) {
    const x = tx * 16 + 3, y = ty * 16 + 8;
    if (!map.solid[ty][tx] && feetBoxHitsFineWall(fine, x, y)) spots.push({ x, y });
  }
  expect(spots.length).toBeGreaterThan(0);
  const inWall = spots[0];
  /** Store a Town save at one feet point under one envelope version. */
  const store = (version: number, at: { x: number; y: number }) => {
    const state = new api.GameState().toSaveData();
    state.activeScene = SceneKey.Town;
    state.player = { x: at.x, y: at.y, facing: 'up', stamina: 50 };
    bytes.set(key, JSON.stringify({ version, slot: 1, savedAt: 9, state }));
  };

  store(27, inWall);
  const moved = api.SaveSystem.load(1);
  expect(moved.player).toMatchObject({ x: 29.5 * 16, y: 39.5 * 16, facing: 'down', stamina: 50 });
  expect(api.SaveSystem.consumeMigrationNotice()).toContain('The Town walls now follow the painting more closely.');

  // A keeper clear of the walls keeps their exact spot and gets no notice.
  const clear = { x: 29.5 * 16 + 1, y: 39.5 * 16 };
  expect(feetBoxHitsFineWall(fine, clear.x, clear.y)).toBe(false);
  store(27, clear);
  expect(api.SaveSystem.load(1).player).toMatchObject({ x: clear.x, y: clear.y, facing: 'up' });
  expect(api.SaveSystem.consumeMigrationNotice()).toBeNull();

  // Version 28 knew the walls of the old picture, not the redrawn one, so its keeper moves the same way.
  store(28, inWall);
  expect(api.SaveSystem.load(1).player).toMatchObject({ x: 29.5 * 16, y: 39.5 * 16, facing: 'down', stamina: 50 });
  expect(api.SaveSystem.consumeMigrationNotice()).toContain('The Town walls now follow the painting more closely.');

  // From version 29 the walls are known, so a keeper inside one is a broken save, not a migration.
  store(29, inWall);
  expect(() => api.SaveSystem.load(1)).toThrow(/is inside a .* wall/);
});
