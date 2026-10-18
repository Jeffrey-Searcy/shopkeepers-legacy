# Town workshop verification notes

The approved scope is an isolated layout workshop, not adoption into ordinary Town or saved adventures.
Source plan: `PLAN-town-layout-workshop.md`. Authored fingerprint: `town-v1-d98f917f`.

### Self-Audit

- A clearing initially crossed its future access road. The authoring script now routes the road around plot 05.
  Every initial plot has grass underlay; a model assertion prevents recurrence.
- The shared adapter initially used ordinary Town dimensions. It now uses the detached 120×110 workshop map.
- Whole-map framing initially clipped the west/top edges. The editor now computes centered, padded camera bounds.
  Native tests check all four map corners in the visible viewport at desktop, narrow and Retina sizes.
- Plot text initially shrank with the map and retained a mismatched canvas resolution. It now uses a fixed
  10 CSS-pixel size and device-resolution text backing. Both raster and display geometry are asserted.
- The first new tree-drag fixture selected a partly obscured fractional pixel at map-wide zoom. It now resolves
  the actual foreground opaque pixel and integer browser mouse movement. No gameplay hit-test was weakened.
- The first new harvest fixture searched for bare `axe`. Toolbelt entries use `tool:axe`; the fixture now calls
  the real `toolFromEntry` decoder before pressing the matching number key. Gameplay code was unchanged.
- Preview harvesting, all three bridge crossings and all four external routes use native key input. Teleport
  helpers only arrange approach positions; they do not perform the asserted action.

### Expert Review

Independent reviewer `customer_runtime_map` ACKs all six criteria before implementation. It reviews the model,
storage ownership, boot order, scene transitions, editor gestures and final visual evidence afterward.

Its concrete finding: the Town editor could call the existing Farm storage writer API. `FarmLayoutStorage`
now rejects every Farm write from a latched Town editor. The independent review spec tests draft writes,
preview writes, import and reset, including attempts after changing URL flags.

Town storage writes require a Town editor. Both previews deny all draft/handoff writes and adventure-slot
access. A preview retains its opening map even when another tab changes or corrupts the handoff key.
Ordinary map resolution never reads Town draft storage. The Forest return override exists only in the
page-owned Town preview; ordinary Forest and its existing Farm route remain unchanged.

The reviewer independently runs all nine model cases, checks generated JSON equality, and inspects wide,
narrow and player-scale screenshots. It reports no remaining source blocker. Final test results are recorded
in `planning_artifacts/town-layout-workshop/implementation.json`.

## Evidence and limits

- First full regression: 366/367 pass. Only the new bare-axe test fixture fails.
- Corrected review/editor run: all nine cases pass, including native harvest and Retina/WebGL editing.
- Final full regression: **368/368 pass (3.6 minutes)**. The independent reviewer verifies exit code 0,
  manifest and stdout hashes, then ACKs all six local criteria with no remaining feature blocker.
- Production build and TypeScript checks pass. The existing large-bundle advisory remains.
- Final full-suite result and captured hashes live in the implementation evidence, not inferred from these notes.
- Visuals show an eastern river bending west, three timber crossings, a northern park, twelve clearings,
  and readable editor-only planning labels. No building is generated or assigned a type.
- River, cliffs, bridge geometry, route mouths and future connection sites stay fixed in this first editor pass.
  Existing trees and decoration can move; adding/removing them and resizing plots remain outside this pass.
- The ordinary gameplay HUD is not redesigned here. The workshop uses separate native controls and viewport bounds.
- No commit or push occurs. The branch contains unrelated prior work, which remains intact. Server 5273 stays running.

The planning-gate and memory-adaptation skills cannot establish formal governed sign-off. Durable memory tools
are absent, and pre-execution compiler/runtime records were not produced. Current command captures are genuine;
missing historical records must not be fabricated. This is local playtest evidence, not a release approval.
Both `validate_impl.py` and `finalize_gate.py` run and return blocked. They list missing runtime/compiler,
memory and staged-proof records, plus capture-name contract mismatches. See `finalize.json` for the complete
unmodified verdict. The gate is not overridden or reported as passed.
