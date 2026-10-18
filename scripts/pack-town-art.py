#!/usr/bin/env python3
"""
Town art packer.

docs/art-source/town/town.png (1310x1201) is a top-down pixel-art Town (the 2026-10 redraw of the first
painting; docs/art-source/town/README.md says how it was made): a cobbled main road from the Mountain
pass in the north to the Beach in the south, a market plaza with a fountain, a river crossed by bridges, a
guild manor, a jail, a museum, a clinic, a ranch, a dock and a row of shops along the south road, all with
lamp posts, banners, hedges and trees. This script fits it to the 82x75 tile Town map and writes the textures
the game draws (src/world/TownArt.ts, src/world/PaintedRoomRenderer.ts, src/entities/ResourceNode.ts):

  * public/assets/town/town.png        -> the backdrop, 2624x2400 texels = 82x75 tiles at 2 texels per world
                                          pixel (32 texels per 16 px tile), with the meadow stones (NODES
                                          below) and the painted people and animals (ERASE) painted out.
  * public/assets/town/town-front.png  -> clear except the trees, lamp posts and banners (PIECES), drawn
                                          above the keeper so the keeper can walk behind them.
  * public/assets/town/town-nodes.png  -> the atlas holding the meadow stones' frame.
  * public/assets/town/town-water-*.png -> looping spritesheets laid over the painted water (WATER below): the
                                          river shimmers, the two waterfalls and the fountain's spray fall.
                                          They are cut from the finished town.png, so they always match it.

The cutting itself lives in scripts/painted_outdoor.py (shared with the other painted outdoor maps); this
file holds only the Town's measured shapes. The script prints the atlas frames as TypeScript for TOWN_NODES
and the piece boxes for TOWN_ART.pieces in src/world/TownArt.ts. Keep them in step. The water lines'
frameWidth and frameHeight must also go into the matching town-water-* entries of
public/assets/manifest.json (PaintedRoomRenderer fails loudly when a sheet does not match).

Usage:  python3 scripts/pack-town-art.py          (everything; prints TOWN_NODES, the pieces and the water)
        python3 scripts/pack-town-art.py water    (only the water sheets, from the current town.png)
Needs:  numpy, Pillow, and scripts/painted_art.py and scripts/painted_outdoor.py next to this file.
"""
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from painted_art import clean_mask, pool_frames, save_sheet, waterfall_frames
from painted_outdoor import Band, Erase, Node, OutdoorArt, Piece, Rect, pack

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "public" / "assets" / "town"
# Texels per tile side in the packed Town textures.
TILE_TEXELS = 32

# Measured on the fitted painting with a half-tile grid. ty = the row the rock's base stands on.
NODES: list[Node] = [
    # The meadow stones. why: the only resource node, because only a small shape on plain meadow has ground
    # around it that a cloned patch continues cleanly (see TREES below).
    Node("rock", 64, 57, ellipse=(64.3, 57.25, 0.9, 0.72), clone="auto"),
]


def ellipse_poly(cx: float, cy: float, rx: float, ry: float, sides: int = 24) -> list[tuple[float, float]]:
    """An ellipse (centre and radii, tiles) as a polygon of `sides` points, for a Piece (pieces take polygons)."""
    return [(cx + rx * math.cos(2 * math.pi * i / sides), cy + ry * math.sin(2 * math.pi * i / sides))
            for i in range(sides)]


