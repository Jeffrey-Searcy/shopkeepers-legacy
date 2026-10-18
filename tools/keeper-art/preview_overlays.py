"""
Preview every wardrobe overlay on the standing head of each body and facing (a review tool, not part of the build).

The drawing rule copies the runtime rule in src/systems/AppearanceTextureSystem.ts, so the preview shows what the
game draws: overlays go hair, then facial hair, then hat; a later overlay paints over an earlier one; a hat hides
hairstyle cells above its crown row; and a cell is painted only where the plain head is empty or shows its master
pixel (in a frame, anything else there is a hand or tool in front of the head).

Usage (from the repo root):
    python tools/keeper-art/preview_overlays.py <output dir>
Writes <output dir>/overlays-<body>.png for each body in grids.BODIES.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import grids
from palette import PAL
from overlays import OVERLAYS, HAT_PALETTES, facing_cells, crown_rows

Z = 6     # zoom
PAD = 5   # cells of margin around the head window (the wizard tip reaches row -5)
HEAD = 21  # master rows shown
ORDER = ['hair', 'face', 'hat']  # runtime draw order by overlay kind
COMBOS = [[], ['tousled'], ['bob'], ['knit'], ['straw'], ['cap'], ['helmet'], ['wizard'], ['hood'], ['mustache'],
          ['beard'], ['bob', 'cap'], ['beard', 'helmet'], ['bob', 'hood'], ['tousled', 'beard', 'wizard']]
FACINGS = ['south', 'north', 'west', 'east']


def rgba(value):
    """Packed RGB -> opaque RGBA tuple."""
    return (value >> 16, (value >> 8) & 255, value & 255, 255)


def render(body, facing, names):
    """
    The head window of one body and facing with the named overlays drawn by the runtime rule.
    @returns an RGBA image (18 + 2*PAD) x (HEAD + PAD) cells.
    """
    G = grids.BODIES[body].master(facing)
    a = np.zeros((HEAD + PAD, 18 + 2 * PAD, 4), np.uint8)
    for y in range(HEAD):
        for x in range(18):
            if G[y][x] != '.':
                a[y + PAD, x + PAD] = rgba(PAL[G[y][x]])
    hats = [n for n in names if OVERLAYS[n]['kind'] == 'hat']
    if len(hats) > 1:
        raise ValueError(f'combo {names} has more than one hat')
    for name in sorted(names, key=lambda n: ORDER.index(OVERLAYS[n]['kind'])):
        kind = OVERLAYS[name]['kind']
        for (x, y), c in facing_cells(name, facing, body).items():
            if kind == 'hair' and hats and y < crown_rows(hats[0]):
                continue
            # why: in a standing master every head pixel is the master pixel, so the runtime's "empty or master"
            # test always passes here; a later overlay simply paints over an earlier one, as in the game
            v =PAL['o'] if c == 'o' else (HAT_PALETTES[name][c] if kind == 'hat' else PAL[c])
            a[y + PAD, x + PAD] = rgba(v)
    return Image.fromarray(a)


def main(out_dir):
    """Write one contact sheet per body: a column per combo, a row per facing."""
    out = Path(out_dir)
    if not out.is_dir():
        raise SystemExit(f'{out} is not a directory')
    tw, th = (18 + 2 * PAD) * Z, (HEAD + PAD) * Z
    for body in grids.BODIES:
        sheet = Image.new('RGBA', (len(COMBOS) * (tw + 6) + 6, 4 * (th + 6) + 26), (96, 120, 84, 255))
        draw = ImageDraw.Draw(sheet)
        for c, names in enumerate(COMBOS):
            draw.text((8 + c * (tw + 6), 6), '+'.join(names) or 'base', fill=(255, 255, 220, 255))
            for r, facing in enumerate(FACINGS):
                img = render(body, facing, names).resize((tw, th), Image.NEAREST)
                sheet.alpha_composite(img, (6 + c * (tw + 6), 22 + r * (th + 6)))
        sheet.save(out / f'overlays-{body}.png')
    print('wrote', ', '.join(f'overlays-{b}.png' for b in grids.BODIES))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: preview_overlays.py <output dir>')
    main(sys.argv[1])
