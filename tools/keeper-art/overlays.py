"""
Hand-drawn wardrobe overlays for the keeper's head: two hairstyles (tousled, bob), six hats (knit cap, straw sun hat,
tweed cap, steel helmet, wizard's hat, wool hood) and two kinds of facial hair (mustache, beard).

Each overlay is a list of (gy, gx_start, pixels) runs in body-grid cells (the same 18x34 grid as the masters in grids.py),
drawn for three facings: south (front), north (back) and east (right side). West is east mirrored across the grid.
'.' in a run means "leave this cell alone". Hair overlays use the hair keys 1-5 so they follow the chosen hair color;
facial hair ('face') uses the hair keys too; hats use their own small palettes (HAT_PALETTES). 'o' is always the
shared outline color. An overlay may carry per-body drawings ('bodies'), because the feminine front face sits one
cell to the right of the original one.

The game paints an overlay cell only where the frame is empty or still shows the master head at that cell, so a tool
or a hand in front of the head always stays on top.
"""

HAT_PALETTES = {
    # knit cap: dark rib, mid-dark, mid, light, pom-pom highlight
    'knit': {'1': 0x2c4a3c, '2': 0x3f6a55, '3': 0x5a8a6e, '4': 0x7fab8c, '5': 0xd6e6c4},
    # straw sun hat: shadow, dark straw, straw, light straw, ribbon dark, ribbon light
    'straw': {'1': 0x6f5228, '2': 0xa5813f, '3': 0xd2b064, '4': 0xeed59a, 'r': 0x8e2a24, 'R': 0xc4483a},
    # tweed flat cap: dark, mid-dark, mid, light
    'cap': {'1': 0x3b3530, '2': 0x5a5049, '3': 0x7a6d60, '4': 0x9c8d7a},
    # guard's brimmed steel helmet: dark, mid-dark, mid, light, shine
    'helmet': {'1': 0x39424d, '2': 0x5e6b78, '3': 0x8796a3, '4': 0xb4c1cb, '5': 0xe9f0f4},
    # wizard's hat: deep violet ramp and a gold band
    'wizard': {'1': 0x241a3d, '2': 0x3a2a63, '3': 0x55408a, '4': 0x7559ad, '5': 0xd9b04a, '6': 0xf3dc8a},
    # wool hood (sage grey): dark, mid-dark, mid, light
    'hood': {'1': 0x29372f, '2': 0x3d5144, '3': 0x566e5c, '4': 0x768f79},
}


def _mirror_runs(runs, width=18):
    """Mirror runs across the 18-cell grid (gx -> 17 - gx), keeping each run's pixels in left-to-right order."""
    out = []
    for gy, x0, px in runs:
        out.append((gy, width - (x0 + len(px)), px[::-1]))
    return out


def _sym(left_runs):
    """A left-side drawing plus its mirror on the right (for front and back views, which are near-symmetric)."""
    return left_runs + _mirror_runs(left_runs)


KNIT_FRONT = [
    (-3, 8, 'oo'),
    (-2, 7, 'o55o'),
    (-1, 6, 'oo44oo'),
    (0, 4, 'oo43333322oo'),
    (1, 3, 'o433333333222o'),
    (2, 2, 'o4333333332222o'),
    (3, 1, 'o43333333332222o'),
    (4, 1, 'o43333333332222o'),
    (5, 0, 'o2424242424242421o'),
    (6, 0, 'o2323232323232321o'),
    (7, 1, 'oooooooooooooooo'),
]
KNIT_SIDE = [
    (-3, 6, 'oo'),
    (-2, 5, 'o55o'),
    (-1, 4, 'oo44oo'),
    (0, 3, 'oo43333322oo'),
    (1, 2, 'o4333333332222o'),
    (2, 1, 'o43333333332222o'),
    (3, 1, 'o43333333333222o'),
    (4, 0, 'o4333333333332222o'),
    (5, 0, 'o2424242424242421o'),
    (6, 0, 'o242424242424242o'),
    (7, 1, 'ooooooooooo'),
]

