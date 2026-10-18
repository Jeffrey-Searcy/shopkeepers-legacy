/**
 * Prop — a generic placed world object (workbench, furniture, shelves...). Static image,
 * bottom-anchored, with an explicit collision footprint anchored to its bottom edge. Most props
 * use a one-tile base; large solid objects can opt into their full rendered width and height.
 * Multi-tile props pass their CENTER tile as (tx,ty). Interactivity is handled by the scene.
 */
import Phaser from 'phaser';
import { TILE, tileToWorld } from '../config/GameConfig';

/** A static placed object whose grid body stays independent of its native image orientation. */
export class Prop extends Phaser.Physics.Arcade.Image {
  readonly tx: number;
  readonly ty: number;

  /** Create native art at a center tile; angle turns pixels only, while body dimensions remain tiles. */
  constructor(
    scene: Phaser.Scene,
    texKey: string,
    tx: number,
    ty: number,
    displayW = TILE + 4,
    displayH = TILE + 8,
    bodyWTiles = 1,
    bodyHTiles = 1,
    frame?: string,
    angle: 0 | 90 = 0
  ) {
    const { x, y } = tileToWorld(tx, ty);
    super(scene, x, y + TILE / 2, texKey, frame);
    // At90°, right-center rotates onto bottom-center. Set this before assigning the static body.
    this.setOrigin(angle === 90 ? 1 : 0.5, angle === 90 ? 0.5 : 1).setAngle(angle);
    this.setDisplaySize(displayW, displayH);
    this.setDepth(this.y);
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    this.tx = tx;
    this.ty = ty;
    const bodyW = TILE * bodyWTiles;
    const bodyH = TILE * bodyHTiles;
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(bodyW, bodyH, false);
    // setOffset moves and reindexes the static body. Direct position writes leave stale tree bounds.
    body.setOffset(body.offset.x + this.x - bodyW / 2 - body.x,
      body.offset.y + this.y - bodyH - body.y);
  }
}
