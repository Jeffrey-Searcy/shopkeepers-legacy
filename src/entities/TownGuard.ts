/**
 * TownGuard renders Captain Maren as a service NPC without adding a romance or social-bond record.
 * The actor owns one solid tile, a gentle idle motion, and short authored public dialogue.
 */
import Phaser from 'phaser';
import { assertAppearance } from '../config/Appearance';
import { FEET_CENTER_DY, TILE } from '../config/GameConfig';
import { GameState } from '../state/GameState';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';

/** Service-only town watch actor. Scene shutdown destroys every owned display object and tween. */
export class TownGuard {
  readonly collider: Phaser.GameObjects.Rectangle;
  private readonly root: Phaser.GameObjects.Container;
  private readonly tx: number;
  private readonly ty: number;

  /** Create Captain Maren at one whole-tile feet anchor. */
  constructor(scene: Phaser.Scene, tx: number, ty: number) {
    this.tx = tx;
    this.ty = ty;
    const x = tx * TILE + TILE / 2, y = ty * TILE + TILE;
    this.root = scene.add.container(x, y).setDepth(y).setName('town-guard-captain-maren');
    const shadow = scene.add.ellipse(0, 1, 12, 5, 0x211c24, 0.2);
    // Watch helmet and the town's crimson tabard over a work shirt: the captain reads as the law from afar.
    const appearance = assertAppearance({ body: 'original', hairStyle: 'tousled', hat: 'helmet', facialHair: 'none', shirtStyle: 'original',
      garment: 'tabard', pantsStyle: 'cuffed', eyeColor: 'grey', skinTone: 'brown', hairColor: 'black', shirtColor: 'blue', pantsColor: 'slate' });
    const texture = AppearanceTextureSystem.forGame(scene.game).serviceTextureFor('captain-maren', appearance);
    const sprite = scene.add.sprite(0, -FEET_CENTER_DY, texture, 0).setName('town-guard-sprite');
    const spear = scene.add.graphics();
    spear.fillStyle(0xa77b4d).fillRect(11, -39, 2, 39);
    spear.fillStyle(0xceb072).fillTriangle(12, -44, 9, -38, 15, -38);
    this.root.add([shadow, sprite, spear]);
    scene.tweens.add({ targets: this.root, y: y - 1, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.collider = scene.add.rectangle(x, y - TILE / 2, TILE, TILE, 0, 0).setName('town-guard-collider');
    scene.physics.add.existing(this.collider, true);
  }

  /** Open one authored guard line when the player addresses Captain Maren's tile. */
  interact(tx: number, ty: number): boolean {
    if (tx !== this.tx || ty !== this.ty) return false;
    GameState.instance.dialogue = { kind: 'message', name: 'Captain Maren',
      line: 'The watch house keeps the north road safe. Respect people’s boundaries, and you will have no trouble with us.' };
    return true;
  }
}
