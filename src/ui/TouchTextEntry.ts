/**
 * TouchTextEntry — a real HTML text box for typing on an iPad or phone.
 *
 * The game reads typed words from keyboard events, and a touch screen has no keyboard until a real text
 * field has focus. So while a typing line is open in touch mode (the resident Chat line or the Wayfarer
 * table's Say line), this module shows one HTML <input> plus a Say button at the top of the screen.
 * The top keeps it above the on-screen keyboard. Tapping the box opens the device keyboard.
 *
 * iOS opens the keyboard only when a focus comes from a real tap, never from code run a frame later.
 * So an owner can also show the box before its line is open (the table's idle "Say something…" box):
 * the target then has an `open` callback, the box does not focus itself, and the player's own tap on
 * the box opens the line inside that tap, so the keyboard comes up at once.
 *
 * The box holds no game logic. Every change goes to the owner's setDraft(), and Say (or the keyboard's
 * Send key) calls the owner's submit(). Desktop never sees the box: it shows only in touch mode.
 *
 * Lifecycle: UIScene builds one in create(), calls sync() every frame, and calls destroy() on shutdown.
 */
import { isTouchMode } from '../input/TouchMode';

/** One open typing line the text box writes to. UIScene builds this from the open dialogue each frame. */
export interface TouchTextTarget {
  /** Changes when a different line opens, so the box reloads its text from `draft`. */
  key: string;
  /** The line's current text in the game. */
  draft: string;
  /** Longest line the owner accepts. */
  maxLength: number;
  /** Grey hint text in the empty box. */
  placeholder: string;
  /** Replace the whole line in the game. */
  setDraft: (text: string) => void;
  /** Say the line (the same as Enter on a keyboard). */
  submit: () => void;
  /**
   * Null when the typing line is already open. Otherwise the line is still closed: the box waits for the
   * player's tap and calls this from inside that tap to open the line (see the file header for why).
   */
  open: (() => void) | null;
}

/** The single HTML text box for touch typing. */
export class TouchTextEntry {
  private readonly form: HTMLFormElement;
  private readonly field: HTMLInputElement;
  /** The target shown now, or null while the box is hidden. */
  private target: TouchTextTarget | null = null;

  /** Build the hidden box and add it to the page. */
  constructor() {
    this.form = document.createElement('form');
    this.form.className = 'touch-text-entry';
    this.form.dataset.testid = 'touch-text-entry';
    // why: the page sets user-select none for touch play; iOS will not type into a field that inherits it.
    this.form.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);'
      + 'z-index:30;display:none;gap:8px;width:min(620px,94vw);padding:8px;box-sizing:border-box;border-radius:12px;'
      + 'background:#f7ead0;border:2px solid #6f4d35;box-shadow:0 4px 14px rgba(0,0,0,.45);'
      + '-webkit-user-select:text;user-select:text;';
    this.field = document.createElement('input');
    this.field.type = 'text';
    this.field.autocomplete = 'off';
    this.field.enterKeyHint = 'send';
    this.field.setAttribute('aria-label', 'What you say');
    this.field.style.cssText = 'flex:1;min-width:0;font:16px Georgia,serif;padding:8px 10px;border-radius:8px;'
      + 'border:1px solid #b99a74;background:#fffaf0;color:#3b2a1d;-webkit-user-select:text;user-select:text;';
    const say = document.createElement('button');
    say.type = 'submit';
    say.textContent = 'Say';
    say.style.cssText = 'font:bold 15px Georgia,serif;padding:8px 18px;border-radius:8px;border:2px solid #2f5b46;'
      + 'background:#3f7a5c;color:#fdf6e6;';
    this.form.append(this.field, say);
    // why: Phaser listens for keys on window. Stopping them here keeps one key from typing twice
    // (once into the box and once through the game's keyboard path).
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.form.addEventListener(type, event => event.stopPropagation());
    }
    this.field.addEventListener('focus', () => {
      const target = this.target;
      // why: a focus while the box is hidden is the blur/hide race at close; only a shown closed line opens.
      if (target?.open) target.open();
    });
    this.field.addEventListener('input', () => this.requireTarget().setDraft(this.field.value));
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      const target = this.requireTarget();
      // why: Say on a closed line means "I want to talk": focusing inside this tap opens the line and the keyboard.
      if (target.open) { this.field.focus(); return; }
      target.setDraft(this.field.value);
      this.field.blur(); // why: closes the device keyboard so the table and its reply are visible again.
      target.submit();
    });
    document.body.append(this.form);
  }

  /**
   * Show the box for the open typing line, or hide it. Call every frame.
   * @param target the open typing line, or null when no line is open
   */
  sync(target: TouchTextTarget | null): void {
    const show = target !== null && isTouchMode();
    if (!show) {
      if (this.target) {
        this.target = null;
        this.field.blur();
        this.form.style.display = 'none';
      }
      return;
    }
    if (this.target?.key !== target.key) {
      this.field.value = target.draft;
      this.field.maxLength = target.maxLength;
      this.field.placeholder = target.placeholder;
      this.form.style.display = 'flex';
      // why: Android opens the keyboard on this focus; iOS needs a tap on the box, which also works.
      // A closed line never focuses itself, or every idle moment would pop the keyboard up.
      if (!target.open) this.field.focus();
      else this.field.blur();
    }
    this.target = target;
  }

  /** Remove the box from the page (UIScene shutdown). */
  destroy(): void {
    this.target = null;
    this.form.remove();
  }

  /** The current target. An input event with no target means the box was not hidden in time: a bug. */
  private requireTarget(): TouchTextTarget {
    if (!this.target) throw new Error('Touch text entry: the box received input while no typing line was open');
    return this.target;
  }
}
