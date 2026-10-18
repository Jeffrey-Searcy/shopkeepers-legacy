# Town buildings and residents

The twelve existing Town clearings now hold permanent buildings. Walk north through a front
door to enter; E is not required. Walk south through the interior exit to return to Town.
Each business has its own room and resident. Face the resident and press E to talk.
Most buildings admit visitors from 8 AM to 8 PM. The Wayfarer admits visitors until midnight.
The owner and established partners may enter after hours. A closed door shows one notice and does not
pull the player through. Future NPC routes use the same rule and skip a stop they cannot enter.

| Building | Resident |
|---|---|
| General Market | Tessa |
| Enchanter’s Cottage | Nyra |
| The Wayfarer | Julian |
| Carpenter’s Workshop | Bram |
| Museum & Library | Elowen |
| Watch & Adventurers’ Lodge | Seren |
| Garden Clinic | Sylvie |
| Meadow Ranch | Rowan |
| Fishing & Tackle | Kit |
| Thread & Dye | Dorian |
| Alchemy House | Cael |
| Ember Forge | Rhea |

## Appearance and ownership

Named residents keep fixed identities.
Original residents use separate outfit textures, so they cannot repaint the player or one another.

Public-room fixtures are town property. The player cannot collect, move, or place furniture
inside these rooms. The player's own shop, bedroom, inventory and tavern service remain unchanged.
Residents follow weekday and weekend paths between their building and changing Town meetings. They stop
walking while speaking to the player, but game time continues. Every resident heads home by midnight.
Each room now connects to its resident's east home. The bedroom stays visible but blocks the player below
two hearts. Commercial actions require the exact customer-side tile. Non-shops require the exact side of
their shrine, exhibit, treatment cot, quest board, anvil, or brew table.

## Current room services

- Market and ranch sell seeds. The bar sells stew and ale. The carpenter sells placeable furniture.
- The forge buys stone bundles. Fishing buys fish. The museum funds cave-sample research.
- The clinic restores health and stamina. Alchemy turns slime gel into immediate recovery.
- The sanctuary gives a reading. The tailor opens the existing character editor.
- The guild board offers three starter contracts tied to the future northern portal dungeons.

These are compact first services, not full tool upgrades, collections, staff systems, or dungeon progression.
The town bar does not run the player's tavern simulation.

## Existing saves and map editor

Save version12 added these buildings. Save version13 adds relationships. Older saves validate against their original Town map
before migration. Only Town records that conflict with new architecture move; their contents
and identities remain intact. Saving an older slot preserves its exact original bytes under
`shopkeeperslegacy.save.backup.pre-town-buildings-v12.slot.N` first.

The map editor retains the same building-free planning map and export fingerprint. It shows
the clearings used to position future Town architecture, not movable copies of the new facades.
Town routes remain upper-left Farm, lower-left Forest, north outdoor mine entrance, south Beach.

## Art registration

`TownBuildings.ts` owns authored native geometry and door offsets. `town-building-art.json`
registers source alpha-content crops only; image dimensions never supply collision geometry.
The twelve original generated PNGs retain their alpha. Phaser crops their transparent margins
and draws them at native scale. Separately sorted landing, doorway and lintel layers supply depth.
Production prompts live in `docs/art/town-buildings-v1/PRODUCTION-PROMPTS.md`.

## Quick playtest

1. Save first, then travel to Town from the upper-left Farm route.
2. Walk into several buildings without pressing E. Check side-to-side porch movement too.
3. Stand at each room's visible service point and face it. Side approaches must not open its menu.
4. Talk to each resident.
5. Raise one resident to two hearts and confirm their visible bedroom opens immediately.
6. Save inside a public room, return to the title, and Continue. Confirm the same room resumes.
7. Return to your own shop and confirm its furniture and tavern service stay as you left them.
