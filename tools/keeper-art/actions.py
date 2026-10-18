"""
Build the keeper's tool-action frames (chop, dig, mine, sweep/scythe, broom, water, sword).

Every frame is composed on the full 96x64 sheet cell, because tools reach outside the 18x34 body grid.
Body grid cell (x, y) lands on frame pixel (x + X0, y + Y0), which is the same placement the walk sheet uses,
so the feet stay on frame row 39 and an action never makes the keeper jump.

A pose is data: where the hands are, which way the tool points, the body bob, the legs, and any effect pixels.
Arms are drawn by code as short sleeve-to-hand strokes from the shoulder to the hand, so a pose only names
the hand position. The left-facing frames are the right-facing frames mirrored across the whole cell.
"""
from compose import region, shift, drop_rows, dup_row, outlined, from_rows
from walk import leg, NEAR, FAR, LEG_BEHIND, LEG_AHEAD, ARM_MID
from tools import tool_layer, sword_layer, can_layer

FW, FH = 96, 64
X0, Y0 = 39, 6

# Shoulders in body-grid cells: front/back left and right, side near shoulder.
SHOULDER = {'L': (2, 18), 'R': (15, 18), 'S': (8, 18)}


def to_frame(layer, dx=0, dy=0):
    """Move a body-grid layer into frame pixels, plus an extra whole-pixel offset."""
    return {(x + X0 + dx, y + Y0 + dy): c for (x, y), c in layer.items()}


def g(x, y):
    """Body-grid cell -> frame pixel (for hand and effect positions written in grid terms)."""
    return (x + X0, y + Y0)


