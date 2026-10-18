/**
 * Town workshop persistence, isolated from Farm drafts and adventure slots. Only a Town editor
 * can write; a preview reads one deeply frozen handoff and never repairs or overwrites bad data.
 */
import {
  createTownLayoutDraft, parseTownLayoutDraft, serializeTownLayoutDraft, validateTownLayoutDraft,
  type TownLayoutDraft,
} from './TownLayoutDraft';
import { mapEditorEnabled, mapEditorMap, mapEditorMode } from './MapEditorMode';

export const TOWN_LAYOUT_DRAFT_STORAGE_KEY = 'skl-map-editor.town-draft.v1';
export const TOWN_LAYOUT_PREVIEW_STORAGE_KEY = 'skl-map-editor.town-preview.v1';
/** Validated handoff retained for this preview page even if a sibling editor changes its key. */
let previewSnapshot: TownLayoutDraft | null = null;

/** Reject disabled builds before inspecting any browser data. */
function assertEnabled(): void {
  if (!mapEditorEnabled()) throw new Error('Town layout storage is disabled in this build.');
}

/** Only the latched Town editor owns mutations, including after URL parameters are removed. */
function assertWritable(): void {
  assertEnabled();
  if (mapEditorMode() !== 'edit' || mapEditorMap() !== 'town') {
    throw new Error('Only the Town editor can change Town layout storage.');
  }
}

/** Deep-freeze a validated JSON tree without retaining references supplied by the caller. */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Read a detached draft; absent storage starts authored data, while corrupt storage fails explicitly. */
export function readTownLayoutDraft(): TownLayoutDraft {
  assertEnabled();
  const text = localStorage.getItem(TOWN_LAYOUT_DRAFT_STORAGE_KEY);
  return text === null ? createTownLayoutDraft() : parseTownLayoutDraft(text);
}

/** Validate before replacing only the Town draft key; return the detached persisted model. */
export function writeTownLayoutDraft(input: unknown): TownLayoutDraft {
  assertWritable();
  const draft = validateTownLayoutDraft(input);
  localStorage.setItem(TOWN_LAYOUT_DRAFT_STORAGE_KEY, serializeTownLayoutDraft(draft));
  return draft;
}

/** Store a validated opening snapshot for a future disposable preview, without changing its draft. */
export function writeTownLayoutPreviewSnapshot(input: unknown): TownLayoutDraft {
  assertWritable();
  const draft = validateTownLayoutDraft(input);
  localStorage.setItem(TOWN_LAYOUT_PREVIEW_STORAGE_KEY, serializeTownLayoutDraft(draft));
  return draft;
}

/** Read and freeze exactly once; missing or malformed handoffs must not boot the old Town. */
export function readTownLayoutPreviewSnapshot(): TownLayoutDraft {
  assertEnabled();
  if (mapEditorMode() !== 'preview' || mapEditorMap() !== 'town') {
    throw new Error('Town snapshots require a Town preview page.');
  }
  if (previewSnapshot !== null) return previewSnapshot;
  const text = localStorage.getItem(TOWN_LAYOUT_PREVIEW_STORAGE_KEY);
  if (text === null) throw new Error('No Town preview exists. Open Walk preview from the Town editor first.');
  previewSnapshot = freeze(parseTownLayoutDraft(text));
  return previewSnapshot;
}
