# Proven art workflow

Read actual source plus this page for the asset type you are changing. The approved originals,
geometry and screenshots are stronger references than an old prompt alone. Generation is variable;
these recipes preserve constraints, not guaranteed quality. Follow the active image tool and skill rules.

## Jeff's supplied visual references

For relevant art work, inspect the preserved [Travellers Rest interior screenshot](references/travellers-rest-interior.png)
and [Stardew porch screenshot](references/stardew-porch.png). They are exact copies of Jeff's supplied images,
kept for analysis/inspiration only—not licensed game assets or images to put into the runtime manifest.
The first shows the warm wood/stone, substantial furniture and room depth he asks for. The second shows
feet grounded on a porch beneath the facade. Neither is approval of our current town interiors.
The source files were a chat clipboard PNG and `Screenshot 2026-09-12 at 2.23.17 PM.png` respectively.

## Painted areas (current)

The Town, eleven town interiors, the jail cell, the Forest, the Beach, the Gate Plaza and the dungeon rooms
are each one painting. The flow is:

1. The source painting lives in `docs/art-source/<area>/`.
2. A packer in `scripts/` (`pack-town-art.py`, `pack-civic-interiors-art.py`, `pack-forest-art.py`,
   `pack-beach-art.py`, `pack-gate-plaza-art.py`, `pack-dungeon-rooms-art.py`) fits it to the map and writes
   the textures. Shared helpers are in `scripts/painted_art.py` and `scripts/painted_outdoor.py`. The packers
   need numpy and Pillow. Read the packer's header for its usage and outputs.
3. A data module in `src/world/` (`TownArt.ts`, `CivicRoomArt.ts`, `ForestArt.ts`, `BeachArt.ts`,
   `GatePlazaArt.ts`, `DungeonRooms.ts`) holds the walk grid traced over the painting, the doors and the
   pieces drawn above the keeper. Some packers print values that must be copied into these modules.
4. `src/world/PaintedRoomRenderer.ts` draws it. It throws when a texture is missing or has the wrong size.

The walk grid is traced over the painting, so what you see is what you hit. If a painting or its scale
changes, retrace the grid in the same change.

## Keeper art (the player)

From the repo root, run `python tools/keeper-art/build_sheets.py .` (needs `tools/keeper-art/requirements.txt`:
numpy and Pillow). It writes the keeper sheets and garment images to `public/assets/characters/`,
`player-keeper-v5.metadata.json`, and `src/config/KeeperArt.generated.ts`. Each frame is 96×64.
Do not edit the generated module by hand. The script checks every sheet before it writes it.

## The town facades (history)

The Town is now one painting, so these separate facades are no longer drawn. `TownBuildingFront.ts`
is still in the repo but nothing uses it. The steps below are kept as history.

Exact prompts: [twelve facades](../art/town-buildings-v1/PRODUCTION-PROMPTS.md).
Sources: `public/assets/objects/town-*.png`, referenced through `public/assets/manifest.json`.
Registration: `src/config/TownBuildings.ts`, `src/world/maps/town-building-art.json`.
Presentation: `src/world/TownBuildingFront.ts`; movement: `src/scenes/TownScene.ts`.

1. Design a distinct silhouette and materials around a building's role and fixed resident. Use a
   frontal orthographic facade with some roof visible, crisp broad clusters, warm palette, top-left light.
   Avoid angled isometric side walls, microtexture, text, people, landscape, and generic shop recolors.
2. For this renderer, generate **roof and wall only**, a flat wall baseline and a dark rectangular
   door aperture. Do not bake in the platform, porch, steps or closed door. Runtime owns those layers.
3. Inspect the actual PNG and alpha. Requested dimensions are not guaranteed. Preserve source bytes;
   register measured alpha bounds as runtime crops. Painted checkerboards are not transparency.
4. Register authored native facade width and door offset. Current widths are 128–192 logical pixels;
   use each building's catalog value, not a universal resize. Native doors are 24×40, landing depth 16.
   Do not derive collision from the full padded bitmap or force every aperture to the image center.
