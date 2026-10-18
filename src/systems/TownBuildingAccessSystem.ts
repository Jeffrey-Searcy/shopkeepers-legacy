/**
 * Relationship-aware visiting hours for the town's combined public business and home interiors.
 * This policy is pure: TownScene owns player feedback, while future NPC routes can skip denied stops.
 */
import type { ResidentId } from '../config/ResidentRelationships';
import { residentBondId } from '../config/ResidentRelationships';
import { townBuilding, type TownBuildingId } from '../config/TownBuildings';
import { residentForBuilding } from '../config/TownResidents';
import type { RelationshipsState } from './RelationshipSystem';

export const TOWN_BUILDING_OPEN = 2 * 60;
export const TOWN_BUILDING_CLOSE = 14 * 60;
export const TOWN_BAR_CLOSE = 18 * 60;

/** A visitor is either the player or one permanent resident. */
export type TownBuildingVisitor = { kind: 'player' } | { kind: 'resident'; residentId: ResidentId };

/** Exact access result used by doors and schedule-stop filtering. */
export interface TownBuildingAccess {
  allowed: boolean;
  reason: 'open' | 'owner' | 'partner' | 'closed';
  message: string;
}

/** Return whether public visiting hours include this game-clock minute. */
export function townBuildingIsOpen(buildingId: TownBuildingId, timeOfDay: number): boolean {
  if (!Number.isFinite(timeOfDay) || timeOfDay < 0 || timeOfDay > 24 * 60) {
    throw new Error(`Town building access: invalid time ${timeOfDay}`);
  }
  townBuilding(buildingId);
  const close = buildingId === 'bar' ? TOWN_BAR_CLOSE : TOWN_BUILDING_CLOSE;
  return timeOfDay >= TOWN_BUILDING_OPEN && timeOfDay < close;
}

/** Decide entry without changing time, relationships, position, or scene state. */
export function townBuildingAccess(buildingId: TownBuildingId, timeOfDay: number, visitor: TownBuildingVisitor,
  relationships: RelationshipsState): TownBuildingAccess {
  const building = townBuilding(buildingId), owner = residentForBuilding(buildingId);
  if (visitor.kind === 'resident' && visitor.residentId === owner.id) {
    return { allowed: true, reason: 'owner', message: `${owner.name} lives here.` };
  }
  if (visitor.kind === 'player') {
    const stage = relationships.residents[owner.id].romanceStage;
    if (stage === 'dating' || stage === 'committed') {
      return { allowed: true, reason: 'partner', message: `${owner.name} trusts you here after hours.` };
    }
  } else {
    const bond = relationships.bonds[residentBondId(visitor.residentId, owner.id)];
    if (!bond) throw new Error(`Town building access: missing bond for ${visitor.residentId} and ${owner.id}`);
    if (bond.exclusive) return { allowed: true, reason: 'partner', message: `${owner.name}'s partner may enter.` };
  }
  if (townBuildingIsOpen(buildingId, timeOfDay)) return { allowed: true, reason: 'open', message: `${building.name} is open.` };
  const hours = buildingId === 'bar' ? '8 AM to midnight' : '8 AM to 8 PM';
  return { allowed: false, reason: 'closed', message: `${building.name} is closed. Hours: ${hours}.` };
}

/** Remove closed or relationship-blocked building stops so an NPC route can continue. */
export function accessibleTownBuildingStops(buildingIds: readonly TownBuildingId[], timeOfDay: number,
  visitor: TownBuildingVisitor, relationships: RelationshipsState): TownBuildingId[] {
  return buildingIds.filter(buildingId => townBuildingAccess(buildingId, timeOfDay, visitor, relationships).allowed);
}
