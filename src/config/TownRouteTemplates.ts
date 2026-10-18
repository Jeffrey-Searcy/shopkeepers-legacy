/**
 * Personality-led starter content for the development route workshop.
 * The private-activity tuple also drives transient room behavior so the workshop and bed effect
 * agree on which one day each week is reserved for daydreaming.
 */
import type { ResidentId } from './ResidentRelationships';
import type { TownBuildingId } from './TownBuildings';
import { TOWN_RESIDENTS } from './TownResidents';
import { TOWN_SOCIAL_SPOT_IDS, type TownSocialSpotId } from './TownSchedules';

/** Explicit development-editor label that the ordinary world presents only as "do not disturb." */
export const DAYDREAM_ROUTE_LABEL = 'Daydreaming';

/** Stable outdoor or building destination understood by the route-draft builder. */
export type TownRouteDestinationId = TownBuildingId | 'home' | 'fishing-bank' | TownSocialSpotId;

/** One named visit with authored motivation rather than a generic wandering command. */
export interface TownRouteVisitTemplate {
  destination: TownRouteDestinationId;
  label: string;
  reason: string;
}

/** Compact weekly personality content expanded into seven complete route days. */
export interface TownRouteProfile {
  residentId: ResidentId;
  privateActivities: readonly [string, string, string, string, string, string, string];
  meals: readonly [TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate];
  errands: readonly [TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate,
    TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate];
  leisure: readonly [TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate,
    TownRouteVisitTemplate, TownRouteVisitTemplate, TownRouteVisitTemplate];
}

/** Keep the authored catalog readable while retaining explicit labels and reasons. */
function visit(destination: TownRouteDestinationId, label: string, reason: string): TownRouteVisitTemplate {
  return { destination, label, reason };
}

