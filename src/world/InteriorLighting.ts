/**
 * InteriorLighting draws light and shadow inside a room. It replaces the flat night tint indoors.
 *
 * How it works (the same on WebGL and on the Canvas renderer that tests use):
 * 1. A small darkness texture covers the room. Each frame it is filled with a dim violet, darker at night.
 * 2. Every light "erases" a soft round hole in that darkness, so the floor near a fire or candle shows through.
 * 3. A colored glow is added (additive blend) on top, so lit areas look warm, not just less dark.
 * 4. Fires and candles flicker: their reach, strength and flame art move a little every frame.
 *
 * The room's light list comes from src/config/InteriorLights.ts. BaseWorldScene creates one InteriorLighting per
 * indoor scene and calls update() each frame with the clock's darkness. All objects are scene-owned and die with
 * the scene; the two shared gradient textures stay in the game's texture manager for the next room.
 */
import Phaser from 'phaser';
import type { InteriorLight } from '../config/InteriorLights';

/** Darkness color for rooms: a warm violet, so shadows indoors feel cozy rather than outdoor blue. */
const AMBIENT_COLOR = 0x140b1e;
/** Darkness alpha by day (soft shade so lamps still read) and the extra amount added at full night. */
const DAY_AMBIENT = 0.1, NIGHT_AMBIENT = 0.56;
/** Same depth as the outdoor night tint: above every world object, below the UI scene. */
const DARKNESS_DEPTH = 1_000_000;
/** The darkness texture is drawn at 1/4 size and scaled up with smooth filtering: soft edges, tiny cost. */
const DARKNESS_SCALE = 4;
/** Size of the shared round gradient textures. */
const GRADIENT_SIZE = 128;
/** The white gradient used to cut holes in the darkness. */
const FALLOFF_KEY = 'interior-light-falloff';
/** How many world pixels of margin the darkness covers around the room, so the room edge never shows a seam. */
const MARGIN = 32;

/**
 * Create (once per game) a round gradient texture: full color in the middle, clear at the edge.
 * Also used by MainMenuScene for the soft glow over the painted title lanterns.
 * @param scene any scene of the game (textures are shared across scenes)
 * @param key texture key to create
 * @param color RGB color of the gradient
 */
