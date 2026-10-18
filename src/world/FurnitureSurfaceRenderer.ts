/** Joins table and rug surfaces from native art patches; placements and collision remain separate. */
import Phaser from 'phaser';
import { TextureKey } from '../config/AssetKeys';
import { furnitureView, type PlacedFurniture } from '../config/Furniture';
import { connectedFurnitureCells } from '../config/FurnitureConnections';

/** One reusable native canvas per placed piece, plus one for the moving placement preview. */
interface SurfaceEntry { texture: Phaser.Textures.CanvasTexture; signature: string }
/** Resolved texture/frame passed to the existing image and physics constructors. */
export interface SurfacePresentation { texture: string; frame?: string }

/** Scene-owned surface composer. Repeats/crops original pixels, never scales or repaints source assets. */
export class FurnitureSurfaceRenderer {
  private entries = new Map<string, SurfaceEntry>();

  /** Attach texture cleanup to this scene's lifetime; no durable game state is created. */
  constructor(private scene: Phaser.Scene) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const entry of this.entries.values()) scene.textures.remove(entry.texture.key);
      this.entries.clear();
    });
  }

  /** Compose a piece against its scene's layout; invalid previews pass only their isolated candidate. */
  resolve(piece: PlacedFurniture, layout: readonly PlacedFurniture[], preview = false): SurfacePresentation {
    const view = furnitureView(piece.item, piece.rotation);
    if (piece.item !== 'table' && piece.item !== 'rug') return { texture: view.texture, frame: view.frame };
    const cells = connectedFurnitureCells(layout, piece.scene).filter(cell => cell.item === piece.item &&
      cell.tx >= piece.tx && cell.tx < piece.tx + view.w && cell.ty >= piece.ty && cell.ty < piece.ty + view.h);
    if (cells.length !== view.w * view.h) throw new Error('Furniture surface: incomplete footprint');
    const signature = `${piece.item}:${view.w}:${view.h}:${cells.map(cell => cell.mask).join(',')}`;
    const slot = preview ? 'preview' : `${piece.item}:${piece.tx}:${piece.ty}`;
    const key = `furniture-surface:${this.scene.scene.key}:${slot}`;
    let entry = this.entries.get(slot);
    if (!entry) {
      const texture = this.scene.textures.createCanvas(key, view.displayW, view.displayH);
      if (!texture) throw new Error(`Furniture surface: cannot create ${key}`);
      entry = { texture, signature: '' };
      this.entries.set(slot, entry);
    }
    if (entry.signature !== signature) {
      entry.texture.setSize(view.displayW, view.displayH);
      const ctx = entry.texture.getContext();
      ctx.clearRect(0, 0, view.displayW, view.displayH);
      ctx.imageSmoothingEnabled = false;
      const sourceKey = piece.item === 'table' ? TextureKey.FurnitureTableHorizontal : TextureKey.FurnitureRug;
      const source = this.scene.textures.get(sourceKey).getSourceImage();
      if (!(source instanceof HTMLImageElement) && !(source instanceof HTMLCanvasElement)) {
        throw new Error(`Furniture surface: unsupported source ${sourceKey}`);
      }
      const sourceW = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
      const sourceH = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
      if (sourceW !== 32 || sourceH !== (piece.item === 'table' ? 24 : 32)) {
        throw new Error(`Furniture surface: unexpected native dimensions for ${sourceKey}: ${sourceW}x${sourceH}`);
      }
      for (const cell of cells) this.drawCell(ctx, source, piece.item,
        (cell.tx - piece.tx) * 16, (cell.ty - piece.ty) * 16, cell.mask, piece.rotation === 1);
      entry.texture.refresh();
      entry.signature = signature;
    }
    return { texture: key };
  }

  /** Free a removed piece's texture after its world image is destroyed; previews use a fixed slot. */
  remove(item: string, tx: number, ty: number): void {
    const slot = `${item}:${tx}:${ty}`, entry = this.entries.get(slot);
    if (!entry) return; // Non-connecting furniture never owns a surface canvas.
    this.scene.textures.remove(entry.texture.key);
    this.entries.delete(slot);
  }

  /** Turn only the tabletop's native pixels; the front apron and two visible feet always point down. */
  private drawCell(ctx: CanvasRenderingContext2D, source: CanvasImageSource, item: 'table' | 'rug',
    x: number, y: number, mask: number, turned: boolean): void {
    if (item === 'table' && turned) {
      // Convert world neighbors into the unturned tabletop's axes before rotating its pixels clockwise.
      const localMask = ((mask & 1) ? 8 : 0) | ((mask & 2) ? 1 : 0) | ((mask & 4) ? 2 : 0) | ((mask & 8) ? 4 : 0) |
        ((mask & 16) ? 128 : 0) | ((mask & 32) ? 16 : 0) | ((mask & 64) ? 32 : 0) | ((mask & 128) ? 64 : 0);
      ctx.save(); ctx.translate(x + 16, y); ctx.rotate(Math.PI / 2);
      this.drawTop(ctx, source, item, 0, 0, localMask);
      ctx.restore();
    } else this.drawTop(ctx, source, item, x, y, mask);
    if (item === 'table' && !(mask & 4)) {
      // South-facing perimeter has a thin apron; feet occur only where that perimeter turns.
      ctx.drawImage(source, 8, 18, 8, 1, x, y + 16, 8, 1);
      ctx.drawImage(source, 8, 18, 8, 1, x + 8, y + 16, 8, 1);
      if (!(mask & 8) || (mask & 64)) ctx.drawImage(source, 0, 18, 8, 5, x, y + 16, 8, 5);
      if (!(mask & 2) || (mask & 32)) ctx.drawImage(source, 24, 18, 8, 5, x + 8, y + 16, 8, 5);
    }
  }

  /** Assemble a flat surface from unchanged 8px patches, opening only edges with matching neighbors. */
  private drawTop(ctx: CanvasRenderingContext2D, source: CanvasImageSource, item: 'table' | 'rug',
    x: number, y: number, mask: number): void {
    const table = item === 'table';
    // Each quadrant independently handles its horizontal, vertical and diagonal neighbors.
    const quadrants = [[0, 0, 8, 1, 128], [1, 0, 2, 1, 16], [0, 1, 8, 4, 64], [1, 1, 2, 4, 32]];
    for (const [qx, qy, horizontal, vertical, diagonal] of quadrants) {
      const side = (mask & horizontal) !== 0, end = (mask & vertical) !== 0;
      // The rug's inset gold border reaches pixel8; only its central12..19 patch is plain fabric.
      const sx = side ? (table ? 8 : 12) : qx * 24;
      const sy = table ? (end ? 6 : 2 + qy * 8) : (end ? 12 : qy * 24);
      ctx.drawImage(source, sx, sy, 8, 8, x + qx * 8, y + qy * 8, 8, 8);
      if (side && end && !(mask & diagonal)) {
        if (table) {
          // Table rims meet at the vertex; their narrower edge needs only a native corner patch.
          ctx.drawImage(source, qx === 0 ? 29 : 1, qy === 0 ? 16 : 2,
            2, 2, x + qx * 14, y + qy * 14, 2, 2);
        } else {
          // Rug trim sits several pixels inside the footprint. Join its straight edge bands at
          // that inset, not at the cell vertex, or an L-shaped rug has a visibly broken border.
          ctx.save(); ctx.translate(x + 8, y + 8);
          ctx.scale(qx === 0 ? -1 : 1, qy === 0 ? -1 : 1);
          ctx.clearRect(4, 4, 4, 4);
          for (let band = 1; band <= 3; band++) {
            ctx.drawImage(source, 12, 24 + band, 8 - band, 1, band, band, 8 - band, 1);
            ctx.drawImage(source, 24 + band, 12, 1, 8 - band, band, band, 1, 8 - band);
          }
          ctx.restore();
        }
      }
    }
  }
}
