/**
 * ShippingSystem — the farm's shipping bin (Stardew model): drop items in during the day, they
 * auto-sell at day end (sleep). Items can be taken back out any time before the day rolls over.
 * Only items with a sell value (ITEM_VALUES) can be shipped — fail-loud UI plays a deny cue.
 */
import { GameState } from '../state/GameState';
import { ITEM_VALUES } from '../config/Items';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';

export const ShippingSystem = {
  /** Can this item be sold at all? */
  sellable(item: string): boolean {
    return (ITEM_VALUES[item] ?? 0) > 0;
  },

  /** Queue `n` of `item` from the bag into the bin. Returns amount moved (0 if unsellable). */
  deposit(item: string, n: number): number {
    if (!this.sellable(item)) return 0;
    const gs = GameState.instance;
    return InventoryLayoutSystem.transferFromPlayer(gs, gs.bin, item, n);
  },

  /** Take items back out of the bin before day end. */
  withdraw(item: string, n: number): number {
    const gs = GameState.instance;
    return InventoryLayoutSystem.transferToPlayer(gs, gs.bin, item, n);
  },

  /** Total gold the current bin contents will fetch. */
  pendingValue(): number {
    const gs = GameState.instance;
    return Object.entries(gs.bin).reduce((sum, [item, n]) => sum + (ITEM_VALUES[item] ?? 0) * n, 0);
  },

  /** Day-end payout: convert the bin to gold. Returns the amount earned. */
  payout(): number {
    const gs = GameState.instance;
    const total = this.pendingValue();
    gs.gold += total;
    gs.bin = {};
    return total;
  },
};
