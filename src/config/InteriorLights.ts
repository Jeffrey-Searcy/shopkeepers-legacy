/**
 * Light sources for indoor rooms. Each room lists where its fires, candles, lamps and windows are, in world
 * pixels. The InteriorLighting renderer (src/world/InteriorLighting.ts) turns this list into darkness with warm
 * holes in it, plus a soft colored glow, so rooms read as lamp-lit at night and gently shaded by day.
 *
 * This file is pure data: positions match art that the room renderers already draw (civic wall sconces, home
 * stoves and dresser lamps), or name new art for the renderer to draw ('art' other than 'none').
 * The painted civic rooms and the jail use positions measured from their paintings (flame centres, in tiles),
 * and never ask for drawn art, because every lamp is already part of the picture.
 */
import { TILE } from './GameConfig';
import type { TownBuilding } from './TownBuildings';
import { civicInteriorBlueprint } from './CivicInteriors';
import type { PaintedCivicId } from '../world/CivicRoomArt';

/** How a light moves over time: fire dances, candles waver, crystals pulse, lamps and windows hold still. */
export type InteriorLightKind = 'fire' | 'candle' | 'lamp' | 'crystal' | 'window';
/**
 * Art the lighting renderer draws for a light. 'none' means the room already draws the object (for example
 * the civic wall sconces and the home-wing stoves); the light only adds brightness there.
 */
export type InteriorLightArt = 'none' | 'wall-lantern' | 'table-candle' | 'counter-lamp' | 'hearth';

/**
 * One light in a room.
 * - x, y: the light's center in world pixels (for drawn art, the base of the flame).
 * - radius: how far the light reaches, in world pixels.
 * - color: the warm (or cool) tint of its glow.
 * - strength: 0..1, how much darkness it removes at its center.
 * - glow: 0..1, how strong its colored glow is at full night.
 * - depth: draw depth for its art (ignored when art is 'none').
 */
export interface InteriorLight {
  id: string;
  kind: InteriorLightKind;
  art: InteriorLightArt;
  x: number;
  y: number;
  radius: number;
  color: number;
  strength: number;
  glow: number;
  depth: number;
}

/** Warm candle and fire tints shared by every room. */
const FIRE = 0xff9a3c, CANDLE = 0xffc070, LAMP = 0xffd98c;

/**
 * Build one light record. Keeps every light field explicit at the call site through a single options object.
 * @param light every light field
 * @returns the same light, frozen so a room list can never be edited at runtime
 */
function light(light: InteriorLight): InteriorLight {
  return Object.freeze(light);
}

/**
 * A wall sconce or lantern hung on the top wall band.
 * @param id stable name for tests and debugging
 * @param x flame x in world pixels
 * @param art 'none' when the room already draws the sconce, 'wall-lantern' to draw a new lantern
 * @param y flame y in world pixels (top wall band is about y 10..44)
 */
function sconce(id: string, x: number, art: InteriorLightArt, y = 30): InteriorLight {
  return light({ id, kind: 'candle', art, x, y, radius: 78, color: CANDLE, strength: 0.78, glow: 0.2, depth: 53 });
}

/**
 * The lights every resident home wing shares: the iron stove's fire and the bedroom dresser lamp.
 * why: both civic rooms and the Market draw these at the same offsets from the wing's left edge (measured from
 * the room renderers: stove mouth at +31,57 and dresser lamp at +157,186).
 * @param prefix id prefix for this room
 * @param baseX world x of the home wing's left edge
 */
function homeWingLights(prefix: string, baseX: number): InteriorLight[] {
  return [
    light({ id: `${prefix}-home-stove`, kind: 'fire', art: 'none', x: baseX + 31, y: 60, radius: 84, color: FIRE,
      strength: 0.82, glow: 0.24, depth: 0 }),
    light({ id: `${prefix}-bedroom-lamp`, kind: 'lamp', art: 'none', x: baseX + 157, y: 184, radius: 74, color: LAMP,
      strength: 0.8, glow: 0.2, depth: 0 }),
  ];
}

/**
 * How a painted light behaves. The painting already shows the flame, so each preset only sets reach and tint.
 * - candle: a small flame (wall candle, table candle)
 * - lantern: a hanging or standing lantern (a steadier, wider flame)
 * - lamp: an oil lamp on a counter or dresser (still, warm-white)
 * - fire: a stove, furnace, hearth or torch
 * - violet / blue: a magic crystal or orb glow in that colour
 */
type PaintedLightPreset = 'candle' | 'lantern' | 'lamp' | 'fire' | 'violet' | 'blue';

/** One measured light in a painting: [name, preset, tile x, tile y] of the flame centre. */
type PaintedLightSpot = readonly [name: string, preset: PaintedLightPreset, tx: number, ty: number];

