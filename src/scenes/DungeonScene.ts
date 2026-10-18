/**
 * DungeonScene — the first portal dungeon beyond the North Gate (Moonlighter-style rooms).
 *
 * The map (MapDef.buildDungeon) holds five painted rooms side by side (world/DungeonRooms.ts): the
 * fountain hub, the crystal cave, the moon library, the old sewer and the Warden's lava pit. Only the
 * current room is drawn (PaintedRoomRenderer) and the camera stays inside it. Every run is shuffled
 * (planDungeonRun): the hub's three doors lead to the three side rooms in a random order, and the stair
 * to the Warden sits behind one random side room's far door; the other two far doors are walled up.
 *  - each room spawns its monsters (config/Dungeon.ts ROOM_PLANS) at fixed, seeded spots, and its doors
 *    stay barred until every monster is dead;
 *  - clearing a room the first time drops its reward along the room's reward row. A cleared room stays
 *    cleared for the run: coming back spawns nothing and leaves the doors open, and loot left on its
 *    floor waits there;
 *  - stepping into an open door moves the keeper to the room behind it (DungeonRooms.doorTarget);
 *  - killing the Warden opens a swirl on the pit's rune; stepping into it walks home to the Gate Plaza;
 *  - loot goes into a small run bag (DUNGEON_BAG_SIZE), not the inventory. A full bag leaves loot on
 *    the floor;
 *  - the escape altar in every room sends the keeper home for gold (ESCAPE_GOLD_PER_FLOOR times the
 *    room's floor), bag and all: the first E shows the price, a second E within a few seconds pays;
 *  - a knockout (HP 0) or the 2am pass-out loses the bag and ends the day at the farm.
 *
 * A run is never saved mid-dungeon (SaveSystem refuses), so the run's state lives only on this scene.
 * The keeper's adventuring party (GameState.social.party) walks along as PartyCompanions: they are
 * placed beside the keeper on every room entry and fight through the same kill path as the sword.
 * Finished facts (runs, deepest floor, boss beaten) go to GameState.progress.dungeon.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { ITEM_CATALOG } from '../config/Items';
import {
  DUNGEON_BAG_SIZE, DUNGEON_SWORD_BASE, ESCAPE_GOLD_PER_FLOOR, MONSTER_DROP_CHANCE, ROOM_PLANS,
} from '../config/Dungeon';
import { BaseWorldScene } from './BaseWorldScene';
import { GameState } from '../state/GameState';
import { Rng } from '../state/Rng';
import { CombatController } from '../combat/CombatController';
import { CombatSystem } from '../combat/CombatSystem';
import type { Enemy } from '../combat/Enemy';
import { Slime } from '../entities/Slime';
import { Bat } from '../entities/Bat';
import { Warden } from '../entities/Warden';
import { PartyCompanions, mapWalkable } from '../entities/PartyCompanion';
import { Sfx } from '../systems/SfxSystem';
import { SaveSystem } from '../systems/SaveSystem';
import { DUNGEON_FLOORS } from '../systems/ProgressSystem';
import { transitionTo } from '../systems/SceneTransitionSystem';
import { registerEnemyProvider } from '../debug/DebugHooks';
import { getMapData } from '../world/MapDef';
import { RUNTIME_ART, ensureRuntimeArt } from '../world/RuntimeArt';
import {
  DUNGEON_ROOMS, DUNGEON_ROOM_IDS, dungeonDoor, dungeonRoomBounds, doorTarget, planDungeonRun,
  type DoorId, type DungeonDoor, type AnyDungeonRoomDef, type DungeonRoomId, type DungeonRunPlan, type TileRect,
} from '../world/DungeonRooms';
import { GATE_PLAZA_ANCHORS } from '../world/GatePlazaArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';

/** Local deterministic scatter for spawn spots (layout-stable; never the gameplay Rng). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Feet within this many px of the exit swirl's centre step through it. */
const PORTAL_STEP_PX = 12;
/** A first E on the altar arms it for this long; a second E inside the window pays. */
const ESCAPE_ARM_MS = 4000;
/** Minimum gap between "bag full" and "door barred" toasts. */
const BAG_FULL_TOAST_MS = 3000;
const BLOCKED_TOAST_MS = 2500;
/** The paintings' dark surround; fills everything outside the current room. */
const VOID_COLOR = 0x0e0a12;
/** Above the hidden tile terrain (-15..-13) and below the painted backdrop. */
const VOID_DEPTH = -12;
/** A barred door's violet bar: colour, alpha, and depth (just above the painted motion, below actors). */
const BAR_COLOR = 0x8a5cff, BAR_ALPHA = 0.45, BAR_DEPTH = -11.3;
/** Gate Plaza tiles that receive bag items the inventory cannot hold (on the court beside the rune). */
const PLAZA_OVERFLOW_TILES = GATE_PLAZA_ANCHORS.overflow;
/** Monsters never spawn closer than this (Manhattan tiles) to the keeper's arrival, or to each other / the altar. */
const SPAWN_CLEAR_OF_ARRIVAL = 6, SPAWN_SPREAD = 3, SPAWN_CLEAR_OF_ALTAR = 3;
/** Per-room seed offsets for the spawn scatter, so each painting gets its own fixed spots. */
const SPAWN_SEEDS: Readonly<Record<DungeonRoomId, number>> = { hub: 900, cave: 901, library: 902, sewer: 903, boss: 904 };

