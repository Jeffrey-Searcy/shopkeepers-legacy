/**
 * RuntimeArt — small placeholder textures drawn with Phaser graphics at runtime, for first-week
 * props that have no authored PNG yet: the farm's north-trail barricade and mailbox, the portal
 * gate, the dungeon's exit portal, and the escape altar.
 *
 * Each texture is generated once per game (textures are global to the Phaser game), so scenes can
 * call ensureRuntimeArt() from every create(). Colours follow docs/ART_BIBLE.md's warm palette with
 * the shared dark outline. Replace a key with authored art by adding a manifest entry of the same
 * name: ensureRuntimeArt() skips any key that already exists.
 */
import type Phaser from 'phaser';

/** Texture keys this module can draw. */
export const RUNTIME_ART = {
  /** 32x24 wooden barricade with a "closed" sign; blocks the north trail until day 5. */
  barricade: 'trail-barricade',
  /** 32x32 glowing floor ring that opens when a dungeon floor is cleared. */
  exitPortal: 'dungeon-exit-portal',
  /** 16x24 stone altar with a coin slot (paid escape from the dungeon). */
  escapeAltar: 'escape-altar',
  /** 16x24 farm mailbox on a wooden post, flag down (no unread mail). */
  mailbox: 'farm-mailbox',
  /** The same mailbox with the red flag up and a letter peeking out (unread mail waiting). */
  mailboxFlag: 'farm-mailbox-flag',
} as const;

const OUTLINE = 0x2c2128;

/** Draw one texture with `paint` unless the key already exists (authored art wins). */
function make(scene: Phaser.Scene, key: string, w: number, h: number, paint: (g: Phaser.GameObjects.Graphics) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  paint(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/**
 * Make sure every runtime placeholder texture exists.
 * @param scene any live scene (textures are shared across the game)
 */
export function ensureRuntimeArt(scene: Phaser.Scene): void {
  make(scene, RUNTIME_ART.barricade, 32, 24, g => {
    // Two posts, two crossed planks, and a small sign.
    g.fillStyle(OUTLINE).fillRect(2, 6, 5, 18).fillRect(25, 6, 5, 18);
    g.fillStyle(0x7a5232).fillRect(3, 7, 3, 16).fillRect(26, 7, 3, 16);
    g.fillStyle(OUTLINE).fillRect(0, 9, 32, 6).fillRect(0, 16, 32, 5);
    g.fillStyle(0xa8743f).fillRect(1, 10, 30, 4).fillRect(1, 17, 30, 3);
    g.fillStyle(0x8c5f34).fillRect(1, 13, 30, 1).fillRect(1, 19, 30, 1);
    g.fillStyle(OUTLINE).fillRect(9, 0, 14, 9);
    g.fillStyle(0xe8d3a6).fillRect(10, 1, 12, 7);
    g.fillStyle(0xb8382e).fillRect(12, 3, 8, 1).fillRect(12, 5, 8, 1);
  });
  make(scene, RUNTIME_ART.exitPortal, 32, 32, g => {
    g.fillStyle(0x3a2266, 0.9).fillEllipse(16, 16, 30, 22);
    g.fillStyle(0x6a44c4).fillEllipse(16, 16, 24, 17);
    g.fillStyle(0x9a78f0).fillEllipse(16, 16, 16, 11);
    g.fillStyle(0xe6dcff).fillEllipse(16, 16, 7, 5);
  });
  make(scene, RUNTIME_ART.escapeAltar, 16, 24, g => {
    g.fillStyle(OUTLINE).fillRect(1, 8, 14, 16).fillRect(0, 6, 16, 4);
    g.fillStyle(0x8a8698).fillRect(2, 9, 12, 14);
    g.fillStyle(0xa9a5b8).fillRect(1, 7, 14, 2);
    g.fillStyle(0xf0c860).fillRect(6, 12, 4, 2); // coin slot glow
    g.fillStyle(0x6a44c4).fillRect(7, 0, 2, 6); // small violet flame: the way home
    g.fillStyle(0xd8c8ff).fillRect(7, 2, 2, 2);
  });
  make(scene, RUNTIME_ART.mailbox, 16, 24, g => paintMailbox(g, false));
  make(scene, RUNTIME_ART.mailboxFlag, 16, 24, g => paintMailbox(g, true));
}

/**
 * Paint the farm mailbox: a round-topped slate-blue box (door on the left, brass latch, cream name
 * plate) on a wooden post with a grass tuft at its foot.
 * @param g the graphics to paint into (16x24)
 * @param flagUp true for "mail waiting": red flag raised and a letter edge showing at the door
 */
function paintMailbox(g: Phaser.GameObjects.Graphics, flagUp: boolean): void {
  // Grass tuft and post (outline first, then wood with a lit left edge).
  g.fillStyle(0x3f6b34).fillRect(4, 22, 8, 2);
  g.fillStyle(0x5f9a4a).fillRect(5, 21, 2, 2).fillRect(9, 21, 2, 2).fillRect(7, 22, 2, 1);
  g.fillStyle(OUTLINE).fillRect(6, 12, 4, 11);
  g.fillStyle(0x7a5232).fillRect(7, 12, 2, 10);
  g.fillStyle(0xa8743f).fillRect(7, 12, 1, 10);
  // Box body with a rounded top: outline rows, then fill, then light and shadow bands.
  g.fillStyle(OUTLINE).fillRect(3, 2, 10, 1).fillRect(2, 3, 12, 1).fillRect(1, 4, 14, 9);
  g.fillStyle(0x5a6f8c).fillRect(3, 3, 10, 1).fillRect(2, 4, 12, 8);
  g.fillStyle(0x8aa0bd).fillRect(4, 3, 8, 1).fillRect(3, 4, 10, 1); // lit curved lid
  g.fillStyle(0x3f4f68).fillRect(2, 11, 12, 1); // underside shadow
  // Door panel on the left end with a brass latch; cream name plate on the side.
  g.fillStyle(0x4a5c76).fillRect(2, 5, 2, 6);
  g.fillStyle(OUTLINE).fillRect(4, 5, 1, 6);
  g.fillStyle(0xe0b04a).fillRect(2, 8, 1, 1);
  g.fillStyle(0xe8d3a6).fillRect(6, 7, 5, 2);
  g.fillStyle(0xb89a70).fillRect(7, 8, 3, 1);
  if (flagUp) {
    // Flag pole up the right side, red flag pointing back over the box; letter edge at the door.
    g.fillStyle(OUTLINE).fillRect(14, 0, 2, 10);
    g.fillStyle(0xd94c3d).fillRect(11, 0, 4, 3);
    g.fillStyle(0xf07a5e).fillRect(11, 0, 4, 1);
    g.fillStyle(0x8a8698).fillRect(15, 3, 1, 7);
    g.fillStyle(0xf4ead2).fillRect(0, 6, 2, 3);
    g.fillStyle(0xd94c3d).fillRect(0, 7, 1, 1); // wax seal
  } else {
    // Flag folded down along the side.
    g.fillStyle(OUTLINE).fillRect(11, 8, 5, 3);
    g.fillStyle(0xa83a2e).fillRect(12, 9, 4, 1);
  }
}
