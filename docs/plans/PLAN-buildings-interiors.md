# PLAN 04 — Unique buildings + door open/close anim + Stardew-grade interiors (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `game-art` + `game-systems` + `docs/ART_BIBLE.md`
> first; follow Plan 01's straight-on art contract.** Delegate art to the **art-director** agent and
> map layouts to the **map-designer** agent where it fits. Baseline after Plans 01–03: green.
> Standing rules (the designer): API/MCP-first, modular, doc-comment everything, no silent fallbacks,
> read-before-change, verify-before-done. Look at every building + interior in screenshots.

## Why / what the designer said
> *"All the buildings in the town are like repeats and still too small and don't match the sizing
> and functionality of the house. All buildings should be unique and serve their own purpose… think
> about how the player enters that building — the door and everything matches… I want a door opening
> and closing animation. The interiors are extremely terrible — research the different interiors in
> Stardew and match how they built walls and decorations. Each exterior AND interior should be
> unique to match its purpose and, if a character lives there, unique in that sense."*

## Current reality (audit, file:line)
- Only **2 building textures** (`building-store`, `building-tavern`) placed as **6 footprints**,
  all `wTiles:8, hSolid:4` (`MapDef.ts:429-436`) — code comment admits it's placeholder reuse.
- Buildings drawn bottom-anchored at `(b.tx + wTiles/2, b.ty+1)` (`BaseWorldScene.ts:484-490`).
- Door = a `WarpDef` on the footprint bottom row (`MapDef.ts:525-526`); warp-carve opens the solid
  door tile (`BaseWorldScene.ts:1079-1092`). **No door sprite, no anim** — just a 150ms camera fade
  (`SceneTransitionSystem.ts:56-62`).
- Interiors (`buildHome:542`, `buildStoreInterior:577`, `buildTavernInterior:608`) are
  floor-everywhere rooms with **walls ONLY on the top edge** (2 solid rows) and thin dark trim on
  the other sides (`renderInterior:365-400`); sparse props; **no NPCs inside any interior**.

## Research → design targets (Stardew's "business grafted onto a home")
Each interior = a **workplace at the front (counter + purpose props) + private living space behind**,
each with a distinct **palette + prop kit + mood** matched to its owner. Concrete references:
- **General Store (Pierre-like):** seed-shelf retail wall, counter+register, cozy-cluttered.
- **Tavern/Saloon (Gus-like):** warm wood tavern, long bar + stools, social hub, small game corner.
- **Clinic/Blacksmith/Carpenter (future buildings):** clinical-sparse / industrial forge / woodshop
  — each a deliberately different density and palette. Build the *system* now; add these buildings
  as the town grows.
- **Player home:** the accretion-progression interior (already the most built — keep + polish).

## TASK A — Data model for unique buildings (modular, data-first)
Extend `BuildingDef` (`MapDef.ts:63-69`) so each building is UNIQUE data, not a shared texture:
- Add `tex` per building already exists — give each its OWN texture key (`building-store`,
  `building-tavern`, `building-clinic`, `building-blacksmith`, `building-carpenter`, `building-inn`…).
- Add `doorTx` (door tile column, relative to footprint) + `interior: SceneKey` + `doorTex`
  (the door sprite key for the animation). Size (`wTiles`/`hSolid`) already per-building — vary them
  so buildings differ in footprint (the store need not be 8 wide).
- **The door must line up with the interior's exit warp** — the designer's "door and everything matches."
  Add an assertion at map-build time: every building's `doorTx` world position must map to the
  interior's `from_*` spawn, else **throw** (fail loud — no silent misaligned doors).

