/**
 * Prop — a generic placed world object (workbench, furniture, shelves...). Static image,
 * bottom-anchored, with an explicit collision footprint anchored to its bottom edge. Most props
 * use a one-tile base; large solid objects can opt into their full rendered width and height.
 * Multi-tile props pass their CENTER tile as (tx,ty). Interactivity is handled by the scene.
 */
import Phaser from 'phaser';
import { TILE, tileToWorld } from '../config/GameConfig';

export class Prop extends Phaser.Physics.Arcade.Image {
  readonly tx: number;
  readonly ty: number;

  constructor(
    scene: Phaser.Scene,
    texKey: string,
    tx: number,
    ty: number,
    displayW = TILE + 4,
    displayH = TILE + 8,
    bodyWTiles = 1,
    bodyHTiles = 1
  ) {
    const { x, y } = tileToWorld(tx, ty);
    super(scene, x, y + TILE / 2, texKey);
    this.setOrigin(0.5, 1);
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
    body.position.set(this.x - bodyW / 2, this.y - bodyH);
    body.updateCenter();
  }
}
