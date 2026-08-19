# EXECUTION PLAN — Interior 2.0 + Enterable Town (Fable 5)

> Drafted by Opus for Fable-5 execution. Baseline: 47/47 specs green, typecheck clean.
> **Read `.claude/skills/game-systems` (esp. "Concurrency & liveness") + `game-art` + `playtest` first.**
> Run to completion in ONE continuous session. Queue ALL PixelLab art up front, build code while it renders.
> Verify at the end: `npm run typecheck` clean + `npx playwright test` fully green + screenshots you LOOK at.

## Baseline facts (already on disk — build on these, don't recreate)
- `src/systems/WeatherSystem.ts` EXISTS and is wired: `WeatherSystem.forDay(day)`, `.override(day,w)`,
  `.forecastLine(today)`. GameState has getters `weather` / `weatherTomorrow` (both serialized).
  Weather is a pure fn of (seed, day); day 1 sunny; RAIN_CHANCE 0.3.
- Interior rendering already exists: `BaseWorldScene.renderInterior()` draws wood floor/walls/door-mat
  for any all-`floor` map with `tile-floor-wood` + `tile-wall-wood` textures loaded.
- Placeable items: `ItemPlacementSystem` (place/itemAt/pickup/remove) + `GameState.placedItems` +
  `BaseWorldScene.spawnPlacedItem()` + `PLACEABLE` set in UIScene. Chests & workbench already work this way.
- Crafting: `CraftingSystem.RECIPES` (data), `station: 'none'|'workbench'`. Workbench opens a panel (E).
- Sleep flow: `BaseWorldScene.sleep(staminaFrac)` → advances day, `ShippingSystem.payout()`, sets
  `GameState.dialogue` to a morning summary string. `gameHarness.sleepInGame()` dismisses it via E.
- Home map: `buildHome()` in `src/world/MapDef.ts` (currently ~20x15, top 2 rows solid wall, bed at
  (3,3) 2x2 solid, chest at (w-4,3), door warp bottom-center → Farm 'from_home').

