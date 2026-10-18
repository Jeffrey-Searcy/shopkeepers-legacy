/** Pause-owned wardrobe: a detached draft, live pose previews, and one explicit Apply boundary. */
import Phaser from 'phaser';
import { APPEARANCE_OPTIONS, assertAppearance, originalAppearance, type Appearance, type AppearanceField } from '../config/Appearance';
import { GameState } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { AppearanceTextureSystem, APPEARANCE_SHEETS } from '../systems/AppearanceTextureSystem';
import { Sfx } from '../systems/SfxSystem';
import { COZY_THEME, cozyPanel, cozyPop, prefersReducedMotion } from './CozyTheme';
import { createScreenShade } from './UILayout';

/** Display order and human labels for the twelve finite cosmetic settings (body and shapes first, then colors). */
const FIELDS: readonly { key: AppearanceField; label: string }[] = [
  { key: 'body', label: 'Body' }, { key: 'hairStyle', label: 'Hair style' }, { key: 'hat', label: 'Hat' },
  { key: 'facialHair', label: 'Facial hair' }, { key: 'shirtStyle', label: 'Shirt' }, { key: 'garment', label: 'Outerwear' },
  { key: 'pantsStyle', label: 'Pants' }, { key: 'eyeColor', label: 'Eye color' }, { key: 'skinTone', label: 'Skin tone' },
  { key: 'hairColor', label: 'Hair color' }, { key: 'shirtColor', label: 'Shirt color' }, { key: 'pantsColor', label: 'Pants color' },
];
/** Wardrobe row layout: twelve rows from y 72 to 391 fit between the panel top (34) and the status line (421). */
const ROW_TOP = 72;
const ROW_PITCH = 29;
// why: one pixel less than the pitch leaves a visible gap between neighbouring row cards
const ROW_HEIGHT = ROW_PITCH - 1;
const ARROW_SIZE = 26;
const DIRECTIONS = ['Front', 'Back', 'Left', 'Right'] as const;
// why: pose n >= 2 previews APPEARANCE_SHEETS[n - 1], so this list follows the sheet order exactly
const POSES = ['Standing', 'Walking', 'Chopping', 'Digging', 'Mining', 'Scythe', 'Sweeping', 'Watering', 'Sword'] as const;

