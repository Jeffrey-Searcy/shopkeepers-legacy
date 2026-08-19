# PLAN 03 — Tool-in-hand + fishing pole/line + harder fishing + more fish (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `.claude/skills/game-systems` + `game-art` first;
> follow Plan 01's art contract.** Baseline after Plans 01–02: specs green, typecheck clean.
> Standing rules (the designer): API/MCP-first, modular, doc-comment everything, no silent fallbacks,
> read-before-change, verify-before-done. Look at the fishing visuals in screenshots.

## Why this is Plan 03
The designer: *"when the player equips a tool I feel like you should see them holding it… when the player
casts the line for fishing we only see the bobber, we don't see the pole anymore which looks dumb.
Also fishing is still a little too easy. And maybe we need to add more fish?"*

## Current reality (from audit + source)
- **No held tool.** Tool motion is baked INTO the character action sheets (`player-chop/water/...`).
  There is no separate held-tool sprite; hoe/axe/pickaxe all reuse the `'chop'` bucket
  (`BaseWorldScene.ts:633-639`). The tool only appears as a hotbar icon.
- **Cast shows only an 8×8 bobber**, no rod, no line (`BaseWorldScene.castAt:685-726`,
  `:695-698`). Power-cast + charge bar already exist (`releaseCast:733-747`).
- **Fishing is easy by design**: reel starts at `progress = 0.4` (already 40% won,
  `FishingSystem.ts:71`), `GAIN=0.3 > DRAIN=0.12`, zone is 32% of the track (`:32-38`); the code
  comment literally says *"Tuned forgiving for V1."*
- **Only 3 fish** in the `FISH` table (`FishingSystem.ts:22-26`), weighted at hook-time with no
  season/water-depth gating.

## TASK A — Held-tool overlay (see the equipped tool)
Two viable approaches; **prefer A2** (data-light, no re-generation of all character sheets):
- **A1 (heavy):** per-tool character action sheets. Rejected — expensive art, doesn't show the tool
  while just *walking/standing*, which is what the designer means by "see them holding it."
- **A2 (chosen): a held-tool sprite pinned to the player.** Add a `HeldTool` display object (a small
  `Phaser.GameObjects.Image` child) that shows `icon-<activeTool>` (icons already exist) offset into
  the player's hand per facing (down/up/left/right → different offset + depth so it sits in front of
  or behind the body correctly). Update it each frame from `ToolSystem.active()` + `player.facing`.
  Hide it for tools with no sensible hand pose if any. This makes the equipped tool visible while
  idle AND walking, cheaply. Extract into `src/entities/HeldTool.ts` (own file, doc-commented) so it
  stays modular and BaseWorldScene doesn't grow.
- Generate proper small **in-hand tool sprites** (art-director) if the flat inventory icons read
  poorly in-hand — straight-on per Plan 01. Keep keys additive (`tool-held-axe`, etc.) only if
  needed; otherwise reuse `icon-*`.

## TASK B — Draw the rod + line during a cast (extract a FishingController)
`BaseWorldScene.ts` is 1287 lines and owns the whole fishing flow. **Extract
`src/scenes/controllers/FishingController.ts`** (a plain class the scene instantiates, holding the
bobber/biteMark/charge/timers state and the cast/release/reel logic moved out of BaseWorldScene).
This is the modularity win the audit called for. Then, inside it:
- On cast, keep the bobber but ALSO draw: (1) the rod — a small rod sprite in the player's hands
  angled toward the cast direction (either a `tool-held-rod` sprite from Task A2 or a dedicated
  cast pose), and (2) the **line** — a thin `Phaser.GameObjects.Line` (or Graphics) from the rod tip
  to the bobber, redrawn each frame so it tracks if the bobber dips/moves. Line depth just under the
  bobber. Remove all three (rod-in-cast-pose, line, bobber) on catch/escape/cancel.
- Bump the bobber render from 8×8 to a readable ~12×12 (it's currently `setDisplaySize(8,8)`,
  `:697`).

