# Player-built shop art — 2026-09-12

## Reference and scope

Final integration: the lower horizontal table and dark vise workbench replace the rejected art.
The generated vertical-table revision fails the in-room check: its tapered, flat top reads like
an ironing board. Keep the prior `interior/table-vertical-v2.png` and its18×35 native crop.
Do not count the new vertical candidate as accepted or claim the rotation set is newly matched.
This decision restores only this packet's manifest/view edit; no user source is reverted.

Jeff's supplied Travellers Rest image guides this original art packet: broad golden oak boards,
substantial gray masonry with timber edges, furniture scaled to the keeper, and deep stairs at
the room edge. Its screenshot, logo, characters and furniture pixels are not passed into any
generator or copied into game assets. Prior player art and matching furniture stay unchanged.

The project `game-art` skill, `ART_BIBLE.md`, `PIXELLAB_GUIDE.md`, approved
`PLAN-player-built-shop.md`, and current PixelLab documentation are read before generation.
Native files remain unedited. Phaser may crop transparent margins, but must not squash or blur
pixels. Floor is a repeatable material, not a map object. Rejected and raw files stay under
`output/pixellab/player-built-shop`, outside Vite's public asset directory.

## Style-test gate

Only three samples queue before root inspection. Each Pro Fast quote is 5 subscription
generations. The initial packet budget is 40, with no paid dollar credit fallback.

| Sample | Tool | Native size | Job/object ID | Seed |
| --- | --- | --- | --- | --- |
| Golden oak floor material | create_image_pro_fast | 32×32 | `994e7d39-5a9d-47a3-8006-c9a5e8b73908` | 91240 |
| Stone/oak north wall | create_image_pro_fast | 32×48 | `01ca4911-db59-4083-969c-b7bb13d6108d` | 91241 |
| Oak workbench | create_object_pro_fast | 32×32 | `dbcc2bf6-11c3-44e6-a96b-180348a39e94` | 91242 |

Image source IDs: floor `c6a51a65-3b88-5e8e-ad47-0a84801bbfeb`, wall
`f33d89e3-f1e4-5a64-830e-918ff2047482`.

All prompts begin with the Art Bible's canonical warm 16-bit farming-sim style stem. Floor
requests four broad horizontal boards, low-contrast tiny grain, staggered joins and seamless
opaque edges. Wall requests four substantial warm-gray stone courses over an oak skirting beam,
full-bleed 32×48, no posts or decorations, horizontal repetition. Workbench requests a broad
30-pixel honey-oak top, thick dark walnut legs, front stretcher and a small iron vise, flat
front-above view with no diagonal isometric angle and transparent background.

This packet owns new PNG assets and this provenance document only. Shared logical keys,
manifest, maps, collisions and scene rendering belong to the root integration packet.

## Accounting

Before: 4,890 subscription generations remain; $0.00 dollar credit balance.
Style-test quotes reserve 15 generations. Final balance and acceptance remain pending.

Floor and wall finish with native32×32 and32×48 opaque frames. Unchanged downloads are retained
under `output/pixellab/player-built-shop/{floor,wall}-download`, and runtime copies are
`public/assets/shop-rebuild/floor-oak.png` and `wall-north.png`. Both contain only alpha255.
Full frames are the intended texture repeats; no crop or scaling is needed.

The first workbench job fails with PixelLab's internal `[500] [Errno 5] Input/output error`.
It returns no image and does not charge the account. A single same-design retry queues as object
`ea1c2365-7686-4734-8450-ac58d06ec1f1`, job `a5afdaa0-d6e1-4be6-b914-c6b55f902704`, seed91242.
After the two material jobs, balance is4,880:10 generations used so far.

Root confirms workbench and stove use fixed south-facing rotation0, with2×1 floor footprints.
No extra directions are generated. Price lookups for the later64×80 stair,32×48 doorway and
32×40 stove each quote5 generations. These jobs wait for root's style-test ACK.

The workbench retry finishes successfully as `public/assets/shop-rebuild/workbench.png`.
Its native canvas is 32×32; visible alpha bounds are x0,y5,w31,h24. It uses binary alpha0/255.
Use a Phaser crop frame at those bounds and display its native31×24 pixels. The worktop, legs
and vise now read as one substantial piece rather than a miniature icon.

After all three successful style samples, balance is 4,875:15 generations used. The failed
workbench job costs zero. A read-only horizontal edge check measures mean RGB jump4.75 for the
floor and11.06 for the wall (0–255 scale). These measurements do not replace a tiled in-scene
check; root must still inspect repetition and proportions with the keeper.

Root inspects the three native samples and accepts their direction. The first functional
in-scene check needs the stove because a recipe already references it. Root authorizes only
that additional style-sample object; stair and doorway generation stay paused.