STRAW_FRONT = [
    (-2, 5, 'oooooooo'),
    (-1, 4, 'o34444332o'),
    (0, 3, 'o3444443322o'),
    (1, 3, 'o3444433322o'),
    (2, 3, 'oRRRRRRRrrro'),
    (3, -1, 'oooo333333333322oooo'),
    (4, -3, 'o444444444444444333222o'.ljust(23, '2') + 'o'),
    (5, -2, 'oo' + '1' * 18 + 'oo'),
]
STRAW_SIDE = [
    (-2, 4, 'ooooooo'),
    (-1, 3, 'o3444432o'),
    (0, 2, 'o344444322o'),
    (1, 2, 'o344443322o'),
    (2, 2, 'oRRRRRRRrro'),
    (3, -3, 'o' + '4' * 14 + '3' * 5 + '2' * 3 + 'o'),
    (4, -2, 'oo' + '1' * 18 + 'oo'),
]

TOUSLED_FRONT = [
    (-2, 3, 'o...o.....o'),
    (-1, 2, 'o4o.o5o...o4o'),
    (0, 2, 'o44o454oo.o44o'),
    (1, 3, 'o4434544o4443o'),
    (3, 0, 'o3'),
    (4, 0, '2'),
    (3, 16, '4o'),
    (4, 17, 'o'),
]
TOUSLED_BACK = [
    (-2, 3, 'o...o.....o'),
    (-1, 2, 'o4o.o5o...o4o'),
    (0, 2, 'o44o454oo.o44o'),
    (1, 3, 'o4434544o4443o'),
    (3, 0, 'o3'),
    (4, 0, '2'),
    (3, 16, '4o'),
    (4, 17, 'o'),
]
TOUSLED_SIDE = [
    (-2, 2, 'o....o..o'),
    (-1, 1, 'o4o..o4oo4o'),
    (0, 1, 'o44oo454o44o'),
    (1, 2, 'o44334544443o'),
    (2, 0, 'o'),
    (3, 0, 'o3'),
]

BOB_SIDES = [  # left side only; the front and back views mirror it to the right
    (8, -1, 'o'),
    (9, -1, 'o23'),
    (10, -1, 'o23'),
    (11, -1, 'o23'),
    (12, -1, 'o232'),
    (13, -1, 'o232'),
    (14, -1, 'o232'),
    (15, -1, 'o2221'),
    (16, -1, 'ooooo'),
]
BOB_BACK_NAPE = [
    (15, 3, '112222222211'),
    (16, 3, 'oooooooooooo'),
]
BOB_SIDE = [
    (12, 0, 'o'),
    (13, 0, 'o12'),
    (14, 0, 'o122'),
    (15, 0, 'o1222111'),
    (16, 0, 'oooooooo'),
]


def _block(y0, x0, rows):
    """A rectangular drawing as runs: row i of `rows` starts at grid cell (x0, y0 + i); '.' cells stay untouched."""
    return [(y0 + i, x0, r) for i, r in enumerate(rows)]


def _shift_x(runs, dx):
    """Move every run dx cells sideways (the feminine front face sits one cell right of the original one)."""
    return [(gy, x0 + dx, px) for gy, x0, px in runs]


CAP_FRONT = _block(-1, 0, [
    ".....oooooooo.....",
    "...oo34444333oo...",
    "..o344444433332o..",
    ".o34444443333322o.",
    ".o34444433333222o.",
    "o1222222222222221o",
    "o3444444444444432o",
    ".oooooooooooooooo.",
])
CAP_BACK = _block(-1, 0, [
    ".....oooooooo.....",
    "...oo34444333oo...",
    "..o344444433332o..",
    ".o34444443333322o.",
    ".o34444433333222o.",
    "o1222222222222221o",
    ".oooooooooooooooo.",
])
CAP_SIDE = _block(-1, 0, [
    "....oooooooo........",
    "..oo34444333oo......",
    ".o3444444333332o....",
    ".o34444443333322o...",
    "o344444433333222o...",
    "o12222222222222221o.",
    "oooooooooooo4444443o",
    "............ooooooo.",
])

