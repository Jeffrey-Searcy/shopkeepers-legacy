# POLISH_SPEC — Prompt 2: make V1 feel like a real game

> V1 (M0–M8) proved the systems. This pass makes it *playable-nice*. Diagnosed by real testing:
> digit-key tool switching was broken (Phaser addKey('1') silently no-ops — seam tests masked it);
> FPS is fine (~72); the "runs bad" feel = fixed tiny canvas + bare map + zero feedback juice.

## Definition of Done (this pass)
1. Tools switch via **digit keys 1–6** (real keyboard), **clicking the hotbar**, and **mouse wheel**.
2. Game **fills the window** (Scale.FIT, centered, crisp pixels) instead of a fixed 960×540 box.
3. Terrain uses the **full 16-tile Wang autotiling** (dual-grid, corner-based) for grass↔dirt, plus a
   generated **water↔grass** tileset for lake/pond edges. No more flat single-tile ground.
4. The farm is a **designed map**: dirt path from the house to town, tree clumps, rock field, weeds,
   wavy lake edge + fishing pond, house with proper collision. Chopped nodes **stay gone** on
   re-entry (weeds regrow daily).
5. The town has **buildings** (general store + tavern facades) and **2 NPCs** (Rosa, Finn) who wander,
   pause when you approach, and **talk** (E) with rotating dialogue lines.
6. **Inventory panel** (I/Tab) with item icons + counts. **Hotbar shows tool icons**, not text.
7. **Feedback juice**: floating pickup toasts (+2 Wood), synthesized SFX (chop/mine/scythe/till/
   water/plant/harvest/stash/sleep/select/deny/talk), controls hint line.
8. **Y-depth sorting** — the player walks behind trees/buildings that are south of them, in front
   otherwise. Night overlay always above the world.
9. Tilled/watered soil uses generated soil-patch art (not flat brown squares).
10. All existing 20 specs stay green + new m9 specs (real-keyboard tools, inventory, dialogue) green.

## Non-goals (later prompts)
Tavern/shop interior loop (Prompt 3, on the M7 placement seam), mines/dungeon/beach, fishing,
music, save/load, title screen.

## Technique notes
- **Dual-grid autotiling:** render tile (vx,vy) in an offset (−8,−8) layer sized (w+1)×(h+1); its 4
  corners sample cells (vx−1,vy−1),(vx,vy−1),(vx−1,vy),(vx,vy). LUT from PixelLab tileset metadata
  corners (NW/NE/SW/SE, lower/upper) → frame index (row-major in the 4×4 sheet). Skip all-upper.
  Layers: grass base → dirt-transition → water-transition. Collision stays on the (now invisible)
  index layer — visuals change, physics doesn't, so all 20 specs stay green.
- **Water tileset chained** to the same grass base tile id (c588a420…) so edges match the dirt set.
- Keyboard: use Phaser KeyCode names ('ONE'…'SIX'); addCapture TAB/SPACE so the browser doesn't steal.
- SFX: pure WebAudio synth (no assets, ~150ms envelopes), lazily created on first input, disabled
  under ?test=1.
- Depth = sprite's world-space bottom edge; night overlay depth 1e6.
