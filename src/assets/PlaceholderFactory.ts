/**
 * PlaceholderFactory — bakes colored-rectangle textures into the Phaser texture cache under the
 * SAME logical key a real PixelLab PNG will later use.
 *
 * This is the core of the "placeholder now, art later, zero logic change" seam (CLAUDE.md Hard
 * Rule 4). Because entities always reference a texture KEY (never "am I a rect or a sprite"), the
 * render path is identical for placeholder and final art — swapping art can only change pixels,
 * never gameplay geometry.
 */
import Phaser from 'phaser';

/**
 * Ensure a solid-color texture exists under `key`. Idempotent — safe to call repeatedly. Uses a
 * Graphics object rendered to a texture (works headless in Playwright's Chromium).
 */
export function ensurePlaceholderTexture(
  scene: Phaser.Scene,
  key: string,
  color: string,
  w: number,
  h: number
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const num = Phaser.Display.Color.HexStringToColor(color).color;
  g.fillStyle(num, 1);
  g.fillRect(0, 0, w, h);
  // A subtle darker border makes placeholder tiles visually distinct while iterating.
  g.lineStyle(1, 0x000000, 0.25);
  g.strokeRect(0, 0, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}
