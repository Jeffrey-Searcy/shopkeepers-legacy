/**
 * First-week dungeon proofs: the farm's north trail stays shut until day 5, then leads to the Gate
 * Plaza; every portal run shuffles its rooms (planDungeonRun) so the hub's three doors lead to the
 * three side rooms in a random order and the Warden's pit hides behind one random side room; barred
 * doors hold until a room is cleared and walled-up far doors never open; the run bag empties into the
 * inventory on the way out; the escape altar charges gold per floor; a knockout loses the bag and ends
 * the day at the farm; and no save can be made inside the dungeon.
 *
 * Monsters are killed through the scene's own kill path (the same calls CombatController makes after
 * a lethal sword hit), so these specs prove the run rules, not sword aim. Sword aim is covered by
 * the Mines combat specs, which share CombatController.
 */
import { expect, test, type Page } from '@playwright/test';
import { act, activeScene, advanceFrames, bootGame, enemies, getState, setDay, setGold, teleport, teleportToExit } from './helpers/gameHarness';
import {
  DUNGEON_ROOMS, HUB_DOOR_IDS, SIDE_ROOM_IDS, doorTarget, dungeonDoor, planDungeonRun,
  type DoorId, type DungeonRoomId, type DungeonRunPlan,
} from '../src/world/DungeonRooms';

/** Wait until the named world scene is active and controllable. */
async function waitForScene(page: Page, key: string): Promise<void> {
  await page.waitForFunction(k => window.__TEST__?.ready === true && window.__TEST__.activeScene() === k, key, { timeout: 10_000 });
}

/** Walk from a fresh day-5 farm through the trail and the gate into the fountain hall. */
async function enterDungeon(page: Page): Promise<void> {
  await setDay(page, 5);
  await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').scene.restart());
  await waitForScene(page, 'FarmScene');
  await teleportToExit(page, 'GatePlazaScene', 'up');
  await waitForScene(page, 'GatePlazaScene');
  await teleportToExit(page, 'DungeonScene', 'up');
  await waitForScene(page, 'DungeonScene');
}

/** Kill every live monster through the scene's kill path; returns how many died. */
async function killRoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Test-only: reach the private run state through the live scene.
    const scene = window.__GAME__!.scene.getScene('DungeonScene') as unknown as {
      combat: { enemies: Array<{ x: number; y: number; destroy(): void }> };
      onEnemyKilled(enemy: unknown, tx: number, ty: number): void;
    };
    const list = scene.combat.enemies.slice();
    for (const enemy of list) {
      scene.combat.enemies = scene.combat.enemies.filter(other => other !== enemy);
      scene.onEnemyKilled(enemy, Math.floor(enemy.x / 16), Math.floor(enemy.y / 16));
      enemy.destroy();
    }
    return list.length;
  });
}

/** The live run: this run's plan, the current room, the bag, and the open exit swirl's tile (or null). */
interface RunView {
  plan: DungeonRunPlan;
  room: DungeonRoomId;
  bag: Record<string, number>;
  exit: { tx: number; ty: number } | null;
}

/** Read the live run off the scene. */
async function run(page: Page): Promise<RunView> {
  return page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('DungeonScene') as unknown as {
      plan: DungeonRunPlan; room: DungeonRoomId; bag: Record<string, number>; exitCentre: { x: number; y: number } | null;
    };
    const exit = scene.exitCentre ? { tx: Math.floor(scene.exitCentre.x / 16), ty: Math.floor(scene.exitCentre.y / 16) } : null;
    return { plan: scene.plan, room: scene.room, bag: { ...scene.bag }, exit };
  });
}

/**
 * Stand on a door's first tile (map coordinates) so the scene's door check sees the keeper's feet there.
 * @param room the room the door belongs to
 * @param door that room's door
 */
async function stepOnDoor(page: Page, room: DungeonRoomId, door: DoorId): Promise<void> {
  const { origin } = DUNGEON_ROOMS[room];
  const { tiles } = dungeonDoor(room, door);
  await teleport(page, origin.tx + tiles.tx, origin.ty + tiles.ty, 'up');
  await advanceFrames(page, 200);
}

