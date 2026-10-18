/**
 * Shared cozy service panel for the eleven non-Market civic interiors.
 * Each building supplies its own name, station, description, offers, and business action.
 */
import Phaser from 'phaser';
import { civicServiceDefinition, type CivicServiceDefinition } from '../config/CivicServices';
import type { ExpandedCivicId } from '../config/CivicInteriors';
import { InputBus } from '../input/InputBus';
import { GameState } from '../state/GameState';
import { CivicServiceSystem } from '../systems/CivicServiceSystem';
import { Sfx } from '../systems/SfxSystem';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { createScreenShade } from './UILayout';

const MAX_ROWS = 4;

/** One persistent UI surface that redraws from the active building's authored service. */
export class CivicServiceUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly description: Phaser.GameObjects.Text;
  private readonly balance: Phaser.GameObjects.Text;
  private readonly feedback: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Container[] = [];
  private readonly rowBackgrounds: Phaser.GameObjects.Rectangle[] = [];
  private readonly rowIcons: Phaser.GameObjects.Image[] = [];
  private readonly rowLabels: Phaser.GameObjects.Text[] = [];
  private readonly rowDetails: Phaser.GameObjects.Text[] = [];
  private readonly batchControls: Phaser.GameObjects.Container[] = [];
  private readonly batchButtons: Phaser.GameObjects.Rectangle[] = [];
  private batchLabel!: Phaser.GameObjects.Text;
  private selection = 0;
  private batch: 1 | 5 = 1;
  private activeBuilding: ExpandedCivicId | null = null;
  private readonly seenKeys = new WeakSet<KeyboardEvent>();

  /** Build all pointer and keyboard controls once; business logic remains in CivicServiceSystem. */
  constructor(private readonly scene: Phaser.Scene, private readonly openWardrobe: () => void) {
    const shade = createScreenShade(scene, 0x1d2720, 0.72).setInteractive();
    shade.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.root = scene.add.container(0, 0, [shade]).setDepth(111).setVisible(false).setName('civic-service-panel');
    this.root.add(cozyPanel(scene, 480, 275, 716, 458, COZY_THEME.shadow));
    this.root.add(cozyPanel(scene, 480, 270, 708, 450));
    this.root.add(cozyPanel(scene, 286, 285, 260, 296, COZY_THEME.pocket, 18));
    this.title = scene.add.text(160, 65, '', {
      fontFamily: COZY_THEME.titleFont, fontSize: '28px', color: COZY_THEME.ink,
    }).setName('civic-service-title');
    this.description = scene.add.text(174, 150, '', {
      fontFamily: COZY_THEME.font, fontSize: '15px', color: COZY_THEME.ink,
      wordWrap: { width: 215 }, lineSpacing: 8,
    }).setName('civic-service-description');
    this.balance = scene.add.text(160, 112, '', {
      fontFamily: COZY_THEME.font, fontSize: '14px', color: COZY_THEME.muted,
    }).setName('civic-service-balance');
    this.feedback = scene.add.text(160, 447, '', {
      fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.ink,
      wordWrap: { width: 630 }, lineSpacing: 3,
    }).setName('civic-service-feedback');
    this.root.add([this.title, this.description, this.balance, this.feedback]);
    this.buildRows();
    this.buildPointerControls();
    this.root.add(scene.add.text(160, 474, '↑ ↓ choose  ·  ← → amount  ·  Enter confirm  ·  E / Esc close', {
      fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.muted,
    }));
    const close = scene.add.text(785, 63, '×', { fontSize: '27px', color: COZY_THEME.muted })
      .setInteractive({ useHandCursor: true }).setName('civic-service-close');
    close.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.close();
    });
    this.root.add(close);
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('CivicServiceUI: keyboard input is required');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /** Create four stable offer rows; inactive rows stay hidden for smaller services. */
  private buildRows(): void {
    for (let index = 0; index < MAX_ROWS; index++) {
      const y = 112 + index * 70;
      const bg = this.scene.add.rectangle(404, y, 385, 58, COZY_THEME.paperDark, 1)
        .setOrigin(0).setStrokeStyle(2, COZY_THEME.border)
        .setName(`civic-service-row-${index}`);
      const iconMat = this.scene.add.rectangle(438, y + 29, 44, 44, COZY_THEME.paper).setStrokeStyle(2, COZY_THEME.border);
      const icon = this.scene.add.image(438, y + 29, '__MISSING').setDisplaySize(30, 30);
      const label = this.scene.add.text(470, y + 8, '', {
        fontFamily: COZY_THEME.titleFont, fontSize: '17px', color: COZY_THEME.ink,
      });
      const detail = this.scene.add.text(470, y + 33, '', {
        fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.muted,
      });
      const row = this.scene.add.container(0, 0, [bg, iconMat, icon, label, detail])
        .setInteractive(new Phaser.Geom.Rectangle(404, y, 385, 58), Phaser.Geom.Rectangle.Contains, true)
        .setName(`civic-service-row-hit-${index}`);
      row.on('pointerover', () => {
        if (!this.service().options[index] || this.selection === index) return;
        this.selection = index; this.batch = 1; this.refresh();
      });
      row.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        const service = this.service();
        if (!service.options[index]) return;
        this.selection = index; this.batch = 1; this.refresh(); Sfx.play('select');
      });
      this.rows.push(row); this.rowBackgrounds.push(bg); this.rowIcons.push(icon);
      this.rowLabels.push(label); this.rowDetails.push(detail); this.root.add(row);
    }
  }

  /** Add amount and confirmation buttons; selecting an offer never commits by itself. */
  private buildPointerControls(): void {
    this.batchLabel = this.scene.add.text(404, 408, 'Amount', {
      fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.muted,
    });
    this.root.add(this.batchLabel);
    for (const [index, value] of ([1, 5] as const).entries()) {
      const x = 520 + index * 108;
      const button = this.scene.add.rectangle(x, 417, 94, 30, COZY_THEME.paperDark)
        .setStrokeStyle(2, COZY_THEME.border).setInteractive({ useHandCursor: true })
        .setName(`civic-service-batch-${value}`);
      button.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (!this.selectedOptionSupportsBatch()) return;
        this.batch = value; this.refresh(); Sfx.play('select');
      });
      const label = this.scene.add.text(x, 417, `${value}`, {
        fontFamily: COZY_THEME.font, fontSize: '13px', color: COZY_THEME.ink,
      }).setOrigin(0.5);
      const control = this.scene.add.container(0, 0, [button, label]);
      this.batchControls.push(control); this.batchButtons.push(button); this.root.add(control);
    }
    const confirm = this.scene.add.rectangle(756, 417, 116, 32, COZY_THEME.green)
      .setStrokeStyle(2, COZY_THEME.border).setInteractive({ useHandCursor: true }).setName('civic-service-confirm');
    confirm.on('pointerdown', (_pointer: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.confirm();
    });
    this.root.add([confirm, this.scene.add.text(756, 417, 'Confirm', {
      fontFamily: COZY_THEME.titleFont, fontSize: '14px', color: '#fff7df',
    }).setOrigin(0.5)]);
  }

  /** Resolve the active authored service or report corrupt transient UI ownership. */
  private service(): CivicServiceDefinition {
    if (!this.activeBuilding) throw new Error('CivicServiceUI: no active building');
    return civicServiceDefinition(this.activeBuilding);
  }

  /** Return whether the selected action permits five-at-once transactions. */
  private selectedOptionSupportsBatch(): boolean {
    return this.service().options[this.selection]?.supportsBatch === true;
  }

  /** Close without changing durable state and release every held input latch. */
  private close(): void {
    GameState.instance.marketPanelOpen = false;
    GameState.instance.civicServiceBuilding = null;
    InputBus.instance.clearAll(); Sfx.play('select');
  }

  /** Own navigation and confirmation keys only while a non-Market service is open. */
  private onKey(event: KeyboardEvent): void {
    const gs = GameState.instance;
    if (!gs.marketPanelOpen || gs.civicServiceBuilding === null || gs.paused || this.seenKeys.has(event)) return;
    this.seenKeys.add(event);
    const count = this.service().options.length;
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      event.preventDefault();
      const delta = event.code === 'ArrowDown' ? 1 : -1;
      this.selection = (this.selection + delta + count) % count; this.batch = 1; this.refresh();
    } else if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && this.selectedOptionSupportsBatch()) {
      event.preventDefault(); this.batch = this.batch === 1 ? 5 : 1; this.refresh();
    } else if (event.code === 'Enter' && !event.repeat) {
      event.preventDefault(); this.confirm();
    }
  }

  /** Submit the selected action once; wardrobe transfers ownership into the existing pause editor. */
  private confirm(): void {
    if (!this.activeBuilding) throw new Error('CivicServiceUI: cannot confirm without a building');
    const option = this.service().options[this.selection];
    if (!option) throw new Error(`CivicServiceUI: missing selection ${this.selection}`);
    const quantity = option.supportsBatch ? this.batch : 1;
    const result = CivicServiceSystem.run(this.activeBuilding, option.id, quantity);
    this.feedback.setText(result.message).setColor(result.ok ? '#30594a' : '#9b442f');
    Sfx.play(result.ok ? 'stash' : 'deny');
    if (result.ok && result.intent === 'wardrobe') {
      this.close(); this.openWardrobe(); return;
    }
    this.refresh();
  }

  /** Redraw live ownership, row contents, quantities, and the current balance. */
  private refresh(): void {
    const service = this.service(), option = service.options[this.selection];
    if (!option) throw new Error(`CivicServiceUI: invalid selection ${this.selection}`);
    this.title.setText(service.title); this.description.setText(service.description);
    this.balance.setText(`${GameState.instance.gold} gold${option.supportsBatch ? `  ·  amount ${this.batch}` : '  ·  one service'}`);
    this.root.setData('selection', this.selection);
    for (let index = 0; index < MAX_ROWS; index++) {
      const entry = service.options[index], row = this.rows[index];
      row.setVisible(Boolean(entry));
      if (!entry) continue;
      if (!this.scene.textures.exists(entry.icon)) throw new Error(`CivicServiceUI: missing icon ${entry.icon}`);
      this.rowIcons[index].setTexture(entry.icon);
      // why: forge, alchemy and board rows change with progress, so the text is worded live.
      const text = CivicServiceSystem.optionText(entry);
      this.rowLabels[index].setText(text.label);
      this.rowDetails[index].setText(text.detail);
      this.rowBackgrounds[index].setStrokeStyle(index === this.selection ? 3 : 2,
        index === this.selection ? COZY_THEME.green : COZY_THEME.border);
    }
    this.batchControls.forEach(control => control.setVisible(option.supportsBatch));
    this.batchLabel.setVisible(option.supportsBatch);
    this.batchButtons.forEach((button, index) => {
      const selected = this.batch === (index === 0 ? 1 : 5);
      button.setFillStyle(selected ? COZY_THEME.yellow : COZY_THEME.paperDark)
        .setStrokeStyle(selected ? 3 : 2, selected ? COZY_THEME.green : COZY_THEME.border);
    });
  }

  /** Reflect transient ownership each frame and initialize a newly selected building exactly once. */
  update(): void {
    const gs = GameState.instance;
    const building = gs.marketPanelOpen ? gs.civicServiceBuilding : null;
    const open = building !== null && !gs.paused;
    this.root.setVisible(open);
    if (open && building !== this.activeBuilding) {
      this.activeBuilding = building; this.selection = 0; this.batch = 1; this.feedback.setText('');
      this.root.setData('building', building);
      this.refresh(); cozyPop(this.scene, this.root);
    } else if (open) this.refresh();
    if (!open) { this.activeBuilding = null; this.root.setData('building', null); }
  }
}
