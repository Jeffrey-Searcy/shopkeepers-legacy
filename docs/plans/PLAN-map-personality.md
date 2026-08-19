# PLAN 05 — Overworld map personality overhaul (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `game-systems` + `docs/ART_BIBLE.md`; delegate to
> the map-designer agent** (it owns layout/terrain/collision) and art-director for new decor.
> Baseline after Plans 01–04: green. Standing rules (the designer): API/MCP-first, modular, doc-comment
> everything, no silent fallbacks, read-before-change, verify-before-done.

## Why / what the designer said
> *"The maps still need a lot of love — they seem generic and it feels like things are too randomly
> placed. Look at the maps on Stardew — there's so much personality."*

## Current reality (audit)
Maps are a **hybrid**: hand-authored structure (paths, lakes via sine/ellipse math, cliff ring,
forest trail) + **seeded-LCG scatter** of trees/rocks/weeds/decor with fixed per-map seeds (farm
1337, town 4242, …), so the world is identical every run (tests depend on it). The scatter uses the
same handful of sprites everywhere with no landmarks/signage/benches/fences, so it reads "correctly
generated," not "designed." (`MapDef.ts` builders + `BaseWorldScene.spawnObjects`.)

## Research → the 6 principles that make Stardew maps feel hand-made
The research pinned exactly why Stardew has personality. Apply each as a concrete map pass:
1. **One hero landmark per region** that breaks the local palette (Community Center, JojaMart,
   Wizard's Tower). Give each map a distinct, high-contrast structure/feature.
2. **Function clustering** — buildings/props grouped by purpose, facing paths, spaced with yards.
3. **Purposeful paths** — a hub-and-spoke graph; path *material* signals zone (cobble=civic,
   dirt=rural) and funnels the player to each region's single edge-exit.
4. **Authored decoration density** — Stardew *hand-places* even weeds. Density keyed to place
   (dense-tidy town, dense-wild forest, sparse-rugged mountain), using a RICHER prop kit
   (fences, lamps, benches, signage, grass tufts, stumps, flowers).
5. **Verticality + natural boundaries** — cliffs/water as impassable edges (no invisible walls).
6. **Distinct water + fishing zone per region** (ocean/tidepool, lake/waterfall, river).

## TASK A — Extract an `ObjectSpawner` from BaseWorldScene (modularity)
The scatter + object/decor spawning lives in the 1287-line `BaseWorldScene.spawnObjects`. Extract
`src/scenes/controllers/ObjectSpawner.ts` (a class the scene uses) so map-population logic is
testable and BaseWorldScene shrinks. Behavior-identical refactor first (specs stay green), THEN add
the new capabilities below. Doc-comment thoroughly.

## TASK B — Author landmarks + zone identity into each map (map-designer)
For farm/town/forest/beach/mountain, keep the deterministic seed (tests depend on it) but replace
"scatter everywhere" with **authored composition**:
- Define, per map, a small set of **hand-placed landmark features** (e.g. farm: grandpa's shrine
  nook + a big central tree + the pond dock; forest: the flower clearing + a fallen-log bridge +
  the traveling-cart spot; beach: tidepools + a pier + driftwood pile; mountain: the mine cliff +
  a waterfall + a quarry ledge; town: the cobblestone plaza + fountain + noticeboard).
- Introduce **path materials** as ground types (cobble vs dirt) that visibly route the player to the
  single edge-exit per direction, matching the warp tiles.
- **Decoration as authored regions, not uniform scatter:** partition each map into zones (tidy near
  town, wild at the edges) and drive density/prop-kit per zone. Keep it seeded + deterministic so
  the world is stable (and specs pass), but make the RESULT read as composed. Add the richer decor
  kinds (fence, lamp, bench, sign, stump, tall-grass, reeds) — art-director generates them
  straight-on per Plan 01.

## TASK C — Richer terrain + water personality
- Add per-region water treatment (the Wang tilesets exist; add ocean-edge/tidepool/waterfall/river
  variants as needed) so each map's water reads differently and gates its fishing (ties to Plan 03's
  depth-gated fish).
- Ensure boundaries are natural (cliff/water/treeline), never invisible walls — audit each map's
  edge and fix any bare invisible-wall boundary (the designer hated those historically).

## Ownership / guardrails
- YOU OWN: the per-map builders in `MapDef.ts` (farm/town/forest/beach/mountain outdoor layouts),
  the new `ObjectSpawner.ts`, new decor/terrain art, new ground/path types in the terrain renderer.
- SHARED — re-read first, additive: `AssetKeys.ts`, `manifest.json` (surgical), the TerrainRenderer
  / Wang LUT files if you add ground types (regenerate LUTs via the existing script, don't hand-edit).
- FORBIDDEN: warp tiles/spawn positions that specs assert (m14 world-expansion geometry — keep the
  edge-exit tiles where the specs expect, or update the specs deliberately and note it); the
  camera/transition regression code; interior maps (Plan 04 owns those).

## SPECS (extend `tests/m14-world-expansion.spec.ts`; add `tests/m25-map-personality.spec.ts`)
Personality is visual, but structure is testable:
1. **Reachability preserved**: every existing warp round-trip (m14) still lands in-bounds — the
   permanent gate. Do NOT move the asserted edge-exit tiles.
2. **Landmarks present**: each map exposes its authored landmark features via the seam (a
   `landmarks()` helper or via `nodes()`/`groundAt()`), asserted present at their tiles.
3. **Paths connect**: assert a walkable path (no solid tiles) exists from each map's spawn to each
   edge-exit — proves paths actually route, no accidental walled-off exits.
4. **Determinism**: same seed → same layout (boot twice, compare a hash of the object list) so the
   world stays stable for every other spec.

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green (esp. m14). 3. Screenshots of ALL five outdoor maps
   — confirm each has a clear landmark, routed paths, zoned decoration, natural boundaries, and its
   own identity. Compare side-by-side; fix any that still read generic. 4. Report: per-map landmark
   list, ObjectSpawner extraction, new decor/terrain art ids, screenshots, before/after read.
