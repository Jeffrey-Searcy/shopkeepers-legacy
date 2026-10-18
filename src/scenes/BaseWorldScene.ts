/**
 * BaseWorldScene — shared behavior for every walkable world scene (Farm/Town/Home).
 *
 * Responsibilities (this is where the two historical bugs are structurally prevented):
 *  - Render the BIG map from MapData as a tile grid (placeholder rects now, PixelLab tiles later).
 *  - Spawn the player at a NAMED spawn (from SceneTransitionSystem), NEVER implicit (0,0).
 *  - Set camera + physics world bounds to the full map, and startFollow the player (camera fix).
 *  - Build static collision for solid tiles so the player can't leave the map or cross water.
 *  - Detect warp-zone overlap and route through SceneTransitionSystem (the ONLY way scenes change).
 *  - Bring party members who walk with the keeper (CompanionWalkSystem) into every scene that allows
 *    them, as PartyCompanion followers the keeper can talk to.
 *
 * Subclasses supply only their SceneKey; everything else is data-driven from MapDef.
 */
import Phaser from 'phaser';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { TILE, CAMERA_LERP, FEET_CENTER_DY, worldToTile } from '../config/GameConfig';
import { worldZoom, interiorViewportHeight } from '../ui/UILayout';
import { installCrispText } from '../ui/TextRendering';
import { getMapData, type MapData, type PaintedNodeArt, type WarpDef } from '../world/MapDef';
import { FINE_CELL, FINE_PER_TILE } from '../world/FineCollision';
import {
  ensureTerrainTileset,
  TERRAIN_TILESET_KEY,
  GROUND_INDEX,
} from '../world/TerrainTileset';
import { renderWangTerrain } from '../world/TerrainRenderer';
import { renderShopInterior } from '../world/InteriorRenderer';
import { FurnitureSurfaceRenderer } from '../world/FurnitureSurfaceRenderer';
import { Player, PLAYER_FOOTSTEP_EVENT } from '../entities/Player';
import { ResourceNode } from '../entities/ResourceNode';
import { fellFx, poofFx, shatterFx } from '../entities/NodeBreakFx';
import { Chest } from '../entities/Chest';
import { Prop } from '../entities/Prop';
import { DroppedItem } from '../entities/DroppedItem';
import { Sfx } from '../systems/SfxSystem';
import { AmbientSoundscape } from '../systems/AmbientSound';
import { footSurfaceAt } from '../world/SoundPlans';
import { waterArea } from '../world/WaterSound';
import { InputBus } from '../input/InputBus';
import { GameState, type Facing } from '../state/GameState';
import { consumePendingResumePlayer, consumePendingSpawn, transitionTo, validateDestination, WORLD_TRANSITION_START, WORLD_FADE_MS } from '../systems/SceneTransitionSystem';
import { isTestMode, markReady, markNotReady, registerSceneTestHooks } from '../debug/DebugHooks';
import { WallsDebugView } from '../debug/WallsDebugView';
import { ToolSystem } from '../systems/ToolSystem';
import { ItemPlacementSystem, PLACEABLE_DEF } from '../systems/ItemPlacementSystem';
import { furnitureAllowedInScene, furnitureDepth, furnitureView, nextFurnitureRotation, type Rotation } from '../config/Furniture';
import { ToolId, ITEM_CATALOG, ITEM_VALUES, type TreeStage } from '../config/Items';
import { StaminaSystem } from '../systems/StaminaSystem';
import { VitalitySystem } from '../systems/VitalitySystem';
import { FarmGridSystem } from '../systems/FarmGridSystem';
import { CropSystem } from '../systems/CropSystem';
import { TreeSystem } from '../systems/TreeSystem';
import { deliverMail } from '../systems/MailSystem';
import { WeatherSystem } from '../systems/WeatherSystem';
import { SoilOverlay } from '../systems/SoilOverlay';
import { TimeSystem } from '../systems/TimeSystem';
import { DevTuningSystem } from '../systems/DevTuningSystem';
import { PlacementSystem } from '../systems/PlacementSystem';
import { FishingSystem, BITE_WINDOW_MS } from '../systems/FishingSystem';
import { ShippingSystem } from '../systems/ShippingSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { GuildBoardSystem } from '../systems/GuildBoardSystem';
import { TownLifeSystem } from '../systems/TownLifeSystem';
import { CANOPY_OFFSETS, ForageSystem, type ForageSpot } from '../systems/ForageSystem';
import { TavernSystem } from '../systems/TavernSystem';
import { syncTownSocialLife } from '../systems/TownSocialLifeSystem';
import { useActiveTool, interact, facingTile, type InteractionContext } from '../systems/InteractionSystem';
import { KeeperSocialSystem } from '../systems/KeeperSocialSystem';
import { closeDialogue, confirmResidentAction, confirmResidentDialogueChoice, residentChatCapturesTyping } from '../systems/ResidentDialogueSystem';
import { cancelWayfarerTableTyping, wayfarerTableTyping } from '../systems/WayfarerTableSystem';
import type { OneShotAction } from '../input/InputBus';
import { interactWithWaitingCuddle, playerCuddleBusy, resetPinnedSelfActivity, updateCuddle, cuddleEffectView } from '../systems/CuddleSystem';
import { CuddleEffectRenderer } from '../world/CuddleEffectRenderer';
import { InteriorLighting } from '../world/InteriorLighting';
import type { InteriorLight } from '../config/InteriorLights';
import { isWorldRoutesModalOpen, setWorldRoutesModalOpen } from '../systems/WorldRoutesModalSystem';
import { PartyCompanions, type CompanionCombat } from '../entities/PartyCompanion';
import { CompanionWalkSystem } from '../systems/CompanionWalkSystem';
import { meetResidentInPerson } from '../systems/ResidentDialogueSystem';
import type { ResidentId } from '../config/ResidentRelationships';

/**
 * The combat view walking companions get outside combat scenes: no enemies, so they only follow.
 * strikeEnemy can never be reached with an empty enemy list; it throws if that ever changes.
 */
const NO_COMBAT: CompanionCombat = {
  enemies: [],
  strikeEnemy() {
    throw new Error('Walking companions have no enemies to strike outside combat scenes');
  },
};

/** One forage find drawn on the ground: the spot, its bobbing icon, and whether a full-bag toast already showed. */
interface ForageSprite {
  spot: ForageSpot;
  image: Phaser.GameObjects.Image;
  warned: boolean;
}

/** How close (px) the keeper's feet must come to a forage find to pick it up. */
const FORAGE_PICK_RANGE = 10;
/** Texture key of the one tile behind the hidden fine wall layer (buildFineWallLayer); never drawn. */
const FINE_WALL_TEXTURE = 'fine-wall-tile';

export abstract class BaseWorldScene extends Phaser.Scene {
  protected map!: MapData;
  protected player!: Player;
  /**
   * How the keeper arrived in this scene instance: the named spawn they were placed at, and whether
   * Continue then moved them to an exact saved position. Scenes use it to tell a fresh New Game
   * arrival (spawn "start", not resumed) from a doorway re-entry or a loaded save.
   */
  protected arrival!: { readonly spawnId: string; readonly resumed: boolean };
  /** The single tilemap layer that renders the whole (big) ground grid, culled and cheap. */
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  /**
   * The layer the keeper's body collides with: groundLayer itself on tile-walled maps, or a hidden layer
   * of FINE_CELL (4 px) cells when the map has fine walls (MapData.fineSolid, the painted outdoor maps).
   */
  private wallLayer!: Phaser.Tilemaps.TilemapLayer;
  /** The walls debug overlay (F9 in test and dev builds); null in normal play. */
  private wallsDebug: WallsDebugView | null = null;
  /**
   * Painted frames of this map's painted trees and rocks, keyed "tx,ty" (from MapData.objects; empty on
   * maps drawn from tiles). spawnNode uses it for a rock or a full tree at that tile.
   */
  private paintedNodeArt = new Map<string, PaintedNodeArt>();
  /** Warp zones the player can overlap to transition. */
  private warpZones: Phaser.GameObjects.Zone[] = [];
  /** Guard so a single overlap frame doesn't fire multiple transitions. */
  protected transitioning = false;
  /** Keyboard bindings, so we can rebind cleanly on each create. */
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  /** Live resource nodes keyed by "tx,ty" for O(1) facing-tile lookup. */
  private nodes = new Map<string, ResourceNode>();
  /** Physics group of node bodies so the player collides with them. */
  private nodeGroup!: Phaser.Physics.Arcade.StaticGroup;
  /** Chest tiles present in this scene, keyed by "tx,ty". */
  private chests = new Set<string>();
  /** Physics group all chest bodies join (map chests + player-placed ones). */
  private chestGroup!: Phaser.Physics.Arcade.StaticGroup;
  /** Player-placed item sprites keyed by "tx,ty" (despawned on pickup). */
  private placedSprites = new Map<string, Phaser.GameObjects.Image>();
  /** Derived connecting surfaces; one native texture per piece, never merged save records or bodies. */
  private furnitureSurfaces!: FurnitureSurfaceRenderer;
  /** Actual directional furniture preview, separate from its whole-footprint ground outline. */
  private placementGhost!: Phaser.GameObjects.Image;
  /** Placed workbench tiles (interacting opens the crafting panel), keyed by "tx,ty". */
  private workbenches = new Set<string>();
  /** Shipping-bin tiles (interacting opens the sell panel), keyed by "tx,ty". */
  private bins = new Set<string>();
  /** TV tiles (interacting shows tomorrow's weather forecast), keyed by "tx,ty". */
  private tvs = new Set<string>();
  /** Power-cast state: holding the rod button charges distance (Stardew hold-to-cast-further). */
  private castCharging = false;
  private castCharge = 0;
  private chargeBg: Phaser.GameObjects.Rectangle | null = null;
  private chargeFill: Phaser.GameObjects.Rectangle | null = null;
  /** Once-per-day guard for the 2am pass-out. */
  private passingOut = false;
  /** Previous-frame hold state, for fresh-press detection (rod actions are press-driven). */
  private prevHolding = false;
  /** The fishing bobber sprite while a cast is live. */
  private bobber: Phaser.GameObjects.Image | null = null;
  /** Small water-contact ripple that gives the bobber a deliberate, readable endpoint. */
  private bobberRipple: Phaser.GameObjects.Ellipse | null = null;
  /** Cardinal casts use the rod icon as a held overlay because the action strip is side-only. */
  /** Rod-only world graphic. Never use a UI/tool icon here: those assets contain their own line. */
  private heldRod: Phaser.GameObjects.Graphics | null = null;
  /** Scene-clock start for the short code-drawn cast flick that replaces the baked-line strip. */
  private rodCastStartedAt = 0;
  /** Live two-tone fishing line, redrawn from the player's hand to the bobber every frame. */
  private fishingLine: Phaser.GameObjects.Graphics | null = null;
  /** Pending fishing timers (bite + miss), cleared on cancel/shutdown. */
  private fishingTimers: Phaser.Time.TimerEvent[] = [];
  /** The "!" bite indicator above the player. */
  private biteMark: Phaser.GameObjects.Text | null = null;
  /** Live ground drops awaiting collection (banked or persisted on scene shutdown). */
  private drops: DroppedItem[] = [];
  /** Today's forage spots drawn in this scene (see ForageSystem); emptied as the keeper picks them. */
  private forage: ForageSprite[] = [];
  /** Bed tiles present in this scene (interacting sleeps), keyed by "tx,ty". */
  private beds = new Set<string>();
  /** Full-screen dark overlay whose alpha tracks the day/night darkness factor. */
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  /** Indoor light and shadow; null outdoors, where the flat night tint is used instead. */
  private interiorLighting: InteriorLighting | null = null;
  /** Connected tilled-soil renderer (dual-grid Wang blob + wet tints), reads GameState.tiles. */
  private soil!: SoilOverlay;
  /** Crop sprites keyed by "tx,ty", redrawn as crop state changes (soil lives in SoilOverlay). */
  private overlay = new Map<string, Phaser.GameObjects.Image>();
  /** Soft plant-foot shadows make the small crop art sit naturally in its soil patch. */
  private cropShadows = new Map<string, Phaser.GameObjects.Ellipse>();
  /** Unsubscribe handle for the one-shot input listener (cleaned on shutdown). */
  private offAction: (() => void) | null = null;
  /** Space key handle for hold-to-repeat tool use. */
  private spaceKey: Phaser.Input.Keyboard.Key | null = null;
  /** True while the left mouse button is held (hold-to-chop toward the cursor). */
  private pointerHeld = false;
  /** Preserve short presses that begin and end between two render frames. */
  private pendingToolPress: 'pointer' | 'keyboard' | 'touch-button' | null = null;
  /** Placing one item consumes that press until release; holding cannot immediately break it. */
  private placementPressConsumed = false;
  /** A press owned by a menu must be released before the world can use that held input. */
  private toolInputNeedsRelease = false;
  /** Last on-screen Use-button press count this scene consumed (see InputBus.toolPressCount). */
  private seenToolPressCount = 0;
  /**
   * The pointer that started the current world press. Multi-touch moves Phaser's shared activePointer
   * to whichever finger moved last (often the joystick thumb), so tool aim follows this finger instead.
   * Null until the first accepted world press in this scene.
   */
  private worldPointer: Phaser.Input.Pointer | null = null;
  /**
   * Touch furniture aim: the top-left tile of the placement ghost. A finger cannot hover like a mouse,
   * so touch play moves the ghost by tapping or dragging the floor. Null whenever nothing is being placed.
   */
  private touchAim: { tx: number; ty: number } | null = null;
  /**
   * The finger currently tapping or dragging the touch placement ghost. `grabDx/Dy` keep the ghost's
   * offset under the finger while dragging; a release that never moved off a tile inside the ghost places it.
   */
  private touchAimDrag: {
    pointerId: number; grabDx: number; grabDy: number; startTx: number; startTy: number;
    insideGhost: boolean; moved: boolean;
  } | null = null;
  /** Countdown between repeated tool swings while holding (ms). */
  private holdTimer = 0;
  /** Highlight showing which tile the next tool use will hit (Stardew-style precision cue). */
  private targetHi!: Phaser.GameObjects.Rectangle;
  /** One shared scene-local blurred placeholder driven only by the transient Cuddle controller. */
  private cuddleEffect!: CuddleEffectRenderer;
  /**
   * Party members walking with the keeper in this scene (CompanionWalkSystem.walkers()), or null in scenes
   * where walkers never appear (Dungeon and Mines bring the whole party themselves; the Jail holds no visitors).
   */
  private walkingParty: PartyCompanions | null = null;

