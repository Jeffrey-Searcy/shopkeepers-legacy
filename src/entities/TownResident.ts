/**
 * One permanent townsperson: room-local pacing and dialogue, drawn with the base pixel-art resident sheet.
 * In Town the actor follows the clock-driven route, animates by the distance it really walks, fades at doors,
 * turns toward a nearby player, and says hello once per day. A gold "!" floats over a resident who has an
 * open favor for the keeper (TownLifeSystem).
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { FEET_CENTER_DY, TILE } from '../config/GameConfig';
import { seatedOffsetX } from '../config/Furniture';
import { TOWN_RESIDENTS, type TownResidentDefinition } from '../config/TownResidents';
import { townBuilding } from '../config/TownBuildings';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { GameState, type Facing } from '../state/GameState';
import { getMapData, type MapData } from '../world/MapDef';
import { closeDialogue, meetResidentInPerson } from '../systems/ResidentDialogueSystem';
import { CompanionWalkSystem } from '../systems/CompanionWalkSystem';
import { residentScheduleScene, residentTownPresence } from '../systems/TownScheduleSystem';
import { RESIDENT_HOME_DEADLINE } from '../config/TownSchedules';
import { civicInteriorBlueprint, RESIDENT_ROUTE_MIN_TILES, RESIDENT_ROUTE_REACH } from '../config/CivicInteriors';
import { JAIL_ANCHORS } from '../world/CivicRoomArt';
import { residentCuddleDirective } from '../systems/CuddleSystem';
import { isResidentJailed } from '../systems/JusticeSystem';
import { TownLifeSystem } from '../systems/TownLifeSystem';
import { isTavernNight, TAVERN_NIGHT } from '../systems/TownRoutePlanSystem';
import { wayfarerSeat } from '../config/WayfarerSeats';

/** Real-time fade used when a resident steps through a door, in milliseconds. */
const DOOR_FADE_MS = 280;
/** Classic sprites advance one walk frame per this many pixels walked, so feet match ground speed. */
const CLASSIC_STRIDE_PX = 5.5;
/** A standing resident turns toward a player closer than this many pixels. */
const NOTICE_PLAYER_PX = 40;
/** How long a greeting stays above a resident's head, in milliseconds. */
const GREETING_MS = 2600;
/** Residents greet the player once per game day; the record survives scene re-entry for the session. */
const GREETED_DAY = new Map<string, number>();
/** Short hellos by time of day; each resident rotates through them day by day. */
const GREETINGS = {
  morning: ['Morning!', 'Oh, good morning.', 'Up early too?'],
  afternoon: ['Afternoon!', 'Hey there.', 'Busy day?'],
  evening: ['Evening!', 'Long day, huh?', 'Night\'s coming on.'],
} as const;

/** How far a seated guest's torso drops onto the chair cushion, in world pixels (TavernScene uses the same 5). */
const SEATED_DROP_PX = 5;

/** One cardinal indoor path tile. Only four selected destinations pause during a loop. */
export interface ResidentRoomRoutePoint { tx: number; ty: number; pauseMs: number }

/**
 * Return whether a civic-room tile is safe and close enough to remain in the public work area.
 * why: the reach matches the load-time check in CivicInteriors, so every painted room's route is proven there.
 */
function roomRouteTile(map: MapData, anchor: { tx: number; ty: number }, point: { tx: number; ty: number }): boolean {
  return point.tx > 0 && point.ty > 0 && point.tx < map.w - 1 && point.ty < map.h - 1
    && Math.abs(point.tx - anchor.tx) + Math.abs(point.ty - anchor.ty) <= RESIDENT_ROUTE_REACH
    && !map.solid[point.ty][point.tx] && map.ground[point.ty][point.tx] !== 'water'
    && !map.warps.some(warp => point.tx >= warp.tx && point.tx < warp.tx + warp.w
      && point.ty >= warp.ty && point.ty < warp.ty + warp.h);
}

