/**
 * GameState — the single, serializable source of truth for the whole game.
 *
 * Systems read and mutate this object; scenes render from it. `serialize()` produces the plain
 * snapshot that the Playwright test seam (window.__TEST__.state()) reads, and is the same shape
 * that will later drive save/load. Keeping ALL gameplay state here (never scattered on sprites)
 * is what makes the game deterministically testable and is why the test seam can assert on it.
 *
 * Facing directions are a small union used by movement + animation selection.
 */
import { SceneKey } from '../config/AssetKeys';
import { STAMINA_MAX, WATER_CAN_CAPACITY } from '../config/GameConfig';
import { seasonForDay, type Season } from '../config/Crops';
import { ItemId, type TreeStage } from '../config/Items';
import {
  BACKPACK_CAPACITY,
  InventoryLayoutSystem,
  TOOLBELT_CAPACITY,
  assertInventoryLayout,
  createDefaultToolbelt,
  createEmptyBackpack,
  type PlayerSlotEntry,
} from '../systems/InventoryLayoutSystem';
import { WeatherSystem, type Weather } from '../systems/WeatherSystem';

export type Facing = 'up' | 'down' | 'left' | 'right';

/** Per-tile soil state for the farm grid, keyed by `${tx},${ty}`. */
export type SoilState = 'tilled' | 'watered';

/** A growing crop on a tilled tile, keyed by `${tx},${ty}`. */
export interface CropData {
  type: string;
  stage: number; // 0..maxStage (visual stage; art key crop-<type>-<stage+1>)
  maxStage: number;
  watered: boolean;
  /** Watered days accumulated toward leaving the CURRENT stage (see Crops.ts stageDays). */
  daysInStage: number;
}

/**
 * A tree that differs from the map default (full-grown): still growing (sapling/small) or a
 * leftover stump after a full tree was felled. `sinceDay` = the day this state began, so growth
 * (TreeSystem.advanceDay) knows when to advance. Keyed by `${scene}:${tx},${ty}`.
 */
export interface TreeState {
  stage: TreeStage | 'stump';
  sinceDay: number;
}

/** A cleared resource node: what stood there and when it was cleared (drives regrowth). */
export interface RemovedNode {
  kind: string;
  day: number;
}

/** A world pickup persisted only when a full backpack prevents banking it during scene shutdown. */
export interface GroundDropData {
  scene: SceneKey;
  item: string;
  tx: number;
  ty: number;
}

/** A placed building footprint (M7 seam for Prompt-2 shops). */
export interface Placement {
  id: string;
  type: string;
  tx: number;
  ty: number;
  w: number; // footprint width in tiles
  h: number; // footprint height in tiles
  scene: SceneKey;
}

/** One sold-item line on the morning sell report (icon/name resolved by the UI from `item`). */
export interface DaySummaryLine {
  item: string;
  qty: number;
  /** Sell value per unit (gold). */
  unit: number;
  /** qty * unit. */
  total: number;
}

/** The morning sell report shown as an overlay when the player wakes (see GameState.daySummary). */
export interface DaySummary {
  /** The NEW day that is starting. */
  day: number;
  lines: DaySummaryLine[];
  /** Grand total earned overnight. */
  total: number;
  /** Gold balance AFTER the payout. */
  gold: number;
}

/** The player's live state. Position is authoritative for save/load, NOT for transitions. */
export interface PlayerState {
  x: number;
  y: number;
  facing: Facing;
  stamina: number;
}

/** Developer-only pacing controls. Values are serialized so browser tests can prove the HUD. */
export interface DevTuningState {
  /** Multiplier applied only to real-time clock ticks; direct stepTime calls remain exact. */
  clockScale: number;
  /** 1 = normal sleep growth; values above 1 enable accelerated preview growth in dev/test. */
  cropScale: number;
}

