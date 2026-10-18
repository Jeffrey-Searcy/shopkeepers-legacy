/**
 * GuildBoardSystem — Seren's short jobs on the guild board.
 *
 * The board holds at most one job (progress.board.active). A job lasts two days: the day it goes
 * up and the next. A new game (and a migrated older save) starts with today's job already pinned
 * (ProgressSystem.createProgressState), so reading the board never changes state on its own.
 * refresh() runs each morning (BaseWorldScene.sleep) and whenever the guild menu reads the board,
 * which also covers a day change without sleep (debug day jumps):
 *  - a job past its due day comes down (free to fail: no penalty);
 *  - an empty board posts one new job, at most one post per day.
 * The posted job rotates by day through GUILD_REQUESTS, so early days ask for farm goods and later
 * days ask for gate loot. Turning a job in pays gold and Seren friendship.
 */
import { GUILD_REQUEST_FRIENDSHIP, guildRequestById, guildRequestForDay, type GuildRequest } from '../config/GuildRequests';
import { ITEM_CATALOG } from '../config/Items';
import { GameState } from '../state/GameState';
import { InventoryLayoutSystem } from './InventoryLayoutSystem';
import { InventorySystem } from './InventorySystem';
import { grantResidentFriendship } from './RelationshipSystem';

/** The live job as menus show it. */
export interface BoardJobView {
  request: GuildRequest;
  dueDay: number;
  /** True when today is the last day to turn it in. */
  dueToday: boolean;
}

/** Bring the board up to today: drop an expired job, post a new one if the board is empty. */
function refresh(): void {
  const gs = GameState.instance, board = gs.progress.board;
  if (board.active && gs.day > board.active.dueDay) board.active = null;
  if (board.active === null && board.lastPostedDay < gs.day) {
    const request = guildRequestForDay(gs.day);
    board.active = { id: request.id, postedDay: gs.day, dueDay: gs.day + 1 };
    board.lastPostedDay = gs.day;
  }
}

/** Refresh, then return the open job or null when today's job is already done. */
function current(): BoardJobView | null {
  refresh();
  const active = GameState.instance.progress.board.active;
  if (!active) return null;
  return { request: guildRequestById(active.id), dueDay: active.dueDay, dueToday: active.dueDay === GameState.instance.day };
}

/**
 * Turn in the open job: take the items, pay gold, and add Seren friendship.
 * @returns ok with a message, or not-ok with what is missing
 */
function turnIn(): { ok: boolean; message: string } {
  const job = current();
  if (!job) return { ok: false, message: 'The board is empty. Seren posts a new job tomorrow.' };
  const gs = GameState.instance, { request } = job;
  const label = ITEM_CATALOG[request.item].label;
  const nextGold = gs.gold + request.reward;
  if (!Number.isSafeInteger(nextGold)) throw new Error(`GuildBoard: gold overflow ${nextGold}`);
  if (!InventoryLayoutSystem.applyInventoryDelta(gs, { [request.item]: -request.qty })) {
    return { ok: false, message: `Seren needs ${request.qty} ${label}. You have ${InventorySystem.count(request.item)}.` };
  }
  gs.gold = nextGold;
  gs.progress.board.active = null;
  gs.progress.board.completed += 1;
  grantResidentFriendship('seren', GUILD_REQUEST_FRIENDSHIP);
  return { ok: true, message: `Job done. Seren pays ${request.reward} gold and smiles. A new job goes up tomorrow.` };
}

/** Public API for sleep, the guild menu and tests. */
export const GuildBoardSystem = Object.freeze({ refresh, current, turnIn });