HELMET_FRONT = _block(-3, 0, [
    ".......oooo.......",
    ".....oo4554oo.....",
    "....o45543332o....",
    "...o4554333322o...",
    "..o455433333322o..",
    "..o444333333222o..",
    ".o11111111111111o.",
]) + [(4, -2, 'o3' + '4' * 12 + '333' + '2222' + 'o'), (5, -1, 'oo' + '1' * 16 + 'oo')]
HELMET_SIDE = _block(-3, 1, [
    ".......oooo.......",
    ".....oo4554oo.....",
    "....o45543332o....",
    "...o4554333322o...",
    "..o455433333322o..",
    "..o444333333222o..",
    ".o11111111111111o.",
]) + [(4, -2, 'o3' + '4' * 13 + '333' + '2222' + 'o'), (5, -1, 'oo' + '1' * 17 + 'oo')]

WIZARD_FRONT = _block(-5, 0, [
    "............oo....",
    "...........o4o....",
    "..........o432o...",
    ".........o4432o...",
    "........o44332o...",
    ".......o443322o...",
    "......o4433322o...",
    "....oo44433322oo..",
]) + [(3, 2, 'o' + '56' * 6 + '5o'), (4, -2, 'o3' + '4' * 11 + '3' * 4 + '2' * 4 + 'o'), (5, -1, 'oo' + '1' * 16 + 'oo')]
WIZARD_BACK = _block(-5, 0, [
    "....oo............",
    "....o4o...........",
    "...o432o..........",
    "...o4432o.........",
    "...o44332o........",
    "...o443322o.......",
    "...o4433322o......",
    "..oo44433322oo....",
]) + [(3, 2, 'o' + '56' * 6 + '5o'), (4, -2, 'o3' + '4' * 11 + '3' * 4 + '2' * 4 + 'o'), (5, -1, 'oo' + '1' * 16 + 'oo')]
WIZARD_SIDE = _block(-5, 0, [
    "oo................",
    "o4oo..............",
    ".o43oo............",
    "..o4432o..........",
    "...o44332oo.......",
    "....o4433322o.....",
    "....o44433322o....",
    "...o444433332o....",
]) + [(3, 2, 'o' + '56' * 6 + '6o'), (4, -3, 'o3' + '4' * 12 + '3' * 5 + '2' * 4 + 'o'), (5, -2, 'oo' + '1' * 18 + 'oo')]

HOOD_FRONT = _block(-2, -1, [
    ".......oooooo.......",
    ".....oo443332oo.....",
    "...o444443333322o...",
    "..o44444333333222o..",
    ".o4444433333332222o.",
    ".o4444433333332222o.",
    "o444443333333322222o",
    "o4444oooooooooo222o.",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    "o443o..........o322o",
    ".o43o..........o32o.",
    ".o433o........o332o.",
    "..o433oooooooo3322o.",
    "...ooooooooooooooo..",
])
HOOD_BACK = _block(-2, -1, [
    ".......oooooo.......",
    ".....oo443332oo.....",
    "...o444443333322o...",
    "..o44444333333222o..",
    ".o4444433333332222o.",
    ".o4444433333332222o.",
    "o444443333333322222o",
    "o444443333333322222o",
    "o444433333333322222o",
    "o444433333333322222o",
    "o444433333333222222o",
    "o444333333333222222o",
    "o444333333333222222o",
    "o443333333332222222o",
    "o443333333332222222o",
    "o433333333322222221o",
    ".o3333333322222221o.",
    ".o3332222222222211o.",
    "..o33222222222211o..",
    "...ooooooooooooooo..",
])
HOOD_SIDE = _block(-2, -1, [
    "......oooooo........",
    "....oo44443332oo....",
    "...o4444433333222o..",
    "..o444443333332222o.",
    ".o4444433333332222o.",
    ".o4444433333332222o.",
    "o44444333333322222o.",
    "o4444433333332222o..",
    "o44443333322oooooo..",
    "o4444333322o........",
    "o4444333322o........",
    "o4444333322o........",
    "o4443333322o........",
    "o4443333322o........",
    "o4443333322o........",
    "o4433333322o........",
    "o4433333322o........",
    ".o433333322o........",
    "..o3332222o.........",
    "...oooooooo.........",
])

