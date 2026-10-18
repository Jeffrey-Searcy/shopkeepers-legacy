# Neutral storefront artwork — 2026-09-12

The user requests a shop-neutral shell and an occupied porch like the supplied Stardew reference.
No Stardew pixels are copied. The existing tavern PNG remains unchanged and available.

## Source and provenance

- Pipeline: project `game-art` skill, PixelLab native 160×160 transparent object generation.
- Source guidance: `docs/ART_BIBLE.md`, `docs/PIXELLAB_GUIDE.md`, live https://api.pixellab.ai/mcp/docs.
- First style test: `2fb6414f-58cc-4b24-842f-d89cbcb3015d`, saved as
  `public/assets/objects/shop-facade-style-test.png`. Rejected: narrow roof and too little porch depth.
- Selected facade: `d8cf5a3b-6325-4656-8dee-32db93ca0c6d`, saved unmodified as
  `public/assets/objects/shop-facade.png`. Native RGBA160×160, content bounds x13–146/y12–139 inclusive.
- Both calls use `create_map_object`, view `side`, selective outline, basic shading, medium detail.
- Credit measurement: 4966 subscription generations before;4964 after. Two generations used, no dollar credit.

Prompt direction: warm muted 16-bit farming-sim palette; flat frontal cream plaster and honey oak
storefront; terracotta roof; two display windows; central open dark door; no text, signs, mugs,
branding, people, or background. The second prompt asks for a broad low roof and a deep floorboard
porch. Both generated images collapse the requested deck. We stop that prompt approach after two
attempts and construct the actual porch as separate native-pixel layers. This is intentional
architectural composition, not a silent missing-art substitute.

## Native layer contract

The facade source pixels remain unchanged. Draw origin is world(1088,82), with no scaling.
The renderer uses its top128 rows; its generated bottom stairs are not used.

| Layer | Source / world placement | Depth |
| --- | --- | --- |
| Roof and wall | Source(0,0,160,128), world(1088,82) | -6 |
| Foreground roof/lintel | Source(0,0,160,85), world(1088,82), aperture excluded |208 |
| Open aperture | Source x69–90/y85–125; world x1157–1178/y167–207 | Part of back wall |
| Oak door leaf | Native runtime trim22×41; world(1157,167) |209 |
| Walkable porch | Source timber crop(24,131,112,6), tiled at(1104,208),128×16 | -6.4 |
| Stone plinth | Native trim at y223–232; under porch | -6.5 |
| Center steps | Three treads at y224,229,234, centered x1168 | -6.3 |
| Front posts | Source crop(18,88,6,16), repeated vertically at(1106,160)/(1224,160),6×64 |224 |

The actual deck is eight tiles wide within the ten-tile building canvas. Transparent margins do
not count as wall or porch. Root-owned collision must follow the deck, narrow post feet, central
steps, and door aperture; not the full160×160 canvas. Source artwork and physics stay independent.
The door opens with integer leaf widths22→14→5→3 over360ms. It invokes one continuation and never
changes player state or scenes itself. Scene-local timers and artwork die with Phaser shutdown.
The aperture has opaque dark pixels (RGBA3,1,1,255), not a transparent hole; no grass shows through.
The separate lintel crop hides the keeper's head as they cross the sill without masking the doorway.

## Checks and remaining integration evidence

Downloaded both with `curl -L --fail` and verified PNG metadata and alpha bounds with pngjs.
Inspected both native images. Root accepted the second facade for an in-game style test.
TypeScript validation passes. An isolated browser on the existing5273 server captures
`output/playwright/shop-home/shop-front-style-test.png` and `shop-front-half-open.png`.
The inspected image shows feet on the timber plane, the vertical stone face, and central steps.
The probe observes closed→open and rejects a second `openDoor` call without another continuation.
Root owns final browser day/night/occlusion screenshots and the real walk-in/round-trip tests.
