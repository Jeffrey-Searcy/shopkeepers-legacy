/** Authored, paired tavern chatter. Pure presentation data never spends money or changes guest state. */
import type { TavernGuest } from './Tavern';

/** One guest's side of a shared conversation beat; listeners react instead of repeating the line. */
export interface GuestConversation {
  topicId: string;
  line: string;
  speaking: boolean;
  reaction: 'smile' | 'laugh' | 'surprised' | 'nod';
  beat: number;
}

/** Four alternating lines form a small exchange, not four unrelated ambient barks. */
export const TAVERN_CONVERSATIONS = [
  { id: 'turnips', lines: ['My turnips won a prize.', 'For size or stubbornness?', 'Mostly stubbornness.', 'They take after you.'], reaction: 'laugh' },
  { id: 'rain', lines: ['Smells like rain.', 'That is my wet coat.', 'A reliable forecast.', 'Every single time.'], reaction: 'smile' },
  { id: 'fishing', lines: ['Caught a fish this big.', 'Your hands keep moving.', 'It grew on the walk here.', 'Naturally.'], reaction: 'laugh' },
  { id: 'cat', lines: ['A cat stole my breakfast.', 'Did you chase it?', 'It looked very busy.', 'Best leave it to work.'], reaction: 'smile' },
  { id: 'roads', lines: ['The road was all mud.', 'Yet your boots are clean.', 'I fell in the stream.', 'That explains the hat.'], reaction: 'surprised' },
  { id: 'stew', lines: ['That stew smells lovely.', 'I came back for seconds.', 'Before your first bowl?', 'I like to plan ahead.'], reaction: 'laugh' },
  { id: 'bed', lines: ['A real bed tonight.', 'No sleeping under stars?', 'They never stop staring.', 'Very rude of them.'], reaction: 'smile' },
  { id: 'bees', lines: ['Thinking of keeping bees.', 'Do the bees know?', 'I have not asked yet.', 'Start with a small gift.'], reaction: 'nod' },
  { id: 'bread', lines: ['I tried baking bread.', 'How did it turn out?', 'Makes a fine doorstop.', 'A useful first loaf.'], reaction: 'laugh' },
  { id: 'music', lines: ['Know any good songs?', 'Only the wrong words.', 'Those are my favorites.', 'Then we make a duet.'], reaction: 'smile' },
  { id: 'boots', lines: ['These boots are new.', 'They look well traveled.', 'New to me, I meant.', 'Then welcome them in.'], reaction: 'nod' },
  { id: 'stars', lines: ['Saw a falling star.', 'Did you make a wish?', 'A warm meal and a chair.', 'One wish well spent.'], reaction: 'smile' },
] as const;

/** Derive a shared clock and topic from a real pair. Both sides always agree on who speaks. */
export function conversationFor(guest: TavernGuest, partner: TavernGuest, day: number, pocket: number): GuestConversation {
  if (guest.id === partner.id || guest.phase !== 'chatting' || partner.phase !== 'chatting') {
    throw new Error('Tavern conversation requires two distinct chatting guests');
  }
  if (!Number.isInteger(pocket) || pocket < 0 || pocket > 3) throw new Error('Tavern conversation pocket must match one of the four authored pairs');
  const low = Math.min(guest.id, partner.id), high = Math.max(guest.id, partner.id);
  const hash = (Math.imul(low, 0x45d9f3b) ^ Math.imul(high, 0x119de1f3) ^ Math.imul(guest.orders + partner.orders, 31)) >>> 0;
  // Layout has four stable paired pockets. Disjoint three-topic banks prevent simultaneous repeats;
  // the common day rotation changes every bank without shifting an ongoing pair when someone arrives.
  const topic = TAVERN_CONVERSATIONS[(pocket * 3 + hash % 3 + day * 5) % TAVERN_CONVERSATIONS.length];
  // The newer arrival starts the shared exchange. A completed exchange rests until someone leaves.
  const elapsed = Math.min(guest.elapsedMs, partner.elapsedMs);
  const beat = Math.min(3, Math.floor(elapsed / 1900));
  const speaking = elapsed < 7600 && guest.id === (beat % 2 === 0 ? low : high);
  return { topicId: topic.id, line: speaking ? topic.lines[beat] : '', speaking, reaction: topic.reaction, beat };
}
