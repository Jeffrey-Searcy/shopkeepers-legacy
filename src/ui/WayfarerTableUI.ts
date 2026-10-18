/**
 * WayfarerTableUI — the screen for sitting at a table in The Wayfarer on its busy Wednesday night.
 *
 * It is a low panel across the bottom 40% of the screen, so the bar and the seated guests stay visible above it.
 *  - Left column: the table title, each guest with their hearts (and a party mark), the purse and the clock.
 *  - Right column: the running transcript, the keeper's typed line, and up to ten buttons.
 * The keeper can fold the panel (H, or the Hide tab) down to a one-line strip that shows only the newest
 * line, to watch the whole room; H, Enter, E, Space or a tap on the strip opens it again. The fold is
 * screen-only state: it lives here, not in the table system, and resets when the table closes.
 *
 * The panel holds no game logic. It reads wayfarerTableView() every frame and sends presses and keys to
 * WayfarerTableSystem. UIScene routes keyboard events here while the table dialogue is open, so one key
 * is handled once. Clicks stop propagation so they never swing the keeper's tool.
 */
import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { Sfx } from '../systems/SfxSystem';
import { townClockLabel } from '../systems/TownLifeSystem';
import { backspaceWayfarerTable, moveWayfarerTableSelection, pressWayfarerTableButton, sendWayfarerTableLine,
  typeWayfarerTable, updateWayfarerTable, wayfarerTableView, type WayfarerTableLine,
  type WayfarerTableView } from '../systems/WayfarerTableSystem';
import { COZY_THEME, cozyPanel } from './CozyTheme';
import { residentCharacterSheet } from '../config/ResidentCharacterSheets';
import type { ResidentId } from '../config/ResidentRelationships';

/** Button slots the panel draws (the idle menu uses nine). */
const BUTTON_SLOTS = 10;
/** Buttons per row. Up and Down move by one row. */
const BUTTONS_PER_ROW = 5;
/** Button size and the centers of the slots. */
const BUTTON_W = 120;
const BUTTON_H = 32;
const BUTTON_X = [364, 492, 620, 748, 876] as const;
const BUTTON_Y = [472, 508] as const;
/** Panel center height and size in the 960x540 UI space (it covers y 318-538). */
const PANEL_Y = 428;
const PANEL_H = 220;
/** Transcript box: left edge, top, wrap width, and the height lines must fit in. */
const TRANSCRIPT_X = 308;
const TRANSCRIPT_TOP = 338;
const TRANSCRIPT_WIDTH = 620;
const TRANSCRIPT_HEIGHT = 90;
/** Time each "talking" dot stays before the next appears, in ms. */
const DOT_STEP_MS = 350;
/** The folded strip: center height and size. */
const STRIP_Y = 516;
const STRIP_H = 40;

/** One drawn button slot. */
interface ButtonSlot {
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/**
 * One persistent table panel. Built once in UIScene.create(); shown only while a table dialogue is open.
 */
export class WayfarerTableUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly guests: Phaser.GameObjects.Text;
  private readonly purse: Phaser.GameObjects.Text;
  private readonly status: Phaser.GameObjects.Text;
  private readonly transcript: Phaser.GameObjects.Text;
  private readonly input: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly slots: ButtonSlot[] = [];
  /** The one-line strip shown instead of the panel while folded. */
  private readonly strip: Phaser.GameObjects.Container;
  private readonly stripLine: Phaser.GameObjects.Text;
  /** True while the keeper has folded the panel down to the strip. Reset when the table closes. */
  private folded = false;

