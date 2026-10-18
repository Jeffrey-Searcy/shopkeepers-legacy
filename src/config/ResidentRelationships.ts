/** Authored social identities, hidden tastes, and finite NPC pair chemistry for permanent residents. */
import { ITEM_CATALOG } from './Items';
import { TOWN_RESIDENTS } from './TownResidents';

export type ResidentId = typeof TOWN_RESIDENTS[number]['id'];
export type DialogueTier = 'new' | 'friend' | 'close' | 'romantic';
export type GiftTaste = 'love' | 'like' | 'neutral' | 'dislike' | 'hate';

/** Public personality and private gift data belong together but only public fields enter the journal/chat prompt. */
export interface ResidentRelationshipProfile {
  id: ResidentId;
  adult: true;
  romanceable: true;
  bio: string;
  traits: readonly [string, string, string];
  relationshipStyle: 'exclusive' | 'open-minded';
  /** Two personality-led preferences bias meetings and attraction without fixing a couple. */
  drawnTo: readonly [ResidentId, ResidentId];
  tastes: Readonly<Record<Exclude<GiftTaste, 'neutral'>, readonly string[]>>;
  dialogue: Readonly<Record<DialogueTier, readonly [string, string, string]>>;
}

/** Finite compatibility lanes let townspeople form relationships without an autonomous agent simulation. */
export interface ResidentBondProfile {
  id: string;
  residents: readonly [ResidentId, ResidentId];
}

