/**
 * WayfarerSeats — where guests sit in The Wayfarer (the Town bar) on its busy Wednesday night.
 *
 * On a normal day a bar visitor paces the room loop. On Wayfarer night each guest sits in one fixed seat
 * instead, so the crowd looks like a crowd: two tables and the bar stools. Seats are fixed per resident,
 * so a guest who arrives late never pushes someone else out of their chair.
 *
 * Tiles are TownBarScene tiles in the painted Wayfarer (world/CivicRoomArt.ts BAR_WALK). Each seat is a chair or
 * stool painted into the room, so it is a solid tile and the guest is placed on it directly (never walked there).
 * Every seat has a walkable tile beside it, so the keeper can face the guest and talk. Table A is near (3..6, 8..11),
 * table B near (14..18, 8..11), and the stools stand in row 7 below the counter (x 8, 10 and 12).
 */
import type { ResidentId } from './ResidentRelationships';
import { TOWN_RESIDENTS } from './TownResidents';
import { CIVIC_ROOM_ART } from '../world/CivicRoomArt';

/** One seat: a tile and the way the sitter faces. */
export interface WayfarerSeat {
  tx: number;
  ty: number;
  facing: 'down' | 'up' | 'left' | 'right';
}

/**
 * One seat per guest, authored by hand. The usual Wednesday crowd (Tessa, Seren, Rowan, Dorian at table A;
 * Bram, Kit, Cael at table B) shares the two tables; anyone else who drops in takes a stool or table B's last chair.
 */
const SEATS_BY_RESIDENT: Readonly<Record<string, WayfarerSeat>> = {
  tessa: { tx: 4, ty: 8, facing: 'down' }, seren: { tx: 6, ty: 9, facing: 'left' },
  rowan: { tx: 3, ty: 11, facing: 'up' }, dorian: { tx: 2, ty: 9, facing: 'right' },
  bram: { tx: 16, ty: 8, facing: 'down' }, kit: { tx: 18, ty: 9, facing: 'left' },
  cael: { tx: 16, ty: 11, facing: 'up' }, nyra: { tx: 14, ty: 9, facing: 'right' },
  rhea: { tx: 8, ty: 7, facing: 'up' }, sylvie: { tx: 10, ty: 7, facing: 'up' }, elowen: { tx: 12, ty: 7, facing: 'up' },
};

/** Which table a seat belongs to: 'a', 'b', or 'bar' for the stools. */
export function wayfarerSeatGroup(seat: WayfarerSeat): 'a' | 'b' | 'bar' {
  if (seat.ty === 7) return 'bar';
  return seat.tx < 12 ? 'a' : 'b';
}

/**
 * The fixed Wayfarer-night seat of one guest. The bar's owner works the counter and has no seat.
 * @param id resident id
 * @throws when the resident has no seat (unknown, or the bar's owner)
 */
export function wayfarerSeat(id: ResidentId): WayfarerSeat {
  const seat = SEATS_BY_RESIDENT[id];
  if (!seat) throw new Error(`Wayfarer seats: ${id} has no seat`);
  return seat;
}

/**
 * Check at boot that every guest has exactly one seat, no two guests share one, and the keeper can stand beside
 * every seat to talk (at least one walkable neighbour in the painted bar).
 * @throws on the first broken seat
 */
export function validateWayfarerSeats(): void {
  const guests = TOWN_RESIDENTS.filter(resident => resident.buildingId !== 'bar').map(resident => resident.id);
  const keys = Object.keys(SEATS_BY_RESIDENT);
  if (keys.length !== guests.length || guests.some(id => !SEATS_BY_RESIDENT[id])) throw new Error('Wayfarer seats: every guest needs one seat');
  const tiles = new Set(keys.map(id => `${SEATS_BY_RESIDENT[id].tx},${SEATS_BY_RESIDENT[id].ty}`));
  if (tiles.size !== keys.length) throw new Error('Wayfarer seats: two guests share a seat');
  const walk = CIVIC_ROOM_ART.bar.walk;
  const walkable = (tx: number, ty: number): boolean => walk[ty] !== undefined && walk[ty][tx] === '.';
  for (const id of keys) {
    const { tx, ty } = SEATS_BY_RESIDENT[id];
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(tx + dx, ty + dy))) {
      throw new Error(`Wayfarer seats: the keeper cannot reach ${id}'s seat at ${tx},${ty}`);
    }
  }
}
