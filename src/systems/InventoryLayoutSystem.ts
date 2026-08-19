/**
 * InventoryLayoutSystem — authoritative player slot locations and atomic inventory mutations.
 *
 * `GameState.inventory` remains the only quantity store. The eight toolbelt slots and twenty-four
 * backpack slots store only unique entry ids: ordinary item ids or `tool:<ToolId>` for physical
 * tools. Every mutation is planned against copies and committed only after capacity and invariant
 * checks pass, so a failed drop/withdraw cannot partially move counts or lose a source stack.
 */
import { cropForSeed } from '../config/Crops';
import { ItemId, ToolId } from '../config/Items';

export const TOOLBELT_CAPACITY = 8;
export const BACKPACK_CAPACITY = 24;
export const TOOL_ENTRY_PREFIX = 'tool:';

/** Physical containers that can own a player entry. */
export type PlayerSlotContainer = 'toolbelt' | 'backpack';
/** A tool entry, ordinary item id, or an empty slot. Quantities never live here. */
export type PlayerSlotEntry = string | null;

/** Stable address used by drag/drop and tests. */
export interface PlayerSlotRef {
  container: PlayerSlotContainer;
  index: number;
}

/** Minimal state surface required by this system; deliberately independent of Phaser/GameState. */
export interface InventoryLayoutState {
  inventory: Record<string, number>;
  toolbeltSlots: PlayerSlotEntry[];
  backpackSlots: PlayerSlotEntry[];
  hotbarIndex: number;
  selectedSeed: string;
}

/** Result of a valid slot gesture. */
export type SlotMoveResult = 'moved' | 'swapped' | 'noop';

/** Seeds are item stacks, not physical tools; every other ToolId has one unique entry. */
export const PHYSICAL_TOOLS: readonly ToolId[] = Object.freeze([
  ToolId.Hoe,
  ToolId.Axe,
  ToolId.Pickaxe,
  ToolId.Scythe,
  ToolId.WateringCan,
  ToolId.Rod,
  ToolId.Sword,
]);

/** Encode a physical tool for storage in a slot array. */
export function toolEntry(tool: Exclude<ToolId, ToolId.Seeds>): string {
  return `${TOOL_ENTRY_PREFIX}${tool}`;
}

/** Decode a physical-tool entry; ordinary item ids return null and malformed tool ids throw. */
export function toolFromEntry(entry: PlayerSlotEntry): ToolId | null {
  if (!entry || !entry.startsWith(TOOL_ENTRY_PREFIX)) return null;
  const id = entry.slice(TOOL_ENTRY_PREFIX.length) as ToolId;
  if (id === ToolId.Seeds || !PHYSICAL_TOOLS.includes(id)) {
    throw new Error(`InventoryLayoutSystem: invalid physical tool entry "${entry}"`);
  }
  return id;
}

/** Fresh-game toolbelt: seven physical tools plus the player's actual parsnip seed stack. */
export function createDefaultToolbelt(): PlayerSlotEntry[] {
  return [
    toolEntry(ToolId.Hoe),
    toolEntry(ToolId.Axe),
    toolEntry(ToolId.Pickaxe),
    toolEntry(ToolId.Scythe),
    toolEntry(ToolId.WateringCan),
    ItemId.ParsnipSeeds,
    toolEntry(ToolId.Rod),
    toolEntry(ToolId.Sword),
  ];
}

/** Fresh-game backpack is empty; new stacks are allocated row-major from index zero. */
export function createEmptyBackpack(): PlayerSlotEntry[] {
  return Array.from({ length: BACKPACK_CAPACITY }, () => null);
}

/** Return the addressed backing array after validating the fixed container shape and index. */
function slotsFor(state: InventoryLayoutState, ref: PlayerSlotRef): PlayerSlotEntry[] {
  const slots = ref.container === 'toolbelt' ? state.toolbeltSlots : state.backpackSlots;
  const expected = ref.container === 'toolbelt' ? TOOLBELT_CAPACITY : BACKPACK_CAPACITY;
  if (slots.length !== expected) {
    throw new Error(`InventoryLayoutSystem: ${ref.container} has ${slots.length} slots; expected ${expected}`);
  }
  if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= expected) {
    throw new Error(`InventoryLayoutSystem: invalid ${ref.container} slot index ${ref.index}`);
  }
  return slots;
}

/** Ordinary item ids are every non-null entry without the reserved tool prefix. */
export function itemFromEntry(entry: PlayerSlotEntry): string | null {
  if (!entry || entry.startsWith(TOOL_ENTRY_PREFIX)) return null;
  return entry;
}

