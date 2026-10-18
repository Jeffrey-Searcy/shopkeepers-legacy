"""
Tool sprites for the keeper's action sheets.

Each tool is a wooden handle (a 1 px line from the hand) plus a hand-drawn head. Heads are drawn fill-only,
pointing straight up (N), with '@' on the handle's top cell. The three other straight directions are lossless
quarter turns; the four diagonals are a 45-degree turn sampled 4x4 per pixel (majority vote), unless a
hand-drawn diagonal exists. The whole tool gets one 1 px outline at the end, so every pose has the same line weight.
"""
import math
from compose import outlined

# Orientation index -> unit step. 0 = N, then clockwise.
DIRS = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]

# Fill-only heads pointing N. The working edge faces E (the clockwise side), so after a turn to E it faces
# down, which is where every overhead swing lands.
HEADS = {
    'axe': [
        "....MN",
        "gGGMMN",
        "gHGMMN",
        "gGGMMN",
        "....MN",
        ".@....",
    ],
    'hoe': [
        "ggGGM.",
        "gH.GMN",
        ".@..MN",
        "....MN",
        ".....N",
    ],
    'pickaxe': [
        "..gGGMMN..",
        ".gG.H..MN.",
        "gg..@...MN",
        "g........N",
    ],
    'broom': [
        "sStSs",
        "sStts",
        "sStSs",
        "sSStS",
        ".sSs.",
        ".III.",
        "..@..",
    ],
    'scythe': [
        "gGMMMN..",
        "gH..GMMN",
        ".@....MN",
        ".......N",
    ],
}
# Handle lengths from the hand to the head, in pixels along the handle direction.
HANDLE = {'axe': 6, 'hoe': 7, 'pickaxe': 6, 'broom': 7, 'scythe': 9}


def _parse(rows):
    """Cells relative to the '@' cell. '@' itself is not returned (the handle paints it)."""
    cells, at = {}, None
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '@':
                at = (x, y)
            elif ch != '.':
                cells[(x, y)] = ch
    if at is None:
        raise ValueError('tool head has no @ attach cell')
    return {(x - at[0], y - at[1]): c for (x, y), c in cells.items()}


def _turn(cells, k):
    """Rotate relative cells clockwise by k quarter turns (lossless on a pixel grid)."""
    for _ in range(k % 4):
        cells = {(-y, x): c for (x, y), c in cells.items()}
    return cells


def _rotate(cells, degrees):
    """
    Rotate relative cells clockwise by any angle. Each output pixel samples a 4x4 grid of points, maps them back
    into the source, and keeps the most common key if at least 6 of 16 samples hit the sprite.
    """
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    r = int(max(max(abs(x), abs(y)) for x, y in cells) * 1.5) + 2
    out = {}
    for Y in range(-r, r + 1):
        for X in range(-r, r + 1):
            votes = {}
            for i in range(4):
                for j in range(4):
                    px, py = X - 0.375 + i * 0.25, Y - 0.375 + j * 0.25
                    # why: the inverse of a clockwise turn (screen y points down) is a counter-clockwise turn
                    sx, sy = px * c + py * s, -px * s + py * c
                    key = cells.get((round(sx), round(sy)))
                    if key:
                        votes[key] = votes.get(key, 0) + 1
            if sum(votes.values()) >= 6:
                out[(X, Y)] = max(votes, key=lambda k: votes[k])
    return out


def head(tool, orient):
    """Head cells for one of 8 orientations, relative to the attach point."""
    base = _parse(HEADS[tool])
    if orient % 2:
        base = _rotate(base, 45)
    return _turn(base, orient // 2)


def tool_layer(tool, grip, orient, handle=None, butt=1):
    """
    Build an outlined tool layer held at grip=(x, y), pointing in orientation 0..7.
    The handle runs from `butt` px behind the hand to the head. Diagonal handles take fewer steps, because each
    diagonal step is about 1.4 px long, so the tool keeps the same length when it turns.
    """
    dx, dy = DIRS[orient]
    length = HANDLE[tool] if handle is None else handle
    if orient % 2:
        length = max(1, round(length / 1.4))
    cells = {}
    for i in range(-butt, length + 1):
        cells[(grip[0] + dx * i, grip[1] + dy * i)] = 'u' if i % 3 == 1 else 'H'
    ax, ay = grip[0] + dx * length, grip[1] + dy * length
    for (x, y), c in head(tool, orient).items():
        cells[(ax + x, ay + y)] = c
    return outlined(cells)


def sword_layer(grip, orient, blade=7):
    """A short sword: blade, brass guard across the blade, wood grip under the hand, brass pommel."""
    dx, dy = DIRS[orient]
    px, py = -dy, dx  # perpendicular, for the guard
    if orient % 2:
        blade = round(blade / 1.4)
    cells = {}
    for i in range(2, blade + 2):
        cells[(grip[0] + dx * i, grip[1] + dy * i)] = 'N' if i == blade + 1 else ('M' if i % 2 else 'N')
    gx, gy = grip[0] + dx, grip[1] + dy
    cells[(gx, gy)] = 'A'
    for s in (-1, 1):
        cells[(gx + px * s, gy + py * s)] = 'Y'
    cells[grip] = 'h'
    cells[(grip[0] - dx, grip[1] - dy)] = 'Y'
    return outlined(cells)


CAN = [  # fill-only, upright, held by the rear loop handle at '@', spout to the right
    ".ff.......",
    "f.ffffff..",
    "f@FlFFFf.f",
    "f.FlFFFFfl",
    ".fFlFFFf..",
    "..ffffff..",
]
SPOUT = (8, 1)  # the spout tip 'l', relative to '@'
CAN_TILT = {0: 0, 1: 30, 2: 50}  # tilt index -> clockwise degrees


def can_spout(grip, tilt):
    """Frame pixel at the spout tip for a can held at grip with the given tilt (where the water leaves)."""
    a = math.radians(CAN_TILT[tilt])
    x, y = SPOUT
    return (grip[0] + round(x * math.cos(a) - y * math.sin(a)), grip[1] + round(x * math.sin(a) + y * math.cos(a)))


def can_layer(grip, tilt):
    """
    Blue watering can held by its rear handle at grip, spout to the right, turned clockwise by CAN_TILT[tilt]
    degrees (0 upright, 1 starting to pour, 2 pouring). The hand is drawn over the handle by the pose.
    """
    if tilt not in CAN_TILT:
        raise ValueError(f'unknown can tilt {tilt!r}')
    cells = _parse(CAN)
    if CAN_TILT[tilt]:
        cells = _rotate(cells, CAN_TILT[tilt])
    return outlined({(grip[0] + x, grip[1] + y): c for (x, y), c in cells.items()})
