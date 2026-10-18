/**
 * BedroomScene is the keeper's private rear room, separate from the public shop and guest stairs.
 * Authored bedroom.json owns furniture, collisions and named doorway spawns. The shared world
 * pipeline owns bed interaction, sleeping, day rollover and saving; this scene adds room lighting.
 */
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { BaseWorldScene } from './BaseWorldScene';
import { bedroomLights, type InteriorLight } from '../config/InteriorLights';
import bedroomMap from '../world/maps/bedroom.json' with { type: 'json' };

/** A quiet private room whose temporary decorations share the normal world-scene lifecycle. */
export class BedroomScene extends BaseWorldScene {
  /** Register the rear bedroom under the checked world scene contract. */
  constructor() {
    super(SceneKey.Bedroom);
  }

  /** Add warm window light and furniture details; never introduce extra collision or sleep state. */
  protected override onCreated(): void {
    for (const key of ['interior-floor', 'interior-wall', 'bed']) {
      if (!this.textures.exists(key)) throw new Error(`BedroomScene: missing room art ${key}`);
    }
    const details = bedroomMap.roomDetails;
    for (const window of details.windows) this.windowAt(window.tx * TILE, window.ty * TILE + 5);
    const lamp = details.bedsideLamp;
    const lampX = lamp.tx * TILE + TILE / 2;
    const lampY = lamp.ty * TILE;
    const light = this.add.graphics().setDepth((lamp.ty + 1) * TILE + 1).setName('bedroom-bedside-lamp');
    light.fillStyle(0xffd98c, 0.1).fillCircle(lampX, lampY, 22);
    light.fillStyle(0x745037).fillRect(lampX - 2, lampY - 6, 4, 9).fillRect(lampX - 5, lampY + 3, 10, 2);
    light.fillStyle(0xdca35d).fillRect(lampX - 6, lampY - 13, 12, 8);
    light.fillStyle(0xffdc95).fillRect(lampX - 4, lampY - 12, 8, 6);
  }

  /** Light the bedroom with daylight through its windows and the bedside lamp. */
  protected override interiorLights(): readonly InteriorLight[] {
    const details = bedroomMap.roomDetails;
    return bedroomLights(details.windows.map(window => ({ x: window.tx * TILE, y: window.ty * TILE + 5 })), details.bedsideLamp);
  }

  /** Draw a framed north-wall window and a restrained patch of light at its authored pixel position. */
  private windowAt(x: number, y: number): void {
    const trim = this.add.graphics().setDepth(32);
    trim.fillStyle(0x483024).fillRect(x, y, 27, 24);
    trim.fillStyle(0x8bbaba).fillRect(x + 3, y + 3, 21, 18);
    trim.fillStyle(0xc2ded2).fillRect(x + 4, y + 4, 7, 6);
    trim.fillStyle(0xdec08c).fillRect(x + 13, y + 3, 2, 18).fillRect(x + 3, y + 12, 21, 2);
    trim.fillStyle(0x527b68).fillRect(x - 3, y - 1, 5, 24).fillRect(x + 25, y - 1, 5, 24);
    trim.fillStyle(0xd9b070).fillRect(x - 4, y - 2, 35, 3).fillRect(x - 1, y + 23, 29, 2);
    this.add.ellipse(x + 13, y + 53, 43, 36, 0xffdd87, 0.08).setDepth(-9.5);
  }
}
