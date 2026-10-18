# ShopkeepersLegacy — Roadmap

> Where we are, what's next, and everything the designer has asked for. Each "prompt" is a milestone-gated
> build (spec → build → Playwright green → playtest), executed with the custom agents in
> `.claude/agents/` (art-director, map-designer, gameplay-engineer, playtester).

## Current status — September 15, 2026

Read [the maintained starting guide](handbook/START_HERE.md) before using the milestones below.
Save v14, living hospitality, Farm/Town editors and approved layouts,
and twelve town buildings/residents are installed. All twelve adults now have authored friendship,
gift, romance, NPC-bond, journal, and optional guarded local-chat foundations.
All twelve residents also follow weekday/weekend routes and record changing daily Town conversations.
Their 66 possible bonds support emergent romance, open agreements, witnessed cheating, and breakups.
Jeff approves the town exteriors. All twelve interiors now have connected homes, visible two-heart bedrooms,
and building-fit service points. The guild board introduces contracts for the future northern portal dungeons.
Final interior visual approval, hiring, dates, marriage, and relationship story events remain future work.
The older notes below include rejected experiments and superseded "future work" claims.
In particular, the whole-image table rotation experiment is rejected; tabletop rotation keeps feet upright.

## Historical pass — Player-built shop (2026-09-12, visual approval open)

Mouse-led room placement, an empty starting shop, and functional crafted workbench/register/bar/
stove now replace fixed service stations. Save v6 preserves items and progress through explicit
older-layout recovery. Crafting uses cozy recipe pockets, text renders at display resolution,
and the title centers conventional controls. Native oak/stone surfaces, deep rear doorway and
substantial stairs remain architectural. Lower horizontal-table and vise-workbench art address
Jeff's latest feedback; the vertical table keeps its prior image after rejecting its new candidate.

All181 tests pass with four workers, including strict door timing and real craft-to-service flow.
Final visual acceptance remains open. See `playtest-reports/2026-09-12-player-built-shop.md`.
Ale brewing, product displays, seating, staff, room bookings and NPC lodging remain future work.

Latest follow-up: Jeff chooses literal90° image turns for table/workbench, not a separate
perspective sprite. Interior views reserve toolbar clearance; camera zoom and outdoor views
stay unchanged. This supersedes the vertical-table artwork task above. See
`plans/PLAN-literal-rotation-exit.md` and `planning_artifacts/literal-rotation-exit-2026-09-12/review.md`.

## Previous pass — Interior foundation and clear menus (2026-09-12, playtest candidate)

The shop and bedroom now use native wood floors, plaster/timber walls and clearer door recesses.
Most dining clutter is gone. A small fixed service area keeps the current food loop working;
the rest of the room is for player-built furniture. Tables, chairs, bar counters, registers and
rugs share grid footprints and native art crops. R rotates; Space or an adjacent click places;
an axe/pickaxe picks up from any occupied tile. New bar/register items are furnishing only.
Movable working stations, ale brewing, product displays and lodging remain future work.

Save v5 preserves furniture rotation and rejects overlapping or out-of-bounds placements.
Old placed tables/rugs return to the bag, or safe persistent drops when it is full, because their
footprints expand. Other items keep their positions. Title navigation is now Continue, New Game,
Load Game and Settings, with working sound/motion choices. The task badge expands with J;
walk-in door timing is shorter. Verification and remaining limits live in
`playtest-reports/2026-09-12-interior-foundation.md`. Jeff's visual approval stays open.
All 162 tests pass with four workers; typecheck and build pass. Real WebGL screenshots and
independent review support this local playtest. Formal governed-session closure remains blocked.

## Previous pass — Shop porch and private home (2026-09-12, visual feedback open)

The inherited building now has a shop-neutral exterior, raised porch, and animated walk-in
door. The keeper enters by walking up the steps; E is not required. A rear doorway leads
to a private bedroom with the existing sleep and save flow. Guest-only stairs stay blocked
to the keeper. Room bookings, NPC lodging, shop selection, and playable upstairs remain later work.
Current tavern service remains in place. Save v4 narrowly moves older Farm saves out of the
new porch solids; valid old positions and the existing legacy Home redirect stay intact.
All 140 tests pass with four workers; typecheck and build pass. Jeff's playtest still rejects
the visual quality: tables/chairs/walls need work, the HUD covers too much game, and the door
feels delayed. He wants Travellers Rest interior research and a conventional New/Load/Settings
title informed by Necesse. That new visual work remains open. See `plans/PLAN-shop-home.md` and
`playtest-reports/2026-09-12-shop-home.md`; passing tests do not mean visual acceptance.

