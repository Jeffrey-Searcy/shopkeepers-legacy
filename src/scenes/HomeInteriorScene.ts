/**
 * HomeInteriorScene — inside the player's house. Holds a bed (sleep -> next day, wired in M6) and a
 * chest (M5), with a door warp back to the Farm. Behavior comes from BaseWorldScene + Home MapData.
 */
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { BaseWorldScene } from './BaseWorldScene';

export class HomeInteriorScene extends BaseWorldScene {
  constructor() {
    super(SceneKey.Home);
  }

  /** Mark the deliberately bare compatibility room as an upstairs-only renovation checkpoint. */
  protected override onCreated(): void {
    // A boarded stair opening communicates intentional deferral without rebuilding the rejected
    // ground-floor interior. It is decorative only; the bed and exit remain the gameplay anchors.
    const x = 24 * TILE;
    const y = 4 * TILE;
    const stair = this.add.graphics().setDepth(-5);
    stair.fillStyle(0x2b1b24, 1).fillRoundedRect(x, y, TILE * 3, TILE * 4, 4);
    stair.lineStyle(3, 0x5a3425, 1).strokeRoundedRect(x, y, TILE * 3, TILE * 4, 4);
    stair.fillStyle(0x8c5732, 1).fillRect(x - 3, y + 13, TILE * 3 + 6, 7).fillRect(x - 3, y + 42, TILE * 3 + 6, 7);
    stair.lineStyle(2, 0xb7814b, 1).lineBetween(x, y + 8, x + TILE * 3, y + 57);
    this.add
      .text(x + TILE * 1.5, y - 10, 'GROUND FLOOR\nRENOVATION NEXT', {
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '6px',
        align: 'center',
        color: '#e2c68d',
        backgroundColor: '#513424',
        padding: { x: 3, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(-4);
  }
}
