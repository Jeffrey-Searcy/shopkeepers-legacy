/**
 * PartyCompanion — a recruited town resident who travels with the keeper, follows a step behind,
 * and joins fights.
 *
 * Two uses, one class:
 *  - combat: the portal dungeon and the mines bring the whole saved party (GameState.social.party,
 *    at most MAX_PARTY_SIZE resident ids; the recruiting UI owns it);
 *  - walk mode: every other world scene except the Jail brings the party members who agreed to
 *    "Walk with me" (CompanionWalkSystem.walkers()). BaseWorldScene owns that PartyCompanions and
 *    passes a combat view with no enemies, so walkers only follow. The keeper can face a walker and
 *    press Interact to talk or give a gift (memberAt). Once a walker reaches the trail spot (or
 *    cannot get closer), they hold still until the keeper moves more than WALK_SLACK_PX away, so
 *    turning to face them never sends them around the keeper.
 * Each scene passes a roster callback; this module only reads it. Scenes build one PartyCompanions
 * per scene instance, place the members beside the keeper on every arrival or room entry, and drive
 * them each frame.
 *
 * Rules:
 *  - every hit goes through CombatController.strikeEnemy, the same path as the keeper's sword, so a
 *    companion kill drops loot, clears floors, and records the Warden exactly like a keeper kill;
 *  - each resident fights in one fixed style (COMPANION_STYLES): melee swings or short thrown
 *    shots, always weaker than the keeper's sword so the player still carries the fight;
 *  - enemies still chase only the keeper, but touching a monster hurts a companion. At 0 HP the
 *    companion is knocked out for KNOCKOUT_MS, then gets back up at full HP. Nobody dies for good;
 *  - companions never change saved state, the keeper's HP, inventory, or gold;
 *  - nothing here is random. Behaviour depends only on positions, timers, and the fixed table.
 *
 * Companions have no physics body (like MayorHollis): they move by hand and test each step against
 * the scene's walkable-tile check, so they never walk through walls and never block the keeper.
 * Scene shutdown destroys every display object they own.
 */
import Phaser from 'phaser';
import { FEET_CENTER_DY, TILE } from '../config/GameConfig';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { CHARACTER_SHEET_IDS } from '../config/ResidentCharacterSheets';
import type { ResidentId } from '../config/ResidentRelationships';
import { MAX_PARTY_SIZE } from '../systems/KeeperSocialState';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { GameState, type Facing } from '../state/GameState';
import type { Enemy } from '../combat/Enemy';
import type { MapData } from '../world/MapDef';

/** One of the twelve authored resident ids (a literal type, so the style table must cover all). */
type CompanionResidentId = typeof CHARACTER_SHEET_IDS[number];

/** How one resident fights. All numbers are fixed design values, never rolled. */
export interface CompanionStyle {
  /** 'melee' swings at arm's length; 'thrown' tosses small objects from a few tiles away. */
  readonly kind: 'melee' | 'thrown';
  /** What they swing or throw (flavour for the label and tests). */
  readonly weapon: string;
  /** Hit points removed per hit (the keeper's sword does 2+ every 350 ms). */
  readonly damage: number;
  /** Milliseconds between attacks. */
  readonly cooldownMs: number;
  /** Feet-to-enemy distance in px at which an attack lands. */
  readonly rangePx: number;
  /** Contact hits the companion can take before a knockout. */
  readonly maxHp: number;
}

/**
 * Each resident's fighting style, chosen from their trade in config/TownResidents.ts: the smith,
 * the carpenter, the guard, the rancher, and the tailor fight up close; the shopkeepers, healers,
 * scholars, and the angler throw things. Highest damage per second here is 2 / 1.3 s ≈ 1.5, about a
 * quarter of the keeper's base sword (2 / 0.35 s ≈ 5.7).
 */
