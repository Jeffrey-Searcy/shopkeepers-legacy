# Engineering and verification

## Read the owner, then change the smallest coherent slice

| Concern | Current source owners |
| --- | --- |
| World/scenes/arrival | `src/world/MapDef.ts`, `TownMap.ts`, `src/scenes/BaseWorldScene.ts`, `src/systems/SceneTransitionSystem.ts` |
| Town architecture | `src/config/TownBuildings.ts`, `CivicFeatures.ts`, `src/world/TownArt.ts`, `CivicRoomArt.ts`, `PaintedRoomRenderer.ts`, `CivicInteriorMap.ts`, `CivicDecor.ts`, `src/scenes/CivicInteriorScene.ts` |
| Fixed residents | `src/config/TownResidents.ts`, `TownSchedules.ts`, `src/entities/TownResident.ts`, `src/systems/TownScheduleSystem.ts`, `TownSocialLifeSystem.ts`, `AppearanceTextureSystem.ts` |
| Resident chat/justice | `src/systems/LocalNpcChatSystem.ts`, `ResidentDialogueSystem.ts`, `JusticeSystem.ts`, `scripts/npc-chat-supervisor.mjs`, `src/entities/TownGuard.ts`, `src/scenes/JailScene.ts` |
| Private romance | `src/config/Cuddle.ts`, `src/systems/CuddleSystem.ts`, `src/world/CuddleEffectRenderer.ts` |
| Customers/inn/tavern | `src/config/Tavern.ts`, `TavernConversations.ts`, `src/systems/TavernSystem.ts`, `TavernLayout.ts`, `src/ui/GuestServicePrompt.ts` |
| Furniture | `src/config/Furniture.ts`, `FurnitureConnections.ts`, `src/world/FurnitureSurfaceRenderer.ts`, `src/systems/ItemPlacementSystem.ts` |
| Player/tools | `src/entities/Player.ts`, `src/systems/HeldItemView.ts`, `ToolSystem.ts` |
| Persistence | `src/state/GameState.ts`, `src/systems/SaveSystem.ts`, `TownLayoutMigration.ts`, `FarmLayoutMigration.ts` |
| Editor | `src/debug/MapEditorMode.ts`, `TownLayoutDraft.ts`, `FarmLayoutDraft.ts`, `src/scenes/MapEditorScene.ts` |
| UI | `src/ui/CozyTheme.ts`, `TextRendering.ts`, `UILayout.ts`, affected menu; `src/scenes/UIScene.ts` |

Same-directory shortened names in this table refer to the directory of the most recent full path in that cell.
Read actual callers; the table is navigation, not an API contract. Existing world composition uses authored
TypeScript/JSON MapData as well as historical Tiled sources. Do not rewrite it to satisfy an obsolete V1 note.

## Fragile contracts worth preserving

- Shared scene transitions validate enum keys and named spawns. Do not add direct scene starts.
- Player movement, interaction and depth use feet. Keep the 8×6 player body independent from outfit/facade art.
- Phaser static `updateFromGameObject()` can reset a custom body to full sprite bounds. Read the existing
  `setSize`/position/`updateCenter` pattern. Do not reintroduce full-canopy collision.
- Digit input uses Phaser key names such as ONE/TWO. Test real keyboard/mouse paths, not only seam helpers.
- Warp cells carve border collision. Test routes, returns, bridges, camera bounds and doorway approach direction.
- Public room features stay town-owned; player placement/pickup is blocked there. Player rooms are separate.
- Resident presentation must not change resident IDs, payments, bookings or other actors' textures.
- Saved state validates detached candidates before installation. Save reads do not mutate slots. Older map
  versions validate against their historical geometry before narrow relocation and current validation.
  Preserve exact old-slot backup bytes before replacing a slot. A bad backup/load fails explicitly.
- Check migration needs for new scene keys, solid cells, footprints and active saved player positions—not
  just new fields. Read old-version tests before incrementing SAVE_VERSION or loosening validation.
