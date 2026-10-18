/**
 * Warden — the first portal dungeon's boss: a huge violet slime that guards the way home.
 *
 * It creeps toward the keeper, then winds up (a white flash) and charges in a straight line. The
 * wind-up is the tell: dodge-roll through the charge (i-frames) or step aside, then hit its back.
 * It drops the Warden Core, which the forge needs for its second upgrade. Hit points and contact
 * damage come from config/Dungeon.ts.
 */
import Phaser from 'phaser';
import { Enemy } from '../combat/Enemy';
import { WARDEN_HP, WARDEN_TOUCH_DAMAGE } from '../config/Dungeon';

const CREEP_SPEED = 30;
const CHARGE_SPEED = 150;
/** Milliseconds between charges, the wind-up flash, and the charge itself. */
const CHARGE_EVERY_MS = 2600;
const WINDUP_MS = 650;
const CHARGE_MS = 450;

export class Warden extends Enemy {
  readonly lootItem = 'warden-core';
  override readonly touchDamage = WARDEN_TOUCH_DAMAGE;
  /** Counts down to the next wind-up. */
  private nextChargeMs = CHARGE_EVERY_MS;
  /** Time left in the current phase (wind-up or charge); 0 = creeping. */
  private phaseMs = 0;
  private phase: 'creep' | 'windup' | 'charge' = 'creep';

  /** Spawn the Warden at a world position (it reuses the slime art, tinted and doubled). */
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, 'enemy-slime', x, y, WARDEN_HP);
    this.setDisplaySize(40, 40);
    this.setTint(0x9a78f0);
  }

  /** Creep, wind up, charge; the base class handles knockback and the leash. */
  protected aiUpdate(deltaMs: number, playerX: number, playerY: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.phase === 'creep') {
      this.nextChargeMs -= deltaMs;
      const a = Math.atan2(playerY - this.y, playerX - this.x);
      body.setVelocity(Math.cos(a) * CREEP_SPEED, Math.sin(a) * CREEP_SPEED);
      if (this.nextChargeMs <= 0) {
        this.phase = 'windup';
        this.phaseMs = WINDUP_MS;
        body.setVelocity(0, 0);
        this.setTintFill(0xffffff);
      }
      return;
    }
    this.phaseMs -= deltaMs;
    if (this.phase === 'windup') {
      body.setVelocity(0, 0);
      if (this.phaseMs <= 0) {
        this.setTint(0x9a78f0);
        const a = Math.atan2(playerY - this.y, playerX - this.x);
        body.setVelocity(Math.cos(a) * CHARGE_SPEED, Math.sin(a) * CHARGE_SPEED);
        this.phase = 'charge';
        this.phaseMs = CHARGE_MS;
      }
      return;
    }
    // Charging: keep the launch velocity until the charge ends.
    if (this.phaseMs <= 0) {
      this.phase = 'creep';
      this.nextChargeMs = CHARGE_EVERY_MS;
    }
  }

  /** A hit restores the boss tint after the base class's white flash. */
  override hit(damage: number, fromX: number, fromY: number): boolean {
    const dead = super.hit(damage, fromX, fromY);
    this.scene.time.delayedCall(90, () => { if (this.active) this.setTint(0x9a78f0); });
    return dead;
  }
}