const COMPANION_STYLES: Readonly<Record<CompanionResidentId, CompanionStyle>> = {
  nyra: { kind: 'thrown', weapon: 'sparks', damage: 1, cooldownMs: 1100, rangePx: 64, maxHp: 3 },
  tessa: { kind: 'thrown', weapon: 'apples', damage: 1, cooldownMs: 1200, rangePx: 60, maxHp: 3 },
  rhea: { kind: 'melee', weapon: 'hammer', damage: 2, cooldownMs: 1300, rangePx: 18, maxHp: 5 },
  sylvie: { kind: 'thrown', weapon: 'pebbles', damage: 1, cooldownMs: 1400, rangePx: 56, maxHp: 3 },
  elowen: { kind: 'thrown', weapon: 'ink pots', damage: 1, cooldownMs: 1300, rangePx: 56, maxHp: 3 },
  seren: { kind: 'melee', weapon: 'spear', damage: 1, cooldownMs: 800, rangePx: 22, maxHp: 5 },
  rowan: { kind: 'melee', weapon: 'crook', damage: 1, cooldownMs: 950, rangePx: 20, maxHp: 4 },
  julian: { kind: 'thrown', weapon: 'corks', damage: 1, cooldownMs: 1000, rangePx: 60, maxHp: 3 },
  bram: { kind: 'melee', weapon: 'mallet', damage: 2, cooldownMs: 1400, rangePx: 18, maxHp: 5 },
  kit: { kind: 'thrown', weapon: 'sinkers', damage: 1, cooldownMs: 1000, rangePx: 64, maxHp: 3 },
  cael: { kind: 'thrown', weapon: 'vials', damage: 1, cooldownMs: 1200, rangePx: 60, maxHp: 3 },
  dorian: { kind: 'melee', weapon: 'shears', damage: 1, cooldownMs: 900, rangePx: 18, maxHp: 4 },
};

/** Normal walking speed in px per second (the keeper walks at 96). */
const WALK_SPEED = 72;
/** Catch-up speed when the companion has fallen behind (a little faster than the keeper). */
const CATCH_UP_SPEED = 104;
/** Farther than this from the trail spot, the companion uses the catch-up speed. */
const CATCH_UP_PX = 3 * TILE;
/** How far behind the keeper the trail spot sits, in px. */
const TRAIL_PX = 18;
/** Sideways spread of the two trail spots, in px (slot 0 left of the keeper's back, slot 1 right). */
const TRAIL_SPREAD_PX = 10;
/** Close enough to the trail spot to stand still, in px. */
const ARRIVE_PX = 4;
/** A companion notices monsters within this many px of itself... */
const AGGRO_PX = 5 * TILE;
/** ...but only fights within this many px of the keeper, so it never wanders off alone. */
const LEASH_PX = 6 * TILE;
/** Farther than this from the keeper (a teleport, a long dodge chain), the companion regroups at once. */
const REGROUP_PX = 9 * TILE;
/** A follower that makes no progress for this long while still far away regroups beside the keeper. */
const STUCK_MS = 1200;
/**
 * Walk mode only: a walker who has settled stays put until the keeper is farther than this. Two tiles
 * is more than Interact reach (faced tile centre plus MEMBER_REACH_PX), so a walker the keeper can talk
 * to never moves.
 */
const WALK_SLACK_PX = 2 * TILE;
/**
 * How far a member's feet may be from the faced tile's centre and still answer Interact. A full tile,
 * not TownResident's 0.8: a settled walker stands TRAIL_PX behind and TRAIL_SPREAD_PX to the side of
 * the keeper, up to about 14 px from the faced tile's centre once the keeper turns around.
 */
const MEMBER_REACH_PX = TILE;
/** A monster this close (px) to the companion's feet touches it. Same reach as on the keeper. */
const CONTACT_PX = 14;
/** Grace time after a contact hit, so contact damage ticks instead of melting a companion. */
const HIT_INVULN_MS = 700;
/** How long a knocked-out companion stays down before getting back up at full HP. */
export const KNOCKOUT_MS = 5000;
/** Classic sheets advance one walk frame per this many px walked (matches TownResident). */
const STRIDE_PX = 5.5;
/** Half-size of the feet box tested against walls, in px. */
const FEET_HALF_W = 3;
const FEET_HALF_H = 2;
/** Flight time of a thrown object, in ms (visual only; the hit lands on release). */
const THROW_FLIGHT_MS = 140;

/** Unit vector for each facing. */
const FACING_VEC: Record<Facing, readonly [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
/** Sprite-sheet row for each facing (navigation sheet: down, up, left, right). */
const FACING_ROW: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 };

