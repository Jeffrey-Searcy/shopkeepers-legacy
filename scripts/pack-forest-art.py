#!/usr/bin/env python3
"""
Forest art packer.

docs/art-source/forest/forest.png (1339x1174) is a painted top-down Forest: a dirt trail from the Farm gate in
the north down through clearings to the road that runs east to Town, a pond with a dock, old ruins, a lamp
post, fences, logs and boulders. It has no hero or HUD baked in. This script fits it to the 80x70 tile
Forest map and writes the textures the game draws (src/world/ForestArt.ts, src/world/PaintedRoomRenderer.ts,
src/entities/ResourceNode.ts):

  * public/assets/forest/forest.png        -> the backdrop, 2560x2240 texels = 80x70 tiles at 2 texels per
                                              world pixel (32 texels per 16 px tile), with the resource trees
                                              and rocks (NODES below) and the painted animals (ERASE) painted
                                              out.
  * public/assets/forest/forest-front.png  -> clear except the lamp post (PIECES), drawn above the keeper so
                                              the keeper can walk behind it.
  * public/assets/forest/forest-nodes.png  -> the atlas of the painted trees and rocks.

The cutting itself lives in scripts/painted_outdoor.py (shared with the other painted outdoor maps); this
file holds only the Forest's measured shapes. The script prints the atlas frames as TypeScript for
FOREST_NODES in src/world/ForestArt.ts. Keep them in step.

Usage:  python3 scripts/pack-forest-art.py
Needs:  numpy, Pillow, and scripts/painted_art.py and scripts/painted_outdoor.py next to this file.
"""
from __future__ import annotations

import re
from pathlib import Path

from painted_outdoor import Erase, Node, OutdoorArt, Piece, Rect, pack

REPO = Path(__file__).resolve().parent.parent

# Measured on the fitted painting with a half-tile grid. Tree rows: ty = the row the trunk stands on.
# The painting has many more trees; only the ones with a clear trunk on open ground become resources
# (a tree whose trunk hides behind a bush, or whose canopy covers another tree, stays painted scenery).
NODES: list[Node] = [
    # Pine west of the south-west clearing.
    Node("tree", 19, 51, poly=[(19.1, 44.9), (19.6, 45.6), (20.0, 46.3), (20.4, 47.2), (20.9, 48.2), (21.2, 49.3),
                               (21.0, 50.4), (18.5, 50.5), (17.2, 50.4), (16.9, 49.6), (17.3, 48.3), (17.7, 47.2),
                               (18.2, 46.2), (18.6, 45.5)],
         trunk=(18.8, 50.2, 19.7, 51.95)),
    # Pine beside the ruins; why: the polygon stops at x 63 so the ruin rubble east of it stays in the backdrop.
    Node("tree", 61, 10, poly=[(61.0, 5.6), (61.5, 6.3), (62.0, 7.1), (62.5, 7.9), (63.0, 8.8), (63.0, 9.5),
                               (62.4, 10.0), (61.6, 10.1), (61.6, 10.9), (60.8, 10.9), (60.8, 10.1), (59.9, 10.0),
                               (59.2, 9.4), (59.3, 8.6), (59.8, 7.8), (60.2, 7.0), (60.6, 6.2)]),
    # Pine in the east clearing; why: the polygon skips the bright bush over its lower right.
    Node("tree", 68, 21, poly=[(68.5, 16.1), (69.0, 16.9), (69.5, 17.7), (70.0, 18.5), (70.4, 19.3), (70.6, 19.9),
                               (69.6, 20.1), (68.9, 20.4), (68.8, 21.6), (68.0, 21.6), (67.6, 21.0), (66.6, 20.9),
                               (66.4, 20.3), (66.8, 19.3), (67.2, 18.4), (67.6, 17.6), (68.0, 16.8)]),
    # Broadleaf in the east clearing; its roots reach half a tile below its tile, like the Beach trees.
    Node("tree", 61, 18, poly=[(59.3, 16.6), (59.4, 15.6), (60.0, 14.9), (61.0, 14.5), (62.2, 14.6), (63.0, 15.2),
                               (63.4, 16.2), (63.2, 17.2), (62.6, 17.8), (62.1, 18.0), (60.9, 18.0), (60.0, 17.7),
                               (59.5, 17.3)],
         trunk=(61.1, 17.8, 62.2, 19.45)),
    # Pine at the top of the little trail up to the deer clearing; a bush in front of it stays in the backdrop.
    Node("tree", 73, 38, poly=[(73.85, 32.3), (74.4, 33.0), (74.9, 33.9), (75.4, 34.9), (75.8, 35.9), (76.0, 36.9),
                               (75.7, 37.7), (74.1, 37.95), (74.1, 38.9), (73.4, 38.9), (73.4, 37.95), (72.0, 37.9),
                               (71.6, 37.3), (71.8, 36.2), (72.3, 35.0), (72.8, 34.0), (73.3, 33.0)]),
    # Broadleaf on the south trail.
    Node("tree", 20, 62, poly=[(17.8, 59.0), (17.9, 58.0), (18.6, 57.1), (19.6, 56.6), (20.8, 56.5), (21.8, 57.0),
                               (22.3, 58.0), (22.3, 59.2), (21.9, 60.3), (21.1, 61.0), (19.0, 61.0), (18.2, 60.3)],
         trunk=(19.4, 60.8, 21.0, 62.95)),
    # Pine at the west end of the log clearing; why: the polygon's right edge stops at x 48.45, short of the
    # blue-flowered bush its lower branches touch.
    Node("tree", 46, 27, poly=[(45.95, 19.4), (46.4, 20.2), (46.9, 21.2), (47.4, 22.2), (47.9, 23.3), (48.25, 24.4),
                               (48.45, 25.3), (48.2, 25.9), (47.2, 26.2), (45.4, 26.2), (44.0, 26.0), (43.4, 25.3),
                               (43.7, 24.3), (44.2, 23.2), (44.7, 22.1), (45.1, 21.1), (45.5, 20.2)],
         trunk=(45.3, 25.9, 47.15, 27.6)),
    # Round broadleaf in the bench clearing; why: its crown stops at y 39.75, below the mossy stone behind it.
    Node("tree", 11, 43, poly=[(11.3, 39.75), (11.9, 40.0), (12.4, 40.4), (12.75, 41.0), (12.85, 41.7), (12.6, 42.5),
                               (12.1, 43.0), (11.2, 43.15), (10.4, 43.0), (10.05, 42.4), (10.0, 41.6), (10.3, 40.8),
                               (10.75, 40.1)],
         trunk=(10.8, 43.0, 12.05, 44.3)),
    # Round broadleaf south of the road, beside the rock at (41, 58); why: its left edge stays east of that
    # rock's ellipse, so the two frames never claim the same pixel.
    Node("tree", 43, 57, poly=[(43.27, 54.6), (43.8, 54.8), (44.3, 55.3), (44.65, 55.9), (44.7, 56.6), (44.4, 57.15),
                               (43.9, 57.4), (42.8, 57.4), (42.45, 57.1), (42.15, 56.6), (41.95, 55.95), (42.2, 55.3),
                               (42.7, 54.8)],
         trunk=(42.9, 57.2, 43.85, 58.6)),
    # A boulder with a small rock beside it, in the bunny clearing.
    Node("rock", 20, 24, poly=[(19.0, 22.6), (19.5, 22.0), (20.4, 21.85), (21.0, 22.2), (21.35, 23.0), (21.5, 23.8),
                               (21.4, 24.6), (20.7, 24.9), (20.0, 24.8), (19.5, 24.3), (18.9, 23.9), (18.85, 23.2)]),
    Node("rock", 54, 3, ellipse=(54.9, 3.0, 0.95, 0.95)),
    Node("rock", 64, 21, ellipse=(64.65, 20.7, 0.95, 1.0)),
    Node("rock", 73, 13, ellipse=(73.9, 12.85, 1.0, 1.1)),
    Node("rock", 41, 58, ellipse=(41.3, 57.65, 1.0, 1.05)),
    Node("rock", 71, 41, ellipse=(71.1, 41.55, 1.05, 0.85)),
]

