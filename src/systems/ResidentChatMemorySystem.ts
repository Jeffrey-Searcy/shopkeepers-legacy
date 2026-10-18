/**
 * ResidentChatMemorySystem — browser-local conversation notes for each town resident.
 *
 * These notes are separate from authored friendship saves. They preserve player speech and a
 * bounded model summary without granting hearts, gifts, items, dates, or any other game progress.
 */
import type { ResidentId } from '../config/ResidentRelationships';
import { residentRelationshipProfile } from '../config/ResidentRelationships';
import type { LocalChatTurn } from './LocalNpcChatSystem';
import { compactResidentChat, MAX_HISTORY_TURNS, MAX_MESSAGE_LENGTH, MAX_REPLY_LENGTH } from './LocalNpcChatSystem';
import { SaveSystem } from './SaveSystem';
import { residentChatNotesStorageKey } from './ResidentChatStorage';

const MAX_STORED_TURNS = 40;
const MAX_SUMMARY_LENGTH = 600;

/** One resident's durable browser-local chat notes. */
export interface ResidentChatNotes {
  summary: string;
  turns: LocalChatTurn[];
}

interface ResidentChatStore {
  version: 1;
  residents: Partial<Record<ResidentId, ResidentChatNotes>>;
}

/** Bind optional chat notes to one save slot; an unslotted test game has its own explicit scope. */
function storageKey(): string {
  const slot = SaveSystem.currentSlot();
  return residentChatNotesStorageKey(slot === null ? 'unslotted' : slot);
}

/** Validate one stored turn without masking corrupt browser data. */
function chatTurn(value: unknown, index: number): LocalChatTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Chat notes turn ${index} is invalid.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'role,text') throw new Error(`Chat notes turn ${index} has unknown fields.`);
  const expected = index % 2 === 0 ? 'player' : 'resident';
  const limit = expected === 'player' ? MAX_MESSAGE_LENGTH : MAX_REPLY_LENGTH;
  if (record.role !== expected || typeof record.text !== 'string' || !record.text.trim() || record.text !== record.text.trim()
    || record.text.length > limit || /[\r\n]/.test(record.text)) {
    throw new Error(`Chat notes turn ${index} is invalid.`);
  }
  return { role: expected, text: record.text };
}

/** Parse the complete versioned store. Corruption is visible instead of silently erasing memory. */
function readStore(key: string): ResidentChatStore {
  const raw = localStorage.getItem(key);
  if (raw === null) return { version: 1, residents: {} };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Resident chat notes are not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resident chat notes are invalid.');
  const store = value as Record<string, unknown>;
  if (Object.keys(store).sort().join(',') !== 'residents,version' || store.version !== 1
    || !store.residents || typeof store.residents !== 'object' || Array.isArray(store.residents)) {
    throw new Error('Resident chat notes have an unsupported format.');
  }
  const residents: Partial<Record<ResidentId, ResidentChatNotes>> = {};
  for (const [rawId, rawNotes] of Object.entries(store.residents as Record<string, unknown>)) {
    const id = rawId as ResidentId;
    residentRelationshipProfile(id);
    if (!rawNotes || typeof rawNotes !== 'object' || Array.isArray(rawNotes)) throw new Error(`Chat notes for ${id} are invalid.`);
    const notes = rawNotes as Record<string, unknown>;
    if (Object.keys(notes).sort().join(',') !== 'summary,turns' || typeof notes.summary !== 'string'
      || notes.summary !== notes.summary.trim()
      || notes.summary.length > MAX_SUMMARY_LENGTH || /[{}\[\]\r\n]/.test(notes.summary) || !Array.isArray(notes.turns)
      || notes.turns.length > MAX_STORED_TURNS || notes.turns.length % 2 !== 0) {
      throw new Error(`Chat notes for ${id} are invalid.`);
    }
    residents[id] = { summary: notes.summary, turns: notes.turns.map(chatTurn) };
  }
  return { version: 1, residents };
}

/** Write an already-validated store and verify the browser kept the exact serialized value. */
function writeStore(key: string, store: ResidentChatStore): void {
  const raw = JSON.stringify(store);
  localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error('Resident chat notes write verification failed.');
}

/** Remove an empty resident record so the store has one canonical representation. */
function storeResidentNotes(store: ResidentChatStore, id: ResidentId, notes: ResidentChatNotes): void {
  if (!notes.summary && notes.turns.length === 0) delete store.residents[id];
  else store.residents[id] = notes;
}

