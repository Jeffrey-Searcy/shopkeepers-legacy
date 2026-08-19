# PLAN 01 — Art perspective + scale pipeline fix (Fable 5)

> Drafted by Opus for Fable-5 execution. **Read `.claude/skills/game-art` + `docs/ART_BIBLE.md`
> first.** Baseline: 61/61 specs green, typecheck clean.
> Standing rules (the designer): API/MCP-first, modular, doc-comment every class/fn/method, no silent
> fallbacks, read-before-change, verify-before-done. Look at every asset you generate (screenshot).

## Why this is Plan 01
The designer: *"I do not know why you keep making angled images — the table and sell box are angled. Also
they're very small."* This is the ROOT of a recurring problem, and every later plan generates art.
Lock the rule and the render-scale here so buildings/interiors/maps/enemies inherit it for free.

## Root cause (confirmed from the shipped PNGs + audit)
1. **Perspective clash.** `furniture-table.png` and `shipping-bin.png` were generated in **3/4
   perspective** — you see the top surface AND the receding front/legs. The world + the approved
   `house-large.png` read **flat/straight-on**. So those objects look "angled" and wrong. The
   `game-art` skill and `ART_BIBLE.md:83-85` already SAY furniture/buildings must be straight-on
   flat facades — the rule exists but wasn't followed for these objects.
2. **Undersized rendering.** TILE=16px. Objects are rendered at hardcoded sizes in
   `BaseWorldScene.spawnObjects` that are barely bigger than one tile:
   - table `TILE+6 × TILE+8` = **22×24** (`BaseWorldScene.ts:452`)
   - chair `TILE × TILE+6` = **16×22** (`:454`)
   - bin `TILE+8 × TILE+8` = **24×24** (`:443`)
   - shelf `TILE+4 × TILE+12` = 20×28 (`:456`), tv `TILE+6 × TILE+10` (`:448`),
     kitchen-counter `TILE*3 × TILE+10` = 48×26 (`:460`)
   The source PNGs are 32×32 but get squashed into these boxes → everything looks tiny/cramped.
   (Collision stays 1 tile at the base via `Prop.ts` regardless — do NOT change collision.)

## TASK A — Codify the art contract (docs + skill), so this never recurs
Edit `docs/ART_BIBLE.md` and `.claude/skills/game-art/SKILL.md` to make the straight-on rule
**unmissable and copy-pasteable**:
- Add a **"Furniture & objects: STRAIGHT-ON, never 3/4"** section with the exact PixelLab phrasing
  that has worked: *"flat 2D pixel art sprite of a <object>, front-facing, straight-on view like a
  paper cutout, flat horizontal ground line, NO isometric angle, NO perspective, NO visible
  tabletop or receding sides, transparent background, cozy 16-bit farming-sim palette, subtle dark
  outline."* Explicitly list the failure to avoid: *"do not show the top surface of tables/counters
  — show only the front face, like Stardew furniture."*
- Reference the two approved anchors: `house-large.png` (buildings) and the farmer character
  (characters). New art must match their light direction (top-left), outline weight, palette.
- Add a **size table** mapping each object kind → its intended tile footprint and its render px, so
  future art is generated at the right native resolution (native px = footprint tiles × 16 × 2 for
  crispness, then rendered at footprint × 16).

## TASK B — Regenerate the angled/undersized art STRAIGHT-ON (art-director agent)
Delegate to the **art-director** agent (it owns PixelLab + verification). Regenerate, straight-on,
matching the approved anchors, at these native sizes (generate at 2× the render box for crispness):
- `furniture-table` — front face of a wooden table, 2 tiles wide → native 64×48, render ~40×36.
- `furniture-chair` — small wooden chair front-on → native 32×48, render ~20×28.
- `shipping-bin` — the "sell box." The designer: *"the sell box is just a brown square lol?"* Make it a
  clearly-readable wooden shipping bin with a hinged lid, front-on (reference Stardew's shipping
  bin) → native 64×48, render ~40×34.
- `store-shelf`, `kitchen-counter` — verify these read straight-on too; regenerate if 3/4.
- Keep the SAME manifest keys (`furniture-table` etc.) — a straight PNG swap, per Hard Rule 4.
  Surgical python manifest patch only if dimensions change; the key/type stay `image`.

## TASK C — Fix render sizes so objects read at a believable scale
In `BaseWorldScene.spawnObjects` (`BaseWorldScene.ts:442-462`), bump the render sizes to match the
new art's footprint. **Do NOT change the collision body** (Prop keeps its 1-tile base). Proposed:
- table → `TILE*2.5 × TILE*2.25` (40×36), bin → `TILE*2.5 × TILE*2.1` (40×34),
  chair → `TILE*1.25 × TILE*1.75` (20×28), shelf/counter → proportional to new art.
- **Extract the magic numbers** into a small `OBJECT_RENDER` table in `GameConfig.ts` (kind → {w,h})
  so sizes are data, not scattered literals — modular + self-documenting. `spawnObjects` reads the
  table. Doc-comment the table's shape.

## TASK D — Close the raw-string texture-key gap (modularity)
Audit found ~3/4 of texture keys are raw string literals (`'furniture-table'`, `'shipping-bin'`,
`'building-store'`, all icons/fish/enemies) despite Hard Rule 4. Extend the `TextureKey` enum in
`AssetKeys.ts` to cover ALL manifest keys and replace the literals in code with the constants.
Purely mechanical + safe (typecheck proves completeness). Doc-comment the enum groups.

## Ownership / guardrails
- YOU OWN: `docs/ART_BIBLE.md`, `.claude/skills/game-art/SKILL.md`, the regenerated PNGs, the
  `OBJECT_RENDER` table in `GameConfig.ts`, `AssetKeys.ts`, and the render-size lines in
  `BaseWorldScene.spawnObjects`.
- SHARED — re-read before editing, keep additive: `manifest.json` (surgical python patches ONLY),
  any file where you swap a string literal for a `TextureKey` const.
- FORBIDDEN: gameplay logic changes, collision body sizes, the transition/camera/placement code.

## SPECS (add `tests/m21-art-scale.spec.ts`)
The art LOOK can't be asserted in Playwright, but the render-size regression CAN:
1. Boot Home interior; assert the table/bin/chair render sizes match the `OBJECT_RENDER` table
   (read the sprite displayWidth/Height via a small seam addition or by reading the config in the
   test). Guards against silent size drift.
2. Keep all 61 existing specs green (this plan changes art + sizes, not logic).
Then the REAL gate: **screenshot Home + Town + the shipping bin on the farm and LOOK** — table/bin
must be straight-on and believably sized. Fix and re-shoot until they read right.

## Final verification
1. `npm run typecheck` → 0 errors (Task D makes this meaningful — proves all keys resolved).
2. `pkill -f vite; npx playwright test` → 61 existing + m21 green.
3. Screenshots (port 5273) of Home, Town, farm shipping bin — attach to the report, confirm
   straight-on + sized right. 4. Report: what was angled, new art ids/generations, the size table,
   the key-const refactor count, screenshots.