/** Twelve distinct weeks derived from the residents' established jobs, voices, and interests. */
export const TOWN_ROUTE_PROFILES: readonly TownRouteProfile[] = [
  { residentId: 'nyra',
    privateActivities: ['Studying a curious trinket', 'Recording a strange dream', DAYDREAM_ROUTE_LABEL, 'Reading an old spellbook',
      'Mapping the night sky', 'Writing an unanswered letter', 'Brewing a quiet pot of tea'],
    meals: [visit('home', 'Lunch at home', 'Eats quietly while reviewing her notes.'), visit('bar', 'Lunch at The Wayfarer', 'Listens for rumors over a warm meal.'),
      visit('market', 'Market picnic lunch', 'Picks up fruit and eats near the market.')],
    errands: [visit('alchemy', 'Comparing unusual reagents', 'Trades observations with Cael about a stubborn reagent.'),
      visit('museum', 'Researching an old symbol', 'Checks Elowen’s archives for a symbol from her collection.'),
      visit('market', 'Buying candles and tea', 'Restocks ordinary supplies before the mysterious ones run out.'),
      visit('clinic', 'Gathering garden herbs', 'Asks Sylvie which herbs are safe around enchanted objects.'),
      visit('tailor', 'Collecting a repaired charm pouch', 'Needs a strong seam for a pouch that keeps wriggling.'),
      visit('guild', 'Following up on a rumor', 'Checks whether a strange trail report needs attention.'),
      visit('fishing', 'Looking for river glass', 'Asks Kit about colored glass found near the water.')],
    leisure: [visit('east-fountain', 'Watching reflections in the river', 'Studies the water when the light makes it look enchanted.'),
      visit('bar', 'A late drink and a story', 'Lets Julian tell one story before asking difficult questions.'),
      visit('west-garden', 'Reading in the west garden', 'Enjoys a quiet chapter away from ticking objects.'),
      visit('fishing-bank', 'Collecting moonlit river stones', 'Looks for smooth stones with interesting colors.'),
      visit('magic', 'Testing a harmless charm', 'Uses the quiet afternoon to test one careful charm.'),
      visit('east-commons', 'People-watching at the commons', 'Watches town life without admitting she is curious.'),
      visit('garden-path', 'Taking the long garden walk', 'Clears her head before returning home.') ] },
  { residentId: 'tessa',
    privateActivities: [DAYDREAM_ROUTE_LABEL, 'Balancing the household ledger', 'Mending her favorite apron', 'Reading a seed catalog',
      'Testing a bread recipe', 'Writing tomorrow’s market list', 'Pressing flowers into a notebook'],
    meals: [visit('market', 'Lunch behind the market', 'Eats between deliveries without leaving the shop unattended for long.'),
      visit('bar', 'Lunch at The Wayfarer', 'Takes a proper break and catches up with Julian.'), visit('home', 'Lunch in her kitchen', 'Makes soup from the morning produce.')],
    errands: [visit('ranch', 'Collecting eggs and milk', 'Checks the week’s fresh dairy order with Rowan.'),
      visit('carpenter', 'Ordering another display shelf', 'Bram is once again asked to find room for one more shelf.'),
      visit('clinic', 'Delivering fruit to the clinic', 'Drops off easy meals for patients and staff.'),
      visit('fishing', 'Checking the fresh catch', 'Plans the market board around Kit’s morning catch.'),
      visit('tailor', 'Picking up new flour sacks', 'Collects repaired cloth sacks from Dorian.'),
      visit('forge', 'Replacing the shop bell', 'Asks Rhea to repair the market’s tired brass bell.'),
      visit('museum', 'Posting the town notice', 'Updates Elowen on new goods and community requests.')],
    leisure: [visit('market-green', 'Chatting on the market green', 'Stays where neighbors can find her after work.'),
      visit('west-garden', 'Walking through the west garden', 'Looks for new flowers to place by the counter.'),
      visit('bar', 'Sharing a drink after closing', 'Lets someone else serve her for once.'),
      visit('east-fountain', 'Resting on the riverbank', 'Takes a quiet break with her shoes off the busy road.'),
      visit('fishing-bank', 'Watching the evening anglers', 'Enjoys the river without trying to sell anyone anything.'),
      visit('garden-path', 'Taking a basket walk', 'Walks slowly and gathers ideas for tomorrow’s display.'),
      visit('east-commons', 'Joining the commons crowd', 'Spends her free afternoon among familiar faces.') ] },
  { residentId: 'rhea',
    privateActivities: ['Sketching a new iron bird', 'Oiling her hand tools', 'Repairing worn work gloves', 'Writing measurements in her design book',
      'Polishing her old boots', DAYDREAM_ROUTE_LABEL, 'Carving a tiny wooden prototype'],
    meals: [visit('forge', 'Lunch beside the cold anvil', 'Eats only after the forge is safely banked.'), visit('bar', 'A heavy lunch at The Wayfarer', 'Refuels after a loud morning at the forge.'),
      visit('market', 'Market-stall lunch', 'Buys something warm and eats outside.')],
    errands: [visit('carpenter', 'Trading fittings with Bram', 'Compares hinges and swaps spare hardware.'),
      visit('guild', 'Inspecting adventuring gear', 'Checks damaged buckles before the next expedition.'),
      visit('ranch', 'Repairing a stubborn gate', 'Tests whether the newest latch can outsmart Rowan’s goat.'),
      visit('market', 'Delivering finished tools', 'Drops off practical tools for the market shelves.'),
      visit('fishing', 'Shaping replacement fishhooks', 'Checks the size and bend Kit needs.'),
      visit('tailor', 'Fitting a new work jacket', 'Lets Dorian adjust a jacket that must survive sparks.'),
      visit('alchemy', 'Ordering heatproof salts', 'Asks Cael for salts used in careful metalwork.')],
    leisure: [visit('bar', 'Cooling down at The Wayfarer', 'Has one cold drink after the forge closes.'),
      visit('east-commons', 'Strength drills at the commons', 'Exercises where there is room to swing safely.'),
      visit('fishing-bank', 'Quiet fishing after work', 'Enjoys an activity that does not require a hammer.'),
      visit('west-garden', 'Sketching garden railings', 'Turns flower shapes into ideas for ironwork.'),
      visit('east-fountain', 'Studying the east bridge ironwork', 'Inspects old joints while pretending to relax.'),
      visit('museum', 'Looking at historic tools', 'Checks whether the old smiths solved a familiar problem.'),
      visit('garden-path', 'Walking off the forge heat', 'Takes the shaded path before heading home.') ] },
  { residentId: 'sylvie',
    privateActivities: ['Drying bundles of mint', 'Updating patient notes', 'Pressing flowers for reference', DAYDREAM_ROUTE_LABEL,
      'Practicing a quiet stretch', 'Blending a bedtime tea', 'Writing in her garden journal'],
    meals: [visit('clinic', 'Garden-room lunch', 'Eats beside the herbs after the morning appointments.'), visit('bar', 'Soup at The Wayfarer', 'Chooses a warm meal and checks on the town gossip gently.'),
      visit('market', 'Fresh market lunch', 'Builds lunch from whatever Tessa says is best today.')],
    errands: [visit('ranch', 'Checking on a recovering animal', 'Visits one of Rowan’s animals after morning rounds.'),
      visit('alchemy', 'Comparing medicinal tinctures', 'Reviews Cael’s labels before accepting a new tincture.'),
      visit('market', 'Restocking clean bandages', 'Picks up cloth and easy food for the clinic.'),
      visit('museum', 'Reading an old herb guide', 'Checks a historical treatment against her garden notes.'),
      visit('magic', 'Examining an enchanted plant', 'Helps Nyra decide whether a restless plant is sick or magical.'),
      visit('tailor', 'Collecting repaired linens', 'Picks up cleanly mended clinic linens.'),
      visit('fishing', 'Buying fresh fish for broth', 'Chooses a mild catch for restorative meals.')],
    leisure: [visit('west-garden', 'Tending the west garden', 'Waters plants that everyone enjoys but nobody owns.'),
      visit('garden-path', 'Taking a restorative walk', 'Practices following her own advice about rest.'),
      visit('east-fountain', 'Reading on the riverbank', 'Enjoys the sound of water after a busy clinic.'),
      visit('bar', 'Tea with the evening crowd', 'Stops for company without ordering anything stronger than tea.'),
      visit('fishing-bank', 'Gathering riverside mint', 'Looks for healthy wild herbs near the bank.'),
      visit('east-commons', 'Leading a gentle stretch', 'Invites whoever is nearby to loosen tired shoulders.'),
      visit('market-green', 'Sharing garden cuttings', 'Trades healthy cuttings with interested neighbors.') ] },
  { residentId: 'elowen',
    privateActivities: ['Translating a damaged fragment', DAYDREAM_ROUTE_LABEL, 'Cataloging old letters', 'Sketching an unfamiliar artifact',
      'Writing an argumentative footnote', 'Sorting research cards', 'Reading one chapter too many'],
    meals: [visit('museum', 'Lunch among the archives', 'Eats carefully beside a stack of unfinished notes.'), visit('bar', 'Lunch and local stories', 'Collects oral history while Julian serves lunch.'),
      visit('market', 'Lunch on the market steps', 'Takes a book and a simple meal outside.')],
    errands: [visit('magic', 'Identifying an old charm', 'Compares Nyra’s collection with a museum record.'),
      visit('guild', 'Copying an expedition report', 'Preserves details before the next party changes the story.'),
      visit('market', 'Buying archival paper', 'Looks for clean paper and complains kindly about the price.'),
      visit('fishing', 'Recording a river tale', 'Asks Kit for the accurate version before writing the better one.'),
      visit('tailor', 'Studying historic embroidery', 'Examines Dorian’s stitches for an exhibit note.'),
      visit('alchemy', 'Dating an old glass vial', 'Compares the museum piece with Cael’s equipment.'),
      visit('forge', 'Inspecting a maker’s mark', 'Asks Rhea how a faint stamp was made.')],
    leisure: [visit('east-fountain', 'Reading by the river', 'Reads where the light remains good late in the day.'),
      visit('bar', 'Listening for town history', 'Lets stories arrive without taking notes for the first ten minutes.'),
      visit('west-garden', 'Sketching old stonework', 'Studies the garden walls as carefully as any artifact.'),
      visit('fishing-bank', 'Collecting smooth pottery shards', 'Looks for harmless pieces washed near the bank.'),
      visit('market-green', 'Hosting an open history talk', 'Answers questions from anyone curious enough to stop.'),
      visit('garden-path', 'Walking without a notebook', 'Attempts one walk without turning it into research.'),
      visit('east-commons', 'Playing a quiet board game', 'Joins a slow game that leaves time for conversation.') ] },
  { residentId: 'seren',
    privateActivities: ['Drawing tomorrow’s patrol map', 'Cleaning and checking her gear', 'Writing a concise incident report', 'Meditating before the day begins',
      'Sharpening a trusted blade', 'Reviewing the guild ledger', DAYDREAM_ROUTE_LABEL],
    meals: [visit('guild', 'Lunch at the guild table', 'Keeps an eye on the door while eating.'), visit('bar', 'Lunch near the tavern door', 'Chooses the seat with the clearest view of the room.'),
      visit('market', 'Quick market lunch', 'Eats during a supply round rather than skipping lunch.')],
    errands: [visit('forge', 'Checking repaired guard gear', 'Tests Rhea’s repairs before signing them back in.'),
      visit('clinic', 'Restocking the first-aid satchel', 'Asks Sylvie what the patrol kit is missing.'),
      visit('market', 'Reviewing emergency supplies', 'Checks that lantern oil and dry food remain available.'),
      visit('bar', 'Quietly checking the evening room', 'Visits Julian before the crowd grows loud.'),
      visit('fishing', 'Walking the riverside patrol', 'Checks the southern bank and speaks with Kit.'),
      visit('carpenter', 'Inspecting bridge barricades', 'Reviews Bram’s stored timber and warning signs.'),
      visit('ranch', 'Checking the east road fence', 'Makes sure the ranch edge remains safe after storms.')],
    leisure: [visit('east-commons', 'Practicing forms at the commons', 'Keeps her movements sharp in an open space.'),
      visit('east-fountain', 'Taking tea by the river', 'Allows herself one quiet cup in public.'),
      visit('bar', 'One drink after patrol', 'Relaxes only after every route is accounted for.'),
      visit('garden-path', 'Walking the garden perimeter', 'Takes the scenic path while still noticing every exit.'),
      visit('fishing-bank', 'Watching the river at dusk', 'Enjoys the water while keeping the south road in view.'),
      visit('museum', 'Reading old town maps', 'Studies how the town changed and where it may change again.'),
      visit('market-green', 'Joining the public notice hour', 'Makes herself available for practical concerns.') ] },
  { residentId: 'rowan',
    privateActivities: ['Mending a worn leather halter', 'Updating the animal-care journal', 'Carving a small shepherd’s whistle', 'Washing mud from his boots',
      DAYDREAM_ROUTE_LABEL, 'Repairing a braided lead rope', 'Taking a well-earned afternoon nap'],
    meals: [visit('ranch', 'Lunch near the feed room', 'Eats after every animal has been checked.'), visit('bar', 'A proper ranch lunch', 'Orders enough food to make up for a forgotten breakfast.'),
      visit('market', 'Market lunch with fresh bread', 'Trades produce and stays for something warm.')],
    errands: [visit('market', 'Delivering eggs and milk', 'Brings the freshest ranch goods to Tessa.'),
      visit('carpenter', 'Discussing another gate latch', 'Explains exactly how the goat defeated the last design.'),
      visit('clinic', 'Picking up animal salve', 'Collects a gentle salve from Sylvie.'),
      visit('forge', 'Collecting new horseshoe nails', 'Checks Rhea’s newest batch for the right size.'),
      visit('tailor', 'Delivering cleaned wool', 'Brings Dorian a bundle ready for spinning.'),
      visit('fishing', 'Trading eggs for smoked fish', 'Swaps ranch goods with Kit for supper.'),
      visit('guild', 'Reporting a broken east fence', 'Makes sure travelers know where the road narrows.')],
    leisure: [visit('west-garden', 'Studying the community flowers', 'Looks for hardy flowers that might survive near goats.'),
      visit('fishing-bank', 'Fishing with his sleeves rolled up', 'Enjoys a patient hour away from the ranch.'),
      visit('bar', 'Joining the early evening crowd', 'Tells Julian what the animals did this week.'),
      visit('east-commons', 'Throwing a ball for the farm dog', 'Uses the open grass before heading home.'),
      visit('garden-path', 'Taking the shaded walk home', 'Slows down after a long day outside.'),
      visit('market-green', 'Trading growing tips', 'Shares practical advice with anyone planting feed crops.'),
      visit('east-fountain', 'Resting beside the river', 'Sits somewhere no animal needs him for a few minutes.') ] },
  { residentId: 'julian',
    privateActivities: ['Planning tomorrow’s stew', 'Counting bottles against the ledger', DAYDREAM_ROUTE_LABEL, 'Polishing the best glassware',
      'Practicing a new card trick', 'Repairing a loose recipe book', 'Taking a late quiet nap'],
    meals: [visit('bar', 'Staff lunch at The Wayfarer', 'Tests the day’s meal before serving it.'), visit('market', 'Market supplier lunch', 'Eats while choosing tomorrow’s produce.'),
      visit('home', 'Quiet lunch upstairs', 'Takes a rare meal away from the public room.')],
    errands: [visit('market', 'Buying produce for the kitchen', 'Chooses vegetables sturdy enough for a long simmer.'),
      visit('fishing', 'Choosing the evening catch', 'Lets Kit explain why today’s fish is historic.'),
      visit('ranch', 'Collecting eggs and cream', 'Picks up ingredients for breakfast and desserts.'),
      visit('carpenter', 'Checking a repaired barstool', 'Makes sure the stool will survive another story night.'),
      visit('museum', 'Borrowing a book of old recipes', 'Asks Elowen whether recipes count as history.'),
      visit('guild', 'Delivering a covered supper pot', 'Brings the late watch something hot.'),
      visit('tailor', 'Collecting clean table linens', 'Picks up the week’s repaired cloths from Dorian.')],
    leisure: [visit('market-green', 'Trading stories on the green', 'Collects one new story and improves two old ones.'),
      visit('east-fountain', 'Practicing cards by the river', 'Tests a card trick on whoever pauses nearby.'),
      visit('fishing-bank', 'Trying to catch tomorrow’s special', 'Lets Kit laugh at his knot work.'),
      visit('west-garden', 'Taking a quiet walk after service', 'Enjoys a place where nobody can ask for another round.'),
      visit('bar', 'Hosting the evening story table', 'Sits with guests after the rush slows.'),
      visit('east-commons', 'Joining a public dice game', 'Plays for stories rather than coins.'),
      visit('garden-path', 'Walking before the late shift', 'Clears his head before reopening the room.') ] },
  { residentId: 'bram',
    privateActivities: [DAYDREAM_ROUTE_LABEL, 'Whittling a smooth wooden bird', 'Oiling his smallest hand tools', 'Mending a heavy work apron',
      'Reading an old joinery manual', 'Testing a puzzle-box joint', 'Resting with a cup of tea'],
    meals: [visit('carpenter', 'Workshop lunch', 'Eats after sweeping the dangerous shavings aside.'), visit('bar', 'Lunch at the sturdy corner table', 'Trusts Julian’s food and his own repaired table.'),
      visit('market', 'Lunch on the market steps', 'Buys bread and watches how people use the benches.')],
    errands: [visit('ranch', 'Measuring the troublesome gate', 'Studies the latch damage before building version three.'),
      visit('forge', 'Collecting hinges from Rhea', 'Picks up hardware made for the week’s commissions.'),
      visit('market', 'Delivering a finished shelf', 'Installs another shelf without asking where Tessa found room.'),
      visit('bar', 'Tightening chairs at The Wayfarer', 'Quietly checks every chair before the evening crowd.'),
      visit('tailor', 'Choosing canvas for tool rolls', 'Asks Dorian for fabric that can handle sharp edges.'),
      visit('guild', 'Inspecting the quest-board frame', 'Makes sure the heavy board remains square and safe.'),
      visit('fishing', 'Repairing a tackle rack', 'Measures Kit’s wall before cutting replacement pegs.')],
    leisure: [visit('west-garden', 'Sketching a garden bench', 'Studies where people naturally choose to sit.'),
      visit('fishing-bank', 'Whittling beside the river', 'Lets the current carry away the workshop noise.'),
      visit('bar', 'Having one slow drink', 'Sits in a chair he knows will not complain.'),
      visit('east-commons', 'Playing a patient board game', 'Enjoys a contest that rewards planning.'),
      visit('market-green', 'Checking the public benches', 'Pretends maintenance is leisure and stays to talk.'),
      visit('museum', 'Studying old furniture joints', 'Examines craftsmanship preserved in the collection.'),
      visit('garden-path', 'Taking the long route home', 'Walks until his hands stop thinking about measurements.') ] },
  { residentId: 'kit',
    privateActivities: ['Tying a box of bright flies', 'Mending a torn casting net', 'Drawing tomorrow’s tide map', 'Carving a tiny wooden lure',
      'Drying boots beside the stove', DAYDREAM_ROUTE_LABEL, 'Untangling line in complete silence'],
    meals: [visit('fishing', 'Lunch at the tackle counter', 'Eats while watching the weather over the river.'), visit('bar', 'Fish stew at The Wayfarer', 'Checks whether Julian tells the catch story correctly.'),
      visit('market', 'Market lunch after deliveries', 'Stays for bread after dropping off the catch.')],
    errands: [visit('market', 'Delivering the morning catch', 'Brings Tessa the fish that survived the story.'),
      visit('bar', 'Dropping off fish for supper', 'Delivers the best cooking fish to Julian.'),
      visit('carpenter', 'Collecting a repaired tackle rack', 'Checks whether Bram added enough pegs this time.'),
      visit('forge', 'Picking up new hooks', 'Tests Rhea’s hooks for strength and bragging rights.'),
      visit('ranch', 'Trading fish for eggs', 'Swaps part of the catch with Rowan.'),
      visit('clinic', 'Bringing fish for broth', 'Leaves a mild fresh catch with Sylvie.'),
      visit('museum', 'Correcting the river exhibit', 'Offers Elowen several facts and one questionable measurement.')],
    leisure: [visit('fishing-bank', 'Fishing the south bank', 'Spends a peaceful hour trying not to exaggerate.'),
      visit('east-fountain', 'Testing a tiny practice lure', 'Claims the calm bank is useful for controlled experiments.'),
      visit('bar', 'Retelling the day’s catch', 'Improves the story for the evening crowd.'),
      visit('garden-path', 'Looking for bait after rain', 'Checks damp soil near the garden path.'),
      visit('east-commons', 'Teaching a casting knot', 'Shows anyone interested how to keep a hook attached.'),
      visit('west-garden', 'Napping under the garden trees', 'Rests where the breeze feels like the river.'),
      visit('market-green', 'Trading river forecasts', 'Shares weather opinions with the morning crowd.') ] },
  { residentId: 'cael',
    privateActivities: ['Relabeling a row of vials', 'Recording an unexpected result', 'Pressing herbs between clean pages', DAYDREAM_ROUTE_LABEL,
      'Calculating a safer mixture', 'Reading a disputed formula', 'Writing larger warning tags'],
    meals: [visit('alchemy', 'Careful laboratory lunch', 'Eats only after every active flame is out.'), visit('bar', 'Lunch away from the glassware', 'Enjoys food that cannot become an experiment.'),
      visit('market', 'Ingredient-market lunch', 'Eats while checking the quality of common herbs.')],
    errands: [visit('magic', 'Comparing magical residue', 'Asks Nyra whether a glow is mystical or merely inconvenient.'),
      visit('clinic', 'Delivering a tested tincture', 'Brings Sylvie a properly labeled batch.'),
      visit('market', 'Buying salt and clean jars', 'Restocks ordinary materials with exact quantities.'),
      visit('museum', 'Researching antique glass', 'Compares an old vial with modern laboratory methods.'),
      visit('fishing', 'Collecting river algae', 'Asks Kit where the harmless green growth gathers.'),
      visit('forge', 'Ordering a heatproof vessel', 'Gives Rhea measurements that leave no room for surprise.'),
      visit('tailor', 'Collecting filtered cloth', 'Picks up tightly woven cloth for careful straining.')],
    leisure: [visit('east-fountain', 'Observing mineral deposits', 'Calls it leisure because he brought only one notebook.'),
      visit('west-garden', 'Gathering fallen petals', 'Collects only what the garden has already dropped.'),
      visit('bar', 'Testing a nonexperimental drink', 'Orders something Julian promises is ordinary.'),
      visit('fishing-bank', 'Watching the river chemistry', 'Studies color and current without taking a sample.'),
      visit('museum', 'Reading outside his discipline', 'Attempts to enjoy a history book without correcting it.'),
      visit('garden-path', 'Taking a measured evening walk', 'Follows the same calming route at an intentionally slower pace.'),
      visit('east-commons', 'Playing a logic game', 'Looks for company willing to argue carefully.') ] },
  { residentId: 'dorian',
    privateActivities: ['Sketching a daring new coat', DAYDREAM_ROUTE_LABEL, 'Mending his own cuff at last', 'Testing dyes on scrap cloth',
      'Practicing a tiny embroidery pattern', 'Writing notes on town fashion', 'Pinning tomorrow’s paper patterns'],
    meals: [visit('tailor', 'Lunch at the cutting table', 'Clears every pin before setting down his plate.'), visit('bar', 'A fashionable lunch break', 'Enjoys the room while noticing every sleeve.'),
      visit('market', 'Market lunch and color study', 'Eats outside and watches the town palette pass by.')],
    errands: [visit('market', 'Buying buttons and thread', 'Checks Tessa’s newest notions before ordering elsewhere.'),
      visit('ranch', 'Selecting clean wool', 'Chooses Rowan’s softest prepared bundle.'),
      visit('forge', 'Collecting polished buckles', 'Inspects Rhea’s metalwork for smooth edges.'),
      visit('magic', 'Discussing colorfast enchanted dye', 'Asks Nyra why one blue refuses to remain blue.'),
      visit('museum', 'Studying historic clothing', 'Examines old seams without touching the display.'),
      visit('clinic', 'Delivering repaired linens', 'Returns neatly mended cloth to Sylvie.'),
      visit('bar', 'Measuring new table linens', 'Plans replacements before the evening rush.')],
    leisure: [visit('market-green', 'Sketching town outfits', 'Draws silhouettes without writing anyone’s name.'),
      visit('west-garden', 'Studying natural color pairs', 'Collects color ideas from leaves and flowers.'),
      visit('bar', 'Showing off a finished coat', 'Enjoys an audience after a successful fitting.'),
      visit('east-fountain', 'Watching fabric move in the breeze', 'Studies drape where the open air can catch it.'),
      visit('fishing-bank', 'Collecting washed-up ribbon colors', 'Looks for river colors rather than usable cloth.'),
      visit('east-commons', 'Helping with quick clothing repairs', 'Fixes loose hems while talking with neighbors.'),
      visit('garden-path', 'Taking an inspiration walk', 'Returns home with too many ideas and muddy shoes.') ] },
];

