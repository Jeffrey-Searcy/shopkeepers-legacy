/**
 * ResidentCharacterSheets — typed, strictly validated access to ResidentCharacterSheets.json.
 *
 * The JSON is the single source of each resident's personality, speech style, likes, worries,
 * history, opinions of three neighbors, four "on my mind" topics, generic reaction lines, and
 * context Talk lines. Two readers share it:
 *  - the game (authored backup scenes between residents, context-aware Talk, Town gossip);
 *  - scripts/npc-chat-supervisor.mjs (the local model prompt), which reads the same file from disk.
 *
 * A broken sheet fails loudly at first use. Nothing is defaulted or repaired.
 */
import rawSheets from './ResidentCharacterSheets.json';
import type { ResidentId } from './ResidentRelationships';

/** Every resident id, in catalog order. The sheet must cover exactly these. */
export const CHARACTER_SHEET_IDS = ['nyra', 'tessa', 'rhea', 'sylvie', 'elowen', 'seren', 'rowan', 'julian', 'bram',
  'kit', 'cael', 'dorian'] as const satisfies readonly ResidentId[];

/** Kinds of generic replies a listener gives inside an assembled scene. */
export type ReactionKind = 'curious' | 'tease' | 'warm' | 'advice' | 'close';

/** Context buckets for lines a resident says to the player during Talk. */
export type TalkContext = 'morning' | 'afternoon' | 'evening' | 'rain' | 'weekend' | 'spring' | 'summer' | 'fall' | 'winter';

/** One small slice of life a resident brings up. `lines` are opener, explanation, wrap-up. */
export interface ResidentTopic {
  id: string;
  /** Third-person gossip form, e.g. "Rowan's brown goat keeps escaping the pen". */
  summary: string;
  lines: readonly [string, string, string];
  /**
   * What a neighbor says back to each of the three `lines`, in order. Written for this topic so the
   * authored (no-model) scene stays on subject; voice-neutral so any listener can say them.
   */
  replies: readonly [string, string, string];
}

/** One resident's complete sheet. */
export interface ResidentCharacterSheet {
  name: string;
  role: string;
  personality: string;
  speech: string;
  likes: readonly [string, string, string];
  worries: readonly [string, string];
  history: string;
  /** How this resident sees three specific neighbors. */
  relationships: Readonly<Partial<Record<ResidentId, string>>>;
  topics: readonly [ResidentTopic, ResidentTopic, ResidentTopic, ResidentTopic];
  reactions: Readonly<Record<ReactionKind, readonly [string, string, string]>>;
  talk: Readonly<Record<TalkContext, readonly string[]>>;
}

const REACTION_KINDS: readonly ReactionKind[] = ['curious', 'tease', 'warm', 'advice', 'close'];
const TALK_COUNTS: Readonly<Record<TalkContext, number>> = { morning: 2, afternoon: 2, evening: 2, rain: 2, weekend: 2,
  spring: 1, summer: 1, fall: 1, winter: 1 };
/** Speech that reaches a bubble or a prompt may not carry JSON-like or multi-line text. */
const UNSAFE_TEXT = /[{}\[\]\r\n]/;

let validated: Readonly<Record<ResidentId, ResidentCharacterSheet>> | null = null;

/**
 * Validate one bounded speech string.
 * @param value unknown JSON value
 * @param label field path for the error
 * @param max inclusive length limit
 * @returns the trimmed string
 */
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || UNSAFE_TEXT.test(value)) {
    throw new Error(`Character sheets: ${label} must be 1-${max} safe characters`);
  }
  return value.trim();
}

/**
 * Validate a fixed-length string list.
 * @param value unknown JSON value
 * @param label field path for the error
 * @param count exact length
 * @param max per-item length limit
 */
function textList(value: unknown, label: string, count: number, max: number): string[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`Character sheets: ${label} must hold exactly ${count}`);
  return value.map((item, index) => text(item, `${label}[${index}]`, max));
}

/**
 * Require an object with exactly these keys in any order.
 * @param value unknown JSON value
 * @param label field path for the error
 * @param keys the only allowed keys
 */
function exact(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Character sheets: ${label} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`Character sheets: ${label} has unknown or missing fields`);
  }
  return record;
}

/**
 * Validate one resident's sheet.
 * @param id the resident the sheet must describe
 * @param value unknown JSON value
 */