# The painted trees. They stay scenery the keeper walks behind, not resources: a cleared tree needs plain
# ground painted under it, and the Town's lawns are too small and too busy (bushes, flowers, paths, fences) for
# a copied patch the size of a canopy to look like anything but other trees. The trunk tiles are solid in
# TOWN_GRID. Each outline is the canopy polygon plus the trunk rectangle, and the tree cut keeps only the
# leaves and bark inside it (not the lawn, path stones or flowers around them); base = the bottom of the trunk.
TREES: list[Piece] = [
    # Trees that hang over the windmill lane and the path down to the west lawn. The mid-green pine (tip x
    # 21.5 y 9.05, canopy x 20.3-23.0 to y 12.35, trunk x 21.3-21.95, roots x 21.17-22.23 to y 13.4) covers
    # the path's east half; the dark round tree behind it (x 22.5-25.6, y 7.92-11.1) covers the lane's south
    # half (band0 rows). The outline stops above the yellow-green tree in the fenced yard (from y 11.17) and
    # leaves the dark pine's top (pine-windmill-yard) below the line from (20.1, 11.4) to (21.05, 12.55). The
    # roots sit on solid tiles (21-22, 12-13).
    Piece("tree-windmill-lane", poly=[(21.5, 8.95), (22.45, 8.95), (22.7, 8.3), (23.3, 7.95), (24.1, 7.8),
          (24.8, 8), (25.3, 8.45), (25.6, 9.1), (25.7, 9.9), (25.55, 10.6), (25.15, 11.05), (23.1, 11.1), (23.1,
          12.05), (22.95, 12.45), (22.3, 12.5), (22.3, 13.45), (21.125, 13.45), (21.125, 12.55), (20.1, 11.4),
          (20.15, 11.15), (20.35, 10.6), (20.6, 10), (21, 9.45)], base=13.4, cut="tree"),
    # Dark pine at the west lawn's east end (tip x 20.05 y 11.45, canopy x 18.94-21.06 to y 14.3); its boughs
    # cover the path from the windmill lane (tiles (19-20, 12-13)). Trunk x 19.8-20.4, roots to y 14.75, on
    # solid tiles. The top edge follows tree-windmill-lane's split line (no texel in two cut-outs).
    Piece("pine-windmill-yard", poly=[(20.05, 11.4), (21, 12.6), (21, 13.6), (21.15, 13.75), (21.15, 14.35),
          (20.5, 14.4), (20.5, 14.8), (19.75, 14.8), (19.75, 14.4), (18.9, 14.35), (18.9, 13.7), (19.2, 12.8),
          (19.6, 12)], base=14.75, cut="tree"),
    # Tall round tree south of the west lawn whose top (tip x 15.99 y 13.15, x 14.4-17.4 by y 14.5) hangs over
    # the lawn's stepping-stone row (13). Trunk x 15.43-16.43, roots to y 18.17, in the forest south of the
    # lawn (rows 14-18 stay solid).
    Piece("tree-west-lawn", poly=[(15.99, 13.1), (16.6, 13.45), (17, 13.8), (17.3, 14.3), (17.45, 14.9), (17.4,
          15.6), (16.9, 16.3), (16.5, 16.5), (16.55, 18.2), (15.35, 18.2), (15.4, 16.5), (14.9, 16.3), (14.45,
          15.6), (14.35, 14.9), (14.5, 14.2), (14.9, 13.75), (15.4, 13.4)], base=18.15, cut="tree"),
    # Dark pine south of the manor lane; its pointed top (tip x 33.05 y 12.24, canopy x 31.94-34.15 to y 14.8)
    # hangs over the lane's south curb and the grass strip east of the main road. Trunk x 32.79-33.31, roots
    # to y 15.56 on solid tiles. The east edge stops at x 34.05 where the round tree of tree-guild-path-mid
    # begins (x 33.96).
    Piece("pine-guild-path", poly=[(33.05, 12.15), (33.5, 12.45), (33.85, 12.9), (34.05, 13.4), (34.05, 14.6),
          (33.8, 14.85), (33.35, 14.9), (33.35, 15.6), (32.7, 15.6), (32.7, 14.9), (32.2, 14.85), (31.85, 14.6),
          (31.85, 13.9), (32.05, 13.3), (32.3, 12.75), (32.65, 12.35)], base=15.55, cut="tree"),
    # Round tree in the grove south of the manor lane; its top (tip x 35.39 y 12.45, canopy x 33.96-36.9)
    # hangs over the lane's east end and the grass that joins the lane to the flower lawn (tiles (35, 12),
    # (36, 13)). Trunk x 34.97-35.57 down to the fence at y 17.3, on solid tiles. The outline stays west of
    # pine-guild-path (x 34.05) and of tree-guild-lawn (x 37.2).
    Piece("tree-guild-path-mid", poly=[(35.39, 12.4), (35.9, 12.55), (36.35, 12.95), (36.7, 13.5), (36.9, 14),
          (36.9, 15.2), (36.3, 16.2), (35.6, 16.3), (35.6, 17.3), (34.95, 17.3), (34.95, 16.3), (34.4, 16.2),
          (34.1, 15.6), (34.1, 13.5), (34.4, 13), (34.85, 12.6)], base=17.3, cut="tree"),
    # Round tree behind the big tree south of the guild lawn; its top (tip x 38.52 y 12.93, canopy x
    # 37.25-39.9) hangs over the lawn that joins the flower lawn to the guild's dirt road (row 13). Its trunk
    # is hidden behind the big round tree (canopy from y 14.13), so the outline stops along that tree's top
    # and the base is set below the walkable row (tiles (37-39, 14) stay solid).
    Piece("tree-guild-lawn", poly=[(38.52, 12.88), (39.1, 13.05), (39.5, 13.45), (39.8, 13.95), (39.95, 14.5),
          (39.9, 15), (39.1, 15), (38.4, 14.4), (37.7, 14.15), (37.25, 14.1), (37.2, 13.6), (37.5, 13.15), (38,
          12.93)], base=15, cut="tree"),
    # Big round tree on the lawn north of the guardhouse (canopy x 67.24-71.23, y 8.51-12.1); its canopy
    # covers the only link between the lawn strip west of the guardhouse and the stepping-stone lawn east of
    # it. Trunk x 68.75-69.58, roots x 68.46-69.9 to y 13.25 just above the guardhouse roof (blocked tiles
    # (68-69, 12)).
    Piece("tree-guardhouse-lawn", poly=[(69.2, 8.45), (69.9, 8.55), (70.4, 8.9), (70.8, 9.4), (71.15, 9.9),
          (71.3, 10.5), (71.3, 11.1), (70.95, 11.7), (70.4, 12.1), (70, 12.15), (70, 13.3), (68.4, 13.3), (68.4,
          12.15), (67.8, 12.05), (67.4, 11.6), (67.2, 10.8), (67.35, 10), (67.7, 9.45), (68.15, 8.95), (68.6,
          8.6)], base=13.3, cut="tree"),
    # Round tree by the shrine stones (canopy x 74.07-77.26, y 10.48-13.81); its canopy covers the lawn east
    # of the stepping stones. Trunk x 75.2-76.0, roots to y 14.71. The outline stays off the low bushes east
    # of the trunk (x 76.15-78.5, from y 12.7).
    Piece("tree-shrine-lawn", poly=[(75.7, 10.42), (76.4, 10.5), (76.85, 10.8), (77.15, 11.3), (77.3, 11.9),
          (77.25, 12.45), (76.95, 12.7), (76.15, 12.7), (76.05, 13.3), (76.05, 14.75), (75.15, 14.75), (75.15,
          13.85), (74.6, 13.6), (74.25, 13.1), (74.05, 12.4), (74.15, 11.6), (74.5, 11), (75.05, 10.6)],
          base=14.75, cut="tree"),
    # round tree at the west end of the west road: its crown hangs over the road's south half (x 0-3.25, top y
    # 20.82, crown bottom y 24.1); the trunk stands on solid lawn at x 0.9-1.95, y 24-25
    Piece("tree-west-road-end", poly=[(0, 21.35), (0.25, 21.15), (0.6, 20.95), (1, 20.85), (1.5, 20.82), (2,
          20.85), (2.45, 20.98), (2.85, 21.1), (3.1, 21.25), (3.25, 21.5), (3.25, 23.3), (3.05, 23.65), (2.6,
          24), (2, 24.1), (0, 24.1)], base=25, cut="tree", rects=[(0.9, 24, 1.95, 25)]),
    # Pine south of the west road; its tip reaches into road row 20 and its body covers the road's south curb
    Piece("pine-west-road", poly=[(21.39, 19.58), (21.75, 20), (22.27, 20.5), (22.32, 21), (22.43, 21.5),
          (22.64, 22), (22.64, 22.5), (22.48, 22.8), (21.75, 22.8), (21.75, 23.2), (21.1, 23.2), (21.1, 22.8),
          (20.55, 22.8), (20.24, 22.5), (20.14, 22), (20.24, 21.5), (20.45, 21), (20.6, 20.5), (21.07, 20)],
          base=23.25, cut="tree"),
    # pine west of pine-west-road (mark 11): its tip hangs over the west road (x 17.4-19.3, top y 20.6); it
    # stands on solid lawn north of the fence, like pine-west-road
    Piece("pine-west-road-west", poly=[(18.36, 20.6), (18.75, 20.8), (19.05, 21.05), (19.25, 21.3), (19.35,
          21.6), (19.5, 22), (19.6, 22.4), (19.5, 22.75), (19.3, 23), (17.4, 23), (17.15, 22.75), (17.1, 22.4),
          (17.2, 22), (17.35, 21.6), (17.5, 21.25), (17.75, 20.95), (18, 20.75)], base=23.25, cut="tree"),
    # yellow-green pine east of pine-west-road (mark 11): its tip hangs over the west road (x 23.3-24.8, top y
    # 21.12); it stands on solid lawn north of the fence
    Piece("pine-west-road-east", poly=[(24.1, 21.12), (24.4, 21.35), (24.65, 21.6), (24.85, 21.85), (25.05,
          22.2), (25.2, 22.5), (25.1, 22.8), (24.85, 23.05), (23.3, 23.05), (23.05, 22.8), (23, 22.5), (23.1,
          22.2), (23.3, 21.85), (23.5, 21.55), (23.8, 21.3)], base=23.25, cut="tree"),
    # mark 38: tip of the pine behind the market house hangs over the west road's south edge (x 13.8-14.26,
    # top y 21.27). Cut at the road's south edge y 21.75 (deepest feet). The pine stands on solid lawn behind
    # the market roof; base/foot are on that blocked lawn
    Piece("pine-market-back", poly=[(13.95, 21.25), (14.1, 21.3), (14.2, 21.5), (14.3, 21.65), (14.3, 21.75),
          (13.72, 21.75), (13.75, 21.6), (13.8, 21.45)], base=23, cut="tree"),
    # the two overlapping round trees on the notice lawn's south edge: crowns x 33.27-38.8, top y 19.55, over
    # the lawn; trunks x 34.4-35.45 (roots to y 24.15) and x 36.3-37.75 (roots to y 25.2) stand on solid
    # ground. The small pine in front (x 35.3-36.6, top y 23.82) stays out of the outline
    Piece("tree-notice-lawn", poly=[(35.05, 19.55), (35.45, 19.65), (35.75, 19.95), (36.05, 20.3), (36.35,
          20.7), (36.65, 20.85), (36.95, 20.85), (37.3, 21), (37.65, 21.3), (38, 21.7), (38.35, 22.1), (38.6,
          22.45), (38.75, 22.8), (38.8, 23.3), (38.75, 23.7), (38.5, 23.97), (36.65, 23.97), (36.2, 23.8),
          (35.6, 23.5), (35.4, 23.4), (35.4, 22.9), (34.2, 22.9), (33.8, 22.65), (33.5, 22.35), (33.3, 22),
          (33.27, 21.5), (33.38, 21.05), (33.62, 20.6), (33.95, 20.2), (34.3, 19.85), (34.7, 19.62)],
          base=25.25, cut="tree", rects=[(34.4, 22.4, 35.45, 24.2), (36.3, 23.9, 37.75, 25.25)]),
    # round tree by the stepping stones west of the river: bright crown x 52-55.05, top y 17.85, dark lower
    # crown x 50.75-52.06 to y 21.96, over the grass nook x 52-55, rows 18-22; trunk and roots x 52.28-53.96
    # to y 22.85 stand on solid tile 53
    Piece("tree-stepping-stones", poly=[(52.4, 17.85), (53.5, 17.85), (54.2, 18.05), (54.6, 18.35), (54.9,
          18.85), (55.05, 19.4), (55.05, 20.5), (54.9, 20.95), (54.55, 21.4), (54.05, 21.6), (53.95, 21.55),
          (52.3, 21.55), (52, 21.95), (51.25, 21.95), (50.95, 21.6), (50.75, 21), (50.75, 19.9), (50.95, 19.4),
          (51.3, 19.05), (52, 18.95), (52.05, 18.25)], base=22.9, cut="tree", rects=[(52.3, 21.45, 53.95,
          22.9)]),
    # top slice of the light-green round tree south of the guardhouse road (x 69.06-71.06, top y 24.34); it
    # covers the road's south half. Only the slice above y 25.75: the rest stands on solid lawn (from y 25.5)
    # by the ranch-garden fence
    Piece("tree-guardhouse-road", poly=[(69.1, 25.75), (69.1, 25.1), (69.3, 24.8), (69.6, 24.55), (69.85, 24.4),
          (70.05, 24.35), (70.3, 24.5), (70.6, 24.65), (70.8, 24.8), (70.95, 25.1), (71.05, 25.4), (71.05,
          25.75)], base=25.75, cut="tree"),
    # top slice of the big round tree south of the guardhouse road (x 73-76.2, top y 24.59); it covers the
    # road's south half. Only the slice above y 25.75: the rest is solid lawn
    Piece("bush-guardhouse-road", poly=[(73, 25.75), (73.1, 25.5), (73.35, 25.25), (73.6, 25.05), (74, 24.85),
          (74.4, 24.7), (74.75, 24.6), (75.1, 24.72), (75.4, 24.95), (75.7, 25.1), (75.85, 25.35), (76.1, 25.6),
          (76.3, 25.75)], base=25.75, cut="tree"),
    # round tree in the magic shop's back garden: its crown (x 9.2-11.95, top y 34.36) hangs over the south
    # half of the road behind the shop. Cut at y 36 so the shed chimney below stays out; kept east of x 9.32
    # to stay clear of the corner lamp head (x 8.5-9.31, band4 piece lamp-magic-corner)
    Piece("tree-magic-garden", poly=[(9.32, 36), (9.32, 35.5), (9.5, 35.12), (9.75, 34.8), (10, 34.58), (10.25,
          34.36), (10.5, 34.42), (10.75, 34.58), (11, 34.72), (11.3, 34.85), (11.55, 35.1), (11.75, 35.4),
          (11.92, 35.75), (11.95, 36)], base=36.5, cut="tree"),
    # Round tree west of the stepping stones east of the plaza: crown x 37.6-39.82, y 36.1-38.95, trunk and
    # roots to y 40. The lawn under the crown stays walkable; only the trunk blocks. The bush east of the
    # trunk (x 38.98-40.23) is a plain blocked thing, not part of the piece.
    Piece("tree-forge-strip", poly=[(37.97, 36.1), (38.9, 36.1), (39.15, 36.5), (39.45, 37), (39.7, 37.5),
          (39.82, 38), (39.8, 38.6), (39.6, 38.95), (39.1, 38.95), (39.15, 39.6), (39.2, 40), (37.95, 40),
          (38.1, 39.6), (38.1, 38.95), (37.7, 38.9), (37.6, 38.5), (37.6, 37), (37.75, 36.5)], base=40,
          cut="tree"),
    # Small pine on the garden lawn above the bar roof (crown x 18.38-20.85, y 40.5-43.9, trunk to y 44.12).
    # It stands on the walk from the garden down to the magic shop's apron; the lawn under the crown stays
    # walkable and only the trunk foot blocks.
    Piece("pine-bar-garden", poly=[(19.82, 40.5), (20.1, 40.9), (20.45, 41.4), (20.65, 41.9), (20.85, 42.6),
          (20.5, 43), (19.9, 43.5), (19.65, 43.75), (19.68, 44.12), (19.35, 44.12), (19.4, 43.95), (18.65,
          43.9), (18.4, 43.5), (18.38, 43), (18.6, 42.5), (18.8, 42), (19, 41.5), (19.6, 40.95)], base=44.1,
          cut="tree"),
    # Round tree at the west end of the ranch lawn, east of the bridge: crown x 65.05-67.35, y 41.66-43.85,
    # trunk to y 44.55. The lawn and stepping stones under the crown stay walkable; only the trunk foot
    # blocks.
    Piece("tree-ranch-west", poly=[(66.15, 41.66), (66.6, 41.8), (66.9, 42.05), (67.2, 42.5), (67.35, 43),
          (67.2, 43.5), (66.9, 43.8), (66.5, 43.85), (66.5, 44.55), (65.8, 44.55), (65.8, 43.85), (65.4, 43.8),
          (65.15, 43.5), (65.05, 43), (65.2, 42.5), (65.45, 42.05), (65.75, 41.8)], base=44.5, cut="tree"),
    # Round tree in the middle of the ranch lawn: crown x 69.37-71.6, y 41.57-43.95, trunk to y 44.12 just
    # above the ranch fence. The lawn under the crown stays walkable; only the trunk foot blocks.
    Piece("tree-ranch-middle", poly=[(70.48, 41.57), (70.9, 41.7), (71.2, 42), (71.4, 42.5), (71.6, 43), (71.55,
          43.5), (71.2, 43.9), (70.72, 43.95), (70.72, 44.12), (70.18, 44.12), (70.18, 43.95), (69.6, 43.9),
          (69.4, 43.5), (69.37, 43), (69.6, 42.5), (69.8, 42), (70.1, 41.7)], base=44.1, cut="tree"),
    # big tree west of the magic shop: its canopy (left edge from (8.6,48.93) to (6.05,51.6)) hangs over the
    # forest road corner (6,49),(7,49),(6,50),(7,50) and the curb; trunk x 7.9-9.05 to the root bottom y 54.5
    Piece("tree-forest-road", poly=[(8.6, 48.93), (9.2, 49.3), (9.2, 51.75), (6.05, 51.75), (6.05, 51.6), (6.18,
          51.3), (6.36, 50.8), (6.71, 50.45), (7.25, 50), (7.96, 49.5)], base=54.5, cut="tree", rects=[(7.9,
          51.75, 9.05, 54.5)]),
    # small pine on top of the alley's east fence post south of the magic yard (crown x 14.5-16.3, y
    # 45.8-47.9): its crown hangs over the stone path strip and the grass alley; it stands on the post column
    Piece("pine-magic-yard", poly=[(15.49, 45.8), (15.7, 46), (15.9, 46.25), (16.12, 46.5), (16.22, 46.75),
          (16.27, 47), (16.3, 47.5), (16.2, 47.85), (14.85, 47.9), (14.55, 47.65), (14.5, 47.3), (14.5, 47),
          (14.62, 46.75), (14.86, 46.5), (15.1, 46.25), (15.3, 46)], base=47.9, cut="tree"),
    # Pine in the ranch yard: its crown (x 74.25-77.55, tip y 41.75) hangs over the ranch lawn rows 42-43
    # north of the fence; the trunk base (y 47.15) stands in the solid ranch yard.
    Piece("pine-ranch", poly=[(75.96, 41.75), (76.5, 42.6), (76.95, 43.15), (77.25, 44), (77.55, 45), (77.5,
          45.9), (77, 46.15), (76.45, 46.3), (76.7, 47.15), (75.2, 47.15), (75.55, 46.3), (74.9, 46.2), (74.25,
          45.9), (74.25, 45), (74.55, 44), (74.8, 43.1), (75.4, 42.6)], base=47.15, cut="tree"),
    # The big meadow tree and the pine painted into its canopy (no line splits them). The polygon skips the
    # light bush west of the trunk and the fence below.
    Piece("tree-meadow", poly=[(58.96, 55.3), (59.9, 55.75), (60.5, 56.5), (61.3, 57.4), (61.75, 58.6), (61.9,
          59.8), (60.9, 60.2), (59.9, 59.9), (59.5, 60.6), (58.4, 60.6), (58.3, 59.9), (57.8, 59.35), (56.9,
          59.15), (56.4, 58.4), (56.5, 57.1), (57.6, 55.9)], base=60.6, cut="tree"),
    # The pine under the meadow lamp; its tip stops short of the lamp post.
    Piece("pine-meadow", poly=[(78.29, 57), (78.95, 57.95), (79.35, 58.9), (79.8, 59.85), (79.85, 60.5), (78.85,
          60.6), (78.8, 61), (78.15, 61), (78.1, 60.6), (76.95, 60.5), (76.9, 59.85), (77.3, 58.9), (77.7,
          57.95)], base=61, cut="tree"),
    # Big tree south-west of the forge: canopy x 33.2-37.5, y 51.0-55.0 over the forge road and the lawn path;
    # trunk to y 55.75.
    Piece("tree-forge-lawn", poly=[(37.52, 53), (37.446, 53.518), (37.229, 54), (36.884, 54.414), (36.435,
          54.732), (35.912, 54.932), (35.35, 55), (34.788, 54.932), (34.265, 54.732), (33.816, 54.414), (33.471,
          54), (33.254, 53.518), (33.18, 53), (33.254, 52.482), (33.471, 52), (33.816, 51.586), (34.265,
          51.268), (34.788, 51.068), (35.35, 51), (35.912, 51.068), (36.435, 51.268), (36.884, 51.586), (37.229,
          52), (37.446, 52.482)], base=55.75, cut="tree", rects=[(34.6, 54.4, 36.2, 55.75)]),
    # big bush crown (x 21.9-26.6, top y 72.2) hangs over the south edge of the road at x 22.7-25.6; its body
    # below row 73 is already solid
    Piece("bush-south-road", poly=[(22.9, 72.75), (23.4, 72.5), (23.9, 72.35), (24.15, 72.2), (24.5, 72.4), (25,
          72.6), (25.6, 73.15), (26.25, 73.7), (26.6, 74.3), (26.6, 75), (21.9, 75), (21.9, 74), (22.4, 73.4),
          (22.7, 73)], base=75, cut="tree"),
    # Top of the dark grove south of the meadow; it hangs over meadow rows 58-59. Everything south of y 61 is
    # solid; base = the grove trunks' foot (y 65.75).
    Piece("grove-meadow-south", poly=[(63.55, 60), (63.7, 59.7), (64, 59.28), (64.32, 58.88), (64.78, 58.55),
          (65.23, 58.42), (65.65, 58.55), (66.06, 58.88), (66.55, 59.45), (66.95, 60)], base=65.75, cut="tree"),
]


