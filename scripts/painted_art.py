#!/usr/bin/env python3
"""
painted_art — shared tools for the painted-room art packers (scripts/pack-*-art.py).

Every painted area of the game starts as one painting (a ChatGPT repaint of a game screenshot) and
is turned into game textures by its own pack script. The steps those scripts share live here:

  * fill()            -> rebuild a covered part of the painting (a baked-in hero, hotbar or HUD).
                         An exact "membrane" (the smoothest surface that matches the painted pixels all
                         around the hole; a Laplace solve done with a sine transform) gives the colour,
                         and the fine texture (the source minus its blur) is copied from nearby. So the
                         fill has the right light and grain and no seams. Nothing is invented.
  * sharpen()         -> a mild unsharp mask. The paintings are soft "fake pixel art"; the game draws
                         them with nearest filtering at 3 screen pixels per texel, so crisp texel edges
                         matter (a playtester called the soft version "blurry... low resolution").
  * swirl_frames()    -> a looping portal swirl: a two-arm spiral that turns, coloured with the
                         painting's own portal colours, drawn into a box of the painting.
  * waterfall_frames()-> a looping fall: bright streaks slide down the painted water (or toxic waste,
                         or lava), so the painted colours stay and only the light moves.
  * pool_frames()     -> a looping shimmer on still liquid: the painted pixels sway a little sideways
                         and soft highlights drift across.
  * clean_mask()      -> tidies a colour-picked liquid mask (no lone specks, no pinholes).
  * save_sheet()      -> writes frames as one spritesheet PNG (Phaser 'spritesheet' type), in rows when wide.

Every animation frame is a box of the room texture with alpha: clear where the painting shows
through, opaque where the liquid is redrawn. Frames must loop: frame N wraps to frame 0 smoothly.

Needs: numpy, Pillow.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Box = tuple[int, int, int, int]
# One texture source for part of a hole: (x_from, x_to, y_from, y_to, dx, dy) -> copy grain from (x+dx, y+dy).
Part = tuple[int, int, int, int, int, int]


# --------------------------------------------------------------------------------------------------
# Rebuilding covered areas
# --------------------------------------------------------------------------------------------------

def _dst1(x: np.ndarray, axis: int) -> np.ndarray:
    """DST-I (discrete sine transform, type 1) of x along one axis, through an odd-extension FFT."""
    x = np.moveaxis(x, axis, 0)
    n = x.shape[0]
    zero = np.zeros((1,) + x.shape[1:], x.dtype)
    extended = np.concatenate([zero, x, zero, -x[::-1]], axis=0)
    out = -np.imag(np.fft.fft(extended, axis=0)[1:n + 1]) / 2
    return np.moveaxis(out, 0, axis)


def _laplace_fill(border: np.ndarray, box: Box) -> np.ndarray:
    """
    The smoothest surface inside box whose edge matches border's pixels just outside box.
    border: HxWx3 float image; box: (x0, y0, x1, y1) with a 1 px ring inside the image.
    Returns the (y1-y0)x(x1-x0)x3 interior. Solved exactly: Laplace(u) = 0 with those edge values.
    """
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    rhs = np.zeros((h, w, 3))
    rhs[0] += border[y0 - 1, x0:x1]
    rhs[-1] += border[y1, x0:x1]
    rhs[:, 0] += border[y0:y1, x0 - 1]
    rhs[:, -1] += border[y0:y1, x1]
    j = np.arange(1, h + 1)[:, None]
    k = np.arange(1, w + 1)[None, :]
    eigen = 4 - 2 * np.cos(np.pi * j / (h + 1)) - 2 * np.cos(np.pi * k / (w + 1))
    out = np.empty((h, w, 3))
    for c in range(3):
        spectrum = _dst1(_dst1(rhs[..., c], 0), 1) / eigen
        out[..., c] = _dst1(_dst1(spectrum, 0), 1) * (2 / (h + 1)) * (2 / (w + 1))
    return out


def membrane(img: np.ndarray, box: Box, open_bottom: bool) -> np.ndarray:
    """
    Smooth colour for the hole box in img. open_bottom: the hole runs off the bottom of the useful art,
    so the bottom edge gets no colour from below (mirroring the hole makes that edge a free one).
    """
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    if not open_bottom:
        return _laplace_fill(img, box)
    mirrored = np.zeros((2 * h + 2, w + 2, 3))
    mirrored[0] = img[y0 - 1, x0 - 1:x1 + 1]
    mirrored[1:h + 1, 0] = img[y0:y1, x0 - 1]
    mirrored[1:h + 1, -1] = img[y0:y1, x1]
    mirrored[h + 1:2 * h + 1] = mirrored[h:0:-1]
    mirrored[2 * h + 1] = mirrored[0]
    return _laplace_fill(mirrored, (1, 1, w + 1, 2 * h + 1))[:h]


def gaussian_blur(x: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur of an HxWxC float array, with edge padding."""
    r = int(3 * sigma)
    kernel = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * sigma * sigma))
    kernel /= kernel.sum()
    padded = np.pad(x, ((r, r), (r, r), (0, 0)), mode="edge")
    rows = np.apply_along_axis(lambda v: np.convolve(v, kernel, "valid"), 0, padded)
    return np.apply_along_axis(lambda v: np.convolve(v, kernel, "valid"), 1, rows)


