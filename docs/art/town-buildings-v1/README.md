# Town buildings — first style test

September 13, 2026. Jeff asks to start the next work while he playtests the adopted town.
This packet prepares three offline concepts. It does not install buildings or reload the game.

## Plan and boundaries

Use the approved proposal's first three contrasting buildings: Tessa's market (a02), Rhea's
forge (a03), and Elowen's museum/library (a05). These names and assignments remain provisional.
Use the existing shop only for palette, pixel scale, front-facing perspective and entry depth.
Each new building needs its own silhouette and proportions, not the shop's fixed160px frame.

Solution: L1 asset-only preparation. Existing primitives considered: ShopFront layered drawing,
SHOP_FRONT geometry, the cosmetic facade packer, TownPlot clearings and the provisional cast plan.
Do not use the cosmetic packer: it forces every source into the old facade bounds. No new
renderer, persistence, editor, runtime surface, dependency or general building framework.
Initial estimate: three PNGs and two documentation files, under250 handwritten lines.
One targeted revision per concept adds three PNGs; eight files total. No implementation code.

Read contract: inspect repository assets/configuration only. Write contract: new files in this
directory only. Freeze src, public, manifest, saves, settings, servers, current map and interiors.
No browser automation against Jeff's playtest and no test server is required for offline images.
Recovery: nothing is installed; these additive concept files can be ignored without gameplay impact.

## Acceptance criteria

1. Three separately generated original concepts: market, forge, museum/library, distinct silhouettes.
2. Flat horizontal baseline, front-facing pixel art, top-left light, visible entry depth and clear central doorway.
3. Preserve generated PNGs and exact prompts here; do not alter game-consumed assets.
4. Preserve the running server and game files. Label images concepts, not playable buildings.
5. Keep the three proposed owner ties provisional; do not assign any permanent resident in code.
6. Main agent inspects all images; independent art reviewer checks scale and entry risks before handoff.

The independent art reviewer ACKs these six criteria before image generation.
The game-art skill constrains perspective and scale. The imagegen skill selects the built-in
image tool. This is a three-building style test, not approval to generate the full town batch.

## Integration facts

Current shop:160×160 native canvas,22×41px door,128×16px walkable deck,32px central steps.
ShopFront splits the wall, front lintel, door and posts into independently sorted layers.
New concepts must later get their own measured door/deck and collision data. Scaling a single
opaque building image into the map cannot reproduce that depth. In-scene scale, animated doors,
collision and all round-trip travel remain unverified until a separate integration pass.

## Concept files and owner direction

- [Market v1](market-concept-v1.png): Tessa's practical market, asymmetrical attached home,
  striped awning and produce windows. Seeds, saplings and daily supplies remain the proposed role.
- [Forge v1](forge-concept-v1.png): Rhea's low slate workshop, tall chimney and open work bay.
  Her exacting craft explains tidy tools, not hostile decoration or a villain's lair.
- [Museum/library v1](museum-concept-v1.png): Elowen's broad stone front, book emblem and tall
  windows. Quiet public learning space; not a church or grand castle.
- [Exact prompts](PROMPTS.md): all three original calls and all three edit calls, built-in image_gen.

V1 is selected for architectural discussion only. The independent reviewer supports these three
directions, not finished sprites. Nothing is imported into the game. V2 files remain as rejected
cutouts/proportion studies, not replacements for V1.

## Verification and limitations

Main and independent art reviewer visually inspect all six images. PNG decoding succeeds:

| File | Dimensions | Fully transparent pixels | Use |
| --- | --- | --- | --- |
| market-concept-v1.png |1536×1024|636242|Concept direction only|
| forge-concept-v1.png |1536×1024|732110|Concept direction only|
| museum-concept-v1.png |1536×1024|603603|Concept direction only|
| market-concept-v2.png |1568×1003|0|Rejected cutout; proportion study|
| forge-concept-v2.png |1568×1003|0|Rejected cutout; proportion study|
| museum-concept-v2.png |1536×1024|0|Rejected cutout; proportion study|

V1 has genuine alpha, but most artwork pixels have alpha253 and soft surrounding edges.
The first visual impression of a painted background was corrected by inspecting the PNG data.
V2 improves some door proportions and simplifies detail but paints an opaque checkerboard into
every image. Do not attempt to use it as transparency or install it as a game asset.

No game tests are claimed for this asset-only pass. User server PID19125 remains running;
this packet does not access browser storage or edit any game-consumed file.
Memory retrieval tools remain unavailable; explicit conversation and project
preferences supply context, not a fabricated successful memory search. No formal planning-gate
approval is claimed without its required tools and execution records.

## Self-Audit

Whole-image reduction would make the original market door about12×22px, forge16×28px and
museum19×33px at the proposed160/160/192px facade widths. These are visual estimates, not
collision measurements. The accepted shop has a22×41px door. V2 brings the museum nearer24×41px,
but market/forge remain undersized. Stairs look dimensional; the landing itself is still shallow.
The generated ratios do not satisfy the intended native geometry despite the exact prompts.

## Expert Review and next pass

Independent reviewer `town_building_art_review` ACKs all six criteria and inspects both versions.
Verdict: distinct silhouettes and service cues pass as concepts. Native-scale readiness fails.
Keep V1 for style selection. Do not produce the full town batch or claim playable doors.

After the style check, redraw native proportions: roughly24×40px clear doors, at least16px of
actual landing before the first step, and an unobstructed32px stair approach. Keep the three
different silhouettes. Produce clean pixel edges and real alpha, then split floor/wall/door/
foreground layers. In-scene inspection must prove the player can stand on the landing and pass
behind supports. Only then define geometry and run native entrance/return tests in isolation.
Do not reuse the player's fixed facade crop constants or silently enlarge map clearings.

The game-art skill's style-test rule pauses the remaining town batch here. Character roles,
plot choices and all twelve permanent resident assignments remain proposals.
