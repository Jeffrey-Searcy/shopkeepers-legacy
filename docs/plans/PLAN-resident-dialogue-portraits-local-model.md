# Resident portraits and face-to-face local chat

## Goal

Replace the six named women with the finished video-animation characters, and move optional local-model chat into direct world interaction.

## Acceptance evidence

1. Nyra, Tessa, Rhea, Sylvie, Elowen, and Seren use `video01`, `video04`, `video02`, `video06`, `video03`, and `video05` respectively.
2. Each named woman has a reviewed, transparent HD portrait extracted from `Subject.png`.
3. The Bonds journal contains no chat text field.
4. Interacting without a gift opens a bottom choice between authored Talk and optional Chat.
5. The bottom conversation panel shows the resident portrait, the player's typed line, a waiting state, and the guarded reply.
6. Local chat never changes friendship, inventory, gold, gifts, dates, or romance state.
7. `gemma4:12b` runs through the localhost bridge on this Mac and returns valid supervised dialogue.
8. Typecheck, focused browser tests, screenshots, overlap checks, and console checks pass.

## Data flow

`TownResident.interact` opens a transient conversation choice. `ResidentDialogueSystem` owns choice, typing, request generation, and stale-reply rejection. `LocalNpcChatSystem` sends only a resident id, one short line, and read-only public relationship context to the localhost bridge. `UIScene` renders the transient state and never mutates durable relationship progress.

## Safety boundaries

- The model receives no tools and no save-state write path.
- Chat remains off until the player enables it.
- Chat text and replies never enter save data.
- Gift behavior remains direct when a giftable belt item is selected.
- Missing art or malformed model output fails with a visible error.
