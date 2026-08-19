/**
 * Bat — the Mines' flier: hovers erratically TOWARD the player (sinusoidal wobble over a homing
 * vector, Moonlighter-style). Fragile (2 hp = one sword hit) but fast. Drops a bat wing.
 */
import Phaser from 'phaser';
import { Enemy } from '../combat/Enemy';

const CHASE_SPEED = 55;
const WOBBLE = 45;

export class Bat extends Enemy {
  readonly lootItem = 'bat-wing';
  private t = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, 'enemy-bat', x, y, 2);
  }

  protected aiUpdate(deltaMs: number, playerX: number, playerY: number): void {
    this.t += deltaMs / 1000;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const a = Math.atan2(playerY - this.y, playerX - this.x);
    // Homing vector + a perpendicular sin wobble = the classic erratic bat flight.
    const wobble = Math.sin(this.t * 5) * WOBBLE;
    body.setVelocity(
      Math.cos(a) * CHASE_SPEED + Math.cos(a + Math.PI / 2) * wobble,
      Math.sin(a) * CHASE_SPEED + Math.sin(a + Math.PI / 2) * wobble
    );
  }
}
