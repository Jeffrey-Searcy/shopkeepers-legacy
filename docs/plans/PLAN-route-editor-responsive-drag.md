# Responsive route drawing repair

## Objective

Make route stops and bend points visibly follow the pointer while dragging. Show a placement preview before adding a stop or bend point, without mutating the route draft until drop or click.

## Acceptance contract

1. A dragged stop or bend point follows the pointer before mouse release and shows its snapped Town tile.
2. The preview draws temporary connections to the surrounding route controls so the edited line reacts during the drag.
3. Valid placement previews are green. Blocked placement previews are red and cannot change the draft or undo history.
4. **Add stop** shows a live placement marker while hovering. Clicking commits exactly one validated stop and clears the preview.
5. Hover and drag cursors distinguish draggable points, route-line insertion, stop placement, panning, and blocked ground.
6. Pointer hit-testing uses the already-rendered route snapshot rather than revalidating all 84 weekly schedules for every hover.
7. One-worker Playwright tests prove live pre-drop feedback, unchanged draft bytes during drag, valid drop, invalid-drop rejection, placement hover, save isolation, and responsive layout. The production build returns exit code 0.

## Solution ladder

- L1 patch: Change cursor labels only. Rejected because points would still stay frozen during dragging.
- L2 abstraction: Add a transient pointer-preview layer and cache the rendered route used for hit-testing. Chosen because it fixes feedback and input latency without changing route data.
- L3 operating surface: Replace the route draft and path compiler. Rejected because the existing validated route model is correct after the gesture commits.

## Existing primitives and reuse

Reuse Phaser pointer events, Town passability rules, the isolated draft, the compiled route segments, the existing undo stack, and the DOM instruction bar.

## Scope and guardrails

- Expected files: 4–6.
- Expected implementation size: about 300 lines changed.
- No new storage, save fields, services, or production schedule changes.
- The transient preview must never enter serialization or undo history.
- Do not restart live Docker services.
- Use one Playwright worker on the isolated test server.

## Completion evidence

- `npm run build` passed on 2026-09-15.
- `npx playwright test --config playwright.personality.config.ts --workers=1 tests/npc-route-editor.spec.ts` passed all 3 tests.
- The drag test proves live valid and blocked previews, unchanged draft data before drop, one valid commit, and no invalid commit.
- `route-drag-live.png` confirms the pointer marker and temporary route connection render above the Town map.