export function ensureGradient(scene: Phaser.Scene, key: string, color: number): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, GRADIENT_SIZE, GRADIENT_SIZE);
  if (!texture) throw new Error(`InteriorLighting: could not create gradient texture ${key}`);
  const context = texture.getContext();
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const half = GRADIENT_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  // why: a slow start and a long tail look like real light; a straight line from 1 to 0 looks like a cone.
  gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(0.3, `rgba(${r},${g},${b},0.86)`);
  gradient.addColorStop(0.65, `rgba(${r},${g},${b},0.36)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
  texture.refresh();
  // why: the game runs with pixelArt (nearest filtering); a stretched gradient would show hard steps.
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/**
 * How bright a light is at this moment, about 0.8..1.08.
 * @param light the light (its kind picks the motion)
 * @param time scene time in ms
 * @param phase a fixed per-light offset so lights do not flicker in step
 */
function flicker(light: InteriorLight, time: number, phase: number): number {
  switch (light.kind) {
    case 'fire': return 0.88 + 0.07 * Math.sin(time / 83 + phase) + 0.05 * Math.sin(time / 31 + phase * 2.3);
    case 'candle': return 0.94 + 0.04 * Math.sin(time / 117 + phase) + 0.025 * Math.sin(time / 43 + phase * 3.1);
    case 'crystal': return 0.9 + 0.1 * Math.sin(time / 640 + phase);
    case 'lamp': return 1;
    case 'window': return 1;
  }
}

/** One live light: its data, its glow image, and (when it draws art) its animated flame. */
interface LiveLight {
  light: InteriorLight;
  phase: number;
  glow: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Graphics | null;
}

/** Owns one room's darkness texture, glows and flame art for the life of its scene. */
export class InteriorLighting {
  private readonly darkness: Phaser.GameObjects.RenderTexture;
  private readonly eraser: Phaser.GameObjects.Image;
  private readonly lights: LiveLight[];
  private readonly originX: number;
  private readonly originY: number;

  /**
   * Build the darkness layer, a glow per light, and any new art (lanterns, candles, the hearth).
   * @param scene the indoor scene that owns every created object
   * @param widthPx room width in world pixels
   * @param heightPx room height in world pixels
   * @param lights the room's lights (from src/config/InteriorLights.ts)
   */
  constructor(private readonly scene: Phaser.Scene, widthPx: number, heightPx: number, lights: readonly InteriorLight[]) {
    if (lights.length === 0) throw new Error(`InteriorLighting: ${scene.scene.key} has no lights`);
    const ids = new Set<string>();
    for (const light of lights) {
      if (ids.has(light.id)) throw new Error(`InteriorLighting: duplicate light id ${light.id}`);
      ids.add(light.id);
      if (light.radius <= 0 || light.strength < 0 || light.strength > 1 || light.glow < 0 || light.glow > 1) {
        throw new Error(`InteriorLighting: light ${light.id} has an invalid radius, strength or glow`);
      }
    }
    ensureGradient(scene, FALLOFF_KEY, 0xffffff);
    this.originX = -MARGIN;
    this.originY = -MARGIN;
    const width = Math.ceil((widthPx + MARGIN * 2) / DARKNESS_SCALE), height = Math.ceil((heightPx + MARGIN * 2) / DARKNESS_SCALE);
    this.darkness = scene.add.renderTexture(this.originX, this.originY, width, height)
      .setOrigin(0, 0).setScale(DARKNESS_SCALE).setDepth(DARKNESS_DEPTH).setName('interior-darkness');
    this.darkness.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.eraser = scene.make.image({ key: FALLOFF_KEY, add: false }).setOrigin(0.5, 0.5);
    this.lights = lights.map((light, index) => {
      const glowKey = `interior-light-glow-${light.color.toString(16).padStart(6, '0')}`;
      ensureGradient(scene, glowKey, light.color);
      const glow = scene.add.image(light.x, light.y, glowKey).setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DARKNESS_DEPTH + 1).setDisplaySize(light.radius * 2, light.radius * 2).setAlpha(0)
        .setName(`interior-glow-${light.id}`);
      return { light, phase: index * 1.7, glow, flame: this.drawArt(light) };
    });
  }

  /**
   * Draw the light's fixed art (lantern, candle, lamp or hearth) and return its flame for animation.
   * @param light the light whose art to draw
   * @returns the flame graphic (origin at the flame's base), or null when the room already draws the object
   */
  private drawArt(light: InteriorLight): Phaser.GameObjects.Graphics | null {
    const { x, y, depth } = light;
    const base = this.scene.add.graphics().setDepth(depth).setName(`interior-light-art-${light.id}`);
    if (light.art === 'none') {
      base.destroy();
      return null;
    }
    if (light.art === 'wall-lantern') {
      // An iron bracket on the wall holding a small glass lantern; the flame sits in the glass.
      base.fillStyle(0x2a1d1a, 0.45).fillRect(x - 6, y + 12, 13, 3);
      base.fillStyle(0x3a2a24).fillRect(x - 1, y - 12, 3, 4).fillRect(x - 6, y - 9, 13, 2).fillRect(x - 5, y + 6, 11, 3);
      base.fillStyle(0xf6c66a, 0.55).fillRect(x - 4, y - 7, 9, 13);
      base.fillStyle(0x3a2a24).fillRect(x - 5, y - 7, 1, 13).fillRect(x + 5, y - 7, 1, 13);
    } else if (light.art === 'table-candle') {
      // A brass dish with a stubby wax candle.
      base.fillStyle(0x2a1d1a, 0.35).fillEllipse(x + 1, y + 3, 14, 4);
      base.fillStyle(0xb98a3e).fillEllipse(x, y + 1, 12, 4);
      base.fillStyle(0xf2e6c8).fillRect(x - 2, y - 6, 4, 7);
      base.fillStyle(0xd8c7a0).fillRect(x + 1, y - 6, 1, 7);
    } else if (light.art === 'counter-lamp') {
      // An oil lamp: round base, glass chimney, flame inside.
      base.fillStyle(0x2a1d1a, 0.35).fillEllipse(x + 1, y + 4, 14, 4);
      base.fillStyle(0x8a5a34).fillEllipse(x, y + 1, 12, 6);
      base.fillStyle(0xf8e0a0, 0.5).fillRect(x - 3, y - 10, 6, 11);
      base.fillStyle(0xe8d0a0, 0.8).fillRect(x - 3, y - 11, 6, 2);
    } else {
      // The Wayfarer hearth: a stone fireplace set into the top wall, with a wooden mantel and logs.
      const left = x - 26, right = x + 26;
      base.fillStyle(0x2a1d1a, 0.4).fillRect(left - 2, y + 3, 56, 6);
      base.fillStyle(0x6e5d58).fillRect(left, y - 32, 52, 35);
      for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
        const sx = left + 2 + col * 13 + (row % 2) * 6, sy = y - 30 + row * 7;
        base.fillStyle(row % 2 === col % 2 ? 0x857169 : 0x7a6760).fillRect(sx, sy, Math.min(11, right - 2 - sx), 5);
      }
      base.fillStyle(0x6b3f27).fillRect(left - 5, y - 36, 62, 6);
      base.fillStyle(0x9a6038).fillRect(left - 5, y - 36, 62, 2);
      base.fillStyle(0x1a0f10).fillRoundedRect(x - 16, y - 20, 32, 22, { tl: 8, tr: 8, bl: 0, br: 0 });
      base.fillStyle(0x7a2f14, 0.75).fillRect(x - 15, y - 4, 30, 5);
      base.fillStyle(0x5a3520).fillRect(x - 13, y - 3, 12, 4).fillRect(x + 1, y - 3, 12, 4);
      base.fillStyle(0x8a5a34).fillRect(x - 13, y - 3, 12, 1).fillRect(x + 1, y - 3, 12, 1);
      base.fillStyle(0x7c6b62).fillRect(left - 3, y + 2, 58, 4);
    }
    return this.scene.add.graphics({ x, y: light.art === 'hearth' ? y - 3 : light.art === 'wall-lantern' ? y + 5 : light.art === 'counter-lamp' ? y - 2 : y - 6 })
      .setDepth(depth + 0.1).setName(`interior-light-flame-${light.id}`);
  }

  /**
   * Redraw the darkness, glows and flames for this frame.
   * @param time scene time in ms (drives flicker)
   * @param night 0..1 darkness from TimeSystem.darkness() (0 = midday, 1 = full night)
   */
  update(time: number, night: number): void {
    if (night < 0 || night > 1) throw new Error(`InteriorLighting: darkness ${night} is outside 0..1`);
    const ambient = DAY_AMBIENT + NIGHT_AMBIENT * night;
    this.darkness.clear();
    this.darkness.fill(AMBIENT_COLOR, ambient);
    for (const live of this.lights) {
      const { light } = live;
      const amount = flicker(light, time, live.phase);
      // why: windows bring daylight in by day and only faint moonlight at night; flames work the other way round.
      const strength = light.kind === 'window' ? light.strength * (1 - 0.6 * night) : light.strength * Math.min(1, amount);
      const radius = light.radius * (light.kind === 'window' ? 1 : 0.94 + 0.06 * amount);
      this.eraser.setPosition((light.x - this.originX) / DARKNESS_SCALE, (light.y - this.originY) / DARKNESS_SCALE)
        .setDisplaySize(radius * 2 / DARKNESS_SCALE, radius * 2 / DARKNESS_SCALE).setAlpha(strength);
      this.darkness.erase(this.eraser);
      const glow = light.kind === 'window' ? light.glow * (1 - night) : light.glow * (0.3 + 0.7 * night) * amount;
      live.glow.setAlpha(glow).setDisplaySize(radius * 2, radius * 2);
      if (live.flame) this.drawFlame(live.flame, light, amount);
    }
  }

  /**
   * Redraw one flame shape. A fire is wide with several tongues; candles and lamps have one small teardrop.
   * @param flame the flame graphic (its position is the flame's base)
   * @param light the light that owns the flame
   * @param amount current flicker, about 0.8..1.08
   */
  private drawFlame(flame: Phaser.GameObjects.Graphics, light: InteriorLight, amount: number): void {
    flame.clear();
    const lift = (amount - 0.9) * 10;
    if (light.art === 'hearth') {
      for (const [dx, h, w] of [[-9, 11, 7], [0, 15, 9], [9, 10, 7]] as const) {
        const height = h + lift * (dx === 0 ? 1.4 : 0.8);
        flame.fillStyle(0xe2561c).fillTriangle(dx - w / 2, 0, dx + w / 2, 0, dx + lift * 0.3, -height);
        flame.fillStyle(0xffb347).fillTriangle(dx - w / 4, 0, dx + w / 4, 0, dx, -height * 0.62);
      }
      flame.fillStyle(0xfff0a0).fillRect(-6, -2, 12, 2);
      return;
    }
    const height = 5 + lift * 0.5;
    flame.fillStyle(0xffa63a).fillTriangle(-1.5, 0, 1.5, 0, lift * 0.1, -height);
    flame.fillStyle(0xfff1b0).fillRect(-0.5, -height * 0.55, 1, height * 0.5);
  }
}
