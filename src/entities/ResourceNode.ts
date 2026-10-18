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
 * leftover stump 2 hits/2 wood). Each hit plays a wobble, warm flash and chips (NodeBreakFx); depletion is
 * handled by InteractionSystem, and BaseWorldScene plays the fall/shatter/sink effect as the node goes.
 *
 * Painted maps (the Beach) cut their full trees and rocks out of the painting: such a node gets a
 * PaintedNodeArt frame and draws those exact painted pixels in their painted place, at the painting's
 * scale. Its collision, hp and drops stay the normal one-tile node's.
 */
import Phaser from 'phaser';
import { NODE_DEF, type ItemId, type TreeStage } from '../config/Items';
import { TILE, tileToWorld } from '../config/GameConfig';
import { PINE_ART } from '../config/Trees';
import { SceneKey } from '../config/AssetKeys';
import { TreeSystem } from '../systems/TreeSystem';
import type { PaintedNodeArt } from '../world/MapDef';
import { SettingsSystem } from '../systems/SettingsSystem';
import { hitFx } from './NodeBreakFx';

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

  /**
   * Create a staged, species-correct resource sprite; preserve the native one-tile trunk collider.
   * @param scene the world scene that owns the node
   * @param kind node kind ('tree', 'stump', 'rock', 'weed')
   * @param tx tile x of the node's base
   * @param ty tile y of the node's base
   * @param stage growth stage (trees only)
   * @param painted the node's frame in a painted map's atlas; only for a rock or a full tree
   * @throws when the node def or texture is missing, or painted art is given for another kind or stage,
   *   or its frame lies outside the atlas
   */
  constructor(scene: Phaser.Scene, kind: string, tx: number, ty: number, stage?: TreeStage, painted?: PaintedNodeArt) {
    // Trees resolve their def per growth stage; every other kind is a direct lookup.
    const defKey = kind === 'tree' ? `tree:${stage ?? 'full'}` : kind;
    const def = NODE_DEF[defKey];
    if (!def) throw new Error(`ResourceNode: unknown node def "${defKey}"`);
    const pine = kind === 'tree' && TreeSystem.speciesAt(scene.scene.key as SceneKey, tx, ty) === 'pine'
      ? PINE_ART[stage === undefined ? 'full' : stage] : null;
    // why: the painting only holds a grown tree or a rock; a sapling, young tree or stump drawn from it would
    // show a full tree, so those stages must come here without painted art.
    if (painted && kind !== 'rock' && !(kind === 'tree' && (stage ?? 'full') === 'full')) {
      throw new Error(`ResourceNode: painted art is only for a rock or a full tree (got ${defKey} at ${tx},${ty})`);
    }
    const texture = painted ? painted.texture : pine ? pine.texture : def.tex;
    if (!scene.textures.exists(texture)) {
      throw new Error(`ResourceNode: texture "${texture}" missing (manifest entry?)`);
    }
    const { x, y } = tileToWorld(tx, ty);
    // Bottom-anchored so a tall tree's base sits on its tile.
    super(scene, x, y + TILE / 2, texture, painted ? ResourceNode.paintedFrame(scene, painted) : undefined);
    this.setOrigin(0.5, 1);
    // Display size comes from the NODE_DEF config when set (never from art dimensions); legacy
    // art without dw/dh draws native.
    if (painted) {
      // why: the origin is the node's foot (its position) measured inside the frame, so the frame's pixels land
      // exactly on the painting texels they were cut from.
      const footX = (tx + 0.5) * TILE * painted.texelsPerPixel, footY = (ty + 1) * TILE * painted.texelsPerPixel;
      this.setOrigin((footX - painted.roomX) / painted.w, (footY - painted.roomY) / painted.h);
      this.setDisplaySize(painted.w / painted.texelsPerPixel, painted.h / painted.texelsPerPixel);
    } else if (pine) this.setDisplaySize(pine.width, pine.height);
    else if (def.dw !== undefined && def.dh !== undefined) this.setDisplaySize(def.dw, def.dh);
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
   * Name of a painted node's frame in its atlas, adding the frame the first time it is asked for.
   * @param scene any scene (textures are shared by the game)
   * @param art the node's atlas box
   * @returns the frame name
   * @throws when the box lies outside the atlas, or a frame of that name already has another box
   */
  private static paintedFrame(scene: Phaser.Scene, art: PaintedNodeArt): string {
    const texture = scene.textures.get(art.texture);
    const name = `node-${art.frameX}-${art.frameY}-${art.w}x${art.h}`;
    const existing = texture.has(name) ? texture.get(name) : null;
    if (existing) {
      if (existing.cutX !== art.frameX || existing.cutY !== art.frameY || existing.cutWidth !== art.w || existing.cutHeight !== art.h) {
        throw new Error(`ResourceNode: atlas "${art.texture}" frame ${name} has a different box`);
      }
      return name;
    }
    const source = texture.getSourceImage() as { width: number; height: number };
    if (art.frameX < 0 || art.frameY < 0 || art.frameX + art.w > source.width || art.frameY + art.h > source.height) {
      throw new Error(`ResourceNode: frame ${name} lies outside atlas "${art.texture}" (${source.width}x${source.height})`);
    }
    texture.add(name, 0, art.frameX, art.frameY, art.w, art.h);
    return name;
  }

  /**
   * Apply one tool hit: a wobble, a soft warm flash and a spray of chips (NodeBreakFx.hitFx), then take one hp.
   * A tree or sapling rocks on its foot away from the keeper; a rock, stump or weed jolts sideways.
   * @param keeperX the keeper's x, so the wobble and chips go away from them
   * @returns true when depleted (the caller removes the node and grants the drop)
   */
  takeHit(keeperX: number): boolean {
    this.hp -= 1;
    const away = keeperX <= this.x ? 1 : -1;
    // why: a hit restarts the wobble; without this, fast repeated chops stack tweens and drift the sprite.
    this.scene.tweens.killTweensOf(this);
    this.setAngle(0);
    this.setX(tileToWorld(this.tx, this.ty).x);
    if (SettingsSystem.prefersReducedMotion()) {
      // No movement; the flash and chips still show the hit.
    } else if (this.kind === 'tree') {
      // The origin is the foot, so turning the sprite rocks the whole tree on its trunk base.
      this.scene.tweens.add({ targets: this, angle: away * 3, duration: 70, ease: 'Sine.Out', yoyo: true, repeat: 1 });
    } else {
      this.scene.tweens.add({ targets: this, x: { from: this.x + away * 1.5, to: this.x }, duration: 90, ease: 'Sine.InOut', yoyo: true });
    }
    // A soft warm tint, not a white flash: it reads as the impact without blinking the screen.
    this.setTint(0xffe6c2);
    this.scene.time.delayedCall(90, () => { if (this.active) this.clearTint(); });
    hitFx(this, keeperX);
    return this.hp <= 0;
  }
}
