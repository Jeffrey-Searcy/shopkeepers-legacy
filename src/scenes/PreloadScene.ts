/**
 * PreloadScene — materializes every texture from the manifest (placeholders + real files), builds
 * animations, then launches the starting world scene (Farm) plus the parallel UIScene.
 *
 * Placeholder textures are created synchronously in preload(); real files are queued on the loader.
 * Animations are (re)built in create() once textures exist. Navigation uses one normalized
 * four-direction sheet; action sheets use the same four-direction layout and character identity.
 */
import Phaser from 'phaser';
import { AnimKey, SceneKey, TextureKey } from '../config/AssetKeys';
import { loadFromManifest } from '../assets/AssetLoader';
import { shouldShowMainMenu } from '../debug/RuntimeMode';
import { FURNITURE } from '../config/Furniture';
import { mapEditorMode } from '../debug/MapEditorMode';
import { enterMapEditor, enterRouteEditor } from '../systems/SceneTransitionSystem';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    // Bake placeholder textures + queue any real asset files. Synchronous so queued loads run within
    // this scene's preload lifecycle before create().
    const manifest = this.cache.json.get('manifest');
    loadFromManifest(this, manifest);
  }

  create(): void {
    this.buildFurnitureFrames();
    this.buildDirectionalNavigation();
    this.buildTavernPatrons();
    // Each visible tool/combat action has four frames in each of four direction rows. At 10 FPS,
    // every action lasts 400 ms and preserves the established input cadence. Fishing cast uses a
    // navigation hold pose because the scene draws the live rod line and bobber separately.
    const actions = ['chop', 'dig', 'mine', 'sweep', 'broom', 'water', 'sword'] as const;
    for (const action of actions) {
      this.buildDirectionalAction(action, 10);
    }

    // Normal play begins at the title. Existing deterministic specs retain direct Farm boot unless
    // they explicitly request `?menu=1`, so every prior gameplay gate keeps its stable setup.
    if (mapEditorMode() === 'routes') {
      enterRouteEditor(this);
    } else if (mapEditorMode() === 'edit') {
      enterMapEditor(this);
    } else if (shouldShowMainMenu()) {
      this.scene.start(SceneKey.MainMenu);
    } else {
      this.scene.start(SceneKey.Farm);
      this.scene.launch(SceneKey.UI);
    }
  }

  /** Register native crops once, rejecting incomplete art before any saved furniture can load. */
  private buildFurnitureFrames(): void {
    for (const definition of Object.values(FURNITURE)) {
      for (const view of Object.values(definition.views)) {
        if (!this.textures.exists(view.texture)) throw new Error(`Furniture: missing texture ${view.texture}`);
        if (!view.crop) continue;
        if (!view.frame) throw new Error(`Furniture: crop has no frame name for ${view.texture}`);
        const texture = this.textures.get(view.texture);
        const source = texture.getSourceImage() as HTMLImageElement;
        const { x, y, w, h } = view.crop;
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > source.width || y + h > source.height) {
          throw new Error(`Furniture: crop exceeds native image ${view.texture}`);
        }
        if (!texture.has(view.frame)) texture.add(view.frame, 0, x, y, w, h);
      }
    }
  }

  /** Register four walk loops and four idle poses from the normalized directional sheet. */
  private buildTavernPatrons(): void {
    for (const texture of [TextureKey.TavernRosa, TextureKey.TavernFinn, TextureKey.TavernMara]) {
      if (!this.textures.exists(texture) || this.textures.get(texture).frameTotal !== 17) {
        throw new Error(`PreloadScene: ${texture} requires a sixteen-frame patron sheet`);
      }
      for (const [index, facing] of ['down', 'up', 'left', 'right'].entries()) {
        const start = index * 4;
        this.anims.create({ key: `${texture}-walk-${facing}`,
          frames: this.anims.generateFrameNumbers(texture, { start, end: start + 3 }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: `${texture}-idle-${facing}`,
          frames: [{ key: texture, frame: start }], frameRate: 1, repeat: -1 });
      }
    }
  }

  /** Register four walk loops and four idle poses from the player's normalized directional sheet. */
  private buildDirectionalNavigation(): void {
    if (!this.textures.exists(TextureKey.PlayerNavigation)) return;
    const texture = this.textures.get(TextureKey.PlayerNavigation);
    const frameCount = texture.frameTotal - 1;
    if (frameCount !== 16) {
      throw new Error(`PreloadScene: player-navigation requires 16 frames; found ${frameCount}`);
    }
    const directions = [
      { walk: AnimKey.PlayerWalkDown, idle: AnimKey.PlayerIdleDown, start: 0 },
      { walk: AnimKey.PlayerWalkUp, idle: AnimKey.PlayerIdleUp, start: 4 },
      { walk: AnimKey.PlayerWalkLeft, idle: AnimKey.PlayerIdleLeft, start: 8 },
      { walk: AnimKey.PlayerWalkRight, idle: AnimKey.PlayerIdleRight, start: 12 },
    ] as const;
    for (const direction of directions) {
      if (!this.anims.exists(direction.walk)) {
        this.anims.create({
          key: direction.walk,
          frames: this.anims.generateFrameNumbers(TextureKey.PlayerNavigation, {
            start: direction.start,
            end: direction.start + 3,
          }),
          frameRate: 8,
          repeat: -1,
        });
      }
      if (!this.anims.exists(direction.idle)) {
        this.anims.create({
          key: direction.idle,
          frames: [{ key: TextureKey.PlayerNavigation, frame: direction.start }],
          frameRate: 1,
          repeat: -1,
        });
      }
    }
  }

  /** Register down/up/left/right four-frame action rows from one matching character sheet. */
  private buildDirectionalAction(
    action: 'chop' | 'dig' | 'mine' | 'sweep' | 'broom' | 'water' | 'sword',
    frameRate: number
  ): void {
    const textureKey = `player-${action}`;
    if (!this.textures.exists(textureKey)) return;
    const frameCount = this.textures.get(textureKey).frameTotal - 1;
    if (frameCount !== 16) {
      throw new Error(`PreloadScene: ${textureKey} requires 16 frames; found ${frameCount}`);
    }
    const directions = [
      { suffix: 'down', start: 0 },
      { suffix: 'up', start: 4 },
      { suffix: 'left', start: 8 },
      { suffix: 'right', start: 12 },
    ] as const;
    for (const direction of directions) {
      const key = `${textureKey}-${direction.suffix}`;
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(textureKey, {
          start: direction.start,
          end: direction.start + 3,
        }),
        frameRate,
        repeat: 0,
      });
    }
  }

}