/** Twelve current adult romance routes. Tastes never appear in player-facing journal data. */
export const RESIDENT_RELATIONSHIPS: readonly ResidentRelationshipProfile[] = [
  { id: 'nyra', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['cael', 'julian'],
    bio: 'A playful magic-shop keeper who hides careful work behind jokes and theatrical mystery.', traits: ['witty', 'curious', 'guarded'],
    tastes: { love: ['bat-wing', 'melon'], like: ['slime-gel', 'ale'], dislike: ['stone'], hate: ['fiber'] }, dialogue: {
      new: ['Most mysteries improve with tea. The rest improve with distance.', 'You have the look of someone about to touch the clearly enchanted shelf.', 'A quiet shop leaves room for interesting questions.'],
      friend: ['I saved a harmless little charm for you. Harmless by my standards.', 'You make this room feel less like a stage and more like home.', 'Cael insists every spark needs an explanation. I prefer a good entrance.'],
      close: ['I do not show everyone the unfinished spells. Try not to look too pleased.', 'You notice when I am worried, even when I am being especially charming.', 'Stay a while. The kettle behaves better when you are here.'],
      romantic: ['If I cast anything tonight, it may only be an excuse to keep you close.', 'You are becoming my favorite unsolved mystery.', 'No trick this time. I am simply happy you came.'] } },
  { id: 'tessa', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['bram', 'sylvie'],
    bio: 'The sunny market keeper remembers every neighbor and worries quietly about having enough for them.', traits: ['generous', 'organized', 'earnest'],
    tastes: { love: ['parsnip', 'potato'], like: ['melon', 'wood'], dislike: ['bat-wing'], hate: ['slime-gel'] }, dialogue: {
      new: ['I moved the seed basket again. The sunlight keeps winning the argument.', 'Tell me what your farm needs and I will put it on the list.', 'A market should feel like a neighbor opening their pantry.'],
      friend: ['I set aside the nicest produce before remembering you grow nicer produce.', 'Seeing you is becoming part of my morning routine.', 'You always make the busiest hour feel manageable.'],
      close: ['I can tell you when I am overwhelmed, can I not?', 'The shop is quieter after closing. I would like to show you sometime.', 'I wrote your name on the list, then realized I only wanted your company.'],
      romantic: ['I saved the seat by the window for us.', 'You make ordinary days feel worth planning around.', 'Come back after closing. I want one hour that belongs only to us.'] } },
  { id: 'rhea', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['dorian', 'seren'],
    bio: 'A disciplined smith with dry humor, fierce standards, and a soft spot for handmade imperfections.', traits: ['direct', 'patient', 'protective'],
    tastes: { love: ['stone', 'bat-wing'], like: ['wood', 'ale'], dislike: ['melon'], hate: ['fiber'] }, dialogue: {
      new: ['Mind the hot end. I prefer visitors with the usual number of fingers.', 'Good work takes patience. Loud work only takes a hammer.', 'The iron bird is a practice piece. The beak is not up for debate.'],
      friend: ['I sharpened your tools. Do not make a ceremony of it.', 'You listen before offering advice. That is rarer than good steel.', 'The forge is loud, but I notice when you enter.'],
      close: ['I trust you near unfinished work. That means more than it sounds.', 'Some days I need quiet company, not solutions.', 'I made something for you, then made it twice because the first was not good enough.'],
      romantic: ['Stay until the coals cool. I like who I am around you.', 'You are the one thing I do not want to improve.', 'Take my hand. Yes, I washed the soot off first.'] } },
  { id: 'sylvie', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['rowan', 'tessa'],
    bio: 'A gentle healer and relentless gardener who treats rest as a necessity, not a reward.', traits: ['calm', 'observant', 'nurturing'],
    tastes: { love: ['fiber', 'parsnip'], like: ['melon', 'fish-carp'], dislike: ['ale'], hate: ['bat-wing'] }, dialogue: {
      new: ['Sit for a moment. Rest is not something you must earn.', 'The mint is doing far too well and knows it.', 'People tell plants secrets. Most plants are discreet.'],
      friend: ['You look tired in the shoulders. Breathe before you disagree.', 'I planted something that made me think of you.', 'Your visits do more for this room than fresh flowers.'],
      close: ['I am used to caring for everyone. Thank you for asking how I am.', 'You can stay without speaking. I would still know what you mean.', 'I trust the quiet we share.'],
      romantic: ['Let me be the place where you rest.', 'I have stopped pretending these flowers were not chosen for you.', 'Your hand fits mine rather wonderfully.'] } },
  { id: 'elowen', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['kit', 'nyra'],
    bio: 'The museum curator follows every loose thread, including the ones that lead far from her notes.', traits: ['scholarly', 'absent-minded', 'bold'],
    tastes: { love: ['fish-carp', 'slime-gel'], like: ['stone', 'bat-wing'], dislike: ['ale'], hate: ['parsnip-seeds'] }, dialogue: {
      new: ['One date disagrees with three others. It has become personal.', 'Every ordinary object has a history if you ask the right question.', 'I meant to read one chapter. That was optimistic.'],
      friend: ['I found a footnote you would love. This is not a strange compliment.', 'You are very good at interrupting my least useful spirals.', 'I kept a place for your discoveries on the second shelf.'],
      close: ['You make me want to experience stories instead of only cataloging them.', 'I wrote about today before it ended. You were in the first line.', 'There are questions I only feel brave enough to ask you.'],
      romantic: ['I know exactly when I began falling for you. I checked my notes.', 'Let us make a history worth misfiling.', 'You are the only distraction I never regret.'] } },
  { id: 'seren', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['julian', 'rhea'],
    bio: 'The guild captain watches every doorway, speaks plainly, and carries responsibility alone too often.', traits: ['steadfast', 'reserved', 'loyal'],
    tastes: { love: ['stew', 'bat-wing'], like: ['stone', 'fish-bass'], dislike: ['ale'], hate: ['slime-gel'] }, dialogue: {
      new: ['Clear paths and sound doors. People getting home safely. That matters.', 'You need not prove courage by walking into danger unprepared.', 'I stand where I can see the door. It is practical, not dramatic.'],
      friend: ['I worry less when I know you made it home.', 'You can ask me for company. I mean that.', 'Julian says I guard my tea. He exaggerates.'],
      close: ['I am not good at needing people. I am trying with you.', 'There are things I can set down when you are here.', 'Walk with me after dusk. The town sounds different then.'],
      romantic: ['My guard lowers around you. That is trust, not carelessness.', 'I choose you with my eyes open.', 'Come closer. I have watched the door long enough.'] } },
  { id: 'rowan', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['sylvie', 'bram'],
    bio: 'A warm rancher who understands animals instantly and people after a thoughtful pause.', traits: ['patient', 'practical', 'shy'],
    tastes: { love: ['parsnip', 'fiber'], like: ['wood', 'potato'], dislike: ['ale'], hate: ['bat-wing'] }, dialogue: {
      new: ['The animals ate on time. I remembered my lunch eventually.', 'Some goats have a philosophy about gates.', 'A quiet voice usually works better than a loud one.'],
      friend: ['The calf recognizes your footsteps now.', 'I saved the calmest part of the afternoon for your visit.', 'You make conversation feel less like a fence I need to climb.'],
      close: ['I can be quiet with you without feeling awkward.', 'There is a hill past the pasture. I would like to show you at sunset.', 'I trust you with the skittish ones. That includes me, a little.'],
      romantic: ['Stay for supper. Then stay after supper too.', 'You feel like coming home before I have even left.', 'I love the way the whole farm settles when you are near.'] } },
  { id: 'julian', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['seren', 'nyra'],
    bio: 'The town bartender collects stories, reads a room quickly, and hides sincerity behind easy charm.', traits: ['sociable', 'perceptive', 'restless'],
    tastes: { love: ['ale', 'fish-bass'], like: ['stew', 'melon'], dislike: ['stone'], hate: ['fiber'] }, dialogue: {
      new: ['A room gets friendlier once someone tells a story.', 'I remember orders better than names. Faces better than both.', 'Seren chose the seat facing the door again. Entirely accidental, I am sure.'],
      friend: ['Your usual? I know, you have not ordered yet.', 'I like the version of this place that starts when you walk in.', 'You listen to my stories as if I am not polishing half of them.'],
      close: ['I spend all night reading people. You are the one I want to know slowly.', 'After closing, I sometimes let the room be quiet. Join me.', 'You make honesty feel less dangerous than charm.'],
      romantic: ['No performance tonight. I missed you.', 'Let everyone else have the stories. I want this moment for us.', 'If you stay, I will pour the last drink and lock the door.'] } },
  { id: 'bram', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['tessa', 'rowan'],
    bio: 'A thoughtful carpenter who speaks through useful gestures and builds everything to outlast worry.', traits: ['steady', 'meticulous', 'kind'],
    tastes: { love: ['wood', 'stew'], like: ['stone', 'parsnip'], dislike: ['slime-gel'], hate: ['bat-wing'] }, dialogue: {
      new: ['Measure twice. Then check which side of the line you marked.', 'A good chair stays quiet when you sit down.', 'Rowan needs another latch. The goat is learning.'],
      friend: ['I fixed that loose handle you mentioned. It was bothering me too.', 'Working beside you feels easier than working alone.', 'I kept this piece of grain because I thought you would notice it.'],
      close: ['I built most of my life to stand on its own. You make sharing the weight feel possible.', 'There is a place by the window I have imagined you in.', 'I do not always have the words. I hope the things I make say enough.'],
      romantic: ['I want to build a life that has room for both of us.', 'Your name sounds right beside mine.', 'Stay. The work can wait, and I rarely say that.'] } },
  { id: 'kit', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['elowen', 'julian'],
    bio: 'A lively fisher whose confidence grows with every retelling and whose quiet side belongs to the shore.', traits: ['adventurous', 'funny', 'sensitive'],
    tastes: { love: ['fish-sardine', 'fish-bass'], like: ['fish-carp', 'ale'], dislike: ['fiber'], hate: ['stone'] }, dialogue: {
      new: ['The fish was enormous. Escaping did not make it smaller.', 'A good knot is a promise to your future self.', 'I know a quiet shore. It becomes less quiet when I arrive.'],
      friend: ['I saved the best part of today to tell you first.', 'You believe exactly enough of my fishing stories.', 'Come to the water sometime. I will even let you choose the spot.'],
      close: ['I joke when I am nervous. You may have noticed a recent increase.', 'The sea makes room for every feeling. So do you.', 'I want you to know the stories I do not tell the bar.'],
      romantic: ['You are better than the ending I add to any story.', 'Meet me at the shore when the lanterns come on.', 'I would cross rough water for you. Calm water too, obviously.'] } },
  { id: 'cael', adult: true, romanceable: true, relationshipStyle: 'open-minded', drawnTo: ['nyra', 'elowen'],
    bio: 'An exacting alchemist who needs labels, evidence, and one trusted person willing to challenge his conclusions.', traits: ['analytical', 'intense', 'honest'],
    tastes: { love: ['slime-gel', 'fiber'], like: ['bat-wing', 'melon'], dislike: ['ale'], hate: ['fish-carp'] }, dialogue: {
      new: ['Unexpected results are useful. Unlabeled results are a nuisance.', 'Nothing exploded today. A modest achievement.', 'Nyra calls it intuition. I call it an undocumented method.'],
      friend: ['Your observations are annoyingly helpful. Please continue.', 'I made notes on our last conversation. Only the useful parts. Mostly.', 'The room is measurably calmer when you are here.'],
      close: ['You are the first person I seek before the explanation is complete.', 'I cannot reduce what I feel for you to a useful formula.', 'Stay while I finish this. Your presence improves my judgment.'],
      romantic: ['The evidence is overwhelming. I am happier with you.', 'I trust you beyond what I can prove.', 'Come here. I have tested this conclusion enough.'] } },
  { id: 'dorian', adult: true, romanceable: true, relationshipStyle: 'exclusive', drawnTo: ['rhea', 'cael'],
    bio: 'A stylish tailor who notices every detail, protects tender feelings with flair, and hates wasted potential.', traits: ['creative', 'dramatic', 'attentive'],
    tastes: { love: ['fiber', 'melon'], like: ['wood', 'ale'], dislike: ['stone'], hate: ['slime-gel'] }, dialogue: {
      new: ['Looking splendid is no excuse for being trapped in your sleeves.', 'Those scraps are very small future ideas.', 'Rhea chose the red lining immediately, despite all protests.'],
      friend: ['That color suits you. No, I will not pretend I did not notice.', 'You make me want to finish the designs I keep saving for someday.', 'I adjusted this pattern because your opinion mattered.'],
      close: ['You see me when I am not performing. It is terrifying and rather lovely.', 'I kept the studio open because I hoped you would come.', 'Let me make something that feels like the way you make me feel.'],
      romantic: ['Darling, even I cannot improve this moment.', 'I know every line of your silhouette and still miss you when you leave.', 'Stay where the light catches you. Better yet, stay beside me.'] } },
] as const;