  /** Build every object once; update() only changes text, colors, and visibility. */
  constructor(scene: Phaser.Scene) {
    const blocker = cozyPanel(scene, 480, PANEL_Y, 940, PANEL_H, COZY_THEME.shadow, 24).setAlpha(0.36).setInteractive();
    // why: a click on the panel's empty parts must not reach the world and swing the held tool.
    blocker.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    const cover = cozyPanel(scene, 480, PANEL_Y, 936, PANEL_H - 6, COZY_THEME.leather, 22).setStrokeStyle(2, COZY_THEME.leatherDark);
    const page = cozyPanel(scene, 480, PANEL_Y, 922, PANEL_H - 20, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border);
    const sidePocket = cozyPanel(scene, 160, PANEL_Y, 270, PANEL_H - 34, COZY_THEME.pocket, 14).setAlpha(0.8);
    const talkPocket = cozyPanel(scene, 620, 392, 640, 118, COZY_THEME.pocket, 14).setAlpha(0.68);
    const title = scene.add.text(36, 334, 'The Wayfarer', { fontFamily: COZY_THEME.titleFont, fontStyle: 'bold',
      fontSize: '17px', color: COZY_THEME.ink }).setName('wayfarer-table-title');
    // why: right-aligned to the side pocket's edge so it never runs into the title.
    const subtitle = scene.add.text(282, 341, 'TAVERN NIGHT', { fontFamily: COZY_THEME.font,
      fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.muted }).setOrigin(1, 0);
    this.guests = scene.add.text(36, 362, '', { fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.ink,
      lineSpacing: 6 }).setName('wayfarer-table-guests');
    this.purse = scene.add.text(36, 458, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px',
      color: COZY_THEME.ink }).setName('wayfarer-table-purse');
    // why: maxLines keeps a long failure message from running into the hint below it.
    this.status = scene.add.text(36, 474, '', { fontFamily: COZY_THEME.font, fontStyle: 'italic', fontSize: '10px',
      color: COZY_THEME.muted, maxLines: 2, wordWrap: { width: 226, useAdvancedWrap: true } }).setName('wayfarer-table-status');
    this.transcript = scene.add.text(TRANSCRIPT_X, TRANSCRIPT_TOP, '', { fontFamily: COZY_THEME.font, fontSize: '12px',
      color: COZY_THEME.ink, lineSpacing: 3, wordWrap: { width: TRANSCRIPT_WIDTH, useAdvancedWrap: true } })
      .setName('wayfarer-table-transcript');
    this.input = scene.add.text(TRANSCRIPT_X, 432, '', { fontFamily: COZY_THEME.font, fontStyle: 'italic', fontSize: '12px',
      color: '#695a49', maxLines: 1, wordWrap: { width: TRANSCRIPT_WIDTH, useAdvancedWrap: true } }).setName('wayfarer-table-input');
    // why: the hint lives in the left column; the button rows fill the right side down to the page edge.
    this.hint = scene.add.text(36, 503, '', { fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.muted,
      maxLines: 2, wordWrap: { width: 226, useAdvancedWrap: true } }).setName('wayfarer-table-hint');
    // The Hide tab sits on the panel's top edge, out of the way of the transcript and the buttons.
    const hideTab = cozyPanel(scene, 884, PANEL_Y - PANEL_H / 2 + 2, 84, 22, COZY_THEME.paperDark, 8)
      .setStrokeStyle(1, COZY_THEME.border).setInteractive({ useHandCursor: true }).setName('wayfarer-table-hide');
    const hideLabel = scene.add.text(884, PANEL_Y - PANEL_H / 2 + 2, 'Hide  ▾', { fontFamily: COZY_THEME.font,
      fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.ink }).setOrigin(0.5);
    hideTab.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.setFolded(true);
    });
    this.root = scene.add.container(0, 0, [blocker, cover, page, sidePocket, talkPocket, title, subtitle, this.guests,
      this.purse, this.status, this.transcript, this.input, this.hint, hideTab, hideLabel])
      .setDepth(20).setVisible(false).setName('wayfarer-table');
    // The folded strip: one tap anywhere on it opens the panel again.
    const stripBack = cozyPanel(scene, 480, STRIP_Y, 940, STRIP_H, COZY_THEME.leather, 14)
      .setStrokeStyle(2, COZY_THEME.leatherDark).setAlpha(0.94).setInteractive({ useHandCursor: true }).setName('wayfarer-table-strip');
    stripBack.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.setFolded(false);
    });
    this.stripLine = scene.add.text(28, STRIP_Y, '', { fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.cream,
      maxLines: 1, wordWrap: { width: 760, useAdvancedWrap: true } }).setOrigin(0, 0.5).setName('wayfarer-table-strip-line');
    const stripHint = scene.add.text(932, STRIP_Y, 'Show  ▴  (H)', { fontFamily: COZY_THEME.font, fontStyle: 'bold',
      fontSize: '10px', color: COZY_THEME.cream }).setOrigin(1, 0.5);
    this.strip = scene.add.container(0, 0, [stripBack, this.stripLine, stripHint]).setDepth(20).setVisible(false)
      .setName('wayfarer-table-folded');
    for (let index = 0; index < BUTTON_SLOTS; index++) {
      const x = BUTTON_X[index % BUTTONS_PER_ROW], y = BUTTON_Y[Math.floor(index / BUTTONS_PER_ROW)];
      const background = cozyPanel(scene, x, y, BUTTON_W, BUTTON_H, COZY_THEME.paperDark, 10)
        .setInteractive({ useHandCursor: true }).setName(`wayfarer-table-button-${index}`);
      const label = scene.add.text(x, y, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px',
        color: COZY_THEME.ink, align: 'center', wordWrap: { width: BUTTON_W - 10, useAdvancedWrap: true } })
        .setOrigin(0.5).setName(`wayfarer-table-button-label-${index}`);
      background.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.press(index);
      });
      this.slots.push({ background, label });
      this.root.add([background, label]);
    }
  }

  /**
   * Fold the panel down to the one-line strip, or open it again.
   * @param folded true to fold, false to open
   */
  private setFolded(folded: boolean): void {
    if (this.folded === folded) return;
    this.folded = folded;
    Sfx.play('select');
  }

  /**
   * Press the button in one slot (a click). Slots past the current button list do nothing.
   * @param index slot index
   */
  private press(index: number): void {
    const view = wayfarerTableView();
    if (!view) return;
    const button = view.buttons[index];
    if (!button || !button.enabled) return;
    Sfx.play('select');
    pressWayfarerTableButton(button.id);
  }

  /**
   * Handle one key while the table is open. UIScene calls this once per native key event.
   * @param event the browser key event
   */
  handleKey(event: KeyboardEvent): void {
    const view = wayfarerTableView();
    if (!view) return;
    // why: the world's Escape handler owns Escape: it closes the Say line first, then the table.
    if (event.key === 'Escape') return;
    if (this.folded) {
      // why: while folded only "open it again" keys work, so a stray arrow or E never presses a hidden button.
      if (['h', 'H', 'Enter', 'e', 'E', ' '].includes(event.key)) { event.preventDefault(); this.setFolded(false); }
      return;
    }
    if (view.phase === 'typing') {
      if (event.key === 'Enter') { event.preventDefault(); sendWayfarerTableLine(); return; }
      if (event.key === 'Backspace') { event.preventDefault(); backspaceWayfarerTable(); return; }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); typeWayfarerTable(event.key);
      }
      return;
    }
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Tab: 1, ArrowDown: BUTTONS_PER_ROW, ArrowUp: -BUTTONS_PER_ROW };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      // why: Up/Down on a short list would wrap to the same row, so it moves by one instead.
      const step = Math.abs(move) === BUTTONS_PER_ROW && view.buttons.length <= BUTTONS_PER_ROW ? Math.sign(move) : move;
      moveWayfarerTableSelection(event.shiftKey && event.key === 'Tab' ? -1 : step);
      return;
    }
    if (event.key === 'h' || event.key === 'H') { event.preventDefault(); this.setFolded(true); return; }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      if (view.buttons[view.selection]?.enabled) Sfx.play('select');
      pressWayfarerTableButton();
    }
  }

  /**
   * Speaker label for one transcript line.
   * @param line transcript line
   */
  private lineText(line: WayfarerTableLine): string {
    if (line.speaker === 'game') return `• ${line.text}`;
    if (line.speaker === 'player') return `You: “${line.text}”`;
    return `${residentCharacterSheet(line.speaker as ResidentId).name}: “${line.text}”`;
  }

  /**
   * Show the newest transcript lines that fit the box (older lines scroll off the top).
   * @param view the table view
   */
  private drawTranscript(view: WayfarerTableView, dots: string): void {
    // why: while the model writes, a dots line at the bottom shows the table is about to speak.
    const lines = view.lines.map(line => this.lineText(line));
    if (view.thinking) lines.push(dots);
    const wrapped = this.transcript.getWrappedText(lines.join('\n'));
    const lineHeight = 12 + 3 + 3;
    const fit = Math.max(1, Math.floor(TRANSCRIPT_HEIGHT / lineHeight));
    this.transcript.setText(wrapped.slice(-fit));
  }

  /**
   * Advance the table and redraw. Call every frame.
   * @param now real time in milliseconds (the UI scene clock)
   */
  update(now: number): void {
    updateWayfarerTable(now);
    const view = wayfarerTableView();
    if (!view) this.folded = false;
    this.root.setVisible(view !== null && !this.folded);
    this.strip.setVisible(view !== null && this.folded);
    if (!view) return;
    // why: the Say line needs the full panel; opening it (for example from the touch box) unfolds it.
    if (view.phase === 'typing') this.folded = false;
    const dots = '•' + ' ·'.repeat(1 + Math.floor(now / DOT_STEP_MS) % 3);
    if (this.folded) {
      const newest = view.lines[view.lines.length - 1];
      this.stripLine.setText(view.thinking ? `The table is talking ${dots}` : newest ? this.lineText(newest) : '');
      return;
    }
    const gs = GameState.instance;
    this.guests.setText(view.guests.map(guest => `${guest.name}  ${'♥'.repeat(guest.hearts)}${'♡'.repeat(Math.max(0, 10 - guest.hearts))}`
      + (guest.inParty ? '  ⚔' : '')).join('\n'));
    // why: the game clock runs in fractions of a minute; the label shows the current whole minute, as the HUD does.
    this.purse.setText(`${gs.gold} gold  ·  ${townClockLabel(Math.floor(gs.timeOfDay))}`);
    this.status.setText(view.thinking ? `The table is talking ${dots}` : view.status);
    this.drawTranscript(view, dots);
    this.input.setText(view.phase === 'typing' ? `You: “${view.draft}▌”`
      : view.hand ? `Your hand: ${view.hand.join(' · ')}` : '');
    this.hint.setText(view.phase === 'typing' ? 'Type  ·  Enter say it  ·  Esc back to the buttons'
      : '← → ↑ ↓ choose  ·  E press  ·  H hide  ·  Esc leave');
    this.slots.forEach((slot, index) => {
      const button = view.buttons[index];
      slot.background.setVisible(Boolean(button));
      slot.label.setVisible(Boolean(button));
      if (!button) return;
      const selected = index === view.selection;
      slot.background.setFillStyle(!button.enabled ? COZY_THEME.pocket : selected ? COZY_THEME.green : COZY_THEME.paperDark)
        .setStrokeStyle(selected ? 2 : 1, selected ? COZY_THEME.greenDark : COZY_THEME.border);
      slot.label.setText(button.label).setColor(!button.enabled ? COZY_THEME.muted : selected ? COZY_THEME.cream : COZY_THEME.ink);
    });
  }
}
