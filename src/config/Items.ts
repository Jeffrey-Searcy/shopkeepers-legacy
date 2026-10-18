/**
 * Items — the catalog of tools, resources, seeds, and resource-node definitions for V1.
 *
 * Central definitions so systems (ToolSystem, Inventory, Crop, Interaction) and UI reference the
 * same ids and metadata. Kept data-only (no behavior) so it's trivially serializable and testable.
 * Crop growth data lives in src/config/Crops.ts; this file owns item ids, values, and node combat.
 */
import { FURNITURE } from './Furniture';

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
export type ItemCategory = 'Resource' | 'Crop' | 'Seed' | 'Placeable' | 'Fish' | 'Dungeon Loot' | 'Food & Drink' | 'Tool';

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
  stew: { label: 'Stew', icon: 'icon-stew', category: 'Food & Drink', description: 'A warm bowl from your kitchen. Serve it to a guest, or eat it yourself to feel Well Fed.' },
  ale: { label: 'House Ale', icon: 'icon-ale', category: 'Food & Drink', description: 'A foamy mug of house ale. Serve it, or drink one for Cheer. Too many rounds make guests tipsy.' },
  broom: { label: 'Broom', icon: 'icon-broom', category: 'Tool', description: 'Equip and use beside a drunk guest to usher them out. Ordinary guests are left alone.' },
  'oak-seed': { label: 'Acorn', icon: 'icon-oak-seed', category: 'Seed', description: 'Plant on clear grass at home to grow an oak tree.' },
  'pine-seed': { label: 'Pine Cone', icon: 'icon-pine-seed', category: 'Seed', description: 'Plant on clear grass at home to grow a pine tree.' },
  wood: { label: 'Wood', icon: 'icon-wood', category: 'Resource', description: 'Sturdy timber for crafting and building.' },
  stone: { label: 'Stone', icon: 'icon-stone', category: 'Resource', description: 'A dependable crafting material from farm rocks.' },
  fiber: { label: 'Fiber', icon: 'icon-fiber', category: 'Resource', description: 'Soft plant fiber cut from wild weeds.' },
  parsnip: { label: 'Parsnip', icon: 'icon-parsnip', category: 'Crop', description: 'A crisp spring root crop ready to ship or save.' },
  potato: { label: 'Potato', icon: 'icon-potato', category: 'Crop', description: 'A hearty spring crop with a good sale price.' },
  melon: { label: 'Melon', icon: 'icon-melon', category: 'Crop', description: 'A valuable summer fruit. Eating one puts a spring in your step.' },
  'parsnip-seeds': { label: 'Parsnip Seeds', icon: 'icon-parsnip-seeds', category: 'Seed', description: 'Plant in spring. Grows quickly.' },
  'potato-seeds': { label: 'Potato Seeds', icon: 'icon-potato-seeds', category: 'Seed', description: 'Plant in spring. Takes a little longer to mature.' },
  'melon-seeds': { label: 'Melon Seeds', icon: 'icon-melon-seeds', category: 'Seed', description: 'Plant in summer. Slow-growing but valuable.' },
  chest: { label: 'Chest', icon: 'chest', category: 'Placeable', description: 'Place it to store gathered goods.' },
  workbench: { label: 'Workbench', icon: 'workbench', category: 'Placeable', description: 'A two-tile crafting bench. Place it to build shop stations and furniture.' },
  table: { label: 'Table', icon: 'furniture-table-horizontal', category: 'Placeable', description: 'Indoors only. Joins nearby tables. Face chairs toward its outside edge for dining.' },
  chair: { label: 'Chair', icon: 'furniture-chair-south', category: 'Placeable', description: 'Indoors only. Press R to face it toward a table. Leave a clear path for guests.' },
  rug: { label: 'Rug', icon: 'furniture-rug', category: 'Placeable', description: 'Indoors only. A woven rug that joins nearby rugs; place furniture on top.' },
  bar: { label: 'Bar Counter', icon: 'furniture-bar-horizontal', category: 'Placeable', description: 'Serve meals and collect payment from the keeper side. Leave paths clear on both sides.' },
  register: { label: 'Register Stand', icon: 'furniture-register', category: 'Placeable', description: 'Indoors only. Manage the inn and tavern separately, and check guests into rooms.' },
  stove: { label: 'Cooking Stove', icon: 'furniture-stove', category: 'Placeable', description: 'Indoors only. Cook harvests into stew or brew small batches of ale for your shop.' },
  'fish-sardine': { label: 'Sardine', icon: 'icon-fish-sardine', category: 'Fish', description: 'A small silver fish from local waters.' },
  'fish-bass': { label: 'Bass', icon: 'icon-fish-bass', category: 'Fish', description: 'A lively catch with a respectable sale price.' },
  'fish-carp': { label: 'Carp', icon: 'icon-fish-carp', category: 'Fish', description: 'A common pond fish with a calm temperament.' },
  'slime-gel': { label: 'Slime Gel', icon: 'icon-slime-gel', category: 'Dungeon Loot', description: 'Shimmering gel recovered from a defeated slime.' },
  'bat-wing': { label: 'Bat Wing', icon: 'icon-bat-wing', category: 'Dungeon Loot', description: 'A leathery wing gathered in the mines.' },
  // Week-one content (appended so older catalog-order tests and bag layouts keep their positions).
  'fish-trout': { label: 'Trout', icon: 'icon-fish-trout', category: 'Fish', description: 'A speckled river fish from the forest pond. Quick and strong.' },
  'fish-pike': { label: 'Pike', icon: 'icon-fish-pike', category: 'Fish', description: 'A toothy forest-pond hunter. Hard to land, worth the fight.' },
  'fish-eel': { label: 'Eel', icon: 'icon-fish-eel', category: 'Fish', description: 'A slippery fish from the beach shallows.' },
  cabbage: { label: 'Cabbage', icon: 'icon-cabbage', category: 'Crop', description: 'A crunchy spring head. Two make a garden stew.' },
  'cabbage-seeds': { label: 'Cabbage Seeds', icon: 'icon-cabbage-seeds', category: 'Seed', description: 'Plant in spring. Steady growth.' },
  strawberry: { label: 'Strawberry', icon: 'icon-strawberry', category: 'Crop', description: 'A sweet spring berry that sells well. Eating one quickens your step.' },
  'strawberry-seeds': { label: 'Strawberry Seeds', icon: 'icon-strawberry-seeds', category: 'Seed', description: 'Plant in spring. Slow but sweet.' },
  tomato: { label: 'Tomato', icon: 'icon-tomato', category: 'Crop', description: 'A sun-ripened summer fruit.' },
  'tomato-seeds': { label: 'Tomato Seeds', icon: 'icon-tomato-seeds', category: 'Seed', description: 'Plant in summer.' },
  mushroom: { label: 'Forest Mushroom', icon: 'icon-mushroom', category: 'Crop', description: 'Picked wild in the forest. Two make a forest stew.' },
  'wild-leek': { label: 'Wild Leek', icon: 'icon-wild-leek', category: 'Crop', description: 'A wild spring onion found along farm and forest paths.' },
  seashell: { label: 'Seashell', icon: 'icon-seashell', category: 'Resource', description: 'A pretty shell from the beach. Collectors like these.' },
  'portal-shard': { label: 'Portal Shard', icon: 'icon-portal-shard', category: 'Dungeon Loot', description: 'A humming crystal chip from beyond the north gate. The forge can use these.' },
  'warden-core': { label: 'Warden Core', icon: 'icon-warden-core', category: 'Dungeon Loot', description: 'The glowing heart of the gate warden. The forge wants it badly.' },
  'healing-potion': { label: 'Healing Potion', icon: 'icon-healing-potion', category: 'Food & Drink', description: 'Equip and use to restore 4 HP. Brewed at the alchemy house.' },
};

/** Stable catalog order used by every inventory-like surface. */
export const ITEM_ORDER: readonly string[] = Object.freeze(Object.keys(ITEM_CATALOG));

/** Inventory items whose contextual action begins world placement. */
export const PLACEABLE_ITEMS: ReadonlySet<string> = new Set(Object.keys(FURNITURE));

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
  'fish-trout': 60,
  'fish-pike': 85,
  'fish-eel': 70,
  cabbage: 70,
  'cabbage-seeds': 20,
  strawberry: 120,
  'strawberry-seeds': 40,
  tomato: 60,
  'tomato-seeds': 25,
  mushroom: 30,
  'wild-leek': 25,
  seashell: 20,
  'portal-shard': 40,
  'warden-core': 200,
  'healing-potion': 30,
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