Stove: object `1e9e2cc0-c820-4dd5-8a20-059fc316e417`, job
`d01835cf-c0f0-49ec-a3b9-cc0ab8ce1d17`, Pro Fast32×40, one south-facing view, seed91243.
Price lookup and queue response both quote5 generations. The prompt specifies a broad30px
cast-iron stove with two burner plates, a gray stone base, warm oven grating and short chimney.
Straight horizontal front and floor edges preserve the square-grid perspective. It includes
no food, pots or labels. The station uses the agreed2×1 footprint and rotation0 only.

Stove download: `public/assets/shop-rebuild/stove.png`, original32×40 PNG, alpha crop
x1,y2,w28,h36. It uses only alpha0/255. Native inspection confirms a straight front-facing iron
range, two burner plates, short chimney and warm oven glow. Root and the furniture owner receive
the crop before logical wiring. After the stove completes, balance is4,870:20 of40 generations
used in this packet. Stair and doorway still wait for the integrated style-test ACK.

Root inspects the actual1440×900 WebGL style sample and accepts the broad warm floor and
gray-stone direction. It then authorizes the stairs and open rear doorway.

| Architecture | Object ID | Native size | Seed | Quoted cost |
| --- | --- | --- | --- | --- |
| Guest staircase | `b699938c-1e08-41bb-af64-7a3d65e1f139` |64×80|91244|5|
| Rear doorway | `41b1c24f-9bae-4086-9869-e6a550ac4833` |32×48|91245|5|

Both use one direction and side view. The original wall image source ID provides style guidance;
the supplied Travellers Rest screenshot never enters either tool. Stair prompt requires8–9
full-width horizontal oak treads from bottom to top, a deep upper opening and side rails only,
with no front crossbar. Doorway prompt requires a heavy oak/stone frame around an open dark
passage at least20px wide, a warm floor threshold, no door leaf and no labels.
Stair generation copies detail/outline/shading without forcing all stone colors onto its wood;
doorway also copies the wall palette. Native crops and final account balance remain pending.

Stairs finish as `public/assets/shop-rebuild/stairs.png`, original64×80 canvas, crop x3,y1,w58,h77,
binary alpha. The silhouette nearly fills the4×5-tile recess. Long rows of treads lead into the
dark upper opening, with side rails but no front fence. The first doorway job fails with the same
internal PixelLab I/O error as the first workbench. It costs zero. One unchanged-design retry
queues as object `0bc6d3bc-8a2d-4cc5-aa1c-60cca59000af`, job
`0ae5eaf6-3a42-4267-a0eb-9ef906c13e16`.

After reviewing `output/playwright/player-built-shop/style-sample.png`, the art and root agents
identify visible horizontal bands of join marks in the repeating floor. Root authorizes one
5-generation material variation, with no edit of the approved file. It specifies four broad
boards with a different staggered joint on every row and quieter grain, guided only by the
original floor's palette. New job `e52f68ac-98f6-4f1e-b445-8ee7e4a0237c`, image source ID
`5e5ed84d-f206-56ed-96b3-0d1e71aa6836`, seed91246,32×32 opaque Pro Fast material. Its candidate
must stay outside public until root compares the integrated scene.

After stairs, balance is4,865:25 generations spent. Door retry and floor variation reserve10,
for an expected total35 of40. Both failed I/O jobs cost zero.

The doorway retry succeeds: `public/assets/shop-rebuild/doorway.png`,32×48 native canvas,
crop x2,y1,w28,h45, binary alpha. The open passage occupies raw x9–22,y11–39, with a threshold
at y40–44. The first floor variation downloads outside public as
`output/pixellab/player-built-shop/floor-oak-v2.png`,32×32 opaque. Balance then is4,855:
35 generations used. Doorway download completes immediately before root's public-file freeze
arrives; no further public writes occur during that freeze.

Root integrates the architecture and inspects the DPR2 WebGL room. The floor variation creates
visible jigsaw/T-shaped seams on repetition and is rejected. Root authorizes the final remaining
5 generations for a64×32 material with four uninterrupted8px horizontal board rows, long simple
rectangular planks, fine staggered vertical joins, nearly flat warm-brown surfaces and no bright
yellow edge highlights. No prior image guides this final material, to avoid preserving the bad
interlocking pattern. Job `53f34733-de56-4bcb-90cd-a2956d6247a7`, source image ID
`97e614b0-0d5c-5b1d-93e5-ce1908d0b2e7`, seed91247. The exact capability quote and queued response
both give5 generations. Save this candidate outside public until root reviews the actual room.

