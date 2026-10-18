#!/usr/bin/env python3
"""
Dungeon rooms art packer (the first portal dungeon: a hub and four rooms behind its doors).

Sources (ChatGPT paintings, docs/art-source/dungeon-rooms/):
  * hub.webp        1536x1024 -> the fountain hall the keeper arrives in. Its painted floor tiles are about
                                 30 px, so it is used at full size: 1536x1024 texels = 48x32 tiles at 2 texels
                                 per world pixel (32 texels per 16 px tile).
  * rooms-grid.webp 1536x1024 -> four rooms in a 2x2 grid split by thin grey lines (x 767-768, y 484-485):
                                 the crystal cave (top left), the moon library (top right), the old sewer
                                 (bottom left) and the Warden's lava pit (bottom right). They are painted at
                                 about 60% of the hub's scale, so each cell is enlarged by 1152/767 (about 1.5)
                                 and centred on a 1152x832 texture = 36x26 tiles. The cells are a little soft
                                 after the enlargement; one full-size painting per room would fix that.

For every room this script writes, under public/assets/dungeon-rooms/ (src/world/DungeonRooms.ts reads them):
  * <room>.png          -> the backdrop (sharpened with painted_art.sharpen, so texels stay crisp).
  * hub-front.png       -> the hub's pixels, clear except the two pillars the keeper walks behind
                           (FRONT_SHAPES). PaintedRoomRenderer cuts them into pieces by the boxes this
                           script prints; the side rooms have nothing to walk behind, so no front layer.
  * <room>-<liquid>.png -> looping spritesheets of the painted water, toxic waste and lava (LIQUIDS):
                           falls get sliding streaks (painted_art.waterfall_frames), pools a sway and a
                           drifting shimmer (painted_art.pool_frames). Each sheet covers only its liquid:
                           pixels are picked by colour inside a hand-drawn box, then the box shrinks to them.
  * <room>-seal.png     -> (cave, library, sewer) the far doorway walled up with the doorframe's own stone
                           (painted_art.fill). The game lays it over the doorway when that door leads nowhere.
  * boss-exit.png       -> the way home: the rune's eye in the Warden's pit turned into a violet swirl
                           (painted_art.swirl_frames), clear outside the eye's oval.

At the end it prints every box and frame size; src/world/DungeonRooms.ts and public/assets/manifest.json
must carry the same numbers (PaintedRoomRenderer fails loudly when a sheet does not match).

Usage:  python3 scripts/pack-dungeon-rooms-art.py
Needs:  numpy, Pillow, and scripts/painted_art.py next to this file.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image, ImageDraw

from painted_art import clean_mask, fill, pool_frames, save_sheet, sharpen, swirl_frames, waterfall_frames

REPO = Path(__file__).resolve().parent.parent
SOURCES = REPO / "docs" / "art-source" / "dungeon-rooms"
OUT = REPO / "public" / "assets" / "dungeon-rooms"

HUB_SIZE = (1536, 1024)
GRID_SIZE = (1536, 1024)
# Grid cells inside rooms-grid.webp, between the grey divider lines (source px, x1/y1 exclusive).
CELLS: dict[str, tuple[int, int, int, int]] = {
    "cave": (0, 0, 767, 484),
    "library": (769, 0, 1536, 484),
    "sewer": (0, 486, 767, 1024),
    "boss": (769, 486, 1536, 1024),
}
# Every grid room becomes this many texels (36x26 tiles).
SIDE_SIZE = (1152, 832)
SIDE_SCALE = SIDE_SIZE[0] / 767
# The paintings' black surround, used for padding.
VOID_RGB = (3, 2, 4)

Box = tuple[int, int, int, int]
Rule = Callable[[np.ndarray], np.ndarray]


# --------------------------------------------------------------------------------------------------
# Liquid colour rules. Each takes an HxWx3 int array and returns an HxW bool mask. The thresholds were
# picked by sampling each painting: the cave is blue everywhere, so its water rule wants bright
# blue-green; the sewer sludge is a dull olive, so its rule is a green ratio; lava is bright orange.
# --------------------------------------------------------------------------------------------------

def water(a: np.ndarray) -> np.ndarray:
    """The hub's fountain water: blue above red, a little green."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (b > r + 25) & (g > r + 5)


