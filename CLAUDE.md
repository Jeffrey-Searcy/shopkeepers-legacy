# CLAUDE.md — ShopkeepersLegacy build rules

> This file is auto-loaded every session. It is the contract for HOW you build.
> The WHAT lives in `docs/GAME_SPEC.md` + `docs/ROADMAP.md` (current status & next prompts).
>
> **Use the project skills and agents** — they encode everything already learned the hard way:
> - Skills: `game-art` (PixelLab + tile-format rules), `game-systems` (architecture + Phaser
>   gotchas that were real bugs), `playtest` (seam API + verification).
> - Agents (`.claude/agents/`): **art-director**, **map-designer**, **gameplay-engineer**,
>   **playtester** — delegate matching work to them, in parallel where possible.
> Read `docs/ART_BIBLE.md` + the `game-art` skill before generating any art.

## What we're building (one line)
A browser-based 2D top-down pixel-art game: Stardew Valley core mechanics (near 1:1)
crossed with Moonlighter (shop management + dungeons). Full vision in `docs/GAME_SPEC.md`.
**V1 = Stardew core only.** Shops/dungeons are later prompts — do NOT build them in V1.

## The stack (non-negotiable for V1)
- **Phaser 3** (3.8x line) — game framework.
- **TypeScript**, `strict: true` — every scene key, texture key, and physics body is typed.
- **Vite** — dev server + build. Start from the `template-vite-ts` layout.
- **Tiled** (`.tmj` / `.tsj`) — all maps are authored as data, imported by Phaser. Maps are NOT hardcoded in TS.
- **Playwright** — automated gameplay verification (see Self-Verification below).

Rationale you must respect: the framework's built-ins (`camera.startFollow`, Tiled tilemap
import, the scene registry) are the reason this project avoids a prior attempt's failures.
Do not hand-roll a game loop, a camera, a tilemap parser, or scene management. Use Phaser's.

## Hard rules (these prevent the specific bugs that killed the last attempt)

1. **Never call `this.scene.start()` / `this.scene.switch()` directly.** All scene changes go
   through `SceneTransitionSystem.transitionTo(targetSceneKey, spawnId)`. It validates the
   target key against the `SceneKey` enum, looks up a **named spawn point** in the destination
   map, and refuses to run if the spawn is missing (throw in dev). The player is placed at a
   named spawn — **never at implicit (0,0)**. This is the guard against "player vanished on
   transition."

2. **The camera always follows the player.** Every world scene calls
   `this.cameras.main.startFollow(this.player, true, 0.1, 0.1)` and
   `this.cameras.main.setBounds(0, 0, mapWidthPx, mapHeightPx)` in `create()`. Also set
   `physics.world.setBounds` to the same. Game config uses `roundPixels: true` and `pixelArt: true`.

3. **Maps are big.** World constants live in `GameConfig.ts` (16px tiles, farm ≥ ~100×100 tiles).
   Never ship a tiny placeholder map "for now" — big maps from M1 so camera/culling are tested for real.

4. **Assets are referenced by logical key, never by filename.** All keys live in `AssetKeys.ts`.
   `public/assets/manifest.json` maps each key to either
   `{ "type": "placeholder", "color": "#RRGGBB", "w": N, "h": N }` or
   `{ "type": "spritesheet"|"image"|"atlas", "file": "...", ... }`. `AssetLoader` reads the manifest
   at boot and loads placeholder OR real art transparently. Swapping in a PixelLab PNG must be a
   **one-line manifest edit + drop the file** — zero game-logic changes. Sprite origin and physics
   body size come from `GameConfig`, not from image dimensions, so a differently-sized PNG never
   shifts collision.

5. **Building placement is tile-validated.** `PlacementSystem` checks a footprint against map
   bounds, a `buildable` layer/property from Tiled, and existing `GameState.placements`. Ghost
   preview tints green/red; commit only when every footprint tile passes.

## Engineering discipline (from the designer's global standards — enforce them)

- **No silent fallbacks. Fail loud.** Do NOT add `?? defaultValue`, optional chaining to mask
  missing data, or try/catch that swallows errors to "make it work." If something is missing
  (a spawn point, an asset key, a map layer), throw with a clear message. Production code must
  surface real failures, not hide them.
- **Read before you change.** Understand existing data flow before editing. Prefer reusing the
  systems/utilities already in `src/` over adding parallel ones.
- **Root cause, not band-aid.** If a test fails, fix the underlying cause. If a theory fails
  twice, stop and reassess rather than piling on patches.
- **Verify before claiming done.** A milestone is complete only when its Playwright spec is green
  AND (for the final V1) a manual `npm run dev` playtest confirms it. Never say "done" on a
  partial or failing state — say what failed and show the output.
- **Comment for the next session.** Top-of-file block per module (what it does, how it fits).
  JSDoc on every class/system/method (purpose, params, returns, side effects). Inline `// why`
  comments on non-obvious logic (especially the transition/camera/placement code). Comment the
  shape of non-trivial state objects (`GameState`, `manifest.json` entries).

## Art / PixelLab rules
- **Read `https://api.pixellab.ai/mcp/docs` before your first generation.** Understand the tools
  and their parameters so you don't waste credits. Details in `docs/PIXELLAB_GUIDE.md`.
- **Style-test before batch.** Generate a tiny style-test set first (farmer + a few tiles),
  drop into the manifest, look at them together, get the style locked, THEN batch-generate the
  rest. Follow the palette/perspective/size rules in `docs/ART_BIBLE.md` so everything is cohesive.
- **Look at what you generate.** After assets land, use Playwright screenshots to confirm sprites
  and tiles don't overlap incorrectly or z-fight; fix sizing/placement before moving on.

## Self-Verification protocol (Playwright on a canvas game)
- The game renders to one `<canvas>`, so DOM assertions are useless. `DebugHooks.ts` (active under
  `?test=1`) exposes `window.__TEST__` with: `ready` (bool), `state()` (serialized `GameState`),
  `input(action)` (e.g. `'move:right'`, `'use-tool'`, `'interact'`, `'hotbar:3'`), and
  `stepTime(minutes)`.
- Boot tests with `?test=1&seed=42`; seed all RNG from the URL so runs are deterministic. Drive the
  in-game clock via `stepTime`, never wall-clock.
- **Each build-order milestone is gated by its own spec.** The four regression specs
  (`scene-transition`, `camera-follow`, map-bounds, `placement`) are permanent, non-negotiable
  gates — they encode the last attempt's failures and must stay green forever.

## Definition of Done
See `docs/GAME_SPEC.md` → "Definition of Done." V1 is done when every criterion there passes in
Playwright and the manual playtest confirms it feels right.

## You may pivot
This spec is a strong starting point, not a straitjacket. If you find a better approach that still
hits the Definition of Done and respects the Hard Rules above, propose it and proceed. The Hard
Rules and the "no silent fallbacks" discipline are the parts you may NOT pivot away from.
