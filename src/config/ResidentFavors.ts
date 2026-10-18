/**
 * ResidentFavors — the small requests a neighbor may ask of the keeper.
 *
 * TownLifeSystem posts at most one open favor at a time, at the start of a day. The resident then
 * shows a "!" marker. Talking to them with the items in the bag hands the items over, pays gold, and
 * raises friendship. A favor lasts FAVOR_DAYS days; missing one costs nothing ("free to fail").
 *
 * This file holds only WHAT each resident asks for and what they say. Timing and rewards live in
 * TownLifeSystem. Every request is validated at module load so a typo fails loudly.
 */
import type { ResidentId } from './ResidentRelationships';
import { ITEM_CATALOG } from './Items';

/** One favor a resident may ask for. */
export interface ResidentFavor {
  /** Stable id stored in saves, e.g. "rowan-fiber". */
  readonly id: string;
  readonly residentId: ResidentId;
  /** ITEM_CATALOG id the keeper must bring. */
  readonly item: string;
  readonly count: number;
  /** Gold paid on hand-in. */
  readonly gold: number;
  /** Spoken when the keeper first talks to them while the favor is open. */
  readonly ask: string;
  /** Spoken when the keeper hands the items over. */
  readonly thanks: string;
}

/** How many days a favor stays open, counting the day it is posted. */
export const FAVOR_DAYS = 2;
/** Friendship points for a finished favor (250 points = one heart). */
export const FAVOR_FRIENDSHIP = 60;

