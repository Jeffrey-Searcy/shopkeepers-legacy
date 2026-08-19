# PLAN 07 — Multi-level Stardew mine + separate Moonlighter dungeon (Fable 5)

> Drafted by Opus for Fable-5 execution. **THE BIG ONE — likely split into sub-sessions (7A then
> 7B).** Read `game-systems` + `game-art` + `playtest` first; use map-designer + art-director +
> gameplay-engineer agents. Baseline after Plans 01–06: green.
> Standing rules (the designer): API/MCP-first, modular, doc-comment everything, no silent fallbacks,
> read-before-change, verify-before-done. This plan builds on save/load (Plan 02), the art pipeline
> (Plan 01), and the loot→shop economy.

## Why / what the designer said
> *"I said you were implementing the dungeon but you just added combat to the mine. I kinda like it
> (Stardew has combat in the mines too), BUT I still want the EXACT dungeon gameplay from
> Moonlighter — how the player looks and how the game plays might/should change completely when the
> player enters the dungeon. Also in the mine there are multiple levels — mine rocks to find the
> ladder down, gets harder, saves every 5 levels with an elevator, better materials deeper, and the
> layout randomizes every time you go down. Same map-wise for the Moonlighter dungeon — it
> changes/randomizes every time you go in."*

**So: TWO underground experiences.** (A) A proper multi-level **Stardew mine** (evolve what exists).
(B) A separate **Moonlighter dungeon** that looks and plays differently. Do them as two sub-plans.

---

# SUB-PLAN 7A — Multi-level Stardew mine

## Research → exact mechanics to replicate
- **Depth counter**, not separate scene keys. One `MinesScene` that rebuilds its map per floor from
  a `mineDepth` in GameState. Stardew: 120 floors, 3 themed bands (rock 1–40 / ice 41–80 / lava
  81–120). Start smaller (e.g. 30 floors, one band) and make the band a data param so it extends.
- **Ladder down**: spawns randomly under a broken rock OR dropped by a killed monster; on "infested"
  floors (no rocks) it appears only after all enemies die. Going down = +1 depth, **regenerate the
  floor** (new seeded layout — seed from `(runSeed, depth)` so it's deterministic per-depth for
  tests but different every descent in play).
- **Elevator every 5 floors**: reaching floor 5/10/15… banks it; an elevator UI lets you jump to any
  reached floor. You must reach NEW depth on foot.
- **Deeper = better ore + harder enemies**: ore tier + enemy roster scale by depth band.

## TASK A — Depth + floor regeneration
- Add `mineDepth: number` + `mineMaxReached: number` to GameState (serialize/deserialize — Plan 02).
- Rework `buildMines()` (`MapDef.ts:1052`) into `buildMineFloor(depth, seed)` — a seeded cave
  generator (reuse the existing carve helpers) that scatters mineable rocks, places enemies scaled to
  depth, and DOES NOT pre-place the down-ladder. Seed = hash(runSeed, depth).
- `descend()` in MinesScene: increments depth, regenerates the floor, spawns the player at the new
  floor's entrance, updates `mineMaxReached`. The **up-ladder** returns to the previous floor (or the
  Mountain at depth 0). This replaces the current single-level + "deeper is blocked" stub
  (`MinesScene.ts:190-194`).

## TASK B — Ladder-down discovery
- When a rock is mined, seeded roll → maybe reveal the down-ladder at that tile (guarantee one per
  floor so you can always progress; extra ladders per Stardew feel). Killing an enemy can also drop
  it. On infested floors (a floor variant with no rocks), reveal the ladder only when enemies are
  cleared — reuse the existing "all enemies defeated" check.
