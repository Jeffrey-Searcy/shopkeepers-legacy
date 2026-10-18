# Player-built shop and reference-led interior — 2026-09-12

Jeff approves the six-part proposal with “Just do it I believe in you!” Functional crafted
stations are included. His latest screenshot and feedback override the previous internal art
score: distant mouse placement, empty starting room, meaningful furniture scale, no world
placards, crisp text, a cozy crafting menu and a simpler centered title.

## Context and constraints

Read actual placement, crafting, UI camera/text, TavernSystem/TavernScene, saves and authored
maps. Existing station actions and guest travel use fixed coordinates. The prior room includes
invisible station solids and reserved routes. Fonts are canvas Text at resolution1 enlarged by
the UI/world camera. At1440x900/DPR2 the game canvas is1440x900 and UI zoom1.5.
Reuse GameState, atomic inventory transactions, Furniture views/cells, Phaser scene transitions,
existing cozy menu primitives and current one-customer counter service. No new engine/backend.
The memory connector is unavailable; explicit conversation/project preferences are the source.
Use feature-contract.v1 plus frontend-contract.v1. Formal unavailable runtime records cannot be
invented; actual command captures and independent review remain required.

## Acceptance contract (reviewer ACK required)

1. Furniture preview follows the mouse across visible legal world floor, never snaps back beside
   the player. R updates preview and footprint; click commits that same tile. Invalid full
   footprints, player overlap, door/spawn access and modal/HUD clicks cannot consume inventory.
   Tool reach outside placement remains unchanged. Existing keyboard placement remains usable.
2. A new shop contains architecture only: no fixed stations, station action tiles, their solids,
   or persistent floor/door/stair labels. New stairs sit at the room edge with a deep rear doorway.
   The bedroom remains reachable and sleep/save works; the player cannot use guest stairs.
3. Bag-craft a workbench, place it, then craft/place a register, bar and stove. Register owns
   repair/upgrade and open/close; stove cooks; a reachable bar serves and collects current meals.
   Guest and keeper approach positions derive from the chosen bar orientation. Opening rejects
   missing/unreachable setup with a clear reason. Active service locks furniture layout.
4. Saved v5 rotations/furniture/inventory/progress survive migration. Table/rug recovery remains
   limited to versions1–4. Workbenches expand to2x1 and get separate versions1–5 recovery into
   the bag or persistent ground drops, preserving exactly one item. Other v5 furnishings retain
   their positions and rotations. A legacy active service without new stations closes explicitly
   without resetting quotas, portions, money or served counts. Current active orders reload
   without teleporting through furniture or paying twice. No personal save bytes are touched.
5. Workbench art has a substantial whole-tile footprint and compatible old-item recovery if it
   expands. Crafting uses cozy recipe pockets, a selected-item preview, owned/needed ingredient
   counts, keyboard/pointer controls and a full modal input shield. Missing resources and full
   inventory get distinct feedback; crafting stays atomic and single-press.
6. Shared text rendering responds to camera scale and device resolution without blurring world
   pixel textures. HUD, bag, crafting, title and dynamic labels are checked at800x500,1440x900,
   1920x1080 and DPR1/2. Title uses centered conventional controls over a coherent scene;
   Continue/New/Load/Settings, save protection and reduced-motion behavior remain functional.
7. Original native interior materials and architectural art closely follow the supplied reference's
   warm broad boards, stone/wood depth and substantial stairs. No screenshot/logo pixels copied.
   Root and independent reviewer inspect real WebGL screenshots with the keeper and placed items.
   User visual acceptance remains open; passing tests/scores do not override Jeff's feedback.
8. Focused real-input tests, full isolated four-worker suite, typecheck, build, diff, Self-Audit
   and independent Expert Review provide captured proof. Freeze source during browser runs.

## Solution and bounded packets

Choose L2: one derived station-layout resolver extends existing furniture/state. L1 art-only
changes leave ghost stations and broken service. L3 general simulation, table seating, employees,
ale/product systems and lodging exceed the request. A deterministic walkable tile route supports
the current single guest; no new general pathfinding service or persisted duplicate station list.

P1 root plan/baseline and reviewer ACK. P2 art specialist supplies original native architecture,
stove/workbench assets after small style tests. P3 UI specialist owns shared text policy, crafting
panel and centered title. P4 gameplay specialist owns placed station roles, service routing,
saves and corresponding tests. P5 root owns mouse placement, world scene/map/art integration.
P6 reviewer checks integrated real-input behavior, assets and regressions. Bounded parallel work
is justified by distinct art, UI and gameplay files; shared scene/config edits use explicit owners.

Estimated35–45 source/test files and3500–6000 changed lines plus assets/evidence. More than3files/
500lines is justified by persisted functional stations, collision/guest routes, shared text and
two UI surfaces. Reassess before45files/6000lines. Art budget initially40 subscription generations,
no paid credit fallback; evaluate small native samples before expanding generation.

## State and safety contracts

GameState owns durable data. Layout readers do not mutate inventory or service. Place/craft/pickup
commit atomically. Station selection is deterministic from existing placedItems; active service
prevents relocation. Missing routes/assets reject explicitly. Migration conditions are versioned,
not tied loosely to the newest SAVE_VERSION. Preserve all economic counters and old saves.
Keep prices/quotas/player shape/mines/dungeons/outdoor topology frozen. No seating simulation,
playable upstairs, shop selection or new progression chain. No commits, pushes or service stops.
Work on dirty codex/shop-home without reverting prior changes. Preserve a source archive before
edits; validate in an isolated directory only, never restore over live files.

Tests use5274 with isolated browser storage; Jeff's5273 server remains. Verification captures
live under planning_artifacts/player-built-shop-2026-09-12. Title/crafting visual records remain
separate from user approval. Unexpected migration/asset incompatibility pauses that packet.

Reviewer shop_home_review ACKs all eight criteria after the item-specific workbench migration
clarification above. This ACK authorizes evaluation against the contract, not formal release
or user visual approval.

## Integration adjustments

The mouse-placement contract requires old tests to aim explicitly. Rear-door fixtures also need
the new authored entrance. Extend the source/test budget to50 files, keeping6000lines and the
same gameplay scope. These are regression fixtures, not added product features.
Jeff rejects the first sideways table and workbench. Extend the native-art cap from40 to55
subscription generations for lower, wider furniture and its matching rotation. No paid credits.
The timed-out suite leaves its test-only5274 server running. Preserve that process and Jeff's5273
server; use an explicit fresh5275 verification configuration for the next suite.
