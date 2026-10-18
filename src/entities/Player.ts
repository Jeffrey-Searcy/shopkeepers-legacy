/**
 * Player — the controllable farmer.
 *
 * A physics sprite driven by the InputBus (held movement directions). Its collision body size comes
 * from GameConfig (NOT the art size) so swapping the placeholder rect for a PixelLab sprite never
 * changes collision (CLAUDE.md Hard Rule 4). The player writes its live position/facing back into
 * GameState every frame so the test seam and save system see authoritative values.
 *
 * Movement is free (pixel precise) while a direction is held. After a stop, the feet glide onto a
 * tile center so the facing-tile highlight always sits squarely in front of the body.
 */
import Phaser from 'phaser';
import { AnimKey, TextureKey, PLAYER_ACTION_DATA_KEY } from '../config/AssetKeys';
import {
  PLAYER_ACCELERATION,
  PLAYER_BODY,
  PLAYER_BRAKING,
  PLAYER_SPEED,
  PLAYER_SETTLE_LEAN_PX,
  PLAYER_SETTLE_SPEED,
  FEET_CENTER_DY,
  TILE,
  tileToWorld,
} from '../config/GameConfig';
import { GameState, type Facing } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { HeldItemView } from '../systems/HeldItemView';
import { VitalitySystem } from '../systems/VitalitySystem';

/**
 * Move one velocity vector toward another by a bounded amount.
 *
 * @param currentX Current horizontal velocity.
 * @param currentY Current vertical velocity.
 * @param targetX Intended horizontal velocity.
 * @param targetY Intended vertical velocity.
 * @param maxDelta Maximum vector change for this step.
 * @returns The next horizontal and vertical velocity.
 */
export function approachVelocity(
  currentX: number,
  currentY: number,
  targetX: number,
  targetY: number,
  maxDelta: number
): { x: number; y: number } {
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance <= maxDelta) return { x: targetX, y: targetY };
  return {
    x: currentX + (dx / distance) * maxDelta,
    y: currentY + (dy / distance) * maxDelta,
  };
}

/**
 * Pick the tile center a stopped keeper's feet glide onto.
 *
 * Each axis takes the tile center nearest to the feet pushed PLAYER_SETTLE_LEAN_PX along the last
 * walking direction, so a stop past the first quarter of a tile finishes the step instead of
 * sliding back.
 *
 * @param feetX Feet x in world pixels.
 * @param feetY Feet y in world pixels.
 * @param leanX Sign (-1, 0, 1) of the last horizontal walking intent.
 * @param leanY Sign (-1, 0, 1) of the last vertical walking intent.
 * @returns The feet position of the chosen tile center.
 */
export function settleTarget(feetX: number, feetY: number, leanX: number, leanY: number): { x: number; y: number } {
  const center = (v: number): number => Math.floor(v / TILE) * TILE + TILE / 2;
  return { x: center(feetX + leanX * PLAYER_SETTLE_LEAN_PX), y: center(feetY + leanY * PLAYER_SETTLE_LEAN_PX) };
}

/**
 * Settle progress after the keeper stops walking.
 *  - 'idle': walking, braking, or not yet started.
 *  - 'gliding': feet move toward `target`.
 *  - 'done': feet sit on the target, or the glide was blocked twice; wait for the next walk.
 */
type SettlePhase = 'idle' | 'gliding' | 'done';

/** Event the keeper emits each time a foot lands while walking; the scene picks the sound for the ground. */
export const PLAYER_FOOTSTEP_EVENT = 'player-footstep';
/**
 * Walked distance (world px) between two footsteps. The walk cycle shows two footfalls per 4 frames at
 * 8 fps, so at the normal speed of 96 px/s a foot lands every 24 px; counting distance keeps the sound in
 * step with the art at every speed buff.
 */
const FOOTSTEP_STRIDE_PX = 24;
/** A walk from rest lands its first step after this many px, so starting to walk is heard at once. */
const FOOTSTEP_FIRST_PX = 6;
/** One frame cannot walk this far (96 px/s for even a 250 ms frame is 24 px); a longer jump is a teleport. */
const FOOTSTEP_TELEPORT_PX = 32;

