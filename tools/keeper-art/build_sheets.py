"""
Export the keeper's game art: for each body (grids.BODIES), the walk sheet and one sheet per tool action; for each
garment (garments.GARMENTS), its diff image (one per body, or one shared file when the bodies match); the sheet
metadata; and the generated TypeScript module that the in-game wardrobe (AppearanceTextureSystem) reads.

Each sheet is 384x256 (4x4 frames of 96x64). Rows are south, north, west, east; feet stand on frame row 39.
Each sheet is checked before it is written:
- every frame holds a full-height figure (24 px or more),
- the navigation sheet keeps the feet within 1 px of row 39 in every frame,
- no frame in a row is a copy of another frame in that row (no faked frames),
- the head of every frame is found at a whole-pixel offset (dy) from its master, so the wardrobe can draw
  hats and hairstyles on the head without guessing from pixels at runtime.

A garment diff holds only the pixels that the garment changes, for all base sheets stacked top to bottom
(384 x 256*len(BASE_SHEETS)); every other pixel is clear. The wardrobe reads a diff pixel in place of the plain
sheet pixel. Each dressed sheet passes the same checks, keeps the plain head offsets, and never clears a pixel
that the plain sheet shows (a garment only covers or adds). When a garment's diffs are byte-identical for every
body (the bodies share the torso it covers), one shared file serves all bodies; otherwise each body gets its own
file. No two garment files are ever copies of each other.

Usage (from the repo root):
    python tools/keeper-art/build_sheets.py .
Writes:
    public/assets/characters/<sheet files>             (see OUT_NAMES)
    public/assets/characters/<garment diff files>      (see garment_textures)
    public/assets/characters/player-keeper-v5.metadata.json
    src/config/KeeperArt.generated.ts
"""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
import grids
import walk
from render import grid_img
from compose import TOP
from actions import FW, FH, X0, Y0
from poses import ACTIONS, build
from palette import PAL, MATERIALS
from overlays import OVERLAYS, HAT_PALETTES, facing_cells, crown_rows
import garments

FEET_ROW = 39
FACINGS = ['south', 'north', 'west', 'east']  # sheet row order
# Base sheet keys in load order. Animations are registered on these keys (the 'original' body's sheets), and the
# wardrobe swaps in the matching sheet of the chosen body (BODY_SHEETS) when it renders an outfit.
BASE_SHEETS = ['player-navigation', 'player-chop', 'player-dig', 'player-mine', 'player-sweep', 'player-broom',
               'player-water', 'player-sword']
# Body id -> base key -> texture key. The original body keeps the base keys; other bodies get their own prefix.
BODY_SHEETS = {
    'original': {k: k for k in BASE_SHEETS},
    'feminine': {k: k.replace('player-', 'player-f-', 1) for k in BASE_SHEETS},
}
# Texture key -> file name. The texture keys are the ones PreloadScene and the manifest use.
OUT_NAMES = {
    'player-navigation': 'player-navigation-v5.png',
    'player-chop': 'player-chop-v3.png', 'player-dig': 'player-dig-v3.png', 'player-mine': 'player-mine-v3.png',
    'player-sweep': 'player-sweep-v3.png', 'player-broom': 'player-broom-v1.png',
    'player-water': 'player-water-v3.png', 'player-sword': 'player-sword-v3.png',
    **{f: f'{f}-v1.png' for f in BODY_SHEETS['feminine'].values()},
}
# Texture key -> body id, for picking the right masters when the head offset is measured.
SHEET_BODY = {key: body for body, sheets in BODY_SHEETS.items() for key in sheets.values()}
# Action name in poses.ACTIONS -> texture key ('sweep' is the scythe; the broom has its own sheet).
ACTION_KEYS = {'chop': 'player-chop', 'dig': 'player-dig', 'mine': 'player-mine', 'sweep': 'player-sweep',
               'broom': 'player-broom', 'water': 'player-water', 'sword': 'player-sword'}
HEAD_ROWS = 16      # master rows 0..15 are the head
HEAD_MATCH = 0.6    # share of master head pixels that must match exactly at the chosen dy
HEAD_MARGIN = 0.3   # the chosen dy must beat every other dy by this share


def nav_frame(rows):
    """Place one 18x36 walk frame (TOP rows of headroom first) on a 96x64 cell, at the action-sheet body spot."""
    cell = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    cell.alpha_composite(grid_img(rows), (X0, Y0 - TOP))
    return cell


