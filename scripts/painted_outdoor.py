#!/usr/bin/env python3
"""
painted_outdoor — the shared packer for the painted outdoor maps (scripts/pack-town-art.py,
scripts/pack-beach-art.py, scripts/pack-forest-art.py).

An outdoor map is one painting, fitted to the map at 32 texels per 16 px tile. Its pack script lists what
the game must treat as separate from the backdrop, and pack() writes three textures:

  * <name>.png        -> the backdrop. The trees and rocks that are game resources (Node) are painted out:
                         the ground under them is rebuilt (like painted_art.fill), so a chopped tree or a
                         mined rock leaves plain ground. Painted animals and other things that must not stay
                         in a still picture (Erase) are rebuilt the same way, with no frame.
  * <name>-front.png  -> the same size, clear except the walk-behind pieces (Piece: palms, a lamp post).
                         The game draws pieces of it above the keeper, so the keeper can walk behind them.
  * <name>-nodes.png  -> a small atlas: one frame per resource node, holding that tree's or rock's original
                         painted pixels (clear around it). ResourceNode draws a full tree or a rock with its
                         frame; saplings, young trees and stumps use the game's normal art.

pack() prints the atlas frames and the piece boxes as TypeScript for the map's src/world/<Name>Art.ts.

Sharpness: a painting within FIT_SLACK pixels of 16 px per tile is padded or cropped, never resized
(native_fit), so each painted pixel stays one game pixel; otherwise it is resized once. The work is done at 2
texels per pixel (doubled), and each finished texture is sharpened at 1 texel per pixel and doubled with
nearest-neighbour (crisp), so every game pixel is a clean 2x2 block. Front masks are snapped to the same
2x2 blocks (blocky).

How a front piece is cut out: its outline (polygon and rectangles) is the most it may hold; its `cut` (see
Cut) picks the object's own texels inside it, so the ground beside a lamp or tree is never drawn over the
keeper.

How a node is cut out:
  1. Its shape (ellipse, polygon, plus a trunk rectangle for a tree) is given in tile units.
  2. The ground under the shape is rebuilt (like painted_art.fill), in cross-faded cells of at most cell_texels
     texels. Each cell's fine grain is copied from the nearby spot whose colour best matches the rebuilt
     colour and whose detail is weakest (no ferns, pebbles or outlines), and that spot must not touch any
     node, piece, erased shape or AVOID box.
  3. The node's pixels are the original pixels, inside the shape, whose smooth colour differs clearly from
     the ground colour around the shape (taken from a median-filtered copy, so pebbles and outlines do not
     count). So the frame holds the tree or rock, and not the ground beside it.
  4. Outside a soft edge around the node's pixels, the original painting is kept (loose pebbles stay sharp).
An erased shape skips step 3: all of its pixels are rebuilt.

A node or erased shape with a `clone` setting is rebuilt by clone_fill() instead of step 2: a nearby patch of
the room as rebuilt so far (picked by hand, or found by matching the ground around the hole) is copied over
it, shifted in colour by the median difference between the ground around the hole and around the patch. Use it on mixed ground (cobbles, planks, fences beside lawns), where
the grain fill's smooth colour smears the pattern.
pack() fails when two nodes, pieces or erased shapes claim the same pixel.

Needs: numpy, Pillow, and scripts/painted_art.py next to this file.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from painted_art import gaussian_blur, membrane

# Texels per 16 px map tile (2 texels per world pixel).
TILE = 32
# Atlas width for the node frames (frames are packed in rows, left to right).
ATLAS_WIDTH = 1024

Point = tuple[float, float]
Rect = tuple[float, float, float, float]
# (width, height) of the fitted room in texels.
Size = tuple[int, int]
@dataclass(frozen=True)
class Band:
    """
    A clone setting for a hole inside a narrow structure that repeats sideways (the counter and back wall of
    a market stall between its posts), where no clear patch as wide as the hole exists nearby: each hole
    texel copies the texel in its own row from the column band x0-x1 (tiles), repeated sideways from x0.
    The band must lie outside the hole and clear of every other shape on all the rows the copy covers.
    """
    x0: float
    x1: float


# How a hole is rebuilt by clone_fill(): "auto" searches for the nearby patch of painting that best matches
# the ground around the hole; a (dx, dy) shift in tiles names the patch by hand; a Band repeats a strip of
# columns beside the hole across it; None uses the grain fill.
Clone = Literal["auto"] | tuple[float, float] | Band | None


@dataclass
class Node:
    """
    One painted tree or rock that becomes a game resource.
    kind: 'tree' or 'rock'; tx, ty: the node's tile in the map (its one-tile body, the trunk foot);
    ellipse: (centre x, centre y, radius x, radius y) in tiles; poly: polygon in tiles; trunk: a
    rectangle (x0, y0, x1, y1) in tiles joined to the shape. A shape has an ellipse or a polygon.
    clone: how the ground under it is rebuilt (see Clone); None uses the grain fill.
    """
    kind: str
    tx: int
    ty: int
    ellipse: tuple[float, float, float, float] | None = None
    poly: list[Point] | None = None
    trunk: Rect | None = None
    clone: Clone = None


# How a front piece's pixels are chosen inside its outline (see piece_alpha):
#   "ground" -> the texels whose colour differs clearly from the ground around the outline, in connected parts
#               of a real size (ground_cut), less any grass-green texel. For a lamp or banner (iron, glass,
#               stone and cloth hold no green): it keeps its own pixels only, so no grass or cobbles are drawn
#               over a keeper who walks behind it.
#   "tree"   -> the ground cut, less any pale texel that is not green-led (a path stone, a road's sandy edge or
#               a curb the canopy touches: leaves are green, bark and outlines are dark).
#   "leaf"   -> green-led leaves and their outlines (a palm on sand, whose sand-coloured gaps must drop out).
#   "none"   -> the whole outline. Only for a shape traced tightly by hand.
Cut = Literal["ground", "tree", "leaf", "none"]


@dataclass
class Piece:
    """
    One front piece (the map's <NAME>_ART.pieces): an outline in tiles and its base row.
    poly: a polygon (tiles); rects: rectangles (x0, y0, x1, y1, tiles) joined to it. Together they are the
    outline, the most the piece may hold; `cut` then picks the piece's own texels inside it (see Cut).
    base: the row (tiles) the piece stands on; actors whose feet are above it are drawn behind it.
    trunks: polygons (tiles) around each trunk, for the "leaf" cut only. They skip the green test (bark is
    brown) and drop only bright sand, so the bark stays whole.
    """
    name: str
    poly: list[Point]
    base: float
    cut: Cut
    rects: list[Rect] = field(default_factory=list)
    trunks: list[list[Point]] = field(default_factory=list)


@dataclass
class Erase:
    """
    A painted thing that must leave the still picture (an animal that would never move): its shape is
    rebuilt as plain ground and kept nowhere else. name: for messages; ellipse / poly / clone: as for Node.
    """
    name: str
    ellipse: tuple[float, float, float, float] | None = None
    poly: list[Point] | None = None
    clone: Clone = None


@dataclass
class OutdoorArt:
    """
    Everything one map's pack script supplies to pack().
    name: file stem and message prefix ('beach' writes beach.png, beach-front.png, beach-nodes.png);
    source / source_size: the painting and its exact size (a different file fails loudly);
    tiles: (width, height) of the map in tiles; out: the output folder;
    avoid: boxes (x0, y0, x1, y1, tiles) never copied as grain: big plants whose fine detail looks like
    plain ground to the scoring, so they would print a ghost into a rebuilt patch;
    nodes_label / pieces_label: the TypeScript names printed above the frames and the piece boxes;
    exact_alpha: a node's pixels are its whole shape (grown 2 texels), with no colour test. Use it when the
    shapes are traced tightly and the ground around the nodes is as dark and busy as the nodes themselves
    (bushes in a forest), so the colour test would leave parts of a tree behind in the backdrop;
    grain_grid: the map's walk grid (one string per tile row), or None. When given, grain is copied only
    from the tiles whose character is in grain_cells (plain walkable ground), so a cleared node leaves
    ground that looks walkable, not a smear of the bushes or trees that stood around it;
    grain_cells: those walk-grid characters (unused without a grain_grid);
    reach_tiles: how far (tiles) from a cell best_offset() looks for its grain;
    cell_texels: a hole is filled in square cells of at most this many texels, each with its own grain
    source, so one large tree does not copy one distant patch (and its features) across its whole width.
    Smaller cells fit the small clearings of a map whose grain comes only from grain_cells.
    """
    name: str
    source: Path
    source_size: Size
    tiles: tuple[int, int]
    out: Path
    nodes: list[Node]
    pieces: list[Piece]
    avoid: list[Rect]
    erase: list[Erase]
    nodes_label: str
    pieces_label: str
    exact_alpha: bool
    grain_grid: list[str] | None
    grain_cells: str
    reach_tiles: int
    cell_texels: int


def px(points: list[Point]) -> list[tuple[float, float]]:
    """Tile points to texel points."""
    return [(x * TILE, y * TILE) for x, y in points]


def shape_mask(shape: Node | Erase, size: Size) -> np.ndarray:
    """The node's (or erased thing's) shape as an HxW bool mask of the whole room."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    if shape.ellipse is not None:
        cx, cy, rx, ry = shape.ellipse
        draw.ellipse([(cx - rx) * TILE, (cy - ry) * TILE, (cx + rx) * TILE, (cy + ry) * TILE], fill=255)
    elif shape.poly is not None:
        draw.polygon(px(shape.poly), fill=255)
    else:
        raise RuntimeError(f"painted_outdoor: {shape} has no shape")
    if isinstance(shape, Node) and shape.trunk is not None:
        x0, y0, x1, y1 = shape.trunk
        draw.rectangle([x0 * TILE, y0 * TILE, x1 * TILE, y1 * TILE], fill=255)
    return np.asarray(mask) > 0


