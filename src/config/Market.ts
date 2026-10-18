/**
 * General Market content: the seed stock sold at the register.
 * The Market room itself (painting, walk rows, register, private wing) lives in CivicInteriors / CivicRoomArt.
 */
import { ITEM_CATALOG, ITEM_VALUES, ItemId } from './Items';
import { cropForSeed } from './Crops';

/** One validated seed offer. Stock is unlimited for this first shop proof. */
export interface MarketStockItem {
  /** A seed item id from ITEM_CATALOG that also has a crop in CROPS (checked at module load). */
  item: string;
  price: number;
  season: 'spring' | 'summer';
}

/** Seed prices sit above shipping value, so buying and reselling cannot create free gold. */
export const MARKET_STOCK: readonly MarketStockItem[] = Object.freeze([
  { item: ItemId.ParsnipSeeds, price: 20, season: 'spring' },
  { item: ItemId.PotatoSeeds, price: 50, season: 'spring' },
  { item: ItemId.MelonSeeds, price: 80, season: 'summer' },
  { item: 'cabbage-seeds', price: 40, season: 'spring' },
  { item: 'strawberry-seeds', price: 80, season: 'spring' },
  { item: 'tomato-seeds', price: 50, season: 'summer' },
]);

/**
 * Check the stock table once at load: every row must sell a real seed whose crop grows in the
 * season the row advertises, and must cost more than the seed ships for (no free-gold loop).
 */
function validateMarketStock(stock: readonly MarketStockItem[]): void {
  const seen = new Set<string>();
  for (const offer of stock) {
    if (seen.has(offer.item)) throw new Error(`Market: ${offer.item} is listed twice`);
    seen.add(offer.item);
    if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, offer.item)) throw new Error(`Market: unknown item ${offer.item}`);
    const crop = cropForSeed(offer.item);
    if (!crop) throw new Error(`Market: ${offer.item} is not a seed`);
    if (crop.season !== offer.season) throw new Error(`Market: ${offer.item} is listed for ${offer.season} but grows in ${crop.season}`);
    if (!(offer.price > (ITEM_VALUES[offer.item] ?? 0))) throw new Error(`Market: ${offer.item} must cost more than it ships for`);
  }
}
validateMarketStock(MARKET_STOCK);
