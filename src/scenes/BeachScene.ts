/**
 * BeachScene — the strand south of the Town: a meadow with the town path, a sand strand with palms, rocks
 * and a tidal pool, and the sea along the south edge.
 *
 * Map data (MapDef.buildBeach, from BEACH_GRID and BEACH_NODES) owns ground, collision, the Town warp and
 * the trees, rocks and weeds. This scene draws the painting (BEACH_ART through PaintedRoomRenderer:
 * backdrop, walk-behind palms and lamp post, the lantern's glow). The painted trees and rocks are
 * ResourceNodes that draw their own cut-out of the painting (see ResourceNode).
 */
import { SceneKey } from '../config/AssetKeys';
import { BEACH_ART, BEACH_STYLE } from '../world/BeachArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { BaseWorldScene } from './BaseWorldScene';

/** Sea blue behind the painting, seen only when a wide window shows past the map's edge. */
const SURROUND_COLOR = 0x077ec7;

export class BeachScene extends BaseWorldScene {
  /** Register under the Beach world key. */
  constructor() {
    super(SceneKey.Beach);
  }

  /** Draw the painted Beach over the whole map; the renderer's objects end with this scene. */
  protected override onCreated(): void {
    new PaintedRoomRenderer(this, BEACH_ART, BEACH_STYLE, 0, 0, 'beach', this.player);
    this.cameras.main.setBackgroundColor(SURROUND_COLOR);
  }
}