def piece_polygon_mask(piece: Piece, size: Size) -> np.ndarray:
    """The piece's polygon, rectangles and trunks as an HxW bool mask of the whole room."""
    return outline_mask(piece.poly, piece.rects, size) | trunk_mask(piece, size)


def outline_mask(poly: list[Point], rects: list[Rect], size: Size) -> np.ndarray:
    """One polygon plus rectangles (tiles) as an HxW bool mask of the whole room."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    if poly:
        draw.polygon(px(poly), fill=255)
    for x0, y0, x1, y1 in rects:
        draw.rectangle([x0 * TILE, y0 * TILE, x1 * TILE, y1 * TILE], fill=255)
    return np.asarray(mask) > 0


def trunk_mask(piece: Piece, size: Size) -> np.ndarray:
    """The piece's trunk polygons as an HxW bool mask of the whole room (empty when it has none)."""
    mask = np.zeros((size[1], size[0]), bool)
    for trunk in piece.trunks:
        mask |= outline_mask(trunk, [], size)
    return mask


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    """Grow a bool mask by r texels (a square max filter)."""
    if r <= 0:
        return mask
    return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def erode(mask: np.ndarray, r: int) -> np.ndarray:
    """Shrink a bool mask by r texels (a square min filter)."""
    if r <= 0:
        return mask
    return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(2 * r + 1))) > 0


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill the holes of a bool mask: every clear pixel that cannot reach the mask's border becomes set."""
    outside = np.zeros_like(mask)
    outside[0, :] = ~mask[0, :]
    outside[-1, :] = ~mask[-1, :]
    outside[:, 0] = ~mask[:, 0]
    outside[:, -1] = ~mask[:, -1]
    clear = ~mask
    while True:
        grown = outside.copy()
        grown[1:] |= outside[:-1]
        grown[:-1] |= outside[1:]
        grown[:, 1:] |= outside[:, :-1]
        grown[:, :-1] |= outside[:, 1:]
        grown &= clear
        if (grown == outside).all():
            return ~outside
        outside = grown


def bbox(mask: np.ndarray, margin: int) -> tuple[int, int, int, int]:
    """Bounding box (x0, y0, x1, y1) of a bool mask, grown by margin and kept 1 texel inside the room's sides."""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        raise RuntimeError("painted_outdoor: empty mask")
    h, w = mask.shape
    return (max(1, xs.min() - margin), max(0, ys.min() - margin), min(w - 1, xs.max() + 1 + margin),
            min(h - 1, ys.max() + 1 + margin))


# Neighbouring cells' grain overlaps by this many texels and cross-fades, so the cells show no seam.
OVERLAP = 12
# fill_feathered()'s margin around a grain sample, for its blur (the sample's own edge is not used).
PAD = 20