/**
 * Turn one measured spot into a light. Art is always 'none' because the painting draws the flame.
 * @param room id prefix (room or 'jail')
 * @param spot the measured flame centre and its preset
 * @param scale 0..1 multiplier on strength and glow (1 for normal rooms; the jail cell uses less)
 * @returns the frozen light
 */
function paintedLight(room: string, [name, preset, tx, ty]: PaintedLightSpot, scale = 1): InteriorLight {
  const x = tx * TILE, y = ty * TILE, id = `${room}-${name}`;
  const base = { id, art: 'none' as const, x, y, depth: 0 };
  switch (preset) {
    case 'candle': return light({ ...base, kind: 'candle', radius: 70, color: CANDLE, strength: 0.76 * scale, glow: 0.2 * scale });
    case 'lantern': return light({ ...base, kind: 'candle', radius: 84, color: CANDLE, strength: 0.8 * scale, glow: 0.22 * scale });
    case 'lamp': return light({ ...base, kind: 'lamp', radius: 84, color: LAMP, strength: 0.8 * scale, glow: 0.22 * scale });
    case 'fire': return light({ ...base, kind: 'fire', radius: 100, color: FIRE, strength: 0.86 * scale, glow: 0.28 * scale });
    case 'violet': return light({ ...base, kind: 'crystal', radius: 80, color: 0xc58cff, strength: 0.72 * scale, glow: 0.26 * scale });
    case 'blue': return light({ ...base, kind: 'crystal', radius: 80, color: 0x8fd4ff, strength: 0.72 * scale, glow: 0.26 * scale });
  }
}

/**
 * Every light in each painted civic room, measured from the painting (flame centres in tile units).
 * why: the paintings are fixed images, so these numbers only change if a painting is re-packed with a new crop.
 */