/** Return the one canonical bond id in permanent resident order. */
export function residentBondId(first: ResidentId, second: ResidentId): string {
  if (first === second) throw new Error(`Relationships: ${first} cannot bond with themself`);
  const order = TOWN_RESIDENTS.map(resident => resident.id);
  const firstIndex = order.indexOf(first), secondIndex = order.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0) throw new Error(`Relationships: unknown bond residents ${first}/${second}`);
  return firstIndex < secondIndex ? `${first}-${second}` : `${second}-${first}`;
}

/** Every resident can build a distinct friendship or romance with every other resident. */
export const RESIDENT_BONDS: readonly ResidentBondProfile[] = TOWN_RESIDENTS.flatMap((resident, index) =>
  TOWN_RESIDENTS.slice(index + 1).map(other => ({ id: residentBondId(resident.id, other.id), residents: [resident.id, other.id] as const })));

/** Resolve one social profile without substituting a different resident. */
export function residentRelationshipProfile(id: string): ResidentRelationshipProfile {
  const profile = RESIDENT_RELATIONSHIPS.find(entry => entry.id === id);
  if (!profile) throw new Error(`Relationships: unknown resident ${id}`);
  return profile;
}

/** Determine one hidden taste after validating the item against the real catalog. */
export function residentGiftTaste(id: string, item: string): GiftTaste {
  if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, item)) throw new Error(`Relationships: unknown item ${item}`);
  const tastes = residentRelationshipProfile(id).tastes;
  for (const taste of ['love', 'like', 'dislike', 'hate'] as const) if (tastes[taste].includes(item)) return taste;
  return 'neutral';
}

