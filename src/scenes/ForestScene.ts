/**
 * ForestScene — the dense woods south of the Farm (the Cindersap analogue). All behavior and
 * layout come from BaseWorldScene + the Forest MapData (winding trail, flower-ringed clearing,
 * pond, heavy tree cover); nothing scene-specific is needed here.
 */
import { SceneKey } from '../config/AssetKeys';
import { BaseWorldScene } from './BaseWorldScene';

export class ForestScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Forest);
  }
}
