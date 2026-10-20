# ShopkeepersLegacy — Game Spec (V1)

> **History.** This is the original build spec, kept for history. The current state lives in
> [VISION](VISION.md), [START_HERE](handbook/START_HERE.md) and the [README](../README.md).

> Historical V1 design. For the installed game and later user decisions, read
> [START_HERE](handbook/START_HERE.md). Do not remove later hospitality, town, or appearance work
> to restore this initial milestone's limits.

> This is the spec the build agent follows. It is structured in the same order the video
> creator (Mansel Scheffel) used: Definition of Done → Tech Contract → Controls → Worlds &
> Scenes → Systems → Art Integration → Build Order → Self-Verification. It is tailored to
> **ShopkeepersLegacy** and scoped to **V1 (Stardew core)**. Read `CLAUDE.md` for the HOW-rules.

## Full-game vision (context — NOT all in V1)
**Current direction, confirmed 2026-09-10:** the inherited tavern is the core progression hub.
The **mines** and **dungeon** are distinct: Stardew-style mining levels and ore progression,
versus Moonlighter-style dungeon rooms, combat and loot risk. Neither replaces the other.
The tavern chapter is specified in `docs/plans/PLAN-tavern-opening.md`. The current interface and
cosmetic wardrobe pass is specified in `docs/plans/PLAN-cozy-interface.md`; it does not expand gameplay.

**Shop/home direction, confirmed 2026-09-12:** the inherited building should suit different shop
types, not look permanently branded as a tavern. The current pass adds a raised, layered porch,
an animated walk-in door, and a private rear bedroom while keeping the existing tavern service.
Guest-only stairs reserve future inn activity; bookings, NPC lodging, shop selection, and a
player-accessible upstairs are not implemented in this pass. Save v4 adds explicit compatibility
for old Farm positions inside the new porch solids. All 140 regression tests pass, but Jeff's
playtest leaves visual quality, HUD coverage, door timing, and conventional title actions open.
The subsequent interior foundation pass uses researched Travellers Rest/Necesse direction:
mostly open rooms, native timber/plaster surfaces, whole-tile furniture footprints, cardinal
rotation, a compact task badge, faster walk-in entry, and conventional title/settings navigation.
Save v5 stores rotation; old expanded table/rug placements recover into the bag or persistent drops.
Bar counters and registers are furnishing, not movable working service stations yet.
All 162 tests, typecheck and build pass; Jeff's visual approval remains open. Current evidence
and limits are in `docs/playtest-reports/2026-09-12-interior-foundation.md`.
See `docs/plans/PLAN-interior-foundation.md` for the bounded scope. Earlier porch evidence is in
`docs/plans/PLAN-shop-home.md` and `docs/playtest-reports/2026-09-12-shop-home.md`.
The V1 sections below remain the historical base contract, not a list of all current scenes.

**Player-built shop, 2026-09-12:** the room now starts with architecture only. Furniture follows
the mouse throughout visible clear floor; full footprints, player overlap, HUD and doorway routes
guard placement. Bag-craft a workbench, then craft/place a register, bar and stove. Those placed
stations now own restoration, opening, cooking and serving. Active service locks the layout.
Save v6 migrates older expanded workbenches and newly blocked entrances explicitly, preserving
items and progress. Crafting uses the cozy inventory style; shared text uses actual display
resolution. Original stone/oak architecture and lower furniture replace the rejected first pass.
The vertical table retains its prior art after its new candidate fails visual review. Visual
approval remains with Jeff. See `plans/PLAN-player-built-shop.md` and its playtest report.

**Follow-up direction:** Jeff replaces alternate table views with literal90° image rotation for
the table and workbench only. Both use their same native image at0°/90° and swap grid footprints.
Interior cameras now reserve space above the toolbar so the south exit stays visible on approach.
World zoom, outdoor views and the other furniture remain unchanged. See `plans/PLAN-literal-rotation-exit.md`.

