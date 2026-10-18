#!/usr/bin/env python3
"""
Civic interiors art packer.

docs/art-source/civic-interiors/<room>.webp are ChatGPT paintings of the town's shop interiors and the
jail. Each shop painting shows the public shop on the left and the keeper's home on the right (a living
room at the top, a bedroom below it behind a curtain door). They arrive with a few things the game must
not show: a mouse cursor near the entrance, a hero or guard standing in the room, barrels that block the
way into the home, and dividing walls with no doorway. This script removes them, fits each painting to
the game grid and writes the textures the game draws (src/world/CivicRoomArt.ts, PaintedRoomRenderer.ts):

  * public/assets/civic-interiors/<room>.png  -> the room backdrop at 32 texels per 16 px tile
                                                 (2 texels per world pixel), ROOMS[room] tiles in size.
  * public/assets/civic-interiors/jail-front.png -> the jail's cell bars only (clear everywhere else).
                                                 The game draws it above actors inside the cell, so a
                                                 jailed keeper stands behind the bars.

Every painting is scaled whole (no crop) to the room size; the walk masks in src/world/CivicRoomArt.ts
were traced on that same scale, so the two must change together.

Clean-up steps are listed per room in CLEANUP, in tiles (1 tile = 32 texels), and run in order on the
scaled room before it is sharpened:
  * ('fill', box, parts) -> painted_art.fill: membrane colour plus grain copied from the parts' offsets.
                            Used to remove a person or a loose prop. Nothing is invented.
  * ('copy', box, dx, dy) -> paste the texels found (dx, dy) tiles away straight into box. Used to remove the
                            white cursor frame left in each painting (a plain copy along its own row
                            keeps the plank lines level), to open a doorway in a dividing wall (floor from the room beside it) and to move a
                            wall cap so the doorway has a top and a bottom edge.
  * ('blend', box, (dxl, dyl), (dxr, dyr)) -> like copy, but the offset fades from the left one to the
                            right one across the box. why: when no single clean patch is as wide as the
                            doorway, two narrower ones join without a visible seam.
  * ('tone', box, edge)  -> scale the box's colour by a gain that changes linearly from its left edge to
                            its right edge, so the strip `edge` tiles wide just inside each side matches
                            the strip just outside it. why: a copied floor patch keeps the light of the
                            place it came from; where that light runs the other way, both sides show a
                            step in brightness.
  * ('tone-rows', box, edge) -> the same, but with a gain worked out for each texel row (smoothed over a few
                            rows). why: where the light also changes from top to bottom (a wall under a
                            candle), one gain per side leaves the top too dark or the bottom too bright.

Usage:  python3 scripts/pack-civic-interiors-art.py [room ...]
Needs:  numpy, Pillow, and scripts/painted_art.py next to this file.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

from painted_art import fill, sharpen

REPO = Path(__file__).resolve().parent.parent
SOURCES = REPO / "docs" / "art-source" / "civic-interiors"
OUT = REPO / "public" / "assets" / "civic-interiors"
TEXELS_PER_TILE = 32

# room id -> (source size in px, room size in tiles). The tile size keeps each painting's aspect ratio.
ROOMS: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {
    "magic": ((1717, 916), (30, 16)),
    "forge": ((1774, 887), (36, 18)),
    "museum": ((1774, 887), (40, 20)),
    "guild": ((1723, 913), (34, 18)),
    "ranch": ((1774, 887), (36, 18)),
    "bar": ((1774, 887), (36, 18)),
    "carpenter": ((1774, 887), (36, 17)),
    "fishing": ((1774, 887), (32, 16)),
    "alchemy": ((1723, 913), (34, 18)),
    "tailor": ((1726, 911), (32, 17)),
    "market": ((1774, 887), (34, 17)),
    "jail": ((1536, 1024), (18, 12)),
}

# Tile-space box (x0, y0, x1, y1) and fill part (xa, xb, ya, yb, dx, dy); see painted_art.Box and Part.
TileBox = tuple[float, float, float, float]
TilePart = tuple[float, float, float, float, float, float]
Step = tuple  # ('fill', TileBox, list[TilePart]) | ('copy', TileBox, dx, dy) | ('blend', TileBox, (dx, dy), (dx, dy)) | ('tone', TileBox, edge) | ('tone-rows', TileBox, edge)


def whole(box: TileBox, dx: float, dy: float) -> list[TilePart]:
    """One fill part covering the whole box, with grain taken (dx, dy) tiles away."""
    x0, y0, x1, y1 = box
    return [(x0, x1, y0, y1, dx, dy)]


CLEANUP: dict[str, list[Step]] = {
    "magic": [
        # The witch by the back wall: wall grain from the clear stone to her right, floor grain from each side.
        ("fill", (6.5, 2.05, 8.0, 4.65), [(6.5, 8.0, 2.05, 3.6, 1.6, 0), (6.5, 7.25, 3.6, 4.65, -0.9, 0),
                                          (7.25, 8.0, 3.6, 4.65, 0.9, 0)]),
        # The scroll barrel in front of the dividing wall, which also hides the potion table's right end.
        # why: copied, not filled, because a fill takes its colour from the dark wall edge beside it.
        # The table's apron runs on to the wall, its left leg is repeated as the right leg, and the stone
        # floor comes from the left (the lowest part from one stone course, 0.95 tile, higher, past a plant).
        ("copy", (17.3, 5.05, 18.45, 6.0), -1.15, 0),
        ("copy", (17.95, 5.1, 18.25, 6.0), -2.75, 0),
        ("copy", (17.3, 6.0, 18.45, 7.0), -1.2, 0),
        ("copy", (17.3, 7.0, 18.45, 7.7), -1.2, -0.95),
        # Doorway through the dividing wall on rows 5-6, under its top beam: a copy of the beam closes the
        # bottom, and living-room planks fill the gap (a cross-fade of two offsets, so neither the wall's
        # edge nor the rug's edge is copied in).
        ("copy", (18.45, 7.1, 20.4, 7.4), 0, -2.95),
        ("blend", (18.45, 4.45, 20.4, 7.1), (2.0, 0), (1.5, 0)),
    ],
    "forge": [
        # The banner on the dividing wall becomes a doorway: living-room wall and floor from 2 tiles right.
        ("copy", (22.45, 5.2, 24.4, 7.7), 2, 0),
    ],
    "museum": [
        # Doorway into the living room on rows 4-5: wall and floor from 2 tiles right and down.
        ("copy", (26.2, 3.4, 28.1, 6.0), 2, 2),
        # The bust on its pedestal by the back wall sits in the one-tile strip that leads to that doorway,
        # so it goes: wall, rail and floor from under the next wall candle to the left (same rows, so the
        # rail and plank lines stay level; offset so both candles' glow lines up), then toned to the wall
        # either side.
        ("copy", (18.78, 2.7, 20.15, 4.94), -8.1, 0),
        ("tone-rows", (18.78, 2.7, 20.15, 4.94), 0.12),
    ],
    "guild": [
        ("copy", (10.41, 15.86, 11.68, 17.03), -1.3, 0),  # cursor (white frame at x 10.53-11.56, rows 15.91-16.91, plus its glow)
        # The potted plant on a barrel beside the divider, then the doorway through it. why: planks only,
        # with no vertical shift so the boards line up; the upper part comes from left of the sword stand,
        # whose right post (to x 20.85) stays.
        ("copy", (20.85, 4.0, 21.7, 5.5), -4.6, 0),
        ("copy", (20.45, 5.5, 21.7, 7.45), -2.0, 0),
        ("copy", (21.7, 4.9, 23.3, 7.3), 1.6, 0),
    ],
    "ranch": [
        ("copy", (11.0, 15.54, 12.18, 16.71), -1.3, 0),  # cursor (white frame at x 11.12-12.06, rows 15.66-16.59, plus its glow)
        # Tools leaning on the divider: wall from below, then the doorway through it.
        ("copy", (21.15, 2.9, 22.45, 4.9), 0, 4),
        ("copy", (21.15, 4.9, 22.45, 6.5), 0, 2),
        ("copy", (22.45, 5.0, 24.55, 7.6), 2, 0),
    ],
    "bar": [
        ("copy", (10.13, 15.41, 11.34, 16.65), -1.3, 0),  # cursor (white frame at x 10.25-11.22, rows 15.53-16.53, plus its glow)
        # The barrel by the divider: planks from its left. why: copied, not filled, because a fill takes
        # its colour from the dark divider beside it. The sources start at x 21.3, past the table edge and
        # the shadow it casts.
        ("copy", (22.15, 4.75, 22.85, 7.1), -0.85, 0),
        ("copy", (22.85, 4.75, 23.4, 7.1), -1.1, 0),
        ("copy", (23.4, 4.85, 25.2, 7.4), 2, 0),                                       # doorway
    ],
    "carpenter": [
        ("copy", (10.66, 14.82, 11.84, 15.93), -1.3, 0),  # cursor (white frame at x 10.78-11.72, rows 14.94-15.81, plus its glow)
        # Doorway on row 7: the wall cap is copied above and below the opening, then floor fills it.
        ("copy", (22.3, 5.8, 24.4, 6.25), 0, 1.4),
        ("copy", (22.3, 8.2, 24.4, 8.65), 0, -1.0),
        # why: the opening runs to x 24.5 so the divider's right outline goes, and its planks start past
        # that outline (2.2 tiles right).
        ("copy", (22.3, 6.25, 24.5, 8.2), 2.2, 0),
    ],
    "fishing": [
        ("copy", (9.19, 13.63, 10.24, 14.68), -1.3, 0),  # cursor (white frame at x 9.31-10.12, rows 13.75-14.56, plus its glow)
        # A see-through sign drawn over the counter (x 9.06-11.15, rows 5.59-7.55). Everything is copied
        # along its own row, so the plank and panel lines stay level. The counter top repeats the two clear
        # strips of top beside the sign (x 8.62-9.02 left of it, 11.18-11.63 right of it). The front panels
        # come from the panels on each side.
        *[("copy", (9.0 + 0.4 * i, 5.55, 9.4 + 0.4 * i, 6.28), -(0.38 + 0.4 * i), 0) for i in range(3)],
        *[("copy", (10.2 + 0.45 * j, 5.55, min(10.65 + 0.45 * j, 11.22), 6.28), 0.98 - 0.45 * j, 0)
          for j in range(3)],
        ("copy", (8.98, 6.28, 10.0, 7.62), -1.0, 0),
        ("copy", (10.0, 6.28, 11.22, 7.62), 1.2, 0),
        # Doorway on row 7: wall caps above and below, then living-room planks across the whole divider.
        ("copy", (20.0, 6.2, 21.7, 6.5), 0, 0.6),
        ("copy", (20.0, 8.0, 21.7, 8.3), 0, -1.2),
        ("copy", (20.05, 6.5, 21.8, 8.0), 2, 0),
        ("copy", (19.98, 6.5, 20.05, 7.05), 2, 0),     # the last sliver of the old cap, above the stand's foot
    ],
    "alchemy": [
        ("copy", (9.82, 15.0, 10.96, 16.15), -1.3, 0),  # cursor (white frame at x 9.94-10.84, rows 15.12-16.03, plus its glow)
        ("copy", (21.05, 5.5, 23.0, 5.75), 0, -1.0),
        # why: the opening spans the whole wall (x 21.0-23.08) and runs down to the lower cap's outline, so
        # no strip of the old wall or its trim stays at either side.
        ("copy", (21.0, 5.75, 23.08, 7.38), 2.1, 0),
    ],
    "tailor": [
        # Cursor (white frame at x 9.34-10.22, rows 14.5-15.28, plus its glow). why: two copies, because the
        # frame sits on the dark band at rows 15.19-15.35; the band's clean stretch (x 10.34-11.46) lies
        # right of the frame, and the planks above are cleanest on its left.
        ("copy", (9.22, 14.38, 10.34, 15.19), -1.3, 0),
        ("copy", (9.22, 15.19, 10.34, 15.4), 1.12, 0),
        ("copy", (20.0, 6.0, 21.55, 6.25), 0, 1.0),
        ("copy", (20.0, 8.0, 21.55, 8.25), 0, -1.0),
        # why: the opening spans the whole wall (x 20.0-21.75): the old cap end on the left and the dark
        # channel on the right both go.
        ("copy", (20.0, 6.25, 21.75, 8.0), 2, 0),
    ],
    "market": [
        # Doorway through the pillar on rows 6-7.
        # why: it runs to x 22.15 so the pillar's shadow on the planks goes with the pillar.
        ("copy", (20.15, 5.45, 22.15, 7.8), 2.1, 0),
        ("tone", (20.15, 5.45, 22.15, 7.8), 0.15),
    ],
    "jail": [
        # The painted guard by the desk (the game places its own guard there).
        # why: plank grain from below him; the candle table and the spear stand sit either side.
        ("fill", (15.05, 4.8, 16.45, 7.15), whole((15.05, 4.8, 16.45, 7.15), 0, 2.3)),
    ],
}

# The jail's cell bars as (x0, y0, x1, y1) texel rectangles, end-exclusive, traced on the cleaned 576x384
# jail.png from each piece's black outline. why rectangles: the back wall's stones are the same dull grey
# as the iron, so only the shapes tell them apart. The barred window on the back wall is part of the wall
# and stays out.
_JAIL_RAIL_TOP, _JAIL_RAIL_MID, _JAIL_RAIL_BOTTOM = (73, 83), (198, 205), (257, 268)
# Solid iron, taken whole: the two corner posts, the three rails and the lock plate.
JAIL_SOLID_RECTS: list[tuple[int, int, int, int]] = [
    (136, 73, 152, 268),                        # left corner post
    (411, 73, 427, 268),                        # right corner post
    *[(136, y0, 427, y1) for y0, y1 in (_JAIL_RAIL_TOP, _JAIL_RAIL_MID, _JAIL_RAIL_BOTTOM)],
    (309, 204, 327, 232),                       # lock plate
]
# Thin bars, which keep only their iron pixels (see jail_front): the full-height bars run top rail to
# bottom rail; the door's bars run middle rail to bottom rail (the painting leaves the door's top open).
JAIL_THIN_RECTS: list[tuple[int, int, int, int]] = [
    *[(x0, 73, x1 + 1, 268) for x0, x1 in ((159, 162), (173, 177), (190, 194), (205, 209), (221, 225),
                                           (238, 242), (255, 259), (327, 330), (344, 348), (361, 365),
                                           (378, 382), (396, 400))],
    *[(x0, 198, x1 + 1, 268) for x0, x1 in ((265, 268), (281, 284), (297, 300), (313, 317))],
]


def tx(v: float) -> int:
    """Tile coordinate -> texel coordinate."""
    return round(v * TEXELS_PER_TILE)


def run_step(img: np.ndarray, step: Step) -> None:
    """Apply one CLEANUP step to the float room image in place; fails on an unknown step kind."""
    kind = step[0]
    x0, y0, x1, y1 = (tx(v) for v in step[1])
    if kind == "fill":
        parts = [(tx(xa), tx(xb), tx(ya), tx(yb), tx(dx), tx(dy)) for xa, xb, ya, yb, dx, dy in step[2]]
        fill(img, (x0, y0, x1, y1), parts)
    elif kind == "copy":
        dx, dy = tx(step[2]), tx(step[3])
        img[y0:y1, x0:x1] = img[y0 + dy:y1 + dy, x0 + dx:x1 + dx].copy()
    elif kind == "blend":
        (lx, ly), (rx, ry) = step[2], step[3]
        left = img[y0 + tx(ly):y1 + tx(ly), x0 + tx(lx):x1 + tx(lx)]
        right = img[y0 + tx(ry):y1 + tx(ry), x0 + tx(rx):x1 + tx(rx)]
        weight = np.linspace(0, 1, x1 - x0)[None, :, None]
        img[y0:y1, x0:x1] = left * (1 - weight) + right * weight
    elif kind == "tone":
        edge = tx(step[2])
        band = img[y0:y1]
        # Per-channel gain at each side: mean colour just outside / mean colour just inside.
        left_gain = band[:, x0 - edge:x0].mean((0, 1)) / band[:, x0:x0 + edge].mean((0, 1))
        right_gain = band[:, x1:x1 + edge].mean((0, 1)) / band[:, x1 - edge:x1].mean((0, 1))
        weight = np.linspace(0, 1, x1 - x0)[None, :, None]
        img[y0:y1, x0:x1] = band[:, x0:x1] * (left_gain * (1 - weight) + right_gain * weight)
    elif kind == "tone-rows":
        edge = tx(step[2])
        band = img[y0:y1]
        # Per-row, per-channel mean colour of the strips just outside and just inside each side.
        out_l, in_l = band[:, x0 - edge:x0].mean(1), band[:, x0:x0 + edge].mean(1)
        out_r, in_r = band[:, x1:x1 + edge].mean(1), band[:, x1 - edge:x1].mean(1)
        # why: smoothing the means over 5 rows keeps a single dark plank seam from setting its row's gain.
        kernel = np.ones(5) / 5
        smooth = lambda a: np.stack([np.convolve(np.pad(a[:, c], 2, mode="edge"), kernel, "valid")
                                     for c in range(a.shape[1])], 1)
        left_gain = smooth(out_l) / smooth(in_l)
        right_gain = smooth(out_r) / smooth(in_r)
        weight = np.linspace(0, 1, x1 - x0)[None, :, None]
        img[y0:y1, x0:x1] = band[:, x0:x1] * (left_gain[:, None] * (1 - weight) + right_gain[:, None] * weight)
    else:
        raise RuntimeError(f"pack-civic-interiors-art: unknown clean-up step {kind!r}")


def build_room(room: str) -> Image.Image:
    """Scale one painting to its room size, run its clean-up steps and sharpen it."""
    source_size, (w, h) = ROOMS[room]
    source = Image.open(SOURCES / f"{room}.webp").convert("RGB")
    if source.size != source_size:
        raise RuntimeError(f"pack-civic-interiors-art: {room}.webp is {source.size}, expected {source_size}")
    scaled = source.resize((w * TEXELS_PER_TILE, h * TEXELS_PER_TILE), Image.Resampling.LANCZOS)
    img = np.asarray(scaled).astype(np.float64).copy()
    for step in CLEANUP[room]:
        run_step(img, step)
    return sharpen(Image.fromarray(np.clip(np.rint(img), 0, 255).astype(np.uint8)))


def anchored_pixels(keep: np.ndarray, seed_rows: np.ndarray) -> np.ndarray:
    """
    The pixels of `keep` (a 2-D bool array) joined, by 4-neighbour steps through `keep`, to any row
    flagged in `seed_rows` (a 1-D bool array, one flag per row). why: inside one thin bar's rectangle,
    seeded from the rows it shares with a rail, this keeps the bar itself and drops the loose bits of
    other painted things that pass the iron colour test, such as the pillow's dark outline. Seeding
    every rail row, not just the end row, matters: a bar's end row can be a warm rail highlight.
    Pure Python flood fill; each bar rectangle is only a few thousand pixels.
    """
    height, width = keep.shape
    seen = np.zeros_like(keep)
    stack = [(y, x) for y in range(height) if seed_rows[y] for x in range(width) if keep[y, x]]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and keep[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    return seen


def jail_front(room: Image.Image) -> Image.Image:
    """
    The jail's cell bars only, copied from the finished room and clear everywhere else. The game draws
    this above actors, so a keeper inside the cell stands behind the bars. JAIL_SOLID_RECTS are taken
    whole; JAIL_THIN_RECTS keep only iron pixels. why: the painting draws the bed's pillow over one thin
    bar, and the pillow must not cover a keeper lying in that bed. Iron is black outline or dull grey;
    the pillow is bright and the bed is warm (high saturation). The posts and rails have warm highlights,
    so that test would punch holes in them. Loose iron-coloured bits not joined to a bar's ends drop out
    (see anchored_pixels).
    """
    rgb = np.asarray(room.convert("RGB")).astype(np.float64)
    hi, lo = rgb.max(-1), rgb.min(-1)
    sat = (hi - lo) / np.maximum(hi, 1)
    iron = (hi < 35) | ((sat < 0.4) & (hi < 185))
    rail_rows = np.zeros(room.height, bool)
    for y0, y1 in (_JAIL_RAIL_TOP, _JAIL_RAIL_MID, _JAIL_RAIL_BOTTOM):
        rail_rows[y0:y1] = True
    keep = np.zeros((room.height, room.width), bool)
    for rects, thin in ((JAIL_SOLID_RECTS, False), (JAIL_THIN_RECTS, True)):
        for x0, y0, x1, y1 in rects:
            if not (0 <= x0 < x1 <= room.width and 0 <= y0 < y1 <= room.height):
                raise RuntimeError(f"pack-civic-interiors-art: jail bar rectangle {(x0, y0, x1, y1)} is off the room")
            keep[y0:y1, x0:x1] |= anchored_pixels(iron[y0:y1, x0:x1], rail_rows[y0:y1]) if thin else True
    alpha = keep.astype(np.uint8) * 255
    out = np.zeros((room.height, room.width, 4), np.uint8)
    out[..., :3] = np.asarray(room.convert("RGB"))
    out[..., 3] = alpha
    return Image.fromarray(out, "RGBA")


def main() -> None:
    """Build the rooms named on the command line (all rooms when none are named)."""
    names = sys.argv[1:] or list(ROOMS)
    unknown = [n for n in names if n not in ROOMS]
    if unknown:
        raise RuntimeError(f"pack-civic-interiors-art: unknown rooms {unknown}")
    OUT.mkdir(parents=True, exist_ok=True)
    for room in names:
        texture = build_room(room)
        texture.save(OUT / f"{room}.png", optimize=True)
        if room == "jail":
            jail_front(texture).save(OUT / "jail-front.png", optimize=True)
        print(f"wrote {room}.png ({texture.width}x{texture.height})")


if __name__ == "__main__":
    main()