def sheet(frames, name, nav=False):
    """Paste a 4x4 list of 96x64 RGBA frames into one sheet, after checking each row; raises on any failed check."""
    out = Image.new('RGBA', (FW * 4, FH * 4), (0, 0, 0, 0))
    for r, row in enumerate(frames):
        if len(row) != 4:
            raise ValueError(f'{name} row {r} has {len(row)} frames, expected 4')
        seen = []
        for c, f in enumerate(row):
            a = np.array(f)
            ys = np.nonzero(a[:, :, 3])[0]
            if ys.size == 0 or ys.max() - ys.min() + 1 < 24:
                raise ValueError(f'{name} frame {r},{c} is not a full figure')
            body = np.nonzero(a[:, X0 - 2:X0 + 20, 3])[0]  # why: fx can fall below the feet; measure the body columns only
            if nav and abs(int(body.max()) - FEET_ROW) > 1:
                raise ValueError(f'{name} frame {r},{c} feet at row {body.max()}, expected {FEET_ROW}')
            for s, prev in enumerate(seen):
                if np.array_equal(prev, a):
                    raise ValueError(f'{name} frame {r},{c} duplicates frame {r},{s}')
            seen.append(a)
            out.alpha_composite(f, (c * FW, r * FH))
    return out


def head_dy(frame, body, facing, where):
    """
    Find how many whole pixels the head sits below (+) or above (-) its master position in one frame.
    Tries dy -2..2 and counts master head pixels whose exact color appears at the shifted spot.
    Raises if no offset reaches HEAD_MATCH, or if the runner-up is within HEAD_MARGIN (the head could not be placed).
    why: hands and tools can cover part of the head (a raised axe in the back view hides about 18%), so the rule
    asks for a clear winner rather than a near-perfect match.
    """
    a = np.array(frame)
    G = grids.BODIES[body].master(facing)
    cells = [(x, y, PAL[G[y][x]]) for y in range(HEAD_ROWS) for x in range(18) if G[y][x] != '.']
    scores = {}
    for dy in range(-2, 3):
        hit = 0
        for x, y, v in cells:
            px = a[y + Y0 + dy, x + X0]
            if px[3] and (int(px[0]) << 16 | int(px[1]) << 8 | int(px[2])) == v:
                hit += 1
        scores[dy] = hit / len(cells)
    best = max(scores, key=lambda d: scores[d])
    if scores[best] < HEAD_MATCH or scores[best] - sorted(scores.values())[-2] < HEAD_MARGIN:
        raise ValueError(f'{where}: head not found (match by dy: {scores})')
    return best


def body_frames(body, dress=None):
    """Build one body's 4x4 frames per base sheet: {base key: rows of PIL frames}; dress is an optional garment."""
    out = {'player-navigation': [[nav_frame(f) for f in row] for row in walk.all_rows(body, dress)]}
    for name, poses in ACTIONS.items():
        out[ACTION_KEYS[name]] = [[grid_img(f) for f in row] for row in build(poses(), body, dress)]
    if list(out) != BASE_SHEETS:
        raise ValueError(f'base sheets {list(out)} do not match BASE_SHEETS {BASE_SHEETS}')
    return out


def all_frames():
    """Build every body's sheets: {texture key: rows of PIL frames}, in OUT_NAMES order."""
    out = {}
    for body, sheets in BODY_SHEETS.items():
        for base, rows in body_frames(grids.BODIES[body]).items():
            out[sheets[base]] = rows
    if set(out) != set(OUT_NAMES):
        raise ValueError(f'sheet keys {sorted(out)} do not match OUT_NAMES {sorted(OUT_NAMES)}')
    return out


def garment_diff(plain, dressed, where):
    """
    Stack one body's plain and dressed sheets (dicts of base key -> 384x256 image, in BASE_SHEETS order) into a
    diff image: dressed pixels where they differ from plain, clear elsewhere. Raises if the garment clears a pixel
    that the plain sheet shows, because the wardrobe could not express that (it only replaces or adds pixels).
    """
    parts = []
    for key in BASE_SHEETS:
        p, d = np.array(plain[key]), np.array(dressed[key])
        cleared = (p[:, :, 3] > 0) & (d[:, :, 3] == 0)
        if cleared.any():
            y, x = np.argwhere(cleared)[0]
            raise ValueError(f'{where} {key}: the garment clears pixel {x},{y}')
        changed = (d != p).any(axis=2) & (d[:, :, 3] > 0)
        parts.append(np.where(changed[:, :, None], d, 0).astype(np.uint8))
    return Image.fromarray(np.concatenate(parts, axis=0), 'RGBA')


