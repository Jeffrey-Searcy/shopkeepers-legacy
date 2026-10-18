# Town adoption and proposed cast

Status: Jeff approved map implementation with “do it”; character/building assignments remain provisional.
Independent reviewer ACKed all six map acceptance criteria before runtime edits. September 13, 2026.

## Objective and agreed routes

Promote the approved 120×110 Town workshop layout into ordinary play. The upper west road leads to Farm; lower west to Forest; north to Mountain's outdoor mine entrance, then separately into Mines; south to Beach. Keep building clearings editable. Do not generate buildings or assign permanent residents yet.

The current workshop fingerprint is `town-v1-d98f917f`. Keep the raw underlay stable so existing workshop exports remain compatible. Normal Town currently uses the legacy 80×60 layout. Mountain already provides the requested outdoor mine entrance.

## Execution plan

Use a single implementation lane, followed by independent review. Before execution, obtain reviewer ACK for the acceptance criteria below.

1. Adopt the workshop geometry through a world-owned compositor shared with the editor. Normal play must not depend on editor storage or preview flags. Add the matching Forest return route without disturbing its other exits.
2. Add a versioned, one-time Town/Forest save migration. Validate old records against detached legacy maps. Preserve legal placements exactly; relocate only conflicts intact to deterministic reachable cells. Move a blocked Town player to a safe arrival. Do not apply the earlier Farm cleanup as the new Town migration. Keep old tree-removal records from clearing unrelated new trees.
3. Test normal travel, migration, editor compatibility and preservation. Keep the user's server on 5273 running; use isolated test configuration on 5276.
4. Discuss the proposed cast and buildings below. Building art, resident identities and appearance-setting changes require a later approved implementation packet.

## Reuse and bounds

Chosen layer: L2_abstraction, a shared Town compositor and focused migration. L1_patch cannot safely replace map geometry without handling persisted locations. L3_operating_surface, a general world migration/editor framework, is unnecessary.

Existing primitives considered: MapData, named spawns and warps, TownPlanning, TownLayoutDraft composition, SaveSystem validation/backups, prior Farm migration patterns and existing isolated browser tests. Reuse these contracts; do not introduce a second map representation.

Estimate: 10–15 source/test/doc files, 500–900 handwritten lines excluding existing map data. Reassess if a general migration framework or unrelated gameplay changes appear necessary.

Read contract: inspecting/listing/loading an old save must not rewrite storage. Mutator contract: validate a complete migrated candidate, back up exact original bytes, and only then persist the new version. A backup or validation failure must surface an error without overwriting the original. Freeze Farm, interiors, inventory, gold, hospitality, unrelated settings and existing server processes. Preserve Town/Forest items rather than deleting them. If relocation capacity is insufficient, stop with an explicit error.

## Acceptance criteria for map adoption

1. Ordinary Town is 120×110 without editor flags. Its four warps target Farm, Forest, Mountain and Beach at the agreed road mouths.
2. Native-input travel passes through all four exits and matching returns. North arrives outdoors, and entering the cave separately reaches Mines. All three bridges and every clearing remain reachable.
3. Version-10 fixtures cover safe and blocked player positions, furniture, rotations, crops/soil, drops, resource markers and placed buildings. Legal records remain unchanged; conflicting records relocate without loss or duplication. Version-11 round trips do not migrate again.
4. Migration preserves Farm and interior state, inventory, gold and hospitality. Invalid candidates and failed backups leave original storage bytes unchanged. Reads do not write.
5. Existing workshop exports import with the unchanged fingerprint. Editor and preview storage remain isolated from adventure saves.
6. Typecheck, production build and the complete isolated Playwright suite exit successfully. Record native travel screenshots, self-audit and independent expert review before delivery. Formal gate approval requires actual passing gate evidence, not historical test results.

## Proposed cast — not existing canon

Names and personalities below are new writing inspired by the supplied fictional designs. Catalog entries currently have no assigned names or roles. IDs follow each source image from left to right.

