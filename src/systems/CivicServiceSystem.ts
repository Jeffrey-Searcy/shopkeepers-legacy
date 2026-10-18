/**
 * Atomic service actions for non-Market civic buildings. UI selects; this module validates and commits.
 * It also words the "live" options (forge and alchemy upgrades, potion brewing, Seren's board job)
 * from current progress, so the menu always shows the real next cost.
 */
import { STAMINA_MAX } from '../config/GameConfig';
import { civicServiceDefinition, type CivicServiceOption } from '../config/CivicServices';
import type { ExpandedCivicId } from '../config/CivicInteriors';
import { ITEM_CATALOG } from '../config/Items';
import { ALCHEMY_UPGRADES, FORGE_UPGRADES, POTION_RECIPE, VITAL_DRAUGHT_HP, describeCost, type UpgradeCost } from '../config/Upgrades';
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';
import { InventorySystem } from './InventorySystem';
import { GuildBoardSystem } from './GuildBoardSystem';
import { ALCHEMY_MAX_LEVEL, FORGE_MAX_LEVEL } from './ProgressSystem';

export interface CivicServiceResult { ok: boolean; message: string; intent?: 'wardrobe' }

/** Resolve an authored option inside its building so callers cannot submit arbitrary actions. */
function serviceOption(building: ExpandedCivicId, optionId: string): CivicServiceOption {
  const option = civicServiceDefinition(building).options.find(entry => entry.id === optionId);
  if (!option) throw new Error(`Civic service: ${building} does not offer ${optionId}`);
  return option;
}

/** Multiply a positive whole amount and reject unsafe totals before any state write. */
function safeTotal(value: number, quantity: number, label: string): number {
  const total = value * quantity;
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error(`Civic service: invalid ${label} total ${total}`);
  return total;
}

/**
 * Pay one upgrade cost (items and gold) in a single step, or change nothing.
 * @returns null on success, or the not-ok message naming what is missing
 */
function payCost(cost: UpgradeCost): string | null {
  const gs = GameState.instance;
  const missing = Object.entries(cost.items).filter(([item, qty]) => InventorySystem.count(item) < qty)
    .map(([item, qty]) => `${qty} ${ITEM_CATALOG[item].label}`);
  if (missing.length > 0) return `You need ${missing.join(' and ')}.`;
  if (gs.gold < cost.gold) return `You need ${cost.gold - gs.gold} more gold.`;
  const delta = Object.fromEntries(Object.entries(cost.items).map(([item, qty]) => [item, -qty]));
  if (!InventoryLayoutSystem.applyInventoryDelta(gs, delta)) throw new Error('Civic service: the bag refused a cost it had just counted');
  gs.gold -= cost.gold;
  return null;
}

/**
 * The label and detail line a menu shows for one option. Fixed offers return their authored text;
 * live offers are worded from current progress.
 * @param option an authored option
 */
export function civicOptionText(option: CivicServiceOption): { label: string; detail: string } {
  const progress = GameState.instance.progress, action = option.action;
  if (action.kind === 'forge-upgrade') {
    const level = progress.forgeLevel;
    if (level >= FORGE_MAX_LEVEL) return { label: `Sword tempered · +${level}`, detail: 'Rhea has nothing left to teach this blade' };
    return { label: `Temper sword · +${level} → +${level + 1}`, detail: describeCost(FORGE_UPGRADES[level].gold, FORGE_UPGRADES[level].items) };
  }
  if (action.kind === 'alchemy-upgrade') {
    const level = progress.alchemyLevel;
    if (level >= ALCHEMY_MAX_LEVEL) return { label: 'Vital Draughts · all drunk', detail: `Max health raised by ${level * VITAL_DRAUGHT_HP}` };
    return { label: `Vital Draught ${level + 1}/${ALCHEMY_MAX_LEVEL} · +${VITAL_DRAUGHT_HP} max HP`,
      detail: describeCost(ALCHEMY_UPGRADES[level].gold, ALCHEMY_UPGRADES[level].items) };
  }
  if (action.kind === 'brew-potion') return { label: option.label, detail: `${describeCost(0, POTION_RECIPE)} → 1 Healing Potion` };
  if (action.kind === 'guild-board') {
    const job = GuildBoardSystem.current();
    if (!job) return { label: 'Board · job done', detail: 'Seren posts a new job tomorrow' };
    return { label: `Board · ${job.request.note}`,
      detail: `Bring ${job.request.qty} ${ITEM_CATALOG[job.request.item].label} · ${job.request.reward}g · due ${job.dueToday ? 'today' : 'tomorrow'}` };
  }
  return { label: option.label, detail: option.detail };
}