## Previous pass — Cozy interface and wardrobe (2026-09-12)

The browser now fills its window with integer world-camera zoom. Title, pause, inventory,
chest and shipping menus share cream surfaces, soft green accents and rounded item pockets.
Pause > Appearance keeps the current body and edits hair, hats, shirts, pants and five color
categories. Four-direction and tool previews use a detached draft; Apply changes the keeper,
Cancel leaves the keeper unchanged. Save Game or sleep persists the applied outfit in save v3.
Explicit v1/v2 migration preserves the original keeper. The wardrobe is cosmetic, not equipment.
All 132 tests pass. See `plans/PLAN-cozy-interface.md` and
`playtest-reports/2026-09-12-cozy-interface.md` for controls, verified evidence, and remaining limits.

## Previous chapter — Tavern opening (2026-09-10, local playtest candidate)

Jeff confirms the inherited tavern is the heart of the game. Mines remain Stardew-style;
the separate dungeon will play like Moonlighter. This chapter adds the tavern room,
restoration, cooking, first customers and first business upgrade. See
`plans/PLAN-tavern-opening.md` for the acceptance contract. Older completion notes below are
historical; several interiors were removed during later quality passes.

Local build includes restoration, batch cooking, sequential guests, daily service limits,
the first upgrade, and save migration. All 111 tests pass with four browser workers; build and
type checking pass. See `playtest-reports/2026-09-10-tavern-opening.md` for controls, evidence,
known visual limits, and the still-open formal review. This is not a finished-game claim.

## Earlier milestones
- **V1 Stardew core (M0–M8):** big maps, camera, transitions, tools/stamina/hotbar, farming loop,
  inventory/chests, day/night+sleep, tile-valid placement, real PixelLab art. 
- **Polish pass:** Wang autotiled terrain (grass/dirt/water), designed farm+town, NPCs+dialogue
  (Rosa/Finn), fullscreen scaling, real-keyboard input fixes, SFX, toasts, y-depth sorting.
- **Precision pass:** 1-tile collision bodies (+m10 gates), Stardew front-facing building facades,
  multi-hit nodes with hit feedback, hold-to-chop (Space/mouse, adjacent-tile click targeting),
  target-tile highlight, slot-grid inventory + chest transfer UI, calm tile-format ground art.
- **Agent infrastructure:** skills (game-art, game-systems, playtest) + 4 custom agents + this roadmap.
- Test suite: 27 Playwright specs, all green. PixelLab: <70 of 5,000 generations used.

## Prompt 4 — Animations & feel — DONE (2026-07-07, 30/30 specs green)
- **Action animations**: chop/sweep/water sheets generated by the art-director agent (PixelLab v3);
  code plumbing done (`Player.playAction`, one-shot anims, movement lock during swing, wired into
  the single `swing()` entry point for Space/hold/mouse).
- **Placeable items anywhere not blocked** — DONE: ItemPlacementSystem (any non-solid, non-water,
  unoccupied tile), green/red ghost highlight, axe/pickaxe pick-back-up, persistence across
  scenes, CraftingSystem stub (20 wood → chest) with a bag-panel craft button. m11 specs green.
- Remaining feel debt: hit-SFX timing sync to anim frames; canopy transparency when the player is
  behind a tree.

## Feel & precision pass 2 — DONE (2026-07-07, 34/34 specs green)
- Feet-based collision (player + NPCs): body at the feet like Stardew — fixes "end up on top of
  things instead of behind" and torso-blocking invisible walls. Depth-sort + tile targeting now
  feet-authoritative.
- Straight-on art rule enforced: new chest/bed/workbench (paper-cutout prompt technique in the
  game-art skill), chest sized ~0.7 character height with 1-tile collision.
- Workbench-first crafting: bag crafts only the workbench (15 wood); placed workbench opens the
  crafting panel (chest recipe there; more recipes land with their art).
