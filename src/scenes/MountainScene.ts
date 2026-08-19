/**
 * MountainScene — the rocky highlands north of the Town: stone shelf, rock-rimmed lake, and the
 * cave mouth into the Mines. The cave facade is a BuildingDef in the Mountain MapData (rendered +
 * solid-baked like the town shops); the Mines warp carves its doorway.
 */
import { SceneKey } from '../config/AssetKeys';
import { BaseWorldScene } from './BaseWorldScene';

export class MountainScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Mountain);
  }
}
