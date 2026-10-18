/**
 * UILayout keeps menu coordinates at 960×540 while the render surface fills the browser.
 * World cameras use native integer pixel zoom; menu cameras fit uniformly and accept pointer
 * input through Phaser's inverse camera transform. No CSS stretching changes world pixels.
 */
import Phaser from 'phaser';
import { displayPixelRatio, installCrispText } from './TextRendering';

export const UI_WIDTH = 960;
export const UI_HEIGHT = 540;
/** Shared top edge of the toolbelt's paper; camera clearance must follow its actual UI position. */
export const TOOLBELT_TOP = UI_HEIGHT - 63;

/** Physical height available to an interior, leaving12 logical pixels before the toolbar paper. */
export function interiorViewportHeight(width: number, height: number): number {
  const uiScale = Math.min(width / UI_WIDTH, height / UI_HEIGHT);
  return Math.floor((height - UI_HEIGHT * uiScale) / 2 + (TOOLBELT_TOP - 12) * uiScale);
}

/** Fit a scene's logical menu area, and remove its resize listener when the scene stops. */
export function installUiCamera(scene: Phaser.Scene): void {
  installCrispText(scene);
  const resize = (): void => {
    const { width, height } = scene.scale;
    scene.cameras.main.setSize(width, height)
      .setZoom(Math.min(width / UI_WIDTH, height / UI_HEIGHT))
      .centerOn(UI_WIDTH / 2, UI_HEIGHT / 2);
  };
  resize();
  scene.scale.on(Phaser.Scale.Events.RESIZE, resize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, resize));
}

/** Convert a screen pointer to this UI camera's logical coordinates, including resize offsets. */
export function uiPoint(scene: Phaser.Scene, pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
  return scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
}

/** Cover the full viewport in logical coordinates, including space outside the designed menu area. */
export function createScreenShade(scene: Phaser.Scene, color: number, alpha: number): Phaser.GameObjects.Rectangle {
  const shade = scene.add.rectangle(0, 0, 1, 1, color, alpha).setOrigin(0);
  const resize = (): void => {
    const scale = Math.min(scene.scale.width / UI_WIDTH, scene.scale.height / UI_HEIGHT);
    const width = scene.scale.width / scale;
    const height = scene.scale.height / scale;
    shade.setPosition((UI_WIDTH - width) / 2, (UI_HEIGHT - height) / 2).setSize(width, height);
    if (shade.input) shade.input.hitArea.setTo(0, 0, width, height);
  };
  resize();
  scene.scale.on(Phaser.Scale.Events.RESIZE, resize);
  shade.once(Phaser.GameObjects.Events.DESTROY, () => scene.scale.off(Phaser.Scale.Events.RESIZE, resize));
  return shade;
}

/** Choose a whole-number world magnification without changing tile or character proportions. */
export function worldZoom(width: number, height: number): number {
  const density = displayPixelRatio();
  // Preserve the established whole-number world size in CSS pixels; the backing canvas now
  // contains device pixels, so density must not make the room or player appear larger.
  return density * Math.max(1, Math.round(2 * Math.min(width / density / UI_WIDTH, height / density / UI_HEIGHT)));
}