/** Fail on incomplete social authoring before any progress or model prompt uses it. */
export function validateResidentRelationships(): void {
  const residentIds = TOWN_RESIDENTS.map(resident => resident.id);
  if (RESIDENT_RELATIONSHIPS.length !== residentIds.length || new Set(RESIDENT_RELATIONSHIPS.map(profile => profile.id)).size !== residentIds.length) {
    throw new Error('Relationships: every town resident needs exactly one profile');
  }
  for (const id of residentIds) {
    const profile = residentRelationshipProfile(id);
    if (!profile.adult || !profile.romanceable || !profile.bio.trim() || new Set(profile.traits).size !== 3
      || new Set(profile.drawnTo).size !== 2 || profile.drawnTo.includes(id)) throw new Error(`Relationships: incomplete profile for ${id}`);
    for (const preferred of profile.drawnTo) if (!residentIds.includes(preferred)) throw new Error(`Relationships: unknown attraction ${id}/${preferred}`);
    const authoredItems = Object.values(profile.tastes).flat();
    if (new Set(authoredItems).size !== authoredItems.length) throw new Error(`Relationships: duplicate taste item for ${id}`);
    for (const item of authoredItems) if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, item)) throw new Error(`Relationships: unknown taste item ${item}`);
    for (const tier of ['new', 'friend', 'close', 'romantic'] as const) {
      if (profile.dialogue[tier].some(line => !line.trim())) throw new Error(`Relationships: empty ${tier} dialogue for ${id}`);
    }
  }
  const expectedBondCount = residentIds.length * (residentIds.length - 1) / 2;
  if (RESIDENT_BONDS.length !== expectedBondCount || new Set(RESIDENT_BONDS.map(bond => bond.id)).size !== RESIDENT_BONDS.length) {
    throw new Error('Relationships: every unique NPC bond must exist once');
  }
  for (const bond of RESIDENT_BONDS) {
    if (bond.residents.some(id => !residentIds.includes(id)) || bond.id !== residentBondId(...bond.residents)) throw new Error(`Relationships: invalid NPC bond ${bond.id}`);
  }
}