/** Compile one shortest cardinal path inside a prevalidated reachable room region. */
function roomPath(start: { tx: number; ty: number }, target: { tx: number; ty: number },
  reachable: ReadonlySet<string>): Array<{ tx: number; ty: number }> {
  const key = (point: { tx: number; ty: number }): string => `${point.tx},${point.ty}`;
  const startKey = key(start), targetKey = key(target), queue = [{ ...start }];
  const previous = new Map<string, string | null>([[startKey, null]]);
  for (let cursor = 0; cursor < queue.length && !previous.has(targetKey); cursor++) {
    const point = queue[cursor];
    for (const next of [{ tx: point.tx + 1, ty: point.ty }, { tx: point.tx, ty: point.ty + 1 },
      { tx: point.tx - 1, ty: point.ty }, { tx: point.tx, ty: point.ty - 1 }]) {
      const nextKey = key(next);
      if (!reachable.has(nextKey) || previous.has(nextKey)) continue;
      previous.set(nextKey, key(point)); queue.push(next);
    }
  }
  if (!previous.has(targetKey)) throw new Error(`Town resident: no indoor path from ${startKey} to ${targetKey}`);
  const path: Array<{ tx: number; ty: number }> = [];
  for (let cursor: string | null = targetKey; cursor !== null; cursor = previous.get(cursor) ?? null) {
    const [tx, ty] = cursor.split(',').map(Number); path.push({ tx, ty });
  }
  return path.reverse();
}

/**
 * Build a deterministic room-scale loop through four spread-out destinations.
 * @param map Civic room whose collision and warps constrain the loop.
 * @param anchor Authored public-room route center.
 * @param residentOffset Stable resident index used to vary destination order and pause rhythm.
 * @returns Cardinal path tiles; exactly four destination tiles carry a pause.
 */