/** Answers whether a companion's feet may stand on tile (tx, ty). Must return false out of bounds. */
export type WalkableTile = (tx: number, ty: number) => boolean;

/**
 * How companions behave: 'combat' (Dungeon, Mines) always keeps the trail spot behind the keeper and
 * fights; 'walk' (BaseWorldScene) only follows and holds still near the keeper (WALK_SLACK_PX).
 */
export type CompanionMode = 'combat' | 'walk';

/**
 * The part of CombatController a companion needs: the live enemy list and the shared hit path.
 * CombatController satisfies it structurally.
 */
export interface CompanionCombat {
  readonly enemies: readonly Enemy[];
  strikeEnemy(enemy: Enemy, damage: number, fromX: number, fromY: number): boolean;
}

/** The keeper's feet and facing, read from GameState.player each frame. */
interface KeeperPose {
  x: number;
  y: number;
  facing: Facing;
}

/**
 * Look up one resident's fighting style.
 * @param residentId a resident id from the party list
 * @returns the fixed style for that resident
 * @throws when the id is not one of the twelve residents
 */
export function companionStyleFor(residentId: string): CompanionStyle {
  if (!Object.prototype.hasOwnProperty.call(COMPANION_STYLES, residentId)) {
    throw new Error(`PartyCompanion: unknown resident "${residentId}" in the adventuring party`);
  }
  return COMPANION_STYLES[residentId as CompanionResidentId];
}

/**
 * Build the basic walkable-tile check for a world map: inside the map and not a solid tile.
 * Scenes add their own blockers (such as the dungeon's altars) on top.
 * @param map the scene's map data
 * @returns a WalkableTile callback
 */
export function mapWalkable(map: MapData): WalkableTile {
  return (tx, ty) => tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && !map.solid[ty][tx];
}

/**
 * Find the first free tile near the keeper, searching rings of growing radius in a fixed order.
 * @param keeperTx keeper feet tile x
 * @param keeperTy keeper feet tile y
 * @param walkable the scene's walkable check
 * @param taken tile keys ("tx,ty") already used by other companions
 * @returns the tile centre in world px
 * @throws when no free tile exists within 3 tiles (the scene layout is broken)
 */
function freeSpotNear(keeperTx: number, keeperTy: number, walkable: WalkableTile, taken: ReadonlySet<string>): { x: number; y: number } {
  for (let radius = 1; radius <= 3; radius++) {
    // why: a fixed scan order (below the keeper first, then sides, then above) keeps placement
    // deterministic and puts companions where the keeper just came from on a room entry.
    for (const dy of [radius, 0, -radius, ...rangeExcluding(radius)]) {
      for (const dx of [0, -radius, radius, ...rangeExcluding(radius)]) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tx = keeperTx + dx;
        const ty = keeperTy + dy;
        if (!walkable(tx, ty) || taken.has(`${tx},${ty}`)) continue;
        return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
      }
    }
  }
  throw new Error(`PartyCompanion: no free tile near the keeper at ${keeperTx},${keeperTy}`);
}

/**
 * Offsets strictly between -radius and radius, excluding 0 (inner ring positions for the scan).
 * @param radius ring radius in tiles
 * @returns the offsets in ascending order
 */
function rangeExcluding(radius: number): number[] {
  const out: number[] = [];
  for (let n = -radius + 1; n < radius; n++) if (n !== 0) out.push(n);
  return out;
}

/**
 * One recruited resident walking with the keeper. Lives only as long as its scene; holds no saved
 * state. Created by PartyCompanions, placed with placeAt, and advanced with update.
 */
