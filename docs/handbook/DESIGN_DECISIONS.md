# Current design decisions

Source: Jeff's explicit decisions in the project conversation through September 14, 2026.
New instructions can change them. These describe intent; START_HERE distinguishes shipped work from goals.

## World and business

- The inherited exterior begins shop-neutral, with a real porch and depth. Shops may gain distinct
  themes. Town buildings should be different architecture, not recolors of the player's shop.
- Enter doors by walking in; no E requirement or long serial delay. The player should stand on
  a landing, pass behind the frame, and cross a threshold—not look pasted over the building.
- The private back room is a bedroom. Upstairs is a visual guest destination, not player-accessible rooms.
- Players build/craft their own shop furniture and service stations. Do not refill the player's
  empty shop with fixed stations during an unrelated change. Public town rooms are a separate case.
- Future progression clears Farm debris, adds crops and more shops. Farm trees require planting;
  rocks do not regenerate there. Mines remain a separate resource destination, not the current priority.
- Town exits: upper-left Farm, lower-left Forest, north outdoor mine entrance before the mine,
  south Beach. Preserve editor drafts/export and working routes during art changes.
- The route editor uses direct map drawing. Drag stops, click route lines to add bend points, and use
  **Add stop** before clicking the map. Do not require hidden select or move modes for ordinary edits.
- Town interiors follow their role rather than one shop template. Commercial rooms use a front counter
  or work station. The sanctuary, museum, clinic, guild, forge, and alchemy house use their own focal action.
- The adventurers' guild is a safe haven with a quest board. Its first contracts prepare the northern portal
  trail and exchange cave resources. The future portal leads to Moonlighter-style dungeons, not the mines.
- Every resident's bedroom remains visible but opens at two hearts. A relationship change updates the gate live.

## Visual taste

- Stardew: grounded exteriors, quiet terrain, porch/wall/roof depth and coherent game scale.
- Travellers Rest: inspiration for rich, warm interiors, substantial furniture and readable layout.
  Use original artwork that captures the qualities; do not copy screenshots as game assets.
- Dinkum/Animal Crossing: cozy, satisfying inventory/chest feel. Necesse: conventional title
  choices and clear hierarchy. These are references, not permission for unrelated UI redesign.
- Crisp readable text and usable browser area matter. HUD/toolbelt must not cover doors or actions.
- Do not add permanent in-world labels to explain poor artwork. Architecture should read visually.
- Keep the original player shape for wardrobe editing. Keep physique readable in the existing world.

## Placement and the table lesson

- Selected toolbar furniture can be placed directly. The preview follows the mouse and snaps to
  validated floor cells; it is not stuck in front of the player. R rotates supported items.
- Rugs, shop stations, tables and chairs are indoor-only for new placement. Workbenches and
  other currently permitted objects work both inside and outside. Extend the policy catalog for new items.
- Tables and rugs connect across corners, mixed orientations and larger blocks—not only straight rows.
- **Rejected:** simply rotating the whole table/workbench PNG 90 degrees. It turns the legs sideways.
  **Latest table rule:** turn the same tabletop; keep the two visible feet on the screen-bottom edge.
  Match tabletop height between orientations. The installed renderer constructs connected surfaces.
  Workbenches use authored upright views. Follow [accepted furniture detail](../art/furniture-perspective.md).

## People and hospitality

- Paying customers differ from permanent named townspeople. Cosmetic pools do not define identity or job.
- Keep the register's management menu, but handle check-in physically at its front/back approach.
- Inn and tavern open/close independently. The player chooses when stock shortages require closing.
  Angry guests can leave; they do not reduce future customer arrivals.
- Serve from equipped inventory goods, visibly carried. Guests should linger, talk, wander, sit or
  order at the bar. Lodgers retain their identities, use stairs, and may visit the tavern.
- Orders use thought clouds. Anger reads through red coloring/steam, not just stationary shaking.
  Drunkenness alone is allowed. A drunk guest meeting an angry guest can trigger a cartoon dust-cloud fight.
