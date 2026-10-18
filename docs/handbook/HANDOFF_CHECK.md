# Handoff check — September 14, 2026

## Scope and results

This pass changes instructions, documentation and preserved reference images only. It does not
change game source, active model settings, server ownership or browser saves.

- New `shopkeepers-legacy` skill and its UI metadata validate with the bundled skill validator.
- Existing `game-character` plus project game-art, game-systems and playtest entrypoints validate.
- Eleven local handbook links resolve before adding this review page; both reference PNG copies
  match their supplied originals byte for byte.
- All 54 installed source, asset, script and test files in the town installation baseline remain unchanged.
- `git diff --check` passes. The 395-test game result is retained from the preceding installation;
  a new full gameplay run is not claimed for this docs-only pass.
- The validator initially lacked PyYAML. An isolated `uv run --with PyYAML` environment runs it
  successfully without changing game dependencies or global Python installation.

## Independent forward test

A fresh `gpt-5.6-sol` agent, without this conversation history, receives the new skill and a short
request to plan a small town-interior improvement and explain a later group-character import.
It is limited to read-only files; no generation, game edits, servers or extra agents are authorized.

Observed response: it identifies the installed twelve buildings and unfinished service economies;
proposes one Market-only visual slice with unchanged geometry/saves; cites real source owners;
keeps resident identity separate from art; describes per-character authored rigs instead of a universal
converter; and preserves the live server/saves while staging. It does not implement unrequested work.

The pass reveals that abbreviated paths can be misread. ART_WORKFLOW now gives full repo-relative
interior paths and the existing visual test. Jeff's actual supplied inspiration screenshots are
also preserved for future visual tasks. The model's reported nonexistent maps/CivicInteriorMap.ts
path was a mistaken inference, not a path the handbook actually contained; explicit paths reduce that risk.

## Self-Audit

Current-state facts are separated from historical plans and future goals. Superseded literal table
rotation, single-tile furniture collision, pending permanent residents and
blanket server-kill instructions are corrected or clearly marked as history. Prompts and production
assets are referenced instead of duplicated. Visual references remain inspiration, not runtime assets.
The general character skill retains source-specific limitations and authorization boundaries.

## Expert Review

Main checks the Sol response against actual source and user decisions, corrects navigational
ambiguity, validates skill metadata/links, and confirms unchanged runtime hashes. This is a small
read-only behavioral check, not a coding benchmark, visual generation trial, or proof that Sol
matches Astra. The user still supplies visual acceptance. Prior formal planning-gate gaps remain
disclosed rather than replaced with invented approval records.

## Using the handoff

In a task using 5.6 Sol, send:

> Use $shopkeepers-legacy. Read docs/handbook/START_HERE.md, then help me with my next game request.

If the skill is not shown, ask the agent to read
`~/.codex/skills/shopkeepers-legacy/SKILL.md` directly. Project AGENTS also points to it.
This does not change model settings for the user.

The structure follows OpenAI's guidance on [reusable skills](https://learn.chatgpt.com/docs/build-skills)
and [project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md): keep durable
entry instructions small and load detailed workflow resources only when the task needs them.
