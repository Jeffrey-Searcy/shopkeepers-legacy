/**
 * FineCollision — the keeper's walls at a quarter of a tile (4 world px), for the painted outdoor maps.
 *
 * Why: a painted map's walk grid (TOWN_GRID and the like) has 16 px tiles, but the painting does not. A lamp
 * post is a few pixels wide, a fence runs along one edge of a tile, a bush hangs half a tile over a path. With
 * whole-tile walls the keeper walks onto things that are drawn and is stopped by empty ground beside them. So a
 * painted map may list edits: rectangles at quarter-tile steps that open or block parts of its walk grid. The
 * keeper's physics (BaseWorldScene) then uses this finer grid in place of the tile walls.
 *
 * The walk grid stays the truth for everything tile-based (resident routes, placement, fishing, sight, saves):
 * the edits only say where the keeper's feet may go. buildFineSolid checks that the two agree, and
 * assertFineWalk checks that the keeper can still walk everywhere the walk grid says is walkable.
 *
 * No Phaser imports: MapDef and the Playwright specs import this file directly.
 */
import { PLAYER_BODY, TILE } from '../config/GameConfig';

/** Fine cells per tile side. */
export const FINE_PER_TILE = 4;
/** Side of one fine cell in world px. */
export const FINE_CELL = TILE / FINE_PER_TILE;

/**
 * One change to a painted map's walls. x0, y0 (top left) and x1, y1 (bottom right, exclusive) are in tiles,
 * each a multiple of 1 / FINE_PER_TILE. 'block' makes that area a wall, 'open' makes it floor. Edits apply in
 * list order, on top of the walk grid's own solid tiles. why: names what is painted there, so the next person
 * can check the edit against the art.
 */
export interface CollisionEdit {
  readonly kind: 'open' | 'block';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly why: string;
}

/**
 * A wall edit (see CollisionEdit).
 * @param x0 left edge, tiles
 * @param y0 top edge, tiles
 * @param x1 right edge, tiles (exclusive)
 * @param y1 bottom edge, tiles (exclusive)
 * @param why what is painted there
 */
export function block(x0: number, y0: number, x1: number, y1: number, why: string): CollisionEdit {
  return { kind: 'block', x0, y0, x1, y1, why };
}

/**
 * A floor edit (see CollisionEdit).
 * @param x0 left edge, tiles
 * @param y0 top edge, tiles
 * @param x1 right edge, tiles (exclusive)
 * @param y1 bottom edge, tiles (exclusive)
 * @param why what is painted there
 */
export function open(x0: number, y0: number, x1: number, y1: number, why: string): CollisionEdit {
  return { kind: 'open', x0, y0, x1, y1, why };
}

/**
 * Turn a map's solid tiles plus its edits into fine walls.
 * @param builder the map builder's name, the prefix of every error
 * @param solid the walk grid's solid tiles (rows of columns)
 * @param edits the map's edits, applied in order
 * @returns solid cells, (h * FINE_PER_TILE) rows of (w * FINE_PER_TILE) columns
 * @throws when an edit is off the quarter grid, empty, outside the map, has no why, or changes nothing (a
 *   stale or doubled edit), or when an edit closes the middle of a walkable tile (the 2x2 cells a keeper
 *   standing on the tile centre covers: arrivals and residents use tile centres)
 */
export function buildFineSolid(builder: string, solid: readonly (readonly boolean[])[], edits: readonly CollisionEdit[]): boolean[][] {
  const h = solid.length, w = solid[0].length;
  const fine = Array.from({ length: h * FINE_PER_TILE }, (_, cy) =>
    Array.from({ length: w * FINE_PER_TILE }, (_, cx) => solid[Math.floor(cy / FINE_PER_TILE)][Math.floor(cx / FINE_PER_TILE)]));
  for (const edit of edits) {
    const name = `${edit.kind} ${edit.x0},${edit.y0}-${edit.x1},${edit.y1} (${edit.why})`;
    const cells = [edit.x0, edit.y0, edit.x1, edit.y1].map(v => v * FINE_PER_TILE);
    if (cells.some(c => !Number.isInteger(c))) throw new Error(`${builder}: edit ${name} is off the quarter-tile grid`);
    const [cx0, cy0, cx1, cy1] = cells;
    if (cx1 <= cx0 || cy1 <= cy0) throw new Error(`${builder}: edit ${name} is empty`);
    if (cx0 < 0 || cy0 < 0 || cx1 > w * FINE_PER_TILE || cy1 > h * FINE_PER_TILE) throw new Error(`${builder}: edit ${name} is outside the map`);
    if (edit.why.trim() === '') throw new Error(`${builder}: edit ${name} needs a why`);
    const wall = edit.kind === 'block';
    let changed = 0;
    for (let cy = cy0; cy < cy1; cy++) for (let cx = cx0; cx < cx1; cx++) {
      if (fine[cy][cx] !== wall) changed++;
      fine[cy][cx] = wall;
    }
    if (changed === 0) throw new Error(`${builder}: edit ${name} changes nothing`);
  }
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    if (solid[ty][tx]) continue;
    const cx = tx * FINE_PER_TILE + 1, cy = ty * FINE_PER_TILE + 1;
    if (fine[cy][cx] || fine[cy][cx + 1] || fine[cy + 1][cx] || fine[cy + 1][cx + 1]) {
      throw new Error(`${builder}: edits close the middle of walkable tile (${tx},${ty}); make the tile solid in the walk grid instead`);
    }
  }
  return fine;
}