def line(a, b):
    """Integer points from a to b inclusive (Bresenham)."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x1 > x0 else -1), (1 if y1 > y0 else -1)
    err, out = dx + dy, []
    while True:
        out.append((x0, y0))
        if (x0, y0) == (x1, y1):
            return out
        e2 = 2 * err
        if e2 >= dy:
            err += dy; x0 += sx
        if e2 <= dx:
            err += dx; y0 += sy


def arm(shoulder, hand):
    """
    A 2 px thick arm from shoulder to hand (both frame pixels): navy sleeve, then a short skin forearm end
    and a 2x2 hand, outlined. The hand's top-left pixel sits on `hand`.
    """
    pts = line(shoulder, hand)
    n = len(pts)
    cells = {}
    for i, (x, y) in enumerate(pts):
        skin = i >= n - 2
        for (ox, oy), (sleeve, flesh) in (((0, 0), ('D', 'c')), ((1, 0), ('C', 'c')),
                                          ((0, 1), ('C', 'b')), ((1, 1), ('B', 'b'))):
            cells[(x + ox, y + oy)] = flesh if skin else sleeve
    hx, hy = hand
    cells.update({(hx, hy): 'c', (hx + 1, hy): 'c', (hx, hy + 1): 'b', (hx + 1, hy + 1): 'a'})
    return outlined(cells)


def front_parts(G):
    """Split a front or back master into head+torso (no arms) and the two legs."""
    body = {**region(G, range(18), range(16)), **region(G, range(4, 14), range(16, 25))}
    arm_l = region(G, range(0, 4), range(16, 26))
    arm_r = region(G, range(14, 18), range(16, 26))
    leg_l = region(G, range(4, 9), range(25, 34))
    leg_r = region(G, range(9, 14), range(25, 34))
    return body, arm_l, arm_r, leg_l, leg_r


def front_legs(leg_l, leg_r, pose):
    """Front/back legs: 'stand', or 'brace' (body 1 px down, feet 1 px apart)."""
    if pose == 'stand':
        return [leg_l, leg_r]
    if pose == 'brace':
        return [shift(drop_rows(leg_l, [26], 'bottom'), dx=-1), shift(drop_rows(leg_r, [26], 'bottom'), dx=1)]
    raise ValueError(f'unknown front leg pose {pose!r}')


def side_legs(side, pose):
    """Side legs: 'stand' (rows 25..33 of the side master), 'lunge' (near leg forward, body 1 px down), 'rear' (near leg back)."""
    if pose == 'stand':
        return [region(side, range(18), range(25, 34))]
    if pose == 'lunge':
        return [leg(LEG_BEHIND, 26, FAR), leg(LEG_AHEAD, 26, NEAR)]
    if pose == 'rear':
        return [leg(LEG_AHEAD, 26, FAR), leg(LEG_BEHIND, 26, NEAR)]
    raise ValueError(f'unknown side leg pose {pose!r}')


def stretch(legs, dy):
    """When the body rises 1 px, repeat the thigh row so the legs still meet the belt (no gap at the waist)."""
    if dy == -1:
        return [dup_row(l, 27) for l in legs]
    if dy < -1:
        raise ValueError('the body may rise at most 1 px')
    return legs


def compose(layers):
    """Draw frame-pixel layers bottom to top into a 96x64 key grid; raises if a pixel leaves the cell."""
    canvas = [['.'] * FW for _ in range(FH)]
    for layer in layers:
        for (x, y), c in layer.items():
            if not (0 <= x < FW and 0 <= y < FH):
                raise ValueError(f'pixel {c!r} at {x},{y} is outside the {FW}x{FH} frame')
            canvas[y][x] = c
    return [''.join(r) for r in canvas]


def mirror_frame(rows):
    """Left-facing frame = right-facing frame flipped across the whole 96 px cell."""
    return [r[::-1] for r in rows]


def held(tool, grip, orient, handle=None):
    """Frame-pixel tool layer for any of the hand tools, the sword, or the can (orient = can tilt)."""
    if tool == 'sword':
        return sword_layer(grip, orient)
    if tool == 'can':
        return can_layer(grip, orient)
    return tool_layer(tool, grip, orient, handle)


def pose_front(G, p, over=None):
    """
    One front- or back-facing frame. over: optional garment layer (body-grid cells), drawn on the body under the arms.
    p keys: dy (body bob), legs, hands {'L': grid cell or None, 'R': ...}, tool (name, grip cell, orient, handle),
    tool_z ('back' behind the body, 'front' over the body, 'mid' over body but under arms), fx (frame layer).
    """
    body, arm_l, arm_r, leg_l, leg_r = front_parts(G)
    dy = p.get('dy', 0)
    layers = []
    tool = None
    if p.get('tool'):
        name, grip, orient, handle = p['tool']
        tool = held(name, g(grip[0], grip[1] + dy), orient, handle)
    if tool and p['tool_z'] == 'back':
        layers.append(tool)
    arms = []
    for side, hang in (('L', arm_l), ('R', arm_r)):
        hand = p['hands'].get(side)
        if hand is None:
            arms.append(to_frame(hang, dy=dy))
        else:
            sx, sy = SHOULDER[side]
            arms.append(arm(g(sx, sy + dy), g(hand[0], hand[1] + dy)))
    # why: arms raised over a chibi head would hide the face, so overhead poses tuck the arms behind the head
    behind = p.get('arms_z') == 'back'
    if behind:
        layers += arms
    layers += [to_frame(l) for l in stretch(front_legs(leg_l, leg_r, p.get('legs', 'stand')), dy)]
    layers.append(to_frame(body, dy=dy))
    if over:
        layers.append(to_frame(over, dy=dy))
    if tool and p['tool_z'] == 'mid':
        layers.append(tool)
    if not behind:
        layers += arms
    if tool and p['tool_z'] == 'front':
        layers.append(tool)
    if p.get('fx'):
        layers.append(p['fx'])
    return compose(layers)


def pose_side(body, p, over=None):
    """One right-facing frame for a grids.Body. Same keys as pose_front, with a single near hand under hands['S']."""
    S = body.side
    dy = p.get('dy', 0)
    upper = {**region(S, range(18), range(16)), **from_rows(body.side_torso, y0=16)}
    layers = []
    tool = None
    if p.get('tool'):
        name, grip, orient, handle = p['tool']
        tool = held(name, g(grip[0], grip[1] + dy), orient, handle)
    if tool and p['tool_z'] == 'back':
        layers.append(tool)
    hand = p['hands'].get('S')
    if hand is None:
        near = to_frame(ARM_MID, dy=dy)
    else:
        sx, sy = SHOULDER['S']
        near = arm(g(sx, sy + dy), g(hand[0], hand[1] + dy))
    behind = p.get('arms_z') == 'back'
    if behind:
        layers.append(near)
    layers += [to_frame(l) for l in stretch(side_legs(S, p.get('legs', 'stand')), dy)]
    layers.append(to_frame(upper, dy=dy))
    if over:
        layers.append(to_frame(over, dy=dy))
    if tool and p['tool_z'] == 'mid':
        layers.append(tool)
    if not behind:
        layers.append(near)
    if tool and p['tool_z'] == 'front':
        layers.append(tool)
    if p.get('fx'):
        layers.append(p['fx'])
    return compose(layers)


def fx(cells):
    """Effect pixels written in body-grid cells: [(x, y, key), ...] -> frame layer."""
    return {g(x, y): c for x, y, c in cells}
