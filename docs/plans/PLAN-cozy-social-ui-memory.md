# Cozy social UI and local-chat memory

## Goal

Make face-to-face resident chat remember the active conversation, return complete replies, and give the pause, relationship, and dialogue screens one clear cozy visual style.

## Acceptance evidence

1. A second chat request includes the first player line and resident reply in order.
2. Chat notes persist browser-locally per save slot and cannot modify authored relationship, inventory, gold, or save data.
3. Replies up to 320 characters render without missing text at 960×540 and an 800×600 browser viewport.
4. Pause keeps every current action and setting, with unchanged keyboard behavior and named pointer controls.
5. Town Bonds keeps all 12 residents readable, and does not expose hidden gift tastes.
6. Focused Playwright tests, the production build, and visual screenshots pass with one Chromium worker.
7. Town Bonds shows saved exchanges per character and can compact them into a bounded factual summary.

## Work packets

1. Extend the guarded localhost protocol with a bounded six-turn history and a 320-character complete-reply limit.
2. Store completed turns per character and send only a summary plus the newest three exchanges.
3. Redesign the dialogue panel as a portrait-led speech card with visible conversation-memory status.
4. Redesign Pause as a shopkeeper daybook with a separate settings shelf.
5. Redesign Town Bonds as an open relationship journal with a clear roster and full-body portrait.
6. Add readable chat-note pages and manual local-model compaction inside Town Bonds.
7. Run three browser review rounds, fix visible problems, then run focused regression checks.

## Safety boundaries

- The model receives no tools and no authority over game state.
- Chat notes use a separate browser-local store keyed by save slot and never enter authored save data.
- The request body remains exact and bounded. Unknown fields fail explicitly.
- Existing saves and unrelated dirty worktree files remain untouched.
