/**
 * SoilOverlay draws native connected dry and watered earth from scene-scoped farm tiles.
 * Each dual-grid vertex reads four cells. Its base-three frame stores empty/dry/wet for NW,
 * NE, SW, SE. Authored Wang silhouettes connect both bed and watering edges. State remains in
 * GameState; scripts/build-living-soil.mjs packs the atlas without rescaling its source pixels.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import { GameState } from '../state/GameState';

/** Existing manifest key now maps to the81-frame native soil atlas. */
export const WANG_SOIL_KEY = 'wang-soil';
const DEPTH_SOIL = -9;

/** Owns this scene's soil layer; Phaser destroys its display objects on scene shutdown. */
export class SoilOverlay {
  private layer: Phaser.Tilemaps.TilemapLayer;

  /** Isolate matching coordinates in different world scenes. */
  private get keyPrefix(): string { return `${this.scene.scene.key}:`; }

  /** Build the vertex layer for a map; absent or incorrectly sized art fails explicitly. */
  constructor(private scene: Phaser.Scene, private w: number, private h: number) {
    if (!scene.textures.exists(WANG_SOIL_KEY)) throw new Error(`SoilOverlay: missing ${WANG_SOIL_KEY}`);
    const source = scene.textures.get(WANG_SOIL_KEY).getSourceImage();
    if (source.width !== 144 || source.height !== 144) throw new Error('SoilOverlay: expected81-frame native16px atlas');
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: w + 1, height: h + 1 });
    const tiles = map.addTilesetImage(WANG_SOIL_KEY, WANG_SOIL_KEY, TILE, TILE, 0, 0);
    if (!tiles) throw new Error('SoilOverlay: could not attach native soil atlas');
    const layer = map.createBlankLayer('soil', tiles, -TILE / 2, -TILE / 2);
    if (!layer) throw new Error('SoilOverlay: could not create soil layer');
    this.layer = layer.setDepth(DEPTH_SOIL);
  }

  /** Refresh the four vertices affected by one soil or watering state change. */
  refreshTile(tx: number, ty: number): void {
    for (let vy = ty; vy <= ty + 1; vy++) for (let vx = tx; vx <= tx + 1; vx++) this.refreshVertex(vx, vy);
  }

  /** Clear and rebuild this scene's beds after loading, entry, or a new day. */
  refreshAll(): void {
    this.layer.fill(-1, 0, 0, this.w + 1, this.h + 1);
    for (const key of Object.keys(GameState.instance.tiles)) {
      if (!key.startsWith(this.keyPrefix)) continue;
      const [tx, ty] = key.slice(this.keyPrefix.length).split(',').map(Number);
      this.refreshTile(tx, ty);
    }
  }

  /** Resolve a cell into an atlas digit; malformed runtime state never draws a guessed result. */
  private cellDigit(x: number, y: number): number {
    const state = GameState.instance.tiles[`${this.keyPrefix}${x},${y}`];
    if (state === undefined) return 0;
    if (state === 'tilled') return 1;
    if (state === 'watered') return 2;
    throw new Error(`SoilOverlay: invalid soil state ${String(state)}`);
  }

  /** Encode corner states in authored atlas order and update or remove one vertex. */
  private refreshVertex(vx: number, vy: number): void {
    if (vx < 0 || vy < 0 || vx > this.w || vy > this.h) return;
    const frame = this.cellDigit(vx - 1, vy - 1) + 3 * this.cellDigit(vx, vy - 1)
      + 9 * this.cellDigit(vx - 1, vy) + 27 * this.cellDigit(vx, vy);
    if (frame === 0) this.layer.removeTileAt(vx, vy, true);
    else this.layer.putTileAt(frame, vx, vy);
  }
}