def cave_water(a: np.ndarray) -> np.ndarray:
    """The cave's falls and pool: much bluer and greener than the blue-tinted rock around them."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g > 28) & (b > 80) & (b > r + 60) & (g > r + 20)


def toxic_fall(a: np.ndarray) -> np.ndarray:
    """The bright green sludge pouring from the sewer pipes."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (g > r + 20) & (g > b + 60) & (g > 110)


def toxic(a: np.ndarray) -> np.ndarray:
    """The sewer's sludge pools (dull olive, green well above red) and the bright falls into them."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ((g > 1.55 * r) & (g > b + 30) & (g > 45)) | toxic_fall(a)


def lava(a: np.ndarray) -> np.ndarray:
    """Glowing lava, including its yellow-white hottest streaks."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ((r > 170) & (r > b + 90) & (g > 40) & (r > g + 30)) | ((r > 235) & (g > 170) & (b < 170))


@dataclass(frozen=True)
class Liquid:
    """
    One animated liquid of one room.
    room: room name; name: sheet suffix (file <room>-<name>.png); kind: 'fall' or 'pool';
    rule: colour rule; box: texel box (x0, y0, x1, y1) the liquid is searched in;
    fps: playback speed the game uses (printed for DungeonRooms.ts); columns: frames per sheet row;
    sway, strength: pool_frames settings (thick sludge and lava sway less than water).
    """
    room: str
    name: str
    kind: str
    rule: Rule
    box: Box
    fps: int
    columns: int = 8
    sway: float = 1.5
    strength: float = 0.18


# Every sheet has FRAMES frames. Falls move PERIOD texels per loop (a multiple of FRAMES, so each frame
# moves the streaks the same whole number of texels). Lava moves slower than water (lower fps).
FRAMES = 8
PERIOD = 48
LIQUIDS: list[Liquid] = [
    Liquid("hub", "fall", "fall", water, (736, 176, 804, 300), 10),
    Liquid("hub", "pool", "pool", water, (560, 296, 1140, 616), 6, columns=4),
    Liquid("cave", "fall-right", "fall", cave_water, (846, 140, 900, 290), 10),
    Liquid("cave", "pool-right", "pool", cave_water, (796, 256, 1000, 372), 6),
    Liquid("cave", "fall-mid", "fall", cave_water, (556, 316, 616, 600), 10),
    Liquid("cave", "fall-left", "fall", cave_water, (140, 456, 196, 540), 10),
    Liquid("sewer", "fall-left", "fall", toxic_fall, (360, 190, 428, 300), 8),
    Liquid("sewer", "fall-right", "fall", toxic_fall, (722, 196, 790, 318), 8),
    Liquid("sewer", "pool-top", "pool", toxic, (310, 250, 980, 410), 5, columns=4, sway=1),
    Liquid("sewer", "pool-low", "pool", toxic, (180, 390, 840, 610), 5, columns=4, sway=1),
    Liquid("boss", "lava-left", "pool", lava, (0, 96, 340, 832), 4, columns=4, sway=1, strength=0.22),
    Liquid("boss", "lava-right", "pool", lava, (812, 96, 1152, 832), 4, columns=4, sway=1, strength=0.22),
    Liquid("boss", "fall-bl", "fall", lava, (316, 636, 354, 792), 6),
    Liquid("boss", "fall-br", "fall", lava, (798, 636, 836, 792), 6),
    Liquid("boss", "fall-back", "fall", lava, (116, 96, 150, 340), 6),
]
# Circles (centre x, y; radius) cut out of a room's liquid masks: the boss pillar braziers' flames are
# lava-coloured but must stay still (they get a flickering glow in the game instead).
HOLES: dict[str, list[tuple[int, int, int]]] = {"boss": [(311, 476, 26), (835, 479, 26)]}

# The far doorway (top arch) of each side room: the box to wall up, and where its stone grain comes from.
# Each part is (x_from, x_to, y_from, y_to, dx, dy): the grain is copied from the doorframe pilasters
# beside the arch (texels 514-540 left, 614-638 right), which are the same stone as a walled-up door.
SEALS: dict[str, Box] = {
    "cave": (540, 90, 612, 234),
    "library": (538, 88, 614, 248),
    "sewer": (540, 50, 612, 192),
}

