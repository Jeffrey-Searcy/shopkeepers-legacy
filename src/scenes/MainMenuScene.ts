/**
 * MainMenuScene — conventional game title, settings, and guarded save-file manager.
 *
 * The title and the three Willowbrook Papers intro pages are painted screens (TextureKey.TitleScreen and
 * TextureKey.Papers*). Words that must change at runtime were removed from the paintings by
 * scripts/pack-title-art.py and are drawn here as live text: menu labels, the keyboard hint, the version,
 * and the save number in each page header. Painted buttons get invisible hit areas at their measured spots.
 *
 * Cards are data-driven from SaveSystem and support both pointer and keyboard input. Empty slots
 * start fresh adventures, valid slots continue, and corrupt/occupied slots can only be deleted
 * through an explicit confirmation. All world entry routes through SceneTransitionSystem.
 */
import Phaser from 'phaser';
import { version as GAME_VERSION } from '../../package.json';
import { COZY_THEME, cozyPanel, prefersReducedMotion } from '../ui/CozyTheme';
import { installUiCamera, createScreenShade } from '../ui/UILayout';
import { ensureGradient } from '../world/InteriorLighting';
import { Sfx } from '../systems/SfxSystem';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { dayOfSeason } from '../config/Crops';
import { GameState } from '../state/GameState';
import { SaveSystem, type SaveSlot, type SaveSlotInfo } from '../systems/SaveSystem';
import { enterWorldFromMenu } from '../systems/SceneTransitionSystem';
import { SettingsSystem, type GameSettings } from '../systems/SettingsSystem';

const CARD_W = 258;
const CARD_H = 210;
const CARD_Y = 343;
const CARD_X = [205, 480, 755] as const;

/** Size of every painted title/papers screen, in image pixels. */
const ART_W = 1672;
const ART_H = 941;
/** Logical UI size the paintings cover (see installUiCamera). */
const UI_W = 960;
const UI_H = 540;
/** Color around the painting when the window is wider or taller than 16:9; matches the art's darkest edge. */
const LETTERBOX_COLOR = 0x0b1519;
/** Shared soft-glow texture for the painted lanterns (warm gradient, created once per game). */
const LANTERN_GLOW_KEY = 'title-lantern-glow';

/** A box in logical UI coordinates: center point and size. */
interface UiBox { x: number; y: number; width: number; height: number }

/**
 * Map a box measured on a painted screen (image pixels, end-exclusive) to logical UI coordinates.
 * @param x0 left edge in image pixels
 * @param y0 top edge in image pixels
 * @param x1 right edge in image pixels
 * @param y1 bottom edge in image pixels
 * @returns the same box as a logical center and size
 */
function artBox(x0: number, y0: number, x1: number, y1: number): UiBox {
  const sx = UI_W / ART_W, sy = UI_H / ART_H;
  return { x: (x0 + x1) / 2 * sx, y: (y0 + y1) / 2 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy };
}

/** The four painted menu buttons on title.png (x 638..1032, tops 424/499/575/650, 69 tall): Continue, New, Load, Settings. */
const TITLE_SLOTS = [424, 499, 575, 650].map(top => artBox(638, top, 1033, top + 69));
/** Where the removed "(A) Select" hint and "v0.1.0" stamp were painted; live text takes their place. */
const TITLE_HINT = artBox(690, 850, 975, 898);
const TITLE_VERSION = artBox(1556, 884, 1634, 912);
/** Painted lanterns that get a soft live flicker: image-pixel center and logical glow diameter. */
const TITLE_LANTERNS = [
  { x: 305, y: 390, size: 70 },   // hanging tavern-sign lantern, left
  { x: 1131, y: 305, size: 60 },  // lantern hanging from the logo board
  { x: 1290, y: 507, size: 44 },  // shop door lamp
] as const;

/** The three intro pages in order, with the painted spot of each page's header line (gold text was removed there). */
const PAPERS_PAGES = [
  { texture: TextureKey.PapersLetter, header: artBox(106, 46, 551, 61) },
  { texture: TextureKey.PapersDeparture, header: artBox(108, 47, 604, 64) },
  { texture: TextureKey.PapersChoice, header: artBox(104, 43, 496, 58) },
] as const;
/** Painted continue buttons: page 1 "TURN THE PAGE", page 2 "FOLLOW THE ROAD". */
const PAPERS_CONTINUE = [artBox(613, 797, 1060, 870), artBox(585, 773, 1085, 850)] as const;
/** Painted business cards on page 3: the enabled Tavern & Inn and the disabled "coming soon" Item Shop. */
const PAPERS_TAVERN_CARD = artBox(347, 252, 835, 760);
const PAPERS_ITEM_SHOP_CARD = artBox(862, 258, 1338, 760);

/**
 * One main-menu entry. `run` is null for a disabled entry (Continue with no valid save):
 * it is still drawn so the painted fourth button is always covered, but keyboard and pointer skip it.
 */
interface MainAction { id: string; label: string; run: (() => void) | null }
/** A drawn main-menu button: its skin image (texture swaps on selection) and whether it can be chosen. */
interface MainButton { skin: Phaser.GameObjects.Image; enabled: boolean }

