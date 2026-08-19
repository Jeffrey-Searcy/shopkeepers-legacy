/**
 * BaseWorldScene — shared behavior for every walkable world scene (Farm/Town/Home).
 *
 * Responsibilities (this is where the two historical bugs are structurally prevented):
 *  - Render the BIG map from MapData as a tile grid (placeholder rects now, PixelLab tiles later).
 *  - Spawn the player at a NAMED spawn (from SceneTransitionSystem), NEVER implicit (0,0).
 *  - Set camera + physics world bounds to the full map, and startFollow the player (camera fix).
 *  - Build static collision for solid tiles so the player can't leave the map or cross water.
 *  - Detect warp-zone overlap and route through SceneTransitionSystem (the ONLY way scenes change).
 *
 * Subclasses supply only their SceneKey; everything else is data-driven from MapDef.
 */
import Phaser from 'phaser';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { TILE, ZOOM, CAMERA_LERP, FEET_CENTER_DY, worldToTile } from '../config/GameConfig';
import { getMapData, type MapData } from '../world/MapDef';
import {
  ensureTerrainTileset,
  TERRAIN_TILESET_KEY,
  GROUND_INDEX,
} from '../world/TerrainTileset';
import { renderWangTerrain } from '../world/TerrainRenderer';
import { Player } from '../entities/Player';
import { ResourceNode } from '../entities/ResourceNode';
import { Chest } from '../entities/Chest';
import { Prop } from '../entities/Prop';
import { DroppedItem } from '../entities/DroppedItem';
import { Sfx } from '../systems/SfxSystem';
import { InputBus } from '../input/InputBus';
import { GameState, type Facing } from '../state/GameState';
import { consumePendingResumePlayer, consumePendingSpawn, transitionTo } from '../systems/SceneTransitionSystem';
import { markReady, registerSceneTestHooks } from '../debug/DebugHooks';
import { ToolSystem } from '../systems/ToolSystem';
import { ItemPlacementSystem, PLACEABLE_DEF } from '../systems/ItemPlacementSystem';
import { ToolId, ITEM_VALUES, type TreeStage } from '../config/Items';
import { StaminaSystem } from '../systems/StaminaSystem';
import { FarmGridSystem } from '../systems/FarmGridSystem';
import { CropSystem } from '../systems/CropSystem';
import { TreeSystem } from '../systems/TreeSystem';
import { WeatherSystem } from '../systems/WeatherSystem';
import { SoilOverlay } from '../systems/SoilOverlay';
import { TimeSystem } from '../systems/TimeSystem';
import { DevTuningSystem } from '../systems/DevTuningSystem';
import { PlacementSystem } from '../systems/PlacementSystem';
import { FishingSystem, BITE_WINDOW_MS } from '../systems/FishingSystem';
import { ShippingSystem } from '../systems/ShippingSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { useActiveTool, interact, facingTile, type InteractionContext } from '../systems/InteractionSystem';
import type { OneShotAction } from '../input/InputBus';

export abstract class BaseWorldScene extends Phaser.Scene {
  protected map!: MapData;
  protected player!: Player;
  /** The single tilemap layer that renders the whole (big) ground grid, culled and cheap. */
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  /** Warp zones the player can overlap to transition. */
  private warpZones: Phaser.GameObjects.Zone[] = [];
  /** Guard so a single overlap frame doesn't fire multiple transitions. */
  private transitioning = false;
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
  /** Bed tiles present in this scene (interacting sleeps), keyed by "tx,ty". */
  private beds = new Set<string>();
  /** Full-screen dark overlay whose alpha tracks the day/night darkness factor. */
  private nightOverlay!: Phaser.GameObjects.Rectangle;
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
  /** Countdown between repeated tool swings while holding (ms). */
  private holdTimer = 0;
  /** Highlight showing which tile the next tool use will hit (Stardew-style precision cue). */
  private targetHi!: Phaser.GameObjects.Rectangle;

  protected constructor(key: SceneKey) {
    super(key);
  }