PIECES: list[Piece] = [
    # The lamp post in the lamp clearing: post and lantern (rectangles) and the arm (polygon), with no colour
    # cut, because the grass behind it is as green as leaves.
    Piece("lamp-post", base=28.45, cut="none",
          poly=[(36.9, 26.6), (39.3, 25.1), (40.25, 24.95), (40.3, 25.6), (39.5, 26.0), (37.9, 27.4), (37.0, 27.4)],
          rects=[(38.5, 25.4, 39.15, 28.45), (39.35, 25.8, 40.25, 27.3)]),
]

# Painted animals: they would stand frozen forever in a still picture, so they leave the backdrop.
ERASE: list[Erase] = [
    Erase("deer", poly=[(72.1, 25.0), (73.2, 24.9), (74.1, 25.3), (74.0, 26.6), (75.3, 26.9), (75.65, 27.6),
                        (75.5, 28.6), (75.4, 29.8), (74.4, 29.8), (73.0, 29.8), (72.8, 28.6), (72.2, 27.9),
                        (72.0, 27.0), (71.9, 25.8)]),
    Erase("bunny", ellipse=(14.5, 27.15, 0.65, 0.7)),
    Erase("crab", ellipse=(67.2, 41.9, 0.8, 0.7)),
]

# Painted features that must never be copied as grain (x0, y0, x1, y1 in tiles). None measured yet.
AVOID: list[Rect] = []


def forest_grid() -> list[str]:
    """
    FOREST_GRID's rows, read from src/world/ForestArt.ts (the one copy of the walk grid).
    Fails when the block cannot be found; painted_outdoor checks its size.
    """
    text = (REPO / "src" / "world" / "ForestArt.ts").read_text()
    start = text.find("export const FOREST_GRID")
    if start < 0:
        raise RuntimeError("pack-forest-art: FOREST_GRID not found in src/world/ForestArt.ts")
    block = text[text.index("[", text.index("=", start)) + 1:text.index("];", start)]
    return re.findall(r"^\s*'([^']*)',", block, flags=re.MULTILINE)


if __name__ == "__main__":
    # The painting is scaled whole to 80x70 tiles (1339/2560 and 1174/2240 differ by 0.2%).
    # why: exact shapes, because the Forest's trees and rocks stand among bushes as dark as they are; grain only
    # from walkable grass (dirt grain is flat and prints a smooth smear), so a cleared node looks like grass
    # the keeper can now walk on; a longer reach and smaller cells, because the grass clearings are small and
    # far apart.
    pack(OutdoorArt(name="forest", source=REPO / "docs" / "art-source" / "forest" / "forest.png",
                    source_size=(1339, 1174), tiles=(80, 70), out=REPO / "public" / "assets" / "forest",
                    nodes=NODES, pieces=PIECES, avoid=AVOID, erase=ERASE,
                    nodes_label="FOREST_NODES (src/world/ForestArt.ts)", pieces_label="FOREST_ART.pieces",
                    exact_alpha=True, grain_grid=forest_grid(), grain_cells=",", reach_tiles=20,
                    cell_texels=64))
