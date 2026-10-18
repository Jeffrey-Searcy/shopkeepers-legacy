/**
 * Party companions: residents in GameState.social.party walk with the keeper through the portal
 * dungeon and the mines, follow a step behind, freeze while paused, arrive with the keeper in each
 * new dungeon room, and kill monsters through the same path as the sword (so loot drops normally).
 *
 * Scenes are entered through the real transition system (transitionTo) from the booted farm, and
 * private scene state is read through window.__GAME__, like the first-week dungeon spec does.
 * The keeper is given very long i-frames so a long fight can never knock them out mid-test.
 */
import { expect, test, type Page } from '@playwright/test';
import { advanceFrames, bootGame, enemies, teleport } from './helpers/gameHarness';
import { dungeonRoomBounds, type DungeonRoomId } from '../src/world/DungeonRooms';

/** One companion as the tests see it. */
interface CompanionView {
  id: string;
  name: string;
  x: number;
  y: number;
  kills: number;
  knockedOut: boolean;
  label: string | null;
  labelVisible: boolean;
}

/**
 * Boot, set the saved party, and travel into a combat scene through the real transition.
 * @param page the test page
 * @param target scene key to enter
 * @param spawn named spawn in that scene
 * @param party resident ids for GameState.social.party
 */
async function enterWithParty(page: Page, target: 'MinesScene' | 'DungeonScene', spawn: string, party: string[]): Promise<void> {
  await bootGame(page);
  await page.evaluate(async ({ target, spawn, party }) => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves the live module to the test browser.
    const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
    GameState.instance.social.party = party;
    transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), target, spawn);
  }, { target, spawn, party });
  await page.waitForFunction(k => window.__TEST__?.ready === true && window.__TEST__.activeScene() === k, target, { timeout: 15_000 });
  await setKeeperInvulnerable(page);
}

/** Give the keeper i-frames that outlast any test, so contact damage never ends the scene. */
async function setKeeperInvulnerable(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.invulnMs = 1e9;
  });
}

/** Read the live companions of a scene, with their name labels. */
async function companions(page: Page, sceneKey: string): Promise<CompanionView[]> {
  return page.evaluate(k => {
    const scene = window.__GAME__!.scene.getScene(k) as unknown as {
      party: { members: Array<{ residentId: string; name: string; x: number; y: number; kills: number; knockedOut: boolean }> };
      children: { getByName(name: string): { text: string; visible: boolean } | null };
    };
    return scene.party.members.map(m => {
      const label = scene.children.getByName(`party-companion-label-${m.residentId}`);
      return { id: m.residentId, name: m.name, x: m.x, y: m.y, kills: m.kills, knockedOut: m.knockedOut,
        label: label ? label.text : null, labelVisible: label ? label.visible : false };
    });
  }, sceneKey);
}

/** The keeper's feet in world px. */
async function keeper(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const p = (window.__TEST__!.state() as unknown as { player: { x: number; y: number } }).player;
    return { x: p.x, y: p.y };
  });
}

/** Largest companion-to-keeper distance, in px. */
async function farthestFromKeeper(page: Page, sceneKey: string): Promise<number> {
  const k = await keeper(page);
  const list = await companions(page, sceneKey);
  return Math.max(...list.map(c => Math.hypot(c.x - k.x, c.y - k.y)));
}

test('an empty party shows nobody, and an unknown resident fails loudly', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves the live module to the test browser.
    const { PartyCompanions, companionStyleFor } = await import('/src/entities/PartyCompanion.ts');
    const scene = window.__GAME__!.scene.getScene(window.__TEST__!.activeScene());
    GameState.instance.social.party = [];
    // The roster callback reads the saved party, the same one DungeonScene and MinesScene pass.
    const roster = () => GameState.instance.social.party;
    const empty = new PartyCompanions(scene, () => true, roster, 'combat').members.length;
    let styleError = '';
    try { companionStyleFor('nobody'); } catch (error) { styleError = (error as Error).message; }
    GameState.instance.social.party = ['nobody'];
    let partyError = '';
    try { new PartyCompanions(scene, () => true, roster, 'combat'); } catch (error) { partyError = (error as Error).message; }
    GameState.instance.social.party = [];
    return { empty, styleError, partyError };
  });
  expect(result.empty).toBe(0);
  expect(result.styleError).toContain('unknown resident "nobody"');
  expect(result.partyError).toContain('unknown resident "nobody"');
});

