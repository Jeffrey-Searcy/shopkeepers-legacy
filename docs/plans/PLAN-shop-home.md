# Shop exterior, porch, and private home — 2026-09-12

Status: Jeff approves the preceding direction with "go". Scope keeps current tavern service;
shop selection and paid lodging remain later work. Independent shop_home_review ACKs all eight criteria.

## Required context

The current farm draws a single160px tavern image at depth -6. Every part stays behind the keeper.
Its solid wall ends at row12; rows13–14 form the porch/steps; E at tiles72–73,row12 enters Tavern.
The tavern bed currently occupies the public room. A legacy Home scene is redirected to Farm on load.
Jeff wants a shop-neutral building, depth like the supplied Stardew porch, an animated walk-in door,
a private rear bedroom, and an inn-only stair suggestion that the keeper cannot enter.
Reference: Jeff's supplied screenshot and https://stardewvalleywiki.com/Farmhouse (researched before approval).

## Objective and scope

Make the inherited building read as a walkable, layered shop with a separate private home.
Preserve the current working tavern service, wardrobe, inventory, farm, and saves. The stairs are
a reserved guest-only alcove; no room assignment, booking, new shop selection, or playable upstairs.
No change to mines/dungeons, time balance, player shape, or current progression costs.

## Acceptance contract (review before implementation)

1. Neutral exterior has no tavern-specific lettering/mug branding. Inspected daytime/nighttime
   screenshots show a raised walkable porch, steps, recessed door, and correctly overlapping posts.
2. Real held movement up the steps opens the door visibly and enters once without E. Exiting
   returns safely outside the trigger. Ten repeated round trips do not lose or trap the player.
3. Door transition rejects pause/modal/tool-busy input and repeated overlap. A missing target/spawn
   fails before changing world state. Menus/tools cannot activate during entry animation/fade.
4. A separate rear bedroom is reachable and returnable with real movement. Sleep advances one day,
   restores stamina, and saves; bedroom save/load restores the correct scene and feet position.
5. Tavern service, costs, quotas, and payment remain unchanged. The public room loses its bed.
   The inn stair alcove has a clear guest-only purpose, rejects player movement, and has no upstairs warp.
6. Existing v1/v2/v3 saves remain loadable. Legacy Home redirect remains intact; old tavern saved
   positions remain walkable or receive an explicit narrow migration if the new doorway requires it.
7. Browser-fill display, portrait/tool alignment, title, inventory, storage, and menus remain intact.
   Inspect compact800x500 and wide1920x1080 views, including real WebGL rendering and porch overlap.
8. Focused new tests, full Playwright suite with four workers, typecheck, build, diff check, and
   independent hostile review produce actual evidence before local playtest handoff.

## Solution ladder and reuse

- L1_patch: replace the single PNG and add an E bypass. Insufficient: the porch needs separate
  depth layers and the bedroom must survive save/load.
- Chosen L2_abstraction: small shop-front renderer and guarded entrance hook within existing
  BaseWorldScene warps; one BedroomScene with authored map data. Reuse SceneTransitionSystem,
  named spawns, Phaser cameras/physics/tweens, manifest asset loading, bed/sleep/save pipelines.
- L3_operating_surface: generic building editor, shop-type framework, or lodging simulation is
  unnecessary. Do not add them for this visual/navigation pass.

Execution uses bounded parallel work: bedroom scene/data and exterior art have independent files;
root owns shared transition/map registration and final tests. A read-only reviewer gates both.
Packets: P1 source baseline and contract; P2 exterior art/porch and entry; P3 bedroom/interior;
P4 integration/save compatibility; P5 regression and visual review.
Estimate22–30 source/test/config files,2000–4000 changed lines, plus generated assets and evidence.
Reassess before exceeding the budget. A new scene and cross-scene entrance require more than500 lines.

Final budget reassessment:31 source/test/config files and1,268 added+deleted lines. Root adds
one required m10 collision-test refresh after the full suite exposes obsolete porch/deferred-entry
expectations. This is acceptance-test maintenance, not new production scope. The archive lacks
.gitignore; only this pass's exact five-line storefront allowlist is counted for that file.

## Contracts and guardrails

No new persistence layer or save envelope version solely for a new known scene. The reviewer ACKs
save v4 specifically for the new physical porch: v1/v2/v3 Farm feet intersecting new plinth/post
geometry migrate to the existing safe from_home spawn. Unchanged positions stay exact, and current
v4 saves in the new solids reject explicitly. Appearance migration remains limited to v1/v2.
Existing GameState
remains authoritative. Door animation is transient scene state and is never saved. Destination
validation precedes animation/state mutation. Movement locks clear at scene shutdown, never through
an unrelated global timer. Interior layout is data, not arrays hidden inside drawing code.
Shared source edits preserve the current dirty wardrobe/tavern work; no reset/stash/clean.
Archive the exact source baseline and use file-scoped recovery. Do not overwrite personal saves,
stop the existing server on5273, commit, push, or deploy. Tests use isolated storage/server5274.

## Verification and done when

Contract: feature-contract.v1. Capture tests and screenshots in
planning_artifacts/shop-home-2026-09-12 and output/playwright/shop-home.
Test entrance frames, collision against porch edges/posts, held-key repeat, menu/tool locks,
bedroom return/sleep/load, old saves, existing tavern payment, and all permanent world regressions.
Use the project playtest workflow with isolated browser storage. Inspect generated art before batching.
Record Self-Audit and Expert Review. Run official planning-gate validation on honest evidence;
never manufacture missing runtime, memory, or measured skill-trigger proof. Memory tools are not
exposed in this session. Local playtest readiness and formal workflow approval are separate claims.
