# ShopkeepersLegacy: start here

Last verified: September 15, 2026. This is the short current-state guide for a fresh model.
Read the relevant source before changing it. Older roadmap entries remain history, not current status.

## Where and what

Checkout: `~/Desktop/code/ShopkeepersLegacy`.
Remote: `https://github.com/Jeffrey-Searcy/shopkeepers-legacy.git`.
Last branch: `codex/shop-home`; verify it rather than switching automatically.
The checkout has extensive user-owned uncommitted work. Do not reset, clean, stash, or blanket-stage it.
Live game: `http://localhost:5273/`. Docker Desktop runs the game and NPC chat bridge;
Ollama remains on the Mac. See [local Docker commands](../DOCKER_LOCAL.md).
iPad: `https://<mac>.<tailnet>.ts.net:10000/` through Tailscale Serve, touch only; see the iPad
section in [local Docker commands](../DOCKER_LOCAL.md). Controls: [touch controls](../../src/input/TouchControls.ts).
Testing uses a separate server on 5276.

The game combines cozy farming and building with a player-run shop/inn/tavern.
Mines and dungeons are separate: Stardew-like mines, Moonlighter-like dungeon ambition.
The old V1-only restriction describes the initial milestone; hospitality is already implemented.

## Current state

- User-approved Farm layout and Town terrain are live. Town has upper-left Farm, lower-left
  Forest, north outdoor mine entrance, and south Beach routes. Three bridges connect its banks.
- Twelve distinct town facades, walk-in animated doors, expanded public rooms, and named residents are live.
  Jeff approves the exteriors. The Market set the interior direction; the other eleven now have distinct
  work zones, connected east homes, visible two-heart bedrooms, and role-specific services. Final visual approval is open.
- Fixed townspeople keep their identities and use the original pixel art.
- Player Appearance customizes the original wardrobe.
- Player shop/bedroom remain separate from public town rooms. Players craft their own stations,
  place from the toolbar with the mouse, rotate where supported, and connect tables/rugs.
- Inn bookings and tavern opening are independent. Lodgers use guest-only stairs. Batch cooking,
  equipped delivery, sold-out responses, social talk, anger, drunkenness, fights, and targeted broom
  ejection exist. See [hospitality controls and limits](../HOSPITALITY_PLAYTEST.md).
- Farm trees/rocks stay cleared; plant species-specific seeds for new farm trees. Existing crops
  and connected soil are implemented. This does not mean farming or mines are visually finished.
- All twelve permanent adult residents now have authored profiles, hidden tastes, daily talks,
  twice-weekly gifts, 10-heart romance routes, and a complete 66-pair NPC bond network. Pause → Bonds opens the journal.
  Every player route stays open; an exclusive NPC bond only makes that route slower.
- All twelve residents follow detailed seven-day schedules. Every day includes 8–9 personality-led stops for
  private time, work, meals, errands, social time, leisure, and home. Residents walk the compiled Town paths,
  enter the correct public buildings, and skip a closed stop unless owner or partner access permits it. Outdoor
  travel samples fractional game time for continuous motion. Indoor residents follow broad room-safe loops with
  four natural pause destinations instead of pacing one fixed square.
  Six save-specific pairings form each day and appear under the selected person's Town Relationships page.
- Pause → World Routes opens the Keeper's Atlas. It draws every real daily route in a distinct color,
  places face-cropped portrait pins at the selected day's current-time positions, and cycles the current week.
  Development builds add **Edit NPC Routes**. Its isolated weekly workshop covers all 12 residents and all 7 days,
  with direct map-placed stops, live draggable line-bend points, paired 15-minute time selectors, reasons, movement preview, undo, import, and export. Its draft never changes a save
  or production schedule. The starter and live game now share one route compiler, while local editor changes remain drafts until explicitly installed.
  Each adult has one weekly daydreaming stop. Earlier draft keys remain untouched.
- Direct player-to-resident dialogue pauses the game clock and every schedule until the dialogue closes. This includes
  local-model waits. NPC-to-NPC meetings do not pause time. Town doors close at 8 PM, except the bar at midnight; partners may enter.
- Resident meetings can show friendship, flirting, embraces, kisses, partnership talks, or boundary talks.
  Closed partners only discover cheating when they see a romantic action. A visible resident in the same
  interior sees it; outdoors they must be within six tiles. An agreed open relationship prevents betrayal.
- Optional local character chat is off by default. The model supplies speech and a bounded behavior label.
  Game rules alone turn that label into a warning, ended talk, or guard call. The model cannot perform actions.
  The same local model may voice a nearby resident meeting, but authored dialogue always works without it.
  Resident meetings now receive the pair's current bond and their last three shared conversations. The second line
  must answer the first. Player chats receive up to six exact accepted-gift facts, including the item and day.
  The Docker Desktop stack starts the chat bridge automatically. Ollama must remain running on the Mac
  before enabling Local Voice in Bonds.
- Chat Notes can delete one displayed exchange or clear only compact memory. Each action needs two clicks.
- Continue loads migrated saves directly. Migration diagnostics remain internal; no update interstitial blocks play.
- Severe chat conduct calls Captain Maren at once and sends the player to the locked jail cell. Sleeping there
  ends the day and returns the player to Farm with half stamina. Lesser conduct warns once, then ends later chat.