- Fishing V1: rod (slot 7), cast at water, bobber, timed bite window, 3 weighted fish, moving
  reels in. Full minigame bar = later upgrade.

## Feel pass 3 — DONE (2026-07-07, 37/37 specs)
- Stardew reel minigame (tap/hold to keep the fish in the zone; progress bar; escape possible),
  hold-to-cast press semantics, cast animation plumbing (art async).
- Bed collision (was walk-through), shipping bin + gold economy (queue items, day-end payout,
  sell values in Items.ts), pass-out at 2:00 (wake home, half stamina), time speed 12 -> 1.5
  game-min/s (Stardew pace, ~13-min days).

## Crafting catalog expansion — QUEUED (the designer: "copy Stardew's craftables")
- Research Stardew's crafting list; design our tiers (workbench -> furnace -> kitchen?): fences,
  paths, torches, scarecrow, sprinklers, furniture; potions/food need a consumables/buff system.
- gameplay-engineer + art-director joint prompt; recipes stay data in CraftingSystem.

## Prompt 5 — WORLD OVERHAUL — DONE (2026-07-07, 41/41 specs green)
Stardew-mirrored world graph shipped by the map-designer agent: Farm↔Forest (south causeway),
Town↔Beach (south road, sand + foam ocean), Town↔Mountain (north road, stone shelf + lake) ↔
Mines L1 via cave mouth (proto-dungeon shell, ~70 mineable rocks). 4 new Wang tilesets
(sand/stone/water-sand/cave, all chained to canonical grass), decor (driftwood/seashell/ladder),
cave-entrance facade. Home interior got the room treatment (wood floor/walls/door mat) + cast anim
wired. Camera-centering + target-square-depth fixes from the playtester audit. m14 reachability
gates. NEXT interiors work: store/tavern enterable rooms.

## (superseded planning notes below)
- The designer's direction: study Stardew's world map and rebuild ours in that spirit — multiple
  connected locations (farm, town square with several buildings, beach, forest, mountain/mines,
  dungeon entrance), each map designed with landmarks and paths. map-designer agent leads with
  layout research; art-director regenerates town buildings at house-large scale/quality.
- **Building interiors**: store + tavern interiors (Tiled-style data maps, wood-floor/wall
  tilesets thought of AS tiles per the Art Bible rules), door warps, furnishings.
- Home interior upgrade (walls, rug, kitchen, decorations).
- Map improvements: farm zones (orchard corner, rocky quarry), fences, more town blocks, beach
  stub. Interior-quality pass on the mines entrance (cave mouth on the farm/mountain).

## Prompt 6 — Crafting & fishing
- **Crafting**: recipes as data (wood/stone/fiber → chest, fence, scarecrow, workbench),
  crafting UI (grid, Stardew-style), **workbench** placeable that unlocks advanced recipes.
- **Fishing**: rod tool + cast at water + timing minigame (the pond and lake already exist),
  fish items, sell value groundwork.

## Prompt 7 — The actual game: shops (Moonlighter half)
- Tavern/inn loop on the placement seam: patrons with order bubbles, serve for money, counter/
  rooms/vacancy management, rowdy patrons. Gold as a real currency; buy building upgrades from a
  carpenter NPC. This is what makes it ShopkeepersLegacy, not a Stardew clone.

## PARALLEL MISSIONS — DONE (2026-07-07, 47/47 specs green)
- **Stardew-classic maps**: cliff-boundary terrain family (carveCliffRing w/ built-in Wang purity
  rule + trail-mouth openings), farm debris ~doubled (134 trees/49 rocks/113 weeds, clustered),
  town: 6 building lots + lane + 60 decor, headless BFS map validator (scripts).
- **Farming depth**: crop catalog (parsnip 3d/potato 6d/melon 12d, per-stage art), 28-day seasons
  (planting season-gated; withering = future rule), CONSUMABLE seeds (start 15 parsnip; harvest
  returns 0-2; bag click equips seed type), watering can 12 uses + refill facing water + UI meter,
  tree lifecycle (sapling→small→full, stumps on fell, regrow after 3 days; per-stage hp/yields),
  connected tilled-soil Wang blob (SoilOverlay) + wet tint. Seed SHOP = natural next hook.

