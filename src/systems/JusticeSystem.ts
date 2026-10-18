/**
 * JusticeSystem owns durable resident boundaries and the narrow consequences of supervised chat.
 * The local model can label speech severity, but only this system can change relationships or request arrest.
 */
import { RESIDENT_RELATIONSHIPS, residentRelationshipProfile, type ResidentId } from '../config/ResidentRelationships';
import { GameState } from '../state/GameState';

export type ResidentChatOutcome = 'continue' | 'warning' | 'end-conversation' | 'call-guard';
export type JusticeSeverity = 'lesser' | 'severe';

/** One resident's current-day boundary state. Day numbers make rollover explicit without reset jobs. */
export interface ResidentBoundaryState {
  warningDay: number | null;
  refusalDay: number | null;
}

/** One bounded record of a consequence that game code accepted. Raw player text is never stored here. */
export interface JusticeIncident {
  residentId: ResidentId;
  day: number;
  severity: JusticeSeverity;
}

/** Complete durable justice payload. It does not add the service guard to the romance network. */
export interface JusticeState {
  residents: Record<ResidentId, ResidentBoundaryState>;
  incidents: JusticeIncident[];
  /** Inclusive release day for residents caught in a witnessed Cuddle, or null when free. */
  residentJailUntilDay: Record<ResidentId, number | null>;
}

const WARNING_POINTS_LOST = 25;
const REFUSAL_POINTS_LOST = 50;
const ARREST_POINTS_LOST = 250;
const MAX_INCIDENTS = 24;

/** Create exact empty boundary records for every romanceable resident. */
export function createJusticeState(): JusticeState {
  return {
    residents: Object.fromEntries(RESIDENT_RELATIONSHIPS.map(profile => [profile.id, {
      warningDay: null,
      refusalDay: null,
    }])) as Record<ResidentId, ResidentBoundaryState>,
    incidents: [],
    residentJailUntilDay: Object.fromEntries(RESIDENT_RELATIONSHIPS.map(profile => [profile.id, null])) as Record<ResidentId, number | null>,
  };
}

/** Validate the complete v15 payload before adding the v16 resident-jail record. */
export function migrateV15JusticeState(value: unknown, currentDay: number): JusticeState {
  const legacy = validateJusticeState(value, currentDay, true);
  return { ...legacy,
    residentJailUntilDay: Object.fromEntries(RESIDENT_RELATIONSHIPS.map(profile => [profile.id, null])) as Record<ResidentId, number | null> };
}

/** Validate unknown saved justice data and return a detached copy. */
export function validateJusticeState(value: unknown, currentDay: number, legacyV15 = false): JusticeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Justice save must be an object');
  const root = value as Record<string, unknown>;
  const expectedRoot = legacyV15 ? 'incidents,residents' : 'incidents,residentJailUntilDay,residents';
  if (Object.keys(root).sort().join(',') !== expectedRoot) throw new Error('Justice save has unknown or missing fields');
  if (!root.residents || typeof root.residents !== 'object' || Array.isArray(root.residents)) {
    throw new Error('Justice save residents must be an object');
  }
  const source = root.residents as Record<string, unknown>;
  const expected = RESIDENT_RELATIONSHIPS.map(profile => profile.id).sort();
  if (Object.keys(source).sort().join(',') !== expected.join(',')) throw new Error('Justice save must contain every resident exactly once');
  const residents = {} as Record<ResidentId, ResidentBoundaryState>;
  const dayValue = (item: unknown, label: string): number | null => {
    if (item === null) return null;
    if (!Number.isSafeInteger(item) || (item as number) < 1 || (item as number) > currentDay) throw new Error(`Justice save ${label} is invalid`);
    return item as number;
  };
  for (const id of expected) {
    const raw = source[id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Justice save ${id} must be an object`);
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'refusalDay,warningDay') throw new Error(`Justice save ${id} has unknown or missing fields`);
    residents[id as ResidentId] = {
      warningDay: dayValue(record.warningDay, `${id}.warningDay`),
      refusalDay: dayValue(record.refusalDay, `${id}.refusalDay`),
    };
  }
  if (!Array.isArray(root.incidents) || root.incidents.length > MAX_INCIDENTS) throw new Error('Justice save incidents are invalid');
  const incidents = root.incidents.map((raw, index): JusticeIncident => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Justice save incident ${index} must be an object`);
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'day,residentId,severity') throw new Error(`Justice save incident ${index} has unknown or missing fields`);
    const residentId = record.residentId as ResidentId;
    residentRelationshipProfile(residentId);
    if (!Number.isSafeInteger(record.day) || (record.day as number) < 1 || (record.day as number) > currentDay) {
      throw new Error(`Justice save incident ${index}.day is invalid`);
    }
    if (record.severity !== 'lesser' && record.severity !== 'severe') throw new Error(`Justice save incident ${index}.severity is invalid`);
    return { residentId, day: record.day as number, severity: record.severity };
  });
  if (legacyV15) return { residents, incidents, residentJailUntilDay: {} as Record<ResidentId, number | null> };
  if (!root.residentJailUntilDay || typeof root.residentJailUntilDay !== 'object' || Array.isArray(root.residentJailUntilDay)) {
    throw new Error('Justice save resident jail days must be an object');
  }
  const jailSource = root.residentJailUntilDay as Record<string, unknown>;
  if (Object.keys(jailSource).sort().join(',') !== expected.join(',')) {
    throw new Error('Justice save resident jail days must contain every resident exactly once');
  }
  const residentJailUntilDay = {} as Record<ResidentId, number | null>;
  for (const id of expected) {
    const release = jailSource[id];
    if (release !== null && (!Number.isSafeInteger(release) || (release as number) < 1)) {
      throw new Error(`Justice save ${id}.residentJailUntilDay is invalid`);
    }
    residentJailUntilDay[id as ResidentId] = release as number | null;
  }
  return { residents, incidents, residentJailUntilDay };
}