## TASK C — Retune fishing difficulty (real curve, still fair)
In `FishingSystem.ts`, make it a genuine skill check (keep it fair, not punishing):
- Start `progress` at **0.25** (not 0.4) so you actually have to fight.
- Shrink the zone: `ZONE_H` 32 → **~22**, and make it **narrow further for harder/rarer fish** (a
  per-fish `zoneMult`), so rare fish demand tighter control.
- Rebalance `GAIN`/`DRAIN` so a skilled reel wins but a sloppy one loses (e.g. GAIN 0.3→0.28,
  DRAIN 0.12→0.2 base). Keep the fish-wander model.
- Add a small **perfect-cast bonus**: a fuller charge (`castCharge`) grants a slightly higher
  starting progress or a wider zone — rewards the power-cast mechanic that already exists.
- Retune by PLAYING it via the seam in a loop until catch-rate feels right (~55–70% for a focused
  player on common fish, lower on rare). Document the target rates in the file header.

## TASK D — More fish, gated by season + water depth
- Expand `FISH` to ~8–12 species with varied `speed`/`drainMult`/`zoneMult`/`weight` and sell
  values (add to `Items.ts` ITEM_VALUES). Reference Stardew's fish variety for flavor names.
- Add gating fields per fish: `seasons: Season[]` and `minDepth` (how far the power-cast reached —
  `reach` in `releaseCast:736` already computes 1–4 tiles out; pass it to `startReel` so deeper
  casts unlock better fish, which the ROADMAP flagged as "later"). The weighted pick at hook-time
  filters to fish valid for the current season + achieved depth. **Fail loud** if the filtered set
  is empty (means a map has water with no valid fish — surface it, don't silently default).
- Generate the new fish icons (art-director, straight-on per Plan 01) — `icon-fish-<id>`.

## Seam additions
Expose enough to test difficulty deterministically: the fishing state already serializes
(`progress`, `zonePos`, `fishPos`, `fishId`). Add a seam helper `fishingReel(held: bool)` if the
reel input isn't already drivable one-step-at-a-time, and `castDir(dir, charge)` to force a cast for
tests. Keep additive.

## Ownership / guardrails
- YOU OWN: `HeldTool.ts`, `FishingController.ts` (new), `FishingSystem.ts`, the fish table in
  `Items.ts` values, new fish/rod art, the cast/reel render code moved out of BaseWorldScene.
- SHARED — re-read first, additive: `BaseWorldScene.ts` (remove fishing code as you extract it —
  this is a refactor, keep behavior identical + specs green), `Player.ts` (held-tool child),
  `Items.ts`, `DebugHooks.ts`, `gameHarness.ts`, `manifest.json` (surgical patches).
- FORBIDDEN: transition/camera/placement regression code; changing the day/stamina economy.

## SPECS (extend `tests/m12-workbench-fishing.spec.ts` + add `tests/m23-fishing-depth.spec.ts`)
1. **Held tool visible**: equip the axe, assert a held-tool sprite child exists on the player and
   shows the axe icon; switch to the pickaxe, it updates.
2. **Rod + line on cast**: cast at water; assert the line object + rod pose exist while the bobber is
   out, and all are removed after catch/escape.
3. **Difficulty**: with the new tuning, a spec that reels PERFECTLY (always in-zone) catches within
   N ticks, and one that reels never-in-zone escapes — proving gain/drain both bite.
4. **Fish gating**: force a shallow cast in spring → only shallow/spring fish are eligible; a deep
   cast unlocks a deep fish; empty eligible set throws (assert message). Keep m12 green (may need
   updating for the new starting progress — do it deliberately, note it).

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green. 3. Manual + screenshots: equip each tool (visible
   in hand), cast (rod + line + bobber all drawn), and play the reel to confirm it FEELS like a real
   catch, not a gimme. 4. Report: held-tool approach, FishingController extraction (lines moved out
   of BaseWorldScene), difficulty numbers + measured catch rate, fish roster, art ids, screenshots.
