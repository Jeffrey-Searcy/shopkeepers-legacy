/**
 * Consumables — what each edible item does when the keeper eats or drinks it.
 *
 * Playtest note: "I should be able to eat and drink, with effects like stamina or other effects".
 * Every edible item restores some stamina. Some also start one timed buff (see BUFFS). The numbers
 * live here so VitalitySystem, the bag card, and the HUD all read one table.
 *
 * Data shapes:
 *  - CONSUMABLES[item]: stamina restored, the verb shown on the bag button, and an optional buff with
 *    its length in game minutes (1 real second = 1.5 game minutes, so 60 game minutes = 40 real seconds).
 *  - BUFFS[id]: the HUD label, a short effect line, and the HUD chip color.
 *
 * The healing potion is not here on purpose: the combat scenes own it (CombatController.drinkPotion).
 */
import { ITEM_CATALOG } from './Items';

/** Every timed buff the keeper can have. */
export const BUFF_IDS = ['well-fed', 'cheer', 'quick-step'] as const;
export type BuffId = typeof BUFF_IDS[number];

/** Display data for one buff. */
export interface BuffDef {
  /** Name on the HUD chip and in toasts. */
  label: string;
  /** One short line that says what the buff does. */
  effect: string;
  /** HUD chip fill color. */
  color: number;
}

/** Display data for every buff, in HUD order. */
export const BUFFS: Readonly<Record<BuffId, BuffDef>> = {
  'well-fed': { label: 'Well Fed', effect: 'Tools cost half stamina', color: 0xc8813a },
  cheer: { label: 'Cheer', effect: 'Chats build more friendship', color: 0xd9a63c },
  'quick-step': { label: 'Quick Step', effect: 'You walk faster', color: 0x6fa96b },
};

/** Tool stamina cost while Well Fed (normal cost is TOOL_STAMINA_COST = 2). */
export const WELL_FED_TOOL_COST = 1;
/** Extra friendship points each chat reply gives while Cheer is active. */
export const CHEER_CHAT_BONUS = 3;
/** Walk speed multiplier while Quick Step is active. */
export const QUICK_STEP_SPEED_SCALE = 1.2;
/** Longest buff length in game minutes. Save validation uses it to reject impossible expiry times. */
export const MAX_BUFF_MINUTES = 240;

/** What one edible item does. */
export interface ConsumableDef {
  /** Stamina restored, before the STAMINA_MAX cap. */
  stamina: number;
  /** Bag button verb. */
  verb: 'Eat' | 'Drink';
  /** Optional timed buff and its length in game minutes. */
  buff?: { id: BuffId; minutes: number };
}

/** Every edible item. Raw fish and seeds are not edible. */
export const CONSUMABLES: Readonly<Record<string, ConsumableDef>> = {
  stew: { stamina: 35, verb: 'Eat', buff: { id: 'well-fed', minutes: 180 } },
  ale: { stamina: 10, verb: 'Drink', buff: { id: 'cheer', minutes: 120 } },
  parsnip: { stamina: 10, verb: 'Eat' },
  potato: { stamina: 15, verb: 'Eat' },
  cabbage: { stamina: 15, verb: 'Eat' },
  tomato: { stamina: 12, verb: 'Eat' },
  mushroom: { stamina: 12, verb: 'Eat' },
  'wild-leek': { stamina: 8, verb: 'Eat' },
  strawberry: { stamina: 8, verb: 'Eat', buff: { id: 'quick-step', minutes: 60 } },
  melon: { stamina: 30, verb: 'Eat', buff: { id: 'quick-step', minutes: 120 } },
};

// why: a typo here would make an item silently inedible; fail at load instead.
for (const [item, def] of Object.entries(CONSUMABLES)) {
  if (!ITEM_CATALOG[item]) throw new Error(`Consumables: "${item}" is not in ITEM_CATALOG`);
  if (def.buff && def.buff.minutes > MAX_BUFF_MINUTES) throw new Error(`Consumables: "${item}" buff is longer than MAX_BUFF_MINUTES`);
}

/**
 * The consumable entry for an item, or null when the item is not edible.
 * @param item inventory item id
 */
export function consumableFor(item: string): ConsumableDef | null {
  return Object.prototype.hasOwnProperty.call(CONSUMABLES, item) ? CONSUMABLES[item] : null;
}