def garment_textures(diffs):
    """
    Name the garment diff textures and drop duplicate files.
    @param diffs garment id -> body id -> diff image (see garment_diff).
    @returns (keys, images): keys is garment id -> body id -> texture key; images is texture key -> the one image
      written for that key. A garment whose diffs are byte-identical for every body gets one shared texture
      'keeper-garment-<garment>'; otherwise each body gets 'keeper-garment-<body>-<garment>'.
    """
    keys, images = {}, {}
    for g, bodies in diffs.items():
        if set(bodies) != set(BODY_SHEETS):
            raise ValueError(f'garment {g} has diffs for {sorted(bodies)}, expected every body {sorted(BODY_SHEETS)}')
        first = np.array(next(iter(bodies.values())))
        # why: shipping two identical files would be a duplicated asset; one shared texture says the same thing
        if all(np.array_equal(first, np.array(img)) for img in bodies.values()):
            key = f'keeper-garment-{g}'
            keys[g] = {b: key for b in bodies}
            images[key] = next(iter(bodies.values()))
        else:
            keys[g] = {b: f'keeper-garment-{b}-{g}' for b in bodies}
            images.update({keys[g][b]: img for b, img in bodies.items()})
    return keys, images


def garment_files(keys):
    """Texture key -> file name for the garment textures named by garment_textures (keys: garment -> body -> key)."""
    return {k: f'{k}-v1.png' for bodies in keys.values() for k in dict.fromkeys(bodies.values())}


