/**
 * PaintedRoomRenderer — draws one hand-painted room in place of the tile art.
 *
 * A painted room is one or two textures of the same size, built by an art script (for the dungeon rooms:
 * scripts/pack-dungeon-rooms-art.py; for the Gate Plaza: scripts/pack-gate-plaza-art.py):
 *  - the backdrop: the whole painting, drawn flat under every actor;
 *  - the front layer (optional): clear except for tall things (pillars, braziers). Each tall thing is
 *    drawn as its own cropped piece with a y-depth at its base, so the keeper walks behind a pillar's
 *    top and in front of its foot, like any other world object.
 * Painted flames get a soft additive glow that flickers, so the still painting feels lit.
 * Painted motion (a portal's swirl, falling water, bubbling sludge, lava) plays as looping
 * spritesheets laid exactly over their part of the backdrop; the art script cuts them from the
 * painting itself. Place sounds (AmbientSound) start with the room and fade with the keeper's distance.
 * The scene can lay more on top later: addAnimation (e.g. an exit that opens when a boss falls) and
 * addPatch (a still image such as stone walling up a doorway). The renderer owns these too.
 *
 * The art is authored at `texelsPerPixel` texels per world pixel (2 for the dungeon), so a 960 px
 * wide painting covers 480 world px = 30 tiles. Textures keep the game's nearest filtering: each
 * texel is a crisp block of screen pixels (the art scripts sharpen the soft paintings for this). Walls and floor rules are NOT here: the scene's
 * MapData owns collision, and the art module that feeds this renderer keeps the two in step.
 *
 * Lifecycle: the scene creates one PaintedRoomRenderer per room it shows and calls destroy() when
 * it leaves that room. Every object is owned by the scene, and a scene shutdown calls destroy()
 * too, so the room's sounds never outlive it.
 */
import Phaser from 'phaser';
import { AmbientSoundscape, type AmbientKind, type AmbientListener } from '../systems/AmbientSound';
import { prefersReducedMotion } from '../ui/CozyTheme';
import { ensureGradient } from './InteriorLighting';
import { FRONT_BOX_KEY, type FrontBox } from '../debug/WallsDebugView';

/** A tall painted thing the keeper can walk behind. Box and base are in texture texels. */
export interface PaintedPiece {
  /** Object name prefix for debugging, e.g. 'pillar-top-left'. */
  readonly name: string;
  /** Box that holds the piece's front-layer pixels. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Texel row where the piece meets the floor; actors whose feet are above it are drawn behind. */
  readonly baseY: number;
}

