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
import { SceneKey, WORLD_SCENE_KEYS } from '../config/AssetKeys';
import { STAMINA_MAX, WATER_CAN_CAPACITY, TILE } from '../config/GameConfig';
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
import { createTavernState, cloneTavernState, validateTavernState, migrateV8TavernState, validateLegacyTavernState, validateV7TavernState, type TavernState } from '../config/Tavern';
import { originalAppearance, assertAppearance, type Appearance } from '../config/Appearance';
import { furnitureCells, furnitureDefinition, furnitureView, type PlacedFurniture, type Rotation } from '../config/Furniture';
import { getMapData, type MapData } from '../world/MapDef';
import { migrateLegacyTavernState, migrateV7TavernState, validateTavernLayoutState } from '../systems/TavernLayout';
import { hasRoomAccess } from '../world/RoomAccess';
import { validatePlantedTrees, type PlantedTree } from '../config/Trees';
import { isCivicInterior } from '../config/TownBuildings';
import { createRelationshipsState, cloneRelationshipsState, migrateV13RelationshipsState, pointsToHearts, socialSeedFromLegacy, validateRelationshipsState,
  type RelationshipsState } from '../systems/RelationshipSystem';
import { cloneJusticeState, createJusticeState, migrateV15JusticeState, validateJusticeState, type JusticeState, type ResidentChatOutcome } from '../systems/JusticeSystem';
import { createCuddleRuntimeState, type CuddleKind, type CuddleRuntimeState } from '../config/Cuddle';
import { cloneMailState, createMailState, deliverMail, migratePreMailState, validateMailState, type MailProgress, type MailState } from '../systems/MailSystem';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { cloneProgressState, createProgressState, migrateProgressFromV17, validateProgressState, type ProgressState } from '../systems/ProgressSystem';
import { cloneTownLifeState, createTownLifeState, migrateTownLifeFromV18, validateTownLifeState, type TownLifeState } from '../systems/TownLifeState';
import { cloneKeeperSocialState, createKeeperSocialState, migrateKeeperSocialFromV19, validateKeeperSocialState,
  type KeeperPlanOption, type KeeperSocialState } from '../systems/KeeperSocialState';
import { isGuildRequest } from '../config/GuildRequests';
import { cloneVitalityState, createVitalityState, migrateVitalityFromV21, validateVitalityState, type VitalityState } from '../systems/VitalityState';
import { cloneResidentOfferState, createResidentOfferState, validateResidentOfferState, type ResidentOfferState } from '../systems/ResidentOfferState';
import type { ChatOfferId } from '../config/ResidentChatOffers';

export type Facing = 'up' | 'down' | 'left' | 'right';

/** One completed, transient speech turn retained only while a resident conversation stays open. */
export interface DialogueTurn {
  role: 'player' | 'resident';
  text: string;
}

/**
 * The face-to-face choices on the resident-choice row, in arrow-key order:
 * talk (authored), chat (local model), together (game actions: befriend, flirt, plans, party, drink),
 * and table (join the resident's Wayfarer-night table; shown only then).
 */
export type ResidentDialogueChoice = 'talk' | 'chat' | 'together' | 'table';

/** One button in the resident-actions grid. `id` is the action the game runs; `label` is the button text. */
export interface DialogueOption {
  id: string;
  label: string;
}

/**
 * One bottom dialogue view. Resident-only fields exist solely during a direct conversation.
 * Kinds:
 *  - message: one line and a close key.
 *  - resident-choice: the Talk / Chat / Together / Table row.
 *  - resident-chat: the local-model conversation.
 *  - resident-actions: the Together grid (and its plan picker).
 *  - wayfarer-table: the keeper sits at a Wayfarer table. WayfarerTableSystem owns the table itself; this
 *    entry only marks the modal, so every existing dialogue guard (frozen movement, Escape, no other
 *    resident talk) also covers the table. It has no residentId, so the clock keeps running (slowly).
 */
