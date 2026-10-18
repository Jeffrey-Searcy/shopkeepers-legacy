# Detailed resident weeks

## Objective

Replace the route workshop's four-stop starter days with believable editable weeks for all twelve residents. Keep the workshop isolated from adventure saves and production schedules.

## Acceptance contract

1. Every resident has seven valid days with 8–10 ordered stops.
2. Every stop has one stable category: `home`, `private`, `work`, `meal`, `errand`, `social`, or `leisure`. Every day contains all seven categories and finishes with `home`.
3. Private room stops use that resident's home-door tile as the Town-only representation of being inside their room. All seven private activity labels are distinct per resident.
4. Meals, errands, and leisure fit each resident's established job and personality. Each resident reaches at least five distinct non-home destination tiles across the week.
5. Every destination is a passable Town tile and every segment compiles without overlaps or missing travel time.
6. The new version-2 detailed starter week opens automatically under a new route-workshop key. The older version-1 route draft and all adventure saves stay untouched.
7. Tests cover all 84 days, categories, measurable variety, person-specific examples, storage isolation, editor controls, and a successful production build.

## Solution ladder

- L1 patch: Hand-write 84 complete route arrays in the draft builder. Rejected because it would duplicate timing and destination rules.
- L2 abstraction: Add twelve compact personality profiles and one deterministic weekly route builder. Chosen because it keeps the content deep and editable without a second schedule engine.
- L3 operating surface: Add procedural runtime scheduling to the game. Rejected because Jeff asked for starter drafts to review, not production installation.

## Existing primitives and reuse

Reuse resident identities, building arrivals, social spots, route validation, path compilation, editor history, and JSON exchange. The version-2 stop schema adds one editable category field.

## Scope and guardrails

- Expected files: 6–8.
- Expected implementation size: 500–700 lines, mostly authored routine content and tests.
- No adventure-save fields, production schedule changes, service restarts, or automatic route installation.
- Daily variety is deterministic by resident and weekday so editor work never changes underneath the user.
- The old route draft key remains untouched and recoverable.

## Completion evidence

- All 84 route days validate. Monday–Friday contain 9 stops; Saturday–Sunday contain 8.
- Every resident has 7 distinct private room activities and at least 5 non-home destinations.
- `npm run build` returned exit code 0.
- The one-worker route and map-editor safety run passed all 13 browser tests.
- The route workshop screenshot was inspected at 1280×720 with the detailed stop list, categories, times, reasons, and route lines visible.
- The bound reviewer returned `APPROVE` against the acceptance contract.
