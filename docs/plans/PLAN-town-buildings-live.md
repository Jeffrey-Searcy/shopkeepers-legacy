# Town buildings and residents — approved implementation

Jeff approves the full set and asks to install it. Work is staged outside the running checkout.
Current source has no permanent residents or town-service economies. This packet adds twelve
distinct buildings, authored interiors, resident appearances/conversation and safe entrances.
Buying seeds, tool tiers, donations, ranch purchases and other service rules remain separate.

## Plan

1. Prepare twelve genuine transparent facade images through built-in image generation.
   Source art supplies wall/roof identity; native rendering owns24×40 doors,16px landings,
  32px steps and foreground depth. Do not use rejected opaque checkerboard drafts.
2. Compose buildings on the existing twelve Town clearings in normal play. Preserve the raw
   workshop map, fingerprint, routes and bridges. Use shared catalog geometry, not PNG-derived collision.
3. Add one parameterized civic interior class with twelve stable scene keys and authored room
   furnishings. Add twelve independently rendered residents with finite dialogue and safe pacing.
4. Upgrade saves to v12 through explicit pre-building v11 geometry. Preserve old migration
   ordering and exact backups, relocate only conflicting Town records intact, reject atomic failures.
5. Run focused tests, full isolated suite, build and independent visual/source review. Compare
   staged edits against the original baseline before applying; preserve all unrelated dirty work.

## Scope and reuse

L2: one catalog, shared facade renderer, shared interior class and a narrow migration. L1 cannot
provide independent doors/interior identity/save compatibility. L3 framework is unnecessary.
Reuse MapData, SceneKey, ShopFront depth/entrance patterns, BaseWorldScene.enterWarp, RoomAccess,
SaveSystem backups, existing furniture textures, AppearanceTextureSystem and dialogue modal.
Bounded parallel lanes: architecture/save/scene and resident presentation have separate owners;
main supplies art and verification. Estimate20 source/test files plus12 assets,1800–2600 lines.
No new dependencies, save fields for resident simulation, engine, service framework or backend.

Read contract: old save reads/listing never write. Write contract: validate detached candidate,
back up exact original bytes before overwrite, then save current state. Invalid map capacity,
missing assets or failed storage must surface errors. Freeze Farm, player interiors, hospitality,
inventory contents, existing customer identities and editor draft format. No user storage access,
process killing, commits, pushes or source checkout edits until verified staged changes are ready.

## Acceptance criteria — reviewer ACK received before implementation

1. Twelve distinct original manifest-loaded facades; no fake transparency; player-scale visual review.
2. Twelve buildings fit current clearings; four world routes and three bridges remain reachable;
   editor underlay/fingerprint/storage remain unchanged.
3. Every entrance animates and walks in without E;24×40 door,16px landing,32px approach;
   correct native collisions/depth; native round trips through all twelve.
4. Twelve distinct authored interiors, stable scene identity, visible exits clear of HUD,
   public floor protected against player placement; no Farm/player interior changes.
5. Twelve named residents separate from visitors; independent pixel wardrobes; dialogue works.
6. v11 validates against its old map, conflicts move intact, historical migration order/backup
   behavior remains; failed writes/corruption are atomic; interior saves resume correctly.
7. Typecheck, build, full isolated suite and native screenshots pass; Self-Audit and independent
   Expert Review are recorded. No user server/storage mutation or publication.

Resident implementer cannot independently approve their own files; main and architecture lane
review those. Resident lane independently reviews architecture it did not author.

Memory retrieval is unavailable, not empty success. Use feature-contract.v1 with explicit user
and project preferences. Formal planning-gate approval cannot be fabricated from absent tools
or historical runtime records; report its outcome separately from functional game validation.
