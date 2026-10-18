/**
 * ResidentMentionSystem — the one extra sentence that makes an authored Talk feel alive.
 *
 * ResidentDialogueSystem asks for it after RelationshipSystem picks the authored line. The sentence
 * either remembers the keeper's latest gift (from ResidentGiftMemorySystem) or mentions another
 * resident, worded by how that pair currently gets along (from the resident-bond journal). It reads
 * state only; it never changes friendship or bonds.
 *
 * Rules:
 *  - A gift from the last GIFT_MEMORY_DAYS days (not today) is remembered on the first talk of a day.
 *  - Otherwise every other conversation mentions a neighbor: the closest public bond, or, when the
 *    resident knows nobody yet, one neighbor picked by the day so it changes over the week.
 *  - Secret romances are never mentioned (the resident would not tell).
 */
import type { GiftTaste, ResidentId } from '../config/ResidentRelationships';
import { GameState } from '../state/GameState';
import { residentBondJournal, type ResidentBondStage, type ResidentBondView } from './RelationshipSystem';
import { recentResidentGifts } from './ResidentGiftMemorySystem';

/** How many days back a resident still brings up a gift. */
export const GIFT_MEMORY_DAYS = 7;

/** What a resident says about a gift they received, by how much they liked it. */
const GIFT_LINES: Record<GiftTaste, (label: string) => string> = {
  love: label => `I still smile about the ${label} you brought me.`,
  like: label => `Thank you again for the ${label}.`,
  neutral: label => `The ${label} you brought is still on my shelf.`,
  dislike: label => `About that ${label}... no hard feelings.`,
  hate: label => `Please, no more ${label}.`,
};

/** What a resident says about another resident, by their current bond stage. */
const NEIGHBOR_LINES: Record<ResidentBondStage, (name: string) => string> = {
  Strangers: name => `I keep meaning to say hello to ${name}.`,
  Acquaintances: name => `${name} waved at me this morning.`,
  Friends: name => `Have you met ${name}? Good company.`,
  Close: name => `${name} and I talked half the night yesterday.`,
  Attracted: name => `${name} has been on my mind lately.`,
  'Best Friends': name => `${name} is my best friend, you know.`,
  Together: name => `${name} and I are together now.`,
  'Open Partners': name => `${name} and I are together, in our own way.`,
  Hurt: name => `I am not speaking to ${name} right now.`,
};

/**
 * Pick the neighbor this resident talks about.
 * @param id the speaking resident
 * @param day today's day, used to rotate the pick when the resident knows nobody yet
 * @returns the bond to mention, or null when every bond is secret
 */
function neighborToMention(id: ResidentId, day: number): ResidentBondView | null {
  const bonds = residentBondJournal(id).filter(bond => !bond.secret);
  if (bonds.length === 0) return null;
  const closest = bonds.reduce((best, bond) => (bond.points > best.points ? bond : best));
  // why: before any town meetings every bond is 0 points; rotating by day keeps the mention fresh.
  return closest.points > 0 ? closest : bonds[day % bonds.length];
}

/**
 * The extra sentence for one authored Talk, or null when this talk adds nothing.
 * @param id the speaking resident
 * @param firstTalkToday true when this is the keeper's first Talk with them today
 * @param conversationIndex the resident's conversation count before this talk (alternates mentions)
 */
export function residentMentionLine(id: ResidentId, firstTalkToday: boolean, conversationIndex: number): string | null {
  const day = GameState.instance.day;
  if (firstTalkToday) {
    const gifts = recentResidentGifts(id);
    const latest = gifts[gifts.length - 1];
    if (latest && latest.day < day && day - latest.day <= GIFT_MEMORY_DAYS) return GIFT_LINES[latest.taste](latest.label);
  }
  if (conversationIndex % 2 === 0) return null;
  const bond = neighborToMention(id, day);
  if (!bond) return null;
  const otherName = bond.residents[0] === id ? bond.names[1] : bond.names[0];
  return NEIGHBOR_LINES[bond.stage](otherName);
}