# Lamp posts and banners the keeper can walk behind (a walkable tile lies north of the post). Each outline is a
# few rectangles (lantern or banner, post, foot); the ground cut keeps only the iron, glass and cloth inside
# them, so no grass or cobbles are drawn over a keeper behind the post. base = the bottom of the post. Lamps
# with no walkable tile behind them stay in the backdrop.
PIECES: list[Piece] = TREES + [
    # Lantern, cross bar, banner and pole on the grass strip west of the main road: the lantern (x
    # 27.07-27.85, y 6.46-7.81) and the bar (x 26.66-28.32, y 8.42-8.75) hang over the windmill lane (band0
    # rows); the banner (x 26.86-28.06, to y 11.33) and pole hang over the grass strip. Rects: lantern, neck,
    # bar, banner, pole, stone foot (x 27.11-27.83, y 12.76-13.67, blocked).
    Piece("banner-windmill-lane", poly=[], base=13.7, cut="ground", rects=[(27.05, 6.45, 27.9, 7.85), (27.25,
          7.8, 27.75, 8.45), (26.6, 8.4, 28.35, 8.8), (26.8, 8.75, 28.1, 11.4), (27.28, 11.35, 27.62, 12.8),
          (27.05, 12.75, 27.9, 13.7)]),
    # Iron lamp on the grass at the north end of the east road: head x 78.46-79.36 from y 11.4, pole x
    # 78.66-79.05, stone base x 78.46-79.2 y 14.33-14.95 (blocked). The keeper walks behind the head and pole
    # on the lawn strip.
    Piece("lamp-east-north", poly=[], base=14.95, cut="ground", rects=[(78.45, 11.35, 79.4, 12.95), (78.6, 12.9,
          79.1, 14.35), (78.45, 14.3, 79.25, 14.97)]),
    # Banner and lantern at the corner of the west road and the main road; the lantern hangs over the road
    Piece("banner-west-road", poly=[], base=25, cut="ground", rects=[(28, 19.15, 28.65, 20.35), (26.6, 20.45,
          28.45, 20.85), (26.9, 20.85, 28.1, 23.45), (27.35, 19.5, 27.7, 24.7), (27.15, 24.6, 27.95, 25.05)]),
    # Banner and lantern standing on the notice lawn; the cloth covers the lawn's west entry from the main
    # road
    Piece("banner-notice-lawn", poly=[], base=24.75, cut="ground", rects=[(30.72, 18.1, 31.56, 19.45), (30.72,
          19.45, 31, 20.75), (31.03, 19.6, 32.75, 19.85), (31.3, 19.8, 32.55, 22.5), (31.75, 18.5, 32, 24.1),
          (31.48, 24.05, 32.46, 24.72)]),
    # The market stall's plank roof; the keeper walks behind it at the foot of the guild steps, so it is drawn
    # above the keeper there. It stops at y 17.38, the roof lip: the painted stall keeper under it is erased
    # (stall-keeper in ERASE), and that patch's soft edge and its band (x 40.92-41.28) reach up to y 17.5,
    # which no front piece may hold.
    Piece("stall-roof-notice-lawn", poly=[], base=19.7, cut="ground", rects=[(40.5, 16.3, 43.25, 17.38)]),
    # iron lamp west of the notice board: glass head x 45.05-45.95, y 20.15-21.6 and pole x 45.28-45.7 over
    # the lawn; its stone base (x 45.19-45.83, y 23.03-23.73) stands on solid tile 45,23
    Piece("lamp-notice-board", poly=[], base=23.75, cut="ground", rects=[(45.05, 20.15, 45.95, 21.6), (45.25,
          21.6, 45.8, 23.75)]),
    # glass head (x 46.57-47.24, y 23.58-24.2) of the little stone lantern at the road's west end, over the
    # road sand; its box (x 46.58-47.36, y 24.2-24.98) stays blocked. Unlit: no light
    Piece("lantern-museum-road", poly=[], base=25, cut="ground", rects=[(46.55, 23.55, 47.3, 24.2)]),
    # lamp on the west bridge-end pillar: head x 55.25-56.5, y 23.15-24.6 over the road where it meets the
    # bridge deck; the pillar (y 24.8-26) is solid
    Piece("lamp-north-bridge-west", poly=[], base=25, cut="ground", rects=[(55.2, 23.15, 56.6, 26)]),
    # lamp on the east bridge-end pillar: head x 63.36-64.77, y 23.1-24.6 over the road where it meets the
    # bridge deck; the pillar (y 24.8-26) is solid
    Piece("lamp-north-bridge-east", poly=[], base=25, cut="ground", rects=[(63.35, 23.1, 64.8, 26)]),
    # street lamp on the west side of the middle road: its head (x 49.79-50.64, y 33.03-34.5) hangs over the
    # road and the museum road junction; the post foot (x 49.84-50.68) stands in the solid verge tile (50,36)
    # and now reaches y 37.46
    Piece("lamp-middle-road", poly=[], base=36.95, cut="ground", rects=[(49.75, 33, 50.65, 34.6), (49.9, 34.55,
          50.5, 36.95)]),
    # mark 36: top of the plaza fountain statue and its water dome (x 28.7-30.8, tip y 30.62) as seen over the
    # cobbles behind it. Statue/water texels only; cut at y 31.75 (deepest feet) so it stays above the
    # animated fountain-spray sprite (drawn at x 28.25-31.625, y 31.94-34). The statue stands in the basin
    # (blocked), so no foot; base 32.0 is just below the deepest feet
    Piece("statue-fountain", poly=[(29.55, 30.62), (29.9, 30.62), (30.05, 30.9), (30.25, 31.05), (30.5, 31.3),
          (30.72, 31.55), (30.8, 31.75), (28.7, 31.75), (28.78, 31.55), (29, 31.3), (29.3, 31.05), (29.45,
          30.85)], base=32, cut="none"),
    # Tall banner in the garden east of the magic shop: finial over the back road, crossbar, flag (x
    # 18.25-19.65, y 36.45-39.05), pole and its foot (x 18.43-19.15, y 40.6-41.3) on the garden lawn. The lawn
    # round the pole stays walkable; only the foot blocks.
    Piece("banner-magic-garden", poly=[], base=41.3, cut="ground", rects=[(18.75, 35.05, 19.05, 36.25), (18,
          36.25, 19.7, 36.5), (18.25, 36.45, 19.65, 39.05), (18.65, 39, 19, 40.65), (18.4, 40.6, 19.15, 41.3)]),
    # Street lamp on the grass verge east of the west road at the magic shop's back corner: finial, head (x
    # 8.5-9.31, y 35.85-36.95), post and base ornament (y 38.45-39.25). The head box stops at x 9.19 above y
    # 36 to stay clear of band3's tree-magic-garden outline.
    Piece("lamp-magic-corner", poly=[], base=39.25, cut="ground", rects=[(8.69, 35.55, 9.06, 35.85), (8.5,
          35.85, 9.19, 36), (8.5, 36, 9.31, 36.95), (8.75, 36.95, 9, 38.45), (8.5, 38.45, 9.25, 39.25)]),
    # The weather vane on the magic shop roof (arrow tip at y 34.25) pokes up into road row 34; as a front
    # piece the road stays walkable and the keeper walks behind it. base = the shop's front wall foot (43), as
    # for roof-magic-north below it: the road under the spire (y 35-36) is open, and a keeper there must still
    # be drawn behind the vane
    Piece("vane-magic-roof", poly=[], base=43, cut="ground", rects=[(13.9, 34.25, 14.28, 34.55), (13.68, 34.55,
          14.85, 35.05)]),
    # Map marks (October 2026): roofs and lamps over paths the player marked as blocked; the ground under them
    # opens in TOWN_WALL_EDITS. top of the magic shop's spire roof (mark 13): it hangs over the road behind
    # the shop (x 13.1-14.95, y 35.05-36). Roof texels only; starts at y 35.1, clear of vane-magic-roof's
    # rects (to y 35.05; touching outlines share texels and the pack fails), and is cut at y 36 (the deepest
    # feet). base = the shop's front wall foot at the door (13,43)
    Piece("roof-magic-north", poly=[(13.62, 35.1), (14.94, 35.1), (14.94, 35.5), (14.85, 35.75), (14.81, 36),
          (13.12, 36), (13.12, 35.75), (13.31, 35.5), (13.5, 35.25)], base=43, cut="none"),
    # Tall banner at the plaza's south-west corner: finial, flag (x 22.05-24.0, y 33.85-36.6), its fringe (to
    # y 37.15), pole and stand (x 22.55-23.45, y 38.25-39.05). The plaza cobbles round the pole stay walkable;
    # only the stand blocks.
    Piece("banner-plaza-west", poly=[], base=39.05, cut="ground", rects=[(22.7, 32.55, 23.4, 33.9), (22.05,
          33.85, 24, 36.6), (22.3, 36.55, 23.8, 37.15), (22.75, 37.1, 23.1, 38.3), (22.55, 38.25, 23.45,
          39.05)]),
    # Tall banner at the plaza's south-east corner: finial, flag (x 35.85-37.65, y 33.85-36.6), its fringe (to
    # y 37.15), pole and stand (x 36.2-37.1, y 38.5-39.05) beside the east stall.
    Piece("banner-plaza-east", poly=[], base=39.05, cut="ground", rects=[(36.45, 32.55, 37.05, 33.9), (35.85,
          33.85, 37.65, 36.6), (36.05, 36.55, 37.4, 37.15), (36.5, 37.1, 36.9, 38.55), (36.2, 38.5, 37.1,
          39.05)]),
    # Street lamp at the south-west corner of the plaza, beside the main road south: lantern (x 27.0-27.95, y
    # 39.9-41.35), cream base and stone foot (x 26.65-28.21, y 42.49-43.48). The cobbles round the lantern
    # stay walkable; only the stone foot blocks.
    Piece("lamp-plaza-south-west", poly=[], base=43.5, cut="ground", rects=[(27, 39.9, 27.95, 41.35), (26.7,
          41.3, 28.15, 42.5), (26.6, 42.45, 28.25, 43.5)]),
    # Street lamp at the south-east corner of the plaza, beside the main road south: lantern (x 31.4-32.35, y
    # 39.95-41.45), cream base and stone foot (x 31.2-32.61, y 42.52-43.57). Only the stone foot blocks.
    Piece("lamp-plaza-south-east", poly=[], base=43.5, cut="ground", rects=[(31.4, 39.95, 32.35, 41.45), (31.15,
          41.4, 32.65, 42.55), (31.15, 42.5, 32.65, 43.55)]),
    # Lamp on the south rail at the west end of the bridge: finial (y 40.15), lantern (x 52.45-53.5) and stone
    # foot (x 52.26-53.74, y 41.75-42.3). Blocking its whole shape would cut the bridge deck to a strip, so
    # the deck stays open and only the foot blocks.
    Piece("lamp-middle-bridge-west", poly=[], base=42.3, cut="ground", rects=[(52.75, 40.15, 53.2, 40.5),
          (52.45, 40.45, 53.5, 41.75), (52.25, 41.7, 53.75, 42.3)]),
    # Lamp on the south rail at the east end of the bridge: finial (y 40.25), lantern (x 62.25-63.2) and stone
    # foot (x 62.05-63.38, y 41.75-42.3). The deck stays open; only the foot blocks.
    Piece("lamp-middle-bridge-east", poly=[], base=42.3, cut="ground", rects=[(62.6, 40.25, 62.95, 40.55),
          (62.25, 40.5, 63.2, 41.75), (62.05, 41.7, 63.4, 42.3)]),
    # lamp post on the west lawn by the forest road (head x 4.64-5.58, y 45.36-46.87; post x 4.91-5.30;
    # pedestal x 4.72-5.51, y 48.61-49.45): it stands in the lawn's opening onto the road; only the pedestal
    # blocks
    Piece("lamp-west-lawn", poly=[], base=49.45, cut="ground", rects=[(4.62, 45.33, 5.6, 46.9), (4.9, 46.9,
          5.32, 48.62), (4.7, 48.6, 5.53, 49.47)]),
    # lamp post at the north-west corner of the magic garden fence (head x 8.38-9.38, y 43.75-45.1; pedestal x
    # 8.45-9.18 down to y 47.57): its head and post stand over the grass strip y 46-46.5 and the lawn by the
    # forest road; only the pedestal (inside the fence line) blocks
    Piece("lamp-magic", poly=[], base=47.57, cut="ground", rects=[(8.38, 43.7, 9.38, 45.1), (8.45, 45.1, 9.2,
          47.6)]),
    # tall corner post of the training yard fence (x 31.44-31.75, y 51.0-52.5) standing in the lawn's opening
    # onto the main road; as a front piece the lawn row 51 stays 1 tile wide from the road
    Piece("post-yard-corner", poly=[], base=52.5, cut="ground", rects=[(31.4, 51, 31.8, 52.5)]),
    # the forge's back roof top edge (y 40.56-40.75, x 39.69-44.1), its ridge finial (x 42.31-43.0, up to y
    # 40.0) and its chimney and pipe cap (x 44.87-46.03, top y 39.84) cover the cobble path behind the forge
    # (mark 15); as a front piece (roof texels only, cut at y 41.25, below the deepest feet y 41.0) the keeper
    # walks behind them. base = the forge's front wall foot
    Piece("roof-forge-back", poly=[(39.6875, 41.25), (39.6875, 40.5625), (40.25, 40.5625), (40.25, 40.625),
          (40.8125, 40.625), (40.8125, 40.6875), (41.25, 40.6875), (41.25, 40.75), (41.4375, 40.75), (41.4375,
          40.6875), (42.3125, 40.6875), (42.3125, 40), (43, 40), (43, 40.5625), (43.5625, 40.5625), (43.625,
          40.625), (43.6875, 40.6875), (43.8125, 40.875), (43.875, 40.9375), (43.9375, 41.125), (44, 41.1875),
          (44.0625, 41.25)], base=49.25, cut="none", rects=[(45.2, 39.84, 45.97, 40.25), (45.06, 40.25, 45.97,
          40.5), (44.87, 40.5, 46.03, 41), (44.97, 41, 45.97, 41.25)]),
    # tall wooden pole at the west end of the forge apron (x 40.93-41.32, y 51.36-53.9): it stands across the
    # only way from the forge apron west to the ledge under the anvil stands; the keeper walks behind it
    Piece("post-forge-apron", poly=[], base=53.9, cut="ground", rects=[(40.9, 51.3, 41.35, 53.95)]),
    # Meadow lamp on the east road: its lantern's left side reaches x 78.3, and the post runs down to y 57.95
    # behind the meadow pine's tip. The post's outline stops at y 57.45, where pine-meadow (drawn in front of
    # it) takes over.
    Piece("lamp-east-meadow", poly=[], base=57.95, cut="ground", rects=[(78.3, 55.3, 79.3, 56.65), (78.6, 56.6,
          79.05, 57.45)]),
    # Tall post east of the bar stairs (x 23.42-23.92, y 52.35-56.3); it stands over the path from the bar
    # apron to the main road (row 53).
    Piece("lamp-bar-stairs", poly=[], base=56.3, cut="ground", rects=[(23.6, 52.35, 23.92, 53.2), (23.42, 53.15,
          23.92, 56.35)]),
    # Lamp at the south bridge's west end: its lantern covers the path tile (27,53) and the sidewalk.
    Piece("lamp-south-bridge-west", poly=[], base=56.3, cut="ground", rects=[(26.95, 53.2, 27.95, 54.7), (26.8,
          54.65, 28.15, 56.3)]),
    # Tall post west of the bar stairs (x 19.1-19.65, y 53.15-56.2); its top stands over road row 53.
    Piece("post-bar-stairs-west", poly=[], base=56.2, cut="ground", rects=[(19.1, 53.15, 19.65, 56.25)]),
    # garden lamp west of the fishing shop: head x 8.24-9.38 y 68.09-69.65, post x 8.63-8.98, base ring x
    # 8.44-9.14 to y 72.0; the keeper walks behind the head and post into the garden
    Piece("lamp-fishing-garden", poly=[], base=72, cut="ground", rects=[(8.25, 68, 9.4, 69.65), (8.6, 69.6, 9,
          71.1), (8.4, 71.05, 9.2, 72)]),
    # the fishing shop's slate roof and south gable (x 10.0-17.5, top edge y 62.4 at the ridge, 62.7 west of
    # it, eave bottom y 66.5; cut at y 67.0 along the gable's bottom beam) hide the boardwalk row behind the
    # shop (y 65.25-66.5) and the foot of the pier stairs (x 12.5-13.75); roof/gable texels only, so the
    # keeper walks behind it. base = the shop's front wall foot by the door steps (y 70.5)
    Piece("roof-fishing-back", poly=[(10.5, 62.75), (13.25, 62.6875), (13.4375, 62.5), (13.5625, 62.375),
          (13.75, 62.4375), (14, 62.5625), (14.5, 62.75), (15, 62.9375), (15, 63), (17, 63), (17, 64.5),
          (17.125, 65), (17.375, 65.5), (17.375, 65.75), (17.5, 66), (17.5, 66.375), (17.375, 66.5), (17.375,
          67), (10.0625, 67), (10, 66.375), (10, 65.75), (10.125, 65.25), (10.25, 64.75), (10.5, 64.375)],
          base=70.5, cut="none"),
]