/** Complete durable payload written by SaveSystem. Unlike serialize(), map records are not sliced. */
export interface GameSaveData {
  day: number;
  timeOfDay: number;
  activeScene: SceneKey;
  player: PlayerState;
  hotbarIndex: number;
  toolbeltSlots: PlayerSlotEntry[];
  backpackSlots: PlayerSlotEntry[];
  inventory: Record<string, number>;
  selectedSeed: string;
  canWater: number;
  chest: Record<string, number>;
  tiles: Record<string, SoilState>;
  crops: Record<string, CropData>;
  treeStages: Record<string, TreeState>;
  removedNodes: Record<string, RemovedNode>;
  groundDrops: GroundDropData[];
  placements: Placement[];
  placedItems: Array<{ item: string; scene: SceneKey; tx: number; ty: number }>;
  bin: Record<string, number>;
  gold: number;
  hp: number;
  maxHp: number;
}

/** Require a plain JSON object and name the corrupt field in the thrown error. */
function objectField(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GameState save: "${label}" must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Require a finite number within an inclusive range. */
function numberField(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`GameState save: "${label}" is invalid`);
  }
  return value;
}

/** Require a non-empty string. */
function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`GameState save: "${label}" must be a non-empty string`);
  }
  return value;
}

/** Require a known world scene; menus/boot scenes are never durable player locations. */
function sceneField(value: unknown, label: string): SceneKey {
  const scene = stringField(value, label) as SceneKey;
  const worlds = new Set<SceneKey>([
    SceneKey.Farm,
    SceneKey.Town,
    SceneKey.Home,
    SceneKey.Forest,
    SceneKey.Beach,
    SceneKey.Mountain,
    SceneKey.Mines,
  ]);
  if (!worlds.has(scene)) throw new Error(`GameState save: "${label}" is not a world scene`);
  return scene;
}

/** Validate and clone an item-count record. */
function countRecord(value: unknown, label: string): Record<string, number> {
  const source = objectField(value, label);
  const out: Record<string, number> = {};
  for (const [item, count] of Object.entries(source)) {
    stringField(item, `${label} item`);
    out[item] = numberField(count, `${label}.${item}`, 1, Number.MAX_SAFE_INTEGER, true);
  }
  return out;
}

/**
 * The mutable game state. Instantiated once (see GameState.instance) and shared across scenes.
 * Everything here is JSON-serializable so the test seam and save system can read it directly.
 */
