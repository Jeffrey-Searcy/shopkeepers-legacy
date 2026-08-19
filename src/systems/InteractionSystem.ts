/**
 * InteractionSystem — resolves "use the active tool on the tile the player is facing."
 *
 * This is the hub that ties tools -> targets -> effects: clearing nodes (staged trees, stumps,
 * rocks, weeds), tilling, planting (seed items, season-gated), watering (limited-capacity can,
 * refilled at water), and harvesting. It computes the facing tile from the player's position +
 * facing, spends stamina, and applies the tool's effect. Effects that need scene objects
 * (removing a node sprite) are delegated back to the scene via a small callback interface so
 * this system stays free of Phaser scene internals and remains unit-reasoned through GameState.
 */
import { GameState } from '../state/GameState';
import { WATER_CAN_CAPACITY, worldToTile } from '../config/GameConfig';
import { ToolSystem } from './ToolSystem';
import { StaminaSystem } from './StaminaSystem';
import type { HarvestAttempt } from './CropSystem';
import { ToolId, TOOL_NODE_KINDS } from '../config/Items';
import { cropForSeed } from '../config/Crops';

/** What the scene must provide so interactions can affect on-map objects. */
export interface InteractionContext {
  /** The resource node at a tile (kind + what it drops when cleared), or null. */
  nodeAt(tx: number, ty: number): { kind: string; drop: string; dropAmount: number } | null;
  /** Apply one tool hit to the node at a tile; returns true when it's depleted (M-hit feel). */
  hitNode(tx: number, ty: number): boolean;
  /** Remove the resource node at a tile (felling a full tree swaps in its stump). */
  removeNodeAt(tx: number, ty: number): void;
  /** Till the soil at a tile. */
  tillSoil(tx: number, ty: number): void;
  /** Water the soil/crop at a tile. */
  waterSoil(tx: number, ty: number): void;
  /** Restore an empty tilled/watered tile to its base map ground. */
  clearSoil(tx: number, ty: number): void;
  /** Plant a crop of `type` at a tile. Returns true if planted. */
  plantSeed(tx: number, ty: number, type: string): boolean;
  /** Atomically harvest into the player's inventory, preserving the crop when capacity is full. */
  harvestCrop(tx: number, ty: number): HarvestAttempt;
  /** True if a chest occupies the tile (M5). */
  chestAt(tx: number, ty: number): boolean;
  /** True if a bed occupies the tile (M6). */
  bedAt(tx: number, ty: number): boolean;
  /** Sleep (day rollover) via the bed at a tile (M6). */
  sleepInBed(): void;
  /** Ground type at a tile — tilling is only allowed on grass; the can refills at water. */
  groundAt(tx: number, ty: number): string;
  /** Spawn dropped-item pickups at a tile (Stardew-style: drops fly to the player on approach). */
  spawnDrop(item: string, n: number, tx: number, ty: number): void;
}

/** The tile directly in front of the player, based on facing. */
export function facingTile(): { tx: number; ty: number } {
  const p = GameState.instance.player;
  const { tx, ty } = worldToTile(p.x, p.y);
  switch (p.facing) {
    case 'up':
      return { tx, ty: ty - 1 };
    case 'down':
      return { tx, ty: ty + 1 };
    case 'left':
      return { tx: tx - 1, ty };
    case 'right':
      return { tx: tx + 1, ty };
  }
}

/**
 * Use the active tool on the facing tile (or an explicit target tile, e.g. from a mouse click).
 * Returns a short result string for feedback/telemetry. Spends stamina only when an action
 * actually happens.
 */