/**
 * A solid block over a rectangle of tiles (a barred door or a walled-up corridor), with its collider
 * and the optional bar drawn over it; destroyed together.
 */
interface TileBlock {
  readonly tiles: TileRect;
  readonly zone: Phaser.GameObjects.Zone;
  readonly collider: Phaser.Physics.Arcade.Collider;
  readonly bar: Phaser.GameObjects.Rectangle | null;
}

export class DungeonScene extends BaseWorldScene {
  /** Shared combat loop; rebuilt on every create. */
  private combat!: CombatController;
  /** The keeper's recruited residents for this run; rebuilt on every create. */
  private party!: PartyCompanions;
  /** This run's shuffled layout (read by specs). */
  private plan!: DungeonRunPlan;
  /** The room the keeper is in. */
  private room: DungeonRoomId = 'hub';
  /** Rooms whose monsters all died this run (they stay empty and open). */
  private cleared = new Set<DungeonRoomId>();
  /** Each entered room's floor number for this run (hub 1; side rooms 2, 3, 3 in entry order; pit 4). */
  private floors = new Map<DungeonRoomId, number>();
  /** This run's finds: item id -> count. Lost on a knockout. */
  private bag: Record<string, number> = {};
  /** Set once the run is ending (exit, escape, knockout) so nothing fires twice. */
  private ending = false;
  /** True once the Warden died this run. */
  private bossDown = false;
  /** World px centre of the open exit swirl in the Warden's pit, or null while it is shut or elsewhere. */
  private exitCentre: { x: number; y: number } | null = null;
  /** Scene time until which the current room's altar is armed (second E pays). */
  private escapeArmedUntil = 0;
  private bagFullToastAt = -Infinity;
  private blockedToastAt = -Infinity;
  private bagText!: Phaser.GameObjects.Text;
  /** The current room's painting; replaced on every room change. */
  private painted: PaintedRoomRenderer | null = null;
  /** The current room's barred doors (until it is cleared) and walled-up corridor. */
  private blocks: TileBlock[] = [];
  /**
   * Map tiles companions must not step on: every altar (always), plus the current room's blocks.
   * The companions' walkable test reads this live set.
   */
  private readonly companionBlocked = new Set<string>();
  /** The altar tiles of every room (map tiles, "x,y"); always in companionBlocked. */
  private altarKeys = new Set<string>();

  /** Register under the Dungeon world key. */
  constructor() {
    super(SceneKey.Dungeon);
  }

