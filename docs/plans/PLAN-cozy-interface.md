# Cozy interface and appearance editor — 2026-09-12

Status: approved by Jeff ("go") on 2026-09-12. Independent reviewer cozy_verifier ACKs all eight criteria.

Local candidate: implementation and 132 tests pass. See
`../playtest-reports/2026-09-12-cozy-interface.md` for playtest steps, evidence, and remaining limits.
Formal planning-gate approval remains open; local test success does not replace missing runtime records.

## Required context

Jeff asks for the game to fill the browser again, an appearance editor in Pause, and a more
cozy, satisfying title screen and inventory. He confirms keeping the current character shape.
Clarification: customization includes actual hairstyles, hats, shirt and trouser styles, and eye
color, not only recoloring. Dinkum and Animal Crossing are the inventory/storage references.
The implementation remains Phaser/TypeScript. Existing uncommitted player and tavern work stays intact.

Observed at 1440x900: main.ts displays a 960x540 canvas because syncCanvasDisplaySize floors
the fit scale. Title and inventory baseline screenshots are under output/playwright/cozy-review/.
Player appearance is baked into the navigation sheet and six active tool/action sheets. Current
saves have no appearance record. Title/pause and inventory have different fonts and visual styles.
Inventory refresh currently overwrites its hover colors each frame.

## Design direction

An inviting tavern at dusk: glowing windows, a wooden shop sign, quiet ambient movement.
Inventory and chest menus use soft rounded cream panels, roomy item pockets, large readable icons,
quiet pastel accents, and simple item-action bubbles. Avoid the current stacked heavy borders,
buckles, brass trim and literal bag silhouette. Keep wood and lantern details primarily in the
title backdrop, not around every inventory control. Clear rounded lettering replaces competing
type treatments. The memorable interaction is lifting a selected item from its pocket, with a
gentle selection pop and soft drop response. Chest storage pairs matching bag/container panels.
Keep motion brief; selection and data changes must not wait on animation.

Reference screenshots (inspiration only; no copied assets):
- Dinkum inventory and storage: https://note.com/nyle_style/n/n7025502e2094
- Animal Crossing: New Horizons pockets: https://www.eurogamer.pt/animal-crossing-new-horizons-guia-ganhar-bells-dinheiro

Screenshot references establish layout and visual direction, not verified animation timings.
The proposed motion and sound need independent in-game evaluation.

## Acceptance contract

1. Browser-fill display responds to resize at 800x500, 1440x900, 1920x1080 and 2560x1080.
   No application-level black frame, stretched sprites, clipped controls or pointer-coordinate drift.
   World view adapts to aspect ratio; a small room's physical boundaries are not stretched.
2. Pause > Appearance offers distinct hairstyles, hats (including none), shirts and trousers,
   plus eye color, skin tone and hair/clothing colors. Keep character proportions, movement,
   collision, tools and frame alignment. Hats/hair/clothes stay aligned through all directions
   and active tool animations; eye color is visible in a close preview without enlarging the eyes.
3. The editor has four-direction previews, walking/action checks, Apply and Cancel. Cancel leaves
   live appearance unchanged. Escape closes the editor before unpausing; gameplay remains frozen.
4. Appearance persists in the current save slot. Older v1/v2 saves migrate explicitly to the
   existing appearance; invalid new appearance values reject before changing live state.
5. Title, save selection, pause, inventory, chest and shipping share the approved visual direction. Preserve the
   three saves, story flow, corruption messages, delete confirmation and unsaved-progress warning.
6. Inventory retains eight toolbelt entries, 24 backpack entries, inspect/equip behavior and atomic
   drag/swap behavior. Hover survives refresh; blank-panel clicks cannot activate the world.
   Opening/closing during a drag clears transient visuals without losing or duplicating an item.
7. Keyboard/mouse parity, visible focus, readable contrast, compact-window layouts, and reduced-motion
   behavior work. Shared chest/shipping UI remains usable after theme changes.
