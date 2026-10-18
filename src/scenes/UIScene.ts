/**
 * UIScene — the parallel overlay: hotbar (icons, clickable, wheel-cyclable), stamina bar, clock,
 * Stardew-style slot-grid inventory (I/Tab), a two-grid chest transfer panel (click a stack to move
 * it), modal dialogue box (for the TV forecast), floating pickup toasts, and a controls hint.
 * Reads GameState each frame
 * and redraws; it holds no game logic. Panel clicks stopPropagation so they never swing the tool.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { CHAT_OFFERS } from '../config/ResidentChatOffers';
import { GameState } from '../state/GameState';
import { InputBus } from '../input/InputBus';
import { ITEM_CATALOG, ToolId } from '../config/Items';
import { dayOfSeason } from '../config/Crops';
import { STAMINA_MAX, WATER_CAN_CAPACITY } from '../config/GameConfig';
import { ToolSystem } from '../systems/ToolSystem';
import { TRACK, ZONE_H } from '../systems/FishingSystem';
import { Sfx } from '../systems/SfxSystem';
import { TOOLBELT_CAPACITY } from '../systems/InventoryLayoutSystem';
import { DevTuningSystem } from '../systems/DevTuningSystem';
import { isTestMode } from '../debug/RuntimeMode';
import { mapEditorEnabled, mapEditorMode, mapEditorUrl } from '../debug/MapEditorMode';
import { InventoryUI, INVENTORY_THEME } from '../ui/InventoryUI';
import { PauseMenu } from '../ui/PauseMenu';
import { TavernUI } from '../ui/TavernUI';
import { StorageUI } from '../ui/StorageUI';
import { CraftingUI } from '../ui/CraftingUI';
import { AppearanceUI } from '../ui/AppearanceUI';
import { RelationshipUI } from '../ui/RelationshipUI';
import { GuestServicePrompt } from '../ui/GuestServicePrompt';
import { UI_WIDTH, UI_HEIGHT, installUiCamera } from '../ui/UILayout';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { backspaceResidentChat, confirmResidentAction, confirmResidentDialogueChoice, continueResidentChat,
  confirmResidentOffer, confirmResidentCuddleOffer, cycleResidentAction, residentOfferVisible, selectResidentOfferChoice, cycleResidentDialogueChoice, residentCuddleChoicesVisible,
  selectResidentDialogueChoice, selectResidentCuddleChoice, sendResidentChat, setResidentChatDraft, typeResidentChat } from '../systems/ResidentDialogueSystem';
import { pressWayfarerTableButton, sendWayfarerTableLine, setWayfarerTableDraft, wayfarerTableTyping, wayfarerTableView } from '../systems/WayfarerTableSystem';
import { TouchTextEntry, type TouchTextTarget } from '../ui/TouchTextEntry';
import { MAX_MESSAGE_LENGTH } from '../systems/LocalNpcChatSystem';
import type { ResidentDialogueChoice } from '../state/GameState';
import { COZY_THEME, cozyPanel } from '../ui/CozyTheme';
import { MarketUI } from '../ui/MarketUI';
import { CivicServiceUI } from '../ui/CivicServiceUI';
import { WayfarerTableUI } from '../ui/WayfarerTableUI';
import { WorldRoutesUI } from '../ui/WorldRoutesUI';
import { TouchControls } from '../input/TouchControls';
import { VitalityHud } from '../ui/VitalityHud';
import { isTouchMode } from '../input/TouchMode';

/** Phaser may surface one native key through overlapping scene plugins; dialogue consumes it once. */
const residentDialogueKeyboardEvents = new WeakSet<KeyboardEvent>();
/** First-screen choices in row order, with the button center x and label. Only offered choices are drawn. */
const DIALOGUE_CHOICES: readonly { choice: ResidentDialogueChoice; x: number; label: string }[] = [
  { choice: 'talk', x: 306, label: 'TALK' }, { choice: 'chat', x: 462, label: 'CHAT' },
  { choice: 'together', x: 618, label: 'TOGETHER' }, { choice: 'table', x: 774, label: 'JOIN TABLE' },
];
/** Together-menu grid: columns, slot centers, and size. Plans and the menu both fit in eight slots. */
const ACTION_COLUMNS = 4;
const ACTION_X = [300, 452, 604, 756] as const;
const ACTION_Y = [150, 192] as const;
const ACTION_SLOTS = ACTION_X.length * ACTION_Y.length;
/** Top of the left HUD column's stacked rows (mana, then the task strip), just below the water meter's slot. */
const LEFT_COLUMN_TOP = 88;

