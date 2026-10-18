/**
 * Independent review proofs for layout-draft storage ownership. Since save version 27 the Town layout workshop is
 * retired (the Town is one painting), so its old URLs open no writer at all; the Farm editor still owns only Farm
 * storage, and the Farm preview stays read-only.
 */
import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import type * as FarmStorage from '../src/debug/FarmLayoutStorage';
import type * as TownStorage from '../src/debug/TownLayoutStorage';
import type * as FarmDraft from '../src/debug/FarmLayoutDraft';
import type * as TownDraft from '../src/debug/TownLayoutDraft';
import type * as Modes from '../src/debug/MapEditorMode';

/** Bundle real modules with an isolated browser URL and memory-only storage; never open a server or user slot. */
function storageModel(query: string) {
  const result = buildSync({ stdin: { contents: [
    'export * from "./src/debug/FarmLayoutStorage.ts";',
    'export * from "./src/debug/TownLayoutStorage.ts";',
    'export * from "./src/debug/FarmLayoutDraft.ts";',
    'export * from "./src/debug/TownLayoutDraft.ts";',
    'export * from "./src/debug/MapEditorMode.ts";',
  ].join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } });
  const module = { exports: {} }, bytes = new Map<string, string>();
  const location = { search: query, href: `https://review.invalid/${query}` };
  const storage = { getItem: (key: string) => bytes.has(key) ? bytes.get(key)! : null,
    setItem: (key: string, value: string) => { bytes.set(key, value); } };
  new Function('module', 'exports', 'window', 'localStorage', result.outputFiles[0].text)(module, module.exports, { location }, storage);
  return { api: module.exports as typeof FarmStorage & typeof TownStorage & typeof FarmDraft & typeof TownDraft & typeof Modes,
    bytes, location };
}

test('a retired Town workshop URL opens no writer: every Farm and Town draft writer refuses and no bytes change', () => {
  for (const query of ['?mapEditor=1&editorMap=town', '?mapPreview=1&editorMap=town']) {
    const { api, bytes } = storageModel(query);
    const farm = api.createFarmLayoutDraft(), town = api.createTownLayoutDraft();
    bytes.set(api.FARM_LAYOUT_DRAFT_STORAGE_KEY, api.serializeFarmLayoutDraft(farm));
    bytes.set(api.FARM_LAYOUT_PREVIEW_STORAGE_KEY, 'existing Farm handoff');
    bytes.set('shopkeeperslegacy.save.v1.slot.1', 'untouched adventure');
    const before = new Map(bytes);
    // why: MapEditorMode refuses the retired Town pages, so each writer's ownership check fails with that message.
    for (const action of [() => api.writeFarmLayoutDraft(farm), () => api.writeFarmLayoutPreviewSnapshot(farm),
      () => api.resetFarmLayoutDraft(), () => api.importFarmLayoutDraft(api.serializeFarmLayoutDraft(farm)),
      () => api.writeTownLayoutDraft(town), () => api.writeTownLayoutPreviewSnapshot(town)]) {
      expect(action).toThrow('The Town layout workshop is retired');
      expect(bytes).toEqual(before);
    }
  }
});

test('Farm editor retains its own writes but cannot write either Town namespace', () => {
  const { api, bytes } = storageModel('?mapEditor=1');
  const farm = api.createFarmLayoutDraft(), town = api.createTownLayoutDraft();
  api.writeFarmLayoutDraft(farm); api.writeFarmLayoutPreviewSnapshot(farm);
  expect([...bytes.keys()].sort()).toEqual([api.FARM_LAYOUT_DRAFT_STORAGE_KEY, api.FARM_LAYOUT_PREVIEW_STORAGE_KEY].sort());
  const before = new Map(bytes);
  expect(() => api.writeTownLayoutDraft(town)).toThrow('Only the Town editor');
  expect(() => api.writeTownLayoutPreviewSnapshot(town)).toThrow('Only the Town editor');
  expect(bytes).toEqual(before);
});

test('the Farm preview denies every draft and handoff writer while the existing normal-dev Farm API remains compatible', () => {
  const { api, bytes, location } = storageModel('?mapPreview=1');
  const farm = api.createFarmLayoutDraft(), town = api.createTownLayoutDraft();
  expect(api.mapEditorMode()).toBe('preview');
  // A later URL change cannot turn the latched preview page into an editor.
  location.search = '?mapEditor=1';
  for (const action of [() => api.writeFarmLayoutDraft(farm), () => api.writeFarmLayoutPreviewSnapshot(farm),
    () => api.resetFarmLayoutDraft(), () => api.importFarmLayoutDraft(api.serializeFarmLayoutDraft(farm)),
    () => api.writeTownLayoutDraft(town), () => api.writeTownLayoutPreviewSnapshot(town)]) expect(action).toThrow();
  expect(bytes.size).toBe(0);
  const ordinary = storageModel('');
  ordinary.api.writeFarmLayoutDraft(ordinary.api.createFarmLayoutDraft());
  expect([...ordinary.bytes.keys()]).toEqual([ordinary.api.FARM_LAYOUT_DRAFT_STORAGE_KEY]);
});
