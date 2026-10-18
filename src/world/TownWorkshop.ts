/**
 * Render Town's bridge decks and quiet plot stakes from existing native timber, in normal play and preview.
 * MapData owns all terrain, walkability and routes. This adds no building, collision or save state.
 * Labels and outlines belong only to MapEditorScene, never to the playable walk preview.
 */
import type Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import type { MapData } from './MapDef';

/** Draw authored crossings and plot corners; the scene owns and destroys every created object. */
export function renderTownWorkshop(scene: Phaser.Scene, map: MapData, showStakes = true): void {
  if (!map.townPlan) throw new Error('Town workshop rendering requires planning metadata.');
  if (!scene.textures.exists(TextureKey.ShopFacade)) throw new Error('Town bridges require the existing timber texture.');
  const timber = scene.textures.get(TextureKey.ShopFacade);
  if (!timber.has('workshop-timber')) timber.add('workshop-timber', 0, 24, 131, 112, 6);
  for (const bridge of map.townPlan.bridges) {
    const x = bridge.tx * TILE, y = bridge.ty * TILE, w = bridge.w * TILE, h = bridge.h * TILE;
    scene.add.rectangle(x - 2, y + 3, w + 4, h, 0x26382b, 0.35).setOrigin(0).setDepth(-8.5);
    scene.add.tileSprite(x, y, w, h, TextureKey.ShopFacade, 'workshop-timber')
      .setOrigin(0).setDepth(-8).setName(`town-bridge-${bridge.id}`);
    const edges = scene.add.graphics().setDepth(-7);
    edges.lineStyle(2, 0x59422f, 1).strokeRect(x, y, w, h);
    // Low edge beams remain below people's feet; the adjacent water already defines the crossing.
    edges.fillStyle(0x9c7449, 1);
    if (bridge.axis === 'horizontal') {
      edges.fillRect(x, y, w, 3).fillRect(x, y + h - 3, w, 3);
    } else {
      edges.fillRect(x, y, 3, h).fillRect(x + w - 3, y, 3, h);
    }
  }
  if (!showStakes) return;
  const stakes = scene.add.graphics().setDepth(-6).setName('town-plot-stakes');
  for (const plot of map.townPlan.plots) {
    for (const [tx, ty] of [[plot.tx, plot.ty], [plot.tx + plot.w - 1, plot.ty],
      [plot.tx, plot.ty + plot.h - 1], [plot.tx + plot.w - 1, plot.ty + plot.h - 1]]) {
      const x = tx * TILE + 8, y = ty * TILE + 10;
      stakes.fillStyle(0x314733, 0.3).fillEllipse(x + 1, y + 4, 8, 3);
      stakes.fillStyle(0x674a32, 1).fillRect(x, y - 3, 3, 7);
      stakes.fillStyle(0xd1ae70, 1).fillRect(x, y - 3, 2, 2);
    }
  }
}
