# PLAN 02 — Save/load + main menu + pause menu (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `.claude/skills/game-systems` first** (esp. scene
> lifecycle + the seam). Baseline after Plan 01: specs green, typecheck clean.
> Standing rules (the designer): API/MCP-first, modular, doc-comment every class/fn/method, no silent
> fallbacks, read-before-change, verify-before-done.

## Why this is Plan 02
The designer: *"I want a pause menu, main menu, and implement saving and loading."* Today there is **zero
persistence** — a page reload wipes the whole game — which makes your own iterative testing
painful. This is deliberately early: it's low-risk (no art dependency) and it protects your test
progress from here forward. The hard part is already done: `GameState.serialize()`
(`GameState.ts:202-237`) is a complete, JSON-safe snapshot and is explicitly noted as "already the
save format." This plan is mostly wiring + a matching `deserialize`.

## ARCHITECTURE (all new + one GameState addition)
### A — `src/systems/SaveSystem.ts` (new)
The single authority for persistence. Doc-comment every method.
- `SAVE_VERSION = 1` and `SAVE_KEY_PREFIX = 'shopkeepers-save-'`. **Versioned** — a snapshot stores
  `{ version, savedAt, state }`. On load, if `version !== SAVE_VERSION`, **fail loud** with a clear
  message (no silent migration guessing — surface it so we write a real migration when the shape
  changes). This respects "no fallbacks."
- `save(slot = 0): void` — `localStorage.setItem(key(slot), JSON.stringify({version, savedAt: <passed-in timestamp>, state: GameState.instance.serialize()}))`.
  NOTE: `Date.now()` is fine in game code (only workflow scripts forbid it); use it for `savedAt`.
- `load(slot = 0): boolean` — read + parse; if absent return false; if version mismatch throw;
  else `GameState.instance.deserialize(snapshot.state)` and return true.
- `hasSave(slot = 0): boolean`, `listSaves(): Array<{slot, savedAt, day, season, gold}>` (peek
  metadata for the Continue screen without fully loading), `deleteSave(slot)`.
- **Do not** auto-save mid-frame; autosave hooks in Task D at safe points (sleep, scene change).

### B — `GameState.deserialize(snapshot)` (new, in `GameState.ts`)
Mirror `serialize()` exactly — restore every field it writes (day, season, timeOfDay, activeScene,
player, hotbarIndex, inventory, selectedSeed, canWater, chest, tiles, crops, treeStages,
removedNodes, placements, placedItems, placingItem, all the `*Open` booleans → force false on load,
bin, gold, hp/maxHp/invuln/dodge, weather/weatherTomorrow, fishing→null on load, dialogue→null,
daySummary→null). **Fail loud** if a required field is missing (throw naming it) — a corrupt/old
save must not silently boot a half-broken world. Add a test asserting `deserialize(serialize())` is
a round-trip identity for a mutated state.

### C — `src/scenes/MainMenuScene.ts` (new) + boot wiring
- New scene: title, **New Game** (→ `GameState.reset()` then start Farm), **Continue** (enabled
  only if `SaveSystem.hasSave()`; loads then starts `snapshot.activeScene`). Keyboard + mouse
  navigable. Styled per the art rules (cozy, readable) — a simple painted/solid title card is fine
  for V1; art-director can do a proper title image later.
- `main.ts` (`:54-67`): register `MainMenuScene`; `PreloadScene` (`PreloadScene.ts:38-39`) currently
  hard-starts Farm — change it to start `MainMenuScene` instead (launch UIScene only once a world
  scene starts, not on the menu). **In test mode (`?test=1`) skip the menu and boot straight into
  Farm** so all existing specs stay green (they assume Farm is the boot scene). Gate on
  `isTestMode()`.

### D — Pause overlay (Esc) + autosave hooks
- Add a pause path. Cleanest without bloating BaseWorldScene: a small `PauseOverlay` rendered by
  `UIScene` off a `GameState.paused` boolean (UIScene is already the pure render-from-state overlay
  — `UIScene.ts:616-706`). Esc toggles `paused`; while paused, freeze the world (pause the active
  world scene's update via `this.scene.pause()` from a manager, or gate BaseWorldScene.update on
  `!GameState.paused` — pick the lower-risk one after reading the scene manager usage). Overlay
  buttons: **Resume**, **Save** (`SaveSystem.save()` + toast), **Quit to Title**
  (`MainMenuScene`). Esc must NOT open when a modal panel (inventory/chest/crafting/bin/dialogue)
  is up — check those booleans first, matching the existing modal-priority pattern.
- **Autosave** at natural Stardew save points: on `sleep()` (end of day) and optionally on scene
  transition. Call `SaveSystem.save()` there. Keep it explicit and logged, not hidden.

## Seam additions (DebugHooks + gameHarness)
- `save()`, `load()`, `hasSave()`, `setPaused(bool)` on `window.__TEST__` so specs can drive
  persistence deterministically. Add `paused` to the serialized state (and `SeamState`) so the
  pause spec can assert it. Keep the seam shape stable/additive.

## Ownership / guardrails
- YOU OWN: `SaveSystem.ts`, `MainMenuScene.ts`, the pause overlay in `UIScene.ts`, the boot wiring
  in `main.ts`/`PreloadScene.ts`, `GameState.deserialize` + the `paused` field.
- SHARED — re-read first, additive: `GameState.ts`, `DebugHooks.ts`, `tests/helpers/gameHarness.ts`.
- FORBIDDEN: gameplay-logic rewrites, the transition/camera/placement regression code, MapDef.

## SPECS (add `tests/m22-save-menus.spec.ts`)
1. **Round-trip**: boot, mutate state (give items, till a tile, set gold/day), `save()`, reload the
   page, `load()`, assert the serialized state matches the pre-save snapshot (minus the volatile
   fields forced to null/false).
2. **Continue vs New**: with a save present, the menu's Continue path restores day/gold/scene; New
   Game path resets to day 1.
3. **Pause**: Esc sets `paused` true and the world clock does not advance while paused (step time,
   assert `timeOfDay` unchanged); Resume clears it. Esc does nothing while the inventory modal is
   open.
4. **Version guard**: hand-write a localStorage blob with `version: 999`; `load()` throws a clear
   error (assert the message), does not boot a broken world.
Keep all prior specs green (test mode skips the menu → Farm boot unchanged).

## Final verification
1. `npm run typecheck` → 0. 2. Full suite green (prior + m22). 3. Manual: `npm run dev` → title
   screen → New Game → play → Esc pause → Save → reload → Continue restores. Screenshot the title +
   pause overlay. 4. Report: SaveSystem API, deserialize coverage, menu/pause wiring, autosave
   points, specs, screenshots.
