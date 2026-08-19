/**
 * FarmScene — the inherited plot where the game starts. Behavior comes from BaseWorldScene + the
 * Farm MapData. Until an interior is designed, its opaque front door is an exterior sleep point;
 * no player-facing route renders the rejected Home room.
 */
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { BaseWorldScene } from './BaseWorldScene';

export class FarmScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Farm);
  }

  /** Draw the 10-tile-wide Tavern with its porch/steps on the matching MapDef footprint. */
  protected override onCreated(): void {
    if (!this.textures.exists(TextureKey.TavernExterior)) {
      throw new Error(`FarmScene: missing required texture "${TextureKey.TavernExterior}"`);
    }
    this.add
      .image(68 * TILE, 15 * TILE, TextureKey.TavernExterior)
      .setOrigin(0, 1)
      .setDepth(-6);
  }

  /** Sleep at the opaque front door while the Tavern interior remains intentionally deferred. */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    if ((tx !== 72 && tx !== 73) || ty !== 12) return false;
    this.game.events.emit('toast', 'You turn in upstairs for the night.');
    this.sleep();
    return true;
  }
}
