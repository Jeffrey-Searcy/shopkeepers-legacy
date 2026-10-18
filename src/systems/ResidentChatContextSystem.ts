/**
 * ResidentChatContextSystem — the real world facts a resident's local-model chat is grounded in.
 *
 * Playtest note: residents "talked about things that wouldn't happen in game". The model only knew
 * friendship numbers, so it filled the gaps by inventing places and events. This module gives it the
 * facts it needs to stay inside the game: where the talk happens, what the resident's plan says they
 * are doing, the clock, weather, season, recent town news, and the list of places that really exist.
 *
 * The result is sent to scripts/npc-chat-server.mjs as `context.world`. The supervisor validates the
 * exact shape again before any of it reaches the prompt (the server never trusts the browser).
 *
 * Data shape (ResidentChatWorld, exact keys):
 *  - place: where the keeper and the resident are talking, e.g. "Enchanter’s Cottage";
 *  - indoors: true inside a building;
 *  - activity: the resident's planned activity right now (see residentActivityLabel);
 *  - weekday / day / clock: calendar facts, clock like "2:30 pm";
 *  - season / weather: today's season and weather;
 *  - news: up to three short town news sentences this resident knows;
 *  - places: every real place name; town buildings name their keeper, e.g. "Garden Clinic (Sylvie)".
 */
import { SceneKey } from '../config/AssetKeys';
import { seasonForDay, type Season } from '../config/Crops';
import type { ResidentId } from '../config/ResidentRelationships';
import { GUARDHOUSE_BUILDING, TOWN_BUILDINGS } from '../config/TownBuildings';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState } from '../state/GameState';
import { TownLifeSystem, townClockLabel } from './TownLifeSystem';
import { TOWN_ROUTE_WEEKDAYS } from './TownRoutePlanSystem';
import { residentActivityLabel } from './TownScheduleSystem';
import { WeatherSystem, type Weather } from './WeatherSystem';

/** World facts for one resident chat turn. Exact keys; see the file header. */
export interface ResidentChatWorld {
  place: string;
  indoors: boolean;
  activity: string;
  weekday: typeof TOWN_ROUTE_WEEKDAYS[number];
  day: number;
  clock: string;
  season: Season;
  weather: Weather;
  news: string[];
  places: string[];
}

/**
 * Place names for world scenes that are not resident buildings. Building scenes take their name
 * from TOWN_BUILDINGS / GUARDHOUSE_BUILDING so a renamed building never drifts out of the prompt.
 */
const OPEN_PLACES: Readonly<Partial<Record<SceneKey, { name: string; indoors: boolean }>>> = {
  [SceneKey.Farm]: { name: "the keeper's farm", indoors: false },
  [SceneKey.Town]: { name: 'the town streets', indoors: false },
  [SceneKey.Home]: { name: "the keeper's home", indoors: true },
  [SceneKey.Bedroom]: { name: "the keeper's bedroom", indoors: true },
  [SceneKey.Tavern]: { name: "the keeper's tavern", indoors: true },
  [SceneKey.Forest]: { name: 'the forest', indoors: false },
  [SceneKey.Beach]: { name: 'the beach', indoors: false },
  [SceneKey.Mountain]: { name: 'the mountain path', indoors: false },
  [SceneKey.Mines]: { name: 'the mines', indoors: true },
  [SceneKey.GatePlaza]: { name: 'the portal gate plaza', indoors: false },
};

/**
 * Name and indoor flag for the keeper's current scene.
 * @param scene the keeper's active world scene
 * @throws for a scene where resident chat cannot happen (menus, editors, the dungeon)
 */
function placeFor(scene: SceneKey): { name: string; indoors: boolean } {
  const building = [...TOWN_BUILDINGS, GUARDHOUSE_BUILDING].find(entry => entry.scene === scene);
  if (building) return { name: building.name, indoors: true };
  const open = OPEN_PLACES[scene];
  if (!open) throw new Error(`Resident chat context: no place name for scene ${scene}`);
  return open;
}

/** Every real place, for the prompt's "only these places exist" list. Built once; the map never changes. */
const REAL_PLACES: readonly string[] = Object.freeze([
  ...TOWN_BUILDINGS.map(building => {
    const keeper = TOWN_RESIDENTS.find(resident => resident.buildingId === building.id);
    if (!keeper) throw new Error(`Resident chat context: no keeper for ${building.id}`);
    return `${building.name} (${keeper.name})`;
  }),
  GUARDHOUSE_BUILDING.name,
  ...Object.values(OPEN_PLACES).map(place => place!.name),
]);

/**
 * Build the world facts for one chat turn with `id`.
 * @param id the resident the keeper is talking to
 * @returns a fresh object (safe to send as JSON)
 */
export function residentChatWorld(id: ResidentId): ResidentChatWorld {
  const gs = GameState.instance, place = placeFor(gs.activeScene);
  // why: the clock is a float during play; townClockLabel needs a whole minute.
  const minute = Math.floor(gs.timeOfDay);
  return {
    place: place.name,
    indoors: place.indoors,
    activity: residentActivityLabel(id, gs.day, minute),
    weekday: TOWN_ROUTE_WEEKDAYS[(gs.day - 1) % TOWN_ROUTE_WEEKDAYS.length],
    day: gs.day,
    clock: townClockLabel(minute),
    season: seasonForDay(gs.day),
    weather: WeatherSystem.forDay(gs.day),
    news: TownLifeSystem.newsContext([id]),
    places: [...REAL_PLACES],
  };
}
