/**
 * Normal-adventure Town travel on the painted Town (world/TownArt.ts, save version 27): the production map is the
 * painting with no editor override, every open tile is reachable from the Day 1 start, all four roads work through
 * real keyboard movement, and the three painted river bridges cross on foot.
 */
import { expect, test, type Page } from '@playwright/test';
import { buildSync } from 'esbuild';
import { bootGame, getState, teleport } from './helpers/gameHarness';
import type * as Maps from '../src/world/MapDef';

/**
 * Load production map resolution without a browser or editor URL; exports stay detached from other tests.
 * @returns the MapDef module exports
 */
function model(): typeof Maps {
  const source = buildSync({ stdin: { contents: 'export * from "./src/world/MapDef.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } });
  const module = { exports: {} };
  new Function('module', 'exports', source.outputFiles[0].text)(module, module.exports);
  return module.exports as typeof Maps;
}

test('normal production Town is the painting and every open tile is reachable from the start', () => {
  const api = model(), map = api.getMapData('TownScene' as never);
  expect(map).toEqual(api.getAuthoredMapData('TownScene' as never));
  expect(map).toMatchObject({ w: 82, h: 75, buildings: [] });
  expect(map.townPlan).toBeUndefined();
  expect(map.warps.slice(0, 4).map(warp => [warp.tx, warp.ty, warp.w, warp.h, warp.target, warp.spawn])).toEqual([
    [0, 20, 1, 1, 'FarmScene', 'from_town'],
    [0, 50, 1, 1, 'ForestScene', 'from_town'],
    [29, 0, 2, 1, 'MountainScene', 'from_town'],
    [29, 74, 2, 1, 'BeachScene', 'from_town'],
  ]);
  // ResourceNode colliders occupy exactly their anchor tile. Tile-center cardinal travel leaves room for player feet.
  const blocked = map.solid.map(row => row.slice());
  for (const object of map.objects) blocked[object.ty][object.tx] = true;
  const start = map.spawns.find(spawn => spawn.id === 'start');
  if (!start) throw new Error('Normal Town has no start arrival');
  const visited = new Set<number>(), queue = [start.ty * map.w + start.tx];
  visited.add(queue[0]);
  for (let index = 0; index < queue.length; index++) {
    const cell = queue[index], tx = cell % map.w, ty = Math.floor(cell / map.w);
    for (const [x, y] of [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]]) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h || blocked[y][x]) continue;
      const next = y * map.w + x;
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  // why: the painting has no fenced pockets, so one walk from the start must touch every open tile, every warp
  // (roads and doors) and every arrival. A pocket would strand a dropped item or a resident route.
  let open = 0;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (blocked[ty][tx]) continue;
    open++;
    expect(visited.has(ty * map.w + tx), `Unreachable open tile ${tx},${ty}`).toBe(true);
  }
  expect(open).toBeGreaterThan(1000);
  for (const warp of map.warps) for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
    for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) expect(visited.has(ty * map.w + tx), `${warp.target} ${tx},${ty}`).toBe(true);
  }
  for (const arrival of map.spawns) expect(visited.has(arrival.ty * map.w + arrival.tx), arrival.id).toBe(true);
});

/** Position just inside an authored edge, then cross through real movement; target is always an explicit expectation. */
async function walkEdge(page: Page, target: string): Promise<void> {
  const approach = await page.evaluate(async target => {
    // @ts-expect-error Vite resolves the actual world module inside the browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData(window.__TEST__!.activeScene());
    const warp = map.warps.find((warp: { target: string }) => warp.target === target);
    if (!warp) throw new Error(`No authored route to ${target}`);
    if (warp.tx === 0) return { tx: 2, ty: warp.ty + Math.floor(warp.h / 2), key: 'a', facing: 'left' };
    if (warp.tx >= map.w - 2) return { tx: map.w - 4, ty: warp.ty + Math.floor(warp.h / 2), key: 'd', facing: 'right' };
    if (warp.ty === 0) return { tx: warp.tx + Math.floor(warp.w / 2), ty: 2, key: 'w', facing: 'up' };
    if (warp.ty >= map.h - 2) return { tx: warp.tx + Math.floor(warp.w / 2), ty: map.h - 4, key: 's', facing: 'down' };
    throw new Error(`Route to ${target} is not on a map edge`);
  }, target);
  await teleport(page, approach.tx, approach.ty, approach.facing);
  await holdUntilScene(page, approach.key, target);
}

/** Hold a real keyboard key until the expected scene finishes loading; release it even when travel fails. */
async function holdUntilScene(page: Page, key: string, target: string): Promise<void> {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(target => window.__TEST__!.ready && window.__TEST__!.activeScene() === target, target);
  } finally { await page.keyboard.up(key); }
  await expect.poll(async () => (await getState(page)).transitionActive).toBe(false);
}

