/**
 * The Town layout workshop is retired (save version 27): the Town is one painting (world/TownArt.ts) with its
 * buildings drawn in, so there are no clearings left to move. These checks keep the retirement explicit:
 * the old workshop URLs fail with a clear message, no page can build a link to them, the route editor still opens
 * on the Town, production pages never enter an editor, and the ordinary Town map has no preview override.
 */
import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import type * as Mode from '../src/debug/MapEditorMode';
import type * as Maps from '../src/world/MapDef';

/**
 * Load the real editor-mode and map modules with isolated Vite constants and a fake page URL.
 * @param query the page's search string, e.g. '?mapEditor=1&editorMap=town'
 * @param dev the value of import.meta.env.DEV (false is a production build)
 * @returns the module exports
 */
function model(query: string, dev = true): typeof Mode & typeof Maps {
  const source = buildSync({ stdin: { contents: [
    'export * from "./src/debug/MapEditorMode.ts";',
    'export * from "./src/world/MapDef.ts";',
  ].join('\n'), resolveDir: process.cwd() }, bundle: true, write: false, format: 'cjs', platform: 'node',
  define: { 'import.meta.env.DEV': String(dev), 'import.meta.env.VITE_MAP_EDITOR': 'undefined' } });
  const module = { exports: {} };
  const location = { href: `https://example.test/${query}`, search: query };
  new Function('module', 'exports', 'window', source.outputFiles[0].text)(module, module.exports, { location });
  return module.exports as typeof Mode & typeof Maps;
}

test('old Town workshop URLs fail clearly, the route editor still opens the Town, and production stays closed', () => {
  for (const query of ['?mapEditor=1&editorMap=town', '?mapPreview=1&editorMap=town']) {
    expect(() => model(query).mapEditorMode()).toThrow('The Town layout workshop is retired');
    expect(model(query, false).mapEditorMode()).toBeNull();
  }
  const routes = model('?routeEditor=1');
  expect(routes.mapEditorMode()).toBe('routes');
  expect(routes.mapEditorMap()).toBe('town');
  for (const query of ['?mapEditor=1&editorMap=bogus', '?mapEditor=1&editorMap=farm&editorMap=town']) {
    expect(() => model(query).mapEditorMode()).toThrow('supported');
  }
  const farm = model('?mapEditor=1');
  expect(farm.mapEditorMode()).toBe('edit');
  expect(farm.mapEditorMap()).toBe('farm');
  // No page may build a link to the retired workshop; the Farm editor's Town button opens the route editor instead.
  for (const mode of ['edit', 'preview'] as const) expect(() => farm.mapEditorUrl(mode, 'town')).toThrow('The Town layout workshop is retired');
  const link = new URL(farm.mapEditorUrl('routes'));
  expect([link.searchParams.get('routeEditor'), link.searchParams.has('mapEditor'), link.searchParams.has('editorMap')]).toEqual(['1', false, false]);
});

test('the ordinary Town is the painted map, with no preview override left', () => {
  const api = model('');
  expect('setTownPreviewMap' in api).toBe(false);
  const town = api.getMapData('TownScene' as never);
  expect(town).toEqual(api.getAuthoredMapData('TownScene' as never));
  expect({ w: town.w, h: town.h, townPlan: town.townPlan }).toEqual({ w: 82, h: 75, townPlan: undefined });
});
