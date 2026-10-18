# Interior foundation and clear game menus — 2026-09-12

Jeff approves the preceding four-part direction with “just go ahead”. His latest clarification
is authoritative: the room may be mostly empty; architecture, furniture scale and grid consistency
matter. The player builds and furnishes the shop. Travellers Rest supplies interior direction;
Necesse supplies conventional title navigation. Existing140 passing tests are functional evidence,
not user approval of the prior artwork. Independent interior_review ACKs the eight criteria below.

## Required context and scope

Read actual ItemPlacementSystem, BaseWorldScene, GameState, SaveSystem, TavernScene/TavernSystem,
MainMenuScene, TavernUI, UILayout and project art/system/playtest skills before implementation.
Current furniture is hardcoded at inconsistent sizes; all placed items occupy one tile. Tavern
service has fixed station coordinates and a fixed guest route. Preserve a minimal service nook
at those coordinates in this pass, remove dining clutter and its collision, and leave open floor
for crafted furniture. New bar/register are explicitly furnishing, not movable service replacements.
Ale brewing, dynamic shop service layout, lodging, shop types and new progression remain deferred.

## Acceptance contract

1. Matching native pixel architecture and furniture, inspired by Travellers Rest, reads at the
   keeper's scale. Room floor stays quiet and mostly open. Bedroom doorway and guest stairs are
   distinct. Style-test one table/chair and architectural kit before batching remaining art.
2. One data definition owns each footprint, directional artwork, anchor and collision. Table2x1,
   chair1x1, bar2x1, register1x1 and rug2x2 occupy whole16px tiles. Rotation changes footprint and
   selects a cardinal view; never spin a vertical chair sprite flat.
3. Existing crafting/bag placement gains R rotation and whole-footprint preview/validation.
   Every occupied tile participates in collision and pickup. Pickup/reposition preserves items.
   Save/load preserves rotation. Old expanded table/rug placements are explicitly recovered into
   the backpack or persistent ground drops if space is unavailable, never discarded or overlapped.
4. Existing food/payment/repair/upgrade and bedtime remain usable. Keep only necessary starter
   service fixtures; remove obsolete furniture solids. Protect fixed guest/door/station routes.
   Label new bar/register as furnishing until service placement is implemented.
5. Objective information becomes compact edge UI, expanded on demand. No persistent central
   banner obscures play. Player and doors remain readable at800x500 and1920x1080 with real HUD.
6. Door visible response begins within80ms of entry trigger; full input lock is at most450ms
   under normal frame timing. Real walk-in withoutE, repeated trips and modal/input safety remain.
7. Conventional title: Continue, New Game, Load Game, Settings. Save cards live under Load.
   Settings control actual sound level and display/UI behavior; no dead options. Keyboard and
   pointer navigation preserve delete/overwrite guards and existing saves.
8. Focused and full four-worker Playwright, typecheck/build/diff, real WebGL screenshots,
   Self-Audit and independent Expert Review provide evidence. User visual acceptance stays open
   until Jeff approves; a passing test or internal score cannot substitute for that approval.

## Architecture and execution

Chosen L2 shared furniture definition extends existing placement, rendering, crafting and save
systems. L1 scaling pictures alone cannot fix footprints or rotation. L3 building editors, a new
inventory backend or dynamic NPC shop simulation exceeds this pass. Reuse Phaser physics, cameras,
input and scene transitions; reuse SaveSystem and atomic inventory transactions.
Bounded parallel packets: P1 contract/baseline; P2 native art; P3 title/settings; P4 furniture model
and migration; P5 root room/HUD/door and shared scene integration; P6 verifier/tests/visual review.
Art and title have independent files. Shared scene integration waits for accepted furniture API.
Estimated35–45 source/test/config files and2500–5000 changed lines plus assets/evidence. This exceeds
the generic3-file500-line budget because persisted multi-tile placement, game UI and architectural
art have distinct cross-scene consumers. Reassess before exceeding45files or5000lines.

## Contracts and guardrails

GameState remains the sole gameplay writer. Placement commits consume exactly one item after
full validation; rejection changes no inventory or placed records. Pickup resolves the anchor
from any footprint tile before removing entity/physics. Definition/read helpers are pure.
Settings use one explicitly validated browser-local preference record separate from game saves.
Versioned rotation migration is explicit; malformed current saves reject before live mutation.
Freeze player shape, world topology outside interiors, mines/dungeons, prices and service quotas.
No silent missing-asset fallbacks; files must exist before manifest references/checks land.
No new backend, runtime service, package, broad abstraction or decorative fake service mechanics.

## Evidence and safety

Baseline archive: planning_artifacts/interior-foundation-2026-09-12/baseline/source-before.tar.gz.
Preserve prior dirty work on codex/shop-home. No commits/pushes/deploys or stops of existing5273.
Tests use isolated5274 and browser storage. Source freezes during browser suites to avoid HMR.
Use frontend-design-harness for title screenshot iterations and project game-art/playtest for
native world art. Memory tools remain unavailable; conversation preferences are explicit context.
Planning-gate records actual proof, not fabricated runtime approvals. Current reference contracts
are available through cw_reference; formal runtime evidence remains separate from local tests.
