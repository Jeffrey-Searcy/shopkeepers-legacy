/**
 * Cozy seed-counter panel for the General Market. It owns selection and feedback only; MarketSystem
 * validates every purchase and performs the single atomic inventory-and-gold transaction.
 */
import Phaser from 'phaser';
import { ITEM_CATALOG } from '../config/Items';
import { MARKET_STOCK } from '../config/Market';
import { InputBus } from '../input/InputBus';
import { GameState } from '../state/GameState';
import { MarketSystem, type MarketPurchaseResult } from '../systems/MarketSystem';
import { Sfx } from '../systems/SfxSystem';
import { COZY_THEME, cozyPanel } from './CozyTheme';
import { createScreenShade } from './UILayout';

/** UIScene-owned Market presentation with matching keyboard and pointer controls. */
export class MarketUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly balance: Phaser.GameObjects.Text;
  private readonly feedback: Phaser.GameObjects.Text;
  private readonly rowBackgrounds: Phaser.GameObjects.Rectangle[] = [];
  private readonly rowDetails: Phaser.GameObjects.Text[] = [];
  private readonly batchButtons: Phaser.GameObjects.Rectangle[] = [];
  private selection = 0;
  private batch: 1 | 5 = 1;
  private wasOpen = false;
  private readonly seenKeys = new WeakSet<KeyboardEvent>();

  /** Build persistent panel objects and remove keyboard ownership with the scene. */
  constructor(private readonly scene: Phaser.Scene) {
    const shade = createScreenShade(scene, 0x1d2720, 0.7).setInteractive();
    shade.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.root = scene.add.container(0, 0, [shade]).setDepth(110).setVisible(false).setName('market-panel');
    this.root.add(cozyPanel(scene, 480, 275, 716, 458, COZY_THEME.shadow));
    this.root.add(cozyPanel(scene, 480, 270, 708, 450));
    this.root.add(cozyPanel(scene, 286, 285, 260, 296, COZY_THEME.pocket, 18));
    this.root.add(scene.add.text(160, 65, 'Tessa’s Seed Counter', {
      fontFamily: COZY_THEME.titleFont, fontSize: '28px', color: COZY_THEME.ink,
    }).setName('market-title'));
    this.root.add(scene.add.text(174, 150,
      'Fresh packets for the season ahead.\n\nPick a seed, then choose one or five packets. New stacks need an open bag slot.', {
        fontFamily: COZY_THEME.font, fontSize: '15px', color: COZY_THEME.ink,
        wordWrap: { width: 215 }, lineSpacing: 8,
      }));
    this.balance = scene.add.text(160, 112, '', {
      fontFamily: COZY_THEME.font, fontSize: '14px', color: COZY_THEME.muted,
    }).setName('market-balance');
    this.root.add(this.balance);
    this.feedback = scene.add.text(160, 447, '', {
      fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.ink,
      wordWrap: { width: 630 }, lineSpacing: 3,
    }).setName('market-feedback');
    this.root.add(this.feedback);
    this.buildRows();
    this.buildPointerControls();
    this.root.add(scene.add.text(160, 474, '↑ ↓ choose  ·  ← → amount  ·  Enter buy  ·  E / Esc close', {
      fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.muted,
    }));
    const close = scene.add.text(785, 63, '×', { fontSize: '27px', color: COZY_THEME.muted })
      .setInteractive({ useHandCursor: true }).setName('market-close');
    close.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.close();
    });
    this.root.add(close);
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('MarketUI: keyboard input is required');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /**
   * Create one compact row per seed in MARKET_STOCK (six today). Rows are 38px tall on a 43px pitch
   * so all of them fit between the balance line and the Amount controls (y 147..400).
   * Their details refresh from live gold and inventory.
   */
  private buildRows(): void {
    const pitch = 43;
    if (147 + (MARKET_STOCK.length - 1) * pitch + 38 > 400) throw new Error('MarketUI: too many seed rows for the panel');
    MARKET_STOCK.forEach((offer, index) => {
      const item = ITEM_CATALOG[offer.item];
      if (!item) throw new Error(`MarketUI: missing item presentation for ${offer.item}`);
      if (!this.scene.textures.exists(item.icon)) throw new Error(`MarketUI: missing icon ${item.icon}`);
      const y = 147 + index * pitch;
      const bg = this.scene.add.rectangle(404, y, 385, 38, COZY_THEME.paperDark, 1)
        .setOrigin(0).setStrokeStyle(2, COZY_THEME.border).setInteractive({ useHandCursor: true })
        .setName(`market-row-${offer.item}`);
      bg.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation(); this.selection = index; this.drawSelection();
      });
      const iconMat = this.scene.add.rectangle(426, y + 19, 30, 30, COZY_THEME.paper, 1)
        .setStrokeStyle(2, COZY_THEME.border);
      const icon = this.scene.add.image(426, y + 19, item.icon).setDisplaySize(24, 24);
      const label = this.scene.add.text(450, y + 19, item.label, {
        fontFamily: COZY_THEME.titleFont, fontSize: '15px', color: COZY_THEME.ink,
      }).setOrigin(0, 0.5);
      const detail = this.scene.add.text(780, y + 19, '', {
        fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.muted,
      }).setOrigin(1, 0.5);
      this.rowBackgrounds.push(bg); this.rowDetails.push(detail);
      this.root.add([bg, iconMat, icon, label, detail]);
    });
  }

  /** Add separate pointer controls so choosing a row never spends gold by itself. */
  private buildPointerControls(): void {
    this.root.add(this.scene.add.text(404, 408, 'Amount', {
      fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.muted,
    }));
    for (const [index, value] of ([1, 5] as const).entries()) {
      const x = 520 + index * 108;
      const button = this.scene.add.rectangle(x, 417, 94, 30, COZY_THEME.paperDark)
        .setStrokeStyle(2, COZY_THEME.border).setInteractive({ useHandCursor: true })
        .setName(`market-batch-${value}`);
      button.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation(); this.batch = value; this.refreshDetails(); Sfx.play('select');
      });
      this.batchButtons.push(button);
      this.root.add([button, this.scene.add.text(x, 417, `${value} ${value === 1 ? 'packet' : 'packets'}`, {
        fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.ink,
      }).setOrigin(0.5)]);
    }
    const buy = this.scene.add.rectangle(756, 417, 116, 32, COZY_THEME.green)
      .setStrokeStyle(2, COZY_THEME.border).setInteractive({ useHandCursor: true }).setName('market-buy');
    buy.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.buy();
    });
    this.root.add([buy, this.scene.add.text(756, 417, 'Buy selected', {
      fontFamily: COZY_THEME.titleFont, fontSize: '14px', color: '#fff7df',
    }).setOrigin(0.5)]);
  }

  /** Close the panel and clear held input so the same press never moves or swings. */
  private close(): void {
    GameState.instance.marketPanelOpen = false;
    GameState.instance.civicServiceBuilding = null;
    InputBus.instance.clearAll();
    Sfx.play('select');
  }

  /** Handle selection, quantity, and purchase keys while the Market owns input. */
  private onKey(event: KeyboardEvent): void {
    if (!GameState.instance.marketPanelOpen || GameState.instance.civicServiceBuilding !== null ||
      GameState.instance.paused || this.seenKeys.has(event)) return;
    this.seenKeys.add(event);
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      event.preventDefault();
      const delta = event.code === 'ArrowDown' ? 1 : -1;
      this.selection = (this.selection + delta + MARKET_STOCK.length) % MARKET_STOCK.length;
      this.drawSelection();
    } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault(); this.batch = this.batch === 1 ? 5 : 1; this.refreshDetails();
    } else if (event.code === 'Enter' && !event.repeat) {
      event.preventDefault(); this.buy();
    }
  }

  /** Ask MarketSystem to buy the selected row and show its exact result. */
  private buy(): void {
    const offer = MARKET_STOCK[this.selection];
    if (!offer) throw new Error(`MarketUI: missing selection ${this.selection}`);
    const result: MarketPurchaseResult = MarketSystem.buy(offer.item, this.batch);
    this.feedback.setText(result.message).setColor(result.ok ? '#30594a' : '#9b442f');
    Sfx.play(result.ok ? 'stash' : 'deny');
    this.refreshDetails();
  }

  /** Update row borders without rebuilding the panel. */
  private drawSelection(): void {
    this.rowBackgrounds.forEach((row, index) => row.setStrokeStyle(index === this.selection ? 3 : 2,
      index === this.selection ? COZY_THEME.green : COZY_THEME.border));
    this.batchButtons.forEach((button, index) => {
      const selected = this.batch === (index === 0 ? 1 : 5);
      button.setFillStyle(selected ? COZY_THEME.yellow : COZY_THEME.paperDark)
        .setStrokeStyle(selected ? 3 : 2, selected ? COZY_THEME.green : COZY_THEME.border);
    });
  }

  /** Refresh prices, quantities, and the player's exact balance. */
  private refreshDetails(): void {
    const gs = GameState.instance;
    this.balance.setText(`${gs.gold} gold  ·  buying ${this.batch} ${this.batch === 1 ? 'packet' : 'packets'}`);
    MARKET_STOCK.forEach((offer, index) => {
      const hasInventoryEntry = Object.prototype.hasOwnProperty.call(gs.inventory, offer.item);
      const owned = hasInventoryEntry ? gs.inventory[offer.item] : 0;
      if (!Number.isInteger(owned) || owned < 0) {
        throw new Error(`MarketUI: invalid inventory count for ${offer.item}`);
      }
      this.rowDetails[index].setText(`${offer.season.toUpperCase()} · ${offer.price * this.batch}g · ${owned} in bag`);
    });
    this.drawSelection();
  }

  /** Reflect the transient Market flag each frame without retaining business state. */
  update(): void {
    const open = GameState.instance.marketPanelOpen && GameState.instance.civicServiceBuilding === null &&
      !GameState.instance.paused;
    this.root.setVisible(open);
    if (open && !this.wasOpen) {
      this.selection = 0; this.batch = 1; this.feedback.setText(''); this.refreshDetails();
    } else if (open) this.refreshDetails();
    this.wasOpen = open;
  }
}
