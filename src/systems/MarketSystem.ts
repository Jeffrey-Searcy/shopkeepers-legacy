/**
 * General Market transactions. This module owns validation and atomic writes; the scene and UI
 * only choose a catalog item and display the returned result.
 */
import { MARKET_STOCK, type MarketStockItem } from '../config/Market';
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';

/** A complete purchase result for player feedback and deterministic tests. */
export interface MarketPurchaseResult { ok: boolean; message: string; item?: string; quantity?: number; cost?: number }

/** Resolve a known stock row without inventing price or item data. */
export function marketStockItem(item: string): MarketStockItem | null {
  const stock = MARKET_STOCK.find(entry => entry.item === item);
  return stock ? stock : null;
}

/**
 * Buy an exact positive quantity. Inventory commits first; gold changes only after that succeeds.
 * @param item Known item ID from MARKET_STOCK.
 * @param quantity Positive whole-unit amount.
 * @returns A result that reports the unchanged rejection or completed transaction.
 */
export function buyMarketStock(item: string, quantity: number): MarketPurchaseResult {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`MarketSystem: invalid quantity ${quantity}`);
  const stock = marketStockItem(item);
  if (!stock) return { ok: false, message: 'That item is not sold at the General Market.' };
  const cost = stock.price * quantity;
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error(`MarketSystem: invalid cost ${cost}`);
  const gs = GameState.instance;
  if (gs.gold < cost) return { ok: false, message: `You need ${cost - gs.gold} more gold.` };
  if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [stock.item]: quantity })) {
    return { ok: false, message: 'Your bag has no room for this seed stack.' };
  }
  gs.gold -= cost;
  return { ok: true, message: `${quantity} ${quantity === 1 ? 'packet' : 'packets'} tucked into your bag.`,
    item: stock.item, quantity, cost };
}

/** Public bounded API for the Market panel and tests. */
export const MarketSystem = Object.freeze({ stock: MARKET_STOCK, buy: buyMarketStock });
