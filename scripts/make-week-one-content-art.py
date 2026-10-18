#!/usr/bin/env python3
"""
Week-one content art builder (placeholder-quality, palette-matched).

Makes the icons and crop stages for the "one fun first week" content: three new fish, three new
crops (+ seeds and 4 growth stages each), three forage finds, and three dungeon items.

Most art is recoloured from existing authored PNGs, so the new pieces share the old line weight
and shading. Items with no close source are drawn from small 16x16 pixel maps and doubled to the
32x32 icon size. Re-run any time; it overwrites only the files it names below.

Usage:  python3 scripts/make-week-one-content-art.py
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "public" / "assets"
UI = ROOT / "ui"
FARM = ROOT / "living-farm"


def load(path: Path) -> Image.Image:
    """Open an existing art file as RGBA (fails loudly when the source art is missing)."""
    return Image.open(path).convert("RGBA")


def recolor(img: Image.Image, fn) -> Image.Image:
    """Return a copy where every opaque pixel's (h, s, v) in 0..1 is replaced by fn(h, s, v)."""
    out = img.copy()
    px = out.load()
    assert px is not None, "PIL could not open pixel access"
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]  # type: ignore[misc]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            nh, ns, nv = fn(h, s, v)
            nr, ng, nb = colorsys.hsv_to_rgb(nh % 1.0, max(0.0, min(1.0, ns)), max(0.0, min(1.0, nv)))
            px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    return out


def shift(dh: float, sm: float = 1.0, vm: float = 1.0):
    """Hue shift (turns) plus saturation/value multipliers, for recolor()."""
    return lambda h, s, v: (h + dh, s * sm, v * vm)


def recolor_where(img: Image.Image, pick, fn) -> Image.Image:
    """Recolour only the pixels where pick(h, s, v) is true."""
    return recolor(img, lambda h, s, v: fn(h, s, v) if pick(h, s, v) else (h, s, v))


def draw(rows: list[str], palette: dict[str, tuple[int, int, int]], scale: int = 2) -> Image.Image:
    """Draw a pixel map ('.' = clear) with the given palette, scaled by an integer factor."""
    h, w = len(rows), len(rows[0])
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    assert px is not None, "PIL could not open pixel access"
    for y, row in enumerate(rows):
        if len(row) != w:
            raise ValueError(f"pixel map row {y} has width {len(row)}, expected {w}")
        for x, ch in enumerate(row):
            if ch != ".":
                r, g, b = palette[ch]
                px[x, y] = (r, g, b, 255)
    return img.resize((w * scale, h * scale), Image.Resampling.NEAREST)


def save(img: Image.Image, path: Path) -> None:
    """Write a PNG and print it, so the run log lists every file touched."""
    img.save(path)
    print("wrote", path.relative_to(ROOT))


OUTLINE = (44, 33, 40)


