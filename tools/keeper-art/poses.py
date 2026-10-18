"""
Keyframes for every tool action, per facing. Grid cells are body-grid coordinates (see actions.py).
Orientation numbers: 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW.
"""
import math
from actions import pose_front, pose_side, fx, mirror_frame
from tools import head, can_spout


def overhead(tool, hit):
    """
    Overhead two-handed swing that lands at the feet: axe (chop), hoe (dig), pickaxe (mine).
    f0 lift over the right shoulder, f1 tool high over the head, f2 strike, f3 impact with debris.
    """
    # why: in the high frame (f1) the head of every tool should clear the hair by the same amount, so the
    # handle length depends on how far that tool's head hangs below its attach point.
    bottom = max(y for _, y in head(tool, 0))
    high = lambda grip_y: grip_y - (2 - bottom)
    down = [
        dict(arms_z='back', hands={'R': (16, 10), 'L': (13, 11)}, tool=(tool, (16, 9), 0, 4), tool_z='back'),
        dict(dy=-1, arms_z='back', hands={'R': (11, 7), 'L': (6, 7)}, tool=(tool, (9, 6), 0, high(6)), tool_z='back'),
        dict(dy=1, legs='brace', hands={'R': (10, 21), 'L': (6, 21)}, tool=(tool, (8, 22), 4, 3), tool_z='front'),
        dict(dy=1, legs='brace', hands={'R': (10, 23), 'L': (6, 23)}, tool=(tool, (8, 24), 4, 3), tool_z='front',
             fx=fx(hit)),
    ]
    up = [
        dict(hands={'R': (16, 10), 'L': (13, 11)}, tool=(tool, (16, 9), 0, 4), tool_z='back'),
        dict(dy=-1, arms_z='back', hands={'R': (11, 7), 'L': (6, 7)}, tool=(tool, (9, 6), 0, high(6)), tool_z='back'),
        dict(dy=1, legs='brace', arms_z='back', hands={'R': (12, 13), 'L': (5, 13)},
             tool=(tool, (9, 12), 0, 12 - (4 - bottom)), tool_z='back'),
        dict(dy=1, legs='brace', arms_z='back', hands={'R': (12, 16), 'L': (5, 16)}, tool=(tool, (9, 13), 0, 3),
             tool_z='back',
             fx=fx([(x, y - 8, c) for x, y, c in hit])),
    ]
    right = [
        dict(hands={'S': (4, 11)}, tool=(tool, (4, 11), 7, 6), tool_z='back'),
        dict(dy=-1, hands={'S': (7, 9)}, tool=(tool, (7, 9), 0, high(9)), tool_z='back'),
        dict(dy=1, legs='lunge', hands={'S': (15, 18)}, tool=(tool, (15, 18), 2, 5), tool_z='front'),
        dict(dy=1, legs='lunge', hands={'S': (15, 21)}, tool=(tool, (15, 21), 3, 6), tool_z='front',
             fx=fx([(x + 12, y - 1, c) for x, y, c in hit])),
    ]
    return down, up, right


def arc(cx, cy, r, a0, a1, keys, ry=None, width=2):
    """
    A swoosh on an ellipse arc, in grid cells: angles in degrees (0 = east, clockwise because screen y points
    down), r the x radius, ry the y radius (ground arcs are squashed to about half), width the stroke in px.
    keys cycles from the outer ring inward, so the outer edge is brightest.
    """
    ry = r if ry is None else ry
    out, seen = [], set()
    lo, hi = sorted((a0, a1))
    for ring in range(width):
        k = keys[ring % len(keys)]
        a = lo
        while a <= hi:
            x = round(cx + (r - ring) * math.cos(math.radians(a)))
            y = round(cy + (ry - ring * ry / r) * math.sin(math.radians(a)))
            if (x, y) not in seen:
                seen.add((x, y)); out.append((x, y, k))
            a += 2
    return out


