/**
 * Building-fit public services for the eleven non-Market interiors. Durable progression stays elsewhere.
 *
 * Most options are fixed offers. Four kinds are "live": their label and cost come from progress at
 * the moment the menu draws (CivicServiceSystem.optionText):
 *  - 'forge-upgrade'   Rhea tempers the sword one level (config/Upgrades.ts FORGE_UPGRADES);
 *  - 'alchemy-upgrade' Cael brews a Vital Draught, +max HP (ALCHEMY_UPGRADES);
 *  - 'brew-potion'     Cael brews one healing potion from POTION_RECIPE;
 *  - 'guild-board'     Seren's current two-day job (GuildBoardSystem).
 */
import type { ExpandedCivicId } from './CivicInteriors';

export type CivicServiceAction =
  | { kind: 'info'; lines: readonly string[] }
  | { kind: 'buy'; item: string; gold: number }
  | { kind: 'exchange'; item: string; itemQuantity: number; gold: number }
  | { kind: 'restore'; gold: number }
  | { kind: 'tonic'; item: string; hp: number; stamina: number }
  | { kind: 'wardrobe' }
  | { kind: 'forge-upgrade' }
  | { kind: 'alchemy-upgrade' }
  | { kind: 'brew-potion' }
  | { kind: 'guild-board' };

export interface CivicServiceOption {
  id: string;
  label: string;
  detail: string;
  icon: string;
  supportsBatch: boolean;
  action: CivicServiceAction;
}

export interface CivicServiceDefinition {
  title: string;
  description: string;
  options: readonly CivicServiceOption[];
}