| Art ID / appearance | Proposed name and personality | Building and purpose |
| --- | --- | --- |
| a01 — dark hair, purple staff | Nyra: playful, curious, generous; guarded about her own past | Enchanter's cottage: an off-center turret, stone base and small porch; enchantments and magical supplies |
| a02 — brunette ponytail | Tessa: welcoming, practical and quietly ambitious | General market: wide awning, produce crates and attached home; seeds, saplings and everyday goods |
| a03 — black/red hair, horns | Rhea: blunt, meticulous and loyal; secretly makes tiny metal gifts | Blacksmith: low stone forge, tall chimney and open side workbay; tools, ore and repairs |
| a04 — green-haired woodland elf | Sylvie: patient, dry humor, firm about self-care | Clinic/herbalist: garden cottage with a deep entry; healing and herbs |
| a05 — lavender hair, glasses | Elowen: reserved until someone mentions history | Museum/library: broad stone front, arched windows and deep steps; donations, exhibits and town history |
| a06 — silver-haired knight | Seren: protective and dutiful; awkward at relaxing | Guild/watch lodge: stout timber and stone with a practice yard; equipment and adventure requests, potentially near the mines |
| b01 — green-haired elf | Rowan: warm animal keeper, forgetful about money | Ranch: barn, small home and paddock, potentially near the Forest; animals and supplies |
| b02 — black hair, black shirt | Julian: observant, dry wit; remembers everyone's order | Town bar: broad gable and side patio; local social hub, recipes and rotating meals |
| b03 — white-haired tusked man | Bram: patient, exacting and deadpan | Carpenter: open work shed, lumber racks and attached home; buildings, upgrades and furniture |
| b04 — orange-haired fox traveler | Kit: outgoing storyteller, reliable when it matters | Fishing shop: weathered dock cabin, potentially at the Beach; tackle, bait and fishing supplies |
| b05 — blue skin, blue robes | Cael: skeptical, precise and delighted by experiments | Alchemy lab: glass-roof annex and copper vents; crafted mixtures. Could share Sylvie's building |
| b06 — red-haired horned man | Dorian: expressive, craft-focused and hates waste | Tailor/dyer: narrow two-story shop, fabric window and awning; clothing, dyes and appearance options |

Twelve residents need not mean twelve Town businesses. Shared buildings and nearby-area workplaces leave room for homes, gardens, civic space and future shops. These locations remain proposals. The town bar serves local social life; do not introduce customer-poaching mechanics or change the player's business rules.

## Art and identity contracts for the later discussion

Use distinct roof shapes, footprints, materials, entrances and yards. Share the world palette, pixel scale, lighting and entrance technology—not one recolored shop silhouette. Doors need grounded thresholds, actual walkable porch/stoop depth, correct roof/post overlap and animated walk-in entry without E.

After approval, test three contrasting buildings at player scale first: market, forge and museum. Review them before producing the rest.

Each named resident needs a stable identity, schedule, dialogue and role independent of appearance. Use original pixel art, never a random customer selection. Customer art must never remove named residents or their services.

## Research references

Stardew services inform the town's useful roles, not copied building art or character writing:

- [Pelican Town](https://stardewvalleywiki.com/Pelican_Town)
- [General store](https://stardewvalleywiki.com/Pierre%27s_General_Store)
- [Carpenter](https://stardewvalleywiki.com/Carpenter%27s_Shop)
- [Blacksmith](https://stardewvalleywiki.com/Blacksmith)
- [Saloon](https://stardewvalleywiki.com/The_Stardrop_Saloon)
- [Museum and library](https://stardewvalleywiki.com/Museum)
- [Clinic](https://stardewvalleywiki.com/Harvey%27s_Clinic)
- [Fishing shop](https://stardewvalleywiki.com/Fish_Shop)
- [Adventurer's Guild](https://stardewvalleywiki.com/Adventurer%27s_Guild)
- [Ranch](https://stardewvalleywiki.com/Marnie%27s_Ranch)
- [Community Center](https://stardewvalleywiki.com/Community_Center)

## Planning self-audit and expert-review risks

Self-audit: the customer catalog supplies appearances, not named residents. Current Town save validation assumes the old map. Neither adopting geometry alone nor reusing customer appearance randomization is sufficient.

Expert-review checklist, not an approval: verify legacy-map isolation, complete migration candidate validation, backup ordering, resource identity mapping, deterministic relocation capacity, editor fingerprint stability and named return spawns. Require an independent ACK before code and a post-change review against the same criteria.
