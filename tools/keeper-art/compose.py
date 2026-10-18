"""
Paper-doll composer for the keeper's 1x pixel maps.

A frame is built from layers drawn bottom to top. Each layer is a sparse dict {(x, y): key} on an
18x34 cell grid. Limb layers can get an automatic 1 px outline (4-neighbour), so a near leg is
separated from a far leg by a dark line, the same way the hand-drawn masters separate parts.
"""
W, H = 18, 34
TOP = 2  # why: rows of headroom above the master, so a 1 px body bob up never clips the hair

def from_rows(rows, y0=0, x0=0):
    """Parse ASCII rows into a sparse layer; '.' is transparent. Rows start at y0 and x0."""
    out = {}
    for dy, r in enumerate(rows):
        for dx, ch in enumerate(r):
            if ch != '.':
                out[(x0 + dx, y0 + dy)] = ch
    return out

def region(grid, xs, ys):
    """Cut the cells of a master grid inside column range xs and row range ys into a layer."""
    return {(x, y): grid[y][x] for y in ys for x in xs if grid[y][x] != '.'}

def shift(layer, dx=0, dy=0):
    """Move a layer by whole pixels."""
    return {(x + dx, y + dy): c for (x, y), c in layer.items()}

def drop_rows(layer, rows, anchor='bottom'):
    """
    Remove whole rows from a layer and close the gap, to shorten a limb (foreshortening or a lifted foot).
    anchor='top' keeps the top fixed (an arm hangs from its shoulder); 'bottom' keeps the bottom fixed.
    """
    rows = sorted(rows)
    out = {}
    for (x, y), c in layer.items():
        if y in rows:
            continue
        if anchor == 'top':
            out[(x, y - sum(1 for r in rows if r < y))] = c
        else:
            out[(x, y + sum(1 for r in rows if r > y))] = c
    return out

def dup_row(layer, row):
    """Repeat one row (stretch a leg by 1 px); everything at or above that row moves up by one."""
    out = {}
    for (x, y), c in layer.items():
        if y <= row:
            out[(x, y - 1)] = c
        if y >= row:
            out[(x, y)] = c
    return out

def outlined(layer):
    """Add a 1 px 4-neighbour outline around a layer (outline pixels are drawn over lower layers)."""
    out = dict(layer)
    for (x, y) in layer:
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in layer:
                out[(nx, ny)] = 'o'
    return out

def flatten(layers):
    """Draw layers bottom to top into ASCII rows (TOP extra rows first); raises if anything falls off the 18x34 grid."""
    canvas = [['.'] * W for _ in range(H + TOP)]
    for layer in layers:
        for (x, y), c in layer.items():
            if not (0 <= x < W and -TOP <= y < H):
                raise ValueError(f'pixel {c!r} at {x},{y} is outside the {W}x{H} grid')
            canvas[y + TOP][x] = c
    return [''.join(r) for r in canvas]

def mirror(rows):
    """Flip a frame left-right (the left-facing walk is the right-facing walk mirrored)."""
    return [r[::-1] for r in rows]
