# Tavern personality pass

September 13, 2026. Local implementation; no deployment or git commit.

## Scope

Improve existing guest behavior and presentation without replacing the shop simulation. Preserve separate service controls, manual closing, prices, room ownership, and future arrival rates. The broom ejects only its faced target; the other fighter stays and calms down.

## Acceptance evidence

- `tests/tavern-personality-system.spec.ts`: ten checks cover real ale sales, contact geometry, split-time determinism, targeted ejection, sold-out guards, paid rooms, closure, morning checkout, and version 8/9 saves.
- `tests/tavern-personality-input.spec.ts`: five checks cover alternating conversation content, native Q/click replies, native broom targeting, task-list controls, and WebGL rendering at 800×600 and 1280×720.
- `output/personality/reviewer-report.json` in the staging folder records browser errors, paused-state equality, and changing fighter visibility. Independent screenshots cover four simultaneous conversations, vertical fights, and reduced motion.
- Full regression: **279 passed**. Build: **passed**. Results are recorded in `planning_artifacts/tavern-personality` in the staging folder. The first full run passed 277 checks and found two old assertions that still expected save version 8. Only those version assertions changed before the passing rerun.
- Full-run proof: `captures/1789316259-full-regression-v2-100/manifest.json`, SHA-256 `515b8634a71501bd8a90343c71b4b67cfacae220458958edf76903ed6e94c580`.
- Before applying, all live target hashes matched the backup baseline. All 25 applied files then matched the tested staging copy byte-for-byte. No user saves or running service processes were changed.
- Installed-copy build passed. The fresh live control run passed all **23** checks, including scythe/broom separation. The native sold-out pointer test then passed **20/20** repeats.
- Live proof: `captures/1789316815-live-controls-diagnostic-100/manifest.json` (`a0f76870c5ef2589cc5e5a6f9bd24b59eece937b2588ee823fafd9f4e156e764`); repeat proof: `captures/1789316849-live-pointer-repeat-100/manifest.json` (`a8e6535bf9009b063364de18eab3b09de020443f7c5859ff3a20c93181c1d4b0`).

### Diagnostic note

The first installed-copy run passed 22/23: its pointer test clicked before the sold-out control became visible after inventory closed. The test now waits for that rendered control. Independent review confirms this is a valid native-input wait, not a weakened business assertion. A second installed-copy run had broad intermittent missing-game/fixture failures; their cause is unconfirmed. No speculative runtime fix was added. Fresh diagnostic and repeated-input runs pass. This is not an all-runs-clean claim.

Staging and the before-apply backup were temporary folders outside the repo.

### Self-Audit

- Fight time is durable state; each pair has distinct, disjoint guest IDs. Validation rejects missing, corrupt, impossible, or blocked-contact pairs.
- Split simulation steps at anger and route-contact boundaries so saving or frame timing does not change fight onset.
- All interactions recheck reach, facing, modal state, guest phase, and relevant stock. Sold-out replies do not charge or remove inventory.
- Guests who own rooms retain their bookings when dismissed. Fight cleanup runs during departure, closure, timeout, and day changes.
- Early ale rounds retain the same seat, preventing social pauses from losing repeat orders before intoxication.
- Conversation content is finite: twelve authored exchanges, not unlimited dialogue or a relationship simulation.

### Expert Review

Independent reviewer approved the code and visual checks, subject to the full regression passing. Review found and corrected four concrete gaps:

1. Common guest pairs collided on the same conversation topic. Paired social spots now use separate topic banks.
2. Paid-room fight cases needed real sale and save-envelope tests. Added those cases.
3. Vertical fights needed a rounder shared dust cloud with actual guest glimpses.
4. The compact quest reminder covered guest speech. It hides during service; J opens the task list deliberately.

## Formal gate status

The planning-gate skill's formal approval remains blocked. It lacks memory evidence, skill-evaluation measurements, required historical checkpoints and workflow records; some proof names also fail its naming rules. See staging `planning_artifacts/tavern-personality/finalize.json` for the exact field list. No history or approval is fabricated. Captured tests, local build results, and independent review are separate evidence; they do not imply a passing formal gate.

## Reproduce

From the project folder, run `npm run build`, then `npx playwright test --config playwright.personality.config.ts --workers=2`. The test configuration owns port 5276 and uses a separate Vite cache. It does not reuse or restart the user's port 5273 or access their browser profile.