/** Parallel HUD and menu owner; creates controls per scene lifecycle and reads current state each frame. */
export class UIScene extends Phaser.Scene {
  private inventoryUI!: InventoryUI;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private staminaText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private chestUI!: StorageUI;
  private shippingUI!: StorageUI;
  private craftingUI!: CraftingUI;
  private dialogueBox!: Phaser.GameObjects.Container;
  private dialogueName!: Phaser.GameObjects.Text;
  private dialogueLine!: Phaser.GameObjects.Text;
  private dialoguePlayerLine!: Phaser.GameObjects.Text;
  private dialogueHint!: Phaser.GameObjects.Text;
  private dialoguePortrait!: Phaser.GameObjects.Sprite;
  private dialoguePortraitMat!: Phaser.GameObjects.Rectangle;
  /** The lighter paper pocket behind the speech text; it follows the text column (beside or without a portrait). */
  private dialogueContentPanel!: Phaser.GameObjects.Rectangle;
  /** One button and label per first-screen choice, in DIALOGUE_CHOICES order. */
  private dialogueChoiceButtons: { choice: ResidentDialogueChoice; button: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  /** Together-menu buttons (ACTION_SLOTS of them); hidden outside the 'resident-actions' dialogue. */
  private dialogueOptionButtons: { button: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }[] = [];
  private dialogueMemory!: Phaser.GameObjects.Text;
  private dialogueCuddleBedroom!: Phaser.GameObjects.Rectangle;
  private dialogueCuddleStanding!: Phaser.GameObjects.Rectangle;
  private dialogueCuddleBedroomLabel!: Phaser.GameObjects.Text;
  private dialogueCuddleStandingLabel!: Phaser.GameObjects.Text;
  /** Accept / "Not now" buttons for a resident's real chat offer (ResidentOfferSystem), same row as Cuddle. */
  private dialogueOfferAccept!: Phaser.GameObjects.Rectangle;
  private dialogueOfferDecline!: Phaser.GameObjects.Rectangle;
  private dialogueOfferAcceptLabel!: Phaser.GameObjects.Text;
  private dialogueOfferDeclineLabel!: Phaser.GameObjects.Text;
  private toastCount = 0;
  private pauseMenu!: PauseMenu;
  private tavernUI!: TavernUI;
  private marketUI!: MarketUI;
  private civicServiceUI!: CivicServiceUI;
  private wayfarerTableUI!: WayfarerTableUI;
  /** HTML text box for typing on a touch screen (shown only in touch mode while a typing line is open). */
  private touchTextEntry!: TouchTextEntry;
  private appearanceUI!: AppearanceUI;
  private relationshipUI!: RelationshipUI;
  private worldRoutesUI!: WorldRoutesUI;
  private controlsHint!: Phaser.GameObjects.Text;
  private guestServicePrompt!: GuestServicePrompt;
  /** iPad joystick and buttons; hidden until the page sees a touch. */
  private touchControls!: TouchControls;
  /** Food buff chips beside the stamina bar. */
  private vitalityHud!: VitalityHud;

  /** Register the shared UI overlay without changing the active world scene. */
  constructor() {
    super({ key: SceneKey.UI, active: false });
  }

  /** Create scene-owned UI controls and listeners, including the contextual guest reply. */
  create(): void {
    installUiCamera(this);
    this.inventoryUI = new InventoryUI(this);
    this.inventoryUI.create();
    this.buildStamina();
    this.vitalityHud = new VitalityHud(this);
    this.vitalityHud.create();
    this.buildClock();
    this.chestUI = new StorageUI(this, 'chest');
    this.craftingUI = new CraftingUI(this);
    this.shippingUI = new StorageUI(this, 'shipping');
    // Morning sell report container (contents rebuilt per-summary in showDaySummary).
    this.daySummaryPanel = this.add.container(0, 0).setVisible(false).setDepth(14);
    this.buildReelBar();
    this.buildDialogueBox();
    this.bindResidentDialogueKeyboard();
    this.buildHints();
    this.guestServicePrompt = new GuestServicePrompt(this);
    if (isTestMode()) this.buildDevTuningPanel();
    this.appearanceUI = new AppearanceUI(this);
    this.relationshipUI = new RelationshipUI(this);
    this.worldRoutesUI = new WorldRoutesUI(this);
    this.pauseMenu = new PauseMenu(this, (event) => {
      this.pauseMenu.setInputEnabled(false);
      this.appearanceUI.open(event);
    }, (event) => {
      this.pauseMenu.setInputEnabled(false);
      this.relationshipUI.open(event);
    }, (event) => {
      this.pauseMenu.setInputEnabled(false);
      this.worldRoutesUI.open(event);
    });
    this.pauseMenu.create();
    this.tavernUI = new TavernUI(this);
    this.marketUI = new MarketUI(this);
    this.civicServiceUI = new CivicServiceUI(this, () => {
      GameState.instance.paused = true;
      this.pauseMenu.setInputEnabled(false);
      this.appearanceUI.open();
    });
    this.wayfarerTableUI = new WayfarerTableUI(this);
    this.touchTextEntry = new TouchTextEntry();

    this.game.events.on('toast', this.showToast, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('toast', this.showToast, this);
      this.touchTextEntry.destroy();
    });

    // Mouse wheel cycles tools (in addition to digits + clicking slots).
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (GameState.instance.transitionActive || GameState.instance.paused || GameState.instance.tavernPanel ||
        GameState.instance.marketPanelOpen || GameState.instance.craftingOpen) return;
      const dir = dy > 0 ? 1 : -1;
      const next = (GameState.instance.hotbarIndex + dir + TOOLBELT_CAPACITY) % TOOLBELT_CAPACITY;
      ToolSystem.select(next);
      Sfx.play('select');
    });

    // Built last so the on-screen touch controls sit above every panel and receive taps first.
    this.touchControls = new TouchControls(this);
  }

  /** Watering-can meter widgets (visible only while the can is the active tool). */
  private waterLabel!: Phaser.GameObjects.Text;
  private waterBg!: Phaser.GameObjects.Rectangle;
  private waterBar!: Phaser.GameObjects.Rectangle;
  private waterText!: Phaser.GameObjects.Text;

  /** Keep vital labels readable over both cream walls and darker outdoor terrain. */
  private buildStamina(): void {
    this.add.text(12, 10, 'Stamina', { fontSize: '12px', color: '#e8d8b0', backgroundColor: '#302a24', padding: { x: 4, y: 1 } });
    this.add.rectangle(12, 30, 160, 14, 0x000000, 0.4).setOrigin(0, 0);
    this.staminaBar = this.add.rectangle(12, 30, 160, 14, 0x5ad46a, 1).setOrigin(0, 0);
    this.staminaText = this.add
      .text(16, 30, '', { fontSize: '10px', color: '#0a2a10' })
      .setOrigin(0, 0)
      .setDepth(1);

    // Water meter, tucked under the stamina bar. Reads GameState.canWater each frame; shown only
    // when the watering can is equipped so the HUD stays quiet otherwise.
    this.waterLabel = this.add.text(12, 50, 'Water', { fontSize: '12px', color: '#bcd8e8', backgroundColor: '#302a24', padding: { x: 4, y: 1 } });
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
      .text(UI_WIDTH / 2, 7, ' ✿ GROWTH LAB · F10 ', {
        fontFamily: 'monospace', fontStyle: 'bold', fontSize: '12px', color: '#fff8df', backgroundColor: '#315f5c',
      })
      .setOrigin(0.5, 0)
      .setDepth(20)
      .setInteractive({ useHandCursor: true })
      .setName('dev-tuning-toggle');
    this.devToggle = toggle;
    const editorAvailable = mapEditorEnabled() && mapEditorMode() === null;
    const panelHeight = editorAvailable ? 148 : 116;
    const panelShadow = this.add.rectangle(5, 5, 254, panelHeight, 0x2f241d, 0.72).setOrigin(0, 0);
    const panelBg = this.add.rectangle(0, 0, 254, panelHeight, INVENTORY_THEME.canvas, 0.99)
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
      }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true }).setName(name).on('pointerdown', () => {
        if (!GameState.instance.transitionActive) action();
      });
    const clockDown = makeButton(90, 48, '−', 'dev-clock-down', () => DevTuningSystem.cycleClock(-1));
    const clockUp = makeButton(178, 48, '+', 'dev-clock-up', () => DevTuningSystem.cycleClock(1));
    const cropDown = makeButton(90, 76, '−', 'dev-crop-down', () => DevTuningSystem.cycleCrops(-1));
    const cropUp = makeButton(178, 76, '+', 'dev-crop-up', () => DevTuningSystem.cycleCrops(1));
    const step = makeButton(100, 103, '✦ GROW ONE DAY', 'dev-crop-step', () => {
      DevTuningSystem.advanceCropDay();
      this.game.events.emit('dev-crops-advanced');
      Sfx.play('select');
    }, 'coral');
    this.devPanel = this.add.container((UI_WIDTH - 254) / 2, 24, [
      panelShadow, panelBg, header, title, hint, clockLabel, cropLabel, this.devClockValue, this.devCropValue,
      clockDown, clockUp, cropDown, cropUp, step,
    ]).setDepth(19).setVisible(false).setName('dev-tuning-panel');
    if (editorAvailable) {
      this.devPanel.add(makeButton(127, 133, 'MAP EDITOR ↗', 'dev-map-editor', () => {
        // Keep the original adventure still while its separate layout tab owns the user's attention.
        GameState.instance.paused = true;
        InputBus.instance.clearAll();
        window.open(mapEditorUrl('edit'), '_blank', 'noopener');
      }));
    }
    // why: F9 works with the panel closed too, so the overlay can stay on while walking around.
    const toggleWalls = (): void => {
      if (!GameState.instance.transitionActive) this.game.events.emit('dev-walls-toggle');
    };
    this.devPanel.add(makeButton(214, 103, 'WALLS', 'dev-walls-toggle', toggleWalls));
    const togglePanel = (): void => {
      if (GameState.instance.transitionActive || GameState.instance.paused) return;
      if (this.devPanel) this.devPanel.setVisible(!this.devPanel.visible);
    };
    toggle.on('pointerdown', togglePanel);
    this.input.keyboard?.on('keydown-BACKTICK', togglePanel);
    this.input.keyboard?.on('keydown-F10', togglePanel);
    this.input.keyboard?.on('keydown-F9', toggleWalls);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-F9', toggleWalls);
      this.input.keyboard?.off('keydown-BACKTICK', togglePanel);
      this.input.keyboard?.off('keydown-F10', togglePanel);
    });
  }

  /** Anchor compact date and money badges to the upper-right edge with reliable contrast. */
  private buildClock(): void {
    this.clockText = this.add
      .text(UI_WIDTH - 12, 12, '', { fontSize: '14px', color: '#e8d8b0', backgroundColor: '#302a24', padding: { x: 4, y: 1 } })
      .setOrigin(1, 0);
    this.goldText = this.add
      .text(UI_WIDTH - 12, 32, '', { fontSize: '13px', color: '#ffd24a', backgroundColor: '#302a24', padding: { x: 4, y: 1 } })
      .setOrigin(1, 0);
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
    const x = (UI_WIDTH - w) / 2;
    const y = (UI_HEIGHT - h) / 2 - 16;
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
    const x = UI_WIDTH - 64;
    const y = (UI_HEIGHT - H) / 2;
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

  /** Build the wide, portrait-led conversation surface shared by residents and ordinary messages. */
  private buildDialogueBox(): void {
    const w = 880;
    const h = 236;
    const x = (UI_WIDTH - w) / 2;
    const y = UI_HEIGHT - h - 16;
    const shadow = cozyPanel(this, w / 2, h / 2 + 7, w, h, COZY_THEME.shadow, 23).setAlpha(0.36);
    const cover = cozyPanel(this, w / 2, h / 2, w, h, COZY_THEME.leather, 23).setStrokeStyle(2, COZY_THEME.leatherDark);
    const bg = cozyPanel(this, w / 2, h / 2, w - 14, h - 14, COZY_THEME.paper, 18).setStrokeStyle(2, COZY_THEME.border);
    this.dialogueContentPanel = cozyPanel(this, 542, 122, 650, 190, COZY_THEME.pocket, 13).setAlpha(0.68)
      .setStrokeStyle(1, COZY_THEME.border).setName('dialogue-content-panel');
    this.dialoguePortraitMat = cozyPanel(this, 116, 122, 180, 204, COZY_THEME.mint, 38).setAlpha(0.68).setStrokeStyle(2, COZY_THEME.border);
    this.dialoguePortrait = this.add.sprite(116, 121, '__MISSING').setName('dialogue-portrait');
    this.dialogueName = this.add.text(226, 19, '', { fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '24px', color: COZY_THEME.ink })
      .setName('dialogue-name');
    this.dialogueMemory = this.add.text(w - 60, 24, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px',
      color: COZY_THEME.muted }).setOrigin(1, 0).setName('dialogue-memory');
    this.dialoguePlayerLine = this.add.text(226, 55, '', { fontFamily: COZY_THEME.font, fontStyle: 'italic', fontSize: '11px',
      color: '#695a49', lineSpacing: 2, wordWrap: { width: 500, useAdvancedWrap: true } }).setName('dialogue-player-line');
    this.dialogueLine = this.add.text(226, 98, '', {
      fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.ink, lineSpacing: 4,
      wordWrap: { width: 500, useAdvancedWrap: true },
    }).setName('dialogue-line');
    this.dialogueChoiceButtons = DIALOGUE_CHOICES.map(({ choice, x, label }) => {
      const button = cozyPanel(this, x, 178, 140, 38, COZY_THEME.paperDark, 12)
        .setInteractive({ useHandCursor: true }).setName(`dialogue-choice-${choice}`);
      const text = this.add.text(x, 178, label, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px',
        color: COZY_THEME.ink }).setOrigin(0.5).setName(`dialogue-choice-${choice}-label`);
      button.on('pointerdown', () => { selectResidentDialogueChoice(choice); confirmResidentDialogueChoice(); });
      return { choice, button, label: text };
    });
    this.dialogueOptionButtons = Array.from({ length: ACTION_SLOTS }, (_unused, index) => {
      const x = ACTION_X[index % ACTION_COLUMNS], y = ACTION_Y[Math.floor(index / ACTION_COLUMNS)];
      const button = cozyPanel(this, x, y, 140, 34, COZY_THEME.paperDark, 10)
        .setInteractive({ useHandCursor: true }).setName(`dialogue-option-${index}`).setVisible(false);
      const text = this.add.text(x, y, '', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.ink,
        align: 'center', wordWrap: { width: 130, useAdvancedWrap: true } }).setOrigin(0.5).setName(`dialogue-option-label-${index}`)
        .setVisible(false);
      button.on('pointerdown', () => confirmResidentAction(index));
      return { button, label: text };
    });
    this.dialogueCuddleBedroom = cozyPanel(this, 360, 190, 258, 32, COZY_THEME.green, 10)
      .setInteractive({ useHandCursor: true }).setName('dialogue-cuddle-bedroom');
    this.dialogueCuddleStanding = cozyPanel(this, 632, 190, 258, 32, COZY_THEME.paperDark, 10)
      .setInteractive({ useHandCursor: true }).setName('dialogue-cuddle-standing');
    this.dialogueCuddleBedroomLabel = this.add.text(360, 190, 'Should we head to the bedroom?', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.cream,
    }).setOrigin(0.5).setName('dialogue-cuddle-bedroom-label');
    this.dialogueCuddleStandingLabel = this.add.text(632, 190, 'Do it right here', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('dialogue-cuddle-standing-label');
    this.dialogueCuddleBedroom.on('pointerdown', () => void confirmResidentCuddleOffer('bedroom'));
    this.dialogueCuddleStanding.on('pointerdown', () => void confirmResidentCuddleOffer('standing'));
    this.dialogueOfferAccept = cozyPanel(this, 360, 190, 258, 32, COZY_THEME.green, 10)
      .setInteractive({ useHandCursor: true }).setName('dialogue-offer-accept').setVisible(false);
    this.dialogueOfferDecline = cozyPanel(this, 632, 190, 258, 32, COZY_THEME.paperDark, 10)
      .setInteractive({ useHandCursor: true }).setName('dialogue-offer-decline').setVisible(false);
    this.dialogueOfferAcceptLabel = this.add.text(360, 190, '', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.cream,
    }).setOrigin(0.5).setName('dialogue-offer-accept-label').setVisible(false);
    this.dialogueOfferDeclineLabel = this.add.text(632, 190, 'Not now', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '10px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('dialogue-offer-decline-label').setVisible(false);
    this.dialogueOfferAccept.on('pointerdown', () => confirmResidentOffer('accept'));
    this.dialogueOfferDecline.on('pointerdown', () => confirmResidentOffer('decline'));
    this.dialogueHint = this.add
      .text(w - 86, h - 20, '', { fontFamily: COZY_THEME.font, fontSize: '10px', color: COZY_THEME.ink })
      .setOrigin(1, 0.5).setName('dialogue-hint');
    this.dialogueBox = this.add.container(x, y, [shadow, cover, bg, this.dialogueContentPanel, this.dialoguePortraitMat, this.dialoguePortrait,
      this.dialogueName, this.dialogueMemory, this.dialoguePlayerLine, this.dialogueLine,
      ...this.dialogueChoiceButtons.flatMap(entry => [entry.button, entry.label]),
      ...this.dialogueOptionButtons.flatMap(entry => [entry.button, entry.label]), this.dialogueCuddleBedroom,
      this.dialogueCuddleStanding, this.dialogueCuddleBedroomLabel, this.dialogueCuddleStandingLabel,
      this.dialogueOfferAccept, this.dialogueOfferDecline, this.dialogueOfferAcceptLabel, this.dialogueOfferDeclineLabel, this.dialogueHint]);
    this.dialogueBox.setVisible(false).setDepth(20).setName('dialogue-box');
  }

  /**
   * Show or hide the offer row. When shown, the label comes from the authored offer and the
   * highlighted answer is drawn green, like the Cuddle row.
   * @param visible true while ResidentDialogueSystem.residentOfferVisible() is true
   * @throws when shown without an offer in the dialogue (residentOfferVisible guarantees one)
   */
  private showOfferButtons(visible: boolean): void {
    for (const part of [this.dialogueOfferAccept, this.dialogueOfferDecline, this.dialogueOfferAcceptLabel, this.dialogueOfferDeclineLabel]) {
      part.setVisible(visible);
    }
    if (!visible) return;
    const offer = GameState.instance.dialogue?.chatOffer;
    if (!offer) throw new Error('Dialogue: the offer row is shown without an offer');
    const accepting = GameState.instance.dialogue?.offerChoice !== 'decline';
    this.dialogueOfferAcceptLabel.setText(CHAT_OFFERS[offer].label).setColor(accepting ? COZY_THEME.cream : COZY_THEME.ink);
    this.dialogueOfferDeclineLabel.setColor(!accepting ? COZY_THEME.cream : COZY_THEME.ink);
    this.dialogueOfferAccept.setFillStyle(accepting ? COZY_THEME.green : COZY_THEME.paperDark);
    this.dialogueOfferDecline.setFillStyle(!accepting ? COZY_THEME.green : COZY_THEME.paperDark);
  }

  /** Fit a guarded reply into the speech page without clipping its ending. */
  private fitDialogueLine(value: string, maxLines = 6): void {
    for (let size = 12; size >= 9; size--) {
      this.dialogueLine.setFontSize(size).setText(value);
      const lines = this.dialogueLine.getWrappedText(value);
      if (lines.length <= maxLines) {
        // Explicit line breaks avoid renderer-dependent late wrapping at high display density.
        this.dialogueLine.setText(lines);
        return;
      }
    }
    throw new Error('Dialogue text exceeds the supported conversation length.');
  }

  /** Capture only keys owned by the direct resident panel; world movement remains frozen by modal state. */
  private bindResidentDialogueKeyboard(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const handler = (event: KeyboardEvent): void => {
      const dialogue = GameState.instance.dialogue;
      if (!dialogue) return;
      if (residentDialogueKeyboardEvents.has(event)) return;
      residentDialogueKeyboardEvents.add(event);
      if (dialogue.kind === 'wayfarer-table') { this.wayfarerTableUI.handleKey(event); return; }
      if (dialogue.kind === 'resident-choice' || dialogue.kind === 'resident-actions') {
        const cycle = dialogue.kind === 'resident-choice' ? cycleResidentDialogueChoice : cycleResidentAction;
        const confirm = dialogue.kind === 'resident-choice' ? confirmResidentDialogueChoice : () => confirmResidentAction();
        if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
          event.preventDefault(); cycle(1);
        } else if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault(); cycle(-1);
        } else if (dialogue.kind === 'resident-actions' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          // why: the grid has rows of four; Up/Down jump a row only when there is a second row.
          event.preventDefault();
          if (!dialogue.options) throw new Error('Resident actions: the grid has no options');
          if (dialogue.options.length > ACTION_COLUMNS) cycleResidentAction(event.key === 'ArrowDown' ? ACTION_COLUMNS : -ACTION_COLUMNS);
        } else if (event.key === 'Enter') {
          event.preventDefault(); confirm();
        }
        return;
      }
      if (dialogue.kind !== 'resident-chat') return;
      if (residentOfferVisible()) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Tab') {
          event.preventDefault(); selectResidentOfferChoice(dialogue.offerChoice === 'accept' ? 'decline' : 'accept'); return;
        }
        if (event.key === 'Enter') { event.preventDefault(); confirmResidentOffer(); return; }
      }
      if (dialogue.chatPhase === 'reply' && residentCuddleChoicesVisible()) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Tab') {
          event.preventDefault(); selectResidentCuddleChoice(dialogue.cuddleChoice === 'bedroom' ? 'standing' : 'bedroom'); return;
        }
        if (event.key === 'Enter') { event.preventDefault(); void confirmResidentCuddleOffer(); return; }
      }
      if (dialogue.chatPhase === 'reply' && event.key === 'Enter') { event.preventDefault(); continueResidentChat(); return; }
      if (dialogue.chatPhase !== 'input') return;
      if (event.key === 'Enter') { event.preventDefault(); void sendResidentChat(); return; }
      if (event.key === 'Backspace') { event.preventDefault(); backspaceResidentChat(); return; }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); typeResidentChat(event.key);
      }
    };
    keyboard.on('keydown', handler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', handler));
  }

  /**
   * Show one resident's pixel-art figure in the left conversation card, or hide the card.
   * @param residentId the resident speaking, or undefined when nobody named is speaking
   * @throws for an unknown resident
   */
  private refreshDialoguePortrait(residentId: string | undefined): void {
    if (!residentId) {
      this.dialoguePortrait.setVisible(false); this.dialoguePortraitMat.setVisible(false); return;
    }
    const resident = TOWN_RESIDENTS.find(entry => entry.id === residentId);
    if (!resident) throw new Error(`Dialogue: unknown resident portrait ${residentId}`);
    this.dialoguePortrait.setVisible(true); this.dialoguePortraitMat.setVisible(true);
    this.dialoguePortrait.setTexture(AppearanceTextureSystem.forGame(this.game).residentTextureFor(resident.id), 0)
      .setOrigin(0.5).setScale(4).setPosition(116, 121);
  }

  /** Keep only compact menu entry hints in the free left gutter; the toolbelt owns the center. */
  private buildHints(): void {
    this.controlsHint = this.add.text(12, UI_HEIGHT - 15, 'I  Inventory   ·   Esc  Pause', {
      fontSize: '12px', color: '#e9e3d3', backgroundColor: '#302a24', padding: { x: 6, y: 3 },
    }).setOrigin(0, 1).setName('hud-menu-hint');
  }

  /** Rising, fading pickup toast in the lower-left (stacks briefly if several fire). */
  private showToast(msg: string): void {
    const y = UI_HEIGHT - 70 - (this.toastCount % 3) * 18;
    this.toastCount++;
    const t = this.add
      .text(16, y, msg, { fontSize: '13px', color: '#ffe9a8', stroke: '#000000', strokeThickness: 3 })
      .setDepth(8); // World messages stay below every modal, including the inventory's shade.
    this.tweens.add({
      targets: t,
      y: y - 26,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  /** Reflect current world, inventory and modal state; individual systems retain transaction authority. */
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
    // why: the left HUD column stacks below the water meter's fixed slot (y 50..78): mana row, then
    // the task strip, so a newly learned mana row can never sit under the task strip.
    const taskStripTop = this.vitalityHud.update(LEFT_COLUMN_TOP);

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
    this.craftingUI.update();
    // Morning sell report: rebuild once per new summary; hide when dismissed.
    if (gs.daySummary && this.summaryShownFor !== gs.daySummary.day) {
      this.summaryShownFor = gs.daySummary.day;
      this.showDaySummary(gs.daySummary);
    } else if (!gs.daySummary && this.daySummaryPanel.visible) {
      this.daySummaryPanel.setVisible(false);
      this.summaryShownFor = null;
    }

    this.shippingUI.update();
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
    this.chestUI.update();
    const otherPanel = gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary !== null ||
      gs.tavernPanel !== null || gs.marketPanelOpen;
    this.inventoryUI.update(gs, otherPanel);
    this.controlsHint.setVisible(!isTouchMode() && !otherPanel && !gs.inventoryOpen && !gs.paused && !gs.appearanceEditorOpen && gs.dialogue === null);
    this.controlsHint.setText(gs.activeScene === SceneKey.Tavern
      ? 'I  Inventory   ·   Esc  Pause   ·   J  Tasks' : 'I  Inventory   ·   Esc  Pause');

    // Dialogue box. The Wayfarer table draws its own lower panel instead (WayfarerTableUI).
    this.dialogueBox.setVisible(!!gs.dialogue && gs.dialogue.kind !== 'wayfarer-table');
    if (gs.dialogue && gs.dialogue.kind !== 'wayfarer-table') {
      const dialogue = gs.dialogue;
      // why: every branch below shows only its own buttons, so all choice and option buttons start hidden.
      this.dialogueChoiceButtons.forEach(entry => { entry.button.setVisible(false); entry.label.setVisible(false); });
      this.dialogueOptionButtons.forEach(entry => { entry.button.setVisible(false); entry.label.setVisible(false); });
      this.dialogueName.setText(gs.dialogue.name);
      this.refreshDialoguePortrait(gs.dialogue.residentId);
      const hasPortrait = Boolean(gs.dialogue.residentId);
      this.dialogueName.setX(hasPortrait ? 226 : 28);
      // why: the pocket frames the text column. Beside a portrait it starts right of the portrait card;
      // without one (the mayor, signs, plain messages) it spans the page below the name (rows 53–217), so
      // the text never straddles its edge and the name never sits on its border.
      this.dialogueContentPanel.setPosition(hasPortrait ? 542 : 440, hasPortrait ? 122 : 135)
        .setSize(hasPortrait ? 650 : 844, hasPortrait ? 190 : 164);
      // Crisp high-density text can render wider than Phaser's measured wrap. The 100-pixel
      // safety margin keeps the drawn glyphs inside the 650-pixel paper panel at every UI scale.
      this.dialogueLine.setX(hasPortrait ? 226 : 28).setWordWrapWidth(hasPortrait ? 500 : 760, true)
        .setY(gs.dialogue.kind === 'resident-chat' ? 98 : gs.dialogue.kind === 'resident-actions' ? 58 : 72);
      this.dialoguePlayerLine.setX(hasPortrait ? 226 : 28).setWordWrapWidth(hasPortrait ? 500 : 760, true);
      if (gs.dialogue.kind === 'resident-choice') {
        this.fitDialogueLine(gs.dialogue.line);
        this.dialoguePlayerLine.setText('');
        this.dialogueMemory.setText('CHOOSE A MOMENT');
        const offered = dialogue.choices;
        if (!offered) throw new Error('Dialogue: the resident choice row has no choices');
        for (const entry of this.dialogueChoiceButtons) {
          const shown = offered.includes(entry.choice), selected = dialogue.choice === entry.choice;
          entry.button.setVisible(shown).setFillStyle(selected ? COZY_THEME.green : COZY_THEME.paperDark)
            .setStrokeStyle(selected ? 2 : undefined, COZY_THEME.greenDark);
          entry.label.setVisible(shown).setColor(selected ? COZY_THEME.cream : COZY_THEME.ink);
        }
        this.dialogueCuddleBedroom.setVisible(false); this.dialogueCuddleStanding.setVisible(false);
        this.dialogueCuddleBedroomLabel.setVisible(false); this.dialogueCuddleStandingLabel.setVisible(false);
        this.showOfferButtons(false);
        this.dialogueHint.setText('← → choose   •   Enter confirm   •   Esc close');
      } else if (dialogue.kind === 'resident-actions') {
        const options = dialogue.options, chosen = dialogue.optionIndex;
        if (!options || chosen === undefined) throw new Error('Dialogue: the Together menu has no options');
        if (options.length > ACTION_SLOTS) throw new Error(`Dialogue: the Together menu has ${options.length} options (max ${ACTION_SLOTS})`);
        this.fitDialogueLine(dialogue.line, 3);
        this.dialoguePlayerLine.setText('');
        this.dialogueMemory.setText(dialogue.actionStep === 'plans' ? 'PLANS FOR TOMORROW' : 'TOGETHER');
        options.forEach((option, index) => {
          const slot = this.dialogueOptionButtons[index], selected = index === chosen;
          slot.button.setVisible(true).setFillStyle(selected ? COZY_THEME.green : COZY_THEME.paperDark)
            .setStrokeStyle(selected ? 2 : undefined, COZY_THEME.greenDark);
          slot.label.setVisible(true).setText(option.label).setColor(selected ? COZY_THEME.cream : COZY_THEME.ink);
        });
        this.dialogueCuddleBedroom.setVisible(false); this.dialogueCuddleStanding.setVisible(false);
        this.dialogueCuddleBedroomLabel.setVisible(false); this.dialogueCuddleStandingLabel.setVisible(false);
        this.showOfferButtons(false);
        this.dialogueHint.setText('← → ↑ ↓ choose   •   Enter confirm   •   Esc close');
      } else if (gs.dialogue.kind === 'resident-chat') {
        const typed = gs.dialogue.chatPhase === 'input' ? (gs.dialogue.draft ?? '') : (gs.dialogue.playerLine ?? '');
        this.dialoguePlayerLine.setText(typed ? `You: “${typed}${gs.dialogue.chatPhase === 'input' ? '▌' : ''}”` : 'You: ▌');
        const showCuddle = residentCuddleChoicesVisible(), showOffer = residentOfferVisible();
        this.fitDialogueLine(gs.dialogue.line, showCuddle || showOffer ? 5 : 6);
        this.showOfferButtons(showOffer);
        const exchanges = Math.floor((gs.dialogue.history?.length ?? 0) / 2);
        const consequence = gs.dialogue.chatOutcome === 'warning' ? '  ·  BOUNDARY WARNING'
          : gs.dialogue.chatOutcome === 'end-conversation' ? '  ·  CONVERSATION ENDED'
            : gs.dialogue.chatOutcome === 'call-guard' ? '  ·  GUARD CALLED' : '';
        this.dialogueMemory.setText(`LOCAL VOICE  ·  MEMORY ${exchanges}/3${consequence}`);
        const bedroomSelected = gs.dialogue.cuddleChoice !== 'standing';
        this.dialogueCuddleBedroom.setVisible(showCuddle).setFillStyle(bedroomSelected ? COZY_THEME.green : COZY_THEME.paperDark);
        this.dialogueCuddleStanding.setVisible(showCuddle).setFillStyle(!bedroomSelected ? COZY_THEME.green : COZY_THEME.paperDark);
        this.dialogueCuddleBedroomLabel.setVisible(showCuddle).setColor(bedroomSelected ? COZY_THEME.cream : COZY_THEME.ink);
        this.dialogueCuddleStandingLabel.setVisible(showCuddle).setColor(!bedroomSelected ? COZY_THEME.cream : COZY_THEME.ink);
        this.dialogueHint.setText(showOffer ? '← → choose   •   Enter answer   •   Esc close'
          : showCuddle ? '← → choose   •   Enter ask   •   Esc close'
          : gs.dialogue.chatPhase === 'input' ? 'Enter: send   •   Esc: close'
          : gs.dialogue.chatPhase === 'waiting' ? 'Waiting for local voice…'
            : gs.dialogue.cuddleDecisionPhase === 'waiting' ? 'Waiting for their answer…'
            : gs.dialogue.chatOutcome === 'end-conversation' ? 'Enter: leave them alone   •   Esc: close'
              : gs.dialogue.chatOutcome === 'call-guard' ? 'The town watch is coming…'
                : 'Enter: reply again   •   Esc: close');
      } else {
        this.fitDialogueLine(gs.dialogue.line);
        this.dialoguePlayerLine.setText('');
        this.dialogueMemory.setText('');
        this.dialogueCuddleBedroom.setVisible(false); this.dialogueCuddleStanding.setVisible(false);
        this.dialogueCuddleBedroomLabel.setVisible(false); this.dialogueCuddleStandingLabel.setVisible(false);
        this.showOfferButtons(false);
        this.dialogueHint.setText('E: close');
      }
    }
    this.appearanceUI.update();
    this.relationshipUI.update();
    this.worldRoutesUI.update();
    this.pauseMenu.setInputEnabled(!gs.appearanceEditorOpen && !gs.relationshipJournalOpen && !this.worldRoutesUI.isOpen());
    this.pauseMenu.update();
    this.tavernUI.update(taskStripTop);
    this.marketUI.update();
    this.civicServiceUI.update();
    this.wayfarerTableUI.update(this.time.now);
    this.touchTextEntry.sync(this.touchTypingTarget());
    this.guestServicePrompt.update();
    this.touchControls.update();
  }
  /**
   * The typing line the touch text box should write to, or null when no line is open.
   * The resident Chat line and the Wayfarer table's Say line are the two typing lines. While the table
   * sits on its main buttons, its Say line is offered closed, so one tap on the box opens it and the keyboard.
   * @returns the target for TouchTextEntry.sync()
   */
  private touchTypingTarget(): TouchTextTarget | null {
    const dialogue = GameState.instance.dialogue;
    if (!dialogue) return null;
    if (dialogue.kind === 'wayfarer-table') {
      const view = wayfarerTableView();
      if (!view) throw new Error('Wayfarer table: the table dialogue is open but the table has no view');
      if (wayfarerTableTyping()) {
        return { key: `table:${dialogue.revision}`, draft: view.draft, maxLength: MAX_MESSAGE_LENGTH, placeholder: 'Say something to the table',
          setDraft: setWayfarerTableDraft, submit: sendWayfarerTableLine, open: null };
      }
      if (view.phase !== 'idle') return null;
      // why: on iOS only the player's own tap can open the keyboard, so the box waits here before Say is pressed.
      return { key: `table-closed:${dialogue.revision}`, draft: '', maxLength: MAX_MESSAGE_LENGTH,
        placeholder: 'Tap here to say something…', setDraft: setWayfarerTableDraft, submit: sendWayfarerTableLine,
        open: () => pressWayfarerTableButton('say') };
    }
    if (dialogue.kind === 'resident-chat' && dialogue.chatPhase === 'input') {
      if (dialogue.draft === undefined || !dialogue.history) throw new Error('Resident chat: the input is open without a draft or history');
      // why: history length changes after each exchange, so every new input line reloads the box.
      return { key: `chat:${dialogue.residentId}:${dialogue.revision}:${dialogue.history.length}`, draft: dialogue.draft,
        maxLength: MAX_MESSAGE_LENGTH, placeholder: `Say something to ${dialogue.name}`, setDraft: setResidentChatDraft,
        submit: () => { void sendResidentChat(); }, open: null };
    }
    return null;
  }
}