/** Deep-clone justice state through the same strict save validator. */
export function cloneJusticeState(value: JusticeState, currentDay: number): JusticeState {
  return validateJusticeState(JSON.parse(JSON.stringify(value)) as unknown, currentDay);
}

/** Read the only boundary facts sent to the local supervisor. */
export function residentBoundaryContext(id: ResidentId): { warningActive: boolean; refusedToday: boolean } {
  residentRelationshipProfile(id);
  const gs = GameState.instance;
  const state = gs.justice.residents[id];
  return { warningActive: state.warningDay === gs.day, refusedToday: state.refusalDay === gs.day };
}

/** Return whether this resident has ended local chat for the current day. */
export function residentRefusesChatToday(id: ResidentId): boolean {
  return residentBoundaryContext(id).refusedToday;
}

/** Apply one validated outcome. The model never receives this mutator or any other game authority. */
export function applyResidentChatOutcome(id: ResidentId, outcome: ResidentChatOutcome): void {
  residentRelationshipProfile(id);
  const gs = GameState.instance;
  const boundary = gs.justice.residents[id];
  if (outcome === 'continue') return;
  const relationship = gs.relationships.residents[id];
  const losePoints = (amount: number): void => { relationship.points = Math.max(0, relationship.points - amount); };
  if (outcome === 'warning') {
    boundary.warningDay = gs.day;
    losePoints(WARNING_POINTS_LOST);
    gs.justice.incidents.push({ residentId: id, day: gs.day, severity: 'lesser' });
  } else if (outcome === 'end-conversation') {
    boundary.refusalDay = gs.day;
    losePoints(REFUSAL_POINTS_LOST);
    gs.justice.incidents.push({ residentId: id, day: gs.day, severity: 'lesser' });
  } else if (outcome === 'call-guard') {
    boundary.refusalDay = gs.day;
    losePoints(ARREST_POINTS_LOST);
    gs.justice.incidents.push({ residentId: id, day: gs.day, severity: 'severe' });
    gs.arrestRequested = true;
  } else {
    throw new Error(`Justice: unknown resident chat outcome ${String(outcome)}`);
  }
  if (gs.justice.incidents.length > MAX_INCIDENTS) gs.justice.incidents.splice(0, gs.justice.incidents.length - MAX_INCIDENTS);
}

/** Return whether a resident remains in the holding cells on the current game day. */
export function isResidentJailed(id: ResidentId): boolean {
  residentRelationshipProfile(id);
  const releaseDay = GameState.instance.justice.residentJailUntilDay[id];
  return releaseDay !== null && GameState.instance.day < releaseDay;
}

/** Commit one witnessed Cuddle report through the same guard authority used by severe chat. */
export function reportCuddleIncident(witnessId: ResidentId, caughtPlayer: boolean, caughtResidents: readonly ResidentId[]): void {
  residentRelationshipProfile(witnessId);
  if (!caughtPlayer && caughtResidents.length === 0) throw new Error('Justice: a Cuddle report must identify someone caught');
  const uniqueResidents = [...new Set(caughtResidents)];
  for (const id of uniqueResidents) {
    residentRelationshipProfile(id);
    GameState.instance.justice.residentJailUntilDay[id] = GameState.instance.day + 1;
  }
  const gs = GameState.instance;
  gs.justice.incidents.push({ residentId: witnessId, day: gs.day, severity: 'severe' });
  if (gs.justice.incidents.length > MAX_INCIDENTS) gs.justice.incidents.splice(0, gs.justice.incidents.length - MAX_INCIDENTS);
  if (caughtPlayer) gs.arrestRequested = true;
}
