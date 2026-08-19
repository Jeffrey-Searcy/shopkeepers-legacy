/**
 * Items — the catalog of tools, resources, seeds, and resource-node definitions for V1.
 *
 * Central definitions so systems (ToolSystem, Inventory, Crop, Interaction) and UI reference the
 * same ids and metadata. Kept data-only (no behavior) so it's trivially serializable and testable.
 * Crop growth data lives in src/config/Crops.ts; this file owns item ids, values, and node combat.
 */

/** Tools the player wields from the hotbar. */
export enum ToolId {
  Hoe = 'hoe',
  Axe = 'axe',
  Pickaxe = 'pickaxe',
  Scythe = 'scythe',
  WateringCan = 'watering-can',
  Seeds = 'seeds',
  Rod = 'rod',
  Sword = 'sword',
}

/** Resource item ids gathered into the inventory. */
export enum ItemId {
  Wood = 'wood',
  Stone = 'stone',
  Fiber = 'fiber',
  Parsnip = 'parsnip',
  ParsnipSeeds = 'parsnip-seeds',
  Potato = 'potato',
  PotatoSeeds = 'potato-seeds',
  Melon = 'melon',
  MelonSeeds = 'melon-seeds',
}

/** The fixed hotbar layout for V1 (slot order 0..N). Numbers 1..N select these. */
export const HOTBAR: ToolId[] = [
  ToolId.Hoe,
  ToolId.Axe,
  ToolId.Pickaxe,
  ToolId.Scythe,
  ToolId.WateringCan,
  ToolId.Seeds,
  ToolId.Rod,
  ToolId.Sword,
];

/** Inventory presentation categories. These are derived display data, never persisted state. */
export type ItemCategory = 'Resource' | 'Crop' | 'Seed' | 'Placeable' | 'Fish' | 'Dungeon Loot';

/**
 * Display-only item metadata shared by the bag, chest, shipping bin, and item-detail card.
 * Keeping it beside the item catalog prevents each UI surface from drifting into a different
 * label/icon/order and makes every obtainable id explicit instead of silently truncating it.
 */
export interface ItemDisplayDef {
  label: string;
  icon: string;
  category: ItemCategory;
  description: string;
}

/** Every currently obtainable non-tool item, in stable backpack display order. */
export const ITEM_CATALOG: Readonly<Record<string, ItemDisplayDef>> = {
  wood: { label: 'Wood', icon: 'icon-wood', category: 'Resource', description: 'Sturdy timber for crafting and building.' },
  stone: { label: 'Stone', icon: 'icon-stone', category: 'Resource', description: 'A dependable crafting material from farm rocks.' },
  fiber: { label: 'Fiber', icon: 'icon-fiber', category: 'Resource', description: 'Soft plant fiber cut from wild weeds.' },
  parsnip: { label: 'Parsnip', icon: 'icon-parsnip', category: 'Crop', description: 'A crisp spring root crop ready to ship or save.' },
  potato: { label: 'Potato', icon: 'icon-potato', category: 'Crop', description: 'A hearty spring crop with a good sale price.' },
  melon: { label: 'Melon', icon: 'icon-melon', category: 'Crop', description: 'A valuable summer fruit with a sweet harvest.' },
  'parsnip-seeds': { label: 'Parsnip Seeds', icon: 'icon-parsnip-seeds', category: 'Seed', description: 'Plant in spring. Grows quickly.' },
  'potato-seeds': { label: 'Potato Seeds', icon: 'icon-potato-seeds', category: 'Seed', description: 'Plant in spring. Takes a little longer to mature.' },
  'melon-seeds': { label: 'Melon Seeds', icon: 'icon-melon-seeds', category: 'Seed', description: 'Plant in summer. Slow-growing but valuable.' },
  chest: { label: 'Chest', icon: 'chest', category: 'Placeable', description: 'Place it outside to store gathered goods.' },
  workbench: { label: 'Workbench', icon: 'workbench', category: 'Placeable', description: 'Place it to unlock advanced crafting recipes.' },
  table: { label: 'Table', icon: 'furniture-table', category: 'Placeable', description: 'A cozy wooden table for home or shop.' },
  chair: { label: 'Chair', icon: 'furniture-chair', category: 'Placeable', description: 'A simple seat that makes a room feel lived in.' },
  rug: { label: 'Rug', icon: 'rug', category: 'Placeable', description: 'A soft woven rug; furniture can stand on top.' },
  'fish-sardine': { label: 'Sardine', icon: 'icon-fish-sardine', category: 'Fish', description: 'A small silver fish from local waters.' },
  'fish-bass': { label: 'Bass', icon: 'icon-fish-bass', category: 'Fish', description: 'A lively catch with a respectable sale price.' },
  'fish-carp': { label: 'Carp', icon: 'icon-fish-carp', category: 'Fish', description: 'A common pond fish with a calm temperament.' },
  'slime-gel': { label: 'Slime Gel', icon: 'icon-slime-gel', category: 'Dungeon Loot', description: 'Shimmering gel recovered from a defeated slime.' },
  'bat-wing': { label: 'Bat Wing', icon: 'icon-bat-wing', category: 'Dungeon Loot', description: 'A leathery wing gathered in the mines.' },
};

