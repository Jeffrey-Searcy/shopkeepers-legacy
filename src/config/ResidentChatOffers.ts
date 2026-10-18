/**
 * ResidentChatOffers — typed, strictly validated access to ResidentChatOffers.json.
 *
 * A chat offer is one real thing a resident may do for the keeper when a local-model conversation
 * naturally leads there (playtester: "if the ai liked how I talked to it, cool things could happen
 * right there in game"). The JSON is shared by two readers:
 *  - the game (ResidentOfferSystem decides who may offer what, and runs the effect on accept);
 *  - scripts/npc-chat-supervisor.mjs, which reads the same file from disk for the model prompt.
 *
 * The model only names an offer id from the list the game sent. The game re-checks every gate and
 * owns every effect, so the model can never invent a reward.
 *
 * Data shape (per offer id):
 *  - residentId: who can make the offer;
 *  - label: the keeper's accept button text;
 *  - ability: plain prompt text that tells the model what this resident can do;
 *  - acceptLine: the authored line the resident says when the keeper accepts;
 *  - minHearts: the friendship needed before the game lists the offer;
 *  - repeat: 'once' (a lifetime event, gated by its own state) or 'daily' (once per game day).
 *
 * A broken file fails loudly at first import. Nothing is defaulted or repaired.
 */
import rawOffers from './ResidentChatOffers.json';
import { CHARACTER_SHEET_IDS } from './ResidentCharacterSheets';
import type { ResidentId } from './ResidentRelationships';

/** Every offer id, in file order. ResidentOfferSystem must have one effect for each. */
export const CHAT_OFFER_IDS = ['teach-mana', 'show-magic', 'herbal-tea', 'on-the-house', 'fresh-berries', 'spare-potion'] as const;

/** One offer id. */
export type ChatOfferId = typeof CHAT_OFFER_IDS[number];

/** How often the keeper can receive one offer. */
export type ChatOfferRepeat = 'once' | 'daily';

/** One validated offer. */
export interface ChatOfferDefinition {
  id: ChatOfferId;
  residentId: ResidentId;
  label: string;
  ability: string;
  acceptLine: string;
  minHearts: number;
  repeat: ChatOfferRepeat;
}

/** Longest accept button text the dialogue panel fits. */
const MAX_LABEL_LENGTH = 32;
/** Longest prompt text for one offer. */
const MAX_ABILITY_LENGTH = 200;
/** Longest authored accept line (the dialogue panel fits about six lines). */
const MAX_ACCEPT_LINE_LENGTH = 220;

/**
 * Require one safe single-line string.
 * @param value raw value
 * @param label path for the error message
 * @param max longest allowed length
 */
function textField(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[{}\[\]\r\n]/.test(value)) {
    throw new Error(`Resident chat offers: "${label}" is invalid`);
  }
  return value;
}

/** Validate the whole JSON file into a frozen id → definition table. */
function loadOffers(): Readonly<Record<ChatOfferId, ChatOfferDefinition>> {
  const raw = rawOffers as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).join(',') !== 'offers') {
    throw new Error('Resident chat offers: the file must contain only "offers"');
  }
  const offers = (raw as { offers: unknown }).offers;
  if (!offers || typeof offers !== 'object' || Array.isArray(offers)) throw new Error('Resident chat offers: "offers" must be an object');
  const table = offers as Record<string, unknown>;
  // why: the effect table in ResidentOfferSystem is keyed by CHAT_OFFER_IDS, so the file must match it exactly.
  if (Object.keys(table).join(',') !== CHAT_OFFER_IDS.join(',')) {
    throw new Error(`Resident chat offers: the file must list exactly ${CHAT_OFFER_IDS.join(', ')} in that order`);
  }
  const result = {} as Record<ChatOfferId, ChatOfferDefinition>;
  for (const id of CHAT_OFFER_IDS) {
    const entry = table[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'ability,acceptLine,label,minHearts,repeat,residentId') {
      throw new Error(`Resident chat offers: "${id}" must have exactly ability, acceptLine, label, minHearts, repeat, residentId`);
    }
    const record = entry as Record<string, unknown>;
    if (!(CHARACTER_SHEET_IDS as readonly string[]).includes(record.residentId as string)) {
      throw new Error(`Resident chat offers: "${id}.residentId" is not a resident`);
    }
    if (!Number.isSafeInteger(record.minHearts) || (record.minHearts as number) < 0 || (record.minHearts as number) > 10) {
      throw new Error(`Resident chat offers: "${id}.minHearts" must be 0-10`);
    }
    if (record.repeat !== 'once' && record.repeat !== 'daily') throw new Error(`Resident chat offers: "${id}.repeat" is invalid`);
    result[id] = Object.freeze({ id, residentId: record.residentId as ResidentId,
      label: textField(record.label, `${id}.label`, MAX_LABEL_LENGTH),
      ability: textField(record.ability, `${id}.ability`, MAX_ABILITY_LENGTH),
      acceptLine: textField(record.acceptLine, `${id}.acceptLine`, MAX_ACCEPT_LINE_LENGTH),
      minHearts: record.minHearts as number, repeat: record.repeat });
  }
  return Object.freeze(result);
}

/** Every offer, validated once at import. */
export const CHAT_OFFERS = loadOffers();

/**
 * True when `value` names a known offer.
 * @param value any value, e.g. a model reply field
 */
export function isChatOfferId(value: unknown): value is ChatOfferId {
  return typeof value === 'string' && (CHAT_OFFER_IDS as readonly string[]).includes(value);
}

/**
 * The offers one resident can ever make, in file order.
 * @param residentId the resident
 */
export function chatOffersFor(residentId: ResidentId): ChatOfferDefinition[] {
  return CHAT_OFFER_IDS.map(id => CHAT_OFFERS[id]).filter(offer => offer.residentId === residentId);
}
