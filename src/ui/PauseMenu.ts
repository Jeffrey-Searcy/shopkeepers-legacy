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

interface PauseOption {
  label: string;
  hint: string;
  action: () => void;
}

export class PauseMenu {
  private readonly scene: Phaser.Scene;
  private root!: Phaser.GameObjects.Container;
  private optionsRoot!: Phaser.GameObjects.Container;
  private confirmRoot!: Phaser.GameObjects.Container;
  private selectedIndex = 0;
  private confirmChoice: 0 | 1 = 0;
  private wasVisible = false;
  private slotText!: Phaser.GameObjects.Text;
  /** Explicit result of the latest manual-save attempt, cleared each time pause opens. */
  private saveStatus: string | null = null;
  /** The same native event may be broadcast twice by Phaser's parallel scene input plugins. */
  private keyboardEvents = new WeakSet<KeyboardEvent>();
  private readonly options: PauseOption[];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.options = [
      { label: 'Resume', hint: 'Back to the day', action: () => this.resume() },
      { label: 'Save Game', hint: 'Keep this moment safe', action: () => this.save() },
      { label: 'Title Screen', hint: 'Leave this adventure', action: () => this.openTitleConfirm() },
    ];
  }

  /** Create all fixed overlay objects and keyboard bindings. */
  create(): void {
    this.root = this.scene.add.container(0, 0).setDepth(2_000_000).setVisible(false).setName('pause-menu');
    this.root.add(this.scene.add.rectangle(0, 0, 960, 540, 0x102622, 0.78).setOrigin(0, 0).setInteractive());
    this.root.add(this.scene.add.rectangle(480, 270, 440, 430, 0x4d3025).setStrokeStyle(5, 0xd7a75e));
    this.root.add(this.scene.add.rectangle(480, 270, 418, 408, 0xead6a6).setStrokeStyle(2, 0x8d6540));
    this.root.add(
      this.scene.add
        .text(480, 105, 'Day Paused', {
          fontFamily: 'Georgia, serif',
          fontSize: '35px',
          color: '#50372b',
        })
        .setOrigin(0.5)
    );
    this.root.add(
      this.scene.add
        .text(480, 145, 'The valley will wait for you.', {
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: '16px',
          color: '#796149',
        })
        .setOrigin(0.5)
    );
    this.slotText = this.scene.add
      .text(480, 181, '', { fontFamily: 'monospace', fontSize: '11px', color: '#8c704e' })
      .setOrigin(0.5)
      .setName('pause-slot-status');
    this.root.add(this.slotText);
    this.optionsRoot = this.scene.add.container(0, 0);
    this.root.add(this.optionsRoot);
    this.confirmRoot = this.buildConfirm();
    this.root.add(this.confirmRoot);
    this.root.add(
      this.scene.add
        .text(480, 461, '↑ ↓ choose  •  Enter select  •  Esc resume', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#887052',
        })
        .setOrigin(0.5)
    );
    this.bindKeyboard();
    this.refreshOptions();
  }

  /** Synchronize visibility and transient selection from GameState. */
  update(): void {
    const gs = GameState.instance;
    this.root.setVisible(gs.paused);
    this.initializeOpenState();
    if (!gs.paused) this.wasVisible = false;
    if (!gs.paused) return;
    const slot = SaveSystem.currentSlot();
    this.slotText.setText(this.saveStatus ?? (slot === null ? 'No save slot selected' : `Current file: Slot ${slot}`));
    this.confirmRoot.setVisible(gs.pauseConfirmOpen);
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

  /** Execute the selected pause option. */
  private activate(): void {
    this.options[this.selectedIndex].action();
  }

  /** Rebuild the three option rows with an unmistakable selected state. */
  private refreshOptions(): void {
    this.optionsRoot.removeAll(true);
    this.options.forEach((option, index) => {
      const selected = index === this.selectedIndex;
      const y = 239 + index * 68;
      const button = this.scene.add
        .rectangle(480, y, 310, 54, selected ? 0x527a50 : 0xc6aa78)
        .setStrokeStyle(selected ? 4 : 2, selected ? 0x345a3a : 0x8e724e)
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
          .text(344, y, `0${index + 1}`, {
            fontFamily: 'monospace',
            fontStyle: 'bold',
            fontSize: '10px',
            color: selected ? '#ffe19a' : '#8e724e',
          })
          .setOrigin(0.5)
      );
      this.optionsRoot.add(
        this.scene.add
          .text(375, y - 9, option.label, {
            fontFamily: 'Georgia, serif',
            fontSize: '20px',
            color: selected ? '#fff0c8' : '#49382b',
          })
          .setOrigin(0, 0.5)
      );
      this.optionsRoot.add(
        this.scene.add
          .text(375, y + 14, option.hint, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: selected ? '#dce5bc' : '#78634a',
          })
          .setOrigin(0, 0.5)
      );
      if (selected) {
        this.optionsRoot.add(this.scene.add.text(621, y, '›', { fontFamily: 'Georgia, serif', fontSize: '31px', color: '#ffe19a' }).setOrigin(0.5));
      }
    });
  }

  /** Build the title-return confirmation panel. */
  private buildConfirm(): Phaser.GameObjects.Container {
    const root = this.scene.add.container(0, 0).setDepth(10).setVisible(false);
    root.add(this.scene.add.rectangle(0, 0, 960, 540, 0x102622, 0.76).setOrigin(0, 0).setInteractive());
    root.add(this.scene.add.rectangle(480, 278, 480, 220, 0x543326).setStrokeStyle(5, 0xe2b966));
    root.add(this.scene.add.rectangle(480, 278, 458, 198, 0xf0dcae));
    root.add(this.scene.add.rectangle(480, 168, 164, 29, 0x6f422c).setStrokeStyle(3, 0xe2b966));
    root.add(this.scene.add.text(480, 168, 'LEAVE THE DAY?', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: '#fff0bd' }).setOrigin(0.5));
    root.add(this.scene.add.text(480, 220, 'Return to the title?', { fontFamily: 'Georgia, serif', fontSize: '27px', color: '#54382d' }).setOrigin(0.5));
    root.add(this.scene.add.text(480, 260, 'Unsaved progress since your last save will be lost.', { fontFamily: 'monospace', fontSize: '11px', color: '#8a493e' }).setOrigin(0.5));
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
      const button = this.scene.add
        .rectangle(choice.x, 322, 165, 44, choice.color)
        .setStrokeStyle(selected ? 4 : 2, selected ? 0xffd976 : 0x5e3c2f)
        .setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => {
        this.confirmChoice = index as 0 | 1;
        this.confirmTitleChoice();
      });
      this.confirmRoot.add(button);
      this.confirmRoot.add(this.scene.add.text(choice.x, 322, choice.label, { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '11px', color: '#fff1ce' }).setOrigin(0.5));
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
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER']);
    keyboard.on('keydown-UP', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!gs.paused || gs.pauseConfirmOpen) return;
      this.initializeOpenState();
      this.selectedIndex = (this.selectedIndex + this.options.length - 1) % this.options.length;
      this.refreshOptions();
    });
    keyboard.on('keydown-DOWN', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!gs.paused || gs.pauseConfirmOpen) return;
      this.initializeOpenState();
      this.selectedIndex = (this.selectedIndex + 1) % this.options.length;
      this.refreshOptions();
    });
    keyboard.on('keydown-LEFT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (!GameState.instance.pauseConfirmOpen) return;
      this.confirmChoice = 0;
      this.refreshConfirm();
    });
    keyboard.on('keydown-RIGHT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (!GameState.instance.pauseConfirmOpen) return;
      this.confirmChoice = 1;
      this.refreshConfirm();
    });
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      const gs = GameState.instance;
      if (!gs.paused) return;
      this.initializeOpenState();
      if (gs.pauseConfirmOpen) this.confirmTitleChoice();
      else this.activate();
    });
  }
}
