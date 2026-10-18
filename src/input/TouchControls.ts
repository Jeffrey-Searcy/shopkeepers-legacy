/**
 * TouchControls — the on-screen iPad controls, modeled on Stardew Valley's mobile layout.
 *
 * UIScene creates one instance and calls `update()` every frame. Nothing is shown until the page has
 * seen a real touch (see TouchMode), so desktop play is unchanged. Every control only feeds the shared
 * InputBus, exactly like the keyboard does; the world scenes keep sole authority over what happens.
 *
 * Layout (logical 960×540 UI space, anchored to the visible screen edges so iPad's taller 4:3 screen
 * uses its extra bands instead of covering the toolbar):
 *  - Left: a floating joystick. A thumb anywhere in the lower-left area plants the stick there;
 *    dragging walks in 8 directions (InputBus.setMove). A faint resting stick shows where to press.
 *  - Right thumb cluster: Use (hold = Space: swing, charge the rod, reel, place furniture), Action (E:
 *    talk, open, harvest, cancel placement, close dialogue), plus a context button above Use:
 *    Rotate while placing furniture, or Dodge in the Mines.
 *  - Top right, below the gold: Bag (inventory) and Menu. Menu becomes a × Back button whenever any
 *    menu, panel or dialogue is open, so every screen has one universal close.
 *
 * Multi-touch: each hold (joystick, Use) remembers its own finger and polls `pointer.isDown`, so a
 * finger that lifts somewhere this scene cannot hear still ends its hold on the next frame.
 */
import Phaser from 'phaser';
import { GameState, type Facing } from '../state/GameState';
import { InputBus, type OneShotAction } from './InputBus';
import { isTouchMode } from './TouchMode';
import { ToolSystem } from '../systems/ToolSystem';
import { ITEM_CATALOG } from '../config/Items';
import { SceneKey } from '../config/AssetKeys';
import { COZY_THEME } from '../ui/CozyTheme';
import { UI_WIDTH, UI_HEIGHT, TOOLBELT_TOP, uiPoint } from '../ui/UILayout';
import { isWorldRoutesModalOpen } from '../systems/WorldRoutesModalSystem';

/**
 * Above every UIScene layer so Back always receives taps. The full-screen overlays (pause menu
 * 2_000_000, journal/appearance 2_000_010, world routes 2_000_020) would otherwise cover the buttons.
 */
const TOUCH_DEPTH = 3_000_000;
/** Gap between controls and the visible screen edge (logical px); clears the iPad home indicator. */
const EDGE = 18;
/** Joystick base radius; the knob travels at most this far from the planted center. */
const STICK_RADIUS = 56;
/** Thumb travel (logical px) that still counts as standing still. */
const STICK_DEAD_ZONE = 12;
/**
 * A normalized stick axis above this counts as pressed. 0.38 ≈ sin(22.5°), so the stick has eight
 * equal 45° sectors: pure up/down/left/right plus the four diagonals.
 */
const STICK_AXIS_THRESHOLD = 0.38;
/** The joystick area stops left of the centered toolbelt (which starts near x 291). */
const STICK_AREA_RIGHT = 280;
/** The joystick area starts below the top-left HUD (stamina, water meter, Mines HP). */
const STICK_AREA_TOP = 170;
/** Extra invisible hit margin around every round button, so a slightly-off thumb still lands. */
const HIT_PAD = 10;
/** Top of the dialogue paper (UIScene.buildDialogueBox: 540 − 236 − 16). The Action button sits above it. */
const DIALOGUE_TOP = 288;

const DIRECTIONS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/**
 * One round on-screen button: a paper disc with a text label or an item icon.
 * The disc itself is the interactive object; its hit circle is padded by HIT_PAD.
 */
class TouchButton {
  readonly disc: Phaser.GameObjects.Arc;
  private readonly label: Phaser.GameObjects.Text;
  private readonly icon: Phaser.GameObjects.Image;
  private iconKey: string | null = null;
  /** Last text label and font size, so per-frame relabels do not redraw an unchanged Text. */
  private labelKey = '';

