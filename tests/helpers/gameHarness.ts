/**
 * gameHarness — Playwright helpers for driving the canvas game through window.__TEST__.
 *
 * Every spec boots with ?test=1&seed=42 (deterministic), waits for readiness, then reads serialized
 * GameState and injects input. This centralizes the seam access so specs stay short and stable.
 */
import { type Page, expect } from '@playwright/test';
import type { TavernState } from '../../src/config/Tavern';
import type { Appearance } from '../../src/config/Appearance';
import type { RelationshipsState } from '../../src/systems/RelationshipSystem';
import type { DialogueState } from '../../src/state/GameState';
import type { CuddleRuntimeState } from '../../src/config/Cuddle';

/** Shape of the serialized state the seam returns (mirrors GameState.serialize). */
export interface SeamState {
  appearance: Appearance;
  appearanceEditorOpen: boolean;
  relationshipJournalOpen: boolean;
  relationships: RelationshipsState;
  cuddle: CuddleRuntimeState;
  tavern: TavernState;
  tavernPanel: 'ledger' | 'kitchen' | null;
  marketPanelOpen: boolean;
  civicServiceBuilding: import('../../src/config/CivicInteriors').ExpandedCivicId | null;
  day: number;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  timeOfDay: number;
  devTuning: { clockScale: number; cropScale: number };
  activeScene: string;
  player: { x: number; y: number; facing: string; stamina: number };
  hotbarIndex: number;
  toolbeltSlots: Array<string | null>;
  backpackSlots: Array<string | null>;
  inventory: Record<string, number>;
  selectedSeed: string;
  canWater: number;
  chest: Record<string, number>;
  tiles: Record<string, string>;
  crops: Record<
    string,
    { type: string; stage: number; maxStage: number; watered: boolean; daysInStage: number }
  >;
  treeStages: Record<string, { stage: string; sinceDay: number }>;
  plantedTrees: Record<string, { species: 'oak' | 'pine'; stage: 'sapling' | 'small' | 'full' | 'stump'; sinceDay: number }>;
  removedNodes: Record<string, { kind: string; day: number }>;
  groundDrops: Array<{ scene: string; item: string; tx: number; ty: number }>;
  placements: Array<{ id: string; type: string; tx: number; ty: number; w: number; h: number; scene: string }>;
  inventoryOpen: boolean;
  chestOpen: boolean;
  craftingOpen: boolean;
  binOpen: boolean;
  paused: boolean;
  transitionActive: boolean;
  pauseConfirmOpen: boolean;
  bin: Record<string, number>;
  gold: number;
  hp: number;
  maxHp: number;
  invulnMs: number;
  dodgeCooldownMs: number;
  weather: 'sunny' | 'rain';
  weatherTomorrow: 'sunny' | 'rain';
  daySummary: {
    day: number;
    lines: Array<{ item: string; qty: number; unit: number; total: number }>;
    total: number;
    gold: number;
  } | null;
  fishing: {
    phase: 'waiting' | 'bite' | 'reeling';
    progress?: number;
    zonePos?: number;
    fishPos?: number;
  } | null;
  dialogue: DialogueState | null;
  placedItems: Array<{ item: string; scene: string; tx: number; ty: number; rotation: number }>;
  placingItem: string | null;
  placingRotation: number;
}

/** Navigate to the game in deterministic test mode and wait until it is controllable. */
export async function bootGame(page: Page, seed = 42): Promise<void> {
  await page.goto(`/?test=1&seed=${seed}`);
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 20_000 });
}

/** Read the current serialized game state. */
export async function getState(page: Page): Promise<SeamState> {
  return page.evaluate(() => window.__TEST__!.state() as unknown as SeamState);
}

/** Map a logical 960×540 UI point through the actual centered camera to browser pointer pixels. */
export async function uiCanvasPoint(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('gameHarness: canvas has no bounding box');
  const scale = Math.min(box.width / 960, box.height / 540);
  return {
    x: box.x + box.width / 2 + (point.x - 480) * scale,
    y: box.y + box.height / 2 + (point.y - 270) * scale,
  };
}