/** Active seed item at the selected toolbelt index, or null when that slot is not a seed stack. */
export function activeSeedEntry(state: InventoryLayoutState): string | null {
  if (!Number.isInteger(state.hotbarIndex) || state.hotbarIndex < 0 || state.hotbarIndex >= TOOLBELT_CAPACITY) {
    throw new Error(`InventoryLayoutSystem: invalid hotbarIndex ${state.hotbarIndex}`);
  }
  const item = itemFromEntry(state.toolbeltSlots[state.hotbarIndex]);
  return item && cropForSeed(item) ? item : null;
}

/** Active gameplay tool derived only from the selected slot; passive/empty entries return null. */
export function activeToolEntry(state: InventoryLayoutState): ToolId | null {
  const entry = state.toolbeltSlots[state.hotbarIndex];
  const tool = toolFromEntry(entry);
  if (tool) return tool;
  return activeSeedEntry(state) ? ToolId.Seeds : null;
}

/** Keep the compatibility selectedSeed field aligned when the active slot contains seed items. */
export function syncSelectedSeed(state: InventoryLayoutState): void {
  const seed = activeSeedEntry(state);
  if (seed) state.selectedSeed = seed;
}

/** Find the unique player slot that owns an entry, or null when it is not materialized. */
export function findEntrySlot(state: InventoryLayoutState, entry: string): PlayerSlotRef | null {
  const toolbeltIndex = state.toolbeltSlots.indexOf(entry);
  if (toolbeltIndex >= 0) return { container: 'toolbelt', index: toolbeltIndex };
  const backpackIndex = state.backpackSlots.indexOf(entry);
  return backpackIndex >= 0 ? { container: 'backpack', index: backpackIndex } : null;
}

/**
 * Assert the complete location/quantity contract. This never repairs: callers must use an explicit
 * mutator so reads cannot hide stale or duplicated state.
 */
export function assertInventoryLayout(state: InventoryLayoutState): void {
  if (state.toolbeltSlots.length !== TOOLBELT_CAPACITY) {
    throw new Error(`InventoryLayoutSystem: toolbelt requires ${TOOLBELT_CAPACITY} slots`);
  }
  if (state.backpackSlots.length !== BACKPACK_CAPACITY) {
    throw new Error(`InventoryLayoutSystem: backpack requires ${BACKPACK_CAPACITY} slots`);
  }
  if (!Number.isInteger(state.hotbarIndex) || state.hotbarIndex < 0 || state.hotbarIndex >= TOOLBELT_CAPACITY) {
    throw new Error(`InventoryLayoutSystem: hotbarIndex ${state.hotbarIndex} is out of range`);
  }

  const entries = [...state.toolbeltSlots, ...state.backpackSlots].filter(
    (entry): entry is string => entry !== null
  );
  const unique = new Set<string>();
  for (const entry of entries) {
    if (!entry.trim()) throw new Error('InventoryLayoutSystem: slot entries cannot be empty strings');
    if (unique.has(entry)) throw new Error(`InventoryLayoutSystem: duplicate slot entry "${entry}"`);
    unique.add(entry);
    const tool = toolFromEntry(entry);
    if (!tool) {
      const count = state.inventory[entry];
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`InventoryLayoutSystem: item slot "${entry}" requires a positive integer count`);
      }
    }
  }

  for (const tool of PHYSICAL_TOOLS) {
    const entry = toolEntry(tool as Exclude<ToolId, ToolId.Seeds>);
    if (!unique.has(entry)) throw new Error(`InventoryLayoutSystem: missing physical tool "${tool}"`);
  }
  for (const [item, count] of Object.entries(state.inventory)) {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`InventoryLayoutSystem: inventory "${item}" has invalid count ${count}`);
    }
    if (!unique.has(item)) throw new Error(`InventoryLayoutSystem: positive stack "${item}" has no player slot`);
  }
}

/** Candidate state used to make multi-item updates atomic. */
interface InventoryCandidate {
  inventory: Record<string, number>;
  toolbeltSlots: PlayerSlotEntry[];
  backpackSlots: PlayerSlotEntry[];
}

