/**
 * Letters — authored mail that arrives in the farm mailbox on its own.
 *
 * Stardew Valley's mailbox is the world's heartbeat: each morning something may arrive that points
 * the player at a person, a place or an item. These letters do the same for Willowbrook's first
 * week. MailSystem decides WHEN a letter arrives (its trigger); this file only holds WHAT it says.
 *
 * Rules for authoring:
 *  - every letter points somewhere (a resident, a building, an area) so it gives a reason to go;
 *  - bodies stay short enough for the bottom dialogue box (LETTER_BODY_MAX characters);
 *  - ids are permanent once shipped, because saves record delivered/read letter ids.
 */
import { ITEM_CATALOG } from './Items';
import { TAVERN_RECIPES } from './Tavern';
import { TOWN_RESIDENTS } from './TownResidents';

/** Farm mailbox tile: open grass just east of the shop porch, between the door and the shipping bin. */
export const MAILBOX_TILE = { tx: 89, ty: 26 } as const;

/** Longest body the dialogue box shows without clipping (about four wrapped lines at 500px). */
export const LETTER_BODY_MAX = 230;

/** Friendship condition: the resident's whole hearts must be at least `atLeast`. */
export interface HeartTrigger {
  readonly resident: string;
  readonly atLeast: number;
}

/**
 * When a letter arrives. It is delivered on the first morning where every condition holds.
 *  day           earliest calendar day (day 1 = the first morning of a new game)
 *  shopRestored  also wait until the inherited shop has been restored (tavern level >= 1)
 *  hearts        also wait until a resident's friendship reaches a heart milestone
 */
export interface LetterTrigger {
  readonly day: number;
  readonly shopRestored?: true;
  readonly hearts?: HeartTrigger;
}

/** An optional enclosed gift, granted once when the letter is read. */
export interface LetterGift {
  readonly item: string;
  readonly qty: number;
}

/** One authored letter. */
export interface LetterDef {
  readonly id: string;
  /** Sender shown as the dialogue name, e.g. "Kit". */
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly trigger: LetterTrigger;
  readonly gift?: LetterGift;
  /** Recipe id from TAVERN_RECIPES taught by reading this letter (the kitchen checks mail.read). */
  readonly recipe?: string;
}

/** Shorthand for a friendship-milestone letter (no date gate beyond day 1). */
function heartLetter(resident: string, atLeast: 3 | 7, from: string, subject: string, body: string,
  extra: { gift?: LetterGift; recipe?: string }): LetterDef {
  return { id: `${resident}-hearts-${atLeast}`, from, subject, body, trigger: { day: 1, hearts: { resident, atLeast } }, ...extra };
}

/**
 * Week-one mail, in delivery-priority order (a morning that unlocks several letters delivers them
 * in this order). Day letters come first; friendship-milestone letters follow.
 */