## Interior 2.0 + Enterable Town — DONE (2026-07-08, 55/55 specs, PLAN-interior-town.md executed)
Rain auto-waters overnight (+free morning watering, Stardew rule); farmhouse rebuilt 24x18
(bed/chest/TV/kitchen counter/rug/dining set); TV = tomorrow's forecast; furniture craftable at
the workbench (table 12w/chair 6w/rug 8 fiber), placeable anywhere not blocked (rug walk-over,
table-on-rug stacking, axe breaks -> drop); itemized morning Shipping Report screen; store +
tavern enterable (door warps, shelf/counter/bar interiors). New gates: m17-m20 (8 specs).

## (superseded) Interior 2.0 — QUEUED (the designer, 2026-07-07): copy Stardew's farmhouse interior
Proper room layout (Stardew reference), TV (weather forecast for tomorrow), rugs/decorations,
FURNITURE as placeable/pickupable items (extends ItemPlacementSystem), full end-of-day summary
SCREEN (what sold, per-item breakdown, fade transition) replacing the dialogue-box version.
DONE TODAY: 2-row solid walls (no standing in the wall band), bed = full 2x2 solid, morning
day-summary dialogue with shipped earnings.

## Town 2.0 — QUEUED: enterable buildings (store/tavern interiors via the house pipeline at
house-large scale), more NPCs, relationship system (spec below).

## Relationship system — SPEC'D by the designer (2026-07-07), queue after map overhaul
Stardew model, his words: talking to a townsperson once per day raises friendship (casual chat
capped at once/day); GIFTS raise it more, but each NPC has likes/dislikes you have to DISCOVER
(liked gifts give big boosts, disliked can hurt). Implementation sketch: GameState.friendships
{npcId: {points, talkedToday, giftedToday}}; hearts UI on dialogue; gift = select item in bag then
E on NPC; per-NPC taste table (hidden from player); daily flags reset on sleep. Dialogue lines
should vary with heart level.

## Dungeon — MOONLIGHTER-STYLE (the designer's direction, 2026-07-07)
The mines/dungeon should PLAY like Moonlighter, not Stardew: research Moonlighter's dungeon loop
(procedural rooms, real-time combat with dodge-roll, enemies dropping loot, inventory-space
risk/reward, leave-or-push-deeper decisions, portal-home cost). The designer explicitly OK with combat
animations diverging from Stardew (sword swings, dodge). Needs: combat system (HP, enemies, hit
frames), enemy art + anims, loot tables feeding the shipping/shop economy. Mines L1 from the map
overhaul is the shell this builds into.

## Fishing power-cast — QUEUED (the designer, 2026-07-07)
Hold to cast FURTHER: hold builds a power meter, releasing casts 1-4 tiles out (deeper water =
better fish table later). Requires the cast anim (in flight) + retuning the press semantics.

## Prompt 8 — Story & life sim
- NPC schedules (time-of-day movement), relationships/hearts (gifts, dialogue trees as data),
  events/cutscenes (festival, grandpa's letter intro), seasons, music (needs a real audio pass —
  synth SFX exist; music likely sourced or composed, not AI slop per the designer's taste).
- Save/load (GameState.serialize is already the save format), title screen.

## Infrastructure track (parallel: API-first / MCP-first / modular)
- **gamedev-mcp (proposed next)**: a tiny local MCP server wrapping the dev loop as tools —
  `boot_game`, `screenshot(tile|scene)`, `drive(actions[])`, `read_state`, `run_specs`,
  `wire_asset(key, file)` — so ANY agent (or Codex, or cloud agents) can operate the game
  without knowing the scripts. The seam already is the API; this makes it MCP.
- Data-first content packs: items/recipes/dialogue/schedules as JSON so systems stay reusable
  for future games.
- CI: run the Playwright suite on push (GitHub Actions) once the repo is on git.

## Bug/report log
- "Walked through a tree" (the designer, Jul 6): investigated — trunk/wall/chest collision verified by
  new m10 gates; almost certainly canopy walk-behind (intended, Stardew-like). Watching for a
  repro with the player drawing OVER foliage (that would be a depth bug).
