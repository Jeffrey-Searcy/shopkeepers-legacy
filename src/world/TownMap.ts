/** Authored Town composition shared by ordinary play and the isolated layout workshop. No browser state is read. */
import type { MapData } from './MapDef';
import type { TownPlan } from './TownPlanning';
import authored from './maps/town-workshop.json' with { type: 'json' };
import { GUARDHOUSE_BUILDING, TOWN_BUILDINGS, townBuildingGeometry, type TownBuildingFacade } from '../config/TownBuildings';

/** Town terrain includes fixed bridges and movable clearing metadata, not finished buildings. */
export interface PlannedTownMap extends MapData { townPlan: TownPlan }

/** Compose clearing surfaces and build zones after underlay edits; returns the same caller-owned detached map. */
export function composeTownClearings(map: PlannedTownMap): PlannedTownMap {
  for (const plot of map.townPlan.plots) {
    for (let ty = plot.ty; ty < plot.ty + plot.h; ty++) {
      for (let tx = plot.tx; tx < plot.tx + plot.w; tx++) map.ground[ty][tx] = 'dirt';
    }
  }
  // The workshop underlay deliberately had no build zone. Ordinary Town must still accept
  // preserved building footprints, without permitting construction on a river or travel route.
  const reserved = new Set<string>(map.spawns.map(point => `${point.tx},${point.ty}`));
  if (map.reservedTiles) for (const point of map.reservedTiles) reserved.add(`${point.tx},${point.ty}`);
  for (const warp of map.warps) for (let ty = warp.ty; ty < warp.ty + warp.h; ty++) {
    for (let tx = warp.tx; tx < warp.tx + warp.w; tx++) reserved.add(`${tx},${ty}`);
  }
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    map.buildable[ty][tx] = tx > 2 && ty > 2 && tx < map.w - 3 && ty < map.h - 3 &&
      !map.solid[ty][tx] && (map.ground[ty][tx] === 'grass' || map.ground[ty][tx] === 'dirt') &&
      !reserved.has(`${tx},${ty}`);
  }
  return map;
}

/** Return independent production terrain with the exact same clearing composition as the editor. */
export function getUnbuiltTownMap(): PlannedTownMap {
  return composeTownClearings(structuredClone(authored) as PlannedTownMap);
}

/** Install only approved civic architecture on a detached production map; editor underlays remain unchanged. */
export function getAuthoredTownMap(): PlannedTownMap {
  const map = getUnbuiltTownMap();
  if (!map.reservedTiles) throw new Error('Town buildings require authored road reservations');
  /** Install one facade against either a resident plot or a fixed service site. */
  const installBuilding = (building: TownBuildingFacade, plot: PlannedTownMap['townPlan']['plots'][number]): void => {
    // Preserve the approved Town underlay exactly. Facade, collision, and reservation own the built site.
    const geometry = townBuildingGeometry(building, plot), wall = geometry.wall;
    for (let ty = plot.ty; ty < plot.ty + plot.h; ty++) for (let tx = plot.tx; tx < plot.tx + plot.w; tx++) {
      map.buildable[ty][tx] = false;
      map.reservedTiles!.push({ tx, ty });
    }
    for (let ty = wall.ty; ty < wall.ty + wall.h; ty++) for (let tx = wall.tx; tx < wall.tx + wall.w; tx++) map.solid[ty][tx] = true;
    for (let tx = geometry.doorTx; tx < geometry.doorTx + 2; tx++) map.solid[geometry.doorTy][tx] = false;
    map.warps.push({ tx: geometry.doorTx, ty: geometry.doorTy, w: 2, h: 1,
      target: building.scene, spawn: 'entry', doorFacing: 'north' });
    map.spawns.push({ id: geometry.returnSpawn, ...geometry.arrival });
  };
  for (const building of TOWN_BUILDINGS) {
    const plot = map.townPlan.plots.find(candidate => candidate.id === building.plotId);
    if (!plot) throw new Error(`Town building ${building.id} has no plot`);
    installBuilding(building, plot);
  }
  const guardhouseSite = map.townPlan.futureSites.find(candidate => candidate.id === GUARDHOUSE_BUILDING.plotId);
  if (!guardhouseSite) throw new Error('Town guardhouse has no authored service site');
  installBuilding(GUARDHOUSE_BUILDING, guardhouseSite);
  return map;
}
