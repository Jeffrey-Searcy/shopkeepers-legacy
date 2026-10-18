/**
 * VitalityHud — the small HUD pieces for the keeper's body, drawn by UIScene beside the stamina bar.
 *
 * Shows:
 *  - one chip per running food buff (name and game time left), just right of the stamina bar;
 *  - after Nyra teaches mana: a mana bar, a Meditate/Stand button, and a Mend button.
 * The chips and the bar only read VitalitySystem. The two buttons are the only writers: they call
 * VitalitySystem.startMeditating/stopMeditating/castMend and toast the result. They are real
 * interactive objects, so BaseWorldScene.pointerOnWorld ignores taps on them (iPad play).
 *
 * Layout (UI pixels): the stamina bar spans x 12..172 at y 30..44, so chips start at x 180 on the
 * same row. Below it, the left HUD column is a stack that UIScene lays out each frame:
 *  1. the water meter's fixed slot (y 50..78; reserved even while hidden so tool swaps never shift rows);
 *  2. the mana row, at the `top` UIScene passes to update() (88 today), only after mana is learned;
 *  3. TavernUI's task strip, at the y update() returns.
 * Playtest probe: a fixed mana row at y 86 sat under the task strip (y 88), which hid it and ate
 * Meditate taps. The stack makes that overlap impossible. The combat HP bar (y 124..154) shows only in
 * combat scenes, where the task strip never shows.
 */
import Phaser from 'phaser';
import { BUFF_IDS } from '../config/Consumables';
import { VitalitySystem } from '../systems/VitalitySystem';
import { GameState } from '../state/GameState';
import { MANA_MAX_CAP, MEDITATION_MINUTES_PER_POINT } from '../systems/VitalityState';

/** Left edge of the first buff chip. */
const CHIP_X = 180;
/** Top of every buff chip (same row as the stamina bar). */
const CHIP_Y = 29;
/** Gap between chips. */
const CHIP_GAP = 6;
/** Chip height. */
const CHIP_H = 16;
/** Mana bar box: same x and width as the stamina bar; its top is `row top + MANA_BAR_OFFSET`. */
const MANA_X = 12, MANA_W = 160, MANA_H = 12;
/** why: the bar is 6px shorter than the buttons, so a 3px offset centers it on the button row. */
const MANA_BAR_OFFSET = 3;
/** Mana buttons: left edge of the first one, size, and gap. Their top is the row top. */
const MANA_BUTTON_X = 180, MANA_BUTTON_W = 112, MANA_BUTTON_H = 18, MANA_BUTTON_GAP = 6;
/** Space the mana row takes in the left column: the button height plus a gap before the next row. */
const MANA_ROW_SPACE = MANA_BUTTON_H + 8;

