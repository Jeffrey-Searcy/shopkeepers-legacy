# Farm, inn and tavern playtest

The shop starts empty. Craft and place your own stations and furniture.

## Placement

- Rugs, tables, chairs, bars, registers and stoves go indoors.
- Chests and workbenches work indoors or outdoors.
- Put furniture in your toolbar and select its slot. Aim with the mouse, press R to rotate, and click or press Space to place one.
- Keep clicking to place more from the same stack. Press E to cancel, or select another slot.
- Older outdoor furniture remains where it was. Once picked up, it follows the new rules.

## Inn

1. Place a register. Keep its front, its back, and the route to the stairs clear.
2. Face the register and press M, or click the nearby **Manage shop** prompt. Restore the shop, then open the inn.
3. Guests wait in front. Stand behind the register, face down, and press E to collect payment and check them in. No menu opens.
4. Each room costs 24 gold for one night. Three rooms are available.
5. Paid guests walk upstairs. The same guests return downstairs to linger and visit the tavern when it opens.
6. Rooms expire the next morning. Guests leave from their current position; they do not pay twice.

M still opens the management menu while a traveler waits. Closing the inn sends unpaid arrivals away. Paid guests keep their rooms. Upstairs remains guest-only.

## Tavern

1. Place a stove and either a bar or tables with chairs.
2. Rotate each chair toward a table's outside edge. Connected tables also work. Leave a clear approach.
3. Face the stove and press E. Prepare one batch, five batches, or the maximum your supplies allow.
4. Parsnips make four stew portions. Each supported fish makes five. Ale costs 8 gold of purchased malt and one wood fuel per four-drink batch.
5. Meals and drinks go into your inventory. Move a stack into your toolbar and select it. Your character visibly carries it.
6. Open the tavern through the register's management menu. Guests arrive at spaced intervals, pause around the room, then choose a chair or bar space.
7. Read the guest's thought cloud. Equip the matching stew or ale, face their chair, and press E or Space to hand over one item. At a bar, stand behind that guest's counter space.

Stew sells for 12 gold; ale sells for 8. Serving removes exactly one item from your bag and collects payment. Guests can order more than one round. Cooking refuses a batch if its output cannot fit; it leaves ingredients and gold untouched.

An empty bag does not close the tavern. Use the register menu to close it yourself. Waiting guests grow impatient, show anger, then leave. Their anger does not reduce future arrivals.

When you have none of a waiting guest's requested item, face them within serving reach. Press Q or click **We're out**. They leave politely; paid lodgers return upstairs. This does not take items or money. Menus block this action.

Guests who meet in a social spot take turns speaking and react while listening. Nearby pairs use different topic groups. The current pool contains twelve short exchanges. Order clouds show the requested item; angry guests blush red, stamp, and release steam.

During service, the task reminder stays hidden so it does not cover conversations. Press J to open or close the task list.

Closing sends unserved diners away. Guests who already paid for food finish it first. Paid lodgers return upstairs and keep their rooms.

The tavern starts with up to three outside diners. The upgrade permits five when destinations and visitor appearances are available.

## Drunk guests and the broom

1. Craft a broom at your workbench with 4 wood and 8 fiber.
2. A guest who drinks three ales starts to sway, blush, and hiccup. Drinking alone does not force them out.
3. A drunk guest who meets an angry waiting guest can start a cartoon dust-cloud fight. Walls and counters block contact.
4. Select your broom, face the guest you want to remove, and press E or Space within two tiles. Only that guest leaves. The other guest stays and calms down.
5. Outside diners leave through the door; lodgers go upstairs and keep their paid rooms. An unattended fight ends after twenty seconds and both guests leave the floor.

The broom can eject a drunk guest or either participant in a fight. It does not eject other sober guests. A lodger's next downstairs visit starts sober, without changing past sales or room payment. Reduced motion keeps mood and fight signals visible without the animated sway or flashing glimpses.

## Trees and crops

- Cleared trees on the home farm stay gone. Farm rocks also stay gone. This pass does not change the mines.
- Mature oak trees drop an acorn when felled. Pine trees beside the forest trail drop a pine cone.
- Select an acorn or pine cone in your toolbar. Face a clear grass tile on your farm and press Space to plant it.
- A planted tree becomes small after two days and mature after two more. Its species and growth survive saving.
- Chop a mature tree for wood and one matching seed. Clear the stump separately; it does not give another seed.
- Trees cannot grow through crops, furniture, buildings or entrances. Wild trees outside the home farm keep their existing regrowth rules.
- Soil and watering now form connected patches. Parsnip, potato and melon use new growth-stage art. Crop seasons, watering and harvest rules remain in place.

## Separate services and saves

The register controls the inn and tavern separately. Close both and let guests finish leaving before decorating. Paid overnight guests keep the layout locked until checkout and departure.

Game time and guest movement pause in menus. Guest movement also pauses outside the shop. Inventory goods, active visits, room bookings, payments and planted trees survive save/load.

Older prepared stock moves into your bag when loaded. If a stack cannot fit, it goes into shared chest storage. A load notice explains this. The original saved bytes stay unchanged until you save again.

Old register layouts may block the new front/back approach. Loading then pauses new inn bookings and sends unpaid queue guests away. Paid rooms remain. Clear the register's front and back, then reopen.

Version 6 saves preserve an active counter visit. Versions 1–5 retain their existing, disclosed rebuilt-room migration: old service closes, but money, meals and sales remain.

Version 9 also saves active fights. Version 8 loads with no active fights and preserves its guests and bookings. Saving again writes the new format; loading alone does not rewrite the original save.

## Deliberate first-pass limits

Rooms have one-night stays and fixed prices. Stove brewing finishes immediately; dedicated brewing equipment and timed fermentation remain later work. Original visitors use six outfits. Visiting-customer conversations use twelve authored exchanges. Permanent residents now have a separate relationship system; see `docs/TOWN_BUILDINGS.md`. Mines are not part of this pass.
