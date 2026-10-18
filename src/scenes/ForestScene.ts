/**
 * ForestScene — the woods south of the Farm: a dirt trail from the Farm gate down through clearings, a pond
 * with a dock, old ruins and a lamp post, and the road that runs east to the Town.
 *
 * Map data (MapDef.buildForest, from FOREST_GRID and FOREST_NODES) owns ground, collision, the Farm and Town
 * warps and the trees, rocks and weeds. This scene draws the painting (FOREST_ART through
 * PaintedRoomRenderer: backdrop, the walk-behind lamp post, the lantern's glow). The painted trees and rocks
 * are ResourceNodes that draw their own cut-out of the painting (see ResourceNode).
 */
import { SceneKey } from '../config/AssetKeys';
import { FOREST_ART, FOREST_STYLE } from '../world/ForestArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { BaseWorldScene } from './BaseWorldScene';

/** Thicket green behind the painting (the median of its edge), seen only when a wide window shows past the map's edge. */
const SURROUND_COLOR = 0x2a5c24;

export class ForestScene extends BaseWorldScene {
  /** Register under the Forest world key. */
  constructor() {
    super(SceneKey.Forest);
  }

  /** Draw the painted Forest over the whole map; the renderer's objects end with this scene. */
  protected override onCreated(): void {
    new PaintedRoomRenderer(this, FOREST_ART, FOREST_STYLE, 0, 0, 'forest', this.player);
    this.cameras.main.setBackgroundColor(SURROUND_COLOR);
  }
}
