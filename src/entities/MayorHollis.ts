/**
 * MayorHollis — the day-1 welcome walk. On a brand-new adventure the mayor greets the keeper at the
 * farm's east road and walks them along the road to the shop door, waiting whenever the keeper
 * falls behind. At the door he explains the shop, then strolls back toward town and fades out.
 *
 * He is a service NPC (no friendship or romance record), drawn from the shared appearance sheet with
 * a small gold chain of office on top. He has no collider while walking, so he can never trap the
 * keeper. FarmScene owns when he appears and what happens when the walk ends; this class only owns
 * movement, facing and the walk animation. Scene shutdown destroys everything he owns.
 */
import Phaser from 'phaser';
import { assertAppearance } from '../config/Appearance';
import { FEET_CENTER_DY, TILE } from '../config/GameConfig';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';

/** Walking speed in px per second (a little slower than the keeper, so following is easy). */
const WALK_SPEED = 46;
/** The mayor waits while the keeper is farther than this from him (px). */
const WAIT_DISTANCE = 5 * TILE;

/** What the mayor is doing right now. */
export type MayorPhase = 'leading' | 'arrived' | 'leaving' | 'gone';

export class MayorHollis {
  /** Feet position in world px. */
  x: number;
  y: number;
  phase: MayorPhase = 'leading';
  private facing: 'down' | 'up' | 'left' | 'right' = 'left';
  private elapsedMs = 0;
  /** Remaining tile waypoints of the current walk (feet at tile centres). */
  private path: Array<{ tx: number; ty: number }>;
  private readonly root: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly texture: string;

  /**
   * Place the mayor and give him the walk to the shop.
   * @param scene the farm scene
   * @param start tile where he stands when the keeper arrives
   * @param path tile waypoints from `start` to his spot beside the shop door
   */
  constructor(private readonly scene: Phaser.Scene, start: { tx: number; ty: number }, path: Array<{ tx: number; ty: number }>) {
    if (path.length === 0) throw new Error('MayorHollis: the walk needs at least one waypoint');
    this.x = start.tx * TILE + TILE / 2;
    this.y = start.ty * TILE + TILE / 2;
    this.path = path.map(point => ({ ...point }));
    // Silver hair and beard, a wool vest over a cream shirt, slate trousers: the town's tidy, older mayor.
    const appearance = assertAppearance({ body: 'original', hairStyle: 'original', hat: 'none', facialHair: 'beard', shirtStyle: 'original',
      garment: 'vest', pantsStyle: 'cuffed', eyeColor: 'brown', skinTone: 'warm', hairColor: 'silver', shirtColor: 'cream', pantsColor: 'slate' });
    this.texture = AppearanceTextureSystem.forGame(scene.game).serviceTextureFor('mayor-hollis', appearance);
    this.root = scene.add.container(this.x, this.y).setName('mayor-hollis');
    const shadow = scene.add.ellipse(0, 1, 12, 5, 0x211c24, 0.2);
    this.sprite = scene.add.sprite(0, -FEET_CENTER_DY, this.texture, 0).setName('mayor-hollis-sprite');
    // Chain of office: a gold loop and medallion across the chest.
    const chain = scene.add.graphics();
    chain.fillStyle(0xd8a93a).fillRect(-4, -FEET_CENTER_DY - 2, 8, 1).fillRect(-1, -FEET_CENTER_DY - 1, 3, 3);
    this.root.add([shadow, this.sprite, chain]);
    this.root.setDepth(this.y);
  }

  /** Feet tile (for E interaction and tests). */
  tile(): { tx: number; ty: number } {
    return { tx: Math.floor(this.x / TILE), ty: Math.floor(this.y / TILE) };
  }

  /** Turn to face a world point (used when he talks to the keeper). */
  faceToward(px: number, py: number): void {
    const dx = px - this.x, dy = py - this.y;
    this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }

  /**
   * Walk back toward town along `path` and fade out at its end.
   * @param path tile waypoints for the stroll away
   */
  leave(path: Array<{ tx: number; ty: number }>): void {
    if (path.length === 0) throw new Error('MayorHollis: the walk away needs at least one waypoint');
    this.path = path.map(point => ({ ...point }));
    this.phase = 'leaving';
  }

  /**
   * Advance one frame.
   * @param deltaMs frame time
   * @param keeperX keeper feet x (world px)
   * @param keeperY keeper feet y (world px)
   * @param paused true while a dialogue or panel is open (he stands still)
   */
  update(deltaMs: number, keeperX: number, keeperY: number, paused: boolean): void {
    if (this.phase === 'gone') return;
    this.elapsedMs += deltaMs;
    let moving = false;
    const waiting = this.phase === 'leading' && Math.hypot(keeperX - this.x, keeperY - this.y) > WAIT_DISTANCE;
    if (!paused && !waiting && (this.phase === 'leading' || this.phase === 'leaving') && this.path.length > 0) {
      const next = this.path[0];
      const gx = next.tx * TILE + TILE / 2, gy = next.ty * TILE + TILE / 2;
      const dx = gx - this.x, dy = gy - this.y;
      const dist = Math.hypot(dx, dy);
      const step = (WALK_SPEED * deltaMs) / 1000;
      if (dist <= step) {
        this.x = gx;
        this.y = gy;
        this.path.shift();
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
      this.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      moving = true;
      if (this.path.length === 0) {
        if (this.phase === 'leading') this.phase = 'arrived';
        else this.fadeOut();
      }
    }
    if (waiting || this.phase === 'arrived') this.faceToward(keeperX, keeperY);
    const row = { down: 0, up: 1, left: 2, right: 3 }[this.facing];
    this.sprite.setTexture(this.texture, row * 4 + (moving ? Math.floor(this.elapsedMs / 160) % 4 : 0));
    this.root.setPosition(this.x, this.y).setDepth(this.y);
  }

  /** Fade away at the end of the walk back to town. */
  private fadeOut(): void {
    this.phase = 'gone';
    this.scene.tweens.add({ targets: this.root, alpha: 0, duration: 600, onComplete: () => this.root.destroy() });
  }
}
