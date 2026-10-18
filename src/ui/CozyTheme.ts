/** Shared soft-pocket presentation for the title, pause, inventory, and wardrobe menus. */
import Phaser from 'phaser';
import { SettingsSystem } from '../systems/SettingsSystem';
import { UI_FONT } from './TextRendering';

/** The menu palette deliberately separates quiet surfaces from actionable green buttons. */
export const COZY_THEME = {
  paper: 0xfff5d6, paperDark: 0xead8a8, pocket: 0xeee1bd, mint: 0xcfddbd, green: 0x426552,
  greenDark: 0x263f35, ink: '#3d3328', muted: '#756854', peach: 0xd99272,
  yellow: 0xe2bd64, shadow: 0x1b2923, border: 0xb99b68, leather: 0x5b382c,
  leatherDark: 0x35241f, plum: 0x6e4556, cream: '#fff2c9',
  font: UI_FONT, titleFont: 'Georgia, serif',
} as const;

/** Create a center-origin rounded surface with native Phaser hit testing and color updates. */
export function cozyPanel(scene: Phaser.Scene, x: number, y: number, width: number, height: number,
  color: number = COZY_THEME.paper, radius = 22): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, width, height, color).setRounded(radius);
}

/** Read the saved motion choice, using the browser preference only before the first choice. */
export function prefersReducedMotion(): boolean {
  return SettingsSystem.prefersReducedMotion();
}

/** Fade in a menu without moving its input geometry or reducing pixel-art sharpness. */
export function cozyPop(scene: Phaser.Scene, target: Phaser.GameObjects.Container): void {
  scene.tweens.killTweensOf(target);
  target.setAlpha(prefersReducedMotion() ? 1 : 0);
  if (!prefersReducedMotion()) scene.tweens.add({ targets: target, alpha: 1, duration: 130, ease: 'Sine.Out' });
}