  create(): void {
    this.transitioning = false;
    this.map = getMapData(this.scene.key as SceneKey);

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
    this.physics.add.collider(this.player, this.groundLayer);

    // Camera + physics bounds = the full big map; camera follows the player (THE camera fix).
    this.cameras.main.setBounds(0, 0, mapWpx, mapHpx);
    this.physics.world.setBounds(0, 0, mapWpx, mapHpx);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.startFollow(this.player, true, CAMERA_LERP, CAMERA_LERP);
    this.cameras.main.fadeIn(150, 0, 0, 0);

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
      .rectangle(0, 0, TILE, TILE)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xffffff, 0.45)
      .setFillStyle(0xffffff, 0.07)
      .setDepth(-7.5);

    // Hold-to-chop toward the mouse: left button held = repeated swings at the cursor's tile
    // (when in reach). pointerHeld is consumed by the hold loop in update().
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button === 0) this.pointerHeld = true;
    });
    this.input.on('pointerup', () => {
      this.pointerHeld = false;
    });

    // Clean up on scene stop: bank uncollected drops when capacity permits. A full bag persists
    // their scene/tile so a transition never loses the drop or aborts scene shutdown.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('dev-crops-advanced', this.renderAllOverlay, this);
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
      this.cancelFishing(); // no dangling casts/timers across scenes
    });
    this.game.events.on('dev-crops-advanced', this.renderAllOverlay, this);

    // Hook for subclasses to add scene-specific content.
    this.onCreated();

    // Register test-only scene hooks (teleport/nodes/sleep) so specs can act deterministically.
    this.registerTestHooks();

    // The game is now controllable; tell the test seam we're ready.
    markReady();
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
  protected sleep(staminaFrac = 1): void {
    const gs = GameState.instance;
    // Overnight rain (Stardew model): if TOMORROW is rainy, the rain falls during this night —
    // unwatered crops grow as if watered, and the player wakes to rain-wet farmland below.
    const rained = WeatherSystem.forDay(gs.day + 1) === 'rain';
    if (rained) {
      // why: ALL scenes' crops (keys are `${scene}:...`) — rain falls on every outdoor map, and
      // soil can only exist outdoors (the hoe needs grass). Same for the re-wet pass below.
      for (const k of Object.keys(gs.crops)) gs.crops[k].watered = true;
    }
    CropSystem.advanceDay(); // watered (incl. rain-watered) crops bank a growth day; soil dries
    gs.day += 1;
    gs.timeOfDay = 0; // back to 06:00
    StaminaSystem.restore(staminaFrac); // < 1 when passing out at 2am
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
    this.renderAllOverlay();
    // Sleep is the one natural autosave point. Direct test/dev world boot has no active slot, so
    // saveCurrent() explicitly returns null and writes no arbitrary storage key.
    SaveSystem.saveCurrent();
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
  }

  /** Subclass hook, called at end of create(). Default no-op. */
  protected onCreated(): void {}

  /** Optional scene-owned interaction handled before generic props/tools. */
  protected handleWorldInteraction(_tx: number, _ty: number): boolean {
    return false;
  }

  /**
   * Room rendering for plain-floor interiors (the Home): a wood-plank floor, a brick/timber wall
   * band along the top and side trims, and a visible doorway (mat + frame gap) at each warp on the
   * bottom row — so the inside actually looks like an inside and you can SEE where the door is.
   * Purely visual; collision stays on the invisible index layer. Returns false when the map isn't
   * a floor interior or the interior art isn't loaded (flat strip stays visible then).
   */
  private renderInterior(): boolean {
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
    this.physics.add.collider(this.player, chestGroup);

    // Player-placed items persisted in GameState (Stardew rule: placeable anywhere not blocked).
    for (const p of GameState.instance.placedItems) {
      if (p.scene === (this.scene.key as SceneKey)) this.spawnPlacedItem(p.item, p.tx, p.ty);
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
   */
  private spawnNode(mapKind: string, tx: number, ty: number): ResourceNode {
    let kind = mapKind;
    let stage: TreeStage | undefined;
    if (mapKind === 'tree') {
      const s = TreeSystem.stageAt(this.scene.key as SceneKey, tx, ty);
      if (s === 'stump') kind = 'stump';
      else stage = s;
    }
    const node = new ResourceNode(this, kind, tx, ty, stage);
    node.setDepth(node.y); // y-sort: bottom-anchored, so depth = base y
    this.nodeGroup.add(node);
    this.nodes.set(`${tx},${ty}`, node);
    return node;
  }

  /** Spawn a player-placed item's world entity: chest (storage) or workbench (crafting station). */
  private spawnPlacedItem(item: string, tx: number, ty: number): void {
    // Floor items (rug) share tiles with blocking items, so they get their own sprite key.
    const k = `${tx},${ty}`;
    if (item === 'chest') {
      const chest = new Chest(this, tx, ty);
      chest.setDepth(chest.y); // bottom-anchored
      this.chestGroup.add(chest);
      this.chests.add(k);
      this.placedSprites.set(k, chest);
    } else if (item === 'workbench') {
      const bench = new Prop(this, 'workbench', tx, ty, TILE + 6, TILE + 8);
      this.chestGroup.add(bench); // same static collision group (player collides)
      this.workbenches.add(k);
      this.placedSprites.set(k, bench);
    } else if (item === 'table') {
      const table = new Prop(this, 'furniture-table', tx, ty, TILE + 6, TILE + 8);
      this.chestGroup.add(table);
      this.placedSprites.set(k, table);
    } else if (item === 'chair') {
      const chair = new Prop(this, 'furniture-chair', tx, ty, TILE, TILE + 6);
      this.chestGroup.add(chair);
      this.placedSprites.set(k, chair);
    } else if (item === 'rug') {
      // Rug: pure floor decor — no physics, renders under everything, walk over it.
      const rug = this.add
        .image(tx * TILE + TILE / 2, ty * TILE + TILE, 'rug')
        .setOrigin(0.5, 1)
        .setDepth(-8.5);
      this.placedSprites.set(`${k}#floor`, rug);
    } else {
      throw new Error(`spawnPlacedItem: unsupported item "${item}"`);
    }
  }

  /** Is this tile blocked by a live scene object (for item placement)? */
  private tileBlocked(tx: number, ty: number): boolean {
    const k = `${tx},${ty}`;
    if (this.nodes.has(k) || this.chests.has(k) || this.beds.has(k)) return true;
    const pt = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY); // feet tile
    return pt.tx === tx && pt.ty === ty; // not under your own feet
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
    if (gs.dialogue || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary) {
      gs.dialogue = null;
      gs.chestOpen = false;
      gs.craftingOpen = false;
      gs.binOpen = false;
      gs.daySummary = null;
      return;
    }
    if (this.player.busy && !opts?.force) return; // mid-swing
    const t = target ?? facingTile();
    const sceneKey = this.scene.key as SceneKey;

    // Placement mode: this swing places the held item instead of using a tool.
    if (gs.placingItem) {
      const item = gs.placingItem;
      if (ItemPlacementSystem.canPlace(this.map, t.tx, t.ty, (x, y) => this.tileBlocked(x, y), item)) {
        ItemPlacementSystem.place(item, sceneKey, t.tx, t.ty);
        this.spawnPlacedItem(item, t.tx, t.ty);
        gs.placingItem = null;
        Sfx.play('stash');
        this.game.events.emit('toast', 'Chest placed');
      } else {
        Sfx.play('deny');
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
      this.player.playAction('chop');
      const item = ItemPlacementSystem.remove(sceneKey, t.tx, t.ty)!;
      // Floor items (rug) live under a "#floor" sprite key so they can share a tile with furniture.
      const k =
        PLACEABLE_DEF[item]?.blocking === false ? `${t.tx},${t.ty}#floor` : `${t.tx},${t.ty}`;
      this.placedSprites.get(k)?.destroy();
      this.placedSprites.delete(k);
      this.chests.delete(`${t.tx},${t.ty}`);
      this.workbenches.delete(`${t.tx},${t.ty}`);
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
        Sfx.play('select');
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
      hitNode: (tx, ty) => this.nodes.get(`${tx},${ty}`)?.takeHit() ?? false,
      removeNodeAt: (tx, ty) => {
        const k = `${tx},${ty}`;
        const node = this.nodes.get(k);
        if (!node) return;
        const gs = GameState.instance;
        node.destroy();
        this.nodes.delete(k);
        if (node.kind === 'tree' && node.stage === 'full') {
          // Felling a FULL tree leaves its stump behind — chop that separately for extra wood.
          TreeSystem.leaveStump(this.scene.key as SceneKey, tx, ty);
          this.spawnNode('tree', tx, ty); // resolves to the stump via the new stage entry
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

      if (action === 'toggle-pause') {
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
        // Escape closes the top gameplay modal first; a second press opens pause.
        if (gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.dialogue || gs.daySummary) {
          gs.inventoryOpen = false;
          gs.chestOpen = false;
          gs.craftingOpen = false;
          gs.binOpen = false;
          gs.dialogue = null;
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
      if (gs.paused) return;

      if (action === 'toggle-inventory') {
        if (gs.daySummary) return; // the morning report owns the modal layer until dismissed
        gs.inventoryOpen = !gs.inventoryOpen;
        Sfx.play('select');
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
        // Dialogue/chest/placement are modal-ish: E closes/cancels them.
        if (gs.daySummary) {
          // Dismiss the morning sell report — the day begins.
          gs.daySummary = null;
          Sfx.play('select');
          return;
        }
        if (gs.placingItem) {
          // Cancel placement — the item stays in the bag.
          gs.placingItem = null;
          Sfx.play('select');
          return;
        }
        if (gs.dialogue) {
          gs.dialogue = null;
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
          if (this.handleWorldInteraction(ft.tx, ft.ty)) return;
          if (this.workbenches.has(`${ft.tx},${ft.ty}`)) {
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
    } else if (result === 'cleared:tree' || result === 'cleared:stump') {
      Sfx.play('chop'); // the +N toast now fires when the DROP is collected
    } else if (result === 'cleared:rock') {
      Sfx.play('mine');
    } else if (result === 'cleared:weed') {
      Sfx.play('scythe');
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
    const shadow = this.add
      .ellipse(tx * TILE + TILE / 2, ty * TILE + TILE - 2, 13, 5, 0x34261e, 0.32)
      .setDepth(-8.2);
    this.cropShadows.set(k, shadow);
    const cropImg = this.add
      .image(tx * TILE + TILE / 2, ty * TILE + TILE, stageTex)
      .setOrigin(0.5, 1)
      .setDepth(-8);
    // Slightly oversize the plant within its 16px cell—the old half-scale made seedlings read as
    // tiny map noise. Bottom anchoring and the soft shadow keep neighboring crops orderly.
    cropImg.setScale(0.62);
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
   * Build the ground as a single Phaser tilemap layer from the MapData grid, then flag solid tiles
   * as colliding. One layer = one culled draw call regardless of map size, and collision is a
   * per-tile boolean flag (no GameObjects). This replaced a 10k-image approach that overwhelmed
   * WebGL and made parallel test runs time out.
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
        if (this.transitioning) return;
        this.transitioning = true;
        // ALL scene changes go through the single authority (never scene.start here).
        transitionTo(this, warp.target, warp.spawn);
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
        if (!GameState.instance.paused) InputBus.instance.setMove(dir, true);
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
    kb.addKey('E').on('down', () => InputBus.instance.emit('interact'));
    const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'] as const;
    DIGITS.forEach((name, slot) => {
      kb.addKey(name).on('down', () => InputBus.instance.emit(`hotbar:${slot}` as OneShotAction));
    });
    kb.addKey('I').on('down', () => InputBus.instance.emit('toggle-inventory'));
    kb.addKey('TAB').on('down', () => InputBus.instance.emit('toggle-inventory'));
    // Listen once at the KeyboardPlugin level. addKey('ESC').on('down') can retain a second
    // callback when Phaser reuses the Key object across a scene restart, turning one press into
    // an immediate open-then-close toggle. The lifecycle cleanup keeps this binding scene-local.
    const onEscape = (event: KeyboardEvent): void => InputBus.instance.emitKeyboard('toggle-pause', event);
    kb.on('keydown-ESC', onEscape);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.off('keydown-ESC', onEscape));
  }

  /**
   * One swing toward the mouse cursor: face the clicked tile (if within 1 tile of the player) and
   * use the active tool on it. Clicking the player's own tile swings at the facing tile as usual.
   */
  private useToolAtPointer(): void {
    const gs = GameState.instance;
    if (gs.dialogue || gs.chestOpen) return;
    const p = this.input.activePointer;
    const { tx, ty } = worldToTile(p.worldX, p.worldY);
    const pt = worldToTile(this.player.x, this.player.y + FEET_CENTER_DY); // feet tile
    const dx = tx - pt.tx;
    const dy = ty - pt.ty;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) return; // out of reach — Stardew-style adjacency
    if (dx !== 0 || dy !== 0) {
      gs.player.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    }
    this.swing(dx === 0 && dy === 0 ? undefined : { tx, ty });
  }

  update(_time: number, deltaMs: number): void {
    const gs = GameState.instance;
    if (gs.paused) {
      this.pointerHeld = false;
      this.prevHolding = false;
      if (this.player?.body) (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      return;
    }
    if (this.player) {
      this.player.update();
      // Y-depth by the FEET so the player reads behind/in front of objects correctly.
      this.player.setDepth(this.player.y + FEET_CENTER_DY);
    }
    this.updateFishingLine();
    this.updateDrops(deltaMs);

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
    const holding = (this.spaceKey?.isDown ?? false) || this.pointerHeld;
    const freshPress = holding && !this.prevHolding;
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
      if (ToolSystem.active() === ToolId.Rod) {
        // Rod semantics: pressing during waiting/bite acts immediately (reel-in / hook); pressing
        // while idle starts a POWER CHARGE — hold to aim further out, release to cast (below).
        if (freshPress) {
          if (gs.fishing) {
            if (this.pointerHeld) this.useToolAtPointer();
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
          if (this.pointerHeld) {
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
      const t = facingTile();
      this.targetHi.setPosition(t.tx * TILE, t.ty * TILE);
      this.targetHi.setVisible(
        !gs.dialogue && !gs.chestOpen && !gs.craftingOpen && !gs.binOpen && !gs.inventoryOpen && !gs.daySummary && !gs.fishing
      );
      if (gs.placingItem) {
        const ok = ItemPlacementSystem.canPlace(
          this.map,
          t.tx,
          t.ty,
          (x, y) => this.tileBlocked(x, y),
          gs.placingItem
        );
        this.targetHi.setStrokeStyle(1, ok ? 0x44dd66 : 0xdd4444, 0.9);
        this.targetHi.setFillStyle(ok ? 0x44dd66 : 0xdd4444, 0.25);
      } else {
        this.targetHi.setStrokeStyle(1, 0xffffff, 0.45);
        this.targetHi.setFillStyle(0xffffff, 0.07);
      }
    }

    // Advance the in-game clock and apply the day/night tint.
    // The sell report is a true morning gate: clock, crop preview, and player movement stay frozen
    // until the player dismisses it, matching the text that the new day begins afterward.
    if (!gs.daySummary) {
      TimeSystem.tick(deltaMs);
      if (DevTuningSystem.tick(deltaMs).cropDaysAdvanced > 0) this.renderAllOverlay();
    }
    if (this.nightOverlay) this.nightOverlay.setAlpha(TimeSystem.darkness() * 0.6);
  }
}