  /**
   * Start a fresh run: shuffle the layout, then the dark surround, combat loop, bag HUD, altars and
   * party, and enter the hub (the keeper is already on its 'entry' spawn).
   * @throws when a room's reward does not fit its reward row
   */
  create(): void {
    for (const id of DUNGEON_ROOM_IDS) {
      const plan = ROOM_PLANS[id];
      const items = Object.values(plan.clearReward).reduce((sum, n) => sum + n, 0);
      if (items > DUNGEON_ROOMS[id].reward.w) {
        throw new Error(`DungeonScene: ${id} drops ${items} rewards on a row of ${DUNGEON_ROOMS[id].reward.w}`);
      }
    }
    // why: set before super.create(), which sizes the camera from cameraArea() (this room).
    this.room = 'hub';
    this.painted = null;
    this.blocks = [];
    this.plan = planDungeonRun(() => Rng.instance.next());
    this.cleared = new Set();
    this.floors = new Map();
    super.create();
    ensureRuntimeArt(this);
    // why: the tile terrain still draws every room and the gaps between them; the painting covers only
    // the current room, so a dark sheet hides the rest when a wide window shows past the room's edge.
    this.add.rectangle(0, 0, this.map.w * TILE, this.map.h * TILE, VOID_COLOR).setOrigin(0).setDepth(VOID_DEPTH);
    this.cameras.main.setBackgroundColor(VOID_COLOR);
    this.bag = {};
    this.ending = false;
    this.bossDown = false;
    this.exitCentre = null;
    this.escapeArmedUntil = 0;
    this.bagFullToastAt = -Infinity;
    this.blockedToastAt = -Infinity;
    GameState.instance.progress.dungeon.runs += 1;

    this.combat = new CombatController(this, this.player, {
      swordDamage: () => DUNGEON_SWORD_BASE + GameState.instance.progress.forgeLevel,
      onEnemyKilled: (enemy, tx, ty) => this.onEnemyKilled(enemy, tx, ty),
      collect: item => this.collect(item),
      onKnockedOut: () => this.knockOut(),
    });
    this.bagText = this.combat.addHudText(12, 160, '#e6dcff');
    this.drawAltars();
    this.companionBlocked.clear();
    for (const key of this.altarKeys) this.companionBlocked.add(key);
    const onMap = mapWalkable(this.map);
    // why: altars, barred doors and walled-up corridors are physics zones, not solid map tiles, so
    // companions (who have no physics body) must avoid them by tile.
    this.party = new PartyCompanions(this, (tx, ty) => onMap(tx, ty) && !this.companionBlocked.has(`${tx},${ty}`),
      () => GameState.instance.social.party, 'combat');
    this.enterRoom('hub', null);

    registerEnemyProvider(() =>
      this.combat.enemies.map(e => ({
        kind: e instanceof Warden ? 'warden' : e.lootItem === 'slime-gel' ? 'slime' : 'bat',
        tx: Math.floor(e.x / TILE),
        ty: Math.floor(e.y / TILE),
        hp: e.hp,
      }))
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => registerEnemyProvider(null));
  }

  /**
   * Map tile of a room's escape altar.
   * @param id room id
   */
  private altarTile(id: DungeonRoomId): { tx: number; ty: number } {
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[id];
    return { tx: room.origin.tx + room.altar.tx, ty: room.origin.ty + room.altar.ty };
  }

  /** The camera shows only the current room (the other rooms are unpainted). */
  protected override cameraArea(): { x: number; y: number; w: number; h: number } {
    const b = dungeonRoomBounds(this.room);
    return { x: b.x0 * TILE, y: b.y0 * TILE, w: (b.x1 - b.x0 + 1) * TILE, h: (b.y1 - b.y0 + 1) * TILE };
  }

  /** Draw every room's escape altar with a solid footprint the player can face and press E on. */
  private drawAltars(): void {
    this.altarKeys = new Set();
    for (const id of DUNGEON_ROOM_IDS) {
      const { tx, ty } = this.altarTile(id);
      this.altarKeys.add(`${tx},${ty}`);
      const altar = this.add.image(tx * TILE + TILE / 2, (ty + 1) * TILE, RUNTIME_ART.escapeAltar).setOrigin(0.5, 1);
      altar.setDepth(altar.y);
      const zone = this.add.zone(tx * TILE + TILE / 2, ty * TILE + TILE / 2, TILE, TILE);
      this.physics.add.existing(zone, true);
      this.physics.add.collider(this.player, zone);
    }
  }

