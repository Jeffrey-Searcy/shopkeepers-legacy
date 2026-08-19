/**
 * UIScene — the parallel overlay: hotbar (icons, clickable, wheel-cyclable), stamina bar, clock,
 * Stardew-style slot-grid inventory (I/Tab), a two-grid chest transfer panel (click a stack to move
 * it), modal dialogue box (for the TV forecast), floating pickup toasts, and a controls hint.
 * Reads GameState each frame
 * and redraws; it holds no game logic. Panel clicks stopPropagation so they never swing the tool.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { GameState } from '../state/GameState';
import { ITEM_CATALOG, ToolId } from '../config/Items';
import { dayOfSeason } from '../config/Crops';
import { STAMINA_MAX, WATER_CAN_CAPACITY } from '../config/GameConfig';
import { ToolSystem } from '../systems/ToolSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { CraftingSystem, RECIPES } from '../systems/CraftingSystem';
import { ShippingSystem } from '../systems/ShippingSystem';
import { TRACK, ZONE_H } from '../systems/FishingSystem';
import { Sfx } from '../systems/SfxSystem';
import { TOOLBELT_CAPACITY } from '../systems/InventoryLayoutSystem';
import { DevTuningSystem } from '../systems/DevTuningSystem';
import { isTestMode } from '../debug/RuntimeMode';
import {
  InventoryUI,
  INVENTORY_THEME,
  createInventoryGrid,
  refreshInventoryGrid,
  type InventoryGridSlot,
} from '../ui/InventoryUI';
import { PauseMenu } from '../ui/PauseMenu';

export class UIScene extends Phaser.Scene {
  private inventoryUI!: InventoryUI;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private staminaText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private chestPanel!: Phaser.GameObjects.Container;
  private chestSlots: InventoryGridSlot[] = [];
  private chestBagSlots: InventoryGridSlot[] = [];
  private dialogueBox!: Phaser.GameObjects.Container;
  private dialogueName!: Phaser.GameObjects.Text;
  private dialogueLine!: Phaser.GameObjects.Text;
  private toastCount = 0;
  private pauseMenu!: PauseMenu;

  constructor() {
    super({ key: SceneKey.UI, active: false });
  }

  create(): void {
    this.inventoryUI = new InventoryUI(this);
    this.inventoryUI.create();
    this.buildStamina();
    this.buildClock();
    this.buildChestPanel();
    this.buildCraftingPanel();
    this.buildBinPanel();
    // Morning sell report container (contents rebuilt per-summary in showDaySummary).
    this.daySummaryPanel = this.add.container(0, 0).setVisible(false).setDepth(14);
    this.buildReelBar();
    this.buildDialogueBox();
    this.buildHints();
    if (isTestMode()) this.buildDevTuningPanel();
    this.pauseMenu = new PauseMenu(this);
    this.pauseMenu.create();

    this.game.events.on('toast', this.showToast, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('toast', this.showToast, this);
    });

    // Mouse wheel cycles tools (in addition to digits + clicking slots).
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (GameState.instance.paused) return;
      const dir = dy > 0 ? 1 : -1;
      const next = (GameState.instance.hotbarIndex + dir + TOOLBELT_CAPACITY) % TOOLBELT_CAPACITY;
      ToolSystem.select(next);
      Sfx.play('select');
    });
  }

  /** Watering-can meter widgets (visible only while the can is the active tool). */
  private waterLabel!: Phaser.GameObjects.Text;
  private waterBg!: Phaser.GameObjects.Rectangle;
  private waterBar!: Phaser.GameObjects.Rectangle;
  private waterText!: Phaser.GameObjects.Text;

  private buildStamina(): void {
    this.add.text(12, 10, 'Stamina', { fontSize: '12px', color: '#e8d8b0' });
    this.add.rectangle(12, 30, 160, 14, 0x000000, 0.4).setOrigin(0, 0);
    this.staminaBar = this.add.rectangle(12, 30, 160, 14, 0x5ad46a, 1).setOrigin(0, 0);
    this.staminaText = this.add
      .text(16, 30, '', { fontSize: '10px', color: '#0a2a10' })
      .setOrigin(0, 0)
      .setDepth(1);

    // Water meter, tucked under the stamina bar. Reads GameState.canWater each frame; shown only
    // when the watering can is equipped so the HUD stays quiet otherwise.
    this.waterLabel = this.add.text(12, 50, 'Water', { fontSize: '12px', color: '#bcd8e8' });
    this.waterBg = this.add.rectangle(12, 68, 120, 10, 0x000000, 0.4).setOrigin(0, 0);
    this.waterBar = this.add.rectangle(12, 68, 120, 10, 0x4aa3c7, 1).setOrigin(0, 0);
    this.waterText = this.add
      .text(136, 67, '', { fontSize: '10px', color: '#bcd8e8' })
      .setOrigin(0, 0)
      .setDepth(1);
  }

  private goldText!: Phaser.GameObjects.Text;

  /** Dev/test-only pacing panel; null in production builds. */
  private devPanel: Phaser.GameObjects.Container | null = null;
  private devToggle: Phaser.GameObjects.Text | null = null;
  private devClockValue: Phaser.GameObjects.Text | null = null;
  private devCropValue: Phaser.GameObjects.Text | null = null;

  /** Build a compact discoverable canvas panel for clock and crop-lifecycle iteration. */
  private buildDevTuningPanel(): void {
    const toggle = this.add
      .text(this.scale.width / 2, 7, ' ✿ GROWTH LAB · F10 ', {
        fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff8df', backgroundColor: '#315f5c',
      })
      .setOrigin(0.5, 0)
      .setDepth(20)
      .setInteractive({ useHandCursor: true })
      .setName('dev-tuning-toggle');
    this.devToggle = toggle;
    const panelShadow = this.add.rectangle(5, 5, 254, 116, 0x2f241d, 0.72).setOrigin(0, 0);
    const panelBg = this.add.rectangle(0, 0, 254, 116, INVENTORY_THEME.canvas, 0.99)
      .setOrigin(0, 0).setStrokeStyle(4, INVENTORY_THEME.cocoa);
    const header = this.add.rectangle(5, 5, 244, 25, INVENTORY_THEME.teal, 1)
      .setOrigin(0, 0).setStrokeStyle(2, INVENTORY_THEME.tealDark);
    const title = this.add.text(13, 11, '✿  GROWTH LAB', {
      fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: INVENTORY_THEME.cream,
    });
    const hint = this.add.text(241, 12, 'F10 close', {
      fontFamily: 'monospace', fontSize: '9px', color: INVENTORY_THEME.cream,
    }).setOrigin(1, 0);
    this.devClockValue = this.add.text(134, 48, '', {
      fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: '#315f5c',
    }).setOrigin(0.5, 0.5).setName('dev-clock-value');
    this.devCropValue = this.add.text(134, 76, '', {
      fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: '#315f5c',
    }).setOrigin(0.5, 0.5).setName('dev-crop-value');
    const clockLabel = this.add.text(12, 48, '☀ TIME', { fontFamily: 'monospace', fontSize: '10px', color: '#6d5b49' }).setOrigin(0, 0.5);
    const cropLabel = this.add.text(12, 76, '♧ CROPS', { fontFamily: 'monospace', fontSize: '10px', color: '#6d5b49' }).setOrigin(0, 0.5);
    const makeButton = (
      x: number,
      y: number,
      label: string,
      name: string,
      action: () => void,
      tone: 'gold' | 'coral' = 'gold'
    ): Phaser.GameObjects.Text =>
      this.add.text(x, y, ` ${label} `, {
        fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px',
        color: tone === 'gold' ? '#2f241d' : '#fff8df',
        backgroundColor: tone === 'gold' ? '#e7b94c' : '#d97a5e',
      }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true }).setName(name).on('pointerdown', action);
    const clockDown = makeButton(90, 48, '−', 'dev-clock-down', () => DevTuningSystem.cycleClock(-1));
    const clockUp = makeButton(178, 48, '+', 'dev-clock-up', () => DevTuningSystem.cycleClock(1));
    const cropDown = makeButton(90, 76, '−', 'dev-crop-down', () => DevTuningSystem.cycleCrops(-1));
    const cropUp = makeButton(178, 76, '+', 'dev-crop-up', () => DevTuningSystem.cycleCrops(1));
    const step = makeButton(127, 103, '✦ GROW ONE DAY', 'dev-crop-step', () => {
      DevTuningSystem.advanceCropDay();
      this.game.events.emit('dev-crops-advanced');
      Sfx.play('select');
    }, 'coral');
    this.devPanel = this.add.container((this.scale.width - 254) / 2, 24, [
      panelShadow, panelBg, header, title, hint, clockLabel, cropLabel, this.devClockValue, this.devCropValue,
      clockDown, clockUp, cropDown, cropUp, step,
    ]).setDepth(19).setVisible(false).setName('dev-tuning-panel');
    const togglePanel = (): void => {
      if (GameState.instance.paused) return;
      if (this.devPanel) this.devPanel.setVisible(!this.devPanel.visible);
    };
    toggle.on('pointerdown', togglePanel);
    this.input.keyboard?.on('keydown-BACKTICK', togglePanel);
    this.input.keyboard?.on('keydown-F10', togglePanel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-BACKTICK', togglePanel);
      this.input.keyboard?.off('keydown-F10', togglePanel);
    });
  }

  private buildClock(): void {
    this.clockText = this.add
      .text(this.scale.width - 12, 12, '', { fontSize: '14px', color: '#e8d8b0' })
      .setOrigin(1, 0);
    this.goldText = this.add
      .text(this.scale.width - 12, 32, '', { fontSize: '13px', color: '#ffd24a' })
      .setOrigin(1, 0);
  }

  /** Shipping-bin sell panel: bin contents (click to take back) + bag (click to queue for sale). */
  private binPanel!: Phaser.GameObjects.Container;
  private binSlots: InventoryGridSlot[] = [];
  private binBagSlots: InventoryGridSlot[] = [];
  private binValueText!: Phaser.GameObjects.Text;

  private buildBinPanel(): void {
    const w = 332;
    const h = 324;
    const x = (this.scale.width - w) / 2;
    const y = (this.scale.height - h) / 2;
    const bg = this.add.rectangle(0, 0, w, h, INVENTORY_THEME.canvas, 1).setOrigin(0, 0).setStrokeStyle(3, INVENTORY_THEME.cocoa);
    const title = this.add.text(16, 10, 'Shipping Crate', { fontFamily: 'Trebuchet MS', fontStyle: 'bold', fontSize: '16px', color: INVENTORY_THEME.espresso });
    const bagTitle = this.add.text(16, 162, 'Your Satchel', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: INVENTORY_THEME.espresso });
    this.binValueText = this.add.text(w - 16, 13, '', { fontFamily: 'monospace', fontSize: '10px', color: '#315f5c' }).setOrigin(1, 0);
    const hint = this.add
      .text(w - 16, h - 8, 'click stack to move · sells at day end · E close', { fontFamily: 'monospace', fontSize: '9px', color: '#6d5b49' })
      .setOrigin(1, 1);
    this.binPanel = this.add.container(x, y, [bg, title, bagTitle, this.binValueText, hint]);
    this.binSlots = createInventoryGrid(this, this.binPanel, 22, 36, {
      columns: 8, rows: 3, slotSize: 32, gap: 4, onClick: (item) => {
        ShippingSystem.withdraw(item, Number.MAX_SAFE_INTEGER);
        Sfx.play('select');
      },
    });
    this.binBagSlots = createInventoryGrid(this, this.binPanel, 22, 184, {
      columns: 8, rows: 3, slotSize: 32, gap: 4, onClick: (item) => {
        if (ShippingSystem.deposit(item, Number.MAX_SAFE_INTEGER) === 0) Sfx.play('deny');
        else Sfx.play('select');
      },
    });
    this.binPanel.setVisible(false).setDepth(11);
  }

  /**
   * The morning sell report (Stardew-style): shown while GameState.daySummary is set. The rows are
   * DYNAMIC (rebuilt when a new summary appears — tracked by summaryShownFor) since each morning
   * sells different items. Dismissed by E or click (both clear gs.daySummary).
   */
  private daySummaryPanel!: Phaser.GameObjects.Container;
  private summaryShownFor: number | null = null;

  /** Rebuild the panel's contents for the given summary and show it. */
  private showDaySummary(s: NonNullable<GameState['daySummary']>): void {
    this.daySummaryPanel.removeAll(true);
    const w = 360;
    const rows = Math.max(s.lines.length, 1);
    const h = 108 + rows * 22;
    const x = (this.scale.width - w) / 2;
    const y = (this.scale.height - h) / 2 - 16;
    this.daySummaryPanel.setPosition(x, y);

    const bg = this.add
      .rectangle(0, 0, w, h, 0x1d1626, 0.97)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffd24a)
      .setInteractive({ useHandCursor: true });
    bg.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        GameState.instance.daySummary = null;
        Sfx.play('select');
      }
    );
    const title = this.add.text(14, 10, `Day ${s.day} — Shipping Report`, {
      fontSize: '14px',
      color: '#ffd24a',
    });
    this.daySummaryPanel.add([bg, title]);

    if (s.lines.length === 0) {
      this.daySummaryPanel.add(
        this.add.text(14, 40, 'Nothing was shipped overnight.', { fontSize: '12px', color: '#b9a7cc' })
      );
    }
    s.lines.forEach((line, i) => {
      const rowY = 40 + i * 22;
      const meta = ITEM_CATALOG[line.item];
      if (meta && this.textures.exists(meta.icon)) {
        this.daySummaryPanel.add(this.add.image(24, rowY + 8, meta.icon).setDisplaySize(18, 18));
      }
      this.daySummaryPanel.add(
        this.add.text(40, rowY, meta?.label ?? line.item, { fontSize: '12px', color: '#f0eadf' })
      );
      this.daySummaryPanel.add(
        this.add
          .text(w - 14, rowY, `${line.qty} × ${line.unit}g = ${line.total}g`, {
            fontSize: '12px',
            color: '#e8e0f0',
          })
          .setOrigin(1, 0)
      );
    });

    const dividerY = 40 + rows * 22 + 6;
    this.daySummaryPanel.add(
      this.add.rectangle(14, dividerY, w - 28, 1, 0x6b5b7a, 1).setOrigin(0, 0)
    );
    this.daySummaryPanel.add(
      this.add
        .text(w - 14, dividerY + 8, `Total: ${s.total}g`, { fontSize: '13px', color: '#8fd68a' })
        .setOrigin(1, 0)
    );
    this.daySummaryPanel.add(
      this.add
        .text(w - 14, dividerY + 26, `Gold: ${s.gold}g`, { fontSize: '13px', color: '#ffd24a' })
        .setOrigin(1, 0)
    );
    this.daySummaryPanel.add(
      this.add
        .text(14, h - 16, 'E or click to start the day', { fontSize: '10px', color: '#8f80a0' })
        .setOrigin(0, 1)
    );
    this.daySummaryPanel.setVisible(true);
  }

  /** The fishing reel minigame bar (right side): zone vs fish vs progress. */
  private reelBar!: Phaser.GameObjects.Container;
  private reelZone!: Phaser.GameObjects.Rectangle;
  private reelFish!: Phaser.GameObjects.Image;
  private reelProgress!: Phaser.GameObjects.Rectangle;
  private static readonly REEL_H = 150;

  private buildReelBar(): void {
    const H = UIScene.REEL_H;
    const x = this.scale.width - 64;
    const y = (this.scale.height - H) / 2;
    const track = this.add.rectangle(0, 0, 26, H, 0x101018, 0.9).setOrigin(0, 0).setStrokeStyle(2, 0x6b5b7a);
    this.reelZone = this.add
      .rectangle(1, 0, 24, (ZONE_H / TRACK) * H, 0x44dd66, 0.5)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x44dd66);
    this.reelFish = this.add.image(13, H / 2, 'icon-fish-sardine').setDisplaySize(14, 14);
    // Full-height rect scaled by progress — mutating .height on a Rectangle ignores the origin and
    // grew the bar DOWNWARD (the designer's "bar goes down instead of filling up"). scaleY respects the
    // bottom origin, so it fills upward as you win.
    this.reelProgress = this.add.rectangle(-10, H, 6, H, 0x5ad46a, 1).setOrigin(0, 1).setScale(1, 0);
    const progTrack = this.add.rectangle(-10, 0, 6, H, 0x000000, 0.5).setOrigin(0, 0);
    const hint = this.add
      .text(13, H + 14, 'hold/tap!', { fontSize: '10px', color: '#ffe9a8' })
      .setOrigin(0.5, 0);
    this.reelBar = this.add.container(x, y, [progTrack, track, this.reelZone, this.reelFish, this.reelProgress, hint]);
    this.reelBar.setVisible(false).setDepth(12);
  }

  /** Workbench crafting panel: one row per workbench recipe, click to craft. */
  private craftingPanel!: Phaser.GameObjects.Container;
  private craftingRows: Phaser.GameObjects.Text[] = [];

  private buildCraftingPanel(): void {
    const recipes = RECIPES.filter((r) => r.station === 'workbench');
    const w = 300;
    const h = 64 + recipes.length * 30;
    const x = (this.scale.width - w) / 2;
    const y = (this.scale.height - h) / 2 - 20;
    const bg = this.add.rectangle(0, 0, w, h, 0x1d1626, 0.96).setOrigin(0, 0).setStrokeStyle(2, 0xffd24a);
    const title = this.add.text(12, 8, 'Workbench', { fontSize: '13px', color: '#ffd24a' });
    const hint = this.add
      .text(w - 12, h - 14, 'click to craft · E close', { fontSize: '10px', color: '#8f80a0' })
      .setOrigin(1, 1);
    this.craftingPanel = this.add.container(x, y, [bg, title, hint]);

    recipes.forEach((recipe, i) => {
      const cost = Object.entries(recipe.cost)
        .map(([item, n]) => `${n} ${item}`)
        .join(', ');
      const row = this.add
        .text(16, 34 + i * 30, `${recipe.label} — ${cost}`, { fontSize: '12px', color: '#e8e0f0' })
        .setInteractive({ useHandCursor: true });
      row.on(
        'pointerdown',
        (_p: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          if (CraftingSystem.craft(recipe.id)) {
            Sfx.play('harvest');
            this.game.events.emit('toast', `+1 ${recipe.label}`);
          } else {
            Sfx.play('deny');
            this.game.events.emit('toast', `Need ${cost}`);
          }
        }
      );
      this.craftingRows.push(row);
      this.craftingPanel.add(row);
    });
    this.craftingPanel.setVisible(false).setDepth(11);
  }

  /** Chest panel: full-capacity chest and satchel grids; click a stack to move it across. */
  private buildChestPanel(): void {
    const w = 332;
    const h = 324;
    const x = (this.scale.width - w) / 2;
    const y = (this.scale.height - h) / 2;
    const bg = this.add
      .rectangle(0, 0, w, h, INVENTORY_THEME.canvas, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, INVENTORY_THEME.cocoa);
    const chestTitle = this.add.text(16, 10, 'Storage Chest', {
      fontFamily: 'Trebuchet MS', fontStyle: 'bold', fontSize: '16px', color: INVENTORY_THEME.espresso,
    });
    const bagTitle = this.add.text(16, 162, 'Your Satchel', {
      fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: INVENTORY_THEME.espresso,
    });
    const hint = this.add
      .text(w - 16, h - 8, 'click stack to move · E close', {
        fontFamily: 'monospace', fontSize: '9px', color: '#6d5b49',
      })
      .setOrigin(1, 1);
    this.chestPanel = this.add.container(x, y, [bg, chestTitle, bagTitle, hint]);
    this.chestSlots = createInventoryGrid(this, this.chestPanel, 22, 36, {
      columns: 8, rows: 3, slotSize: 32, gap: 4, onClick: (item) => {
        InventorySystem.withdraw(item, Number.MAX_SAFE_INTEGER);
        Sfx.play('select');
      },
    });
    this.chestBagSlots = createInventoryGrid(this, this.chestPanel, 22, 184, {
      columns: 8, rows: 3, slotSize: 32, gap: 4, onClick: (item) => {
        InventorySystem.deposit(item, Number.MAX_SAFE_INTEGER);
        Sfx.play('select');
      },
    });
    this.chestPanel.setVisible(false).setDepth(11);
  }

  /** Bottom-center dialogue box; visibility mirrors GameState.dialogue. */
  private buildDialogueBox(): void {
    const w = 520;
    const h = 74;
    const x = (this.scale.width - w) / 2;
    const y = this.scale.height - h - 64;
    const bg = this.add.rectangle(0, 0, w, h, 0x1d1626, 0.94).setOrigin(0, 0).setStrokeStyle(2, 0xffd24a);
    this.dialogueName = this.add.text(14, 8, '', { fontSize: '13px', color: '#ffd24a' });
    this.dialogueLine = this.add.text(14, 28, '', {
      fontSize: '13px',
      color: '#f0eadf',
      wordWrap: { width: w - 28 },
    });
    const hint = this.add
      .text(w - 12, h - 16, 'E to close', { fontSize: '10px', color: '#8f80a0' })
      .setOrigin(1, 0);
    this.dialogueBox = this.add.container(x, y, [bg, this.dialogueName, this.dialogueLine, hint]);
    this.dialogueBox.setVisible(false).setDepth(12);
  }

  private buildHints(): void {
    this.add
      .text(
        this.scale.width - 12,
        this.scale.height - 10,
        `WASD move · Space/click hold to use · E talk/open · 1-8/wheel tools · I/Tab satchel${
          isTestMode() ? ' · F10 Growth Lab' : ''
        }`,
        { fontSize: '10px', color: '#8f80a0' }
      )
      .setOrigin(1, 1);
  }

  /** Rising, fading pickup toast in the lower-left (stacks briefly if several fire). */
  private showToast(msg: string): void {
    const y = this.scale.height - 70 - (this.toastCount % 3) * 18;
    this.toastCount++;
    const t = this.add
      .text(16, y, msg, { fontSize: '13px', color: '#ffe9a8', stroke: '#000000', strokeThickness: 3 })
      .setDepth(13);
    this.tweens.add({
      targets: t,
      y: y - 26,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  update(): void {
    const gs = GameState.instance;
    if (this.devToggle) this.devToggle.setVisible(!gs.paused);
    if (gs.paused && this.devPanel) this.devPanel.setVisible(false);
    if (this.devClockValue) this.devClockValue.setText(`×${gs.devTuning.clockScale}`);
    if (this.devCropValue) this.devCropValue.setText(gs.devTuning.cropScale === 1 ? 'NORMAL' : `×${gs.devTuning.cropScale}`);

    // Stamina.
    const frac = Math.max(0, Math.min(1, gs.player.stamina / STAMINA_MAX));
    this.staminaBar.width = 160 * frac;
    this.staminaBar.setFillStyle(frac > 0.3 ? 0x5ad46a : 0xd45a5a, 1);
    this.staminaText.setText(`${Math.round(gs.player.stamina)}/${STAMINA_MAX}`);

    // Watering-can meter: only while the can is equipped; drains red-ish when empty.
    const canEquipped = ToolSystem.active() === ToolId.WateringCan;
    this.waterLabel.setVisible(canEquipped);
    this.waterBg.setVisible(canEquipped);
    this.waterBar.setVisible(canEquipped);
    this.waterText.setVisible(canEquipped);
    if (canEquipped) {
      const wfrac = Math.max(0, Math.min(1, gs.canWater / WATER_CAN_CAPACITY));
      this.waterBar.width = 120 * wfrac;
      this.waterBar.setFillStyle(gs.canWater > 0 ? 0x4aa3c7 : 0xd45a5a, 1);
      this.waterText.setText(`${gs.canWater}/${WATER_CAN_CAPACITY}`);
    }

    // Clock (season + day-of-season, Stardew-style calendar) + gold.
    const totalMin = (6 * 60 + gs.timeOfDay) % (24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(Math.floor(totalMin % 60)).padStart(2, '0');
    const season = gs.season.charAt(0).toUpperCase() + gs.season.slice(1);
    this.clockText.setText(`${season} ${dayOfSeason(gs.day)}   ${hh}:${mm}`);
    this.goldText.setText(`${gs.gold}g`);

    // Panels (chest/crafting/bin take precedence over the bag panel).
    this.craftingPanel.setVisible(gs.craftingOpen);
    // Morning sell report: rebuild once per new summary; hide when dismissed.
    if (gs.daySummary && this.summaryShownFor !== gs.daySummary.day) {
      this.summaryShownFor = gs.daySummary.day;
      this.showDaySummary(gs.daySummary);
    } else if (!gs.daySummary && this.daySummaryPanel.visible) {
      this.daySummaryPanel.setVisible(false);
      this.summaryShownFor = null;
    }

    this.binPanel.setVisible(gs.binOpen);
    if (gs.binOpen) {
      refreshInventoryGrid(this, this.binSlots, gs.bin);
      // Toolbelt item stacks still belong to the player's unified inventory and must remain
      // transferable after being dragged out of the backpack grid.
      refreshInventoryGrid(this, this.binBagSlots, gs.inventory);
      this.binValueText.setText(`pending: ${ShippingSystem.pendingValue()}g`);
    }
    // Fishing reel bar.
    const reeling = gs.fishing?.phase === 'reeling';
    this.reelBar.setVisible(reeling);
    if (reeling && gs.fishing) {
      const H = UIScene.REEL_H;
      const zoneTop = 1 - ((gs.fishing.zonePos ?? 0) + ZONE_H) / TRACK; // track units -> screen frac
      this.reelZone.setY(zoneTop * H);
      this.reelFish.setY((1 - (gs.fishing.fishPos ?? 50) / TRACK) * H);
      this.reelProgress.setScale(1, Math.max(0, Math.min(1, gs.fishing.progress ?? 0)));
      const fishId = gs.fishing.fishId;
      if (fishId && this.textures.exists(`icon-${fishId}`)) this.reelFish.setTexture(`icon-${fishId}`);
    }
    this.chestPanel.setVisible(gs.chestOpen);
    if (gs.chestOpen) {
      refreshInventoryGrid(this, this.chestSlots, gs.chest);
      refreshInventoryGrid(this, this.chestBagSlots, gs.inventory);
    }
    const otherPanel = gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary !== null;
    this.inventoryUI.update(gs, otherPanel);

    // Dialogue box.
    this.dialogueBox.setVisible(!!gs.dialogue);
    if (gs.dialogue) {
      this.dialogueName.setText(gs.dialogue.name);
      this.dialogueLine.setText(gs.dialogue.line);
    }
    this.pauseMenu.update();
  }
}
