/** Browser-local persistence for the route workshop; adventure save keys are never inspected. */
import { mapEditorEnabled, mapEditorMode } from './MapEditorMode';
import { createNpcRouteDraft, parseNpcRouteDraft, serializeNpcRouteDraft, validateNpcRouteDraft, type NpcRouteDraft } from './NpcRouteDraft';

/** Revision 3 adds weekly private moments while leaving every earlier draft byte untouched. */
export const NPC_ROUTE_DRAFT_STORAGE_KEY = 'skl-npc-route-editor.draft.v3';

/** Require a development build before any route-workshop storage access. */
function assertEnabled(): void {
  if (!mapEditorEnabled()) throw new Error('NPC route workshop storage is disabled in this build.');
}

/** Only the latched route page may replace the isolated draft key. */
function assertWritable(): void {
  assertEnabled();
  if (mapEditorMode() !== 'routes') throw new Error('Only the NPC route workshop can change route draft storage.');
}

/** Read a valid detached draft; a missing key starts the authored initial route set. */
export function readNpcRouteDraft(): NpcRouteDraft {
  assertEnabled();
  const source = localStorage.getItem(NPC_ROUTE_DRAFT_STORAGE_KEY);
  return source === null ? createNpcRouteDraft() : parseNpcRouteDraft(source);
}

/** Validate before replacing the one editor-owned key, then verify exact browser bytes. */
export function writeNpcRouteDraft(input: unknown): NpcRouteDraft {
  assertWritable();
  const draft = validateNpcRouteDraft(input), source = serializeNpcRouteDraft(draft);
  localStorage.setItem(NPC_ROUTE_DRAFT_STORAGE_KEY, source);
  if (localStorage.getItem(NPC_ROUTE_DRAFT_STORAGE_KEY) !== source) throw new Error('NPC route draft write verification failed.');
  return draft;
}
