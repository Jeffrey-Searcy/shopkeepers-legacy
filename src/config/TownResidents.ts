/** Named townspeople belong to their homes and jobs, never the random paying-customer pool. */
import { appearanceKey, assertAppearance, type Appearance } from './Appearance';
import type { TownBuildingId } from './TownBuildings';

/** Permanent identity, base pixel-art wardrobe and authored dialogue. */
export interface TownResidentDefinition {
  id: string; name: string; buildingId: TownBuildingId;
  appearance: Appearance; lines: readonly [string, string, string];
}

/**
 * Validate one complete finite outfit. The Appearance type makes every field mandatory, so each choice stays
 * explicit in the resident catalog. Women use the feminine body; role clothing (robe, smith apron, overalls,
 * vest, apron, hood, cap, beard) tells each resident's trade at a glance in the town.
 */
function outfit(appearance: Appearance): Appearance {
  return assertAppearance(appearance);
}

/** Twelve authored residents. Dialogue describes character, not unimplemented trading or upgrade services. */
export const TOWN_RESIDENTS: readonly TownResidentDefinition[] = [
  { id: 'nyra', name: 'Nyra', buildingId: 'magic',
    appearance: outfit({ body: 'feminine', hairStyle: 'bob', hat: 'wizard', facialHair: 'none', shirtStyle: 'tee', garment: 'robe', pantsStyle: 'original',
      eyeColor: 'grey', skinTone: 'ivory', hairColor: 'black', shirtColor: 'berry', pantsColor: 'plum' }), lines: [
      'I keep the curious things on the high shelves. Naturally, those are the shelves everyone asks about.',
      'A little mystery makes a house warmer. An unexplained noise in the cellar does not. There is a difference.',
      'If your kettle starts singing, bring it here. If it starts giving advice, stop listening first.' ] },
  { id: 'tessa', name: 'Tessa', buildingId: 'market',
    appearance: outfit({ body: 'feminine', hairStyle: 'tousled', hat: 'none', facialHair: 'none', shirtStyle: 'striped', garment: 'none', pantsStyle: 'cuffed',
      eyeColor: 'brown', skinTone: 'warm', hairColor: 'original', shirtColor: 'cream', pantsColor: 'earth' }), lines: [
      'Welcome in! I am still deciding where everything belongs. The sunlight has very strong opinions.',
      'A good market should feel like a neighbor opening their kitchen door. With slightly fewer muddy boots.',
      'I keep a list of things this town needs. Another shelf is always somewhere near the top.' ] },
  { id: 'rhea', name: 'Rhea', buildingId: 'forge',
    appearance: outfit({ body: 'feminine', hairStyle: 'tousled', hat: 'none', facialHair: 'none', shirtStyle: 'tee', garment: 'smith', pantsStyle: 'cuffed',
      eyeColor: 'brown', skinTone: 'warm', hairColor: 'black', shirtColor: 'original', pantsColor: 'slate' }), lines: [
      'Mind the hot end. You would be surprised how often that needs saying.',
      'That little iron bird? A practice piece. No, you cannot laugh at it. The beak took three tries.',
      'Good work takes patience. Loud work just takes a hammer. I prefer to manage both.' ] },
  { id: 'sylvie', name: 'Sylvie', buildingId: 'clinic',
    appearance: outfit({ body: 'feminine', hairStyle: 'bob', hat: 'none', facialHair: 'none', shirtStyle: 'tee', garment: 'robe', pantsStyle: 'original',
      eyeColor: 'green', skinTone: 'ivory', hairColor: 'blonde', shirtColor: 'cream', pantsColor: 'moss' }), lines: [
      'Sit for a moment. Rest is not a reward you have to earn.',
      'The garden is doing well. Except the mint, which is doing far too well and knows it.',
      'People tell plants all sorts of things while watering them. Fortunately, most plants are discreet.' ] },
  { id: 'elowen', name: 'Elowen', buildingId: 'museum',
    appearance: outfit({ body: 'feminine', hairStyle: 'bob', hat: 'none', facialHair: 'none', shirtStyle: 'striped', garment: 'none', pantsStyle: 'original',
      eyeColor: 'grey', skinTone: 'ivory', hairColor: 'silver', shirtColor: 'blue', pantsColor: 'plum' }), lines: [
      'Please excuse the notes. I found one date that disagrees with three others, and now it is personal.',
      'Every ordinary object has a history. The difficult part is convincing it to tell us.',
      'I meant to read one chapter before opening. That was a very optimistic plan.' ] },
  { id: 'seren', name: 'Seren', buildingId: 'guild',
    appearance: outfit({ body: 'feminine', hairStyle: 'tousled', hat: 'hood', facialHair: 'none', shirtStyle: 'tee', garment: 'none', pantsStyle: 'original',
      eyeColor: 'grey', skinTone: 'ivory', hairColor: 'silver', shirtColor: 'blue', pantsColor: 'slate' }), lines: [
      'Clear paths. Sound doors. People getting home safely. That is what matters to me.',
      'Julian says I stand guard while drinking tea. I am simply choosing a sensible view of the room.',
      'You do not have to prove anything by walking into danger unprepared. Ask for company.' ] },
  { id: 'rowan', name: 'Rowan', buildingId: 'ranch',
    appearance: outfit({ body: 'original', hairStyle: 'tousled', hat: 'straw', facialHair: 'none', shirtStyle: 'original', garment: 'overalls', pantsStyle: 'cuffed',
      eyeColor: 'green', skinTone: 'warm', hairColor: 'blonde', shirtColor: 'sage', pantsColor: 'earth' }), lines: [
      'I remembered every feeding time and forgot my own lunch. The animals are better organized than I am.',
      'A quiet voice works better than a loud one. Usually. Some goats have their own philosophy.',
      'Bram made that latch twice. I asked for the second one after explaining it needed to outsmart a goat.' ] },
  { id: 'julian', name: 'Julian', buildingId: 'bar',
    appearance: outfit({ body: 'original', hairStyle: 'tousled', hat: 'none', facialHair: 'none', shirtStyle: 'tee', garment: 'apron', pantsStyle: 'original',
      eyeColor: 'grey', skinTone: 'warm', hairColor: 'black', shirtColor: 'sage', pantsColor: 'slate' }), lines: [
      'A room gets friendlier once someone tells a story. Kit usually provides enough for three rooms.',
      'Seren chose the seat facing the door again. I have stopped pretending it is a coincidence.',
      'I remember faces better than names. Orders better than either. Make of that what you will.' ] },
  { id: 'bram', name: 'Bram', buildingId: 'carpenter',
    appearance: outfit({ body: 'original', hairStyle: 'original', hat: 'knit', facialHair: 'beard', shirtStyle: 'original', garment: 'none', pantsStyle: 'cuffed',
      eyeColor: 'brown', skinTone: 'brown', hairColor: 'silver', shirtColor: 'sage', pantsColor: 'earth' }), lines: [
      'Measure twice. Then check which side of the line you marked. Saves a surprising amount of wood.',
      'Rowan needs another gate latch. I am starting to suspect the goat is studying my work.',
      'I like a chair that stays quiet when you sit down. People have enough complaints without furniture joining in.' ] },
  { id: 'kit', name: 'Kit', buildingId: 'fishing',
    appearance: outfit({ body: 'original', hairStyle: 'tousled', hat: 'cap', facialHair: 'none', shirtStyle: 'striped', garment: 'vest', pantsStyle: 'shorts',
      eyeColor: 'brown', skinTone: 'warm', hairColor: 'copper', shirtColor: 'cream', pantsColor: 'original' }), lines: [
      'The fish was enormous. The part where it escaped does not make it any smaller.',
      'A good knot is a promise you make to your future self. I learned that in fairly wet circumstances.',
      'Come by the shore sometime. I know a quiet spot. Well, quiet until I get there.' ] },
  { id: 'cael', name: 'Cael', buildingId: 'alchemy',
    appearance: outfit({ body: 'original', hairStyle: 'original', hat: 'none', facialHair: 'none', shirtStyle: 'tee', garment: 'robe', pantsStyle: 'original',
      eyeColor: 'grey', skinTone: 'deep', hairColor: 'silver', shirtColor: 'blue', pantsColor: 'plum' }), lines: [
      'Unexpected results are useful. Unlabeled results are a nuisance. Please do not rearrange the bottles.',
      'Nyra calls it intuition. I call it a theory that has not written down its workings yet.',
      'Nothing exploded today. A modest achievement, but one worth appreciating.' ] },
  { id: 'dorian', name: 'Dorian', buildingId: 'tailor',
    appearance: outfit({ body: 'original', hairStyle: 'bob', hat: 'none', facialHair: 'mustache', shirtStyle: 'original', garment: 'vest', pantsStyle: 'cuffed',
      eyeColor: 'brown', skinTone: 'brown', hairColor: 'copper', shirtColor: 'rose', pantsColor: 'slate' }), lines: [
      'A good coat should let you raise your arms. Looking splendid is no excuse for being trapped in your sleeves.',
      'Those scraps are not rubbish. They are very small future ideas.',
      'Rhea pretends not to care about the lining of her work jacket. She chose the red one immediately.' ] },
];

/** Fail on duplicate identities, incomplete roles or invalid wardrobes before texture creation. */
export function validateTownResidents(): void {
  if (TOWN_RESIDENTS.length !== 12) throw new Error('Town residents: exactly twelve residents are required');
  for (const field of ['id', 'name', 'buildingId'] as const) {
    if (new Set(TOWN_RESIDENTS.map(resident => resident[field])).size !== 12) throw new Error(`Town residents: ${field} must have twelve unique entries`);
  }
  if (new Set(TOWN_RESIDENTS.map(resident => appearanceKey(resident.appearance))).size !== 12) throw new Error('Town residents: wardrobes must differ');
  for (const resident of TOWN_RESIDENTS) {
    if (resident.lines.length < 3 || resident.lines.some(line => !line.trim())) throw new Error(`Town residents: missing dialogue for ${resident.id}`);
  }
}

/** Resolve permanent business ownership; unknown IDs are authoring errors, never randomized. */
export function residentForBuilding(buildingId: TownBuildingId): TownResidentDefinition {
  validateTownResidents();
  const resident = TOWN_RESIDENTS.find(entry => entry.buildingId === buildingId);
  if (!resident) throw new Error(`Town residents: no resident for ${buildingId}`);
  return resident;
}
