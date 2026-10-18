/**
 * GatePlazaScene — the painted ruin beyond the farm's north trail, home of the first portal gate.
 *
 * Map data (MapDef.buildGatePlaza, from GATE_PLAZA_WALK) owns collision, the farm return warp and the
 * portal warp into the DungeonScene. This scene draws the painting (GATE_PLAZA_ART through
 * PaintedRoomRenderer: backdrop, the swirling portal and its hum, walk-behind pillars, braziers and
 * signpost, flame glows) and lets the
 * keeper read the signpost (E while facing it) for the dungeon rules.
 * Loot that did not fit in the inventory after a run is restored here by BaseWorldScene's ground
 * drops (on GATE_PLAZA_ANCHORS.overflow), so nothing from the dungeon bag is ever lost on the way out.
 */
import { SceneKey } from '../config/AssetKeys';
import { DUNGEON_BAG_SIZE, ESCAPE_GOLD_PER_FLOOR } from '../config/Dungeon';
import { GameState } from '../state/GameState';
import { Sfx } from '../systems/SfxSystem';
import { GATE_PLAZA_ANCHORS, GATE_PLAZA_ART, GATE_PLAZA_STYLE } from '../world/GatePlazaArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { BaseWorldScene } from './BaseWorldScene';

/** Meadow green behind the painting, seen only when a wide window shows past the map's edge. */
const SURROUND_COLOR = 0x1f3a1c;

export class GatePlazaScene extends BaseWorldScene {
  /** Register under the Gate Plaza world key. */
  constructor() {
    super(SceneKey.GatePlaza);
  }

  /** Draw the painted plaza over the whole map; the renderer's objects and sounds end with this scene. */
  protected override onCreated(): void {
    new PaintedRoomRenderer(this, GATE_PLAZA_ART, GATE_PLAZA_STYLE, 0, 0, 'gate-plaza', this.player);
    this.cameras.main.setBackgroundColor(SURROUND_COLOR);
  }

  /**
   * E while facing the signpost reads what the dungeon holds and how to leave it.
   * @param tx facing tile x
   * @param ty facing tile y
   * @returns true when the facing tile is part of the signpost
   */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    const sign = GATE_PLAZA_ANCHORS.signpost;
    const onSign = tx >= sign.tx && tx < sign.tx + sign.w && ty >= sign.ty && ty < sign.ty + sign.h;
    if (!onSign) return false;
    GameState.instance.dialogue = {
      name: 'The North Gate',
      line: 'Beyond: a fountain hall and three rooms that shift every run. One hides the stair to the Warden. ' +
        'Monsters bar the doors until they fall. ' +
        `Your bag holds ${DUNGEON_BAG_SIZE} finds. The altar sends you home for ${ESCAPE_GOLD_PER_FLOOR}g a floor. Fall, and the bag is lost.`,
    };
    Sfx.play('talk');
    return true;
  }
}
