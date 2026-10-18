# Relationships and optional local chat

Installed September 14, 2026. All twelve permanent town residents are adults and romanceable.

## Play

- Talk to a resident with E. The first talk each day gives 20 points. Later talks still show dialogue.
- Put a non-furniture item in the selected toolbelt slot, then press E near a resident to offer it.
- Each resident accepts one gift per day and two gifts per seven-day week.
- Gifts give80,45,10,-30, or-60points based on hidden tastes. The journal never reveals those lists.
- Each250points fills one heart. Pause and select **♡ Bonds**, or press R while Pause is open.
- Use **Share your feelings** at the required heart level to move from friends to interested,
  dating, and committed. NPC partnerships raise early requirements by three hearts and halve positive
  point gains. They never close the player route.

All twelve residents follow weekday and weekend schedules. They travel between work, home, and six
meeting places in Town. Each day makes six new save-specific pairings, so all twelve people socialize.
Personality preferences and the save's social seed shape who feels drawn to whom. Different adventures
can grow different friendships and romances.

Game time pauses during face-to-face resident dialogue, including while Local Voice is thinking.
Every resident stays on their current route point. When the conversation closes, the clock and routes resume.
NPC-to-NPC conversations remain part of the normal running schedule.

Pause → Town Bonds → **Town Relationships** opens from the selected resident. It shows that person's
bond with each of the other eleven residents, including its stage, progress, agreement, betrayal history,
recent visible action, meeting place, witnesses, and saved conversation. Player romance routes remain open.

Resident actions include friendly talk, flirting, embraces, kisses, defining a relationship, and discussing
boundaries. Relationships start closed. A boundaries conversation can make one open. Any personality pair
can eventually have that conversation, but open-minded residents are more likely to suggest it.

A closed partner only catches cheating when they see a romantic action. Visible residents in the same
interior can witness it. Outdoors, they must be within six tiles. Friendly talk never counts as cheating.
Discovery ends the betrayed bond, clears its progress, and records the day. Unseen romance can remain secret.
The event stores its action, witnesses, speech, and all bond changes before applying them. Reloads and scene
changes cannot award the meeting twice. Sleeping completes missed meetings before the next day.

The current slice does not yet add player dates, marriage, full scandal cutscenes, gossip spreading, apologies,
or reconciliation. Multiple player commitments still become complicated without closing any route.

## Private romantic moments

This adult feature is always on and has no setting. A dating or committed resident can show two
contextual choices after local chat reaches an intimate topic: go to their bedroom, or stay together where
they stand. The local model only accepts or denies the offer in character. Game code owns movement, timing,
relationship changes, witnesses, reports, and jail consequences.

A bedroom choice makes the resident walk to their authored bed. The player must follow and interact there.
The standing choice starts at once and carries witness risk. The scene shows blurred figures and floating
hearts. It does not show an explicit feature label. Private events are runtime-only and are never saved.

Adult resident pairs can also choose private activity during their evening home window. The schedule system
still owns their routes. A witnessed public event uses a four-tile facing cone, checks walls, and queues the
witness reaction before any report. Report odds use the witness relationship. A reported resident stays in
jail until the next day; an arrested player uses the existing locked-cell day ending.

## Optional local character chat

Normal resident dialogue is authored and needs no model. Local chat is browser-local and off by default.
It adds speech plus one bounded behavior label during face-to-face town conversations. When the player stands near a scheduled
meeting, the same model may replace that event's two authored lines. It cannot change hearts, inventory,
gifts, romance stages, quests, schedules, or saves. Game code alone applies any relationship loss or arrest.

Install Ollama, pull the tested model once, then start the narrow local bridge:

```sh
ollama pull gemma4:12b
npm run npc-chat:local
```

Enable **Local chat** in **Pause → Town Bonds**. Then meet a resident, press **E**, and choose **Chat**.
Missing service, malformed model output, and disallowed response shapes show a clear error. The bridge
listens only on 127.0.0.1:5277, allows the local game and test origins, and sends no model tools.
The game calls the bridge through its own address at `/chat`; the Vite dev server forwards those
requests (`SHOPKEEPERS_CHAT_PROXY`), so chat also works from the iPad over Tailscale.

