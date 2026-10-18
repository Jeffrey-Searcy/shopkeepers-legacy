/** Verify development gates, gameplay save isolation, strict draft writes, and frozen preview handoffs. */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { expect, test, type Page } from '@playwright/test';
import type { FarmMapEditorMode } from '../src/debug/MapEditorMode';

/** Public mode functions loaded from the actual source under explicit build-time constants. */
interface ModeModule {
  mapEditorEnabled(): boolean;
  mapEditorMode(): FarmMapEditorMode | null;
  mapEditorUrl(mode: FarmMapEditorMode): string;
  setSearch(search: string): void;
}

/** Compile the actual mode module as Vite would replace environment constants, without running a server or game. */
function modeModule(dev: boolean, configured: string | undefined, search: string): ModeModule {
  const source = fs.readFileSync('src/debug/MapEditorMode.ts', 'utf8')
    .split('import.meta.env.DEV').join(JSON.stringify(dev))
    .split('import.meta.env.VITE_MAP_EDITOR').join(configured === undefined ? 'undefined' : JSON.stringify(configured));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports: Partial<ModeModule> = {};
  const location = { search, href: `https://example.test/farm${search}` };
  vm.runInNewContext(compiled.outputText, {
    exports, URL, URLSearchParams, window: { location },
  });
  /** Simulate history.replaceState without reloading the module's page-owned session state. */
  exports.setSearch = (next: string): void => {
    location.search = next;
    location.href = `https://example.test/farm${next}`;
  };
  return exports as ModeModule;
}

/** Boot only the test-owned origin, before changing its URL to exercise sandbox guards independently of editor UI. */
async function bootSafetyFixture(page: Page): Promise<void> {
  await page.goto('/?test=1&seed=42');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
}

test('editor modes require development and respect explicit disable, even for conflicting queries', () => {
  for (const query of ['?mapEditor=1', '?mapPreview=1', '?routeEditor=1', '?mapEditor=1&mapPreview=1', '?mapEditor=1&routeEditor=1']) {
    for (const [dev, configured] of [[false, undefined], [false, 'true'], [true, 'false']] as const) {
      const mode = modeModule(dev, configured, query);
      expect(mode.mapEditorEnabled()).toBe(false);
      expect(mode.mapEditorMode()).toBeNull();
      expect(() => mode.mapEditorUrl('edit')).toThrow('disabled');
    }
  }
  expect(modeModule(true, undefined, '?mapEditor=1').mapEditorMode()).toBe('edit');
  expect(modeModule(true, undefined, '?mapPreview=1').mapEditorMode()).toBe('preview');
  expect(modeModule(true, undefined, '?routeEditor=1').mapEditorMode()).toBe('routes');
  expect(modeModule(true, undefined, '?mapEditor=0&mapPreview=0&routeEditor=0').mapEditorMode()).toBeNull();
  expect(() => modeModule(true, undefined, '?mapEditor=1&mapPreview=1').mapEditorMode()).toThrow('one development editor mode');
  expect(() => modeModule(true, undefined, '?mapEditor=0&mapEditor=1&mapPreview=1').mapEditorMode()).toThrow('one development editor mode');
});

test('editor links preserve origin and unrelated parameters while replacing every existing mode flag', () => {
  const mode = modeModule(true, undefined, '?seed=42&mapEditor=1&mapEditor=0&mapPreview=0');
  const preview = new URL(mode.mapEditorUrl('preview'));
  expect(preview.origin).toBe('https://example.test');
  expect(preview.pathname).toBe('/farm');
  expect(preview.searchParams.get('seed')).toBe('42');
  expect(preview.searchParams.has('mapEditor')).toBe(false);
  expect(preview.searchParams.has('routeEditor')).toBe(false);
  expect(preview.searchParams.getAll('mapPreview')).toEqual(['1']);
  const routes = new URL(mode.mapEditorUrl('routes'));
  expect(routes.searchParams.get('routeEditor')).toBe('1');
  expect(routes.searchParams.has('mapEditor')).toBe(false);
  expect(routes.searchParams.has('mapPreview')).toBe(false);
  expect(() => mode.mapEditorUrl('invalid' as FarmMapEditorMode)).toThrow('edit, preview, or routes');
});

test('sandbox mode remains latched after its URL flags are removed or changed', () => {
  for (const initial of ['edit', 'preview', 'routes'] as const) {
    const mode = modeModule(true, undefined, '?seed=42');
    expect(mode.mapEditorMode()).toBeNull();
    mode.setSearch(initial === 'edit' ? '?mapEditor=1' : initial === 'preview' ? '?mapPreview=1' : '?routeEditor=1');
    expect(mode.mapEditorMode()).toBe(initial);
    mode.setSearch('?seed=42');
    expect(mode.mapEditorMode()).toBe(initial);
    mode.setSearch(initial === 'edit' ? '?mapPreview=1' : '?mapEditor=1');
    expect(mode.mapEditorMode()).toBe(initial);
  }
});