/** Every resident's request pool. Early-game items only, so a new keeper can help in week one. */
export const RESIDENT_FAVORS: readonly ResidentFavor[] = [
  { id: 'nyra-bat-wing', residentId: 'nyra', item: 'bat-wing', count: 1, gold: 70,
    ask: 'Could you bring me one bat wing? A charm I am making will not hold without it.',
    thanks: 'A bat wing! The charm will finally hold. Here, take this for your trouble.' },
  { id: 'nyra-mushroom', residentId: 'nyra', item: 'mushroom', count: 2, gold: 45,
    ask: 'I need two forest mushrooms for a tea that helps me read old runes. Any luck in the woods?',
    thanks: 'Perfect, still earthy. My rune tea thanks you, and so do I.' },
  { id: 'nyra-seashell', residentId: 'nyra', item: 'seashell', count: 2, gold: 40,
    ask: 'Two seashells would finish my wind chime. Could you look on the beach?',
    thanks: 'Listen to them clink. That chime will sing all summer. Thank you.' },
  { id: 'tessa-parsnip', residentId: 'tessa', item: 'parsnip', count: 3, gold: 90,
    ask: 'My parsnip crate is empty and people keep asking. Could you spare three?',
    thanks: 'Three lovely parsnips. My regulars will be so happy. Here is your share.' },
  { id: 'tessa-wild-leek', residentId: 'tessa', item: 'wild-leek', count: 2, gold: 45,
    ask: 'I promised a customer wild leeks for her soup. Could you find me two?',
    thanks: 'You saved my good name today. Thank you, truly.' },
  { id: 'tessa-wood', residentId: 'tessa', item: 'wood', count: 8, gold: 40,
    ask: 'My stall shelf cracked again. Could you bring eight pieces of wood?',
    thanks: 'Eight good pieces. Bram will have that shelf fixed by supper. Thank you.' },
  { id: 'rhea-stone', residentId: 'rhea', item: 'stone', count: 10, gold: 50,
    ask: 'The forge wall is crumbling. Bring me ten stone and I will pay fair.',
    thanks: 'Good, solid stone. The wall will hold. Here is your pay.' },
  { id: 'rhea-wood', residentId: 'rhea', item: 'wood', count: 10, gold: 50,
    ask: 'I burn through charcoal fast. Ten wood would keep the fire up this week.',
    thanks: 'That will keep the forge hot. You have my thanks, and some coin.' },
  { id: 'rhea-sardine', residentId: 'rhea', item: 'fish-sardine', count: 1, gold: 60,
    ask: 'I forgot my lunch again. One sardine would do. Do not tell anyone.',
    thanks: 'A sardine. Perfect. This stays between us, understood?' },
  { id: 'sylvie-wild-leek', residentId: 'sylvie', item: 'wild-leek', count: 2, gold: 45,
    ask: 'I need two wild leeks for a cold remedy. Someone in town has a cough.',
    thanks: 'Thank you. These will help someone sleep tonight.' },
  { id: 'sylvie-fiber', residentId: 'sylvie', item: 'fiber', count: 6, gold: 35,
    ask: 'Six bundles of fiber would let me tie up my herb garden before the wind gets it.',
    thanks: 'My herbs are safe now. Thank you for thinking of them.' },
  { id: 'sylvie-mushroom', residentId: 'sylvie', item: 'mushroom', count: 2, gold: 45,
    ask: 'Two forest mushrooms would help a salve I am making. Could you gather some?',
    thanks: 'Exactly the right kind. You have a good eye.' },
  { id: 'elowen-seashell', residentId: 'elowen', item: 'seashell', count: 3, gold: 55,
    ask: 'I want three seashells for a coastline display. Would you hunt some down?',
    thanks: 'Splendid specimens. The display card will mention a generous donor.' },
  { id: 'elowen-portal-shard', residentId: 'elowen', item: 'portal-shard', count: 1, gold: 120,
    ask: 'A portal shard for the museum would be a dream. Have you been past the north gate?',
    thanks: 'It hums! Oh, this is going in the center case. Thank you!' },
  { id: 'elowen-slime-gel', residentId: 'elowen', item: 'slime-gel', count: 2, gold: 60,
    ask: 'For science, I need two jars of slime gel. Do not ask how I lost the last ones.',
    thanks: 'Two jars, sealed. I will label these properly this time.' },
  { id: 'seren-stone', residentId: 'seren', item: 'stone', count: 8, gold: 45,
    ask: 'The watch post needs a new step. Eight stone would do it.',
    thanks: 'Good work. The night watch will not trip on that step again.' },
  { id: 'seren-slime-gel', residentId: 'seren', item: 'slime-gel', count: 2, gold: 65,
    ask: 'Bring me two slime gels from the gate. I need proof of what is out there.',
    thanks: 'This confirms it. Thank you, keeper. You are braver than most.' },
  { id: 'seren-sardine', residentId: 'seren', item: 'fish-sardine', count: 2, gold: 100,
    ask: 'The trail crew is hungry. Two sardines would hold them until supper.',
    thanks: 'The crew will eat well tonight. You have my respect.' },
  { id: 'rowan-fiber', residentId: 'rowan', item: 'fiber', count: 8, gold: 40,
    ask: 'The goats chewed through their rope again. Eight fiber would let me make more.',
    thanks: 'Oh, thank you. The goats will be very disappointed.' },
  { id: 'rowan-parsnip', residentId: 'rowan', item: 'parsnip', count: 2, gold: 70,
    ask: 'Um, could you bring two parsnips? The old horse will not eat anything else this week.',
    thanks: 'He will be so happy. Thank you. Really.' },
  { id: 'rowan-wood', residentId: 'rowan', item: 'wood', count: 10, gold: 50,
    ask: 'The pen fence has a gap. Ten wood would close it before the goats find it.',
    thanks: 'That should hold them. For a while, anyway. Thank you.' },
  { id: 'julian-potato', residentId: 'julian', item: 'potato', count: 3, gold: 90,
    ask: 'The tavern is out of potatoes and the regulars want fries. Three would save my night.',
    thanks: 'You are a hero. First round is on the house tonight. Well, almost.' },
  { id: 'julian-mushroom', residentId: 'julian', item: 'mushroom', count: 2, gold: 45,
    ask: 'I am trying a new mushroom toast. Could you bring me two from the forest?',
    thanks: 'Perfect. If the toast is a hit, I will name it after you.' },
  { id: 'julian-sardine', residentId: 'julian', item: 'fish-sardine', count: 2, gold: 100,
    ask: 'A traveler asked for grilled sardines. Two would make him a regular.',
    thanks: 'He will never leave now. Thank you, friend.' },
  { id: 'bram-wood', residentId: 'bram', item: 'wood', count: 12, gold: 60,
    ask: 'I am building a bench for the square. Twelve wood would finish it.',
    thanks: 'Fine timber. Sit on the new bench when it is done. You earned it.' },
  { id: 'bram-stone', residentId: 'bram', item: 'stone', count: 6, gold: 35,
    ask: 'Six stone would give my workshop a proper footing. Could you help?',
    thanks: 'Good and square. Thank you. I will put it to use today.' },
  { id: 'bram-fiber', residentId: 'bram', item: 'fiber', count: 5, gold: 30,
    ask: 'I need five fiber to bind a chair seat. Any to spare?',
    thanks: 'That will make a fine seat. Thank you kindly.' },
  { id: 'kit-seashell', residentId: 'kit', item: 'seashell', count: 2, gold: 40,
    ask: 'Bet you cannot find two seashells before I catch a fish. Go on, try!',
    thanks: 'You beat me! Fine, fine. Here, winner takes the purse.' },
  { id: 'kit-fiber', residentId: 'kit', item: 'fiber', count: 6, gold: 35,
    ask: 'My net tore on a rock. Six fiber would patch it up. Help a friend out?',
    thanks: 'Net is good as new. Next catch is partly yours.' },
  { id: 'kit-parsnip', residentId: 'kit', item: 'parsnip', count: 1, gold: 40,
    ask: 'I have eaten only fish for three days. One parsnip, please. I am begging.',
    thanks: 'A vegetable! You are the best. Do not tell the fish.' },
  { id: 'cael-slime-gel', residentId: 'cael', item: 'slime-gel', count: 3, gold: 80,
    ask: 'I require three slime gels for a binding agent. Fresh ones, please.',
    thanks: 'Acceptable quality. Better than acceptable. Thank you.' },
  { id: 'cael-mushroom', residentId: 'cael', item: 'mushroom', count: 3, gold: 60,
    ask: 'Three forest mushrooms. I am testing a theory about spores.',
    thanks: 'Good. The theory survives another day. You have my thanks.' },
  { id: 'cael-wild-leek', residentId: 'cael', item: 'wild-leek', count: 2, gold: 45,
    ask: 'Two wild leeks. The tonic needs something sharp, and I mean sharp.',
    thanks: 'Pungent. Exactly right. Here is your fee.' },
  { id: 'dorian-fiber', residentId: 'dorian', item: 'fiber', count: 10, gold: 50,
    ask: 'Darling, I need ten fiber for a cloak lining. Could you gather some?',
    thanks: 'Wonderful texture. This cloak will be talked about. Thank you!' },
  { id: 'dorian-seashell', residentId: 'dorian', item: 'seashell', count: 2, gold: 45,
    ask: 'Two seashells would make the most charming buttons. Would you find me some?',
    thanks: 'Oh, these are perfect. Every coat in town will be jealous.' },
  { id: 'dorian-strawberry', residentId: 'dorian', item: 'strawberry', count: 2, gold: 80,
    ask: 'I want strawberry dye for a scarf. Two berries would be enough.',
    thanks: 'Such a color! You have saved my scarf. Thank you, truly.' },
];

