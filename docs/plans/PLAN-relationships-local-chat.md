# Relationships and guarded local chat — current implementation plan

## Objective

Give all twelve permanent adult residents persistent friendship and romance routes. Add authored
daily talk and gift play, a readable relationship journal, gradual resident-to-resident bonds,
and optional local-model conversations that cannot change gameplay state.

## Scope

In scope: resident biographies and traits, hidden item tastes, heart-tier dialogue, once-daily
talking, once-daily/twice-weekly gifts, save migration, romance intent stages, non-blocking resident
pair bonds, a pause-menu journal, a disabled-by-default local chat control, and a local Ollama bridge.

Out of scope: dates, marriage, children, breakup cutscenes, jealousy/scandal events, outdoor daily
schedules, hosted AI, voice, model-driven actions, and procedural affection changes.

## Solution ladder

- L1 patch: add a points counter to the existing three-line resident interaction.
- L2 abstraction, chosen: add one validated relationship state owner, a journal, and a guarded
  speech-only local bridge while reusing residents, inventory, sleep, settings, and save systems.
- L3 operating surface: autonomous agent residents with long-term memory and model tool access.

L1 cannot support gifts, romance routes, resident bonds, or safe local chat. L3 would give a model
too much authority and add services before the game rules are settled.

## Acceptance contract

1. All twelve residents are explicit adults, romanceable, uniquely described, and have validated
   hidden tastes plus heart-tier dialogue.
2. The first talk each day adds points once. Later talks remain available without adding points.
3. A selected gift is consumed only after a valid gift action. Taste changes points, daily and
   weekly limits hold, and invalid resident/item data fails clearly.
4. Hearts and romance stages persist. Every route stays available. An NPC partnership makes player
   courtship slower and raises its heart requirement, but never locks the route.
5. Sleeping resets daily availability and advances only the finite authored NPC bond pairs.
6. Pause opens a relationship journal that lists every resident, hearts, biography, romance state,
   and complications without revealing hidden tastes.
7. Local chat starts disabled. When enabled, it returns speech only through the local bridge.
   It cannot change hearts, gifts, inventory, dating state, schedules, or quests. Missing local
   service and rejected model output produce visible errors.
8. Version12 saves migrate to version13 without changing unrelated state. Focused tests, typecheck,
   build, save tests, resident tests, and UI smoke tests pass.

## Data and ownership

- `ResidentRelationships.ts` owns authored social profiles and pair compatibility.
- `RelationshipSystem.ts` alone mutates durable social progress.
- `GameState.relationships` is the durable source. The UI open flag and chat transcript are not saved.
- `TownResident` chooses talk versus the selected gift, then opens the existing dialogue surface.
- `RelationshipUI` reads progress and invokes explicit romance or chat actions.
- `LocalNpcChatSystem` sends only public persona and current relationship context.
- `npc-chat-server.mjs` validates requests, builds the supervisor prompt, calls local Ollama, and
  returns text only. The model receives no tools and no state mutation endpoint.

## Persisted-state guardrails

Version13 must contain exactly one validated record for each resident and each authored NPC bond.
Versions1–12 receive a deterministic empty relationship state during migration. Current-version
missing records are corruption. No local chat transcript, endpoint response, or model setting enters
adventure saves. Removing the feature requires restoring version12 code while retaining a raw
pre-relationship backup before any old slot is overwritten.

## Verification

Run focused pure and browser tests for points, limits, dialogue, gifts, romance difficulty, bond
growth, journal controls, local chat request boundaries, migration, and live resident interaction.
Then run typecheck, build, adjacent save/menu/resident tests, and `git diff --check`. Capture the
journal at 1280×720 and 800×720.

## Known limits

The local model is optional flavor text. Authored dialogue remains the normal game path. The first
slice tracks relationship complications but does not yet stage dates, confrontations, or scandals.