/** One painted flame that gets a live glow. Centre is in texture texels; size is the glow diameter in world px. */
export interface PaintedLight {
  readonly kind: 'torch' | 'brazier';
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * A looping spritesheet laid over part of the backdrop (built by the room's art script).
 * x, y: top-left of the box in texture texels; frameWidth, frameHeight: the box size in texels;
 * frames: frame count in the sheet; fps: playback speed.
 */
export interface PaintedAnimation {
  readonly name: string;
  readonly texture: string;
  readonly x: number;
  readonly y: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frames: number;
  readonly fps: number;
}

/** A place sound: centre in texture texels, hearing radius in world px. */
export interface PaintedSound {
  readonly kind: AmbientKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Everything the renderer needs to draw one painted room. */
export interface PaintedRoomArt {
  /** Texture key of the full painting. */
  readonly backdrop: string;
  /**
   * Texture key of the front layer (same size as the backdrop, clear outside the pieces), or null for a
   * room with nothing to walk behind (then pieces must be empty).
   */
  readonly front: string | null;
  /** Texture size in texels; the renderer checks the loaded textures match. */
  readonly widthTexels: number;
  readonly heightTexels: number;
  /** Texels per world pixel. */
  readonly texelsPerPixel: number;
  readonly pieces: readonly PaintedPiece[];
  readonly lights: readonly PaintedLight[];
  /** Painted motion, drawn just above the backdrop. */
  readonly animations: readonly PaintedAnimation[];
  readonly sounds: readonly PaintedSound[];
}

/**
 * How one room shows the shared painting.
 *  - tint: multiplied over the backdrop and front pieces (0xffffff = as painted);
 *  - glow: additive glow colour per light kind.
 */
export interface PaintedRoomStyle {
  readonly tint: number;
  readonly glow: Readonly<Record<PaintedLight['kind'], number>>;
}

/** Depth of the backdrop: above the hidden tile terrain (-15..-13), below rugs, decor and actors. */
export const PAINTED_BACKDROP_DEPTH = -11.5;
/** Painted motion sits on the backdrop it redraws, still below rugs, decor and actors. */
const ANIMATION_DEPTH = PAINTED_BACKDROP_DEPTH + 0.1;
/** Glows sit above every actor (y-depths) so nearby actors are lit too, and below the night tint (1_000_000). */
const GLOW_DEPTH = 900_000;
/** Glow strength at rest, and how far it dims at the bottom of a flicker. */
const GLOW_ALPHA = 0.42, GLOW_ALPHA_LOW = 0.26;

/**
 * Draws one painted room at a world origin, and removes it again on destroy().
 */
export class PaintedRoomRenderer {
  /** Every object this room created, so destroy() can remove exactly these. */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  /** The room's place sounds; null once destroyed. */
  private soundscape: AmbientSoundscape | null;
  /** Set by destroy(); later addAnimation/addPatch calls are lifecycle bugs and throw. */
  private destroyed = false;
  /** Bound once so the same function can be added to and removed from the scene's events. */
  private readonly onUpdate = (): void => {
    // why: destroy() removes this listener before dropping the soundscape, so a missing one is a lifecycle bug.
    if (!this.soundscape) throw new Error('PaintedRoomRenderer: update after destroy');
    this.soundscape.update();
  };
  private readonly onShutdown = (): void => this.destroy();
  /** World px per texel (1 / texelsPerPixel). */
  private readonly scale: number;
  /** True when the player asked for reduced motion: animations hold their first frame. */
  private readonly reducedMotion: boolean;

  /**
   * Draw the room now.
   * @param scene the world scene that owns the objects
   * @param art the painted room's textures, pieces and lights
   * @param style tint and glow colours for this room
   * @param originX world x of the painting's left edge
   * @param originY world y of the painting's top edge
   * @param name prefix for object names (tests and debugging find pieces by it)
   * @param listener the keeper: place sounds get louder as it walks closer
   * @throws when a texture is missing or its size does not match the art data
   */
  constructor(
    private readonly scene: Phaser.Scene,
    art: PaintedRoomArt,
    private readonly style: PaintedRoomStyle,
    private readonly originX: number,
    private readonly originY: number,
    private readonly name: string,
    listener: AmbientListener,
  ) {
    const frontKey = art.front;
    if (frontKey === null && art.pieces.length > 0) {
      throw new Error(`PaintedRoomRenderer: ${name} has ${art.pieces.length} front pieces but no front texture`);
    }
    for (const key of frontKey === null ? [art.backdrop] : [art.backdrop, frontKey]) {
      if (!scene.textures.exists(key)) throw new Error(`PaintedRoomRenderer: texture ${key} is not loaded`);
      const source = scene.textures.get(key).getSourceImage();
      if (source.width !== art.widthTexels || source.height !== art.heightTexels) {
        throw new Error(`PaintedRoomRenderer: ${key} is ${source.width}x${source.height}, expected ${art.widthTexels}x${art.heightTexels}`);
      }
    }
    const scale = 1 / art.texelsPerPixel;
    this.scale = scale;
    this.reducedMotion = prefersReducedMotion();

    this.objects.push(scene.add.image(originX, originY, art.backdrop).setOrigin(0).setScale(scale)
      .setTint(style.tint).setDepth(PAINTED_BACKDROP_DEPTH).setName(`${name}-backdrop`));

    // why: frontKey is null only when pieces is empty (checked above), so this loop never reads it as null.
    if (frontKey !== null) for (const piece of art.pieces) {
      // why: a cropped image keeps its full-size frame, so it is placed at the room origin like the backdrop
      // and only the crop box draws. Its depth is the world row of its base, matching actor y-depths.
      const front = scene.add.image(originX, originY, frontKey).setOrigin(0).setScale(scale)
        .setCrop(piece.x, piece.y, piece.w, piece.h).setTint(style.tint)
        .setDepth(originY + piece.baseY * scale).setName(`${name}-${piece.name}`);
      // why: the walls debug view (F9 in test builds) outlines each piece and its base line from this box.
      const box: FrontBox = {
        x: originX + piece.x * scale, y: originY + piece.y * scale, w: piece.w * scale, h: piece.h * scale,
        baseY: originY + piece.baseY * scale,
      };
      front.setData(FRONT_BOX_KEY, box);
      this.objects.push(front);
    }

    for (const anim of art.animations) this.addAnimation(anim);
    const reducedMotion = this.reducedMotion;

    art.lights.forEach((light, index) => {
      const key = `painted-room-glow-${style.glow[light.kind].toString(16).padStart(6, '0')}`;
      ensureGradient(scene, key, style.glow[light.kind]);
      const glow = scene.add.image(originX + light.x * scale, originY + light.y * scale, key)
        .setDisplaySize(light.size, light.size).setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(GLOW_ALPHA).setDepth(GLOW_DEPTH).setName(`${name}-glow-${index}`);
      this.objects.push(glow);
      if (reducedMotion) return;
      // why: torches flicker fast and braziers breathe slowly; per-light durations keep them out of step.
      const duration = (light.kind === 'torch' ? 380 : 1200) + index * 97;
      scene.tweens.add({
        targets: glow, alpha: GLOW_ALPHA_LOW, scale: glow.scale * 0.92, duration,
        ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
      });
    });

    this.soundscape = new AmbientSoundscape(art.sounds.map((sound) => ({
      kind: sound.kind, x: originX + sound.x * scale, y: originY + sound.y * scale, radius: sound.radius,
    })), listener);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
  }

  /** How many place sounds are playing (0 in test mode, where audio is off). */
  get soundsPlaying(): number {
    return this.soundscape ? this.soundscape.playing : 0;
  }

  /**
   * Lay one looping spritesheet over its box of the backdrop. The renderer owns it (destroy() removes it).
   * With reduced motion it shows frame 0 only (that frame also covers the still painted version).
   * @param anim the sheet and its box, in texels of this room's painting
   * @returns the sprite, already added to the scene
   * @throws when the renderer is destroyed, or the sheet is missing or its frames do not match the art data
   */
  addAnimation(anim: PaintedAnimation): Phaser.GameObjects.Sprite {
    if (this.destroyed) throw new Error(`PaintedRoomRenderer: addAnimation(${anim.name}) after destroy`);
    const { scene, scale, style, originX, originY, name } = this;
    if (!scene.textures.exists(anim.texture)) throw new Error(`PaintedRoomRenderer: animation texture ${anim.texture} is not loaded`);
    const texture = scene.textures.get(anim.texture);
    // why: Phaser adds a '__BASE' frame for the whole sheet, so a sheet of N frames has N + 1.
    const first = texture.get(0);
    if (texture.frameTotal - 1 !== anim.frames || first.width !== anim.frameWidth || first.height !== anim.frameHeight) {
      throw new Error(`PaintedRoomRenderer: ${anim.texture} has ${texture.frameTotal - 1} frames of ${first.width}x${first.height}, ` +
        `expected ${anim.frames} of ${anim.frameWidth}x${anim.frameHeight}`);
    }
    const sprite = scene.add.sprite(originX + anim.x * scale, originY + anim.y * scale, anim.texture, 0)
      .setOrigin(0).setScale(scale).setTint(style.tint).setDepth(ANIMATION_DEPTH).setName(`${name}-${anim.name}`);
    this.objects.push(sprite);
    if (this.reducedMotion) return sprite;
    const key = `painted-${anim.texture}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(anim.texture, {}), frameRate: anim.fps, repeat: -1 });
    }
    sprite.play(key);
    return sprite;
  }

  /**
   * Lay one still image over the backdrop (e.g. stone walling up a doorway), at the animation depth.
   * The renderer owns it (destroy() removes it).
   * @param patchName object name suffix (the object is named `${name}-${patchName}`)
   * @param texture texture key of the image, authored at this room's texels per pixel
   * @param x left edge in texels of this room's painting
   * @param y top edge in texels of this room's painting
   * @returns the image, already added to the scene
   * @throws when the renderer is destroyed or the texture is missing
   */
  addPatch(patchName: string, texture: string, x: number, y: number): Phaser.GameObjects.Image {
    if (this.destroyed) throw new Error(`PaintedRoomRenderer: addPatch(${patchName}) after destroy`);
    if (!this.scene.textures.exists(texture)) throw new Error(`PaintedRoomRenderer: patch texture ${texture} is not loaded`);
    const image = this.scene.add.image(this.originX + x * this.scale, this.originY + y * this.scale, texture)
      .setOrigin(0).setScale(this.scale).setTint(this.style.tint).setDepth(ANIMATION_DEPTH)
      .setName(`${this.name}-${patchName}`);
    this.objects.push(image);
    return image;
  }

  /** Remove every object (and its tweens) and stop every sound this room created. Safe to call twice. */
  destroy(): void {
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    if (this.soundscape) this.soundscape.destroy();
    this.soundscape = null;
    for (const object of this.objects) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.objects.length = 0;
  }
}
