# Town buildings: independent review

## Scope and ownership

The review covers the shared building catalog, exterior rendering, public interiors, placement restrictions, save migration, manifest keys, and furnishing atlas. It excludes the reviewer's own resident implementation. Another agent reviews that code.

## Findings and fixes

1. Exterior collision originally covered blank plot margins. The current wall uses the registered facade position and a narrower body footprint.
2. Saved player-built structures could enter public rooms. GameState now rejects these records before installing state. A regression test checks unchanged storage and live state.
3. Some new furnishing sprites were narrower than their collision footprint. The current catalog narrows books, retorts, pedestals, armor, and mannequins. Both rendering and map collision use that same catalog. No second collider or new physics system is added.

## Evidence

- Independently ran the server-free migration suite: 22 tests passed before the final additional rejection test.
- Inspected the exterior door layers, entrance timing, atlas renderer, manifest keys, public-room geometry, and save guard.
- Read-only PNG check confirms all 16 atlas crops use integer coordinates, remain inside the image, and contain visible pixels.
- Read-only arithmetic check confirms every atlas furnishing has at most eight pixels of total horizontal gap between artwork and its tile footprint.
- The final full browser suite and build are running under the main agent. This review does not claim their outcome.

## Self-Audit

The final furnishing fix changes only new public-room content. It preserves the shared collision source, player-owned furniture, Farm, shop, bedroom, and save schema. Public floors stay reserved. No user saves, services, or source files change during this final review.

## Expert Review

ACK: no unresolved blocking source findings remain in the reviewed packet. The former furnishing-margin issue is resolved. Native travel, rendered game-scale checks, the final test suite, and the build remain separate delivery gates owned by the main agent.