# Facial hair (hair keys, so it follows the hair color). Faces only show from the front and the side.
MUSTACHE_FRONT = [(14, 4, 'o2332'), (14, 9, '2332o'), (15, 4, 'o2'), (15, 12, '2o')]
MUSTACHE_SIDE = [(14, 11, '2332'), (15, 12, '22'), (15, 14, 'o')]
BEARD_FRONT = _block(12, 0, [
    "...2..........2...",
    "...23........32...",
    "..o23332mm23332o..",
    "..o233333333332o..",
    "...o2333333332o...",
    "....o22333322o....",
    ".....oo2222oo.....",
    ".......oooo.......",
])
BEARD_SIDE = _block(12, 0, [
    ".........2........",
    ".........23.......",
    ".........2333m3o..",
    ".........23333332o",
    "........o2333332o.",
    "........o222222o..",
    ".........oooooo...",
])

OVERLAYS = {
    'tousled': {'kind': 'hair', 'south': TOUSLED_FRONT, 'north': TOUSLED_BACK, 'east': TOUSLED_SIDE},
    'bob': {'kind': 'hair', 'south': _sym(BOB_SIDES), 'north': _sym(BOB_SIDES) + BOB_BACK_NAPE, 'east': BOB_SIDE},
    'knit': {'kind': 'hat', 'south': KNIT_FRONT, 'north': KNIT_FRONT, 'east': KNIT_SIDE},
    'straw': {'kind': 'hat', 'south': STRAW_FRONT, 'north': STRAW_FRONT, 'east': STRAW_SIDE},
    'cap': {'kind': 'hat', 'south': CAP_FRONT, 'north': CAP_BACK, 'east': CAP_SIDE},
    'helmet': {'kind': 'hat', 'south': HELMET_FRONT, 'north': HELMET_FRONT, 'east': HELMET_SIDE},
    'wizard': {'kind': 'hat', 'south': WIZARD_FRONT, 'north': WIZARD_BACK, 'east': WIZARD_SIDE},
    'hood': {'kind': 'hat', 'crown': 99, 'south': HOOD_FRONT, 'north': HOOD_BACK, 'east': HOOD_SIDE},
    'mustache': {'kind': 'face', 'south': MUSTACHE_FRONT, 'north': [], 'east': MUSTACHE_SIDE,
                 'bodies': {'feminine': {'south': _shift_x(MUSTACHE_FRONT, 1)}}},
    'beard': {'kind': 'face', 'south': BEARD_FRONT, 'north': [], 'east': BEARD_SIDE,
              'bodies': {'feminine': {'south': _shift_x(BEARD_FRONT, 1)}}},
}
# Hats hide hairstyle cells above this grid row; a hat may raise it ('crown': 99 hides every hairstyle cell).
HAT_CROWN_ROWS = 5


def cells(runs):
    """Expand runs into {(gx, gy): key}, skipping '.'; raises on a cell drawn twice with different keys."""
    out = {}
    for gy, x0, px in runs:
        for i, ch in enumerate(px):
            if ch == '.':
                continue
            at = (x0 + i, gy)
            if at in out and out[at] != ch:
                raise ValueError(f'overlay cell {at} drawn as {out[at]!r} and {ch!r}')
            out[at] = ch
    return out


def facing_cells(name, facing, body):
    """
    Cells for one overlay, facing and body ('original' or 'feminine'); 'west' is 'east' mirrored across the 18-cell
    grid. A body-specific drawing (the spec's 'bodies' entry) replaces the shared one for that facing.
    """
    spec = OVERLAYS[name]
    own = spec.get('bodies', {}).get(body, {})
    source = 'east' if facing == 'west' else facing
    runs = own[source] if source in own else spec[source]
    if facing == 'west':
        return {(17 - x, y): c for (x, y), c in cells(runs).items()}
    return cells(runs)


def crown_rows(name):
    """Grid row above which a hat hides hairstyle cells (HAT_CROWN_ROWS unless the hat sets 'crown')."""
    spec = OVERLAYS[name]
    if spec['kind'] != 'hat':
        raise ValueError(f'{name} is not a hat')
    return spec.get('crown', HAT_CROWN_ROWS)