/**
 * True when the keeper's feet box (PLAYER_BODY), centred on the feet point (x, y), covers a fine wall cell.
 * why: the save check uses it. A save made before a map's walls were trimmed can hold a spot that is now
 * partly wall, and Arcade physics would shove a keeper that starts inside a wall in an arbitrary direction.
 * @param fine the map's fine walls (MapData.fineSolid)
 * @param x feet point, world px (GameState.player.x)
 * @param y feet point, world px (GameState.player.y)
 * @returns whether any covered cell is a wall; cells past the map edge are skipped, because the world bounds
 *   (not the fine walls) hold the keeper there and the save check tests the bounds on its own
 */
export function feetBoxHitsFineWall(fine: readonly (readonly boolean[])[], x: number, y: number): boolean {
  const cx0 = Math.max(0, Math.floor((x - PLAYER_BODY.w / 2) / FINE_CELL));
  const cy0 = Math.max(0, Math.floor((y - PLAYER_BODY.h / 2) / FINE_CELL));
  // why: the box's right and bottom edges are exclusive, so a box that ends exactly on a cell line does not
  // cover the cell past it (Arcade treats touching edges as no overlap too).
  const cx1 = Math.min(fine[0].length, Math.ceil((x + PLAYER_BODY.w / 2) / FINE_CELL));
  const cy1 = Math.min(fine.length, Math.ceil((y + PLAYER_BODY.h / 2) / FINE_CELL));
  for (let cy = cy0; cy < cy1; cy++) for (let cx = cx0; cx < cx1; cx++) if (fine[cy][cx]) return true;
  return false;
}

/**
 * Side, in fine cells, of the square the walk audit moves. why: the keeper's feet box is 8x6 px, but steering
 * with four keys through a gap exactly 8 px wide is near impossible, so a path counts only when it is at least
 * 12 px wide.
 */
const AUDIT_BOX = 3;

/**
 * Fail loudly unless a 12 px square can walk, through the fine walls, from the root arrival to the centre of
 * every walkable tile that is not blocked by a node.
 * @param builder the map builder's name, the prefix of every error
 * @param fine the fine walls (buildFineSolid)
 * @param solid the walk grid's solid tiles
 * @param blockedTiles "tx,ty" keys of tiles that block as bodies of their own (resource nodes)
 * @param root the root arrival tile; the keeper starts with feet on its centre
 * @throws naming up to five tiles the square cannot reach
 */
export function assertFineWalk(builder: string, fine: readonly (readonly boolean[])[], solid: readonly (readonly boolean[])[],
  blockedTiles: ReadonlySet<string>, root: { readonly tx: number; readonly ty: number }): void {
  const rows = fine.length, cols = fine[0].length;
  // why: every getMapData call on a painted map runs this audit (the Town's is about 330x300 cells), and the
  // resident schedules call getMapData hundreds of times. Looking up a "tx,ty" string per cell test made one
  // audit take about half a second, so walls are flattened into a byte grid once: 1 is a wall cell or a cell
  // of a node's tile.
  const wallCells = new Uint8Array(rows * cols);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) if (fine[cy][cx]) wallCells[cy * cols + cx] = 1;
  for (let ty = 0; ty < solid.length; ty++) for (let tx = 0; tx < solid[ty].length; tx++) {
    if (!blockedTiles.has(`${tx},${ty}`)) continue;
    for (let cy = ty * FINE_PER_TILE; cy < (ty + 1) * FINE_PER_TILE; cy++) {
      wallCells.fill(1, cy * cols + tx * FINE_PER_TILE, cy * cols + (tx + 1) * FINE_PER_TILE);
    }
  }
  // A square at (cx, cy) covers cells cx..cx+AUDIT_BOX-1 and the same rows.
  const free = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx + AUDIT_BOX > cols || cy + AUDIT_BOX > rows) return false;
    for (let y = cy; y < cy + AUDIT_BOX; y++) for (let x = cx; x < cx + AUDIT_BOX; x++) if (wallCells[y * cols + x] === 1) return false;
    return true;
  };
  /** The squares that contain the centre point of tile (tx, ty) strictly inside them. */
  const around = (tx: number, ty: number): Array<[number, number]> => {
    const px = tx * FINE_PER_TILE + FINE_PER_TILE / 2, py = ty * FINE_PER_TILE + FINE_PER_TILE / 2;
    const out: Array<[number, number]> = [];
    for (let cy = py - AUDIT_BOX + 1; cy < py; cy++) for (let cx = px - AUDIT_BOX + 1; cx < px; cx++) out.push([cx, cy]);
    return out;
  };
  const seen = new Uint8Array(rows * cols);
  const queue: number[] = [];
  for (const [cx, cy] of around(root.tx, root.ty)) {
    if (free(cx, cy)) { seen[cy * cols + cx] = 1; queue.push(cy * cols + cx); }
  }
  if (queue.length === 0) throw new Error(`${builder}: the fine walls box in the root arrival (${root.tx},${root.ty})`);
  while (queue.length > 0) {
    const at = queue.pop() as number;
    const cx = at % cols, cy = (at - cx) / cols;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
      if (!free(nx, ny) || seen[ny * cols + nx]) continue;
      seen[ny * cols + nx] = 1;
      queue.push(ny * cols + nx);
    }
  }
  const missed: string[] = [];
  for (let ty = 0; ty < solid.length; ty++) for (let tx = 0; tx < solid[ty].length; tx++) {
    if (solid[ty][tx] || blockedTiles.has(`${tx},${ty}`)) continue;
    if (!around(tx, ty).some(([cx, cy]) => seen[cy * cols + cx] === 1)) missed.push(`(${tx},${ty})`);
  }
  if (missed.length > 0) {
    throw new Error(`${builder}: the keeper cannot walk through the fine walls to ${missed.length} walkable tiles: ${missed.slice(0, 5).join(' ')}`);
  }
}