export function residentRoute(map: MapData, anchor?: { tx: number; ty: number }, residentOffset = 0): readonly ResidentRoomRoutePoint[] {
  const start = anchor ? { ...anchor } : { tx: Math.floor(map.w / 2), ty: 5 };
  if (!roomRouteTile(map, start, start)) throw new Error(`Town resident: blocked room anchor in ${map.key} at ${start.tx},${start.ty}`);
  const queue = [start], reachable = new Map<string, { tx: number; ty: number }>([[`${start.tx},${start.ty}`, start]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = queue[cursor];
    for (const next of [{ tx: point.tx + 1, ty: point.ty }, { tx: point.tx, ty: point.ty + 1 },
      { tx: point.tx - 1, ty: point.ty }, { tx: point.tx, ty: point.ty - 1 }]) {
      const nextKey = `${next.tx},${next.ty}`;
      if (reachable.has(nextKey) || !roomRouteTile(map, start, next)) continue;
      reachable.set(nextKey, next); queue.push(next);
    }
  }
  const points = [...reachable.values()];
  if (points.length < RESIDENT_ROUTE_MIN_TILES) throw new Error(`Town resident: ${map.key} has only ${points.length} safe roaming tiles`);
  // Cardinal extremes guarantee that each loop uses both the room's width and depth.
  const directions = [{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  const rotated = directions.map((_direction, index) => directions[(index + residentOffset) % directions.length]);
  const chosen = new Set<string>();
  const destinations = rotated.map(direction => {
    const target = [...points].sort((left, right) => {
      const leftScore = (left.tx - start.tx) * direction.dx + (left.ty - start.ty) * direction.dy;
      const rightScore = (right.tx - start.tx) * direction.dx + (right.ty - start.ty) * direction.dy;
      return rightScore - leftScore || Math.abs(right.tx - start.tx) + Math.abs(right.ty - start.ty)
        - Math.abs(left.tx - start.tx) - Math.abs(left.ty - start.ty) || left.ty - right.ty || left.tx - right.tx;
    }).find(point => !chosen.has(`${point.tx},${point.ty}`));
    if (!target) throw new Error(`Town resident: ${map.key} cannot choose four room destinations`);
    chosen.add(`${target.tx},${target.ty}`);
    return target;
  });
  const reachableKeys = new Set(reachable.keys()), route: ResidentRoomRoutePoint[] = [{ ...start, pauseMs: 0 }];
  let from = start;
  destinations.forEach((destination, index) => {
    const segment = roomPath(from, destination, reachableKeys);
    for (const point of segment.slice(1)) route.push({ ...point, pauseMs: 0 });
    route[route.length - 1].pauseMs = 1350 + ((residentOffset + index) % 3) * 450;
    from = destination;
  });
  const homeSegment = roomPath(from, start, reachableKeys);
  for (const point of homeSegment.slice(1, -1)) route.push({ ...point, pauseMs: 0 });
  const unique = new Set(route.map(point => `${point.tx},${point.ty}`));
  const width = Math.max(...route.map(point => point.tx)) - Math.min(...route.map(point => point.tx)) + 1;
  const height = Math.max(...route.map(point => point.ty)) - Math.min(...route.map(point => point.ty)) + 1;
  if (unique.size < 16 || width < 5 || height < 4) {
    throw new Error(`Town resident: ${map.key} roaming loop is too small (${unique.size} tiles, ${width}x${height})`);
  }
  return route;
}

/** Scene-owned actor. Phaser destroys the sprite, shadow and collider on shutdown; no actor state enters saves. */
export class TownResident {
  readonly collider: Phaser.GameObjects.Zone;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly route: ReturnType<typeof residentRoute> | null;
  private readonly originalTexture: string;
  private readonly scheduleMap: MapData;
  private elapsedMs = 0;
  private x: number;
  private y: number;
  private facing: Facing = 'down';
  private active = false;
  private presentedSchedule: ReturnType<typeof residentScheduleScene> | null = null;
  /** Total game minutes removed from this actor's schedule after completed player conversations. */
  private scheduleDelayMinutes = 0;
  /** Actual game-clock minute when the current conversation began. */
  private dialogueStartedAt: number | null = null;
  /** Last calendar sample detects a new day or a developer clock rewind. */
  private observedDay = -1;
  private observedTimeOfDay = 0;
  /** Pixels walked while moving; drives walk frames so steps match real ground speed. */
  private walkedPx = 0;
  /** Door fade state: 0 hidden, 1 fully shown. */
  private presenceAlpha = 0;
  /** False until the first update, so residents already indoors at scene start never flash a fade. */
  private presenceStarted = false;
  /** Small floating hello shown once per day when the player first comes close. */
  private greeting: Phaser.GameObjects.Text | null = null;
  private greetingUntil = 0;
  /** Gold "!" shown while this resident has an open favor for the keeper. */
  private readonly favorMark: Phaser.GameObjects.Text;

  /**
   * Create one permanent resident actor for a Town, civic-room, or explicitly allowed service scene.
   * @param allowForeignScene Allows a scene other than the resident's home to own this inactive-or-visiting actor.
   * @param foreignRouteAnchor Required for ordinary civic visitors; omitted only for directive-owned jail/private guests.
   */
  constructor(private readonly scene: Phaser.Scene, private readonly resident: TownResidentDefinition, private readonly map: MapData,
    allowForeignScene = false, foreignRouteAnchor?: { tx: number; ty: number }) {
    if (map.key !== SceneKey.Town && townBuilding(resident.buildingId).scene !== map.key && !allowForeignScene) {
      throw new Error(`Town resident: ${resident.name} is in the wrong room`);
    }
    const homeRouteAnchor = civicInteriorBlueprint(resident.buildingId).residentRoute;
    const residentIndex = TOWN_RESIDENTS.findIndex(candidate => candidate.id === resident.id);
    if (residentIndex < 0) throw new Error(`Town resident: unknown resident ${resident.id}`);
    const routeAnchor = foreignRouteAnchor ?? homeRouteAnchor;
    this.route = map.key === SceneKey.Town || (allowForeignScene && foreignRouteAnchor === undefined)
      ? null : residentRoute(map, routeAnchor, residentIndex);
    this.scheduleMap = map.key === SceneKey.Town ? map : getMapData(SceneKey.Town);
    // Different starting phases keep several legitimate room visitors from standing on one sprite.
    this.elapsedMs = residentIndex * 317;
    this.x = this.route ? (this.route[0].tx + 0.5) * TILE : -TILE;
    this.y = this.route ? (this.route[0].ty + 0.5) * TILE : -TILE;
    const texture = AppearanceTextureSystem.forGame(scene.game).residentTextureFor(resident.id);
    this.originalTexture = texture;
    this.shadow = scene.add.ellipse(this.x, this.y + 1, 12, 5, 0x2c211c, 0.18);
    this.sprite = scene.add.sprite(this.x, this.y - FEET_CENTER_DY, texture, 0)
      .setName(`town-resident-${resident.id}`).setData('residentId', resident.id).setData('residentName', resident.name);
    this.collider = scene.add.zone(this.x, this.y, 8, 6).setName(`town-resident-body-${resident.id}`);
    // Render at 8px then halve, like the conversation bubbles; Phaser text blurs below 8px.
    this.favorMark = scene.add.text(this.x, this.y - 30, '!', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '16px',
      color: '#f2c14e', stroke: '#5a3a1a', strokeThickness: 4 }).setOrigin(0.5, 1).setScale(0.5).setVisible(false)
      .setName(`town-favor-${resident.id}`);
    scene.physics.add.existing(this.collider, true);
    this.update();
  }

  /**
   * Where this jailed resident stands in the painted cell.
   * why: jailed residents fill the cell slots in TOWN_RESIDENTS order, so one prisoner stands at the front of the
   * cell rather than at a fixed far slot. JAIL_ANCHORS proves at load that the keeper can still reach the cot
   * with every slot taken.
   * @returns the jail directive (tile centre of this resident's slot, facing down)
   * @throws when more residents are jailed than the cell has slots
   */
  private jailDirective(): { scene: SceneKey; x: number; y: number; facing: 'down'; moving: false; activity: string } {
    const order = TOWN_RESIDENTS.findIndex(candidate => candidate.id === this.resident.id);
    if (order < 0) throw new Error(`Town resident: unknown resident ${this.resident.id}`);
    const slotIndex = TOWN_RESIDENTS.slice(0, order).filter(candidate => isResidentJailed(candidate.id)).length;
    const slot = JAIL_ANCHORS.slots[slotIndex];
    if (!slot) throw new Error(`Town resident: jail has ${JAIL_ANCHORS.slots.length} slots, ${this.resident.name} needs slot ${slotIndex}`);
    return { scene: SceneKey.Jail, x: (slot.tx + 0.5) * TILE, y: (slot.ty + 0.5) * TILE, facing: 'down', moving: false,
      activity: 'in jail' };
  }

  /** Update modest deterministic pacing and selected art. Pause/menu state freezes movement but not appearance changes. */
  update(): void {
    const gs = GameState.instance, settings = SettingsSystem.get();
    if (this.observedDay !== gs.day || gs.timeOfDay < this.observedTimeOfDay) {
      this.scheduleDelayMinutes = 0;
      this.dialogueStartedAt = null;
      this.observedDay = gs.day;
    }
    // why: a resident walking with the keeper is drawn by the scene's PartyCompanions follower instead, so this
    // scheduled body stays hidden, and a talk with the follower neither pins nor delays this body's schedule.
    const walking = CompanionWalkSystem.isWalking(this.resident.id);
    let talking = !walking && gs.dialogue?.residentId === this.resident.id;
    if (talking && gs.timeOfDay >= RESIDENT_HOME_DEADLINE) {
      closeDialogue();
      this.scene.game.events.emit('toast', `${this.resident.name} heads home for the night.`);
      talking = false;
      // Midnight is a hard deadline. Conversation delays never carry past it or into a new day.
      this.scheduleDelayMinutes = 0;
      this.dialogueStartedAt = null;
    } else if (talking && this.dialogueStartedAt === null) {
      this.dialogueStartedAt = gs.timeOfDay;
    } else if (!talking && this.dialogueStartedAt !== null) {
      const pausedMinutes = gs.timeOfDay - this.dialogueStartedAt;
      if (pausedMinutes < 0) throw new Error(`Town resident: ${this.resident.name} dialogue moved backward in time`);
      this.scheduleDelayMinutes += pausedMinutes;
      this.dialogueStartedAt = null;
    }
    const activeDialogueMinutes = this.dialogueStartedAt === null ? 0 : gs.timeOfDay - this.dialogueStartedAt;
    const scheduleTime = gs.timeOfDay >= RESIDENT_HOME_DEADLINE
      ? gs.timeOfDay
      : Math.max(0, gs.timeOfDay - this.scheduleDelayMinutes - activeDialogueMinutes);
    this.observedTimeOfDay = gs.timeOfDay;
    const modal = gs.paused || gs.transitionActive || gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen ||
      gs.daySummary !== null || gs.tavernPanel !== null || gs.marketPanelOpen || gs.fishing !== null || gs.appearanceEditorOpen ||
      gs.relationshipJournalOpen;
    const scheduled = residentScheduleScene(this.resident.id, gs.day, scheduleTime, this.scheduleMap);
    const jailed = isResidentJailed(this.resident.id);
    if (jailed && this.map.key !== SceneKey.Jail) {
      this.active = false;
      const body = this.collider.body as Phaser.Physics.Arcade.StaticBody;
      body.enable = false;
      this.sprite.setVisible(false).setActive(false);
      this.shadow.setVisible(false).setActive(false);
      this.collider.setActive(false).setData('scheduleActivity', 'in jail').setData('scheduleLocation', 'Town Watch House');
      this.favorMark.setVisible(false);
      return;
    }
    const jailDirective = jailed ? this.jailDirective() : null;
    // why: on Wayfarer night a bar guest sits in a fixed seat instead of pacing the room loop, so the crowd reads as a crowd.
    const seat = !jailDirective && this.map.key === SceneKey.TownBar && scheduled.scene === SceneKey.TownBar
      && this.resident.buildingId !== 'bar' && isTavernNight(gs.day)
      && scheduleTime >= TAVERN_NIGHT.opensAt && scheduleTime < TAVERN_NIGHT.closesAt ? wayfarerSeat(this.resident.id) : null;
    const seatDirective = seat ? { scene: SceneKey.TownBar, x: (seat.tx + 0.5) * TILE, y: (seat.ty + 0.5) * TILE,
      facing: seat.facing, moving: false, activity: scheduled.activity } : null;
    const cuddleDirective = jailDirective
      ?? residentCuddleDirective(this.resident.id, { activity: scheduled.activity, minute: scheduleTime }) ?? seatDirective;
    // Direct conversation pins only this actor. The clock and every other resident continue normally.
    const conversationPinned = !cuddleDirective && talking && this.active && this.presentedSchedule !== null;
    let schedule = scheduled;
    if (conversationPinned) {
      if (!this.presentedSchedule) throw new Error(`Town resident: ${this.resident.name} lost its dialogue schedule`);
      schedule = this.presentedSchedule;
    }
    if (!conversationPinned) {
      this.active = !walking && (cuddleDirective?.scene ?? schedule.scene) === this.map.key;
      this.presentedSchedule = schedule;
    }
    const body = this.collider.body as Phaser.Physics.Arcade.StaticBody;
    body.enable = this.active;
    this.updatePresenceFade();
    const activityLabel = walking ? 'walking with the keeper' : cuddleDirective?.activity ?? schedule.activity;
    const locationLabel = walking ? 'With the keeper' : cuddleDirective && cuddleDirective !== seatDirective
      ? (cuddleDirective.scene === SceneKey.Town ? 'Town' : 'Private room') : schedule.locationLabel;
    this.collider.setActive(this.active).setData('scheduleActivity', activityLabel).setData('scheduleLocation', locationLabel);
    if (!this.active) { this.hideGreeting(); this.favorMark.setVisible(false); return; }
    const playerDistance = Math.hypot(gs.player.x - this.x, gs.player.y - this.y);
    // Room loops are timed by elapsedMs, so they still pause beside the player. Town routes follow the clock.
    const nearby = this.map.key !== SceneKey.Town && playerDistance < 28;
    if (!modal && !nearby) this.elapsedMs += this.scene.game.loop.delta;
    const previousX = this.x, previousY = this.y;
    let moving: boolean;
    if (cuddleDirective) {
      this.x = cuddleDirective.x; this.y = cuddleDirective.y; this.facing = cuddleDirective.facing;
      moving = cuddleDirective.moving && !modal;
    } else if (conversationPinned) {
      moving = false;
    } else if (this.map.key === SceneKey.Town) {
      const presence = residentTownPresence(this.resident.id, gs.day, scheduleTime, this.map);
      if (!presence) throw new Error(`Town resident: ${this.resident.name} has no outdoor position`);
      this.x = presence.x; this.y = presence.y; this.facing = presence.facing; moving = presence.moving && !modal;
      if (!moving && playerDistance < NOTICE_PLAYER_PX && !modal) {
        // People turn to look at someone who walks right up to them.
        const dx = gs.player.x - this.x, dy = gs.player.y - this.y;
        this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
      if (playerDistance < NOTICE_PLAYER_PX && !modal && !talking) this.greetOncePerDay(gs.day, gs.timeOfDay);
    } else {
      if (!this.route) throw new Error(`Town resident: ${this.resident.name} has no room route`);
      const moveMs = 430, cycleMs = this.route.reduce((total, point) => total + point.pauseMs + moveMs, 0);
      let phase = this.elapsedMs % cycleMs, leg = 0;
      while (leg < this.route.length - 1 && phase >= this.route[leg].pauseMs + moveMs) {
        phase -= this.route[leg].pauseMs + moveMs; leg++;
      }
      const from = this.route[leg], to = this.route[(leg + 1) % this.route.length];
      moving = phase >= from.pauseMs && !modal && !nearby;
      const fraction = Math.max(0, Math.min(1, (phase - from.pauseMs) / moveMs));
      this.x = (from.tx + (to.tx - from.tx) * fraction + 0.5) * TILE;
      this.y = (from.ty + (to.ty - from.ty) * fraction + 0.5) * TILE;
      if (moving) this.facing = to.tx > from.tx ? 'right' : to.tx < from.tx ? 'left' : to.ty > from.ty ? 'down' : 'up';
    }
    // Count only real ground covered, so legs never paddle in place or slide without stepping.
    if (moving) this.walkedPx += Math.hypot(this.x - previousX, this.y - previousY);
    const row = { down: 0, up: 1, left: 2, right: 3 }[this.facing];
    const frame = row * 4 + (moving && !settings.reducedMotion ? Math.floor(this.walkedPx / CLASSIC_STRIDE_PX) % 4 : 0);
    // A Wayfarer guest in their seat sits on the chair: legs hidden, torso lowered onto the cushion, like tavern guests.
    const seated = seatDirective !== null && cuddleDirective === seatDirective;
    // why: a guest who faces down, left or right sits in front of the chair back, so they draw over the chair
    // (its depth is the tile's bottom edge). A guest facing up keeps their back behind the chair-back art.
    const depth = seated && this.facing !== 'up' ? (Math.floor(this.y / TILE) + 1) * TILE + 1 : this.y;
    // Match actual foot pixels, not canvas center: the sheet's feet are FEET_CENTER_DY pixels below its centre.
    this.sprite.setTexture(this.originalTexture, frame).setOrigin(0.5).setScale(1)
      // why: side chairs tuck toward their table, so the seated body shifts with the seat.
      .setPosition(this.x + (seated ? seatedOffsetX(this.facing) : 0), this.y + (seated ? SEATED_DROP_PX : 0) - FEET_CENTER_DY)
      .setDepth(depth)
      .setData('feetX', this.x).setData('feetY', this.y).setData('moving', moving).setData('seated', seated)
      .setData('scheduleActivity', activityLabel).setData('scheduleLocation', locationLabel);
    // why: crop one pixel below the sprite origin (the hips), the same cut TavernScene uses for seated guests.
    if (seated) this.sprite.setCrop(0, 0, this.sprite.frame.width, this.sprite.frame.height / 2 + 1);
    else this.sprite.setCrop();
    this.shadow.setPosition(this.x, this.y + 1).setDepth(this.y - 1)
      // why: the door fade above already chose visibility; seating only ever hides the shadow, never shows it.
      .setVisible(this.shadow.visible && !seated);
    this.collider.setPosition(this.x, this.y);
    body.position.set(this.x - 4, this.y - 3);
    body.updateCenter();
    const hasFavor = TownLifeSystem.openFavor()?.favor.residentId === this.resident.id;
    // why: the hello and the marker share the space over the head; the hello wins while it shows.
    this.favorMark.setVisible(hasFavor && this.greeting === null && this.presenceAlpha > 0)
      .setPosition(this.x, this.y - 28).setDepth(this.y + 190);
    if (this.greeting) {
      if (this.scene.time.now >= this.greetingUntil) this.hideGreeting();
      else this.greeting.setPosition(this.x, this.y - 30).setDepth(this.y + 200);
    }
  }

  /**
   * Fade the sprite in or out when the resident steps through a door, instead of popping.
   * While fading out, the sprite stays where it was last drawn (the doorway).
   * Residents that are already inside when the scene starts are hidden at once.
   */
  private updatePresenceFade(): void {
    const target = this.active ? 1 : 0;
    if (!this.presenceStarted) { this.presenceAlpha = target; this.presenceStarted = true; }
    const step = this.scene.game.loop.delta / DOOR_FADE_MS;
    this.presenceAlpha = target > this.presenceAlpha ? Math.min(target, this.presenceAlpha + step)
      : Math.max(target, this.presenceAlpha - step);
    const shown = this.presenceAlpha > 0;
    this.sprite.setVisible(shown).setActive(shown).setAlpha(this.presenceAlpha);
    this.shadow.setVisible(shown).setActive(shown).setAlpha(this.presenceAlpha);
  }

  /**
   * Show a short hello the first time the player comes close on a given day.
   * @param day Current game day; one greeting per resident per day.
   * @param timeOfDay Minutes since 06:00, used to pick morning/afternoon/evening wording.
   */
  private greetOncePerDay(day: number, timeOfDay: number): void {
    if (GREETED_DAY.get(this.resident.id) === day) return;
    GREETED_DAY.set(this.resident.id, day);
    const band = timeOfDay < 360 ? GREETINGS.morning : timeOfDay < 720 ? GREETINGS.afternoon : GREETINGS.evening;
    const residentIndex = TOWN_RESIDENTS.findIndex(candidate => candidate.id === this.resident.id);
    const text = band[(residentIndex + day) % band.length];
    this.greeting?.destroy();
    // Render at 8px then halve, like the conversation bubbles; Phaser text blurs below 8px.
    this.greeting = this.scene.add.text(this.x, this.y - 30, text, { fontFamily: 'monospace', fontStyle: 'bold',
      fontSize: '8px', color: '#3a2720', backgroundColor: '#fff0c8', padding: { x: 3, y: 2 } })
      .setOrigin(0.5, 1).setScale(0.5).setName(`town-greeting-${this.resident.id}`);
    this.greetingUntil = this.scene.time.now + GREETING_MS;
  }

  /** Remove the floating hello, if any. */
  private hideGreeting(): void {
    this.greeting?.destroy();
    this.greeting = null;
  }

  /** Return visible feet for bubbles and tests without exposing the sprite as a movement authority. */
  position(): { x: number; y: number } | null {
    return this.active ? { x: this.x, y: this.y } : null;
  }

  /** Return visible feet and facing for the world witness cone. */
  observation(): { x: number; y: number; facing: Facing } | null {
    return this.active ? { x: this.x, y: this.y, facing: this.facing } : null;
  }

  /** Open the next authored line only when the player faces this resident. Return true when dialogue consumes E. */
  interact(tx: number, ty: number): boolean {
    const gs = GameState.instance;
    // Town walkers stand between tile centers (rounded corners, keep-right lane), so accept the faced tile when the
    // resident's feet are within most of a tile of its center.
    const facedTileDistance = Math.hypot((tx + 0.5) * TILE - this.x, (ty + 0.5) * TILE - this.y);
    if (!this.active || facedTileDistance > TILE * 0.8 || gs.dialogue !== null ||
      gs.paused || gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary !== null ||
      gs.tavernPanel !== null || gs.marketPanelOpen || gs.transitionActive || gs.appearanceEditorOpen || gs.relationshipJournalOpen ||
      gs.fishing !== null) return false;
    const activity = String(this.collider.getData('scheduleActivity') ?? '');
    if (activity === 'do not disturb' || activity === 'busy' || activity === 'waiting privately') {
      this.scene.game.events.emit('toast', activity === 'do not disturb' ? `${this.resident.name} is busy. Please do not disturb.`
        : `${this.resident.name} needs a private moment.`);
      return true;
    }
    const dx = gs.player.x - this.x, dy = gs.player.y - this.y;
    if (Math.hypot(dx, dy) > TILE * 2) return false;
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    meetResidentInPerson(this.resident.id);
    this.update();
    return true;
  }
}