# The hub's walk-behind pillars (texel polygons). Their boxes must match the hub pieces in DungeonRooms.ts.
FRONT_SHAPES: dict[str, list[tuple[int, int]]] = {
    "pillar-left": [(418, 349), (456, 349), (470, 364), (470, 470), (482, 478), (482, 508), (398, 508),
                    (398, 478), (408, 470), (408, 364)],
    "pillar-bottom-left": [(345, 644), (388, 644), (402, 658), (402, 770), (412, 780), (412, 800), (330, 800),
                           (330, 780), (334, 770), (334, 658)],
}

# The boss room's way home: the rune's eye (an oval on the floor) becomes a violet swirl.
EXIT_BOX = (528, 357, 624, 425)
EXIT_CENTRE = (576.0, 391.0)
EXIT_RADIUS = (40.0, 28.0)
EXIT_FRAMES = 16
EXIT_FPS = 10
# Violet ramp the eye is recoloured with before the swirl is drawn (dark, middle, light).
EXIT_RAMP = (np.array([34.0, 10.0, 60.0]), np.array([136.0, 66.0, 214.0]), np.array([236.0, 204.0, 255.0]))


def side_room(grid: Image.Image, name: str) -> Image.Image:
    """
    Cut one grid cell, enlarge it by SIDE_SCALE and centre it on a SIDE_SIZE texture of the black surround.
    Returns the RGB room before sharpening.
    """
    x0, y0, x1, y1 = CELLS[name]
    w, h = round((x1 - x0) * SIDE_SCALE), round((y1 - y0) * SIDE_SCALE)
    if w != SIDE_SIZE[0] or h > SIDE_SIZE[1]:
        raise RuntimeError(f"pack-dungeon-rooms-art: cell {name} scales to {w}x{h}, which does not fit {SIDE_SIZE}")
    cell = grid.crop((x0, y0, x1, y1)).resize((w, h), Image.Resampling.LANCZOS)
    room = Image.new("RGB", SIDE_SIZE, VOID_RGB)
    room.paste(cell, (0, (SIDE_SIZE[1] - h) // 2))
    return room


def load(name: str, size: tuple[int, int]) -> Image.Image:
    """Open a source painting as RGB; fail loudly when it is not the measured size."""
    path = SOURCES / name
    image = Image.open(path).convert("RGB")
    if image.size != size:
        raise RuntimeError(f"pack-dungeon-rooms-art: {path} is {image.size}, expected {size}")
    return image


def liquid_mask(room: Image.Image, liquid: Liquid) -> tuple[Box, np.ndarray]:
    """
    Pick the liquid's pixels inside its box and shrink the box to them.
    Returns (tight box, mask of that box). Fails when the rule finds nothing (a moved painting).
    """
    x0, y0, x1, y1 = liquid.box
    pixels = np.asarray(room.crop(liquid.box)).astype(int)
    mask = clean_mask(liquid.rule(pixels))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    for cx, cy, radius in HOLES.get(liquid.room, []):
        mask &= (xx - cx) ** 2 + (yy - cy) ** 2 > radius * radius
    if not mask.any():
        raise RuntimeError(f"pack-dungeon-rooms-art: {liquid.room}-{liquid.name} found no liquid in {liquid.box}")
    rows, cols = np.nonzero(mask.any(1))[0], np.nonzero(mask.any(0))[0]
    # why: even edges keep the animation's 2-texel blocks on the same grid as the painting's chunky pixels.
    top, left = rows[0] - rows[0] % 2, cols[0] - cols[0] % 2
    bottom, right = min(rows[-1] + 1 + (rows[-1] + 1) % 2, y1 - y0), min(cols[-1] + 1 + (cols[-1] + 1) % 2, x1 - x0)
    tight = (x0 + left, y0 + top, x0 + right, y0 + bottom)
    return tight, mask[top:bottom, left:right]


def seal(room: Image.Image, box: Box) -> Image.Image:
    """Wall up one doorway: returns the box's pixels rebuilt from the doorframe's stone (RGB)."""
    x0, y0, x1, y1 = box
    pixels = np.asarray(room).astype(np.float64).copy()
    fill(pixels, box, [(x0, 564, y0, y1, 514 - x0, 0), (564, 590, y0, y1, -50, 0), (590, x1, y0, y1, 24, 0)])
    return Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8)).crop(box)