def fill(img: np.ndarray, box: Box, parts: list[Part], open_bottom: bool = False, sigma: float = 6) -> None:
    """
    Rebuild img[box] in place: membrane colour plus fine texture copied from the offsets in parts.
    parts must cover the whole box. The texture fades out over 4 px at each closed edge, so the
    rebuilt area meets the painting without a line.
    """
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    pad = 20
    grain = np.zeros((h + 2 * pad, w + 2 * pad, 3))
    covered = np.zeros((h, w), bool)
    for xa, xb, ya, yb, dx, dy in parts:
        sample = img[ya - pad + dy:yb + pad + dy, xa - pad + dx:xb + pad + dx]
        detail = sample - gaussian_blur(sample, sigma)
        grain[ya - y0 + pad:yb - y0 + pad, xa - x0 + pad:xb - x0 + pad] = detail[pad:-pad, pad:-pad]
        covered[ya - y0:yb - y0, xa - x0:xb - x0] = True
    if not covered.all():
        raise RuntimeError(f"painted_art.fill: texture parts do not cover the hole {box}")
    smooth = membrane(img, box, open_bottom)
    yy, xx = np.mgrid[0:h, 0:w]
    edges = [yy + 1, xx + 1, w - xx] + ([] if open_bottom else [h - yy])
    fade = np.clip(np.minimum.reduce(edges).astype(float) / 4, 0, 1)[..., None]
    img[y0:y1, x0:x1] = smooth + grain[pad:-pad, pad:-pad] * fade


# --------------------------------------------------------------------------------------------------
# Crisp texels
# --------------------------------------------------------------------------------------------------

def sharpen(room: Image.Image) -> Image.Image:
    """
    Mild unsharp mask for a packed room texture (RGB). why: the game shows each texel as a 3x3 block
    of screen pixels with nearest filtering; without this the soft painting still reads as blurry.
    """
    return room.filter(ImageFilter.UnsharpMask(radius=1.5, percent=90, threshold=1))


# --------------------------------------------------------------------------------------------------
# Loop helpers
# --------------------------------------------------------------------------------------------------