test('dungeon: two named companions follow the keeper, freeze while paused, and arrive in the next room', async ({ page }) => {
  await enterWithParty(page, 'DungeonScene', 'entry', ['kit', 'bram']);
  const start = await companions(page, 'DungeonScene');
  expect(start.map(c => c.name)).toEqual(['Kit', 'Bram']);
  expect(start.map(c => c.label)).toEqual(['Kit', 'Bram']);
  expect(start.every(c => c.labelVisible)).toBe(true);
  expect(await farthestFromKeeper(page, 'DungeonScene')).toBeLessThanOrEqual(2 * 16 * Math.SQRT2);

  // Take the monsters out of play (test-only, no kill) so the follow check is not a fight.
  await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('DungeonScene') as unknown as { combat: { enemies: Array<{ destroy(): void }> } };
    for (const enemy of scene.combat.enemies) enemy.destroy();
    scene.combat.enemies = [];
  });

  // Paused: the keeper moves away, the companions do not move at all.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.paused = true;
  });
  // why: read positions after the pause starts; companions may have moved since `start`.
  const beforePause = await companions(page, 'DungeonScene');
  // why: a hall floor tile about 6 tiles east of the portal arrival (24,22).
  await teleport(page, 30, 22, 'right');
  await advanceFrames(page, 600);
  const frozen = await companions(page, 'DungeonScene');
  expect(frozen.map(c => [c.x, c.y])).toEqual(beforePause.map(c => [c.x, c.y]));

  // Unpaused: they walk up to the keeper (about 6 tiles) and settle a step behind.
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the live module to the test browser.
    const { GameState } = await import('/src/state/GameState.ts');
    GameState.instance.paused = false;
  });
  await expect.poll(() => farthestFromKeeper(page, 'DungeonScene'), { timeout: 6_000, intervals: [250] }).toBeLessThan(2 * 16);

  // A new room re-places the party beside the keeper's new spawn.
  const side = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('DungeonScene') as unknown as {
      plan: { doors: Record<'left', DungeonRoomId> };
      enterRoom(id: DungeonRoomId, through: 'way-in'): void;
    };
    const target = scene.plan.doors.left;
    scene.enterRoom(target, 'way-in');
    return target;
  });
  const next = await companions(page, 'DungeonScene');
  const b = dungeonRoomBounds(side);
  expect(next.every(c => c.x >= b.x0 * 16 && c.x < (b.x1 + 1) * 16 && c.y >= b.y0 * 16 && c.y < (b.y1 + 1) * 16)).toBe(true);
  expect(await farthestFromKeeper(page, 'DungeonScene')).toBeLessThanOrEqual(2 * 16 * Math.SQRT2);
});

test('mines: a companion kill removes the monster and drops loot through the normal kill path', async ({ page }) => {
  await enterWithParty(page, 'MinesScene', 'entrance', ['kit', 'bram']);
  expect((await companions(page, 'MinesScene')).map(c => c.id)).toEqual(['kit', 'bram']);
  const startEnemies = (await enemies(page)).length;
  const slime = (await enemies(page)).find(e => e.kind === 'slime');
  if (!slime) throw new Error('test: the mines have no slime');

  // The keeper stands by a slime and never swings (no sword selected, no Space). Companions regroup
  // beside the keeper and must do all the killing.
  await teleport(page, slime.tx, slime.ty, 'down');
  await expect.poll(async () => (await companions(page, 'MinesScene')).reduce((sum, c) => sum + c.kills, 0),
    { timeout: 20_000, intervals: [250] }).toBeGreaterThan(0);

  // One synchronous read, so kills, enemies, drops and bag are from the same frame.
  const snapshot = await page.evaluate(() => {
    const scene = window.__GAME__!.scene.getScene('MinesScene') as unknown as {
      party: { members: Array<{ kills: number }> };
      combat: { enemies: unknown[]; lootDrops: Array<{ item: string }> };
    };
    const inventory = (window.__TEST__!.state() as unknown as { inventory: Record<string, number> }).inventory;
    return {
      kills: scene.party.members.reduce((sum, m) => sum + m.kills, 0),
      enemies: scene.combat.enemies.length,
      groundLoot: scene.combat.lootDrops.map(d => d.item),
      bagged: (inventory['slime-gel'] ?? 0) + (inventory['bat-wing'] ?? 0),
    };
  });
  expect(startEnemies - snapshot.enemies).toBe(snapshot.kills);
  // Mines kills always drop their loot: each one is on the ground or already magnet-collected.
  expect(snapshot.groundLoot.length + snapshot.bagged).toBe(snapshot.kills);
  expect(snapshot.groundLoot.every(item => item === 'slime-gel' || item === 'bat-wing')).toBe(true);
});