def scythe():
    """Scythe ('sweep'): a wide, low, flat swing across the grass, leaving a green arc of cut blades."""
    t = 'scythe'
    down = [
        dict(hands={'R': (16, 20), 'L': (14, 21)}, tool=(t, (16, 20), 2, 6), tool_z='front'),
        dict(dy=1, legs='brace', hands={'R': (11, 23), 'L': (8, 23)}, tool=(t, (10, 24), 4, 4), tool_z='front',
             fx=fx(arc(9, 32, 9, 0, 70, 'UT', ry=4, width=1))),
        dict(dy=1, legs='brace', hands={'R': (4, 23), 'L': (2, 22)}, tool=(t, (2, 23), 6, 6), tool_z='front',
             fx=fx(arc(9, 32, 11, 10, 175, 'UT', ry=5))),
        dict(hands={'R': (2, 20), 'L': (1, 18)}, tool=(t, (1, 19), 7, 6), tool_z='front',
             fx=fx([(-4, 25, 'U'), (-2, 22, 'T'), (-6, 28, 'U'), (19, 31, 'T'), (-3, 31, 'U')])),
    ]
    up = [
        dict(hands={'R': (3, 20), 'L': (1, 21)}, tool=(t, (1, 20), 6, 6), tool_z='back'),
        dict(dy=1, legs='brace', arms_z='back', hands={'R': (11, 19), 'L': (7, 19)}, tool=(t, (9, 18), 0, 6),
             tool_z='back', fx=fx(arc(9, 31, 11, 190, 220, 'UT', ry=4, width=1))),
        dict(dy=1, legs='brace', hands={'R': (15, 21), 'L': (13, 21)}, tool=(t, (16, 21), 2, 6), tool_z='back',
             fx=fx(arc(9, 31, 12, 185, 355, 'UT', ry=4))),
        dict(hands={'R': (16, 18), 'L': (14, 18)}, tool=(t, (17, 18), 1, 6), tool_z='back',
             fx=fx([(21, 16, 'U'), (19, 13, 'T'), (23, 20, 'U'), (-3, 18, 'T')])),
    ]
    right = [
        dict(hands={'S': (4, 20)}, tool=(t, (4, 20), 6, 6), tool_z='back'),
        dict(dy=1, legs='lunge', hands={'S': (10, 23)}, tool=(t, (10, 23), 4, 5), tool_z='front',
             fx=fx(arc(11, 32, 8, 150, 190, 'UT', ry=3, width=1))),
        dict(dy=1, legs='lunge', hands={'S': (15, 21)}, tool=(t, (15, 21), 3, 7), tool_z='front',
             fx=fx(arc(12, 32, 11, -30, 170, 'UT', ry=4))),
        dict(hands={'S': (16, 17)}, tool=(t, (16, 17), 1, 7), tool_z='front',
             fx=fx([(24, 22, 'U'), (22, 18, 'T'), (26, 27, 'U'), (20, 31, 'T'), (27, 31, 'U')])),
    ]
    return down, up, right


def broom():
    """Broom: short push-and-pull strokes with the bristles on the floor, kicking up small dust puffs."""
    t = 'broom'
    dust = lambda x, y: [(x, y, 'X'), (x + 1, y - 1, 't'), (x - 1, y - 1, 'X'), (x + 2, y, 't')]
    down = [
        dict(hands={'R': (11, 20), 'L': (8, 18)}, tool=(t, (10, 19), 5, 7), tool_z='front'),
        dict(hands={'R': (11, 21), 'L': (9, 19)}, tool=(t, (10, 20), 4, 6), tool_z='front'),
        dict(dy=1, legs='brace', hands={'R': (12, 21), 'L': (10, 19)}, tool=(t, (11, 20), 3, 7), tool_z='front',
             fx=fx(dust(19, 36))),
        dict(dy=1, legs='brace', hands={'R': (11, 21), 'L': (9, 19)}, tool=(t, (10, 20), 4, 6), tool_z='front',
             fx=fx(dust(21, 34) + dust(4, 37))),
    ]
    up = [
        dict(arms_z='back', hands={'R': (12, 21), 'L': (7, 20)}, tool=(t, (12, 20), 1, 7), tool_z='back'),
        dict(arms_z='back', hands={'R': (12, 21), 'L': (7, 20)}, tool=(t, (12, 21), 1, 4), tool_z='back'),
        dict(dy=1, legs='brace', arms_z='back', hands={'R': (11, 21), 'L': (6, 20)}, tool=(t, (6, 20), 7, 7),
             tool_z='back', fx=fx(dust(-4, 25))),
        dict(dy=1, legs='brace', arms_z='back', hands={'R': (11, 21), 'L': (6, 21)}, tool=(t, (6, 21), 7, 4),
             tool_z='back', fx=fx(dust(-3, 22) + dust(20, 26))),
    ]
    right = [
        dict(hands={'S': (11, 19)}, tool=(t, (11, 19), 3, 8), tool_z='front'),
        dict(dy=1, legs='lunge', hands={'S': (14, 20)}, tool=(t, (14, 20), 3, 8), tool_z='front'),
        dict(dy=1, legs='lunge', hands={'S': (15, 20)}, tool=(t, (15, 20), 3, 8), tool_z='front',
             fx=fx(dust(28, 33) + dust(25, 30))),
        dict(hands={'S': (12, 20)}, tool=(t, (12, 20), 3, 8), tool_z='front',
             fx=fx(dust(30, 31))),
    ]
    return down, up, right


