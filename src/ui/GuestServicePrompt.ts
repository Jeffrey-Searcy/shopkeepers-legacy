/** Contextual sold-out response, separate from the management menu and inventory transactions. */
import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import { TavernSystem } from '../systems/TavernSystem';
import { tavernVisitor } from '../config/Tavern';
import { Sfx } from '../systems/SfxSystem';
import { UI_FONT } from './TextRendering';
import { UI_WIDTH, UI_HEIGHT, TOOLBELT_TOP } from './UILayout';
import { isTouchMode } from '../input/TouchMode';

/** Scene-owned keyboard/pointer prompt. The system rechecks every action's guards before mutation. */
export class GuestServicePrompt {
  private readonly button: Phaser.GameObjects.Text;
  private readonly events = new WeakSet<KeyboardEvent>();
  /** Which layout the button last used (null before the first update); restyling redraws the text, so do it once. */
  private touchLayout: boolean | null = null;

  /** Allocate the corner prompt and clean up its keyboard listener when this UI scene stops. */
  constructor(private readonly scene: Phaser.Scene) {
    this.button = scene.add.text(UI_WIDTH - 14, UI_HEIGHT - 14, '', {
      fontFamily: UI_FONT, fontSize: '11px', color: '#fff5da', backgroundColor: '#3e5145',
      padding: { x: 10, y: 7 },
    }).setOrigin(1, 1).setDepth(11).setVisible(false).setName('guest-sold-out')
      .setInteractive({ useHandCursor: true });
    this.button.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.respond();
    });
    const keyboard = scene.input.keyboard;
    if (keyboard === null) throw new Error('GuestServicePrompt: keyboard input is required');
    /** Reject auto-repeat and replayed native events from parallel scene plugins. */
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat || this.events.has(event)) return;
      this.events.add(event);
      this.respond();
    };
    keyboard.on('keydown-Q', onKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown-Q', onKey));
  }

  /** Resolve current reach and stock; visible labels never grant transaction authority. */
  private target(): number | null {
    const guest = GameState.instance.tavern.guests.find(candidate => TavernSystem.canDeclineOrder(candidate.id));
    return guest ? guest.id : null;
  }

  /** Send one deliberate reply. Blocked prompts do not consume inventory or issue a misleading toast. */
  private respond(): void {
    const target = this.target();
    if (target === null) return;
    const result = TavernSystem.declineOrder(target);
    Sfx.play(result.ok ? 'select' : 'deny');
    this.scene.game.events.emit('toast', result.message);
    this.update();
  }

  /**
   * Show the one reachable guest. Desktop: bottom-right corner, away from the central exit and toolbar.
   * Touch: centered just above the toolbar, larger and without the Q key hint, because the bottom-right
   * corner belongs to the on-screen Use/Action buttons.
   */
  update(): void {
    const id = this.target();
    this.button.setVisible(id !== null);
    if (id === null) return;
    const guest = GameState.instance.tavern.guests.find(candidate => candidate.id === id);
    if (!guest) throw new Error('GuestServicePrompt: selected guest disappeared synchronously');
    const touch = isTouchMode();
    if (touch !== this.touchLayout) {
      this.touchLayout = touch;
      if (touch) this.button.setPosition(UI_WIDTH / 2, TOOLBELT_TOP - 10).setOrigin(0.5, 1).setFontSize(14).setPadding(14, 10, 14, 10);
      else this.button.setPosition(UI_WIDTH - 14, UI_HEIGHT - 14).setOrigin(1, 1).setFontSize(11).setPadding(10, 7, 10, 7);
    }
    const name = tavernVisitor(guest.visitorId).name;
    this.button.setText(`${touch ? '' : 'Q  '}Tell ${name}: “We’re out”`).setData('guestId', id);
  }
}