## TASK B — Unique exterior art (art-director), sized + straight-on
Generate a UNIQUE facade per town building, straight-on per Plan 01, at the **house-large.png scale
and detail level** (the designer's benchmark). Each reads as its business: store (awning + produce),
tavern (sign + warm windows), etc. Native width = `wTiles × 16 × 2`; render `wTiles × 16` wide,
bottom-anchored. Keep manifest keys additive; surgical python patches. Replace the 6-reuse layout in
`buildTown` with the distinct buildings + a couple of "coming soon" lots (don't fake a full town).

## TASK C — Door open/close animation
- Generate a small **door spritesheet** per building style (closed → opening → open, ~4 frames) OR a
  generic door sheet reused with per-building tint if styles are close enough (decide after seeing
  the exteriors — prefer per-style if cheap). Door sits at the facade's door tile, depth just above
  the facade base.
- Wire it into `SceneTransitionSystem`: on entering a building warp, play door-open → then the
  existing fade → switch scene. On exit, spawn at the interior door, play door-close behind you.
  **Do this in the transition authority, not scattered in scenes** — it stays the single warp path
  (Hard Rule 1). Add a `doorAnim?` hook to the warp so only building-doors animate (map-edge warps
  don't). Keep the transition's spawn-validation intact.

## TASK D — Real interiors (map-designer + art-director)
Rebuild `buildHome`/`buildStoreInterior`/`buildTavernInterior` (and a shared interior renderer) so
they read as lived-in rooms, per the research:
- **Full wall treatment on all four sides**, not just the top. Add interior wall/floor **variants**
  (wood/plaster/stone floors, papered/log/brick walls) as textures so each interior looks distinct.
  Generalize `renderInterior` (`BaseWorldScene.ts:365-400`) to take a `wallTex`/`floorTex` per map +
  render side and bottom walls properly (solid + art), not 4px trim.
- **Decoration density + theming:** windows, wall hangings/paintings, plants, lamps, rugs, shelving,
  clutter appropriate to the owner — via new decor `ObjectDef`/`DecorDef` kinds (art-director makes
  the sprites straight-on). Store = retail shelves + register; tavern = bar + stools + booths + a
  game corner; home = the cozy starter set (keep, add windows/plants/wall art).
- Interiors sized generously enough to feel like rooms (the 16×12 store is cramped — bump to match
  the facade's implied size).

## TASK E — Put the resident inside (ties to Plan 06)
Each staffed building gets its keeper NPC standing at the counter (Plan 06 builds the NPC/relationship
system; here just reserve the spawn + make the interior's `npcs` array populated by that plan). Note
the dependency in both plans.

## Ownership / guardrails
- YOU OWN: `BuildingDef` extensions + `buildTown`/interior builders in `MapDef.ts`, the generalized
  `renderInterior`, the door-anim hook in `SceneTransitionSystem.ts`, new building/door/interior art.
- SHARED — re-read first, additive: `AssetKeys.ts` (SceneKey enum if new interiors), `manifest.json`
  (surgical), `BaseWorldScene.spawnObjects` (new decor kinds).
- FORBIDDEN: the camera/placement regression code; changing the transition's spawn-validation
  (extend it, don't weaken it); the farm/forest/beach/mountain outdoor layouts (Plan 05 owns those).

## SPECS (extend `tests/m20-buildings.spec.ts` + `tests/m18-furniture.spec.ts`; add `tests/m24-interiors.spec.ts`)
1. **Door-warp alignment**: for every town building, the door world-tile maps to the destination
   interior's `from_*` spawn (the Task A assertion, tested); a deliberately misaligned def throws.
2. **Unique exteriors**: town has ≥N distinct building texture keys (no key reused as the only
   building art) — guards against regressing to the 2-texture reuse.
3. **Interiors have full walls**: assert the solid grid for each interior has solid border on ALL
   four sides (not just top), and a walkable interior.
4. **Door anim doesn't break transitions**: entering + exiting a building still lands the player at a
   valid named spawn, in-bounds (the permanent transition gate must stay green).
Keep all prior specs green.

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green. 3. Screenshots of the town (distinct buildings), a
   door mid-open, and EACH interior — confirm unique + lived-in + walls on all sides. Fix jank.
4. Report: building roster + art ids, door-anim wiring, interior-renderer generalization, screenshots,
   the NPC-placement handoff to Plan 06.
