/**
 * M16 — Moonlighter-style dungeon combat in the Mines (PLAN-dungeon-combat).
 *
 * Combat is CONFINED to MinesScene: enemies (slimes + bats) spawn on cave floor away from the
 * entrance, the sword (hotbar slot 8, real key '8') kills them via scene-local Space attacks,
 * contact deals damage, Shift dodge-rolls grant i-frames, dying costs 20% gold + the day (wake
 * at Home healed), and simply leaving the mines heals to full.
 *
 * Input note: the sword/dodge keys are polled scene-locally in MinesScene.update (NOT routed
 * through the seam's input()), so these specs press REAL keys via page.keyboard — the same path
 * a player uses. Positioning uses the teleport seam so runs stay deterministic.
 *
 * Route to the mines (mirrors m14): Farm -> Town (98,30) -> authored north road -> Mountain -> Mines (39,12).
 * Mines entrance spawn: (25,4). Mines ladder warp back to Mountain: (25,2).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  bootGame,
  getState,
  teleport,
  advanceFrames,
  activeScene,
  enemies,
  setHp,
  setGold,
  farmLayout,
} from './helpers/gameHarness';

const ENTRANCE = { tx: 25, ty: 4 };

/** Teleport onto a warp tile and wait for the destination scene to become active (m14 pattern). */
async function warpTo(page: Page, tx: number, ty: number, facing: string, scene: string): Promise<void> {
  await teleport(page, tx, ty, facing);
  await expect
    .poll(async () => activeScene(page), { timeout: 15_000, intervals: [200] })
    .toBe(scene);
  await advanceFrames(page, 300);
}

/** Boot and walk the full warp chain into the Mines. */
async function enterMines(page: Page): Promise<void> {
  await bootGame(page);
  await warpTo(page, 98, 30, 'right', 'TownScene');
  const road = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the current map in the live browser.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const warp = getMapData('TownScene').warps.find((warp: { target: string }) => warp.target === 'MountainScene');
    if (!warp) throw new Error('Town has no outdoor mine entrance road');
    return { tx: warp.tx + Math.floor(warp.w / 2), ty: warp.ty + Math.floor(warp.h / 2) };
  });
  await warpTo(page, road.tx, road.ty, 'up', 'MountainScene');
  await warpTo(page, 39, 12, 'up', 'MinesScene');
}

/** Nearest live slime to a point (slimes are slow — the stable sword-target choice). */
async function nearestSlime(page: Page, tx: number, ty: number) {
  const list = (await enemies(page)).filter((e) => e.kind === 'slime');
  expect(list.length).toBeGreaterThan(0);
  list.sort((a, b) => (Math.abs(a.tx - tx) + Math.abs(a.ty - ty)) - (Math.abs(b.tx - tx) + Math.abs(b.ty - ty)));
  return list[0];
}

test('enemies spawn in the mines, none anywhere near the entrance spawn', async ({ page }) => {
  await enterMines(page);
  const list = await enemies(page);
  expect(list.length).toBeGreaterThan(0);
  expect(list.some((e) => e.kind === 'slime')).toBe(true);
  expect(list.some((e) => e.kind === 'bat')).toBe(true);
  // Spawns are >=8 tiles out and leashed to ~4.5 tiles of home — the entry tile stays safe.
  for (const e of list) {
    const manhattan = Math.abs(e.tx - ENTRANCE.tx) + Math.abs(e.ty - ENTRANCE.ty);
    expect(manhattan).toBeGreaterThan(2);
  }
});

test('sword (slot 8) kills a slime; its loot drop magnet-collects into the bag', async ({ page }) => {
  await enterMines(page);

  // Select the sword with the REAL '8' key (scene-local binding).
  await page.keyboard.press('8');
  await advanceFrames(page, 150);
  expect((await getState(page)).hotbarIndex).toBe(7);

  const startSlimes = (await enemies(page)).filter((e) => e.kind === 'slime').length;
  let lastTarget = await nearestSlime(page, ENTRANCE.tx, ENTRANCE.ty);

  // Swing until one slime dies: re-teleport adjacent each swing (knockback shoves it around),
  // face up at the tile below it (16px < SWORD_RANGE, inside the facing half-plane).
  for (let i = 0; i < 15; i++) {
    const slimes = (await enemies(page)).filter((e) => e.kind === 'slime');
    if (slimes.length < startSlimes) break;
    lastTarget = await nearestSlime(page, lastTarget.tx, lastTarget.ty);
    await teleport(page, lastTarget.tx, lastTarget.ty + 1, 'up');
    await page.keyboard.down('Space');
    await advanceFrames(page, 100);
    await page.keyboard.up('Space');
    await advanceFrames(page, 350); // let the attack cooldown lapse before the next swing
  }
  const slimesNow = (await enemies(page)).filter((e) => e.kind === 'slime').length;
  expect(slimesNow).toBe(startSlimes - 1);

  // Collect the drop: knockback can carry the dying slime up to ~2 tiles from the target tile,
  // so sweep the nearby tiles until magnetism (34px range) picks the gel up.
  let collected = false;
  outer: for (const dy of [0, -1, -2, 1]) {
    for (const dx of [0, -1, 1]) {
      await teleport(page, lastTarget.tx + dx, lastTarget.ty + dy);
      await advanceFrames(page, 500);
      const inv = (await getState(page)).inventory;
      if ((inv['slime-gel'] ?? 0) >= 1) {
        collected = true;
        break outer;
      }
    }
  }
  expect(collected).toBe(true);
});