export class PartyCompanion {
  readonly residentId: string;
  /** Display name from the resident catalog. */
  readonly name: string;
  readonly style: CompanionStyle;
  /** Feet position in world px. */
  x = 0;
  y = 0;
  /** Contact hits left before a knockout. */
  hp: number;
  /** Enemies this companion has killed in this scene instance (tests and tuning read it). */
  kills = 0;
  private facing: Facing = 'down';
  /** Time until the next attack may start. */
  private cooldownMs = 0;
  /** Grace time after a contact hit. */
  private invulnMs = 0;
  /** Time left lying down; 0 while standing. */
  private knockedOutMs = 0;
  /** Distance walked, for the walk-frame cycle. */
  private walkedPx = 0;
  /** Time spent following without getting closer while still far from the trail spot. */
  private stuckMs = 0;
  /** Set when the companion should be moved next to the keeper by its PartyCompanions owner. */
  wantsRegroup = false;
  /** Walk mode: true once the companion reached the trail spot (or could get no closer) and is holding. */
  private settled = false;
  private readonly texture: string;
  private readonly root: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;

  /**
   * Build the sprite, shadow and name label. The companion stays hidden at (0,0) until placeAt.
   * @param scene the combat scene that owns the display objects
   * @param residentId a resident id from GameState.social.party
   * @param slot party position (0 or 1), which picks the left or right trail spot
   * @param walkable the scene's walkable-tile check
   * @param mode combat or walk behaviour (see CompanionMode)
   * @throws when the resident id is unknown
   */
  constructor(private readonly scene: Phaser.Scene, residentId: string, readonly slot: number,
    private readonly walkable: WalkableTile, private readonly mode: CompanionMode) {
    this.style = companionStyleFor(residentId);
    const resident = TOWN_RESIDENTS.find(candidate => candidate.id === residentId);
    if (!resident) throw new Error(`PartyCompanion: resident "${residentId}" is missing from the town catalog`);
    this.residentId = residentId;
    this.name = resident.name;
    this.hp = this.style.maxHp;
    this.texture = AppearanceTextureSystem.forGame(scene.game).residentTextureFor(residentId);
    this.root = scene.add.container(0, 0).setName(`party-companion-${residentId}`).setVisible(false);
    const shadow = scene.add.ellipse(0, 1, 12, 5, 0x211c24, 0.2);
    this.sprite = scene.add.sprite(0, -FEET_CENTER_DY, this.texture, 0).setName(`party-companion-sprite-${residentId}`);
    this.root.add([shadow, this.sprite]);
    // why: render at 8px then halve, like resident greetings; Phaser text blurs below 8px. The label
    // is its own object (not in the container) so it can sit above monsters drawn lower on screen.
    this.label = scene.add.text(0, 0, resident.name, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '8px',
      color: '#fff0c8', stroke: '#2a1e2e', strokeThickness: 3 }).setOrigin(0.5, 1).setScale(0.5)
      .setName(`party-companion-label-${residentId}`).setVisible(false);
  }

  /** True while the companion lies knocked out. */
  get knockedOut(): boolean {
    return this.knockedOutMs > 0;
  }

  /**
   * Put the companion on a spot, standing, at full HP, with fresh timers (a new room is a fresh start).
   * @param x feet x in world px
   * @param y feet y in world px
   * @param facing which way to face
   * Side effects: shows the companion and its label.
   */
  placeAt(x: number, y: number, facing: Facing): void {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.hp = this.style.maxHp;
    this.cooldownMs = 0;
    this.invulnMs = 0;
    this.knockedOutMs = 0;
    this.stuckMs = 0;
    this.wantsRegroup = false;
    this.settled = true;
    this.sprite.setAngle(0).setAlpha(1).clearTint();
    this.root.setVisible(true);
    this.label.setVisible(true).setAlpha(1);
    this.render(false);
  }

  /**
   * Move the companion beside the keeper after it fell far behind or got stuck. Unlike placeAt it
   * keeps HP and timers, so regrouping is never a free heal.
   * @param x feet x in world px
   * @param y feet y in world px
   */
  relocate(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.stuckMs = 0;
    this.wantsRegroup = false;
    this.settled = true;
    this.render(false);
  }

  /**
   * Turn to face a world point, for example the keeper who just spoke to this companion.
   * @param px point x in world px
   * @param py point y in world px
   * Side effects: redraws the sprite standing still.
   */
  turnToward(px: number, py: number): void {
    this.faceToward(px, py);
    this.render(false);
  }

  /** Remove every display object this companion owns (roster change inside a live scene). */
  destroy(): void {
    this.scene.tweens.killTweensOf(this.sprite);
    this.root.destroy();
    this.label.destroy();
  }

  /**
   * Advance one frame: recover, take contact hits, then fight or follow.
   * @param deltaMs frame time in ms
   * @param keeper the keeper's feet and facing
   * @param combat the scene's combat controller
   * Side effects: may damage or kill enemies through combat.strikeEnemy; may set wantsRegroup.
   */
  update(deltaMs: number, keeper: KeeperPose, combat: CompanionCombat): void {
    this.cooldownMs = Math.max(0, this.cooldownMs - deltaMs);
    this.invulnMs = Math.max(0, this.invulnMs - deltaMs);
    if (this.knockedOutMs > 0) {
      this.knockedOutMs = Math.max(0, this.knockedOutMs - deltaMs);
      if (this.knockedOutMs === 0) this.getUp();
      this.render(false);
      return;
    }
    if (this.takeContactHits(combat)) {
      this.render(false);
      return;
    }
    const keeperDist = Math.hypot(keeper.x - this.x, keeper.y - this.y);
    if (keeperDist > REGROUP_PX) {
      this.wantsRegroup = true;
      this.render(false);
      return;
    }
    const target = this.pickTarget(keeper, combat);
    const moving = target ? this.fight(target, deltaMs, combat) : this.follow(keeper, deltaMs);
    this.render(moving);
  }

  /**
   * Check monster contact and apply at most one hit this frame.
   * @param combat the scene's combat controller
   * @returns true when the hit knocked the companion out
   * Side effects: lowers hp, flashes the sprite, may start a knockout.
   */
  private takeContactHits(combat: CompanionCombat): boolean {
    if (this.invulnMs > 0) return false;
    const toucher = combat.enemies.find(enemy => Math.hypot(enemy.x - this.x, enemy.y - this.y) < CONTACT_PX);
    if (!toucher) return false;
    this.hp = Math.max(0, this.hp - toucher.touchDamage);
    this.invulnMs = HIT_INVULN_MS;
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.sprite.clearTint());
    if (this.hp > 0) return false;
    this.knockedOutMs = KNOCKOUT_MS;
    // why: lying on the side and dimmed reads as "down for a moment" without new art.
    this.sprite.setAngle(90).setAlpha(0.6);
    this.label.setAlpha(0.6);
    return true;
  }

  /** Stand back up at full HP after a knockout. Side effects: restores the sprite and label. */
  private getUp(): void {
    this.hp = this.style.maxHp;
    this.sprite.setAngle(0).setAlpha(1);
    this.label.setAlpha(1);
  }

  /**
   * The nearest live enemy the companion should fight, or null.
   * @param keeper the keeper's feet
   * @param combat the scene's combat controller
   * @returns an enemy within AGGRO_PX of the companion and LEASH_PX of the keeper, or null
   */
  private pickTarget(keeper: KeeperPose, combat: CompanionCombat): Enemy | null {
    let best: Enemy | null = null;
    let bestDist = Infinity;
    for (const enemy of combat.enemies) {
      const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
      if (dist > AGGRO_PX || Math.hypot(enemy.x - keeper.x, enemy.y - keeper.y) > LEASH_PX) continue;
      // why: ties break on list order, which is spawn order, so the choice is deterministic.
      if (dist < bestDist) {
        best = enemy;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Close in on the target and attack when in range and off cooldown.
   * @param target the enemy to fight
   * @param deltaMs frame time
   * @param combat the scene's combat controller
   * @returns true when the companion moved this frame
   * Side effects: may hit or kill the target through combat.strikeEnemy.
   */
  private fight(target: Enemy, deltaMs: number, combat: CompanionCombat): boolean {
    const dist = Math.hypot(target.x - this.x, target.y - this.y);
    this.faceToward(target.x, target.y);
    this.stuckMs = 0;
    if (dist > this.style.rangePx) {
      // why: stop a little inside the range so knockback jitter does not flip between walk and swing.
      return this.moveToward(target.x, target.y, WALK_SPEED, deltaMs, this.style.rangePx - 2);
    }
    if (this.cooldownMs > 0) return false;
    this.cooldownMs = this.style.cooldownMs;
    const targetX = target.x;
    const targetY = target.y;
    // why: the hit lands on release; the thrown object's flight is only a picture, so game logic
    // never depends on a tween finishing.
    if (combat.strikeEnemy(target, this.style.damage, this.x, this.y)) this.kills += 1;
    if (this.style.kind === 'thrown') this.showThrow(targetX, targetY);
    else this.showSwing(targetX, targetY);
    return false;
  }

  /**
   * Walk to the trail spot behind the keeper. In walk mode a settled companion holds still while the
   * keeper stays within WALK_SLACK_PX.
   * @param keeper the keeper's feet and facing
   * @param deltaMs frame time
   * @returns true when the companion moved this frame
   * Side effects: may set wantsRegroup when stuck behind a wall; updates settled in walk mode.
   */
  private follow(keeper: KeeperPose, deltaMs: number): boolean {
    if (this.mode === 'walk') {
      // why: the keeper turns around to talk to a walker. Chasing the new trail spot behind the keeper
      // would walk the walker through the keeper and out of reach, so a settled walker stays put until
      // the keeper actually walks away.
      if (Math.hypot(keeper.x - this.x, keeper.y - this.y) > WALK_SLACK_PX) this.settled = false;
      else if (this.settled) {
        this.stuckMs = 0;
        return false;
      }
    }
    const [fx, fy] = FACING_VEC[keeper.facing];
    // why: the perpendicular of the facing vector spreads the two companions to either side.
    const side = (this.slot === 0 ? -1 : 1) * TRAIL_SPREAD_PX;
    const goalX = keeper.x - fx * TRAIL_PX - fy * side;
    const goalY = keeper.y - fy * TRAIL_PX + fx * side;
    const dist = Math.hypot(goalX - this.x, goalY - this.y);
    if (dist <= ARRIVE_PX) {
      this.stuckMs = 0;
      this.facing = keeper.facing;
      this.settled = true;
      return false;
    }
    const speed = dist > CATCH_UP_PX ? CATCH_UP_SPEED : WALK_SPEED;
    const moved = this.moveToward(goalX, goalY, speed, deltaMs, ARRIVE_PX);
    // why: a walker blocked short of the trail spot (a fence, a crate) but already near the keeper
    // settles where they are instead of pushing against it every frame.
    if (!moved && this.mode === 'walk' && Math.hypot(keeper.x - this.x, keeper.y - this.y) <= WALK_SLACK_PX) this.settled = true;
    // why: a wall between companion and keeper can stop both axes; after a short wait, regroup
    // beside the keeper instead of standing stuck. Close by, standing still is fine.
    if (!moved && dist > 2 * TILE) this.stuckMs += deltaMs;
    else this.stuckMs = 0;
    if (this.stuckMs >= STUCK_MS) this.wantsRegroup = true;
    return moved;
  }

  /**
   * Step toward a point, one axis at a time so the companion slides along walls.
   * @param gx goal x in world px
   * @param gy goal y in world px
   * @param speed px per second
   * @param deltaMs frame time
   * @param stopPx stop when this close to the goal
   * @returns true when the feet moved at all
   */
  private moveToward(gx: number, gy: number, speed: number, deltaMs: number, stopPx: number): boolean {
    const dx = gx - this.x;
    const dy = gy - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= stopPx) return false;
    const step = Math.min(dist - stopPx, (speed * deltaMs) / 1000);
    const nx = this.x + (dx / dist) * step;
    const ny = this.y + (dy / dist) * step;
    let moved = false;
    if (nx !== this.x && this.feetClear(nx, this.y)) {
      this.x = nx;
      moved = true;
    }
    if (ny !== this.y && this.feetClear(this.x, ny)) {
      this.y = ny;
      moved = true;
    }
    if (moved) {
      this.walkedPx += step;
      this.faceToward(gx, gy);
    }
    return moved;
  }

  /**
   * True when every corner of the small feet box at (x, y) is on a walkable tile.
   * @param x feet x in world px
   * @param y feet y in world px
   */
  private feetClear(x: number, y: number): boolean {
    for (const [cx, cy] of [[x - FEET_HALF_W, y - FEET_HALF_H], [x + FEET_HALF_W, y - FEET_HALF_H],
      [x - FEET_HALF_W, y + FEET_HALF_H], [x + FEET_HALF_W, y + FEET_HALF_H]]) {
      if (!this.walkable(Math.floor(cx / TILE), Math.floor(cy / TILE))) return false;
    }
    return true;
  }

  /**
   * Face a world point along the stronger axis.
   * @param px point x
   * @param py point y
   */
  private faceToward(px: number, py: number): void {
    const dx = px - this.x;
    const dy = py - this.y;
    if (dx === 0 && dy === 0) return;
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }

  /**
   * A short lunge toward the target (visual only).
   * @param tx target x
   * @param ty target y
   */
  private showSwing(tx: number, ty: number): void {
    const dist = Math.hypot(tx - this.x, ty - this.y);
    if (dist === 0) return;
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setPosition(0, -FEET_CENTER_DY);
    this.scene.tweens.add({ targets: this.sprite, x: ((tx - this.x) / dist) * 3, y: -FEET_CENTER_DY + ((ty - this.y) / dist) * 3,
      duration: 70, yoyo: true });
  }

  /**
   * A small object flying from the companion's hand to the target (visual only).
   * @param tx target x
   * @param ty target y
   */
  private showThrow(tx: number, ty: number): void {
    const shot = this.scene.add.circle(this.x, this.y - FEET_CENTER_DY - 2, 1.5, 0xf2e2b8)
      .setStrokeStyle(0.5, 0x3a2720).setDepth(this.y + 1);
    this.scene.tweens.add({ targets: shot, x: tx, y: ty - 2, duration: THROW_FLIGHT_MS, onComplete: () => shot.destroy() });
  }

  /**
   * Draw the companion at its feet with the right facing and walk frame.
   * @param moving true when it walked this frame (animates the legs)
   */
  private render(moving: boolean): void {
    const frame = FACING_ROW[this.facing] * 4 + (moving ? Math.floor(this.walkedPx / STRIDE_PX) % 4 : 0);
    this.sprite.setTexture(this.texture, frame);
    this.root.setPosition(this.x, this.y).setDepth(this.y)
      .setData('residentId', this.residentId).setData('feetX', this.x).setData('feetY', this.y)
      .setData('knockedOut', this.knockedOut);
    this.label.setPosition(this.x, this.y - 22).setDepth(this.y + 190);
  }
}

/**
 * The companions in one scene: reads a roster (the whole party in combat scenes, today's walkers
 * elsewhere), builds one PartyCompanion per member, places them beside the keeper, and advances them
 * each frame.
 */
export class PartyCompanions {
  /** Live companions in roster order. Empty when the roster is empty. */
  members: PartyCompanion[] = [];

  /**
   * Read the roster and build its members (hidden until placeNearKeeper).
   * @param scene the scene that owns the display objects
   * @param walkable the scene's walkable-tile check
   * @param roster returns the resident ids who should be here right now (read on every sync)
   * @param mode 'combat' for the Dungeon and the Mines, 'walk' for BaseWorldScene's walkers
   * @throws when the roster is too large, repeats a resident, or names an unknown resident
   */
  constructor(private readonly scene: Phaser.Scene, private readonly walkable: WalkableTile,
    private readonly roster: () => readonly ResidentId[], private readonly mode: CompanionMode) {
    this.syncRoster();
  }

  /**
   * Match the live members to the roster: members who left are destroyed, members who stay keep their
   * position, HP and slot, and new members take the lowest free slot (hidden until placed).
   * @returns the members created by this call
   * @throws when the roster is too large or repeats a resident
   * Side effects: destroys and creates companion display objects.
   */
  private syncRoster(): PartyCompanion[] {
    const roster = [...this.roster()];
    if (roster.length > MAX_PARTY_SIZE) throw new Error(`PartyCompanion: the roster has ${roster.length} members (max ${MAX_PARTY_SIZE})`);
    if (new Set(roster).size !== roster.length) throw new Error('PartyCompanion: the roster repeats a resident');
    if (roster.join(',') === this.members.map(member => member.residentId).join(',')) return [];
    const kept = this.members.filter(member => roster.includes(member.residentId as ResidentId));
    for (const member of this.members) if (!kept.includes(member)) member.destroy();
    const added: PartyCompanion[] = [];
    for (const id of roster) {
      if (kept.some(member => member.residentId === id)) continue;
      // why: a member who stays keeps their trail side; the newcomer takes the side nobody uses.
      let slot = 0;
      while ([...kept, ...added].some(member => member.slot === slot)) slot++;
      added.push(new PartyCompanion(this.scene, id, slot, this.walkable, this.mode));
    }
    const live = [...kept, ...added];
    this.members = roster.map(id => {
      const member = live.find(candidate => candidate.residentId === id);
      if (!member) throw new Error(`PartyCompanion: roster member ${id} was not built`);
      return member;
    });
    return added;
  }

  /**
   * Re-read the roster mid-scene (walk mode): members who left disappear at once, and members who just
   * joined step in beside the keeper. Members who stay are not moved.
   * Side effects: may create, destroy and place members.
   */
  followRoster(): void {
    const added = this.syncRoster();
    if (added.length === 0) return;
    const gs = GameState.instance;
    const taken = new Set(this.members.filter(member => !added.includes(member))
      .map(member => `${Math.floor(member.x / TILE)},${Math.floor(member.y / TILE)}`));
    for (const member of added) {
      const spot = this.freeSpot(taken);
      member.placeAt(spot.x, spot.y, gs.player.facing);
    }
  }

  /**
   * The member the keeper faces: the member's feet must be within MEMBER_REACH_PX of the faced tile's
   * centre, since followers stand between tile centres (see MEMBER_REACH_PX for why it is a full tile).
   * @param tx faced tile x
   * @param ty faced tile y
   * @returns that member, or null when nobody stands there
   */
  memberAt(tx: number, ty: number): PartyCompanion | null {
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    let best: PartyCompanion | null = null, bestDist = MEMBER_REACH_PX;
    for (const member of this.members) {
      const dist = Math.hypot(member.x - cx, member.y - cy);
      // why: two followers can both be in reach; the nearer one answers, ties go to roster order.
      if (dist <= bestDist && (best === null || dist < bestDist)) {
        best = member;
        bestDist = dist;
      }
    }
    return best;
  }

  /**
   * Re-read the roster and put every member on a free tile beside the keeper, fresh and standing.
   * Call after the keeper is at the arrival spot (scene start, room entry).
   * Side effects: may rebuild members; moves all members.
   */
  placeNearKeeper(): void {
    this.syncRoster();
    const gs = GameState.instance;
    const taken = new Set<string>();
    for (const member of this.members) {
      const spot = this.freeSpot(taken);
      member.placeAt(spot.x, spot.y, gs.player.facing);
    }
  }

  /**
   * Advance every member one frame. The caller skips this while combat is over (knockout, run end).
   * Freezes completely while the game is paused or a scene transition runs.
   * @param deltaMs frame time
   * @param combat the scene's combat controller
   * Side effects: companions move, fight, and may regroup beside the keeper.
   */
  update(deltaMs: number, combat: CompanionCombat): void {
    const gs = GameState.instance;
    // why: the same two flags BaseWorldScene.update stops the keeper on; companions must not act
    // behind the pause menu or a fade.
    if (gs.paused || gs.transitionActive) return;
    const keeper = { x: gs.player.x, y: gs.player.y, facing: gs.player.facing };
    for (const member of this.members) member.update(deltaMs, keeper, combat);
    const taken = new Set(this.members.filter(member => !member.wantsRegroup)
      .map(member => `${Math.floor(member.x / TILE)},${Math.floor(member.y / TILE)}`));
    for (const member of this.members) {
      if (!member.wantsRegroup) continue;
      const spot = this.freeSpot(taken);
      member.relocate(spot.x, spot.y);
    }
  }

  /**
   * Claim a free tile beside the keeper.
   * @param taken tiles already used; the chosen tile is added
   * @returns the tile centre in world px
   */
  private freeSpot(taken: Set<string>): { x: number; y: number } {
    const gs = GameState.instance;
    const spot = freeSpotNear(Math.floor(gs.player.x / TILE), Math.floor(gs.player.y / TILE), this.walkable, taken);
    taken.add(`${Math.floor(spot.x / TILE)},${Math.floor(spot.y / TILE)}`);
    return spot;
  }
}
