/** Authored atlas furnishings give civic rooms their role; shared feature data retains all collision ownership. */
import type Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { CIVIC_FEATURES } from '../config/CivicFeatures';
import type { TownBuilding } from '../config/TownBuildings';
import bounds from './maps/town-prop-art.json' with { type: 'json' };

/**
 * Render this building's immovable public features at whole native pixels. The source PNG stays untouched.
 * @param scene Owning scene; shutdown destroys these objects but retains shared atlas frames.
 * @param building Authored identity, whose feature footprints already exist in the room collision map.
 * @param include Optional selector for rooms that replace specific shared feature art.
 * @returns Nothing; the function adds scene-owned display objects.
 */
export function renderCivicFeatures(scene: Phaser.Scene, building: TownBuilding,
  include: (feature: (typeof CIVIC_FEATURES)[TownBuilding['id']][number]) => boolean = () => true): void {
  for (const feature of CIVIC_FEATURES[building.id].filter(include)) {
    const x = feature.tx * TILE, bottom = (feature.ty + feature.h) * TILE, width = feature.w * TILE;
    const name = `civic-feature-${building.id}-${feature.kind}-${feature.tx}`;
    if (feature.kind === 'bed' || feature.kind === 'shelf') {
      const key = feature.kind === 'bed' ? TextureKey.Bed : TextureKey.StoreShelf;
      if (!scene.textures.exists(key)) throw new Error(`Civic features: required texture ${key} is missing`);
      scene.add.image(x + width / 2, bottom, key).setOrigin(0.5, 1).setDepth(bottom).setName(name);
      continue;
    }
    const key = TextureKey.TownInteriorProps, crop = bounds[feature.kind];
    if (!scene.textures.exists(key)) throw new Error('Civic features: furnishing atlas is missing');
    const texture = scene.textures.get(key), source = texture.getSourceImage();
    if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0 ||
      crop.x + crop.w > source.width || crop.y + crop.h > source.height) {
      throw new Error(`Civic features: invalid atlas crop for ${feature.kind}`);
    }
    if (!texture.has(feature.kind)) texture.add(feature.kind, 0, crop.x, crop.y, crop.w, crop.h);
    // Preserve proportions inside the footprint. Tall displays stay near character height, not giant icons.
    const maxHeight = feature.kind === 'armor' || feature.kind === 'mannequin' ? 44 : 42;
    const scale = Math.min((width - 2) / crop.w, maxHeight / crop.h);
    const displayW = Math.round(crop.w * scale), displayH = Math.round(crop.h * scale);
    scene.add.ellipse(x + width / 2, bottom, displayW, 4, 0x211c24, 0.15).setDepth(bottom - 1);
    scene.add.image(x + width / 2, bottom, key, feature.kind).setOrigin(0.5, 1)
      .setDisplaySize(displayW, displayH).setDepth(bottom).setName(name);
  }
}