  /**
   * @param scene the UI scene that owns the button.
   * @param name debug/test name for the disc (the label and icon get `-label` / `-icon` suffixes).
   * @param radius disc radius in logical px.
   * @param onDown called with the pressing finger when the button is touched.
   */
  constructor(scene: Phaser.Scene, name: string, private readonly radius: number,
    onDown: (pointer: Phaser.Input.Pointer) => void) {
    this.disc = scene.add.circle(0, 0, radius, COZY_THEME.paper, 0.86)
      .setStrokeStyle(3, COZY_THEME.leather, 0.95).setDepth(TOUCH_DEPTH).setName(name)
      .setInteractive(new Phaser.Geom.Circle(radius, radius, radius + HIT_PAD), Phaser.Geom.Circle.Contains);
    this.label = scene.add.text(0, 0, '', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: `${Math.round(radius * 0.36)}px`, color: COZY_THEME.ink,
    }).setOrigin(0.5).setDepth(TOUCH_DEPTH + 1).setName(`${name}-label`);
    this.icon = scene.add.image(0, 0, '__DEFAULT').setDepth(TOUCH_DEPTH + 1).setVisible(false).setName(`${name}-icon`);
    this.disc.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      onDown(pointer);
    });
  }

  /** Move the button's center to logical (x, y). */
  setPosition(x: number, y: number): void {
    this.disc.setPosition(x, y);
    this.label.setPosition(x, y);
    this.icon.setPosition(x, y);
  }

  /** Show or hide the button; a hidden disc is not hit-tested by Phaser. */
  setVisible(visible: boolean): void {
    this.disc.setVisible(visible);
    this.label.setVisible(visible && this.iconKey === null);
    this.icon.setVisible(visible && this.iconKey !== null);
  }

  /** @returns whether the button is currently shown. */
  get visible(): boolean {
    return this.disc.visible;
  }

  /**
   * Show text on the button (clears any icon).
   * @param text short label; `size` optionally overrides the default font size in px.
   */
  setLabel(text: string, size?: number): void {
    const fontSize = size ?? Math.round(this.radius * 0.36);
    const key = `${fontSize}|${text}`;
    if (this.iconKey === null && this.labelKey === key) return;
    this.iconKey = null;
    this.labelKey = key;
    this.icon.setVisible(false);
    this.label.setText(text).setFontSize(fontSize).setVisible(this.disc.visible);
  }

  /**
   * Show an item/tool icon on the button (hides the text label).
   * @param key texture key; must already be loaded.
   */
  setIcon(key: string): void {
    if (this.iconKey === key) return;
    this.iconKey = key;
    this.labelKey = '';
    const size = this.radius * 1.15;
    this.icon.setTexture(key).setDisplaySize(size, size).setVisible(this.disc.visible);
    this.label.setVisible(false);
  }

  /** Darken the disc while a finger holds it. */
  setPressed(pressed: boolean): void {
    this.disc.setFillStyle(pressed ? COZY_THEME.paperDark : COZY_THEME.paper, pressed ? 0.95 : 0.86);
  }
}

/**
 * Owns every on-screen touch control for one UIScene lifetime. Created in UIScene.create(); its
 * update() runs from UIScene.update(). Scene shutdown destroys its game objects with the scene.
 */
export class TouchControls {
  /** Visible logical rectangle of the UI camera (wider or taller than 960×540 on most screens). */
  private view = new Phaser.Geom.Rectangle(0, 0, UI_WIDTH, UI_HEIGHT);

  // Joystick.
  private readonly stickArea: Phaser.GameObjects.Zone;
  private readonly stickBase: Phaser.GameObjects.Arc;
  private readonly stickKnob: Phaser.GameObjects.Arc;
  /** The finger steering the joystick, or null when the stick rests. */
  private stickPointer: Phaser.Input.Pointer | null = null;
  /** Where that finger first touched (the planted stick center), in logical px. */
  private stickOrigin = new Phaser.Math.Vector2();
  /** Directions this joystick currently holds on the InputBus (it releases only its own). */
  private stickDirs = new Set<Facing>();

