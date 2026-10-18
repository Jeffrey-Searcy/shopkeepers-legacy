#!/usr/bin/env python3
"""
Beach art packer.

docs/art-source/beach/beach.png (1586x992) is a painted top-down Beach: a grass meadow along the north with
the town path, a cave and stairs, a sand strand with rocks, palms and driftwood, a tidal pool, and the sea.
It has no hero or HUD baked in. This script fits it to the 80x50 tile Beach map and writes the textures the
game draws (src/world/BeachArt.ts, src/world/PaintedRoomRenderer.ts, src/entities/ResourceNode.ts):

  * public/assets/beach/beach.png        -> the backdrop, 2560x1600 texels = 80x50 tiles at 2 texels per world
                                            pixel (32 texels per 16 px tile), with the resource trees and
                                            rocks (NODES below) painted out.
  * public/assets/beach/beach-front.png  -> clear except the palms and the lamp post (PIECES), drawn above
                                            the keeper so the keeper can walk behind a palm's fronds.
  * public/assets/beach/beach-nodes.png  -> the atlas of the painted trees and rocks.

The cutting itself lives in scripts/painted_outdoor.py (shared with the other painted outdoor maps); this
file holds only the Beach's measured shapes. The script prints the atlas frames as TypeScript for
BEACH_NODES in src/world/BeachArt.ts. Keep them in step.

Usage:  python3 scripts/pack-beach-art.py
Needs:  numpy, Pillow, and scripts/painted_art.py and scripts/painted_outdoor.py next to this file.
"""
from __future__ import annotations

from pathlib import Path

from painted_outdoor import Node, OutdoorArt, Piece, Rect, pack

REPO = Path(__file__).resolve().parent.parent

# Measured on the fitted painting with a tile grid (see the file header). Tree rows: ty = the trunk foot's row.
NODES: list[Node] = [
    Node("tree", 24, 11, ellipse=(24.6, 8.3, 3.0, 3.3), trunk=(23.3, 10.5, 26.0, 12.5)),
    # The three trees along the top edge run off the painting.
    Node("tree", 24, 2, poly=[(22.5, 0), (27, 0), (27.3, 2.5), (26.2, 3.0), (25.5, 3.3), (23.9, 3.3), (22.9, 2.9),
                              (22.0, 1.5)]),
    # why: the canopy ends near x 54; the flowering bush east of it stays in the backdrop.
    Node("tree", 51, 6, poly=[(49.6, 0), (54.2, 0), (54.2, 1.8), (54.1, 3.0), (53.8, 4.4), (53, 5.0),
                              (52.6, 6.9), (50.2, 6.9), (50.5, 5.0), (49.2, 4.6), (48.7, 3.3), (48.9, 1.4)]),
    Node("tree", 74, 4, poly=[(73.3, 0), (76.4, 0), (77.1, 2.5), (76.5, 4.4), (75.5, 5.0), (74.0, 5.0), (72.6, 4.2),
                              (72.2, 3.0), (72.8, 1.0)]),
    Node("rock", 18, 18, ellipse=(18.55, 18.35, 1.15, 0.95)),
    Node("rock", 37, 15, ellipse=(37.1, 15.1, 1.45, 1.0)),
    Node("rock", 68, 3, ellipse=(68.4, 2.65, 1.3, 1.1)),
    Node("rock", 31, 27, ellipse=(31.8, 27.0, 0.85, 0.75)),
    Node("rock", 34, 27, ellipse=(34.2, 26.6, 0.9, 1.05)),
    Node("rock", 67, 23, ellipse=(67.5, 22.8, 0.75, 0.78)),
    Node("rock", 69, 22, ellipse=(69.4, 22.1, 0.68, 0.75)),
    Node("rock", 71, 27, ellipse=(71.7, 27.15, 1.2, 0.9)),
    Node("rock", 57, 28, ellipse=(57.3, 27.75, 1.35, 0.95)),
    # why: a polygon, so the driftwood log that leans on this rock stays in the backdrop.
    Node("rock", 54, 29, poly=[(53.0, 29.0), (53.6, 28.25), (54.4, 28.05), (55.1, 28.3), (55.6, 28.8), (55.75, 29.4),
                               (55.3, 29.7), (55.0, 30.0), (54.5, 30.25), (53.6, 30.25), (53.0, 29.9), (52.9, 29.4)]),
]

