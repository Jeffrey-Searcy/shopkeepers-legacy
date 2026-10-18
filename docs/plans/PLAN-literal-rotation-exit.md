# Literal furniture rotation and a clear interior exit

Jeff explicitly chooses a literal90° image rotation for the table and workbench. Do not generate
another perspective or change chairs, counters, stoves, chests or rugs. The fixed bottom toolbar
covers the south exit because the world camera currently draws behind it.

## Plan and acceptance

1. Reuse Furniture views: same texture/crop/native dimensions, explicit0/90 image angle and
   rotated pivot, with2×1/1×2 collision footprints. R toggles those two orientations.
2. Preview and placed Prop use identical angle/origin; body stays at the full grid footprint.
   Save v6 already records rotation. Test reload, blocked placement, second-cell interaction
   and pickup. No new save version or persisted field.
3. Reuse UILayout's actual logical toolbelt top to reserve an interior-only viewport above it,
   with12logical pixels clearance. Keep world zoom, physical map and outdoor camera unchanged.
   Check800×500/1440×900/1920×1080 atDPR1/2. South exits and keeper stay above the toolbar on
   approach. UI and placement pointer transforms still use the actual cameras.
4. Verify focused/new and full four-worker tests, build/typecheck, real WebGL screenshots,
   Self-Audit and independent Expert Review. User visual approval remains separate.

Choose L1 patch of existing view/render/viewport data. L2 new rendering abstraction or L3 UI
redesign adds no value here. Reuse Furniture, Prop, BaseWorldScene, UILayout, InventoryUI and
existing save validation. Estimate5 production files+1 test,300lines; allow up to3 old fixtures
only if the reduced camera viewport exposes their hardcoded screen positions. No prices,
progression, generated assets, save migration, or outdoor behavior changes.

Single implementation lane: root. Existing reviewer ACKs the contract and reviews independently.
Memory connector is unavailable; current user preference is authoritative. Apply feature and
bug-fix prompt contracts: reproduce before editing, preserve compatibility, capture proof.
Preserve unrelated dirty work on codex/shop-home. Archive the scoped source before edits and
only validate extraction in a temporary directory. No live restore, commit, push, or service stop.
Tests use the explicit isolated5275 configuration; personal5273 game/storage is untouched.
