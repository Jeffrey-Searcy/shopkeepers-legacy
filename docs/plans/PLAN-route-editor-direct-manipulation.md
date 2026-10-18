# Route editor direct-manipulation repair

## Objective

Make the development route editor understandable without prior instructions. The map must act like a visual path editor: stops are placed on the map, route lines accept bend points, and every editable point can be dragged directly.

## Acceptance contract

1. The default map tool edits routes. Clicking a visible route leg adds and selects a bend point on that exact leg; clicking unrelated empty ground shows a clear instruction instead of silently doing nothing.
2. **Add stop** becomes a click-to-place tool. One click on a passable Town tile inserts a timed activity after the selected stop, moves it to the clicked tile, selects it, and returns to route editing.
3. Every authored bend point is visible. The selected arrival leg is visually emphasized, other legs are quieter, and stops and bend points remain directly draggable.
4. The map includes a compact overlay that explains the current action. Plain labels replace the old Select, Move stop, and Via path vocabulary.
5. Stop name, arrival, departure, reason, day context, preview, undo, redo, save, import, and export remain available and keep strict validation.
6. Focused one-worker browser tests prove line insertion, map stop placement, dragging, visible guidance, responsive layout, undo, preview, and byte-identical adventure-save isolation. `npm run build` returns exit code 0.

## Solution ladder

- L1 patch: Rename the existing tools. Rejected because the default no-op map behavior and hidden line controls would remain.
- L2 abstraction: Add direct line hit-testing and a single map interaction model around stops, route legs, and bend points. Chosen because it fixes the root interaction problem without changing route data.
- L3 operating surface: Replace route drafts or production schedules with a new route graph editor. Rejected because the existing validated draft and path compiler already fit the requested design.

## Existing primitives and reuse

Reuse `NpcRouteDraft`, the Town passability checks, the shortest-path compiler, route history, save isolation, and the native DOM inspector. Add only ordered bend-point insertion and clearer map interaction.

## Scope and guardrails

- Expected files: 5–7.
- Expected implementation size: about 450 lines changed.
- No new save fields, public APIs, routes, services, or storage keys.
- Do not install drafts into production NPC schedules.
- Do not restart or modify the live Docker services.
- Keep one Playwright worker and port 5276 for tests.

## Work packets

1. Direct route model: ordered bend-point insertion and deterministic tests.
2. Editor interaction: line hit-testing, click-to-place stops, direct dragging, selection emphasis, and on-map guidance.
3. Verification and documentation: responsive browser proof, save isolation, production build, handbook update, self-audit, and hostile review.