/** Execute one validated service and commit its complete write set only after every check passes. */
export function runCivicService(building: ExpandedCivicId, optionId: string, quantity: number): CivicServiceResult {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Civic service: invalid quantity ${quantity}`);
  const option = serviceOption(building, optionId);
  if (!option.supportsBatch && quantity !== 1) throw new Error(`Civic service: ${optionId} does not support batches`);
  const gs = GameState.instance, action = option.action;
  if (action.kind === 'info') {
    const index = (gs.day - 1) % action.lines.length;
    const line = action.lines[index];
    if (!line) throw new Error(`Civic service: ${optionId} has no daily line`);
    return { ok: true, message: line };
  }
  if (action.kind === 'wardrobe') return { ok: true, message: 'The fitting room is ready.', intent: 'wardrobe' };
  if (action.kind === 'forge-upgrade') {
    const level = gs.progress.forgeLevel;
    if (level >= FORGE_MAX_LEVEL) return { ok: false, message: 'Your sword is already as sharp as Rhea can make it.' };
    const missing = payCost(FORGE_UPGRADES[level]);
    if (missing) return { ok: false, message: missing };
    gs.progress.forgeLevel = level + 1;
    return { ok: true, message: `Rhea folds the shards into the steel. Your sword now hits for +${level + 1}.` };
  }
  if (action.kind === 'alchemy-upgrade') {
    const level = gs.progress.alchemyLevel;
    if (level >= ALCHEMY_MAX_LEVEL) return { ok: false, message: 'Cael says one more draught would do more harm than good.' };
    const missing = payCost(ALCHEMY_UPGRADES[level]);
    if (missing) return { ok: false, message: missing };
    gs.progress.alchemyLevel = level + 1;
    gs.maxHp += VITAL_DRAUGHT_HP;
    gs.hp = gs.maxHp;
    return { ok: true, message: `The draught burns, then glows. Max health is now ${gs.maxHp}.` };
  }
  if (action.kind === 'brew-potion') {
    const missing = payCost({ gold: 0, items: POTION_RECIPE });
    if (missing) return { ok: false, message: missing };
    if (!InventoryLayoutSystem.applyInventoryDelta(gs, { 'healing-potion': 1 })) {
      // why: give the ingredients back so a full bag never eats them.
      if (!InventoryLayoutSystem.applyInventoryDelta(gs, POTION_RECIPE)) throw new Error('Civic service: could not return potion ingredients');
      return { ok: false, message: 'Your bag has no room for the potion.' };
    }
    return { ok: true, message: 'Cael corks a warm red potion. Equip it in a fight and use it to heal.' };
  }
  if (action.kind === 'guild-board') {
    const result = GuildBoardSystem.turnIn();
    return { ok: result.ok, message: result.message };
  }
  if (action.kind === 'restore') {
    if (gs.hp === gs.maxHp && gs.player.stamina === STAMINA_MAX) return { ok: false, message: 'You are already at full strength.' };
    if (gs.gold < action.gold) return { ok: false, message: `Treatment costs ${action.gold} gold.` };
    gs.gold -= action.gold; gs.hp = gs.maxHp; gs.player.stamina = STAMINA_MAX;
    return { ok: true, message: 'Bandaged, rested, and ready to go.' };
  }
  if (action.kind === 'tonic') {
    if (gs.hp === gs.maxHp && gs.player.stamina === STAMINA_MAX) return { ok: false, message: 'You do not need a tonic right now.' };
    if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [action.item]: -1 })) {
      return { ok: false, message: `Bring one ${action.item.replace('-', ' ')}.` };
    }
    gs.hp = Math.min(gs.maxHp, gs.hp + action.hp);
    gs.player.stamina = Math.min(STAMINA_MAX, gs.player.stamina + action.stamina);
    return { ok: true, message: 'The tonic warms your hands and clears your head.' };
  }
  if (action.kind === 'buy') {
    const cost = safeTotal(action.gold, quantity, 'gold');
    if (gs.gold < cost) return { ok: false, message: `You need ${cost - gs.gold} more gold.` };
    if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [action.item]: quantity })) {
      return { ok: false, message: 'Your bag has no room for that stack.' };
    }
    gs.gold -= cost;
    return { ok: true, message: `${quantity} ${option.label} ${quantity === 1 ? 'is' : 'are'} ready.` };
  }
  const itemQuantity = safeTotal(action.itemQuantity, quantity, 'item');
  const gold = safeTotal(action.gold, quantity, 'reward');
  const nextGold = gs.gold + gold;
  if (!Number.isSafeInteger(nextGold)) throw new Error(`Civic service: gold overflow ${nextGold}`);
  if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [action.item]: -itemQuantity })) {
    return { ok: false, message: `You need ${itemQuantity} ${action.item.replace('-', ' ')}.` };
  }
  gs.gold = nextGold;
  return { ok: true, message: `Contract complete. ${gold} gold received.` };
}

/** Public bounded API for the civic panel and behavior tests. */
export const CivicServiceSystem = Object.freeze({ run: runCivicService, optionText: civicOptionText });