- A broom removes **only the targeted guest**, not both fighters. Do not silently change this to a group action.
- All twelve permanent residents are adults and romanceable. Every route always stays available.
  An exclusive NPC relationship makes that route harder, but it never locks the player out.
- Authored rules control hearts, gifts, romance stages, and resident bonds. Optional local chat adds
  in-character speech only. Chat cannot award affection, accept gifts, start dates, or change game state.
- Accepted gifts create separate verified speech facts. The local model can remember the exact item and day,
  but it cannot invent a gift or perform another transfer. Deleting or compacting chat does not rewrite game facts.
- Local resident meetings use the pair's current bond, weekday, place, authored topic, and last three shared
  conversations. Two returned lines form one connected exchange; the second resident answers the first.
- The development route workshop is an isolated design draft. It covers every resident and weekday, but it never
  replaces production schedules automatically. Export and review the JSON before installing route changes.
- Route workshop starter weeks should feel lived-in before manual editing. Every day includes a stable activity type,
  private room time, work or chores, food, an errand, social time, leisure, and home. Weekday variety stays deterministic
  so an editor reload never rerolls Jeff's work. Town-only private stops use the resident's home-door marker.
- Save migration messages stay available to diagnostics. Continue enters the migrated world without a blocking update page.
- Every resident can form a friendship or romance with any other resident. A per-save social seed,
  personality affinity, and daily matching keep different adventures from producing the same social network.
- A relationship stays closed until both residents have an explicit boundaries conversation. Relationship
  style changes the chance of that talk, but does not make it impossible.
- Cheating requires a visible romantic action: flirt, embrace, kiss, or define the relationship. A closed
  partner catches it only in the same visible interior or within six outdoor tiles. Discovery ends their bond
  and records the betrayal day. Friendly conversation never triggers jealousy.
- All twelve residents follow deterministic weekday and weekend schedules. They walk between their
  assigned work, home, and one paired social meeting. Missed meetings still happen off-screen.
- Game time pauses during direct player-to-resident dialogue, including local-model waits. Every town route resumes
  from the same clock minute after the conversation ends. NPC-to-NPC meetings do not pause time. Town buildings
  close at 8 PM; the bar closes at midnight. Owners and
  established partners keep access, and a route skips any stop that denies entry.
- Every adult resident has one authored daydreaming private-room stop per week. Normal gameplay calls it "do not disturb"
  and uses the existing blurred-heart treatment over that resident's bed.
- Six changing pairs include all twelve residents each day. The event log records the visible action,
  witnesses, speech, and every bond change before state changes, so reloads cannot award a meeting twice.
  Town Relationships shows the selected resident's bond with each of the other eleven people.
- One optional shared local model can replace the two spoken lines only when the player witnesses a
  meeting nearby. It cannot select partners, award points, alter schedules, or control any game action.
- During direct player chat, the local model also returns one strict behavior label. Game code owns every
  consequence. Lesser conduct gives one warning before the resident ends chat. Severe conduct calls the
  guard immediately. Neither result permanently closes that romance route.
- Captain Maren is a service guard, not a thirteenth romanceable resident. An immediate arrest moves the
  player to a locked jail cell. The cell bed ends the day and releases the player with half stamina.
- Adult private romance is always on (no setting) for dating or committed relationships. The local model decides
  only the spoken accept or deny response. Game code owns all movement, timing, witnesses, reports, and effects.
- Player-facing text uses natural invitations instead of a named feature label. Its scene effect is blurred
  silhouettes with floating hearts. Private events are runtime-only and never saved.
- Hiring is a desired future system, not a finished feature. Likewise, large-scale food/ale production
  beyond the current batch stove is a future design task, not an established fermentation simulation.

## Collaboration

Jeff prefers plain, short updates and real in-game results. He can describe an uncomfortable visual
without supplying a technical cause; inspect it before choosing a fix. A speculative diagnosis is not a fact.
For broad art work, use a representative proof and his feedback. For approved implementation, finish the
in-game installation and verification; do not leave work in staging and call it live.
Preserve playtests and saves. Check before actions that require a service restart or expanded authority.