export class GameState {
  /** In-game day counter (starts at day 1). */
  day = 1;
  /** Time of day in minutes since 06:00 (game start), 0..(24*60). */
  timeOfDay = 0;
  /** Dev/test pacing starts at production-equivalent behavior and is ignored outside dev/test. */
  devTuning: DevTuningState = { clockScale: 1, cropScale: 1 };
  /** Which world scene the player is currently in. */
  activeScene: SceneKey = SceneKey.Farm;
  /** Player live state. */
  player: PlayerState = { x: 0, y: 0, facing: 'down', stamina: STAMINA_MAX };
  /** Selected hotbar slot index (0-based). */
  hotbarIndex = 0;
  /** Eight ordered player slots; entries are item ids, `tool:<id>`, or null. Never quantities. */
  toolbeltSlots: PlayerSlotEntry[] = createDefaultToolbelt();
  /** Twenty-four row-major backpack slots. Item/tool location lives here, counts do not. */
  backpackSlots: PlayerSlotEntry[] = createEmptyBackpack();
  /**
   * Inventory item -> count. Seeds are ITEMS (planting consumes one); a fresh game starts with
   * 15 parsnip seeds (the Stardew opener) — there are no unlimited seeds.
   */
  inventory: Record<string, number> = { [ItemId.ParsnipSeeds]: 15 };
  /** The seed item the Seeds hotbar slot plants (switched by clicking a seed stack in the bag). */
  selectedSeed: string = ItemId.ParsnipSeeds;
  /** Water remaining in the watering can (uses); refilled to capacity by using it facing water. */
  canWater = WATER_CAN_CAPACITY;
  /** Chest storage item -> count (single shared chest for V1). */
  chest: Record<string, number> = {};
  /**
   * Soil tiles keyed by `${scene}:${tx},${ty}` -> state. Scene-scoped (same key pattern as
   * removedNodes/treeStages): soil tilled at farm (20,20) must NOT render at town (20,20) —
   * un-scoped keys caused exactly that cross-map bleed.
   */
  tiles: Record<string, SoilState> = {};
  /** Crops keyed by `${scene}:${tx},${ty}` (scene-scoped, same rule as tiles). */
  crops: Record<string, CropData> = {};
  /** Placed buildings. */
  placements: Placement[] = [];
  /**
   * Player-placed world items (Stardew rule: placeable anywhere not blocked). Source of truth —
   * scenes spawn entities from this on (re)entry. V1 item: 'chest'.
   */
  placedItems: Array<{ item: string; scene: SceneKey; tx: number; ty: number }> = [];
  /** The item currently being placed (ghost-targeting mode), or null. */
  placingItem: string | null = null;
  /** Whether the inventory panel is open (UI state, but serialized so tests can assert it). */
  inventoryOpen = false;
  /** Whether the chest transfer UI is open. */
  chestOpen = false;
  /** Whether the workbench crafting panel is open. */
  craftingOpen = false;
  /** Whether the shipping-bin sell panel is open. */
  binOpen = false;
  /** True while the in-game pause overlay owns input and world updates are frozen. */
  paused = false;
  /** Transient destructive-confirmation state owned by the pause overlay. */
  pauseConfirmOpen = false;
  /** Items queued in the shipping bin (sold automatically at day end). */
  bin: Record<string, number> = {};
  /** The player's money. */
  gold = 0;
  /** Combat (Mines-only for V1): health points. Damage/dodge rules live in src/combat/CombatSystem. */
  hp = 10;
  maxHp = 10;
  /** Remaining invulnerability (i-frames) in ms — from a dodge roll or a just-taken hit. */
  invulnMs = 0;
  /** Remaining dodge cooldown in ms. */
  dodgeCooldownMs = 0;
  /** Active fishing state (null when not fishing). Reeling carries the minigame's live numbers. */
  fishing: {
    phase: 'waiting' | 'bite' | 'reeling';
    fishId?: string;
    progress?: number;
    zonePos?: number;
    zoneVel?: number;
    fishPos?: number;
    fishTarget?: number;
  } | null = null;
  /** The open dialogue line (null when no dialogue). */
  dialogue: { name: string; line: string } | null = null;
  /**
   * The morning sell report (Stardew's end-of-day screen): what the shipping bin sold overnight,
   * line by line, plus the new gold balance. Set by sleep(); non-null means the overlay is open
   * (E or a click dismisses it, THEN the day starts). Rendered by UIScene.
   */
  daySummary: DaySummary | null = null;
  /**
   * Resource nodes the player has cleared, keyed by `${scene}:${tx},${ty}` -> what/when. Scenes
   * skip these on (re)entry so chopped trees don't respawn when you walk to town and back.
   * Regrowth (TreeSystem.advanceDay): weeds regrow next day; cleared TREE spots sprout a sapling
   * after TREE_REGROW_DAYS; rocks stay cleared forever.
   */
  removedNodes: Record<string, RemovedNode> = {};
  /** Uncollected full-bag drops restored when their owning scene is entered again. */
  groundDrops: GroundDropData[] = [];

  /**
   * Trees that differ from the map default (growing saplings/small trees, or stumps left by
   * felling a full tree), keyed by `${scene}:${tx},${ty}`. Absence of a key = full-grown tree.
   */
  treeStages: Record<string, TreeState> = {};

  /** The current season, derived from the day counter (28-day seasons; day 1 = spring 1). */
  get season(): Season {
    return seasonForDay(this.day);
  }

  /** Today's weather — pure function of (seed, day), so it needs no stored field. */
  get weather(): Weather {
    return WeatherSystem.forDay(this.day);
  }

  /** Tomorrow's weather (what the farmhouse TV forecasts). */
  get weatherTomorrow(): Weather {
    return WeatherSystem.forDay(this.day + 1);
  }

