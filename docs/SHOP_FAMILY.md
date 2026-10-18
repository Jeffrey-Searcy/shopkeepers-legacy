# Your farm and shop exteriors

The farm now starts from Jeff’s September 13 layout. The north trail remains a future connection, with no active exit. Trees and rocks remain harvestable resources, not permanent decoration.

## Existing saves

Load your adventure normally. The compatibility notice explains the farm move. Version 10 keeps the shop and bedroom interiors, inventory, storage and hospitality progress.

The one-time move removes outdoor placed furnishings and building placements, as approved. Cleared authored resources move with their original identities. Crops, soil, planted trees and pickups stay where possible; records blocked by the new map move to nearby free ground. Their contents and progress remain intact.

Loading and slot inspection do not rewrite stored save bytes. The first save after migration keeps an exact recovery copy under `shopkeeperslegacy.save.backup.pre-farm-v10.slot.N`, before writing version 10 to the existing slot key. A failed backup prevents the overwrite. Ordinary slot deletion does not delete this recovery copy. Ask for help before restoring it; loading an old copy applies the farm move again.

## Try the exteriors

Press Escape and click **Exterior** at the bottom. Click to cycle, or use Up/Down to select the row and Left/Right to browse. Enter also advances.

Choices: Original shop, Fantasy inn, Blacksmith, Magic shop, Farm shop, Church, Library, Tailor, Alchemist.

This is a browser-local cosmetic preview. It changes the existing farm facade immediately and stays selected after reload. It does not change your business, interior or door physics, and it does not place extra buildings. Choose Original shop to restore the accepted original art.

All eight images live in `public/assets/objects/shop-facade-*.png` and load through manifest keys. They use the same 160×160 native canvas. The original facade remains untouched; its porch planks, foreground posts and animated door remain shared.

## Art process

The built-in image generator edits the accepted reference, one call per variation. A second cutout pass produces genuine transparency. Native packing aligns the visible building bounds with the original and uses nearest-neighbor sampling. The inn passes an in-game style check before the other seven are generated.

Prompts and source names: `docs/art/shop-family-prompts.json`. Browser evidence: `planning_artifacts/farm-shop-family/`.