/** Aim a world tile after camera follow settles; fixture placement must supply an actual mouse target. */
export async function aimWorldTile(page: Page, tx: number, ty: number): Promise<void> {
  await advanceFrames(page, 200);
  const point = await page.evaluate(({ tx, ty }) => {
    const game = window.__GAME__!;
    const camera = game.scene.getScene(window.__TEST__!.activeScene()).cameras.main;
    const origin = camera.getWorldPoint(0, 0), bounds = game.canvas.getBoundingClientRect();
    return { x: bounds.x + ((tx + 0.5) * 16 - origin.x) * camera.zoom * bounds.width / game.scale.width,
      y: bounds.y + ((ty + 0.5) * 16 - origin.y) * camera.zoom * bounds.height / game.scale.height };
  }, { tx, ty });
  await page.mouse.move(point.x, point.y);
}

/** Emit a one-shot or movement action through the seam. */
export async function sendInput(page: Page, action: string): Promise<void> {
  await page.evaluate((a) => window.__TEST__!.input(a), action);
}

/** Release all held movement. */
export async function stopMove(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.stopMove());
}

/** Teleport onto the current map's named destination warp; callers still assert the expected transition. */
export async function teleportToExit(page: Page, target: string, facing: string): Promise<void> {
  const point = await page.evaluate(async target => {
    // @ts-expect-error Vite serves the real map module to the test browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const warp = getMapData(window.__TEST__!.activeScene()).warps.find((entry: { target: string }) => entry.target === target);
    if (!warp) throw new Error(`gameHarness: current map has no exit to ${target}`);
    return { tx: warp.tx + Math.floor(warp.w / 2), ty: warp.ty + Math.floor(warp.h / 2) };
  }, target);
  await teleport(page, point.tx, point.ty, facing);
}

/** Advance the in-game clock deterministically. */
export async function stepTime(page: Page, minutes: number): Promise<void> {
  await page.evaluate((m) => window.__TEST__!.stepTime(m), minutes);
}

/** The active (non-UI) world scene key. */
export async function activeScene(page: Page): Promise<string> {
  return page.evaluate(() => window.__TEST__!.activeScene());
}

/** Wait for real frames to advance by yielding wall-clock time to the game loop. */
export async function advanceFrames(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Test-only: place the player at a tile with optional facing. */
export async function teleport(page: Page, tx: number, ty: number, facing?: string): Promise<void> {
  await page.evaluate(
    ([x, y, f]) => window.__TEST__!.teleport(x as number, y as number, f as string | undefined),
    [tx, ty, facing] as const
  );
}

/** Read named live farm geometry, including an installed preview, without mutating map or state. */
export async function farmLayout(page: Page): Promise<{
  door: { tx: number; ty: number }; arrival: { tx: number; ty: number };
  bin: { tx: number; ty: number }; offset: { tx: number; ty: number };
}> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime map data inside the isolated test page.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const map = getMapData('FarmScene');
    const door = map.warps.find((warp: { target: string }) => warp.target === 'TavernScene');
    const arrival = map.spawns.find((spawn: { id: string }) => spawn.id === 'from_home');
    const bin = map.objects.find((object: { kind: string }) => object.kind === 'bin');
    if (!door || !arrival || !bin || !map.shopOffset) throw new Error('Farm test geometry is incomplete');
    return { door: { tx: door.tx, ty: door.ty }, arrival: { tx: arrival.tx, ty: arrival.ty },
      bin: { tx: bin.tx, ty: bin.ty }, offset: { ...map.shopOffset } };
  });
}

/** Place the keeper relative to the named shop door tile; positive dy moves toward its porch. */
export async function teleportAtFarmShop(page: Page, dx: number, dy: number, facing: string): Promise<void> {
  const { door } = await farmLayout(page);
  await teleport(page, door.tx + dx, door.ty + dy, facing);
}