def best_offset(blurred: np.ndarray, energy: np.ndarray, shapes: np.ndarray, busy: np.ndarray,
                box: tuple[int, int, int, int], want: np.ndarray, weight: np.ndarray, ref: float, shape_ref: float,
                reach: int, pad: int = PAD + OVERLAP, step: int = 16) -> tuple[int, int]:
    """
    The grain source for one cell of a hole: the shift (dx, dy) whose box of the room is closest in smooth
    colour to `want` (the hole's rebuilt colour) and whose detail strength is closest to `ref` (the ground
    around the node), both weighted by `weight`.
    blurred: HxWx3 room blurred lightly (so a fern or a pebble's colour counts against a source);
    energy: HxW strength of the room's fine detail (outlines, pebbles and ferns are strong, sand grain weak);
    shapes: HxW strength of mid-size shapes (a fern's fronds, a bush, a pebble), matched to `shape_ref`.
    The source box (with fill_feathered()'s pad and overlap) must lie inside the room, and the box grown by
    the overlap must not touch `busy` (nodes, pieces, erased shapes, AVOID). box: (x0, y0, x1, y1) of the
    cell; reach: the farthest shift tried, in texels. Returns (dx, dy). Fails when no shift within reach is clear.
    """
    x0, y0, x1, y1 = box
    h, w = blurred.shape[:2]
    best: tuple[float, int, int] | None = None
    wsum = weight.sum()
    for dy in range(-reach, reach + 1, step):
        if y0 - pad + dy < 0 or y1 + pad + dy > h:
            continue
        for dx in range(-reach, reach + 1, step):
            if x0 - pad + dx < 0 or x1 + pad + dx > w:
                continue
            if busy[y0 - OVERLAP + dy:y1 + OVERLAP + dy, x0 - OVERLAP + dx:x1 + OVERLAP + dx].any():
                continue
            src = blurred[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
            colour = np.abs(src - want).sum(-1)
            # why: a source of the right colour can still carry a fern or a rock outline (too much detail) or
            # be a flat smear (too little); its detail is copied as grain, so either costs like a colour error.
            detail = np.abs(energy[y0 + dy:y1 + dy, x0 + dx:x1 + dx] - ref) * 1.5
            # why: grass grain and a fern have the same fine detail; only the fern has big leaf shapes.
            bulk = np.maximum(shapes[y0 + dy:y1 + dy, x0 + dx:x1 + dx] - shape_ref, 0) * 2.0
            score = ((colour + detail + bulk) * weight).sum() / wsum
            if best is None or score < best[0]:
                best = (score, dx, dy)
    if best is None:
        raise RuntimeError(f"painted_outdoor: no clear grain source near hole {box}")
    return best[1], best[2]


def fill_feathered(img: np.ndarray, box: tuple[int, int, int, int], parts: list[tuple[int, int, int, int, int, int]],
                   open_bottom: bool, ground: np.ndarray, sigma: float = 6) -> None:
    """
    Rebuild img[box] in place, like painted_art.fill, but the cells' grain cross-fades over OVERLAP texels.
    img: HxWx3 float room (edited); box: (x0, y0, x1, y1); parts: (xa, xb, ya, yb, dx, dy) cells that
    cover the box, each with its grain shift; ground: the image whose pixels around box set the smooth
    colour (the median-filtered room). open_bottom: the box runs off the bottom (see painted_art.membrane).
    The grain fades out over 4 texels at each closed edge, so the rebuilt area meets the painting cleanly.
    """
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    grain = np.zeros((h, w, 3))
    total = np.zeros((h, w, 1))
    covered = np.zeros((h, w), bool)
    for xa, xb, ya, yb, dx, dy in parts:
        covered[ya - y0:yb - y0, xa - x0:xb - x0] = True
        ea, eb = max(x0, xa - OVERLAP), min(x1, xb + OVERLAP)
        fa, fb = max(y0, ya - OVERLAP), min(y1, yb + OVERLAP)
        sample = img[fa - PAD + dy:fb + PAD + dy, ea - PAD + dx:eb + PAD + dx]
        detail = (sample - gaussian_blur(sample, sigma))[PAD:-PAD, PAD:-PAD]
        # why: a tent weight, highest in the cell's middle; it never reaches 0, so each texel has a weight.
        wx = np.minimum(np.arange(ea, eb) - ea + 1, eb - np.arange(ea, eb)).astype(float)
        wy = np.minimum(np.arange(fa, fb) - fa + 1, fb - np.arange(fa, fb)).astype(float)
        weight = np.minimum(wy[:, None], wx[None, :])[..., None]
        grain[fa - y0:fb - y0, ea - x0:eb - x0] += detail * weight
        total[fa - y0:fb - y0, ea - x0:eb - x0] += weight
    if not covered.all():
        raise RuntimeError(f"painted_outdoor: grain cells do not cover the hole {box}")
    smooth = membrane(ground, box, open_bottom)
    yy, xx = np.mgrid[0:h, 0:w]
    edges = [yy + 1, xx + 1, w - xx] + ([] if open_bottom else [h - yy])
    fade = np.clip(np.minimum.reduce(edges).astype(float) / 4, 0, 1)[..., None]
    img[y0:y1, x0:x1] = smooth + grain / total * fade


# Per kind: (colour threshold, closing radius in texels) for node_alpha. A tree's sunlit leaves are close
# to the grass in colour, so trees take a lower threshold and a wider closing to seal the canopy.
ALPHA_RULES = {"rock": (80, 2), "tree": (60, 6)}

# Box margin (texels) around a node's shape: room for the 3 texel alpha growth, the 4 texel blend growth
# and the blend's soft tail.
MARGIN = 14


def ground_under(med: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    """
    The smooth ground colour inside box (x0, y0, x1, y1): a membrane from the median-filtered room's pixels
    around the box. A box on the top edge has an open top (it is solved upside down with an open bottom).
    Returns a (y1-y0)x(x1-x0)x3 float array in the room's frame.
    """
    h = med.shape[0]
    x0, y0, x1, y1 = box
    if y0 == 0:
        return membrane(med[::-1], (x0, h - y1, x1, h - y0), open_bottom=True)[::-1]
    return membrane(med, box, open_bottom=False)


def node_alpha(original: np.ndarray, ground: np.ndarray, box: tuple[int, int, int, int],
               shape: np.ndarray, kind: str) -> np.ndarray:
    """
    The node's own pixels: inside the shape (grown 2 texels), where the painting's smooth colour differs
    clearly from the smooth ground colour around it. Holes are filled and the result grown 1 texel, so the
    frame has no pinholes or seams. ground: ground_under() for box; kind: 'tree' or 'rock' (ALPHA_RULES).
    Returns an HxW bool mask of the room.
    """
    threshold, close = ALPHA_RULES[kind]
    x0, y0, x1, y1 = box
    # why: compare against the ground's colour, not a rebuilt copy, so sand beside a rock always drops out
    # (sand ripples change the colour by well under the threshold; rock, bark and leaves change it far more).
    smooth = gaussian_blur(original[y0:y1, x0:x1], 2.5)
    differs = np.abs(smooth - ground).sum(-1) > threshold
    local = differs & dilate(shape, 2)[y0:y1, x0:x1]
    local = dilate(fill_holes(erode(dilate(local, close), close)), 1) & dilate(shape, 3)[y0:y1, x0:x1]
    alpha = np.zeros(shape.shape, bool)
    alpha[y0:y1, x0:x1] = local
    return alpha


def cut_node(work: np.ndarray, med: np.ndarray, blurred: np.ndarray, energy: np.ndarray, shapes: np.ndarray,
             busy: np.ndarray, shape: np.ndarray, alpha: np.ndarray, box: tuple[int, int, int, int],
             ground: np.ndarray, reach: int, cell: int) -> list[tuple[int, int]]:
    """
    Paint one node (or erased shape) out of `work` (HxWx3 float, edited in place): fill its box, then keep
    the fill only on its pixels (alpha) and a soft 4 texel edge around them, so loose pebbles beside it stay
    sharp. The box is split into cells of at most `cell` texels, each with its own grain source. A box on the top edge is
    filled upside down with an open bottom, because the fill needs painted pixels on every closed side.
    med: the median-filtered room (sets the fill colour); ground: ground_under() for box; reach: see best_offset(); cell: see OutdoorArt.cell_texels.
    Returns each cell's grain shift (in the room's frame).
    """
    h = work.shape[0]
    x0, y0, x1, y1 = box
    before = work[y0:y1, x0:x1].copy()
    ring = dilate(shape, 24) & ~dilate(shape, 6)
    # why: the ring around a rock is often strewn with pebbles; the calm fifth of it is the bare ground.
    ref = float(np.percentile(energy[ring], 20))
    shape_ref = float(np.percentile(shapes[ring], 20))
    blend = dilate(alpha, 4)
    top = y0 == 0
    # why: a flipped view writes straight through to `work`, so the fill edits the room itself.
    if top:
        frame, frame_med, frame_blur, frame_energy, frame_busy = work[::-1], med[::-1], blurred[::-1], energy[::-1], busy[::-1]
        frame_shapes = shapes[::-1]
        fblend, want = blend[::-1], ground[::-1]
        fbox = (x0, h - y1, x1, h - y0)
    else:
        frame, frame_med, frame_blur, frame_energy, frame_busy = work, med, blurred, energy, busy
        frame_shapes = shapes
        fblend, want = blend, ground
        fbox = box
    bx0, by0, bx1, by1 = fbox
    cols = max(1, -(-(bx1 - bx0) // cell))
    rows = max(1, -(-(by1 - by0) // cell))
    xs = np.linspace(bx0, bx1, cols + 1).round().astype(int)
    ys = np.linspace(by0, by1, rows + 1).round().astype(int)
    parts, shifts = [], []
    for ya, yb in zip(ys[:-1], ys[1:]):
        for xa, xb in zip(xs[:-1], xs[1:]):
            # why: only the blend region (the node's pixels grown 4 texels) shows the fill; the small floor weight
            # gives a cell outside it a source too.
            weight = fblend[ya:yb, xa:xb].astype(np.float64) + 0.02
            cell_want = want[ya - by0:yb - by0, xa - bx0:xb - bx0]
            dx, dy = best_offset(frame_blur, frame_energy, frame_shapes, frame_busy, (xa, ya, xb, yb), cell_want,
                                 weight, ref, shape_ref, reach)
            parts.append((xa, xb, ya, yb, dx, dy))
            shifts.append((dx, -dy if top else dy))
    fill_feathered(frame, fbox, parts, top, frame_med)
    soft = gaussian_blur(blend[y0:y1, x0:x1, None].astype(np.float64), 1.5)
    work[y0:y1, x0:x1] = before * (1 - soft) + work[y0:y1, x0:x1] * soft
    return shifts


# clone_fill()'s search: how far (texels) it looks for a source patch, how much each texel of distance adds
# to a patch's score (a near patch shares the light and the brush of the hole's surroundings), and how much a
# patch's detail differing from the surroundings' adds (a barrel or a flower bed inside an otherwise good
# match). A score is a mean squared colour error per texel, summed over the 3 channels.
CLONE_REACH = 12 * TILE
CLONE_DISTANCE_COST = 4.0
CLONE_DETAIL_COST = 40.0
# clone_fill()'s colour match: the width (texels) of the ring of ground just outside the copied area whose
# median colour difference shifts the copy.
CLONE_RING = 6


def correlate(window: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """
    For every shift (i, j) that keeps kernel inside window: sum over p of kernel[p] * window[p + (i, j)].
    window: HxW float; kernel: hxw float (h <= H, w <= W). Returns (H-h+1)x(W-w+1). Computed with an FFT,
    so a whole search window costs about one large transform instead of one sum per shift.
    """
    big_h, big_w = window.shape
    h, w = kernel.shape
    padded = np.zeros_like(window)
    padded[:h, :w] = kernel
    out = np.fft.irfft2(np.fft.rfft2(window) * np.conj(np.fft.rfft2(padded)), s=window.shape)
    return out[:big_h - h + 1, :big_w - w + 1]


def find_clone_source(work: np.ndarray, energy: np.ndarray, taken: np.ndarray,
                      box: tuple[int, int, int, int], soft: np.ndarray, context: np.ndarray) -> tuple[int, int, float]:
    """
    The patch of the room to copy into a hole: the shift (dx, dy), in texels, whose box of `work` best
    continues the ground around the hole.
    work: the room so far (holes rebuilt earlier count as ground); energy: fine detail strength (see pack());
    taken: HxW bool, the shapes not yet rebuilt, the nodes, the pieces and the AVOID boxes, grown 4 texels (the
    copied area must not touch one, or it would print a ghost of it); box: (x0, y0, x1, y1) of the hole;
    soft: the hole's (y1-y0)x(x1-x0) blend weight (0 = keep the painting, 1 = all copy); context: bool, same
    size, the texels around the hole that the score compares.
    Score = squared colour error over `context`, plus CLONE_DETAIL_COST times how far the copied area's detail
    strength is from the context's, plus CLONE_DISTANCE_COST per texel of shift.
    Returns (dx, dy, score). Fails when no shift within CLONE_REACH is clear.
    """
    x0, y0, x1, y1 = box
    room_h, room_w = taken.shape
    # why: the colour match at the copy's edge needs one texel of painting around the source box.
    wx0, wy0 = max(1, x0 - CLONE_REACH), max(1, y0 - CLONE_REACH)
    wx1, wy1 = min(room_w - 1, x1 + CLONE_REACH), min(room_h - 1, y1 + CLONE_REACH)
    target = work[y0:y1, x0:x1]
    ring = context.astype(np.float64)
    ring_total = ring.sum()
    if ring_total == 0:
        raise RuntimeError(f"painted_outdoor: no painting around the clone hole {box}")
    ssd = np.zeros((wy1 - wy0 - (y1 - y0) + 1, wx1 - wx0 - (x1 - x0) + 1))
    for c in range(3):
        window = work[wy0:wy1, wx0:wx1, c]
        t = target[..., c]
        ssd += correlate(window * window, ring) - 2 * correlate(window, ring * t) + (ring * t * t).sum()
    ssd /= ring_total
    copied = (soft > 0.01).astype(np.float64)
    ref = float(np.median(energy[y0:y1, x0:x1][context]))
    detail = correlate(np.abs(energy[wy0:wy1, wx0:wx1] - ref), copied) / copied.sum()
    blocked = correlate(taken[wy0:wy1, wx0:wx1].astype(np.float64), copied) > 0.5
    ii, jj = np.mgrid[0:ssd.shape[0], 0:ssd.shape[1]]
    dx, dy = jj + wx0 - x0, ii + wy0 - y0
    score = ssd + CLONE_DETAIL_COST * detail + CLONE_DISTANCE_COST * np.hypot(dx, dy)
    score[blocked] = np.inf
    best = np.unravel_index(np.argmin(score), score.shape)
    if not np.isfinite(score[best]):
        raise RuntimeError(f"painted_outdoor: no clear clone source within {CLONE_REACH} texels of hole {box}")
    return int(dx[best]), int(dy[best]), float(score[best])


def band_fill(work: np.ndarray, taken: np.ndarray, box: tuple[int, int, int, int], soft: np.ndarray,
              band: Band, label: str) -> tuple[int, int]:
    """
    clone_fill() for a Band clone: blend into `work` (edited in place) a copy of the hole's box in which each
    column is the band column at the same offset from the band's left edge, modulo the band's width.
    why no colour match (clone_fill step 3): the copy comes from the same rows a few texels away, inside the
    same structure, so it already has the hole's light.
    box: the hole's box (x0, y0, x1, y1, texels); soft: the copy's weight inside the box, as in clone_fill().
    Returns (band's left edge - box's left edge, 0) in texels, for the log. Fails when the band is under two
    texels wide or leaves the room, or when any band texel on a row the copy covers is on a shape still
    waiting to be rebuilt (this hole included) or another cut-out (taken).
    """
    x0, y0, x1, y1 = box
    bx0, bx1 = round(band.x0 * TILE), round(band.x1 * TILE)
    if bx1 - bx0 < 2 or bx0 < 0 or bx1 > work.shape[1]:
        raise RuntimeError(f"painted_outdoor: band {band} of {label} is too narrow or leaves the room")
    rows = (soft > 0.01).any(axis=1)
    if taken[y0:y1][rows, bx0:bx1].any():
        raise RuntimeError(f"painted_outdoor: band {band} of {label} touches the hole or another shape")
    cols = bx0 + (np.arange(x0, x1) - bx0) % (bx1 - bx0)
    copy = work[y0:y1][:, cols]
    before = work[y0:y1, x0:x1].copy()
    work[y0:y1, x0:x1] = before * (1 - soft[..., None]) + copy * soft[..., None]
    return bx0 - x0, 0


def clone_fill(work: np.ndarray, energy: np.ndarray, taken: np.ndarray, keep: np.ndarray, shape: np.ndarray,
               alpha: np.ndarray, clone: Clone, label: str) -> tuple[int, int]:
    """
    Paint one node (or erased shape) out of `work` (HxWx3 float, edited in place) by copying a nearby patch of
    the room over it, like a clone stamp: cobbles from cobbles, planks from planks, so the hole keeps the
    ground's real pattern instead of a smooth guess. The patch comes from the room as rebuilt so far, so a
    spot cleared earlier (a fishing rod over the water) can be the source for the next hole.
    1. The copied area is the node's pixels (alpha) grown 4 texels, with a 1.5 texel soft edge.
    2. The source patch is clone's (dx, dy) in tiles, or found by find_clone_source() for "auto". A Band
       clone is handed to band_fill() instead, and steps 2-3 do not apply.
    3. The copy's colour is matched to the hole's surroundings, so a patch from a slightly lighter spot does
       not show as a lighter blot: every copied texel is shifted by the per-channel median of (hole side -
       source side) over CLONE_RING texels of ground just outside the copied area, at both places.
       why a median over that thin ring, not a smooth fill from the box's edge: the box edge lies MARGIN texels
       out and crosses lamps, fences and stairs that differ between the two places, and such a fill carried
       their colour into the hole as a tinted blot. Over the ring, a stray object is a minority the median
       ignores. Ring texels on another shape (taken) at either place are left out.
    energy: the painting's detail strength (pack()); taken: see find_clone_source(); keep: HxW bool, pixels another cut-out owns (node frames, front pieces),
    which the copy must not paint over; label: the shape's name for messages.
    Returns the shift used, in texels (for a Band, see band_fill()). Fails when the source or the copied area
    touches another shape, when
    the hole's box touches the top or bottom edge of the room (the colour match needs painting there), or when
    no ring texel is clear of other shapes at both places.
    """
    room_h, room_w = shape.shape
    x0, y0, x1, y1 = bbox(shape, MARGIN)
    if y0 < 1 or y1 > room_h - 1:
        raise RuntimeError(f"painted_outdoor: clone hole {label} touches the room's top or bottom edge")
    blend = dilate(alpha, 4)
    soft = gaussian_blur(blend[y0:y1, x0:x1, None].astype(np.float64), 1.5)[..., 0]
    if (keep[y0:y1, x0:x1] & (soft > 0.01)).any():
        raise RuntimeError(f"painted_outdoor: clone hole {label} would paint over another node or front piece")
    if clone == "auto":
        context = (soft < 0.01) & ~taken[y0:y1, x0:x1]
        dx, dy, score = find_clone_source(work, energy, taken, (x0, y0, x1, y1), soft, context)
        print(f"    {label}: clone source {dx:+d},{dy:+d} texels ({dx / TILE:+.2f},{dy / TILE:+.2f} tiles), score {score:.0f}")
    elif isinstance(clone, Band):
        return band_fill(work, taken, (x0, y0, x1, y1), soft, clone, label)
    elif isinstance(clone, tuple):
        dx, dy = round(clone[0] * TILE), round(clone[1] * TILE)
        if not (1 <= x0 + dx and x1 + dx <= room_w - 1 and 1 <= y0 + dy and y1 + dy <= room_h - 1):
            raise RuntimeError(f"painted_outdoor: clone source of {label} leaves the room")
        if taken[y0 + dy:y1 + dy, x0 + dx:x1 + dx][soft > 0.01].any():
            raise RuntimeError(f"painted_outdoor: clone source of {label} touches another shape")
    else:
        raise RuntimeError(f"painted_outdoor: clone_fill() called for {label} without a clone setting")
    # why: grow the box's crop, not the whole room; MARGIN leaves room in the box for the ring.
    ring = (dilate(blend[y0:y1, x0:x1], 4 + CLONE_RING) & (soft < 0.01)
            & ~taken[y0:y1, x0:x1] & ~taken[y0 + dy:y1 + dy, x0 + dx:x1 + dx])
    if not ring.any():
        raise RuntimeError(f"painted_outdoor: no clear ground around clone hole {label} to match its colour")
    source = work[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
    offset = np.median(work[y0:y1, x0:x1][ring] - source[ring], axis=0)
    copy = source + offset
    before = work[y0:y1, x0:x1].copy()
    work[y0:y1, x0:x1] = before * (1 - soft[..., None]) + copy * soft[..., None]
    return dx, dy


# ground_cut(): a texel belongs to the piece when its lightly smoothed colour differs from the ground colour
# under the outline by more than this (sum of |dR|+|dG|+|dB|). Measured on the Town: iron, banner cloth and
# canopies differ by 120 and more; cobble grout and grass blades by under 60.
GROUND_CUT_THRESHOLD = 70
# ground_cut(drop="pale"): a texel brighter than this (luma, 0-255) that is not green-led is not a tree's.
TREE_PALE_LUMA = 140
# ground_cut(drop="green"): a texel whose green leads red by more than this and blue by more than twice this
# is grass. why: the sunlit grass beside a lamp differs from the shaded lawn median, so step 2 keeps it; lamp
# glow and banner gold are red-led, iron and stone are grey.
GRASS_GREEN_LEAD = 12
# ground_cut(): a connected part smaller than this share of the piece's biggest part is a stray (a path stone
# or a flower beside a canopy) and stays in the backdrop.
GROUND_CUT_KEEP_SHARE = 0.1


def parts(mask: np.ndarray) -> list[np.ndarray]:
    """
    The 4-connected parts of a bool mask, biggest first, each as a bool mask of the same shape.
    why: numpy only (no scipy here); the masks are one piece's box, a few hundred texels a side.
    """
    label = np.zeros(mask.shape, np.int32)
    h, w = mask.shape
    found: list[np.ndarray] = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if label[y0, x0]:
            continue
        n = len(found) + 1
        label[y0, x0] = n
        stack = [(y0, x0)]
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = n
                    stack.append((ny, nx))
        found.append(label == n)
    return sorted(found, key=lambda m: -int(m.sum()))


def ground_cut(room: np.ndarray, med: np.ndarray, outline: np.ndarray, name: str,
               drop: Literal["pale", "green"]) -> np.ndarray:
    """
    The texels inside `outline` that belong to the object, not to the ground it stands on.
    1. The ground colour under the outline is a smooth membrane from the median-filtered room around its box
       (ground_under), so grass, cobbles or dirt each give their own colour.
    2. A texel is the object's when its lightly smoothed colour differs from that by GROUND_CUT_THRESHOLD.
    3. Opening (shrink, grow 1 texel) drops lone grout lines and grass blades; closing (grow, shrink 2) and
       hole filling join the outline's dark edge to the object.
    4. drop="pale" (trees): pale texels that are not green-led leave. drop="green" (lamps, banners): grass-green
       texels leave. Holes this opens inside the object are filled again (a bright bark highlight stays).
    5. Parts smaller than GROUND_CUT_KEEP_SHARE of the biggest are dropped. No grow follows: a grown rim
       would be the light halo of grass or cobbles beside the post, which is what the keeper saw.
    room: the backdrop as rebuilt (float RGB); med: its 13-texel median; outline: HxW bool; name: for errors;
    drop: which texels step 4 removes.
    Returns an HxW bool mask of the room. Fails when nothing inside the outline differs from the ground.
    """
    x0, y0, x1, y1 = bbox(outline, 8)
    inside = outline[y0:y1, x0:x1]
    ground = ground_under(med, (x0, y0, x1, y1))
    smooth = gaussian_blur(room[y0:y1, x0:x1], 0.8)
    local = (np.abs(smooth - ground).sum(-1) > GROUND_CUT_THRESHOLD) & inside
    local = dilate(erode(local, 1), 1)
    local = fill_holes(erode(dilate(local, 2), 2)) & inside
    rgb = room[y0:y1, x0:x1]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if drop == "pale":
        foreign = ((0.299 * r + 0.587 * g + 0.114 * b) > TREE_PALE_LUMA) & (g <= r)
    else:
        foreign = (g > r + GRASS_GREEN_LEAD) & (g > b + 2 * GRASS_GREEN_LEAD)
    local = fill_holes(local & ~foreign) & inside
    found = parts(local)
    if not found:
        raise RuntimeError(f"painted_outdoor: piece {name} has no texel that differs from its ground")
    biggest = int(found[0].sum())
    local = np.logical_or.reduce([m for m in found if m.sum() >= GROUND_CUT_KEEP_SHARE * biggest])
    alpha = np.zeros(outline.shape, bool)
    alpha[y0:y1, x0:x1] = local
    return alpha


def piece_alpha(room: np.ndarray, med: np.ndarray, piece: Piece, size: Size) -> np.ndarray:
    """
    The piece's front-layer pixels inside its outline, chosen by piece.cut (see Cut).
    room: the backdrop as rebuilt (float RGB); med: its 13-texel median (the ground colour for "ground").
    """
    poly = outline_mask(piece.poly, piece.rects, size)
    trunks = trunk_mask(piece, size)
    if piece.cut == "none":
        return poly | trunks
    if piece.cut in ("ground", "tree"):
        if piece.trunks:
            raise RuntimeError(f"painted_outdoor: piece {piece.name} has trunks, which only the leaf cut uses")
        return ground_cut(room, med, poly, piece.name, drop="pale" if piece.cut == "tree" else "green")
    r, g, b = room[..., 0], room[..., 1], room[..., 2]
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    # why: leaves are green-led. Grey rock and sand are not, so they stay in the backdrop. Closing (grow,
    # then shrink) adds the dark outline around each frond.
    leaves = erode(dilate((g > r + 5) & poly, 3), 3)
    holes = fill_holes(leaves) & ~leaves
    # why: a hole inside the canopy is either the dark frond centre (keep it) or sand seen between fronds
    # (drop it, or it hides the keeper). Sand is bright and red-led; the dark centre is neither.
    sand = (r > g) & (luminance > 135)
    # why: a trunk polygon is a little wider than the trunk; the sand slivers along its sides stay behind.
    # Bark highlights are as bright as sand, so the holes and notches they leave are closed again.
    bark = fill_holes(erode(dilate(trunks & ~sand, 3), 3)) & trunks
    return (dilate(leaves | (holes & ~sand), 1) & poly) | bark


def pack_atlas(frames: list[np.ndarray]) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Shelf-pack RGBA frames into one atlas ATLAS_WIDTH wide (1 texel gap). Returns the atlas and each frame's top-left."""
    places: list[tuple[int, int]] = []
    x = y = shelf = 0
    for f in frames:
        fh, fw = f.shape[:2]
        if fw > ATLAS_WIDTH:
            raise RuntimeError(f"painted_outdoor: a {fw} texel wide node frame does not fit the atlas")
        if x + fw > ATLAS_WIDTH:
            x, y, shelf = 0, y + shelf + 1, 0
        places.append((x, y))
        x += fw + 1
        shelf = max(shelf, fh)
    atlas = np.zeros((y + shelf, ATLAS_WIDTH, 4), np.uint8)
    for f, (fx, fy) in zip(frames, places):
        atlas[fy:fy + f.shape[0], fx:fx + f.shape[1]] = f
    return atlas, places


def ground_texels(rows: list[str], cells_wanted: str, tiles: tuple[int, int]) -> np.ndarray:
    """
    The texels of the walk grid's tiles whose character is in cells_wanted, as an HxW bool mask of the room.
    rows: one string per tile row; tiles: the expected (width, height). Fails on a grid of the wrong size.
    """
    if len(rows) != tiles[1] or any(len(row) != tiles[0] for row in rows):
        raise RuntimeError(f"painted_outdoor: the walk grid must be {tiles[1]} rows of {tiles[0]} tiles")
    cells = np.array([[c in cells_wanted for c in row] for row in rows])
    return np.repeat(np.repeat(cells, TILE, axis=0), TILE, axis=1)


# Texels per world pixel in the packed textures. The work is done at this scale, but every texture is made of
# 2x2 blocks of one colour (see native_fit and crisp), so the game shows one painting pixel per world pixel.
TEXELS_PER_PIXEL = 2
# How far (pixels) a source may be from the native size (16 pixels per tile) and still be padded or cropped
# to it instead of resampled.
FIT_SLACK = 2


def native_fit(source: Image.Image, native: Size) -> Image.Image:
    """
    The painting at one pixel per world pixel (16 per tile).
    A source within FIT_SLACK pixels of that size is padded (edge pixels repeated) or cropped, centred: its
    own pixels stay untouched, and nothing moves by more than one pixel against a resample. why: resampling
    by 0.1% blends every pixel with its neighbour, which is the softness the keeper saw. A source farther
    off is resampled with LANCZOS (a real resize, where blending is unavoidable).
    """
    sw, sh = source.size
    nw, nh = native
    if abs(sw - nw) > FIT_SLACK or abs(sh - nh) > FIT_SLACK:
        return source.resize(native, Image.Resampling.LANCZOS)
    src = np.asarray(source)
    # Crop first (centred), then pad by repeating the edge pixels (centred).
    cx, cy = max(0, (sw - nw) // 2), max(0, (sh - nh) // 2)
    src = src[cy:cy + min(sh, nh), cx:cx + min(sw, nw)]
    px_, py_ = nw - src.shape[1], nh - src.shape[0]
    src = np.pad(src, ((py_ // 2, py_ - py_ // 2), (px_ // 2, px_ - px_ // 2), (0, 0)), mode="edge")
    return Image.fromarray(src)


def doubled(native: Image.Image) -> Image.Image:
    """A native-scale image as TEXELS_PER_PIXEL x TEXELS_PER_PIXEL blocks (nearest), the textures' scale."""
    return native.resize((native.width * TEXELS_PER_PIXEL, native.height * TEXELS_PER_PIXEL), Image.Resampling.NEAREST)


def crisp(work: Image.Image) -> Image.Image:
    """
    The finished texture: back to one colour per world pixel (a box average of each 2x2 block, so the rebuilt
    patches whose copy shift was odd join the grid too), sharpened at that scale, and doubled again.
    why: the painting is soft; sharpening per world pixel (not per texel) gives each painting pixel an edge
    the size the game draws it, and blocks of one colour stay even at every zoom.
    """
    native = work.resize((work.width // TEXELS_PER_PIXEL, work.height // TEXELS_PER_PIXEL), Image.Resampling.BOX)
    return doubled(native.filter(ImageFilter.UnsharpMask(radius=1.0, percent=140, threshold=1)))


def blocky(mask: np.ndarray) -> np.ndarray:
    """A bool mask snapped to the textures' 2x2 blocks: a block is set when at least half of it is."""
    t = TEXELS_PER_PIXEL
    h, w = mask.shape
    share = mask.reshape(h // t, t, w // t, t).mean(axis=(1, 3))
    return np.repeat(np.repeat(share >= 0.5, t, axis=0), t, axis=1)


def pack(art: OutdoorArt) -> None:
    """
    Build the map's three textures and print its node frames and piece boxes as TypeScript.
    Fails loudly on a wrong source size or on cut-outs that claim the same pixel.
    """
    size: Size = (art.tiles[0] * TILE, art.tiles[1] * TILE)
    source = Image.open(art.source).convert("RGB")
    if source.size != art.source_size:
        raise RuntimeError(f"pack-{art.name}-art: {art.source} is {source.size}, expected {art.source_size}")
    native = (art.tiles[0] * TILE // TEXELS_PER_PIXEL, art.tiles[1] * TILE // TEXELS_PER_PIXEL)
    fitted = doubled(native_fit(source, native))
    original = np.asarray(fitted).astype(np.float64)
    blurred = np.asarray(fitted.filter(ImageFilter.GaussianBlur(3))).astype(np.float64)
    # Fine detail strength: how far each texel is from its smooth colour, averaged over a few texels.
    detail = np.abs(original - np.asarray(fitted.filter(ImageFilter.GaussianBlur(6))).astype(np.float64)).sum(-1)
    energy = gaussian_blur(detail[..., None], 4.0)[..., 0]
    # Mid-size shape strength: the band between a light and a wide blur, averaged over a fern's size.
    band = np.abs(np.asarray(fitted.filter(ImageFilter.GaussianBlur(3))).astype(np.float64)
                  - np.asarray(fitted.filter(ImageFilter.GaussianBlur(12))).astype(np.float64)).sum(-1)
    shapes_strength = gaussian_blur(band[..., None], 8.0)[..., 0]

    shapes = [shape_mask(n, size) for n in art.nodes]
    erased = [shape_mask(e, size) for e in art.erase]
    piece_polys = [piece_polygon_mask(p, size) for p in art.pieces]
    avoid = np.zeros(size[::-1], bool)
    for x0, y0, x1, y1 in art.avoid:
        avoid[round(y0 * TILE):round(y1 * TILE), round(x0 * TILE):round(x1 * TILE)] = True
    taken = dilate(np.logical_or.reduce(shapes + erased + piece_polys + [avoid]), 4)
    busy = taken.copy()
    if art.grain_grid is not None:
        busy |= ~ground_texels(art.grain_grid, art.grain_cells, art.tiles)
    reach = art.reach_tiles * TILE

    # why: a median filter wipes out pebbles, outlines and grass blades, so the rebuilt ground takes the
    # colour of the ground itself, not of the clutter on the edge of each box.
    med = np.asarray(fitted.filter(ImageFilter.MedianFilter(13))).astype(np.float64)

    work = original.copy()
    # Pixels a clone fill must never paint over: every node's shape and every front piece's polygon.
    keep = np.logical_or.reduce(shapes + piece_polys) if shapes or piece_polys else np.zeros(size[::-1], bool)
    alphas = []
    for node, shape in zip(art.nodes, shapes):
        box = bbox(shape, MARGIN)
        ground = ground_under(med, box)
        alpha = dilate(shape, 2) if art.exact_alpha else node_alpha(original, ground, box, shape, node.kind)
        alphas.append(alpha)
        label = f"{node.kind} ({node.tx},{node.ty})"
        if node.clone is not None:
            # why: the node's own shape is in `keep`; only the other shapes may not be painted over.
            dx, dy = clone_fill(work, energy, taken, keep & ~shape, shape, alpha, node.clone, label)
            print(f"  {label}: cloned from {dx:+d},{dy:+d}")
            continue
        shifts = cut_node(work, med, blurred, energy, shapes_strength, busy, shape, alpha, box, ground, reach, art.cell_texels)
        print(f"  {label}: grain from " + " ".join(f"{dx:+d},{dy:+d}" for dx, dy in shifts))
    # why: an erased shape rebuilt earlier is ground now, so a later clone may copy from it; the shapes still
    # waiting (and every node, piece and AVOID box) may not be copied.
    fixed = np.logical_or.reduce(shapes + piece_polys + [avoid])
    for i, (thing, shape) in enumerate(zip(art.erase, erased)):
        if thing.clone is not None:
            pending = dilate(np.logical_or.reduce([fixed] + erased[i:]), 4)
            dx, dy = clone_fill(work, energy, pending, keep, shape, shape, thing.clone, thing.name)
            print(f"  erased {thing.name}: cloned from {dx:+d},{dy:+d}")
            continue
        box = bbox(shape, MARGIN)
        shifts = cut_node(work, med, blurred, energy, shapes_strength, busy, shape, shape, box, ground_under(med, box), reach, art.cell_texels)
        print(f"  erased {thing.name}: grain from " + " ".join(f"{dx:+d},{dy:+d}" for dx, dy in shifts))

    backdrop = crisp(Image.fromarray(np.clip(np.rint(work), 0, 255).astype(np.uint8)))
    painted = np.asarray(crisp(fitted))
    room = np.asarray(backdrop).astype(np.float64)
    room_med = np.asarray(backdrop.filter(ImageFilter.MedianFilter(13))).astype(np.float64)
    # why blocky: a front texel that covers half a painting pixel would show a sliver of the ground's colour.
    fronts = [blocky(piece_alpha(room, room_med, p, size)) for p in art.pieces]

    claimed = np.zeros(size[::-1], np.int32)
    for a in alphas + fronts + erased:
        claimed += a
    if (claimed > 1).any():
        ys, xs = np.nonzero(claimed > 1)
        raise RuntimeError(f"pack-{art.name}-art: {len(xs)} texels belong to two cut-outs, e.g. tile ({xs[0] // TILE},{ys[0] // TILE})")

    art.out.mkdir(parents=True, exist_ok=True)
    backdrop.save(art.out / f"{art.name}.png", optimize=True)
    front = np.zeros(size[::-1] + (4,), np.uint8)
    if fronts:
        front_mask = np.logical_or.reduce(fronts)
        front[front_mask, :3] = np.asarray(backdrop)[front_mask]
        front[front_mask, 3] = 255
    Image.fromarray(front, "RGBA").save(art.out / f"{art.name}-front.png", optimize=True)

    frames, boxes = [], []
    for a in alphas:
        x0, y0, x1, y1 = bbox(a, 0)
        f = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        f[..., :3] = painted[y0:y1, x0:x1]
        f[..., 3] = a[y0:y1, x0:x1] * 255
        frames.append(f)
        boxes.append((x0, y0, x1 - x0, y1 - y0))
    atlas, places = pack_atlas(frames)
    Image.fromarray(atlas, "RGBA").save(art.out / f"{art.name}-nodes.png", optimize=True)

    print(f"wrote {art.name}.png, {art.name}-front.png and {art.name}-nodes.png ({atlas.shape[1]}x{atlas.shape[0]}) to {art.out}")
    print(f"// {art.nodes_label}")
    for node, (bx, by, bw, bh), (fx, fy) in zip(art.nodes, boxes, places):
        print(f"  node('{node.kind}', {node.tx}, {node.ty}, {{ frameX: {fx}, frameY: {fy}, w: {bw}, h: {bh}, roomX: {bx}, roomY: {by} }}),")
    print(f"// {art.pieces_label}")
    for piece, a in zip(art.pieces, fronts):
        x0, y0, x1, y1 = bbox(a, 0)
        print(f"  {{ name: '{piece.name}', x: {x0}, y: {y0}, w: {x1 - x0}, h: {y1 - y0}, baseY: {round(piece.base * TILE)} }},")
