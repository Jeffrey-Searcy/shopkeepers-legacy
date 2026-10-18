#!/usr/bin/env python3
"""
Portal-dungeon room art packer.

docs/art-source/dungeon/hall.webp (1708x921) is a painted mock-up of a dungeon hall. It arrives with a game
HUD, a hero, a hotbar and a minimap baked in. This script removes them, fits the hall to the game grid, and
writes the two textures the game draws (src/world/DungeonRoomArt.ts, src/world/PaintedRoomRenderer.ts):

  * public/assets/dungeon/hall.png        -> the full room backdrop, 960x544 texels = 30x17 tiles at
                                             2 texels per world pixel (32 texels per 16 px tile). The rune
                                             in the middle of the floor sits on the centre of tile (15, 9).
  * public/assets/dungeon/hall-front.png  -> the same pixels, but clear everywhere except the pillars and
                                             braziers. The game draws pieces of it above the keeper, so the
                                             keeper can walk behind a pillar.

The FRONT_SHAPES polygons below must stay inside the piece boxes of DUNGEON_HALL_ART in src/world/DungeonRoomArt.ts.
Removal copies nearby painted floor or wall, or mirrors the symmetric hall; nothing is invented.

Usage:  python3 scripts/pack-dungeon-art.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "docs" / "art-source" / "dungeon" / "hall.webp"
OUT = REPO / "public" / "assets" / "dungeon"
SOURCE_SIZE = (1708, 921)
# The game grid: 30x17 tiles of 32 texels each.
ROOM_SIZE = (960, 544)
# The hall is cut from x 17..1643 and moved down 15 px, so the rune centre lands on a tile centre.
CROP = (17, 0, 1643, 906)
CROP_SHIFT_Y = 15
VOID = (14, 10, 18)

# Pillars and braziers in room texels (see the file header). Each list is one closed polygon.
FRONT_SHAPES: list[list[tuple[int, int]]] = [
    [(258, 128), (302, 128), (302, 184), (258, 184)],                      # top-left brazier
    [(264, 100), (296, 100), (296, 128), (264, 128)],                      # ...its flame tip
    [(689, 129), (738, 129), (738, 184), (689, 184)],                      # top-right brazier
    [(697, 100), (729, 100), (729, 129), (697, 129)],                      # ...its flame tip
    [(322, 158), (330, 147), (366, 147), (372, 157), (372, 236), (380, 246),
     (380, 262), (318, 262), (318, 246), (322, 236)],                      # top-left pillar
    [(629, 158), (636, 148), (670, 148), (676, 158), (676, 238), (684, 246),
     (684, 264), (622, 264), (622, 246), (629, 238)],                      # top-right pillar
    [(265, 330), (273, 319), (309, 319), (317, 330), (317, 432), (265, 432)],  # bottom-left pillar
    [(676, 330), (684, 319), (720, 319), (729, 330), (729, 432), (676, 432)],  # bottom-right pillar
    [(239, 429), (281, 429), (281, 480), (239, 480)],                      # bottom-left brazier
    [(251, 390), (269, 390), (269, 430), (251, 430)],                      # ...its flame
    [(713, 429), (760, 429), (760, 480), (713, 480)],                      # bottom-right brazier
    [(727, 385), (745, 385), (745, 430), (727, 430)],                      # ...its flame
]


RGB = tuple[int, int, int]


def as_rgb(value: object) -> RGB:
    """One RGB pixel from PIL; fails loudly on anything else (PIL types pixels loosely)."""
    if not isinstance(value, tuple) or len(value) != 3 or not all(isinstance(c, int) for c in value):
        raise RuntimeError(f"pack-dungeon-art: expected an RGB pixel, got {value!r}")
    return (value[0], value[1], value[2])


def clean(im: Image.Image) -> Image.Image:
    """Remove the baked-in HUD boxes, title banner, hero, hotbar and minimap from the source painting."""
    W, H = im.size
    px = im.load()
    if px is None:
        raise RuntimeError("pack-dungeon-art: could not read the source pixels")

    def copy(src_box: tuple[int, int, int, int], dst_xy: tuple[int, int]) -> None:
        im.paste(im.crop(src_box), dst_xy)

    # 1. Corner HUD boxes sit over the dark void: fill them with the void's own dark colour.
    void_sample = sorted((as_rgb(c) for c in im.crop((0, 0, 30, 200)).get_flattened_data()), key=sum)
    dark = void_sample[len(void_sample) // 4]
    for box in ((30, 18, 312, 84), (1466, 20, 1668, 96), (30, 850, 300, 896)):
        im.paste(dark, box)

    # 2. Title banner over the top wall: copy the wall row just below it.
    copy((704, 41, 1006, 68), (704, 14))

    # 3. Hero on the rune. The rune is mirror-symmetric about y=500, so the covered top half is rebuilt
    #    from the bottom half; the floor above the rune comes from 130 px to the left.
    rune_top, rune_mid = 412, 500
    for y in range(rune_top, rune_mid + 4):
        for x in range(818, 898):
            px[x, y] = px[x, 2 * rune_mid - y]
    copy((818 - 130, 372, 898 - 130, rune_top), (818, 372))
    # why: the hero's boots sat on the mirror line, so a few dark pixels survive at the rune centre.
    for y in range(488, 514):
        row = [as_rgb(px[x, y]) for x in range(826, 890)]
        light = [c for c in row if sum(c) >= 170]
        if not light:
            raise RuntimeError(f"pack-dungeon-art: rune row {y} has no light pixels to sample")
        avg = tuple(sum(c[i] for c in light) // len(light) for i in range(3))
        for x in range(826, 890):
            if sum(as_rgb(px[x, y])) < 170:
                px[x, y] = avg

    # 4. Hotbar: continue the floor rows down to the ledge, then repeat the ledge band beside it.
    copy((520, 742, 1188, 800), (520, 800))
    # why: the first copy brings half a clay pot along; overwrite that part from clean floor.
    copy((650, 742, 780, 800), (520, 800))
    band = im.crop((440, 820, 520, H))
    for x in range(520, 1188, 80):
        im.paste(band.crop((0, 0, min(80, 1188 - x), band.height)), (x, 820))

    # 5. Minimap (bottom right): mirror the bottom-left corner (the hall is left/right symmetric).
    mm = (1506, 712, 1680, 894)
    mirror = im.crop((W - mm[2], mm[1], W - mm[0], mm[3])).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    im.paste(mirror, (mm[0], mm[1]))
    return im


def fit_to_grid(im: Image.Image) -> Image.Image:
    """Crop the cleaned hall, shift it so the rune is on a tile centre, and scale it to ROOM_SIZE."""
    hall = im.crop(CROP)
    canvas = Image.new("RGB", (hall.width, hall.height + CROP_SHIFT_Y), VOID)
    canvas.paste(hall, (0, CROP_SHIFT_Y))
    return canvas.resize(ROOM_SIZE, Image.Resampling.LANCZOS)


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
    """Build both textures from the source painting; fail loudly when the source is not the measured size."""
    source = Image.open(SOURCE).convert("RGB")
    if source.size != SOURCE_SIZE:
        raise RuntimeError(f"pack-dungeon-art: {SOURCE} is {source.size}, expected {SOURCE_SIZE}")
    room = fit_to_grid(clean(source))
    OUT.mkdir(parents=True, exist_ok=True)
    room.save(OUT / "hall.png", optimize=True)
    front_layer(room).save(OUT / "hall-front.png", optimize=True)
    print(f"wrote {OUT / 'hall.png'} and {OUT / 'hall-front.png'}")


if __name__ == "__main__":
    main()