function sheet(id: ResidentId, value: unknown): ResidentCharacterSheet {
  const record = exact(value, id, ['name', 'role', 'personality', 'speech', 'likes', 'worries', 'history', 'relationships',
    'topics', 'reactions', 'talk']);
  const relationships = record.relationships;
  if (!relationships || typeof relationships !== 'object' || Array.isArray(relationships)
    || Object.keys(relationships).length !== 3) throw new Error(`Character sheets: ${id}.relationships must name three neighbors`);
  const opinions: Partial<Record<ResidentId, string>> = {};
  for (const [other, note] of Object.entries(relationships as Record<string, unknown>)) {
    if (other === id || !(CHARACTER_SHEET_IDS as readonly string[]).includes(other)) {
      throw new Error(`Character sheets: ${id}.relationships names unknown neighbor ${other}`);
    }
    opinions[other as ResidentId] = text(note, `${id}.relationships.${other}`, 120);
  }
  if (!Array.isArray(record.topics) || record.topics.length !== 4) throw new Error(`Character sheets: ${id}.topics must hold four`);
  const topics = record.topics.map((topic, index) => {
    const entry = exact(topic, `${id}.topics[${index}]`, ['id', 'summary', 'lines', 'replies']);
    const topicId = text(entry.id, `${id}.topics[${index}].id`, 48);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topicId)) throw new Error(`Character sheets: ${id} topic id ${topicId} is not kebab-case`);
    return { id: topicId, summary: text(entry.summary, `${id}.${topicId}.summary`, 90),
      lines: textList(entry.lines, `${id}.${topicId}.lines`, 3, 140) as unknown as readonly [string, string, string],
      replies: textList(entry.replies, `${id}.${topicId}.replies`, 3, 140) as unknown as readonly [string, string, string] };
  });
  if (new Set(topics.map(topic => topic.id)).size !== 4) throw new Error(`Character sheets: ${id} topic ids repeat`);
  const reactionRecord = exact(record.reactions, `${id}.reactions`, REACTION_KINDS);
  const reactions = Object.fromEntries(REACTION_KINDS.map(kind =>
    [kind, textList(reactionRecord[kind], `${id}.reactions.${kind}`, 3, 140)])) as unknown as ResidentCharacterSheet['reactions'];
  const talkRecord = exact(record.talk, `${id}.talk`, Object.keys(TALK_COUNTS));
  const talk = Object.fromEntries((Object.keys(TALK_COUNTS) as TalkContext[]).map(context =>
    [context, textList(talkRecord[context], `${id}.talk.${context}`, TALK_COUNTS[context], 140)])) as unknown as ResidentCharacterSheet['talk'];
  return {
    name: text(record.name, `${id}.name`, 24), role: text(record.role, `${id}.role`, 60),
    personality: text(record.personality, `${id}.personality`, 200), speech: text(record.speech, `${id}.speech`, 160),
    likes: textList(record.likes, `${id}.likes`, 3, 60) as unknown as ResidentCharacterSheet['likes'],
    worries: textList(record.worries, `${id}.worries`, 2, 80) as unknown as ResidentCharacterSheet['worries'],
    history: text(record.history, `${id}.history`, 240), relationships: opinions,
    topics: topics as unknown as ResidentCharacterSheet['topics'], reactions, talk,
  };
}

/** Validate the whole file once and cache the frozen result. */
export function residentCharacterSheets(): Readonly<Record<ResidentId, ResidentCharacterSheet>> {
  if (validated) return validated;
  const root = exact(rawSheets as unknown, 'file', ['residents']);
  const residents = exact(root.residents, 'residents', CHARACTER_SHEET_IDS);
  validated = Object.freeze(Object.fromEntries(CHARACTER_SHEET_IDS.map(id => [id, sheet(id, residents[id])]))) as
    Readonly<Record<ResidentId, ResidentCharacterSheet>>;
  return validated;
}

/**
 * One resident's validated sheet.
 * @param id resident id
 */
export function residentCharacterSheet(id: ResidentId): ResidentCharacterSheet {
  const found = residentCharacterSheets()[id];
  if (!found) throw new Error(`Character sheets: no sheet for ${id}`);
  return found;
}

/**
 * The topic on a resident's mind today. The same topic drives that day's scenes, Talk, and gossip,
 * so what a resident tells the keeper matches what they tell their neighbors.
 * @param id resident id
 * @param day game day (1-based)
 */
export function residentTopicForDay(id: ResidentId, day: number): ResidentTopic {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`Character sheets: invalid day ${day}`);
  const index = CHARACTER_SHEET_IDS.indexOf(id as typeof CHARACTER_SHEET_IDS[number]);
  if (index < 0) throw new Error(`Character sheets: unknown resident ${id}`);
  // why: offset by resident index so neighbors do not all switch topics in lockstep.
  return residentCharacterSheet(id).topics[(day + index) % 4];
}

/**
 * Find one topic by its stable id (gossip stores topic ids, not text).
 * @param id resident who owns the topic
 * @param topicId kebab-case topic id
 */
export function residentTopic(id: ResidentId, topicId: string): ResidentTopic {
  const topic = residentCharacterSheet(id).topics.find(candidate => candidate.id === topicId);
  if (!topic) throw new Error(`Character sheets: ${id} has no topic ${topicId}`);
  return topic;
}
