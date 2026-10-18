/**
 * PauseMenu — UIScene-owned overlay for Resume, Save Game, and confirmed return to title.
 *
 * UIScene remains live while BaseWorldScene is update-gated, so this class owns only presentation
 * and menu intent. GameState.paused/pauseConfirmOpen are the shared modal authority.
 */
import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { SaveSystem } from '../systems/SaveSystem';
import { returnToMainMenu } from '../systems/SceneTransitionSystem';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { createScreenShade } from './UILayout';
import { Sfx } from '../systems/SfxSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { mapEditorMode } from '../debug/MapEditorMode';
import { SHOP_FACADES, shopFacade } from '../config/ShopFacades';

interface PauseOption {
  label: string;
  hint: string;
  action: (event?: KeyboardEvent) => void;
}

/** Owns pause navigation and save feedback while the world remains frozen. */
export class PauseMenu {
  private inputEnabled = true;
  private readonly scene: Phaser.Scene;
  private root!: Phaser.GameObjects.Container;
  private optionsRoot!: Phaser.GameObjects.Container;
  private confirmRoot!: Phaser.GameObjects.Container;
  private selectedIndex = 0;
  private confirmChoice: 0 | 1 = 0;
  private wasVisible = false;
  private slotText!: Phaser.GameObjects.Text;
  private relationshipButton!: Phaser.GameObjects.Rectangle;
  private relationshipLabel!: Phaser.GameObjects.Text;
  private routesButton!: Phaser.GameObjects.Rectangle;
  private routesLabel!: Phaser.GameObjects.Text;
  private facadeButton!: Phaser.GameObjects.Rectangle;
  private facadeLabel!: Phaser.GameObjects.Text;
  /** Explicit result of the latest save or setting attempt, cleared each time pause opens. */
  private saveStatus: string | null = null;
  /** The same native event may be broadcast twice by Phaser's parallel scene input plugins. */
  private keyboardEvents = new WeakSet<KeyboardEvent>();
  private readonly options: PauseOption[];

  /** Build menu intents; the optional editor callback leaves the world paused. */
  constructor(scene: Phaser.Scene, onAppearance?: (event?: KeyboardEvent) => void,
    private readonly onRelationships?: (event?: KeyboardEvent) => void,
    private readonly onWorldRoutes?: (event?: KeyboardEvent) => void) {
    this.scene = scene;
    this.options = [
      { label: 'Resume', hint: 'Back to the day', action: () => this.resume() },
      { label: 'Save Game', hint: 'Keep this moment safe', action: () => this.save() },
      ...(onAppearance ? [{ label: 'Appearance', hint: 'Make yourself at home', action: onAppearance }] : []),
      { label: mapEditorMode() === 'preview' ? 'Back to Editor' : 'Title Screen',
        hint: mapEditorMode() === 'preview' ? 'Leave this layout preview' : 'Leave this adventure', action: () => this.openTitleConfirm() },
    ];
  }

