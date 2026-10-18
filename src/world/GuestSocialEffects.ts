/** Lightweight reusable mood and cartoon-fight effects. These draw only; guest rules stay in TavernSystem. */
import Phaser from 'phaser';
import type { TavernGuestView } from '../systems/TavernSystem';
import { UI_FONT } from '../ui/TextRendering';

/** One guest's blush, steam and reaction marks; destroyed with its scene-local visitor attachment. */
export class GuestSocialEffects {
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly cue: Phaser.GameObjects.Text;

  /** Allocate reusable objects rather than adding particles or tweens each frame. */
  constructor(scene: Phaser.Scene, id: number) {
    this.marks = scene.add.graphics().setName(`guest-emotion-${id}`);
    this.cue = scene.add.text(0, 0, '', { fontFamily: UI_FONT, fontSize: '6px', color: '#785f86' })
      .setOrigin(0.5).setName(`guest-reaction-${id}`);
  }

  /** Draw at the rendered feet; phase time freezes naturally under menus and during a fight. */
  update(view: TavernGuestView, x: number, feet: number, reducedMotion: boolean): void {
    const angry = view.mood === 'angry', drunk = view.intoxicated;
    const clock = reducedMotion ? 350 : view.guest.elapsedMs + view.guest.id * 173;
    const g = this.marks.clear().setPosition(x, feet).setDepth(feet + 2);
    this.cue.setVisible(false).setDepth(feet + 3);
    g.setData('steam', angry && view.fight === null).setData('intoxicated', drunk);
    if (view.fight !== null) return;
    if (angry || drunk) {
      g.fillStyle(angry ? 0xe45843 : 0xda7e7b, angry ? 0.65 : 0.46);
      g.fillEllipse(-3, -24, 3.5, 2).fillEllipse(3, -24, 3.5, 2);
    }
    if (angry) {
      for (const side of [-1, 1]) for (let index = 0; index < 3; index++) {
        const phase = ((clock + index * 210 + (side + 1) * 140) % 1050) / 1050;
        const px = side * (8 + phase * 5), py = -23 - phase * 12;
        g.fillStyle(0xfff2d8, (1 - phase) * 0.8);
        g.fillCircle(px, py, 1.6 + phase * 1.6).fillCircle(px + side * 1.4, py - 1.6, 1.2 + phase);
      }
      // A comic frustration mark remains readable when reduced motion removes the steam pulse.
      g.lineStyle(1.2, 0xb94232, 1);
      g.lineBetween(7, -33, 10, -33).lineBetween(10, -33, 10, -36);
      g.lineBetween(12, -33, 15, -33).lineBetween(12, -33, 12, -36);
      g.lineBetween(10, -31, 10, -28).lineBetween(10, -31, 7, -31);
      g.lineBetween(12, -31, 15, -31).lineBetween(12, -31, 12, -28);
    } else if (drunk) {
      const hiccup = clock % 4300 < 650;
      this.cue.setVisible(hiccup).setText('hic!').setColor('#796387').setPosition(x + 10, feet - 32);
      const phase = clock / 950;
      for (let index = 0; index < 3; index++) {
        const angle = phase + index * Math.PI * 2 / 3;
        g.fillStyle(0xdab864, 0.8).fillCircle(Math.cos(angle) * 8, -34 + Math.sin(angle) * 2, 0.9);
      }
    } else if (view.conversation !== null && !view.conversation.speaking) {
      const reaction = view.conversation.reaction;
      if (reaction === 'surprised' || reaction === 'laugh') {
        this.cue.setVisible(true).setText(reaction === 'surprised' ? '!' : 'ha!')
          .setColor('#738d68').setPosition(x + 9, feet - 30);
      }
    }
  }

  /** Remove both objects when the visitor no longer exists in this scene. */
  destroy(): void { this.marks.destroy(); this.cue.destroy(); }
}

/** One shared dust cloud per pair. Actual guest sprites briefly emerge above it; no duplicate guests exist. */
export class GuestFightCloud {
  readonly root: Phaser.GameObjects.Graphics;

  /** Allocate an independently named effect for screenshot checks and scene-owned cleanup. */
  constructor(scene: Phaser.Scene, pairKey: string) {
    this.root = scene.add.graphics().setName(`guest-fight-${pairKey}`);
  }

  /** Animate a bounded warm dust silhouette and comic stars from the saved fight clock. */
  update(x: number, centerFeet: number, depthFeet: number, spanX: number, spanY: number, elapsedMs: number, reducedMotion: boolean): void {
    const clock = reducedMotion ? 500 : elapsedMs;
    const ry = spanY / 2 + 13, rx = Math.max(spanX / 2 + 12, ry * 0.85);
    const g = this.root.clear().setPosition(x, centerFeet - 15).setDepth(depthFeet + 3);
    g.fillStyle(0x34281f, 0.15).fillEllipse(0, ry + 3, rx * 2 + 8, 9);
    // Lobes change shape, not world position: the dust never hides a teleport or route mutation.
    for (let layer = 0; layer < 2; layer++) {
      g.fillStyle(layer === 0 ? 0x9d8c71 : 0xe4d4b5, 1);
      g.fillEllipse(0, -1, rx * 2 + 2 - layer, ry * 2 - layer);
      for (let index = 0; index < 8; index++) {
        const angle = index * Math.PI / 4;
        const pulse = Math.sin(clock / 110 + index * 2) * 1.3;
        g.fillCircle(Math.cos(angle) * rx, Math.sin(angle) * ry, 5 + pulse - layer * 0.8);
      }
    }
    g.fillStyle(0xf8ecd3, 0.9);
    for (let index = 0; index < 3; index++) {
      g.fillCircle(-8 + index * 7, -6 + Math.sin(clock / 170 + index) * 2, 3.5);
    }
    for (let index = 0; index < 3; index++) {
      const phase = ((clock + index * 270) % 900) / 900;
      const angle = -2.8 + index * 1.25;
      const px = Math.cos(angle) * (rx + 8 + phase * 7), py = Math.sin(angle) * (ry + 8 + phase * 6);
      g.lineStyle(1.3, index === 1 ? 0xc77848 : 0xe3b857, 1 - phase * 0.6);
      g.lineBetween(px - 2, py, px + 2, py).lineBetween(px, py - 2, px, py + 2);
    }
    g.setData('elapsedMs', elapsedMs).setData('reducedMotion', reducedMotion);
  }

  /** Remove the pair's cloud as soon as either guest leaves the fight. */
  destroy(): void { this.root.destroy(); }
}
