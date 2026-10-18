# Table and workbench perspective — September 12, 2026

## Direction

Jeff rejects the literal bitmap rotation experiment and the older mismatched views.
The replacement keeps the camera and short feet upright while the furniture turns on the floor.
Broad rectangular tops, quiet honey-oak boards and thin dark aprons keep the pieces readable.
These are original generated assets, not extracted game art.

Research: Jeff's supplied screenshot and the decorating footage on the official
[Travellers Rest page](https://store.steampowered.com/app/1139980/Travellers_Rest/).
The visual lesson is a large tabletop plane with little exposed leg height, not a tall front panel.

## Table source and final geometry

| View | Public file | Native canvas | Transparent-padding crop | Floor footprint |
| --- | --- | --- | --- | --- |
| Horizontal | `public/assets/furniture-perspective/table-horizontal.png` | 32×24 | x1,y2,w30,h21 | 2×1 tiles |
| Earlier north–south candidate, no longer rendered | `public/assets/furniture-perspective/table-vertical.png` | 34×34 | x9,y4,w16,h26 | 1×2 tiles |

Horizontal is Pro job `4f0ae2ca-41d0-4f93-8edf-bcb77c12ef92`, candidate0, seed912324.
North–south is the East frame of object `2478f2e7-7e06-46da-b5ed-25e3a9b3b20a`.
It uses the exact original horizontal PNG as `reference_image_base64`, `view: high top-down`,
and no size override. The generated South frame is not selected.

Root and the independent reviewer inspect both native images and the actual room pair.
Evidence: `planning_artifacts/furniture-perspective-2026-09-12/screenshots/table-identity-pair.png`.
Jeff subsequently rejects its shorter visible length and clarifies the intended construction:
rotate the same tabletop90°, with its two visible feet relocated to the new south edge.
That instruction supersedes the earlier pair approval. Only the horizontal PNG supplies table
pixels now. Runtime native patches produce a32×16 top horizontally or16×32 vertically, followed
by a5px upright apron/feet region. Full frames are32×21 and16×37 at scale1 in either view.
The earlier vertical PNG remains available for provenance, not active table rendering.

## Workbench files

| View | Public file | Native canvas | Transparent-padding crop |
| --- | --- | --- | --- |
| Horizontal | `public/assets/furniture-perspective/workbench-horizontal.png` | 34×34 | x1,y9,w29,h18 |
| North–south | `public/assets/furniture-perspective/workbench-vertical.png` | 34×34 | x9,y5,w16,h25 |

These are South/East frames of object`09056da5-0ade-48df-b839-04b50276504c`, generated with
`create_8_direction_object`, size32, high top-down camera and table object
`2478f2e7-7e06-46da-b5ed-25e3a9b3b20a` as `style_object_id`. Both keep the vise and feet upright.
Root and reviewer inspect the actual room pair. No pixel resizing or repainting.

## Rendering contract

`src/config/Furniture.ts` owns both floor footprints and authored views. Logical keys resolve
through the asset manifest. The loader creates crop frames without changing any source pixels.
Images remain angle0 and scale1. FurnitureSurfaceRenderer derives table/rug connections from
scene-local cells, copies native source patches into one canvas per placed piece and reuses one
preview canvas. Only the table's top enters a90° transform; feet draw afterward in screen-down
orientation. Interiors remove shared edges/feet; outside and inside corners retain their rim.
Rug fabric samples12..19, excluding the original inset border at8px. This prevents internal stripes.
Concave corners join native white/red/dark trim bands at their true inset, instead of leaving a
gap at the cell vertex. A mirrored construction covers all four inside-corner directions.
The existing collision, save and pickup systems retain independent items. No new save fields.

The toolbar and interior camera clearance remain unchanged. Connecting surfaces need scene
refresh hooks in BaseWorldScene, but its camera block stays byte-identical. Prop, UILayout and
InventoryUI remain byte-identical to the scoped baseline. Both furniture views pass actual mouse/R placement,
two-cell collision, save/reload and pickup checks. Workbenches also need second-cell interaction.

## Reproduction and rejected work

Full prompts, generation IDs, selection notes and failed experiments are recorded in
`output/pixellab/furniture-perspective/PROVENANCE.md` in the local work output.
The accepted native PNGs are copied without resizing, repainting or alpha modification.
Older assets remain untouched. No source-game image enters the generation reference chain.

The failed side-camera rotation has too little visible tabletop. Paired Pro sheets ignore
the intended object sizes. Some Pro image-reference calls produce fragmented sprites.
Those are observed outputs, not a confirmed platform bug. None are used by the game.
Final spend:206 subscription generations from4835 to4629, within the240 cap. No dollar credits.

## Verification

The final200-test four-worker suite passes, including pixel-exact tabletop rotation, joins,
perimeter feet, plain rug seams, inside trim, save/reload, collision, pickup and texture cleanup.
Build/typecheck pass. Actual WebGL captures cover20-piece connected room layouts plus six
window-size/pixel-density combinations. Root and independent reviewer inspect the images.
No personal save is changed; Jeff's final visual acceptance remains a playtest step.
