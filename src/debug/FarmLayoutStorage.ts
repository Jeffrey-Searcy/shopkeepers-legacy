/**
 * Persist developer farm layouts in a namespace separate from gameplay save slots.
 * A preview takes one validated, frozen snapshot per page. Corrupt drafts require explicit recovery.
 */
import {
  createFarmLayoutDraft, parseFarmLayoutDraft, serializeFarmLayoutDraft, validateFarmLayoutDraft,
  type FarmLayoutDraft,
} from './FarmLayoutDraft';
import { mapEditorEnabled, mapEditorMap, mapEditorMode } from './MapEditorMode';

/** Exact editor-owned keys; neither key belongs to the gameplay SaveSystem namespace. */
export const FARM_LAYOUT_DRAFT_STORAGE_KEY = 'skl-map-editor.farm-draft.v1';
export const FARM_LAYOUT_PREVIEW_STORAGE_KEY = 'skl-map-editor.farm-preview.v1';

/** The first successful preview read is immutable for this page, independent of later editor writes. */
let previewSnapshot: FarmLayoutDraft | null = null;

/** Reject developer storage access in production and explicitly disabled development builds. */
function assertStorageEnabled(): void {
  if (!mapEditorEnabled()) throw new Error('Farm layout storage is disabled in this build.');
}

/** Preview pages may read their frozen handoff but must never persist draft or handoff mutations. */
function assertStorageWritable(): void {
  assertStorageEnabled();
  if (mapEditorMode() === 'preview') throw new Error('Farm preview is read-only. Return to the editor to change the layout.');
  if (mapEditorMode() === 'edit' && mapEditorMap() === 'town') {
    throw new Error('The Town editor cannot change Farm layout storage.');
  }
}

/** Freeze every nested value of an already validated acyclic layout; return the same detached object. */
function freezeLayout<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeLayout(child);
    Object.freeze(value);
  }
  return value;
}

/** Read without rewriting bytes. The model explicitly converts known legacy drafts; only absence creates a new layout. */
export function readFarmLayoutDraft(): FarmLayoutDraft {
  assertStorageEnabled();
  const text = localStorage.getItem(FARM_LAYOUT_DRAFT_STORAGE_KEY);
  return text === null ? createFarmLayoutDraft() : parseFarmLayoutDraft(text);
}

/** Validate the whole candidate before replacing the draft key; return a detached copy of the written model. */
export function writeFarmLayoutDraft(input: unknown): FarmLayoutDraft {
  assertStorageWritable();
  const draft = validateFarmLayoutDraft(input);
  const text = serializeFarmLayoutDraft(draft);
  localStorage.setItem(FARM_LAYOUT_DRAFT_STORAGE_KEY, text);
  return draft;
}

/** Explicitly recover or discard a draft by replacing it with the original authored layout. */
export function resetFarmLayoutDraft(): FarmLayoutDraft {
  assertStorageWritable();
  return writeFarmLayoutDraft(createFarmLayoutDraft());
}

/** Import JSON only after full parsing and validation; a rejected import preserves the current draft bytes. */
export function importFarmLayoutDraft(text: string): FarmLayoutDraft {
  assertStorageWritable();
  return writeFarmLayoutDraft(parseFarmLayoutDraft(text));
}

/** Write a validated handoff for the next preview page without changing this page's frozen snapshot or draft. */
export function writeFarmLayoutPreviewSnapshot(input: unknown): FarmLayoutDraft {
  assertStorageWritable();
  const draft = validateFarmLayoutDraft(input);
  const text = serializeFarmLayoutDraft(draft);
  localStorage.setItem(FARM_LAYOUT_PREVIEW_STORAGE_KEY, text);
  return draft;
}

/** Validate and freeze the explicit preview handoff once per page; missing or corrupt snapshots fail visibly. */
export function readFarmLayoutPreviewSnapshot(): FarmLayoutDraft {
  assertStorageEnabled();
  if (previewSnapshot !== null) return previewSnapshot;
  const text = localStorage.getItem(FARM_LAYOUT_PREVIEW_STORAGE_KEY);
  if (text === null) throw new Error('No farm preview snapshot exists. Open Preview from the farm editor first.');
  const candidate = parseFarmLayoutDraft(text);
  previewSnapshot = freezeLayout(candidate);
  return previewSnapshot;
}
