/**
 * ResourceNode — a harvestable object on the map (tree / stump / rock / weed).
 *
 * Placed from MapData.objects (trees may be overridden to sapling/small/stump via
 * GameState.treeStages — see TreeSystem). COLLISION IS EXACTLY ONE TILE at the node's base —
 * never the art bounds. (A previous version called StaticBody.updateFromGameObject() after
 * setSize, which resets the body to the full sprite bounds — so trees collided with their whole
 * 48x64 canopy. That was the "invisible walls" bug.)
 *
 * Nodes take multiple hits before dropping (Stardew feel); hp + drop item/amount come from the
 * NODE_DEF data table in Items.ts (per tree stage: sapling 1 hit/0 wood ... full 3 hits/5 wood,
 * leftover stump 2 hits/2 wood). Each hit plays a small shake+flash; depletion is handled by
 * InteractionSystem.
 */
import Phaser from 'phaser';
import { NODE_DEF, type ItemId, type TreeStage } from '../config/Items';
import { TILE, tileToWorld } from '../config/GameConfig';

export class ResourceNode extends Phaser.Physics.Arcade.Image {
  readonly kind: string;
  /** Growth stage — only meaningful for kind 'tree' (undefined otherwise). */
  readonly stage?: TreeStage;
  readonly tx: number;
  readonly ty: number;
  /** Remaining hits before this node drops its resource. */
  hp: number;
  /** What lands on the ground when the node is cleared. */
  readonly drop: ItemId;
  readonly dropAmount: number;

  constructor(scene: Phaser.Scene, kind: string, tx: number, ty: number, stage?: TreeStage) {
    // Trees resolve their def per growth stage; every other kind is a direct lookup.
    const defKey = kind === 'tree' ? `tree:${stage ?? 'full'}` : kind;
    const def = NODE_DEF[defKey];
    if (!def) throw new Error(`ResourceNode: unknown node def "${defKey}"`);
    if (!scene.textures.exists(def.tex)) {
      throw new Error(`ResourceNode: texture "${def.tex}" missing (manifest entry?)`);
    }
    const { x, y } = tileToWorld(tx, ty);
    // Bottom-anchored so a tall tree's base sits on its tile.
    super(scene, x, y + TILE / 2, def.tex);
    this.setOrigin(0.5, 1);
    // Display size comes from the NODE_DEF config when set (never from art dimensions); legacy
    // art without dw/dh draws native.
    if (def.dw !== undefined && def.dh !== undefined) this.setDisplaySize(def.dw, def.dh);
    scene.add.existing(this);
    scene.physics.add.existing(this, true);
    this.kind = kind;
    this.stage = kind === 'tree' ? (stage ?? 'full') : undefined;
    this.tx = tx;
    this.ty = ty;
    this.hp = def.hp;
    this.drop = def.drop;
    this.dropAmount = def.amount;

    // Collision = the base tile only, positioned explicitly. Do NOT call updateFromGameObject()
    // afterwards — it would reset the body to the full art bounds (the invisible-wall bug).
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(TILE, TILE, false);
    body.position.set(this.x - TILE / 2, this.y - TILE);
    body.updateCenter();
  }

  /**
   * Apply one tool hit: shake + flash feedback, decrement hp. Returns true when depleted (the
   * caller removes the node and grants the drop).
   */
  takeHit(): boolean {
    this.hp -= 1;
    // Quick wobble + white flash — reads as "impact" without particles.
    this.scene.tweens.add({
      targets: this,
      x: { from: this.x - 2, to: this.x },
      duration: 90,
      ease: 'Sine.InOut',
      yoyo: true,
    });
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => this.clearTint());
    return this.hp <= 0;
  }
}