Completed chats are stored as browser-local notes for that save slot. Town Bonds → **Chat Notes** shows
one full exchange per page. **Compact Memory** asks the local model for a factual summary, then keeps the
two newest exchanges verbatim. A new conversation sends only that summary and the newest three exchanges,
so long histories do not overload the model. **Delete Chat** removes only the displayed exchange.
**Clear Memory** removes only the compact summary. Both actions require a second confirming click.
Chat notes never grant authored progress.

Town meeting notes are also browser-local per save slot. They keep at most 72 events. The oldest event
leaves first when event 73 is added. Each witnessed local-voice request runs once with no retry. If it
fails, the authored lines remain and Town Relationships shows the model error.

While chat is on, type normally and press Enter. Escape closes the conversation. The letter E stays inside
the chat panel, so typing it cannot close the conversation.

Accepted gifts also create a separate verified memory for that save slot. The next local chat can remember the
exact item, day, and prior reaction. Rejected gifts do not create memory. The model cannot invent another gift or
change inventory. Deleting chat lines or compact memory does not erase these verified game facts.

Local resident-to-resident speech receives the pair's current bond and up to three prior shared conversations.
Each two-line scene stays on one concrete subject, and the second resident must answer the first. Authored lines
remain available whenever local voice is off or unavailable.

Lesser conduct gives one clear boundary warning. Repeated lesser conduct ends that resident's chat for the
day. Severe conduct calls Captain Maren immediately. The player enters the locked jail cell and can only
walk, pause, or use its bed. Sleeping ends the day and returns the player to Farm with half stamina. These
consequences reduce relationship points but never permanently close a romance route.

## Save compatibility

Save version 16 adds resident jail release days. Private-event runtime state remains transient and never enters
a save. Its first overwrite of a v15 slot keeps exact original bytes at
`shopkeeperslegacy.save.backup.pre-cuddle-v16.slot.N`. Save version 15 adds exact resident warning/refusal days and a bounded incident list. Its first overwrite of
a v14 or older slot keeps exact original bytes at `shopkeeperslegacy.save.backup.pre-justice-v15.slot.N`.
Save version 14 stores exact progress for all 12 residents, all 66 bonds, and one social seed. Version 13
expands its six original bonds into the complete network without losing progress. Versions 1–12 migrate
to empty relationship progress. The first save that overwrites an older slot preserves the original
envelope at `shopkeeperslegacy.save.backup.pre-relationships-v13.slot.N` and verifies the bytes first.

## Source ownership

- `src/config/ResidentRelationships.ts`: profiles, attraction preferences, hidden tastes, dialogue, and all 66 bonds.
- `src/config/TownSchedules.ts`: weekday/weekend times, meeting spots, and reusable resident dialogue.
- `src/systems/RelationshipSystem.ts`: all durable point, gift, romance, and bond changes.
- `src/systems/TownScheduleSystem.ts`: deterministic resident routes and scene presence.
- `src/systems/TownBuildingAccessSystem.ts`: visiting hours and relationship-based entry exceptions.
- `src/systems/TownSocialLifeSystem.ts`: exact-once meeting events, logs, and guarded local voice.
- `src/ui/RelationshipUI.ts`: profiles, Town Relationships, and per-character chat-note pages.
- `src/systems/LocalNpcChatSystem.ts`: browser request and protected-state check.
- `src/systems/ResidentChatMemorySystem.ts`: per-save-slot local notes, context window, and compaction.
- `src/systems/JusticeSystem.ts`: validated warnings, ended conversations, relationship loss, and arrest requests.
- `src/systems/CuddleSystem.ts`: private-event eligibility, movement, timing, witnesses, reports, and transient outcomes.
- `src/world/CuddleEffectRenderer.ts`: shared blurred-figure and floating-heart scene treatment.
- `src/entities/TownGuard.ts` and `src/scenes/JailScene.ts`: Captain Maren and the locked consequence scene.
- `scripts/npc-chat-server.mjs`: localhost bridge to Ollama.
- `scripts/npc-chat-supervisor.mjs`: server-owned personas, prompt, and response checks.
