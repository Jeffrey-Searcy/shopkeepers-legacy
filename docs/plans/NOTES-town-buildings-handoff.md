# Town buildings: September 14 installation update

The staged work is now installed in the live checkout. All 61 installed files initially match
the staged hashes. The existing server on port 5273 renders all twelve buildings; a fresh,
isolated browser walks into the Market and finds Tessa without browser errors. Typecheck passes.
All 24 WebGL building round trips pass at desktop and Retina sizes, with 52 final screenshots.
All 395 tests pass on the installed checkout. Exact pre-install file copies and the current
record are under `output/town-buildings-install-2026-09-14/`. Real save slots remain untouched.

The notes below preserve the earlier overnight pause as history; their pending-install status
no longer describes the live checkout. Formal workflow metadata remains separate from game tests.

---

# Earlier overnight handoff

## Current status

The twelve exteriors, public interiors, residents, doors, appearance switching, v12 migration,
and final furnishing atlas are implemented in the staged copy. No implementation files have
been applied to the player's running checkout. Port5273 and real browser saves remain untouched.
No commit, push, or power-setting change occurs.

## Verification evidence

- Initial complete suite:394 tests pass in6.7 minutes. This includes the final atlas but predates
  narrowed furnishing footprints and the added fit regression.
- Final build and embedded typecheck pass after the footprint correction.
- The new native furnishing-fit regression fails on old geometry, then passes with the correction.
- Final full suite:387 pass,8 fail in55.2 minutes. All civic tests pass; failures affect existing
  crafting/customer/tavern/editor timing. Do not report this as a green full run.
- A focused repetition passes29 and fails5 in49.3 minutes, with changed timeout failures.
- macOS power logs confirm lid-closed sleep at22:07:53 on September13, followed by repeated
  maintenance/dark-wake sleeps during both runs. Hardware query confirms the lid stays closed.
  The timing evidence supports environment interruption, not a reason to suppress assertions.
- Two independent source reviews approve separate packets. The furnishing-width issue is fixed.
- Earlier38 captured building screenshots predate the final atlas. They prove doors and room
  exits but must not substitute for final atlas visual review.

## Remaining work

1. Keep the Mac open and awake. Run the complete395-test suite in the isolated5276 config.
2. Run `node scripts/town-buildings-visual.mjs` only while5276 is free. It owns a temporary server
   and checks24 native WebGL round trips at desktop and Retina sizes. Personally inspect its
   final furnishing and resident screenshots. This script has been written but not run yet.
3. Address real defects, if any; do not weaken timing assertions because the Mac slept.
4. Compare the staged bundle's baseline hashes against the original checkout. Preserve any
   newer user changes. Back up exact target files and apply only the task-owned staged files.
5. Warn about Vite reload before application. Run final typecheck in the original checkout.

The full executable temporary stage is `/tmp/shopkeepers-town-buildings.V9b0Mq`. A durable
task-only bundle is saved under the original checkout's `output/town-buildings-staged-2026-09-13`.
Its `files/` paths mirror the checkout; `baseline.json` records old and staged hashes. Do not
copy test-generated `.frontend-loop` screenshots into the user's source changes.

## Self-Audit

No service economies, outdoor schedules, relationship system, or hiring system are claimed.
Room fixtures stay public property. Main inspected all12 exteriors and representative room
views, but the final atlas still needs native visual inspection after wake. Installation and
full regression remain open. A closed lid is not addressed with altered OS power settings.

## Expert Review

Architecture review catches and resolves oversized exterior collision, public-room building
records in saves, and overly wide prop collision. Main and architecture author independently
review the resident packet; the resident author reviews architecture. Review acknowledgements
do not replace a passing final run or final visual checks.

## Formal workflow status

Planning-gate records are separate from game test evidence. Kernel transaction/session records
and memory retrieval are unavailable. Do not fabricate them or claim formal approval.
