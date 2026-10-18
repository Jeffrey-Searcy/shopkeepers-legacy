/**
 * ResidentOfferSystem — decides which real chat offers a resident may make, and runs one on accept.
 *
 * Playtest request: "if the AI liked how I talked to it, cool things could happen right there in
 * game", e.g. Nyra teaching mana after a conversation about magic. The flow is:
 *  1. Before each chat turn, ResidentDialogueSystem asks eligibleOffers() and sends those ids to the
 *     local model (with ability text from ResidentChatOffers.json, see the supervisor prompt).
 *  2. The model may name one id in the reply where it offers it in words. Most replies name none.
 *  3. The game shows accept/decline buttons only when the offer is still eligible right now.
 *  4. accept() re-checks every gate, runs the authored effect, and records the day.
 *
 * The model never chooses an effect or an amount. Every effect lives in EFFECTS below, keyed by
 * CHAT_OFFER_IDS, so adding an offer to the JSON without an effect fails type checking.
 *
 * Gates for every offer: friendship hearts >= minHearts, 'daily' offers once per game day, and the
 * offer's own `ready` rule (e.g. teach-mana only before the keeper has mana).
 */
import { STAMINA_MAX } from '../config/GameConfig';
import { CHAT_OFFERS, chatOffersFor, type ChatOfferDefinition, type ChatOfferId } from '../config/ResidentChatOffers';
import type { ResidentId } from '../config/ResidentRelationships';
import { GameState } from '../state/GameState';
import { relationshipView } from './RelationshipSystem';
import { Sfx } from './SfxSystem';
import { VitalitySystem } from './VitalitySystem';

/** Result of accepting an offer. `ok` false means nothing changed and the offer was not used up. */
export interface OfferResult {
  ok: boolean;
  message: string;
}

/** Stamina the herbal-tea offer restores. */
export const HERBAL_TEA_STAMINA = 30;
/** Game minutes the show-magic charm (Quick Step) lasts. */
export const SHOW_MAGIC_MINUTES = 60;
/** Game minutes the on-the-house drink (Cheer) lasts. */
export const ON_THE_HOUSE_MINUTES = 120;

/**
 * One offer's authored rule.
 *  - ready: extra gate beyond hearts and the daily limit; returns true when the offer makes sense now.
 *  - run: applies the effect and returns the result. A failed run must change nothing.
 */
interface OfferEffect {
  ready(): boolean;
  run(): OfferResult;
}

/**
 * Give items atomically, or refuse with a clear message when the bag is full.
 * @param item item id
 * @param count how many
 * @param label what the toast calls them
 */
function giveItems(item: string, count: number, label: string): OfferResult {
  if (!GameState.instance.addItem(item, count)) return { ok: false, message: `Your bag is full. Make room for the ${label} first.` };
  Sfx.play('harvest');
  return { ok: true, message: `+${count} ${label}` };
}

/** Authored effect for every offer id (the Record type forces one per id). */
const EFFECTS: Readonly<Record<ChatOfferId, OfferEffect>> = {
  'teach-mana': {
    ready: () => !VitalitySystem.hasMana(),
    run: () => {
      VitalitySystem.learnMana();
      Sfx.play('magic');
      return { ok: true, message: 'You can feel mana now · Meditate an hour to grow it' };
    },
  },
  'show-magic': {
    ready: () => true,
    run: () => {
      VitalitySystem.grantBuff('quick-step', SHOW_MAGIC_MINUTES);
      Sfx.play('magic');
      return { ok: true, message: 'Quick Step: you walk faster' };
    },
  },
  'herbal-tea': {
    // why: tea only restores stamina, so offering it at full stamina would be an empty gift.
    ready: () => GameState.instance.player.stamina < STAMINA_MAX,
    run: () => {
      const player = GameState.instance.player, gained = Math.min(HERBAL_TEA_STAMINA, STAMINA_MAX - player.stamina);
      if (gained <= 0) return { ok: false, message: 'You are full of energy already.' };
      player.stamina += gained;
      Sfx.play('eat');
      return { ok: true, message: `+${gained} stamina` };
    },
  },
  'on-the-house': {
    ready: () => true,
    run: () => {
      VitalitySystem.grantBuff('cheer', ON_THE_HOUSE_MINUTES);
      Sfx.play('eat');
      return { ok: true, message: 'Cheer: chats build friendship faster' };
    },
  },
  'fresh-berries': { ready: () => true, run: () => giveItems('strawberry', 2, 'Strawberries') },
  'spare-potion': { ready: () => true, run: () => giveItems('healing-potion', 1, 'Healing Potion') },
};

/**
 * True when `offer` passes every gate right now.
 * @param offer offer definition
 */
function isEligible(offer: ChatOfferDefinition): boolean {
  const gs = GameState.instance;
  if (relationshipView(offer.residentId).hearts < offer.minHearts) return false;
  if (offer.repeat === 'daily' && gs.residentOffers.lastDay[offer.id] === gs.day) return false;
  return EFFECTS[offer.id].ready();
}

export const ResidentOfferSystem = {
  /**
   * Offers `id` may make in the next chat reply, in file order.
   * @param id the resident being talked to
   * @param declined offers the keeper already turned down in this conversation
   */
  eligibleOffers(id: ResidentId, declined: readonly ChatOfferId[]): ChatOfferId[] {
    return chatOffersFor(id).filter(offer => !declined.includes(offer.id) && isEligible(offer)).map(offer => offer.id);
  },

  /**
   * True when `offerId` belongs to `id` and passes every gate right now.
   * @param id resident
   * @param offerId offer id
   */
  isEligible(id: ResidentId, offerId: ChatOfferId): boolean {
    const offer = CHAT_OFFERS[offerId];
    return offer.residentId === id && isEligible(offer);
  },

  /**
   * Accept one offer: re-check the gates, run the effect, record the day.
   * @param id the resident making the offer
   * @param offerId the offer shown to the keeper
   * @returns the effect result; `ok` false changes nothing (e.g. a full bag)
   * @throws when the offer is not this resident's or no longer passes its gates (the UI re-checks first)
   */
  accept(id: ResidentId, offerId: ChatOfferId): OfferResult {
    if (!this.isEligible(id, offerId)) throw new Error(`Resident offers: ${offerId} is not available from ${id} now`);
    const result = EFFECTS[offerId].run();
    if (result.ok) GameState.instance.residentOffers.lastDay[offerId] = GameState.instance.day;
    return result;
  },
};
