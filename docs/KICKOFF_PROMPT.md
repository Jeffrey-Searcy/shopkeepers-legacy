# Kickoff Prompt (V1)

> HOW TO USE: When you're ready to start the build (Phase C), open Claude Code in this project
> with **Opus 4.8**, enter **plan mode** (Shift+Tab until it says "plan mode"), paste the block
> below, and hit enter. Let it produce a plan, review it, approve it, then let it build and
> self-verify in a loop. This mirrors the video's "one prompt in plan mode → whole V1" approach,
> but with a much stronger, pre-loaded spec.
>
> PRE-FLIGHT (must be true before pasting):
> - PixelLab MCP is connected (`claude mcp list` shows `pixellab ✔ Connected`).
> - Playwright is installed (`npx playwright --version` works; `chromium` installed).
> - `CLAUDE.md`, `docs/GAME_SPEC.md`, `docs/ART_BIBLE.md`, `docs/PIXELLAB_GUIDE.md` exist (they do).

---

## PASTE THIS ↓

Build **V1 of ShopkeepersLegacy**, a browser-based 2D top-down pixel-art game.

Read these first, in order, and treat them as the source of truth:
1. `CLAUDE.md` — the build rules (stack, hard rules, engineering discipline, test protocol). The
   Hard Rules and "no silent fallbacks" discipline are non-negotiable.
2. `docs/GAME_SPEC.md` — the spec: Definition of Done, Tech Contract, Controls, Worlds & Scenes,
   Systems, Art Integration, Build Order (M0–M8), Self-Verification. **V1 scope = Stardew core
   only**; the tavern/inn shop and dungeons are later prompts — do not build them now.
3. `docs/ART_BIBLE.md` and `docs/PIXELLAB_GUIDE.md` — read before generating any art.

Environment you have:
- **PixelLab** is available via the `pixellab` MCP server for real pixel art. **Before your first
  generation, fetch `https://api.pixellab.ai/mcp/docs`** to learn the tools so you don't waste
  credits. Generate a **style-test set first** (farmer + grass/dirt/tilled tileset + one tree +
  one rock), wire it into `public/assets/manifest.json`, and confirm the style looks cohesive
  before batch-generating the rest.
- **Playwright** is installed for automated gameplay verification. The game renders to a canvas,
  so verify via the `window.__TEST__` seam described in `CLAUDE.md`/`GAME_SPEC.md`
  (`ready`, `state()`, `input()`, `stepTime()`), booting tests with `?test=1&seed=42`.

How to work:
- Follow the **Build Order M0→M8**. Build each milestone, then write and run its Playwright spec,
  and **do not advance until that spec is green.** M2 (scene transitions) must be green before any
  further systems — the player must never vanish on a warp.
- The four regression specs (scene-transition, camera-follow, map-bounds, placement) are permanent
  gates that encode specific past failures; they must stay green forever.
- Fix root causes, not symptoms. If a theory fails twice, reassess. Never report a milestone done
  on a failing or partial state — show the test output.
- Keep the asset seam clean: game code references only logical keys from `AssetKeys.ts`; swapping a
  placeholder for a PixelLab PNG must be a one-line `manifest.json` change.
- Comment as you go for the next session (per `CLAUDE.md`).

You may **follow this spec or propose improvements and pivot** to best hit the Definition of Done,
as long as you respect the Hard Rules and the no-silent-fallbacks discipline. If you deviate, say
what you changed and why.

Start by producing a concise implementation plan for M0–M8 (scaffold the Phaser 3 + TypeScript +
Vite project, then the milestones), then wait for my approval before building.

## ↑ END PASTE

---

## Notes for you (the designer), not part of the prompt
- **Model/effort:** Opus 4.8. If you want to mirror the video's intensity, run at high/extra-high
  reasoning; the video creator found "max" wasn't worth the extra tokens.
- **Watch cost:** the video's V1 was ~$163 (with a 99% cache-hit rate keeping it cheap despite huge
  token counts). Long autonomous coding is where cost accrues — the milestone-gated approach keeps
  context tight and cache-friendly.
- **Watch PixelLab credits:** he used only ~156 / 5,000. If you see rapid credit burn, it's usually
  wasteful regeneration — the style-test-first rule is there to prevent that.
- **Prompts 2 and 3** (after V1 plays): Prompt 2 = the tavern/inn shop loop (seat patrons, deliver
  the item shown above their head for money, manage the counter/rooms/vacancy sign, eject rowdy
  patrons) built on M7's placement seam. Prompt 3 = polish + additional shop types. Keep each as its
  own plan-mode prompt so scope stays controlled.