/** Read one resident's full notes for the relationship journal. */
export function residentChatNotes(id: ResidentId): ResidentChatNotes {
  residentRelationshipProfile(id);
  const notes = readStore(storageKey()).residents[id];
  return notes ? { summary: notes.summary, turns: notes.turns.map(turn => ({ ...turn })) } : { summary: '', turns: [] };
}

/** Return the small context window sent with the next face-to-face message. */
export function residentChatContext(id: ResidentId): ResidentChatNotes {
  const notes = residentChatNotes(id);
  return { summary: notes.summary, turns: notes.turns.slice(-MAX_HISTORY_TURNS) };
}

/** Reject another message when manual compaction is required to preserve every stored line. */
export function assertResidentChatCapacity(id: ResidentId): void {
  if (residentChatNotes(id).turns.length + 2 > MAX_STORED_TURNS) {
    throw new Error('These chat notes are full. Compact them in Town Bonds before talking again.');
  }
}

/** Append one completed exchange atomically and return the new bounded model context. */
export function recordResidentChatExchange(id: ResidentId, player: string, resident: string): ResidentChatNotes {
  residentRelationshipProfile(id);
  const key = storageKey();
  const playerTurn = chatTurn({ role: 'player', text: player }, 0);
  const residentTurn = chatTurn({ role: 'resident', text: resident }, 1);
  const store = readStore(key);
  const notes = store.residents[id] ?? { summary: '', turns: [] };
  if (notes.turns.length + 2 > MAX_STORED_TURNS) {
    throw new Error('These chat notes are full. Compact them in Town Bonds before talking again.');
  }
  const next: ResidentChatNotes = { summary: notes.summary, turns: [...notes.turns,
    playerTurn, residentTurn] };
  store.residents[id] = next;
  writeStore(key, store);
  return { summary: next.summary, turns: next.turns.slice(-MAX_HISTORY_TURNS) };
}

/** Delete one zero-based chronological player/resident exchange while preserving compact memory. */
export function deleteResidentChatExchange(id: ResidentId, exchangeIndex: number): ResidentChatNotes {
  residentRelationshipProfile(id);
  if (!Number.isSafeInteger(exchangeIndex) || exchangeIndex < 0) throw new Error('Chat exchange index is invalid.');
  const key = storageKey(), store = readStore(key), existing = store.residents[id];
  const exchangeCount = (existing?.turns.length ?? 0) / 2;
  if (!existing || exchangeIndex >= exchangeCount) throw new Error('That saved conversation does not exist.');
  const start = exchangeIndex * 2;
  const next: ResidentChatNotes = { summary: existing.summary,
    turns: [...existing.turns.slice(0, start), ...existing.turns.slice(start + 2)] };
  storeResidentNotes(store, id, next);
  writeStore(key, store);
  return { summary: next.summary, turns: next.turns.map(turn => ({ ...turn })) };
}

/** Clear only one resident's compact summary while retaining every saved conversation. */
export function clearResidentChatSummary(id: ResidentId): ResidentChatNotes {
  residentRelationshipProfile(id);
  const key = storageKey(), store = readStore(key), existing = store.residents[id];
  if (!existing?.summary) throw new Error('There is no compact memory to clear.');
  const next: ResidentChatNotes = { summary: '', turns: existing.turns.map(turn => ({ ...turn })) };
  storeResidentNotes(store, id, next);
  writeStore(key, store);
  return { summary: '', turns: next.turns.map(turn => ({ ...turn })) };
}

/** Summarize the selected resident's notes locally, then retain the latest two exchanges verbatim. */
export async function compactResidentChatNotes(id: ResidentId): Promise<ResidentChatNotes> {
  residentRelationshipProfile(id);
  const key = storageKey();
  const startingStore = readStore(key);
  const stored = startingStore.residents[id];
  const existing: ResidentChatNotes = stored
    ? { summary: stored.summary, turns: stored.turns.map(turn => ({ ...turn })) }
    : { summary: '', turns: [] };
  if (existing.turns.length === 0) throw new Error('There are no chats to compact yet.');
  const expected = JSON.stringify(existing);
  const summary = await compactResidentChat(id, existing.summary, existing.turns);
  if (storageKey() !== key) {
    throw new Error('The active save changed while compacting chat notes. No memory was changed.');
  }
  const store = readStore(key);
  if (!store.residents[id] || JSON.stringify(store.residents[id]) !== expected) {
    throw new Error('These chat notes changed while compacting. No memory was changed. Try again.');
  }
  const next = { summary, turns: existing.turns.slice(-4) };
  store.residents[id] = next;
  writeStore(key, store);
  return { summary: next.summary, turns: next.turns.map(turn => ({ ...turn })) };
}
