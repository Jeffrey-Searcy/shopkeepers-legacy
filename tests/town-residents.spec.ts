/** Permanent town identities remain separate from customers, player cosmetics and save state. */
import { expect, test } from '@playwright/test';
import { TOWN_RESIDENTS, residentForBuilding, validateTownResidents } from '../src/config/TownResidents';
import { appearanceKey } from '../src/config/Appearance';
import { bootGame, getState, teleport } from './helpers/gameHarness';

test('all twelve residents have unique names, jobs and pixel wardrobes', () => {
  expect(() => validateTownResidents()).not.toThrow();
  expect(TOWN_RESIDENTS).toHaveLength(12);
  expect(new Set(TOWN_RESIDENTS.map(resident => appearanceKey(resident.appearance))).size).toBe(12);
  expect(new Set(TOWN_RESIDENTS.flatMap(resident => resident.lines)).size).toBe(36);
  for (const resident of TOWN_RESIDENTS) expect(residentForBuilding(resident.buildingId)).toBe(resident);
  expect(() => residentForBuilding('missing' as never)).toThrow('no resident');
});

test('resident texture banks stay distinct from player, preview and visitor banks', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime modules for browser assertions.
    const { AppearanceTextureSystem } = await import('/src/systems/AppearanceTextureSystem.ts');
    // @ts-expect-error Vite serves runtime modules for browser assertions.
    const { TOWN_RESIDENTS } = await import('/src/config/TownResidents.ts');
    const game = window.__GAME__!, system = AppearanceTextureSystem.forGame(game);
    /** Hash original RGBA pixels so cache ownership is tested beyond different key strings. */
    const pixels = (key: string): number => {
      const image = game.textures.get(key).getSourceImage() as HTMLImageElement;
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Resident test cannot read texture');
      context.drawImage(image, 0, 0);
      let hash = 2166136261;
      for (const value of context.getImageData(0, 0, canvas.width, canvas.height).data) hash = Math.imul(hash ^ value, 16777619);
      return hash >>> 0;
    };
    const original = pixels('player-navigation');
    const keys = TOWN_RESIDENTS.map((resident: { id: string }) => system.residentTextureFor(resident.id));
    const hashes = keys.map(pixels), count = game.textures.getTextureKeys().length;
    for (let pass = 0; pass < 3; pass++) for (const resident of TOWN_RESIDENTS) system.residentTextureFor(resident.id);
    return { keys, hashes, unchanged: pixels('player-navigation') === original, bounded: count === game.textures.getTextureKeys().length };
  });
  expect(new Set(result.keys).size).toBe(12); expect(new Set(result.hashes).size).toBe(12);
  expect(result.keys.every((key: string) => key.startsWith('town-resident-'))).toBe(true);
  expect(result.unchanged).toBe(true); expect(result.bounded).toBe(true);
});

test('native resident dialogue works in every room and shows the selected town art', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await bootGame(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const initial = await getState(page);
  for (const resident of TOWN_RESIDENTS) {
    const sceneKey = await page.evaluate(async buildingId => {
      // @ts-expect-error Vite resolves runtime source in the browser fixture.
      const { townBuilding } = await import('/src/config/TownBuildings.ts');
      // @ts-expect-error Vite resolves runtime source in the browser fixture.
      const { transitionTo } = await import('/src/systems/SceneTransitionSystem.ts');
      // @ts-expect-error Vite resolves runtime source in the browser fixture.
      const { GameState } = await import('/src/state/GameState.ts');
      const building = townBuilding(buildingId);
      GameState.instance.timeOfDay = 0;
      transitionTo(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()), building.scene, 'entry');
      return building.scene as string;
    }, resident.buildingId);
    await page.waitForFunction(scene => window.__TEST__!.ready && window.__TEST__!.activeScene() === scene, sceneKey);
    const anchor = await page.evaluate(({ sceneKey, id }) => {
      const actor = window.__GAME__!.scene.getScene(sceneKey).children.getByName(`town-resident-${id}`) as Phaser.GameObjects.Sprite;
      return { tx: Math.floor(actor.getData('feetX') / 16), ty: Math.floor(actor.getData('feetY') / 16) };
    }, { sceneKey, id: resident.id });
    await teleport(page, anchor.tx, anchor.ty + 1, 'up');
    const lines = [];
    for (let line = 0; line < 3; line++) {
      await page.keyboard.press('e');
      await expect.poll(async () => (await getState(page)).dialogue?.kind).toBe('resident-choice');
      await page.keyboard.press('e');
      await expect.poll(async () => (await getState(page)).dialogue?.kind).toBe('message');
      lines.push((await getState(page)).dialogue!.line);
      await page.keyboard.down('s');
      const position = (await getState(page)).player;
      await page.waitForTimeout(80);
      await page.keyboard.up('s');
      expect((await getState(page)).player.x).toBe(position.x);
      expect((await getState(page)).player.y).toBe(position.y);
      await page.keyboard.press('e');
      await expect.poll(async () => (await getState(page)).dialogue).toBeNull();
    }
    // Talk lines come from the character sheet (ResidentTalkSystem): the first Talk of the day opens with
    // today's topic, later Talks rotate the pool. The second talk may add one neighbor mention.
    const pool = await page.evaluate(async id => {
      // @ts-expect-error Vite serves the real Talk module.
      const { residentTalkPool } = await import('/src/systems/ResidentTalkSystem.ts');
      const gs = window.__TEST__!.state();
      return residentTalkPool({ id, day: gs.day, timeOfDay: gs.timeOfDay, tierLine: 'unused', conversationIndex: 0,
        firstTalkToday: true }).lines as string[];
    }, resident.id);
    expect(lines[0]).toBe(pool[0]);
    expect(lines[1].startsWith(pool[1])).toBe(true);
    expect(lines[2]).toBe(pool[2]);
    // Residents always draw their own pixel wardrobe at full scale; there is no alternate art mode.
    const identity = await page.evaluate(async ({ sceneKey, id }) => {
      const scene = window.__GAME__!.scene.getScene(sceneKey);
      scene.update(0, 0);
      const actor = scene.children.getByName(`town-resident-${id}`) as Phaser.GameObjects.Sprite;
      return { visible: actor.visible, scale: actor.scaleX, name: actor.getData('residentName'), texture: actor.texture.key };
    }, { sceneKey, id: resident.id });
    expect(identity).toEqual({ visible: true, scale: 1, name: resident.name, texture: `town-resident-${resident.id}` });
    if (resident.id === 'nyra' || resident.id === 'bram') await page.screenshot({ path: testInfo.outputPath(`${resident.id}-base.png`) });
  }
  const final = await getState(page);
  for (const field of ['appearance', 'inventory', 'gold', 'tavern'] as const) expect(final[field]).toEqual(initial[field]);
  expect(errors).toEqual([]);
});