  protected constructor(key: SceneKey) {
    super(key);
  }

  /** Recreate scene-local input, native surfaces, collision and saved furniture at a named spawn. */
  create(): void {
    installCrispText(this);
    this.pendingToolPress = null;
    this.placementPressConsumed = false;
    this.toolInputNeedsRelease = false;
    // A Use-button press made during the previous scene must not replay here.
    this.seenToolPressCount = InputBus.instance.toolPressCount;
    this.worldPointer = null;
    this.touchAim = null;
    this.touchAimDrag = null;
    this.transitioning = true;
    GameState.instance.transitionActive = true;
    markNotReady();
    this.events.on(WORLD_TRANSITION_START, this.lockForTransition, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(WORLD_TRANSITION_START, this.lockForTransition, this));
    this.map = getMapData(this.scene.key as SceneKey);
    this.paintedNodeArt = new Map(this.map.objects.flatMap(obj => obj.painted ? [[`${obj.tx},${obj.ty}`, obj.painted] as const] : []));
    this.furnitureSurfaces = new FurnitureSurfaceRenderer(this);

    const mapWpx = this.map.w * TILE;
    const mapHpx = this.map.h * TILE;

    // Render the entire ground as ONE culled tilemap layer (not thousands of images). This is the
    // fast path big maps require; collision comes from a marked collision index on the same layer.
    this.buildTilemap();

    // The connected tilled-soil overlay (its own dual-grid layer above the terrain stack).
    this.soil = new SoilOverlay(this, this.map.w, this.map.h);

    // Pretty pass: full Wang autotiled terrain (grass base + dirt/water transitions). Visual only —
    // when it succeeds, the flat index layer keeps doing collision invisibly underneath.
    if (renderWangTerrain(this, this.map)) {
      this.groundLayer.setVisible(false);
    } else if (this.renderInterior()) {
      // Plain-floor interiors (the Home) get the room treatment instead: wood floor, walls, doorway.
      this.groundLayer.setVisible(false);
    }

    // Spawn the player at the NAMED pending spawn (never (0,0)). Fail-loud if the id is unknown.
    const spawnId = consumePendingSpawn();
    const spawn = this.map.spawns.find((s) => s.id === spawnId);
    if (!spawn) {
      throw new Error(
        `${this.scene.key}: no spawn "${spawnId}" (have: ${this.map.spawns.map((s) => s.id).join(', ')})`
      );
    }
    this.player = new Player(this, spawn.tx, spawn.ty);
    const resumePlayer = consumePendingResumePlayer();
    if (resumePlayer) {
      if (resumePlayer.x < 0 || resumePlayer.x > mapWpx || resumePlayer.y < 0 || resumePlayer.y > mapHpx) {
        throw new Error(`${this.scene.key}: saved player position (${resumePlayer.x},${resumePlayer.y}) is outside map bounds`);
      }
      this.player.setPosition(resumePlayer.x, resumePlayer.y - FEET_CENTER_DY);
      GameState.instance.player = { ...resumePlayer };
    }
    this.arrival = { spawnId: spawn.id, resumed: resumePlayer !== null };
    this.startGroundSounds();
    this.physics.add.collider(this.player, this.wallLayer);
    this.cuddleEffect = new CuddleEffectRenderer(this);
    // why: self-activity pins belong to the previous scene's actors; this scene's actors re-pin on their first update.
    resetPinnedSelfActivity();

    // Camera + physics bounds = the full big map; camera follows the player (THE camera fix).
    this.cameras.main.setBounds(0, 0, mapWpx, mapHpx);
    this.physics.world.setBounds(0, 0, mapWpx, mapHpx);
    /** Resize only the interior viewport to clear the toolbelt; preserve outdoor view and native zoom. */
    const resizeWorld = (): void => {
      const zoom = worldZoom(this.scale.width, this.scale.height);
      const height = this.map.interior ? interiorViewportHeight(this.scale.width, this.scale.height) : this.scale.height;
      this.cameras.main.setViewport(0, 0, this.scale.width, height).setZoom(zoom);
      this.refreshCameraBounds();
    };
    resizeWorld();
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeWorld);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, resizeWorld));
    this.cameras.main.startFollow(this.player, true, CAMERA_LERP, CAMERA_LERP);

    // Day/night tint: a dark rectangle fixed to the screen (scrollFactor 0) whose alpha tracks the
    // clock. Depth is far above everything (entities use y-depths up to mapHeight px).
    // NOTE: fillAlpha must be 1 — the per-frame setAlpha() multiplies against it (a fillAlpha of 0
    // made the tint permanently invisible). Sized generously because zoom scales scrollFactor-0
    // objects too.
    this.nightOverlay = this.add
      .rectangle(-this.scale.width, -this.scale.height, this.scale.width * 3, this.scale.height * 3, 0x0a0a2a, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(1_000_000)
      .setAlpha(0);

    this.buildWarps();
    this.spawnObjects();
    this.restoreGroundDrops();
    this.renderAllOverlay();
    this.renderExistingPlacements();
    this.bindKeyboard();
    this.bindActions();

    // Target-tile highlight: shows exactly which tile the next swing hits (precision cue). It is a
    // GROUND marker — depth just above soil/crops but below all y-sorted entities, so it never
    // draws across the player's body when facing up (playtester finding F1).
    this.targetHi = this.add
      // A 14px rectangle with a centered 2px stroke occupies exactly one 16px tile.
      .rectangle(0, 0, TILE - 2, TILE - 2)
      .setName('target-tile-highlight')
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffffff, 0.65)
      .setFillStyle(0xffffff, 0.12)
      .setDepth(-7.5);
    this.placementGhost = this.add.image(0, 0, TextureKey.Chest).setOrigin(0.5, 1)
      .setAlpha(0.65).setVisible(false).setName('furniture-placement-preview');

    // Hold-to-chop toward the mouse or finger: left button / finger held = repeated swings at that
    // tile (when in reach). pointerHeld is consumed by the hold loop in update().
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      // HUD releases can stop at their own scene. Do not latch a world hold from a HUD press.
      if (this.toolInputBlocked() || !this.pointerOnWorld(p)) {
        this.toolInputNeedsRelease = true;
        return;
      }
      // Touch decorating: taps and drags aim the ghost; a tap on the ghost places it on release.
      if (p.wasTouch && GameState.instance.placingItem) {
        this.beginTouchAim(p);
        return;
      }
      this.worldPointer = p;
      this.pointerHeld = true;
      this.placementPressConsumed = false;
      this.pendingToolPress = 'pointer';
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveTouchAim(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.touchAimDrag?.pointerId === p.id) {
        this.endTouchAim(p);
        return;
      }
      // Another finger lifting (for example the joystick thumb sliding off its pad) must not end
      // the finger that is still holding the tool on the world.
      if (this.worldPointer && p.id !== this.worldPointer.id) return;
      this.releaseWorldPointer();
    });

    // Clean up on scene stop: bank uncollected drops when capacity permits. A full bag persists
    // their scene/tile so a transition never loses the drop or aborts scene shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('dev-crops-advanced', this.renderAllOverlay, this);
      this.game.events.off('dev-walls-toggle', this.toggleWallsDebug, this);
      this.wallsDebug?.destroy();
      this.wallsDebug = null;
      if (this.offAction) this.offAction();
      this.offAction = null;
      for (const drop of this.drops) {
        if (!GameState.instance.addItem(drop.item, 1)) {
          const tile = worldToTile(drop.x, drop.y);
          GameState.instance.groundDrops.push({
            scene: this.scene.key as SceneKey,
            item: drop.item,
            tx: tile.tx,
            ty: tile.ty,
          });
        }
        drop.destroy();
      }
      this.drops = [];
      // Forage needs no banking: unpicked spots are recomputed from the day on the next visit.
      this.forage = [];
      this.cancelFishing(); // no dangling casts/timers across scenes
      this.cuddleEffect.destroy();
    });
    this.game.events.on('dev-crops-advanced', this.renderAllOverlay, this);
    if (isTestMode()) {
      this.wallsDebug = new WallsDebugView(this, this.map, this.player);
      this.game.events.on('dev-walls-toggle', this.toggleWallsDebug, this);
    }

    // Hook for subclasses to add scene-specific content.
    this.onCreated();
    // why: built after onCreated so the walkable check sees the furniture and fronts the scene just added.
    this.walkingParty = CompanionWalkSystem.walksIn(this.scene.key as SceneKey)
      ? new PartyCompanions(this, (tx, ty) => tx >= 0 && ty >= 0 && tx < this.map.w && ty < this.map.h &&
        !this.map.solid[ty][tx] && !this.staticBodyAt(tx, ty), () => CompanionWalkSystem.walkers(), 'walk')
      : null;
    this.walkingParty?.placeNearKeeper();
    // why: lights are read after onCreated so a room can build its light list from art it just drew.
    const lights = this.interiorLights();
    this.interiorLighting = lights === null ? null : new InteriorLighting(this, mapWpx, mapHpx, lights);
    this.spawnForage();

    // Register test-only scene hooks (teleport/nodes/sleep) so specs can act deterministically.
    this.registerTestHooks();

    // Do not let a held doorway key or menu action leak through the arrival fade. Readiness
    // means input is available, not merely that the destination scene's objects exist.
    this.cameras.main.once('camerafadeincomplete', () => {
      InputBus.instance.clearAll();
      this.transitioning = false;
      GameState.instance.transitionActive = false;
      markReady();
    });
    this.cameras.main.fadeIn(WORLD_FADE_MS, 0, 0, 0);
  }

  /**
   * Place the player at a tile center and optionally set facing. Test-only helper (used via the
   * seam) so specs can position the player next to a specific target without walking there.
   */
  protected teleport(tx: number, ty: number, facing?: Facing): void {
    const wx = tx * TILE + TILE / 2;
    const wy = ty * TILE + TILE / 2;
    // Place the FEET on the tile center (the sprite is drawn FEET_CENTER_DY higher).
    this.player.setPosition(wx, wy - FEET_CENTER_DY);
    const gs = GameState.instance;
    gs.player.x = wx;
    gs.player.y = wy;
    if (facing) gs.player.facing = facing;
  }

  /**
   * Show or hide the walls debug overlay (the 'dev-walls-toggle' game event, sent by UIScene on F9).
   * @throws when called outside test mode, where the overlay is never made (the listener is test-only)
   */
  private toggleWallsDebug(): void {
    if (!this.wallsDebug) throw new Error(`${this.scene.key}: walls debug toggled outside test mode`);
    this.wallsDebug.toggle();
  }

  /** Register the test hooks this scene can service. */
  private registerTestHooks(): void {
    registerSceneTestHooks({
      teleport: (tx, ty, facing) => this.teleport(tx, ty, facing as Facing | undefined),
      nodes: () =>
        [...this.nodes.values()].map((n) => ({ tx: n.tx, ty: n.ty, kind: n.kind, stage: n.stage })),
      sleep: () => this.sleep(),
      place: (type, tx, ty, w, h) => this.placeBuilding(type, tx, ty, w, h),
      groundAt: (tx, ty) => this.map.ground[ty]?.[tx] ?? 'grass',
    });
  }

  /**
   * Attempt to place a building in THIS scene via PlacementSystem. On success, draw a visible
   * footprint rectangle and return true; on failure, return false (nothing changes). This is the
   * seam the Prompt-2 carpenter/shop-buying flow will call.
   */
  protected placeBuilding(type: string, tx: number, ty: number, w: number, h: number): boolean {
    const res = PlacementSystem.tryPlace(this.map, this.scene.key as SceneKey, type, tx, ty, w, h);
    if (!res.ok) return false;
    this.renderPlacement(res.placement.tx, res.placement.ty, w, h);
    return true;
  }

  /** Redraw buildings already placed in this scene (persisted in GameState) on (re)entry. */
  private renderExistingPlacements(): void {
    for (const p of GameState.instance.placements) {
      if (p.scene === (this.scene.key as SceneKey)) {
        this.renderPlacement(p.tx, p.ty, p.w, p.h);
      }
    }
  }

  /** Draw a placed building's footprint (placeholder rect; real art comes later). */
  private renderPlacement(tx: number, ty: number, w: number, h: number): void {
    this.add
      .rectangle(tx * TILE, ty * TILE, w * TILE, h * TILE, 0x8a5a3b, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x5a3a26)
      .setDepth(-7);
  }

  /**
   * Sleep → day rollover: advance the day counter, restore stamina, grow watered crops, reset the
   * clock to morning. Crop growth (M4) and stamina/day (M6) both live here since a night's sleep is
   * a single atomic transition. After changing state, refresh the soil/crop overlay so grown crops
   * render at their new stage. Rendering the world tint for day/night is handled per-frame in M6.
   */
  protected sleep(staminaFrac = 1, autosave = true): void {
    const gs = GameState.instance;
    // Overnight rain (Stardew model): if TOMORROW is rainy, the rain falls during this night —
    // unwatered crops grow as if watered, and the player wakes to rain-wet farmland below.
    const rained = WeatherSystem.forDay(gs.day + 1) === 'rain';
    if (rained) {
      // why: ALL scenes' crops (keys are `${scene}:...`) — rain falls on every outdoor map, and
      // soil can only exist outdoors (the hoe needs grass). Same for the re-wet pass below.
      for (const k of Object.keys(gs.crops)) gs.crops[k].watered = true;
    }
    // Finish every authored meeting before the calendar rolls. This also covers early bedtimes.
    syncTownSocialLife(gs.day, 24 * 60);
    CropSystem.advanceDay(); // watered (incl. rain-watered) crops bank a growth day; soil dries
    gs.day += 1;
    // why: the mayor's welcome walk only happens on day 1; a night always closes it (matches the v17 migration).
    gs.progress.mayorMet = true;
    GuildBoardSystem.refresh(); // Seren takes down an expired job and pins today's.
    TownLifeSystem.refreshDay(); // Old favors and invites expire; a resident may post a new favor.
    KeeperSocialSystem.refreshDay(); // Daily rounds, cards, and flirts reset; yesterday's plans drop.
    TavernSystem.onNewDay(); // Reset service before the overnight save; no repeated daily quota.
    // Morning mail: letters due today (by date, shop progress or friendship) arrive in the farm mailbox.
    const arrived = deliverMail(gs.mail, gs.mailProgress());
    if (arrived.length > 0) {
      this.game.events.emit('toast', arrived.length === 1 ? `New mail from ${arrived[0].from}` : `${arrived.length} new letters in your mailbox`);
    }
    gs.tavernPanel = null;
    gs.marketPanelOpen = false;
    gs.civicServiceBuilding = null;
    gs.timeOfDay = 0; // back to 06:00
    StaminaSystem.restore(staminaFrac); // < 1 when passing out at 2am
    VitalitySystem.restoreManaOnSleep(); // a night's sleep refills taught mana
    if (rained) {
      // advanceDay dried the soil; the morning rain re-wets every tilled tile + crop, feeding
      // TONIGHT's growth too (rain = a free watering day, exactly like Stardew).
      for (const k of Object.keys(gs.tiles)) gs.tiles[k] = 'watered';
      for (const k of Object.keys(gs.crops)) gs.crops[k].watered = true;
      this.game.events.emit('toast', 'It rained overnight — your crops are watered.');
    }
    // The shipping bin pays out overnight. Capture WHAT sold (per-item lines) BEFORE payout clears
    // the bin, then show the Stardew-style morning sell report (UIScene renders gs.daySummary;
    // E/click dismisses it).
    const lines = Object.entries(gs.bin).map(([item, qty]) => {
      const unit = ITEM_VALUES[item] ?? 0;
      return { item, qty, unit, total: qty * unit };
    });
    const earned = ShippingSystem.payout();
    if (earned > 0) Sfx.play('harvest');
    gs.daySummary = { day: gs.day, lines, total: earned, gold: gs.gold };
    // Overnight node lifecycle (TreeSystem): saplings/small trees grow a stage, weeds regrow, and
    // cleared tree spots sprout saplings after TREE_REGROW_DAYS; then re-sync this scene's live
    // node sprites so the changes are visible without a scene re-entry.
    TreeSystem.advanceDay();
    this.respawnNodes();
    this.spawnForage(); // a new day lays out new finds in the scene the keeper woke in
    this.renderAllOverlay();
    // Sleep is the one natural autosave point. Direct test/dev world boot has no active slot, so
    // saveCurrent() explicitly returns null and writes no arbitrary storage key.
    if (autosave) SaveSystem.saveCurrent();
  }

  /** Jail overrides this narrow gate so walking and bed use remain, while tools and panels stay locked. */
  protected restrictPlayerActions(): boolean {
    return false;
  }

  /**
   * Re-sync live resource-node sprites with what GameState says should stand on each map object
   * spot (called after a day rollover): spawn regrown weeds/saplings, and swap staged trees whose
   * stage advanced overnight. Never spawns a node under the player's feet or through farmed soil.
   */
  private respawnNodes(): void {
    const gs = GameState.instance;
    const feet = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY);
    for (const obj of this.map.objects) {
      if (obj.kind !== 'tree' && obj.kind !== 'rock' && obj.kind !== 'weed') continue;
      const k = `${obj.tx},${obj.ty}`;
      if (gs.plantedTrees[`${this.scene.key}:${k}`]) continue;
      if (gs.removedNodes[`${this.scene.key}:${k}`]) continue; // still cleared
      const live = this.nodes.get(k);
      if (obj.kind === 'tree') {
        const s = TreeSystem.stageAt(this.scene.key as SceneKey, obj.tx, obj.ty);
        const wantKind = s === 'stump' ? 'stump' : 'tree';
        const wantStage = s === 'stump' ? undefined : s;
        if (live && live.kind === wantKind && live.stage === wantStage) continue;
        if (!live && feet.tx === obj.tx && feet.ty === obj.ty) continue; // not under the player
        if (live) {
          live.destroy();
          this.nodes.delete(k);
        }
        this.spawnNode('tree', obj.tx, obj.ty);
      } else {
        if (live) continue;
        if (feet.tx === obj.tx && feet.ty === obj.ty) continue; // not under the player
        // Soil/crop keys are scene-scoped — check THIS scene's entry for the tile.
        if (gs.tiles[`${this.scene.key}:${k}`] || gs.crops[`${this.scene.key}:${k}`]) continue;
        this.spawnNode(obj.kind, obj.tx, obj.ty);
      }
    }
    this.syncPlantedTrees();
  }

  /** Spawn independent player-planted trunks and replace their visuals after growth or felling. */
  private syncPlantedTrees(): void {
    const prefix = `${this.scene.key}:`;
    for (const [key, tree] of Object.entries(GameState.instance.plantedTrees)) {
      if (!key.startsWith(prefix)) continue;
      const local = key.slice(prefix.length);
      const [tx, ty] = local.split(',').map(Number);
      const live = this.nodes.get(local);
      const kind = tree.stage === 'stump' ? 'stump' : 'tree';
      const stage = tree.stage === 'stump' ? undefined : tree.stage;
      if (live && live.kind === kind && live.stage === stage) continue;
      if (live) { live.destroy(); this.nodes.delete(local); }
      this.spawnNode('tree', tx, ty);
    }
  }

  /**
   * The tile a walking companion stands on in this scene.
   * @param id a resident who is walking with the keeper
   * @returns the follower's feet tile
   * @throws when this scene has no follower for that resident (walkers never appear here, or the roster
   *   was not synced this frame)
   */
  protected companionTile(id: ResidentId): { tx: number; ty: number } {
    const member = this.walkingParty?.members.find(candidate => candidate.residentId === id);
    if (!member) throw new Error(`${this.scene.key}: ${id} is walking with the keeper but has no follower here`);
    return { tx: Math.floor(member.x / TILE), ty: Math.floor(member.y / TILE) };
  }

  /** Subclass hook, called at end of create(). Default no-op. */
  protected onCreated(): void {}

  /**
   * The world rectangle (px) the camera may show. Default: the whole map. A scene that shows only part
   * of its map at a time (the dungeon's separate rooms) returns that part and calls refreshCameraBounds()
   * whenever it changes.
   * @returns left, top, width and height in world px
   */
  protected cameraArea(): { x: number; y: number; w: number; h: number } {
    return { x: 0, y: 0, w: this.map.w * TILE, h: this.map.h * TILE };
  }

  /**
   * Fit the main camera's bounds to cameraArea() for the current viewport and zoom.
   * why: an area smaller than the view stays centred in the window. Only the camera padding grows;
   * the authored room, physics bounds, sprite scale and normal follow behaviour stay unchanged.
   */
  protected refreshCameraBounds(): void {
    const camera = this.cameras.main, area = this.cameraArea();
    const viewW = camera.width / camera.zoom, viewH = camera.height / camera.zoom;
    camera.setBounds(area.x + Math.min(0, (area.w - viewW) / 2), area.y + Math.min(0, (area.h - viewH) / 2),
      Math.max(area.w, viewW), Math.max(area.h, viewH));
  }

  /**
   * Indoor rooms return their light sources (see src/config/InteriorLights.ts) to get lamp-lit shadows instead of
   * the flat outdoor night tint. Outdoor scenes keep this default.
   * @returns the room's lights, or null for an outdoor scene
   */
  protected interiorLights(): readonly InteriorLight[] | null {
    return null;
  }

  /** Optional scene-owned interaction handled before generic props/tools. */
  protected handleWorldInteraction(_tx: number, _ty: number): boolean {
    return false;
  }

  /** Allow business scenes to expose management independently from direct guest interaction. */
  protected handleShopManagement(): void {}

  /** Business scenes consume held goods or tools before generic farm tool handling. */
  protected handleHeldItemUse(_item: string): boolean { return false; }

  /** Stop input/physics once a validated entrance owns the keeper; scene shutdown ends the lock. */
  private lockForTransition(): void {
    this.pendingToolPress = null;
    this.transitioning = true;
    GameState.instance.transitionActive = true;
    markNotReady();
    InputBus.instance.clearAll();
    this.pointerHeld = false;
    this.prevHolding = false;
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    this.targetHi.setVisible(false);
  }

  /** Whether a walk-through doorway may take control; menus and unfinished tool use retain ownership. */
  protected canEnterDoor(): boolean {
    const gs = GameState.instance;
    return !this.transitioning && !this.player.busy && !this.castCharging && !gs.paused && !gs.pauseConfirmOpen &&
      !gs.appearanceEditorOpen && !gs.inventoryOpen && !gs.chestOpen && !gs.binOpen && !gs.craftingOpen &&
      gs.tavernPanel === null && !gs.marketPanelOpen && gs.dialogue === null && gs.daySummary === null && gs.fishing === null &&
      // A selected belt stack is equipment, not a modal: carrying it must not block walk-in doors.
      (gs.placingItem === null || gs.placingSource === 'toolbelt');
  }

  /** Validate and lock a doorway once, then let the scene finish its entrance animation before fading. */
  protected enterWarp(warp: WarpDef): void {
    if (!this.canEnterDoor()) return;
    validateDestination(warp.target, warp.spawn);
    this.lockForTransition();
    this.animateEntrance(warp, () => transitionTo(this, warp.target, warp.spawn));
  }

  /** Scene-owned entrance art hook; ordinary world-edge warps have no door to animate. */
  protected animateEntrance(_warp: WarpDef, onReady: () => void): void {
    onReady();
  }

  /**
   * Room rendering for plain-floor interiors (the Home): a wood-plank floor, a brick/timber wall
   * band along the top and side trims, and a visible doorway (mat + frame gap) at each warp on the
   * bottom row — so the inside actually looks like an inside and you can SEE where the door is.
   * Purely visual; collision stays on the invisible index layer. Returns false when the map isn't
   * a floor interior or the interior art isn't loaded (flat strip stays visible then).
   * Maps with `interior` set: 'built' rooms get the shared stone-and-oak art; 'painted' rooms draw
   * nothing here (their scene adds the painting), but the flat strip is still hidden.
   */
  private renderInterior(): boolean {
    if (this.map.interior) {
      // why: a painted room's scene draws its own painting in onCreated(); the shared tile art would sit under it unseen.
      if (this.map.interior.kind === 'built') renderShopInterior(this, this.map);
      return true;
    }
    const isFloorInterior =
      this.map.ground.every((row) => row.every((g) => g === 'floor')) &&
      this.textures.exists('tile-floor-wood') &&
      this.textures.exists('tile-wall-wood');
    if (!isFloorInterior) return false;

    const wPx = this.map.w * TILE;
    const hPx = this.map.h * TILE;

    // Floor: one TileSprite tiles the whole room cheaply.
    this.add.tileSprite(0, 0, wPx, hPx, 'tile-floor-wood').setOrigin(0, 0).setDepth(-15);
    // Wall band across the top (the border row + one visual row of wall height).
    this.add.tileSprite(0, 0, wPx, TILE * 2, 'tile-wall-wood').setOrigin(0, 0).setDepth(-14);
    // Side + bottom trims (thin dark edging so the room reads enclosed).
    const trim = 0x241a12;
    this.add.rectangle(0, 0, 4, hPx, trim, 1).setOrigin(0, 0).setDepth(-14);
    this.add.rectangle(wPx - 4, 0, 4, hPx, trim, 1).setOrigin(0, 0).setDepth(-14);
    this.add.rectangle(0, hPx - 4, wPx, 4, trim, 1).setOrigin(0, 0).setDepth(-14);

    // Doorways: for each warp, a floor mat + a lighter gap in the trim so the exit is obvious.
    for (const warp of this.map.warps) {
      const x = warp.tx * TILE;
      const y = warp.ty * TILE;
      const w = warp.w * TILE;
      if (warp.doorFacing === 'north') {
        // A rear doorway opens through the wall, not through the floor like a southern exit.
        this.add.rectangle(x, 4, w, TILE * 2 - 4, 0x342b2b).setOrigin(0, 0).setDepth(-12);
        this.add.rectangle(x - 3, 3, 3, TILE * 2 + 3, 0x986846).setOrigin(0, 0).setDepth(TILE * 2 + 3);
        this.add.rectangle(x + w, 3, 3, TILE * 2 + 3, 0x986846).setOrigin(0, 0).setDepth(TILE * 2 + 3);
        this.add.rectangle(x - 3, 1, w + 6, 4, 0xc69863).setOrigin(0, 0).setDepth(TILE * 2 + 4);
        this.add.rectangle(x, TILE * 2, w, 3, 0xc69863).setOrigin(0, 0).setDepth(-11);
        continue;
      }
      this.add
        .rectangle(x, y + TILE - 6, w, 6, 0x8a5a3b, 1)
        .setOrigin(0, 0)
        .setDepth(-13); // door mat
      this.add
        .rectangle(x, y + TILE - 4, w, 4, 0xc8a06a, 1)
        .setOrigin(0, 0)
        .setDepth(-12); // light spilling in through the gap
    }
    return true;
  }

  /** Spawn resource nodes, chests, beds, decor, and buildings from the map definition. */
  private spawnObjects(): void {
    const gs = GameState.instance;
    this.nodes.clear();
    this.chests.clear();
    this.tvs.clear();
    this.placedSprites.clear();
    this.nodeGroup = this.physics.add.staticGroup();
    const chestGroup = this.physics.add.staticGroup();
    this.chestGroup = chestGroup;
    for (const obj of this.map.objects) {
      if (obj.kind === 'tree' || obj.kind === 'rock' || obj.kind === 'weed') {
        if (gs.plantedTrees[`${this.scene.key}:${obj.tx},${obj.ty}`]) continue;
        // Skip nodes the player already cleared (so chopped trees don't respawn on re-entry),
        // and never spawn one through farmed soil (a cleared-then-tilled spot is farmland now).
        if (gs.removedNodes[`${this.scene.key}:${obj.tx},${obj.ty}`]) continue;
        // Soil/crop keys share the same `${scene}:${tx},${ty}` format as removedNodes.
        if (
          gs.tiles[`${this.scene.key}:${obj.tx},${obj.ty}`] ||
          gs.crops[`${this.scene.key}:${obj.tx},${obj.ty}`]
        )
          continue;
        this.spawnNode(obj.kind, obj.tx, obj.ty);
      } else if (obj.kind === 'chest') {
        const chest = new Chest(this, obj.tx, obj.ty);
        chest.setDepth(chest.y); // bottom-anchored
        chestGroup.add(chest);
        this.chests.add(`${obj.tx},${obj.ty}`);
      } else if (obj.kind === 'bed') {
        // The bed occupies a 2-tile-wide footprint with REAL collision (it was previously a bare
        // image you could walk through). Centered between obj tile and the next; base = both tiles.
        const bed = this.add
          .image((obj.tx + 1) * TILE, obj.ty * TILE + TILE, TextureKey.Bed)
          .setOrigin(0.5, 1)
          .setDepth(obj.ty * TILE + TILE);
        this.physics.add.existing(bed, true);
        const body = (bed as unknown as { body: Phaser.Physics.Arcade.StaticBody }).body;
        // Full visual footprint (2x2 tiles): you can't slip behind the headboard and have the bed
        // draw over you — Stardew beds are solid furniture.
        body.setSize(TILE * 2, TILE * 2, false);
        body.position.set(obj.tx * TILE, (obj.ty - 1) * TILE);
        body.updateCenter();
        chestGroup.add(bed as unknown as Phaser.GameObjects.GameObject); // reuse the static collide group
        this.beds.add(`${obj.tx},${obj.ty}`);
        this.beds.add(`${obj.tx + 1},${obj.ty}`); // either tile counts for E-to-sleep
      } else if (obj.kind === 'painted-bed') {
        // The bed is part of the room's painting and its two tiles are solid in the map, so there is
        // no sprite or body here: only the E-to-sleep tiles.
        if (!this.map.solid[obj.ty][obj.tx] || !this.map.solid[obj.ty][obj.tx + 1]) {
          throw new Error(`${this.scene.key}: painted bed at ${obj.tx},${obj.ty} must sit on solid tiles`);
        }
        this.beds.add(`${obj.tx},${obj.ty}`);
        this.beds.add(`${obj.tx + 1},${obj.ty}`);
      } else if (obj.kind === 'bin') {
        // The deposit trunk is solid across every visible pixel. A base-only 32x16 body left the
        // upper ten pixels and four pixels on each side walkable even though the 40x26 art was
        // plainly present there.
        const binW = TILE * 2 + 8;
        const binH = TILE + 10;
        const bin = new Prop(this, 'shipping-bin', obj.tx, obj.ty, binW, binH, binW / TILE, binH / TILE);
        chestGroup.add(bin);
        this.bins.add(`${obj.tx},${obj.ty}`);
      } else if (obj.kind === 'tv') {
        // The TV: solid furniture + E = tomorrow's weather forecast (see the interact chain).
        const tv = new Prop(this, 'tv', obj.tx, obj.ty, TILE + 6, TILE + 10);
        chestGroup.add(tv);
        this.tvs.add(`${obj.tx},${obj.ty}`);
      } else if (obj.kind === 'table') {
        chestGroup.add(new Prop(this, 'furniture-table', obj.tx, obj.ty, TILE + 6, TILE + 8));
      } else if (obj.kind === 'chair') {
        chestGroup.add(new Prop(this, 'furniture-chair', obj.tx, obj.ty, TILE, TILE + 6));
      } else if (obj.kind === 'shelf') {
        chestGroup.add(new Prop(this, 'store-shelf', obj.tx, obj.ty, TILE + 4, TILE + 12));
      } else if (obj.kind === 'kitchen-counter') {
        // 3-tile counter: obj.tx is the LEFT tile; Prop takes the CENTER tile + a 3-tile body.
        chestGroup.add(
          new Prop(this, 'kitchen-counter', obj.tx + 1, obj.ty, TILE * 3, TILE + 10, 3)
        );
      }
    }
    this.physics.add.collider(this.player, this.nodeGroup);
    this.syncPlantedTrees();
    this.physics.add.collider(this.player, chestGroup);

    // Player-placed items persisted in GameState (Stardew rule: placeable anywhere not blocked).
    for (const p of GameState.instance.placedItems) {
      if (p.scene === (this.scene.key as SceneKey)) this.spawnPlacedItem(p.item, p.tx, p.ty, p.rotation);
    }

    // Non-blocking decor (bushes/flowers) — pure life, no physics.
    for (const d of this.map.decor) {
      if (!this.textures.exists(d.kind)) continue;
      const img = this.add
        .image(d.tx * TILE + TILE / 2, d.ty * TILE + TILE, d.kind)
        .setOrigin(0.5, 1)
        .setDepth(d.ty * TILE + TILE);
      // Rugs are FLOOR decor: they must render under every entity (walk OVER them), not y-sort.
      if (d.kind === 'rug') img.setDepth(-8.5);
    }

    // Building facades (solid footprints already baked into the map's solid grid). Only the mines
    // cave-entrance uses this today — the town facades were cut pending real (Sunnyside-era) art.
    for (const b of this.map.buildings) {
      if (!this.textures.exists(b.tex)) continue;
      this.add
        .image((b.tx + b.wTiles / 2) * TILE, (b.ty + 1) * TILE, b.tex)
        .setOrigin(0.5, 1)
        .setDepth((b.ty + 1) * TILE);
    }
  }

  /**
   * Spawn one resource node at a tile, resolving a map 'tree' through its GameState stage
   * (sapling/small/full, or the stump left by felling a full one). The single spawn path for
   * create(), day-rollover respawns, and the stump swap-in.
   * On a painted map, a rock or a full tree at a painted node's tile draws its painted frame.
   * @param mapKind the map object's kind ('tree', 'rock', 'weed')
   * @param tx tile x
   * @param ty tile y
   * @returns the live node (also added to nodeGroup and nodes)
   */
  private spawnNode(mapKind: string, tx: number, ty: number): ResourceNode {
    let kind = mapKind;
    let stage: TreeStage | undefined;
    if (mapKind === 'tree') {
      const s = TreeSystem.stageAt(this.scene.key as SceneKey, tx, ty);
      if (s === 'stump') kind = 'stump';
      else stage = s;
    }
    const art = this.paintedNodeArt.get(`${tx},${ty}`);
    // why: a felled tree's stump and its regrowth (sapling, young tree) are not in the painting, so they use normal art.
    const painted = art && (kind === 'rock' || (kind === 'tree' && stage === 'full')) ? art : undefined;
    const node = new ResourceNode(this, kind, tx, ty, stage, painted);
    node.setDepth(node.y); // y-sort: bottom-anchored, so depth = base y
    this.nodeGroup.add(node);
    this.nodes.set(`${tx},${ty}`, node);
    return node;
  }

  /** Spawn from a top-left footprint; all art and physics share the same native view definition. */
  private spawnPlacedItem(item: string, tx: number, ty: number, rotation: Rotation): void {
    // Floor items (rug) share tiles with blocking items, so they get their own sprite key.
    const k = `${tx},${ty}`;
    if (item === 'chest') {
      const chest = new Chest(this, tx, ty);
      chest.setDepth(chest.y); // bottom-anchored
      this.chestGroup.add(chest);
      this.chests.add(k);
      this.placedSprites.set(k, chest);
    } else {
      const view = furnitureView(item, rotation);
      if (!this.textures.exists(view.texture)) throw new Error(`Furniture: missing texture "${view.texture}"`);
      const presentation = this.furnitureSurfaces.resolve({ item, tx, ty, rotation, scene: this.scene.key as SceneKey },
        GameState.instance.placedItems);
      if (PLACEABLE_DEF[item].blocking) {
        // Prop accepts a center tile; durable placement always stores the top-left corner.
        const prop = new Prop(this, presentation.texture, tx + (view.w - 1) / 2, ty + view.h - 1,
          view.displayW, view.displayH, view.w, view.h, presentation.frame, view.angle).setName(`furniture-${item}-${tx}-${ty}`);
        // why: chairs tuck under a same-row tabletop; see furnitureDepth.
        prop.setDepth(furnitureDepth(item, ty, view.h));
        this.chestGroup.add(prop);
        if (item === 'workbench') this.workbenches.add(k);
        this.placedSprites.set(k, prop);
      } else {
        const floor = this.add.image((tx + view.w / 2) * TILE, (ty + view.h) * TILE, presentation.texture, presentation.frame)
          .setOrigin(view.originX, view.originY).setAngle(view.angle).setDisplaySize(view.displayW, view.displayH).setDepth(-8.5)
          .setName(`furniture-${item}-${tx}-${ty}`);
        this.placedSprites.set(`${k}#floor`, floor);
      }
    }
  }

  /** Rebuild only native surface pixels after a layout edit; existing indexed physics bodies stay untouched. */
  private refreshFurnitureSurfaces(): void {
    const layout = GameState.instance.placedItems;
    for (const piece of layout) {
      if (piece.scene !== this.scene.key || (piece.item !== 'table' && piece.item !== 'rug')) continue;
      this.furnitureSurfaces.resolve(piece, layout);
    }
  }

  /** Check every real solid body, including authored beds, shelves and porch geometry. */
  private tileBlocked(tx: number, ty: number): boolean {
    const x = tx * TILE, y = ty * TILE;
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    // Feet can straddle a tile edge. Reject every intersecting cell, not only their center tile.
    if (x < playerBody.right && x + TILE > playerBody.x && y < playerBody.bottom && y + TILE > playerBody.y) return true;
    return this.staticBodyAt(tx, ty);
  }

  /** True when any enabled static body (furniture, beds, porch, nodes) overlaps the tile. */
  private staticBodyAt(tx: number, ty: number): boolean {
    const x = tx * TILE, y = ty * TILE;
    return this.physics.world.staticBodies.entries.some(body => body.enable &&
      x < body.right && x + TILE > body.x && y < body.bottom && y + TILE > body.y);
  }

  /**
   * Draw today's unpicked forage spots (ForageSystem) for this scene, replacing any already drawn.
   * Called on create and after a night's sleep, so a new day shows new spots without re-entry.
   * Tilled soil, crops, live nodes (and the canopy of live trees, e.g. planted ones) and solid
   * furniture rule a tile out.
   */
  private spawnForage(): void {
    for (const sprite of this.forage) sprite.image.destroy();
    this.forage = [];
    const gs = GameState.instance, key = this.scene.key;
    const spots = ForageSystem.liveSpots(this.map, (tx, ty) =>
      !!gs.tiles[`${key}:${tx},${ty}`] || !!gs.crops[`${key}:${tx},${ty}`] || this.nodes.has(`${tx},${ty}`) || this.staticBodyAt(tx, ty) ||
      // why: a tile is under a live tree's canopy when a tree sits at the inverse canopy offset.
      CANOPY_OFFSETS.some(([dx, dy]) => this.nodes.get(`${tx - dx},${ty - dy}`)?.kind === 'tree'));
    for (const spot of spots) {
      const x = spot.tx * TILE + TILE / 2, y = spot.ty * TILE + TILE / 2;
      const image = this.add.image(x, y, `icon-${spot.item}`).setDisplaySize(14, 14).setDepth(y - 4).setName(`forage-${spot.tx},${spot.ty}`);
      // A slow bob makes a find catch the eye without a second sprite.
      this.tweens.add({ targets: image, y: y - 2, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.forage.push({ spot, image, warned: false });
    }
  }

  /**
   * Walk-over pickup for forage spots; called each frame from update(). A full bag shows one toast
   * per approach and leaves the spot on the ground.
   */
  private updateForage(): void {
    if (this.forage.length === 0) return;
    const fx = this.player.x, fy = this.player.y + FEET_CENTER_DY;
    const remaining: ForageSprite[] = [];
    for (const sprite of this.forage) {
      const near = Math.hypot(sprite.spot.tx * TILE + TILE / 2 - fx, sprite.spot.ty * TILE + TILE / 2 - fy) < FORAGE_PICK_RANGE;
      if (!near) {
        sprite.warned = false;
        remaining.push(sprite);
      } else if (ForageSystem.pick(this.scene.key as SceneKey, sprite.spot)) {
        Sfx.play('harvest');
        this.game.events.emit('toast', `Found ${ITEM_CATALOG[sprite.spot.item].label}`);
        sprite.image.destroy();
      } else {
        if (!sprite.warned) {
          Sfx.play('deny');
          this.game.events.emit('toast', 'Your bag is full.');
          sprite.warned = true;
        }
        remaining.push(sprite);
      }
    }
    this.forage = remaining;
  }

  /** Modals and travel own input; do not queue world actions for a later unblocked frame. */
  private toolInputBlocked(): boolean {
    const gs = GameState.instance;
    return this.restrictPlayerActions() || playerCuddleBusy() || this.transitioning || gs.transitionActive || gs.paused || gs.inventoryOpen || gs.chestOpen ||
      gs.craftingOpen || gs.binOpen || !!gs.dialogue || !!gs.daySummary || !!gs.tavernPanel || gs.marketPanelOpen;
  }

  /**
   * The furniture placement tile. A mouse aims with the cursor anywhere on the floor (no adjacency
   * rule). Touch play aims with the ghost tile the player tapped or dragged (see touchAim).
   */
  private furnitureTarget(): { tx: number; ty: number } {
    if (this.touchAimActive()) return this.placementTouchAim();
    return this.pointerTile(this.input.activePointer);
  }

  /**
   * Whether placement may use the current aim. Mouse aim must sit on visible world, not on the HUD;
   * touch aim is a chosen tile, so a finger resting on the HUD's Place button does not block it.
   */
  private furniturePointerAvailable(): boolean {
    if (this.touchAimActive()) return true;
    return this.pointerOnWorld(this.input.activePointer);
  }

  /**
   * True when `pointer` sits inside this world camera and not on any UIScene control.
   * @param pointer the mouse or finger to test.
   */
  private pointerOnWorld(pointer: Phaser.Input.Pointer): boolean {
    const camera = this.cameras.main;
    if (pointer.x < camera.x || pointer.y < camera.y || pointer.x >= camera.x + camera.width ||
      pointer.y >= camera.y + camera.height) return false;
    if (!this.scene.isActive(SceneKey.UI)) return true;
    const ui = this.scene.get(SceneKey.UI);
    return ui.input.hitTestPointer(pointer).length === 0;
  }

  /**
   * The world tile under a pointer. Parallel UI input can overwrite Pointer.worldX/Y with its own
   * camera, so this inverts this world's camera explicitly.
   * @param pointer the mouse or finger.
   * @returns the tile coordinates under it.
   */
  private pointerTile(pointer: Phaser.Input.Pointer): { tx: number; ty: number } {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return worldToTile(point.x, point.y);
  }

  /** True while furniture is held and the latest input came from a finger (touch aim owns placement). */
  private touchAimActive(): boolean {
    return GameState.instance.placingItem !== null && this.input.activePointer.wasTouch;
  }

  /**
   * The touch placement ghost tile, starting on the tile the keeper faces when placement begins.
   * @returns the current touch aim (created on first use during a placement).
   */
  private placementTouchAim(): { tx: number; ty: number } {
    if (!this.touchAim) this.touchAim = facingTile();
    return this.touchAim;
  }

  /**
   * A finger touched the floor while furniture is held. A touch outside the ghost moves the ghost
   * there; a touch inside it may become a place-tap (on release) or a drag.
   * @param p the finger that touched the world.
   */
  private beginTouchAim(p: Phaser.Input.Pointer): void {
    const gs = GameState.instance;
    const item = gs.placingItem;
    if (!item) throw new Error('Touch placement aim started without a held furniture item.');
    const aim = this.placementTouchAim();
    const tile = this.pointerTile(p);
    const view = furnitureView(item, gs.placingRotation);
    const insideGhost = tile.tx >= aim.tx && tile.tx < aim.tx + view.w && tile.ty >= aim.ty && tile.ty < aim.ty + view.h;
    const anchor = insideGhost ? aim : { tx: tile.tx, ty: tile.ty };
    this.touchAim = anchor;
    this.touchAimDrag = {
      pointerId: p.id, grabDx: tile.tx - anchor.tx, grabDy: tile.ty - anchor.ty,
      startTx: tile.tx, startTy: tile.ty, insideGhost, moved: false,
    };
    if (!insideGhost) Sfx.play('select');
  }

  /**
   * Drag the touch placement ghost with the finger that grabbed it.
   * @param p any moving pointer; only the grabbing finger is used.
   */
  private moveTouchAim(p: Phaser.Input.Pointer): void {
    const drag = this.touchAimDrag;
    if (!drag || drag.pointerId !== p.id || !GameState.instance.placingItem) return;
    const tile = this.pointerTile(p);
    if (tile.tx !== drag.startTx || tile.ty !== drag.startTy) drag.moved = true;
    this.touchAim = { tx: tile.tx - drag.grabDx, ty: tile.ty - drag.grabDy };
  }

  /**
   * The grabbing finger lifted. A tap that began inside the ghost and never left its tile places it.
   * @param p the finger that lifted.
   */
  private endTouchAim(p: Phaser.Input.Pointer): void {
    const drag = this.touchAimDrag;
    if (!drag || drag.pointerId !== p.id) throw new Error('Touch placement release came from a finger that did not grab the ghost.');
    this.touchAimDrag = null;
    if (!drag.insideGhost || drag.moved || !GameState.instance.placingItem || this.toolInputBlocked()) return;
    this.swing(this.placementTouchAim());
  }

  /** End the current world mouse/finger press and its placement latches. */
  private releaseWorldPointer(): void {
    this.pointerHeld = false;
    if (!this.spaceKey?.isDown && !InputBus.instance.toolHeld) {
      this.placementPressConsumed = false;
      this.toolInputNeedsRelease = false;
    }
  }

  /**
   * Turn a new on-screen Use-button press into the same pending press Space makes. A press made
   * while a menu owns input must be released before the world may use it.
   */
  private consumeTouchToolPress(): void {
    const bus = InputBus.instance;
    if (bus.toolPressCount === this.seenToolPressCount) return;
    this.seenToolPressCount = bus.toolPressCount;
    if (this.toolInputBlocked()) {
      this.toolInputNeedsRelease = true;
      return;
    }
    this.placementPressConsumed = false;
    this.pendingToolPress = 'touch-button';
  }

  /** Turn the furniture ghost to its next supported rotation (R key and the touch Rotate button). */
  private rotatePlacement(): void {
    const gs = GameState.instance;
    if (!gs.placingItem || this.transitioning || gs.paused || gs.inventoryOpen || gs.tavernPanel || gs.marketPanelOpen ||
      gs.dialogue || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary) return;
    gs.placingRotation = nextFurnitureRotation(gs.placingItem, gs.placingRotation);
    Sfx.play('select');
  }

  /**
   * One tool swing at `target` (or the facing tile): closes modals, handles item-placement mode
   * and placed-item pickup, plays the action animation, then applies the tool. The single entry
   * point for Space, hold-repeat, mouse swings, and the test seam.
   *
   * `force` (used by the seam's one-shot 'use-tool') applies the tool effect even mid-swing so
   * logic-driving tests stay deterministic; real input paths are feel-gated by the swing lock.
   */
  private swing(target?: { tx: number; ty: number }, opts?: { force?: boolean }): void {
    const gs = GameState.instance;
    if (gs.tavernPanel || gs.marketPanelOpen) return;
    if (gs.dialogue || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary) {
      closeDialogue();
      gs.chestOpen = false;
      gs.craftingOpen = false;
      gs.binOpen = false;
      gs.daySummary = null;
      return;
    }
    if (this.player.busy && !opts?.force) return; // mid-swing
    const t = target ?? (gs.placingItem ? this.furnitureTarget() : facingTile());
    const sceneKey = this.scene.key as SceneKey;

    const heldItem = ToolSystem.activeItem();
    if (heldItem === 'oak-seed' || heldItem === 'pine-seed') {
      const result = TreeSystem.plant(heldItem, t.tx, t.ty, {
        nodeAt: (tx, ty) => this.tileBlocked(tx, ty) ? true : null,
      });
      if (result === 'planted') {
        this.syncPlantedTrees();
        Sfx.play('plant');
        this.game.events.emit('toast', heldItem === 'oak-seed' ? 'Acorn planted' : 'Pine cone planted');
      } else {
        Sfx.play('deny');
        this.game.events.emit('toast', result === 'wrong-scene' ? 'Plant trees on your home farm.' : 'Choose a clear grass tile beside you.');
      }
      return;
    }
    if (heldItem !== null && this.handleHeldItemUse(heldItem)) return;
    // Food and drink on the belt: using it eats or drinks one. Scenes claim theirs first above
    // (the Tavern serves held stew and ale to guests; combat scenes drink potions).
    if (heldItem !== null && VitalitySystem.isConsumable(heldItem)) {
      const result = VitalitySystem.consume(heldItem);
      Sfx.play(result.ok ? 'eat' : 'deny');
      this.game.events.emit('toast', result.message);
      return;
    }

    // Placement mode: this swing places the held item instead of using a tool.
    if (gs.placingItem) {
      if (!this.furniturePointerAvailable()) return;
      const item = gs.placingItem;
      const view = furnitureView(item, gs.placingRotation);
      if (!this.textures.exists(view.texture)) throw new Error(`Furniture: missing texture "${view.texture}"`);
      if (ItemPlacementSystem.canPlace(this.map, t.tx, t.ty, (x, y) => this.tileBlocked(x, y), item, gs.placingRotation)) {
        if (!ItemPlacementSystem.place(item, sceneKey, t.tx, t.ty, gs.placingRotation)) {
          throw new Error(`Furniture: selected item "${item}" is no longer in the backpack`);
        }
        this.spawnPlacedItem(item, t.tx, t.ty, gs.placingRotation);
        this.refreshFurnitureSurfaces();
        ToolSystem.placementCommitted();
        this.placementPressConsumed = true;
        Sfx.play('stash');
        this.game.events.emit('toast', 'Furniture placed');
      } else {
        Sfx.play('deny');
        if (ItemPlacementSystem.layoutLocked(sceneKey)) this.game.events.emit('toast', 'Close both services and wait for guests to leave or check out before decorating.');
        else if (!furnitureAllowedInScene(item, sceneKey)) this.game.events.emit('toast', 'This furniture belongs indoors.');
      }
      return;
    }

    // Breaking a placed item (axe/pickaxe): it DROPS on the ground as a pickup — Stardew rule —
    // rather than teleporting into the bag. Walk over it to collect, then place it elsewhere.
    const tool = ToolSystem.active();
    if (
      (tool === ToolId.Axe || tool === ToolId.Pickaxe) &&
      ItemPlacementSystem.itemAt(sceneKey, t.tx, t.ty)
    ) {
      if (ItemPlacementSystem.layoutLocked(sceneKey)) {
        Sfx.play('deny');
        this.game.events.emit('toast', 'Close both services and wait for guests to leave or check out before decorating.');
        return;
      }
      this.player.playAction('chop');
      const placed = ItemPlacementSystem.itemAt(sceneKey, t.tx, t.ty);
      if (!placed) throw new Error('Furniture: pickup target disappeared before removal');
      // Floor items (rug) live under a "#floor" sprite key so they can share a tile with furniture.
      const k =
        PLACEABLE_DEF[placed.item].blocking === false ? `${placed.tx},${placed.ty}#floor` : `${placed.tx},${placed.ty}`;
      const sprite = this.placedSprites.get(k);
      if (!sprite) throw new Error(`Furniture: missing world entity at ${k}`);
      const item = ItemPlacementSystem.remove(sceneKey, t.tx, t.ty);
      if (!item) throw new Error('Furniture: pickup target disappeared before removal');
      sprite.destroy();
      this.placedSprites.delete(k);
      this.furnitureSurfaces.remove(placed.item, placed.tx, placed.ty);
      this.refreshFurnitureSurfaces();
      this.chests.delete(`${placed.tx},${placed.ty}`);
      this.workbenches.delete(`${placed.tx},${placed.ty}`);
      Sfx.play('chop');
      this.spawnDrops(item, 1, t.tx, t.ty);
      return;
    }

    // Fishing rod: cast at water / hook a bite / reel in. Handled apart from swing anims.
    if (tool === ToolId.Rod) {
      this.handleRod(t);
      return;
    }

    // Normal swing: action animation (when its art is loaded) + tool effect. Each tool has its
    // own Sunnyside strip: hoe = DIG, pickaxe = MINING, scythe = its dedicated harvesting sweep.
    const ACTION: Partial<Record<ToolId, 'chop' | 'dig' | 'mine' | 'sweep' | 'water'>> = {
      [ToolId.Hoe]: 'dig',
      [ToolId.Axe]: 'chop',
      [ToolId.Pickaxe]: 'mine',
      [ToolId.Scythe]: 'sweep',
      [ToolId.WateringCan]: 'water',
    };
    const action = tool ? ACTION[tool] : undefined;
    if (action && !this.player.busy) this.player.playAction(action);
    this.feedback(useActiveTool(this.ctx(), target));
  }

  /** Human-readable item labels for pickup toasts. */
  private static readonly ITEM_LABEL: Record<string, string> = {
    wood: 'Wood',
    stone: 'Stone',
    fiber: 'Fiber',
    chest: 'Chest',
    workbench: 'Workbench',
    parsnip: 'Parsnip',
    potato: 'Potato',
    melon: 'Melon',
    'parsnip-seeds': 'Parsnip Seeds',
    'potato-seeds': 'Potato Seeds',
    'melon-seeds': 'Melon Seeds',
  };

  /**
   * Fishing (rod use): if a bite is live → hook the fish; if a cast is waiting → reel in; else if
   * the target tile is water → cast (bobber + seeded bite timer + miss window).
   */
  private handleRod(t: { tx: number; ty: number }): void {
    const gs = GameState.instance;

    if (gs.fishing?.phase === 'reeling') {
      return; // reel input is continuous, handled in update()
    }
    if (gs.fishing?.phase === 'bite') {
      // Hook! The Stardew reel minigame begins (UIScene draws the bar; update() ticks it).
      FishingSystem.startReel();
      this.clearFishingTimersAndBiteCue();
      Sfx.play('select');
      return;
    }
    if (gs.fishing?.phase === 'waiting') {
      this.cancelFishing(); // reel in
      return;
    }
    this.castAt(t); // immediate 1-tile cast (seam path; real input charges via the hold loop)
  }

  /** Cast the line at a specific water tile (power-cast picks tiles further out). */
  private castAt(t: { tx: number; ty: number }): void {
    if (this.map.ground[t.ty]?.[t.tx] !== 'water') return; // must cast at water
    if (!StaminaSystem.spendForTool()) {
      this.feedback('too-tired');
      return;
    }

    const waitMs = FishingSystem.startCast();
    this.player.playAction('cast'); // the cast animation (no-op until its sheet is loaded)
    Sfx.play('water');
    this.bobber = this.add
      .image(t.tx * TILE + TILE / 2, t.ty * TILE + TILE / 2, 'bobber')
      .setDisplaySize(8, 8)
      .setDepth(t.ty * TILE + TILE);
    this.bobberRipple = this.add
      .ellipse(this.bobber.x, this.bobber.y + 3, 15, 7, 0xffffff, 0.18)
      .setStrokeStyle(2, 0x24506d, 0.9)
      .setDepth(this.bobber.depth - 1);
    // All four facings share one rod-only drawing. The old vertical icon and side cast sheet each
    // contained a baked fishing line, which could never align with the live bobber tether.
    this.rodCastStartedAt = this.time.now;
    this.heldRod = this.add.graphics();
    this.updateHeldRod();
    this.fishingLine = this.add.graphics();
    this.updateFishingLine();
    this.fishingTimers.push(
      this.time.delayedCall(waitMs, () => {
        if (GameState.instance.fishing?.phase !== 'waiting') return;
        FishingSystem.bite();
        Sfx.play('talk');
        this.bobber?.setDisplaySize(6, 6); // dip
        this.biteMark = this.add
          .text(this.player.x, this.player.y - 28, '!', {
            fontSize: '16px',
            color: '#ffd24a',
            stroke: '#000',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1)
          .setDepth(999_998);
        // Miss window: if not hooked in time, the fish gets away.
        this.fishingTimers.push(
          this.time.delayedCall(BITE_WINDOW_MS, () => {
            if (GameState.instance.fishing?.phase === 'bite') {
              this.cancelFishing();
              Sfx.play('deny');
              this.game.events.emit('toast', 'It got away...');
            }
          })
        );
      })
    );
  }

  /**
   * Release a charged cast: distance 1-4 tiles out along the facing direction (Stardew's
   * hold-to-cast-further). Lands on the FURTHEST water tile within the charged reach; if no water
   * lies that way, the line just doesn't go out.
   */
  private releaseCast(): void {
    const gs = GameState.instance;
    if (gs.fishing) return;
    const reach = 1 + Math.round(this.castCharge * 3);
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gs.player.facing];
    const ft = worldToTile(gs.player.x, gs.player.y);
    for (let d = reach; d >= 1; d--) {
      const t = { tx: ft.tx + dir[0] * d, ty: ft.ty + dir[1] * d };
      if (this.map.ground[t.ty]?.[t.tx] === 'water') {
        this.castAt(t);
        return;
      }
    }
    Sfx.play('deny'); // no water within reach in that direction
  }

  /** The little charge meter above the player while holding a cast. */
  private updateChargeBar(): void {
    if (!this.chargeBg) {
      this.chargeBg = this.add.rectangle(0, 0, 22, 5, 0x101018, 0.85).setDepth(999_998);
      this.chargeFill = this.add.rectangle(0, 0, 20, 3, 0x5ad4d4, 1).setOrigin(0, 0.5).setDepth(999_999);
    }
    const x = this.player.x;
    const y = this.player.y - 30;
    this.chargeBg.setPosition(x, y).setVisible(true);
    this.chargeFill!.setPosition(x - 10, y).setScale(this.castCharge, 1).setVisible(true);
  }

  private hideChargeBar(): void {
    this.chargeBg?.setVisible(false);
    this.chargeFill?.setVisible(false);
  }

  /** Cancel any live cast and clean visuals/timers. */
  private cancelFishing(): void {
    FishingSystem.cancel();
    this.clearFishingVisuals();
  }

  private clearFishingVisuals(): void {
    this.clearFishingTimersAndBiteCue();
    this.bobber?.destroy();
    this.bobber = null;
    this.bobberRipple?.destroy();
    this.bobberRipple = null;
    this.heldRod?.destroy();
    this.heldRod = null;
    this.rodCastStartedAt = 0;
    this.fishingLine?.destroy();
    this.fishingLine = null;
  }

  /** Clear bite timing/cue while preserving the bobber and line for the reeling phase. */
  private clearFishingTimersAndBiteCue(): void {
    for (const timer of this.fishingTimers) timer.remove(false);
    this.fishingTimers = [];
    this.biteMark?.destroy();
    this.biteMark = null;
  }

  /** Resolve the hand and animated rod-tip positions for the current directional sprite. */
  private fishingRodPose(): { grip: { x: number; y: number }; tip: { x: number; y: number } } {
    const x = this.player.x;
    const y = this.player.y;
    const pose = {
      up: { grip: { x: x - 4, y: y - 7 }, tip: { x: x - 17, y: y - 23 }, windup: { x: x + 9, y: y + 6 } },
      down: { grip: { x: x + 4, y: y + 3 }, tip: { x: x + 18, y: y + 14 }, windup: { x: x - 9, y: y - 18 } },
      left: { grip: { x: x - 5, y: y - 3 }, tip: { x: x - 23, y: y - 7 }, windup: { x: x + 4, y: y - 22 } },
      right: { grip: { x: x + 5, y: y - 3 }, tip: { x: x + 23, y: y - 7 }, windup: { x: x - 4, y: y - 22 } },
    }[GameState.instance.player.facing];
    const elapsed = this.rodCastStartedAt > 0 ? this.time.now - this.rodCastStartedAt : 300;
    const progress = Phaser.Math.Clamp(elapsed / 280, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      grip: pose.grip,
      tip: {
        x: Phaser.Math.Linear(pose.windup.x, pose.tip.x, eased),
        y: Phaser.Math.Linear(pose.windup.y, pose.tip.y, eased),
      },
    };
  }

  /** Redraw the sole one-pixel tether from the rod tip directly to the live bobber. */
  private updateFishingLine(): void {
    if (!this.fishingLine || !this.bobber || !GameState.instance.fishing) return;
    this.updateHeldRod();
    const { tip } = this.fishingRodPose();
    this.fishingLine.clear();
    // One literal straight stroke. No outline, second segment, icon line, or cast-sheet line.
    this.fishingLine.lineStyle(1, 0xf3e0b5, 1)
      .lineBetween(tip.x, tip.y, this.bobber.x, this.bobber.y);
    this.fishingLine.setDepth(this.player.depth + 1);
  }

  /** Draw a compact rod-only pose; the fishing line starts at its tip but is a separate object. */
  private updateHeldRod(): void {
    if (!this.heldRod) return;
    const { grip, tip } = this.fishingRodPose();
    this.heldRod.clear();
    // Dark edge + warm shaft reads as a rod at 2x zoom; neither stroke extends toward the bobber.
    this.heldRod.lineStyle(4, 0x2f241d, 1).lineBetween(grip.x, grip.y, tip.x, tip.y);
    this.heldRod.lineStyle(2, 0xb7763f, 1).lineBetween(grip.x, grip.y, tip.x, tip.y);
    this.heldRod.fillStyle(0xe7b94c, 1).fillCircle(grip.x, grip.y, 2);
    this.heldRod.setDepth(this.player.depth + 2);
  }

  /** Spawn `n` dropped-item pickups at a tile (they hop, then magnet to the player on approach). */
  private spawnDrops(item: string, n: number, tx: number, ty: number): void {
    for (let i = 0; i < n; i++) {
      this.drops.push(new DroppedItem(this, item, tx, ty));
    }
  }

  /** Recreate full-bag drops owned by this scene, removing them from persistence while live. */
  private restoreGroundDrops(): void {
    const gs = GameState.instance;
    const remaining = [];
    for (const drop of gs.groundDrops) {
      if (drop.scene === this.scene.key) this.spawnDrops(drop.item, 1, drop.tx, drop.ty);
      else remaining.push(drop);
    }
    gs.groundDrops = remaining;
  }

  /**
   * Start this map's ground sounds: a quiet footstep per stride on the surface under the feet (see
   * SoundPlans), and the soft loop of the map's running water near its banks (see WaterSound; still ponds
   * and lakes have none, and river water is silent for now, so only the sea plays a loop). Both end with the
   * scene: the keeper's listener goes with its sprite, and the water fades out on shutdown.
   */
  private startGroundSounds(): void {
    const key = this.scene.key as SceneKey;
    this.player.on(PLAYER_FOOTSTEP_EVENT, () => {
      const feet = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY);
      Sfx.step(footSurfaceAt(key, this.map, feet.tx, feet.ty));
    });
    const area = waterArea(key, this.map);
    if (!area) return;
    const player = this.player;
    // why: water is heard from the feet, which stand FEET_CENTER_DY below the sprite's centre.
    const water = new AmbientSoundscape([area], { get x() { return player.x; }, get y() { return player.y + FEET_CENTER_DY; } });
    const update = (): void => water.update();
    this.events.on(Phaser.Scenes.Events.UPDATE, update);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, update);
      water.destroy();
    });
  }

  /** Magnetism + collection for ground drops; called each frame from update(). */
  private updateDrops(deltaMs: number): void {
    if (this.drops.length === 0) return;
    const remaining: DroppedItem[] = [];
    for (const drop of this.drops) {
      drop.age += deltaMs;
      if (
        drop.magnetTo(this.player.x, this.player.y + FEET_CENTER_DY, deltaMs) &&
        GameState.instance.addItem(drop.item, 1)
      ) {
        Sfx.play('pickup');
        this.game.events.emit('toast', `+1 ${BaseWorldScene.ITEM_LABEL[drop.item] ?? drop.item}`);
        drop.destroy();
      } else {
        remaining.push(drop);
      }
    }
    this.drops = remaining;
  }

  /** The interaction context: lets InteractionSystem affect this scene's on-map objects + overlay. */
  private ctx(): InteractionContext {
    return {
      nodeAt: (tx, ty) => this.nodes.get(`${tx},${ty}`) ?? null,
      hitNode: (tx, ty) => {
        const node = this.nodes.get(`${tx},${ty}`);
        if (!node) throw new Error(`hitNode: no node at ${tx},${ty} (InteractionSystem checks nodeAt first)`);
        return node.takeHit(this.player.x);
      },
      removeNodeAt: (tx, ty) => {
        const k = `${tx},${ty}`;
        const node = this.nodes.get(k);
        if (!node) return;
        const gs = GameState.instance;
        // The look and sound of the break play on a copy of the node's art; the node itself goes at once, so
        // the stump, drops and saved clearing below never wait on an animation.
        // why: the sound is chosen here, not in feedback(), because a sapling and a grown tree both report
        // 'cleared:tree' but one sinks (a chop) and the other falls (a creak and a thump on landing).
        if (node.kind === 'tree' && node.stage !== 'sapling') {
          fellFx(node, this.player.x);
          Sfx.play('fell');
        } else if (node.kind === 'rock') {
          shatterFx(node, this.player.x);
          Sfx.play('crumble');
        } else {
          poofFx(node);
          Sfx.play(node.kind === 'weed' ? 'scythe' : 'chop');
        }
        this.tweens.killTweensOf(node);
        node.destroy();
        this.nodes.delete(k);
        if (node.kind === 'tree' && node.stage === 'full') {
          this.spawnDrops(TreeSystem.seedAt(this.scene.key as SceneKey, tx, ty), 1, tx, ty);
          // Felling a FULL tree leaves its stump behind — chop that separately for extra wood.
          TreeSystem.leaveStump(this.scene.key as SceneKey, tx, ty);
          this.spawnNode('tree', tx, ty); // resolves to the stump via the new stage entry
          return;
        }
        if (node.kind === 'tree' || node.kind === 'stump') {
          TreeSystem.clear(this.scene.key as SceneKey, tx, ty);
          return;
        }
        // Record the clearing (with the day, for regrowth) so the node stays gone on re-entry.
        // why: a cleared stump records kind 'tree' — it's the TREE SPOT that regrows a sapling
        // after TREE_REGROW_DAYS (TreeSystem.advanceDay); rocks stay cleared, weeds regrow daily.
        const recordKind = node.kind === 'stump' ? 'tree' : node.kind;
        gs.removedNodes[`${this.scene.key}:${k}`] = { kind: recordKind, day: gs.day };
      },
      groundAt: (tx, ty) => this.map.ground[ty]?.[tx] ?? 'grass',
      spawnDrop: (item, n, tx, ty) => this.spawnDrops(item, n, tx, ty),
      tillSoil: (tx, ty) => {
        FarmGridSystem.till(tx, ty);
        this.renderOverlayAt(tx, ty);
      },
      waterSoil: (tx, ty) => {
        FarmGridSystem.water(tx, ty);
        this.renderOverlayAt(tx, ty);
      },
      clearSoil: (tx, ty) => {
        FarmGridSystem.clear(tx, ty);
        this.renderOverlayAt(tx, ty);
      },
      plantSeed: (tx, ty, type) => {
        const ok = CropSystem.plant(tx, ty, type);
        this.renderOverlayAt(tx, ty);
        return ok;
      },
      harvestCrop: (tx, ty) => {
        const attempt = CropSystem.harvest(tx, ty);
        if (attempt.status === 'harvested') this.renderOverlayAt(tx, ty);
        return attempt;
      },
      chestAt: (tx, ty) => this.chests.has(`${tx},${ty}`),
      bedAt: (tx, ty) => this.beds.has(`${tx},${ty}`),
      sleepInBed: () => this.sleep(),
    };
  }

  /** Subscribe to one-shot actions and turn results into feedback (SFX + toasts). */
  private bindActions(): void {
    this.offAction = InputBus.instance.onAction((action: OneShotAction) => {
      const gs = GameState.instance;
      if (this.transitioning) return;

      if (action === 'toggle-pause') {
        // The world owns Escape once, so closing the editor cannot also resume on the same event.
        if (isWorldRoutesModalOpen()) {
          setWorldRoutesModalOpen(false);
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        if (gs.relationshipJournalOpen) {
          gs.relationshipJournalOpen = false;
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        if (gs.appearanceEditorOpen) {
          gs.appearanceEditorOpen = false;
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        if (gs.tavernPanel) {
          gs.tavernPanel = null;
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        if (gs.marketPanelOpen) {
          gs.marketPanelOpen = false;
          gs.civicServiceBuilding = null;
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        if (gs.pauseConfirmOpen) {
          gs.pauseConfirmOpen = false;
          Sfx.play('select');
          return;
        }
        if (gs.paused) {
          gs.paused = false;
          InputBus.instance.clearAll();
          Sfx.play('select');
          return;
        }
        // why: Escape while typing at the Wayfarer table drops the line and returns to the table's buttons.
        // Closing the whole table here would throw away the evening by accident; a second Escape leaves.
        if (gs.dialogue?.kind === 'wayfarer-table' && wayfarerTableTyping()) {
          cancelWayfarerTableTyping();
          Sfx.play('select');
          return;
        }
        // Escape closes the top gameplay modal first; a second press opens pause.
        if (gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.dialogue || gs.daySummary) {
          gs.inventoryOpen = false;
          gs.chestOpen = false;
          gs.craftingOpen = false;
          gs.binOpen = false;
          closeDialogue();
          gs.daySummary = null;
          Sfx.play('select');
          return;
        }
        gs.paused = true;
        this.pointerHeld = false;
        this.prevHolding = false;
        this.castCharging = false;
        this.hideChargeBar();
        InputBus.instance.clearAll();
        if (this.player.body) (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        // Capture the exact stopped feet position before the update gate begins; otherwise a final
        // physics step can make serialized pause state lag the visible player by a pixel or two.
        gs.player.x = this.player.x;
        gs.player.y = this.player.y + FEET_CENTER_DY;
        Sfx.play('select');
        return;
      }
      if (this.restrictPlayerActions() && action !== 'interact') {
        this.game.events.emit('toast', 'The cell door is locked. The bed is the only way to pass the night.');
        InputBus.instance.clearAll();
        return;
      }
      if (gs.paused) return;
      if (gs.tavernPanel) {
        if (action === 'interact') {
          gs.tavernPanel = null;
          InputBus.instance.clearAll();
          Sfx.play('select');
        }
        return;
      }
      if (gs.marketPanelOpen) {
        if (action === 'interact') {
          gs.marketPanelOpen = false;
          gs.civicServiceBuilding = null;
          InputBus.instance.clearAll();
          Sfx.play('select');
        }
        return;
      }

      if (action === 'rotate-placement') {
        this.rotatePlacement();
        return;
      }
      // The Mines scene owns its dodge roll through its own subscription; other worlds ignore it.
      if (action === 'dodge') return;
      if (action === 'toggle-inventory') {
        if (gs.daySummary || gs.chestOpen || gs.binOpen || gs.craftingOpen || gs.dialogue) return;
        gs.inventoryOpen = !gs.inventoryOpen;
        InputBus.instance.clearAll();
        Sfx.play('select');
        return;
      }
      if (action === 'manage-shop') {
        if (gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.dialogue || gs.daySummary || gs.placingItem) return;
        this.handleShopManagement();
        return;
      }
      if (action.startsWith('hotbar:')) {
        const idx = Number(action.slice('hotbar:'.length));
        if (Number.isInteger(idx)) {
          ToolSystem.select(idx);
          Sfx.play('select');
        }
        return;
      }
      if (action === 'interact') {
        // The bag owns input while open; E must not buy upgrades or enter another room behind it.
        if (gs.inventoryOpen) return;
        // Dialogue/chest/placement are modal-ish: E closes/cancels them.
        if (gs.daySummary) {
          // Dismiss the morning sell report — the day begins.
          gs.daySummary = null;
          Sfx.play('select');
          return;
        }
        if (gs.placingItem) {
          // Cancel placement — the item stays in the bag.
          ToolSystem.cancelPlacement();
          Sfx.play('select');
          return;
        }
        if (gs.dialogue) {
          // why: the Wayfarer table owns its own keys and buttons; Interact must not close it mid-conversation.
          if (gs.dialogue.kind === 'wayfarer-table') return;
          if (gs.dialogue.kind === 'resident-choice') confirmResidentDialogueChoice();
          else if (gs.dialogue.kind === 'resident-actions') confirmResidentAction();
          else closeDialogue();
          Sfx.play('talk');
          return;
        }
        if (gs.chestOpen) {
          gs.chestOpen = false;
          Sfx.play('stash');
          return;
        }
        if (gs.craftingOpen || gs.binOpen) {
          gs.craftingOpen = false;
          gs.binOpen = false;
          Sfx.play('select');
          return;
        }
        // A workbench opens the crafting panel; the shipping bin opens the sell panel.
        {
          const ft = facingTile();
          if (interactWithWaitingCuddle(this.scene.key as SceneKey, ft.tx, ft.ty)) {
            closeDialogue(); InputBus.instance.clearAll(); Sfx.play('talk'); return;
          }
          // A party member walking with the keeper answers like their town self: a gift or the talk row.
          const companion = this.walkingParty?.memberAt(ft.tx, ft.ty);
          if (companion) {
            companion.turnToward(gs.player.x, gs.player.y);
            meetResidentInPerson(companion.residentId as ResidentId);
            Sfx.play('talk');
            return;
          }
          if (this.handleWorldInteraction(ft.tx, ft.ty)) return;
          if (this.workbenches.has(`${ft.tx},${ft.ty}`) ||
            ItemPlacementSystem.itemAt(this.scene.key as SceneKey, ft.tx, ft.ty)?.item === 'workbench') {
            gs.craftingOpen = true;
            Sfx.play('select');
            return;
          }
          if (this.bins.has(`${ft.tx},${ft.ty}`)) {
            gs.binOpen = true;
            Sfx.play('select');
            return;
          }
          // The TV reports tomorrow's weather (Stardew's forecast channel).
          if (this.tvs.has(`${ft.tx},${ft.ty}`)) {
            gs.dialogue = { name: 'TV — Weather Forecast', line: WeatherSystem.forecastLine(gs.day) };
            Sfx.play('talk');
            return;
          }
        }
        this.feedback(interact(this.ctx()));
        return;
      }
      if (action === 'use-tool') {
        // The one-shot bus action is only emitted by the test seam now (real input goes through
        // the hold loop / pointer). Force so logic tests aren't dropped by the swing lock.
        this.swing(undefined, { force: true });
      }
    });
  }

  /** Map an interaction result string to SFX + a floating toast (routed to the UIScene). */
  private feedback(result: string): void {
    const toast = (msg: string): void => {
      this.game.events.emit('toast', msg);
    };
    if (result === 'hit:tree' || result === 'hit:stump') {
      Sfx.play('chop');
    } else if (result === 'hit:rock') {
      Sfx.play('mine');
    } else if (result.startsWith('cleared:')) {
      // The break sound plays with its effect in removeNodeAt; the +N toast fires when the drop is collected.
    } else if (result === 'tilled') {
      Sfx.play('till');
    } else if (result === 'soil-cleared') {
      Sfx.play('mine');
      toast('Soil restored');
    } else if (result === 'watered') {
      Sfx.play('water');
    } else if (result === 'refilled') {
      Sfx.play('water');
      toast('Watering can refilled');
    } else if (result === 'can-empty') {
      Sfx.play('deny');
      toast('Watering can is empty — refill at water');
    } else if (result === 'no-seeds') {
      Sfx.play('deny');
      toast('Out of seeds');
    } else if (result.startsWith('wrong-season:')) {
      Sfx.play('deny');
      toast(`Wrong season — plant that in ${result.slice('wrong-season:'.length)}`);
    } else if (result === 'planted') {
      Sfx.play('plant');
      toast('Planted');
    } else if (result.startsWith('harvested:')) {
      // Format: harvested:<produce>:<seedReturn> (see InteractionSystem.interact).
      const [, produce, seedsStr] = result.split(':');
      Sfx.play('harvest');
      toast(`+1 ${BaseWorldScene.ITEM_LABEL[produce] ?? produce}`);
      const seeds = Number(seedsStr);
      if (seeds > 0) toast(`+${seeds} seeds back`);
    } else if (result === 'inventory-full') {
      Sfx.play('deny');
      toast('Backpack is full — crop left unharvested');
    } else if (result === 'chest-opened') {
      Sfx.play('stash');
    } else if (result === 'slept') {
      Sfx.play('sleep');
      toast(`Day ${GameState.instance.day} — a fresh start`);
    } else if (result === 'too-tired') {
      Sfx.play('deny');
      toast('Too tired...');
    }
  }

  /**
   * Draw/refresh the farm overlay for one tile from GameState: the connected-soil blob + wet
   * tint (SoilOverlay) and the crop sprite with its per-crop, per-stage art
   * (`crop-<type>-<stage+1>` — a missing stage texture throws; art is wired via the manifest).
   */
  private renderOverlayAt(tx: number, ty: number): void {
    const k = `${tx},${ty}`;
    const gs = GameState.instance;
    // Crop state is scene-scoped; the local sprite map (this.overlay) stays coordinate-keyed.
    const crop = gs.crops[`${this.scene.key}:${k}`];

    // Soil: connected Wang blob + wet tint (reads GameState.tiles).
    this.soil.refreshTile(tx, ty);

    // Crop sprite: remove any stale image first so we always reflect current state.
    const existing = this.overlay.get(k);
    if (existing) {
      existing.destroy();
      this.overlay.delete(k);
    }
    const existingShadow = this.cropShadows.get(k);
    if (existingShadow) {
      existingShadow.destroy();
      this.cropShadows.delete(k);
    }
    if (!crop) return;

    const stageTex = `crop-${crop.type}-${Math.min(crop.maxStage, crop.stage) + 1}`;
    if (!this.textures.exists(stageTex)) {
      throw new Error(`renderOverlayAt: missing crop stage texture "${stageTex}" (manifest entry?)`);
    }
    // Anchored at the tile's bottom-center so the plant "sits" on the soil.
    const shadowWidth = [4, 6, 9, 11][Math.min(3, crop.stage)];
    const shadow = this.add
      .ellipse(tx * TILE + TILE / 2, ty * TILE + TILE - 2, shadowWidth, 3, 0x34261e, 0.2)
      .setDepth(-8.2);
    this.cropShadows.set(k, shadow);
    const cropImg = this.add
      .image(tx * TILE + TILE / 2, ty * TILE + TILE, stageTex)
      .setOrigin(0.5, 1)
      .setDepth(ty * TILE + TILE - 1)
      .setName(`crop-${crop.type}-${tx}-${ty}`);
    // New art is authored for one native16px cell. Fractional scaling destroys its pixel rhythm.
    cropImg.setScale(1);
    this.overlay.set(k, cropImg);
  }

  /** Render overlays for all currently-tracked soil/crop tiles (scene (re)entry / after sleep). */
  private renderAllOverlay(): void {
    const gs = GameState.instance;
    this.soil.refreshAll();
    for (const img of this.overlay.values()) img.destroy();
    this.overlay.clear();
    for (const shadow of this.cropShadows.values()) shadow.destroy();
    this.cropShadows.clear();
    const prefix = `${this.scene.key}:`;
    for (const k of Object.keys(gs.crops)) {
      if (!k.startsWith(prefix)) continue; // another scene's crops — not ours to draw
      const [tx, ty] = k.slice(prefix.length).split(',').map(Number);
      this.renderOverlayAt(tx, ty);
    }
  }

  /**
   * Build the ground as a single Phaser tilemap layer from the MapData grid, then build the keeper's
   * walls: on a map with fine walls (MapData.fineSolid) a hidden layer of 4 px cells (buildFineWallLayer),
   * otherwise solid tiles of the ground layer flagged as colliding. One layer = one culled draw call
   * regardless of map size, and collision is a per-tile boolean flag (no GameObjects). This replaced a
   * 10k-image approach that overwhelmed WebGL and made parallel test runs time out.
   * Side effects: sets groundLayer and wallLayer.
   */
  private buildTilemap(): void {
    ensureTerrainTileset(this);

    // Convert the Ground grid into a numeric tile-index grid the tilemap consumes.
    const data: number[][] = this.map.ground.map((row) => row.map((g) => GROUND_INDEX[g]));

    const map = this.make.tilemap({
      data,
      tileWidth: TILE,
      tileHeight: TILE,
      width: this.map.w,
      height: this.map.h,
    });
    const tiles = map.addTilesetImage(TERRAIN_TILESET_KEY, TERRAIN_TILESET_KEY, TILE, TILE, 0, 0);
    if (!tiles) throw new Error(`${this.scene.key}: failed to add terrain tileset`);
    const layer = map.createLayer(0, tiles, 0, 0);
    if (!layer) throw new Error(`${this.scene.key}: failed to create ground layer`);
    layer.setDepth(-10);
    this.groundLayer = layer;

    if (this.map.fineSolid) {
      // why: no warp carving here. Painted maps assert every warp tile is walkable in their walk grid, and
      // buildFineSolid refuses edits that close the middle of a walkable tile, so every warp stays reachable.
      this.wallLayer = this.buildFineWallLayer(this.map.fineSolid);
      return;
    }
    this.wallLayer = layer;

    // A warp is a doorway, not a wall: carve out any solid tile a warp zone covers so the player can
    // actually reach the warp (otherwise a warp placed on the solid border is unreachable — this was
    // a real bug on the town's west edge). Build a mask of warp-covered tiles first.
    const isWarpTile = (x: number, y: number): boolean =>
      this.map.warps.some(
        (w) => x >= w.tx && x < w.tx + w.w && y >= w.ty && y < w.ty + w.h
      );

    // Flag solid tiles (map border, water) as colliding — a boolean per tile, not a body per tile.
    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        if (this.map.solid[y][x] && !isWarpTile(x, y)) {
          const tile = layer.getTileAt(x, y);
          if (tile) tile.setCollision(true, true, true, true);
        }
      }
    }
  }

  /**
   * Build the hidden collision layer for a map's fine walls: one FINE_CELL (4 px) tile per wall cell.
   * @param fine solid cells, (map.h * FINE_PER_TILE) rows of (map.w * FINE_PER_TILE) columns (buildFineSolid)
   * @returns the layer, invisible, with every wall cell colliding on all four sides
   * @throws when the grid's size does not match the map, or Phaser cannot build the layer
   * Side effect: makes the texture FINE_WALL_TEXTURE once per game (the tileset needs an image; it is never drawn).
   */
  private buildFineWallLayer(fine: readonly (readonly boolean[])[]): Phaser.Tilemaps.TilemapLayer {
    const rows = this.map.h * FINE_PER_TILE, cols = this.map.w * FINE_PER_TILE;
    if (fine.length !== rows || fine.some((row) => row.length !== cols)) {
      throw new Error(`${this.scene.key}: fine walls are not ${cols}x${rows} cells`);
    }
    if (!this.textures.exists(FINE_WALL_TEXTURE)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xff0000, 1).fillRect(0, 0, FINE_CELL, FINE_CELL);
      g.generateTexture(FINE_WALL_TEXTURE, FINE_CELL, FINE_CELL);
      g.destroy();
    }
    const map = this.make.tilemap({
      // why: -1 is an empty cell (no tile, no collision); 0 is the one wall tile.
      data: fine.map((row) => row.map((wall) => (wall ? 0 : -1))),
      tileWidth: FINE_CELL,
      tileHeight: FINE_CELL,
      insertNull: true,
    });
    const tiles = map.addTilesetImage(FINE_WALL_TEXTURE, FINE_WALL_TEXTURE, FINE_CELL, FINE_CELL, 0, 0);
    if (!tiles) throw new Error(`${this.scene.key}: failed to add fine wall tileset`);
    const layer = map.createLayer(0, tiles, 0, 0);
    if (!layer) throw new Error(`${this.scene.key}: failed to create fine wall layer`);
    layer.setCollision(0).setVisible(false);
    return layer;
  }

  /** Create overlap zones for each warp; overlapping routes through SceneTransitionSystem. */
  private buildWarps(): void {
    this.warpZones = [];
    for (const warp of this.map.warps) {
      const zone = this.add.zone(
        warp.tx * TILE,
        warp.ty * TILE,
        warp.w * TILE,
        warp.h * TILE
      );
      zone.setOrigin(0, 0);
      this.physics.add.existing(zone, true); // static body
      this.physics.add.overlap(this.player, zone, () => {
        if (warp.doorFacing) {
          // Feet, not the top of the physics box, must cross a door sill. Sideways porch travel
          // remains normal walking, and merely brushing an exit cannot pull the keeper through it.
          const feet = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY);
          const direction = warp.doorFacing === 'north' ? 'up' : 'down';
          if (feet.tx < warp.tx || feet.tx >= warp.tx + warp.w || feet.ty < warp.ty || feet.ty >= warp.ty + warp.h ||
            !InputBus.instance.getHeld().has(direction)) return;
        }
        this.enterWarp(warp);
      });
      this.warpZones.push(zone);
    }
  }

  /** Wire WASD + arrow keys into the InputBus (held-direction model). */
  private bindKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const map: Record<string, Facing> = {
      W: 'up',
      S: 'down',
      A: 'left',
      D: 'right',
      UP: 'up',
      DOWN: 'down',
      LEFT: 'left',
      RIGHT: 'right',
    };
    for (const [keyName, dir] of Object.entries(map)) {
      const key = kb.addKey(keyName);
      this.keys[keyName] = key;
      key.on('down', () => {
        const gs = GameState.instance;
        if (!this.transitioning && !gs.paused && !gs.inventoryOpen && !gs.chestOpen && !gs.binOpen && !gs.craftingOpen &&
          !gs.tavernPanel && !gs.marketPanelOpen) {
          InputBus.instance.setMove(dir, true);
        }
      });
      key.on('up', () => InputBus.instance.setMove(dir, false));
    }

    // One-shot actions: Space = use tool (hold to repeat), E = interact, digits 1-8 = hotbar,
    // I/Tab = inventory.
    // NOTE: digit keys MUST use Phaser's KeyCode NAMES ('ONE'...) — addKey('1') silently no-ops
    // (KeyCodes has no '1' entry), which is exactly why tool switching was broken in real play.
    kb.addCapture(['SPACE', 'TAB', 'ESC']); // stop the browser from scrolling / stealing focus
    // Space is HELD-state driven (see the hold loop in update()) so holding it keeps swinging —
    // the Stardew hold-to-chop feel. The test seam's one-shot 'use-tool' path is unchanged.
    this.spaceKey = kb.addKey('SPACE');
    const toolEvents = new WeakSet<KeyboardEvent>();
    this.spaceKey.on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
      if (event.repeat || toolEvents.has(event)) return;
      toolEvents.add(event);
      if (this.toolInputBlocked()) { this.toolInputNeedsRelease = true; return; }
      this.placementPressConsumed = false;
      this.pendingToolPress = 'keyboard';
    });
    this.spaceKey.on('up', () => {
      if (!this.pointerHeld && !InputBus.instance.toolHeld) {
        this.placementPressConsumed = false;
        this.toolInputNeedsRelease = false;
      }
    });
    const rotationEvents = new WeakSet<KeyboardEvent>();
    kb.addKey('R').on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
      if (event.repeat || rotationEvents.has(event)) return;
      rotationEvents.add(event);
      this.rotatePlacement();
    });
    // Parallel scene plugins can replay a queue containing keydown AND keyup. Phaser's Key then
    // emits down again for the same native event. Normalize every one-shot once by event identity,
    // as Escape already does, so one bell press cannot open and immediately close a service.
    kb.addKey('E').on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
      // While the resident field owns letters, an "e" is text rather than the world Interact action.
      if (!residentChatCapturesTyping()) InputBus.instance.emitKeyboard('interact', event);
    });
    kb.addKey('M').on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => InputBus.instance.emitKeyboard('manage-shop', event));
    const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'] as const;
    DIGITS.forEach((name, slot) => {
      kb.addKey(name).on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => InputBus.instance.emitKeyboard(`hotbar:${slot}` as OneShotAction, event));
    });
    kb.addKey('I').on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => InputBus.instance.emitKeyboard('toggle-inventory', event));
    kb.addKey('TAB').on('down', (_key: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => InputBus.instance.emitKeyboard('toggle-inventory', event));
    // Listen once at the KeyboardPlugin level. addKey('ESC').on('down') can retain a second
    // callback when Phaser reuses the Key object across a scene restart, turning one press into
    // an immediate open-then-close toggle. The lifecycle cleanup keeps this binding scene-local.
    const onEscape = (event: KeyboardEvent): void => InputBus.instance.emitKeyboard('toggle-pause', event);
    kb.on('keydown-ESC', onEscape);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.off('keydown-ESC', onEscape));
  }

  /**
   * Place furniture at the cursor anywhere on visible floor. Ordinary tools retain one-tile reach
   * and face the target; furniture placement never turns or moves the keeper toward a distant tile.
   * Aims with the pointer that started the world press (see worldPointer), not the last-moved finger.
   */
  private useToolAtPointer(): void {
    const gs = GameState.instance;
    if (gs.dialogue || gs.chestOpen) return;
    if (gs.placingItem) {
      this.swing(this.furnitureTarget());
      return;
    }
    const p = this.worldPointer;
    if (!p) throw new Error('useToolAtPointer ran without a world press pointer.');
    // Invert this world's camera explicitly so adjacent-tile targeting remains correct at every
    // viewport aspect ratio.
    const { tx, ty } = this.pointerTile(p);
    const pt = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY); // feet tile
    const dx = tx - pt.tx;
    const dy = ty - pt.ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) return; // out of reach — Stardew-style adjacency
    if (dx !== 0 || dy !== 0) {
      gs.player.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    }
    this.swing(dx === 0 && dy === 0 ? undefined : { tx, ty });
  }

  /** Advance input and world presentation; slot ownership is reconciled before any placement action. */
  update(_time: number, deltaMs: number): void {
    const gs = GameState.instance;
    this.wallsDebug?.update();
    updateCuddle();
    for (const line of CompanionWalkSystem.endExpiredWalks()) this.game.events.emit('toast', line);
    this.cuddleEffect?.update(cuddleEffectView(this.scene.key as SceneKey), this.time.now);
    ToolSystem.syncPlacement();
    this.consumeTouchToolPress();
    // A finger can lift over the HUD, where the world never hears its pointerup. Poll so it cannot stick.
    if (this.pointerHeld && this.worldPointer && !this.worldPointer.isDown) this.releaseWorldPointer();
    if (!gs.placingItem) {
      this.touchAim = null;
      this.touchAimDrag = null;
    }
    if (this.toolInputBlocked()) {
      this.pendingToolPress = null;
      if (this.spaceKey?.isDown || this.pointerHeld || InputBus.instance.toolHeld) this.toolInputNeedsRelease = true;
      if (this.castCharging) {
        // Losing world input ownership cancels charging; it is not a player's cast-release intent.
        this.castCharging = false;
        this.castCharge = 0;
        this.hideChargeBar();
      }
    }
    // Meditation needs stillness: walking, using a tool, travel, or any conversation ends it.
    // Progress already counted stays (see VitalitySystem.meditate).
    if (gs.meditating && (InputBus.instance.getHeld().size > 0 || this.pendingToolPress !== null || this.pointerHeld
      || (this.spaceKey?.isDown ?? false) || InputBus.instance.toolHeld || this.transitioning || gs.dialogue !== null)) {
      VitalitySystem.stopMeditating();
    }
    if (this.transitioning) {
      this.placementGhost.setVisible(false);
      // Entrance tweens own the sprite during this short interval. No clock, tools, or held keys
      // run behind them; the tween publishes its feet before the validated scene replacement.
      InputBus.instance.clearAll();
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      return;
    }
    if (gs.arrestRequested) {
      gs.arrestRequested = false;
      Sfx.play('deny');
      this.game.events.emit('toast', 'Captain Maren escorts you to the town watch house.');
      for (const line of CompanionWalkSystem.endAllWalks()) this.game.events.emit('toast', line);
      transitionTo(this, SceneKey.Jail, 'entry');
      return;
    }
    if (gs.paused) {
      this.placementGhost.setVisible(false);
      this.pointerHeld = false;
      this.prevHolding = false;
      if (this.player?.body) (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      return;
    }
    if (playerCuddleBusy()) {
      this.placementGhost.setVisible(false);
      InputBus.instance.clearAll();
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    if (this.player) {
      // A private moment owns the keeper's spot, so the tile settle glide must not move them.
      this.player.update(deltaMs, !playerCuddleBusy());
      // Y-depth by the FEET so the player reads behind/in front of objects correctly.
      this.player.setDepth(this.player.y + FEET_CENTER_DY);
    }
    if (this.walkingParty) {
      // why: a walk can start or end in a dialogue this frame; followers step in or leave without a scene change.
      this.walkingParty.followRoster();
      this.walkingParty.update(deltaMs, NO_COMBAT);
    }
    if (gs.tavernPanel || gs.marketPanelOpen) {
      this.placementGhost.setVisible(false);
      this.pointerHeld = false;
      this.prevHolding = false;
      this.targetHi.setVisible(false);
      return;
    }
    this.updateFishingLine();
    this.updateDrops(deltaMs);
    this.updateForage();

    // Walking away reels in a live cast (waiting/bite only — while reeling you're locked in).
    if (
      GameState.instance.fishing &&
      GameState.instance.fishing.phase !== 'reeling' &&
      InputBus.instance.getHeld().size > 0
    ) {
      this.cancelFishing();
    }

    // Input model: tools auto-repeat while held (Stardew rhythm); the ROD is press-driven (hold =
    // one cast, press again to hook); while REELING, holding is the continuous reel force.
    // The on-screen Use button (touch play) holds the tool exactly like Space.
    const physicalHold = (this.spaceKey?.isDown ?? false) || this.pointerHeld || InputBus.instance.toolHeld;
    if (!physicalHold) { this.placementPressConsumed = false; this.toolInputNeedsRelease = false; }
    const press = this.pendingToolPress;
    this.pendingToolPress = null;
    const holding = !this.toolInputBlocked() && !this.toolInputNeedsRelease && !this.placementPressConsumed && (physicalHold || press !== null);
    const pointerAction = press === 'pointer' || this.pointerHeld;
    const freshPress = holding && (press !== null || !this.prevHolding);
    this.prevHolding = holding;

    if (gs.fishing?.phase === 'reeling') {
      const reelHeld = holding || InputBus.instance.reelHeld;
      const res = FishingSystem.tickReel(deltaMs, reelHeld);
      if (res.status === 'caught') {
        this.clearFishingVisuals();
        Sfx.play(res.fish.stored ? 'harvest' : 'deny');
        this.game.events.emit('toast', res.fish.stored ? `+1 ${res.fish.label}!` : 'Backpack full — fish released');
      } else if (res.status === 'escaped') {
        this.clearFishingVisuals();
        Sfx.play('deny');
        this.game.events.emit('toast', 'It got away...');
      }
    } else if (holding) {
      if (gs.placingItem) {
        // Decorating owns the press even when the selected tool is a fishing rod.
        if (freshPress) this.swing(this.furnitureTarget());
      } else if (ToolSystem.active() === ToolId.Rod) {
        // Rod semantics: pressing during waiting/bite acts immediately (reel-in / hook); pressing
        // while idle starts a POWER CHARGE — hold to aim further out, release to cast (below).
        if (freshPress) {
          if (gs.fishing) {
            if (pointerAction) this.useToolAtPointer();
            else this.swing();
          } else if (!gs.dialogue && !gs.chestOpen && !gs.craftingOpen && !gs.binOpen) {
            this.castCharging = true;
            this.castCharge = 0;
          }
        }
        if (this.castCharging) {
          this.castCharge = Math.min(1, this.castCharge + deltaMs / 900);
          this.updateChargeBar();
        }
      } else {
        this.holdTimer = Math.max(this.holdTimer - deltaMs, -1);
        // Swing when the cadence timer elapses AND the previous swing finished — so held input
        // chains swings back-to-back instead of skipping beats mid-animation.
        if (this.holdTimer <= 0 && !this.player.busy) {
          this.holdTimer = 320;
          if (pointerAction) {
            this.useToolAtPointer();
          } else {
            this.swing();
          }
        }
      }
    } else {
      this.holdTimer = 0;
      // Rod button released while charging → the actual cast, distance scaled by the charge.
      if (this.castCharging) {
        this.castCharging = false;
        this.hideChargeBar();
        this.releaseCast();
      }
    }

    // Pass-out rule: until the upstairs exists, collapse advances the night and wakes the player
    // at the Tavern's named exterior arrival without ever rendering the rejected interior.
    if (!this.passingOut && gs.timeOfDay >= 1200) {
      this.passingOut = true;
      Sfx.play('deny');
      this.game.events.emit('toast', 'You passed out!');
      this.sleep(0.5);
      transitionTo(this, SceneKey.Farm, 'from_home');
    }

    // Target-tile highlight follows the facing tile; hidden while a panel is open. In placement
    // mode it turns green/red as a live can-place cue (Stardew ghost).
    if (this.targetHi) {
      const t = gs.placingItem ? this.furnitureTarget() : facingTile();
      this.targetHi.setPosition(t.tx * TILE + 1, t.ty * TILE + 1);
      this.placementGhost.setVisible(false);
      this.targetHi.setVisible(
        !gs.dialogue && !gs.chestOpen && !gs.craftingOpen && !gs.binOpen && !gs.inventoryOpen && !gs.daySummary && !gs.fishing
      );
      if (gs.placingItem) {
        const pointerAvailable = this.furniturePointerAvailable();
        const ok = pointerAvailable && ItemPlacementSystem.canPlace(
          this.map,
          t.tx,
          t.ty,
          (x, y) => this.tileBlocked(x, y),
          gs.placingItem,
          gs.placingRotation
        );
        const view = furnitureView(gs.placingItem, gs.placingRotation);
        const candidate = { item: gs.placingItem, tx: t.tx, ty: t.ty, rotation: gs.placingRotation,
          scene: this.scene.key as SceneKey };
        const presentation = this.furnitureSurfaces.resolve(candidate, ok ? [...gs.placedItems, candidate] : [candidate], true);
        this.targetHi.setSize(view.w * TILE - 2, view.h * TILE - 2);
        if (!this.textures.exists(view.texture)) throw new Error(`Furniture: missing preview texture "${view.texture}"`);
        this.placementGhost.setTexture(presentation.texture, presentation.frame).setDisplaySize(view.displayW, view.displayH)
          .setOrigin(view.originX, view.originY).setAngle(view.angle)
          .setPosition((t.tx + view.w / 2) * TILE, (t.ty + view.h) * TILE)
          .setDepth(furnitureDepth(gs.placingItem, t.ty, view.h)).setTint(ok ? 0xb5e6ad : 0xf58d82)
          .setVisible(this.targetHi.visible && pointerAvailable);
        this.targetHi.setVisible(this.targetHi.visible && pointerAvailable);
        this.targetHi.setStrokeStyle(2, ok ? 0x44dd66 : 0xdd4444, 0.9);
        this.targetHi.setFillStyle(ok ? 0x44dd66 : 0xdd4444, 0.25);
      } else {
        this.targetHi.setSize(TILE - 2, TILE - 2);
        this.targetHi.setStrokeStyle(2, 0xffffff, 0.65);
        this.targetHi.setFillStyle(0xffffff, 0.12);
      }
    }

    // Advance the in-game clock and apply the day/night tint.
    // The sell report is a true morning gate: clock, crop preview, and player movement stay frozen
    // until the player dismisses it, matching the text that the new day begins afterward.
    if (!gs.daySummary) {
      TimeSystem.tick(deltaMs);
      if (DevTuningSystem.tick(deltaMs).cropDaysAdvanced > 0) this.renderAllOverlay();
    }
    if (this.interiorLighting) {
      // Indoors the lighting layer owns all darkness, so the flat tint stays off.
      this.nightOverlay.setAlpha(0);
      this.interiorLighting.update(_time, TimeSystem.darkness());
    } else if (this.nightOverlay) this.nightOverlay.setAlpha(TimeSystem.darkness() * 0.6);
  }
}
