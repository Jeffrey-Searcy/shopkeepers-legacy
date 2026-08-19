# M8 Resume — PixelLab art pass (read this after restarting Claude Code)

## Why you're reading this
Milestones **M0–M7 are complete and verified** (20/20 Playwright tests green). The game is fully
playable with colored-placeholder art (`npm run dev`). Only **M8 (real PixelLab pixel art)** remains.

M8 was blocked because the `pixellab` MCP server was registered *after* the previous session
started, so its tools weren't loaded. **After restarting Claude Code in this project, the `pixellab`
tools should be available.** This note tells the new session exactly how to finish.

## First: confirm the tools loaded
- Run `claude mcp list` → `pixellab ✔ Connected`.
- Confirm the MCP tools are now callable (names like `create_character`, `animate_character`,
  `create_tileset`). If they still aren't present, the MCP didn't load — check `/mcp`.
- **Read `https://api.pixellab.ai/mcp/docs` FIRST** (per CLAUDE.md / PIXELLAB_GUIDE) to learn the
  exact tool params before spending credits.

## The art pipeline is already wired — you only need to generate + drop files
The code already supports real art with **zero logic changes** (the asset seam):
- **`public/assets/manifest.json`** maps each logical key to a placeholder OR a real file. To use
  real art: change an entry from `{"type":"placeholder",...}` to `{"type":"image","file":"..."}` or
  `{"type":"spritesheet","file":"...","frameWidth":N,"frameHeight":N}` and drop the PNG under
  `public/assets/<category>/`.
- **`src/scenes/PreloadScene.ts` → `buildPlayerAnimations()`** auto-registers the farmer's 4-direction
  walk anims IF the `player` texture is a real multi-frame spritesheet (row 0 down, 1 up, 2 left,
  3 right; equal columns = frames/direction). It's a no-op for the placeholder. Match that layout.
- **`src/entities/Player.ts` → `updateAnimation()`** plays `player-walk-<facing>` when those anims
  exist; no-op otherwise.
- Terrain currently renders from a baked placeholder tileset (`src/world/TerrainTileset.ts`). To use a
  real PixelLab tileset, either (a) swap the baked strip for a loaded tileset PNG indexed the same way
  (grass=0, dirt=1, water=2, floor=3), or (b) keep placeholders for ground and just add real
  object/character art first. Keep the GROUND_INDEX order stable.

## Order of work (follow ART_BIBLE.md + PIXELLAB_GUIDE.md)
1. **Style-test FIRST (don't batch yet).** Generate: farmer (4-dir walk), a grass/dirt/tilled tileset,
   one tree, one rock — using the canonical style stem in `docs/ART_BIBLE.md` (16px tiles, 32px
   character, top-down 3/4, warm palette). Save PNGs under `public/assets/{characters,tilesets,objects}/`.
2. **Wire the style-test into `manifest.json`** and run `npm run dev` (or a Playwright screenshot) to
   LOOK at them together in-scene. Confirm cohesion (readable farmer on grass, seamless tiles,
   grounded shadows). Get the designer's sign-off on the look before spending more credits.
3. **Batch the rest** only after style is locked: crop growth stages, more terrain transitions, weed,
   chest, bed, house, UI icons (see the V1 asset list in ART_BIBLE).
4. **Swap manifest entries** placeholder→real for each, drop PNGs.
5. **Verify:** re-run `npx playwright test` — ALL 20 logic specs must stay green (art must not change
   geometry). Then add screenshot baselines for art-overlap checks. Fix sizing in `manifest.json`/
   `GameConfig` if anything overlaps or floats — never let art dimensions drive collision.

## Credit discipline
PixelLab is credit-metered. The reference build used ~156/5,000 credits total. Style-test = a handful
of calls; never batch before the style is approved; reuse the exact same style stem so you don't
regenerate the whole set to fix consistency.

## Current test status (baseline to preserve)
`npx playwright test` → **20 passed**. Files: m0-boot, m1-camera-movement (3), m2-scene-transition (2),
m3-tools (3), m4-farming (2), m5-inventory-chest (2), m6-time (4), m7-placement (3). The 4 regression
gates (transition, camera, map-bounds, placement) must never regress.

## Notes
- Dev server runs on **port 5273** (5173 is taken by a Docker container on this machine).
- Test mode uses the Canvas renderer (`?test=1`); normal play uses WebGL.
- SECURITY: the PixelLab token printed once in a prior transcript — consider rotating it in the
  PixelLab dashboard. It lives in `~/.pixellab_token` and in `~/.claude.json` (local MCP config).
