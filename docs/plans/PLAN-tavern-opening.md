# Tavern opening — first playable chapter

Confirmed by Jeff on 2026-09-10: restoring and running the inherited tavern is the heart of
Shopkeeper's Legacy. The mines and dungeon are separate experiences. The mines follow
Stardew's mining progression; the dungeon follows Moonlighter's room combat and risky loot runs.
This chapter establishes a working tavern before expanding either exploration mode.

## Acceptance contract

1. The farm door enters a distinct furnished TavernScene using named spawns. Exit and bed work.
2. A ledger explains the inheritance and the next objective. Repair consumes 20 wood and 10 stone
   exactly once, or changes nothing when the player lacks supplies.
3. Rosa's welcome delivery gives four portions once. One parsnip cooks four more; one eligible
   fish cooks five. Cooking uses the existing atomic inventory transaction.
4. The bell opens one service per day. Three named customers walk to the counter in sequence.
   Serving within reach consumes one portion and pays 12 gold once. Leaving and loading preserve
   the current service. Closing ends that day's service. Sleep resets it before autosaving.
5. After three total customers, 60 gold and 10 wood buy the first upgrade. It admits five customers
   on the next service; upgrading never changes an already-open day's quota.
6. Save envelope v2 validates tavern state. Explicit v1 migration preserves existing slot keys,
   inventory and world progress. Missing tavern data in v2 is corruption, not a new-game default.
7. Real keyboard and mouse actions work. Menus stop movement, tools and accidental sales. Prompts
   identify the next action, required materials, stock, current order and service progress.
8. Focused gameplay tests, the full suite, type checking, build, and visual playtest provide evidence.

## Implementation boundary

Use one TavernSystem and GameState record, existing inventory transactions, the scene transition
system, the shared UI scene and the current pixel-art assets. No general business framework or
new persistence layer. The new room is authored as data and consumed by the existing map pipeline.
The previous player pass remains intact. This is a playtest milestone, not a claim that the full
game, relationships, mines or dungeon are finished.

The solution is a small reusable gameplay system (L2): UI-only edits cannot preserve transactions
and service across saves; a generic shop framework would exceed this first loop. Estimated scope:
22 files / 2,500 lines including map data, tests, comments, and UI. The larger-than-small-fix scope
is necessary because a walkable room, persistent economy, input, save migration and tests must agree.

## Evidence and recovery

Reviewer `tavern_reviewer` acknowledges the contract before code changes. Tests include failed
transactions, repeated serve input, leaving/reentering, mid-service saves, upgrading during service,
corrupt saves, and sleep. Screenshots and playtest notes assess readability and flow independently.
Before edits, `planning_artifacts/tavern-opening-2026-09-10/baseline/source-before.tar.gz` records
the current source, tests, docs and manifest, including the uncommitted player pass. Restoration
must target only files changed by this chapter; it must never discard the previous player work.
