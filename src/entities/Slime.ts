/**
 * Slime — the Mines' basic monster (Moonlighter-style): ambles randomly, then LUNGES when the
 * player closes within range. 3 hp (two sword hits), drops slime gel.
 */
import Phaser from 'phaser';
import { Enemy } from '../combat/Enemy';
import { Rng } from '../state/Rng';

const WANDER_SPEED = 25;
const LUNGE_SPEED = 95;
const LUNGE_RANGE = 60;

export class Slime extends Enemy {
  readonly lootItem = 'slime-gel';
  private moveTimer = 0;
  private dirX = 0;
  private dirY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, 'enemy-slime', x, y, 3);
  }

  protected aiUpdate(deltaMs: number, playerX: number, playerY: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY);

    if (dist < LUNGE_RANGE) {
      // Lunge straight at the player.
      const a = Math.atan2(playerY - this.y, playerX - this.x);
      body.setVelocity(Math.cos(a) * LUNGE_SPEED, Math.sin(a) * LUNGE_SPEED);
      return;
    }
    // Amble: re-roll a direction (or a pause) every ~1-2s.
    this.moveTimer -= deltaMs;
    if (this.moveTimer <= 0) {
      this.moveTimer = 1000 + Rng.instance.next() * 1000;
      if (Rng.instance.next() < 0.35) {
        this.dirX = 0;
        this.dirY = 0;
      } else {
        const a = Rng.instance.next() * Math.PI * 2;
        this.dirX = Math.cos(a);
        this.dirY = Math.sin(a);
      }
    }
    body.setVelocity(this.dirX * WANDER_SPEED, this.dirY * WANDER_SPEED);
  }
}
