/**
 * gameHarness — Playwright helpers for driving the canvas game through window.__TEST__.
 *
 * Every spec boots with ?test=1&seed=42 (deterministic), waits for readiness, then reads serialized
 * GameState and injects input. This centralizes the seam access so specs stay short and stable.
 */
import { type Page, expect } from '@playwright/test';

/** Shape of the serialized state the seam returns (mirrors GameState.serialize). */
export interface SeamState {
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
  removedNodes: Record<string, { kind: string; day: number }>;
  groundDrops: Array<{ scene: string; item: string; tx: number; ty: number }>;
  placements: Array<{ id: string; type: string; tx: number; ty: number; w: number; h: number; scene: string }>;
  inventoryOpen: boolean;
  chestOpen: boolean;
  craftingOpen: boolean;
  binOpen: boolean;
  paused: boolean;
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
  dialogue: { name: string; line: string } | null;
  placedItems: Array<{ item: string; scene: string; tx: number; ty: number }>;
  placingItem: string | null;
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

/** Emit a one-shot or movement action through the seam. */
export async function sendInput(page: Page, action: string): Promise<void> {
  await page.evaluate((a) => window.__TEST__!.input(a), action);
}

/** Release all held movement. */
export async function stopMove(page: Page): Promise<void> {
  await page.evaluate(() => window.__TEST__!.stopMove());
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