/** Fail loudly at load on unknown items, repeated ids, or unsafe speech. */
function validateResidentFavors(favors: readonly ResidentFavor[]): void {
  const ids = new Set<string>();
  for (const favor of favors) {
    if (ids.has(favor.id)) throw new Error(`ResidentFavors: repeated id ${favor.id}`);
    ids.add(favor.id);
    if (!favor.id.startsWith(`${favor.residentId}-`)) throw new Error(`ResidentFavors: ${favor.id} must start with its resident id`);
    const item = ITEM_CATALOG[favor.item];
    if (!item || item.category === 'Placeable' || item.category === 'Tool' || item.category === 'Seed') {
      throw new Error(`ResidentFavors: ${favor.id} asks for an item that cannot be a favor`);
    }
    if (!Number.isSafeInteger(favor.count) || favor.count < 1 || favor.count > 20
      || !Number.isSafeInteger(favor.gold) || favor.gold < 1 || favor.gold > 500) {
      throw new Error(`ResidentFavors: ${favor.id} has an invalid count or gold`);
    }
    for (const text of [favor.ask, favor.thanks]) {
      if (!text.trim() || text.length > 140 || /[{}\[\]\r\n]/.test(text)) throw new Error(`ResidentFavors: ${favor.id} has unsafe speech`);
    }
  }
}
validateResidentFavors(RESIDENT_FAVORS);

/**
 * All favors one resident may ask for.
 * @param id resident id
 * @returns at least one favor; a resident without favors is a config error
 */
export function residentFavors(id: ResidentId): readonly ResidentFavor[] {
  const favors = RESIDENT_FAVORS.filter(favor => favor.residentId === id);
  if (favors.length === 0) throw new Error(`ResidentFavors: ${id} has no favors`);
  return favors;
}

/**
 * Look up one favor by its saved id.
 * @param id favor id
 */
export function residentFavor(id: string): ResidentFavor {
  const favor = RESIDENT_FAVORS.find(candidate => candidate.id === id);
  if (!favor) throw new Error(`ResidentFavors: unknown favor ${id}`);
  return favor;
}