/** The guild board previews the future portal route through real, resource-backed contracts. */
export const CIVIC_SERVICES: Readonly<Record<ExpandedCivicId, CivicServiceDefinition>> = {
  magic: { title: 'Moonwell Sanctuary', description: 'Nyra reads the day’s current at the shrine. No counter. No charge.', options: [
    { id: 'fortune', label: 'Read the moonwell', detail: 'A free daily arcane reading', icon: 'icon-slime-gel', supportsBatch: false,
      action: { kind: 'info', lines: ['The current favors patient work and doors left open.', 'A bright thread crosses the western path today.', 'The moonwell is quiet. Small promises will matter most.'] } },
  ] },
  forge: { title: 'Rhea’s Anvil Orders', description: 'Bring stone to the hot work bay. Rhea pays for clean refining bundles, and tempers blades with gate shards.', options: [
    { id: 'temper-sword', label: 'Temper your sword', detail: 'Live forge level', icon: 'icon-portal-shard', supportsBatch: false,
      action: { kind: 'forge-upgrade' } },
    { id: 'stone-bundle', label: 'Refining bundle', detail: 'Give 5 stone · receive 18g', icon: 'icon-stone', supportsBatch: true,
      action: { kind: 'exchange', item: 'stone', itemQuantity: 5, gold: 18 } },
  ] },
  museum: { title: 'Elowen’s Research Desk', description: 'Contribute unusual finds at the exhibit plinth.', options: [
    { id: 'slime-study', label: 'Slime gel study', detail: 'Give 1 gel · receive 25g grant', icon: 'icon-slime-gel', supportsBatch: true,
      action: { kind: 'exchange', item: 'slime-gel', itemQuantity: 1, gold: 25 } },
    { id: 'wing-study', label: 'Nightwing study', detail: 'Give 1 bat wing · receive 35g grant', icon: 'icon-bat-wing', supportsBatch: true,
      action: { kind: 'exchange', item: 'bat-wing', itemQuantity: 1, gold: 35 } },
  ] },
  clinic: { title: 'Sylvie’s Garden Clinic', description: 'Rest beside the treatment cot while Sylvie tends every scrape.', options: [
    { id: 'treatment', label: 'Full treatment', detail: 'Restore health and stamina · 75g', icon: 'icon-stew', supportsBatch: false,
      action: { kind: 'restore', gold: 75 } },
  ] },
  guild: { title: 'Safe Haven Quest Board', description: 'Seren posts contracts preparing the northern portal trail and the dungeons beyond it. Her pinned job changes every two days.', options: [
    { id: 'board-job', label: 'Seren’s pinned job', detail: 'Live board job', icon: 'icon-stone', supportsBatch: false,
      action: { kind: 'guild-board' } },
    { id: 'portal-trail', label: 'Portal Trail Survey', detail: 'Give 10 stone · receive 100g', icon: 'icon-stone', supportsBatch: false,
      action: { kind: 'exchange', item: 'stone', itemQuantity: 10, gold: 100 } },
    { id: 'cave-sample', label: 'Cave Sample', detail: 'Give 2 slime gel · receive 80g', icon: 'icon-slime-gel', supportsBatch: false,
      action: { kind: 'exchange', item: 'slime-gel', itemQuantity: 2, gold: 80 } },
    { id: 'nightwing', label: 'Nightwing Survey', detail: 'Give 1 bat wing · receive 65g', icon: 'icon-bat-wing', supportsBatch: false,
      action: { kind: 'exchange', item: 'bat-wing', itemQuantity: 1, gold: 65 } },
  ] },
  ranch: { title: 'Rowan’s Seed Ledger', description: 'Tree stock from the ranch nursery. Plant these at the farm.', options: [
    { id: 'oak-seed', label: 'Acorn', detail: '30g each', icon: 'icon-oak-seed', supportsBatch: true,
      action: { kind: 'buy', item: 'oak-seed', gold: 30 } },
    { id: 'pine-seed', label: 'Pine Cone', detail: '30g each', icon: 'icon-pine-seed', supportsBatch: true,
      action: { kind: 'buy', item: 'pine-seed', gold: 30 } },
  ] },
  bar: { title: 'The Wayfarer Bar', description: 'Julian serves simple food and drink at the public bar.', options: [
    { id: 'stew', label: 'Wayfarer Stew', detail: '70g each', icon: 'icon-stew', supportsBatch: true,
      action: { kind: 'buy', item: 'stew', gold: 70 } },
    { id: 'ale', label: 'House Ale', detail: '55g each', icon: 'icon-ale', supportsBatch: true,
      action: { kind: 'buy', item: 'ale', gold: 55 } },
  ] },
  carpenter: { title: 'Bram’s Order Book', description: 'Order sturdy furnishings at the workbench.', options: [
    { id: 'table', label: 'Table', detail: '120g each', icon: 'furniture-table-horizontal', supportsBatch: true,
      action: { kind: 'buy', item: 'table', gold: 120 } },
    { id: 'chair', label: 'Chair', detail: '60g each', icon: 'furniture-chair-south', supportsBatch: true,
      action: { kind: 'buy', item: 'chair', gold: 60 } },
    { id: 'rug', label: 'Rug', detail: '90g each', icon: 'furniture-rug', supportsBatch: true,
      action: { kind: 'buy', item: 'rug', gold: 90 } },
    { id: 'workbench', label: 'Workbench', detail: '180g each', icon: 'workbench', supportsBatch: true,
      action: { kind: 'buy', item: 'workbench', gold: 180 } },
  ] },
  fishing: { title: 'Kit’s Tackle Scale', description: 'Kit pays a little extra for a catch brought directly to the tackle house.', options: [
    { id: 'sardine', label: 'Sell Sardine', detail: 'Receive 50g each', icon: 'icon-fish-sardine', supportsBatch: true,
      action: { kind: 'exchange', item: 'fish-sardine', itemQuantity: 1, gold: 50 } },
    { id: 'bass', label: 'Sell Bass', detail: 'Receive 55g each', icon: 'icon-fish-bass', supportsBatch: true,
      action: { kind: 'exchange', item: 'fish-bass', itemQuantity: 1, gold: 55 } },
    { id: 'carp', label: 'Sell Carp', detail: 'Receive 40g each', icon: 'icon-fish-carp', supportsBatch: true,
      action: { kind: 'exchange', item: 'fish-carp', itemQuantity: 1, gold: 40 } },
  ] },
  alchemy: { title: 'Cael’s Brew Table', description: 'Turn slime gel into a quick field tonic, brew healing potions, or drink a Vital Draught made with gate shards.', options: [
    { id: 'field-tonic', label: 'Brew Field Tonic', detail: 'Give 1 gel · restore 3 health and 35 stamina', icon: 'icon-slime-gel', supportsBatch: false,
      action: { kind: 'tonic', item: 'slime-gel', hp: 3, stamina: 35 } },
    { id: 'healing-potion', label: 'Brew Healing Potion', detail: 'Live potion recipe', icon: 'icon-healing-potion', supportsBatch: false,
      action: { kind: 'brew-potion' } },
    { id: 'vital-draught', label: 'Vital Draught', detail: 'Live alchemy level', icon: 'icon-warden-core', supportsBatch: false,
      action: { kind: 'alchemy-upgrade' } },
  ] },
  tailor: { title: 'Dorian’s Fitting Mirror', description: 'Try your full wardrobe beside the fabric table.', options: [
    { id: 'wardrobe', label: 'Begin fitting', detail: 'Open the existing character editor · free', icon: 'furniture-chair-south', supportsBatch: false,
      action: { kind: 'wardrobe' } },
  ] },
};

/** Resolve one complete service definition or fail on an authoring mismatch. */
export function civicServiceDefinition(id: ExpandedCivicId): CivicServiceDefinition {
  const service = CIVIC_SERVICES[id];
  if (!service) throw new Error(`Civic services: missing definition for ${id}`);
  return service;
}