def ts_module(dys, gkeys):
    """
    Source text of src/config/KeeperArt.generated.ts (sheets, palette, masters, head offsets, overlays, garments).
    @param dys texture key -> per-frame head offsets.
    @param gkeys garment id -> body id -> diff texture key (from garment_textures).
    """
    def hexes(d):
        return '{ ' + ', '.join(f"'{k}': 0x{v:06x}" for k, v in d.items()) + ' }'

    def cell_list(cells):
        return '[' + ', '.join(f"[{x}, {y}, '{c}']" for (x, y), c in sorted(cells.items(), key=lambda t: (t[0][1], t[0][0]))) + ']'

    palette = {k: v for k, v in PAL.items() if v is not None}
    lines = [
        '/**',
        ' * GENERATED by tools/keeper-art/build_sheets.py. Do not edit by hand; change the Python source and rebuild.',
        ' *',
        " * The keeper's hand-authored pixel art, described for the wardrobe recolor (AppearanceTextureSystem):",
        ' * - KEEPER_PALETTE: one unique RGB per palette key, so every pixel of a sheet names its material exactly.',
        ' * - KEEPER_MATERIALS: which keys belong to hair, skin, shirt, and so on.',
        ' * - KEEPER_BODY_SHEETS: per body, the texture that replaces each base sheet (animations use the base keys).',
        ' * - KEEPER_MASTERS: per body, the 18x34 standing pixel maps per facing (west is east mirrored).',
        ' * - KEEPER_HEAD_DY: per sheet, per frame (row-major, rows south/north/west/east), the whole-pixel head offset',
        ' *   from the master position, measured when the sheets were built.',
        ' * - KEEPER_OVERLAYS: hairstyle, hat and facial-hair cells as [gridX, gridY, key] per body and facing.',
        ' * - KEEPER_GARMENTS: per garment and body, the diff texture whose clear pixels keep the plain sheet. Bodies',
        ' *   share one texture when the garment looks the same on each.',
        ' * A body-grid cell (x, y) sits at frame pixel (x + KEEPER_BODY_ORIGIN.x, y + KEEPER_BODY_ORIGIN.y + dy).',
        ' */',
        '',
        '/** Sheet texture keys in load order, each mapped to its file in public/assets/characters. */',
        'export const KEEPER_SHEET_FILES = {',
        *[f"  '{k}': '{v}'," for k, v in OUT_NAMES.items()],
        '} as const;',
        'export type KeeperSheet = keyof typeof KEEPER_SHEET_FILES;',
        '',
        '/** The original body\'s sheets; animations are registered on these keys. */',
        f'export const KEEPER_BASE_SHEETS = {json.dumps(BASE_SHEETS)} as const;',
        'export type KeeperBaseSheet = typeof KEEPER_BASE_SHEETS[number];',
        '',
        '/** Body ids, equal to the Appearance `body` options. */',
        f'export const KEEPER_BODIES = {json.dumps(list(BODY_SHEETS))} as const;',
        'export type KeeperBody = typeof KEEPER_BODIES[number];',
        '',
        '/** Body -> base sheet -> the texture the wardrobe renders from for that body. */',
        'export const KEEPER_BODY_SHEETS: Readonly<Record<KeeperBody, Readonly<Record<KeeperBaseSheet, KeeperSheet>>>> = {',
        *[f'  {b}: {{ ' + ', '.join(f"'{k}': '{v}'" for k, v in sheets.items()) + ' },' for b, sheets in BODY_SHEETS.items()],
        '};',
        '',
        '/** Sheet row order; frame n faces KEEPER_FACINGS[Math.floor(n / 4)]. */',
        "export const KEEPER_FACINGS = ['south', 'north', 'west', 'east'] as const;",
        'export type KeeperFacing = typeof KEEPER_FACINGS[number];',
        '',
        '/** Frame pixel of body-grid cell (0, 0) when the head offset is 0. */',
        f'export const KEEPER_BODY_ORIGIN = {{ x: {X0}, y: {Y0} }} as const;',
        '',
        '/** Palette key -> packed RGB. Every value is unique across the whole palette. */',
        f'export const KEEPER_PALETTE: Readonly<Record<string, number>> = {hexes(palette)};',
        '',
        '/** Material name -> palette keys, darkest first where the material is a shade ramp. */',
        'export const KEEPER_MATERIALS = {',
        *[f"  {k}: '{v}'," for k, v in MATERIALS.items()],
        '} as const;',
        '',
        '/** Standing 18x34 pixel maps per body; \'.\' is empty. The west map is the east map mirrored. */',
        'export const KEEPER_MASTERS: Readonly<Record<KeeperBody, Readonly<Record<KeeperFacing, readonly string[]>>>> = {',
        *[line for b in BODY_SHEETS for line in (
            f'  {b}: {{',
            *[f'    {f}: {json.dumps(grids.BODIES[b].master(f))},' for f in FACINGS],
            '  },')],
        '};',
        '',
        '/** Head offset (dy, in pixels) for each of the 16 frames of each sheet. */',
        'export const KEEPER_HEAD_DY: Readonly<Record<KeeperSheet, readonly number[]>> = {',
        *[f"  '{k}': {json.dumps(v)}," for k, v in dys.items()],
        '};',
        '',
        '/** Overlay cells per body and facing: [gridX, gridY, palette or hat key]. */',
        'export type KeeperOverlayCells = Readonly<Record<KeeperBody, Readonly<Record<KeeperFacing, ReadonlyArray<readonly [number, number, string]>>>>>;',
        '/**',
        ' * One overlay. Hair and face (facial hair) overlays use hair keys 1-5 and follow the hair color; hats use',
        ' * KEEPER_HAT_PALETTES. A hat hides hairstyle cells above its crown row (a hood hides them all).',
        ' */',
        "export type KeeperOverlay = { kind: 'hat'; crown: number; cells: KeeperOverlayCells } | { kind: 'hair' | 'face'; cells: KeeperOverlayCells };",
        '',
        '/** Wardrobe overlays by Appearance id (hairStyle, hat and facialHair options). */',
        'export const KEEPER_OVERLAYS: Readonly<Record<string, KeeperOverlay>> = {',
    ]
    for name, spec in OVERLAYS.items():
        crown = f', crown: {crown_rows(name)}' if spec['kind'] == 'hat' else ''
        lines.append(f"  {name}: {{ kind: '{spec['kind']}'{crown}, cells: {{")
        for b in BODY_SHEETS:
            lines.append(f'    {b}: {{')
            for f in FACINGS:
                lines.append(f'      {f}: {cell_list(facing_cells(name, f, b))},')
            lines.append('    },')
        lines.append('  } },')
    lines += [
        '};',
        '',
        '/** Fixed colors for each hat, by the keys its overlay cells use (outline \'o\' comes from KEEPER_PALETTE). */',
        'export const KEEPER_HAT_PALETTES: Readonly<Record<string, Readonly<Record<string, number>>>> = {',
        *[f'  {k}: {hexes(v)},' for k, v in HAT_PALETTES.items()],
        '};',
        '',
        '/** Garment diff texture keys, each mapped to its file in public/assets/characters. */',
        'export const KEEPER_GARMENT_FILES = {',
        *[f"  '{k}': '{v}'," for k, v in garment_files(gkeys).items()],
        '} as const;',
        'export type KeeperGarmentTexture = keyof typeof KEEPER_GARMENT_FILES;',
        '',
        '/**',
        ' * Garment id -> body -> diff texture. A diff is KEEPER_BASE_SHEETS stacked top to bottom (384 x 256 each);',
        ' * its opaque pixels replace the plain sheet pixels and its clear pixels keep them. Garment cloth in shirt',
        ' * keys follows the shirt color and in pants keys the pants color; other garment keys keep their colors.',
        ' */',
        'export const KEEPER_GARMENTS: Readonly<Record<string, Readonly<Record<KeeperBody, KeeperGarmentTexture>>>> = {',
        *[f'  {g}: {{ ' + ', '.join(f"{b}: '{k}'" for b, k in bodies.items()) + ' },' for g, bodies in gkeys.items()],
        '};',
        '',
    ]
    return '\n'.join(lines)


