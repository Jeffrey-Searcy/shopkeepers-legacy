/** World requests use small thought clouds; real paired conversations get one readable speech balloon. */
import Phaser from 'phaser';
import type { TavernGuestView } from '../systems/TavernSystem';
import { UI_FONT } from '../ui/TextRendering';

/** Reusable attachment whose content and timers come from the read-only guest view. */
export class GuestThoughtCloud {
  readonly root: Phaser.GameObjects.Container;
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly caption: Phaser.GameObjects.Text;

  /** Allocate once per guest; the shared crisp-text system follows the actual camera scale. */
  constructor(scene: Phaser.Scene, id: number) {
    this.background = scene.add.graphics();
    this.icon = scene.add.image(0, -3, 'icon-stew').setDisplaySize(13, 13);
    this.caption = scene.add.text(0, -4, '', {
      fontFamily: UI_FONT, fontSize: '6px', color: '#4b4035', align: 'center',
      wordWrap: { width: 67 }, lineSpacing: 1,
    }).setOrigin(0.5);
    this.root = scene.add.container(0, 0, [this.background, this.icon, this.caption])
      .setSize(29, 30).setDepth(990_001).setName(`shop-order-${id}`);
  }

  /** Paint a joined silhouette; drawing it twice gives an outline without internal circle seams. */
  private cloud(color: number, grow: number, y: number): void {
    const g = this.background.fillStyle(color);
    g.fillRoundedRect(-10 - grow, -8 - grow + y, 20 + grow * 2, 14 + grow * 2, 5);
    for (const [x, cy, radius] of [[-8, -5, 5], [-4, -9, 5], [3, -9, 5], [9, -4, 4], [5, 2, 4]]) {
      g.fillCircle(x, cy + y, radius + grow);
    }
  }

  /** Derive a request or one speaker's line. Rendering never changes patience or conversation progress. */
  update(view: TavernGuestView, belowGuest = false): void {
    const { guest, mood, conversation, fight } = view;
    const request = guest.phase === 'waiting' && fight === null;
    const speaking = conversation !== null && conversation.speaking && fight === null;
    this.root.setVisible(request || speaking).setData('mood', mood).setData('product', guest.product)
      .setData('speaker', speaking).setData('topic', conversation === null ? null : conversation.topicId);
    if (!this.root.visible) return;
    const g = this.background.clear();
    this.icon.setVisible(request && guest.product !== null);
    this.caption.setVisible(!this.icon.visible);
    if (speaking && conversation !== null) {
      this.caption.setText(conversation.line).setPosition(0, -3).setColor('#4b4035');
      const width = Math.max(30, this.caption.width + 10), height = this.caption.height + 8;
      this.root.setSize(width + 2, height + 8);
      g.fillStyle(0x604c3c).fillRoundedRect(-width / 2 - 1, -height / 2 - 4, width + 2, height + 2, 5);
      g.fillStyle(0xfff7e5).fillRoundedRect(-width / 2, -height / 2 - 3, width, height, 4);
      if (belowGuest) {
        g.fillStyle(0x604c3c).fillTriangle(-5, -height / 2 - 3, 1, -height / 2 - 3, -4, -height / 2 - 9);
        g.fillStyle(0xfff7e5).fillTriangle(-4, -height / 2 - 2, 0, -height / 2 - 2, -3, -height / 2 - 7);
      } else {
        g.fillStyle(0x604c3c).fillTriangle(-5, height / 2 - 3, 1, height / 2 - 3, -4, height / 2 + 3);
        g.fillStyle(0xfff7e5).fillTriangle(-4, height / 2 - 4, 0, height / 2 - 4, -3, height / 2 + 1);
      }
      return;
    }
    this.root.setSize(29, 30);
    this.cloud(0x483a30, 0.8, 1);
    this.cloud(mood === 'angry' ? 0xffdfce : 0xfff8e8, 0, 0);
    g.fillStyle(0xfffdf4).fillCircle(-4, -10, 3).fillCircle(3, -10, 3);
    const tailY = belowGuest ? -16 : 10, tailStep = belowGuest ? -4 : 4;
    g.fillStyle(0x604c3c).fillCircle(-5, tailY, 2.1).fillCircle(-8, tailY + tailStep, 1.2);
    g.fillStyle(0xfff8e8).fillCircle(-5, tailY - 0.5, 1.4);
    if (this.icon.visible) this.icon.setTexture(guest.product === 'ale' ? 'icon-ale' : 'icon-stew');
    this.caption.setText('Room').setPosition(0, -3).setColor('#4b4035');
    if (mood === 'angry' || mood === 'impatient') {
      g.fillStyle(mood === 'angry' ? 0xc9503d : 0xc48b42).fillCircle(10, -10, 3.1);
      g.fillStyle(0xfff9e9).fillRect(9.5, -12, 1, 2.5).fillRect(9.5, -8.8, 1, 1);
    }
  }

  /** Release the entire attachment when the guest leaves or the scene shuts down. */
  destroy(): void { this.root.destroy(); }
}
