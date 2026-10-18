#!/usr/bin/env python3
"""
Gate Plaza art packer.

docs/art-source/gate-plaza/plaza.webp (1750x899) is a painted mock-up of the Gate Plaza: the portal arch,
two pillars, two braziers, a signpost, a meadow and a path south. It arrives with a stamina bar, a clock,
a gold counter, a hotbar and a hero baked in. This script removes them, fits the plaza to the game grid,
and writes the two textures the game draws (src/world/GatePlazaArt.ts, src/world/PaintedRoomRenderer.ts):

  * public/assets/gate-plaza/plaza.png        -> the full plaza backdrop, 1088x544 texels = 34x17 tiles at
                                                 2 texels per world pixel (32 texels per 16 px tile). The
                                                 rune in front of the portal sits on the centre of tile (17, 10).
  * public/assets/gate-plaza/plaza-front.png  -> the same pixels, but clear everywhere except the pillars,
                                                 braziers and signpost. The game draws pieces of it above
                                                 the keeper, so the keeper can walk behind them.
  * public/assets/gate-plaza/plaza-portal.png -> PORTAL_FRAMES frames of the portal panel with its spiral
                                                 turning inwards (a spritesheet, frames left to right).
                                                 The game plays it over the painted panel (GATE_PLAZA_ART.animations).

The room is sharpened (painted_art.sharpen) so its texels stay crisp at 3 screen pixels each.
Covered areas are rebuilt with painted_art.fill (see that module): nothing is invented.

The FRONT_SHAPES polygons below must stay inside the piece boxes of GATE_PLAZA_ART in src/world/GatePlazaArt.ts.

Usage:  python3 scripts/pack-gate-plaza-art.py
Needs:  numpy, Pillow, and scripts/painted_art.py next to this file.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from painted_art import fill, save_sheet, sharpen, swirl_frames

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "docs" / "art-source" / "gate-plaza" / "plaza.webp"
OUT = REPO / "public" / "assets" / "gate-plaza"
SOURCE_SIZE = (1750, 899)
# The game grid: 34x17 tiles of 32 texels each.
ROOM_SIZE = (1088, 544)
# Source px per texel scale: the rune centre (878, 530) and the portal's top (y 40) are 490 source px apart,
# and must be 336 texels apart (rune centre on tile row 10 = texel 336 below the crop top).
SCALE = 336 / (530 - 40)
# Source box that becomes the room: the rune centre lands on texel x 560 (centre of tile column 17).
CROP_X0 = 878 - 560 / SCALE
CROP = (CROP_X0, 40.0, CROP_X0 + ROOM_SIZE[0] / SCALE, 40.0 + ROOM_SIZE[1] / SCALE)

# Pillars, braziers and the signpost in room texels (see the file header). Each list is one closed polygon.
FRONT_SHAPES: list[list[tuple[int, int]]] = [
    [(287, 175), (358, 175), (358, 195), (352, 200), (352, 300), (350, 330), (283, 330), (283, 300),
     (293, 295), (293, 200), (287, 195)],                                                  # left pillar
    [(770, 183), (832, 183), (832, 300), (848, 320), (848, 346), (757, 346), (757, 320), (775, 300)],  # right pillar
    [(437, 185), (483, 185), (483, 282), (437, 282)],                                     # left brazier + flame
    [(643, 185), (690, 185), (690, 282), (643, 282)],                                     # right brazier + flame
    # why: the signpost is three shapes, each with its own foot, so the keeper standing south of the short
    # left post is not covered by the board, and no painted grass around the sign is cut out with it.
    [(199, 363), (218, 363), (218, 380), (240, 380), (240, 412), (199, 412)],             # short left post + beam
    [(240, 354), (260, 354), (260, 378), (318, 374), (322, 378), (322, 437), (240, 437)],  # tall post + board
    [(318, 364), (337, 364), (337, 366), (361, 366), (361, 420), (337, 420), (336, 400),
     (322, 400), (322, 378)],                                                              # right post + lantern
]

# The portal panel in room texels (inside the dark stone frame, measured on plaza.png) and its spiral.
# Keep in step with the 'portal-swirl' animation in GATE_PLAZA_ART (src/world/GatePlazaArt.ts).
PORTAL_BOX = (519, 97, 607, 221)
PORTAL_CENTRE = (565.0, 163.0)
PORTAL_RADIUS = (30.0, 44.0)
PORTAL_FRAMES = 24
# why: twist -5 curls the arms the same way as the painted spiral; spin -1 then draws them inwards.
PORTAL_TWIST = -5.0
PORTAL_SPIN = -1


def clean(source: Image.Image) -> Image.Image:
    """Remove the baked-in hero, hotbar, stamina bar, clock and gold counter from the source painting."""
    img = np.asarray(source).astype(np.float64).copy()
    # 1. Hero on the rune: floor grain from 100 px right above the rune, rune-band grain from 151 px right.
    fill(img, (843, 430, 918, 570), [(843, 918, 430, 500, 100, 0), (843, 918, 500, 570, 151, 0)])
    # 2. Hotbar strip at the bottom: path and grass grain from just above it. Open bottom: it runs off the crop.
    #    why: the shift must stay above y 786 - 54, or the copied grain carries hotbar rows along.
    fill(img, (544, 786, 1212, 840), [(690, 1212, 786, 840, 0, -54), (544, 690, 786, 840, 0, -100)], open_bottom=True)
    # 3. Stamina label and bar (top left), then clock and gold (top right): grain from just below each.
    fill(img, (84, 10, 370, 80), [(84, 370, 10, 80, 0, 72)])
    fill(img, (1482, 16, 1670, 86), [(1482, 1670, 16, 86, 0, 72)])
    return Image.fromarray(np.clip(np.rint(img), 0, 255).astype(np.uint8))


def fit_to_grid(im: Image.Image) -> Image.Image:
    """Crop the cleaned plaza so the rune is on a tile centre, and scale it to ROOM_SIZE."""
    return im.resize(ROOM_SIZE, Image.Resampling.LANCZOS, box=CROP)


def front_layer(room: Image.Image) -> Image.Image:
    """The room pixels inside FRONT_SHAPES only; everything else fully clear."""
    mask = Image.new("L", room.size, 0)
    draw = ImageDraw.Draw(mask)
    for shape in FRONT_SHAPES:
        draw.polygon(shape, fill=255)
    front = Image.new("RGBA", room.size, (0, 0, 0, 0))
    front.paste(room.convert("RGBA"), (0, 0), mask)
    return front


def main() -> None:
    """Build all textures from the source painting; fail loudly when the source is not the measured size."""
    source = Image.open(SOURCE).convert("RGB")
    if source.size != SOURCE_SIZE:
        raise RuntimeError(f"pack-gate-plaza-art: {SOURCE} is {source.size}, expected {SOURCE_SIZE}")
    room = sharpen(fit_to_grid(clean(source)))
    OUT.mkdir(parents=True, exist_ok=True)
    room.save(OUT / "plaza.png", optimize=True)
    front_layer(room).save(OUT / "plaza-front.png", optimize=True)
    swirl = swirl_frames(room, PORTAL_BOX, PORTAL_CENTRE, PORTAL_RADIUS, PORTAL_FRAMES, PORTAL_TWIST, PORTAL_SPIN)
    frame_w, frame_h = save_sheet(swirl, OUT / "plaza-portal.png")
    print(f"wrote plaza.png, plaza-front.png and plaza-portal.png ({PORTAL_FRAMES} frames of {frame_w}x{frame_h}) to {OUT}")


if __name__ == "__main__":
    main()