export function useActiveTool(
  ctx: InteractionContext,
  targetTile?: { tx: number; ty: number }
): string {
  const tool = ToolSystem.active();
  const { tx, ty } = targetTile ?? facingTile();
  const gs = GameState.instance;
  if (!tool) return 'noop';
  // Soil/crop keys are scene-scoped (`${scene}:${tx},${ty}`); tools act in the active scene.
  const key = `${gs.activeScene}:${tx},${ty}`;

  // Destructive tools: axe/pickaxe/scythe chip away at their matching node kinds (the axe covers
  // trees AND leftover stumps). Nodes take multiple hits — hp and the drop come from the node
  // (NODE_DEF per kind/stage); each hit costs stamina; the drop lands on the final hit.
  const kinds = TOOL_NODE_KINDS[tool];
  if (kinds) {
    const node = ctx.nodeAt(tx, ty);
    if (node) {
      if (!kinds.has(node.kind)) return 'no-target';
      if (!StaminaSystem.spendForTool()) return 'too-tired';
      const depleted = ctx.hitNode(tx, ty);
      if (!depleted) return `hit:${node.kind}`;
      ctx.removeNodeAt(tx, ty);
      // Stardew feel: the resource DROPS on the ground and flies to the player on approach —
      // it doesn't teleport into the bag. (A sapling drops nothing: amount 0.)
      if (node.dropAmount > 0) ctx.spawnDrop(node.drop, node.dropAmount, tx, ty);
      return `cleared:${node.kind}`;
    }
    // Stardew rule: a pickaxe restores EMPTY tilled or watered soil to the base map tile. A crop
    // owns its soil until harvested, so this path must deny without stamina or state mutation.
    if (tool === ToolId.Pickaxe && gs.tiles[key]) {
      if (gs.crops[key]) return 'occupied';
      if (!StaminaSystem.spendForTool()) return 'too-tired';
      ctx.clearSoil(tx, ty);
      return 'soil-cleared';
    }
    return 'no-target';
  }

  // Hoe: till empty, non-node GRASS into soil (no tilling paths, water, or floors).
  if (tool === ToolId.Hoe) {
    if (ctx.nodeAt(tx, ty)) return 'blocked';
    if (ctx.groundAt(tx, ty) !== 'grass') return 'not-tillable';
    if (gs.tiles[key]) return 'already-tilled';
    if (!StaminaSystem.spendForTool()) return 'too-tired';
    ctx.tillSoil(tx, ty);
    return 'tilled';
  }

  // Watering can: facing WATER refills it; otherwise it waters tilled soil / a planted crop,
  // spending one unit of its limited capacity. An empty can waters nothing (deny cue).
  if (tool === ToolId.WateringCan) {
    if (ctx.groundAt(tx, ty) === 'water') {
      gs.canWater = WATER_CAN_CAPACITY;
      return 'refilled';
    }
    if (!gs.tiles[key]) return 'not-soil';
    if (gs.canWater <= 0) return 'can-empty';
    if (!StaminaSystem.spendForTool()) return 'too-tired';
    gs.canWater -= 1;
    ctx.waterSoil(tx, ty);
    return 'watered';
  }

  // Seeds: plant the SELECTED seed on tilled soil. Seeds are items — planting needs (and
  // consumes) one from the bag — and every crop is season-locked.
  if (tool === ToolId.Seeds) {
    if (gs.tiles[key] !== 'tilled' && gs.tiles[key] !== 'watered') return 'not-soil';
    if (gs.crops[key]) return 'occupied';
    const seedItem = ToolSystem.activeSeed();
    if (!seedItem) throw new Error('useActiveTool: Seeds action has no selected toolbelt seed stack');
    const def = cropForSeed(seedItem);
    if (!def) throw new Error(`useActiveTool: active seed "${seedItem}" is not a seed item`);
    if ((gs.inventory[seedItem] ?? 0) < 1) return 'no-seeds';
    if (def.season !== gs.season) return `wrong-season:${def.season}`;
    if (!StaminaSystem.spendForTool()) return 'too-tired';
    if (!ctx.plantSeed(tx, ty, def.type)) return 'plant-failed';
    // Consume exactly one seed; drop the key at zero so the bag doesn't show empty stacks.
    if (!gs.removeItem(seedItem, 1)) {
      throw new Error(`useActiveTool: failed to consume available seed "${seedItem}"`);
    }
    return 'planted';
  }

  return 'noop';
}

/**
 * Interact (E) on the facing tile, in priority order:
 *  1. A bed -> sleep.
 *  2. A chest -> open the transfer UI (GameState.chestOpen; the UIScene renders it).
 *  3. A mature crop -> harvest it into the bag (produce + a seeded 0..2 seed return).
 * Returns a short result string for feedback/telemetry.
 */
export function interact(ctx: InteractionContext): string {
  const { tx, ty } = facingTile();

  if (ctx.bedAt(tx, ty)) {
    ctx.sleepInBed();
    return 'slept';
  }

  if (ctx.chestAt(tx, ty)) {
    GameState.instance.chestOpen = true;
    return 'chest-opened';
  }

  const attempt = ctx.harvestCrop(tx, ty);
  if (attempt.status === 'nothing') return 'nothing';
  if (attempt.status === 'full') return 'inventory-full';
  const res = attempt.result;
  // Encode produce + seed return so feedback() can toast both.
  return `harvested:${res.produce}:${res.seeds}`;
}
