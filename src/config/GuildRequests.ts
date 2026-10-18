/**
 * GuildRequests — the pool of short jobs Seren posts on the guild board.
 *
 * Each morning with no open job, the board posts one request from this pool, rotating by day
 * (day 1 posts the first entry), so early days ask for farm goods and later days for gate loot. A job lasts two days: the day it is posted and the next one.
 * Missing it costs nothing — the request just comes down and a new one goes up ("free to fail").
 * GuildBoardSystem owns the timing and the hand-in; this file only holds WHAT is asked and paid.
 */
import { ITEM_CATALOG } from './Items';

/** One board job: bring `qty` of `item` to the guild board for `reward` gold (+ Seren friendship). */
export interface GuildRequest {
  readonly id: string;
  readonly item: string;
  readonly qty: number;
  readonly reward: number;
  /** Short line Seren pins to the board, shown in the guild menu. */
  readonly note: string;
}

/** Friendship points Seren gives for each finished job (250 points = one heart). */
export const GUILD_REQUEST_FRIENDSHIP = 60;

/** Rotation order. Early jobs use farm and pond goods; later ones send the keeper into the gate. */
export const GUILD_REQUESTS: readonly GuildRequest[] = [
  { id: 'wall-stone', item: 'stone', qty: 12, reward: 60, note: 'The east wall needs patching.' },
  { id: 'rope-fiber', item: 'fiber', qty: 10, reward: 40, note: 'Rope for the north trail crew.' },
  { id: 'crew-sardines', item: 'fish-sardine', qty: 2, reward: 110, note: 'Lunch for the trail crew.' },
  { id: 'slime-samples', item: 'slime-gel', qty: 3, reward: 75, note: 'Cael wants slime samples.' },
  { id: 'barricade-wood', item: 'wood', qty: 15, reward: 55, note: 'Timber for the gate barricade.' },
  { id: 'crew-parsnips', item: 'parsnip', qty: 3, reward: 130, note: 'Fresh food for the night watch.' },
  { id: 'bat-wings', item: 'bat-wing', qty: 2, reward: 70, note: 'Bat wings for Nyra\'s charms.' },
  { id: 'gate-shards', item: 'portal-shard', qty: 2, reward: 120, note: 'Shards to study the gate.' },
];

/** Check the pool at module load: unique ids, real items, positive amounts. */
function validateGuildRequests(requests: readonly GuildRequest[]): void {
  if (requests.length === 0) throw new Error('GuildRequests: the pool is empty');
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.id)) throw new Error(`GuildRequests: duplicate id ${request.id}`);
    seen.add(request.id);
    if (!Object.prototype.hasOwnProperty.call(ITEM_CATALOG, request.item)) throw new Error(`GuildRequests: ${request.id} asks for unknown item ${request.item}`);
    if (!Number.isSafeInteger(request.qty) || request.qty < 1) throw new Error(`GuildRequests: ${request.id} has an invalid quantity`);
    if (!Number.isSafeInteger(request.reward) || request.reward < 1) throw new Error(`GuildRequests: ${request.id} has an invalid reward`);
  }
}
validateGuildRequests(GUILD_REQUESTS);

/**
 * Look up one request by id.
 * @throws when the id is not in the pool
 */
export function guildRequestById(id: string): GuildRequest {
  const request = GUILD_REQUESTS.find(entry => entry.id === id);
  if (!request) throw new Error(`GuildRequests: unknown request ${id}`);
  return request;
}

/** True when the id names a request in the pool (used by save validation). */
/**
 * The job the board posts on a given day (the pool rotates by day; day 1 posts the first entry).
 * @param day a game day, 1 or later
 */
export function guildRequestForDay(day: number): GuildRequest {
  if (!Number.isSafeInteger(day) || day < 1) throw new Error(`GuildRequests: invalid day ${day}`);
  return GUILD_REQUESTS[(day - 1) % GUILD_REQUESTS.length];
}

export function isGuildRequest(id: string): boolean {
  return GUILD_REQUESTS.some(entry => entry.id === id);
}