for (const mode of ['edit', 'preview', 'routes'] as const) test(`${mode}: save entry points deny reads and writes before touching real slots or state`, async ({ page }) => {
  await bootSafetyFixture(page);
  const result = await page.evaluate(async selected => {
    // @ts-expect-error Vite serves runtime modules to the isolated test page.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite serves runtime modules to the isolated test page.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite serves runtime modules to the isolated test page.
    const { shouldShowMainMenu } = await import('/src/debug/RuntimeMode.ts');
    SaveSystem.beginNewGame(1);
    const keys = [1, 2, 3].map(slot => SaveSystem.storageKey(slot));
    const original = keys.map((key, i) => {
      const text = `existing player slot ${i + 1}`;
      localStorage.setItem(key, text);
      return text;
    });
    const stateBefore = JSON.stringify(GameState.instance.toSaveData());
    const flag = selected === 'edit' ? 'mapEditor' : selected === 'preview' ? 'mapPreview' : 'routeEditor';
    history.replaceState(null, '', `/?test=1&seed=42&${flag}=1`);
    const accesses: string[] = [], errors: string[] = [];
    const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem, removeItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (key: string): string | null {
      if (keys.includes(key)) accesses.push(`read:${key}`);
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string): void {
      if (keys.includes(key)) accesses.push(`write:${key}`);
      setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string): void {
      if (keys.includes(key)) accesses.push(`delete:${key}`);
      removeItem.call(this, key);
    };
    let autosave: unknown, showMenu: boolean;
    try {
      for (const call of [() => SaveSystem.beginNewGame(2), () => SaveSystem.save(1), () => SaveSystem.load(1),
        () => SaveSystem.delete(1), () => SaveSystem.inspectSlot(1), () => SaveSystem.listSlots()]) {
        try { call(); errors.push('unexpected success'); } catch (error) { errors.push(String(error)); }
      }
      autosave = SaveSystem.saveCurrent();
      showMenu = shouldShowMainMenu();
      history.replaceState(null, '', '/?test=1&seed=42');
      try { SaveSystem.save(1); errors.push('unexpected success'); } catch (error) { errors.push(String(error)); }
      if (SaveSystem.saveCurrent() !== null) throw new Error('Removing the sandbox URL unlocked autosave.');
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
      Storage.prototype.removeItem = removeItem;
    }
    const stateAfter = JSON.stringify(GameState.instance.toSaveData());
    const boundSlot = SaveSystem.currentSlot();
    SaveSystem.endSession();
    return { errors, accesses, autosave, showMenu, stateBefore, stateAfter, boundSlot,
      original, after: keys.map(key => localStorage.getItem(key)), endedSlot: SaveSystem.currentSlot() };
  }, mode);
  expect(result.errors).toHaveLength(7);
  for (const error of result.errors) expect(error).toContain('Gameplay saves are unavailable');
  expect(result.accesses).toEqual([]);
  expect(result.autosave).toBeNull();
  expect(result.showMenu).toBe(false);
  expect(result.stateAfter).toBe(result.stateBefore);
  expect(result.after).toEqual(result.original);
  expect(result.boundSlot).toBe(1);
  expect(result.endedSlot).toBeNull();
});

test('draft storage preserves corrupt bytes until explicit reset or valid import and never touches gameplay keys', async ({ page }) => {
  await bootSafetyFixture(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the isolated editor storage module.
    const storage = await import('/src/debug/FarmLayoutStorage.ts');
    // @ts-expect-error Vite serves the strict editor model module.
    const model = await import('/src/debug/FarmLayoutDraft.ts');
    const saveKey = 'shopkeeperslegacy.save.v1.slot.1';
    localStorage.setItem(saveKey, 'player save must remain unchanged');
    const key = storage.FARM_LAYOUT_DRAFT_STORAGE_KEY;
    const authored = storage.readFarmLayoutDraft(), absentReadWritesNothing = localStorage.getItem(key) === null;
    storage.writeFarmLayoutDraft(authored);
    const goodBytes = localStorage.getItem(key);
    const errors: string[] = [];
    for (const attempt of [() => storage.writeFarmLayoutDraft({ ...authored, version: 999 }),
      () => storage.importFarmLayoutDraft('{ broken'), () => storage.importFarmLayoutDraft('{"version":1}')]) {
      try { attempt(); errors.push('unexpected success'); } catch (error) { errors.push(String(error)); }
    }
    const rejectedWritesPreserveBytes = localStorage.getItem(key) === goodBytes;
    localStorage.setItem(key, '{ corrupt retained draft');
    let readError = '';
    try { storage.readFarmLayoutDraft(); } catch (error) { readError = String(error); }
    const corruptBytes = localStorage.getItem(key);
    const reset = storage.resetFarmLayoutDraft();
    const imported = storage.importFarmLayoutDraft(model.serializeFarmLayoutDraft(reset));
    return { authored, reset, imported, absentReadWritesNothing, rejectedWritesPreserveBytes, errors, readError, corruptBytes,
      savedGame: localStorage.getItem(saveKey),
      keysSeparate: !key.startsWith('shopkeeperslegacy.save.') && key !== storage.FARM_LAYOUT_PREVIEW_STORAGE_KEY };
  });
  expect(result.absentReadWritesNothing).toBe(true);
  expect(result.rejectedWritesPreserveBytes).toBe(true);
  expect(result.keysSeparate).toBe(true);
  expect(result.savedGame).toBe('player save must remain unchanged');
  expect(result.errors).toHaveLength(3);
  for (const error of result.errors) expect(error).not.toBe('unexpected success');
  expect(result.readError).not.toBe('');
  expect(result.corruptBytes).toBe('{ corrupt retained draft');
  expect(result.reset).toEqual(result.authored);
  expect(result.imported).toEqual(result.authored);
});