Stardew Valley (near 1:1 base mechanics) crossed with Moonlighter (shop management + dungeons).
You inherit a rundown plot/building from your grandpa, move to town, clear the overgrown land,
and farm. As you earn money you **buy/build different shop types** (tavern/inn, potions,
blacksmith, farm) from the town carpenter — growing a "shop empire." Endgame: hire and manage
employees, or go work your favorite shop yourself. Town, mines, beach, and a dungeon are
explorable. **V1 delivers only the Stardew core loop below.** The tavern/inn shop is Prompt 2.

---

## 1. Definition of Done (V1)
V1 is DONE when all of the following are true and verified by Playwright + a manual playtest.
Each maps to a regression/feature spec.

1. **Big map + camera:** The player walks around a large map (≥ ~100×100 tiles) with WASD, and
   the camera smoothly follows and stays centered on the player, clamped to map bounds. The
   player cannot walk off the map.
2. **Scene transitions never lose the player:** Walking through a warp from Farm → Town (and
   back, and into the Home interior) transitions scenes with the player present, at a valid
   named spawn, inside the destination map bounds. *The player never vanishes.*
3. **Tool hotbar:** The player selects a tool from a hotbar (keys 1–8); the active tool is shown.
4. **Stamina:** Using tools drains stamina; sleeping restores it. Stamina is visible in the UI.
5. **Clear the land:** Using the right tool on the right node works — axe fells a tree (→ wood),
   pickaxe breaks a rock (→ stone/ore), scythe clears a weed. Wrong tool does nothing.
6. **Farming loop:** Hoe tills soil → plant a seed → water it → it grows over in-game days →
   harvest yields a crop into inventory.
7. **Inventory:** The player can open/close an inventory, and items collected (wood, crops, etc.)
   appear with correct counts.
8. **Chests:** The player can deposit items into a chest and withdraw them; counts round-trip correctly.
9. **Day/night + day rollover:** Time visibly advances; the screen tints toward night; sleeping
   advances to the next day, restores stamina, and advances planted crops one growth step.
10. **Tile-valid building placement:** The player can place a building only on valid, unoccupied,
    buildable tiles; invalid placements are rejected with a red ghost; valid ones persist in
    `GameState.placements`. *(This is the seam the Prompt-2 shops build on.)*

---

## 2. Tech Contract
- **Engine:** Phaser 3 (3.8x). **Language:** TypeScript, `tsconfig` `"strict": true`.
- **Bundler/dev server:** Vite (start from `template-vite-ts`).
- **Runs in:** the browser. `npm run dev` serves it; the build is static.
- **Maps:** authored in **Tiled** as `.tmj` (maps) + `.tsj` (tilesets), imported by Phaser.
  *(Historical: maps are now built in `src/world/MapDef.ts` from TS data and JSON; no Tiled files remain.)*
  Maps are DATA, not TypeScript. Warp triggers, spawn points, collision, and the `buildable`
  layer are all authored in Tiled.
- **World scale:** 16px tiles; farm map ≥ ~100×100 tiles. `GameConfig` holds tile size, map
  dims, zoom, physics settings.
- **Rendering:** `pixelArt: true`, `roundPixels: true`, Arcade physics.
- **Determinism for tests:** all RNG seeded from a `seed` URL param.
- **No hand-rolled** game loop, camera, tilemap parser, or scene manager — use Phaser's.
- **No silent fallbacks** anywhere (see `CLAUDE.md`). Missing data throws.

---

## 3. Controls
- **Move:** W A S D (and/or arrow keys). Player faces the last-moved direction.
- **Use active tool / action:** left-click on the targeted (facing) tile, or a key (e.g. Space).
- **Interact** (chests, doors, NPCs, sign): E.
- **Hotbar select:** number keys 1–8.
- **Toggle inventory:** I (or Tab).
- **Shop ledger:** M opens the shop ledger in the player's tavern.
- **Sold out:** Q tells a waiting guest "We're out" when the order can't be served.
- **Combat:** Shift dodges (Space swings when the sword is active).
- **Pause / appearance:** Escape opens Pause. In Pause, R opens Town Bonds and M opens World Routes.
  Appearance edits a draft; Apply changes the keeper,
  while Cancel or Escape discards the draft. Save Game or sleep persists the applied appearance.