/** Stand on the shipping bin's left approach using the authored bin position, then face it. */
export async function teleportAtFarmBin(page: Page): Promise<void> {
  const { bin } = await farmLayout(page);
  await teleport(page, bin.tx - 1, bin.ty, 'right');
}

/** Clear only the requested test plot through normal tool actions; never alter the authored map. */
export async function clearFarmResources(page: Page, rect: { tx: number; ty: number; w: number; h: number }): Promise<void> {
  if (await activeScene(page) !== 'FarmScene') throw new Error('Clearing fixture requires the farm');
  const targets = (await nodes(page)).filter(node => node.tx >= rect.tx && node.tx < rect.tx + rect.w &&
    node.ty >= rect.ty && node.ty < rect.ty + rect.h);
  for (const node of targets) {
    const slot = { tree: 1, rock: 2, weed: 3 }[node.kind];
    if (slot === undefined) throw new Error(`Unsupported clearing fixture node ${node.kind}`);
    await teleport(page, node.tx, node.ty + 1, 'up');
    await sendInput(page, `hotbar:${slot}`);
    for (let hit = 0; hit < 8; hit++) {
      if (!(await nodes(page)).some(value => value.tx === node.tx && value.ty === node.ty)) break;
      await sendInput(page, 'use-tool');
      await advanceFrames(page, 500);
    }
    expect((await nodes(page)).some(value => value.tx === node.tx && value.ty === node.ty)).toBe(false);
  }
}

/** Test-only: list resource-node tiles in the active scene (trees carry their growth stage). */
export async function nodes(
  page: Page
): Promise<Array<{ tx: number; ty: number; kind: string; stage?: string }>> {
  return page.evaluate(() => window.__TEST__!.nodes());
}

/** Test-only: switch the seed the Seeds hotbar slot plants. */
export async function selectSeed(page: Page, item: string): Promise<void> {
  await page.evaluate((i) => window.__TEST__!.selectSeed(i), item);
}

/** Test-only: jump the calendar to an absolute day (e.g. into another season). */
export async function setDay(page: Page, day: number): Promise<void> {
  await page.evaluate((d) => window.__TEST__!.setDay(d), day);
}

/** Test-only: emit a one-shot action then let a couple frames run so effects apply. */
export async function act(page: Page, action: string): Promise<void> {
  await sendInput(page, action);
  await advanceFrames(page, 120);
}

/** Test-only: sleep in place (advance to next day), dismissing the morning day-summary dialogue. */
export async function sleepInGame(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.sleep());
  await sendInput(page, 'interact'); // E closes the Stardew-style day summary
  await advanceFrames(page, 100);
}

/** Test-only: pin a day's weather ('sunny' | 'rain') for deterministic weather specs. */
/** Test-only: live enemies in the Mines (empty outside the Mines). */
export async function enemies(
  page: Page
): Promise<Array<{ kind: string; tx: number; ty: number; hp: number }>> {
  return page.evaluate(() => window.__TEST__!.enemies());
}

/** Test-only: set the player's combat hp directly. */
export async function setHp(page: Page, hp: number): Promise<void> {
  await page.evaluate((h) => window.__TEST__!.setHp(h), hp);
}

/** Test-only: set the player's gold directly (death-penalty specs). */
export async function setGold(page: Page, gold: number): Promise<void> {
  await page.evaluate((g) => window.__TEST__!.setGold(g), gold);
}

export async function setWeather(page: Page, day: number, weather: 'sunny' | 'rain'): Promise<void> {
  await page.evaluate(([d, w]) => window.__TEST__!.setWeather(d as number, w as string), [day, weather] as const);
}

/** Test-only: add items to the player's bag. */
export async function give(page: Page, item: string, n: number): Promise<void> {
  await page.evaluate(([i, c]) => window.__TEST__!.give(i as string, c as number), [item, n] as const);
}

/** Assert two numbers are finite and close-ish (used for position sanity). */
export function expectFinite(n: number): void {
  expect(Number.isFinite(n)).toBe(true);
}