def front_layer(room: Image.Image) -> tuple[Image.Image, dict[str, Box]]:
    """The hub pixels inside FRONT_SHAPES only (everything else clear), and each shape's box (x, y, w, h)."""
    mask = Image.new("L", room.size, 0)
    draw = ImageDraw.Draw(mask)
    boxes: dict[str, Box] = {}
    for name, shape in FRONT_SHAPES.items():
        draw.polygon(shape, fill=255)
        xs, ys = [p[0] for p in shape], [p[1] for p in shape]
        boxes[name] = (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)
    front = Image.new("RGBA", room.size, (0, 0, 0, 0))
    front.paste(room.convert("RGBA"), (0, 0), mask)
    return front, boxes


def exit_frames(room: Image.Image) -> list[np.ndarray]:
    """
    The boss room's way home: recolour the rune's eye along EXIT_RAMP by brightness (so the painted
    rune lines become the bright arms' colours), draw a turning swirl on it, and clear everything
    outside the eye's oval (in 2-texel steps, so the rim is as chunky as the painting).
    """
    x0, y0, x1, y1 = EXIT_BOX
    pixels = np.asarray(room).astype(np.float64).copy()
    patch = pixels[y0:y1, x0:x1]
    light = (patch @ np.array([0.299, 0.587, 0.114])) / 255
    light = np.clip((light - light.min()) / (light.max() - light.min()), 0, 1)[..., None]
    dark, middle, bright = EXIT_RAMP
    low = dark + (middle - dark) * np.clip(light * 2, 0, 1)
    pixels[y0:y1, x0:x1] = np.where(light < 0.5, low, middle + (bright - middle) * np.clip(light * 2 - 1, 0, 1))
    violet = Image.fromarray(np.clip(np.rint(pixels), 0, 255).astype(np.uint8))
    frames = swirl_frames(violet, EXIT_BOX, EXIT_CENTRE, EXIT_RADIUS, EXIT_FRAMES, twist=-5.0, spin=-1, stars=6)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    # why: sample the oval at block centres so its rim steps in 2-texel blocks.
    by, bx = yy - (yy - y0) % 2 + 1, xx - (xx - x0) % 2 + 1
    inside = ((bx - EXIT_CENTRE[0]) / EXIT_RADIUS[0]) ** 2 + ((by - EXIT_CENTRE[1]) / EXIT_RADIUS[1]) ** 2 < 1
    for frame in frames:
        frame[..., 3] = np.where(inside, 255, 0)
    return frames


def main() -> None:
    """Build every room texture, front layer, liquid sheet, seal and the exit swirl; print their numbers."""
    hub = load("hub.webp", HUB_SIZE)
    grid = load("rooms-grid.webp", GRID_SIZE)
    rooms = {"hub": sharpen(hub)}
    for name in CELLS:
        rooms[name] = sharpen(side_room(grid, name))
    OUT.mkdir(parents=True, exist_ok=True)
    for name, room in rooms.items():
        room.save(OUT / f"{name}.png", optimize=True)
    print(f"backdrops: {', '.join(rooms)}")

    front, boxes = front_layer(rooms["hub"])
    front.save(OUT / "hub-front.png", optimize=True)
    for name, (x, y, w, h) in boxes.items():
        print(f"hub piece {name}: x {x} y {y} w {w} h {h} baseY {y + h}")

    for liquid in LIQUIDS:
        room = rooms[liquid.room]
        box, mask = liquid_mask(room, liquid)
        if liquid.kind == "fall":
            frames = waterfall_frames(room, box, mask, FRAMES, PERIOD)
        elif liquid.kind == "pool":
            frames = pool_frames(room, box, mask, FRAMES, liquid.sway, liquid.strength)
        else:
            raise RuntimeError(f"pack-dungeon-rooms-art: unknown liquid kind {liquid.kind}")
        w, h = save_sheet(frames, OUT / f"{liquid.room}-{liquid.name}.png", liquid.columns)
        print(f"{liquid.room}-{liquid.name}: x {box[0]} y {box[1]} frame {w}x{h} frames {FRAMES} fps {liquid.fps}")

    for name, box in SEALS.items():
        seal(rooms[name], box).save(OUT / f"{name}-seal.png", optimize=True)
        print(f"{name}-seal: x {box[0]} y {box[1]} size {box[2] - box[0]}x{box[3] - box[1]}")

    w, h = save_sheet(exit_frames(rooms["boss"]), OUT / "boss-exit.png", EXIT_FRAMES // 2)
    print(f"boss-exit: x {EXIT_BOX[0]} y {EXIT_BOX[1]} frame {w}x{h} frames {EXIT_FRAMES} fps {EXIT_FPS}")


if __name__ == "__main__":
    main()
