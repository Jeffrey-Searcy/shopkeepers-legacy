/**
 * InventorySystem — the player bag plus transfers to/from a chest.
 *
 * Chest counts remain a plain map, while player item locations are owned by InventoryLayoutSystem.
 * Withdrawals plan backpack capacity before touching the chest; deposits clear a player slot when
 * its stack reaches zero. This keeps count + location changes atomic.
 */
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';

export const InventorySystem = {
  /** Count of an item in the bag. */
  count(item: string): number {
    return GameState.instance.inventory[item] ?? 0;
  },

  /** Count of an item in the chest. */
  chestCount(item: string): number {
    return GameState.instance.chest[item] ?? 0;
  },

  /** Deposit `n` of `item` from bag -> chest. Returns amount deposited. */
  deposit(item: string, n: number): number {
    const gs = GameState.instance;
    return InventoryLayoutSystem.transferFromPlayer(gs, gs.chest, item, n);
  },

  /** Withdraw `n` of `item` from chest -> bag. Returns amount withdrawn. */
  withdraw(item: string, n: number): number {
    const gs = GameState.instance;
    return InventoryLayoutSystem.transferToPlayer(gs, gs.chest, item, n);
  },

  /** Deposit the entire bag into the chest (used by the "quick stash" chest interaction). */
  depositAll(): void {
    const gs = GameState.instance;
    for (const item of Object.keys(gs.inventory)) {
      InventoryLayoutSystem.transferFromPlayer(gs, gs.chest, item, gs.inventory[item]);
    }
  },
};
