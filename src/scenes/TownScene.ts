/**
 * TownScene — the town reachable from the Farm's east warp. For V1 it just needs to exist and be
 * walkable so scene transitions are real and testable; NPCs/shops arrive in later prompts.
 */
import { SceneKey } from '../config/AssetKeys';
import { BaseWorldScene } from './BaseWorldScene';

export class TownScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Town);
  }
}
