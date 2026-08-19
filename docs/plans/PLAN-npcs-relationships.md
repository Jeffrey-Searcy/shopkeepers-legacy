# PLAN 06 — More NPCs + the relationship system (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `game-systems` first; follow `game-art` for
> portraits/sprites.** Baseline after Plans 01–05: green. Standing rules (the designer): API/MCP-first,
> **data-first** (NPCs/dialogue/tastes as JSON), modular, doc-comment everything, no silent
> fallbacks, read-before-change, verify-before-done.

## Why / what the designer said
> *"We still need to implement the different characters and relationship system."* Plus his earlier
> spec (ROADMAP): Stardew model — talking once/day raises friendship (capped once/day); GIFTS raise
> it more, but each NPC has hidden likes/dislikes you must DISCOVER; dialogue varies with heart
> level; daily flags reset on sleep.

## Current reality (audit)
**Zero relationship code.** Two NPCs (Rosa, Old Finn) in Town only, each with 3 static rotating
lines (`MapDef.ts:476-500`, `Npc.ts`), wander/idle + talk-on-E, no day/heart variation, none inside
interiors. `GameState` has no `friendships` field. Fully spec'd, unbuilt.

## Research → Stardew relationship model (the target)
- Friendship measured in **points → hearts** (each heart = a points threshold). Talking once/day
  gives a small bump (capped). **Gifts** give the real movement, scaled by the NPC's **hidden taste**
  for that item (love/like/neutral/dislike/hate → big+ / + / small+ / − / big−). Discovering tastes
  is the meta-game. Dialogue and events unlock at heart thresholds.
- Daily flags (`talkedToday`, `giftedToday`, gift-count-this-week) **reset on sleep**.

## TASK A — Data-first content (JSON packs)
Create `public/data/npcs.json` (or `src/content/npcs.ts` if you prefer typed-at-build; **prefer
JSON loaded via the manifest so it's swappable like art** — API/data-first per the designer). Shape,
doc-commented:
- `npcs[]`: `{ id, name, home: SceneKey, spawn: {tx,ty}, portrait: texKey, sprite: texKey,
  schedule?: [...], tastes: { love:[itemIds], like:[...], dislike:[...], hate:[...] },
  dialogue: { default:[...], heart2:[...], heart4:[...], heart6:[...] } }`.
- Tastes are **hidden from the player** (never surfaced in UI); dialogue arrays are chosen by
  current heart level, falling back to `default`. **Fail loud** if an NPC refers to a missing
  portrait/sprite/dialogue key at load (throw) — no silent blank NPCs.
- Author a starter roster (~5–7): the store keeper, the tavern keeper (both live in their Plan-04
  interiors), plus a few townsfolk with distinct personalities. Give each a unique taste table +
  heart-tiered dialogue.

## TASK B — `GameState.friendships` + `RelationshipSystem`
- Add to `GameState` (serialize + deserialize — Plan 02): `friendships: Record<npcId, { points:
  number, hearts: number, talkedToday: boolean, giftedToday: boolean, giftsThisWeek: number }>`.
  Doc-comment the shape.
- New `src/systems/RelationshipSystem.ts` (pure logic over GameState), doc-comment every method:
  - `talk(npcId)` → if `!talkedToday`, add the daily chat points, set flag; return the heart-tiered
    dialogue line. If already talked, return a "already chatted" line (no points).
  - `giveGift(npcId, itemId)` → if `!giftedToday` (and under the weekly cap), consume the item,
    look up the hidden taste, apply the scaled point delta, recompute hearts, set flags; return the
    NPC's reaction line by taste tier. Loud error if the NPC/item is invalid.
  - `pointsToHearts(points)` / heart thresholds as documented constants.
  - `onNewDay()` → reset `talkedToday`/`giftedToday` (weekly counter on the 7-day boundary). Wire
    into the existing sleep/new-day path (where crops advance).

## TASK C — Wire NPCs to the system + gift input
- `Npc.ts`: on E, route through `RelationshipSystem.talk` instead of the static rotating line;
  show the returned line in the existing dialogue box. Spawn NPCs from `npcs.json` into their `home`
  scene (townsfolk in Town, keepers in their interiors — the Plan-04 handoff).
- **Gift flow** (the designer's spec): select an item in the bag, then E on an NPC → `giveGift`. Reuse the
  existing "select item then act" pattern used by item-placement (`startPlacing`) so input stays
  consistent. If no item selected, E = talk.
- **Hearts UI**: render the NPC's current hearts on the dialogue box (UIScene, from
  `GameState.friendships`). Hidden tastes never shown.

## TASK D — (Optional, note as stretch) simple schedules
If time allows, a lightweight time-of-day schedule (NPC at counter during shop hours, home at night)
driven by `schedule` data + `TimeSystem`. If cut, leave the `schedule` field parsed-but-unused and
note it — don't half-build it silently.

## Ownership / guardrails
- YOU OWN: `npcs.json` + its loader, `RelationshipSystem.ts`, `GameState.friendships`, `Npc.ts`
  wiring, the hearts UI in `UIScene`, the gift-input path, NPC spawn placement.
- SHARED — re-read first, additive: `GameState.ts` (friendships + serialize/deserialize — coordinate
  with Plan 02's deserialize), the sleep/new-day hook, `manifest.json` (portraits/sprites + the json
  data entry), `DebugHooks.ts`/`gameHarness.ts` (seam: `talk`, `giveGift`, read friendships).
- FORBIDDEN: the transition/camera/placement code; map outdoor layouts (Plan 05) except NPC spawns.

## SPECS (add `tests/m26-relationships.spec.ts`)
1. **Talk once/day**: talk raises points once; a second talk same day adds nothing; after sleep it
   works again.
2. **Gift tastes**: give a loved item → big point jump + love reaction; a hated item → point drop +
   hate reaction; giftedToday blocks a second gift that day.
3. **Hearts threshold**: accumulate points → hearts increments at the documented thresholds; dialogue
   switches to the higher-heart array.
4. **Persistence**: friendships survive save→reload (ties Plan 02) — round-trip a mid-heart NPC.
5. **Loud failure**: an NPC def with a missing dialogue key throws at load (assert message).
Keep prior specs green (the 2 old NPCs migrate into the data roster).

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green. 3. Manual: talk to each NPC (heart-tiered lines),
   gift a loved vs hated item (reactions differ), watch hearts rise, sleep + confirm daily reset,
   save/reload keeps hearts. Screenshot the dialogue box with hearts. 4. Report: NPC roster + taste
   design, RelationshipSystem API, gift-input reuse, hearts UI, specs, screenshots.
