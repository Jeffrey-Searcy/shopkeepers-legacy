/**
 * BootScene — the very first scene. Loads the asset manifest JSON, then hands off to PreloadScene.
 *
 * Kept minimal: its only job is to fetch manifest.json (the single source of truth for textures)
 * so PreloadScene can materialize everything. Fail-loud if the manifest is missing/malformed.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  preload(): void {
    this.load.json('manifest', 'assets/manifest.json');
  }

  create(): void {
    const manifest = this.cache.json.get('manifest');
    if (!manifest || !manifest.textures) {
      throw new Error('BootScene: assets/manifest.json missing or has no "textures" key');
    }
    this.scene.start(SceneKey.Preload);
  }
}