5. Keep the catalog geometry shared by facade, collision, warp and return spawn. The wall sits behind
   the keeper, the landing underfoot, the door/frame in the appropriate foreground depth. Opening and
   keeper movement run concurrently for 100 ms; the shared transition owns the actual scene change.
6. Review one candidate at player scale before a batch. Inspect every final facade and walk into/out of
   all affected doors. Test lateral movement across the porch so it cannot cause accidental entry.

The first collision pass included empty plot margins and made invisible walls. Fix geometry, not
player collision or movement speed. Wide decorative silhouettes are not automatically solid footprints.

## Town interiors

Eleven of the twelve rooms are now paintings (see Painted areas and `src/world/CivicRoomArt.ts`). The clinic
still uses the built room from `CivicInteriorMap.ts` and `CivicDecor.ts`. The notes below apply to the built
room and are kept as history for the rest.
Built rooms were functional foundations, **not Jeff-approved final interiors**.
Use Travellers Rest for material richness, spatial hierarchy and coherent furniture scale. Research
current references when asked; identify the specific visual qualities rather than asking to clone a game.

Read `src/config/TownBuildings.ts` (room dimensions/fixtures), `src/config/CivicFeatures.ts`
(fixed feature footprints), `src/world/CivicInteriorMap.ts` (solid/reserved cells),
`src/scenes/CivicInteriorScene.ts`, `src/world/CivicDecor.ts`, and `src/world/InteriorRenderer.ts`.
Do not alter the player's Tavern/Bedroom maps just to improve a public room.
Start with one room: readable entrance, substantial wall depth, purposeful fixture grouping, clear
walking space, feet-aligned furniture, and door visibility beneath the HUD. Inspect the residents.
Changing solid/reserved cells can affect saved positions; assess compatibility before changing room layouts.
The existing screenshot/door test is `tests/town-buildings-travel.spec.ts`; the WebGL script and
focused test groups are in ENGINEERING_AND_TESTS. Inspect those before adding a duplicate visual harness.

The existing [16-prop atlas prompt](../art/town-buildings-v1/INTERIOR-ATLAS-PROMPT.md) uses a 4×4 layout,
but runtime crops are measured individually in `src/world/maps/town-prop-art.json`.
It was requested at 1536² and returned at 1254². Never slice it using the requested size.
Tall features display near actor scale, with proportional sizing inside authored footprints.
An earlier oversized footprint left excessive empty collision space: the final fit check limits total
horizontal gap to eight pixels for these specific atlas props. Do not treat that threshold as universal art quality.

## Furniture and UI

Use `Furniture.ts`, `FurnitureConnections.ts`, `FurnitureSurfaceRenderer.ts` and
[the furniture reference](../art/furniture-perspective.md). Top-left tile anchor, full rotated footprint,
native crop, bottom edge, leg location, preview and collision must agree. A bitmap turn is not a physical rotation.
Connected groups retain borders/legs at their outside edges. Preserve workbench and chair authored views.

Read `CozyTheme.ts`, `TextRendering.ts`, `UILayout.ts` and the affected UI class before menu changes.
Do not blur all world textures to fix text. Text uses display-resolution rendering; native pixel art stays crisp.
Test full-screen desktop and narrow/Retina views, mouse targeting, modal focus and actual door visibility.

## Supplied characters and animation

The `game-character` skill and its ShopkeepersLegacy adapter are local to the author's machine.
They are not in this repo. Do not repeat that large workflow here. Preserve identity, complete silhouettes and fixed feet.
Residents use `TownResidents.ts` independently of random visits.

Unique image hashes alone do not prove a smooth gait. Watch actual soles alternate at play speed.
Do not reuse one character's masks/boot color on another body, or crossfade whole bodies to fake new motion.
Pixel-changing scripts require authorization and must follow the current image tool rules. This page grants none.

## Deliverable and evidence

Keep original generated sources and prompts; add logical keys only when files are present and verified.
Capture and personally inspect the live result, not only enlarged source sheets. Pair source/alpha tests with
native input, WebGL screenshots, and motion playback when animations change. State approximation or missing tools.
Say whether work is a preview, staged implementation, or installed game; do not conflate those states.
