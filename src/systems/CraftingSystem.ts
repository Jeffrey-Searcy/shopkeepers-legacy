/**
 * CraftingSystem — recipes as data (the Prompt-6 crafting system starts here; V1 ships one
 * recipe so the place-anywhere loop is playable: 20 wood -> a placeable chest).
 *
 * craft() is all-or-nothing: it verifies the full cost, deducts, then yields. Fail-loud contract:
 * returns false (no partial deduction) when ingredients are missing — the UI plays a deny cue.
 */
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';

export interface Recipe {
  id: string;
  label: string;
  cost: Record<string, number>;
  yields: string;
  /**
   * Where this can be crafted: 'none' = anywhere from the bag; 'workbench' = only via the crafting
   * panel opened at a placed workbench. NOTE: craft() itself stays pure (affordability only) —
   * station access is enforced by which UI can invoke it.
   */
  station: 'none' | 'workbench';
}

/** The recipe book (data — extend here, not in logic). The workbench unlocks everything else.
 *  (Fences/tools/etc. get added here as their art + placement support land.) */
export const RECIPES: Recipe[] = [
  { id: 'workbench', label: 'Workbench', cost: { wood: 15 }, yields: 'workbench', station: 'none' },
  { id: 'chest', label: 'Chest', cost: { wood: 20 }, yields: 'chest', station: 'workbench' },
  // Furniture (Interior 2.0): placeable anywhere not blocked, break/pickup with the axe.
  { id: 'table', label: 'Table', cost: { wood: 12 }, yields: 'table', station: 'workbench' },
  { id: 'chair', label: 'Chair', cost: { wood: 6 }, yields: 'chair', station: 'workbench' },
  { id: 'rug', label: 'Rug', cost: { fiber: 8 }, yields: 'rug', station: 'workbench' },
];

export const CraftingSystem = {
  /** Can the player afford this recipe right now? */
  canCraft(id: string): boolean {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) return false;
    const inv = GameState.instance.inventory;
    return Object.entries(r.cost).every(([item, n]) => (inv[item] ?? 0) >= n);
  },

  /** Craft a recipe: deduct the full cost and add the yield. Returns false if unaffordable. */
  craft(id: string): boolean {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) throw new Error(`CraftingSystem: unknown recipe "${id}"`);
    if (!this.canCraft(id)) return false;
    const gs = GameState.instance;
    const deltas: Record<string, number> = { [r.yields]: 1 };
    for (const [item, n] of Object.entries(r.cost)) {
      deltas[item] = (deltas[item] ?? 0) - n;
    }
    // Ingredients may free the slot the yield needs; plan the complete recipe before committing.
    return InventoryLayoutSystem.applyInventoryDelta(gs, deltas);
  },
};
