"""
Hand-drawn garments for the keeper bodies: aprons, a smith's leather apron, overalls, a vest, a guard tabard and a robe.

A garment is baked into the sheets (build_sheets.py), not drawn at runtime, because it must sit between the body
and the arms: a sleeve swinging across an apron has to stay on top of it. Each garment is a set of 18-cell ASCII rows
per facing (south = front, north = back, east = right side; west is the east frames mirrored), in body-grid cells.
The rows are drawn over the torso and thighs after the body layer, under the arms and the tool, and they follow the
body bob (dy) of every frame. '.' leaves a cell alone.

Colors: overalls use the trouser keys and the robe uses the shirt keys, so they follow the wearer's pants and shirt
colors. The other garments use their own fixed palette keys (palette.py: linen, leather, wool, tabard), which
the wardrobe never recolors.
A body may override a facing (BODY_OVERRIDES) where its collar differs.
"""
from compose import from_rows

GARMENTS = {
    'apron': {
        'south': (17, [
            "......i....i......",
            "......i....i......",
            ".....oixxjjio.....",
            ".....oxjjjjio.....",
            ".....oxjjjjio.....",
            ".....oxjjjjio.....",
            "....oixjjjjjio....",
            "....oxjjjjjjio....",
            "....oxjjjjjjio....",
            "....oxjjjjjjio....",
            "....oxjjjjjiio....",
            "....oooooooooo....",
        ]),
        'north': (17, [
            "......i....i......",
            "......i....i......",
            ".......i..i.......",
            ".......i..i.......",
            "........ii........",
            "........ii........",
            ".......ixxi.......",
        ]),
        'east': (19, [
            "............oxo...",
            "............oxo...",
            "............oxo...",
            "...........oixo...",
            "...........oxjo...",
            "...........oxjo...",
            "...........oxjo...",
            "...........oxjio..",
            "...........oxjio..",
            "...........ooooo..",
        ]),
    },
    'smith': {
        'south': (17, [
            "......6....6......",
            "......6....6......",
            ".....o7888876o....",
            ".....o788887o.....",
            ".....o78&&87o.....",
            ".....o788887o.....",
            "....o67888876o....",
            "....o78888876o....",
            "....o78788876o....",
            "....o78788876o....",
            "....o78888876o....",
            "....o77888776o....",
            "....oooooooooo....",
        ]),
        'north': (17, [
            "......6....6......",
            "......6....6......",
            ".......6..6.......",
            ".......6..6.......",
            "........66........",
            "........66........",
            "....o66666666o....",
        ]),
        'east': (19, [
            "............o8o...",
            "............o8o...",
            "............o8o...",
            "...........o78o...",
            "...........o87o...",
            "...........o87o...",
            "...........o876o..",
            "...........o876o..",
            "...........o876o..",
            "...........o776o..",
            "...........ooooo..",
        ]),
    },
    'overalls': {
        'south': (17, [
            ".....P......P.....",
            ".....P......P.....",
            ".....&oPPPPo&.....",
            ".....oQPPPPPo.....",
            ".....oQPppPPo.....",
            ".....oQPPPPpo.....",
            "....oPQPPPPPpo....",
        ]),
        'north': (17, [
            ".....P......P.....",
            "......P....P......",
            ".......P..P.......",
            "........PP........",
            ".......P..P.......",
            "......P....P......",
            "....oPPPPPPPPo....",
        ]),
        'east': (17, [
            "........P.........",
            ".........P........",
            "..........PP&.....",
            "..........oQPo....",
            "..........oQPo....",
            "..........oQpo....",
            "....oPPPPPPQPo....",
        ]),
    },
    'vest': {
        'south': (17, [
            "...o9O.....O9o....",
            "...o90O...O09o....",
            "....oO0o.o0O9o....",
            "....o90o.o0O9o....",
            "....oO0o.o0Oo.....",
            "....o90&.&0O9o....",
            "....oO0o.o0O9o....",
        ]),
        'north': (17, [
            "...o9OO000OO9o....",
            "....o9O000O99o....",
            "....oO000000Oo....",
            "....oO00000O9o....",
            "....oO00000O9o....",
            "....o9O000OO9o....",
            "....oO00000O9o....",
        ]),
        'east': (17, [
            "....o9O0O0o.......",
            "....o9O00O0o......",
            "....o9O000O0o.....",
            "....o9O000O0o.....",
            "....o9O000O0o.....",
            "....o9O000O&o.....",
            "....o9OO00O0o.....",
        ]),
    },
    'tabard': {
        'south': (17, [
            "....o%&&&&&&%o....",
            ".....o%$$$$%o.....",
            ".....o#$&&$#o.....",
            ".....o#&$$&#o.....",
            ".....o#$&&$#o.....",
            ".....o#$$$$#o.....",
            ".....o%&&&&%o.....",
            ".....o#$$$$#o.....",
            ".....o#$$$$#o.....",
            ".....o#$$$$!o.....",
            ".....o#$$$$!o.....",
            ".....o%&&&&%o.....",
            "......oooooo......",
        ]),
        'north': (17, [
            "....o%&&&&&&%o....",
            ".....o#$$$$#o.....",
            ".....o#$$$$#o.....",
            ".....o#$$$$#o.....",
            ".....o#$$$$#o.....",
            ".....o!#$$#!o.....",
            ".....o%&&&&%o.....",
            ".....o#$$$$#o.....",
            ".....o#$$$$#o.....",
            ".....o!$$$$!o.....",
            ".....o!#$$#!o.....",
            ".....o%&&&&%o.....",
            "......oooooo......",
        ]),
        'east': (17, [
            "....o%&&&&&%o.....",
            "....o$o...o$$o....",
            "....o#o...o$$o....",
            "....o#o...o&$o....",
            "....o#o...o$$o....",
            "....o#o...o$#o....",
            "....o%o...o&%o....",
            "....o#o...o$#o....",
            "....o#o...o$#o....",
            "....o!o...o$!o....",
            "....o!o...o#!o....",
            "....o%o...o&%o....",
            "....ooo...oooo....",
        ]),
    },
    'robe': {
        'south': (23, [
            "....okLLyyLLko....",
            "...onBCCDDCCBno...",
            "...onBCCDCCCBno...",
            "...onBCCDCCCBno...",
            "..onBBCCDCCCBBno..",
            "..onnBBCCCCBBnno..",
            "..oooooooooooooo..",
        ]),
        'north': (23, [
            "....okLLLLLLko....",
            "...onBCCCCCCBno...",
            "...onBCCCCCCBno...",
            "...onBCCCCCCBno...",
            "..onBBCCCCCCBBno..",
            "..onnBBCCCCBBnno..",
            "..oooooooooooooo..",
        ]),
        'east': (23, [
            "....okLLLLLLyo....",
            "...onBBCCCCCDo....",
            "...onBBCCCCCDDo...",
            "...onBBCCCCCCDo...",
            "..onBBBCCCCCCDDo..",
            "..onnBBBCCCCCDDo..",
            "..oooooooooooooo..",
        ]),
    },
}
BODY_OVERRIDES = {}  # {(garment, body, facing): (y0, rows)}


def layer(name, body, facing):
    """Garment cells for one body and facing ('south', 'north', 'east') as a body-grid layer; raises on a bad row."""
    y0, rows = BODY_OVERRIDES.get((name, body, facing), GARMENTS[name][facing])
    for r in rows:
        if len(r) != 18:
            raise ValueError(f'{name} {facing} row {r!r} is {len(r)} cells, expected 18')
    return from_rows(rows, y0=y0)


def dress(name, body):
    """The {'south','north','east': layer} dict that walk.all_rows and poses.build accept."""
    return {f: layer(name, body, f) for f in ('south', 'north', 'east')}