const PAINTED_LIGHTS: Readonly<Record<PaintedCivicId, readonly PaintedLightSpot[]>> = {
  forge: [
    ['furnace-left', 'fire', 4.6, 4.8], ['furnace-right', 'fire', 6.6, 4.8],
    ['wall-candle-0', 'candle', 1.75, 2.3], ['wall-candle-1', 'candle', 8.0, 1.9], ['wall-candle-2', 'candle', 21.7, 1.9],
    ['table-candle', 'candle', 9.3, 3.6], ['map-table-candle', 'candle', 5.7, 11.6],
    ['door-lantern-left', 'lantern', 9.7, 14.8], ['door-lantern-right', 'lantern', 14.7, 14.8],
    ['home-stove', 'fire', 26.3, 3.5], ['bedroom-candle-0', 'candle', 27.2, 9.4], ['bedroom-candle-1', 'candle', 31, 9.4],
    ['nightstand-lantern', 'lantern', 27.5, 11.4], ['dresser-candle', 'candle', 33.5, 11.3],
  ],
  magic: [
    ['candle-0', 'candle', 4.1, 1.4], ['candle-1', 'candle', 10.1, 1.6], ['candle-2', 'candle', 14.1, 1.5],
    ['candle-3', 'candle', 17.8, 1.6], ['candle-4', 'candle', 5.1, 3.2], ['candle-5', 'candle', 15.1, 3.3],
    ['candle-6', 'candle', 14.8, 7.6], ['candle-7', 'candle', 9.3, 9.4], ['candle-8', 'candle', 4.8, 10.7],
    ['candle-9', 'candle', 8.0, 5.6],
    ['door-torch-left', 'fire', 7.7, 13.0], ['door-torch-right', 'fire', 12.3, 13.0],
    ['crystal-violet', 'violet', 2.8, 5.5], ['crystal-blue', 'blue', 1.7, 7.4], ['orb', 'blue', 10.0, 5.7],
    ['home-stove', 'fire', 21.5, 3.2], ['bedroom-candle-0', 'candle', 22.5, 9.5], ['bedroom-candle-1', 'candle', 27.7, 9.6],
  ],
  museum: [
    ['wall-candle-0', 'candle', 8.0, 2.0], ['wall-candle-1', 'candle', 11.3, 2.0], ['wall-candle-2', 'candle', 16.1, 2.0],
    ['wall-candle-3', 'candle', 19.2, 2.0], ['west-candle', 'candle', 1.4, 7.8], ['east-candle', 'candle', 25.7, 6.3],
    ['door-lantern-left', 'lantern', 10.2, 16.0], ['door-lantern-right', 'lantern', 17.2, 16.0],
    ['home-stove', 'fire', 29.6, 3.8], ['living-candle', 'candle', 31.6, 2.2],
    ['nightstand-lamp', 'lamp', 31, 11.8], ['dresser-lamp', 'lamp', 36.8, 12.0],
  ],
  guild: [
    ['wall-candle-0', 'candle', 4.7, 1.7], ['wall-candle-1', 'candle', 12.8, 2.0], ['wall-candle-2', 'candle', 18.7, 2.0],
    ['map-table-candle', 'candle', 9.0, 7.3], ['side-candle-west', 'candle', 3.2, 7.5],
    ['side-candle-east', 'candle', 20.0, 9.9], ['floor-lamp', 'lamp', 1.6, 11.4], ['public-stove', 'fire', 18.5, 14.6],
    ['home-stove', 'fire', 24.5, 3.5], ['dresser-lamp', 'lamp', 31.9, 11.0],
  ],
  ranch: [
    ['wall-lantern-west', 'lantern', 3.3, 1.8], ['wall-lantern-east', 'lantern', 20.5, 1.8],
    ['stall-lantern-north', 'lantern', 7.8, 7.6], ['stall-lantern-south', 'lantern', 7.8, 12.6],
    ['hay-lantern', 'lantern', 13.9, 9.3], ['home-stove', 'fire', 25.9, 3.4], ['dresser-lamp', 'lamp', 33.7, 11.2],
  ],
  bar: [
    ['wall-lantern-0', 'lantern', 1.6, 1.3], ['wall-lantern-1', 'lantern', 13.0, 1.3], ['wall-lantern-2', 'lantern', 21.7, 1.3],
    ['hearth', 'fire', 6.2, 4.2], ['counter-candle-west', 'candle', 9.8, 5.0], ['counter-candle-east', 'candle', 19.7, 5.0],
    ['table-a-candle', 'candle', 4.5, 9.4], ['table-b-candle', 'candle', 16.1, 9.4],
    ['round-table-candle', 'candle', 19.8, 12.8], ['coat-rack-lantern', 'lantern', 23, 9.8],
    ['home-stove', 'fire', 26.6, 3.6], ['dresser-lamp', 'lamp', 33.9, 11.0],
  ],
  carpenter: [
    ['wall-lantern-west', 'lantern', 7.2, 1.6], ['wall-lantern-east', 'lantern', 19.2, 1.6],
    ['sign-candle', 'candle', 12.3, 1.6], ['workbench-candle', 'candle', 9.0, 4.1],
    ['west-lantern', 'lantern', 1.7, 7.3], ['table-lantern', 'lantern', 11.2, 8.2], ['floor-lantern', 'lantern', 22.1, 12.2],
    ['home-stove', 'fire', 25.8, 3.0], ['dresser-lamp', 'lamp', 33.8, 10.8],
  ],
  fishing: [
    ['wall-lantern-west', 'lantern', 4.1, 1.3], ['wall-lantern-east', 'lantern', 17.1, 1.3],
    ['counter-lantern', 'lantern', 8.3, 5.4], ['table-lantern', 'lantern', 6.4, 8.9],
    ['home-stove', 'fire', 22.9, 3.0], ['dresser-lamp', 'lamp', 30, 10.0],
  ],
  alchemy: [
    ['hanging-lantern', 'lantern', 4.5, 1.6], ['brew-stove', 'fire', 5.2, 4.7], ['counter-candle', 'candle', 15, 4.5],
    ['shelf-candle-0', 'candle', 10.2, 1.5], ['shelf-candle-1', 'candle', 14.5, 1.6],
    ['candle-table', 'candle', 20.2, 8.5], ['home-stove', 'fire', 24.5, 3.0], ['dresser-lamp', 'lamp', 32, 11],
  ],
  tailor: [
    ['wall-lantern-west', 'lantern', 3.4, 1.5], ['wall-lantern-east', 'lantern', 17.3, 1.5],
    ['table-lantern', 'lantern', 8.9, 9.6], ['home-stove', 'fire', 23, 3.3], ['dresser-lamp', 'lamp', 30, 10.4],
  ],
  market: [
    ['wall-lantern-0', 'lantern', 1.7, 1.5], ['wall-lantern-1', 'lantern', 9.2, 1.9], ['wall-lantern-2', 'lantern', 12.7, 1.9],
    ['counter-lamp', 'lamp', 6.7, 4.6], ['post-lantern-west', 'lantern', 8.9, 14.0],
    ['post-lantern-east', 'lantern', 13.0, 14.0], ['home-stove', 'fire', 24.4, 3.4],
    ['nightstand-lamp', 'lamp', 24.4, 10.7], ['dresser-lamp', 'lamp', 30.9, 11],
  ],
};

