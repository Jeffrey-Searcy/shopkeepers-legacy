# ShopkeepersLegacy — Art Bible

> The canonical art spec so every PixelLab asset is cohesive. The video creator had no such
> doc, which is partly why his result looked inconsistent (floating houses, mismatched shadows).
> Read this AND `docs/PIXELLAB_GUIDE.md` before generating art. Keep these values FIXED across
> every generation so nothing clashes.

## Target look
Cozy, warm, readable 16-bit farming-sim pixel art in the spirit of Stardew Valley: hand-crafted,
soft, inviting — NOT hyper-detailed, not noisy, not high-contrast. Everything must read clearly at
small size against grass and dirt.

## Fixed technical specs (do not vary)
- **Perspective:** top-down **3/4** view (the standard Stardew/farming-sim angle) — characters and
  objects seen slightly from the front-above, not pure top-down, not side-on.
- **Base tile size:** **16×16 px**. Multi-tile objects are whole multiples (tree = 2×3 tiles, house = larger).
- **Character canvas:** farmer/NPCs on a **32×32** sprite (occupies ~1×2 tiles) with a 4-direction
  layout: **down, up, left, right**. Left/right may be mirrored. Walk cycle = 4 frames per direction
  minimum; idle = 1–2 frames.
- **Outlines:** subtle dark outline on characters and foreground objects for readability; terrain
  tiles are outline-light so they tile seamlessly.
- **Shading:** simple 2–3 step shading, single soft light source from the **top-left**. Keep shadow
  contact grounded — objects sit ON the ground (avoid the "floating" look; a small contact shadow
  ellipse at the base is preferred over a big offset drop shadow).
- **Tiling:** terrain tilesets must be **seamless** and support transitions (grass↔dirt↔tilled↔water
  edges). Use PixelLab's top-down/Wang tileset tool for these.

## Palette
Use a limited, warm, cohesive palette. Seed colors (adjust to taste, then LOCK):
- Grass: `#6ab04c` / shadow `#4a8035` / highlight `#8fd66a`
- Dirt / soil (untilled): `#a9744f` / tilled `#7a4f34` / watered `#5a3a26`
- Water: `#4aa3c7` / deep `#2f799b`
- Wood / trunks: `#8a5a3b`; tree leaves: `#3f8f4f`
- Stone / rock: `#8b8b8b` / shadow `#5f5f5f`
- Skin (default farmer): `#e8b48f`; hair (default): `#5b3a29`; shirt: `#c0392b`; pants: `#2c3e50`
- UI parchment/panel: `#e8d8b0` with border `#7a5a3a`
Keep total colors modest per asset (roughly ≤ 16) so the set feels unified.

## Canonical style prompt (reuse this stem for EVERY PixelLab call)
Prepend this to every generation prompt so the whole set matches. Fill in only the subject:

> "16-bit top-down 3/4 farming-sim pixel art, cozy warm palette, subtle dark outline, soft
> shading with top-left light, grounded (not floating), clean and readable at small size,
> Stardew-Valley-inspired. Subject: **<the thing>**."

Examples:
- Farmer: `...Subject: a friendly farmer character, 4-directional, brown hair, red shirt, for a walk cycle.`
- Grass tileset: `...Subject: seamless grass terrain tileset with dirt-path transitions, top-down.`
- Tree: `...Subject: a leafy deciduous tree, 2x3 tiles, with a grounded base shadow.`
- Rock: `...Subject: a breakable grey boulder, 1x1 tile, with a small contact shadow.`
- Crop (parsnip): `...Subject: a parsnip crop shown in 4 growth stages, top-down, on tilled soil.`

## Style-test set (generate THESE FIRST, then stop and review)
Before batch-generating anything, produce only:
1. Farmer (4-direction, walk).
2. Grass tileset with dirt + tilled-soil transitions.
3. One tree.
4. One rock.
Drop them into `public/assets/manifest.json`, run the game, and look at them together in-scene.
Confirm: farmer reads clearly on grass; tiles are seamless; shadows are grounded; palette is
consistent. **Only after the style is approved** do you batch-generate the full V1 set below.

## V1 asset list (batch AFTER style lock)
- **Characters:** farmer (walk 4-dir + idle). (NPCs come in Prompt 2.)
- **Terrain tilesets:** grass, dirt/path, tilled soil, watered soil, water edges, house-floor
  (interior), town ground.
- **Objects:** tree (choppable), rock (breakable), weed (clearable), chest (closed/open), bed,
  the player's house exterior, door.
- **Crops:** at least one crop (e.g. parsnip) in 4 growth stages + harvested-item icon.
- **UI:** hotbar frame, stamina bar, tool icons (hoe, axe, pickaxe, scythe, watering can, seeds),
  clock face, inventory panel, day/night indicator.

## Tile-format rules (think in the top-down grid BEFORE generating — from the designer's art direction)
Every asset lives on a 16px top-down tile grid. Generate accordingly:
- **Ground/terrain = tilesets, never objects.** They repeat hundreds of times, so they must be
  SUBTLE: low contrast, small even texture, no big pebbles/chunks that read as obstacles. Detail
  belongs in objects, not floors. (The first dirt tileset failed this — pebble-heavy full-dirt
  tiles made paths/plazas read as rock walls.)
- **Chain tilesets** to the shared grass base tile id so every terrain family matches.
- **Objects** (trees/rocks/furniture): transparent PNG, base sized to a whole tile multiple,
  bottom-anchored with a small contact shadow; collision is ONE tile at the base regardless of
  art height.
- **Buildings**: straight-on facades (view "side" + "flat horizontal ground line, NO isometric
  angle"), width = footprint tiles × 16 exactly, flat baseline so they sit on a tile row.
- **Icons**: straight-on ("side"), centered, readable silhouette at 28px.

## Consistency rules (enforce during the art pass)
- Same perspective, same light direction, same outline weight on everything.
- Objects sit grounded; use small contact shadows, not floating drop shadows.
- Match tile edges so terrain transitions are seamless (regenerate a tile rather than shipping a seam).
- After placing assets, use Playwright screenshots to catch overlap/z-order/scale problems and fix
  sizing in `manifest.json` / `GameConfig` (never let art dimensions drive collision — see `CLAUDE.md`).