test('touching an enemy deals contact damage', async ({ page }) => {
  await enterMines(page);
  const before = await getState(page);
  expect(before.hp).toBe(before.maxHp);

  // Stand on a slime's tile until contact registers (re-track it — it wanders/lunges).
  for (let i = 0; i < 10; i++) {
    const slime = await nearestSlime(page, ENTRANCE.tx, ENTRANCE.ty);
    await teleport(page, slime.tx, slime.ty);
    await advanceFrames(page, 250);
    if ((await getState(page)).hp < before.maxHp) break;
  }
  const after = await getState(page);
  expect(after.hp).toBeLessThan(after.maxHp);
});

test('dodge roll (Shift) grants i-frames: contact during invuln deals no damage', async ({ page }) => {
  await enterMines(page);
  const maxHp = (await getState(page)).maxHp;
  expect((await getState(page)).hp).toBe(maxHp);
  const slime = await nearestSlime(page, ENTRANCE.tx, ENTRANCE.ty);

  // Start the dodge with a REAL Shift press, then sample IN-PAGE at 20ms cadence while gluing
  // the player to the slime every sample. Why in-page: Playwright eval round-trips (~40-130ms
  // each) raced the 400ms invuln window and lost — the outer-loop version of this test caught
  // POST-HIT invuln (hp already down) instead of dodge invuln. Why glue every 20ms: the dodge
  // dash (300px/s, facing up at the entrance) otherwise flings the player into the ladder warp
  // at (25,2), shutting the scene down mid-test (found via a timer probe: both combat timers
  // zeroed simultaneously = the shutdown heal, not decay).
  await page.keyboard.down('Shift');
  const samples = await page.evaluate(
    async ([tx, ty]) => {
      const T = window.__TEST__!;
      const out: Array<{ invuln: number; cd: number; hp: number }> = [];
      for (let i = 0; i < 30; i++) {
        T.teleport(tx, ty);
        const s = T.state();
        out.push({ invuln: s.invulnMs, cd: s.dodgeCooldownMs, hp: s.hp });
        await new Promise((r) => setTimeout(r, 20));
      }
      return out;
    },
    [slime.tx, slime.ty] as [number, number]
  );
  await page.keyboard.up('Shift');

  // The dodge started (cooldown running)...
  expect(samples.some((s) => s.cd > 0)).toBe(true);
  // ...i-frames were live while standing on the slime, with zero damage taken...
  const invulnUnhurt = samples.filter((s) => s.invuln > 0 && s.hp === maxHp);
  expect(invulnUnhurt.length).toBeGreaterThanOrEqual(3);
  // ...and the contact was REAL: once the window closed, the same position drew blood.
  expect(samples.some((s) => s.hp < maxHp)).toBe(true);
});

test('death penalty: 20% gold lost, day advances, wake outside the Tavern fully healed', async ({ page }) => {
  await enterMines(page);
  await setGold(page, 100);
  await setHp(page, 1);
  const day0 = (await getState(page)).day;
  const { arrival } = await farmLayout(page);

  // Walk into a slime until the killing contact fires the named exterior wake-up.
  for (let i = 0; i < 12; i++) {
    if ((await activeScene(page)) === 'FarmScene') break;
    const list = (await enemies(page)).filter((e) => e.kind === 'slime');
    if (list.length === 0) break; // scene changed between reads — enemies() is empty outside Mines
    await teleport(page, list[0].tx, list[0].ty);
    await advanceFrames(page, 250);
  }
  await expect
    .poll(async () => activeScene(page), { timeout: 10_000, intervals: [200] })
    .toBe('FarmScene');
  await expect
    .poll(async () => {
      const player = (await getState(page)).player;
      return { tx: Math.floor(player.x / 16), ty: Math.floor(player.y / 16) };
    }, { timeout: 5_000, intervals: [50, 100, 200] })
    .toEqual(arrival);

  const s = await getState(page);
  expect(s.gold).toBe(80); // floor(100 * 0.8)
  expect(s.day).toBe(day0 + 1); // the knockout burns the rest of the day (sleep path)
  expect(s.hp).toBe(s.maxHp); // wake healed
  expect(Math.floor(s.player.x / 16)).toBe(arrival.tx);
  expect(Math.floor(s.player.y / 16)).toBe(arrival.ty);
  expect(await page.evaluate(() => window.__GAME__!.scene.isActive('HomeInteriorScene'))).toBe(false);
});

test('leaving the mines via the ladder heals to full', async ({ page }) => {
  await enterMines(page);
  await setHp(page, 3);
  expect((await getState(page)).hp).toBe(3);

  await warpTo(page, 25, 2, 'up', 'MountainScene');
  const s = await getState(page);
  expect(s.hp).toBe(s.maxHp);
});