def _rgba(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Join an HxWx3 float colour array and an HxW alpha (0..1) into uint8 RGBA."""
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255)
    out[..., 3] = np.clip(np.rint(alpha * 255), 0, 255)
    return out


def _palette(pixels: np.ndarray, count: int, seed: int) -> np.ndarray:
    """
    The `count` main colours of an Nx3 float pixel list (plain k-means, fixed seed so builds repeat).
    Returns a count x 3 array sorted dark to light.
    """
    if len(pixels) < count:
        raise RuntimeError(f"painted_art._palette: {len(pixels)} pixels cannot give {count} colours")
    rng = np.random.default_rng(seed)
    centres = pixels[rng.choice(len(pixels), count, replace=False)]
    for _ in range(25):
        nearest = np.argmin(((pixels[:, None] - centres[None]) ** 2).sum(-1), axis=1)
        for c in range(count):
            members = pixels[nearest == c]
            if len(members):
                centres[c] = members.mean(0)
    return centres[np.argsort(centres @ np.array([0.299, 0.587, 0.114]))]


def _snap(rgb: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """Replace each pixel of an HxWx3 array by its nearest palette colour (keeps the pixel-art look)."""
    flat = rgb.reshape(-1, 3)
    nearest = np.argmin(((flat[:, None] - palette[None]) ** 2).sum(-1), axis=1)
    return palette[nearest].reshape(rgb.shape)


def _blocky(field: np.ndarray, block: int) -> np.ndarray:
    """Hold a 2D field constant over block x block squares, so drawn shapes have the painting's chunky pixels."""
    h, w = field.shape
    small = field[block // 2::block, block // 2::block]
    return np.repeat(np.repeat(small, block, 0), block, 1)[:h, :w]


def _grow(mask: np.ndarray, k: int) -> np.ndarray:
    """Dilate a bool mask by a (2k+1) square; outside the mask counts as empty."""
    h, w = mask.shape
    padded = np.pad(mask, k)
    out = np.zeros_like(mask)
    for dy in range(2 * k + 1):
        for dx in range(2 * k + 1):
            out |= padded[dy:dy + h, dx:dx + w]
    return out


def clean_mask(mask: np.ndarray, k: int = 2) -> np.ndarray:
    """
    Open then close a colour-picked mask with a (2k+1) square: drops lone specks of liquid colour
    in the rock, then fills pinholes in the liquid, so the animation has no salt-and-pepper edges.
    """
    opened = _grow(~_grow(~mask, k), k)
    return ~_grow(~_grow(opened, k), k)


# --------------------------------------------------------------------------------------------------
# Animations
# --------------------------------------------------------------------------------------------------

def swirl_frames(room: Image.Image, box: Box, centre: tuple[float, float], radius: tuple[float, float],
                 frames: int, twist: float, spin: int, width: float = 0.55, opening: int = 7, block: int = 2,
                 stars: int = 9, seed: int = 7) -> list[np.ndarray]:
    """
    A turning two-arm spiral for a portal, drawn over box of room (texel coordinates).

    The painted spiral is wiped with a grey opening (a min filter then a max filter of size
    `opening`): thin bright arms vanish, while the panel's large shapes and their edges stay. That
    is the glowing background. New arms are drawn on it in the panel's light colours, and every
    pixel is snapped to the panel's own palette, so the result still reads as the painting. Two arms
    repeat every half turn, so frame k turns the spiral by pi * k / frames and the last frame flows
    back into the first.

    room: RGB texture; box: (x0, y0, x1, y1); centre: spiral centre in texels; radius: (rx, ry) of the
    spiral's outer edge (an ellipse, the panel is taller than wide); frames: loop length;
    twist: how tightly the arms wind (its sign sets the arms' handedness, match the painting);
    spin: +1 or -1, which way the arms turn (pick the one that draws the arms inwards);
    width: arm threshold on the wave, -1..1 (higher draws thinner arms);
    opening: filter size, a bit wider than a painted arm; block: texel size of one drawn pixel;
    stars: how many twinkling sparks; seed: star placement and palette start.
    Returns `frames` RGBA arrays of the box size, fully opaque (the whole box is redrawn).
    """
    if spin not in (1, -1):
        raise RuntimeError(f"painted_art.swirl_frames: spin must be 1 or -1, got {spin}")
    x0, y0 = box[0], box[1]
    panel_img = room.crop(box)
    panel = np.asarray(panel_img).astype(np.float64)
    h, w = panel.shape[:2]
    background = panel_img.filter(ImageFilter.MinFilter(opening)).filter(ImageFilter.MaxFilter(opening))
    # why: the square filters leave stair-step blocks in the soft glow; a small blur rounds them off.
    glow = gaussian_blur(np.asarray(background).astype(np.float64), 2)
    palette = _palette(panel.reshape(-1, 3), 12, seed)
    arm_colour, core_colour = palette[-2], palette[-1]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    dx = (xx + x0 - centre[0]) / radius[0]
    dy = (yy + y0 - centre[1]) / radius[1]
    rho = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)
    # why: arms fade out towards the edge and thin into the core, which gets its own bright spot.
    arm_reach = np.clip((1.1 - rho) / 0.4, 0, 1) * np.clip((rho - 0.05) / 0.1, 0, 1)
    core = np.clip(1.4 - rho / 0.1, 0, 1)
    rng = np.random.default_rng(seed)
    # why: sparks only inside the spiral's ellipse, never on the painted frame around the panel.
    inside = np.argwhere((rho[:h - block, :w - block] < 0.95) & (rho[:h - block, :w - block] > 0.2))
    if len(inside) < stars:
        raise RuntimeError(f"painted_art.swirl_frames: the spiral ellipse is too small for {stars} sparks")
    picks = inside[rng.choice(len(inside), stars, replace=False)]
    sparks = [(int(x), int(y), int(rng.integers(0, frames))) for y, x in picks]
    out = []
    for k in range(frames):
        phase = spin * np.pi * k / frames
        wave = np.cos(2 * (theta + phase) + twist * np.log(rho + 0.03))
        arm = _blocky(np.clip((wave - width) / 0.25, 0, 1) * arm_reach, block)
        colour = glow * (1 - arm[..., None]) + arm_colour * arm[..., None]
        colour = colour * (1 - core[..., None]) + core_colour * core[..., None]
        colour = _snap(colour, palette)
        for sx, sy, start in sparks:
            # why: each spark is lit for a third of the loop, starting at its own frame, so they twinkle out of step.
            if (k - start) % frames < frames // 3:
                colour[sy:sy + block, sx:sx + block] = core_colour
        out.append(_rgba(colour, np.ones((h, w))))
    return out


def waterfall_frames(room: Image.Image, box: Box, mask: np.ndarray, frames: int, period: int,
                     strength: float = 0.35, block: int = 2, seed: int = 3) -> list[np.ndarray]:
    """
    Falling streaks over a painted waterfall (water, toxic waste or lava).

    Each column of the fall gets bright streaks that move down `period` texels over the loop, so the
    loop is seamless. The painted colour stays; the streaks lighten it towards white by `strength`.
    room: RGB texture; box: (x0, y0, x1, y1); mask: HxW bool, True where the fall is (box size);
    frames: loop length; period: streak pattern height in texels (a multiple of frames moves evenly).
    Returns `frames` RGBA arrays of the box size, opaque only on the mask.
    """
    base = np.asarray(room.crop(box)).astype(np.float64)
    h, w = base.shape[:2]
    if mask.shape != (h, w):
        raise RuntimeError(f"painted_art.waterfall_frames: mask {mask.shape} does not match box {(h, w)}")
    rng = np.random.default_rng(seed)
    cols = (w + block - 1) // block
    # Per drawn column: streak offset and length, so neighbouring columns do not move as one sheet.
    offsets = rng.integers(0, period, cols)
    lengths = rng.integers(period // 5, period // 2, cols)
    out = []
    for k in range(frames):
        shift = period * k / frames
        light = np.zeros((h, w))
        for c in range(cols):
            pos = (np.arange(h) - shift - offsets[c]) % period
            streak = (pos < lengths[c]) * (1 - pos / lengths[c])
            light[:, c * block:(c + 1) * block] = np.round(streak * 3)[:, None] / 3
        light = _blocky(light, block)
        colour = base + (255 - base) * (light * strength)[..., None]
        out.append(_rgba(colour, mask.astype(np.float64)))
    return out


def pool_frames(room: Image.Image, box: Box, mask: np.ndarray, frames: int, sway: float = 1.5,
                strength: float = 0.18, block: int = 2, seed: int = 5) -> list[np.ndarray]:
    """
    A still-liquid shimmer (pools, toxic sludge, lava lakes).

    Rows of the painted liquid sway sideways by up to `sway` texels in a slow wave, and soft
    highlight bands drift diagonally; both run one full cycle over the loop. The wave and the bands
    are laid out in room texels, not box texels. why: a long liquid (a river) is cut into several
    boxes, and boxes made with the same seed then meet without a seam.
    room: RGB texture; box: (x0, y0, x1, y1); mask: HxW bool, True on the liquid (box size);
    frames: loop length; strength: how much the highlights lighten.
    Returns `frames` RGBA arrays of the box size, opaque only on the mask.
    """
    base = np.asarray(room.crop(box)).astype(np.float64)
    h, w = base.shape[:2]
    if mask.shape != (h, w):
        raise RuntimeError(f"painted_art.pool_frames: mask {mask.shape} does not match box {(h, w)}")
    rng = np.random.default_rng(seed)
    phase0 = rng.uniform(0, 2 * np.pi)
    yy, xx = np.mgrid[box[1]:box[1] + h, box[0]:box[0] + w].astype(np.float64)
    out = []
    for k in range(frames):
        t = 2 * np.pi * k / frames
        shift = np.rint(sway * np.sin(yy[:, 0] / 9 + t + phase0)).astype(int)
        swayed = base.copy()
        for row in range(h):
            # why: sample only liquid pixels, so the sway never pulls the painted rim into the pool.
            src = np.clip(np.arange(w) - shift[row], 0, w - 1)
            ok = mask[row, src]
            swayed[row, ok] = base[row, src[ok]]
        bands = np.sin((xx + yy * 0.6) / 7 - t) * np.sin((xx * 0.4 - yy) / 11 + t + phase0)
        light = _blocky(np.clip((bands - 0.55) / 0.45, 0, 1), block)
        colour = swayed + (255 - swayed) * (np.round(light * 2) / 2 * strength)[..., None]
        out.append(_rgba(colour, mask.astype(np.float64)))
    return out


def save_sheet(frames: list[np.ndarray], path: Path, columns: int | None = None) -> tuple[int, int]:
    """
    Write frames as one RGBA spritesheet: left to right, and in rows of `columns` frames when given
    (Phaser reads spritesheet frames row by row). why: wide boxes would pass the 4096 px texture limit
    in a single row. Fails when frames differ in size, when the frames do not fill whole rows (Phaser
    would add blank frames), or when the sheet is wider or taller than 4096 px.
    Returns (frameWidth, frameHeight) for the manifest entry.
    """
    if not frames:
        raise RuntimeError(f"painted_art.save_sheet: no frames for {path}")
    h, w = frames[0].shape[:2]
    if any(f.shape[:2] != (h, w) for f in frames):
        raise RuntimeError(f"painted_art.save_sheet: frames for {path} differ in size")
    per_row = len(frames) if columns is None else columns
    if per_row < 1 or len(frames) % per_row:
        raise RuntimeError(f"painted_art.save_sheet: {len(frames)} frames do not fill rows of {per_row} for {path}")
    rows = [np.concatenate(frames[i:i + per_row], axis=1) for i in range(0, len(frames), per_row)]
    sheet = np.concatenate(rows, axis=0)
    if sheet.shape[0] > 4096 or sheet.shape[1] > 4096:
        raise RuntimeError(f"painted_art.save_sheet: {path} would be {sheet.shape[1]}x{sheet.shape[0]}, over 4096 px")
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(path, optimize=True)
    return w, h
