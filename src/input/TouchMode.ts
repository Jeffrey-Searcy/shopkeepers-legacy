/**
 * TouchMode — remembers whether this page has seen a finger on the screen.
 *
 * On-screen touch controls (see TouchControls) stay hidden on desktop and appear only after the first
 * real touch. The listener sits on `window` in the capture phase so a tap anywhere — including the
 * main menu, before any world scene exists — switches the page into touch mode. The mode never turns
 * off again during the page's life; an iPad player who also pairs a keyboard keeps the buttons.
 *
 * Tests turn it on the same way a player does: a real (CDP/Playwright) touch on the page.
 */

/** True once a native touch has been seen (or a test forced touch mode on). */
let touchSeen = false;
/** Guard so the window listener is installed exactly once per page. */
let installed = false;

/**
 * Install the one-time window listener that flips the page into touch mode.
 * Must run before the Phaser game boots so the very first tap is caught.
 * Side effect: adds a capture-phase `touchstart` listener to `window`.
 */
export function installTouchDetection(): void {
  if (installed) throw new Error('installTouchDetection() was called twice.');
  installed = true;
  const onTouch = (): void => {
    touchSeen = true;
    window.removeEventListener('touchstart', onTouch, true);
  };
  window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
}

/** @returns true when on-screen touch controls should be shown. */
export function isTouchMode(): boolean {
  return touchSeen;
}

