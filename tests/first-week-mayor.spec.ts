/**
 * Mayor Hollis's day-1 welcome walk: a brand-new adventure starts on the east road with the mayor
 * greeting the keeper; he walks the road to the shop door, waits when the keeper lags, gives the
 * shop speech at the door (recording progress.mayorMet), then strolls off. Direct test boots (no
 * save slot), any later day, and re-entering the farm (from the shop or a loaded save) skip him.
 */
import { expect, test, type Page } from '@playwright/test';
import { act, advanceFrames, bootGame, getState, teleport, teleportAtFarmShop, teleportToExit } from './helpers/gameHarness';

/** Start a real New Game in slot 1 the way the title menu does, and wait for the farm. */
async function startNewAdventure(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { enterWorldFromMenu } = await import('/src/systems/SceneTransitionSystem.ts');
    SaveSystem.beginNewGame(1);
    enterWorldFromMenu(window.__GAME__!.scene.getScene('FarmScene'), 'FarmScene', null);
  });
  await page.waitForFunction(() => window.__TEST__?.ready === true && window.__TEST__.activeScene() === 'FarmScene', undefined, { timeout: 10_000 });
}

/** The mayor's feet tile and phase, or null when he is not on the farm. */
async function mayor(page: Page): Promise<{ tx: number; ty: number; phase: string } | null> {
  return page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('FarmScene') as unknown as { mayor: { phase: string; tile(): { tx: number; ty: number } } | null };
    return scene.mayor ? { ...scene.mayor.tile(), phase: scene.mayor.phase } : null;
  });
}

/** Read progress.mayorMet. */
async function mayorMet(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return GameState.instance.progress.mayorMet as boolean;
  });
}

test('direct test boots skip the welcome walk', async ({ page }) => {
  await bootGame(page);
  expect(await mayor(page)).toBeNull();
});

test('Mayor Hollis greets a new keeper and walks them to the shop door', async ({ page }) => {
  await bootGame(page);
  await startNewAdventure(page);
  const start = await getState(page);
  expect(start.dialogue?.name).toBe('Mayor Hollis');
  expect(Math.floor(start.player.x / 16)).toBe(96);
  expect(await mayor(page)).toEqual({ tx: 94, ty: 30, phase: 'leading' });

  // He waits while the dialogue is open.
  await advanceFrames(page, 600);
  expect((await mayor(page))!.tx).toBe(94);
  await act(page, 'interact');

  // The keeper lags far behind: he walks a little, then waits for them.
  await advanceFrames(page, 2500);
  const waiting = (await mayor(page))!;
  expect(waiting.phase).toBe('leading');
  expect(waiting.tx).toBeGreaterThan(85);

  // The keeper catches up; he reaches his spot by the door.
  await teleport(page, 86, 30, 'left');
  await expect.poll(async () => (await mayor(page))?.phase, { timeout: 10_000 }).toBe('arrived');
  expect(await mayor(page)).toEqual({ tx: 85, ty: 27, phase: 'arrived' });
  expect(await mayorMet(page)).toBe(false);

  // At the door he gives the shop speech and records the meeting.
  await teleport(page, 83, 27, 'right');
  await advanceFrames(page, 200);
  const speech = await getState(page);
  expect(speech.dialogue?.name).toBe('Mayor Hollis');
  expect(speech.dialogue?.line).toContain('grandfather');
  expect(await mayorMet(page)).toBe(true);
  await act(page, 'interact');
  await expect.poll(async () => mayor(page), { timeout: 12_000 }).toBeNull();
});

test('a night closes the welcome walk for good', async ({ page }) => {
  await bootGame(page);
  await startNewAdventure(page);
  await act(page, 'interact');
  await page.evaluate(() => window.__TEST__!.sleep());
  expect(await mayorMet(page)).toBe(true);
});

test('leaving the shop on day 1 does not restart the welcome walk', async ({ page }) => {
  await bootGame(page);
  await startNewAdventure(page);
  await act(page, 'interact');
  // The keeper skips the mayor and walks straight into the shop, then back out.
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => window.__TEST__!.activeScene() === 'TavernScene' && window.__TEST__!.ready); }
  finally { await page.keyboard.up('w'); }
  await teleportToExit(page, 'FarmScene', 'down');
  await page.keyboard.down('s');
  try { await page.waitForFunction(() => window.__TEST__!.activeScene() === 'FarmScene' && window.__TEST__!.ready); }
  finally { await page.keyboard.up('s'); }
  expect(await mayor(page)).toBeNull();
  expect((await getState(page)).dialogue).toBeNull();
  expect(await mayorMet(page)).toBe(false);
});