8. New focused tests, full Playwright suite with four workers, npm run typecheck, npm run build,
   git diff --check, and inspected screenshots provide evidence. Independent review precedes closure.

## Required constraints and scope

First editor version includes a small authored wardrobe, not an unlimited asset editor. Hats and
clothes are cosmetic choices; buying/unlocking them, stat bonuses, and equipment mechanics are
outside this pass. Do not redesign the base body or add unrelated accessory categories.
No gameplay economy, tavern progression, mines, dungeon, online service or game-engine rewrite.
No changes to the user's running save files during tests. Use isolated browser storage.
No commits, pushes, deployment or stopping the running dev server without separate approval.
Confirm approval before modifying overlapping player/tavern source files.

Reuse GameState/SaveSystem, manifest texture loading, shared inventory grid functions,
InventoryLayoutSystem.moveOrSwap, InputBus modal handling and Sfx. Appearance uses one validated
saved configuration and a transient editor draft; there is no second persistence layer.
Use aligned character parts or authored masks over the current animation poses. Preserve shading
and isolate skin, eyes, hair and clothing from tools and outlines across all seven active sheets.
Define hair/hat overlap explicitly; no floating hats or hair poking through solid hat crowns.
Style-test a small wardrobe on the real character before batching the remaining art. Compose only
the active appearance and editor preview; do not generate every possible outfit combination.
Do not use a whole-sprite tint as character customization.

## Solution ladder and execution

- L1 patch: fractional canvas stretching and unrelated menu restyles. Insufficient for true
  browser-fill layout, consistent input coordinates, and saved appearance across action sheets.
- Chosen L2: a small shared UI theme/layout layer and one appearance system over existing state.
  Reuse the scene manager, texture manager, inventory operations and save validation.
- L3 general UI framework or arbitrary avatar authoring engine: unnecessary for a bounded wardrobe.

Execution shape: single implementation lane, with bounded art/design and independent review work
only where files do not overlap. Work region by region: display foundation; title/pause; inventory;
appearance editor; cross-screen regression checks. Target three visual iterations per major region,
stopping when the frontend-design rubric clears its thresholds. Preserve the strongest iteration.

Estimate: 20-28 source/test files, 2,500-4,000 changed lines, plus wardrobe art and evidence. The scope
spans render sizing, shared storage UI, aligned parts for seven character sheets, save migration
and input tests. The expanded wardrobe replaces the earlier color-only estimate.
Reassess before exceeding this range rather than adding a new framework or feature family.

## Contract closure and overengineering guardrails

Only Apply changes GameState appearance. Preview rendering cannot mutate the active player or save.
Saving uses the existing SaveSystem entry point. Loading validates a detached candidate.
Existing inventory movement is read/reused, not reimplemented. Camera/world coordinates remain
distinct from menu coordinates. Keep saved appearance identifiers finite and catalog-validated.
Do not add configurable body geometry, a general asset editor, or a theme marketplace.

## Verification and recovery

Capture current source before edits, including the uncommitted player/tavern work. Recovery is
file-scoped against that snapshot; never reset/clean the worktree. Test failed Apply/load, Cancel,
slot switching, all directions/actions, scene changes, browser resizing and drag cancellation.
Compare screenshots for blur, uneven scaling, hover/press state, clipping and readable text.
Store design rounds and source snapshots under the existing .frontend-loop convention; gate proof
belongs in planning_artifacts/cozy-interface-2026-09-12/.

Done when the acceptance contract passes with real captures and Jeff can playtest the coherent pass.
Do not claim formal gate approval if the required evidence or independent review is incomplete.
Memory retrieval is unavailable in this session; use the explicit request and project notes, and
record that limit rather than inventing retrieved preferences. Prompt contract: frontend-contract.v1
plus feature-contract.v1 for appearance persistence.