export interface DialogueState {
  kind?: 'message' | 'resident-choice' | 'resident-chat' | 'resident-actions' | 'wayfarer-table';
  name: string;
  line: string;
  residentId?: string;
  hearts?: number;
  choice?: ResidentDialogueChoice;
  /** Choices shown on the resident-choice row, in arrow-key order. */
  choices?: ResidentDialogueChoice[];
  /** resident-actions only: the buttons of the current step. */
  options?: DialogueOption[];
  /** resident-actions only: the highlighted button. */
  optionIndex?: number;
  /** resident-actions only: the action list, or tomorrow's plan picker. */
  actionStep?: 'menu' | 'plans';
  /** resident-actions plan picker only: the offered plans, in the same order as `options` (Back is last). */
  planOptions?: KeeperPlanOption[];
  chatPhase?: 'input' | 'waiting' | 'reply';
  draft?: string;
  playerLine?: string;
  /** At most three completed exchanges; excluded from save data with the rest of dialogue state. */
  history?: DialogueTurn[];
  /** Durable browser-local summary supplied to the model, never part of authored relationship state. */
  memorySummary?: string;
  /** Validated game-owned consequence attached to the current local reply. */
  chatOutcome?: ResidentChatOutcome;
  /** Monotonic direct-conversation identity used to reject stale local-model replies. */
  revision?: number;
  /** Hidden recent-topic classification returned with the current local reply. */
  chatIsOnIntimateTopic?: boolean;
  /** Which contextual Cuddle offer is highlighted inside the active dialogue panel. */
  cuddleChoice?: CuddleKind;
  /** The local-model Cuddle decision owns input while it is pending. */
  cuddleDecisionPhase?: 'waiting' | 'accepted' | 'denied';
  /** A real offer the resident just made in words (see ResidentChatOffers.json); shows accept/decline buttons. */
  chatOffer?: ChatOfferId;
  /** Which offer button is highlighted while `chatOffer` is shown. */
  offerChoice?: 'accept' | 'decline';
  /** Offers the keeper turned down in this conversation; they are not sent to the model again until it closes. */
  declinedOffers?: ChatOfferId[];
}

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
  appearance: Appearance;
  tavern: TavernState;
  relationships: RelationshipsState;
  justice: JusticeState;
  /** Farm mailbox: delivered-but-unread and already-read letter ids (version 17+). */
  mail: MailState;
  /** First-week progress: mayor walk, forge/alchemy levels, dungeon records, guild board, forage (version 18+). */
  progress: ProgressState;
  /** Town news, the open favor and invite, and today's chat friendship (version 19+). */
  townLife: TownLifeState;
  /** The keeper's plans with residents, adventuring party, and today's social actions (version 20+). */
  social: KeeperSocialState;
  /** Timed food buffs and taught mana (version 22+). */
  vitality: VitalityState;
  /** Which resident chat offers the keeper received, and on which day (version 23+). */
  residentOffers: ResidentOfferState;
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
  plantedTrees: Record<string, PlantedTree>;
  removedNodes: Record<string, RemovedNode>;
  groundDrops: GroundDropData[];
  placements: Placement[];
  placedItems: PlacedFurniture[];
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
  if (!WORLD_SCENE_KEYS.has(scene)) throw new Error(`GameState save: "${label}" is not a world scene`);
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
  /** Cosmetic choices belong to the save; preview drafts never write here until Apply. */
  appearance: Appearance = originalAppearance();
  /** Pause-owned editor flag, intentionally excluded from durable saves. */
  appearanceEditorOpen = false;
  /** Pause-owned relationship journal flag, intentionally excluded from durable saves. */
  relationshipJournalOpen = false;
  /** Restored room, prepared food, and durable daily service progress. */
  tavern: TavernState = createTavernState();
  /** Friendship, romance, and finite resident-pair progress; local chat text never enters this state. */
  relationships: RelationshipsState = createRelationshipsState(1, 42);
  /** Resident boundaries and bounded incident history. The service guard is not a relationship. */
  justice: JusticeState = createJusticeState();
  /** A new game's mailbox already holds its day-1 mail (the mayor's welcome). */
  mail: MailState = GameState.startingMail();
  /** First-week progress not owned by another system (see systems/ProgressSystem.ts). */
  progress: ProgressState = createProgressState(1);
  /** Town news, favors, invites, and chat friendship (see systems/TownLifeState.ts and TownLifeSystem.ts). */
  townLife: TownLifeState = createTownLifeState(1);
  /** Keeper plans, party, and daily social actions (see systems/KeeperSocialState.ts and KeeperSocialSystem.ts). */
  social: KeeperSocialState = createKeeperSocialState(1);
  /** Food buffs and mana (see systems/VitalityState.ts and VitalitySystem.ts). */
  vitality: VitalityState = createVitalityState();
  /** Resident chat offers already received (see systems/ResidentOfferState.ts and ResidentOfferSystem.ts). */
  residentOffers: ResidentOfferState = createResidentOfferState();
  /**
   * True while the keeper sits in meditation (see VitalitySystem). Runtime only: never saved, so a
   * loaded game always starts standing up.
   */
  meditating = false;
  /** Transient scene-transition request created only by JusticeSystem after a validated severe outcome. */
  arrestRequested = false;
  /** Always-on Cuddle and private-room state. This entire runtime is intentionally excluded from saves. */
  cuddle: CuddleRuntimeState = createCuddleRuntimeState();
  /** Temporary station menu ownership; never restored from a save. */
  tavernPanel: 'ledger' | 'kitchen' | null = null;
  /** Temporary civic service modal flag; its legacy name remains stable for test and input ownership. */
  marketPanelOpen = false;
  /** Non-Market civic service that owns the shared service panel; never restored from a save. */
  civicServiceBuilding: import('../config/CivicInteriors').ExpandedCivicId | null = null;
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
  placedItems: PlacedFurniture[] = [];
  /** The item currently being placed (ghost-targeting mode), or null. */
  placingItem: string | null = null;
  /** Placement intent owner; toolbar stacks remain equipped after placing one unit. Never saved. */
  placingSource: 'toolbelt' | 'inventory' | null = null;
  /** Explicit E cancellation suppresses this belt entry until it is selected again. Never saved. */
  placingCancelledEntry: string | null = null;
  /** Transient authored furniture view; resets when a new placement gesture begins. */
  placingRotation: Rotation = 0;
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
  /** Transient world-entry ownership shared with the parallel UI; never included in save data. */
  transitionActive = false;
  /**
   * Party members walking beside the keeper outside combat (systems/CompanionWalkSystem.ts owns it).
   * `day` is the game day the walks started on. Transient like transitionActive: never saved, so every
   * load and new game starts with nobody following and the save format stays unchanged.
   */
  companionWalk: { day: number; residents: import('../config/ResidentRelationships').ResidentId[] } = { day: 0, residents: [] };
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
  /** The open transient dialogue surface. Local chat text never enters save data. */
  dialogue: DialogueState | null = null;
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
  /** Player-planted farm trees own species and stages independently of authored map objects. */
  plantedTrees: Record<string, PlantedTree> = {};

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
      appearance: { ...this.appearance },
      appearanceEditorOpen: this.appearanceEditorOpen,
      relationshipJournalOpen: this.relationshipJournalOpen,
      tavern: cloneTavernState(this.tavern),
      relationships: cloneRelationshipsState(this.relationships, this.day),
      justice: cloneJusticeState(this.justice, this.day),
      mail: cloneMailState(this.mail),
      progress: cloneProgressState(this.progress),
      townLife: cloneTownLifeState(this.townLife),
      social: cloneKeeperSocialState(this.social),
      vitality: cloneVitalityState(this.vitality),
      residentOffers: cloneResidentOfferState(this.residentOffers),
      arrestRequested: this.arrestRequested,
      cuddle: JSON.parse(JSON.stringify(this.cuddle)) as CuddleRuntimeState,
      tavernPanel: this.tavernPanel,
      marketPanelOpen: this.marketPanelOpen,
      civicServiceBuilding: this.civicServiceBuilding,
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
      plantedTrees: JSON.parse(JSON.stringify(this.plantedTrees)) as Record<string, PlantedTree>,
      removedNodes: JSON.parse(JSON.stringify(this.removedNodes)) as Record<string, RemovedNode>,
      groundDrops: this.groundDrops.map((drop) => ({ ...drop })),
      placements: this.placements.map((p) => ({ ...p })),
      placedItems: this.placedItems.map((p) => ({ ...p })),
      placingItem: this.placingItem,
      placingSource: this.placingSource,
      placingCancelledEntry: this.placingCancelledEntry,
      placingRotation: this.placingRotation,
      inventoryOpen: this.inventoryOpen,
      chestOpen: this.chestOpen,
      craftingOpen: this.craftingOpen,
      binOpen: this.binOpen,
      paused: this.paused,
      transitionActive: this.transitionActive,
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
      appearance: { ...this.appearance },
      tavern: cloneTavernState(this.tavern),
      relationships: cloneRelationshipsState(this.relationships, this.day),
      justice: cloneJusticeState(this.justice, this.day),
      mail: cloneMailState(this.mail),
      progress: cloneProgressState(this.progress),
      townLife: cloneTownLifeState(this.townLife),
      social: cloneKeeperSocialState(this.social),
      vitality: cloneVitalityState(this.vitality),
      residentOffers: cloneResidentOfferState(this.residentOffers),
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
      plantedTrees: JSON.parse(JSON.stringify(this.plantedTrees)) as Record<string, PlantedTree>,
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
   * @param value Unknown parsed save state, after explicit version-field migrations.
   * @param sourceVersion Explicit schema being read. Only versions1–4 used all one-cell furniture;
   * version5 retains rotations/footprints except its one-cell workbench. Current callers omit it.
   * @param validationFarm Explicit old farm for detached pre-migration checks; never installs a global override.
   * @param validationRegion Detached legacy Town/Forest maps during the two pre-v11 validation passes.
   * @returns A detached candidate with validated inventory and non-overlapping furniture footprints.
   */
  static candidateFromSaveData(value: unknown, sourceVersion = 30, validationFarm: MapData = getMapData(SceneKey.Farm),
    validationRegion: ReadonlyMap<SceneKey, MapData> = new Map()): GameState {
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(sourceVersion)) throw new Error('GameState save: unsupported source version');
    for (const [key, map] of validationRegion) {
      if ((key !== SceneKey.Town && key !== SceneKey.Forest) || key !== map.key) {
        throw new Error('GameState save: validation region must contain matching Town/Forest snapshots');
      }
    }
    /** Explicit snapshots affect only compatibility validation, never global map resolution or interiors. */
    const validationMap = (scene: SceneKey): MapData => {
      if (scene === SceneKey.Farm) return validationFarm;
      const snapshot = validationRegion.get(scene);
      return snapshot === undefined ? getMapData(scene) : snapshot;
    };
    const data = objectField(value, 'state');
    const candidate = new GameState();
    candidate.appearance = assertAppearance(data.appearance);
    candidate.day = numberField(data.day, 'day', 1, Number.MAX_SAFE_INTEGER, true);
    // Versions1–12 predate relationships. Version13 owned only six fixed lanes; version14 owns all 66 bonds.
    const migrationSeed = socialSeedFromLegacy(data);
    candidate.relationships = sourceVersion <= 12 ? createRelationshipsState(candidate.day, migrationSeed)
      : sourceVersion === 13 ? migrateV13RelationshipsState(data.relationships, candidate.day, migrationSeed)
        : validateRelationshipsState(data.relationships, candidate.day);
    // Version15 introduces resident boundaries; version16 adds strict resident jail release days.
    candidate.justice = sourceVersion <= 14 ? createJusticeState()
      : sourceVersion === 15 ? migrateV15JusticeState(data.justice, candidate.day)
        : validateJusticeState(data.justice, candidate.day);
    // Version17 adds the mailbox. Older saves get past letters marked read, so only today's and
    // later mail can still arrive (see migratePreMailState).
    candidate.mail = sourceVersion <= 16 ? migratePreMailState(candidate.day) : validateMailState(data.mail);
    // Version18 adds first-week progress. Older saves past day 1 count the mayor as already met.
    candidate.progress = sourceVersion <= 17 ? migrateProgressFromV17(candidate.day)
      : validateProgressState(data.progress, candidate.day, isGuildRequest);
    // Version19 adds town news, favors, and invites. Older saves start with a quiet town.
    candidate.townLife = sourceVersion <= 18 ? migrateTownLifeFromV18(candidate.day)
      : validateTownLifeState(data.townLife, candidate.day);
    // Version20 adds the keeper's plans, party, and daily social actions. Older saves start with none.
    candidate.social = sourceVersion <= 19 ? migrateKeeperSocialFromV19(candidate.day)
      : validateKeeperSocialState(data.social, candidate.day);
    // Validate legacy accounting now, but resolve its guest only after furniture geometry is known.
    const legacyTavern = sourceVersion <= 6 ? validateLegacyTavernState(data.tavern, candidate.day) : null;
    let previousTavern = sourceVersion === 7 ? validateV7TavernState(data.tavern, candidate.day) : null;
    if (sourceVersion === 8) candidate.tavern = migrateV8TavernState(data.tavern, candidate.day);
    if (sourceVersion >= 9) candidate.tavern = validateTavernState(data.tavern, candidate.day);
    candidate.timeOfDay = numberField(data.timeOfDay, 'timeOfDay', 0, 24 * 60);
    // Version22 adds food buffs and mana. Older saves start with neither. Buff expiry is checked against the clock.
    candidate.vitality = sourceVersion <= 21 ? migrateVitalityFromV21()
      : validateVitalityState(data.vitality, candidate.day, candidate.timeOfDay);
    // Version23 adds resident chat offers. Older saves have received none.
    candidate.residentOffers = sourceVersion <= 22 ? createResidentOfferState()
      : validateResidentOfferState(data.residentOffers, candidate.day);
    candidate.activeScene = sceneField(data.activeScene, 'activeScene');
    // why: a portal run is never saved (death or escape decides what the bag keeps), so a save that
    // resumes inside the dungeon can only come from a bug or a hand-edited file.
    if (candidate.activeScene === SceneKey.Dungeon) throw new Error('GameState save: cannot resume inside the portal dungeon');

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
      const scene = sceneField(placement.scene, `placements.${index}.scene`);
      if (isCivicInterior(scene)) throw new Error('GameState save: public interiors cannot contain player building placements');
      return {
        id: stringField(placement.id, `placements.${index}.id`),
        type: stringField(placement.type, `placements.${index}.type`),
        tx: numberField(placement.tx, `placements.${index}.tx`, 0, 10_000, true),
        ty: numberField(placement.ty, `placements.${index}.ty`, 0, 10_000, true),
        w: numberField(placement.w, `placements.${index}.w`, 1, 1_000, true),
        h: numberField(placement.h, `placements.${index}.h`, 1, 1_000, true),
        scene,
      };
    });

    if (!Array.isArray(data.placedItems)) throw new Error('GameState save: "placedItems" must be an array');
    candidate.placedItems = data.placedItems.map((raw, index) => {
      const item = objectField(raw, `placedItems.${index}`);
      const itemId = stringField(item.item, `placedItems.${index}.item`);
      const rotation = numberField(item.rotation, `placedItems.${index}.rotation`, 0, 3, true) as Rotation;
      furnitureView(itemId, rotation);
      return {
        item: itemId,
        scene: sceneField(item.scene, `placedItems.${index}.scene`),
        tx: numberField(item.tx, `placedItems.${index}.tx`, 0, 10_000, true),
        ty: numberField(item.ty, `placedItems.${index}.ty`, 0, 10_000, true),
        rotation,
      };
    });

    // Legacy table/rug art occupied one cell. Validate that original geometry before SaveSystem
    // recovers expanded pieces; growing them here would falsely reject valid old neighbors.
    const occupied = new Map<string, { blocking: boolean; item: string }[]>();
    const mapSizes = new Map<SceneKey, { w: number; h: number }>();
    for (const placed of candidate.placedItems) {
      if (!mapSizes.has(placed.scene)) {
        const map = validationMap(placed.scene);
        mapSizes.set(placed.scene, { w: map.w, h: map.h });
      }
      const size = mapSizes.get(placed.scene);
      if (!size) throw new Error(`GameState save: missing map dimensions for ${placed.scene}`);
      const oldFootprint = sourceVersion <= 4 || (sourceVersion === 5 && placed.item === 'workbench');
      const cells = oldFootprint ? [{ tx: placed.tx, ty: placed.ty }] :
        furnitureCells(placed.item, placed.tx, placed.ty, placed.rotation);
      const blocking = furnitureDefinition(placed.item).blocking;
      const map = validationMap(placed.scene);
      for (const cell of cells) {
        if (cell.tx < 1 || cell.ty < 1 || cell.tx >= size.w - 1 || cell.ty >= size.h - 1) {
          throw new Error(`GameState save: "${placed.item}" footprint is outside ${placed.scene} placement bounds`);
        }
        if (sourceVersion >= 6 && (map.spawns.some(spawn => spawn.tx === cell.tx && spawn.ty === cell.ty) ||
          map.warps.some(warp => cell.tx >= warp.tx && cell.tx < warp.tx + warp.w && cell.ty >= warp.ty && cell.ty < warp.ty + warp.h) ||
          (map.reservedTiles && map.reservedTiles.some(reserved => reserved.tx === cell.tx && reserved.ty === cell.ty)))) {
          throw new Error(`GameState save: furniture occupies a protected entrance at ${placed.scene}:${cell.tx},${cell.ty}`);
        }
        const key = `${placed.scene}:${cell.tx},${cell.ty}`;
        const previous = occupied.get(key);
        if (previous && previous.some(other => (blocking && other.blocking) || placed.item === other.item)) {
          throw new Error(`GameState save: furniture footprints overlap at ${key}`);
        }
        if (previous) previous.push({ blocking, item: placed.item });
        else occupied.set(key, [{ blocking, item: placed.item }]);
      }
    }

    // Versions1–7 predate planted trees. Their authored trees remain explicitly oak.
    candidate.plantedTrees = sourceVersion <= 7 ? {} : validatePlantedTrees(data.plantedTrees, candidate, validationFarm);
    candidate.gold = numberField(data.gold, 'gold', 0, Number.MAX_SAFE_INTEGER, true);
    candidate.maxHp = numberField(data.maxHp, 'maxHp', 1, 1_000, true);
    candidate.hp = numberField(data.hp, 'hp', 0, candidate.maxHp, true);
    assertInventoryLayout(candidate);
    if (sourceVersion >= 6) {
      for (const scene of WORLD_SCENE_KEYS) {
        const room = getMapData(scene);
        if (!room.interior) continue;
        const keeper = candidate.activeScene === scene
          ? { tx: Math.floor(candidate.player.x / TILE), ty: Math.floor(candidate.player.y / TILE) } : undefined;
        if (!hasRoomAccess(room, candidate.placedItems, keeper)) {
          throw new Error(`GameState save: ${scene} furniture blocks a required room route`);
        }
      }
    }
    if (legacyTavern !== null) {
      // Versions1–5 already closed service during the rebuilt-room migration; SaveSystem discloses it.
      // Version6 has the current placed stations, so its accepted or paid guest resumes instead.
      const source = sourceVersion <= 5 ? { ...legacyTavern, phase: 'closed' as const, phaseElapsedMs: 0 } : legacyTavern;
      previousTavern = migrateLegacyTavernState(source, candidate.day, candidate.placedItems, getMapData(SceneKey.Tavern));
    }
    if (previousTavern !== null) {
      candidate.tavern = migrateV7TavernState(previousTavern, candidate.day, candidate.placedItems, getMapData(SceneKey.Tavern));
      // Old pantry quantities become ordinary goods. A full bag sends that stack to shared chest
      // storage, preserving large quantities without creating thousands of individual ground drops.
      for (const [item, quantity] of [['stew', previousTavern.portions], ['ale', previousTavern.ale]] as const) {
        if (quantity === 0) continue;
        const existing = Object.prototype.hasOwnProperty.call(candidate.inventory, item) ? candidate.inventory[item] : 0;
        if (Number.isSafeInteger(existing + quantity) && candidate.addItem(item, quantity)) continue;
        const stored = Object.prototype.hasOwnProperty.call(candidate.chest, item) ? candidate.chest[item] : 0;
        if (!Number.isSafeInteger(stored + quantity)) throw new Error(`GameState save: migrated ${item} exceeds storage capacity`);
        candidate.chest[item] = stored + quantity;
      }
    }
    candidate.tavern = validateTavernState(candidate.tavern, candidate.day);
    if (sourceVersion >= 6) validateTavernLayoutState(candidate.tavern, candidate.placedItems, getMapData(SceneKey.Tavern));
    return candidate;
  }

  /** Install a previously validated detached candidate as the single live state. */
  static installCandidate(candidate: GameState): void {
    if (!(candidate instanceof GameState)) throw new Error('GameState.installCandidate: candidate is invalid');
    GameState._instance = candidate;
  }

  /** Mailbox for a brand-new game: empty, then day-1 letters delivered (shop not yet restored, no hearts). */
  private static startingMail(): MailState {
    const mail = createMailState();
    deliverMail(mail, { day: 1, shopLevel: 0, hearts: Object.fromEntries(TOWN_RESIDENTS.map(resident => [resident.id, 0])) });
    return mail;
  }

  /** What letter triggers read right now: the day, shop level, and whole hearts per resident. */
  mailProgress(): MailProgress {
    const hearts = Object.fromEntries(Object.entries(this.relationships.residents).map(([id, state]) => [id, pointsToHearts(state.points)]));
    return { day: this.day, shopLevel: this.tavern.level, hearts };
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

  /** Start a new adventure with its own durable social seed. */
  static resetWithSocialSeed(socialSeed: number): void {
    const fresh = new GameState();
    fresh.relationships = createRelationshipsState(1, socialSeed);
    GameState._instance = fresh;
  }
}