/** Scene-owned physics actor; the saved wardrobe art follows it without owning movement or collisions. */
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** A visual attachment only; the selected toolbar stack remains authoritative. */
  private readonly heldItem: HeldItemView;
  /** Spawn at a named tile, bind the saved wardrobe, and dispose visuals on destruction. */
  constructor(scene: Phaser.Scene, tx: number, ty: number) {
    const { x, y } = tileToWorld(tx, ty);
    // Position so the FEET (the collision body center) land exactly on the tile center — the
    // sprite is drawn FEET_CENTER_DY px higher, which is how Stardew characters stand "on" a tile.
    super(scene, x, y - FEET_CENTER_DY, TextureKey.PlayerNavigation);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setOrigin(0.5, 0.5);
    // Feet-box collision (config-driven, independent of art size) — see GameConfig.PLAYER_BODY.
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(PLAYER_BODY.w, PLAYER_BODY.h);
    body.setOffset(PLAYER_BODY.offsetX, PLAYER_BODY.offsetY);
    body.setCollideWorldBounds(true);

    // GameState position is the FEET (authoritative for tiles/facing/warps/saves).
    const gs = GameState.instance;
    gs.player.x = x;
    gs.player.y = y;
    const wardrobe = AppearanceTextureSystem.forGame(scene.game);
    wardrobe.bind(this, () => GameState.instance.appearance);
    const refreshAppearance = (): void => wardrobe.apply(this, GameState.instance.appearance);
    scene.game.events.on('appearance-changed', refreshAppearance);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.game.events.off('appearance-changed', refreshAppearance));
    this.heldItem = new HeldItemView(this);
  }

  /** True while an action animation (chop/dig/mine/...) is playing — movement is locked. */
  busy = false;

  /** Tile settle state; see SettlePhase. */
  private settlePhase: SettlePhase = 'idle';
  /** Feet position the settle glide is heading to (valid while gliding). */
  private settleGoal = { x: 0, y: 0 };
  /** True after the first blocked glide fell back to the plain nearest tile center. */
  private settleRetargeted = false;
  /** Feet distance to the goal at the previous glide frame, for blocked detection. */
  private settleLastDist = 0;
  /** Feet position at the previous walking frame, or null while standing (see trackFootsteps). */
  private stepFrom: { x: number; y: number } | null = null;
  /** Walked px still to go before the next footstep. */
  private stepLeft = FOOTSTEP_FIRST_PX;
  /** Sign of the last walking intent per axis; leans the settle tile toward the walk direction. */
  private lastIntent = { x: 0, y: 0 };

  /**
   * Play a one-shot action animation (`player-<action>`) if its sheet is loaded, locking movement
   * for its duration (Stardew swing feel). Playing an anim switches the sprite's texture to that
   * action strip automatically; on completion we return to the looping idle anim (which switches
   * back to the idle strip). No-ops (returns false) when the action art isn't present, so gameplay
   * works identically before the art lands.
   */
  playAction(action: 'chop' | 'dig' | 'mine' | 'sweep' | 'broom' | 'water' | 'cast' | 'sword'): boolean {
    const facing = GameState.instance.player.facing;
    // Every action, the broom included, has its own sheet (player-sweep is the scythe). The captured
    // intent below still tells the held item which tool this swing uses.
    const key = `player-${action}-${facing}`;
    // Every frame of the old side-casting strip eventually bakes a fishing line or bobber into the
    // player texture. Keeping its last frame under the live scene-drawn tether produced the exact
    // doubled line reported in normal play. A live cast therefore retains the approved
    // facing-specific navigation art while BaseWorldScene draws the rod and sole tether.
    if (action === 'cast') {
      if (this.busy) return true;
      this.setData(PLAYER_ACTION_DATA_KEY, action);
      this.busy = true;
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      // Navigation has a dedicated left row, so the cast hold pose must never mirror it.
      this.setFlipX(false);
      const idleKey = this.navigationAnimKey(false, facing);
      if (this.anims.animationManager.exists(idleKey)) this.play(idleKey);
      this.heldItem.update();
      this.scene.time.delayedCall(450, () => {
        this.setData(PLAYER_ACTION_DATA_KEY, null);
        this.busy = false;
        this.setFlipX(false);
        const currentIdle = this.navigationAnimKey(false, GameState.instance.player.facing);
        if (this.anims.animationManager.exists(currentIdle)) this.play(currentIdle);
        this.heldItem.update();
      });
      return true;
    }
    if (!this.anims.animationManager.exists(key) || this.busy) return this.busy;
    this.setData(PLAYER_ACTION_DATA_KEY, action);
    this.busy = true;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    // Each action has dedicated art for all four directions. Mirroring a frame changes the hand
    // and tool side, so it would break the character identity and the target direction.
    this.setFlipX(false);
    this.play(key);
    // Native tool input can arrive after Player.update. Hide the carried copy in this same frame.
    this.heldItem.update();
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.setData(PLAYER_ACTION_DATA_KEY, null);
      this.busy = false;
      this.setFlipX(false);
      const idleKey = this.navigationAnimKey(false, GameState.instance.player.facing);
      if (this.anims.animationManager.exists(idleKey)) this.play(idleKey);
      this.heldItem.update();
    });
    return true;
  }

  /**
   * Read held directions, approach the intended velocity, update facing, and sync saved feet.
   * After a stop, the feet glide onto a tile center (see settle()).
   *
   * @param deltaMs Real frame time in milliseconds, used to keep acceleration frame-rate neutral.
   * @param canSettle False while something else owns the keeper's position (a private moment).
   */
  update(deltaMs: number, canSettle = true): void {
    const modal = GameState.instance;
    if (modal.inventoryOpen || modal.chestOpen || modal.binOpen || modal.craftingOpen || modal.dialogue || modal.marketPanelOpen) {
      InputBus.instance.clearAll();
    }
    // Locked mid-swing or mid-reel: hold position.
    if (this.busy || GameState.instance.fishing || GameState.instance.daySummary || GameState.instance.tavernPanel ||
      GameState.instance.marketPanelOpen || GameState.instance.dialogue
      || GameState.instance.inventoryOpen || GameState.instance.chestOpen || GameState.instance.binOpen || GameState.instance.craftingOpen) {
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      // why: a glide cut short by a panel restarts fresh, so the paused frames never read as "blocked".
      if (this.settlePhase === 'gliding') this.settlePhase = 'idle';
      const gs = GameState.instance;
      gs.player.x = this.x;
      gs.player.y = this.y + FEET_CENTER_DY;
      this.trackFootsteps(false);
      this.heldItem.update();
      return;
    }
    const held = InputBus.instance.getHeld();
    let vx = 0;
    let vy = 0;
    if (held.has('left')) vx -= 1;
    if (held.has('right')) vx += 1;
    if (held.has('up')) vy -= 1;
    if (held.has('down')) vy += 1;

    // Normalize diagonal speed so diagonal movement isn't faster, then approach that velocity.
    const len = Math.hypot(vx, vy) || 1;
    const body = this.body as Phaser.Physics.Arcade.Body;
    // why: the Quick Step food buff raises top speed; acceleration and the tile settle stay the same.
    const speed = PLAYER_SPEED * VitalitySystem.moveSpeedScale();
    const targetX = (vx / len) * speed;
    const targetY = (vy / len) * speed;
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      this.lastIntent = { x: Math.sign(vx), y: Math.sign(vy) };
      this.settlePhase = 'idle';
    }
    // why: once braking ends, the settle glide owns the velocity until the feet sit on a tile.
    if (moving || this.settlePhase !== 'gliding') {
      const rate = moving ? PLAYER_ACCELERATION : PLAYER_BRAKING;
      const nextVelocity = approachVelocity(
        body.velocity.x,
        body.velocity.y,
        targetX,
        targetY,
        rate * (deltaMs / 1000)
      );
      body.setVelocity(nextVelocity.x, nextVelocity.y);
    }
    if (!moving && canSettle) this.settle();

    // Update facing from the dominant axis of intent (only when moving).
    if (moving) {
      const facing: Facing =
        Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      GameState.instance.player.facing = facing;
    }

    // Drive walk animations IF they were registered (real spritesheet present). With the placeholder
    // texture no anims exist, so this is a no-op and the player stays a static rect.
    // Keep walking through the short braking tail so the feet never slide in an idle pose.
    const visuallyMoving = Math.hypot(body.velocity.x, body.velocity.y) > 0.5;
    this.updateAnimation(visuallyMoving);

    // Sync authoritative FEET position into GameState for the test seam / save.
    const gs = GameState.instance;
    gs.player.x = this.x;
    gs.player.y = this.y + FEET_CENTER_DY;
    this.trackFootsteps(moving);
    this.heldItem.update();
  }

  /**
   * Emit PLAYER_FOOTSTEP_EVENT once per FOOTSTEP_STRIDE_PX actually walked. Only real travel counts:
   * pushing into a wall makes no steps, and the tile-settle glide after a stop is silent.
   * @param walking true while a move direction is held this frame
   */
  private trackFootsteps(walking: boolean): void {
    if (!walking) {
      this.stepFrom = null;
      this.stepLeft = FOOTSTEP_FIRST_PX;
      return;
    }
    const at = { x: this.x, y: this.y };
    if (this.stepFrom) {
      const travelled = Math.hypot(at.x - this.stepFrom.x, at.y - this.stepFrom.y);
      // why: a warp or resume moves the keeper in one frame; that jump is not walking.
      if (travelled < FOOTSTEP_TELEPORT_PX) {
        this.stepLeft -= travelled;
        if (this.stepLeft <= 0) {
          this.stepLeft += FOOTSTEP_STRIDE_PX;
          this.emit(PLAYER_FOOTSTEP_EVENT);
        }
      }
    }
    this.stepFrom = at;
  }

  /**
   * Glide the stopped keeper's feet onto a tile center so the facing tile lines up with the body.
   * Starts once braking reaches zero and moves at a constant PLAYER_SETTLE_SPEED. When the goal is
   * within one physics step, the feet snap onto it exactly. If a wall or object stops the glide, it
   * retries once toward the plain nearest center (no lean), then gives up until the next walk,
   * leaving the keeper where the collision put them.
   */
  private settle(): void {
    if (this.settlePhase === 'done') return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const world = this.scene.physics.world;
    const feetX = this.x;
    const feetY = this.y + FEET_CENTER_DY;
    if (this.settlePhase === 'idle') {
      if (body.velocity.x !== 0 || body.velocity.y !== 0) return;
      this.startGlide(settleTarget(feetX, feetY, this.lastIntent.x, this.lastIntent.y));
    }
    const dx = this.settleGoal.x - feetX;
    const dy = this.settleGoal.y - feetY;
    const dist = Math.hypot(dx, dy);
    // why: Arcade moves bodies in fixed 1/fps steps, so one step covers this many pixels.
    const stepPx = PLAYER_SETTLE_SPEED / world.fps;
    // why: a body pressed against a collider must not be snapped into it.
    const free = body.blocked.none && body.touching.none;
    // why: feet already exactly on the goal need no move, so the snap is safe even against a collider.
    // Without this, a keeper resting on the goal while touching a wall or the shipping bin fell through to
    // the velocity line below and divided by a zero distance, which made the body's position NaN.
    if (dist === 0 || (dist <= stepPx + 0.01 && free)) {
      this.snapFeet(this.settleGoal.x, this.settleGoal.y);
      this.settlePhase = 'done';
      return;
    }
    // why: progress is only measurable on frames where physics stepped; a frame with no step moves nothing.
    if (world.stepsLastFrame > 0) {
      if (dist >= this.settleLastDist - 0.1) {
        if (this.settleRetargeted) {
          body.setVelocity(0, 0);
          this.settlePhase = 'done';
          return;
        }
        this.startGlide(settleTarget(feetX, feetY, 0, 0));
        this.settleRetargeted = true;
        this.settle();
        return;
      }
      this.settleLastDist = dist;
    }
    body.setVelocity((dx / dist) * PLAYER_SETTLE_SPEED, (dy / dist) * PLAYER_SETTLE_SPEED);
  }

  /**
   * Put the feet exactly on a point and stop. The body is synced to the sprite too: Arcade's
   * postUpdate adds this frame's body move (position minus prevFrame) back onto the sprite, which
   * would otherwise push the keeper one physics step past the snap point.
   *
   * @param feetX Feet x in world pixels.
   * @param feetY Feet y in world pixels.
   */
  private snapFeet(feetX: number, feetY: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    this.setPosition(feetX, feetY - FEET_CENTER_DY);
    body.updateFromGameObject();
    body.prev.copy(body.position);
    body.prevFrame.copy(body.position);
  }

  /**
   * Begin (or restart) a settle glide toward one feet goal.
   *
   * @param goal Feet position of the target tile center.
   */
  private startGlide(goal: { x: number; y: number }): void {
    this.settleGoal = goal;
    this.settleRetargeted = false;
    this.settleLastDist = Number.POSITIVE_INFINITY;
    this.settlePhase = 'gliding';
  }

  /** Play the matching directional walk or idle animation without mirroring any navigation row. */
  private updateAnimation(moving: boolean): void {
    const facing: Facing = GameState.instance.player.facing;
    this.setFlipX(false);
    const animKey = this.navigationAnimKey(moving, facing);
    if (!this.anims.animationManager.exists(animKey)) return;
    this.play(animKey, true); // ignoreIfPlaying — safe to call every frame
  }

  /** Resolve the explicit navigation key for one movement state and facing. */
  private navigationAnimKey(moving: boolean, facing: Facing): AnimKey {
    if (facing === 'up') return moving ? AnimKey.PlayerWalkUp : AnimKey.PlayerIdleUp;
    if (facing === 'down') return moving ? AnimKey.PlayerWalkDown : AnimKey.PlayerIdleDown;
    if (facing === 'left') return moving ? AnimKey.PlayerWalkLeft : AnimKey.PlayerIdleLeft;
    return moving ? AnimKey.PlayerWalkRight : AnimKey.PlayerIdleRight;
  }

}
