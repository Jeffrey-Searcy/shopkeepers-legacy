/**
 * Gate the optional layout editor and its play preview before gameplay or storage starts.
 * Production builds ignore editor queries. VITE_MAP_EDITOR=false also disables both dev modes.
 */

/** All isolated development sessions; the legacy exported type name remains compatible. */
export type FarmMapEditorMode = 'edit' | 'preview' | 'routes';
/** Explicit workshop targets; omission means the original Farm editor URL remains compatible. */
export type MapEditorMap = 'farm' | 'town';

/** Once a sandbox starts, only a page reload may return that page to gameplay save access. */
let sessionMode: FarmMapEditorMode | null = null;
/** Map selection belongs to the sandbox page, not its later navigation or mutable URL. */
let sessionMap: MapEditorMap | null = null;

/** Return whether this build permits the editor; production never enables it through a URL. */
export function mapEditorEnabled(): boolean {
  return import.meta.env.DEV === true && import.meta.env.VITE_MAP_EDITOR !== 'false';
}

/** Resolve the enabled URL mode and retain the first sandbox mode, so URL edits cannot unlock saves. */
export function mapEditorMode(): FarmMapEditorMode | null {
  if (!mapEditorEnabled()) return null;
  const params = new URLSearchParams(window.location.search);
  const edit = params.getAll('mapEditor').includes('1');
  const preview = params.getAll('mapPreview').includes('1');
  const routes = params.getAll('routeEditor').includes('1');
  if ([edit, preview, routes].filter(Boolean).length > 1) throw new Error('Choose one development editor mode.');
  if (sessionMode === null && (edit || preview || routes)) {
    const selections = params.getAll('editorMap');
    if (selections.length > 1 || (selections.length === 1 && selections[0] !== 'farm' && selections[0] !== 'town')) {
      throw new Error('Choose one supported workshop map: farm or town.');
    }
    // why: the Town layout workshop moved the clearings of the hand-built 120x110 Town. The Town is now one
    // painting (TownArt) with its buildings drawn in, so there is nothing for it to move. The route editor
    // ('routes', always the Town) still works on the painting.
    if (!routes && selections[0] === 'town') {
      throw new Error('The Town layout workshop is retired: the Town is now one painting. Use the route editor (?routeEditor=1) for resident routes.');
    }
    // Old published editor URLs intentionally select Farm when no map was supplied.
    sessionMap = routes ? 'town' : selections.length === 0 ? 'farm' : selections[0] as MapEditorMap;
    sessionMode = routes ? 'routes' : edit ? 'edit' : 'preview';
  }
  return sessionMode;
}

/** Read the page's latched map; ordinary and production pages retain the original Farm entry button. */
export function mapEditorMap(): MapEditorMap {
  if (mapEditorMode() === null) return 'farm';
  if (sessionMap === null) throw new Error('Layout sandbox has no selected map.');
  return sessionMap;
}

/**
 * Build a same-origin editor URL, replacing every editor flag and retaining unrelated query settings.
 * @param mode the editor session to open ('routes' always edits the Town)
 * @param map the map for an 'edit' or 'preview' session; defaults to this page's latched map
 * @returns the absolute URL to open
 * @throws when the build has no editor, or for a Town 'edit' / 'preview' link (that workshop is retired)
 */
export function mapEditorUrl(mode: FarmMapEditorMode, map: MapEditorMap = mapEditorMap()): string {
  if (!mapEditorEnabled()) throw new Error('The layout editor is disabled in this build.');
  if (mode !== 'edit' && mode !== 'preview' && mode !== 'routes') throw new Error('Editor mode must be edit, preview, or routes.');
  if (map !== 'farm' && map !== 'town') throw new Error('Unknown workshop map.');
  // why: mapEditorMode() refuses these pages, so building the link would only lead to an error page.
  if (mode !== 'routes' && map === 'town') {
    throw new Error('The Town layout workshop is retired: the Town is now one painting. Use the route editor for the Town.');
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('mapEditor');
  url.searchParams.delete('mapPreview');
  url.searchParams.delete('routeEditor');
  url.searchParams.delete('editorMap');
  if (mode === 'routes') url.searchParams.set('routeEditor', '1');
  else {
    if (map === 'town') url.searchParams.set('editorMap', map);
    url.searchParams.set(mode === 'edit' ? 'mapEditor' : 'mapPreview', '1');
  }
  return url.toString();
}