/**
 * One fire light for every iron stove fixture in a civic public room (the forge's two furnaces, the magic shop,
 * Wayfarer, guild and alchemy stoves).
 * why: these stoves are authored as room fixtures in TownBuildings, so deriving the light from the same fixture
 * list keeps the glow on the art if a stove ever moves. CivicInteriorScene draws a stove bottom-centered at
 * ((tx + 1) * TILE, (ty + 1) * TILE), 28x36 px; its firebox grate sits about 12 px above that bottom edge and
 * 1 px left of center (measured from shop-rebuild/stove.png inside its furniture crop).
 * @param building the civic building whose fixtures are scanned
 * @returns one fire light per stove fixture, in fixture order
 */
function stoveLights(building: TownBuilding): InteriorLight[] {
  return building.room.fixtures
    .filter(piece => piece.item === 'stove')
    .map(piece => light({ id: `${building.id}-stove-${piece.tx}-${piece.ty}`, kind: 'fire', art: 'none',
      x: (piece.tx + 1) * TILE - 1, y: (piece.ty + 1) * TILE - 12, radius: 92, color: FIRE, strength: 0.86,
      glow: 0.28, depth: 0 }));
}

/**
 * All lights for one civic building.
 * - Painted rooms: the lamps measured from the painting (PAINTED_LIGHTS).
 * - The built clinic: its wall sconces (already drawn by CivicInteriorRenderer.wallDetails), its home wing, and
 *   the fire in each stove fixture.
 * @param building the civic building whose room is being lit
 * @returns the room's lights in a stable order
 */
export function civicInteriorLights(building: TownBuilding): readonly InteriorLight[] {
  const room = civicInteriorBlueprint(building.id);
  if (room.layout === 'painted') return PAINTED_LIGHTS[room.id].map(spot => paintedLight(room.id, spot));
  // why: these three x positions mirror wallDetails() in CivicInteriorRenderer, which draws a flame at tx*TILE+8.
  const sconces = [3, Math.floor(room.baseW / 2), room.baseW - 4]
    .map((tx, index) => sconce(`${room.id}-sconce-${index}`, tx * TILE + 8, 'none'));
  return [...sconces, ...homeWingLights(room.id, room.baseW * TILE), ...stoveLights(building)];
}

/**
 * A north-wall window: daylight falls on the floor below it, and moonlight at night.
 * @param id stable name
 * @param x left edge of the window frame in world pixels
 * @param y top edge of the window frame in world pixels
 */
export function windowLight(id: string, x: number, y: number): InteriorLight {
  return light({ id, kind: 'window', art: 'none', x: x + 13, y: y + 46, radius: 64, color: 0xfff0c8, strength: 0.6,
    glow: 0.16, depth: 0 });
}

/**
 * Lights for the keeper's own Tavern: its two windows plus two drawn wall lanterns between the windows and the door.
 * @param windows top-left pixel of each window the scene draws
 */
export function tavernLights(windows: readonly { x: number; y: number }[]): readonly InteriorLight[] {
  return [
    ...windows.map((window, index) => windowLight(`tavern-window-${index}`, window.x, window.y)),
    sconce('tavern-lantern-west', 9.5 * TILE, 'wall-lantern', 26),
    sconce('tavern-lantern-east', 19 * TILE, 'wall-lantern', 26),
  ];
}

/**
 * Lights for the keeper's bedroom: its windows and the bedside lamp the scene already draws.
 * @param windows top-left pixel of each window the scene draws
 * @param lamp the bedside lamp's tile (the scene draws its shade just above that tile's top edge)
 */
export function bedroomLights(windows: readonly { x: number; y: number }[], lamp: { tx: number; ty: number }): readonly InteriorLight[] {
  return [
    ...windows.map((window, index) => windowLight(`bedroom-window-${index}`, window.x, window.y)),
    light({ id: 'bedroom-bedside-lamp', kind: 'lamp', art: 'none', x: lamp.tx * TILE + TILE / 2, y: lamp.ty * TILE - 8,
      radius: 96, color: LAMP, strength: 0.86, glow: 0.24, depth: 0 }),
  ];
}

/**
 * Lights for the painted watch-house jail (JailScene), measured from its painting: three wall lanterns, a candle on
 * the west shelf, and a candle on Captain Maren's table.
 * why: the jail is meant to feel bleak, so the lantern over the barred cell is weaker than the guard's side.
 * @returns the jail's lights in a stable order
 */
export function jailLights(): readonly InteriorLight[] {
  return [
    paintedLight('jail', ['west-lantern', 'lantern', 2.4, 0.95]),
    paintedLight('jail', ['cell-lantern', 'lantern', 8.95, 0.95], 0.8),
    paintedLight('jail', ['guard-lantern', 'lantern', 15.6, 0.95]),
    paintedLight('jail', ['shelf-candle', 'candle', 1.45, 3.05]),
    paintedLight('jail', ['desk-candle', 'candle', 14.25, 5.45]),
  ];
}
