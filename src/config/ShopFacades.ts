/** Cosmetic storefront family. All entries share the accepted door, porch, footprint and interior. */
import { TextureKey } from './AssetKeys';

export const SHOP_FACADES = [
  { id: 'original', label: 'Original shop', texture: TextureKey.ShopFacade },
  { id: 'inn', label: 'Fantasy inn', texture: TextureKey.ShopFacadeInn },
  { id: 'blacksmith', label: 'Blacksmith', texture: TextureKey.ShopFacadeBlacksmith },
  { id: 'magic', label: 'Magic shop', texture: TextureKey.ShopFacadeMagic },
  { id: 'farm', label: 'Farm shop', texture: TextureKey.ShopFacadeFarm },
  { id: 'church', label: 'Church', texture: TextureKey.ShopFacadeChurch },
  { id: 'library', label: 'Library', texture: TextureKey.ShopFacadeLibrary },
  { id: 'tailor', label: 'Tailor', texture: TextureKey.ShopFacadeTailor },
  { id: 'alchemist', label: 'Alchemist', texture: TextureKey.ShopFacadeAlchemist },
] as const;

export type ShopFacadeId = typeof SHOP_FACADES[number]['id'];

/** Resolve a known cosmetic choice; unknown persisted values must not silently become Original. */
export function shopFacade(value: unknown): typeof SHOP_FACADES[number] {
  const entry = SHOP_FACADES.find(candidate => candidate.id === value);
  if (!entry) throw new Error(`Unknown shop facade: ${String(value)}`);
  return entry;
}
