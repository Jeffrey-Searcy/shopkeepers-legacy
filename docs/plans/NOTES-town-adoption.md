# Town adoption — implementation notes

September 13, 2026. Jeff approved the map packet. Character names, building assignments, new art
and resident appearance wiring remain proposals, not implemented gameplay.

## Delivered behavior

- Normal Town uses the approved 120×110 layout, twelve clearings, three bridges and four roads.
- Upper west reaches Farm; lower west reaches Forest; north reaches Mountain outdoors before a
  separate cave transition; south reaches Beach. Forest has its authored matching return.
- Normal play and the editor share clearing/build-zone composition. Editor imports keep the
  exact `town-v1-d98f917f` fingerprint. Adventure resolution never reads editor storage.
- Version11 uses detached legacy Town/Forest geometry to validate older saves. Version1–9 still
  run their previously approved Farm migration first. The Town migration itself never removes
  Farm/interior content or modifies inventory, gold, appearance or hospitality.
- Conflicting regional furniture, building footprints, soil/crop pairs and pickups move intact.
  All legal records reserve their space before relocation. Single-root reachability prevents
  relocated blockers from separating exits or trapping surviving crops. A blocked keeper uses
  a named safe arrival. Old Town resource markers cannot clear unrelated new trees.
- Reads and loads leave stored bytes unchanged. First successful overwrite preserves the exact
  old envelope in the separate pre-town backup. A conflicting backup, failed write, malformed
  source record or no fitting destination rejects explicitly before live installation/slot loss.

## Verification record

Actual captures live under `planning_artifacts/town-adoption/captures/`:

- `1789345836-typecheck-25`: typecheck exit0.
- `1789345864-map-and-legacy-smoke-50`: 30 passed, 3 failed. Failures were obsolete version10
  and single-backup expectations. They were updated to version11 and both explicit backups.
- `1789346000-production-build-50`: production build exit0.
- `1789346195-migration-and-travel-75`: 26 passed, 1 failed. The old editor test compared computed
  build zones to the intentionally all-false preview underlay. It now compares the shared
  compiled baseline; ground, collision, warps and fingerprint assertions remain unchanged.
- `1789346312-migration-travel-final-75`: all30 pass, including eleven Town migration proofs,
  seven historical Farm migration proofs, three normal Town travel tests and nine editor models.
- `1789346348-final-build-100`: final production build and TypeScript compile exit0.
- `1789346347-full-regression-100`: 378 passed, 4 failed. Two fixtures still teleported to the old
  Town north exit. They now resolve the authored destination through a shared test helper. One
  expected version10 after resaving; one reused a fixture slot without clearing its test-owned
  pre-town backup between independent cases. Updated fixtures preserve strict backup checks.
- `1789346652-corrected-regression-fixtures-100`: all22 corrected fixture checks pass.
- `1789346709-final-full-regression-100`: 380 passed, 2 failed. One older customer fixture could
  click before its registered pause control's parent became visible. It now waits for visible,
  fully faded-in native controls before inspecting poses.
  The missing-asset negative test remains unchanged. The second failure exhausted the Retina
  WebGL editor test's total30-second budget under four workers, without proving an Undo defect.
- `1789347154-test-customer-readiness-100`: all54 checks pass across three repetitions of the
  complete customer and map-editor input files with two workers. The Retina test, timeouts and
  runtime remain unchanged. The final full run uses two workers to reduce graphics contention.
- `1789347275-test-final-full-regression-100`: final full regression exits0 with all382 tests
  passing, using two workers without retries or changed test timeouts. Final production build
  remains the passing capture above; runtime source has not changed since that build.

The main agent inspected all three bridge screenshots and the clearing at normal player scale.
The additional isolated Playwright CLI session used WebGL on5273, walked Farm→Town with the
keyboard and captured `output/playwright/town-adoption-webgl-final.png`. It reported renderer2,
ready=true, TownScene and no save keys. The only observed console error was the existing missing
favicon. User server PID19125 remains unchanged; it was not restarted. Tests use their own5276.

## Self-Audit

The migration tests caught the workshop underlay's all-false building grid. That would reject
every old Town building footprint. Shared world composition now derives usable grass/dirt build
zones while protecting entrances and reserved roads. Migration also checks resources, occupancy
and reachability. No new map format, building generator or general migration framework was added.

The source and save version changes required six extra mechanical test expectation updates, two
additional travel fixtures and their shared helper beyond the initial file estimate. A separate
customer test gains native menu-readiness assertions without changing NPC behavior. Existing
versioned corruption tests retain their historical input
versions. Earlier unrelated dirty changes remain untouched; the whole git diff is not this task's
change count. No commit, push, PR, global settings change or user save overwrite was performed.

## Expert Review

The independent reviewer ACKed all six acceptance criteria before implementation. Initial review
found multi-source reachability could hide severed entrances and accepted blockers could isolate
surviving crops. Both are fixed. A real authored choke-point fixture proves the crop stays while
the closing chest moves. Layered table/rug records remain exact. No-space and failed-backup tests
prove failure leaves original bytes and live state intact.

Final source review reports no blocking findings and independently confirms the30-test passing
capture. Its report is `planning_artifacts/town-adoption/review-source.md`. The main agent confirms
the final382-test passing capture separately. Formal gate status remains a separate result;
source review and passing game tests do not replace its unavailable workflow records.
The reviewer also checked both later timing failures. It confirmed the customer helper's
registration check alone did not establish visibility, and rejected a force-click or runtime
change for the Retina timeout. Repeated native tests pass without weakening pose or Undo checks.

## Gate and recovery boundary

Memory tools were unavailable, not an empty successful retrieval. The feature-contract.v1 plan
uses explicit conversation/project preferences. Formal planning-gate approval is not claimed:
memory/benchmark/runtime execution records are missing. Record actual final validator output;
do not invent historical kernel execution or tool access to make the gate green.

The pre-town backup survives ordinary slot deletion. Restoring its exact original envelope to the
same slot while the game is closed provides recovery; a later load deterministically migrates it
again. Browser fixtures test repeat loads and byte preservation without touching Jeff's saves.
