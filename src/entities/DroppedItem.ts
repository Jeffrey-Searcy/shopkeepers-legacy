/**
 * DroppedItem — a collectible item entity on the ground (Stardew-style drop).
 *
 * Spawned when nodes are cleared (wood/stone/fiber) or placed items are broken (chest). Pops with
 * a little hop, then idles with a gentle bob. The scene's update applies magnetism: within
 * MAGNET_RANGE it drifts toward the player and is collected on contact (after a short spawn grace
 * so the drop is visible before vanishing). Drops are transient — the scene banks any uncollected
 * drops into the inventory on shutdown so nothing is ever lost.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import { Rng } from '../state/Rng';

/** Pixels within which a drop drifts toward the player. */
export const MAGNET_RANGE = 34;
/** Pixels at which a drop is collected. */
export const COLLECT_RANGE = 11;
/** Grace period before a drop can be collected (lets the pop read visually). */
export const COLLECT_GRACE_MS = 250;
/** Drift speed toward the player (px/s). */
const MAGNET_SPEED = 150;

/** Pick the best texture to represent an item on the ground. */
function dropTexture(scene: Phaser.Scene, item: string): string {
  const icon = `icon-${item}`;
  if (scene.textures.exists(icon)) return icon;
  if (scene.textures.exists(item)) return item; // e.g. 'chest' object art
  return 'crop'; // safe fallback (always in the manifest)
}

export class DroppedItem extends Phaser.GameObjects.Image {
  readonly item: string;
  /** Milliseconds since spawn (collection allowed after COLLECT_GRACE_MS). */
  age = 0;
  /** Set once magnetism engages — the idle tweens are killed so both axes move freely. */
  private magnetized = false;

  constructor(scene: Phaser.Scene, item: string, tx: number, ty: number) {
    // Scatter within the tile so multi-drops don't stack into one sprite.
    const x = tx * TILE + TILE / 2 + (Rng.instance.next() - 0.5) * 8;
    const y = ty * TILE + TILE / 2 + (Rng.instance.next() - 0.5) * 6;
    super(scene, x, y, dropTexture(scene, item));
    this.item = item;
    this.setDisplaySize(12, 12);
    this.setDepth(y);
    scene.add.existing(this);

    // Pop hop, then a gentle idle bob.
    scene.tweens.add({
      targets: this,
      y: y - 8,
      duration: 130,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => {
        scene.tweens.add({
          targets: this,
          y: y - 2,
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        });
      },
    });
  }

  /**
   * Magnetism step. Returns true when the drop reached the player and should be collected.
   * On first engagement the idle tweens are killed — they own the y axis and would otherwise
   * overwrite the drift every frame (a drop below the player could never close the gap).
   */
  magnetTo(px: number, py: number, deltaMs: number): boolean {
    if (this.age < COLLECT_GRACE_MS) return false;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, px, py);
    if (dist < COLLECT_RANGE) return true;
    if (dist < MAGNET_RANGE) {
      if (!this.magnetized) {
        this.magnetized = true;
        this.scene.tweens.killTweensOf(this);
      }
      const step = (MAGNET_SPEED * deltaMs) / 1000;
      const angle = Math.atan2(py - this.y, px - this.x);
      this.x += Math.cos(angle) * step;
      this.y += Math.sin(angle) * step;
      this.setDepth(this.y);
    }
    return false;
  }
}
