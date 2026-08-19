/**
 * Player — the controllable farmer.
 *
 * A physics sprite driven by the InputBus (held movement directions). Its collision body size comes
 * from GameConfig (NOT the art size) so swapping the placeholder rect for a PixelLab sprite never
 * changes collision (CLAUDE.md Hard Rule 4). The player writes its live position/facing back into
 * GameState every frame so the test seam and save system see authoritative values.
 */
import Phaser from 'phaser';
import { AnimKey, TextureKey } from '../config/AssetKeys';
import { PLAYER_SPEED, PLAYER_BODY, FEET_CENTER_DY, tileToWorld } from '../config/GameConfig';
import { GameState, type Facing } from '../state/GameState';
import { InputBus } from '../input/InputBus';

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, tx: number, ty: number) {
    const { x, y } = tileToWorld(tx, ty);
    // Position so the FEET (the collision body center) land exactly on the tile center — the
    // sprite is drawn FEET_CENTER_DY px higher, which is how Stardew characters stand "on" a tile.
    super(scene, x, y - FEET_CENTER_DY, TextureKey.Player);
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
  }

  /** True while an action animation (chop/dig/mine/...) is playing — movement is locked. */
  busy = false;

  /**
   * Play a one-shot action animation (`player-<action>`) if its sheet is loaded, locking movement
   * for its duration (Stardew swing feel). Playing an anim switches the sprite's texture to that
   * action strip automatically; on completion we return to the looping idle anim (which switches
   * back to the idle strip). No-ops (returns false) when the action art isn't present, so gameplay
   * works identically before the art lands.
   */
  playAction(action: 'chop' | 'dig' | 'mine' | 'sweep' | 'water' | 'cast' | 'sword'): boolean {
    const facing = GameState.instance.player.facing;
    const directionalToolAction = action === 'sweep' || action === 'sword';
    const direction = facing === 'left' ? 'right' : facing;
    const key = directionalToolAction ? `player-${action}-${direction}` : `player-${action}`;
    // Every frame of the old side-casting strip eventually bakes a fishing line or bobber into the
    // player texture. Keeping its last frame under the live scene-drawn tether produced the exact
    // doubled line reported in normal play. A live cast therefore retains the approved
    // facing-specific navigation art while BaseWorldScene draws the rod and sole tether.
    if (action === 'cast') {
      if (this.busy) return true;
      this.busy = true;
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      this.setFlipX(facing === 'left');
      const idleKey = this.navigationAnimKey(false, facing);
      if (this.anims.animationManager.exists(idleKey)) this.play(idleKey);
      this.scene.time.delayedCall(450, () => {
        this.busy = false;
        const currentIdle = this.navigationAnimKey(false, GameState.instance.player.facing);
        if (this.anims.animationManager.exists(currentIdle)) this.play(currentIdle);
      });
      return true;
    }
    if (!this.anims.animationManager.exists(key) || this.busy) return this.busy;
    this.busy = true;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    // The dedicated sweep/sword sheets contain right, down, and up slices. Left mirrors right;
    // every other direction stays unflipped so a down-facing player cannot become a side pose.
    this.setFlipX(facing === 'left');
    this.play(key);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.busy = false;
      const idleKey = this.navigationAnimKey(false, GameState.instance.player.facing);
      if (this.anims.animationManager.exists(idleKey)) this.play(idleKey);
    });
    return true;
  }

  /** Per-frame update: read held directions, move, update facing, sync GameState. */
  update(): void {
    // Locked mid-swing or mid-reel: hold position.
    if (this.busy || GameState.instance.fishing || GameState.instance.daySummary) {
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      const gs = GameState.instance;
      gs.player.x = this.x;
      gs.player.y = this.y + FEET_CENTER_DY;
      return;
    }
    const held = InputBus.instance.getHeld();
    let vx = 0;
    let vy = 0;
    if (held.has('left')) vx -= 1;
    if (held.has('right')) vx += 1;
    if (held.has('up')) vy -= 1;
    if (held.has('down')) vy += 1;

    // Normalize diagonal speed so diagonal movement isn't faster.
    const len = Math.hypot(vx, vy) || 1;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);

    // Update facing from the dominant axis of intent (only when moving).
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const facing: Facing =
        Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      GameState.instance.player.facing = facing;
    }

    // Drive walk animations IF they were registered (real spritesheet present). With the placeholder
    // texture no anims exist, so this is a no-op and the player stays a static rect.
    this.updateAnimation(moving);

    // Sync authoritative FEET position into GameState for the test seam / save.
    const gs = GameState.instance;
    gs.player.x = this.x;
    gs.player.y = this.y + FEET_CENTER_DY;
  }

  /**
   * Play the approved Sunnyside side-view strips for left/right and matching generated rotations
   * for up/down. Only the original side sheet is mirrored; cardinal frames are never flipped.
   */
  private updateAnimation(moving: boolean): void {
    const facing: Facing = GameState.instance.player.facing;
    this.setFlipX(facing === 'left');
    const animKey = this.navigationAnimKey(moving, facing);
    if (!this.anims.animationManager.exists(animKey)) return;
    this.play(animKey, true); // ignoreIfPlaying — safe to call every frame
  }

  /** Resolve the navigation key without allowing vertical input to replace the approved side art. */
  private navigationAnimKey(moving: boolean, facing: Facing): AnimKey {
    if (facing === 'up') return moving ? AnimKey.PlayerWalkUp : AnimKey.PlayerIdleUp;
    if (facing === 'down') return moving ? AnimKey.PlayerWalkDown : AnimKey.PlayerIdleDown;
    return moving ? AnimKey.PlayerWalk : AnimKey.PlayerIdle;
  }
}
