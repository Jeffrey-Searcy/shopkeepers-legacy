#!/usr/bin/env python3
"""
Title-screen and Willowbrook Papers art packer.

The four painted screens in docs/art-source/title/ (1672x941 each) arrive with some words baked in. A few of
those words must change at runtime, so this script removes them and the game draws live text in their place:

  * title.png              -> the gamepad-only "(A) Select" hint and the "v0.1.0" stamp are removed (the game
                              draws the real keyboard hint and the package.json version). The four menu buttons
                              stay in the plate, but the game always covers them with the two button skins below.
  * title-button-*.png     -> one green (selected) and one wood (idle) menu button cut from the title art with the
                              label painted out, so live labels and live selection sit on the same authored button.
  * papers-*.png           -> the "THE WILLOWBROOK PAPERS - SAVE 1" header is removed (the game writes the real
                              save slot). Page counters, letters and buttons are correct as painted and stay.

Removal uses a small diffusion fill: masked text pixels repeatedly take the mean of their neighbours, so thin
glyph strokes dissolve into the surrounding wood, grass or cloth. Nothing outside the listed boxes is touched.

Usage:  python3 scripts/pack-title-art.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SOURCE = REPO / "docs" / "art-source" / "title"
OUT = REPO / "public" / "assets" / "ui" / "title"
SIZE = (1672, 941)

# Painted menu buttons, measured on title.png: each outline box is x 638..1032 and 69 px tall.
BUTTON_X = (638, 1033)
BUTTON_TOPS = (424, 499, 575, 650)
BUTTON_H = 69


def load(name: str) -> np.ndarray:
    """Read one source screen as a float RGB array; fail loudly when its size is not the measured size."""
    image = Image.open(SOURCE / name).convert("RGB")
    if image.size != SIZE:
        raise ValueError(f"{name} is {image.size}, expected {SIZE}; re-measure the boxes in this script")
    return np.asarray(image).astype(np.float64)


def save(pixels: np.ndarray, name: str) -> None:
    """Write an RGB array as a PNG under public/assets/ui/title/."""
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(pixels.round(), 0, 255).astype(np.uint8), "RGB").save(OUT / name, optimize=True)


def dilate(mask: np.ndarray, steps: int) -> np.ndarray:
    """Grow a mask by `steps` pixels (4-neighbour) so anti-aliased glyph edges are removed too."""
    grown = mask.copy()
    for _ in range(steps):
        step = grown.copy()
        step[1:, :] |= grown[:-1, :]
        step[:-1, :] |= grown[1:, :]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        grown = step
    return grown


def erase(pixels: np.ndarray, box: tuple[int, int, int, int], is_text, grow: int = 2, rounds: int = 400) -> int:
    """
    Remove text inside `box` (x0, y0, x1, y1; end-exclusive) by diffusion fill.

    `is_text(region)` receives the region's RGB array and returns a bool mask of glyph pixels. Masked pixels are
    re-solved from their unmasked neighbours; unmasked pixels never change. Returns the masked pixel count so a
    caller can fail when a box no longer matches its art.
    """
    x0, y0, x1, y1 = box
    region = pixels[y0:y1, x0:x1]
    mask = dilate(is_text(region), grow)
    # why: the outermost ring of the box must stay fixed, or the fill has no known border to diffuse from.
    mask[0, :] = mask[-1, :] = False
    mask[:, 0] = mask[:, -1] = False
    count = int(mask.sum())
    if count == 0:
        raise ValueError(f"no text found in box {box}")
    filled = region.copy()
    filled[mask] = region[~mask].mean(axis=0)
    for _ in range(rounds):
        mean = (np.roll(filled, 1, 0) + np.roll(filled, -1, 0) + np.roll(filled, 1, 1) + np.roll(filled, -1, 1)) / 4
        filled[mask] = mean[mask]
    pixels[y0:y1, x0:x1] = filled
    return count


def cream(region: np.ndarray) -> np.ndarray:
    """Pale cream lettering (title hints and version): every channel is bright."""
    return region.min(axis=2) > 140


def gold(region: np.ndarray) -> np.ndarray:
    """Warm gold header lettering: bright red and green, red at least as strong as green, clearly above blue."""
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    return (r > 150) & (g > 120) & (r >= g - 8) & (r - b > 40)


def blank_label(button: np.ndarray, label: tuple[int, int], donor: tuple[int, int]) -> np.ndarray:
    """
    Paint out a button label by repeating a clean donor strip of columns across the label columns.

    why: the painted buttons are horizontal bands (outline, bevel, inner rule, fill), so a strip copied sideways
    keeps every band continuous, which a diffusion fill would smear. Columns are mirrored back and forth through
    the donor strip so no hard seam repeats.
    """
    out = button.copy()
    d0, d1 = donor
    width = d1 - d0
    for index, x in enumerate(range(label[0], label[1])):
        cycle = index % (2 * width)
        source = d0 + (cycle if cycle < width else 2 * width - 1 - cycle)
        out[:, x] = button[:, source]
    return out


def main() -> None:
    """Build every packed title image from the four source screens."""
    title = load("title.png")
    # Button skins come from the untouched title art: slot 1 is the green selected button, slot 2 a wood one.
    x0, x1 = BUTTON_X
    green = title[BUTTON_TOPS[0]:BUTTON_TOPS[0] + BUTTON_H, x0:x1]
    wood = title[BUTTON_TOPS[1]:BUTTON_TOPS[1] + BUTTON_H, x0:x1]
    # Label columns (button-local x) are 95..300; clean donor strips sit between the arrow and the label.
    save(blank_label(green, (95, 300), (62, 92)), "title-button-selected.png")
    save(blank_label(wood, (95, 300), (40, 90)), "title-button.png")

    erase(title, (690, 850, 975, 898), cream)   # "↑↓ Choose  (A) Select"
    erase(title, (1556, 884, 1634, 912), cream)  # "v0.1.0"
    save(title, "title.png")

    for name, box in (("papers-1-letter.png", (98, 38, 566, 68)),
                      ("papers-2-departure.png", (98, 40, 614, 72)),
                      ("papers-3-choice.png", (96, 36, 506, 64))):
        page = load(name)
        erase(page, box, gold)
        save(page, name)


if __name__ == "__main__":
    main()