- Ore/materials by depth: extend the mineable-rock drop table to tier ore (copper → iron → …) by
  band; add the ore items + values to `Items.ts` (feeds the shipping/shop economy — the designer's loop).

## TASK C — Elevator save-points
- Every 5th floor is a **safe floor** (elevator, no enemies, a milestone chest — Stardew's treasure
  floors). Reaching it records the checkpoint.
- Elevator UI (in UIScene, off a `GameState.elevatorOpen` flag): a scrollable list of reached
  checkpoint floors; selecting one regenerates that floor and warps there. Fail loud if asked to
  jump to an unreached floor.

## 7A SPECS (add `tests/m27-mine-depth.spec.ts`)
1. Descend: mine rocks until the ladder appears, go down → depth increments, new layout (hash
   differs), player at the new entrance.
2. Elevator: reach floor 5 → checkpoint recorded; elevator can jump to 5 but not to 10 (unreached →
   throws/denied).
3. Ore by depth: deeper floors drop higher-tier ore (assert the drop table by band).
4. Determinism: same (runSeed, depth) → identical floor (hash match), so specs are stable.

---

# SUB-PLAN 7B — Separate Moonlighter dungeon

## Research → what makes it Moonlighter (and what it is NOT)
The research corrected key assumptions — build to **Moonlighter 2018**, not the sequel or the genre
cliché:
- **Room-template procedural assembly, NOT fully random tiles.** A library of hand-authored **room
  templates** (fixed interior obstacles/enemy-spawns/hazards + door openings on edges), stitched into
  a **randomized floor graph** connected edge-to-edge. Re-randomizes every entry, always starts
  floor 1. *This is the single most load-bearing design decision.*
- **3 floors per dungeon** (floors 1–2 minibosses, floor 3 boss → exit portal). Start with one
  dungeon, 3 floors.
- **Rooms are discrete screens** connected by door transitions (not one scrolling map).
- **Doors do NOT lock on combat** (the genre cliché Moonlighter avoided). **Chests gate on clear** —
  a room's chest opens only after you kill every enemy in it; passage stays mostly open. The exit
  door is just somewhere in the room graph, usually past the guaranteed **Healing Pool** (which is
  always on the path to the exit — a navigation aid). One Healing Pool + often an Abandoned Campsite
  dead-end per floor.
- **In-run rules:** cleared enemies stay dead on backtrack; fleeing an UNcleared room refills its
  enemies. No user seed (add a URL seed for OUR tests only).

## TASK D — DungeonScene + room-graph generator (the core)
- New `src/scenes/DungeonScene.ts` + `src/dungeon/` module. A `DungeonGenerator` that:
  - Holds a **room-template library** (data-first: `public/data/dungeon-rooms.json` — each template
    = tile layout + door edges + enemy-spawn markers + hazard markers). Doc-comment the schema.
  - Stitches templates into a floor **graph** (pick a start room, grow by connecting door edges,
    place the Healing Pool on the critical path to the exit, scatter 1–2 secret "pit" rooms + a
    campsite dead-end, put the exit door in a leaf/room past the pool). Seeded per entry for our
    tests; fresh every real entry.
  - Fail loud if templates can't connect (bad door data) — no silent empty floor.
- Room transitions reuse the scene's warp discipline but INTRA-scene (move between rooms in one
  DungeonScene by swapping the active room's tilemap + repositioning the player at the entered door).

## TASK E — "Looks and plays completely different" (the designer's emphasis)
On entering the dungeon, change the feel deliberately:
- **Camera**: tighter zoom / room-framed (a room is one screen) vs the overworld's scrolling follow.
- **Player presentation**: combat-forward — the sword/weapon is always in hand (Plan 03 held-tool),
  HP + potion HUD always visible (unlike the overworld's no-combat-HUD rule). Consider a subtly
  different player tint/state so it reads as "dungeon mode."
- **Music/palette**: biome palette + combat-intensifying track (audio is a later pass; leave hooks).
- **Combat**: build on the existing `CombatSystem`/`Enemy` (dodge-roll i-frames already there). Add
  the Moonlighter combat verbs incrementally: 3-hit combo (3rd hit double damage + knockback), a
  charge special, and — if scoped in — the **two-weapon swap** (equip 2, swap button, combo carries
  across the swap). Telegraphed enemy attacks (growing-shadow slam, colored projectile markers).
  Avoid the #1 real complaint: **make hitboxes match the swing arc.**

## TASK F — The risk/reward loop (what defines Moonlighter)
- **Return portal (Merchant Emblem):** drop a two-way portal → warp to town/shop, sell/bank, portal
  back to the same spot (enemies refilled, floor revealed). Also a one-way **Pendant** panic escape
  that resets to floor 1. Costs scale with depth. This is the "bail with a full bag, come back"
  rhythm the designer pointed at.
- **Death penalty (2018 rule):** lose the **backpack** loot (not gold, not equipped gear, not the
  few "pocket" slots) and lose the night; respawn in town. (NOT the "lose gold/quality" sequel rule.)
- **Loot → shop:** dungeon drops feed the existing shipping/shop economy next day. Cursed-item
  inventory-placement constraints are a STRETCH (flag as a later sub-plan — it's a whole subsystem);
  V1 dungeon can ship without curses.

## 7B SPECS (add `tests/m28-dungeon.spec.ts`)
1. Generation: entering the dungeon builds a connected room graph (every room reachable from start
   via doors); the Healing Pool is on the path to the exit; re-entry with a different seed differs.
2. Doors don't lock: you can leave an uncleared room (passage open); its enemies refill on return; a
   room's chest opens only after its enemies are cleared.
3. Return portal: drop portal → warp to town → portal back to the same room; Pendant resets to floor
   1. Death drops backpack loot but keeps gold + equipped gear.
4. Floor progression: clear to the floor-3 boss → exit portal spawns.
Keep the 4 permanent regression gates + all prior specs green.

## Ownership / guardrails
- YOU OWN (7A): `mineDepth` logic, `buildMineFloor`, MinesScene descend/elevator, ore items/tables,
  elevator UI. YOU OWN (7B): `DungeonScene.ts`, `src/dungeon/**`, `dungeon-rooms.json`, the portal/
  death-loop, dungeon combat extensions, dungeon art (biome tiles, enemies, portal, weapons).
- SHARED — re-read first, additive: `GameState.ts` (+ serialize/deserialize — Plan 02), `Items.ts`,
  `CombatSystem.ts`/`Enemy.ts` (extend, don't rewrite), `UIScene.ts` (elevator + potion HUD),
  `SceneTransitionSystem.ts` (dungeon entry/exit warps), seam files, `manifest.json` (surgical).
- FORBIDDEN: weakening the transition spawn-validation or the camera/placement gates; the overworld
  no-combat-HUD rule outside the mine/dungeon.

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green (all prior + m27 + m28). 3. Playtest + screenshots:
   descend the multi-level mine (ladder → deeper → elevator), and enter the Moonlighter dungeon
   (room-to-room, clear a room to open its chest, drop a return portal, feel the different camera/HUD).
   4. Report: mine depth/elevator design, dungeon room-graph generator + template schema, the
   Moonlighter loop (portal/death/loot→shop), combat extensions, what was scoped out (curses,
   two-weapon if cut), specs, screenshots.
```

## Note on scope
7B is large — the room-graph generator alone is a meaty subsystem. Expect to run 7A and 7B as
separate Fable sessions, and possibly split 7B again (generator + combat feel, then the
portal/risk-reward loop). The plan is written so each piece has its own specs and can land
independently without breaking the game.