test('preview snapshot validates once and stays deeply frozen when draft or handoff storage changes', async ({ page }) => {
  await bootSafetyFixture(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the isolated editor storage module.
    const storage = await import('/src/debug/FarmLayoutStorage.ts');
    // @ts-expect-error Vite serves the strict editor model module.
    const model = await import('/src/debug/FarmLayoutDraft.ts');
    let missingError = '';
    try { storage.readFarmLayoutPreviewSnapshot(); } catch (error) { missingError = String(error); }
    const authored = storage.readFarmLayoutDraft();
    storage.writeFarmLayoutPreviewSnapshot(authored);
    const snapshot = storage.readFarmLayoutPreviewSnapshot();
    const before = JSON.stringify(snapshot);
    const frozen = Object.isFrozen(snapshot) && Object.isFrozen(snapshot.shop) && Object.isFrozen(snapshot.objects)
      && snapshot.objects.every((object: object) => Object.isFrozen(object));
    const changed = model.paintFarmLayoutTiles(authored, [{ tx: 40, ty: 40 }], 'dirt');
    storage.writeFarmLayoutDraft(changed);
    storage.writeFarmLayoutPreviewSnapshot(changed);
    const validHandoffDidNotChangeSnapshot = JSON.stringify(storage.readFarmLayoutPreviewSnapshot()) === before;
    localStorage.setItem(storage.FARM_LAYOUT_PREVIEW_STORAGE_KEY, '{ later handoff cannot alter an active preview');
    const second = storage.readFarmLayoutPreviewSnapshot();
    const mutationAccepted = Reflect.set(snapshot.shop, 'tx', snapshot.shop.tx + 1);
    return { missingError, frozen, validHandoffDidNotChangeSnapshot,
      draftChanged: JSON.stringify(storage.readFarmLayoutDraft()) !== before,
      sameObject: second === snapshot, before, after: JSON.stringify(second), mutationAccepted };
  });
  expect(result.missingError).toContain('Open Preview');
  expect(result.frozen).toBe(true);
  expect(result.draftChanged).toBe(true);
  expect(result.validHandoffDidNotChangeSnapshot).toBe(true);
  expect(result.sameObject).toBe(true);
  expect(result.after).toBe(result.before);
  expect(result.mutationAccepted).toBe(false);
  // A new page must reject the malformed handoff instead of reusing another page's cached snapshot.
  await page.reload();
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  const error = await page.evaluate(async () => {
    // @ts-expect-error Vite serves a fresh editor storage module after page reload.
    const storage = await import('/src/debug/FarmLayoutStorage.ts');
    try { storage.readFarmLayoutPreviewSnapshot(); return 'unexpected success'; } catch (error) { return String(error); }
  });
  expect(error).not.toBe('unexpected success');
});

test('preview rejects every draft and handoff write, even after removing its URL flag', async ({ page }) => {
  await bootSafetyFixture(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves the isolated editor storage module.
    const storage = await import('/src/debug/FarmLayoutStorage.ts');
    // @ts-expect-error Vite serves the strict editor model module.
    const model = await import('/src/debug/FarmLayoutDraft.ts');
    const draft = storage.readFarmLayoutDraft();
    storage.writeFarmLayoutDraft(draft);
    storage.writeFarmLayoutPreviewSnapshot(draft);
    const keys = [storage.FARM_LAYOUT_DRAFT_STORAGE_KEY, storage.FARM_LAYOUT_PREVIEW_STORAGE_KEY];
    const before = keys.map(key => localStorage.getItem(key));
    const text = model.serializeFarmLayoutDraft(draft);
    history.replaceState(null, '', '/?test=1&seed=42&mapPreview=1');
    const errors: string[] = [];
    for (const write of [() => storage.writeFarmLayoutDraft(draft), () => storage.resetFarmLayoutDraft(),
      () => storage.importFarmLayoutDraft(text), () => storage.writeFarmLayoutPreviewSnapshot(draft)]) {
      try { write(); errors.push('unexpected success'); } catch (error) { errors.push(String(error)); }
    }
    history.replaceState(null, '', '/?test=1&seed=42');
    try { storage.writeFarmLayoutDraft(draft); errors.push('unexpected success'); } catch (error) { errors.push(String(error)); }
    return { errors, before, after: keys.map(key => localStorage.getItem(key)),
      preview: storage.readFarmLayoutPreviewSnapshot(), draft: storage.readFarmLayoutDraft() };
  });
  expect(result.errors).toHaveLength(5);
  for (const error of result.errors) expect(error).toContain('Farm preview is read-only');
  expect(result.after).toEqual(result.before);
  expect(result.preview).toEqual(result.draft);
});
