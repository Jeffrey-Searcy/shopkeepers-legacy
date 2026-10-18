# Living town interiors — Market proof

## Goal

Set the final quality pattern for town interiors with one complete General Market. The room must
look lived-in, support an actual seed-buying visit, show Tessa's private bedroom, and gate that
bedroom at two hearts. The other eleven services receive a purpose catalog, but their rooms do not
change until Jeff accepts the Market at game scale.

## Research translated into this game

Stardew combines business space and living space in one readable cutaway. It keeps private rooms
visible, uses relationship progress to unlock bedrooms, and gives public rooms secondary social
uses. Shop fixtures serve the room instead of acting as scattered decoration. Shopkeepers Legacy
will use those structural lessons with original artwork and its existing warm-fantasy identity.

## Solution ladder

- L1: enlarge or rearrange current props. Rejected because the room remains one undivided box.
- L2: add an authored room blueprint with zones, partitions, private thresholds, and service points.
  Chosen because all twelve rooms need these concepts without sharing identical layouts.
- L3: add a full in-game interior editor and universal economy framework. Deferred because it would
  delay the visual proof and create systems before their individual services are designed.

## Acceptance contract

1. The Market reads as four spaces: storefront, counter/stock, shared living area, and bedroom.
2. Furniture uses whole-tile footprints, grounded depth, and clear walking routes.
3. The bedroom remains visible but blocks the player below two hearts with Tessa.
4. At two hearts, the same threshold opens without a reload or save migration.
5. The counter lets the player buy existing crop seeds. Failed purchases change no gold or inventory.
6. A save from the old Market loads at the exact saved pixels, stays walkable, and changes no saved
   bytes. Signatures for the other eleven civic rooms remain identical. Exteriors and player-owned
   interiors do not change.
7. Typecheck, build, and focused Playwright checks pass with one worker. At 1280x720, inspected
   WebGL views cover the entrance, center, and private-room threshold with no HUD-blocked route.
   Final scores must reach 4.2/5 for design quality and originality, 4.0/5 for craft and
   functionality, and 4/5 for zoning, depth, and actor scale.
8. Jeff receives the Market for playtesting before this design expands to the other eleven rooms.

## Service catalog for later rooms

| Building | Main reason to visit |
|---|---|
| General Market | Buy seasonal seeds and daily supplies |
| Ember Forge | Upgrade tools and process ore |
| Museum & Library | Donate finds, study collections, read town lore |
| Enchanter's Cottage | Enchant equipment and inspect magical objects |
| Garden Clinic | Recover stamina and buy remedies |
| Watch & Adventurers' Lodge | Take bounties and prepare for dangerous trips |
| Meadow Ranch | Buy animals, feed, and animal-care supplies |
| The Wayfarer | Buy food, play social activities, and meet residents |
| Carpenter's Workshop | Order buildings, expansions, and furniture plans |
| Fishing & Tackle | Buy tackle, sell special catches, and take fishing jobs |
| Alchemy House | Brew potions and process herbs or monster materials |
| Thread & Dye | Change clothing colors and commission outfits |

## Guardrails

- Use original art. Reference games supply composition lessons only.
- Do not change town exteriors, Farm, the player's shop, saves, schedules, or relationship math.
- Do not add a universal shop framework during the one-room proof.
- Do not expand the Market design until Jeff sees and accepts it in play.