  /**
   * Add `n` of `item` atomically. Returns false when a brand-new stack has no backpack slot;
   * callers that own a world pickup keep that pickup alive instead of silently losing it.
   */
  addItem(item: string, n = 1): boolean {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`GameState.addItem: invalid amount ${n}`);
    return InventoryLayoutSystem.applyInventoryDelta(this, { [item]: n });
  }

  /** Remove `n` from a player stack atomically, clearing its slot at zero. */
  removeItem(item: string, n = 1): boolean {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`GameState.removeItem: invalid amount ${n}`);
    return InventoryLayoutSystem.applyInventoryDelta(this, { [item]: -n });
  }

  /**
   * Slice a `${scene}:${tx},${ty}`-keyed record down to the ACTIVE scene's entries, with the
   * scene prefix stripped back to plain `${tx},${ty}` keys. serialize() uses this for tiles and
   * crops so the seam reports "the soil/crops where the player currently is" in the tile-key
   * shape the specs assert on — other scenes' entries stay in storage, just out of the snapshot.
   */
  private sceneSlice<T>(rec: Record<string, T>): Record<string, T> {
    const prefix = `${this.activeScene}:`;
    const out: Record<string, T> = {};
    for (const k of Object.keys(rec)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = rec[k];
    }
    return out;
  }

  /**
   * Produce a plain snapshot for the test seam / save system. This is the contract the Playwright
   * specs assert against, so keep it stable and JSON-safe.
   */
  serialize() {
    return {
      day: this.day,
      season: this.season,
      timeOfDay: this.timeOfDay,
      devTuning: { ...this.devTuning },
      activeScene: this.activeScene,
      player: { ...this.player },
      hotbarIndex: this.hotbarIndex,
      toolbeltSlots: [...this.toolbeltSlots],
      backpackSlots: [...this.backpackSlots],
      inventory: { ...this.inventory },
      selectedSeed: this.selectedSeed,
      canWater: this.canWater,
      chest: { ...this.chest },
      tiles: this.sceneSlice(this.tiles),
      crops: JSON.parse(JSON.stringify(this.sceneSlice(this.crops))) as Record<string, CropData>,
      treeStages: JSON.parse(JSON.stringify(this.treeStages)) as Record<string, TreeState>,
      removedNodes: JSON.parse(JSON.stringify(this.removedNodes)) as Record<string, RemovedNode>,
      groundDrops: this.groundDrops.map((drop) => ({ ...drop })),
      placements: this.placements.map((p) => ({ ...p })),
      placedItems: this.placedItems.map((p) => ({ ...p })),
      placingItem: this.placingItem,
      inventoryOpen: this.inventoryOpen,
      chestOpen: this.chestOpen,
      craftingOpen: this.craftingOpen,
      binOpen: this.binOpen,
      paused: this.paused,
      pauseConfirmOpen: this.pauseConfirmOpen,
      bin: { ...this.bin },
      gold: this.gold,
      hp: this.hp,
      maxHp: this.maxHp,
      invulnMs: this.invulnMs,
      dodgeCooldownMs: this.dodgeCooldownMs,
      weather: this.weather,
      weatherTomorrow: this.weatherTomorrow,
      fishing: this.fishing ? { ...this.fishing } : null,
      dialogue: this.dialogue ? { ...this.dialogue } : null,
      daySummary: this.daySummary ? (JSON.parse(JSON.stringify(this.daySummary)) as DaySummary) : null,
    };
  }

  /**
   * Export the complete durable world. UI modals, developer tuning, fishing, action timers, and
   * morning overlays are intentionally excluded so a resumed game always starts controllably.
   */
  toSaveData(): GameSaveData {
    return {
      day: this.day,
      timeOfDay: this.timeOfDay,
      activeScene: this.activeScene,
      player: { ...this.player },
      hotbarIndex: this.hotbarIndex,
      toolbeltSlots: [...this.toolbeltSlots],
      backpackSlots: [...this.backpackSlots],
      inventory: { ...this.inventory },
      selectedSeed: this.selectedSeed,
      canWater: this.canWater,
      chest: { ...this.chest },
      tiles: { ...this.tiles },
      crops: JSON.parse(JSON.stringify(this.crops)) as Record<string, CropData>,
      treeStages: JSON.parse(JSON.stringify(this.treeStages)) as Record<string, TreeState>,
      removedNodes: JSON.parse(JSON.stringify(this.removedNodes)) as Record<string, RemovedNode>,
      groundDrops: this.groundDrops.map((drop) => ({ ...drop })),
      placements: this.placements.map((placement) => ({ ...placement })),
      placedItems: this.placedItems.map((item) => ({ ...item })),
      bin: { ...this.bin },
      gold: this.gold,
      hp: this.hp,
      maxHp: this.maxHp,
    };
  }

  /**
   * Validate an unknown durable payload into a detached GameState. Nothing live is mutated until
   * SaveSystem explicitly installs this fully-valid candidate.
   */
  static candidateFromSaveData(value: unknown): GameState {
    const data = objectField(value, 'state');
    const candidate = new GameState();
    candidate.day = numberField(data.day, 'day', 1, Number.MAX_SAFE_INTEGER, true);
    candidate.timeOfDay = numberField(data.timeOfDay, 'timeOfDay', 0, 24 * 60);
    candidate.activeScene = sceneField(data.activeScene, 'activeScene');

    const player = objectField(data.player, 'player');
    const facing = stringField(player.facing, 'player.facing') as Facing;
    if (!(['up', 'down', 'left', 'right'] as Facing[]).includes(facing)) {
      throw new Error('GameState save: "player.facing" is invalid');
    }
    candidate.player = {
      x: numberField(player.x, 'player.x', 0, Number.MAX_SAFE_INTEGER),
      y: numberField(player.y, 'player.y', 0, Number.MAX_SAFE_INTEGER),
      facing,
      stamina: numberField(player.stamina, 'player.stamina', 0, STAMINA_MAX),
    };

    candidate.hotbarIndex = numberField(data.hotbarIndex, 'hotbarIndex', 0, TOOLBELT_CAPACITY - 1, true);
    if (!Array.isArray(data.toolbeltSlots) || data.toolbeltSlots.length !== TOOLBELT_CAPACITY) {
      throw new Error(`GameState save: "toolbeltSlots" must contain ${TOOLBELT_CAPACITY} slots`);
    }
    if (!Array.isArray(data.backpackSlots) || data.backpackSlots.length !== BACKPACK_CAPACITY) {
      throw new Error(`GameState save: "backpackSlots" must contain ${BACKPACK_CAPACITY} slots`);
    }
    const cloneSlots = (slots: unknown[], label: string): PlayerSlotEntry[] =>
      slots.map((entry, index) => {
        if (entry === null) return null;
        return stringField(entry, `${label}.${index}`);
      });
    candidate.toolbeltSlots = cloneSlots(data.toolbeltSlots, 'toolbeltSlots');
    candidate.backpackSlots = cloneSlots(data.backpackSlots, 'backpackSlots');
    candidate.inventory = countRecord(data.inventory, 'inventory');
    candidate.selectedSeed = stringField(data.selectedSeed, 'selectedSeed');
    candidate.canWater = numberField(data.canWater, 'canWater', 0, WATER_CAN_CAPACITY, true);
    candidate.chest = countRecord(data.chest, 'chest');
    candidate.bin = countRecord(data.bin, 'bin');

    const tiles = objectField(data.tiles, 'tiles');
    candidate.tiles = {};
    for (const [key, soil] of Object.entries(tiles)) {
      stringField(key, 'tiles key');
      if (soil !== 'tilled' && soil !== 'watered') throw new Error(`GameState save: "tiles.${key}" is invalid`);
      candidate.tiles[key] = soil;
    }

    const crops = objectField(data.crops, 'crops');
    candidate.crops = {};
    for (const [key, raw] of Object.entries(crops)) {
      const crop = objectField(raw, `crops.${key}`);
      const maxStage = numberField(crop.maxStage, `crops.${key}.maxStage`, 0, 32, true);
      candidate.crops[key] = {
        type: stringField(crop.type, `crops.${key}.type`),
        stage: numberField(crop.stage, `crops.${key}.stage`, 0, maxStage, true),
        maxStage,
        watered: crop.watered === true,
        daysInStage: numberField(crop.daysInStage, `crops.${key}.daysInStage`, 0, 365, true),
      };
      if (typeof crop.watered !== 'boolean') throw new Error(`GameState save: "crops.${key}.watered" is invalid`);
    }

    const treeStages = objectField(data.treeStages, 'treeStages');
    candidate.treeStages = {};
    for (const [key, raw] of Object.entries(treeStages)) {
      const tree = objectField(raw, `treeStages.${key}`);
      const stage = stringField(tree.stage, `treeStages.${key}.stage`) as TreeState['stage'];
      if (!['sapling', 'small', 'full', 'stump'].includes(stage)) {
        throw new Error(`GameState save: "treeStages.${key}.stage" is invalid`);
      }
      candidate.treeStages[key] = {
        stage,
        sinceDay: numberField(tree.sinceDay, `treeStages.${key}.sinceDay`, 1, Number.MAX_SAFE_INTEGER, true),
      };
    }

    const removed = objectField(data.removedNodes, 'removedNodes');
    candidate.removedNodes = {};
    for (const [key, raw] of Object.entries(removed)) {
      const node = objectField(raw, `removedNodes.${key}`);
      candidate.removedNodes[key] = {
        kind: stringField(node.kind, `removedNodes.${key}.kind`),
        day: numberField(node.day, `removedNodes.${key}.day`, 1, Number.MAX_SAFE_INTEGER, true),
      };
    }

    if (!Array.isArray(data.groundDrops)) throw new Error('GameState save: "groundDrops" must be an array');
    candidate.groundDrops = data.groundDrops.map((raw, index) => {
      const drop = objectField(raw, `groundDrops.${index}`);
      return {
        scene: sceneField(drop.scene, `groundDrops.${index}.scene`),
        item: stringField(drop.item, `groundDrops.${index}.item`),
        tx: numberField(drop.tx, `groundDrops.${index}.tx`, 0, 10_000, true),
        ty: numberField(drop.ty, `groundDrops.${index}.ty`, 0, 10_000, true),
      };
    });

    if (!Array.isArray(data.placements)) throw new Error('GameState save: "placements" must be an array');
    candidate.placements = data.placements.map((raw, index) => {
      const placement = objectField(raw, `placements.${index}`);
      return {
        id: stringField(placement.id, `placements.${index}.id`),
        type: stringField(placement.type, `placements.${index}.type`),
        tx: numberField(placement.tx, `placements.${index}.tx`, 0, 10_000, true),
        ty: numberField(placement.ty, `placements.${index}.ty`, 0, 10_000, true),
        w: numberField(placement.w, `placements.${index}.w`, 1, 1_000, true),
        h: numberField(placement.h, `placements.${index}.h`, 1, 1_000, true),
        scene: sceneField(placement.scene, `placements.${index}.scene`),
      };
    });

    if (!Array.isArray(data.placedItems)) throw new Error('GameState save: "placedItems" must be an array');
    candidate.placedItems = data.placedItems.map((raw, index) => {
      const item = objectField(raw, `placedItems.${index}`);
      return {
        item: stringField(item.item, `placedItems.${index}.item`),
        scene: sceneField(item.scene, `placedItems.${index}.scene`),
        tx: numberField(item.tx, `placedItems.${index}.tx`, 0, 10_000, true),
        ty: numberField(item.ty, `placedItems.${index}.ty`, 0, 10_000, true),
      };
    });

    candidate.gold = numberField(data.gold, 'gold', 0, Number.MAX_SAFE_INTEGER, true);
    candidate.maxHp = numberField(data.maxHp, 'maxHp', 1, 1_000, true);
    candidate.hp = numberField(data.hp, 'hp', 0, candidate.maxHp, true);
    assertInventoryLayout(candidate);
    return candidate;
  }

  /** Install a previously validated detached candidate as the single live state. */
  static installCandidate(candidate: GameState): void {
    if (!(candidate instanceof GameState)) throw new Error('GameState.installCandidate: candidate is invalid');
    GameState._instance = candidate;
  }

  /** The one shared instance. Created lazily. */
  private static _instance: GameState | null = null;
  static get instance(): GameState {
    if (!GameState._instance) GameState._instance = new GameState();
    return GameState._instance;
  }

  /** Reset to a fresh game (used at boot and by tests via a fresh page load). */
  static reset(): void {
    GameState._instance = new GameState();
  }
}
