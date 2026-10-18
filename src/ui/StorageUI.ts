/** Shared chest/shipping presentation. Transfers stay in the existing inventory systems. */
import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { InventorySystem } from '../systems/InventorySystem';
import { ShippingSystem } from '../systems/ShippingSystem';
import { Sfx } from '../systems/SfxSystem';
import { createInventoryGrid, refreshInventoryGrid, type InventoryGridSlot } from './InventoryUI';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { createScreenShade } from './UILayout';

/** Two matching pockets panels; focus and hover are transient, quantities are never copied here. */
export class StorageUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly grids: [InventoryGridSlot[], InventoryGridSlot[]];
  private readonly note: Phaser.GameObjects.Text;
  private readonly focus: Phaser.GameObjects.Rectangle;
  private pane = 0;
  private selected = 0;
  private wasOpen = false;
  private readonly keys = new WeakSet<KeyboardEvent>();

  /** Build either storage intent. The kind selects existing state and transfer functions only. */
  constructor(private readonly scene: Phaser.Scene, private readonly kind: 'chest' | 'shipping') {
    const shade = createScreenShade(scene, COZY_THEME.shadow, 0.55).setInteractive();
    shade.on('pointerdown', this.stopPointer);
    this.root = scene.add.container(0, 0, [shade]).setDepth(15).setVisible(false).setName(`${kind}-panel`);
    const panel = cozyPanel(scene, 480, 270, 792, 408).setInteractive();
    panel.on('pointerdown', this.stopPointer);
    this.root.add(panel);
    const textStyle = { fontFamily: COZY_THEME.font, color: COZY_THEME.ink };
    this.root.add(scene.add.text(116, 90, kind === 'chest' ? 'A place for everything' : 'Ready for market', {
      ...textStyle, fontSize: '28px', fontStyle: 'bold',
    }));
    this.note = scene.add.text(118, 130, '', { ...textStyle, fontSize: '13px', color: COZY_THEME.muted });
    this.root.add(this.note);
    const grids: InventoryGridSlot[][] = [];
    for (let pane = 0; pane < 2; pane++) {
      const left = 116 + pane * 380;
      this.root.add(cozyPanel(scene, left + 162, 288, 348, 260, COZY_THEME.pocket, 25));
      this.root.add(scene.add.text(left + 8, 171, pane === 1 ? 'Your pockets' : kind === 'chest' ? 'Storage chest' : 'Shipping crate', {
        ...textStyle, fontSize: '16px', fontStyle: 'bold',
      }));
      grids.push(createInventoryGrid(scene, this.root, left + 7, 204, {
        columns: 6, rows: 4, slotSize: 44, gap: 10,
        onClick: (item) => this.transfer(pane, item),
      }));
    }
    this.grids = [grids[0], grids[1]];
    this.focus = cozyPanel(scene, 0, 0, 48, 48, COZY_THEME.yellow, 14).setFillStyle(COZY_THEME.yellow, 0)
      .setStrokeStyle(3, COZY_THEME.green).setVisible(false);
    this.root.add(this.focus);
    this.root.add(scene.add.text(118, 441, 'Click a stack to move it  ·  Tab switch pockets  ·  Arrows choose  ·  Enter move', {
      ...textStyle, fontSize: '12px', color: COZY_THEME.muted,
    }));
    const close = scene.add.text(839, 96, '×', { ...textStyle, fontSize: '28px' }).setOrigin(0.5)
      .setInteractive({ useHandCursor: true }).setName(`${kind}-close`);
    close.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (kind === 'chest') GameState.instance.chestOpen = false;
      else GameState.instance.binOpen = false;
    });
    this.root.add(close);
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('StorageUI requires keyboard input');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /** Consume panel clicks so empty space never activates the world. */
  private stopPointer(_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData): void {
    event.stopPropagation();
  }

  /** Read modal ownership without changing the world. */
  private isOpen(): boolean {
    const gs = GameState.instance;
    return !gs.paused && (this.kind === 'chest' ? gs.chestOpen : gs.binOpen);
  }

  /** Transfer a complete stack through the existing atomic inventory operations. */
  private transfer(pane: number, item: string): void {
    if (!this.isOpen()) return;
    const system = this.kind === 'chest' ? InventorySystem : ShippingSystem;
    const moved = pane === 0 ? system.withdraw(item, Number.MAX_SAFE_INTEGER) : system.deposit(item, Number.MAX_SAFE_INTEGER);
    Sfx.play(moved > 0 ? 'stash' : 'deny');
  }

  /** Navigate both grids with one native keyboard event, preserving empty slots as valid focus. */
  private onKey(event: KeyboardEvent): void {
    if (!this.isOpen() || this.keys.has(event)) return;
    this.keys.add(event);
    if (!['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'Tab') this.pane = 1 - this.pane;
    if (event.code === 'ArrowLeft') this.selected = (this.selected + 23) % 24;
    if (event.code === 'ArrowRight') this.selected = (this.selected + 1) % 24;
    if (event.code === 'ArrowUp') this.selected = (this.selected + 18) % 24;
    if (event.code === 'ArrowDown') this.selected = (this.selected + 6) % 24;
    if (event.code === 'Enter' && !event.repeat) {
      const item = this.grids[this.pane][this.selected].item;
      if (item !== null) this.transfer(this.pane, item);
    }
    this.focus.setVisible(true);
    this.refreshFocus();
  }

  /** Position the keyboard ring without moving the actual grid hit areas. */
  private refreshFocus(): void {
    const slot = this.grids[this.pane][this.selected];
    this.focus.setPosition(slot.bg.x + 22, slot.bg.y + 22);
  }

  /** Refresh the visible quantities from authoritative state; initialize focus once per open. */
  update(): void {
    const open = this.isOpen();
    this.root.setVisible(open);
    if (!open) { this.wasOpen = false; return; }
    if (!this.wasOpen) {
      this.wasOpen = true; this.pane = 0; this.selected = 0; this.focus.setVisible(false);
      cozyPop(this.scene, this.root);
    }
    const gs = GameState.instance;
    refreshInventoryGrid(this.scene, this.grids[0], this.kind === 'chest' ? gs.chest : gs.bin);
    refreshInventoryGrid(this.scene, this.grids[1], gs.inventory);
    this.note.setText(this.kind === 'chest' ? 'Keep little treasures safe for another day.' : `${ShippingSystem.pendingValue()}g ready to ship · Sold when you sleep`);
    this.refreshFocus();
  }
}
