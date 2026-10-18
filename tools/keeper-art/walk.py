"""
Build the keeper's 4-frame walk for every facing from the hand-drawn masters in grids.py.

Frame plan (frame 0 doubles as the idle pose, so it is the plain master):
  front/back: 0 stand | 1 right foot lifted, left arm forward | 2 contact, legs apart, body 1 px down | 3 mirror of 1
  side:       0 stand | 1 stride (near leg forward, arm back)   | 2 passing, near knee up, body 1 px up | 3 stride (near leg back, arm forward)
"""
from compose import from_rows, region, shift, drop_rows, dup_row, outlined, flatten, mirror

# Side-master cells of the near arm hanging at rest (rows 17..25), so a garment can be drawn under it on the stand frame.
SIDE_ARM_CELLS = [(x, y) for y, xs in ((17, (8, 9)), (18, (7, 8, 9, 10)), (19, (7, 8, 9, 10)), (20, (8, 9)),
                                       (21, (7, 8, 9, 10)), (22, (7, 8, 9, 10)), (23, (7, 8, 9, 10)),
                                       (24, (7, 8, 9, 10)), (25, (8, 9))) for x in xs]

def front_like(G, over=None):
    """
    Return 4 walk frames for a front-or-back master (both share limb columns).
    over: optional garment layer (body-grid cells) drawn on the torso, under the arms, following the body bob.
    """
    head_body = {**region(G, range(18), range(16)), **region(G, range(4, 14), range(16, 25))}
    arm_l = region(G, range(0, 4), range(16, 26))
    arm_r = region(G, range(14, 18), range(16, 26))
    leg_l = region(G, range(4, 9), range(25, 34))
    leg_r = region(G, range(9, 14), range(25, 34))

    def frame(dy=0, lift_l=0, lift_r=0, arm_up_l=0, arm_up_r=0, spread=0):
        legs = []
        for leg, lift, sx in ((leg_l, lift_l, -spread), (leg_r, lift_r, spread)):
            if dy == 1:
                leg = drop_rows(leg, [26], 'bottom')      # why: body sinks 1 px, so the thigh is 1 px shorter
            if lift:
                leg = drop_rows(leg, [27, 28][:lift], 'top')  # why: foot rises, hip stays put
            legs.append(shift(leg, dx=sx))
        arms = [shift(drop_rows(a, [19, 20][:k], 'top'), dy=dy) for a, k in ((arm_l, arm_up_l), (arm_r, arm_up_r))]
        dress = [shift(over, dy=dy)] if over else []
        return flatten(legs + [shift(head_body, dy=dy)] + dress + arms)

    return [
        frame(),
        frame(lift_r=2, arm_up_l=2, arm_up_r=1),
        frame(dy=1, spread=1),
        frame(lift_l=2, arm_up_r=2, arm_up_l=1),
    ]

# Side view (facing right): the torso without the near arm is Body.side_torso (grids.py); the arm is its own layer.
ARM_BACK = from_rows([
    "........CC........",
    ".......CDDC.......",
    "......CDDC........",
    ".....oDDCo........",
    "....ocbo..........",
    "...obao...........",
    "....oo............",
], y0=17)
ARM_FWD = from_rows([
    "........CC........",
    ".......CDDC.......",
    "........CDDC......",
    ".........CDDCo....",
    "..........oocbo...",
    "...........obao...",
    "............oo....",
], y0=17)
# Leg shapes use generic shade letters, then get the near (lighter) or far (darker) palette.
# x/y = trouser edge/centre, i/j/k = boot dark/mid/light.
NEAR = {'x': 'P', 'y': 'Q', 'i': 'v', 'j': 'V', 'k': 'W'}
FAR = {'x': 'p', 'y': 'P', 'i': 'v', 'j': 'v', 'k': 'V'}
LEG_BEHIND = [  # rows 26..32, for stride frames (body 1 px down)
    ".....xyx..........",
    ".....xyx..........",
    "....xyx...........",
    "....xyx...........",
    "...jkj............",
    "..jkkjj...........",
    "..ijjii...........",
]
LEG_AHEAD = [
    "........xyx.......",
    ".........xyx......",
    ".........xyx......",
    "..........xyx.....",
    "..........jkj.....",
    "..........jkkjj...",
    "..........ijjii...",
]
LEG_PLANTED = [  # rows 24..32, for the passing frame (body 1 px up)
    ".....xyx..........",
    ".....xyx..........",
    ".....xyx..........",
    ".....xyx..........",
    ".....xyx..........",
    ".....xyx..........",
    ".....jkj..........",
    ".....jkkjj........",
    ".....ijjii........",
]
LEG_LIFTED = [  # rows 24..30: knee forward, foot 2 px off the ground
    "........xyx.......",
    ".........xyx......",
    "..........xyx.....",
    ".........xyx......",
    ".........jkj......",
    ".........jkkjj....",
    ".........ijjii....",
]
ARM_MID = from_rows([  # arm hanging straight, as in the stand master
    "........CC........",
    ".......CDDC.......",
    ".......CDDC.......",
    "........CC........",
    ".......ocbo.......",
    ".......ocbo.......",
    ".......obao.......",
    "........oo........",
], y0=17)

def leg(rows, y0, pal):
    """Paint a generic leg shape with the near or far palette and give it an outline."""
    return outlined(from_rows([''.join(pal.get(c, c) for c in r) for r in rows], y0=y0))

def side_right(body, over=None):
    """Return 4 walk frames facing right for one grids.Body; over is an optional garment layer (see front_like)."""
    S = body.side
    upper = {**region(S, range(18), range(16)), **from_rows(body.side_torso, y0=16)}

    def frame(dy, far, near, arm):
        dress = [shift(over, dy=dy)] if over else []
        return flatten([far, near, shift(upper, dy=dy)] + dress + [shift(arm, dy=dy)])

    stand = [region(S, range(18), range(34))]
    if over:
        # why: the stand frame is the master itself, whose near arm is part of the torso; redraw that arm over the garment
        stand += [over, {(x, y): S[y][x] for x, y in SIDE_ARM_CELLS}]
    return [
        flatten(stand),
        frame(1, leg(LEG_BEHIND, 26, FAR), leg(LEG_AHEAD, 26, NEAR), ARM_BACK),
        frame(-1, leg(LEG_PLANTED, 24, FAR), leg(LEG_LIFTED, 24, NEAR), ARM_MID),
        frame(1, leg(LEG_AHEAD, 26, FAR), leg(LEG_BEHIND, 26, NEAR), ARM_FWD),
    ]

def all_rows(body, dress=None):
    """
    Rows in sheet order: south (down), north (up), west (left), east (right), for one grids.Body.
    dress: optional {'south'|'north'|'east': garment layer}; west is the east frames mirrored, garment included.
    """
    dress = dress or {}
    right = side_right(body, dress.get('east'))
    return [front_like(body.front, dress.get('south')), front_like(body.back, dress.get('north')),
            [mirror(f) for f in right], right]