test('ordinary adventure walks all four Town return routes, with an outdoor stop before the separate mine entrance', async ({ page }) => {
  test.setTimeout(90_000);
  await bootGame(page);
  expect(new URL(page.url()).searchParams.has('mapPreview')).toBe(false);
  expect(new URL(page.url()).searchParams.has('mapEditor')).toBe(false);
  await walkEdge(page, 'TownScene');
  for (const target of ['FarmScene', 'ForestScene', 'MountainScene', 'BeachScene']) {
    await walkEdge(page, target);
    const arrived = await getState(page);
    expect(arrived.activeScene).toBe(target);
    expect(Number.isFinite(arrived.player.x) && Number.isFinite(arrived.player.y)).toBe(true);
    if (target === 'MountainScene') {
      const outdoors = await page.evaluate(() => window.__TEST__!.groundAt(40, 55));
      expect(['grass', 'dirt', 'stone']).toContain(outdoors);
      await teleport(page, 39, 14, 'up');
      await holdUntilScene(page, 'w', 'MinesScene');
      expect(await page.evaluate(() => window.__TEST__!.groundAt(25, 4))).toBe('cave');
      await teleport(page, 25, 4, 'up');
      await holdUntilScene(page, 'w', 'MountainScene');
    }
    await walkEdge(page, 'TownScene');
  }
});

/**
 * The three river bridges drawn into the Town painting (rows and columns from TOWN_GRID): each one is walked
 * from the dry road on one bank to the dry road on the other.
 *  - from: the road tile the keeper starts on; past: the tile coordinate (x or y) the feet must pass.
 */
const PAINTED_BRIDGES = [
  { id: 'north-east', from: { tx: 50, ty: 23 }, key: 'd', facing: 'right', axis: 'x', past: 64 },
  { id: 'east', from: { tx: 50, ty: 40 }, key: 'd', facing: 'right', axis: 'x', past: 62 },
  { id: 'south', from: { tx: 29, ty: 54 }, key: 's', facing: 'down', axis: 'y', past: 64 },
] as const;

test('the painted Town river bridges cross through keyboard movement at player scale', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await bootGame(page);
  await walkEdge(page, 'TownScene');
  const water = await page.evaluate(async bridges => {
    // @ts-expect-error Vite resolves authored map data inside the live normal adventure.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData('TownScene');
    // why: prove each walk really spans the river, so a moved bridge cannot pass on dry land.
    return bridges.map(bridge => {
      const cells: string[] = [];
      for (let step = 1; ; step++) {
        const tx = bridge.axis === 'x' ? bridge.from.tx + step : bridge.from.tx;
        const ty = bridge.axis === 'y' ? bridge.from.ty + step : bridge.from.ty;
        if ((bridge.axis === 'x' ? tx : ty) > bridge.past) break;
        if (map.solid[ty][tx]) throw new Error(`${bridge.id} bridge is blocked at ${tx},${ty}`);
        // The bridges are two to four tiles wide, so look up to four tiles to each side of the walked line.
        const side = [-4, -3, -2, -1, 1, 2, 3, 4].map(off => bridge.axis === 'x' ? map.ground[ty + off][tx] : map.ground[ty][tx + off]);
        if (side.includes('water')) cells.push(`${tx},${ty}`);
      }
      return cells.length;
    });
  }, PAINTED_BRIDGES);
  for (const [index, cells] of water.entries()) expect(cells, PAINTED_BRIDGES[index].id).toBeGreaterThan(1);
  for (const bridge of PAINTED_BRIDGES) {
    await teleport(page, bridge.from.tx, bridge.from.ty, bridge.facing);
    await page.keyboard.down(bridge.key);
    try {
      await expect.poll(async () => {
        const player = (await getState(page)).player;
        return (bridge.axis === 'x' ? player.x : player.y) / 16;
      }, { timeout: 10_000 }).toBeGreaterThan(bridge.past);
    } finally { await page.keyboard.up(bridge.key); }
    expect((await getState(page)).activeScene).toBe('TownScene');
    const middle = Math.floor(((bridge.axis === 'x' ? bridge.from.tx : bridge.from.ty) + bridge.past) / 2);
    await teleport(page, bridge.axis === 'x' ? middle : bridge.from.tx, bridge.axis === 'y' ? middle : bridge.from.ty, 'down');
    await page.waitForTimeout(300); // Let the normal follow camera settle, without changing its zoom.
    await page.screenshot({ path: testInfo.outputPath(`bridge-${bridge.id}.png`) });
  }
  await teleport(page, 29, 39, 'down');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('normal-town-player-scale.png') });
});
