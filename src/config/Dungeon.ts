/**
 * Dungeon — tuning for the north trail, the Gate Plaza and the first portal dungeon.
 *
 * DungeonScene reads the room plans; FarmScene reads the trail opening day; the forge and alchemy
 * upgrade costs live with the civic services (config/Upgrades.ts). Numbers are sized for one fun
 * first week: a full clear gives enough shards for the first forge upgrade, and the boss core
 * unlocks the second.
 */
import type { DungeonRoomId } from '../world/DungeonRooms';

/** Day the guild finishes clearing the farm's north trail (Seren's day-5 letter announces it). */
export const NORTH_TRAIL_OPEN_DAY = 5;

/** Items the dungeon bag holds. Loot beyond this stays on the floor. */
export const DUNGEON_BAG_SIZE = 12;

/**
 * Gold per floor to use the escape altar. The fountain hall is floor 1, the side rooms count up in the
 * order the keeper first enters them (2, 3, 3), and the Warden's pit is floor 4 (80g).
 */
export const ESCAPE_GOLD_PER_FLOOR = 20;

/** Base sword damage in the dungeon; each forge level adds one. */
export const DUNGEON_SWORD_BASE = 2;

/** Chance that a slime or bat drops its own loot (gel, wing) when it dies. */
export const MONSTER_DROP_CHANCE = 0.45;

/** One room's monsters and the reward that appears when it is first cleared. */
export interface RoomPlan {
  slimes: number;
  bats: number;
  /** The boss room holds one Warden (a big slime). */
  boss: boolean;
  /** Items dropped along the room's reward row when it is first cleared (at most the row's width). */
  clearReward: Readonly<Record<string, number>>;
}

/**
 * Every room's plan. A full run clears all five: 8 shards, the Warden's core and a potion (the first
 * forge upgrade with shards to spare; the core starts the second).
 */
export const ROOM_PLANS: Readonly<Record<DungeonRoomId, RoomPlan>> = {
  hub: { slimes: 2, bats: 1, boss: false, clearReward: { 'portal-shard': 1 } },
  cave: { slimes: 3, bats: 2, boss: false, clearReward: { 'portal-shard': 2 } },
  library: { slimes: 2, bats: 3, boss: false, clearReward: { 'portal-shard': 1, 'healing-potion': 1 } },
  sewer: { slimes: 4, bats: 1, boss: false, clearReward: { 'portal-shard': 2 } },
  boss: { slimes: 2, bats: 0, boss: true, clearReward: { 'warden-core': 1, 'portal-shard': 2 } },
};

/** Warden boss: hit points and contact damage. */
export const WARDEN_HP = 16;
export const WARDEN_TOUCH_DAMAGE = 2;

/** HP a healing potion restores (used from the toolbelt while in a combat scene). */
export const POTION_HEAL = 4;
