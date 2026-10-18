/**
 * Upgrades — what dungeon loot buys at the forge and the alchemy house.
 *
 * Rhea's forge tempers the keeper's sword (+1 damage per level, in the Mines and the dungeon).
 * Cael's alchemy house brews Vital Draughts (+VITAL_DRAUGHT_HP max HP per level, applied once on
 * purchase) and healing potions. CivicServiceSystem reads these costs; ProgressSystem stores the
 * levels. Costs are sized so one full clear (8 shards, 1 core) buys forge level 1 plus most of
 * level 2, and the Warden core gates each second level.
 */
import { ALCHEMY_MAX_LEVEL, FORGE_MAX_LEVEL } from '../systems/ProgressSystem';
import { ITEM_CATALOG } from './Items';

/** Gold plus items for one upgrade level. */
export interface UpgradeCost {
  readonly gold: number;
  readonly items: Readonly<Record<string, number>>;
}

/** Forge levels 1 and 2 (index 0 buys level 1). */
export const FORGE_UPGRADES: readonly UpgradeCost[] = [
  { gold: 50, items: { 'portal-shard': 3 } },
  { gold: 150, items: { 'portal-shard': 6, 'warden-core': 1 } },
];

/** Alchemy levels 1 and 2 (index 0 buys level 1). */
export const ALCHEMY_UPGRADES: readonly UpgradeCost[] = [
  { gold: 60, items: { 'portal-shard': 2, 'slime-gel': 2 } },
  { gold: 160, items: { 'portal-shard': 4, 'warden-core': 1 } },
];

/** Max HP each Vital Draught adds. */
export const VITAL_DRAUGHT_HP = 2;

/** Ingredients for one healing potion at Cael's brew table. */
export const POTION_RECIPE: Readonly<Record<string, number>> = { 'slime-gel': 1, mushroom: 1 };

/** Check the tables at module load: one cost per level, real items, positive amounts. */
function validateUpgrades(): void {
  const check = (label: string, costs: readonly UpgradeCost[], levels: number): void => {
    if (costs.length !== levels) throw new Error(`Upgrades: ${label} needs exactly ${levels} levels`);
    for (const cost of costs) {
      if (!Number.isSafeInteger(cost.gold) || cost.gold < 0) throw new Error(`Upgrades: ${label} has an invalid gold cost`);
      checkItems(label, cost.items);
    }
  };
  const checkItems = (label: string, items: Readonly<Record<string, number>>): void => {
    for (const [item, qty] of Object.entries(items)) {
      if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, item)) throw new Error(`Upgrades: ${label} uses unknown item ${item}`);
      if (!Number.isSafeInteger(qty) || qty < 1) throw new Error(`Upgrades: ${label} has an invalid amount of ${item}`);
    }
  };
  check('forge', FORGE_UPGRADES, FORGE_MAX_LEVEL);
  check('alchemy', ALCHEMY_UPGRADES, ALCHEMY_MAX_LEVEL);
  checkItems('potion', POTION_RECIPE);
}
validateUpgrades();

/**
 * Describe a cost as "3 Portal Shard · 50g", using catalog labels.
 * @param gold gold part of the cost
 * @param items item part of the cost
 */
export function describeCost(gold: number, items: Readonly<Record<string, number>>): string {
  const parts = Object.entries(items).map(([item, qty]) => `${qty} ${ITEM_CATALOG[item].label}`);
  if (gold > 0) parts.push(`${gold}g`);
  return parts.join(' · ');
}