PIECES: list[Piece] = [
    # why: the canopy polygon stops above the bushes at the palm's foot; only the trunk reaches the base.
    Piece("palm-west", base=20.2, cut="leaf", poly=[
        (6.3, 12.8), (7.3, 12.35), (8.6, 12.6), (9.6, 11.95), (11.0, 12.15), (11.5, 13.3), (11.95, 14.7), (11.8, 15.35),
        (11.0, 15.5), (10.9, 16.3), (10.55, 17.0), (9.3, 17.0), (8.6, 16.9), (7.6, 16.7), (7.0, 16.5), (6.9, 15.2),
        (6.1, 15.4), (6.05, 14.5)],
        trunks=[[(8.45, 15.0), (9.05, 15.0), (8.6, 16.0), (8.15, 17.0), (8.05, 18.0), (7.85, 19.0), (7.75, 20.25),
                 (7.2, 20.25), (7.15, 19.0), (7.25, 18.0), (7.45, 17.0), (7.75, 16.0)]]),
    # The two east palms overlap, so they are one piece (their trunks stand on solid tiles).
    # why: the canopy polygon stops above the bushes around the trunks and below the hedge behind the fronds.
    Piece("palms-east", base=21.3, cut="leaf", poly=[
        (72.45, 17.4), (72.5, 16.0), (73.1, 14.7), (74.4, 14.1), (75.4, 14.55), (76.3, 14.4), (77.0, 14.9), (77.8, 14.9),
        (78.5, 14.5), (80.0, 14.5), (80.0, 17.0), (79.5, 18.6), (78.3, 19.0), (77.2, 19.0), (75.5, 19.1), (74.9, 19.15),
        (73.8, 19.2), (73.2, 18.5)],
        trunks=[[(75.4, 16.9), (76.0, 16.9), (76.35, 18.0), (76.75, 19.0), (77.1, 20.0), (77.5, 21.0), (77.6, 21.4),
                 (76.65, 21.4), (76.35, 20.0), (75.95, 19.0), (75.7, 18.0)],
                [(79.6, 16.9), (80.0, 16.9), (80.0, 18.0), (79.9, 19.0), (79.7, 20.0), (79.25, 21.0), (79.15, 22.0),
                 (79.1, 22.6), (78.45, 22.6), (78.55, 21.0), (78.85, 20.0), (79.15, 19.0), (79.25, 18.0)]]),
    # The lamp post on the meadow west of the path: post, beam and lantern (a rectangle each, no colour cut,
    # because the meadow behind it is as green as the leaves of a palm).
    Piece("lamp-post", base=10.78, cut="none", poly=[], rects=[
        (36.62, 6.92, 39.82, 7.8), (37.25, 6.92, 37.99, 10.8), (38.6, 7.7, 39.72, 9.75)]),
]

# Painted features that must never be copied as grain (x0, y0, x1, y1 in tiles): big plants whose fine
# detail looks like plain ground to the scoring, so they would print a ghost into a rebuilt patch.
AVOID: list[Rect] = [
    (61.5, 1.2, 65.7, 4.3),  # the fern west of the boulder R(68,3)
]

if __name__ == "__main__":
    # The painting is scaled whole to 80x50 tiles (1586/2560 and 992/1600 differ by 0.1%).
    pack(OutdoorArt(name="beach", source=REPO / "docs" / "art-source" / "beach" / "beach.png", source_size=(1586, 992),
                    tiles=(80, 50), out=REPO / "public" / "assets" / "beach", nodes=NODES, pieces=PIECES,
                    avoid=AVOID, erase=[], nodes_label="BEACH_NODES (src/world/BeachArt.ts)",
                    pieces_label="BEACH_ART.pieces", exact_alpha=False, grain_grid=None, grain_cells="",
                    reach_tiles=12, cell_texels=128))