/** Walk along a room's reward row until its drops are collected. */
async function collectReward(page: Page, room: DungeonRoomId): Promise<void> {
  const { origin, reward } = DUNGEON_ROOMS[room];
  for (let dx = 0; dx < reward.w; dx++) {
    await teleport(page, origin.tx + reward.tx + dx, origin.ty + reward.ty, 'up');
    await advanceFrames(page, 500);
  }
}

/**
 * The hub door that leads into a side room in this run.
 * @throws when no hub door leads there (a broken plan)
 */
function hubDoorTo(plan: DungeonRunPlan, side: DungeonRoomId): DoorId {
  const door = HUB_DOOR_IDS.find(id => plan.doors[id] === side);
  if (!door) throw new Error(`no hub door leads to ${side}`);
  return door;
}

test('every run plan wires each hub door to a different side room and hides the pit behind one', () => {
  const orders = new Set<string>();
  const pits = new Set<string>();
  let s = 7;
  // A small fixed LCG walks through many plans, so every order and every pit spot must show up.
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  for (let i = 0; i < 400; i++) {
    const plan = planDungeonRun(rand);
    const order = HUB_DOOR_IDS.map(id => plan.doors[id]);
    expect([...order].sort()).toEqual([...SIDE_ROOM_IDS].sort());
    orders.add(order.join(','));
    pits.add(plan.bossBehind);
    for (const door of HUB_DOOR_IDS) {
      expect(doorTarget(plan, 'hub', door)).toEqual({ room: plan.doors[door], door: 'way-in' });
      expect(doorTarget(plan, plan.doors[door], 'way-in')).toEqual({ room: 'hub', door });
    }
    for (const side of SIDE_ROOM_IDS) {
      expect(doorTarget(plan, side, 'far')).toEqual(side === plan.bossBehind ? { room: 'boss', door: 'way-in' } : 'sealed');
    }
    expect(doorTarget(plan, 'boss', 'way-in')).toEqual({ room: plan.bossBehind, door: 'far' });
  }
  expect(orders.size).toBe(6);
  expect(pits.size).toBe(3);
  expect(() => planDungeonRun(() => 1)).toThrow();
});

test('the north trail is barricaded before day 5 and opens on day 5', async ({ page }) => {
  await bootGame(page);
  const day1 = await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').children.getByName('north-trail-barricade') !== null);
  expect(day1).toBe(true);
  await teleportToExit(page, 'GatePlazaScene', 'up');
  await advanceFrames(page, 400);
  expect(await activeScene(page)).toBe('FarmScene');
  expect((await getState(page)).player.y).toBeGreaterThan(2 * 16);

  await setDay(page, 5);
  await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').scene.restart());
  await waitForScene(page, 'FarmScene');
  const day5 = await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').children.getByName('north-trail-barricade') !== null);
  expect(day5).toBe(false);
  await teleportToExit(page, 'GatePlazaScene', 'up');
  await waitForScene(page, 'GatePlazaScene');
  // The signpost by the gate explains the rules (the keeper stands north of it, facing down).
  await teleport(page, 8, 11, 'down');
  await act(page, 'interact');
  expect((await getState(page)).dialogue?.name).toBe('The North Gate');
});

