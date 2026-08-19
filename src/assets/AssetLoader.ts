/**
 * AssetLoader — reads public/assets/manifest.json and materializes every texture key.
 *
 * For `placeholder` entries it bakes a colored rect (via PlaceholderFactory); for real entries it
 * loads the PNG/spritesheet/atlas. Game code never learns which — it just uses the key. This is
 * the mechanism behind the placeholder->PixelLab swap (CLAUDE.md Hard Rule 4).
 *
 * Fail-loud (CLAUDE.md discipline): an unknown manifest entry type throws rather than silently
 * skipping, so a typo surfaces immediately instead of as a mysterious blank sprite later.
 */
import Phaser from 'phaser';
import { ensurePlaceholderTexture } from './PlaceholderFactory';

/** A manifest texture entry: either a generated placeholder or a real asset file. */
type ManifestEntry =
  | { type: 'placeholder'; color: string; w: number; h: number }
  | { type: 'image'; file: string }
  | { type: 'spritesheet'; file: string; frameWidth: number; frameHeight: number }
  | { type: 'atlas'; file: string; data: string };

interface Manifest {
  textures: Record<string, ManifestEntry>;
}

/**
 * Queue real-asset loads onto the scene loader (call during preload) AND immediately create
 * placeholder textures (which need no async load). Returns nothing; call before `scene.load.start`
 * is triggered (Phaser preload lifecycle handles that).
 */
export function loadFromManifest(scene: Phaser.Scene, manifest: Manifest): void {
  for (const [key, entry] of Object.entries(manifest.textures)) {
    switch (entry.type) {
      case 'placeholder':
        ensurePlaceholderTexture(scene, key, entry.color, entry.w, entry.h);
        break;
      case 'image':
        scene.load.image(key, `assets/${entry.file}`);
        break;
      case 'spritesheet':
        scene.load.spritesheet(key, `assets/${entry.file}`, {
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
        });
        break;
      case 'atlas':
        scene.load.atlas(key, `assets/${entry.file}`, `assets/${entry.data}`);
        break;
      default: {
        // Exhaustiveness + fail-loud on an unknown/typo'd entry type.
        const bad = entry as { type: string };
        throw new Error(`AssetLoader: unknown manifest entry type "${bad.type}" for key "${key}"`);
      }
    }
  }
}
