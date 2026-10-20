# PixelLab Guide — understand the product before using it

> **Retired.** PixelLab is no longer used for new art (as of September 2026). Some early PixelLab
> sprites remain in the game. Kept for history. For current art, see `docs/handbook/ART_WORKFLOW.md`.

> The video creator explicitly told the model to "understand this product before it goes out
> there and tries to use it, so we get the best possible use for every token." This doc is that.
> **Before your first generation, fetch and read `https://api.pixellab.ai/mcp/docs`** for the
> authoritative, current tool schemas — treat this file as orientation, the live docs as truth.

## What PixelLab is
An AI pixel-art generator exposed to Claude Code as an **MCP server** (registered here as
`pixellab`). You call its tools to generate game-ready pixel art; it returns **transparent PNGs**.
It is credit-metered per generation, so generate deliberately (style-test before batch).

## Connection (done once, in Phase A — see project README / plan)
Registered as an HTTP MCP server with a Bearer token:
```
claude mcp add pixellab https://api.pixellab.ai/mcp -t http -H "Authorization: Bearer <TOKEN>"
```
Token comes from signing in at `https://api.pixellab.ai/mcp`. Verify with `claude mcp list`
(look for `pixellab ✔ Connected`). The paid tier had a priority queue for faster/parallel
generation. Reference: the creator used only ~156 of 5,000 credits for a whole game, so there is
lots of headroom for this project.

## The tools (confirm exact names/params against the live docs before calling)
1. **create_character** — a pixel-art character with **4- or 8-directional** views. Use for the
   farmer (and later NPCs). Feed it the canonical style stem + subject from `docs/ART_BIBLE.md`.
2. **animate_character** — add animations (walk, run, idle, etc.) to an existing character. Use to
   produce the farmer's walk cycle per direction. (The creator's agent even queried PixelLab's
   own agent for its list of ~49 humanoid animations — you can ask the docs/agent what's available.)
3. **create_tileset** — a **seamless top-down (Wang) tileset** for terrain that tiles cleanly with
   transitions (grass↔dirt↔tilled↔water). Use for all ground terrain.
4. **create_isometric_tile** — individual isometric tiles. **Not used in V1** (we're top-down 3/4),
   listed for completeness.

(There may be additional object/animation tools exposed — check the live docs. For V1 objects like
trees/rocks/chests, use whatever the docs recommend for single transparent map objects.)

## The workflow (follow this order — it saves credits and prevents rework)
1. **Read the docs** at `https://api.pixellab.ai/mcp/docs`. Note each tool's required params
   (size, direction count, style controls) so you get it right the first time.
2. **Fix the style inputs** from `docs/ART_BIBLE.md`: 16px tiles, 32px characters, top-down 3/4,
   the warm palette, the canonical prompt stem. Do NOT vary these between calls.
3. **Style-test set first:** farmer + grass tileset (with dirt/tilled transitions) + one tree +
   one rock. Stop. Drop them into `public/assets/manifest.json`, run the game, and look at them
   together in-scene. Get the style approved before anything else.
4. **Batch the rest** only after the style is locked (see the V1 asset list in `docs/ART_BIBLE.md`).
   The Artisan tier's priority queue lets you fire multiple generations without waiting on each —
   batch related assets together.
5. **Look at every result.** Confirm sizing, seams, and grounded shadows. Regenerate anything that
   doesn't match rather than shipping a mismatch.

## How generated PNGs enter the game (the seam)
Game code never references a filename — only a **logical key** from `src/config/AssetKeys.ts`.
`public/assets/manifest.json` maps each key to its source. Bringing art in = **edit one manifest
entry + drop the PNG**; no game-logic changes (see `CLAUDE.md` Hard Rule 4).

- **Characters/animations:** assemble the returned directional frames into ONE spritesheet PNG per
  character (rows = down/up/left/right, cols = frames), saved to `public/assets/characters/`. Manifest
  entry: `{ "type": "spritesheet", "file": "characters/farmer.png", "frameWidth": 32, "frameHeight": 32 }`.
  Build named animations (`farmer-walk-down`, …) in `PreloadScene`.
- **Tilesets:** save the tileset PNG to `public/assets/tilesets/`, reference it from a Tiled `.tsj`,
  wire it into the `.tmj` maps. Phaser loads the PNG via `load.image` + `map.addTilesetImage(...)`.
- **Objects/UI:** individual PNGs by key in `public/assets/objects/` and `public/assets/ui/`
  (or a small packed atlas). Manifest entry: `{ "type": "image", "file": "objects/tree.png" }`.

## Credit discipline
- Style-test = a handful of generations; don't batch before it's approved.
- Reuse the exact same style stem and sizes so you don't regenerate a whole set to fix consistency.
- Animations cost more than single sprites — generate the walk cycle once, correctly.
- Track roughly how many credits you spend; there's ample headroom on the Artisan tier, but
  wasteful regeneration is the main risk.
