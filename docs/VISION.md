# Shopkeeper's Legacy — Vision

This page says what the game is trying to feel like and what to build next. Read it before
picking up new work. Detailed plans live in `docs/plans/`; this page only sets direction.

## The feeling

You inherit Grandpa's run-down shop in Willowbrook. By day you farm, gather, cook and run the
tavern and inn. In the evening you share real conversations with townsfolk by the fire. At night
you retire upstairs, and in the morning you head north through the old gates to go adventuring.

The town feels **alive**. People remember you, they have opinions about each other, and things
happen whether you are watching or not.

## Three layers

Every good life-sim has all three. Each one feeds the others.

1. **The spine — main quest.** One big reason to keep going: restore Grandpa's shop, open the
   ancient gates north of the farm, and find out what Grandpa knew about them.
2. **The daily loop — the basics.** Farm, gather, craft, cook, fish, delve, sell, sleep. This is
   what your hands do every day, and it must be fun on its own.
3. **The living world — the dream.** Residents who remember you, gossip, become friends, fall in
   love, fight, form adventuring parties, and talk with you for real.

How they connect: the loop makes items → items go to the shop and to people → people remember
and react → reactions become letters, gossip and requests → those send you back into the loop
and toward the spine.

## How "smart NPCs" stay consistent

Think of a stage play. **The game is the stage manager; the AI is the actor.**

- The game owns the facts: hearts, bonds between residents, who is dating whom, what you gave
  someone yesterday, who is in jail. Simple rules change those facts over time.
- The local AI chat only gives residents a voice. It reads the facts and speaks in character.
  It never invents facts the game does not hold.

Big events (parties forming, marriages, feuds, crimes) are decided by rules and then voiced by
the AI, so they stay consistent and can be saved.

## Pull, not push

The opening must never feel like "you are dropped in and nothing happens." The world reaches out:

- **A greeting.** Someone meets you and gives one small, concrete first task. (Today: the
  mayor's welcome letter. Next: Mayor Hollis as a walking NPC who meets you on day 1.)
- **A heartbeat.** Something arrives on its own each morning. (Today: the farm mailbox and
  week-one letters in `src/config/Letters.ts`.)
- **A horizon.** Something visible but locked that you want. (Next: the north trail and the
  portal gates, announced by Seren's day-5 letter.)

## Milestone: one fun first week

Make days 1–7 fun from start to finish before stretching to a full season. Give each system
just enough depth to fill that week.

- [x] Mailbox with week-one letters that point at people and places (save v17)
- [x] Shop-door hint reads the real door from the farm map
- [x] Mayor Hollis meets you on the farm on day 1 and walks you to the shop
- [x] First-day task chain: restore shop → meet 3 neighbors → make a first sale (each step opens the next)
- [x] North trail opens on day 5: cliff gap at the end of the farm's north path, gate plaza beyond
- [x] First portal dungeon: one gate, 3 rooms-based floors + a boss, paid escape, small bag
- [x] Dungeon loot feeds the forge and alchemy house (upgrades you can see)
- [x] Short daily requests on Seren's board (2-day jobs, free to fail)
- [x] Residents remember gifts and mention each other in talk
- [x] Letters at friendship milestones (recipes and gifts at 3 and 7 hearts)
- [x] Enough content for a week: 6 fish, 8 recipes, 6 crops, daily forage (mushrooms, wild leeks, shells)
- [ ] Authored art for the mailbox (runtime-drawn in RuntimeArt for now; a PNG named farm-mailbox / farm-mailbox-flag in the manifest replaces it)

## Later

Full seasons and festivals, resident-to-resident events (parties, dating, feuds), more gates,
marriage, and the Item Shop business path.
