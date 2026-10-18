/** Conventional title navigation, guarded save selection, and real local sound/motion preferences. */
import { expect, test, type Page } from '@playwright/test';
import { uiCanvasPoint } from './helpers/gameHarness';

/** Boot only the title; browser contexts isolate this suite from personal save slots. */
async function title(page: Page): Promise<void> {
  await page.goto('/?test=1&seed=42&menu=1');
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
}

/** Click a named Phaser control through the actual UI camera rather than assumed canvas scaling. */
async function clickTitle(page: Page, name: string): Promise<void> {
  const point = await page.evaluate(name => {
    const scene = window.__GAME__!.scene.getScene('MainMenuScene');
    /** Search visible nested containers; inactive pages must not supply an input target. */
    const search = (children: unknown[]): { x: number; y: number } | null => {
      for (const candidate of children) {
        const child = candidate as { name: string; visible: boolean; x: number; y: number; list?: unknown[] };
        if (!child.visible) continue;
        if (child.name === name) return { x: child.x, y: child.y };
        if (child.list) {
          const found = search(child.list);
          if (found) return found;
        }
      }
      return null;
    };
    const found = search(scene.children.list);
    if (!found) throw new Error(`Visible title control ${name} is missing`);
    return found;
  }, name);
  const pointer = await uiCanvasPoint(page, point);
  await page.mouse.click(pointer.x, pointer.y);
}

/** Inspect whether a stable scene-root page is visible. */
async function visible(page: Page, name: string): Promise<boolean> {
  return page.evaluate(name => {
    const object = window.__GAME__!.scene.getScene('MainMenuScene').children.getByName(name) as unknown as { visible: boolean };
    return object.visible;
  }, name);
}

/** Prepare three distinct valid saves without using the title behavior being tested. */
async function seedSlots(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime modules in browser tests.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves runtime modules in browser tests.
    const { GameState } = await import('/src/state/GameState.ts');
    for (const slot of [1, 2, 3]) {
      SaveSystem.beginNewGame(slot);
      GameState.instance.gold = slot * 100;
      SaveSystem.saveCurrent(1000 * slot);
      SaveSystem.endSession();
    }
  });
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
}

test('default title hides save cards and keyboard New Game keeps the guarded story flow', async ({ page }) => {
  await title(page);
  expect(await visible(page, 'title-main-root')).toBe(true);
  expect(await visible(page, 'title-load-root')).toBe(false);
  const centers = await page.evaluate(() => {
    const root = window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('title-main-root') as unknown as {
      list: Array<{ name: string; x: number }>;
    };
    return root.list.filter(child => ['title-new-game', 'title-load-game', 'title-settings'].includes(child.name)).map(child => child.x);
  });
  expect(centers).toEqual([480, 480, 480]);
  await page.keyboard.press('Enter');
  expect(await visible(page, 'origin-intro-root')).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.save.v1.slot.1'))).toBe(null);
  await page.keyboard.press('Escape');
  expect(await visible(page, 'origin-intro-root')).toBe(false);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  expect(await visible(page, 'origin-choice-root')).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__?.ready === true && window.__GAME__!.scene.isActive('FarmScene'));
});

test('Continue loads the latest valid save, not slot one or the newest damaged file', async ({ page }) => {
  await title(page);
  await seedSlots(page);
  await page.evaluate(() => localStorage.setItem('shopkeeperslegacy.save.v1.slot.3', '{broken'));
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await page.evaluate(() => window.__TEST__!.state().gold)).toBe(200);
  expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.save.v1.slot.3'))).toBe('{broken');
});

test('legacy recovery enters directly without showing an update interstitial or changing saved bytes', async ({ page }) => {
  await title(page);
  const original = await page.evaluate(async () => {
    // @ts-expect-error Vite serves runtime TypeScript modules to this isolated context.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite serves the historical envelope contract to this isolated context.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    SaveSystem.beginNewGame(1);
    SaveSystem.saveCurrent(1234);
    const key = SaveSystem.storageKey(1);
    const stored = localStorage.getItem(key);
    if (stored === null) throw new Error('Migration fixture save is missing');
    const envelope = JSON.parse(stored);
    envelope.version = 5;
    envelope.state.tavern = createLegacyTavernState();
    envelope.state.placedItems = [{ item: 'workbench', scene: 'FarmScene', tx: 60, ty: 60, rotation: 0 }];
    const legacy = JSON.stringify(envelope);
    localStorage.setItem(key, legacy);
    SaveSystem.endSession();
    return legacy;
  });
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  expect(await page.evaluate(() => window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('title-migration-root'))).toBeNull();
  expect(await page.evaluate(() => window.__TEST__!.state().inventory.workbench)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.save.v1.slot.1'))).toBe(original);
});

test('full slots cannot be overwritten; Load Game keeps deletion confirmation and Cancel', async ({ page }) => {
  await title(page);
  await seedSlots(page);
  const before = await page.evaluate(() => [1, 2, 3].map(slot => localStorage.getItem(`shopkeeperslegacy.save.v1.slot.${slot}`)));
  await clickTitle(page, 'title-new-game');
  expect(await visible(page, 'title-load-root')).toBe(true);
  const status = await page.evaluate(() => (window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('title-status') as unknown as { text: string }).text);
  expect(status).toContain('All saves are occupied');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Enter'); // Cancel remains the safe selected choice.
  expect(await page.evaluate(() => [1, 2, 3].map(slot => localStorage.getItem(`shopkeeperslegacy.save.v1.slot.${slot}`)))).toEqual(before);
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.save.v1.slot.1'))).toBe(null);
  await page.keyboard.press('Escape');
  await clickTitle(page, 'title-new-game');
  expect(await visible(page, 'origin-intro-root')).toBe(true);
});

test('settings keyboard and pointer change validated persisted sound and actual motion preference', async ({ page }) => {
  await title(page);
  await clickTitle(page, 'title-settings');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const settings = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the preference module in browser tests.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    return SettingsSystem.get();
  });
  expect(settings).toEqual({ soundVolume: 0.9, reducedMotion: true, shopFacade: 'original', localNpcChat: false });
  // Clicking the volume row's minus must change sound even while the motion row has keyboard focus.
  await clickTitle(page, 'title-sound-less');
  await page.reload();
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  const reloaded = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the preference module in browser tests.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // @ts-expect-error Vite resolves the actual shared animation preference in browser tests.
    const { prefersReducedMotion } = await import('/src/ui/CozyTheme.ts');
    return { settings: SettingsSystem.get(), motion: prefersReducedMotion() };
  });
  expect(reloaded).toEqual({ settings: { soundVolume: 0.8, reducedMotion: true, shopFacade: 'original', localNpcChat: false }, motion: true });
});

