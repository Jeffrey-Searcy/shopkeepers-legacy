# Farm map editor

User approved the farm-first development sandbox on 2026-09-13.

## Objective and boundaries

Arrange the farm with native art and tile-snapped drag/drop, paint grass/dirt paths,
undo/redo, save a separate draft, import/export layout JSON, and walk a fresh preview.
Normal saves, all existing authored maps, town NPCs and customer settings stay unchanged.
Water, cliffs, outer boundaries and external map exits are read-only in version one.
This is a dev-build feature, explicitly disableable with VITE_MAP_EDITOR=false.

## Contract

1. Dev-only Map Editor entry opens a separate page. Production ignores editor/preview queries.
2. Independent versioned drafts use stable editor IDs, atomic validated changes, undo/redo,
   confirmed reset, strict bounded JSON import/export and draft reload.
3. Moving the shop moves art, porch collisions, door warp, start and from_home arrivals together.
   The ordinary authored farm remains identical.
4. Objects and decor snap to tiles. Grass/dirt strokes work. Invalid bounds, terrain,
   overlaps and blocked arrival routes reject with visible feedback.
5. Editor pan/zoom uses Phaser cameras with no gameplay simulation or ticking clock.
   Test actual pointer/keyboard controls.
6. Preview uses a separate fresh slotless page, API-level save/load/delete protection,
   and one frozen draft through farm travel. Harvesting does not modify the draft.
7. Typecheck, build and the full dedicated port5276 Playwright suite pass. Capture and
   inspect real-input editor screenshots at desktop and narrower sizes.
8. Complete Self-Audit and independent hostile review; fix material findings before delivery.

Reviewer /root/customer_runtime_map explicitly ACKed all eight criteria before implementation.

## Architecture / solution ladder

Chosen L3_operating_surface: a separate editor scene plus fresh preview, not a gameplay mode.
Why not lower: existing resources and crops are keyed by tile; moving them inside a live save
can revive harvested nodes or inherit old removals. Live-state snapshot restore also loses drops.
Why not higher: no editor framework, backend, general schema engine or production map migration.
Reuse MapData, terrain rendering, manifest assets, ShopFront, Phaser camera/scene lifecycle,
SceneTransitionSystem and the existing Growth Lab entry point. No new art.

Bounded swarm: pure layout/geometry and sandbox storage protections are independent of editor UI.
Estimated scope: 15 source/test/document files, 1,600–2,200 lines including checks and tests.
The scope exceeds three files because save protection, geometry and UI have separate owners.

## Packets

- A: typed draft model, validation/compilation, shop geometry; model tests.
- B: strict dev mode, independent draft storage, save protection; safety tests.
- C: editor scene, small native DOM controls using the existing cozy palette, development-menu
  entry and fresh preview boot; input, undo, storage and roundtrip tests.
- D: full regression suite, responsive screenshots, self-audit and independent review.

## Guardrails

Mutations affect only a validated detached layout and explicitly named editor storage keys.
Gameplay state and save formats are frozen. Every preview loads a validated snapshot once.
Imported data is bounded and strict; malformed drafts remain stored until explicit recovery.
No overwrite of gameplay saves, no new dependencies, no production query backdoor.
One undo entry per drag/stroke. Preview harvesting cannot become an editor change.
No generic event engine or per-tile display objects; reuse culled terrain layers.
Browser test contexts are disposable; user server5273 remains running and untouched.

## Verification / recovery

Run npm run typecheck, npm run build and npx playwright test -c playwright.personality.config.ts.
Save evidence under planning_artifacts/farm-map-editor and output/map-editor.
Disable the feature with VITE_MAP_EDITOR=false; normal gameplay never consumes draft storage.
Keep git changes local and preserve all pre-existing edits. No commit/push authorized.

## Preference evidence

Applied explicit user preferences: visible native art, simple drag/drop, cozy readable controls,
development-only access, farm-first scope, safe progress and exact layout handoff.
memory-adaptation tool discovery found no codex-mem tools; retrieval is unavailable, not empty.
Prompt contract: feature-contract.v1. Existing palette/fonts guide local editor fidelity;
no separate art-direction redesign is needed.

## Self-Audit

Fixed before handoff:

- Sparse unknown-input arrays could omit authored entities; indexed validation now rejects holes.
- Removing sandbox URL flags could unlock save APIs; page-owned mode now stays latched.
- Preview pages could call editor storage writes; all write entry points now reject preview mode.
- Resizing during a gesture could reuse stale camera coordinates; resize cancels the gesture.
- Narrow controls hid the dirty badge; Save draft now carries an always-visible changed-state cue.
- A blocked popup could produce a false success message; preview feedback offers a direct link.
- Native test fixtures now use exact integer browser pixels when selecting overlapping tree art.
- Sparse path tests distinguish authored dirt from new edits instead of demanding redundant records.

Normal authoring data compiles unchanged. No gameplay save schema or user service changed.
The F10 entry deliberately pauses the original adventure and opens the editor separately.
Git changes remain local; no unrelated files were staged, reverted or committed.

## Expert Review

Independent reviewer /root/customer_runtime_map ACKed all eight criteria after the final full run.
The model, storage guards, native input and translated shop geometry have no open findings.
Separate screenshot/source review by /root/customer_rigs_b produced the three UI fixes above.

## Final local playtest evidence

- `npm run build`: pass (includes `tsc --noEmit`); existing Phaser chunk-size warning only.
- `git diff --check`: pass.
- Full dedicated port5276 regression: **328/328 pass in 3.8 minutes**, four workers.
- Ten layout-model tests, eight mode/storage tests, five native editor tests included in that run.
- Native tests cover F10 launch/automatic pause, all movable kinds, valid/invalid strokes,
  undo/redo, cancelled resize gesture, export/import/reset, reload, and pan/zoom.
- Fresh preview walks through the moved shop door and back. Native pickaxe harvesting changes
  neither the editor draft nor a sibling normal game's real save-slot bytes or live state.
- Inspected screenshots: `output/map-editor/editor-1280.png`, `editor-700.png`,
  `editor-webgl-dpr2.png`, and `preview-moved-shop.png`. Controls do not cover editable map tiles.
- User server5273 still returns HTTP200. No user service was stopped or restarted.

Capture: `planning_artifacts/farm-map-editor/captures/1789333226-full-regression-100/manifest.json`.
SHA256: `075285f902f2fb91367c167bd5680df71eb2c59fb79d15450ade66c7d798400e`.

## Formal gate boundary

`validate_impl.py` and `finalize_gate.py` were run. Formal release approval remains blocked:
the complete governed compiler/readiness/schedule records and durable-memory retrieval evidence
are not available. The validator also expects stage-specific proof naming and more schema fields.
The actual full regression capture is valid and its 100% smoke result is pass. Do not represent
this local development playtest handoff as formal governed release approval or invent old records.