# Painted people and animals: they would stand frozen forever in a still picture, and some stand in doorways
# and on roads, so they leave the backdrop. The Town's own residents walk these streets instead.
# Each hole is rebuilt by a clone (see painted_outdoor.clone_fill). A shift in tiles names the patch by hand
# where "auto" picks ground of the wrong kind. Order matters: a hole may copy from one rebuilt before it.
# why empty: town.png is the pixel-art redraw (2026-10, see docs/art-source/town/README.md), which was drawn
# without people; the erases measured on the first painting no longer apply and were dropped. The one figure
# the redraw kept is painted out when the quarters are stitched (PATCHES in docs/art-source/town/redraw/stitch.py).
ERASE: list[Erase] = []

# Painted features that must never be copied as grain (x0, y0, x1, y1 in tiles). None measured yet.
AVOID: list[Rect] = []


# --------------------------------------------------------------------------------------------------
# Water
# --------------------------------------------------------------------------------------------------

Rule = Callable[[np.ndarray], np.ndarray]


def water(a: np.ndarray) -> np.ndarray:
    """The river, the pools and the fountain basin: clearly blue (a few slate roofs pass, see Water.holes)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (b > r + 40) & (b > g + 5)


def falling(a: np.ndarray) -> np.ndarray:
    """A waterfall: its blue water plus the pale blue-white foam where it breaks (grey rock is not bluer than red)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return water(a) | ((b > r + 12) & (r > 150))