def metadata(gkeys):
    """
    The sheet layout record kept next to the PNGs, so the source of the art and its format stay documented.
    @param gkeys garment id -> body id -> diff texture key (from garment_textures).
    """
    return {
        'source': 'Hand-authored pixel art (tools/keeper-art), traced from the approved keeper poster',
        'frameWidth': FW, 'frameHeight': FH, 'columns': 4, 'rows': 4,
        'rowOrder': FACINGS, 'visibleFeetRow': FEET_ROW,
        'bodyOrigin': {'x': X0, 'y': Y0}, 'westIsMirroredEast': True,
        'sheets': OUT_NAMES, 'bodySheets': BODY_SHEETS,
        'garments': {'files': garment_files(gkeys), 'bodies': gkeys, 'layout': f'base sheets stacked top to bottom: {BASE_SHEETS}'},
        'animations': {'walk': {'fps': 8, 'frames': 4, 'idleFrame': 0}, 'actions': {'fps': 10, 'frames': 4, 'repeat': 0}},
    }


def main(repo):
    """Build, check and write every sheet, the metadata file and the generated TypeScript module under repo."""
    root = Path(repo)
    chars = root / 'public' / 'assets' / 'characters'
    config = root / 'src' / 'config'
    if not chars.is_dir() or not config.is_dir():
        raise SystemExit(f'{root} is not the Shopkeepers Legacy repo root')
    dys, plain = {}, {}
    for key, rows in all_frames().items():
        img = sheet(rows, key, nav=key == BODY_SHEETS[SHEET_BODY[key]]['player-navigation'])
        dys[key] = [head_dy(f, SHEET_BODY[key], FACINGS[r], f'{key} frame {r},{c}') for r, row in enumerate(rows) for c, f in enumerate(row)]
        plain[key] = img
        img.save(chars / OUT_NAMES[key])
    diffs = {}
    for g in garments.GARMENTS:
        diffs[g] = {}
        for b in BODY_SHEETS:
            gkey = f'{g} on {b}'
            dressed = {}
            for base, rows in body_frames(grids.BODIES[b], garments.dress(g, b)).items():
                key = BODY_SHEETS[b][base]
                dressed[base] = sheet(rows, f'{gkey} {base}', nav=base == 'player-navigation')
                got = [head_dy(f, b, FACINGS[r], f'{gkey} {base} frame {r},{c}') for r, row in enumerate(rows) for c, f in enumerate(row)]
                if got != dys[key]:
                    raise ValueError(f'{gkey} {base}: the garment moves the head offsets {dys[key]} -> {got}')
            diffs[g][b] = garment_diff({base: plain[BODY_SHEETS[b][base]] for base in BASE_SHEETS}, dressed, gkey)
    gkeys, gimages = garment_textures(diffs)
    gfiles = garment_files(gkeys)
    for key, img in gimages.items():
        img.save(chars / gfiles[key])
    (chars / 'player-keeper-v5.metadata.json').write_text(json.dumps(metadata(gkeys), indent=2) + '\n')
    (config / 'KeeperArt.generated.ts').write_text(ts_module(dys, gkeys))
    print('wrote', ', '.join([*OUT_NAMES.values(), *gfiles.values()]), '+ metadata + KeeperArt.generated.ts')
    for key, v in dys.items():
        print(f'  {key:18} head dy {v}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: build_sheets.py <repo root>')
    main(sys.argv[1])