/** No editor state enters GameState until Apply. Closing, Escape, or scene shutdown discards the draft. */
export class AppearanceUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly preview: Phaser.GameObjects.Image;
  private readonly thumbnails: Phaser.GameObjects.Image[] = [];
  private readonly values: Phaser.GameObjects.Text[] = [];
  private readonly rows: Phaser.GameObjects.Rectangle[] = [];
  private readonly swatches: Phaser.GameObjects.Rectangle[] = [];
  private readonly directionButtons: Phaser.GameObjects.Text[] = [];
  private readonly poseLabel: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private draft: Appearance = originalAppearance();
  private selected = 0;
  private direction = 0;
  private pose = 1;
  private readonly keys = new WeakSet<KeyboardEvent>();
  private readonly textures: AppearanceTextureSystem;

  /** Build editor controls, with fixed logical geometry shared by pointer and keyboard paths. */
  constructor(private readonly scene: Phaser.Scene) {
    this.textures = AppearanceTextureSystem.forGame(scene.game);
    const shade = createScreenShade(scene, COZY_THEME.shadow, 0.65).setInteractive();
    shade.on('pointerdown', this.stopPointer);
    const panel = cozyPanel(scene, 480, 270, 792, 472).setInteractive();
    panel.on('pointerdown', this.stopPointer);
    this.root = scene.add.container(0, 0, [shade, panel]).setDepth(2_000_010).setVisible(false).setName('appearance-editor');
    this.root.add(this.text(120, 59, 'A little more you', 29, true));
    this.root.add(this.text(122, 98, 'Small details. Your own keeper.', 13));
    this.root.add(cozyPanel(scene, 273, 265, 300, 284, COZY_THEME.mint, 28));
    this.root.add(scene.add.ellipse(273, 316, 118, 18, COZY_THEME.green, 0.15));
    this.preview = scene.add.image(273, 280, APPEARANCE_SHEETS[0], 0).setScale(4).setName('appearance-preview');
    this.root.add(this.preview);
    for (let index = 0; index < 4; index++) {
      const thumb = scene.add.image(171 + index * 68, 375, APPEARANCE_SHEETS[0], index * 4).setScale(1.4);
      this.thumbnails.push(thumb); this.root.add(thumb);
      const button = this.button(171 + index * 68, 409, DIRECTIONS[index], () => { this.direction = index; this.refreshRows(); }, `appearance-direction-${index}`, 60, 25);
      this.directionButtons.push(button);
    }
    this.poseLabel = this.button(273, 145, '', () => this.cyclePose(), 'appearance-pose', 192, 30);
    FIELDS.forEach(({ key, label }, index) => {
      const y = ROW_TOP + index * ROW_PITCH;
      const row = cozyPanel(scene, 642, y, 384, ROW_HEIGHT, COZY_THEME.pocket, 10);
      this.rows.push(row); this.root.add(row);
      this.root.add(this.text(463, y - 8, label, 13, true));
      this.button(619, y, '‹', () => this.change(index, -1), `appearance-${key}-previous`, ARROW_SIZE, ARROW_SIZE);
      const value = this.text(719, y, '', 13).setOrigin(0.5);
      this.values.push(value); this.root.add(value);
      const swatch = cozyPanel(scene, 646, y, 12, 12, COZY_THEME.mint, 4).setVisible(false);
      this.swatches.push(swatch); this.root.add(swatch);
      this.button(814, y, '›', () => this.change(index, 1), `appearance-${key}-next`, ARROW_SIZE, ARROW_SIZE);
    });
    this.status = this.text(457, 421, 'Changes stay here until you apply.', 11).setWordWrapWidth(382);
    this.root.add(this.status);
    this.button(657, 463, 'Cancel', () => this.close(), 'appearance-cancel', 108, 34);
    this.button(788, 463, 'Apply', () => this.apply(), 'appearance-apply', 116, 34, true);
    this.root.add(this.text(122, 471, 'Arrows edit · R turn · Space pose', 10));
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('AppearanceUI requires keyboard input');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /** Construct consistent text; caller chooses whether to parent it as a control or label. */
  private text(x: number, y: number, label: string, size: number, bold = false): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, label, { fontFamily: COZY_THEME.font, fontSize: `${size}px`, color: COZY_THEME.ink, fontStyle: bold ? 'bold' : 'normal' });
  }

  /**
   * Create a named button that shares the same validated intent as keyboard input.
   * @param x center x; y center y; label text (‹ › arrows get a larger font and a padded hit box).
   * @param action runs on press while the editor is open; name is the debug/test name.
   * @param width drawn width; height drawn height; primary uses the green filled style.
   * @returns the button's label text.
   */
  private button(x: number, y: number, label: string, action: () => void, name: string, width: number, height: number, primary = false): Phaser.GameObjects.Text {
    // Touch: the ‹ › arrows are only ARROW_SIZE px. Widen their invisible hit box by 12 px each side, but only
    // 1 px vertically: the hit box is then ARROW_SIZE + 2 = 28 px tall inside a 29 px row pitch, so a thumb
    // never lands on the next row's arrow.
    const arrow = label === '‹' || label === '›';
    const bg = cozyPanel(this.scene, x, y, width, height, primary ? COZY_THEME.green : COZY_THEME.paper, 12)
      .setInteractive(arrow
        ? { hitArea: new Phaser.Geom.Rectangle(-12, -1, width + 24, height + 2), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true }
        : { useHandCursor: true }).setName(name);
    bg.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (GameState.instance.appearanceEditorOpen) action();
    });
    bg.on('pointerover', () => bg.setStrokeStyle(2, COZY_THEME.green));
    bg.on('pointerout', () => bg.setStrokeStyle(0));
    const text = this.text(x, y, label, label === '‹' || label === '›' ? 25 : 13, primary).setOrigin(0.5).setColor(primary ? '#fff9e9' : COZY_THEME.ink);
    this.root.add([bg, text]);
    return text;
  }

  /** Prevent clicks on blank editor space from reaching lower scenes. */
  private stopPointer(_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData): void {
    event.stopPropagation();
  }

  /** Start a fresh detached draft while retaining pause ownership. */
  open(event?: KeyboardEvent): void {
    if (!GameState.instance.paused) throw new Error('Appearance editor can only open while paused');
    this.draft = assertAppearance(GameState.instance.appearance);
    if (event) this.keys.add(event);
    this.selected = 0; this.direction = 0; this.pose = prefersReducedMotion() ? 0 : 1;
    GameState.instance.appearanceEditorOpen = true;
    InputBus.instance.clearAll();
    this.status.setText('Changes stay here until you apply.');
    this.root.setVisible(true); this.refreshRows(); this.refreshPreview();
    cozyPop(this.scene, this.root);
  }

  /** Discard draft ownership and return to pause, never resume gameplay or write a save. */
  private close(): void {
    GameState.instance.appearanceEditorOpen = false;
    // UIScene re-enables pause on the next update, after this native event finishes dispatching.
    this.root.setVisible(false); InputBus.instance.clearAll();
  }

  /** Validate every action sheet before the only live-state write; display any failure explicitly. */
  private apply(): void {
    try {
      const appearance = this.textures.prepareActive(this.draft);
      GameState.instance.appearance = appearance;
      this.scene.game.events.emit('appearance-changed');
      Sfx.play('stash'); this.close();
    } catch (error) {
      this.status.setText(error instanceof Error ? error.message : String(error));
      Sfx.play('deny');
    }
  }

  /** Cycle a finite catalog option on the draft; render validation happens before committing the choice. */
  private change(index: number, delta: number): void {
    this.selected = index;
    const field = FIELDS[index].key;
    const options = APPEARANCE_OPTIONS[field];
    const current = options.findIndex(option => option.id === this.draft[field]);
    const next = options[(current + delta + options.length) % options.length];
    const candidate = assertAppearance({ ...this.draft, [field]: next.id });
    try {
      this.textures.textureFor(APPEARANCE_SHEETS[0], candidate, 'preview');
      this.draft = candidate; this.refreshRows(); this.refreshPreview(); Sfx.play('select');
    } catch (error) {
      this.status.setText(error instanceof Error ? error.message : String(error)); Sfx.play('deny');
    }
  }

  /** Advance among idle, walking and all six tool-sheet previews without affecting the world. */
  private cyclePose(): void {
    this.pose = (this.pose + 1) % POSES.length; this.refreshRows(); this.refreshPreview();
  }

  /** Show current catalog labels, swatches and the keyboard selection without changing hit geometry. */
  private refreshRows(): void {
    FIELDS.forEach(({ key }, index) => {
      const option = APPEARANCE_OPTIONS[key].find(entry => entry.id === this.draft[key]);
      if (!option) throw new Error(`Appearance editor has invalid ${key}`);
      this.values[index].setText(option.label);
      if (index === this.selected) this.rows[index].setStrokeStyle(2, COZY_THEME.green);
      else this.rows[index].setStrokeStyle();
      this.swatches[index].setVisible('color' in option);
      if ('color' in option) this.swatches[index].setFillStyle(Number.parseInt(option.color.slice(1), 16));
    });
    this.directionButtons.forEach((button, index) => button.setColor(index === this.direction ? '#27704f' : COZY_THEME.muted));
    this.poseLabel.setText(`${POSES[this.pose]}  ↻`);
  }

  /** Preview the current frame and all four facing poses using the isolated texture bank. */
  private refreshPreview(): void {
    const sheet = APPEARANCE_SHEETS[this.pose <= 1 ? 0 : this.pose - 1];
    const frame = this.direction * 4 + (this.pose === 0 ? 0 : Math.floor(this.scene.time.now / 125) % 4);
    this.preview.setTexture(this.textures.textureFor(sheet, this.draft, 'preview'), frame);
    const navigation = this.textures.textureFor(APPEARANCE_SHEETS[0], this.draft, 'preview');
    this.thumbnails.forEach((thumb, index) => thumb.setTexture(navigation, index * 4));
  }

  /** Handle discrete keyboard intent once per native event; the world owns Escape cancellation. */
  private onKey(event: KeyboardEvent): void {
    if (this.keys.has(event)) return;
    this.keys.add(event);
    // Record even closed-state events: Phaser may broadcast the Enter that opens this editor twice.
    if (!GameState.instance.appearanceEditorOpen) return;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown' || event.code === 'Tab') {
      event.preventDefault();
      const delta = event.code === 'ArrowUp' || (event.code === 'Tab' && event.shiftKey) ? -1 : 1;
      this.selected = (this.selected + delta + FIELDS.length) % FIELDS.length; this.refreshRows();
    } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      event.preventDefault(); this.change(this.selected, event.code === 'ArrowLeft' ? -1 : 1);
    } else if (event.code === 'Enter' && !event.repeat) { event.preventDefault(); this.apply(); }
    else if (event.code === 'Space' && !event.repeat) { event.preventDefault(); this.cyclePose(); }
    else if (event.code === 'KeyR' && !event.repeat) { this.direction = (this.direction + 1) % 4; this.refreshRows(); }
  }

  /** Animate only the visible draft; reflect Escape closing before the pause menu is rendered. */
  update(): void {
    const open = GameState.instance.appearanceEditorOpen;
    this.root.setVisible(open);
    if (open) this.refreshPreview();
  }
}