export const LETTERS: readonly LetterDef[] = [
  {
    id: 'mayor-welcome',
    from: 'Mayor Hollis',
    subject: 'Welcome to Willowbrook',
    body: 'Welcome home! Your grandfather kept that old shop alive for forty years. Get settled, then follow the east road into town. Everyone is eager to meet the new keeper.',
    trigger: { day: 1 },
  },
  {
    id: 'kit-pond',
    from: 'Kit',
    subject: 'The pond is biting',
    body: 'Heard the old farm has a keeper again! The forest pond south of your place is biting today. A couple of sardines for your first stew. Come say hi at the tackle shop!',
    trigger: { day: 2 },
    gift: { item: 'fish-sardine', qty: 2 },
  },
  {
    id: 'bram-timber',
    from: 'Bram',
    subject: 'For those porch boards',
    body: "Your grandpa's porch boards are older than I am. Here's a bundle of wood to get repairs started. The carpenter's workshop is open if you need more.",
    trigger: { day: 3 },
    gift: { item: 'wood', qty: 10 },
  },
  {
    id: 'tessa-potatoes',
    from: 'Tessa',
    subject: 'Spring is short!',
    body: 'Potatoes love Willowbrook soil. I tucked a few seed potatoes in with this note, plus my potato stew recipe for your kitchen. The market has more seed whenever you need it.',
    trigger: { day: 4 },
    gift: { item: 'potato-seeds', qty: 5 },
    recipe: 'potato-stew',
  },
  {
    id: 'seren-north-trail',
    from: 'Seren',
    subject: 'The north trail',
    body: 'The guild cleared the old trail north of your farm. A gate stands open up there, humming. Bring a sword, and bring back shards. The forge can use them. Check my board in town too.',
    trigger: { day: 5 },
  },
  {
    id: 'julian-lights-on',
    from: 'Julian',
    subject: 'Lights on again',
    body: "So the old shop has its lights on again. Willowbrook has had one tavern for years. Friendly competition, keeper. Drop by The Wayfarer sometime.",
    trigger: { day: 2, shopRestored: true },
  },
  {
    id: 'cael-forest-stew',
    from: 'Cael',
    subject: 'Mushrooms are up',
    body: 'Wild mushrooms are popping up in the forest. Two in a pot make a forest stew your guests will love. Recipe enclosed. Bring me slime gel sometime and I will show you a healing brew.',
    trigger: { day: 6 },
    recipe: 'forest-stew',
  },
  {
    id: 'elowen-curiosities',
    from: 'Elowen',
    subject: 'Empty display cases',
    body: 'The museum has a few empty cases. If you find curiosities in the mines, bring them by. Your grandfather donated the very first piece we ever displayed.',
    trigger: { day: 7 },
  },
  // Friendship milestones: each resident writes at 3 and 7 hearts with a gift or a recipe.
  heartLetter('nyra', 3, 'Nyra', 'Moon mushrooms', 'The stars say you are good company. I picked these under last night\'s moon. They are only mushrooms, but they are lucky ones.', { gift: { item: 'mushroom', qty: 4 } }),
  heartLetter('nyra', 7, 'Nyra', 'Humming crystals', 'These shards hum the same note as the north gate. Keep them. Rhea can fold them into steel, and I would like you to come back from the portal in one piece.', { gift: { item: 'portal-shard', qty: 3 } }),
  heartLetter('tessa', 3, 'Tessa', 'Garden stew', 'You are my best customer, so here is my garden stew recipe: two cabbages, slow simmer. Seeds enclosed so you can grow your own.', { gift: { item: 'cabbage-seeds', qty: 5 }, recipe: 'garden-stew' }),
  heartLetter('tessa', 7, 'Tessa', 'Sweet spring', 'Strawberries take patience, like friends. These seeds came from my mother\'s patch. Plant them in spring and think of me when they ripen.', { gift: { item: 'strawberry-seeds', qty: 8 } }),
  heartLetter('rhea', 3, 'Rhea', 'Good stone', 'You haul ore like a smith. Here is a load of good stone from my yard. Bring me portal shards and I will put a real edge on that sword.', { gift: { item: 'stone', qty: 20 } }),
  heartLetter('rhea', 7, 'Rhea', 'For the forge', 'Saved these shards from the scrap bin for you. Do not spend them on trinkets. Come see me and we will make that blade sing.', { gift: { item: 'portal-shard', qty: 2 } }),
  heartLetter('sylvie', 3, 'Sylvie', 'Doctor\'s orders', 'Eat your greens! These wild leeks grow by the clinic fence. Put them in something warm and rest more than you think you need.', { gift: { item: 'wild-leek', qty: 5 } }),
  heartLetter('sylvie', 7, 'Sylvie', 'Just in case', 'I hear you go through the north gate now. Please carry these. Drink one the moment things look bad, not after. I mean it.', { gift: { item: 'healing-potion', qty: 3 } }),
  heartLetter('elowen', 3, 'Elowen', 'Spare shells', 'We had duplicates in the shell drawer. Your grandfather would have wanted them on a shelf at the shop, not in a box at the museum.', { gift: { item: 'seashell', qty: 3 } }),
  heartLetter('elowen', 7, 'Elowen', 'Grandpa\'s melons', 'I found seeds in your grandfather\'s donation box, labelled in his hand. They belong with you. Summer melons, his favourite.', { gift: { item: 'melon-seeds', qty: 4 } }),
  heartLetter('seren', 3, 'Seren', 'Guild rations', 'You keep your word on the board. Every guild member gets a field kit. Yours has two potions. Use them in the portal, not on a stubbed toe.', { gift: { item: 'healing-potion', qty: 2 } }),
  heartLetter('seren', 7, 'Seren', 'A keeper of the gate', 'The guild voted. You are one of us now. These shards are your first share of what we pulled from the gate. Your grandfather would be proud.', { gift: { item: 'portal-shard', qty: 4 } }),
  heartLetter('rowan', 3, 'Rowan', 'Ranch twine', 'Too much twine at the ranch again. Fiber for your crafting. Swing by and say hi to the cows, they ask about you.', { gift: { item: 'fiber', qty: 20 } }),
  heartLetter('rowan', 7, 'Rowan', 'Seed money', 'Did well at market this week, so here are parsnip seeds for you. Friends share a good season.', { gift: { item: 'parsnip-seeds', qty: 10 } }),
  heartLetter('julian', 3, 'Julian', 'A truce in a mug', 'Fine, your shop is not terrible. Have a few casks on me. Do not tell anyone at The Wayfarer.', { gift: { item: 'ale', qty: 4 } }),
  heartLetter('julian', 7, 'Julian', 'Rivals, then friends', 'Willowbrook is better with two taverns. There, I said it. Eight ales for your shelf. Come drink one with me at closing.', { gift: { item: 'ale', qty: 8 } }),
  heartLetter('bram', 3, 'Bram', 'More boards', 'You treat wood right. Another bundle for whatever you build next. My workshop door is always open.', { gift: { item: 'wood', qty: 25 } }),
  heartLetter('bram', 7, 'Bram', 'A proper chest', 'Built this chest from the old oak by the bridge. Solid joints, no nails. It should outlast us both.', { gift: { item: 'chest', qty: 1 } }),
  heartLetter('kit', 3, 'Kit', 'Hearty stew', 'Secret family recipe: one potato and one trout make the best stew in the valley. Two trout enclosed so you can try it today!', { gift: { item: 'fish-trout', qty: 2 }, recipe: 'hearty-stew' }),
  heartLetter('kit', 7, 'Kit', 'The big ones', 'Landed two pike before sunrise and thought of you. Best friend gets the best fish. Come fishing with me soon?', { gift: { item: 'fish-pike', qty: 2 } }),
  heartLetter('cael', 3, 'Cael', 'Gel for brewing', 'Slime gel is the base of every healing brew. Here is a start. Bring it with a mushroom to the alchemy house.', { gift: { item: 'slime-gel', qty: 3 } }),
  heartLetter('cael', 7, 'Cael', 'My best batch', 'My strongest potions yet, and you are the first to get them. Let me know how they taste. Honestly. I can take it.', { gift: { item: 'healing-potion', qty: 4 } }),
  heartLetter('dorian', 3, 'Dorian', 'Good thread', 'Fine fiber for a fine keeper. Your shop deserves curtains, by the way. We can talk about that.', { gift: { item: 'fiber', qty: 15 } }),
  heartLetter('dorian', 7, 'Dorian', 'A woven rug', 'I wove this rug for your shop floor. Do not argue. It took me a week and it matches your apron.', { gift: { item: 'rug', qty: 1 } }),
];