  /** Create all fixed overlay objects and keyboard bindings. */
  create(): void {
    this.root = this.scene.add.container(0, 0).setDepth(2_000_000).setVisible(false).setName('pause-menu');
    this.root.add(createScreenShade(this.scene, COZY_THEME.shadow, 0.68).setInteractive());
    this.root.add(cozyPanel(this.scene, 480, 276, 702, 508, COZY_THEME.shadow, 30).setAlpha(0.34));
    this.root.add(cozyPanel(this.scene, 480, 267, 702, 508, COZY_THEME.leather, 30).setInteractive().setStrokeStyle(3, COZY_THEME.leatherDark));
    this.root.add(cozyPanel(this.scene, 480, 267, 674, 480, COZY_THEME.paper, 22).setStrokeStyle(2, COZY_THEME.border));
    this.root.add(cozyPanel(this.scene, 248, 267, 186, 454, COZY_THEME.paperDark, 18).setAlpha(0.5));
    this.root.add(this.scene.add.rectangle(347, 267, 3, 438, COZY_THEME.border).setAlpha(0.8));
    this.root.add(cozyPanel(this.scene, 248, 102, 146, 31, COZY_THEME.green, 15));
    this.root.add(this.scene.add.text(248, 102, "SHOPKEEPER'S", {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '12px', color: COZY_THEME.cream,
    }).setOrigin(0.5));
    this.root.add(this.scene.add.text(248, 147, 'DAYBOOK', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '29px', color: COZY_THEME.ink,
    }).setOrigin(0.5));
    this.root.add(this.scene.add.text(248, 194, 'Pause the day.\nKeep the story.', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'italic', fontSize: '13px', color: COZY_THEME.muted,
      align: 'center', lineSpacing: 4,
    }).setOrigin(0.5));
    this.root.add(this.scene.add.text(575, 92, 'A quiet moment', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '30px', color: COZY_THEME.ink,
    }).setOrigin(0.5));
    this.root.add(this.scene.add.text(575, 121, 'Choose what comes next.', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'italic', fontSize: '13px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    this.slotText = this.scene.add
      .text(248, 474, '', { fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.muted, align: 'center', wordWrap: { width: 155 } })
      .setOrigin(0.5)
      .setName('pause-slot-status');
    this.root.add(this.slotText);
    this.optionsRoot = this.scene.add.container(0, 0);
    this.root.add(this.optionsRoot);
    // A compact journal entry keeps all four main rows and their existing keyboard indices fixed.
    this.relationshipButton = cozyPanel(this.scene, 248, 250, 168, 40, COZY_THEME.plum, 13)
      .setInteractive({ useHandCursor: true }).setName('pause-relationships');
    this.relationshipButton.on('pointerdown', () => {
      if (!this.inputEnabled || !GameState.instance.paused || GameState.instance.pauseConfirmOpen) return;
      Sfx.play('select');
      this.onRelationships?.();
    });
    this.relationshipLabel = this.scene.add.text(248, 250, '♥  Town Bonds', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.cream })
      .setOrigin(0.5).setName('pause-relationships-label');
    this.root.add([this.relationshipButton, this.relationshipLabel]);
    this.routesButton = cozyPanel(this.scene, 248, 296, 168, 34, COZY_THEME.green, 11)
      .setInteractive({ useHandCursor: true }).setName('pause-world-routes');
    this.routesButton.on('pointerdown', () => {
      if (!this.inputEnabled || !GameState.instance.paused || GameState.instance.pauseConfirmOpen) return;
      Sfx.play('select');
      this.onWorldRoutes?.();
    });
    this.routesLabel = this.scene.add.text(248, 296, '⌖  World Routes', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.cream,
    }).setOrigin(0.5).setName('pause-world-routes-label');
    this.root.add([this.routesButton, this.routesLabel]);
    this.facadeButton = cozyPanel(this.scene, 248, 340, 168, 30, COZY_THEME.pocket, 10)
      .setName('pause-shop-facade').setInteractive({ useHandCursor: true });
    this.facadeButton.on('pointerdown', () => {
      if (!this.inputEnabled || !GameState.instance.paused || GameState.instance.pauseConfirmOpen) return;
      this.selectedIndex = this.facadeIndex();
      this.cycleFacade(1);
    });
    this.facadeLabel = this.scene.add.text(248, 340, '', { fontFamily: COZY_THEME.font, fontSize: '8px', color: COZY_THEME.ink })
      .setOrigin(0.5).setName('pause-shop-facade-label');
    this.root.add([this.facadeButton, this.facadeLabel]);
    this.confirmRoot = this.buildConfirm();
    this.root.add(this.confirmRoot);
    this.root.add(
      this.scene.add
        .text(575, 496, '↑ ↓ choose   •   Enter select   •   Esc resume', {
          fontFamily: COZY_THEME.font,
          fontSize: '11px',
          color: COZY_THEME.muted,
        })
        .setOrigin(0.5)
    );
    this.bindKeyboard();
    this.refreshOptions();
  }

  /** Synchronize visibility and transient selection from GameState. */
  update(): void {
    const gs = GameState.instance;
    this.root.setVisible(gs.paused && this.inputEnabled);
    this.initializeOpenState();
    if (!gs.paused) this.wasVisible = false;
    if (!gs.paused || !this.inputEnabled) return;
    const slot = SaveSystem.currentSlot();
    this.slotText.setText(this.saveStatus ?? (slot === null ? 'No save slot selected' : `Current file: Slot ${slot}`));
    this.confirmRoot.setVisible(gs.pauseConfirmOpen);
  }

  /** Hide and suspend this menu while a nested editor owns input; does not unpause gameplay. */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.root.setVisible(enabled && GameState.instance.paused);
  }

  /** Resume play from a button or Enter, clearing every process-wide input latch. */
  private resume(): void {
    const gs = GameState.instance;
    gs.pauseConfirmOpen = false;
    gs.paused = false;
    this.wasVisible = false;
    InputBus.instance.clearAll();
  }

  /** Initialize a newly-opened menu before either the render loop or a fast key press can use it. */
  private initializeOpenState(): void {
    const gs = GameState.instance;
    if (!gs.paused || this.wasVisible) return;
    this.wasVisible = true;
    cozyPop(this.scene, this.root);
    this.selectedIndex = 0;
    this.confirmChoice = 0;
    this.saveStatus = null;
    gs.pauseConfirmOpen = false;
    this.refreshOptions();
  }

  /** Accept each physical keyboard event once without suppressing genuinely rapid key presses. */
  private consumeKeyboardEvent(event: KeyboardEvent): boolean {
    if (this.keyboardEvents.has(event)) return false;
    this.keyboardEvents.add(event);
    return true;
  }

  /** Save the active slot and show explicit success/no-slot/failure feedback. */
  private save(): void {
    if (mapEditorMode() === 'preview') {
      this.saveStatus = 'Layout previews never write adventure saves.';
      this.slotText.setText(this.saveStatus);
      return;
    }
    try {
      const saved = SaveSystem.saveCurrent();
      this.saveStatus = saved ? `✓ Saved to Slot ${saved.slot}` : 'No save slot selected';
      this.slotText.setText(this.saveStatus);
    } catch (error) {
      this.saveStatus = error instanceof Error ? error.message : String(error);
      this.slotText.setText(this.saveStatus);
    }
  }

  /** Open the destructive title confirmation with Keep Playing selected. */
  private openTitleConfirm(): void {
    GameState.instance.pauseConfirmOpen = true;
    this.confirmChoice = 0;
    this.saveStatus = null;
    this.refreshConfirm();
  }

  /**
   * Execute the selected pause option: a right-page journal option or the Exterior cycle.
   * @param event the keyboard event that chose it, when the keyboard did
   */
  private activate(event?: KeyboardEvent): void {
    if (this.selectedIndex === this.facadeIndex()) { this.cycleFacade(1); return; }
    Sfx.play('select');
    this.options[this.selectedIndex].action(event);
  }

  /** Rebuild option rows with an unmistakable selected state. */
  private refreshOptions(): void {
    const facadeSelected = this.selectedIndex === this.facadeIndex();
    this.facadeButton.setFillStyle(facadeSelected ? COZY_THEME.green : COZY_THEME.pocket)
      .setStrokeStyle(facadeSelected ? 2 : undefined, COZY_THEME.greenDark);
    this.facadeLabel.setText(`Exterior · ${shopFacade(SettingsSystem.get().shopFacade).label.replace(/ shop$/, '')}  ‹ ›`)
      .setColor(facadeSelected ? '#fff0c8' : COZY_THEME.ink);
    this.relationshipButton.setFillStyle(COZY_THEME.plum).setStrokeStyle(1, COZY_THEME.leatherDark);
    this.relationshipLabel.setColor(COZY_THEME.cream);
    this.optionsRoot.removeAll(true);
    this.options.forEach((option, index) => {
      const selected = index === this.selectedIndex;
      const y = 222 + index * 63;
      const button = cozyPanel(this.scene, 575, y, 382, 54, selected ? COZY_THEME.green : COZY_THEME.pocket, 14)
        .setStrokeStyle(selected ? 2 : undefined, COZY_THEME.greenDark)
        .setInteractive({ useHandCursor: true })
        .setName(`pause-option-${index}`);
      button.on('pointerdown', () => {
        this.selectedIndex = index;
        this.refreshOptions();
        this.activate();
      });
      this.optionsRoot.add(button);
      this.optionsRoot.add(
        this.scene.add
          .text(409, y, ['▷', '◇', '✿', '⌂'][index], {
            fontFamily: COZY_THEME.font,
            fontStyle: 'bold',
            fontSize: '10px',
            color: selected ? '#ffe19a' : '#8e724e',
          })
          .setOrigin(0.5)
      );
      this.optionsRoot.add(
        this.scene.add
          .text(442, y - 9, option.label, {
            fontFamily: COZY_THEME.font,
            fontSize: '20px',
            color: selected ? '#fff0c8' : COZY_THEME.ink,
          })
          .setOrigin(0, 0.5)
      );
      this.optionsRoot.add(
        this.scene.add
          .text(442, y + 14, option.hint, {
            fontFamily: COZY_THEME.font,
            fontSize: '10px',
            color: selected ? '#dce5bc' : COZY_THEME.muted,
          })
          .setOrigin(0, 0.5)
      );
      if (selected) {
        this.optionsRoot.add(this.scene.add.text(748, y, '›', { fontFamily: COZY_THEME.font, fontSize: '31px', color: '#ffe19a' }).setOrigin(0.5));
      }
    });
  }

  /** Count the keyboard stops: the right-page options, then Exterior. The journals use their own buttons. */
  private optionCount(): number {
    return this.options.length + 1;
  }

  /** Keyboard index of the Exterior cycle, the last stop. */
  private facadeIndex(): number {
    return this.options.length;
  }

  /** Preview the next cosmetic facade. Check art before persistence and show any storage/asset failure. */
  private cycleFacade(direction: 1 | -1): void {
    try {
      const index = SHOP_FACADES.findIndex(value => value.id === SettingsSystem.get().shopFacade);
      const next = SHOP_FACADES[(index + direction + SHOP_FACADES.length) % SHOP_FACADES.length];
      if (!this.scene.textures.exists(next.texture)) throw new Error(`Exterior art is missing: ${next.label}`);
      const image = this.scene.textures.get(next.texture).getSourceImage();
      if (image.width !== 160 || image.height !== 160) throw new Error(`Exterior art size is invalid: ${next.label}`);
      SettingsSystem.update({ shopFacade: next.id });
      this.saveStatus = 'Exterior preview only · Your interior stays the same.';
      this.refreshOptions();
      Sfx.play('select');
    } catch (error) {
      this.saveStatus = error instanceof Error ? error.message : String(error);
      this.slotText.setText(this.saveStatus);
    }
  }

  /** Build the title-return confirmation panel. */
  private buildConfirm(): Phaser.GameObjects.Container {
    const root = this.scene.add.container(0, 0).setDepth(10).setVisible(false);
    root.add(createScreenShade(this.scene, 0x203f35, 0.65).setInteractive());
    root.add(cozyPanel(this.scene, 480, 284, 480, 220, COZY_THEME.shadow).setAlpha(0.18));
    root.add(cozyPanel(this.scene, 480, 278, 480, 220).setInteractive());
    root.add(cozyPanel(this.scene, 480, 178, 164, 29, COZY_THEME.green, 14));
    root.add(this.scene.add.text(480, 178, 'LEAVE THE DAY?', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: '#fff0bd' }).setOrigin(0.5));
    root.add(this.scene.add.text(480, 220, 'Return to the title?', { fontFamily: COZY_THEME.font, fontSize: '27px', color: '#54382d' }).setOrigin(0.5));
    root.add(this.scene.add.text(480, 260, 'Unsaved progress since your last save will be lost.', { fontFamily: COZY_THEME.font, fontSize: '11px', color: '#8a493e' }).setOrigin(0.5));
    return root;
  }

  /** Redraw confirmation choices and pointer actions. */
  private refreshConfirm(): void {
    // Keep the seven permanent ledger-modal objects, including its warning and top tab.
    while (this.confirmRoot.length > 7) this.confirmRoot.removeAt(7, true);
    const choices = [
      { label: 'KEEP PLAYING', x: 385, color: 0x527a50 },
      { label: 'TITLE SCREEN', x: 575, color: 0x985340 },
    ] as const;
    choices.forEach((choice, index) => {
      const selected = this.confirmChoice === index;
      const button = cozyPanel(this.scene, choice.x, 322, 165, 44, choice.color, 18)
        .setStrokeStyle(selected ? 3 : undefined, COZY_THEME.yellow)
        .setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => {
        this.confirmChoice = index as 0 | 1;
        this.confirmTitleChoice();
      });
      this.confirmRoot.add(button);
      this.confirmRoot.add(this.scene.add.text(choice.x, 322, choice.label, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: '#fff1ce' }).setOrigin(0.5));
    });
  }

  /** Keep playing or perform the ordered shutdown/reset/title transition. */
  private confirmTitleChoice(): void {
    if (this.confirmChoice === 0) {
      GameState.instance.pauseConfirmOpen = false;
      return;
    }
    returnToMainMenu(this.scene);
  }

  /** Keyboard navigation remains active because UIScene is not paused with the world. */
  private bindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) throw new Error('PauseMenu: keyboard input unavailable');
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'R', 'M']);
    keyboard.on('keydown-R', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!this.inputEnabled || !gs.paused || gs.pauseConfirmOpen || !this.onRelationships) return;
      Sfx.play('select');
      this.onRelationships(event);
    });
    keyboard.on('keydown-M', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!this.inputEnabled || !gs.paused || gs.pauseConfirmOpen || !this.onWorldRoutes) return;
      Sfx.play('select');
      this.onWorldRoutes(event);
    });
    keyboard.on('keydown-UP', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!this.inputEnabled || !gs.paused || gs.pauseConfirmOpen) return;
      this.initializeOpenState();
      this.selectedIndex = (this.selectedIndex + this.optionCount() - 1) % this.optionCount();
      this.refreshOptions();
    });
    keyboard.on('keydown-DOWN', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!this.inputEnabled || !gs.paused || gs.pauseConfirmOpen) return;
      this.initializeOpenState();
      this.selectedIndex = (this.selectedIndex + 1) % this.optionCount();
      this.refreshOptions();
    });
    keyboard.on('keydown-LEFT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.inputEnabled && GameState.instance.paused && !GameState.instance.pauseConfirmOpen
        && this.selectedIndex === this.facadeIndex()) { this.cycleFacade(-1); return; }
      if (!this.inputEnabled || !GameState.instance.pauseConfirmOpen) return;
      this.confirmChoice = 0;
      this.refreshConfirm();
    });
    keyboard.on('keydown-RIGHT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.inputEnabled && GameState.instance.paused && !GameState.instance.pauseConfirmOpen
        && this.selectedIndex === this.facadeIndex()) { this.cycleFacade(1); return; }
      if (!this.inputEnabled || !GameState.instance.pauseConfirmOpen) return;
      this.confirmChoice = 1;
      this.refreshConfirm();
    });
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!this.inputEnabled || !gs.paused) return;
      this.initializeOpenState();
      if (gs.pauseConfirmOpen) this.confirmTitleChoice();
      else this.activate(event);
    });
  }
}
