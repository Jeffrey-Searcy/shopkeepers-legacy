/**
 * WallsDebugView — a developer overlay that shows where the keeper can and cannot walk, and where it passes
 * behind things, drawn over the world in test and dev builds (F9, or WALLS in the Growth Lab panel).
 *
 * Why: collision and drawing order on the painted maps are traced by hand against the painting. Seeing the
 * walls and the front pieces on top of the art is the quickest way to find a wall that is too big, a gap that
 * is missing, or a front piece that is cut too wide.
 *
 * It draws:
 * - red: the keeper's walls (MapData.fineSolid cells on maps that have them, else solid tiles);
 * - cyan outline: warp zones;
 * - yellow outline: each front piece's box (an image tagged FRONT_BOX_KEY by PaintedRoomRenderer), with a
 *   magenta line at its base: the keeper's feet below that line draw in front of the piece, above it behind;
 * - green outline: the keeper's collision body (the feet box), redrawn every frame.
 *
 * Lifecycle: the owning world scene makes one per scene instance, calls update() every frame and destroy() on
 * shutdown. Nothing is drawn until toggle() turns it on.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import type { MapData } from '../world/MapDef';
import { FINE_CELL } from '../world/FineCollision';

/** Data key under which PaintedRoomRenderer stores a front piece's box (FrontBox) on its image. */
export const FRONT_BOX_KEY = 'frontBox';

/** A front piece's box in world px: x, y, w, h is the drawn area, baseY the row its depth sorts at. */
export interface FrontBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly baseY: number;
}

/** why: above every world object (actor depths are world rows, under 10 000 on every map). */
const OVERLAY_DEPTH = 1_000_000;

/**
 * The overlay for one world scene (see the file comment).
 */
export class WallsDebugView {
  /** The still parts (walls, warps, front pieces); null while off. */
  private still: Phaser.GameObjects.Graphics | null = null;
  /** The keeper's feet box, redrawn each frame; null while off. */
  private body: Phaser.GameObjects.Graphics | null = null;

  /**
   * @param scene the world scene to draw in
   * @param map the scene's map (walls and warps)
   * @param player the keeper, whose arcade body is outlined
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: MapData,
    private readonly player: Phaser.Physics.Arcade.Sprite,
  ) {}

  /** True while the overlay shows. */
  get on(): boolean {
    return this.still !== null;
  }

  /** Show the overlay when it is off, hide it when it is on. */
  toggle(): void {
    if (this.on) {
      this.destroy();
      return;
    }
    this.still = this.scene.add.graphics().setDepth(OVERLAY_DEPTH).setName('walls-debug');
    this.body = this.scene.add.graphics().setDepth(OVERLAY_DEPTH + 1).setName('walls-debug-body');
    this.drawStill(this.still);
    this.update();
  }

  /** Redraw the keeper's feet box; does nothing while off. */
  update(): void {
    if (!this.body) return;
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.clear().lineStyle(1, 0x00ff66, 1).strokeRect(b.x, b.y, b.width, b.height);
  }

  /** Remove the overlay's objects (safe to call while off). */
  destroy(): void {
    this.still?.destroy();
    this.body?.destroy();
    this.still = null;
    this.body = null;
  }

  /**
   * Draw the walls, warps and front pieces once.
   * @param g the graphics to draw into
   * @throws when a tagged front piece has no valid box (a renderer bug)
   */
  private drawStill(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0xff2020, 0.38);
    const fine = this.map.fineSolid;
    // why: rows of walls are drawn as runs, so ~100k cells become a few thousand rectangles.
    const grid = fine ?? this.map.solid;
    const cell = fine ? FINE_CELL : TILE;
    grid.forEach((row, y) => {
      let start = -1;
      for (let x = 0; x <= row.length; x++) {
        const wall = x < row.length && row[x];
        if (wall && start < 0) start = x;
        if (!wall && start >= 0) {
          g.fillRect(start * cell, y * cell, (x - start) * cell, cell);
          start = -1;
        }
      }
    });

    g.lineStyle(1, 0x00e5ff, 1);
    for (const w of this.map.warps) g.strokeRect(w.tx * TILE, w.ty * TILE, w.w * TILE, w.h * TILE);

    for (const child of this.scene.children.list) {
      const box = child.getData?.(FRONT_BOX_KEY) as FrontBox | undefined;
      if (box === undefined) continue;
      if (![box.x, box.y, box.w, box.h, box.baseY].every(Number.isFinite)) {
        throw new Error(`WallsDebugView: ${child.name} has a bad front box`);
      }
      g.lineStyle(1, 0xffe14a, 0.9).strokeRect(box.x, box.y, box.w, box.h);
      g.lineStyle(1, 0xff3df5, 1).lineBetween(box.x - 2, box.baseY, box.x + box.w + 2, box.baseY);
    }
  }
}
