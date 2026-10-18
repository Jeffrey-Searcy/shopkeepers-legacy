/**
 * Shared native-pixel text rendering for UI and world scenes. The main canvas owns real device
 * pixels; each Phaser Text rasterizes at its actual camera/parent scale instead of enlarging a
 * small cached glyph image. World image textures keep Phaser's nearest-neighbor pixel filtering.
 */
import Phaser from 'phaser';

/** Explicit readable UI font replaces Phaser's implicit Courier only; authored font choices remain. */
export const UI_FONT = 'Trebuchet MS, sans-serif';

/** Read the actual display density; invalid browser geometry is an error, never a guessed scale. */
export function displayPixelRatio(): number {
  const ratio = window.devicePixelRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('TextRendering: device pixel ratio must be positive.');
  return ratio;
}

/**
 * Keep Phaser's backing canvas at CSS viewport × device density. Scale.NONE lets Phaser own the
 * physical buffer while its public zoom/bounds APIs map native pointer input back correctly.
 * Called once after game boot; listeners are removed when that game is destroyed.
 */
export function installHiDpiCanvas(game: Phaser.Game): void {
  let densityQuery: MediaQueryList;
  /** Resize real render pixels first, then record the exact CSS bounds for pointer conversion. */
  const resize = (): void => {
    const ratio = displayPixelRatio();
    if (window.innerWidth <= 0 || window.innerHeight <= 0) throw new Error('TextRendering: viewport must have positive dimensions.');
    game.scale.setZoom(1 / ratio);
    game.scale.resize(Math.round(window.innerWidth * ratio), Math.round(window.innerHeight * ratio));
    game.canvas.style.width = `${window.innerWidth}px`;
    game.canvas.style.height = `${window.innerHeight}px`;
    game.scale.refresh();
  };
  /** Re-arm the exact density query when a window moves between displays or browser zoom changes. */
  const densityChanged = (): void => {
    densityQuery.removeEventListener('change', densityChanged);
    resize();
    densityQuery = window.matchMedia(`(resolution: ${displayPixelRatio()}dppx)`);
    densityQuery.addEventListener('change', densityChanged);
  };
  resize();
  densityQuery = window.matchMedia(`(resolution: ${displayPixelRatio()}dppx)`);
  densityQuery.addEventListener('change', densityChanged);
  window.addEventListener('resize', resize);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('resize', resize);
    densityQuery.removeEventListener('change', densityChanged);
  });
}

/** Track a scene once per lifecycle, including Text created later and Text moved into containers. */
const installed = new WeakSet<Phaser.Scene>();

/**
 * Install before creating labels. Dynamic setText calls retain the correct resolution; camera or
 * container scaling updates it before rendering. Text destruction removes tracked objects.
 * This does not alter logical layout, hit areas, world images, camera position or game state.
 */
export function installCrispText(scene: Phaser.Scene): void {
  if (installed.has(scene)) return;
  installed.add(scene);
  const labels = new Set<Phaser.GameObjects.Text>();
  const matrix = new Phaser.GameObjects.Components.TransformMatrix();
  const parentMatrix = new Phaser.GameObjects.Components.TransformMatrix();
  /** Adopt all current/future labels; a container's contents remain tracked after reparenting. */
  const adopt = (object: Phaser.GameObjects.GameObject): void => {
    if (object instanceof Phaser.GameObjects.Container) object.list.forEach(adopt);
    if (!(object instanceof Phaser.GameObjects.Text) || labels.has(object)) return;
    if (object.style.fontFamily === 'Courier') object.setFontFamily(UI_FONT);
    labels.add(object);
    object.once(Phaser.GameObjects.Events.DESTROY, () => labels.delete(object));
  };
  /** Match glyph raster pixels to their actual physical draw size, including parent transforms. */
  const refresh = (): void => {
    const camera = scene.cameras.main;
    for (const text of labels) {
      text.getWorldTransformMatrix(matrix, parentMatrix);
      const scale = Math.max(Math.abs(matrix.scaleX * camera.zoomX), Math.abs(matrix.scaleY * camera.zoomY));
      if (!Number.isFinite(scale)) throw new Error('TextRendering: label scale is not finite.');
      if (scale === 0) continue; // A deliberately collapsed label has no visible pixels to rasterize.
      const resolution = Math.round(scale * 1_000_000) / 1_000_000;
      if (Math.abs(text.style.resolution - resolution) > 0.000001) text.setResolution(resolution);
    }
  };
  scene.children.list.forEach(adopt);
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, adopt);
  scene.events.on(Phaser.Scenes.Events.PRE_RENDER, refresh);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, adopt);
    scene.events.off(Phaser.Scenes.Events.PRE_RENDER, refresh);
    labels.clear();
    installed.delete(scene);
  });
}
