# Town layout workshop — approved September 13

Status: user approves the plan, four routes and two reserved sites. Independent reviewer ACKs all six criteria before code.

## Required context

Jeff requests a Pelican Town-inspired town layout, no generated buildings, and editable building clearings with JSON export like the farm. Reference: https://stardewvalleywiki.com/Pelican_Town (read and visually inspected in browser). The wiki lists four ordinary outdoor links: northwest Bus Stop/Farm, southwest Forest, north Mountain, south Beach. Sewer access and a minecart station are separate travel connections, not additional edge paths.

Current source: `buildTown` in `src/world/MapDef.ts` produces an 80×60 grass/plaza map with Farm, Mountain and Beach links, no river or buildings. Forest currently only connects to Farm. The farm editor requires a farm-specific draft, a shop anchor, fixed authored objects, grass/dirt edits and fixed water/cliffs/exits. Normal map resolution never reads editor storage; preview save guards already exist.

## Proposed first pass

Use a larger town canvas with Pelican Town's broad arrangement: western center/plaza, upper park and raised northern green space, a river along the east curving across the south, bridges, southern residential clearings and eastern workshop clearings. Use current terrain and object art, not downloaded Stardew art or newly generated buildings. Keep building types unassigned until Jeff chooses them.

Four main route mouths follow the reference. Reserve optional sewer/transit sites without creating those destinations. The existing Farm/Mountain/Beach connections remain named; a Forest connection needs its explicit matching return route. Do not invent a fifth or sixth road destination. Confirm this interpretation before implementation.

Add a Town choice to the development workshop. Represent future buildings as movable, grid-snapped plots with editor-only outlines and short plot IDs. Ordinary walk preview shows clearings without large floating labels. Support moving greenery, painting paths, undo/redo, import/export and isolated walk preview. Export a town-specific JSON file. Keep farm drafts, approved farm layout and all interiors unchanged. Start town authoring in the isolated workshop; adopt Jeff's exported design into ordinary saves as a separate agreed step.

## Reuse and scope

Choose L2_abstraction: shared editor gestures/panel with explicit map-specific data validation, storage and preview targets. L1 merely replacing town terrain cannot provide the requested export workflow. L3 a generic world/quest/building editor is unnecessary. Reuse MapData, TerrainRenderer, SceneTransitionSystem, draft validation, sandbox guards and existing editor controls. No new backend, dependencies, buildings or NPC systems.

Bounded implementation: map/model, editor controls and runtime/storage have separate file owners; they share explicit typed contracts and converge before browser tests. Independent review follows. Expected 14–20 source/test/doc files, roughly 1,400–2,200 lines excluding authored terrain. This exceeds the simple-change budget because isolated town drafts, plot geometry, scene selection and travel tests are required. Reassess after exact editor contracts are selected; do not build a broad editor framework.

## Required constraints

Readers return detached draft/map data and never rewrite adventure slots. Mutators validate an entire gesture/import before commit. Town and farm storage keys remain separate. Invalid map selectors, unsupported exports, blocked routes and corrupt drafts report clear errors and retain existing bytes. Frozen surfaces: approved farm, existing save slots, interiors, hospitality, original art and user server5273. Plot outlines are editor information, not collision pretending to be a finished building. Preview maps cannot escape into real save access.

## Verification and done when

1. The town contains the agreed roads, river crossings, clearings and exactly the approved external route list; every plot and route is reachable from the town spawn.
2. No generated building or copied Stardew asset enters the manifest; building designs remain unassigned.
3. Native mouse input moves a plot/tree and paints paths; undo/redo restores the exact draft; JSON export/import round-trips.
4. Farm drafts and ordinary adventure slot bytes remain identical throughout town editing and preview. Preview uses a frozen opening snapshot.
5. All connected routes and returns work through named spawns; future connections never transition to missing scenes.
6. Typecheck, build and full isolated Playwright suite pass. Inspect whole-town and player-scale screenshots plus desktop/narrow workshop controls.

Tests use `playwright.personality.config.ts` on isolated5276, never restart5273. Save direct command logs and native-input screenshot evidence under `planning_artifacts/town-layout-workshop/`. Send the final agreed criteria to an independent reviewer for ACK before code. Perform self-audit and expert review before handoff.

## Rollback and open decisions

Closing the town workshop/preview leaves ordinary play unchanged. Imports and reset require validation/confirmation and support undo. Adoption into real saves is not hidden inside editor work.

Jeff approves four main routes plus two reserved future connection sites. Implementation and review evidence
are recorded in `NOTES-town-layout-workshop.md`. Memory tools remain unavailable; explicit user/project context
is applied under feature-contract.v1 without claiming memory retrieval. Formal planning-gate records remain
incomplete and do not establish governed release approval.