/** Human-friendly world label for save-card metadata. */
function locationLabel(scene: string): string {
  const labels: Record<string, string> = {
    FarmScene: 'The Farm',
    TownScene: 'Willowbrook',
    HomeInteriorScene: 'Tavern Upstairs',
    TavernScene: 'Your Shop',
    BedroomScene: 'Your Bedroom',
    ForestScene: 'Whispering Woods',
    BeachScene: 'Sunpetal Beach',
    MountainScene: 'Mountain Pass',
    MinesScene: 'Old Mines',
  };
  return labels[scene] ?? scene;
}

/** Format a timestamp compactly without hiding invalid metadata behind a fallback. */
function savedLabel(savedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAt));
}

/** Presents save selection and the existing inheritance story without mutating unconfirmed slots. */
export class MainMenuScene extends Phaser.Scene {
  private selectedIndex = 0;
  private cardsRoot!: Phaser.GameObjects.Container;
  /** Mutually exclusive title pages keep save management out of the default landing screen. */
  private page: 'main' | 'load' | 'settings' = 'main';
  private mainRoot!: Phaser.GameObjects.Container;
  private loadRoot!: Phaser.GameObjects.Container;
  private settingsRoot!: Phaser.GameObjects.Container;
  private mainIndex = 0;
  private settingsIndex = 0;
  private mainActions: MainAction[] = [];
  /** Buttons drawn for `mainActions`, same order; rebuilt by refreshMain, re-skinned by selectMain. */
  private mainButtons: MainButton[] = [];
  /** Soft additive glows over the painted lanterns; refreshMotion starts or stops their flicker. */
  private lanternGlows: Phaser.GameObjects.Image[] = [];
  private confirmRoot!: Phaser.GameObjects.Container;
  /** New-slot-only inheritance story; never shown while continuing a ready save. */
  private originRoot!: Phaser.GameObjects.Container;
  /** Choice-page content is separate so tests and pointer ownership can inspect it directly. */
  private originChoiceRoot!: Phaser.GameObjects.Container;
  private originSlot: SaveSlot | null = null;
  private originPage: 0 | 1 | 2 = 0;
  private confirmSlot: SaveSlot | null = null;
  private confirmChoice: 0 | 1 = 0;
  private statusText!: Phaser.GameObjects.Text;
  private confirmTabText!: Phaser.GameObjects.Text;
  /** De-duplicate one native key event without throttling intentional fast navigation. */
  private keyboardEvents = new WeakSet<KeyboardEvent>();

  /** Register this non-world scene with its stable scene key. */
  constructor() {
    super(SceneKey.MainMenu);
  }

  /** Build conventional navigation over an authored pixel landscape and retain guarded save/story flows. */
  create(): void {
    installUiCamera(this);
    SaveSystem.endSession();
    this.input.topOnly = true;
    try { SettingsSystem.get(); }
    catch (error) {
      this.showSettingsRecovery(error instanceof Error ? error.message : String(error));
      return;
    }
    this.drawBackdrop();
    this.page = 'main';
    this.mainIndex = 0;
    this.mainRoot = this.add.container(0, 0).setName('title-main-root').setDepth(10);
    this.loadRoot = this.add.container(0, 0).setName('title-load-root').setDepth(20).setVisible(false);
    this.loadRoot.add(createScreenShade(this, 0x101f24, 0.92).setInteractive());
    this.loadRoot.add(this.add.text(480, 120, 'LOAD GAME', {
      fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#f3d796',
    }).setOrigin(0.5));
    this.cardsRoot = this.add.container(0, 0);
    this.loadRoot.add(this.cardsRoot);
    this.loadRoot.add(this.menuButton(480, 484, 'Back', 'load-back', false, () => this.showPage('main'), 190));
    this.settingsRoot = this.add.container(0, 0).setName('title-settings-root').setDepth(20).setVisible(false);
    this.statusText = this.add
      .text(480, 515, '', { fontFamily: COZY_THEME.font, fontSize: '12px', color: '#ffe0ac', align: 'center', wordWrap: { width: 850 } })
      .setOrigin(0.5).setDepth(30).setName('title-status');

    this.confirmRoot = this.buildConfirmOverlay();
    this.originRoot = this.add.container(0, 0).setName('origin-intro-root').setDepth(110).setVisible(false);
    this.originChoiceRoot = this.add.container(0, 0).setName('origin-choice-root').setDepth(111).setVisible(false);
    this.refreshCards();
    this.refreshMain();
    this.bindKeyboard();
  }

