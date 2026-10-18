# NPC route workshop, living conversations, and gift memory

Date: 2026-09-15

## Goal

Give Jeff a safe visual workshop for editing each resident's weekly route. Remove the blocking save-update screen. Improve witnessed local-model conversations, and let a resident remember the exact accepted gift.

## Solution ladder

- L1: Change route colors, remove the update panel, and add the gift name to one prompt.
- L2: Add validated gift facts and shared conversation continuity to the existing chat boundary.
- L3: Add a separate development route workshop with its own draft, history, preview, and import/export surface.

Chosen: L3 for route authoring, with bounded L2 changes for chat and gift context. A coordinate-only patch cannot express seven schedules. A production route migration is not part of this pass.

## Acceptance contract

1. A development-only route workshop opens from the Keeper's Atlas and never reads or writes adventure saves.
2. The workshop selects all 12 residents and seven weekdays, edits schedule stops, times, labels, reasons, and exact path points, and previews the resident moving along the selected route.
3. Draft changes support undo, redo, strict validation, browser-local save, JSON import, JSON export, and reset.
4. Invalid files, blocked tiles, broken time order, missing home endpoints, and oversized input fail with a visible reason and keep the prior draft intact.
5. Loading a migrated save enters the world directly. Migration logic and internal diagnostics remain intact, but the blocking update screen is gone.
6. Resident-to-resident local speech uses the current event, location, both personalities, and recent shared conversations to create a connected exchange without changing game state.
7. An accepted gift records its exact item label, taste reaction, and day in bounded per-resident memory. Later local chat receives that fact. Rejected gifts record nothing.
8. Focused tests, typecheck, build, browser screenshots, and a one-worker visual review pass.

## Scope and boundaries

In scope: development route draft/model/UI, atlas entry link, migration-screen removal, local chat prompt/context, bounded gift facts, focused tests, handbook updates.

Out of scope: replacing production schedules with an unapproved draft, changing relationship points, letting the model accept gifts, changing save version, restarting Docker services, or redesigning unrelated menus.

## Data authority

- Adventure saves remain the source of relationship and inventory state.
- The route workshop owns one separate versioned local-storage key.
- The route draft is design input only until Jeff exports and approves it.
- Game code records accepted gift facts. The model can mention those facts but cannot create them.
- Game code selects partners and relationship outcomes. The model supplies speech only.

## Risks and checks

- Route draft drift: bind imports to a Town fingerprint and exact resident set.
- Route corruption: validate the full candidate before each committed edit and storage write.
- Chat invention: send explicit witnessed facts and retain strict structured output.
- Duplicate dialogue: include recent pair history and reject repeated opening lines in prompt guidance.
- Dirty worktree: touch only named files and do not reset or stage unrelated work.
- Live playtest: use isolated port 5276 with one Playwright worker. Do not restart port 5273 or 5277.

## Planned packets

1. Route data contract and isolated storage.
2. Route workshop scene, controls, atlas link, and visual tests.
3. Migration-screen removal and title navigation regression test.
4. Social continuity and gift-aware local chat with unit/integration tests.
5. Typecheck, build, focused browser tests, visual scoring, hostile review, and handbook update.

## Evidence

- `tests/npc-route-editor.spec.ts`
- `tests/npc-chat-server.spec.ts`
- `tests/relationships-system.spec.ts`
- `tests/title-navigation.spec.ts`
- isolated screenshots under `.frontend-loop/npc-route-editor-2026-09-15/screenshots/`
- final planning-gate and frontend-harness artifacts

