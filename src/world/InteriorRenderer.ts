/** Native oak and stone room surfaces with thick cutaway edges and deep architectural thresholds. */
import Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import type { MapData } from './MapDef';

/**
 * Tile native frames without TileSprite's WebGL power-of-two resampling. Each edge clips its
 * last image rather than stretching it; this keeps the61×28 floor and32×48 wall pixels exact.
 */
function nativeSurface(scene: Phaser.Scene, texture: string, frame: string | undefined, width: number, height: number,
  tileW: number, tileH: number, depth: number, name: string): void {
  const surface = scene.add.container(0, 0).setDepth(depth).setName(name);
  for (let y = 0; y < height; y += tileH) {
    for (let x = 0; x < width; x += tileW) {
      const tile = scene.add.image(x, y, texture, frame).setOrigin(0);
      if (x + tileW > width || y + tileH > height) tile.setCrop(0, 0, Math.min(tileW, width - x), Math.min(tileH, height - y));
      surface.add(tile);
    }
  }
}

/** Render original materials at native pixels; map data alone owns walls and doorway collision. */
export function renderShopInterior(scene: Phaser.Scene, map: MapData): void {
  if (!map.interior || map.interior.kind !== 'built') throw new Error(`Interior: ${map.key} is not a built interior`);
  for (const key of [TextureKey.InteriorFloor, TextureKey.InteriorWall, TextureKey.InteriorDoorway]) {
    if (!scene.textures.exists(key)) throw new Error(`Interior: missing material ${key}`);
  }
  const w = map.w * TILE, h = map.h * TILE, wallHeight = map.interior.wallHeight;
  const floor = scene.textures.get(TextureKey.InteriorFloor);
  const source = floor.getSourceImage() as HTMLImageElement;
  if (source.width !== 64 || source.height !== 32) throw new Error('Interior: quiet oak requires its native64×32 source');
  if (!floor.has('native-wood')) floor.add('native-wood', 0, 1, 1, 61, 28);
  nativeSurface(scene, TextureKey.InteriorFloor, 'native-wood', w, h, 61, 28, -15, 'interior-native-floor');
  nativeSurface(scene, TextureKey.InteriorWall, undefined, w, wallHeight, 32, 48, -14, 'interior-stone-wall');
  const trim = scene.add.graphics().setDepth(-12).setName('interior-wall-depth');
  // The contact edge belongs to architecture, not an oversized furniture drop shadow.
  trim.fillStyle(0x32232b, 0.24).fillRect(8, wallHeight, w - 16, 5);
  trim.fillStyle(0x201d29).fillRect(0, 0, w, 4).fillRect(0, 0, 8, h).fillRect(w - 8, 0, 8, h);
  trim.fillStyle(0x514555).fillRect(1, 2, 5, h - 2).fillRect(w - 6, 2, 5, h - 2);
  trim.fillStyle(0x887579).fillRect(2, 3, 2, h - 3).fillRect(w - 6, 3, 2, h - 3);
  for (let y = 12; y < h; y += 12) {
    trim.fillStyle(0x2d2734).fillRect(1, y, 6, 1).fillRect(w - 7, y, 6, 1);
  }
  trim.fillStyle(0x241e2b).fillRect(0, h - 7, w, 7);
  trim.fillStyle(0x74616b).fillRect(1, h - 7, w - 2, 2);
  trim.fillStyle(0xa68569).fillRect(2, h - 7, w - 4, 1);
  for (const warp of map.warps) {
    const x = warp.tx * TILE, width = warp.w * TILE;
    if (warp.doorFacing === 'north') {
      const source = scene.textures.get(TextureKey.InteriorDoorway).getSourceImage() as HTMLImageElement;
      if (source.width !== width || source.height !== wallHeight) throw new Error('Interior: doorway must match its native opening');
      scene.add.image(x, 0, TextureKey.InteriorDoorway)
        .setOrigin(0).setDepth(wallHeight + 1).setName('interior-rear-door');
    } else {
      const y = warp.ty * TILE;
      scene.add.rectangle(x, y + TILE - 7, width, 7, 0x98704c).setOrigin(0).setDepth(-11);
      scene.add.rectangle(x, y + TILE - 5, width, 2, 0xc58d55).setOrigin(0).setDepth(-10);
    }
  }
}