/** One reusable buff chip: a rounded fill and its text. */
interface BuffChip {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

/**
 * Format game minutes left as "2h 40m" or "35m".
 * @param minutes whole game minutes, at least 1
 */
export function formatBuffTime(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

/** Buff chips for UIScene. Create once, then call update() every frame. */
export class VitalityHud {
  /** One chip per possible buff; only running buffs are visible. */
  private readonly chips: BuffChip[] = [];
  /** Mana row objects; hidden until the keeper has mana. */
  private manaBg!: Phaser.GameObjects.Rectangle;
  private manaBar!: Phaser.GameObjects.Rectangle;
  private manaText!: Phaser.GameObjects.Text;
  private meditateButton!: Phaser.GameObjects.Rectangle;
  private meditateLabel!: Phaser.GameObjects.Text;
  private mendButton!: Phaser.GameObjects.Rectangle;
  private mendLabel!: Phaser.GameObjects.Text;
  /** Max mana seen last frame; a rise means meditation earned a point, which gets a toast. Null before mana. */
  private lastMax: number | null = null;

  /** @param scene the UI scene that owns these objects */
  constructor(private readonly scene: Phaser.Scene) {}

  /** Build the hidden chip pool. */
  create(): void {
    for (let i = 0; i < BUFF_IDS.length; i++) {
      const bg = this.scene.add.rectangle(CHIP_X, CHIP_Y, 10, CHIP_H, 0x000000, 0.85).setOrigin(0, 0).setRounded(5)
        .setName(`hud-buff-chip-${i}`).setVisible(false);
      const text = this.scene.add.text(CHIP_X, CHIP_Y + 2, '', { fontSize: '11px', color: '#2a1c10', fontStyle: 'bold' })
        .setOrigin(0, 0).setDepth(1).setVisible(false);
      this.chips.push({ bg, text });
    }
    this.manaBg = this.scene.add.rectangle(MANA_X, 0, MANA_W, MANA_H, 0x000000, 0.4).setOrigin(0, 0)
      .setName('hud-mana-bg').setVisible(false);
    this.manaBar = this.scene.add.rectangle(MANA_X, 0, MANA_W, MANA_H, 0x6a8cff, 1).setOrigin(0, 0)
      .setName('hud-mana-bar').setVisible(false);
    this.manaText = this.scene.add.text(MANA_X + 4, 0, '', { fontSize: '10px', color: '#0d1440', fontStyle: 'bold' })
      .setOrigin(0, 0).setDepth(1).setName('hud-mana-text').setVisible(false);
    const button = (x: number, name: string, onTap: () => void): [Phaser.GameObjects.Rectangle, Phaser.GameObjects.Text] => {
      const bg = this.scene.add.rectangle(x, 0, MANA_BUTTON_W, MANA_BUTTON_H, 0x302a24, 0.92).setOrigin(0, 0)
        .setRounded(5).setStrokeStyle(1, 0x6a8cff).setInteractive({ useHandCursor: true }).setName(name).setVisible(false);
      const label = this.scene.add.text(x + MANA_BUTTON_W / 2, MANA_BUTTON_H / 2, '', {
        fontSize: '11px', color: '#e8e4ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(1).setName(`${name}-label`).setVisible(false);
      // why: stop the tap here so no other UI handler (e.g. a menu click-away) also reacts to it.
      bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        onTap();
      });
      return [bg, label];
    };
    [this.meditateButton, this.meditateLabel] = button(MANA_BUTTON_X, 'hud-meditate', () => this.toggleMeditation());
    [this.mendButton, this.mendLabel] = button(MANA_BUTTON_X + MANA_BUTTON_W + MANA_BUTTON_GAP, 'hud-mend', () => this.castMend());
    this.mendLabel.setText('Mend (1 mana)');
  }

  /** Sit down or stand up, with a toast that tells the keeper what is happening. */
  private toggleMeditation(): void {
    if (VitalitySystem.isMeditating()) {
      VitalitySystem.stopMeditating();
      this.toast('You stand up.');
      return;
    }
    VitalitySystem.startMeditating();
    this.toast('You sit and breathe slowly. Moving or acting ends it.');
  }

  /** Cast Mend and toast what happened (including a refusal). */
  private castMend(): void {
    this.toast(VitalitySystem.castMend().message);
  }

  /**
   * Show a toast through UIScene's shared toast channel.
   * @param message toast text
   */
  private toast(message: string): void {
    this.scene.game.events.emit('toast', message);
  }

  /**
   * Show running buffs left to right (BUFF_IDS order) and lay out the mana row in the left column.
   * @param top the left column's next free y (UI pixels) below the water meter's slot
   * @returns the next free y below the mana row; `top` itself while mana is not learned
   */
  update(top: number): number {
    const buffs = VitalitySystem.activeBuffs();
    let x = CHIP_X;
    this.chips.forEach((chip, index) => {
      const buff = buffs[index];
      chip.bg.setVisible(buff !== undefined);
      chip.text.setVisible(buff !== undefined);
      if (buff === undefined) return;
      chip.text.setText(`${buff.label} ${formatBuffTime(buff.minutesLeft)}`).setPosition(x + 6, CHIP_Y + 2);
      const width = Math.ceil(chip.text.width) + 12;
      chip.bg.setPosition(x, CHIP_Y).setSize(width, CHIP_H).setFillStyle(buff.color, 0.92);
      x += width + CHIP_GAP;
    });
    return this.updateMana(top);
  }

  /**
   * Draw the mana row at `top`, or hide it before mana is learned and while a dialogue is open.
   * @param top row top in UI pixels
   * @returns the next free y below the row
   */
  private updateMana(top: number): number {
    const gs = GameState.instance, mana = gs.vitality.mana;
    const visible = mana !== null && gs.dialogue === null;
    for (const part of [this.manaBg, this.manaBar, this.manaText, this.meditateButton, this.meditateLabel, this.mendButton, this.mendLabel]) {
      part.setVisible(visible);
    }
    if (mana === null) { this.lastMax = null; return top; }
    if (this.lastMax !== null && mana.max > this.lastMax) this.toast(`Your mana grows · max ${mana.max}`);
    this.lastMax = mana.max;
    // why: the space is kept while a dialogue hides the row, so the task strip never shifts mid-game;
    // it moves down once, when mana is learned.
    const next = top + MANA_ROW_SPACE;
    if (!visible) return next;
    this.manaBg.setY(top + MANA_BAR_OFFSET);
    this.manaBar.setY(top + MANA_BAR_OFFSET);
    this.manaText.setY(top + MANA_BAR_OFFSET);
    this.meditateButton.setY(top);
    this.mendButton.setY(top);
    this.meditateLabel.setY(top + MANA_BUTTON_H / 2);
    this.mendLabel.setY(top + MANA_BUTTON_H / 2);
    this.manaBar.width = MANA_W * (mana.current / mana.max);
    const meditating = VitalitySystem.isMeditating();
    // why: at the cap there is no next point to train toward, so only the state is shown.
    // why: the bar is only 160px wide, so training progress shows only while sitting; the button says the state.
    const progress = meditating && mana.max < MANA_MAX_CAP ? ` · ${Math.floor(mana.practice)}/${MEDITATION_MINUTES_PER_POINT}m` : '';
    this.manaText.setText(`Mana ${mana.current}/${mana.max}${progress}`);
    this.meditateLabel.setText(meditating ? 'Meditating · Stand' : 'Meditate');
    this.meditateButton.setFillStyle(meditating ? 0x4a5aa8 : 0x302a24, 0.92);
    return next;
  }
}