def spray(a: np.ndarray) -> np.ndarray:
    """The fountain's spray: pale and see-through, so only a little bluer than the grey statue under it."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (b > r + 22) & (b >= g)


@dataclass(frozen=True)
class Water:
    """
    One animated stretch of Town water.
    name: the sheet (public/assets/town/town-water-<name>.png, texture key 'town-water-<name>') and the
      animation name in TOWN_ART; kind: 'fall' (streaks slide down) or 'pool' (sway and drifting light);
    rule: colour rule; box: (x0, y0, x1, y1) in tiles, the area searched (the sheet shrinks to the water found);
    fps: playback speed; holes: tile boxes inside `box` left out (blue things that are not water).
    """
    name: str
    kind: str
    rule: Rule
    box: tuple[float, float, float, float]
    fps: int
    holes: tuple[tuple[float, float, float, float], ...] = ()


# Every sheet has WATER_FRAMES frames; falls move WATER_PERIOD texels per loop (a multiple of the frame count, so
# each frame moves the streaks the same whole number of texels). Same numbers as the dungeon's water.
WATER_FRAMES = 8
WATER_PERIOD = 48
# Order matters: each stretch takes only water no stretch before it took, so the falls come before the pools
# they pour into, and the river's parts share its long bends without drawing a texel twice. The river is cut
# in parts so each sheet stays small (one box around the whole river would be mostly bank); pool_frames lays its
# wave out in room texels, so the parts meet without a seam. Bridges, the dock, the boat's hull, lily pads and
# ducks are not blue, so they stay painted and still.
WATER: list[Water] = [
    Water("fall-north", "fall", falling, (58.0, 0.0, 63.0, 2.25), 10),        # the river's source, top edge
    Water("river-north", "pool", water, (55.5, 0.0, 64.5, 23.5), 6),          # down to the north bridge
    Water("river-middle", "pool", water, (53.0, 25.0, 64.5, 40.0), 6),        # between the two bridges
    Water("river-bend-north", "pool", water, (52.0, 42.0, 64.0, 50.0), 6),
    Water("river-bend-south", "pool", water, (44.0, 50.0, 62.0, 58.5), 6),    # round the fisher's dock
    Water("river-east", "pool", water, (31.5, 52.0, 50.0, 63.0), 6),          # main bridge to the bend
    # the harbour west of the main bridge; the fishing shop's slate roof (main roof, its peak, the little tower on
    # the dock) and the boat's blue cargo are not water. why stepped: one box round the roof also froze the
    # strips of real water beside its peak and its tower.
    Water("river-west", "pool", water, (0.0, 57.0, 28.0, 64.0), 6,
          holes=((10.5, 62.6, 14.85, 64.0), (12.6, 62.1, 14.85, 62.6), (14.85, 60.5, 16.85, 64.0),
                 (7.25, 59.25, 8.75, 60.75))),
    Water("fall-west", "fall", falling, (3.25, 10.5, 5.5, 16.25), 10),        # the cliff fall west of the mill
    Water("pool-west", "pool", water, (2.0, 15.5, 8.0, 19.75), 6),            # ...and the pool under it
    Water("fountain-spray", "fall", spray, (28.25, 30.5, 31.75, 34.0), 10),   # the plaza fountain's water dome
    Water("fountain-basin", "pool", water, (27.25, 33.0, 32.75, 36.75), 6),
]


def water_sheets(room: Image.Image) -> list[str]:
    """
    Cut every WATER stretch from the finished backdrop and write its spritesheet.
    room: the packed town.png (RGB).
    Returns the TOWN_ART.animations lines (TypeScript) in WATER order.
    Fails when a stretch finds no water (a moved painting), when a hole lies outside its box, or when a sheet
    would pass 4096 px (save_sheet).
    """
    pixels = np.asarray(room).astype(int)
    taken = np.zeros(pixels.shape[:2], dtype=bool)
    lines = []
    for stretch in WATER:
        x0, y0, x1, y1 = (round(v * TILE_TEXELS) for v in stretch.box)
        mask = clean_mask(stretch.rule(pixels[y0:y1, x0:x1])) & ~taken[y0:y1, x0:x1]
        for hole in stretch.holes:
            hx0, hy0, hx1, hy1 = (round(v * TILE_TEXELS) for v in hole)
            if hx0 < x0 or hy0 < y0 or hx1 > x1 or hy1 > y1:
                raise RuntimeError(f"pack-town-art: water {stretch.name} hole {hole} is outside its box {stretch.box}")
            mask[hy0 - y0:hy1 - y0, hx0 - x0:hx1 - x0] = False
        if not mask.any():
            raise RuntimeError(f"pack-town-art: water {stretch.name} found no water in {stretch.box}")
        rows, cols = np.nonzero(mask.any(1))[0], np.nonzero(mask.any(0))[0]
        # why: even edges keep the animation's 2-texel blocks on the same grid as the painting's chunky pixels.
        top, left = rows[0] - rows[0] % 2, cols[0] - cols[0] % 2
        bottom = min(rows[-1] + 1 + (rows[-1] + 1) % 2, y1 - y0)
        right = min(cols[-1] + 1 + (cols[-1] + 1) % 2, x1 - x0)
        box = (x0 + left, y0 + top, x0 + right, y0 + bottom)
        tight = mask[top:bottom, left:right]
        taken[box[1]:box[3], box[0]:box[2]] |= tight
        if stretch.kind == "fall":
            frames = waterfall_frames(room, box, tight, WATER_FRAMES, WATER_PERIOD)
        elif stretch.kind == "pool":
            frames = pool_frames(room, box, tight, WATER_FRAMES)
        else:
            raise RuntimeError(f"pack-town-art: water {stretch.name} has unknown kind {stretch.kind}")
        # why: the widest frames per row that keep the sheet inside 4096 px (save_sheet fails beyond that).
        width = box[2] - box[0]
        columns = next((c for c in (8, 4, 2, 1) if width * c <= 4096), None)
        if columns is None:
            raise RuntimeError(f"pack-town-art: water {stretch.name} is {width} texels wide, over 4096 px")
        fw, fh = save_sheet(frames, OUT / f"town-water-{stretch.name}.png", columns)
        key = "TownWater" + "".join(part.capitalize() for part in stretch.name.split("-"))
        lines.append(f"    {{ name: 'water-{stretch.name}', texture: TextureKey.{key}, x: {box[0]}, y: {box[1]}, "
                     f"frameWidth: {fw}, frameHeight: {fh}, frames: {WATER_FRAMES}, fps: {stretch.fps} }},")
    return lines


def town_grid() -> list[str]:
    """
    TOWN_GRID's rows, read from src/world/TownArt.ts (the one copy of the walk grid).
    Fails when the block cannot be found; painted_outdoor checks its size.
    """
    text = (REPO / "src" / "world" / "TownArt.ts").read_text()
    start = text.find("export const TOWN_GRID")
    if start < 0:
        raise RuntimeError("pack-town-art: TOWN_GRID not found in src/world/TownArt.ts")
    block = text[text.index("[", text.index("=", start)) + 1:text.index("];", start)]
    return re.findall(r"^\s*'([^']*)',", block, flags=re.MULTILINE)


def main() -> None:
    """Pack the Town (unless argv says 'water'), then cut the water sheets from the packed backdrop."""
    mode = sys.argv[1:]
    if mode not in ([], ["water"]):
        raise SystemExit(f"usage: python3 scripts/pack-town-art.py [water]   (got {' '.join(mode)})")
    if not mode:
        pack_town()
    lines = water_sheets(Image.open(OUT / "town.png").convert("RGB"))
    print("\nTOWN_ART.animations (src/world/TownArt.ts):")
    print("\n".join(lines))


def pack_town() -> None:
    """Fit the painting and write town.png, town-front.png and town-nodes.png (painted_outdoor.pack)."""
    # The painting is scaled whole to 82x75 tiles (1310/2624 and 1201/2400 differ by 0.3%).
    # why: exact shapes, because the Town's trees stand on lawns as dark as their leaves; grain from grass,
    # road and water, because some erased people stand on cobbles and the fisher's rod and duck sit over the
    # river, and each hole must be rebuilt from the ground it lies on.
    pack(OutdoorArt(name="town", source=REPO / "docs" / "art-source" / "town" / "town.png",
                    source_size=(1310, 1201), tiles=(82, 75), out=OUT,
                    nodes=NODES, pieces=PIECES, avoid=AVOID, erase=ERASE,
                    nodes_label="TOWN_NODES (src/world/TownArt.ts)", pieces_label="TOWN_ART.pieces",
                    exact_alpha=True, grain_grid=town_grid(), grain_cells=",=~", reach_tiles=20,
                    cell_texels=64))


if __name__ == "__main__":
    main()
