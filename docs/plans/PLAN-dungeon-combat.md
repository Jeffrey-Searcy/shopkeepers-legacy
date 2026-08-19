# EXECUTION PLAN — Moonlighter-style Dungeon Combat (Fable 5)

> Drafted by Opus for Fable-5 execution. Baseline: 47/47 specs green, typecheck clean.
> **Read `.claude/skills/game-systems` (esp. "Concurrency & liveness") + `game-art` + `playtest` first.**
> The designer's directive: the Mines PLAY like Moonlighter, not Stardew — combat animations may diverge (approved).
> Run to completion in ONE session. Queue ALL PixelLab art up front (curl -L + `file`-verify), code while it renders.
> **Scope discipline: combat exists ONLY in the Mines for V1. Outside the mines, no HP, no damage, no combat HUD.**

## Research first
WebSearch Moonlighter's dungeon loop (real-time combat, dodge-roll, enemies drop loot, push-deeper vs
leave risk/reward). Capture the ESSENCE in the V1 below — not a full clone.

## Baseline facts (build on these)
- Mines scene: `src/scenes/MinesScene.ts` (thin subclass of BaseWorldScene) + `buildMines()` in MapDef
  (cave floor, ~70 mineable rocks, ladder alcove, warp to/from Mountain). **Do NOT edit MapDef or
  BaseWorldScene** — reach the mines exactly as today (m14 spec must stay green; enemies must NOT spawn on
  the entry spawn tile).
- Player entity: `src/entities/Player.ts` (feet-based body, `playAction(name)` one-shot anims). Farmer
  PixelLab character id: `0e1af81a-0d21-403e-a2b4-756050d35ef1`.
- Input: `src/input/InputBus.ts` (YOURS to extend). Movement is held-direction; one-shot actions via emit.
- Drops: `src/entities/DroppedItem.ts` + `BaseWorldScene.spawnDrops(item,n,tx,ty)` (magnet-collect). You can
  reuse the drop VISUAL/collect pattern, but since you can't edit BaseWorldScene, implement a MinesScene-local
  drop spawn if needed (see ownership note) OR request a small hook.
- Sleep/wake-home: `SceneTransitionSystem.transitionTo(scene, SceneKey.Home, 'entry')` warps home; `sleep()`
  advances the day. GameState.gold exists.

## ARCHITECTURE (all new, confined)
Create `src/combat/` with:
- `CombatState` fields appended to GameState (minimal, re-read GameState before editing!): `hp`, `maxHp`
  (e.g. 10), `dodgeCooldownMs`, `invulnMs`. Serialize them. Default hp=maxHp; only meaningful in the mines.
- `src/combat/CombatSystem.ts`: pure-ish helpers — `damagePlayer(n)` (respects invuln), `startDodge()`
  (sets invulnMs + cooldown), `tick(deltaMs)` (decays timers), `heal()` (full).
- `src/entities/Slime.ts`, `src/entities/Bat.ts`: physics sprites with hp, simple AI
  (slime: wander, lunge when player within N px; bat: erratic hover toward player). Contact → damagePlayer +
  knockback both ways. On hp<=0: spawn loot drop + destroy.
- Sword: new `ToolId.Sword` in Items.ts (re-read first; hotbar slot 8). Loot items: `slime-gel`, `bat-wing`
  (+ ITEM_VALUES for the shipping bin).