/**
 * Check the authored table once at module load: unique ids, real gift items, short bodies.
 * A broken letter must fail loudly at boot, never silently disappear from the mailbox.
 */
function validateLetters(letters: readonly LetterDef[]): void {
  const seen = new Set<string>();
  for (const letter of letters) {
    if (seen.has(letter.id)) throw new Error(`Letters: duplicate id ${letter.id}`);
    seen.add(letter.id);
    if (!Number.isSafeInteger(letter.trigger.day) || letter.trigger.day < 1) throw new Error(`Letters: ${letter.id} has an invalid trigger day`);
    if (letter.body.length > LETTER_BODY_MAX) throw new Error(`Letters: ${letter.id} body is longer than ${LETTER_BODY_MAX} characters`);
    if (letter.gift) {
      if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, letter.gift.item)) throw new Error(`Letters: ${letter.id} encloses unknown item ${letter.gift.item}`);
      if (!Number.isSafeInteger(letter.gift.qty) || letter.gift.qty < 1) throw new Error(`Letters: ${letter.id} has an invalid gift quantity`);
    }
    const hearts = letter.trigger.hearts;
    if (hearts) {
      if (!TOWN_RESIDENTS.some(resident => resident.id === hearts.resident)) throw new Error(`Letters: ${letter.id} waits on unknown resident ${hearts.resident}`);
      if (!Number.isSafeInteger(hearts.atLeast) || hearts.atLeast < 1 || hearts.atLeast > 10) throw new Error(`Letters: ${letter.id} has an invalid heart milestone`);
    }
    if (letter.recipe !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(TAVERN_RECIPES, letter.recipe)) throw new Error(`Letters: ${letter.id} teaches unknown recipe ${letter.recipe}`);
      if (TAVERN_RECIPES[letter.recipe].letter !== letter.id) throw new Error(`Letters: ${letter.id} teaches ${letter.recipe}, but that recipe names a different letter`);
    }
  }
  // why: the kitchen unlocks a recipe by its letter id, so every letter-taught recipe needs a real
  // letter that says it teaches it — otherwise the recipe could never be learned.
  for (const [recipeId, recipe] of Object.entries(TAVERN_RECIPES)) {
    if (recipe.letter !== null && !letters.some(letter => letter.id === recipe.letter && letter.recipe === recipeId)) {
      throw new Error(`Letters: recipe ${recipeId} names letter ${recipe.letter}, which does not teach it`);
    }
  }
}
validateLetters(LETTERS);

/**
 * Look up one letter by id.
 * @throws when the id is not authored (a save naming an unknown letter is corrupt)
 */
export function letterById(id: string): LetterDef {
  const letter = LETTERS.find(entry => entry.id === id);
  if (!letter) throw new Error(`Letters: unknown letter ${id}`);
  return letter;
}