/** Fail before route generation if any resident lacks a complete or valid personality week. */
export function validateTownRouteProfiles(): void {
  const expected = TOWN_RESIDENTS.map(resident => resident.id);
  if (TOWN_ROUTE_PROFILES.length !== expected.length || TOWN_ROUTE_PROFILES.some((profile, index) => profile.residentId !== expected[index])) {
    throw new Error('Town route templates must cover all residents in authored order.');
  }
  const destinations = new Set<TownRouteDestinationId>(['home', 'fishing-bank', ...TOWN_SOCIAL_SPOT_IDS, 'market', 'forge', 'museum', 'magic', 'clinic', 'guild', 'ranch', 'bar',
    'carpenter', 'fishing', 'alchemy', 'tailor']);
  for (const profile of TOWN_ROUTE_PROFILES) {
    if (profile.privateActivities.length !== 7 || new Set(profile.privateActivities).size !== 7
      || profile.privateActivities.filter(activity => activity === DAYDREAM_ROUTE_LABEL).length !== 1
      || profile.meals.length !== 3 || profile.errands.length !== 7 || profile.leisure.length !== 7) {
      throw new Error(`Town route templates: ${profile.residentId} needs a complete varied week.`);
    }
    for (const activity of [...profile.meals, ...profile.errands, ...profile.leisure]) {
      if (!destinations.has(activity.destination) || activity.label !== activity.label.trim() || activity.label.length === 0 || activity.label.length > 48
        || activity.reason !== activity.reason.trim() || activity.reason.length === 0 || activity.reason.length > 180) {
        throw new Error(`Town route templates: ${profile.residentId} has an invalid visit.`);
      }
    }
  }
}

/** Return one stable personality profile without allowing callers to invent residents. */
export function townRouteProfile(residentId: ResidentId): TownRouteProfile {
  validateTownRouteProfiles();
  const profile = TOWN_ROUTE_PROFILES.find(candidate => candidate.residentId === residentId);
  if (!profile) throw new Error(`Town route templates: missing resident ${residentId}.`);
  return profile;
}
