"""Turn ASCII pixel maps into RGBA images and side-by-side comparison sheets."""
import numpy as np
from PIL import Image
from palette import PAL, rgb
def grid_img(rows):
    """Render one pixel map; raises on uneven rows or unknown palette keys (no silent gaps)."""
    w = len(rows[0])
    a = np.zeros((len(rows), w, 4), np.uint8)
    for y, r in enumerate(rows):
        if len(r) != w: raise ValueError(f'row {y} has {len(r)} px, expected {w}: {r!r}')
        for x, ch in enumerate(r):
            if ch not in PAL: raise ValueError(f'unknown key {ch!r} at {x},{y}')
            if PAL[ch] is None: continue
            a[y, x, :3] = rgb(ch); a[y, x, 3] = 255
    return Image.fromarray(a)
def compare(pairs, out, Z=10, bg=(96, 120, 84)):
    """pairs: list of PIL images; each drawn at Z (1x art) or Z*K for poster crops passed as (img, zoom)."""
    tiles = []
    for p in pairs:
        img, z = p if isinstance(p, tuple) else (p, Z)
        tiles.append(img.resize((round(img.width * z), round(img.height * z)), Image.NEAREST))
    W = sum(t.width + 20 for t in tiles) + 20; H = max(t.height for t in tiles) + 40
    sheet = Image.new('RGBA', (W, H), bg + (255,)); x = 20
    for t in tiles: sheet.alpha_composite(t, (x, H - 20 - t.height)); x += t.width + 20
    sheet.save(out)
