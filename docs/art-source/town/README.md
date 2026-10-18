# Town art source

`town.png` (1310x1201, about 16 px per tile for the 82x75 tile Town) is the picture that
`scripts/pack-town-art.py` cuts into the game's Town textures.

## Where it came from (2026-10 redraw)

The first Town was a soft, painterly picture (`redraw/painted-v1.png`). At game zoom it looked blurry, so it
was redrawn as crisp pixel art:

1. The painting was cut into four quarters with 96 px overlaps (`redraw/town-1..4-*.png`; the boxes are
   `BOXES` in `redraw/stitch.py`).
2. ChatGPT redrew each quarter with the prompts in `redraw/prompt-1..4.md` (same layout, no people or
   animals). Its answers are `redraw/q1..q4-*.webp`.
3. `redraw/stitch.py` lines each redraw up with its quarter (whole-image shift, block matching, an affine fit
   plus a smooth local correction), joins them along the lowest-difference seam in each overlap, and scales
   the result to 1310x1201. Every quarter lands within about a tenth of a tile of the painting's layout. It
   also paints out the one figure the redraw kept (`PATCHES`).

   ```
   python3 -I redraw/stitch.py OUT_DIR redraw redraw/q1-top-left.webp redraw/q2-top-right.webp \
       redraw/q3-bottom-left.webp redraw/q4-bottom-right.webp
   ```

   It writes `OUT_DIR/town-stitched.png`; copy that over `town.png`.

The redraw moved some trees, fences and lamps a little, so the walls (`TOWN_GRID`, `TOWN_WALL_EDITS`) and the
front pieces (`PIECES` in `scripts/pack-town-art.py`) are fitted to this picture, not to `painted-v1.png`.
