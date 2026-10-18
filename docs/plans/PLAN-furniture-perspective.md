# Consistent table and workbench views — 2026-09-12

## Objective and context

Jeff rejects both earlier authored furniture and the literal bitmap rotation experiment.
His latest instruction authorizes researched replacement. The current table/workbench share
one native crop per item with angle90 for rotation1. That turns their legs sideways.
Replace their art only; preserve the accepted toolbar clearance and existing grid mechanics.

## Plan

L1 patch: reuse Furniture view data, logical texture keys, manifest loading and native crop
frames. L2 rendering abstraction and L3 decorating-system redesign add no value. Existing
Prop already separates image bounds from indexed collision. Save v6 already stores the two
rotations; no new state, API, migration, station, price or progression change is needed.

Single implementation lane owned by root, with a bounded independent art-generation packet
and reviewer. Art generation can run while root prepares isolated previews and tests.
Budget: initially60, revised to120,160 and finally240 total PixelLab subscription generations
from4835 remaining; no dollar credits. Two rejected paired-sheet batches spend40. Their model
ignores per-object size constraints inside a shared sheet. The revised pipeline gives each
view a hard native canvas:32x24 horizontal,20x40 vertical, with the selected horizontal sprite
passed as a labelled identity reference for the vertical sprite. This replaces the failed
sheet-packing strategy; it is not another paired prompt. Stop and reassess after two failures
of this revised strategy. H32x24 succeeds at30x21 visible pixels. The identity-guided20x40
V batch returns only sliced/repeated fragments. PixelLab support finds no documented narrow
aspect bug; a canvas/layout cause remains an inference, not a verified platform diagnosis.
The controlled next experiment uses a square40x40 canvas with the same H identity reference,
plus one1-generation32x40 single-object alternative without a candidate grid. The latter
tool requires both canvas dimensions to be at least32; its intended content remains16–18px
wide. Keep original
pixels and reject fragments or mismatched geometry. At this point80 generations are spent;
the160 cap covers the remaining views and this explicit experiment. No third retry of the
same failing strategy. Runtime rendering and all five acceptance criteria remain unchanged.
Both alternatives fail: the basic image is diagonal; the square Pro reference call returns
horizontal variants with decorations. Neither is integrated. Actual spend reaches106.
The next distinct workflow is the documented eight-direction object rotation tool using H0
as its exact object reference. This tool rotates object identity rather than generating image
variations. The240 total cap covers this bounded test, a workbench base and its rotation set.
No paid dollar credits. Review native cardinal frames in the room before accepting any pair.
The side-camera object produces complete but overly shallow end views; reject it. The same
H0 reference with high top-down camera produces the accepted East view. Root and independent
reviewer accept original H0 plus high East in the actual room at native30x21 and16x26.
Table/viewport focused checks pass3/3. Total spend146 before workbench generation.
A32x24 workbench Pro call with H0 as style reference produces fragments; reject the batch.
Spend166. Use the successful unreferenced native-horizontal workflow for the bench, then its
exact object reference with the accepted high camera. The240 total hard cap remains unchanged.
One built-in image-generation design sheet precedes native production. Table pair is the
style test; workbench waits for its in-room check. Do not ship rejected candidates.
Estimate3 production/data files,1 test,2 documents and4 native PNGs; under200 code lines.

## Binding acceptance contract (reviewer ACK received)

### User-authorized addition during implementation

Jeff asks for adjacent tables and rugs to join, explicitly including corners and larger blocks.
He also rejects the shorter vertical table. Supersede the earlier V-size art ACK: both table
orientations need32px of tabletop length and the same5px vertical offset from their floor cells.
Compose native source patches over the occupied grid; do not stretch source bitmaps. Remove
shared borders and interior feet, retain outside rims and concave corners. Each placement remains
an independent inventory item, save record and body. Derive connections on place/remove/reload;
preview against the candidate-inclusive layout. Mixed orientations connect; rugs and tables do not.

The additional scene hooks explicitly unfreeze BaseWorldScene.ts, but not its camera or toolbar
logic. Archive before-connections.tar.gz records its pre-addition state. Prop.ts, UILayout.ts and
InventoryUI.ts remain frozen. A bounded agent owns the pure adjacency helper and its tests;
root owns the native compositor, scene hooks, art integration and browser verification.

Added gates: all8 neighbor bits/corners, mixed rotations, remove/split, scene isolation, separate
item types, real mouse-connected placement, joined pixel seams, save/reload, collision and preview
texture cleanup. Current user direction, not the superseded table-pair ACK, controls acceptance.

Jeff's final clarification rotates the same tabletop90°, then moves the two visible feet to the
new south edge. Implement this literally for the TOP only, followed by unturned apron/feet.
Both views now use the same source PNG; a full pixel comparison proves their tops match by90°.
The previous distinct-source test expectation is superseded for tables, not workbenches.

1. Table horizontal/vertical pair visibly shares warm wood, thin tabletop, short downward
   legs and straight axis-aligned edges beside the keeper. Only the tabletop rotates; feet do not.
2. Workbench pair follows the accepted geometry and stays visibly distinct from the table.
3. Preserve2x1/1x2 footprints, mouse/R placement, exact indexed collision, save/reload,
   second-cell workbench interaction and pickup. Keep native pixels at scale1.
4. Do not edit the toolbar/exit viewport fix. Check800/1440/1920 atDPR1/2 in actual WebGL.
5. Typecheck, build and the full four-worker test suite must return exit0. Keep all
   functional assertions; replace only the obsolete literal-image art assertions.

## Evidence and safety

Use planning_artifacts/furniture-perspective-2026-09-12 for the scoped pre-edit archive,
command captures, screenshots and independent review. Test screenshots use isolated storage;
suite uses the existing explicit5275 configuration. Never stop Jeff's5273 server, change
his browser/save, restore the dirty worktree, commit, push or deploy.

Memory tools remain unavailable; record blocked retrieval, not a claimed empty result.
Apply bug-fix-contract.v1 with current user preference as authority. Formal runtime approval
remains separate from local evidence; do not fabricate missing runtime events or approvals.

## Research findings

Jeff's supplied Travellers Rest screenshot shows broad flat tops, narrow front aprons and
short legs below them. Long north-south tables retain downward legs. The design inference is
to turn the tabletop's floor axes while keeping vertical height and lighting fixed.
The official [Travellers Rest page](https://store.steampowered.com/app/1139980/Travellers_Rest/)
confirms player-crafted furniture/decorating as its intended loop. Root also inspects its
"Your tavern, your rules" decorating footage in the browser: near-rectangular north-south
tops, restrained grain, short exposed feet, and keeper height close to total table image height.
This is direct visual research, not an inference from search snippets. The
[Stardew furniture reference](https://stardewvalleywiki.com/Mahogany_Dining_Table) provides
comparison context, not copied assets or implementation authority. No source game's pixels
enter runtime. The original generated design sheet is a direction reference only: its taper
and slightly long legs must not carry into the native pair.