test('a full run clears the hall and all three side rooms, then the Warden, and banks the bag', async ({ page }) => {
  await bootGame(page);
  await enterDungeon(page);
  const progress = () => page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { GameState } = await import('/src/state/GameState.ts');
    return { ...GameState.instance.progress.dungeon };
  });
  expect(await progress()).toEqual({ deepestFloor: 1, bossBeaten: false, runs: 1 });
  expect((await enemies(page)).length).toBe(3);
  const shardsBefore = (await getState(page)).inventory['portal-shard'] ?? 0;
  const { plan, room } = await run(page);
  expect(room).toBe('hub');

  // A barred door holds while monsters remain.
  await stepOnDoor(page, 'hub', 'left');
  expect((await run(page)).room).toBe('hub');
  expect(await killRoom(page)).toBe(3);
  await collectReward(page, 'hub');

  // Visit every side room through its hub door and come back; the pit's room is left for last.
  const order = [...SIDE_ROOM_IDS.filter(id => id !== plan.bossBehind), plan.bossBehind];
  for (const side of order) {
    const door = hubDoorTo(plan, side);
    await stepOnDoor(page, 'hub', door);
    await expect.poll(async () => (await run(page)).room).toBe(side);
    expect((await enemies(page)).length).toBeGreaterThan(0);
    expect(await killRoom(page)).toBeGreaterThan(0);
    await collectReward(page, side);
    if (side === plan.bossBehind) break;
    // A walled-up far door never opens, even in a cleared room.
    await stepOnDoor(page, side, 'far');
    expect((await run(page)).room).toBe(side);
    await stepOnDoor(page, side, 'way-in');
    await expect.poll(async () => (await run(page)).room).toBe('hub');
    // A cleared hall stays empty on the way back.
    expect((await enemies(page)).length).toBe(0);
  }

  await stepOnDoor(page, plan.bossBehind, 'far');
  await expect.poll(async () => (await run(page)).room).toBe('boss');
  expect((await enemies(page)).some(e => e.kind === 'warden')).toBe(true);
  expect((await run(page)).exit).toBeNull();
  expect(await killRoom(page)).toBeGreaterThan(0);
  await collectReward(page, 'boss');
  const exit = (await run(page)).exit;
  expect(exit).not.toBeNull();
  await teleport(page, exit!.tx, exit!.ty, 'up');
  await advanceFrames(page, 300);

  await waitForScene(page, 'GatePlazaScene');
  const after = await getState(page);
  // The hall gives 1 shard, the cave 2, the library 1, the sewer 2 and the Warden 2; the core and a potion come too.
  expect((after.inventory['portal-shard'] ?? 0) - shardsBefore).toBe(8);
  expect(after.inventory['warden-core']).toBe(1);
  expect(after.inventory['healing-potion']).toBe(1);
  expect(await progress()).toEqual({ deepestFloor: 4, bossBeaten: true, runs: 1 });
});

test('the escape altar charges gold per floor and keeps the bag', async ({ page }) => {
  await bootGame(page);
  await enterDungeon(page);
  await killRoom(page);
  await collectReward(page, 'hub');
  expect((await run(page)).bag['portal-shard']).toBe(1);
  await setGold(page, 100);
  // The hall is floor 1 (20g). Stand on the tile east of its altar, facing west.
  const { origin, altar } = DUNGEON_ROOMS.hub;
  await teleport(page, origin.tx + altar.tx + 1, origin.ty + altar.ty, 'left');
  await act(page, 'interact');
  expect(await activeScene(page)).toBe('DungeonScene');
  await act(page, 'interact');
  await waitForScene(page, 'GatePlazaScene');
  const after = await getState(page);
  expect(after.gold).toBe(80);
  expect(after.inventory['portal-shard']).toBe(1);
});

test('a knockout loses the bag and wakes the keeper at the farm next morning', async ({ page }) => {
  await bootGame(page);
  await enterDungeon(page);
  await killRoom(page);
  await collectReward(page, 'hub');
  expect((await run(page)).bag['portal-shard']).toBe(1);
  const saveError = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to browser assertions.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    try { SaveSystem.save(1, 1); return ''; } catch (error) { return String(error); }
  });
  expect(saveError).toContain('cannot save inside the portal');
  await page.evaluate(() => {
    (window.__GAME__!.scene.getScene('DungeonScene') as unknown as { knockOut(): void }).knockOut();
  });
  await waitForScene(page, 'FarmScene');
  const after = await getState(page);
  expect(after.day).toBe(6);
  expect(after.inventory['portal-shard'] ?? 0).toBe(0);
});
