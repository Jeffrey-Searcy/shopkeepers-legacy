# Living farm art — September12,2026

## Direction and reference

The crop pass replaces all twelve old growth sprites, not their scale alone. Seeds stay small;
leaf shape and plant height explain growth. Parsnips use pointed leaves, potatoes use rounded
leaves and lavender flowers, and melons spread into a low vine with a visible mature fruit.

Studied the [official Stardew Valley farm screenshot](https://www.stardewvalley.net/wp-content/uploads/2012/04/StardewValley_1-1024x593.png)
and [official media page](https://www.stardewvalley.net/media/). The useful relationships are
quiet connected earth, small sprouts versus taller mature plants, leaves above the ground,
and one readable silhouette per planting cell. The new assets are generated original art;
no reference-game pixels enter the project.

## Native asset contract

- Every crop canvas is16×16. `crop-bounds.json` records the source rectangles and content sizes.
- The crop packer shifts intact native pixels into bottom-centered canvases. It never rescales.
- Root contact reaches the bottom pixel of each frame. Seed stages contain two brown seed flecks.
- `icon-stew`, `icon-ale`, `icon-oak-seed`, `icon-pine-seed` are transparent16×16.
- `icon-broom` is16×32 with11×27 native content. Only source transparent padding is removed.
- Pine full/small/sapling canvases are32×48,32×32,16×16. Collision remains a separate one-tile rule.
- Existing character, furniture, building, and oak art remains unchanged.

## Connected soil

The generated16px Wang soil family uses the existing canonical grass base. The packer removes
the generated green grass pixels so the actual world remains visible below. It brings orange
earth into the art bible's quieter warm-brown ramp. Water uses a darker version of the same
native pixels, not a blue rectangle or unrelated dirt texture.

The final144×144 atlas contains81 vertex frames. Four base-three digits encode NW/NE/SW/SE:
empty0,dry1,watered2. Water is clipped to the authored outer earth silhouette. Beds and watered
regions therefore connect across straight rows, corners, and blocks. Rendering stays scene-scoped.

Rebuild:

```sh
node scripts/build-living-soil.mjs
node scripts/build-living-crops.mjs
node scripts/pack-living-art.mjs public/assets/living-farm/broom-source.png public/assets/living-farm/icon-broom.png 16 32
```

## Generation provenance

Used the project-mandated PixelLab tools for native game assets; no CLI model fallback.
Account generations used moves from371 to402: **31 generations** for this art stream.
No paid credits are purchased or consumed outside the existing subscription.

| Asset | Generator and job |
|---|---|
| Final crop source | Pro Flash64×64, `730c85f2-eba6-4243-a646-eae952fedd30` |
| Final soil source | Standard Wang16px, `d7e0bd3f-5a28-40aa-85fb-f1ab88e07629` |
| Stew | Pixen16×16, `13e20d6a-ffad-44ca-b80a-b8ca4f40a468` |
| Ale | Pixen16×16, `5ba6e1e0-5f6f-4cee-b830-132f521bddf4` |
| Broom source | Pixen32×32, `8ca6d49e-c085-41ea-beb7-16f80bf815b3` |
| Acorn | Pixen16×16, `6b8a3aef-c78c-4ccc-947e-16d75446d2a4` |
| Pine cone | Pixen16×16, `d74dc19a-43b4-431d-a994-a44cd7179106` |
| Pine full | Pixen32×48, `683193fb-90fa-4dee-bbe5-73fca9a2cc5b` |
| Pine small | Pixen32×32, `76e148fc-89c4-4627-9acc-ded061930853` |
| Pine sapling | Pixen16×16, `5e91932b-be51-40b2-8348-68b3fb167328` |

Crop prompt: “A pixel art sprite atlas for a cozy farming game, exact64×64 native pixels,
transparent background. Four columns and four rows, each cell16×16 pixels. Top three rows:
crop growth stages, left to right sowing(two tiny brown seed flecks), seedling(two tiny green
leaves), young plant(four green leaves), mature plant. Row1 parsnip: pointed emerald leaves,
tiny pale cream root shoulder only at mature stage. Row2 potato: round emerald leaves, mature
broad plant with tiny lavender blossoms. Row3 melon: heart-shaped leaves becoming a low creeping
vine, mature round green striped melon nestled under leaf. Last row empty. All silhouettes fit
their cells. Ground contact near cell bottom-center. Roots stay underground; no orange soilballs,
pots, dirtpatches, text, gridlines, borders, or backgrounds. Native crisp colored pixels, warm
earthy palette, dark-green outline, two-step green shading, classic16-bit farming art.”

Seed902 drives the small Pixen item and pine prompts; the crop source uses seed120. Each prompt
uses the art bible's warm16-bit farming style, front-above view for plants and side view for icons.

## Rejected experiments

The first map-object crop sheet drew uprooted vegetables. The Pixflux strip miscounted stages.
Small Pixen crops repeatedly put orange root/soil lumps under seedlings. These are not referenced
by any crop manifest entry. Rejected downloaded samples remain recoverable in
`output/living-farm-rejected/`, outside shipped assets. The coordinated crop atlas fixes those problems.

The first square0-depth Wang set did not respect useful corner coverage. Its standard0.25
replacement supplies correct connected shapes. Two wet-family generations introduced weak
wet/dry contrast or bright outlines. They are not shipped. The final explicit shared-pixel wet
palette avoids mismatched silhouettes and is covered by pixel-level tests.

## Verification

- `npm run typecheck` passes after the art changes.
- Four permanent tests cover native icon alpha, all81 soil silhouettes, twelve distinct16px crop frames,
  and a WebGL fixture with24 native crop sprites and foot-based depth ordering.
- The isolated WebGL fixture and three pixel tests pass:4/4. The promoted fixture adds explicit sprite checks.
- Reviewed `output/living-farm-all-stages.png`: a cleared plot shows every crop stage on wet and dry beds.
- The fixture uses a new browser context and never saves, edits personal browser state, or changes a running server.

### Self-Audit

The generator drifts the second/third source rows by one pixel and shifts melon vines left.
The packer uses measured non-overlapping regions, preserves complete leaf silhouettes, and
rejects any bounds that cannot fit16×16. Final growth frames stay bottom-aligned.

### Expert Review

Root visually reviews and approves the final crop progression and quieter earth palette.
Root review remains responsible for integrated crop input, save behavior, and final live play.
This art stream does not claim those checks from screenshots alone. The independent art tests
verify water never changes an outer alpha silhouette and every selected asset is real native PNG.
