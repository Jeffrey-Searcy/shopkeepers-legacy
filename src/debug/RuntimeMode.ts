/** Shared runtime-mode guards used by the test seam, title routing, and isolated developer sessions. */
import { mapEditorMode } from './MapEditorMode';

/** Permit the existing test seam in explicit test sessions and development builds. */
export function isTestMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('test') === '1' || import.meta.env.DEV;
}

/** Normal play shows the title; editor sandboxes and direct deterministic tests bypass save-slot UI. */
export function shouldShowMainMenu(): boolean {
  if (mapEditorMode() !== null) return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('test') !== '1' || params.get('menu') === '1';
}