## MINES-LOCAL WIRING (in MinesScene.ts create()/update() — this is where you're free)
- Bind keys scene-locally with `this.input.keyboard.addKey(...)` inside MinesScene: SHIFT = dodge,
  slot-8 (key 'EIGHT') = sword select. (Do NOT edit BaseWorldScene's keyboard binding.)
- Spawn enemies from deterministic seeded spots (use the `Rng` singleton or a local lcg; NEVER on the entry
  spawn tile). Track them in a MinesScene array; `update()` runs their AI + CombatSystem.tick + sword-hit
  checks (on use-tool with sword active, hit enemies whose tile is in the facing area).
- Sword swing: `this.player.playAction('sword')` (add 'sword' to Player.playAction's union + PreloadScene's
  action list — Player/PreloadScene are shared; re-read before editing, keep the change tiny/additive).
- HP HUD: a MinesScene-LOCAL overlay (hearts or a bar) created in create(), updated in update(), destroyed on
  shutdown. Do NOT touch UIScene.
- Loot on enemy death: spawn a collectible. If you can't call BaseWorldScene.spawnDrops (private), instantiate
  DroppedItem directly in MinesScene and run its magnet/collect in your update loop (DroppedItem is a plain
  entity you can own locally). Add the collected item to GameState.inventory.
- Clear message: when all enemies defeated, toast "Level cleared!". Ladder-deeper stub: toast
  "The ladder down is blocked... (coming soon)".
- Death (hp<=0): toast "You were knocked out!", `CombatSystem.heal()`, lose 20% gold
  (`gs.gold = Math.floor(gs.gold*0.8)`), advance the day via the sleep path, and
  `transitionTo(this, SceneKey.Home, 'entry')`.
- Leaving the mines (the existing Mountain warp) heals to full — do this in MinesScene shutdown/transition.

## ART (queue up front, curl -L, file-verify, STRAIGHT-ON per skill)
- Farmer sword-swing anim: `animate_character(id, mode:'v3', frame_count 4, dirs [s,n,e,w],
  action_description "swinging a sword in a downward slash, blade clearly visible")` → assemble
  `characters/farmer-sword.png` (scripts/assemble-walksheet.mjs) → manifest `player-sword` spritesheet.
- `enemy-slime` (24x24, a couple bob frames or single), `enemy-bat` (24x24), `icon-sword` (32x32),
  `icon-slime-gel` / `icon-bat-wing` (32x32). Manifest: surgical python key patches ONLY (another wave may
  patch other keys concurrently).

## Ownership / guardrails
- YOU OWN: src/combat/** (create), src/entities/{Slime,Bat}.ts, src/scenes/MinesScene.ts, your tests, your art.
- SHARED — re-read immediately before EACH edit, tiny additive changes only: GameState.ts (append hp/maxHp/
  dodge/invuln + serialize), Items.ts (Sword + loot items/values), Player.ts + PreloadScene.ts ('sword' anim),
  InputBus.ts (any new actions), DebugHooks.ts + tests/helpers/gameHarness.ts (seam: hp, enemies list,
  attack/dodge; SeamState fields). If you hit "file modified since read", re-read & re-apply.
- FORBIDDEN: src/world/*, BaseWorldScene.ts, UIScene.ts, other scene files, MapDef Mines data/warps, whole-file
  manifest rewrites. Need something there? Put a request in your report.

## SPECS (add tests/m16-dungeon.spec.ts — drive via seam + real keys)
1. Enter mines; seam `enemies()` returns >0; none on the entry spawn tile.
2. Select sword (real key '8'), face a slime, use-tool → slime hp drops; repeat → slime dies → loot drop →
   collect → inventory has slime-gel.
3. Contact with an enemy reduces `hp` (drive player into a slime; poll hp < maxHp).
4. Dodge (Shift) grants i-frames: start dodge, move through a slime, assert hp unchanged during invuln.
5. Death penalty: seam-force hp to 0 (or take enough hits), assert gold reduced ~20%, activeScene becomes
   'HomeInteriorScene', day advanced, hp restored to maxHp.
6. Leaving the mines via the Mountain warp restores hp to full.
Keep m14 (mines reachability) green.

## Final verification
1. `npm run typecheck` → 0 errors.
2. `pkill -f vite; npx playwright test` → ALL green (47 existing + m16).
3. Screenshots (port 5273) and LOOK: a combat moment (player + enemies + HP HUD), a loot drop. Fix jank.
4. Report: architecture, art ids/generations, spec names, suite result, screenshots, any requests.