  // Buttons.
  private readonly use: TouchButton;
  private readonly action: TouchButton;
  private readonly rotate: TouchButton;
  private readonly dodge: TouchButton;
  private readonly bag: TouchButton;
  private readonly menu: TouchButton;
  /** The finger holding Use, or null. */
  private usePointer: Phaser.Input.Pointer | null = null;

  /** @param scene the UIScene (its main camera is the 960×540 UI camera). */
  constructor(private readonly scene: Phaser.Scene) {
    this.stickArea = scene.add.zone(0, 0, 1, 1).setOrigin(0).setDepth(TOUCH_DEPTH).setName('touch-stick-area')
      .setInteractive();
    this.stickArea.on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.plantStick(pointer);
    });
    this.stickBase = scene.add.circle(0, 0, STICK_RADIUS, COZY_THEME.shadow, 0.22)
      .setStrokeStyle(3, 0xfff2c9, 0.55).setDepth(TOUCH_DEPTH).setName('touch-stick-base');
    this.stickKnob = scene.add.circle(0, 0, 26, COZY_THEME.paper, 0.7)
      .setStrokeStyle(3, COZY_THEME.leather, 0.8).setDepth(TOUCH_DEPTH + 1).setName('touch-stick-knob');

    this.use = new TouchButton(scene, 'touch-use', 46, pointer => {
      if (this.usePointer) return;
      this.usePointer = pointer;
      this.use.setPressed(true);
      InputBus.instance.pressTool();
    });
    this.action = new TouchButton(scene, 'touch-action', 36, () => this.emit('interact'));
    this.rotate = new TouchButton(scene, 'touch-rotate', 28, () => this.emit('rotate-placement'));
    this.rotate.setLabel('↻', 26);
    this.dodge = new TouchButton(scene, 'touch-dodge', 28, () => this.emit('dodge'));
    this.dodge.setLabel('DODGE', 10);
    this.bag = new TouchButton(scene, 'touch-bag', 28, () => this.emit('toggle-inventory'));
    this.bag.setLabel('BAG', 10);
    this.menu = new TouchButton(scene, 'touch-menu', 28, () => this.emit('toggle-pause'));

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.releaseStick();
      this.releaseUse();
    });
    this.hideAll();
  }

  /** @returns true once the controls are active (a touch has been seen on this page). */
  get active(): boolean {
    return isTouchMode();
  }

  /** Recompute the visible logical rectangle and anchor every control to its edges. */
  private layout(): void {
    const { width, height } = this.scene.scale;
    const zoom = Math.min(width / UI_WIDTH, height / UI_HEIGHT);
    const w = width / zoom;
    const h = height / zoom;
    this.view.setTo((UI_WIDTH - w) / 2, (UI_HEIGHT - h) / 2, w, h);
    const v = this.view;

    const areaTop = STICK_AREA_TOP;
    this.stickArea.setPosition(v.x, areaTop).setSize(STICK_AREA_RIGHT - v.x, v.bottom - areaTop);
    if (!this.stickArea.input) throw new Error('TouchControls: joystick area lost its input handle.');
    this.stickArea.input.hitArea.setTo(0, 0, this.stickArea.width, this.stickArea.height);
    if (!this.stickPointer) this.placeStick(this.restingStickCenter());

    const useX = v.right - EDGE - 50;
    // Keep the whole thumb cluster above the toolbelt line on wide screens, and in the extra
    // bottom band on iPad's taller screen.
    const useY = Math.min(v.bottom - EDGE - 118, TOOLBELT_TOP + 40);
    this.use.setPosition(useX, useY);
    this.rotate.setPosition(useX, useY - 92);
    this.dodge.setPosition(useX, useY - 92);
    this.bag.setPosition(v.right - EDGE - 98, 90);
    this.menu.setPosition(v.right - EDGE - 32, 90);
  }

  /** Default Action position: down-left of Use, in the classic Stardew mobile thumb arc. */
  private actionHome(): { x: number; y: number } {
    const v = this.view;
    return { x: v.right - EDGE - 146, y: Math.min(v.bottom - EDGE - 50, TOOLBELT_TOP + 108) };
  }

  /** Center of the resting (untouched) joystick in the lower-left corner. */
  private restingStickCenter(): Phaser.Math.Vector2 {
    const v = this.view;
    return new Phaser.Math.Vector2(v.x + EDGE + 96, v.bottom - EDGE - 96);
  }

  /** Draw the joystick base and knob centered at `center`. */
  private placeStick(center: Phaser.Math.Vector2): void {
    this.stickOrigin.copy(center);
    this.stickBase.setPosition(center.x, center.y);
    this.stickKnob.setPosition(center.x, center.y);
  }

  /**
   * A thumb touched the joystick area: plant the stick under it (kept fully on screen).
   * @param pointer the finger that will steer until it lifts.
   */
  private plantStick(pointer: Phaser.Input.Pointer): void {
    if (this.stickPointer) return;
    this.stickPointer = pointer;
    const v = this.view;
    const p = uiPoint(this.scene, pointer);
    const x = Phaser.Math.Clamp(p.x, v.x + STICK_RADIUS, STICK_AREA_RIGHT - STICK_RADIUS / 2);
    const y = Phaser.Math.Clamp(p.y, STICK_AREA_TOP + STICK_RADIUS / 2, v.bottom - STICK_RADIUS);
    this.placeStick(new Phaser.Math.Vector2(x, y));
    this.stickBase.setAlpha(1);
    this.stickKnob.setAlpha(1);
    this.steerStick();
  }

  /** Follow the steering finger: move the knob and hold the matching directions on the InputBus. */
  private steerStick(): void {
    const pointer = this.stickPointer;
    if (!pointer) throw new Error('TouchControls: steerStick ran without a steering finger.');
    const p = uiPoint(this.scene, pointer);
    const dx = p.x - this.stickOrigin.x;
    const dy = p.y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    const reach = Math.min(len, STICK_RADIUS);
    const kx = len > 0 ? (dx / len) * reach : 0;
    const ky = len > 0 ? (dy / len) * reach : 0;
    this.stickKnob.setPosition(this.stickOrigin.x + kx, this.stickOrigin.y + ky);
    const dirs = new Set<Facing>();
    if (len >= STICK_DEAD_ZONE) {
      const nx = dx / len;
      const ny = dy / len;
      if (nx > STICK_AXIS_THRESHOLD) dirs.add('right');
      if (nx < -STICK_AXIS_THRESHOLD) dirs.add('left');
      if (ny > STICK_AXIS_THRESHOLD) dirs.add('down');
      if (ny < -STICK_AXIS_THRESHOLD) dirs.add('up');
    }
    this.holdDirections(dirs);
  }

  /**
   * Hold exactly `dirs` for the joystick. Wanted directions are re-sent every frame because menus and
   * scene changes clear the bus; directions held by a keyboard are never released here.
   */
  private holdDirections(dirs: Set<Facing>): void {
    const bus = InputBus.instance;
    for (const dir of DIRECTIONS) {
      if (dirs.has(dir)) bus.setMove(dir, true);
      else if (this.stickDirs.has(dir)) bus.setMove(dir, false);
    }
    this.stickDirs = dirs;
  }

  /** Let go of the joystick: release its directions and return the stick to rest. */
  private releaseStick(): void {
    this.holdDirections(new Set());
    this.stickPointer = null;
    this.placeStick(this.restingStickCenter());
    this.stickBase.setAlpha(0.55);
    this.stickKnob.setAlpha(0.55);
  }

  /** Let go of the Use button's hold. */
  private releaseUse(): void {
    if (!this.usePointer) return;
    this.usePointer = null;
    this.use.setPressed(false);
    InputBus.instance.releaseTool();
  }

  /**
   * Send a one-shot action exactly as its keyboard key would.
   * @param action the InputBus action.
   */
  private emit(action: OneShotAction): void {
    InputBus.instance.emit(action);
  }

  /** Hide every control and drop any hold (used before the first touch and while hidden). */
  private hideAll(): void {
    this.setStickVisible(false);
    for (const button of [this.use, this.action, this.rotate, this.dodge, this.bag, this.menu]) button.setVisible(false);
    this.releaseUse();
  }

  /** Show or hide the joystick; hiding also releases it. */
  private setStickVisible(visible: boolean): void {
    if (!visible && this.stickPointer) this.releaseStick();
    this.stickBase.setVisible(visible);
    this.stickKnob.setVisible(visible);
    if (!this.stickArea.input) throw new Error('TouchControls: joystick area lost its input handle.');
    this.stickArea.input.enabled = visible;
  }

  /** Per-frame: choose which controls show, relabel them for the moment, and track held fingers. */
  update(): void {
    if (!this.active) {
      this.hideAll();
      return;
    }
    const gs = GameState.instance;
    const menuOpen = gs.paused || gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen ||
      gs.tavernPanel !== null || gs.marketPanelOpen || gs.appearanceEditorOpen || gs.relationshipJournalOpen ||
      isWorldRoutesModalOpen();
    const talking = gs.dialogue !== null;
    const summary = gs.daySummary !== null;
    const free = !menuOpen && !talking && !summary;

    // Joystick: steer while its finger stays down; lift (anywhere) returns it to rest.
    this.setStickVisible(free);
    if (free && this.stickPointer) {
      if (this.stickPointer.isDown) {
        if (!gs.transitionActive) this.steerStick();
      } else {
        this.releaseStick();
      }
    }

    // Use: hold while its finger stays down.
    this.use.setVisible(free);
    if (!free) this.releaseUse();
    else if (this.usePointer && !this.usePointer.isDown) this.releaseUse();
    if (free) this.refreshUseFace(gs.placingItem !== null);

    // Action: world "E", and the confirm/close key for dialogue and the morning report.
    // why: the Wayfarer table draws its own tappable buttons, so the world action button would only cover them.
    this.action.setVisible(!menuOpen && gs.dialogue?.kind !== 'wayfarer-table');
    const home = this.actionHome();
    if (talking) {
      this.action.setPosition(this.view.right - EDGE - 50, DIALOGUE_TOP - 50);
      this.action.setLabel(gs.dialogue?.kind === 'resident-choice' || gs.dialogue?.kind === 'resident-actions' ? 'OK' : 'CLOSE', 12);
    } else {
      this.action.setPosition(home.x, home.y);
      this.action.setLabel(summary ? 'OK' : gs.placingItem ? 'CANCEL' : 'ACTION', summary ? 14 : 10);
    }

    // Context button above Use.
    this.rotate.setVisible(free && gs.placingItem !== null);
    this.dodge.setVisible(free && gs.placingItem === null && gs.activeScene === SceneKey.Mines);

    // Top-right menu pair. Menu turns into Back whenever anything covers the world, so Bag is only
    // needed on the open world (while the bag is open, it would also cover the panel's corner).
    this.bag.setVisible(free);
    const covered = menuOpen || talking || summary;
    this.menu.setVisible(true);
    this.menu.setLabel(covered ? '×' : 'MENU', covered ? 28 : 10);
  }

  /**
   * Show what Use will do: PLACE during furniture placement, otherwise the held item's or tool's icon.
   * @param placing whether a furniture ghost is active.
   */
  private refreshUseFace(placing: boolean): void {
    if (placing) {
      this.use.setLabel('PLACE', 14);
      return;
    }
    const item = ToolSystem.activeItem();
    const tool = ToolSystem.active();
    const key = item !== null ? ITEM_CATALOG[item]?.icon : tool !== null ? `icon-${tool}` : null;
    if (item !== null && !key) throw new Error(`TouchControls: held item "${item}" has no icon metadata.`);
    if (key === null || key === undefined) {
      this.use.setLabel('USE', 16);
      return;
    }
    if (!this.scene.textures.exists(key)) throw new Error(`TouchControls: Use button needs missing texture "${key}".`);
    this.use.setIcon(key);
  }
}