def main() -> None:
    # --- Fish: recolour the three authored fish so silhouettes stay consistent. ---
    bass, sardine = load(UI / "icon-fish-bass.png"), load(UI / "icon-fish-sardine.png")
    # Trout: pink-silver body with the bass silhouette.
    save(recolor(bass, lambda h, s, v: (0.95, s * 0.55, min(1.0, v * 1.25))), UI / "icon-fish-trout.png")
    # Pike: olive-yellow, long-bodied predator.
    pike = recolor(bass, lambda h, s, v: (0.16, s * 0.9, v * 0.95)).resize((32, 26), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); canvas.alpha_composite(pike, (0, 3))
    save(canvas, UI / "icon-fish-pike.png")
    # Eel: dark slate, stretched thin from the sardine.
    eel = recolor(sardine, lambda h, s, v: (0.42, 0.35, v * 0.55)).resize((32, 22), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); canvas.alpha_composite(eel, (0, 5))
    save(canvas, UI / "icon-fish-eel.png")

    # --- Crops: produce icons, seed packets, and four growth stages each. ---
    melon = load(UI / "icon-melon.png")
    melon_seeds = load(UI / "icon-melon-seeds.png")
    save(recolor(melon, lambda h, s, v: (0.27, s * 0.55, min(1.0, v * 1.15))), UI / "icon-cabbage.png")
    save(recolor(melon, lambda h, s, v: (0.0 if s > 0.25 else h, min(1.0, s * 1.15), v)), UI / "icon-tomato.png")
    save(draw([
        "................",
        "......g.g.......",
        ".....gGgGg......",
        "....oGgGGgo.....",
        "...oRRgGgRRo....",
        "..oRRRRRRRRRo...",
        "..oRyRRRyRRRo...",
        "..oRRRRRRRyRo...",
        "...oRRyRRRRo....",
        "...oRRRRRyRo....",
        "....oRRyRRo.....",
        ".....oRRRo......",
        "......ooo.......",
        "................",
        "................",
        "................",
    ], {"o": OUTLINE, "R": (214, 54, 64), "y": (246, 214, 120), "g": (60, 128, 60), "G": (106, 176, 74)}), UI / "icon-strawberry.png")
    # Seed packets: hue-shift the melon packet's inner picture to the crop's colour.
    save(recolor(melon_seeds, shift(0.08, 0.8, 1.05)), UI / "icon-cabbage-seeds.png")
    save(recolor(melon_seeds, shift(-0.27, 1.1, 1.0)), UI / "icon-tomato-seeds.png")
    save(recolor(melon_seeds, shift(-0.33, 1.2, 0.95)), UI / "icon-strawberry-seeds.png")
    # Growth stages: young stages reuse the potato sprout shapes; ripe stages recolour fruit pixels.
    for stage in (1, 2, 3):
        src = load(FARM / f"crop-potato-{stage}.png")
        save(recolor(src, shift(0.03, 0.7, 1.1)), FARM / f"crop-cabbage-{stage}.png")
        save(recolor(src, shift(-0.03, 1.0, 0.95)), FARM / f"crop-tomato-{stage}.png")
        save(recolor(src, shift(0.0, 1.1, 1.0)), FARM / f"crop-strawberry-{stage}.png")
    save(recolor(load(FARM / "crop-melon-4.png"), lambda h, s, v: (0.27, s * 0.55, min(1.0, v * 1.15))), FARM / "crop-cabbage-4.png")
    potato4 = load(FARM / "crop-potato-4.png")
    # Potato blossoms are the pink/white pixels: they become tomatoes or berries.
    blossom = lambda h, s, v: (h > 0.7 or h < 0.05) and v > 0.55
    save(recolor_where(potato4, blossom, lambda h, s, v: (0.0, 0.85, 0.9)), FARM / "crop-tomato-4.png")
    save(recolor_where(potato4, blossom, lambda h, s, v: (0.97, 0.75, 0.85)), FARM / "crop-strawberry-4.png")

    # --- Forage finds. ---
    save(draw([
        "................",
        "................",
        ".....oooooo.....",
        "...ooRRwRRRoo...",
        "..oRRRRRRwRRRo..",
        "..oRwRRRRRRRRo..",
        ".oRRRRRwRRRwRRo.",
        ".oooooooooooooo.",
        "......oCCo......",
        "......oCCo......",
        "......oCco......",
        "......oCco......",
        ".....ooCCoo.....",
        ".....oooooo.....",
        "................",
        "................",
    ], {"o": OUTLINE, "R": (176, 92, 58), "w": (240, 222, 196), "C": (232, 216, 186), "c": (200, 182, 150)}), UI / "icon-mushroom.png")
    save(draw([
        "................",
        "..........o.....",
        "....o....oGo....",
        "...oGo..oGo.....",
        "....oGooGo..o...",
        ".....oGGGo.oGo..",
        "......oGGooGo...",
        "......oGGGGo....",
        "......oWWGo.....",
        "......oWWWo.....",
        "......oWWWo.....",
        "......oWWWo.....",
        ".....ooWWWoo....",
        ".....oyoyoyo....",
        "......ooooo.....",
        "................",
    ], {"o": OUTLINE, "G": (92, 168, 76), "W": (236, 236, 214), "y": (196, 176, 120)}), UI / "icon-wild-leek.png")
    save(draw([
        "................",
        "................",
        "................",
        "......oooo......",
        "....ooPpPpoo....",
        "...oPpPpPpPpo...",
        "..oPpPpPpPpPpo..",
        "..oPpPpPpPpPpo..",
        "..opPpPpPpPpPo..",
        "...oPpPpPpPpo...",
        "....oooPpooo....",
        "......oPPo......",
        "......oooo......",
        "................",
        "................",
        "................",
    ], {"o": OUTLINE, "P": (246, 204, 190), "p": (222, 156, 146)}), UI / "icon-seashell.png")

    # --- Dungeon finds. ---
    save(draw([
        "................",
        ".......o........",
        "......oCo.......",
        ".....oCcCo......",
        ".....oCcCo......",
        "....oCcwcCo.....",
        "....oCcwcCo.....",
        "...oCcCwCcCo....",
        "...oCcCwCcCo....",
        "....oCcCcCo.....",
        "....oCcCcCo.....",
        ".....oCcCo......",
        ".....oCcCo......",
        "......oCo.......",
        ".......o........",
        "................",
    ], {"o": OUTLINE, "C": (140, 108, 236), "c": (96, 70, 196), "w": (226, 214, 255)}), UI / "icon-portal-shard.png")
    save(draw([
        "................",
        ".....oooooo.....",
        "...ooSSSSSSoo...",
        "..oSSsooooSSSo..",
        "..oSsoAAAAoSSo..",
        ".oSSoAAwwAAoSSo.",
        ".oSsoAwwAAAoSSo.",
        ".oSsoAAAAAAoSSo.",
        ".oSsoAAAAAaoSSo.",
        ".oSSoAAAAaaoSSo.",
        "..oSsoAAaaoSSo..",
        "..oSSSooooSSSo..",
        "...ooSSSSSSoo...",
        ".....oooooo.....",
        "................",
        "................",
    ], {"o": OUTLINE, "S": (128, 132, 150), "s": (96, 98, 116), "A": (238, 162, 64), "a": (196, 112, 44), "w": (255, 236, 176)}), UI / "icon-warden-core.png")
    save(draw([
        "................",
        "......oooo......",
        "......oKKo......",
        "......oooo......",
        ".......oo.......",
        "......oGGo......",
        ".....oGGGGo.....",
        "....oGwRRRRo....",
        "...oRwRRRRRRo...",
        "...oRwRRRRRRo...",
        "...oRRRRRRrRo...",
        "...oRRRRRrrRo...",
        "....oRRRRRRo....",
        ".....oooooo.....",
        "................",
        "................",
    ], {"o": OUTLINE, "K": (156, 110, 72), "G": (200, 222, 230), "w": (250, 230, 230), "R": (214, 60, 76), "r": (160, 36, 56)}), UI / "icon-healing-potion.png")


if __name__ == "__main__":
    main()
