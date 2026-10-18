# Farm layout and shop family

User approves moving existing saves on 2026-09-13. Preserve interiors; outdoor placed furniture may be removed.

## Contract and scope

1. Promote the exact supplied farm export. Preserve the north trail without adding a warp.
2. Migrate legacy saves once. Preserve interior state; remap cleared authored resources from an immutable snapshot. Keep crops/soil/planted trees where valid and explicitly relocate conflicts. Remove outdoor placed objects with a notice. Back up original slot bytes before overwrite.
3. Current saves round-trip without repeated migration. Invalid reads or failed backups cannot replace live state or saved slots.
4. Editor reset uses the new base; known old exports convert explicitly without discarding original storage bytes. Preview stays isolated.
5. Retain the original facade plus eight real art variants, all using the same porch, collision, entrance and size. Expose a cosmetic selector without changing shop operation or interiors.
6. Typecheck, build, regression tests and native-input entrance/exit checks pass. Inspect every facade in the game.

Reviewer customer_runtime_map ACKs these criteria before execution. User approves the plan and existing-save migration. Crop conflicts must not be silently deleted.

## Execution

Bounded swarm: map/base/editor and save migration have separate owners; main handles art and the cosmetic selector. They converge before browser verification. This permits art generation to run beside migration implementation.

Reuse MapData, FarmLayoutDraft, SaveSystem candidate validation, SettingsSystem and ShopFront. Choose L2 abstraction: a small explicit legacy-to-current migration and a data-driven facade catalog. L1 global map replacement loses coordinate-based progress. L3 a new multi-shop building system is outside this request.

Estimated scope: 18 source/test/doc files plus authored map and eight PNGs; roughly 1,100 lines excluding map data. Exceeding three files is necessary for isolated save migration, editor compatibility, assets and verification.

## Guardrails

Reads return detached data and never update slots. Mutators validate before commit; backup failure aborts saving. Frozen surfaces: interiors, inventory balances, hospitality rules, other world maps, original facade file, user port 5273. No direct browser save edits, services restarted, commits or pushes. No future-area warp or multi-shop economy. Cosmetic selection only changes facade art and is reversible.

## Evidence

Run npm run typecheck, npm run build, and Playwright through playwright.personality.config.ts on isolated port 5276. Add old-save, new-save, collision migration, backup, editor compatibility, native input and art geometry coverage. Capture screenshots under planning_artifacts/farm-shop-family/.

## Memory and gate status

Memory tools are unavailable in the active tool catalog; no retrieval success is claimed. Use feature-contract.v1 with explicit user preferences and repository evidence. Formal gate approval remains blocked until its required evidence validates; local correctness is reported separately.

Final `validate_impl.py` and `finalize_gate.py` both return blocked. The JSON records do not supply the full governed plan schema, pre-execution compiler/readiness chain, capture manifests, or memory evidence. `finalize.json` records `ok=false`; direct passing tests do not override that result. This task is handed off only for local playtesting, with no release approval, commit, push, or deployment.

### Self-Audit

Final regression: 345/345 passed in 3.9 minutes (`planning_artifacts/farm-shop-family/regression-final.log`). Typecheck and production build pass; only the existing bundle-size warning remains. All nine facade screenshots and both pause widths were inspected. The facade selector fits and preserves pause/input state. The pause heading remains oversized at 1280px; this is not an exterior-control or save blocker and is not claimed as polished by this task.

Fixed alpha-bound registration so near-transparent export specks cannot shrink the building. Preserved actual generated alpha instead of forcing opaque pixels. Updated old map-coordinate test fixtures to named shop/bin geometry. No user save storage was edited during verification; migration occurs on the user's next load.

### Expert Review

Independent reviewer customer_runtime_map checked the six agreed criteria. Review found that map.interior is rendering metadata, not a reliable outdoor classification. Fixed migration to use an explicit outdoor scene list and added Home/Mines preservation tests. Review also checked detached resource remapping, relocation, backup-before-overwrite atomicity, exact historical settings migration, texture validation, shared porch/door geometry, and event cleanup. No remaining runtime blocker was found. Formal gate status is separate from local playtest evidence.