The final candidate downloads only to `output/pixellab/player-built-shop/floor-oak-v3.png`.
It is an opaque64×32 PNG with straight rectangular boards and quiet brown grain. However,
PixelLab adds white margins despite the full-bleed request. Read-only pixel inspection finds
the actual wood at x1,y1,w61,h28; four board rows are7px high. The full frame is therefore
NOT a usable seamless floor. Root may compare the native61×28 Phaser crop without changing
pixels or stretching it. This limitation is reported before any manifest/scene integration.
Final floor acceptance remains open until the actual repeated room is inspected.

Final account balance:4,850 of5,000 subscription generations remain, $0.00 dollar credit.
This packet uses exactly40: floor5 + wall5 + workbench5 + stove5 + stairs5 + doorway5 +
floor variation5 + final floor5. Two internal I/O failures cost zero. No further art jobs queue.
All final candidate writes stay outside public after the last freeze; shared keys, maps,
metadata and manifest remain untouched by this art packet.

## Furniture correction after new user feedback

Root accepts the final quiet floor's native61×28 crop after an actual in-scene comparison.
It reads substantially better than either brighter patterned candidate. This is root's internal
visual ACK, not a claim that Jeff approves the completed room.

Jeff then explicitly rejects the table and workbench appearance. The crafting screenshot
`.frontend-loop/player-built-shop/screenshots/round-02-1440-dpr1-crafting.png` shows the old table
reading like a chair: a tall back-like surface and tiny seat-like lip. Root reopens this art
packet with15 additional subscription generations, for a total55 cap, and no dollar credits.
Footprints, rotations, collision and save data contracts stay unchanged.

Stage one generates only a horizontal table and fixed-facing workbench. Pro Fast capability
quotes and queue replies are5 each. Root must inspect them in scene before the remaining
5-generation matching north-south table may queue. All candidates remain outside public.

| Candidate | Object ID | Native size | Seed |
| --- | --- | --- | --- |
| Wide low walnut table | `ced91157-d93a-4894-8b67-38767ae46c63` |32×24|91248|
| Wide low walnut workbench | `8d5adba1-0f20-4a4c-aed6-20251a5490a9` |32×28|91249|

Both use high top-down as the camera setting and explicitly request a front-above RPG view.
Table prompt specifies a30–32px-wide horizontal tabletop plane with10–12px depth, a thin2px
front apron and short6px legs; no backrest, panel, chair or side-on slab. Workbench requests a
similar broad medium walnut top with a small charcoal vise, short legs and restrained grain.
It forbids yellow striped boards, blue parts and tall tool racks. The supplied reference image
is inspected again, but its pixels are never supplied to the generator.

Stage-one downloads are output-only:

| File under output/pixellab/player-built-shop | Native canvas | Alpha crop x,y,w,h |
| --- | --- | --- |
| `table-horizontal-v2.png` |32×24|0,3,31,19|
| `workbench-v2.png` |32×28|3,5,27,19|

Both use binary alpha0/255 and have lower, wider silhouettes than the rejected art. The table
has no tall back-like panel. The workbench loses the yellow stripes and blue frame. Its visible
width is27px rather than the requested30–32px; this is disclosed rather than enlarged by scaling.
Root must judge the horizontal tabletop depth and overall proportions in the actual scene
before these samples are accepted. No shared metadata or public files change in this stage.

After this stage, balance is4,840:50 generations used from the revised55 cap. The remaining
5-generation north-south table remains paused at the scene gate.

Root wires stage-one assets unchanged and inspects
`.frontend-loop/player-built-shop/screenshots/round-03-1440-dpr1-room.png`. It accepts the lower,
wider table geometry and walnut workbench for integration, while keeping user visual approval
open. Root then authorizes the final matching north-south table.

North-south table: object `472de3c6-703f-4daa-81bf-ae8e20efb8ef`, job
`fb0517a6-ae38-4329-a53b-1fd567f7cba7`, Pro Fast32×40, one high-top-down view, seed91250,
quoted5 generations. The accepted horizontal table URL guides palette, detail, outline and
shading. Prompt asks for a long upward-facing tabletop, thin front apron, short4–6px legs,
dark warm walnut, no tall panel and no diagonal isometric rotation.

Output-only download: `output/pixellab/player-built-shop/table-vertical-v2.png`.
Native32×40 canvas, alpha crop x5,y2,w22,h35,42 opaque colors and binary alpha0/255. The generated
top tapers from14px at the back to22px across the front apron; bottom feet span18px. That is
slightly wider than the requested14–17px visible silhouette and gives a small overhang beyond
its1×2 footprint. This is reported before root integration; do not squash the pixels to hide it.
Root's in-scene assessment of this final orientation remains required.

Final revised accounting:4,835 subscription generations remain, $0.00 dollar credit. This
player-built-shop art packet consumes55 total, exactly the reopened cap. No further jobs queue.
The final orientation download changes no public asset, shared metadata, map or game source.