- The Town Watch House and Captain Maren are service content. They do not change the twelve romanceable residents.
- Save version 15 stores resident warnings, refusals, and a bounded incident list. Version 14 stores the 66-pair
  network and its per-save social seed. Version 13 expands from its six
  original bonds without losing progress. Versions 1–12 migrate to empty progress, and the
  first overwrite preserves the old envelope in byte-exact relationship and justice backups where required.

## Not implemented by the town-interior pass

Tool upgrades, a permanent museum collection, hiring, dates, marriage, full relationship cutscenes,
and a complete Moonlighter dungeon are not finished services. The guild quest board currently exchanges
existing cave resources for gold and introduces the northern portal trail; it does not open the portal yet. Resident
schedules, changing pairings, open agreements, witnessed cheating, and breakups are foundation systems.
Do not confuse the public town bar with the player's working tavern simulation.
Do not describe the hand-authored 12-character pool as a one-click converter for arbitrary images.

## Next direction and boundaries

Jeff's next step is the eleven-room playtest. Preserve the excellent town exteriors and the approved Market.
Treat his feedback as room-specific; a church, clinic, guild, forge, and bar must not collapse into one shop plan.
Do not alter Farm, repaint approved facades, or change the player shop layout as a side effect.

## Read only what the task needs

- [Design decisions](DESIGN_DECISIONS.md): latest choices, rejected experiments, and social behavior.
- [Art workflow](ART_WORKFLOW.md): facade recipe, native geometry, interiors, furniture, character workflow.
- [Engineering and tests](ENGINEERING_AND_TESTS.md): source owners, commands, saves, staging, failure handling.
- [Town catalog and controls](../TOWN_BUILDINGS.md): all twelve owners and scene behavior.
- [Handoff check](HANDOFF_CHECK.md): skill validation, limited Sol trial, and a restart prompt; read only when checking the handoff itself.

## Last verified evidence

The September 15 weekly self-activity and dialogue-clock pass ran 22 focused browser checks with one worker. All passed.
It covers all 84 resident-days, all twelve authored bed centers, adult gates, the real blurred-heart bedroom effect,
route-draft isolation, direct-dialogue clock freezing, NPC meeting time, and save safety. Typecheck and production build pass.

The September 17 route install validates all 84 live route days, shared editor starters, building access, indoor visitors,
outdoor walking, and atlas positions. The focused production route checks, typecheck, and production build pass.

The September 17 route-motion repair ran 16 focused browser checks with one Chromium worker. All passed. It covers
continuous outdoor interpolation, broad cardinal loops in all twelve civic rooms, dialogue pin-and-resume behavior,
all 84 route days, building visits, social state, and resident art. Typecheck and the production build pass.

The September 15 route-time repair ran all 4 route-editor browser checks with one Chromium worker. All passed.
It covers paired time edits, one-step validation, invalid-range rejection, locked home times, live route dragging,
and adventure-save isolation. Typecheck and the production build pass.

The September 15 direct-route-editor repair ran 12 focused browser checks with one Chromium worker. All passed.
It covers route-line clicks, draggable bend points, click-to-place timed stops, map-level feedback, responsive controls,
undo, preview, draft validation, and byte-identical adventure-save isolation. Typecheck and the production build pass.

The September 15 route-and-chat pass ran 50 focused browser checks with one worker. All passed. It covers
route draft safety, weekly editor controls, portrait pins, direct migrated-save entry, exact accepted-gift memory,
shared NPC conversation history, strict local-model requests, and protected game state. Typecheck and the
production build pass. The live Docker chat bridge was not restarted during this pass.

The September 15 civic pass ran 25 focused browser checks with one worker. All passed. It covers every
service stance, transaction, bedroom gate, old walkable cell, exact saved position, and byte-identical legacy save.
The fixed visual pass captured entry, service, bedroom, desktop menu, and Retina menu views for all eleven rooms
without browser errors. Typecheck and the production build pass. The earlier September14 justice pass ran all437 browser checks with one worker:435 passed, while two old Exterior
tests still clicked the menu's former location. After correcting that test coordinate, all six Exterior tests,
all53 affected-system tests, and all five final justice checks pass. Warning, arrest, jail release, guardhouse,
and v14 migration all have browser proof. Typecheck and the production build pass. The whole437 set was not
rerun after the test-only coordinate correction. Run browser suites with one worker to protect Jeff's Mac.
Final graphics: 24 WebGL entry/exit round trips across desktop and Retina sizes; 52 screenshots.
Live port 5273: twelve rendered facades and twelve working mixed-use interiors.
These are dated results, not permission to skip checks after the next change.

Durable local evidence and exact file backups: `output/town-buildings-install-2026-09-14/`.
Full test proof: `planning_artifacts/town-buildings-install/captures/1789384795-installed-full-regression-100/manifest.json`.
These ignored local directories may be absent in another checkout. Do not claim fresh proof there.
Formal planning-gate metadata remains incomplete; gameplay test results do not imply formal approval.

## Keep this useful

After a meaningful pass, update changed facts, the next agreed step, and the dated evidence.
Record new explicit user choices in DESIGN_DECISIONS. Keep this page short; link details instead
of appending transcripts. No model can guarantee identical results from written guidance alone.
