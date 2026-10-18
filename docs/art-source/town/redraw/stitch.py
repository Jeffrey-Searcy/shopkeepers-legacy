"""
Stitch the four ChatGPT pixel-art redraws of the Town back into the original painting's frame.

Each quarter (town-N-*.png here) was cut from the first painting, painted-v1.png (1310x1201), with 96 px overlaps, redrawn by ChatGPT at
about 1.86x, and came back slightly shifted and stretched. For each quarter this script:
  1. measures block-by-block where the redraw's content sits against the original quarter (gradient match), after a whole-image pre-shift,
  2. fits an affine map to the confident blocks and adds a smooth local correction from their leftovers,
  3. samples the full-size redraw through that map onto a 2x canvas in the original frame.
Then it joins the quarters along the lowest-difference seam inside each overlap (left|right first, then
top/bottom), paints out the few figures the redraw kept (PATCHES), and box-averages the 2x canvas down to
1310x1201.

usage: python3 -I stitch.py OUT_DIR ORIG_QUARTERS_DIR Q1 Q2 Q3 Q4
Writes OUT_DIR/town-stitched.png (1310x1201), OUT_DIR/town-stitched-2x.png and OUT_DIR/seams.png.
Fails loudly when a quarter matches too few blocks to fit.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

FULL = (1310, 1201)
# Quarter crop boxes in the original painting (same as the files sent to ChatGPT).
BOXES = [(0, 0, 703, 648), (607, 0, 1310, 648), (0, 552, 703, 1201), (607, 552, 1310, 1201)]
NAMES = ["town-1-top-left.png", "town-2-top-right.png", "town-3-bottom-left.png", "town-4-bottom-right.png"]
UP = 2          # work scale: 2 canvas px per original px
# Leftover figures the redraw kept, painted out on the 2x canvas after the join: (name, box x0, y0, x1, y1 in 2x
# canvas px, source shift dx, dy). Each box is overwritten by the canvas FEATHER-blended at its top and left edges
# from the box shifted by (dx, dy). why here and not as an Erase in pack-town-art.py: the pack's erase grows its
# hole by a soft edge about 0.27 tile wide, and the lamp post beside this figure stands 0.08 tile from it.
PATCHES = [
    ("west-road-sitter", (229, 1132, 270, 1204), (0, 66)),  # a figure on a chair by the west road's lamp
]
FEATHER = 3     # px of soft blend on a patch's top and left edges (its right and bottom meet like ground)
BS, R = 96, 24  # block size and search radius (original px) for the local match
CONFIDENT = 0.25


def grad(a: np.ndarray) -> np.ndarray:
    """Normalised edge strength of a grey image (so flat colour areas count for nothing)."""
    g = np.abs(np.diff(a, axis=1))[:-1] + np.abs(np.diff(a, axis=0))[:, :-1]
    return (g - g.mean()) / (g.std() + 1e-9)


def best_shift(A: np.ndarray, B: np.ndarray, rng: int, step: int) -> tuple[float, int, int]:
    """Whole-image shift (dx, dy) so that B[p + d] best matches A[p]."""
    H, W = A.shape
    best = (-9.0, 0, 0)
    for dy in range(-rng, rng + 1, step):
        for dx in range(-rng, rng + 1, step):
            a = A[max(0, -dy):H - max(0, dy), max(0, -dx):W - max(0, dx)]
            b = B[max(0, dy):max(0, dy) + a.shape[0], max(0, dx):max(0, dx) + a.shape[1]]
            s = float((a * b).mean())
            if s > best[0]:
                best = (s, dx, dy)
    return best


def block_shifts(A: np.ndarray, B: np.ndarray, pre: tuple[int, int]) -> np.ndarray:
    """Rows (cx, cy, dx, dy, score): B[p + d] matches A[p] for the block centred on (cx, cy); d includes pre."""
    H, W = A.shape
    rows = []
    for y in range(R, H - BS - R, BS // 2):
        for x in range(R, W - BS - R, BS // 2):
            a = A[y:y + BS, x:x + BS]
            best = (-1e9, 0, 0)
            for dy in range(-R, R + 1, 2):
                for dx in range(-R, R + 1, 2):
                    yy, xx = y + pre[1] + dy, x + pre[0] + dx
                    if yy < 0 or xx < 0 or yy + BS > B.shape[0] or xx + BS > B.shape[1]:
                        continue
                    s = float((a * B[yy:yy + BS, xx:xx + BS]).mean())
                    if s > best[0]:
                        best = (s, dx, dy)
            s, dx, dy = best
            fx, fy = dx, dy
            for ddy in (-1, 0, 1):
                for ddx in (-1, 0, 1):
                    yy, xx = y + pre[1] + dy + ddy, x + pre[0] + dx + ddx
                    if yy < 0 or xx < 0 or yy + BS > B.shape[0] or xx + BS > B.shape[1]:
                        continue
                    v = float((a * B[yy:yy + BS, xx:xx + BS]).mean())
                    if v > s:
                        s, fx, fy = v, dx + ddx, dy + ddy
            rows.append((x + BS / 2, y + BS / 2, fx + pre[0], fy + pre[1], s))
    return np.array(rows)


def displacement(rows: np.ndarray, size: tuple[int, int], label: str) -> tuple[np.ndarray, np.ndarray, str]:
    """
    Dense (dx, dy) over a quarter of size (w, h): affine fit of the confident blocks plus a smooth correction
    from their leftovers (gaussian-weighted, pulled to zero where blocks are sparse, so a wrong match far away
    cannot bend the image).
    """
    g = rows[rows[:, 4] > CONFIDENT]
    if len(g) < 20:
        raise RuntimeError(f"{label}: only {len(g)} confident blocks, cannot fit the warp")
    A = np.c_[g[:, 0], g[:, 1], np.ones(len(g))]
    cx, *_ = np.linalg.lstsq(A, g[:, 2], rcond=None)
    cy, *_ = np.linalg.lstsq(A, g[:, 3], rcond=None)
    rx, ry = g[:, 2] - A @ cx, g[:, 3] - A @ cy
    # why: a block whose leftover is huge is a redrawn object, not drift; leave it to the affine part.
    keep = np.hypot(rx, ry) < 12
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    num_x = np.zeros((h, w)); num_y = np.zeros((h, w)); den = np.full((h, w), 0.3)
    sig = 60.0
    for (px, py, ex, ey, s) in zip(g[keep, 0], g[keep, 1], rx[keep], ry[keep], g[keep, 4]):
        k = s * np.exp(-((xx - px) ** 2 + (yy - py) ** 2) / (2 * sig * sig))
        num_x += k * ex; num_y += k * ey; den += k
    dx = cx[0] * xx + cx[1] * yy + cx[2] + num_x / den
    dy = cy[0] * xx + cy[1] * yy + cy[2] + num_y / den
    res = np.hypot(rx, ry)[keep] / 16
    note = (f"{label}: {len(g)}/{len(rows)} confident, scale x {1 + cx[0]:.3f} y {1 + cy[1]:.3f}, "
            f"leftover tiles median {np.median(res):.2f} p90 {np.percentile(res, 90):.2f}, "
            f"{int((~keep).sum())} blocks ignored as redrawn")
    return dx, dy, note


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Sample an HxWx3 float image at float coordinates (clamped at the border)."""
    H, W = img.shape[:2]
    # why: a redraw that came back shrunk ends short of the map edge; mirroring repeats the edge forest's
    # texture, where clamping smeared the last pixel column into stripes.
    x = np.abs(x); y = np.abs(y)
    x = np.where(x > W - 1.001, 2 * (W - 1.001) - x, x); y = np.where(y > H - 1.001, 2 * (H - 1.001) - y, y)
    x = np.clip(x, 0, W - 1.001); y = np.clip(y, 0, H - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    a = img[y0, x0]; b = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def warp_quarter(orig: Image.Image, new: Image.Image, label: str) -> tuple[np.ndarray, str]:
    """The redraw resampled into the original quarter's frame at UP x scale (float RGB)."""
    ow, oh = orig.size
    sx, sy = new.width / ow, new.height / oh
    A = grad(np.asarray(orig.convert("L"), np.float64))
    B = grad(np.asarray(new.convert("L").resize(orig.size, Image.Resampling.LANCZOS), np.float64))
    _, px, py = best_shift(A, B, 60, 2)
    rows = block_shifts(A, B, (px, py))
    dx, dy, note = displacement(rows, orig.size, label)
    # Upsample the displacement to the work grid, then map to the redraw's own pixels.
    uh, uw = oh * UP, ow * UP
    gy, gx = np.mgrid[0:uh, 0:uw].astype(np.float64)
    ox, oy = (gx + 0.5) / UP - 0.5, (gy + 0.5) / UP - 0.5
    ix = np.clip(np.round(ox).astype(int), 0, ow - 1); iy = np.clip(np.round(oy).astype(int), 0, oh - 1)
    src_x = (ox + dx[iy, ix] + 0.5) * sx - 0.5
    src_y = (oy + dy[iy, ix] + 0.5) * sy - 0.5
    # How far (original px) the map runs past the redraw on each side; only map-edge sides matter.
    over = (max(0.0, -src_x.min()) / sx, max(0.0, src_x.max() - new.width + 1) / sx,
            max(0.0, -src_y.min()) / sy, max(0.0, src_y.max() - new.height + 1) / sy)
    note += ", past the redraw L/R/T/B px " + "/".join(f"{v:.0f}" for v in over)
    return bilinear(np.asarray(new.convert("RGB"), np.float64), src_x, src_y), note + f", pre-shift ({px},{py})"


def seam_cut(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    For two same-size HxWx3 images overlapping left|right, the column index per row of the lowest-difference
    top-to-bottom path (dynamic programming). Pixels left of it come from a, the rest from b.
    """
    cost = np.abs(a - b).sum(-1)
    H, W = cost.shape
    # why: keep the seam away from the very edge of the overlap, where one quarter may run out of picture.
    cost[:, :8] += 1e4; cost[:, -8:] += 1e4
    acc = cost.copy(); back = np.zeros((H, W), int)
    for y in range(1, H):
        prev = acc[y - 1]
        left = np.r_[np.inf, prev[:-1]]; right = np.r_[prev[1:], np.inf]
        stack = np.vstack([left, prev, right])
        k = stack.argmin(0)
        acc[y] += stack[k, np.arange(W)]
        back[y] = np.arange(W) + k - 1
    path = np.zeros(H, int); path[-1] = int(acc[-1].argmin())
    for y in range(H - 1, 0, -1):
        path[y - 1] = back[y, path[y]]
    return path


def join_lr(L: np.ndarray, Rt: np.ndarray, x0: int, x1: int) -> tuple[np.ndarray, np.ndarray]:
    """Join two canvases side by side; L covers [0, x1), Rt covers [x0, ...). Returns image and seam mask."""
    H = L.shape[0]
    W = x0 + Rt.shape[1]
    out = np.zeros((H, W, 3)); out[:, :x0] = L[:, :x0]; out[:, x1:] = Rt[:, x1 - x0:]
    path = seam_cut(L[:, x0:x1], Rt[:, :x1 - x0])
    cols = np.arange(x1 - x0)[None, :]
    take_l = cols < path[:, None]
    out[:, x0:x1] = np.where(take_l[..., None], L[:, x0:x1], Rt[:, :x1 - x0])
    mask = np.zeros((H, W), bool); mask[np.arange(H), x0 + path] = True
    return out, mask


def paint_out(full: np.ndarray) -> None:
    """
    Paint the PATCHES out of the joined 2x canvas (H x W x 3 float, edited in place) by copying the ground from
    each box's shifted twin. The copy fades in over FEATHER px at the box's top and left edges.
    Fails when a source box leaves the canvas.
    """
    H, W = full.shape[:2]
    for name, (x0, y0, x1, y1), (dx, dy) in PATCHES:
        if not (0 <= x0 + dx and x1 + dx <= W and 0 <= y0 + dy and y1 + dy <= H):
            raise RuntimeError(f"patch {name}: source box leaves the canvas")
        src = full[y0 + dy:y1 + dy, x0 + dx:x1 + dx].copy()
        ramp_y = np.clip((np.arange(y1 - y0) + 1) / (FEATHER + 1), 0, 1)[:, None]
        ramp_x = np.clip((np.arange(x1 - x0) + 1) / (FEATHER + 1), 0, 1)[None, :]
        w = (ramp_y * ramp_x)[..., None]
        full[y0:y1, x0:x1] = full[y0:y1, x0:x1] * (1 - w) + src * w


def main() -> None:
    out_dir, qdir = Path(sys.argv[1]), Path(sys.argv[2])
    news = [Image.open(p).convert("RGB") for p in sys.argv[3:7]]
    warped = []
    for i, (box, name, new) in enumerate(zip(BOXES, NAMES, news), 1):
        orig = Image.open(qdir / name).convert("RGB")
        if orig.size != (box[2] - box[0], box[3] - box[1]):
            raise RuntimeError(f"{name} is {orig.size}, expected box {box}")
        w, note = warp_quarter(orig, new, f"q{i}")
        print(note, flush=True)
        warped.append(w)
    U = UP
    top, m_top = join_lr(warped[0], warped[1], 607 * U, 703 * U)
    bot, m_bot = join_lr(warped[2], warped[3], 607 * U, 703 * U)
    # Top/bottom: same seam search on the transposed images.
    full_t, m_mid = join_lr(top.transpose(1, 0, 2), bot.transpose(1, 0, 2), 552 * U, 648 * U)
    full = full_t.transpose(1, 0, 2)
    if full.shape[:2] != (FULL[1] * U, FULL[0] * U):
        raise RuntimeError(f"stitched size {full.shape[:2]} != {(FULL[1] * U, FULL[0] * U)}")
    paint_out(full)
    img = Image.fromarray(np.clip(full, 0, 255).round().astype(np.uint8))
    img.save(out_dir / "town-stitched-2x.png")
    img.resize(FULL, Image.Resampling.BOX).save(out_dir / "town-stitched.png")
    seams = np.asarray(img).copy()
    mask = np.zeros(full.shape[:2], bool)
    mask[:648 * U, :] |= m_top[:648 * U]
    mask[552 * U:, :] |= m_bot[:FULL[1] * U - 552 * U]
    mask |= m_mid.T
    seams[mask] = (255, 0, 255)
    Image.fromarray(seams).save(out_dir / "seams.png")


if __name__ == "__main__":
    main()
