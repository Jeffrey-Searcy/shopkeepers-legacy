/**
 * Enemy — shared base for Mines monsters (Slime, Bat). Owns hp, hit reaction (flash + knockback),
 * and a spawn-leash so enemies without terrain collision stay in their open-cave pocket (we cannot
 * add colliders against the base scene's private ground layer — see the mission report). AI is
 * per-species in aiUpdate(); MinesScene drives everything per frame.
 */
import Phaser from 'phaser';

export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  hp: number;
  /** Contact damage dealt to the player. */
  readonly touchDamage: number = 1;
  /** What this enemy drops on death. */
  abstract readonly lootItem: string;
  /** Leash anchor (spawn point) — AI steers back inside LEASH_PX of this. */
  protected readonly homeX: number;
  protected readonly homeY: number;
  protected static readonly LEASH_PX = 72;
  /** Knockback suppresses AI steering briefly so the shove reads. */
  protected knockbackMs = 0;

  constructor(scene: Phaser.Scene, texKey: string, x: number, y: number, hp: number) {
    super(scene, x, y, texKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.hp = hp;
    this.homeX = x;
    this.homeY = y;
    this.setDisplaySize(20, 20);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(this.width * 0.6, this.height * 0.6, true);
    body.setCollideWorldBounds(true);
  }

  /**
   * Take a sword hit: flash, knock away from the attacker, decrement hp. Returns true when dead
   * (the scene spawns loot + destroys).
   */
  hit(damage: number, fromX: number, fromY: number): boolean {
    this.hp -= damage;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.clearTint());
    const angle = Math.atan2(this.y - fromY, this.x - fromX);
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * 180, Math.sin(angle) * 180);
    this.knockbackMs = 220;
    return this.hp <= 0;
  }

  /** Per-frame AI (called by MinesScene). Skips steering while a knockback impulse plays out. */
  update(_time?: number, deltaMs = 16, playerX = 0, playerY = 0): void {
    if (this.knockbackMs > 0) {
      this.knockbackMs -= deltaMs;
      return;
    }
    this.aiUpdate(deltaMs, playerX, playerY);
    // Leash: beyond the tether, steer home (keeps un-collided enemies out of cave walls).
    const dHome = Phaser.Math.Distance.Between(this.x, this.y, this.homeX, this.homeY);
    if (dHome > Enemy.LEASH_PX) {
      const a = Math.atan2(this.homeY - this.y, this.homeX - this.x);
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(a) * 60, Math.sin(a) * 60);
    }
    this.setDepth(this.y);
  }

  protected abstract aiUpdate(deltaMs: number, playerX: number, playerY: number): void;
}