  /** Explain malformed preferences and require a deliberate reset before rendering preference-dependent UI. */
  private showSettingsRecovery(message: string): void {
    const root = this.add.container(0, 0).setName('title-settings-error-root');
    root.add(createScreenShade(this, 0x17292e, 1));
    root.add(this.add.rectangle(480, 268, 610, 278, 0x273831).setStrokeStyle(3, 0x9a8259));
    root.add(this.add.text(480, 183, 'SETTINGS NEED ATTENTION', {
      fontFamily: 'monospace', fontStyle: 'bold', fontSize: '22px', color: '#f3d796',
    }).setOrigin(0.5));
    root.add(this.add.text(480, 241, message, {
      fontFamily: 'monospace', fontSize: '13px', color: '#f4bca0', align: 'center', wordWrap: { width: 530 },
    }).setOrigin(0.5));
    root.add(this.add.text(480, 290, 'Reset only sound and motion preferences.\nYour saved games will not change.', {
      fontFamily: 'monospace', fontSize: '13px', color: '#d4dfc6', align: 'center', lineSpacing: 6,
    }).setOrigin(0.5));
    this.statusText = this.add.text(480, 435, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#f4bca0', align: 'center', wordWrap: { width: 650 },
    }).setOrigin(0.5).setName('title-status');
    /** Reset the exact settings key only after explicit input, then rebuild this non-world title scene. */
    const reset = (): void => {
      SettingsSystem.reset();
      this.scene.restart();
    };
    root.add(this.menuButton(480, 355, 'Reset Settings', 'reset-settings', true, reset));
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('MainMenuScene: keyboard input unavailable');
    keyboard.addCapture(['ENTER']);
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (this.consumeKeyboardEvent(event)) this.perform(reset);
    });
  }

  /** Paint the title screen: the authored painting, live lantern glows, the keyboard hint and the real version. */
  private drawBackdrop(): void {
    createScreenShade(this, LETTERBOX_COLOR, 1);
    this.smoothArt(TextureKey.TitleScreen, TextureKey.TitleButton, TextureKey.TitleButtonSelected,
      TextureKey.PapersLetter, TextureKey.PapersDeparture, TextureKey.PapersChoice);
    this.add.image(0, 0, TextureKey.TitleScreen).setOrigin(0).setDisplaySize(UI_W, UI_H);
    ensureGradient(this, LANTERN_GLOW_KEY, 0xffb760);
    this.lanternGlows = TITLE_LANTERNS.map(lantern => {
      const at = artBox(lantern.x, lantern.y, lantern.x, lantern.y);
      return this.add.image(at.x, at.y, LANTERN_GLOW_KEY).setDisplaySize(lantern.size, lantern.size)
        .setBlendMode(Phaser.BlendModes.ADD);
    });
    this.add.text(TITLE_VERSION.x, TITLE_VERSION.y, `v${GAME_VERSION}`, {
      fontFamily: 'monospace', fontSize: '11px', color: '#d8cdb0',
    }).setOrigin(0.5).setName('title-version');
    this.refreshMotion();
  }

  /**
   * Switch the painted screens to smooth (LINEAR) scaling.
   * why: the game config sets pixelArt, so textures default to nearest-neighbor. These paintings are 1672 px wide
   * and drawn at whatever size the window needs; nearest-neighbor at a non-whole scale would make uneven pixels.
   * @param keys texture keys loaded from the manifest; a missing key fails loudly
   */
  private smoothArt(...keys: TextureKey[]): void {
    for (const key of keys) {
      if (!this.textures.exists(key)) throw new Error(`MainMenuScene: title art ${key} is not loaded`);
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
  }

  /** Apply the real saved motion choice to the lantern flicker immediately (steady glow when motion is reduced). */
  private refreshMotion(): void {
    this.lanternGlows.forEach((glow, index) => {
      this.tweens.killTweensOf(glow);
      glow.setAlpha(0.5);
      if (!prefersReducedMotion()) {
        this.tweens.add({ targets: glow, alpha: 0.28, duration: 1300 + index * 370, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      }
    });
  }

  /** Create a conventional pixel-edged game button with visible pointer and keyboard selection. */
  private menuButton(x: number, y: number, label: string, id: string, selected: boolean, action: () => void, width = 286): Phaser.GameObjects.Container {
    const root = this.add.container(x, y).setName(`title-${id}`);
    const frame = this.add.rectangle(0, 0, width, 38, selected ? 0x856244 : 0x493c30).setStrokeStyle(2, selected ? 0xe5c17c : 0x8e7752).setInteractive({ useHandCursor: true });
    root.add(this.add.rectangle(3, 4, width, 38, 0x0c1917, 0.8));
    root.add(frame);
    root.add(this.add.rectangle(0, -15, width - 8, 2, selected ? 0xc9a265 : 0x6a5540));
    root.add(this.add.text(0, 0, label, { fontFamily: COZY_THEME.font, fontSize: '18px', fontStyle: 'bold', color: '#fff1ce' }).setOrigin(0.5));
    if (selected) root.add(this.add.text(-width / 2 + 17, -1, '›', { fontFamily: 'monospace', fontSize: '22px', color: '#ffe3a3' }).setOrigin(0.5));
    frame.on('pointerover', () => frame.setFillStyle(0x856244));
    frame.on('pointerout', () => frame.setFillStyle(selected ? 0x856244 : 0x493c30));
    frame.on('pointerdown', () => this.perform(action));
    return root;
  }

  /** Surface storage/validation errors in the current menu instead of losing or replacing progress. */
  private perform(action: () => void): void {
    try { action(); }
    catch (error) { this.statusText.setText(error instanceof Error ? error.message : String(error)); }
  }

  /**
   * Rebuild the four painted menu buttons. Continue reads the latest valid timestamp and keeps damaged saves
   * under Load Game. With no valid save, Continue is drawn disabled so the painting's fourth button is always
   * covered by a live one; keyboard and pointer skip it.
   */
  private refreshMain(): void {
    this.mainRoot.removeAll(true);
    const valid = SaveSystem.listSlots().filter((slot): slot is Extract<SaveSlotInfo, { status: 'ready' }> => slot.status === 'ready')
      .sort((a, b) => b.savedAt - a.savedAt || a.slot - b.slot);
    const latest = valid.length > 0 ? valid[0] : null;
    this.mainActions = [
      { id: 'continue', label: 'Continue', run: latest === null ? null : () => {
        this.selectedIndex = latest.slot - 1;
        this.activateSelected();
      } },
      { id: 'new-game', label: 'New Game', run: () => this.startNew() },
      { id: 'load-game', label: 'Load Game', run: () => this.showPage('load') },
      { id: 'settings', label: 'Settings', run: () => this.showPage('settings') },
    ];
    if (this.mainActions.length !== TITLE_SLOTS.length) throw new Error('MainMenuScene: every painted menu button needs one action');
    // why: a save may have been deleted under Load Game since the last visit, disabling the remembered entry.
    if (this.mainActions[this.mainIndex].run === null) this.mainIndex = this.mainActions.findIndex(action => action.run !== null);
    this.mainButtons = this.mainActions.map((action, index) => this.titleButton(index, action));
    this.selectMain(this.mainIndex);
    this.mainRoot.add(this.add.text(TITLE_HINT.x, TITLE_HINT.y, '↑ ↓ Choose    Enter Select', {
      fontFamily: COZY_THEME.font, fontSize: '14px', color: '#efe3c2',
    }).setOrigin(0.5).setShadow(0, 1, '#120c08', 2, false, true));
  }

  /**
   * Draw one live menu button exactly over painted button `index`: the cut button skin plus a live label.
   * The container sits at x 480 (the menu's center line) and the skin is nudged by under a pixel onto the
   * painted button's measured center, so no painted edge peeks out.
   * @param index painted slot, 0 (top) to 3
   * @param action the entry to show; a null `run` draws it dimmed and not clickable
   * @returns the skin and enabled flag, for selectMain
   */
  private titleButton(index: number, action: MainAction): MainButton {
    const slot = TITLE_SLOTS[index];
    const enabled = action.run !== null;
    const root = this.add.container(UI_W / 2, slot.y).setName(enabled ? `title-${action.id}` : `title-${action.id}-disabled`);
    const skin = this.add.image(slot.x - UI_W / 2, 0, TextureKey.TitleButton).setDisplaySize(slot.width, slot.height);
    root.add(skin);
    if (!enabled) {
      // why: an opaque shade (not alpha on the skin) keeps the painted button under it hidden on every renderer.
      root.add(this.add.rectangle(skin.x, 0, slot.width - 8, slot.height - 8, 0x120c08, 0.42));
    }
    root.add(this.add.text(skin.x, -1, action.label, {
      fontFamily: COZY_THEME.titleFont, fontSize: '18px', fontStyle: 'bold', color: enabled ? '#f8e9c6' : '#8f8370',
    }).setOrigin(0.5).setShadow(0, 2, '#1d120a', 0, false, true));
    this.mainRoot.add(root);
    const run = action.run;
    if (run !== null) {
      skin.setInteractive({ useHandCursor: true });
      skin.on('pointerover', () => this.selectMain(index));
      skin.on('pointerdown', () => {
        this.selectMain(index);
        this.perform(run);
      });
    }
    return { skin, enabled };
  }

  /**
   * Mark one enabled main-menu entry as selected by swapping button skins in place.
   * why: pointerover calls this, so it must not destroy and rebuild the button under the pointer.
   * @param index entry to select; must be enabled
   */
  private selectMain(index: number): void {
    if (!this.mainButtons[index].enabled) throw new Error(`MainMenuScene: menu entry ${index} is disabled`);
    this.mainIndex = index;
    this.mainButtons.forEach((button, i) => {
      if (button.enabled) button.skin.setTexture(i === index ? TextureKey.TitleButtonSelected : TextureKey.TitleButton);
    });
  }

  /**
   * Move the main-menu selection up or down, wrapping and skipping disabled entries.
   * @param direction -1 for up, 1 for down
   */
  private stepMain(direction: -1 | 1): void {
    const count = this.mainActions.length;
    let next = this.mainIndex;
    // New Game is always enabled, so this loop always stops.
    do next = (next + direction + count) % count; while (this.mainActions[next].run === null);
    this.selectMain(next);
  }

  /** Start only in an explicitly empty slot; a full list requires deliberate deletion under Load. */
  private startNew(): void {
    const empty = SaveSystem.listSlots().find(slot => slot.status === 'empty');
    if (!empty) {
      this.showPage('load');
      this.statusText.setText('All saves are occupied. Choose a save and Delete it before starting a new game.');
      return;
    }
    this.selectedIndex = empty.slot - 1;
    this.openOriginIntro(empty.slot);
  }

  /** Change the active page without allowing invisible save buttons to intercept input. */
  private showPage(page: 'main' | 'load' | 'settings'): void {
    this.page = page;
    this.mainRoot.setVisible(page === 'main');
    this.loadRoot.setVisible(page === 'load');
    this.settingsRoot.setVisible(page === 'settings');
    this.statusText.setText('');
    if (page === 'main') this.refreshMain();
    if (page === 'load') this.refreshCards();
    if (page === 'settings') { this.settingsIndex = 0; this.refreshSettings(); }
  }

  /** Rebuild the two real preferences and a Back button; there are no placeholder settings. */
  private refreshSettings(): void {
    const settings = SettingsSystem.get();
    this.settingsRoot.removeAll(true);
    this.settingsRoot.add(createScreenShade(this, 0x101f24, 0.94).setInteractive());
    this.settingsRoot.add(this.add.rectangle(480, 278, 540, 330, 0x273831).setStrokeStyle(3, 0x9a8259));
    this.settingsRoot.add(this.add.text(480, 152, 'SETTINGS', { fontFamily: 'monospace', fontSize: '28px', fontStyle: 'bold', color: '#f3d796' }).setOrigin(0.5));
    this.settingsRoot.add(this.menuButton(480, 224, `Sound Volume  ${Math.round(settings.soundVolume * 100)}%`, 'sound-volume', this.settingsIndex === 0, () => this.changeSetting('soundVolume', settings.soundVolume >= 1 ? 0 : Math.min(1, Math.round((settings.soundVolume + 0.1) * 10) / 10)), 350));
    this.settingsRoot.add(this.menuButton(275, 224, '−', 'sound-less', false, () => this.changeSetting('soundVolume', Math.max(0, Math.round((settings.soundVolume - 0.1) * 10) / 10)), 38));
    this.settingsRoot.add(this.menuButton(685, 224, '+', 'sound-more', false, () => this.changeSetting('soundVolume', Math.min(1, Math.round((settings.soundVolume + 0.1) * 10) / 10)), 38));
    this.settingsRoot.add(this.menuButton(480, 288, `Reduced Motion  ${settings.reducedMotion ? 'On' : 'Off'}`, 'reduced-motion', this.settingsIndex === 1, () => this.changeSetting('reducedMotion', !settings.reducedMotion), 350));
    this.settingsRoot.add(this.add.text(480, 331, 'Stops decorative menu animation.\nSound and motion choices save on this browser.', { fontFamily: 'monospace', fontSize: '11px', align: 'center', color: '#b6c3a9', lineSpacing: 5 }).setOrigin(0.5));
    this.settingsRoot.add(this.menuButton(480, 392, 'Back', 'settings-back', this.settingsIndex === 2, () => this.showPage('main'), 190));
  }

  /** Apply one validated setting and refresh both the control and live decorative motion. */
  private changeSetting<Key extends keyof GameSettings>(key: Key, value: GameSettings[Key]): void {
    SettingsSystem.update({ [key]: value });
    this.refreshMotion();
    this.refreshSettings();
    Sfx.play('select');
  }

  /** Adjust the selected preference using keyboard arrows or explicit sound +/- targets. */
  private adjustSetting(direction: -1 | 1): void {
    const settings = SettingsSystem.get();
    if (this.settingsIndex === 1) this.changeSetting('reducedMotion', !settings.reducedMotion);
    else this.changeSetting('soundVolume', Math.max(0, Math.min(1, Math.round((settings.soundVolume + direction * 0.1) * 10) / 10)));
  }

  /** Rebuild the three cards from authoritative SaveSystem inspection. */
  private refreshCards(): void {
    this.cardsRoot.removeAll(true);
    const slots = SaveSystem.listSlots();
    for (let index = 0; index < slots.length; index++) {
      this.cardsRoot.add(this.buildCard(slots[index], index));
    }
    this.statusText.setText('');
  }

  /** Build one selected/unselected empty, ready, or corrupt slot card. */
  private buildCard(info: SaveSlotInfo, index: number): Phaser.GameObjects.Container {
    const selected = index === this.selectedIndex;
    const x = CARD_X[index];
    // Selection gently raises a pocket; the generous whole-card target remains easy to choose.
    const root = this.add.container(x, CARD_Y + (selected ? -7 : 0)).setName(`save-slot-${info.slot}`);
    const shadow = cozyPanel(this, 0, 6, CARD_W, CARD_H, COZY_THEME.shadow, 24).setAlpha(0.12);
    const frame = cozyPanel(this, 0, 0, CARD_W, CARD_H, COZY_THEME.paper, 24)
      .setStrokeStyle(selected ? 3 : 1, selected ? COZY_THEME.green : COZY_THEME.border);
    const paper = cozyPanel(this, 0, 1, CARD_W - 12, CARD_H - 12, COZY_THEME.paper, 20);
    const tab = cozyPanel(this, 0, -CARD_H / 2, 86, 26, selected ? COZY_THEME.green : 0xe0e6ce, 13);
    root.add([shadow, frame, paper, tab]);

    if (selected) {
      root.add(this.add.circle(-CARD_W / 2 + 18, -CARD_H / 2 + 20, 4, COZY_THEME.green));
    }
    root.add(
      this.add
        .text(0, -CARD_H / 2, `SAVE ${info.slot}`, {
          fontFamily: COZY_THEME.font,
          fontStyle: 'bold',
          fontSize: '14px',
          color: selected ? '#fff9e9' : COZY_THEME.muted,
        })
        .setOrigin(0.5)
    );

    if (info.status === 'empty') {
      root.add(this.add.text(0, -31, '+', { fontFamily: 'Georgia, serif', fontSize: '44px', color: '#4e8050' }).setOrigin(0.5));
      root.add(this.add.text(0, 15, 'New Adventure', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '21px', color: '#3c3429' }).setOrigin(0.5));
      root.add(this.add.text(0, 45, 'A warm hearth. A fresh start.', { align: 'center', fontFamily: COZY_THEME.font, fontSize: '12px', color: '#78654d' }).setOrigin(0.5));
      root.add(this.actionPill('BEGIN', 74, 0x4f7d50));
    } else if (info.status === 'ready') {
      const season = info.season.toUpperCase();
      root.add(this.add.text(0, -44, `${season}  ${dayOfSeason(info.day)}`, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '19px', color: '#3f5636' }).setOrigin(0.5));
      root.add(this.add.text(0, -12, `Day ${info.day}  •  ${info.gold.toLocaleString()}g`, { fontFamily: COZY_THEME.font, fontSize: '14px', color: '#5b4734' }).setOrigin(0.5));
      root.add(this.add.text(0, 17, locationLabel(info.activeScene), { fontFamily: 'Georgia, serif', fontSize: '16px', color: '#4b382b' }).setOrigin(0.5));
      root.add(this.add.text(0, 43, savedLabel(info.savedAt), { fontFamily: COZY_THEME.font, fontSize: '10px', color: '#89755c' }).setOrigin(0.5));
      root.add(this.actionPill('CONTINUE', 74, 0x4f7d50));
      const remove = this.add
        .text(105, -88, '×', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '20px', color: '#9d4e3d' })
        .setOrigin(0.5);
      // Touch: the × glyph is about 12×20 px. Pad the invisible hit box 14 px sideways and 10 px
      // up/down so a thumb can reach it; the card's other controls are far below.
      remove.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-14, -10, remove.width + 28, remove.height + 20),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
      remove.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.openDelete(info.slot);
      });
      root.add(remove);
    } else {
      root.add(this.add.text(0, -35, '!', { fontFamily: 'Georgia, serif', fontSize: '39px', color: '#a24f3b' }).setOrigin(0.5));
      root.add(this.add.text(0, 5, 'Damaged Save', { fontFamily: 'Georgia, serif', fontSize: '20px', color: '#74382f' }).setOrigin(0.5));
      root.add(this.add.text(0, 38, 'This file cannot be loaded safely.', { fontFamily: COZY_THEME.font, fontSize: '10px', color: '#786054' }).setOrigin(0.5));
      root.add(this.actionPill('DELETE TO REUSE', 74, 0x9b5943));
    }

    frame.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      this.selectedIndex = index;
      this.refreshCards();
      this.activateSelected();
    });
    return root;
  }

  /** Create a small high-contrast primary-action label within a card. */
  private actionPill(label: string, y: number, color: number): Phaser.GameObjects.Container {
    const pill = this.add.container(0, y);
    pill.add(cozyPanel(this, 0, 0, 164, 32, color, 16));
    pill.add(this.add.text(0, 0, label, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '12px', color: '#fff4d0' }).setOrigin(0.5));
    return pill;
  }

  /** Start or load the currently selected slot. Corrupt slots route to delete confirmation. */
  private activateSelected(): void {
    Sfx.play('select');
    const info = SaveSystem.listSlots()[this.selectedIndex];
    try {
      if (info.status === 'empty') {
        this.openOriginIntro(info.slot);
      } else if (info.status === 'ready') {
        SaveSystem.load(info.slot);
        // Migration details remain available to diagnostics, but loading never blocks the player.
        SaveSystem.consumeMigrationNotice();
        const gs = GameState.instance;
        enterWorldFromMenu(this, gs.activeScene, { ...gs.player });
      } else {
        this.openDelete(info.slot);
      }
    } catch (error) {
      this.refreshCards();
      this.statusText.setText(error instanceof Error ? error.message : String(error));
    }
  }

  /** Open the inheritance story for an explicitly empty slot without binding or writing it yet. */
  private openOriginIntro(slot: SaveSlot): void {
    const info = SaveSystem.inspectSlot(slot);
    if (info.status !== 'empty') {
      throw new Error(`MainMenuScene: Save ${slot} is no longer empty`);
    }
    this.originSlot = slot;
    this.originPage = 0;
    this.originRoot.setVisible(true);
    this.renderOriginPage();
  }

  /** Close the intro without creating a session or mutating the selected save slot. */
  private closeOriginIntro(): void {
    this.originSlot = null;
    this.originPage = 0;
    this.originRoot.setVisible(false);
    this.originChoiceRoot.setVisible(false);
    this.originRoot.removeAll(true);
    this.originChoiceRoot.removeAll(true);
  }

  /** Advance letter -> departure -> choice, then confirm the only enabled Tavern path. */
  private advanceOriginIntro(): void {
    if (this.originSlot === null) return;
    if (this.originPage < 2) {
      this.originPage = (this.originPage + 1) as 1 | 2;
      this.renderOriginPage();
      return;
    }
    this.confirmTavernOrigin();
  }

  /** Bind the chosen empty slot and enter the existing named Farm start through official systems. */
  private confirmTavernOrigin(): void {
    const slot = this.originSlot;
    if (slot === null) return;
    try {
      if (SaveSystem.inspectSlot(slot).status !== 'empty') {
        throw new Error(`MainMenuScene: Save ${slot} is no longer empty`);
      }
      this.closeOriginIntro();
      SaveSystem.beginNewGame(slot);
      enterWorldFromMenu(this, SceneKey.Farm, null);
    } catch (error) {
      this.closeOriginIntro();
      this.refreshCards();
      this.statusText.setText(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Rebuild one of the three painted Willowbrook Papers pages: the page painting, the live header with the real
   * save number, and invisible hit areas over the painted buttons (continue on pages 1-2, business cards on 3).
   */
  private renderOriginPage(): void {
    this.originRoot.removeAll(true);
    this.originChoiceRoot.removeAll(true);
    this.originChoiceRoot.setVisible(false);
    if (this.originSlot === null) throw new Error('MainMenuScene: origin page drawn without a chosen save');

    // The interactive shade blocks the title buttons underneath and fills any letterbox space.
    this.originRoot.add(createScreenShade(this, LETTERBOX_COLOR, 1).setInteractive());
    const page = PAPERS_PAGES[this.originPage];
    this.originRoot.add(this.add.image(0, 0, page.texture).setOrigin(0).setDisplaySize(UI_W, UI_H));
    this.originRoot.add(this.add.text(page.header.x - page.header.width / 2, page.header.y, `THE WILLOWBROOK PAPERS  •  SAVE ${this.originSlot}`, {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '11px', color: '#e2c27c', letterSpacing: 1.5,
    }).setOrigin(0, 0.5).setName('origin-header'));

    if (this.originPage === 2) this.drawBusinessChoice();
    else this.originRoot.add(this.originHotspot('origin-continue', PAPERS_CONTINUE[this.originPage], () => this.advanceOriginIntro()));
  }

  /**
   * Final page: the painting already shows both cards. Only the Tavern & Inn card is clickable; the Item Shop card
   * is painted "coming soon" and its named container stays non-interactive so pointer input falls to the shade.
   */
  private drawBusinessChoice(): void {
    this.originChoiceRoot.setVisible(true);
    this.originChoiceRoot.add(this.originHotspot('origin-tavern-card', PAPERS_TAVERN_CARD, () => this.confirmTavernOrigin()));
    this.originChoiceRoot.add(this.add.container(PAPERS_ITEM_SHOP_CARD.x, PAPERS_ITEM_SHOP_CARD.y).setName('origin-item-shop-card'));
  }

  /**
   * Make a painted button clickable: an invisible hit area with a soft warm highlight while the pointer is over it.
   * @param name container name (tests and pointer ownership look it up)
   * @param box the painted button's logical box
   * @param action what a click does
   * @returns the container, centered on the box
   */
  private originHotspot(name: string, box: UiBox, action: () => void): Phaser.GameObjects.Container {
    const root = this.add.container(box.x, box.y).setName(name);
    const highlight = this.add.rectangle(0, 0, box.width, box.height, 0xffe2a0, 0).setBlendMode(Phaser.BlendModes.ADD);
    const zone = this.add.zone(0, 0, box.width, box.height).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => highlight.setFillStyle(0xffe2a0, 0.12));
    zone.on('pointerout', () => highlight.setFillStyle(0xffe2a0, 0));
    zone.on('pointerdown', action);
    root.add([highlight, zone]);
    return root;
  }

  /** Show the destructive confirmation with Cancel selected by default. */
  private openDelete(slot: SaveSlot): void {
    this.confirmSlot = slot;
    this.confirmChoice = 0;
    this.confirmTabText.setText(`SAVE ${slot}`);
    this.confirmRoot.setVisible(true);
    this.refreshConfirm();
  }

  /** Build the modal deletion card once; labels are refreshed as selection changes. */
  private buildConfirmOverlay(): Phaser.GameObjects.Container {
    const root = this.add.container(0, 0).setDepth(100).setVisible(false);
    root.add(createScreenShade(this, COZY_THEME.shadow, 0.62).setInteractive());
    root.add(cozyPanel(this, 480, 280, 470, 208, COZY_THEME.shadow).setAlpha(0.18));
    root.add(cozyPanel(this, 480, 274, 470, 208).setInteractive());
    root.add(cozyPanel(this, 480, 170, 104, 29, COZY_THEME.green, 14));
    this.confirmTabText = this.add
      .text(480, 170, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '12px', color: '#fff0bd' })
      .setOrigin(0.5);
    root.add(this.confirmTabText);
    root.add(this.add.text(480, 218, 'Remove this adventure?', { fontFamily: 'Georgia, serif', fontSize: '26px', color: '#56392d' }).setOrigin(0.5));
    root.add(this.add.text(480, 258, 'This cannot be undone.', { fontFamily: COZY_THEME.font, fontSize: '13px', color: '#8d4b3d' }).setOrigin(0.5));
    return root;
  }

  /** Redraw the two confirmation choices and their pointer handlers. */
  private refreshConfirm(): void {
    // Seven objects form the permanent modal (scrim, ledger frame/tab, title, safety warning).
    while (this.confirmRoot.length > 7) this.confirmRoot.removeAt(7, true);
    const choices = [
      { label: 'KEEP IT', x: 385, color: 0x537a50 },
      { label: 'DELETE', x: 575, color: 0x985340 },
    ] as const;
    choices.forEach((choice, index) => {
      const selected = this.confirmChoice === index;
      const button = cozyPanel(this, choice.x, 321, 150, 42, choice.color, 18)
        .setStrokeStyle(selected ? 3 : undefined, COZY_THEME.yellow)
        .setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => {
        this.confirmChoice = index as 0 | 1;
        this.confirmSelection();
      });
      this.confirmRoot.add(button);
      this.confirmRoot.add(this.add.text(choice.x, 321, choice.label, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '13px', color: '#fff1cc' }).setOrigin(0.5));
    });
  }

  /** Resolve the current confirmation selection. */
  private confirmSelection(): void {
    if (this.confirmChoice === 1 && this.confirmSlot !== null) SaveSystem.delete(this.confirmSlot);
    this.confirmSlot = null;
    this.confirmRoot.setVisible(false);
    this.refreshCards();
  }

  /** Bind title-screen keyboard navigation; handlers live only for this scene lifecycle. */
  private bindKeyboard(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('MainMenuScene: keyboard input unavailable');
    keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'ESC', 'DELETE']);
    for (const [key, direction] of [['UP', -1], ['DOWN', 1]] as const) {
      keyboard.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (!this.consumeKeyboardEvent(event) || this.originSlot !== null || this.confirmSlot !== null) return;
        if (this.page === 'main') {
          this.stepMain(direction);
        } else if (this.page === 'settings') {
          this.settingsIndex = (this.settingsIndex + direction + 3) % 3;
          this.perform(() => this.refreshSettings());
        }
      });
    }
    keyboard.on('keydown-LEFT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return; // Tavern is the only enabled origin choice.
      if (this.confirmSlot !== null) {
        this.confirmChoice = 0;
        this.refreshConfirm();
      } else if (this.page === 'load') {
        this.selectedIndex = (this.selectedIndex + 2) % 3;
        this.refreshCards();
      } else if (this.page === 'settings' && this.settingsIndex < 2) {
        this.perform(() => this.adjustSetting(-1));
      }
    });
    keyboard.on('keydown-RIGHT', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return; // Item Shop remains visibly disabled.
      if (this.confirmSlot !== null) {
        this.confirmChoice = 1;
        this.refreshConfirm();
      } else if (this.page === 'load') {
        this.selectedIndex = (this.selectedIndex + 1) % 3;
        this.refreshCards();
      } else if (this.page === 'settings' && this.settingsIndex < 2) {
        this.perform(() => this.adjustSetting(1));
      }
    });
    keyboard.on('keydown-ENTER', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) this.advanceOriginIntro();
      else if (this.confirmSlot !== null) this.confirmSelection();
      else if (this.page === 'load') this.activateSelected();
      else if (this.page === 'main') {
        const run = this.mainActions[this.mainIndex].run;
        if (run === null) throw new Error('MainMenuScene: a disabled menu entry is selected');
        this.perform(run);
      }
      else if (this.settingsIndex === 2) this.showPage('main');
      else this.perform(() => this.adjustSetting(1));
    });
    keyboard.on('keydown-DELETE', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) return;
      if (this.confirmSlot !== null) return;
      if (this.page !== 'load') return;
      const info = SaveSystem.listSlots()[this.selectedIndex];
      if (info.status !== 'empty') this.openDelete(info.slot);
    });
    keyboard.on('keydown-ESC', (event: KeyboardEvent) => {
      if (!this.consumeKeyboardEvent(event)) return;
      if (this.originSlot !== null) {
        this.closeOriginIntro();
        return;
      }
      if (this.confirmSlot === null) {
        if (this.page !== 'main') this.showPage('main');
        return;
      }
      this.confirmSlot = null;
      this.confirmRoot.setVisible(false);
    });
  }

  /** Consume a physical keyboard event once while keeping distinct rapid presses responsive. */
  private consumeKeyboardEvent(event: KeyboardEvent): boolean {
    if (this.keyboardEvents.has(event)) return false;
    this.keyboardEvents.add(event);
    return true;
  }
}
