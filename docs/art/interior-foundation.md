# Interior foundation art — 2026-09-12

This packet creates new native pixel assets for the shop's interior. Existing bitmap assets and
the player remain unchanged. Travellers Rest guides substantial furniture, quiet wooden floors,
plaster and timber walls, and front-above depth. No game screenshots are copied into assets.

Research references: [Travellers Rest official press kit](https://www.isolatedgames.com/travellers-rest-press-kit/)
and its interior screenshots guide room materials and scale. [Necesse](https://www.necessegame.com/)
and the [reference title menu](https://app.pingcore.io/uploads/knowledge-base/1-multiplayer_1761135500.png)
guide conventional game navigation. These are references, not shipped art sources.

## Pipeline and acceptance

Read the project `game-art` skill, `ART_BIBLE.md`, `PIXELLAB_GUIDE.md`, and live PixelLab MCP docs
before generation. Download generated PNGs without pixel edits. Inspect native pixels and alpha
bounds. Phaser may crop transparent padding into named frames; it must not blur or squash art.
Footprints use the shared furniture definition, not PNG canvas size. Final acceptance requires
the assets together with the keeper in a real game screenshot and Jeff's later visual approval.

Root and an independent reviewer inspect the final WebGL arrangement in
`output/playwright/interior-foundation/furniture-final-1440-webgl.png`. The revised vertical table
matches the horizontal walnut table. The vertical bar is slightly brighter, accepted for this
bounded pass. This is internal acceptance only; Jeff's visual approval remains open.

Canonical prompt stem:

> 16-bit top-down 3/4 farming-sim pixel art, cozy warm palette, subtle dark outline, soft shading
> with top-left light, grounded (not floating), clean and readable at small size,
> Stardew-Valley-inspired.

## Style tests

| Asset | PixelLab ID | Native alpha bounds | Decision |
| --- | --- | --- | --- |
| `rejected/table-iso.png` | `fdda2961-12eb-4986-ada1-37b4fc2fb7bb` | x2 y4 w28 h24 on 32×32 | Reject: diagonal perspective |
| `rejected/chair-iso.png` | `08bfde64-7a76-4755-ab39-92c7554c1f91` | x7 y1 w18 h31 on 32×32 | Reject: diagonal perspective |
| `rejected/table-flat.png` | `24ad95fb-c5be-4062-98c4-0553e806b7c0` | x4 y8 w24 h16 on 32×32 | Reject: short, shallow tabletop |
| `rejected/chair-bench.png` | `ff29e6d6-1274-458e-b471-a421d3a2c58f` | x4 y8 w24 h18 on 32×32 | Reject: bench-like proportions |

All four use `create_map_object`, 32×32, side view, selective outline, basic shading, low detail.
The first pair requests a front-facing honey-walnut long table and tall slatted chair. The second
uses the skill's stronger flat paper-cutout wording. Two failed attempts trigger reassessment:
the separate eight-direction object tool now generates real cardinal chair views from scratch.
Rejected files remain separate and are never registered in the asset manifest.

## Architectural kit

PixelLab ID: `0628432b-057c-4518-928a-1cee9eb883f7`.
`create_building_kit`: square_topdown, tile_size 16, wall_tiles 2, materials layout,
tile_view_angle 90, wall_angle 5, segmentation outline, seed 91226.
The first validation-only request used wall_angle 0; the tool requires at least 5 and queued no job.

Floor prompt after canonical stem: quiet low-contrast warm brown oak plank floor, broad horizontal
boards, subtle tiny grain, no knots or checkerboard, muted medium walnut wood like a cozy
Travellers Rest medieval inn interior.
Wall prompt after stem: warm cream lime plaster walls, sturdy dark walnut timber top beam,
lower gray-brown stone foundation course, medieval Travellers Rest interior architecture,
quiet broad surfaces, strong depth, no furniture or signage.
Upper floor description: dark walnut timber wall cap.

## Cardinal chair

PixelLab ID: `a1a734b7-bae9-4602-9943-da82964e836b`.
`create_8_direction_object`: size 32, low top-down. Quoted cost 20 generations.
Prompt after canonical stem: sturdy full-height rustic oak dining chair, tall upright backrest,
two horizontal back slats, broad square wooden seat, four short sturdy legs. Honey walnut brown
wood, dark walnut shaded structure. Single chair, not bench, no person or cushion. Nearly fill
canvas height. Front/rear cardinal views square to camera, side views truly in profile, flat
horizontal ground line, transparent background.

### Download and native crops

The original kit ZIP is `public/assets/interior/architecture-kit.zip`. All 80 original pieces
are extracted under `architecture/raw/`; their final filename number matches the PixelLab tile
index. Convenience copies `architecture/floor.png` and `architecture/wall-north.png` contain
the unchanged tile 0 and tile 1 PNG bytes. Every kit canvas is 24×28.

- Floor: crop x4,y8,w16,h16. Three muted walnut colors; no bright checkerboard or large knots.
- Plaster/timber material: north-wall crop x4,y4,w16,h8. Repeat native pixels vertically to form
  a character-height wall; do not scale the short kit piece to stretch its pixels.
- Stone base: north-wall crop x4,y12,w16,h4, placed below the plaster field.

The generated north wall has only 12 visible pixels of height, despite the 2-tile request. It is
accepted only as a reusable material, not as a complete room-height architectural module.
The kit's small stairs are not accepted as player-scale finished stairs.

Chair PNGs have 34×34 canvases with the following alpha bounds. Select these as Phaser crop frames
and display at their native dimensions, bottom-centered over the one-tile footprint.

| File | x | y | width | height |
| --- | --- | --- | --- | --- |
| `chair-south.png` |9|3|16|27|
| `chair-north.png` |10|6|14|23|
| `chair-east.png` |9|4|15|26|
| `chair-west.png` |11|5|14|25|

These are actual cardinal views, not rotated bitmap rectangles. Side views stay upright.
Root reviews the native samples before further furniture generation.

Root accepts the chair and architectural materials for in-scene style testing after inspecting
the native south/north/west views, floor and wall. This does not claim Jeff's final approval.

## Matching furniture batch

Table: `7cb73063-347b-48a9-ab2a-e4b84597b76b`.
Bar counter: `6078a723-ace4-44c2-9731-a7d5d57f2660`.
Both use `create_object_pro_fast`, eight directions, low top-down, native36×36 canvas. The canvas
fits the unchanged34×34 chair style reference without resizing. South is the horizontal view;
east is the vertical-footprint view. Each queue response estimates6 subscription generations.
Seeds: table91227, counter91228. The style reference is the generated chair's south-facing URL;
palette, detail, outline and shading matching are all enabled. The reference guides style only,
not an edit of the chair. New subjects have broad honey-walnut tops, sturdy dark walnut legs or
panels,30px horizontal width and28px height, and square front-above edges instead of diagonal
isometric edges. The table stays empty; the counter has no taps, stools or products.

Register: `d73e7f54-7c38-4794-bc3b-3c347bfbf611`, `create_map_object`,32×32, side view,
selective outline, basic shading, low detail. Subject: compact brass cash register on oak base,
dark number window, cream keys, upright flat-front view, intended16×20 visible pixels.

Rug: `9207ac8c-2872-4cf1-b887-7dfbcd6fec85`, `create_map_object`,32×32, high top-down,
lineless, flat shading, low detail. Subject: flat square woven rug, terracotta field,
walnut border and cream corner accents, straight overhead square edges, no tassels.

Rug downloads as `rug.png`, native32×32 with alpha bounds x2,y2,w28,h28. Keep the full32×32
frame for floor placement: the two-pixel inset is intentional space inside its2×2 footprint.
The first register is rejected at `rejected/register-iso.png` (bbox x5,y4,w22,h24) because it
faces diagonally. One basic retry, `3d3f09b3-4c4d-48fa-8285-bdf6b05a8476`, uses the skill's
flat paper-cutout wording and replaces trope-loaded cash-register wording with an upright
brass till: a honey-brown box, small number board, cream button row and drawer knob.

The register retry also fails the cardinal-view requirement and remains at
`rejected/register-retry-iso.png` (bbox x5,y2,w21,h29). Stop using the basic model for this subject.
Root approves a final bounded Pro Fast retry after inspecting both rejected register and table
views. The total subscription cap becomes69; no paid dollar credits are authorized.

Root accepts the table's south view and both counter views for scene integration:

| File | Original canvas | Native crop x,y,w,h |
| --- | --- | --- |
| `table-horizontal.png` |36×36|4,4,27,29|
| `bar-horizontal.png` |36×36|0,7,34,24|
| `bar-vertical.png` |36×36|8,2,18,31|

The table's east view is too square (26×29) and does not communicate a1×2 footprint. It moves
to `rejected/table-vertical-too-wide.png`; it must not be registered as the vertical table.

Final narrow-end table: `4d152093-a270-4f1e-8105-cb9635d9aaef`, Pro Fast one direction,
native16×40, low top-down, seed91229, quoted5 generations. Its prompt explicitly gives a tall
narrow tabletop extending away from the viewer,14–16 pixels wide,35–39 pixels tall, sturdy
short legs and honey-walnut wood. The accepted horizontal table's36px reference cannot fit a
16px-wide target without forbidden image resizing, so its visible design and colors guide the
text prompt instead. No reference bitmap is changed.

Final register: `e66bbaab-b2d1-44c8-bfb5-de1e0fad3905`, Pro Fast one direction,
native20×28, side view, seed91230, quoted5 generations. Prompt describes a symmetric front-facing
brass till on a dark walnut pedestal, cream key row, centered drawer knob, and no side face.

Final download crops:

| File | Original canvas | Native crop x,y,w,h |
| --- | --- | --- |
| `table-vertical.png` |16×40|2,3,11,33|
| `register.png` |20×28|1,1,18,26|

The final register is upright and front-facing. The final vertical table now communicates a
narrow end and long floor footprint, but its silhouette is narrower and lighter than the
horizontal table. It has278 distinct opaque RGB colors, while the horizontal table has71.
This custom-size result needs explicit in-scene visual review before final acceptance; do not
claim the native palette is fully matched. No postprocessing hides that difference.

Native PNG checks find only alpha0 or255 in all selected furniture and architecture files.
There are no partially transparent softened edges. The floor uses3 colors, wall11, rug8,
chair views27–33, counter views62–79 and register83. PixelLab's newer object pipeline uses more
colors than the Art Bible's approximate16-color target; visible consistency remains a review
gate, not an unsupported claim.

## Subscription accounting

Before: 4,964 of 5,000 subscription generations remain, $0.00 dollar credit balance.
Four basic style tests consume 4 generations. Kit cost was absent from the live tool schema;
its queued response disclosed 20–40. Root raised the internal cap to 60 subscription generations,
including all rejected tests. No paid dollar credits are authorized. After kit and chair finish:
4,920 remain, so 44 total generations are used (20 kit + 20 chair + 4 rejected tests).
The newer `create_object_pro_fast` pricing lookup quotes 5 for one 32×32 image and 6 including
eight directional views before queueing.

Final balance:4,895 of5,000 subscription generations remain, $0.00 dollar credit balance.
Total used for this packet:69 (20 kit +20 chair +4 initial rejected style tests +6 table +6 bar
+1 rug +2 rejected registers +5 final narrow table +5 final register). Root explicitly approves
both internal cap increases after inspecting the failed candidates. No further jobs are queued.

## Handoff

Asset keys and source paths remain the root integration packet's responsibility. This packet
does not edit the shared manifest, AssetKeys, scenes or furniture definition. All proposed
furniture frame crops are sent to the furniture definition owner. The game-art skill changes
the process through native sizing, style-test gates, rejected-art separation, and explicit
alpha bounds. The root's real-game screenshot checks and independent review remain pending.
