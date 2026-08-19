# MASTER IMPROVEMENT ROADMAP — ShopkeepersLegacy (the designer's testing feedback, 2026-07-09)

> Drafted by Opus after (a) a grounded file:line code audit of the whole `src/` tree, (b) an
> art-perspective analysis of the actual shipped PNGs, and (c) mechanics research on Moonlighter's
> dungeon + Stardew's mines/interiors/map design. Each numbered plan below is a **separate,
> self-contained executable file** for Fable 5 to run one at a time.
>
> **Standing rules for ALL plans (the designer's directive):** API-first, MCP-first, modular, clean,
> organized. Detailed doc comment above EVERY class / function / method (purpose, params, returns,
> side effects) so a fresh session can expand it. No silent fallbacks — fail loud. Read before you
> change. Verify before claiming done (typecheck + the milestone's Playwright spec green + look at
> screenshots). Use the project skills (`game-art`, `game-systems`, `playtest`) and agents.

---

## How to read this
This roadmap is the index. It records **what** each plan does and **why it is ordered where it
is**. The detail (file:line targets, exact code, specs, verification) lives in each `PLAN-*.md`.
Execute them **in the order listed** unless a plan's header says it is independent.

## Scoping assumptions (the designer was away when asked — override any of these freely)
- **Dungeon = fully separate mode.** A distinct `DungeonScene` with Moonlighter-style room-based
  procedural layout + return portal, ALONGSIDE a multi-level Stardew mine. See Plan 07.
- **Sequencing = foundations first.** Save/load + menus + the art-pipeline fix land before content,
  because (a) save/load stops you losing progress every reload while testing, and (b) the art fix
  is a *rule* every later asset must follow — fixing it first means buildings/interiors/maps get it
  for free instead of being redone.
- **Workflow = Opus plans, Fable executes.** Same as the interior + dungeon plans that shipped.

---

## The core finding that shapes everything
The codebase is **genuinely modular and well-commented** — the state→system→scene→seam→spec
pattern is real and consistently applied, `GameState.serialize()` is already a complete save
snapshot, the manifest asset-seam works. The problems you're seeing are almost all **content and
polish gaps on top of a sound architecture**, not architectural rot. Two exceptions worth doing
deliberately: `BaseWorldScene.ts` (1287 lines) has accreted enough that fishing + object-spawning
should be extracted (Plans 04 and 05 do this), and ~3/4 of texture keys are raw string literals
rather than `TextureKey` constants (Plan 01 closes this as it touches art).

---

## THE PLANS (execute top to bottom)

### FOUNDATIONS (do first — they unblock or de-risk everything after)

**01 — `PLAN-art-pipeline.md`** · Art perspective + scale fix
The root cause of "why do you keep making angled images" + "everything's too small." The table and
shipping bin were generated in 3/4 perspective (you see the top *and* the receding front) while the
world is flat-ish top-down, so they clash. AND objects are rendered into ~22–24px boxes barely
bigger than a 16px tile, so they look tiny. This plan: (1) writes an ironclad art-generation
contract into `game-art` + `ART_BIBLE.md` (straight-on flat-facade phrasing, reference the approved
`house-large.png`), (2) regenerates the offending furniture/bin art straight-on at correct scale,
(3) fixes the render-size constants so objects read at a believable size, (4) moves the remaining
raw-string texture keys into `AssetKeys.ts`. **First because every later plan generates art** — lock
the rule now so buildings/interiors/maps/enemies all inherit it.

**02 — `PLAN-save-menus.md`** · Save/load + main menu + pause menu
No persistence exists — a reload wipes everything, which makes iterative testing painful. But
`GameState.serialize()` is already the save format, so this is mostly wiring: a `SaveSystem`
(localStorage, slot-based, versioned), a `MainMenuScene` (New Game / Continue), a pause overlay
(Esc → Resume / Save / Quit to title), and a `GameState.deserialize()` to match serialize. **Second
because it protects your test progress from here on** and is low-risk (no art dependency).

**03 — `PLAN-tools-fishing.md`** · Tool-in-hand + fishing pole/line + harder fishing + more fish
You should *see* the equipped tool; casting should show the rod + line, not a lonely bobber; fishing
is too easy (it literally starts 40% won); needs more fish. This plan: held-tool sprite overlay on
the player, a drawn rod + line from hand to bobber during casts, retunes the reel minigame to a real
difficulty curve, and expands the fish table (season/water-depth gated). Extracts a
`FishingController` out of `BaseWorldScene`. **Third — self-contained, uses the Plan 01 art rules.**

### CONTENT (the bulk of the "make it feel like Stardew" work)

**04 — `PLAN-buildings-interiors.md`** · Unique building exteriors + door open/close anim + real interiors
Today there are only 2 building textures reused 6× in town, no door animation, and interiors are
shells (walls only on the top edge, sparse props, no occupants). This plan gives each building a
unique exterior sized to its footprint and matched to its door, a door open/close animation on
entry/exit, and Stardew-grade interiors (full wall/floor treatment, lived-in decoration density,
each interior themed to its purpose and its resident). Depends on Plan 01's art rules and pairs with
Plan 06's NPCs (shopkeepers live in these interiors).

**05 — `PLAN-map-personality.md`** · Overworld map personality overhaul
The maps read as "correctly generated" not "hand-designed." This plan adds landmark clustering,
paths that lead somewhere, fences/signage/lamps/benches, environmental storytelling, and denser
purposeful decoration — using Stardew's map-composition principles from the research. Extracts an
`ObjectSpawner` from `BaseWorldScene`.

**06 — `PLAN-npcs-relationships.md`** · More NPCs + the relationship system
Currently 2 NPCs with static rotating lines and zero relationship code. This plan builds the
Stardew-model relationship system you spec'd (once-daily chat, gifts with hidden per-NPC tastes,
hearts, heart-gated dialogue), adds a roster of NPCs with unique portraits/dialogue, and places
shopkeepers inside their interiors (ties to Plan 04). Data-first: NPCs/dialogue/tastes as JSON.

### THE BIG ONE

**07 — `PLAN-mine-dungeon.md`** · Multi-level Stardew mine + separate Moonlighter dungeon
Two connected pieces informed by the research: (A) make the mine properly **multi-level** — break
rocks to find the ladder down, layout regenerates each descent, elevator save-points every 5
levels, deeper = better ore + harder enemies. (B) build a **separate Moonlighter dungeon** — a
distinct scene with room-based procedural layout, locked-door room clears, a two-weapon combat feel,
a drop-a-portal-return-to-shop loop, and death/loss stakes, where the game LOOKS and PLAYS
differently on entry (as you described). Biggest plan; sequenced last because it leans on save/load
(Plan 02), the art pipeline (Plan 01), and the loot→shop economy.

---

## Cross-cutting infrastructure (proposed, not blocking)
Per your API-first/MCP-first push and the ROADMAP's `gamedev-mcp` idea: after the foundations land,
a tiny local MCP wrapping the dev loop (`boot_game`, `screenshot`, `drive`, `read_state`,
`run_specs`, `wire_asset`) would let any agent operate the game without knowing the scripts. The
seam already IS the API; this makes it MCP. Flagged here; its own plan when you want it.

## Definition of done for the whole batch
Every plan's Playwright milestone spec green, typecheck clean, the 4 permanent regression gates
(scene-transition / camera-follow / map-bounds / placement) still green, and a manual playtest per
plan confirming it *feels* right. Nothing is "done" on a partial or failing state.