test('invalid preference updates preserve prior bytes and report explicit validation errors', async ({ page }) => {
  await title(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the preference module in browser tests.
    const { SettingsSystem, SETTINGS_STORAGE_KEY } = await import('/src/systems/SettingsSystem.ts');
    SettingsSystem.update({ soundVolume: 0.4, reducedMotion: true });
    const before = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const errors: string[] = [];
    for (const bad of [{ soundVolume: -1 }, { soundVolume: NaN }, { reducedMotion: 'yes' }, { extra: 1 }]) {
      try { SettingsSystem.update(bad); }
      catch (error) { errors.push(String(error)); }
    }
    return { before, after: localStorage.getItem(SETTINGS_STORAGE_KEY), errors };
  });
  expect(result.errors).toHaveLength(4);
  expect(result.after).toBe(result.before);
});

for (const [label, malformed] of [['JSON', '{broken'], ['schema', '{"soundVolume":4,"reducedMotion":"yes"}']] as const) {
  test(`damaged settings ${label} shows deliberate recovery without changing save bytes`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await title(page);
    await seedSlots(page);
    const before = await page.evaluate(malformed => {
      localStorage.setItem('shopkeeperslegacy.settings.v1', malformed);
      return [1, 2, 3].map(slot => localStorage.getItem(`shopkeeperslegacy.save.v1.slot.${slot}`));
    }, malformed);
    await page.reload();
    await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
    expect(await visible(page, 'title-settings-error-root')).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.settings.v1'))).toBe(malformed);
    await clickTitle(page, 'title-reset-settings');
    await page.waitForFunction(() => {
      const main = window.__GAME__!.scene.getScene('MainMenuScene').children.getByName('title-main-root');
      return main !== null && (main as unknown as { visible: boolean }).visible;
    });
    expect(await page.evaluate(() => localStorage.getItem('shopkeeperslegacy.settings.v1'))).toBe(null);
    expect(await page.evaluate(() => [1, 2, 3].map(slot => localStorage.getItem(`shopkeeperslegacy.save.v1.slot.${slot}`)))).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test('sound level controls the shared audio gain, including already initialized audio and mute', async ({ page }) => {
  await page.addInitScript(() => {
    /** Minimal WebAudio recorder verifies routing and gain writes without playing audible effects. */
    class RecordingAudioContext {
      currentTime = 0;
      state = 'running';
      destination = {};
      /** Record all gain nodes, including Phaser's own boot-time audio manager nodes. */
      createGain(): unknown {
        const values: number[] = [];
        (window as unknown as { audioGains: number[][] }).audioGains.push(values);
        const node = { gain: { setValueAtTime: (value: number) => values.push(value), exponentialRampToValueAtTime: (value: number) => values.push(value) }, connect: () => node };
        return node;
      }
      /** Provide the oscillator operations used by the select sound. */
      createOscillator(): unknown {
        const node = { type: '', frequency: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (next: unknown) => next, start: () => {}, stop: () => {} };
        return node;
      }
      /** Provide the soft treble filter Sfx puts after its master gain. */
      createBiquadFilter(): unknown {
        return { type: '', frequency: { value: 0, setValueAtTime: () => {} }, Q: { value: 0 }, connect: (next: unknown) => next };
      }
    }
    (window as unknown as { audioGains: number[][] }).audioGains = [];
    Object.defineProperty(window, 'AudioContext', { value: RecordingAudioContext });
  });
  // Production audio intentionally stays disabled under test=1, so this case uses the live DEV title.
  await page.goto('/?menu=1&seed=42');
  await page.waitForFunction(() => window.__GAME__?.scene.isActive('MainMenuScene') === true);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves the live sound module.
    const { Sfx } = await import('/src/systems/SfxSystem.ts');
    // @ts-expect-error Vite resolves the live preference module.
    const { SettingsSystem } = await import('/src/systems/SettingsSystem.ts');
    // Phaser creates mute/volume gains during game boot. The application Sfx context starts only
    // here, so capture its exact node boundary instead of assuming the first global node is ours.
    const gains = (window as unknown as { audioGains: number[][] }).audioGains;
    const masterIndex = gains.length;
    Sfx.play('select');
    if (gains.length !== masterIndex + 2) {
      throw new Error(`Sfx initialization must create one master and one envelope gain; created ${gains.length - masterIndex}.`);
    }
    SettingsSystem.update({ soundVolume: 0.3 });
    Sfx.play('select');
    SettingsSystem.update({ soundVolume: 0 });
    return { priorGainNodes: masterIndex, masterValues: gains[masterIndex] };
  });
  expect(result.priorGainNodes).toBeGreaterThanOrEqual(2);
  expect(result.masterValues).toEqual([1, 0.3, 0]);
});