  /**
   * Make a rectangle of the current room's tiles solid for the keeper and the companions.
   * @param tiles room-local tiles to block
   * @param toast what the keeper is told on bumping into it (rate-limited)
   * @param barred true to draw a violet bar over it (a barred door); false for a sealed corridor,
   *   whose seal patch the painting already shows
   */
  private addBlock(tiles: TileRect, toast: string, barred: boolean): void {
    const origin = DUNGEON_ROOMS[this.room].origin;
    const x = (origin.tx + tiles.tx) * TILE, y = (origin.ty + tiles.ty) * TILE;
    const w = tiles.w * TILE, h = tiles.h * TILE;
    const zone = this.add.zone(x + w / 2, y + h / 2, w, h);
    this.physics.add.existing(zone, true);
    const collider = this.physics.add.collider(this.player, zone, () => {
      if (this.time.now - this.blockedToastAt < BLOCKED_TOAST_MS) return;
      this.blockedToastAt = this.time.now;
      this.game.events.emit('toast', toast);
    });
    const bar = barred
      ? this.add.rectangle(x, y, w, h, BAR_COLOR, BAR_ALPHA).setOrigin(0).setDepth(BAR_DEPTH).setName(`dungeon-bar-${tiles.tx}-${tiles.ty}`)
      : null;
    for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) {
      for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) this.companionBlocked.add(`${origin.tx + tx},${origin.ty + ty}`);
    }
    this.blocks.push({ tiles, zone, collider, bar });
  }

  /**
   * Remove some of the current room's blocks (all of them when `which` is omitted).
   * @param which predicate choosing the blocks to remove
   */
  private removeBlocks(which: (block: TileBlock) => boolean = () => true): void {
    const origin = DUNGEON_ROOMS[this.room].origin;
    const keep: TileBlock[] = [];
    for (const block of this.blocks) {
      if (!which(block)) {
        keep.push(block);
        continue;
      }
      // why: the collider holds the zone's body; destroy it first so physics never sees a dead body.
      block.collider.destroy();
      block.zone.destroy();
      if (block.bar) block.bar.destroy();
      const { tiles } = block;
      for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) {
        for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) {
          const key = `${origin.tx + tx},${origin.ty + ty}`;
          if (!this.altarKeys.has(key)) this.companionBlocked.delete(key);
        }
      }
    }
    this.blocks = keep;
  }

  /**
   * Move the run into a room: drop the last room's blocks, paint the room, move the keeper to the door
   * they came through, wall up a sealed far door, spawn this room's monsters and bar its doors (unless it
   * is already cleared), bring the party along, and record the floor reached.
   * @param id the room to enter
   * @param through the door of `id` the keeper comes out of, or null for the hub on scene start (the
   *   transition already put the keeper on the 'entry' spawn)
   * @throws when the room has no space for its monsters
   */
  private enterRoom(id: DungeonRoomId, through: DoorId | null): void {
    this.removeBlocks();
    this.room = id;
    this.exitCentre = null;
    this.escapeArmedUntil = 0;
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[id];
    const { origin } = room;

    let arrival: { tx: number; ty: number };
    if (through === null) {
      if (!('portalArrival' in room)) throw new Error(`DungeonScene: ${id} has no portal arrival`);
      arrival = room.portalArrival;
    } else {
      const door = dungeonDoor(id, through);
      arrival = door.arrival;
      this.teleport(origin.tx + arrival.tx, origin.ty + arrival.ty, door.arrival.facing);
    }

    this.painted?.destroy();
    this.painted = new PaintedRoomRenderer(this, room.art, room.style, origin.tx * TILE, origin.ty * TILE, `dungeon-${id}`, this.player);
    this.refreshCameraBounds();
    // why: without a jump the follow camera would glide across the gap from the last room.
    this.cameras.main.centerOn(this.player.x, this.player.y);

    if ('seal' in room && doorTarget(this.plan, id, 'far') === 'sealed') {
      this.painted.addPatch('seal', room.seal.texture, room.seal.x, room.seal.y);
      this.addBlock(room.seal.tiles, 'Fallen stone walls up this passage.', false);
    }

    if (!this.cleared.has(id)) {
      this.spawnMonsters(id, arrival);
      for (const door of room.doors) {
        if (doorTarget(this.plan, id, door.id) === 'sealed') continue;
        this.addBlock(door.tiles, 'A violet ward bars the door while monsters remain.', true);
      }
    } else if (id === 'boss') {
      this.openExit();
    }
    // why: rooms do not connect, so companions must arrive with the keeper every time.
    this.party.placeNearKeeper();

    const floor = this.floorOf(id);
    const dungeon = GameState.instance.progress.dungeon;
    dungeon.deepestFloor = Math.max(dungeon.deepestFloor, floor);
    Sfx.play('select');
    this.game.events.emit('toast', id === 'boss' ? room.title : `Floor ${floor}: ${room.title}`);
    this.updateBagText();
  }

  /**
   * A room's floor number for this run, assigned on first entry: the hub 1, side rooms 2, 3, 3 in the
   * order the keeper first enters them, the Warden's pit DUNGEON_FLOORS + 1.
   * @param id room id
   */
  private floorOf(id: DungeonRoomId): number {
    const known = this.floors.get(id);
    if (known !== undefined) return known;
    let floor: number;
    if (id === 'hub') floor = 1;
    else if (id === 'boss') floor = DUNGEON_FLOORS + 1;
    else {
      const sideRoomsSeen = [...this.floors.keys()].filter(other => other !== 'hub' && other !== 'boss').length;
      // why: the first side room entered is floor 2; the second and third share floor 3.
      floor = Math.min(2 + sideRoomsSeen, DUNGEON_FLOORS);
    }
    this.floors.set(id, floor);
    return floor;
  }

  /**
   * Spawn a room's monsters (and the Warden in the pit) at seeded floor spots away from the keeper.
   * @param id room id
   * @param arrival room-local tile the keeper arrived on
   * @throws when the room has no space for its monsters
   */
  private spawnMonsters(id: DungeonRoomId, arrival: { tx: number; ty: number }): void {
    const plan = ROOM_PLANS[id];
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[id];
    const b = dungeonRoomBounds(id);
    const at = { tx: room.origin.tx + arrival.tx, ty: room.origin.ty + arrival.ty };
    const altar = this.altarTile(id);
    // why: door mouths, arrivals and the far-door corridor must stay free, so a monster never sits in a
    // doorway or behind a seal.
    const reserved = new Set<string>();
    const reserve = (rect: TileRect): void => {
      for (let ty = rect.ty; ty < rect.ty + rect.h; ty++) {
        for (let tx = rect.tx; tx < rect.tx + rect.w; tx++) reserved.add(`${room.origin.tx + tx},${room.origin.ty + ty}`);
      }
    };
    for (const door of room.doors) {
      reserve(door.tiles);
      reserve({ tx: door.arrival.tx, ty: door.arrival.ty, w: 1, h: 1 });
    }
    if ('seal' in room) reserve(room.seal.tiles);

    const rand = lcg(SPAWN_SEEDS[id]);
    const spots: Array<{ tx: number; ty: number }> = [];
    const wanted = plan.slimes + plan.bats;
    let guard = 0;
    while (spots.length < wanted && guard++ < 2000) {
      // why: the paintings' walls, pillars, liquids and props are solid tiles, so sampling the whole room
      // and skipping solid tiles lands every monster on the painted floor.
      const tx = b.x0 + Math.floor(rand() * (b.x1 - b.x0 + 1));
      const ty = b.y0 + Math.floor(rand() * (b.y1 - b.y0 + 1));
      if (this.map.solid[ty][tx] || reserved.has(`${tx},${ty}`)) continue;
      if (Math.abs(tx - at.tx) + Math.abs(ty - at.ty) < SPAWN_CLEAR_OF_ARRIVAL) continue;
      if (Math.abs(tx - altar.tx) + Math.abs(ty - altar.ty) < SPAWN_CLEAR_OF_ALTAR) continue;
      if (spots.some(s => Math.abs(s.tx - tx) + Math.abs(s.ty - ty) < SPAWN_SPREAD)) continue;
      spots.push({ tx, ty });
    }
    if (spots.length < wanted) throw new Error(`DungeonScene: ${id} has no space for ${wanted} monsters`);
    spots.forEach((s, i) => {
      const x = s.tx * TILE + TILE / 2;
      const y = s.ty * TILE + TILE / 2;
      this.combat.addEnemy(i < plan.slimes ? new Slime(this, x, y) : new Bat(this, x, y));
    });
    if (plan.boss) {
      if (!('warden' in room)) throw new Error(`DungeonScene: ${id} plans a boss but has no Warden start`);
      this.combat.addEnemy(new Warden(this, (room.origin.tx + room.warden.tx) * TILE + TILE / 2,
        (room.origin.ty + room.warden.ty) * TILE + TILE / 2));
    }
  }

  /** A monster died: maybe drop its loot; the last one clears the room. */
  private onEnemyKilled(enemy: Enemy, tx: number, ty: number): void {
    if (enemy instanceof Warden) {
      this.bossDown = true;
      Sfx.play('harvest');
      this.game.events.emit('toast', 'The Warden falls!');
    } else if (Rng.instance.next() < MONSTER_DROP_CHANCE) {
      this.combat.dropLoot(enemy.lootItem, tx, ty);
    }
    if (this.combat.enemies.length === 0) this.roomCleared();
  }

  /** Every monster is dead: drop the reward along the reward row, lift the door bars, and in the pit open the way home. */
  private roomCleared(): void {
    const id = this.room;
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[id];
    this.cleared.add(id);
    let slot = 0;
    for (const [item, count] of Object.entries(ROOM_PLANS[id].clearReward)) {
      for (let n = 0; n < count; n++) {
        this.combat.dropLoot(item, room.origin.tx + room.reward.tx + slot, room.origin.ty + room.reward.ty);
        slot += 1;
      }
    }
    // why: bars only; a walled-up corridor stays walled for the whole run.
    this.removeBlocks(block => block.bar !== null);
    Sfx.play('harvest');
    if (id === 'boss') {
      this.openExit();
      this.game.events.emit('toast', 'The way home is open.');
    } else {
      this.game.events.emit('toast', 'Room cleared! The doors open.');
    }
  }

  /** Lay the looping exit swirl over the pit's rune and remember its centre for the step check. */
  private openExit(): void {
    const pit = DUNGEON_ROOMS.boss;
    if (!this.painted) throw new Error('DungeonScene: no painted room to open the exit in');
    this.painted.addAnimation(pit.exit);
    const scale = 1 / pit.art.texelsPerPixel;
    this.exitCentre = {
      x: pit.origin.tx * TILE + (pit.exit.x + pit.exit.frameWidth / 2) * scale,
      y: pit.origin.ty * TILE + (pit.exit.y + pit.exit.frameHeight / 2) * scale,
    };
  }

  /** Put one find in the run bag; a full bag leaves it on the floor. */
  private collect(item: string): boolean {
    const held = Object.values(this.bag).reduce((sum, n) => sum + n, 0);
    if (held >= DUNGEON_BAG_SIZE) {
      if (this.time.now - this.bagFullToastAt > BAG_FULL_TOAST_MS) {
        this.bagFullToastAt = this.time.now;
        this.game.events.emit('toast', `Bag full (${DUNGEON_BAG_SIZE}). Head home to empty it.`);
      }
      return false;
    }
    this.bag[item] = (this.bag[item] ?? 0) + 1;
    this.game.events.emit('toast', `+1 ${ITEM_CATALOG[item].label}`);
    this.updateBagText();
    return true;
  }

  /** Refresh the "Bag n/12" HUD line, plus the forge bonus once the sword has been tempered. */
  private updateBagText(): void {
    const held = Object.values(this.bag).reduce((sum, n) => sum + n, 0);
    const forge = GameState.instance.progress.forgeLevel;
    this.bagText.setText(`Bag ${held}/${DUNGEON_BAG_SIZE}${forge > 0 ? `  ·  Sword +${forge}` : ''}`);
  }

  /** E on the escape altar: first press quotes the price, a second press within the window pays. */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    const altar = this.altarTile(this.room);
    if (tx !== altar.tx || ty !== altar.ty || this.ending) return false;
    const price = ESCAPE_GOLD_PER_FLOOR * this.floorOf(this.room);
    const gs = GameState.instance;
    if (this.time.now > this.escapeArmedUntil) {
      this.escapeArmedUntil = this.time.now + ESCAPE_ARM_MS;
      Sfx.play('talk');
      this.game.events.emit('toast', `Escape home for ${price}g? Press E again to pay.`);
      return true;
    }
    if (gs.gold < price) {
      Sfx.play('deny');
      this.game.events.emit('toast', `The altar wants ${price}g. You have ${gs.gold}g.`);
      this.escapeArmedUntil = 0;
      return true;
    }
    gs.gold -= price;
    this.finishRun(`Escaped for ${price}g`);
    return true;
  }

  /** A held healing potion is drunk; other held items use the base behaviour. */
  protected override handleHeldItemUse(item: string): boolean {
    if (item !== 'healing-potion') return false;
    this.combat.drinkPotion();
    return true;
  }

  /**
   * End the run safely: empty the bag into the inventory (overflow waits on the Gate Plaza
   * ground), record the boss, and walk out to the plaza.
   * @param headline first words of the summary toast
   */
  private finishRun(headline: string): void {
    if (this.ending) return;
    this.ending = true;
    const gs = GameState.instance;
    let total = 0;
    let overflow = 0;
    for (const [item, count] of Object.entries(this.bag)) {
      for (let n = 0; n < count; n++) {
        total += 1;
        if (gs.addItem(item, 1)) continue;
        const [tx, ty] = PLAZA_OVERFLOW_TILES[overflow % PLAZA_OVERFLOW_TILES.length];
        gs.groundDrops.push({ scene: SceneKey.GatePlaza, item, tx, ty });
        overflow += 1;
      }
    }
    this.bag = {};
    if (this.bossDown) gs.progress.dungeon.bossBeaten = true;
    Sfx.play('select');
    const spill = overflow > 0 ? ` ${overflow} wait by the gate (backpack full).` : '';
    this.game.events.emit('toast', `${headline}: brought home ${total} find${total === 1 ? '' : 's'}.${spill}`);
    transitionTo(this, SceneKey.GatePlaza, 'from_dungeon');
  }

  /** HP reached zero: the bag is lost and the keeper wakes at the farm the next morning. */
  private knockOut(): void {
    if (this.ending) return;
    Sfx.play('deny');
    this.game.events.emit('toast', 'You were knocked out! The bag is lost.');
    CombatSystem.heal();
    this.sleep(0.5);
  }

  /**
   * Any night in the dungeon (knockout or the 2am pass-out) ends the run: the bag is lost, the
   * day rolls, and the keeper wakes at the farm. Saved like JailScene: the farm position is set
   * and the transition starts before the save, because a save inside the dungeon is refused.
   */
  protected override sleep(staminaFrac = 0.5): void {
    if (this.ending) return;
    this.ending = true;
    this.bag = {};
    const gs = GameState.instance;
    gs.dialogue = null;
    super.sleep(staminaFrac, false);
    const farm = getMapData(SceneKey.Farm);
    const spawn = farm.spawns.find(candidate => candidate.id === 'from_home');
    if (!spawn) throw new Error('DungeonScene: Farm has no morning spawn');
    gs.player = { x: spawn.tx * TILE + TILE / 2, y: spawn.ty * TILE + TILE / 2, facing: 'down', stamina: gs.player.stamina };
    transitionTo(this, SceneKey.Farm, 'from_home');
    // transitionTo sets activeScene first, so the save holds a valid Farm position.
    SaveSystem.saveCurrent();
  }

  /**
   * The open door (if any) whose mouth holds the keeper's feet.
   * @returns the door, or null when the keeper stands on no open door
   */
  private doorUnderFeet(): DungeonDoor | null {
    const gs = GameState.instance;
    const room: AnyDungeonRoomDef = DUNGEON_ROOMS[this.room];
    const tx = Math.floor(gs.player.x / TILE) - room.origin.tx, ty = Math.floor(gs.player.y / TILE) - room.origin.ty;
    for (const door of room.doors) {
      const t = door.tiles;
      if (tx < t.tx || tx >= t.tx + t.w || ty < t.ty || ty >= t.ty + t.h) continue;
      if (doorTarget(this.plan, this.room, door.id) === 'sealed') return null;
      return door;
    }
    return null;
  }

  /**
   * Base world update, the combat frame, the party, then the door and exit-swirl step checks.
   * @param time scene clock in ms
   * @param deltaMs frame time in ms
   */
  update(time: number, deltaMs: number): void {
    super.update(time, deltaMs);
    if (this.ending) return;
    if (!this.combat.update(time, deltaMs)) return;
    this.party.update(deltaMs, this.combat);
    // why: doors open only once the room is cleared (the bars also block them physically).
    if (!this.cleared.has(this.room)) return;
    const gs = GameState.instance;
    if (this.exitCentre && Math.hypot(gs.player.x - this.exitCentre.x, gs.player.y - this.exitCentre.y) <= PORTAL_STEP_PX) {
      this.finishRun('Run complete');
      return;
    }
    const door = this.doorUnderFeet();
    if (!door) return;
    const target = doorTarget(this.plan, this.room, door.id);
    if (target === 'sealed') throw new Error(`DungeonScene: ${this.room} door ${door.id} is sealed but was open`);
    this.enterRoom(target.room, target.door);
  }
}