- **Inventory keyboard:** arrows inspect pockets, Enter picks up/drops a slot, Space uses its action,
  and C crafts a workbench. In chest/shipping menus, Tab switches panels and Enter moves a stack.
- **Furniture:** inspect a crafted furnishing in the bag and choose Place in World. R rotates;
  Space or an adjacent mouse click places; E cancels. Axe/pickaxe returns it as a collectible drop.
- **Task details:** J expands or closes the compact objective badge.
- **Sleep:** interact with the bed in the private rear bedroom.
Controls route through an `InputBus` so Playwright can emit the same actions via `window.__TEST__.input(...)`.

---

## 4. Worlds & Scenes (V1)
Authored as separate Tiled maps, each backed by a scene extending `BaseWorldScene`:
- **FarmScene** — the inherited plot: overgrown with trees, rocks, and weeds to clear; tillable
  soil; the player's house (enters Home interior); a chest; a warp to Town. This is the start scene.
- **TownScene** — a town area reachable from the Farm warp, with room for NPCs/shops/carpenter
  later. V1 just needs it to exist and be walkable so the transition is real and testable.
- **HomeInteriorScene** — inside the house: a bed (sleep → next day) and a chest. *(Now: the bed is
  in `BedroomScene`, the keeper's private room; `HomeInteriorScene` is kept only for old saves.)*
- **UIScene** — runs in parallel as an overlay (hotbar, stamina bar, clock). Never blocks the world scene.

Later (not V1): shop interiors, mines, beach, dungeon. *(Now: all of these exist — `TavernScene`,
the town rooms, `MinesScene`, `BeachScene`, `GatePlazaScene` and `DungeonScene`.)*

**Transition contract:** every warp is a Tiled trigger zone with `target` (scene key) + `spawn`
(named spawn id) properties. `SceneTransitionSystem` is the only code that changes scenes.

---

## 5. Systems (V1)
Each is an isolated module in `src/systems/` (or `src/state/`), independently testable via the state seam.
- **TimeSystem** — in-game clock; advances during play and via `stepTime()`; fires day-rollover.
- **StaminaSystem** — current/max stamina; tool use costs stamina; sleep restores to max.
- **FarmGridSystem** — per-tile soil state (untilled / tilled / watered) keyed by tile coords.
- **CropSystem** — planted crops with growth stages; advance one stage per day; harvest yields item.
- **InventorySystem** — the player bag + hotbar + chest storage; add/remove/move items with counts.
- **ToolSystem** — the set of tools, the active tool, and each tool's effect on a target tile/node.
- **InteractionSystem** — resolves the facing/targeted tile; dispatches chop/mine/clear/till/plant/water/interact.
- **SceneTransitionSystem** — the single warp authority (validate key → named spawn → framed
  fade → recreate player → `startFollow`). See `CLAUDE.md` Hard Rule 1.
- **PlacementSystem** — tile-validated building placement with ghost preview. See `CLAUDE.md` Hard Rule 5.
- **GameState** (`src/state/`) — the single serializable source of truth: `{ day, timeOfDay,
  player:{x,y,facing,stamina}, activeScene, inventory, hotbarIndex, tiles, crops, placements }`.
  `serialize()` feeds the test seam and (later) save/load.

---

## 6. Art Integration (PixelLab via MCP)
*Historical: PixelLab is retired. New art now comes from painted areas and `tools/keeper-art`;
see `docs/handbook/ART_WORKFLOW.md`.*
- Real pixel art is generated by **PixelLab** through its **MCP server** (registered as `pixellab`).
- **Before generating anything, read `https://api.pixellab.ai/mcp/docs`** to understand the tools
  and parameters (so no credits are wasted). See `docs/PIXELLAB_GUIDE.md` for the tool reference
  and `docs/ART_BIBLE.md` for the canonical style (palette, 16px tiles, 3/4 top-down, 4-direction).
- **Style-test first, then batch:** generate the farmer (4-direction) + grass/dirt/tilled tiles +
  one tree + one rock; drop them into `manifest.json`; look at them together; lock the style; only
  then batch-generate the rest (crop growth stages, more terrain transitions, other nodes, UI icons).
- **Pipeline into Phaser:** character walk frames → one spritesheet PNG per character (rows =
  down/up/left/right, cols = frames) loaded via `load.spritesheet`, animations built in `PreloadScene`.
  Tilesets → tileset PNG referenced by a Tiled `.tsj`, wired into the maps. Objects/UI → individual
  PNGs (or a small atlas) by key. **All wiring is data:** `manifest.json` + Tiled files. Game code
  only ever names a logical key (see `CLAUDE.md` Hard Rule 4).
- **Placeholders → art with zero logic change:** each key starts as a colored-rect placeholder
  (`PlaceholderFactory`) and is swapped to a PixelLab PNG by editing one manifest entry.

---

## 7. Build Order (V1 milestones — each independently Playwright-gated)
Highest-risk items first, so the transition/camera/big-map are proven before systems pile on.
- **M0 — Skeleton & seam.** Vite+TS+Phaser boot, empty FarmScene, `DebugHooks` exposes
  `window.__TEST__` (`ready`, `state`). *Verify:* `ready===true`, active scene = Farm.
- **M1 — Big map + player + camera** (placeholders). Large Tiled farm map, rect player, WASD via
  InputBus, `startFollow` + camera/physics bounds + a collision layer. *Verify:* player moves;
  camera tracks within deadzone; player can't leave bounds. **Proves the camera + map-size fixes.**
- **M2 — Scene transitions.** Town + Home maps, `SceneTransitionSystem`, Tiled named spawns +
  warp triggers. *Verify:* warp Farm↔Town: player non-null, finite, in-bounds, correct active
  scene. **Proves the vanishing-player fix — build nothing else until this spec is green.**
- **M3 — Tools + stamina + hotbar + interaction.** UIScene hotbar/stamina; facing-tile targeting;
  chop/mine/clear placeholder nodes → stamina cost + item drop. *Verify:* select tool, use on node,
  node changes, stamina drops, item added.
- **M4 — Farming loop.** FarmGrid + Crop: till→plant→water→grow (via `stepTime`)→harvest.
  *Verify:* tile states advance, harvest yields inventory item.
- **M5 — Inventory + chests.** Bag + chest transfer. *Verify:* deposit/withdraw round-trips counts.
- **M6 — Time / day-night + rollover.** Clock, night tint, sleep→next day (restores stamina,
  advances crops). *Verify:* `stepTime` to next day rolls `day`, restores stamina, advances crops.
- **M7 — Building placement.** Tile-valid ghost preview → `GameState.placements`. *Verify:* invalid
  rejected, valid persist. **The seam Prompt-2 shops plug into.**
- **M8 — Art pass.** PixelLab style-test → lock → batch → swap manifest placeholders for PNGs +
  wire Tiled tilesets. *Verify:* all logic specs still green (art changed no geometry) + screenshot
  baselines catch overlap/z-order.

---

## 8. Self-Verification Protocol
- Use **Playwright** against the `window.__TEST__` seam (see `CLAUDE.md`). Boot `?test=1&seed=42`.
- Read state with `page.evaluate(() => window.__TEST__.state())`; drive input with `input(...)`;
  advance time with `stepTime(...)`. No wall-clock, no arbitrary sleeps.
- **Every milestone above has its own spec** and must be green before the next milestone starts.
- **Permanent regression gates** (encode the last attempt's failures): `scene-transition.spec.ts`,
  `camera-follow.spec.ts`, map-bounds, `placement.spec.ts`. These must never regress.
- **Art checks:** after M8, screenshot baselines on framed deterministic scenes confirm sprites/
  tiles don't overlap incorrectly. Keep art specs separate from logic specs.
- Loop **build → test → fix → test** on each milestone. Fix root causes; if a theory fails twice,
  reassess. Do not declare a milestone done on a failing or partial state.

---

## Pivot clause
Follow this spec, **or propose improvements and pivot** as needed to best hit the Definition of
Done — as long as you respect the Hard Rules and the no-silent-fallbacks discipline in `CLAUDE.md`.
If you deviate, say what you changed and why.