/** Stable catalog order used by every inventory-like surface. */
export const ITEM_ORDER: readonly string[] = Object.freeze(Object.keys(ITEM_CATALOG));

/** Inventory items whose contextual action begins world placement. */
export const PLACEABLE_ITEMS: ReadonlySet<string> = new Set(['chest', 'workbench', 'table', 'chair', 'rug']);

/** Short tool labels used by the HUD when an icon cannot be constructed. */
export const TOOL_LABEL: Readonly<Record<ToolId, string>> = {
  [ToolId.Hoe]: 'Hoe',
  [ToolId.Axe]: 'Axe',
  [ToolId.Pickaxe]: 'Pickaxe',
  [ToolId.Scythe]: 'Scythe',
  [ToolId.WateringCan]: 'Watering Can',
  [ToolId.Seeds]: 'Seeds',
  [ToolId.Rod]: 'Fishing Rod',
  [ToolId.Sword]: 'Sword',
};

/** Sell values (gold) for the shipping bin. Unlisted items can't be shipped. */
export const ITEM_VALUES: Record<string, number> = {
  wood: 2,
  stone: 2,
  fiber: 1,
  parsnip: 35,
  potato: 80,
  melon: 250,
  'parsnip-seeds': 10,
  'potato-seeds': 25,
  'melon-seeds': 40,
  'fish-sardine': 40,
  'fish-bass': 45,
  'fish-carp': 30,
  // Dungeon loot (Moonlighter loop: fight -> loot -> ship/sell).
  'slime-gel': 15,
  'bat-wing': 22,
};

/** Tree growth stages (a map tree defaults to 'full'; overrides live in GameState.treeStages). */
export type TreeStage = 'sapling' | 'small' | 'full';

/**
 * Per-node-kind (and per-tree-stage) combat + drop + art data. Keys: 'tree:<stage>', 'stump',
 * 'rock', 'weed'. `hp` = tool hits to clear; `amount` = units of `drop` spawned on the final hit.
 * `dw`/`dh` = on-screen display size in px (config drives size, never art dimensions — CLAUDE.md
 * Hard Rule 4); omitted = draw the art at its native size (the legacy full tree/rock/weed art is
 * already scene-scaled).
 */
export interface NodeDef {
  hp: number;
  drop: ItemId;
  amount: number;
  tex: string;
  dw?: number;
  dh?: number;
}
export const NODE_DEF: Record<string, NodeDef> = {
  // Staged trees: fuller trees take more chops and pay more wood. Felling a FULL tree leaves a
  // stump behind (extra wood if the player clears it too) — see BaseWorldScene.removeNodeAt.
  'tree:sapling': { hp: 1, drop: ItemId.Wood, amount: 0, tex: 'tree-sapling', dw: 14, dh: 22 },
  'tree:small': { hp: 2, drop: ItemId.Wood, amount: 2, tex: 'tree-small', dw: 24, dh: 36 },
  'tree:full': { hp: 3, drop: ItemId.Wood, amount: 5, tex: 'tree' },
  stump: { hp: 2, drop: ItemId.Wood, amount: 2, tex: 'tree-stump', dw: 16, dh: 16 },
  rock: { hp: 2, drop: ItemId.Stone, amount: 1, tex: 'rock' },
  weed: { hp: 1, drop: ItemId.Fiber, amount: 1, tex: 'weed' },
};

/** Which node kinds each destructive tool acts on (the axe handles both trees and stumps). */
export const TOOL_NODE_KINDS: Partial<Record<ToolId, ReadonlySet<string>>> = {
  [ToolId.Axe]: new Set(['tree', 'stump']),
  [ToolId.Pickaxe]: new Set(['rock']),
  [ToolId.Scythe]: new Set(['weed']),
};

/** Days a staged tree needs to advance one growth stage (sapling -> small -> full). */
export const TREE_STAGE_DAYS = 2;
/** Days after clearing a tree spot before a fresh sapling sprouts there. */
export const TREE_REGROW_DAYS = 3;