/** Build an inventory candidate, returning null for insufficient quantity or backpack capacity. */
function buildCandidate(state: InventoryLayoutState, deltas: Readonly<Record<string, number>>): InventoryCandidate | null {
  assertInventoryLayout(state);
  const inventory = { ...state.inventory };
  for (const [item, delta] of Object.entries(deltas)) {
    if (!item || !Number.isInteger(delta)) {
      throw new Error(`InventoryLayoutSystem: invalid inventory delta ${item}=${delta}`);
    }
    if (delta === 0) continue;
    const next = (inventory[item] ?? 0) + delta;
    if (next < 0) return null;
    if (next === 0) delete inventory[item];
    else inventory[item] = next;
  }

  const toolbeltSlots = [...state.toolbeltSlots];
  const backpackSlots = [...state.backpackSlots];
  for (const slots of [toolbeltSlots, backpackSlots]) {
    for (let index = 0; index < slots.length; index++) {
      const item = itemFromEntry(slots[index]);
      if (item && !inventory[item]) slots[index] = null;
    }
  }

  const located = new Set(
    [...toolbeltSlots, ...backpackSlots]
      .map(itemFromEntry)
      .filter((item): item is string => item !== null)
  );
  for (const item of Object.keys(inventory)) {
    if (located.has(item)) continue;
    const emptyIndex = backpackSlots.indexOf(null);
    if (emptyIndex < 0) return null;
    backpackSlots[emptyIndex] = item;
    located.add(item);
  }
  return { inventory, toolbeltSlots, backpackSlots };
}

/** Apply a multi-item quantity delta atomically; false means insufficient quantity or no slot. */
export function applyInventoryDelta(
  state: InventoryLayoutState,
  deltas: Readonly<Record<string, number>>
): boolean {
  const candidate = buildCandidate(state, deltas);
  if (!candidate) return false;
  state.inventory = candidate.inventory;
  state.toolbeltSlots = candidate.toolbeltSlots;
  state.backpackSlots = candidate.backpackSlots;
  syncSelectedSeed(state);
  assertInventoryLayout(state);
  return true;
}

/** Move/swap a whole slot entry. Same-source and empty-source gestures are explicit no-ops. */
export function moveOrSwap(
  state: InventoryLayoutState,
  source: PlayerSlotRef,
  destination: PlayerSlotRef
): SlotMoveResult {
  assertInventoryLayout(state);
  const sourceSlots = slotsFor(state, source);
  const destinationSlots = slotsFor(state, destination);
  if (source.container === destination.container && source.index === destination.index) return 'noop';
  const sourceEntry = sourceSlots[source.index];
  if (!sourceEntry) return 'noop';
  const destinationEntry = destinationSlots[destination.index];
  sourceSlots[source.index] = destinationEntry;
  destinationSlots[destination.index] = sourceEntry;
  syncSelectedSeed(state);
  assertInventoryLayout(state);
  return destinationEntry ? 'swapped' : 'moved';
}

/** Move a player stack into an external count store; clearing its final unit clears its slot. */
export function transferFromPlayer(
  state: InventoryLayoutState,
  destination: Record<string, number>,
  item: string,
  requested: number
): number {
  if (!Number.isFinite(requested) || requested < 0) {
    throw new Error(`InventoryLayoutSystem: invalid transfer amount ${requested}`);
  }
  const amount = Math.min(state.inventory[item] ?? 0, Math.floor(requested));
  if (amount <= 0) return 0;
  if (!applyInventoryDelta(state, { [item]: -amount })) {
    throw new Error(`InventoryLayoutSystem: failed to remove available stack "${item}"`);
  }
  destination[item] = (destination[item] ?? 0) + amount;
  return amount;
}

/**
 * Move an external stack into the player. Capacity is checked and the player candidate commits
 * before the source store changes, so a full backpack returns zero with the source untouched.
 */
export function transferToPlayer(
  state: InventoryLayoutState,
  source: Record<string, number>,
  item: string,
  requested: number
): number {
  if (!Number.isFinite(requested) || requested < 0) {
    throw new Error(`InventoryLayoutSystem: invalid transfer amount ${requested}`);
  }
  const amount = Math.min(source[item] ?? 0, Math.floor(requested));
  if (amount <= 0) return 0;
  if (!applyInventoryDelta(state, { [item]: amount })) return 0;
  source[item] -= amount;
  if (source[item] === 0) delete source[item];
  return amount;
}

/** Public bounded API used by gameplay systems and the inventory UI. */
export const InventoryLayoutSystem = {
  assert: assertInventoryLayout,
  applyInventoryDelta,
  moveOrSwap,
  transferFromPlayer,
  transferToPlayer,
  activeTool: activeToolEntry,
  activeSeed: activeSeedEntry,
  syncSelectedSeed,
  findEntrySlot,
};
