/** Shared code-drawn placeholder for private bed and risky standing Cuddle. */
import Phaser from 'phaser';
import type { CuddleEffectView } from '../systems/CuddleSystem';

/** Owns one soft silhouette cloud. Art can replace this class without changing gameplay state. */
export class CuddleEffectRenderer {
  private readonly root: Phaser.GameObjects.Container;
  private readonly haze: Phaser.GameObjects.Graphics;
  private readonly hearts: Phaser.GameObjects.Text[];

  /** Create hidden scene-local graphics. */
  constructor(scene: Phaser.Scene) {
    this.haze = scene.add.graphics();
    this.hearts = [0, 1, 2].map(() => scene.add.text(0, 0, '♥', { fontFamily: 'serif', fontStyle: 'bold', fontSize: '7px',
      color: '#ffd0dc', stroke: '#71445d', strokeThickness: 2 }).setOrigin(0.5));
    this.root = scene.add.container(0, 0, [this.haze, ...this.hearts]).setVisible(false).setName('cuddle-effect');
  }

  /** Redraw the correct shared placeholder, or remove it immediately when no view is active. */
  update(view: CuddleEffectView | null, elapsedMs: number): void {
    if (!view) { this.root.setVisible(false).setName('cuddle-effect'); return; }
    const pulse = 1 + Math.sin(elapsedMs / 140) * 0.035;
    const bed = view.kind === 'bedroom';
    this.root.setVisible(true).setPosition(view.x, view.y).setScale(pulse)
      .setDepth(view.y + 90).setName(bed ? 'cuddle-effect-bed' : 'cuddle-effect-standing');
    this.haze.clear();
    // Layered translucent ellipses read as a deliberately blurred silhouette at the game's scale.
    const width = bed ? 58 : 42, height = bed ? 30 : 54;
    this.haze.fillStyle(0x2b1831, 0.48).fillEllipse(0, -8, width + 8, height + 8);
    this.haze.fillStyle(0x8f5b77, 0.58).fillEllipse(-6, -10, width, height);
    this.haze.fillStyle(0xd9a3a8, 0.38).fillEllipse(7, -7, width - 6, height - 5);
    this.haze.fillStyle(0xffedd0, 0.28).fillCircle(-width / 4, -height / 2, 8).fillCircle(width / 5, -height / 2 + 2, 8);
    this.haze.lineStyle(2, 0xffd27a, 0.8).strokeEllipse(0, -8, width + 4, height + 4);
    this.hearts.forEach((heart, index) => {
      const phase = (elapsedMs / 950 + index / this.hearts.length) % 1;
      heart.setPosition(-13 + index * 13 + Math.sin(elapsedMs / 180 + index) * 2, -13 - phase * 27)
        .setAlpha(Math.sin(phase * Math.PI)).setScale(0.75 + phase * 0.45);
    });
  }

  /** Destroy every scene-owned object during shutdown. */
  destroy(): void { this.root.destroy(true); }
}
