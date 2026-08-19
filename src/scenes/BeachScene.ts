/**
 * BeachScene — the strand south of the Town: grass bluff, sand, tidal pool, and the open ocean
 * along the south edge. Entirely data-driven from the Beach MapData in MapDef.
 */
import { SceneKey } from '../config/AssetKeys';
import { BaseWorldScene } from './BaseWorldScene';

export class BeachScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Beach);
  }
}
