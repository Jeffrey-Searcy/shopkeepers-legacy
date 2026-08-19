/**
 * Chest — a static storage object on the map. Interacting (E) while facing it stashes the player's
 * whole bag into shared chest storage (GameState.chest). A minimal but complete V1 storage loop;
 * a full transfer UI can come later. Uses a logical texture key per the asset seam.
 */
import Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { TILE, tileToWorld } from '../config/GameConfig';

export class Chest extends Phaser.Physics.Arcade.Image {
  readonly tx: number;
  readonly ty: number;

  constructor(scene: Phaser.Scene, tx: number, ty: number) {
    const { x, y } = tileToWorld(tx, ty);
    // Bottom-anchored on its tile, displayed at EXACTLY one tile wide (Stardew chests occupy one
    // tile). The raw art is 32px — drawn at full size it overhung its collision tile by 8px on
    // every side, which read as "walking through part of the chest".
    super(scene, x, y + TILE / 2, TextureKey.Chest);
    this.setOrigin(0.5, 1);
    // Stardew chest proportions: ~1.25 tiles wide, ~1.6 tall (≈0.7 of the character's height) so
    // it reads substantial, while COLLISION stays exactly one tile (2px art overhang per side is
    // imperceptible — the earlier 16px version read "very tiny").
    this.setDisplaySize(TILE + 4, TILE + 10);
    scene.add.existing(this);
    scene.physics.add.existing(this, true); // static: blocks the player
    this.tx = tx;
    this.ty = ty;
    // Collision = exactly one tile, positioned explicitly (updateFromGameObject would reset the
    // body to the full art — a 2x2-tile invisible wall).
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(TILE, TILE, false);
    body.position.set(this.x - TILE / 2, this.y - TILE);
    body.updateCenter();
  }
}