- Keep private-event runtime state outside saves. Validate resident jail release days in save candidates and
  preserve the byte-exact v15 backup before the first v16 write. The current `SAVE_VERSION` is 30; that
  backup step still runs when an old save loads.

## Safe test commands

The live development stack uses Docker Desktop. Start it with `npm run docker:up`, inspect it with
`npm run docker:status`, and stop it with `npm run docker:down`. The game and chat bridge publish only
to local ports 5273 and 5277. Ollama stays on the Mac. See [the Docker runtime guide](../DOCKER_LOCAL.md).

Run tests from the actual project or an intentionally isolated copy. Inspect ports first:

```sh
lsof -nP -iTCP:5273 -iTCP:5276 -sTCP:LISTEN
npm run typecheck
npx playwright test --config playwright.personality.config.ts --workers=1
npm run build
```

`playwright.personality.config.ts` is the reusable isolated-server config despite its historical name.
It owns port 5276 with a private Vite cache, leaving the player's 5273 server alone. It refuses a busy port.
Never use blanket pkill or quietly attach to a different server. Check an occupied port; ask before restarting
a service. Do not run two suites/visual probes that both own 5276 at once. Avoid a simultaneous heavy build
when investigating browser timing. A full run last took 5.2 minutes; give command wrappers enough total time.
Keep one browser worker unless Jeff explicitly asks for more; large parallel runs previously overloaded his Mac.
`run_cmd_capture.py` is a local command wrapper; it is not in this repo. With it, the default limit is 300 seconds: use `--timeout-sec 1200` for the full suite.
This raises the wrapper limit, not individual test assertions. No retries are enabled in the project config.

Useful focused groups (same config; pass matching filenames to Playwright):

- Town: `town-building-art`, `town-buildings-travel`, `town-buildings-migration`, `town-residents`,
  `town-social-life`, `town-prop-fit`, `town-adoption-travel`; all are `tests/*.spec.ts`.
- Furniture: `furniture-connections`, `furniture-footprints`, `furniture-surfaces`, `placement-access`, `hotbar-placement`.
- Appearance: `appearance-rendering`.
- Service: `tavern-personality-system`, `tavern-personality-input`, `hospitality-system`, `hospitality-playthrough`.
- Saving/map edits: relevant migration tests plus `map-editor-safety`, `town-workshop-safety`, and native editor tests.

Fast no-browser migration check: `npx playwright test --config playwright.civic-unit.config.ts`.
Town visual pass: `node scripts/town-buildings-visual.mjs` (owns 5276, 52 WebGL screenshots in
`output/playwright/town-buildings-webgl/`). Read the script before modifying or reusing it for other scope.
Screenshots are not inspected merely because a file exists—open them.

## Input and visual verification

The canvas game's dev seam is `window.__TEST__`; see `tests/helpers/gameHarness.ts`. The playtest skill is local to the author's machine; it is not in this repo.
Use `?test=1&seed=42` for deterministic Canvas tests; add `renderer=webgl` for actual graphics behavior.
Fresh browser contexts isolate saves. Set up prerequisites through the seam, then exercise real keys/mouse.
Use readiness/state predicates for transitions, `stepTime` for game-time rules. Short screenshot settling
delays are not proof that a transition or action completes. Check console errors and exact returned positions.

## Failures and installation

If browser actions stall, inspect the exact error, test concurrency, server/cache ownership, and machine sleep.
Lid-closed macOS sleep previously stretched tests into an hour; it did not justify weakening assertions.
Do not change OS power settings, dismiss real bugs as flaky, or keep retrying unchanged theories.
Capture the failed result, isolate its cause, and report what is and is not verified.

If staging while Jeff plays, record the live baseline hashes and preserve all user changes. After checks,
compare hashes again, back up exact targets, land assets before references, apply only the task-owned changes,
verify resulting hashes/typecheck, and probe the live server with isolated saves. Tell Jeff before a reload.
Never mark staging as installed. Do not reset the repository to recover a failed installation.

Maintain separate truth for functional tests, visual inspection, user acceptance, and formal workflow gates.
Unavailable memory/gate services are not successful empty results. Report their limits without inventing records.