## TASK 1 — Rain auto-waters overnight (finish the WeatherSystem loop)
`WeatherSystem` is built but the RAIN EFFECT isn't applied. In `BaseWorldScene.sleep()`, AFTER the day
increments, if `WeatherSystem.forDay(gs.day) === 'rain'`: set every `gs.tiles[k]` that is `'tilled'` to
`'watered'` AND mark every `gs.crops[k].watered = true`. (This must run before `CropSystem.advanceDay()`
if that's what consumes `watered` — check the call order in sleep(); crops should grow on a rainy night
without manual watering.) Add a toast "It rained overnight — your crops are watered."
- Spec (add to a new `tests/m17-weather.spec.ts`): seam `setWeather(day, 'rain')` for tomorrow, plant+till
  (don't water), sleep, assert the crop advanced a stage and the tile reads 'watered'.

## TASK 2 — Stardew-style farmhouse interior (rebuild `buildHome`)
Research first: WebSearch "Stardew Valley farmhouse interior layout" (structure only). Then rebuild
`buildHome()` at **24x18**:
- Room read: keep the top 2 rows as solid wall band; add a kitchen corner (counter furniture, top-right),
  a rug in the center (non-blocking decor), a bed (top-left, 2x2 solid — reuse the existing bed handling),
  the chest near the bed, and a TV against the top wall.
- Furniture placed via `objects`/`decor` arrays or new object kinds. Bed keeps its E-to-sleep tiles.
- Door warp stays bottom-center → Farm 'from_home'. KEEP the farm-side door at (12-13,12).
- Art (queue up front, STRAIGHT-ON per game-art skill, "flat paper cutout" phrasing if a piece comes out
  angled): `furniture-table` (32x24), `furniture-chair` (16x20), `rug` (48x32, non-blocking), `tv` (32x28),
  `kitchen-counter` (48x28). Manifest: surgical python key patches only.
- Depth: all furniture bottom-anchored, `setDepth(y)`; rug at a low depth (walk over it).

## TASK 3 — The TV forecasts tomorrow's weather
Add a `tvs` Set<"tx,ty"> in BaseWorldScene (mirror the `workbenches`/`bins` pattern). Place the TV tile in
buildHome. On E facing a TV tile: `gs.dialogue = { name: 'TV — Weather', line: WeatherSystem.forecastLine(gs.day) }`.
- Spec (m17): warp to Home, face the TV, E, assert `state().dialogue.line` contains 'sunny' or 'rain'
  matching `state().weatherTomorrow`.

## TASK 4 — Furniture as craftable placeable/pickupable items
- Add recipes to `CraftingSystem.RECIPES` (station 'workbench'): table (12 wood), chair (6 wood),
  rug (8 fiber). yields = item ids 'table'/'chair'/'rug'.
- Add these to `PLACEABLE` (UIScene) + `spawnPlacedItem()` (BaseWorldScene) + `ItemPlacementSystem`
  (rug is walk-over: place it but DON'T add collision or block the tile for other placement — give it a
  `blocking: false` path; table/chair block 1 tile like a chest). Break/pickup with axe → DroppedItem, same
  as chests (extend the axe-pickup branch's item list beyond 'chest').
- Add item labels/icons metadata in UIScene ITEM_META + ITEM_ORDER; generate small inventory icons OR reuse
  the object art scaled to 28px.
- Spec (m18-furniture): craft a table at a workbench, place it, confirm it blocks (collision) + persists in
  `placedItems`; place a rug and confirm you can stand on its tile; axe the table → it drops → collect.

## TASK 5 — Full end-of-day SELL SCREEN (replace the morning dialogue)
Replace the `gs.dialogue` morning summary with a proper overlay panel in UIScene.
- New `GameState.daySummary: { lines: {item,label,qty,unit,total}[]; grand: number; gold: number } | null`
  (serialized). `BaseWorldScene.sleep()` builds it from what `ShippingSystem.payout()` sold BEFORE clearing
  the bin — so capture bin contents + ITEM_VALUES into the summary, then payout.
- UIScene: a `daySummaryPanel` (title "Day N — Shipping", per-item rows with icon+name+"qty x unit = total",
  a divider, "Total: Xg", "Gold: Yg"), visible when `gs.daySummary` is non-null, dismissed by E/click which
  sets `gs.daySummary = null`. While open it blocks other input like the chest panel does.
- Update `gameHarness.sleepInGame()`: after `sleep()`, if `daySummary` present, dismiss via E (send 'interact');
  keep it robust whether or not there was anything to sell.
- Spec (m19-sellscreen): give 3 wood + 2 parsnip, open bin, deposit both, sleep, assert
  `state().daySummary.grand === 3*2 + 2*35` and after dismiss `daySummary === null` and `gold` updated.

## TASK 6 — Enterable Store + Tavern
The town has building facades `building-store` and `building-tavern` (in `buildTown()`). Add door warps + interiors.
- In `buildTown()`: add a warp on each building's door tile → new scenes 'StoreInterior' / 'TavernInterior'
  at spawn 'entry'. (Find the facades' tx/wTiles; the door is centered on the bottom row of each footprint.)
- Add `SceneKey.StoreInterior='StoreInteriorScene'`, `SceneKey.TavernInterior='TavernInteriorScene'` to
  AssetKeys + WORLD_SCENE_KEYS. New thin scene classes (copy FarmScene pattern) in src/scenes/. Register in
  src/main.ts scene array.
- `buildStoreInterior()` / `buildTavernInterior()` in MapDef: small all-`floor` rooms (get the room treatment
  free via renderInterior), a door warp back to Town 'from_store'/'from_tavern' spawns, furniture decor
  (store: counter + shelves; tavern: bar + tables). Empty of NPCs (relationships wave adds keepers).
- Spec (m20-buildings): teleport onto the store door warp → poll activeScene === 'StoreInteriorScene',
  player finite/in-bounds; walk back out → Town. Same for tavern.

## Ownership / guardrails
- YOU OWN: src/world/MapDef.ts, src/scenes/*, src/state/GameState.ts, src/systems/* (except src/combat/*
  which the dungeon wave owns — do NOT create/edit combat), src/config/Items.ts, src/config/Crops.ts,
  src/debug/DebugHooks.ts, tests/*, scripts you create, public/assets (manifest = surgical patches).
- KEEP GREEN: every existing spec's intent. Protected coords: farm door (12-13,12), bin (18,13), chest (16,20),
  all farm/forest/beach/mountain/mines warps, town west warp, NPC spawns. Don't touch Mines map/warps.
- Extend the seam (DebugHooks + gameHarness SeamState) for anything new a spec drives: setWeather, daySummary,
  tvs/furniture. Keep GameState serializable.

## Final verification (all must pass before declaring done)
1. `npm run typecheck` → 0 errors.
2. `pkill -f vite; npx playwright test` → ALL green (47 existing + your new m17-m20).
3. Screenshots (scripts/screenshot pattern, port 5273) and LOOK: new farmhouse interior, the sell screen with
   ≥2 item lines, the store interior. Fix anything that overlaps/floats/misreads.
4. Report: files changed, art ids + generations used, new spec names, suite result, screenshot paths.