def water():
    """Watering can: lift, tip, pour a stream from the spout, then splash where the water lands."""
    def pour(grip, tilt, ground, start=1, splash=False):
        """Water drops from the spout of a can held at grip (grid cells) down to the ground row."""
        sx, sy = can_spout(grip, tilt)
        cells = [(sx + (i % 2), y, 'qz'[i % 2]) for i, y in enumerate(range(sy + start, ground))]
        if splash:
            cells += [(sx - 2, ground, 'z'), (sx + 3, ground, 'z'), (sx - 1, ground - 1, 'q'),
                      (sx + 2, ground - 1, 'q'), (sx - 3, ground - 2, 'z'), (sx + 4, ground - 2, 'q')]
        return fx(cells)

    def side(face, ground, dy=0):
        """The same pour seen from one facing; face picks hand positions (grid cells) for the 4 beats."""
        g0, g1, g2, g3 = face
        legs = 'brace' if dy else 'stand'
        return [
            dict(hands={'R': g0}, tool=('can', g0, 0, None)),
            dict(hands={'R': g1}, tool=('can', g1, 1, None), fx=pour(g1, 1, ground, 2, False)),
            dict(dy=1, legs='brace', hands={'R': g2}, tool=('can', g2, 2, None), fx=pour(g2, 2, ground)),
            dict(dy=1, legs='brace', hands={'R': g3}, tool=('can', g3, 2, None), fx=pour(g3, 2, ground, 2, True)),
        ]

    down = side([(14, 21), (15, 20), (15, 19), (15, 19)], 37)
    for f in down:
        f['tool_z'] = 'mid'
    up = side([(15, 21), (15, 20), (15, 19), (15, 19)], 32)
    for f in up:
        f['tool_z'] = 'back'
    right = side([(13, 20), (14, 19), (14, 18), (14, 18)], 33)
    for f in right:
        f['tool_z'] = 'mid'
        f['hands'] = {'S': f['hands']['R']}
        if f.get('legs') == 'brace':
            f['legs'] = 'lunge'
    # why: the first beat of the pour only shows a single drop leaving the spout, not a full stream
    for row in (down, up, right):
        row[1]['fx'] = {k: v for k, v in list(row[1]['fx'].items())[:1]}
    return down, up, right


def sword():
    """Sword: wind up, swing over, slash with a bright arc, follow through."""
    t = 'sword'
    down = [
        dict(hands={'R': (16, 12)}, tool=(t, (16, 12), 1, None), tool_z='front'),
        dict(hands={'R': (17, 17)}, tool=(t, (17, 17), 2, None), tool_z='front',
             fx=fx(arc(9, 18, 15, -50, -10, 'Z', width=1))),
        dict(dy=1, legs='brace', hands={'R': (11, 22)}, tool=(t, (11, 22), 4, None), tool_z='front',
             fx=fx(arc(9, 20, 13, -30, 100, 'XZ'))),
        dict(dy=1, legs='brace', hands={'R': (5, 22)}, tool=(t, (5, 22), 5, None), tool_z='front',
             fx=fx(arc(9, 20, 13, 60, 150, 'ZX'))),
    ]
    up = [
        dict(hands={'R': (16, 12)}, tool=(t, (16, 12), 1, None), tool_z='back'),
        dict(arms_z='back', hands={'R': (11, 8)}, tool=(t, (10, 7), 0, None), tool_z='back',
             fx=fx(arc(9, 12, 14, -60, -30, 'Z', width=1))),
        dict(dy=1, legs='brace', hands={'R': (3, 14)}, tool=(t, (3, 14), 7, None), tool_z='back',
             fx=fx(arc(9, 12, 14, -150, -40, 'XZ'))),
        dict(dy=1, legs='brace', hands={'R': (1, 19)}, tool=(t, (1, 19), 6, None), tool_z='back',
             fx=fx(arc(9, 14, 14, -190, -130, 'ZX'))),
    ]
    right = [
        dict(hands={'S': (4, 19)}, tool=(t, (4, 19), 7, None), tool_z='back'),
        dict(hands={'S': (14, 18)}, tool=(t, (14, 18), 1, None), tool_z='front'),
        dict(dy=1, legs='lunge', hands={'S': (16, 18)}, tool=(t, (16, 18), 2, None), tool_z='front',
             fx=fx(arc(9, 18, 16, -80, 20, 'XZ'))),
        dict(dy=1, legs='lunge', hands={'S': (15, 22)}, tool=(t, (15, 22), 3, None), tool_z='front',
             fx=fx(arc(9, 18, 16, 0, 60, 'ZX'))),
    ]
    return down, up, right


def build(action_poses, body, dress=None):
    """
    Render keyframes into sheet rows in order south, north, west, east, for one grids.Body.
    dress: optional {'south'|'north'|'east': garment layer}; the west row mirrors the east row, garment included.
    """
    down, up, right = action_poses
    dress = dress or {}
    r = [pose_side(body, p, dress.get('east')) for p in right]
    return [[pose_front(body.front, p, dress.get('south')) for p in down], [pose_front(body.back, p, dress.get('north')) for p in up],
            [mirror_frame(f) for f in r], r]


CHIPS = [(3, 33, 'u'), (13, 32, 'H'), (2, 30, 'u'), (14, 29, 'u'), (15, 33, 'H'), (1, 32, 'H')]
DIRT = [(3, 33, 'J'), (13, 32, 'K'), (2, 31, 'J'), (14, 30, 'J'), (15, 33, 'K'), (1, 33, 'K')]
SPARK = [(3, 32, 'Y'), (13, 31, 'N'), (2, 30, 'N'), (14, 29, 'Y'), (15, 32, 'g'), (1, 33, 'g')]
ACTIONS = {
    'chop': lambda: overhead('axe', CHIPS),
    'dig': lambda: overhead('hoe', DIRT),
    'mine': lambda: overhead('pickaxe', SPARK),
    'sweep': scythe,
    'broom': broom,
    'water': water,
    'sword': sword,
}
