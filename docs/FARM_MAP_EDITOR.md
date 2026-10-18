# Farm workshop

The map editor is a development-only layout sandbox. It does not edit an adventure save.

## Open it

While playing, press **F10** (or click **Growth Lab**) and choose **Map Editor**.
It opens a separate tab. You can also visit `http://localhost:5273/?mapEditor=1`.
The menu button pauses your original game and leaves it in its original tab.
If you open the direct link yourself, pause your game first to stop its clock.

Choose **Town** in the sidebar for the separate [Town workshop](TOWN_MAP_EDITOR.md).
Each map keeps its own draft. Switching asks before discarding unsaved edits.

## Arrange the farm

- **Move:** drag the shop, trees, rocks, weeds, shipping bin or flowers. Targets snap to whole tiles.
- **Path / Grass:** drag across tiles to paint or erase paths. One stroke is one undo step.
- **Pan:** drag the camera. Space + drag, right-drag and middle-drag also work.
- Use the wheel or zoom buttons, **Whole farm**, and **Find shop** to navigate.
- **Undo / Redo:** use the buttons or Ctrl/Command+Z and Ctrl/Command+Shift+Z.
- Press **Escape** to cancel a gesture. Dropping outside the map viewport also cancels it.

Gold outlines mark legal positions. Red outlines and the bottom status explain rejected moves.
Shop art, porch, collisions, doorway and arrival points move together. Place it in a clear area;
move obstructing trees and rocks first. Tree canopies may overlap, but their trunks cannot.
The shipping bin uses its complete physical size, not a one-tile placeholder.

Version one keeps ponds, cliffs, map borders and exits fixed. It moves existing objects only.
Normal player-built furniture, crops and harvested-resource records do not appear in this editor.
It starts from the authored farm layout, not from the current adventure's progress.

## Save, share and preview

**Save draft** stores the current layout separately in this browser. It does not change normal play.
**Export** downloads `shopkeepers-farm-layout.json`. Send that file to Codex to adopt the exact design.
**Import** loads an exported layout into the editor; save it when you want to keep it.
Invalid or outdated files leave the current draft untouched. Files must be under 1 MB.

**Walk preview** opens a fresh, disposable game in another tab. Walk around, use tools and test
the relocated shop door. It never loads, overwrites or deletes an adventure save. Harvesting
there does not edit the layout. Each preview keeps its opening snapshot; later edits need a new preview.
Return with **Back to editor**, or close the preview tab and use the original editor tab.

Reset asks for confirmation and writes the original layout to the editor key only.
It can be undone within that editor session; save again to keep the undone version.
The editor warns before leaving with unsaved changes. History holds the latest 100 actions.

## Developer boundary

The feature requires a Vite development build. Set `VITE_MAP_EDITOR=false` to disable it there too.
Production builds ignore `mapEditor` and `mapPreview` URL flags.

Editor storage keys:

- `skl-map-editor.farm-draft.v1`
- `skl-map-editor.farm-preview.v1`

Gameplay saves keep their existing keys. All SaveSystem entry points deny sandbox
slot access; its automatic save call returns no result without writing. A sandbox's protection
stays active even if its URL flags are removed without reloading.

Drafts carry the base farm fingerprint, stable editor IDs and sparse grass/dirt changes.
A changed base map requires an explicit draft migration; incompatible layouts are never guessed.
Normal game map consumers do not read editor storage.

## September 13 approved starting layout

Reset now uses Jeff’s approved layout, with the shop at tile78,18 and the north trail preserved.
Known exports from the previous baseline convert explicitly, keeping their complete terrain and object positions.
Reading an old browser draft does not rewrite its stored bytes. Unknown fingerprints still report an error.
Adventure saves migrate separately through save version10; see `SHOP_FAMILY.md` for backup and preservation rules.
