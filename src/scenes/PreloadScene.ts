/**
 * PreloadScene — materializes every texture from the manifest (placeholders + real files), builds
 * animations, then launches the starting world scene (Farm) plus the parallel UIScene.
 *
 * Placeholder textures are created synchronously in preload(); real files are queued on the loader.
 * Animations are (re)built in create() once textures exist. Navigation and action strips use the
 * approved Sunnyside base+shorthair composite; generated north/south rotations are registered only
 * after they have been visually verified against that exact character.
 */
import Phaser from 'phaser';
import { AnimKey, SceneKey, TextureKey } from '../config/AssetKeys';
import { loadFromManifest } from '../assets/AssetLoader';
import { shouldShowMainMenu } from '../debug/RuntimeMode';

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
    this.buildStripAnim(TextureKey.Player, AnimKey.PlayerWalk, -1, 10);
    this.buildStripAnim(AnimKey.PlayerIdle, AnimKey.PlayerIdle, -1, 6);
    this.buildCardinalNavigation();
    // One-shot tool/combat actions. Scythe and sword use dedicated direction-aware strips; sharing
    // the generic ATTACK strip made a harvesting sweep read as a sword slash and collapsed vertical
    // facing back to the side pose.
    // why per-action rates: held input chains swings only when the anim finishes (BaseWorldScene
    // holdTimer + busy), so cadence = strip duration. The strips have 5..15 frames; each rate is
    // picked so a swing lands in ~420ms — the Stardew snap the m9/m15 regression gates encode.
    // Casting is NOT cadence-gated (rod has its own charge/reel flow) and stays slower for feel.
    const ACTION_RATES: Record<string, number> = {
      chop: 24, // 10 frames -> 417ms
      dig: 30, // 13 frames -> 433ms
      mine: 24, // 10 frames -> 417ms
      sweep: 10, // 4 facing-specific frames -> 400ms
      water: 12, // 5 frames -> 417ms
      cast: 18, // 15 frames -> 833ms, cinematic
      sword: 10, // 4 facing-specific frames -> 400ms
    };
    for (const [action, rate] of Object.entries(ACTION_RATES)) {
      if (action === 'sweep' || action === 'sword') {
        this.buildDirectionalAction(action, rate);
      } else {
        this.buildStripAnim(`player-${action}`, `player-${action}`, 0, rate);
      }
    }

    // Normal play begins at the title. Existing deterministic specs retain direct Farm boot unless
    // they explicitly request `?menu=1`, so every prior gameplay gate keeps its stable setup.
    if (shouldShowMainMenu()) {
      this.scene.start(SceneKey.MainMenu);
    } else {
      this.scene.start(SceneKey.Farm);
      this.scene.launch(SceneKey.UI);
    }
  }

  /** Register verified south/north navigation while retaining the approved side-view strips. */
  private buildCardinalNavigation(): void {
    if (!this.textures.exists(TextureKey.PlayerCardinal)) return;
    const texture = this.textures.get(TextureKey.PlayerCardinal);
    const frameCount = texture.frameTotal - 1;
    if (frameCount !== 8) {
      throw new Error(`PreloadScene: player-cardinal requires 8 frames; found ${frameCount}`);
    }
    const directions = [
      { walk: AnimKey.PlayerWalkDown, idle: AnimKey.PlayerIdleDown, start: 0 },
      { walk: AnimKey.PlayerWalkUp, idle: AnimKey.PlayerIdleUp, start: 4 },
    ] as const;
    for (const direction of directions) {
      if (!this.anims.exists(direction.walk)) {
        this.anims.create({
          key: direction.walk,
          frames: this.anims.generateFrameNumbers(TextureKey.PlayerCardinal, {
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
          frames: [{ key: TextureKey.PlayerCardinal, frame: direction.start }],
          frameRate: 1,
          repeat: -1,
        });
      }
    }
  }

  /** Register right/down/up four-frame action slices; left mirrors the right slice in Player. */
  private buildDirectionalAction(action: 'sweep' | 'sword', frameRate: number): void {
    const textureKey = `player-${action}`;
    if (!this.textures.exists(textureKey)) return;
    const frameCount = this.textures.get(textureKey).frameTotal - 1;
    if (frameCount !== 12) {
      throw new Error(`PreloadScene: ${textureKey} requires 12 frames; found ${frameCount}`);
    }
    const directions = [
      { suffix: 'right', start: 0 },
      { suffix: 'down', start: 4 },
      { suffix: 'up', start: 8 },
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

  /**
   * Register ONE animation spanning every frame of a single-row horizontal strip spritesheet.
   * No-op when the texture is missing or is a 1-frame placeholder, so the game runs identically
   * until real art lands (the manifest seam, CLAUDE.md Hard Rule 4).
   *
   * @param texKey  manifest texture key of the strip spritesheet
   * @param animKey animation key game code plays (e.g. 'player-walk', 'player-chop')
   * @param repeat  -1 = loop forever (walk/idle), 0 = play once (tool actions)
   * @param frameRate frames per second
   */
  private buildStripAnim(texKey: string, animKey: string, repeat: number, frameRate: number): void {
    if (!this.textures.exists(texKey)) return;
    const tex = this.textures.get(texKey);
    const frameCount = tex.frameTotal - 1; // frameTotal includes the base __BASE frame
    if (frameCount <= 1) return; // placeholder single frame — nothing to animate yet
    if (this.anims.exists(animKey)) return;

    this.anims.create({
      key: animKey,
      frames: this.anims.generateFrameNumbers(texKey, { start: 0, end: frameCount - 1 }),
      frameRate,
      repeat,
    });
  }
}
