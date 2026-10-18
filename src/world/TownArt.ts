/**
 * TownArt — the painted Town, as plain data.
 *
 * The Town art (public/assets/town/*.png, built by scripts/pack-town-art.py from
 * docs/art-source/town/town.png) is 82x75 tiles and is the whole Town map (save version 27 and later; older
 * saves keep the hand-built 120x110 Town only so their positions can be moved onto this one). This module is
 * the single place that ties the painting to the game:
 *  - TOWN_GRID: the ground and collision of every tile, traced over the painting. MapDef.buildTown turns it
 *    into the map's ground (water for fishing in the river) and its solid tiles, so what you see is what you
 *    hit. scripts/pack-town-art.py reads it too: a cleared tree or rock is rebuilt from walkable ground;
 *  - TOWN_ANCHORS: the arrivals and warps of the four roads out of Town (Farm, Forest, Mountain, Beach);
 *  - TOWN_DOORS: the painted door of every building, so MapDef can add its door warp and return spawn;
 *  - TOWN_WALL_EDITS: the keeper's walls trimmed to a quarter tile, on top of TOWN_GRID (see FineCollision);
 *  - TOWN_NODES: the meadow stones, the one painted resource node (mine). The painted trees stand on lawns
 *    as dark as their leaves, so a felled tree could not leave clean ground behind: they are scenery the
 *    keeper walks behind (TOWN_ART.pieces) and their trunks are solid in TOWN_GRID;
 *  - TOWN_ART: the textures, the trees, lamp posts and banners the keeper can walk behind, and the glow of
 *    the lamps and the forge fire (PaintedRoomRenderer draws them);
 *  - TOWN_STYLE: tint and glow colours (as painted, with warm lanterns).
 *
 * No Phaser imports at runtime: MapDef and the Playwright specs import this file directly.
 * Coordinates: tiles are map tiles (0..81, 0..74); frames, pieces and lights are art texels (2 per world px).
 */
import { TextureKey } from '../config/AssetKeys';
import { block, open, type CollisionEdit } from './FineCollision';
import type { ObjectDef, PaintedNodeArt } from './MapDef';
import type { PaintedRoomArt, PaintedRoomStyle } from './PaintedRoomRenderer';

/** Size of the painted Town in tiles (also the Town map size). */
export const TOWN_TILES = { w: 82, h: 75 } as const;

/**
 * Ground and collision of the painted Town, one string per tile row:
 *   ',' grass   '=' road (cobbles, dirt paths, stairs, the dock, the bridges)   walkable
 *   '%' solid grass (house, hedge, bush, fence, stall, statue)   '#' solid road (a lamp, barrel or pot that
 *   stands on the road)   '~' water (the river; solid, and where the keeper fishes)
 * Traced over the painting. The meadow stones' FOOT (64,57) is walkable here: it blocks as a resource node, so
 * the tile opens when the stones are mined. Tree trunks are solid: the painted trees are scenery. MapDef checks
 * that every walkable tile connects to the first arrival and that every door, warp and node can be reached.
 * scripts/pack-town-art.py reads these rows (between the brackets, one quoted row per line).
 */
export const TOWN_GRID: readonly string[] = [
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%',  // 0  map edge; the main road (x 29-30) is the Mountain warp
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%',  // 1
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%',  // 2
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%',  // 3
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~%%%%%%%%%%%%%%%%%%%%',  // 4
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%,,,%%%%%%%',  // 5
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~%%%%%%%%%,,,%%%%%%%',  // 6
  '%%%%%%%%%%%%%%%%%%%#===========%%%%%%%%%%%%%%%%%%%%%%%%%%%%~~~~%%%%%%%%%,,%%%%%%%%',  // 7  the windmill lane
  '%%%%%%%%%%%%%%%%%%%============%%%%%%%%%%==%%%%%%%%%%%%%%%~~~~~~%%%%%%%%,,%%%%%%%%',  // 8
  '%%%%%%%%%%%%%%%%%%%,,,%%%%,,===%%%%%%%%=====%%%%%%%%%%%%%%~%%~~~%%%%%%%,,,,,,,,%%%',  // 9
  '%%%%%%%%%%%%%%%%%%%%,,%%%%,,,==%%%%%%%%%===#%%%%%%%%%%%%%%~~~~~%%%%,,,,,,,,,,,,%%,',  // 10
  '%%%%%%%%%%%%%%%%%%%%,,%%%%,,,=======,,%%====%%%%%%%%%%%%%%~~~~~%%%,,,,,,,,,,,,,,,,',  // 11 the lane up to the guild manor
  '%%%~~%%%%%%%%%%%%%,,,%%%%%,,,=======,,%%===,%%%%%%%%%%%%%%%~~~~~%%,,%%,%,,,,,,,,,,',  // 12
  '%%%%~%%%%,,,,,,,,,,,,%%%%%%%,==,%%%%,,,==============#%%%%%~~~~~%%,%%%%%%%%,%%#,,,',  // 13 the lane east of the manor
  '%%%%~%%%%%%%%%%%%%%%%%%%%%%%,==,%%%%%%%%%=%%%%%%%%%%,,%%%%%~~~~~%%,%%%%%%%%%%%%,,,',  // 14
  '%%%%~%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%=%%%%%%%%%%%,,%%%~%~~~%%%,%%%%%%%%%,,==,,',  // 15
  '%%%~~~%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%,,,,,%%%%%%%%%%%%%%~%~~~%%%%%%%%%%%%%%%==,,',  // 16
  '%%%~~~%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%,,%%%%%%%%%%%%%~~~~%%%%%%%%%%%%%%%%==,,',  // 17
  '%%%%~~%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%,%%%%%,%%%%%%%,,,%%%~~~~%%%%%%%%%%%%%%%%==,,',  // 18
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==,,,%%,,,,%%%,,%%%%%%%,,,%%%~~~~~%%%%%%%==%%%%%%==,%',  // 19 the lawn by the notice board (x 31-45)
  '===============================,,,,,,,,,,,,,,,%%%%%%,,,%%%~~~~~%%%%%%%==%%%%%%==%%',  // 20 the west road; its west end (x 0) is the Farm warp
  '%%%%%%%%%%%%%%%%%%%%%%%%%,,,,==,,,,,,,,,,,,,,,%%%%%%%%,%%%~~~~~%%%%%%%==%%%%%%==%%',  // 21
  '%%%%%%%%%%%%%%%%%%%%%%%%%,,,,==,,,,,,,,,,,,,,%%%%%%%%%,%%%~~~~%%%%%%%%==%%%%%%==%%',  // 22
  '%%%%%%%%%%%%%%%%%%%%%%%%%%,,,==,%%%%%%%,,%%%%%==============================#===%%',  // 23 the north-east road over the river bridge
  '%%%%%%%%%%%%%%%%%%%%%%%%%,,%,==%%%%%%%%%%%%%%%%=================================%%',  // 24
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%==,%',  // 25
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%==%%%%%%%~%%%%%%%%%%%%%%%%%==,%',  // 26
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%==%%%%%~~~~%%%%%%%%%%%%%%%%==%%',  // 27
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%==%%%%%~~~~%%%%%%%%%%%%%%%%==%%',  // 28
  '%%%%%%%%%%%%%%%==%%%%####=========###%%%%%%%%%%%%%%==%%%%%~~~~~%%%%%%%%%%%%%%%==%%',  // 29 the plaza (x 21-36, rows 29-42) and the market step
  '%%%%%,,%%%%##===#########=========###%%%%%%==%%%%%%==%%%%~~~~~%%%%%%%%%%%%%%%%==%%',  // 30
  '%%%%,,%%%%%#==#===##%####==######=###%%%%%#==#%%%%%==%%%~~~~~%%%%%%%%%%%%%%%%%==%%',  // 31
  '%%%%,,%%%%%####===##%##====######====%%%%%====%%%%%==%%%~~~~~%%%%%%%%%%%%%%%%%==,%',  // 32
  '%%%%,,,,===================######=====####====###====%%%%~~~%%%%%%%%%%%%%%%%%%==,%',  // 33 the roads west and east of the plaza
  '%%%%,,====================########===================%%%%~~~~%%%%%%%%%%%%%%%%%==,%',  // 34
  '%%%%%%==%%%%=%%=====%=====########========%%=========%%%%~~~~%%%%%%%%==%%%%%%%==,%',  // 35
  '%%%%%%==%%%%%%%%%%%%%#=====######====%%,,,%%%%%%%%%==%%%~~~~~%%%%%%%%==%%%%%%%==,%',  // 36
  '%%%%%%==%%%%%%%%%%%%%#=====##==#=====%%%,%%%%%%%%%%==%%~~~~~~%%,%%%%====%%%%%%==%%',  // 37
  '%%%%%%==%%%%%%%%%%%%%###=##======#==#%%%,%%%%%%%%%%=#%%%~~~~%%%,%%%,,==%%%%%%%==%%',  // 38
  '%%%%%%==%%%%%%%%%%%%%######======####%%%,%%%%%%%%%%=#%%%~~~~%%%,%%%%%==,%%%%%%==%%',  // 39
  '%%%%%%==%%%%%%%%%%%%%######======####%==========================================%%',  // 40 the east road over the river bridge
  '%%%%%%==%%%%%%%%%%%%%######======####%=%%%%%%%==================================%%',  // 41
  '%%%%%%==%%%%%%%%%%%%%#######===######%,%%%%%%%%%%%%%%%%%%%%%%%%%,,,,,,,,,,,,,===%%',  // 42 the lawn under the ranch trees (x 64-76)
  '%%%%%,==%%%%%==%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%~~%%%%%,,,,,,,,%%,,,===%%',  // 43
  '%%%%%,===#=======%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%~~~~%%%%,,%%%%%%%%%%%%==%%',  // 44 the magic shop apron; x 64 (rows 44-45) the stepping stones below the ranch lawn
  '%%%%%%==,=======#%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%~~~~%%%%,,%%%%%%%%%%%%==%%',  // 45
  '%%%%,,==%%%%%,%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%==%%',  // 46
  '%%%%,,==%%%%%,%%%%%%%%%%%%%%===%%%%%%%%%%==%%%%%%%%%%%~~~%~~%%%%%%%%%%%%%%%%%%==%%',  // 47
  '%%%%%,==%%%%%,%%%%%%%%%%%%%%===%%%%%%%%##==##%%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%==%%',  // 48 the forge front
  '%%%%%%==%%%%%,%%%%%%%%%%%%%%===%%%%%%%%##==##%%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%%==%%',  // 49
  '========%%%%%,%%%%%%==%%%%%%===%%%%%%%###===#%%%%%%%~~~~~%%%%%%%%%%%%%%%%%%%%%==%%',  // 50 the Forest road; its west end (x 0) is the Forest warp
  '%%%%%%%%%%%%%%%#####==###%%%=========%%=====#%%%%%%~~~~~~%%%%%%%%%%%%%%%%%%%%%==%%',  // 51 the bar apron and the path to the forge
  '%%%%%%%%%%%%%%%=========#%%%===%,,%%,,,,,%%%%%%%%%~~~~~~~%%%%%%%%%%%%==%%%%%%%==%%',  // 52 x 32-33 the flagstone nook behind tree-forge-lawn
  '%%%%%%%%%%%%%%%====#====,,,,===%%%%%%%%%%%%%%%%%%~~~~~~~%%%%%%%%%%%%%#=#%%%%%%==%%',  // 53
  '%%%%%%%%%%%%%%%%==%%===%%%,,===%%%%%%%%%%%%%%%%%~~~~~~~%%%%%%%%%%%%%%===%%%%%%==%%',  // 54
  '%%%%%%%%%%%%%%%%=#%%===%%%%%===#%%%%%%%%%%%%%%%%~%~~~~%%%%%%%%%%%%%%%==#%%%%%%==%%',  // 55
  '%%%%%%%%%%%%%%%%=#%%%==%%%%%===#%%%%%%%%%%%%~~~~~~~~~~%%%%%,,%%%%%%%%==#%%%%%%==%%',  // 56 (59-60: grass under the meadow tree's canopy, a front piece)
  '%%%%%%%%%%%%%%%%=#%%%==%%%%%===#%%%%%%%~~~~~~~~~~~~====%,,,,,,,%,,,,,,,,,,,,,,%,%%',  // 57 the south-east meadow (x 50-79)
  '~~~~~~~~~%%~~~~~=#~~~~~~~~~%===#%%%~~~~~~~~~~~~~~~~=#==,,,,,,,,,,,,,,,,,,,,,,,,,%%',  // 58 the dock (x 11-17) and the south bridge (x 28-31)
  '~~~~%%%%%%%#==##=#~~~~~~~~~%===#~~~~~~~~~~~~~~%%~%%~%,,,%%%%,,,,%%%%,,,,,,,,,,,,%%',  // 59
  '~~~~%%%%%%%#=====#~~~~~~~~~%===#~~~~%~~~~~%%%%%%%%%%%%,,%%%%%%,%%%%%%,,%,,,%,%%,%%',  // 60 x 50-51: the grass pocket behind the pier pine is solid (only a gap past the pine leads in)
  '~~~~~%%%%%%%%%%%%%~~~~~~~~~%===#~~~~~~~%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%,,%%%%,%%',  // 61
  '~~~~~~~~~%~%%%%%%~~%%~~~~~~%===#%%%~%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 62
  '~~~~~~~~~~%%%%%%%%%%%%~~~~~%===#%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 63
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%===#%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 64
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 65
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 66
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 67
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%==%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 68
  '%%%%%%%%%%%%%==%%%%,%%%%%%%%%==%%%%%%%%%%==%%%%%%%%%%#==#%%%%%%%%%%%%==%%%%%%%%%%%',  // 69
  '%%%%%%%%%==#===###=,%%%%%%%%%==%%%%%%%##=====#%%%%%%=====%%%%%%%%%###===##=#%%%%%%',  // 70 the shop aprons along the south road
  '%%%%%%%%%============================#============%%=====%=================%%%=%%%',  // 71 the south road
  '%%%%%%%##======================================================================#%%',  // 72
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 73
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%===%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',  // 74 map edge; the main road (x 29-30) is the Beach warp
];

/** Map tile anchors: the four roads out of Town, the Day 1 start and the watch-house guard. */
export const TOWN_ANCHORS = {
  /** Day 1 and the fallback arrival: on the main road just south of the plaza. */
  start: { tx: 29, ty: 39 },
  /** Arriving from the Farm: on the west road, two tiles inside the west edge. */
  fromFarm: { tx: 2, ty: 20 },
  /** The west end of the west road: walking off it returns to the Farm. */
  farmRoad: { tx: 0, ty: 20, w: 1, h: 1 },
  /** Arriving from the Forest: on the Forest road, two tiles inside the west edge. */
  fromForest: { tx: 2, ty: 50 },
  /** The west end of the Forest road: walking off it returns to the Forest. */
  forestRoad: { tx: 0, ty: 50, w: 1, h: 1 },
  /** Arriving from the Mountain: on the main road, two tiles below the north edge. */
  fromMountain: { tx: 29, ty: 2 },
  /** The top of the main road: walking off it climbs to the Mountain. */
  mountainRoad: { tx: 29, ty: 0, w: 2, h: 1 },
  /** Arriving from the Beach: on the main road, two tiles above the south edge. */
  fromBeach: { tx: 29, ty: 72 },
  /** The bottom of the main road: walking off it goes down to the Beach. */
  beachRoad: { tx: 29, ty: 74, w: 2, h: 1 },
  /** The watch-house guard: on the north-east road beside the foot of the jail stairs; the road's lower row stays open. */
  guard: { tx: 72, ty: 23 },
} as const;

/** Every building with a door on the painted Town: the twelve businesses and the watch house. */
export type TownDoorId = 'guild' | 'guardhouse' | 'market' | 'museum' | 'clinic' | 'magic' | 'bar' | 'forge' | 'ranch'
  | 'fishing' | 'tailor' | 'alchemy' | 'carpenter';

/**
 * The painted door of every building: (tx, ty) is the left of its two door tiles, on the row that holds the
 * painted door's bottom edge (walkable in TOWN_GRID, with solid wall above). MapDef puts the door warp there
 * and the return arrival two tiles below it.
 */
export const TOWN_DOORS: Readonly<Record<TownDoorId, { readonly tx: number; readonly ty: number }>> = {
  guild: { tx: 41, ty: 8 },
  guardhouse: { tx: 70, ty: 19 },
  market: { tx: 15, ty: 29 },
  museum: { tx: 43, ty: 30 },
  clinic: { tx: 69, ty: 35 },
  magic: { tx: 13, ty: 43 },
  bar: { tx: 20, ty: 50 },
  forge: { tx: 41, ty: 47 },
  ranch: { tx: 69, ty: 52 },
  fishing: { tx: 13, ty: 69 },
  tailor: { tx: 41, ty: 69 },
  alchemy: { tx: 54, ty: 68 },
  carpenter: { tx: 69, ty: 69 },
};

/**
 * The keeper's walls at a quarter tile, on top of TOWN_GRID's solid tiles (see FineCollision). TOWN_GRID is
 * whole tiles, the painting is not: these edits trim each wall to what is drawn, so the keeper neither walks
 * onto a fence, bush or stall nor stops short on open ground beside it. Rules used when tracing:
 *  - a short thing (bush, barrel, crate, fence, wall, rock, planter) blocks its whole painted shape, so the
 *    keeper never stands on it;
 *  - a tall thing the keeper walks behind (a tree, lamp post or banner in TOWN_ART.pieces) blocks only its
 *    foot; the piece is drawn over a keeper whose feet are above its base;
 *  - a building blocks from its roof line down to its wall foot, so the keeper never stands on a roof.
 * Edits apply in order, a few rows of the map at a time (top to bottom). MapDef checks that no edit closes the
 * middle of a walkable tile and that the keeper can still walk to every walkable tile.
 */
export const TOWN_WALL_EDITS: readonly CollisionEdit[] = [
  // Rows 0-9: north edge, shrine lamps and the guild yard.
  open(28.5, 0, 29, 7, 'west curb stones of the main road (x 28.5-28.75); the west lamp ends at x 28.42'),
  block(74.75, 5, 75, 7, 'west edge of the right shrine lamp and its dark base (x 74.8-75.45, y 4.9-6.95)'),
  open(19.5, 6, 20.5, 7, 'grass with yellow flowers between the fence posts (posts end y 5.9-6.0) north of the lane\'s west end; the lower rail starts at x 20.65'),
  open(19.5, 7, 20, 8, 'grass strip and lane cobbles east of the dark lantern (lantern x 18.74-19.37, y 6.4-7.52)'),
  open(74, 7, 74.25, 9, 'shrine stair steps west of the right balustrade (steps run to x 74.37, balustrade from x 74.4)'),
  open(19, 7.5, 19.5, 8, 'top of the tan dirt path below the dark lantern (lantern ends y 7.52)'),
  open(18.75, 7.75, 19, 9.5, 'grass strip between the garden fence (posts to x 18.62) and the tan dirt path'),
  block(42.75, 8, 43, 9, 'stone plinth with a gold cap east of the guild stairs (x 42.68-43.2, y 8.15-8.97)'),
  open(77, 8.25, 78, 9, 'shrine lawn reaching up between the rocks (to x 76.82) and the big tree\'s canopy (from x 77.95)'),
  open(38.75, 8.75, 40.25, 9, 'porch floor shadow below the guild\'s west wall foot (y 8.75); the west plinth starts x 40.33'),
  open(43.25, 8.75, 44.25, 9, 'porch floor below the east window wall (wall foot y 8.6), between the plinth (to x 43.2) and the gate post (from x 44.34)'),
  open(25.5, 9, 26, 10, 'grass east of the dark round tree (its edge x 25.3-25.5)'),
  open(38.5, 9, 39, 10, 'grass strip and porch floor west of the guild porch (fence post x 38.19-38.5 from y 9.35, bush to x 38.2)'),
  open(44, 9, 44.25, 10, 'porch floor west of the wooden gate post (post x 44.34-44.73, y 8.27-9.6)'),
  block(71.25, 9, 72, 9.25, 'base of the left shrine lamp pillar (x 71.3-71.9, to y 9.25)'),
  block(74.25, 9, 76.5, 9.25, 'base of the right shrine balustrade (x 74.3-74.75, to y 9.25), the grey rock and the dark bushes (bottoms y 9.1-9.3)'),
  block(78.25, 9, 79, 9.25, 'lower edge of the big shrine tree\'s canopy (x 78.3-79, to y 9.3)'),
  block(74.75, 9.25, 75.25, 9.5, 'bottom of the grey rock east of the balustrade (rock x 74.97-75.44, to y 9.38)'),
  // Rows 10-18: upper town houses, the guild steps and the north orchard.
  open(13.5, 10, 14.25, 13, 'grass strip between the house and barrel (to x 13.58) and the raised vegetable bed (from x 14.35)'),
  open(19.5, 10, 20, 12, 'grass path east of the short fence posts (posts to x 19.4)'),
  open(39.5, 10, 40, 12.75, 'west end of the top steps and the grass below them, east of the fence post (to x 39.44) and the small tree (to x 39.42)'),
  open(43, 10, 43.5, 11, 'stair landing west of the stone post (post from x 43.62)'),
  block(26, 10.25, 26.25, 13, 'tall fence post of the yard (x 25.74-26.14, from y 10.29)'),
  open(32, 10.5, 38, 11, 'grass between the fence feet (to y 10.5) and the manor lane\'s top curb'),
  block(31, 11, 32, 11.25, 'foot of the lamp at the manor lane\'s corner (x 31.07-31.96, to y 11.22)'),
  block(43.75, 11, 44, 12.25, 'stone post (x 43.62-44.07, to y 11.3) and the pine east of the stairs (from x 43.79, to y 12.2)'),
  block(18.25, 12, 19.5, 12.25, 'bottoms of the tall and short fence posts (to y 12.24)'),
  open(68, 12, 68.25, 13, 'grass west of the big tree\'s roots (roots from x 68.45)'),
  open(69.75, 12, 70, 12.75, 'grass east of the big tree\'s trunk (roots reach x 69.85 only from y 12.9)'),
  open(8.25, 12.25, 9, 13, 'grass at the lawn\'s west end below the windmill wall foot (to y 12.12), east of the barrel stack (to x 8.24)'),
  open(9, 12.25, 9.5, 13, 'grass between the house wall (to y 12.12) and the barrel (from x 9.48)'),
  open(11, 12.25, 11.75, 13, 'grass and a loose pink flower below the house wall (wall ends y 12.12; shelf from x 11.78)'),
  open(9.5, 12.5, 10, 13, 'grass below the barrel (barrel ends y 12.55)'),
  open(10, 12.75, 11, 13, 'grass below the crate stand (stand ends y 12.71)'),
  open(11.75, 12.75, 13.5, 13, 'grass below the shelf (to y 12.6) and the barrel (to y 12.71)'),
  block(27, 12.75, 28, 13, 'stone foot of the banner pole (x 27.11-27.83, y 12.76-13.67)'),
  open(38, 12.75, 40, 13, 'grass below the small round tree (tree ends y 12.81)'),
  block(76.25, 12.75, 78.5, 13, 'tops of the low bushes under the round tree (from y 12.7)'),
  open(8.25, 13, 9, 13.5, 'grass of the lawn\'s west end between the barrel stack (to x 8.24) and above the yellow-green bush (from y 13.61)'),
  open(26.25, 13, 27, 13.5, 'grass above the round bush (bush top y 13.48)'),
  open(70, 13, 70.75, 13.5, 'grass between the big tree\'s roots (to x 69.9) and the white chimney (from x 70.89), above the roof top (y 13.53)'),
  open(72, 13, 73, 13.5, 'end of the stepping stones above the roof top (y 13.53), east of the gable'),
  open(74, 13, 75, 13.5, 'grass above the roof top (y 13.53) under the round tree\'s canopy'),
  open(78.5, 13, 79, 14.25, 'grass behind the lamp pole (lamp-east-north front piece), east of the bushes (to x 78.5)'),
  open(8.25, 13.5, 8.75, 13.75, 'grass west of the yellow-green bush\'s top (bush from x 8.8), east of the barrel stack (to x 8.24)'),
  block(8.75, 13.5, 9.25, 13.75, 'top of the yellow-green bush south of the lawn (top y 13.61 at x 8.8-9.2)'),
  block(8.25, 13.75, 12.25, 14, 'tops of the yellow-green bush and the dark round tree south of the lawn (tops y 13.61-13.74)'),
  open(27.75, 13.75, 28, 15.25, 'grass between the round bush (to x 27.57) and the lamp (from y 15.17)'),
  block(43.75, 13.75, 50.5, 14, 'canopy tops of the round trees on the guild road\'s south edge (tops y 13.69-13.9)'),
  open(12.5, 14, 14.25, 14.5, 'grass with flowers above the low fence (fence top y 14.67) south of the stepping stones'),
  open(40, 14, 41, 14.25, 'grass south of the dirt road, above the stair fence post (post from y 14.43)'),
  open(42, 14, 43.25, 14.25, 'grass south of the dirt road, above the stair fence posts'),
  block(53.25, 14, 54, 14.25, 'bottom of the big round tree\'s canopy at the road bend (to y 14.18)'),
  block(41, 14.25, 41.25, 15.75, 'west fence post across the south stairs (x 40.84-41.18)'),
  open(42, 14.25, 42.25, 14.75, 'east half of the south stairs\' top step (stairs to x 42.29)'),
  block(79, 14.25, 79.25, 15, 'the lamp\'s stone base (x 78.46-79.2, y 14.33-14.95)'),
  block(52, 14.5, 52.25, 15, 'wooden fence post on the bend\'s west side (x 51.9-52.25, from y 14.56)'),
  block(31.25, 14.75, 32, 15, 'top of the fence post east of the main road (x 31.42-31.81, from y 14.65)'),
  block(41, 14.75, 42, 15.25, 'fence rails across the south stairs (y 14.73-15.27)'),
  open(75.5, 14.75, 77.25, 15, 'grass strip south of the round tree\'s roots (to y 14.71)'),
  open(77.25, 14.75, 78.5, 15, 'grass south of the low bushes (to y 14.71), west of the lamp base'),
  open(28.5, 15, 29, 19, 'white curb west of the main road beside the lamp (lamp to x 28.35)'),
  open(31, 15, 31.25, 19, 'grass strip east of the main road\'s curb, west of the fence posts and the pot'),
  open(52.25, 15, 53, 15.5, 'stepping stones above the round bush (bush from y 15.58)'),
  open(42, 15.25, 42.25, 16, 'east half of the south stairs\' lower steps (stairs to x 42.29)'),
  block(53, 15.75, 55, 16, 'tops of the grey rocks south of the clearing (from y 15.7)'),
  open(77.25, 16, 78, 19, 'grass and white curb west of the east road, east of the garden rack (to x 77.0)'),
  block(39.75, 16.5, 40.25, 17.5, 'flower bush west of the stall (x 39.66-40.38, y 16.42-17.38)'),
  open(39, 17, 39.75, 18, 'grass between the big round tree (to x 39.0) and the flower bush (from x 39.73) and west of the small pine\'s left edge (x 39.78 at y 17.85)'),
  open(38.75, 17.25, 39, 18, 'grass east of the big round tree\'s canopy (edge x 38.8 at y 17.3)'),
  open(38.5, 17.5, 38.75, 18, 'grass below the big round tree\'s canopy (edge x 38.68 at y 17.45, x 38.37 at y 17.6)'),
  open(38, 17.75, 38.5, 18, 'grass below the big round tree\'s canopy (canopy ends y 17.7)'),
  open(39, 18, 39.5, 19, 'grass west of the small pine (pine from x 39.5)'),
  block(52, 18, 55, 18.25, 'bottoms of the grey rocks north of the stepping-stone lawn (to y 18.2)'),
  // Rows 19-27: notice lawn, the market and the stepping-stone garden.
  open(28.5, 19, 29, 19.5, 'white curb and grass west of the main road'),
  block(32.75, 19, 34, 19.25, 'bottoms of the rack posts on the notice lawn\'s north edge (x 32.8-34.2, to y 19.24)'),
  block(39.5, 19, 40, 19.25, 'bottom of the small round pine west of the stall (x 39.48-40.47, to y 19.2-19.3)'),
  open(77.25, 19, 78, 23, 'grass and white curb west of the east road (curb x 77.43-77.68)'),
  open(0, 19.5, 29, 20, 'grass verge and curb north of the west road'),
  open(34, 19.5, 36, 20, 'lawn grass south of the rack post foot and the stump (both end by y 19.5)'),
  open(40, 19.5, 41.75, 20, 'grass south of the stall (stall legs end y 19.45)'),
  open(42.25, 19.5, 43, 20, 'grass south of the stall'),
  open(45, 19.5, 46, 20, 'grass below the dark shrub under the yellow tree'),
  open(46, 19.5, 46.5, 20.75, 'grass between the yellow tree\'s roots and the notice board roof (roof from x 46.69), above the climbing rose (top y 20.72)'),
  open(41.75, 19.75, 42.25, 20, 'grass below the stall keeper\'s spot'),
  open(0, 20.75, 4, 21.75, 'west road ground under the crown of the round tree at the road\'s west end (front piece tree-west-road-end)'),
  open(17.5, 20.75, 19.25, 21.75, 'west road ground under the tip of the pine west of pine-west-road'),
  open(4, 21, 17.5, 21.75, 'road dirt and curb south of the west road (curb y 21.5-21.65)'),
  open(19.25, 21, 25, 21.75, 'road dirt, curb and grass south of the west road, under the pine front pieces'),
  block(3, 21.5, 3.75, 21.75, 'top of the wooden fence post on the west road\'s south edge (x 3.1-3.65, from y 21.52)'),
  open(45, 22, 46, 23, 'grass around the notice-board lamp pole (front piece lamp-notice-board)'),
  open(46, 22.25, 47, 23, 'grass stems under the climbing rose (leaves end y 22.31) and west of the board legs (x 47.09); the lawn\'s way down to the road'),
  block(32.75, 22.75, 33.25, 23, 'tip of the small pine south of the banner (top y 22.9 at x 33.05)'),
  block(34.5, 22.75, 35.5, 23, 'trunk of the big lawn tree (x 34.54-35.32), below its crown'),
  open(25.5, 23, 26, 24, 'grass east of the purple-flower shrub (shrub x 25.04-25.6)'),
  open(32, 23, 32.5, 24, 'grass between the banner pole and the small pine'),
  open(33.5, 23, 34.25, 24, 'grass between the small pine (x to 33.6) and the lawn tree\'s roots (from x 34.4), above the bush (from y 24.15)'),
  open(38.75, 23, 39, 24, 'grass east of the second lawn tree\'s crown (crown to x 38.77)'),
  open(41, 23, 44, 23.25, 'grass and stepping stones north of the museum roof (roof peak at x 44.25, y 23.14)'),
  open(44.5, 23, 45.25, 23.25, 'grass east of the museum roof peak, west of the notice lamp\'s stone base (x 45.19)'),
  block(56.5, 23, 63.5, 23.25, 'north rail of the bridge (y 22.77-23.11)'),
  block(69, 23, 69.75, 23.25, 'bottom of the barrel west of the guardhouse stairs (x 69.07-69.73, to y 23.24)'),
  block(72.25, 23, 73, 23.25, 'bottom of the barrel east of the guardhouse stairs (x 72.32-72.98)'),
  open(76, 23, 76.5, 23.75, 'grass and curb west of the east lamp post (pole x 76.53-77)'),
  open(41, 23.25, 43.75, 23.5, 'grass north of the museum roof\'s west slope (x 44.05 at y 23.25, 43.7 at y 23.5)'),
  open(41, 23.5, 41.25, 24, 'grass west of the museum pillar finial (x 41.36-41.98)'),
  open(42, 23.5, 43.25, 23.75, 'grass between the pillar finial and the roof\'s west slope (43.4 at y 23.75)'),
  open(42, 23.75, 43, 24, 'grass between the pillar finial and the roof\'s west slope (43.05 at y 24)'),
  open(76, 23.75, 76.25, 24, 'curb west of the east lamp\'s stone base (x 76.35-77.13)'),
  block(77, 23.75, 77.25, 24, 'east edge of the east lamp\'s stone base'),
  open(27, 24, 28, 24.5, 'grass north of the banner foot'),
  open(31, 24, 31.5, 25, 'grass west of the banner foot'),
  open(38.5, 24, 39.75, 25, 'grass west of the museum fence posts (from x 39.8), under the second lawn tree\'s crown edge'),
  open(46, 24, 46.5, 24.5, 'road sand between the museum roof\'s east slope (45.97 at y 24.38) and the stone lantern box (from x 46.58)'),
  block(76.25, 24, 77.25, 24.25, 'bottom of the east lamp\'s stone base and its dark rim (to y 24.14)'),
  block(47, 24.25, 47.25, 25, 'box of the little stone lantern (x 46.58-47.36, y 24.2-24.98)'),
  open(27, 24.5, 27.25, 25, 'grass west of the banner foot'),
  block(47.25, 24.75, 48.75, 25, 'plants on the planter south of the road'),
  block(55.25, 24.75, 56.5, 25, 'top of the west bridge lamp\'s stone pillar'),
  block(63.5, 24.75, 64.75, 25, 'top of the east bridge lamp\'s stone pillar'),
  open(28.5, 25, 29, 28, 'curb west of the main road (curb x 28.54-28.72)'),
  open(31, 25, 31.25, 28, 'curb east of the main road (curb x 30.75-30.96)'),
  open(65.25, 25, 78, 25.5, 'guardhouse road\'s south cobbles and curb (grass starts y 25.52), under the two round tree front pieces'),
  block(80.25, 25, 81, 25.25, 'bottom of the tree canopy east of the east road'),
  open(77.75, 25.5, 78, 28, 'curb west of the east road'),
  // Rows 28-36: middle road, the museum junction and the plaza's north side.
  open(28.5, 28, 29, 29, 'pink and white curb on the west side of the main road'),
  open(31, 28, 31.25, 29, 'curb and green strip on the east side of the main road'),
  open(50.75, 28, 51, 33, 'pink curb on the west side of the middle road (verge lamp ends at x 50.67)'),
  open(53, 28, 53.25, 35.75, 'pink curb on the east side of the middle road'),
  open(77.5, 28, 78, 37, 'pink curb on the west side of the east road (clinic lamp ends at x 77.45)'),
  open(34, 29, 34.5, 30, 'plaza cobbles west of the barrels'),
  block(13, 30, 13.75, 30.25, 'foot of the market wall west of the short post'),
  block(13.75, 30, 14.25, 30.75, 'short post in front of the market (x 13.9-14.34, y 29.78-30.71)'),
  block(14.25, 30, 14.5, 30.25, 'foot of the market wall between the short post and the stairs'),
  open(16, 30, 16.75, 31, 'market doorstep and cobbles below the painted door (x 16.18-16.78)'),
  open(12.5, 30.25, 13, 31, 'porch cobbles east of the barrel at the market'),
  open(11.75, 30.75, 12.5, 31, 'porch cobbles below the barrel at the market (barrel ends y 30.68)'),
  block(4, 31, 4.25, 31.5, 'trunk of the tree at the west lawn edge (x 3.85-4.33, to y 31.45)'),
  block(4.25, 31, 4.5, 31.25, 'trunk of the tree at the west lawn edge'),
  block(5.75, 31, 6, 33, 'west side of the round pine on the west lawn (x 5.8-6.96)'),
  open(11, 31, 12, 31.5, 'porch cobbles above the left post of the market rail'),
  open(14, 31, 15, 31.5, 'porch cobbles and foot of the market stairs above the right rail post (post from y 31.5)'),
  open(18, 31, 18.5, 31.5, 'cobbles above-left of the bush in front of the market (bush top y 31.6 here)'),
  open(34, 31, 34.25, 31.75, 'cobbles west of the low stone ledge under the barrels'),
  open(45, 31, 45.25, 32, 'edge of the museum stairs west of the east balustrade'),
  open(3.75, 31.5, 4, 35, 'grass at the west edge of the west lawn (grass edge x 3.7)'),
  open(80, 31.5, 81, 32, 'grass verge east of the east road below the pine (pine ends y 31.39)'),
  block(12, 31.75, 14, 32, 'top of the iron rail across the market porch (rail top y 31.84)'),
  open(22.5, 31.75, 25, 32, 'cobbles below the pink stone ledge of the plaza garden'),
  open(34, 31.75, 37, 32, 'cobbles below the low stone ledge under the barrels'),
  open(22.5, 32, 23, 33, 'cobbles east of the north-west plaza lamp (lamp foot x 21.58-22.32)'),
  block(42, 32, 43, 32.25, 'foot of the museum wall west of the stairs'),
  block(45.25, 32, 46, 32.25, 'foot of the museum wall east of the stairs'),
  open(11.75, 32.5, 14.5, 33, 'grass below the iron rail across the market porch (rail bottom y 32.53)'),
  open(7, 32.75, 11.75, 33, 'grass below the fence and the left rail post west of the market (fence bottom y 32.8)'),
  open(14.5, 32.75, 15, 33, 'grass below the right post of the market rail (post bottom y 32.75)'),
  open(21, 32.75, 22.5, 33, 'cobbles below the foot of the north-west plaza lamp (foot ends y 32.77)'),
  open(37, 32.75, 38.25, 33, 'cobbles below the foot of the lamp west of the museum garden (foot ends y 32.77)'),
  block(5.75, 33, 7, 33.25, 'roots of the round pine on the west lawn (to y 33.23)'),
  block(18.25, 33, 19.75, 33.25, 'bottom of the bush in front of the market (to y 33.3)'),
  block(19.75, 33, 20.5, 33.25, 'post east of the market bush (x 19.87-20.43, to y 33.5)'),
  open(38, 33, 38.25, 33.75, 'cobbles west of the museum garden fence post (x 38.26)'),
  block(49, 33, 49.25, 33.5, 'fence pole east of the notice board (to y 33.3)'),
  block(19.75, 33.25, 20.25, 33.5, 'post east of the market bush (to y 33.5)'),
  open(38, 33.75, 42, 34, 'curb below the museum garden'),
  open(46, 33.75, 49, 34, 'curb below the notice board'),
  open(33.75, 34, 34, 36, 'cobbles east of the planter east of the fountain (leaves reach x 33.66)'),
  block(25.75, 34.25, 26, 35.25, 'leaves on the west side of the planter west of the fountain (x 25.76)'),
  block(43, 34.25, 43.25, 34.75, 'tip of the pine south of the museum road'),
  block(42.75, 34.75, 43.5, 35, 'top of the pine south of the museum road'),
  open(5.5, 35, 5.75, 35.5, 'grass between the grey stone block and the west road'),
  open(5.75, 35, 6, 37, 'flat curb on the west side of the west road'),
  open(8, 35, 12, 35.5, 'cobble road behind the magic shop under the crown of tree-magic-garden and the head of the corner lamp'),
  open(13, 35, 15, 36, 'cobble road and curb under the magic shop spire (front pieces vane-magic-roof and roof-magic-north)'),
  open(20, 35, 20.5, 35.5, 'cobble road north of the lamp behind the magic shop (lamp top y 35.5)'),
  open(20.5, 35, 21, 36, 'grey cobbles of the side road east of the lamp behind the magic shop'),
  open(42, 35, 42.5, 35.25, 'dirt road west of the pine'),
  open(42, 35.25, 42.25, 35.75, 'dirt road west of the pine'),
  open(8, 35.5, 9, 37, 'grass verge east of the west road curb, under the head of the corner lamp (front piece lamp-magic-corner)'),
  open(9.25, 35.5, 12, 35.75, 'cobble road under the crown of tree-magic-garden'),
  block(44, 35.5, 44.25, 36, 'east edge of the pine south of the museum road'),
  block(46.75, 35.5, 47.25, 35.75, 'top of the round bush south of the museum road'),
  block(16.25, 35.75, 16.75, 36, 'dark finial of the magic shop roof (x 16.25-16.6, from y 35.68)'),
  block(19.75, 35.75, 20, 36, 'west edge of the cap of the lamp behind the magic shop'),
  block(46, 35.75, 47.75, 36, 'upper part of the round bush south of the museum road'),
  open(12, 36, 12.75, 36.25, 'grass south of the curb above the small bush behind the magic shop (bush top y 36.25)'),
  open(15.25, 36, 16.25, 36.25, 'grass south of the curb above the bush behind the magic shop (bush top y 36.25)'),
  open(16.75, 36, 18, 36.25, 'grass south of the curb above the bushes behind the magic shop'),
  open(18, 36, 19.5, 37, 'grass in the garden east of the magic shop under the banner (front piece banner-magic-garden)'),
  block(22, 36, 22.25, 37, 'wooden post of the west stall (x 21.33-22.07, from y 36.12)'),
  open(38, 36, 39, 36.25, 'curb along the dirt road'),
  open(44.25, 36, 46, 36.25, 'curb along the dirt road between the pine and the bush'),
  open(47.75, 36, 50, 36.25, 'curb along the dirt road east of the bush'),
  block(39, 36.5, 39.25, 37, 'tree east of the forge strip at the stepping-stone lawn'),
  block(41.75, 36.5, 42, 37, 'lowest branches of the pine east of the stepping stones'),
  // Rows 37-45: west road, the plaza, the forge's back path and the ranch lawn.
  open(5.5, 37, 5.75, 37.75, 'grass at the foot of the curb west of the west road'),
  open(5.75, 37, 6, 43, 'flat curb on the west side of the west road'),
  open(8, 37, 9, 38.5, 'grass verge east of the road under lamp-magic-corner\'s head and post (front piece)'),
  open(17.75, 37, 19.75, 38.5, 'grass of the garden east of the magic shop'),
  block(22, 37, 22.25, 38, 'left post of the west stall'),
  open(28.5, 37, 29, 38, 'cobbles round the south-west fountain planter\'s pots'),
  block(32, 37, 32.5, 37.25, 'small right pot of the south-east fountain planter'),
  open(37.75, 37, 40, 39, 'lawn under tree-forge-strip\'s leaves (front piece)'),
  open(41, 37, 41.5, 40, 'lawn west of the fence post and pine beside the stepping stones'),
  open(64, 37, 64.75, 37.25, 'lawn of the clinic yard west of the stairs'),
  open(65.75, 37, 67, 37.25, 'lawn of the clinic yard west of the stairs'),
  open(67.75, 37, 68, 38, 'lawn of the clinic yard west of the stairs'),
  open(72, 37, 72.5, 40, 'paving and grass of the clinic yard east of the stairs'),
  open(77.5, 37, 78, 40, 'curb stones and cobbles on the west edge of the east road'),
  open(27, 37.25, 27.5, 38, 'cobbles round the south-west fountain planter\'s pots'),
  open(28.25, 37.25, 28.5, 38, 'cobbles round the south-west fountain planter\'s pots'),
  block(32, 37.25, 32.25, 37.5, 'small right pot of the south-east fountain planter'),
  block(63, 37.25, 63.25, 40, 'north-east bridge lamp and its stone pier'),
  open(64, 37.25, 64.5, 37.5, 'lawn of the clinic yard west of the stairs'),
  open(66, 37.25, 67, 37.5, 'lawn of the clinic yard west of the stairs'),
  open(31, 37.5, 31.25, 38, 'cobbles round the south-east fountain planter\'s pots'),
  block(52.75, 37.5, 53, 37.75, 'top of the north-west bridge lamp'),
  open(64, 37.5, 64.25, 38.25, 'lawn of the clinic yard west of the stairs'),
  open(66.25, 37.5, 67, 37.75, 'lawn of the clinic yard west of the stairs'),
  open(31.25, 37.75, 32, 38, 'cobbles round the south-east fountain planter\'s pots'),
  block(52.5, 37.75, 53, 38, 'head of the north-west bridge lamp'),
  open(66.5, 37.75, 67, 39, 'lawn of the clinic yard west of the stairs'),
  open(22.25, 38, 23.5, 38.25, 'cobbles under the west banner\'s pole (banner-plaza-west), above its stand'),
  open(23.5, 38, 24, 39, 'cobbles east of the west banner\'s stand'),
  open(25, 38, 27, 38.25, 'cobbles above the west stall\'s barrels'),
  open(33, 38, 33.5, 39, 'cobbles above the east stall\'s left post'),
  open(33.5, 38, 34, 38.5, 'cobbles beside the east stall\'s ring post'),
  open(52, 38, 52.5, 38.75, 'road west of the north-west bridge lamp\'s head'),
  open(71, 38, 71.5, 39, 'paving and grass of the clinic yard east of the stairs'),
  open(25, 38.25, 26.75, 38.5, 'cobbles above the west stall\'s barrels'),
  open(26.75, 38.25, 27, 42, 'cobbles east of the west stall\'s curly right pillar'),
  open(8, 38.5, 8.5, 40.25, 'shaded grass verge between the west road and lamp-magic-corner\'s base, above the tree by the magic shop'),
  open(17.75, 38.5, 19.5, 39, 'grass of the garden east of the magic shop'),
  open(26.5, 38.5, 26.75, 39, 'cobbles above the west stall\'s curly right pillar'),
  open(64, 38.5, 64.25, 40, 'lawn of the clinic yard west of the stairs'),
  open(52, 38.75, 52.25, 40, 'road west of the north-west bridge lamp\'s stone base'),
  open(5.5, 39, 5.75, 41, 'grass east of the big west tree'),
  open(18.75, 39, 19.5, 40.5, 'grass of the garden east of the magic shop'),
  open(20.5, 39, 20.75, 40.25, 'grass of the garden east of the magic shop'),
  open(21.5, 39, 21.75, 43, 'grass of the garden east of the magic shop'),
  open(37.75, 39, 38.25, 39.5, 'lawn under tree-forge-strip\'s leaves (front piece)'),
  block(40, 39, 40.25, 40, 'bush east of tree-forge-strip\'s trunk'),
  open(41.5, 39, 42.25, 40, 'grass below the fence\'s west end post'),
  open(67.75, 39, 69, 39.25, 'lawn of the clinic yard west of the stairs'),
  block(71.5, 39, 72, 39.25, 'small plant east of the clinic stairs'),
  open(19.5, 39.25, 20.5, 43, 'grass of the garden east of the magic shop'),
  block(32.75, 39.25, 33, 42, 'left post of the east stall'),
  open(64.25, 39.25, 64.75, 40, 'lawn of the clinic yard west of the stairs'),
  open(67.75, 39.25, 68, 40, 'lawn of the clinic yard west of the stairs'),
  open(68.75, 39.25, 69, 40, 'lawn of the clinic yard west of the stairs'),
  open(37.75, 39.5, 38, 40, 'lawn under tree-forge-strip\'s leaves (front piece)'),
  open(64.75, 39.5, 65, 40, 'lawn of the clinic yard west of the stairs'),
  open(65.75, 39.5, 66, 40, 'lawn of the clinic yard west of the stairs'),
  open(20.75, 40, 21.5, 40.25, 'grass of the garden east of the magic shop'),
  open(37.75, 40, 38, 43.5, 'stone path from the path behind the forge down to the training-yard lawn'),
  block(52.25, 40, 63.25, 40.25, 'face of the bridge\'s north rail and the stone piers of the bridge lamps'),
  open(21.25, 40.25, 21.5, 42.75, 'grass of the garden east of the magic shop'),
  open(19.25, 40.5, 19.5, 43.5, 'grass of the garden east of the magic shop'),
  block(7.75, 40.75, 8, 42.5, 'leaves of the tree beside the magic shop reach into the road'),
  open(17.75, 41, 18.5, 43.25, 'grass of the garden east of the magic shop'),
  open(39, 41, 39.75, 41.25, 'cobbles above the plant by the forge roof'),
  open(18.5, 41.25, 19.25, 43.25, 'grass of the garden east of the magic shop'),
  open(20.5, 41.25, 21.25, 42.5, 'grass of the garden east of the magic shop'),
  open(39, 41.25, 39.25, 41.5, 'cobbles above the plant by the forge roof'),
  open(39.5, 41.25, 39.75, 41.5, 'cobbles above the plant by the forge roof'),
  block(38.75, 41.5, 39, 43, 'plant beside the forge roof'),
  block(47.75, 41.5, 48.25, 42, 'tree south of the road east of the forge'),
  block(47.5, 41.75, 47.75, 42, 'tree south of the road east of the forge'),
  block(48.25, 41.75, 48.5, 42, 'tree south of the road east of the forge'),
  block(50.75, 41.75, 51, 42, 'round tree south of the road west of the bridge'),
  block(52.25, 41.75, 53.75, 42, 'stone foot of the west bridge lamp (front piece lamp-middle-bridge-west)'),
  block(62, 41.75, 63.5, 42, 'stone foot of the east bridge lamp (front piece lamp-middle-bridge-east)'),
  open(26.75, 42, 28, 42.5, 'cobbles under the south-west lamp\'s cream base (front piece lamp-plaza-south-west)'),
  open(31, 42, 32.75, 42.5, 'cobbles under the south-east lamp\'s cream base (front piece lamp-plaza-south-east)'),
  open(48.75, 42, 50.5, 42.5, 'grass nook between the two trees south of the road'),
  open(63.5, 42, 64, 44, 'grass and stepping stones east of the bridge pier'),
  open(21.75, 42.25, 26.5, 43.25, 'grass pocket between the west stall and the bar roof'),
  open(20.5, 42.5, 21, 42.75, 'grass of the garden east of the magic shop'),
  block(28, 42.5, 28.25, 43.5, 'stone foot of the south-west plaza lamp (front piece lamp-plaza-south-west)'),
  open(31, 42.5, 31.25, 43.5, 'cobbles west of the south-east lamp\'s stone foot'),
  open(32.5, 42.5, 32.75, 44.25, 'training-yard lawn south of the east stall'),
  open(48.75, 42.5, 50, 42.75, 'grass nook between the two trees south of the road'),
  open(20.5, 42.75, 20.75, 43, 'grass of the garden east of the magic shop'),
  open(32.75, 42.75, 37.75, 43.5, 'training-yard lawn south of the east stall'),
  open(48.75, 42.75, 49.75, 43.5, 'grass nook between the two trees south of the road'),
  block(73, 42.75, 73.25, 43, 'round bush on the ranch lawn'),
  block(5, 43, 5.25, 43.25, 'lowest leaves of the big west tree'),
  open(8, 43, 8.5, 43.5, 'grass west of the tree roots by the magic shop corner'),
  open(19.5, 43, 20.25, 43.25, 'grass of the garden east of the magic shop'),
  open(38, 43, 38.75, 43.25, 'stone path from the path behind the forge down to the training-yard lawn'),
  open(17, 43.25, 17.75, 44.25, 'grass between the magic shop corner and the bar roof, joining the garden to the magic apron'),
  open(17.75, 43.25, 18, 44.25, 'grass of the garden east of the magic shop'),
  open(18.75, 43.25, 19.25, 44.25, 'grass of the garden east of the magic shop'),
  open(19.5, 43.25, 20, 43.5, 'grass of the garden east of the magic shop'),
  open(22, 43.25, 24, 43.5, 'grass pocket between the west stall and the bar roof'),
  open(25.75, 43.25, 26.5, 44, 'grass pocket between the west stall and the bar roof'),
  open(4.5, 43.5, 5, 45, 'grass east of the big west tree\'s trunk'),
  open(8, 43.5, 9.5, 44, 'grass below the tree roots by the magic shop corner'),
  open(10, 43.5, 12.25, 44, 'stone steps of the magic shop porch below the planter and bench'),
  open(22.25, 43.5, 24, 43.75, 'grass pocket between the west stall and the bar roof'),
  open(26.5, 43.5, 28, 44.25, 'grass below the south-west plaza lamp, joining the pocket to the main road'),
  open(31, 43.5, 31.25, 46, 'grass strip between the main road and the training-yard fence'),
  open(31.25, 43.5, 32.5, 44.25, 'grass below the south-east plaza lamp, the way into the training-yard lawn'),
  open(32.75, 43.5, 34.25, 43.75, 'training-yard lawn south of the east stall'),
  open(36.5, 43.5, 37.5, 43.75, 'training-yard lawn south of the east stall'),
  open(12.25, 43.75, 13, 44, 'porch step below the box beside the door stairs'),
  open(22.5, 43.75, 24, 44, 'grass pocket between the west stall and the bar roof'),
  open(32.75, 43.75, 33.5, 44.25, 'training-yard lawn south of the east stall'),
  open(36.5, 43.75, 36.75, 44, 'training-yard lawn south of the east stall'),
  block(65.75, 43.75, 66.5, 44, 'trunk foot of tree-ranch-west (front piece)'),
  block(70.25, 43.75, 70.75, 44, 'trunk foot of tree-ranch-middle (front piece)'),
  open(9, 44, 9.25, 45, 'grass west of the dark post and bucket (under band5\'s lamp-magic head)'),
  open(9.25, 44, 9.5, 44.5, 'grass west of the dark post, above the bucket'),
  block(15.5, 44, 16.25, 44.25, 'legs of the urn stand east of the magic shop stairs'),
  open(23, 44, 24, 44.25, 'grass pocket between the west stall and the bar roof'),
  open(25.75, 44, 26, 44.25, 'grass pocket between the west stall and the bar roof'),
  open(63.75, 44, 64, 45, 'stepping stones east of the bush below the bridge pier'),
  block(65.75, 44, 66, 44.5, 'trunk foot of tree-ranch-west (front piece)'),
  open(77.5, 44, 78, 46, 'curb stones and cobbles on the west edge of the east road'),
  open(17, 44.25, 17.5, 44.5, 'grass west of the bar roof\'s west slope'),
  open(31.25, 44.25, 31.5, 46, 'grass strip between the main road and the training-yard fence'),
  open(17, 44.5, 17.25, 44.75, 'grass west of the bar roof\'s west slope'),
  open(66, 44.5, 66.5, 46, 'grass west of the ranch\'s west fence'),
  open(16, 45, 16.25, 46, 'magic apron cobbles west of the lantern stand'),
  open(28.25, 45, 29, 46, 'pink sidewalk strip west of the main road'),
  open(63.5, 45, 64, 46, 'grass east of the bush below the bridge pier'),
  // Rows 46-54: magic garden, the forge and the ranch yard.
  open(8, 46, 13, 46.5, 'grass and stone strip between the magic apron and the magic garden fence (fence top y 46.55)'),
  open(14, 46, 16.25, 46.5, 'grass under the crown of front piece pine-magic-yard, south of the stone path'),
  open(31, 46, 31.25, 51, 'grass strip between the main road\'s east curb (x 31.0) and the training yard\'s west fence (from x 31.39)'),
  block(79.75, 46, 80, 55, 'pink bead curb and vine border along the east road\'s right edge'),
  block(13, 46.5, 13.25, 51, 'east fence of the magic garden, the alley\'s west side (x 13.0-13.3)'),
  open(14, 46.5, 14.5, 51, 'east half of the grass alley, west of the fence post column (from x 14.55)'),
  open(4, 48, 5, 48.25, 'lawn north of the west lawn fence (fence top y 48.3)'),
  open(4.75, 48.25, 5, 48.75, 'lawn between the last fence post (to x 4.57) and the lamp pedestal (top y 48.61)'),
  block(5, 48.75, 5.5, 49, 'pedestal of front piece lamp-west-lawn (x 4.72-5.51, y 48.61-49.45)'),
  open(27.5, 48.75, 28, 53, 'grass strip east of the bar garden fence end (post to y 48.57), the crate and the yard fence (to x 27.4)'),
  open(5.5, 49, 6, 49.5, 'lawn and flat bead border east of the lamp pedestal (to x 5.51)'),
  open(0, 49.5, 6, 50, 'curb and cobbles of the forest road north edge, south of the west lawn garden fence (fence bottom y 49.5)'),
  open(44, 50, 46.75, 50.5, 'pink floor of the forge porch east of the apron, south of the grinding wheel (to y 49.8), north of the post tops (from y 50.57)'),
  open(32, 50.75, 35.5, 51, 'yard ground south of the front training dummies\' feet (bottom y 50.67)'),
  open(0, 51, 8, 51.75, 'south dirt edge and flat stone curb of the forest road (curb bottom y 51.72); the corner x 6-8 lies under front piece tree-forest-road'),
  block(36, 51, 37, 51.25, 'fence rail and post south of the training yard (post x 36.35-36.77 to y 51.33)'),
  block(39, 51, 41, 51.25, 'legs of the anvil and tool stands (bottom y 51.2)'),
  block(2.5, 51.25, 3.25, 51.5, 'tip of the pine south of the forest road (tip x 2.89, y 51.22)'),
  block(39, 51.25, 39.25, 52.25, 'post at the west end of the forge ledge (x 39.0-39.32, y 51.0-52.2)'),
  block(2.25, 51.5, 3.5, 51.75, 'pine south of the forest road, its top widens to x 2.3-3.5 at y 51.75'),
  open(17, 51.5, 19, 52, 'apron cobbles south of the bar front wall (wall foot y 51.45)'),
  open(22.75, 51.5, 24, 52, 'apron cobbles south of the bar\'s east front wall, east of the stair cheek (cheek to x 22.56), west of the yard fence (post from x 24.18, y 51.75)'),
  block(15, 52, 16.25, 52.25, 'bottom of the bar barrel (x 15.44-16.22, to y 52.28) and the post west of it'),
  open(31, 52, 32, 53.25, 'grass around the foot of the yard corner post (front piece post-yard-corner), north of the south bridge east lamp\'s lantern (top y 53.3)'),
  block(31.5, 52, 31.75, 52.5, 'foot of the yard corner post (x 31.44-31.75, bottom y 52.5)'),
  open(34, 52, 36, 53, 'lawn under the canopy of front piece tree-forge-lawn (its trunk is in band6)'),
  block(15, 53, 15.25, 54, 'fence post at the apron\'s west end (x 14.81-15.18, y 53.0-54.6)'),
  open(19, 53, 20, 53.25, 'apron cobbles north of the fence post top (y 53.19)'),
  open(59, 53, 60, 55, 'lawn between the rocks (to x 59.07) and the big meadow-north tree\'s trunk (from x 60.06)'),
  open(61.75, 53, 63.25, 55, 'lawn east of the big meadow-north tree, west of the rose bush'),
  open(69.5, 53, 70, 54, 'ranch door steps right of the left wall lantern (steps from x 69.44)'),
  open(69.25, 53, 69.5, 53.75, 'right edge of the ranch\'s left wall lantern (to x 69.44): open so the walk-in lane up from the return arrival (69,54) to the door tile (69,52) is clear; the redrawn door sits half a tile right of its door tiles'),
  open(71, 53, 71.25, 54, 'east end of the ranch steps (to x 71.23), left of the right wall lantern'),
  open(19.75, 53.25, 20, 54, 'apron cobbles east of the fence post (post to x 19.59)'),
  open(31, 53.25, 31.25, 55, 'grass strip west of the south bridge east lamp\'s lantern (lantern from x 31.36)'),
  open(63.25, 53.75, 64.5, 55, 'grass with loose flowers between the rose bush (bottom y 53.65) and the ranch fence post (from x 64.44)'),
  open(68.75, 53.75, 69.5, 54, 'pink paving below the ranch\'s left wall lantern (lantern bottom y 53.65)'),
  open(71.25, 53.75, 72.5, 54.25, 'grey landing stones below the ranch\'s right wall lantern (lantern bottom y 53.65), west of the fence post (x 72.48), north of the bush'),
  open(24, 54, 26, 54.25, 'pink stepping stones north of the bush (bush top y 54.4)'),
  open(68.75, 54, 69, 55, 'pink paving between the left fence posts (to x 68.73) and the landing'),
  open(76.5, 54, 78, 55, 'grass and flat border pebbles west of the east road, at the top of the dirt path to the meadow'),
  open(25.75, 54.25, 26, 55, 'grass east of the bush (bush to x 25.58)'),
  block(71.75, 54.25, 72, 55, 'small bush east of the ranch landing (x 71.82-72.47, y 54.14-55.0)'),
  block(20, 54.75, 20.25, 55, 'top of the fence post at the bar stairs\' west side (x 19.73-20.15, from y 54.73)'),
  // Rows 55-63: meadow, the bar apron, the docks and the south bridge.
  open(17, 55, 17.5, 59.25, 'dock walkway planks west of the vine rail post'),
  block(28, 55, 28.25, 56.25, 'stone pedestal corner of the south bridge west lamp'),
  open(63.25, 55, 64.25, 56.75, 'grass strip between the boulder (ends x 63.24) and the cow pen post (from x 64.28)'),
  block(70.75, 55, 71, 57.25, 'ranch gate post (x 70.75-71.27, y 55.18-57.26)'),
  open(76.5, 55, 78, 56.75, 'grass and flat border pebbles west of the dirt path to the meadow, east of the ranch yard corner post'),
  open(68.75, 55.25, 69, 56.75, 'paving east of the cow pen post (x 68.1-68.56)'),
  open(58.75, 55.5, 59.75, 55.75, 'grass east of the railing post (ends x 58.68), at the top of the tree-meadow canopy (front piece)'),
  block(16, 55.75, 16.25, 59.75, 'water gap and post C west of the dock walkway planks'),
  open(58.25, 55.75, 61.5, 56.25, 'grass below the dark bush (ends y 55.65), under the tree-meadow canopy (front piece)'),
  open(20.5, 56, 21, 57.5, 'lower stairs to the river (west part)'),
  block(22.75, 56, 23, 58, 'plant and stone edge east of the lower stairs'),
  open(31, 56.25, 31.25, 64, 'south bridge deck west of the east chain rail (x 31.3-31.62)'),
  open(57.75, 56.25, 61.5, 56.75, 'grass under the tree-meadow canopy (front piece), east of the fishing hut\'s side'),
  open(61.5, 56.5, 62.25, 56.75, 'grass below the pink rocks (x 61.5-62.3, end y 56.43)'),
  open(57.75, 56.75, 63.25, 57, 'meadow grass under the tree-meadow canopy and below the rocks and boulder'),
  open(65.25, 56.75, 68, 57, 'meadow grass below the cow pen rails and posts (end y 56.77)'),
  open(68.5, 56.75, 69, 57, 'paving east of the cow pen\'s corner post'),
  open(71.25, 56.75, 78, 57, 'meadow grass below the ranch yard fence posts (end y 56.64)'),
  block(51, 57, 51.25, 58.75, 'pier\'s west pilings'),
  block(54.25, 57, 55, 57.25, 'foot of the pier\'s east corner post x 54.3-54.8 to y 57.12'),
  block(56, 57, 56.5, 57.25, 'second clay pot by the fishing hut (55.98-56.5, to y 57.33)'),
  open(63, 57, 63.25, 58, 'grass west of the meadow stones (x 63.32-65.08, y 56.69-58.38)'),
  block(71, 57, 71.25, 57.25, 'foot of the ranch gate post'),
  open(78, 57, 79, 57.5, 'dirt path behind the meadow lamp post (front piece lamp-east-meadow) and the pine tip (pine-meadow)'),
  open(78, 57.5, 78.5, 58, 'grass west of the meadow lamp post\'s foot, under the pine-meadow tip (front piece)'),
  block(21, 57.75, 23, 58, 'river at the foot of the stairs'),
  open(52, 58, 52.5, 58.75, 'pier deck west of the mooring post'),
  block(55.25, 58, 56, 58.25, 'bottom of the bucket by the hut (x 55.3-55.98, y 57.54-58.17)'),
  block(63.25, 58, 65, 58.25, 'bottom of the meadow stones'),
  block(51, 58.75, 52, 59, 'water under the pier deck\'s west end'),
  block(12, 59, 16.25, 59.25, 'dock deck\'s north edge (water above it)'),
  block(13.75, 59, 14, 59.75, 'dock post B (x 13.78-14.25)'),
  open(56, 59, 58, 59.25, 'grass above the tree-yard fence post (from y 59.18) and the vine pole (from y 59.33)'),
  block(61.75, 59, 62.25, 61, 'east fence post of the meadow tree yard (x 61.96-62.32, y 59.18-61.05)'),
  open(64, 59, 66, 59.25, 'grass under the grove-meadow-south canopy (front piece)'),
  open(66.5, 59, 68, 59.5, 'grass between the dark grove crest (ends x 66.48 at y 59.47) and the light tree top (y 59.64)'),
  open(14.25, 59.25, 15.5, 60, 'dock deck between posts B and C'),
  open(17, 59.25, 17.25, 60.5, 'dock walkway planks west of the fishing rod stand (x 17.3-17.53, y 59.27-60.45)'),
  block(53, 59.5, 53.25, 60, 'east edge of the pine south of the pier'),
  open(14, 59.75, 14.25, 60, 'dock deck south of post B'),
  open(15.5, 59.75, 16, 60, 'dock deck south of post C'),
  block(68, 59.75, 68.25, 60, 'light tree\'s top-right slope'),
  block(71.25, 59.75, 71.75, 60, 'tip of the pine on the lawn'),
  open(53.5, 60, 54, 61, 'grass east of the pine south of the pier'),
  block(74.75, 60, 75, 61.75, 'bush on the lawn (x 74.78-75.62, y 60.1-61.8)'),
  block(72, 60.25, 72.25, 61, 'east edge of the pine on the lawn'),
  block(13.75, 60.5, 14.25, 61, 'dock post on the deck\'s south edge'),
  block(54.75, 60.5, 55, 60.75, 'cottage roof spire (x 54.74-54.96, from y 60.43)'),
  block(69, 60.5, 69.25, 61, 'edge of the light tree west of the lawn'),
  block(15.75, 60.75, 16, 61, 'gazebo roof spire tip (x 15.73-16.05)'),
  block(54.5, 60.75, 55.25, 61, 'cottage roof slopes below the spire'),
  block(70.75, 60.75, 71, 61, 'pine on the lawn (x 70.48-72.7, y 59.77-62.37)'),
  block(76.5, 60.75, 77, 61, 'top of the big tree (x 76.73, y 60.77)'),
  open(12.5, 61, 13.75, 64, 'plank stairs down from the pier deck and the walk behind the fishing shop roof (front piece roof-fishing-back) to the boardwalk row'),
  block(79, 61.5, 79.25, 62, 'right edge of the big tree on the verge'),
  block(73.25, 61.75, 73.75, 62, 'tip of the small conifer (x 73.0-73.86, y 61.92-62.7)'),
  open(74, 62, 75.25, 62.5, 'lawn above the south fence (top y 62.57)'),
  // Rows 64-74: south bridge, the pier, the shore and the south grove.
  block(28, 64, 28.25, 67, 'west bridge pedestal and lamp base (x 26.7-28.04, to y 67.3)'),
  open(12.5, 64, 13.75, 65.25, 'foot of the plank stairs down from the pier deck, behind the fishing shop roof (front piece roof-fishing-back)'),
  open(31, 64, 31.25, 71, 'pebble edge east of the main road; east pedestal starts x 31.21, fence beyond'),
  open(5, 65.25, 10, 65.75, 'west boardwalk planks below the waterside fence (posts end y 65.32), up to the dark lantern post (x 9.5-10.0 from y 65.82)'),
  open(10, 65.25, 17.25, 66.5, 'boardwalk row behind the fishing shop, hidden by front piece roof-fishing-back (eave bottom y 66.47)'),
  open(17.25, 65.25, 18.75, 65.5, 'east boardwalk planks below the rail beam (y 65.09), west of the rail post (x 18.9)'),
  open(20.25, 65.25, 23.75, 67, 'lawn with pink stepping stones east of the east boardwalk (picket tops y 67.19, pine from x 23.8)'),
  open(17.25, 65.5, 20.25, 66.5, 'east boardwalk planks behind the fishing shop (rail posts end y 65.37 and 65.52)'),
  open(5, 65.75, 9.5, 66, 'west boardwalk planks west of the dark lantern post (x 9.5-10.0)'),
  open(5, 66, 7.75, 66.75, 'west boardwalk planks west of the deck post (x 7.65-8.06 from y 66.1); deck edge y 66.75'),
  open(8, 66, 9.5, 66.5, 'west boardwalk planks east of the deck post, above the T-sign (top y 66.57)'),
  open(18.75, 66.5, 19.75, 67.25, 'lower boardwalk nook between the shop\'s corner and the rail post (x 19.78); barrel below from y 67.34'),
  open(28.5, 67, 29, 71, 'pebble edge of the main road west of the path (pink edging ends x 28.45)'),
  open(8, 68.25, 9.25, 71, 'garden grass under and behind the garden lamp (front piece lamp-fishing-garden); T-sign ends y 67.8, fence post x 7.6-8.1 ends y 68.1, shop wall from x 9.23'),
  open(18.75, 68.25, 19.75, 69, 'grass strip north of (19,69), below the barrel (ends y 68.15)'),
  open(5.5, 69, 6.25, 69.25, 'garden grass below the low garden fence (posts end y 68.83), west of the round tree'),
  open(18.75, 69, 19, 70, 'grass west of the strip (19,69); the shop\'s wheel stack ends x 18.72'),
  open(53.5, 69, 54, 70, 'cobbles east of the alchemy pot (pot x 53.0-53.48) in front of the door'),
  open(5, 69.25, 6.25, 69.5, 'garden grass below the flower stalk (ends y 69.15), west of the round tree'),
  open(5, 69.5, 6.5, 71.5, 'flower garden grass west of the round tree; dark bush below from y 71.38'),
  open(7.5, 69.75, 8, 70, 'garden grass below the round tree\'s crown (ends y 69.7 east of x 7.36)'),
  block(12.5, 70, 12.75, 70.25, 'stone cheek at the west end of the fishing shop steps (x 12.4-12.75 to y 70.15)'),
  open(15, 70, 15.25, 70.5, 'ground west of the barrels (barrels from x 15.28)'),
  open(17.75, 70, 18, 70.5, 'ground east of the barrels (to x 17.7), south of the wheel stack (ends y 69.95)'),
  open(39.5, 70, 40, 70.75, 'ground east of the spinning wheel (to x 39.53)'),
  open(6.5, 70, 8.5, 71.5, 'garden grass and low flowers south of the round tree (roots end y 70.08), west of the lamp post'),
  block(71.75, 70, 72, 70.5, 'carpenter pot west edge x 71.8'),
  block(74.75, 70, 75, 71.5, 'barrel stack west edge x 74.77 (to y 71.44)'),
  block(56.75, 70.25, 57, 71.5, 'rose bush west edge x 56.81 (y 70.3-71.4)'),
  open(11, 70.5, 12, 71, 'road south of the pot (pot ends y 70.49)'),
  open(15, 70.5, 18, 71, 'road south of the barrels (end y 70.53)'),
  open(66, 70.5, 69, 71, 'road south of the carpenter flower boxes and barrel (end y 70.4)'),
  open(72, 70.5, 74, 71, 'road south of the carpenter pot and chest (end y 70.45)'),
  open(38.5, 70.75, 40, 71, 'road and shadow south of the spinning wheel (ends y 70.7)'),
  block(20, 71, 28, 71.25, 'flower bed, tree roots and pot bottoms north of the road (y 71.13-71.43)'),
  block(31.25, 71, 36.75, 71.25, 'raised flower bed bottom edge (y 71.22)'),
  block(45, 71, 50, 71.25, 'sign, hedge, fence and post bottoms (~y 71.3)'),
  open(51.5, 71, 52, 71.5, 'ground east of the urn (urn x 50.49-51.43)'),
  block(58, 71, 66, 71.25, 'garden fence, pole and barrel bottoms (y 71.25-71.4)'),
  block(78, 71, 78.25, 71.5, 'pink planter east edge x 78.23'),
  block(9, 71.25, 9.25, 72, 'base of the fishing garden lamp (x 8.44-9.14, y 71.05-72.0; front piece lamp-fishing-garden)'),
  block(20, 71.25, 20.25, 71.5, 'fence post foot x 19.94-20.29 to y 71.29'),
  open(6.5, 71.5, 8.5, 72, 'garden grass east of the dark bush (to x 6.38) and west of the lamp base (from x 8.44)'),
  open(50, 71.5, 52, 72, 'road south of the post and urn (end y 71.43)'),
  open(57, 71.5, 58, 72, 'road south of the rose bush (ends y 71.4)'),
  open(75, 71.5, 78, 72, 'road south of the barrels, pole and planter (end y 71.35-71.49)'),
  open(6.75, 72, 8, 72.25, 'dirt path between the dark bush and the bush by the road (from x 8.04)'),
  block(27.25, 72.75, 27.5, 73, 'finial of the beach path lamp (x 27.24-27.48, top y 72.81)'),
  block(43, 72.75, 45, 73, 'bush top above the south fence (y 72.66)'),
  block(50.5, 72.75, 51, 73, 'pine top above the south fence (y 72.66)'),
  block(54.25, 72.75, 55.5, 73, 'pine top above the south fence (y 72.81)'),
  block(63.5, 72.75, 64.25, 73, 'bush top above the south fence (y 72.77)'),
  block(65.25, 72.75, 66.25, 73, 'bush top above the south fence (x 65.27-66.3, tip y 72.6)'),
  block(78.5, 72.75, 79, 73, 'pine top above the south fence (y 72.76)'),
  open(31, 73, 31.25, 75, 'dirt edge of the beach path (x 31.0-31.33)'),
];

/** Texels per world pixel of every Town texture. */
const TEXELS_PER_PIXEL = 2;

/**
 * One painted resource node (see TOWN_NODES).
 * @param kind 'tree' or 'rock'
 * @param tx tile x of the node's foot
 * @param ty tile y of the node's foot
 * @param frame where the node's pixels sit in the atlas (frameX, frameY, w, h) and in the painting (roomX, roomY)
 * @returns the map object, carrying its atlas frame
 */
function node(kind: 'tree' | 'rock', tx: number, ty: number, frame: Omit<PaintedNodeArt, 'texture' | 'texelsPerPixel'>): ObjectDef {
  return { kind, tx, ty, painted: { texture: TextureKey.TownNodes, texelsPerPixel: TEXELS_PER_PIXEL, ...frame } };
}

/**
 * The Town's resource nodes: the meadow stones only. The frame is printed by scripts/pack-town-art.py (its
 * NODES list); keep them in step.
 */
export const TOWN_NODES: readonly ObjectDef[] = [
  node('rock', 64, 57, { frameX: 0, frameY: 0, w: 63, h: 52, roomX: 2026, roomY: 1806 }),
];

/**
 * The Town's textures, its walk-behind trees, lamp posts and banners, and the glow of its lamps and the forge
 * fire (texel coordinates; 2 texels per world px).
 */
export const TOWN_ART: PaintedRoomArt = {
  backdrop: TextureKey.Town,
  front: TextureKey.TownFront,
  widthTexels: 2624,
  heightTexels: 2400,
  texelsPerPixel: TEXELS_PER_PIXEL,
  // The boxes hold the PIECES shapes in scripts/pack-town-art.py (it prints them); baseY is where each trunk,
  // post or pole meets the ground.
  pieces: [
    { name: 'tree-windmill-lane', x: 646, y: 254, w: 174, h: 178, baseY: 429 },
    { name: 'pine-windmill-yard', x: 604, y: 366, w: 74, h: 108, baseY: 472 },
    { name: 'tree-west-lawn', x: 458, y: 420, w: 102, h: 164, baseY: 581 },
    { name: 'pine-guild-path', x: 1018, y: 390, w: 72, h: 110, baseY: 498 },
    { name: 'tree-guild-path-mid', x: 1090, y: 398, w: 92, h: 156, baseY: 554 },
    { name: 'tree-guild-lawn', x: 1190, y: 412, w: 88, h: 70, baseY: 480 },
    { name: 'tree-guardhouse-lawn', x: 2150, y: 272, w: 132, h: 154, baseY: 426 },
    { name: 'tree-shrine-lawn', x: 2370, y: 336, w: 104, h: 138, baseY: 472 },
    { name: 'tree-west-road-end', x: 1, y: 666, w: 105, h: 136, baseY: 800 },
    { name: 'pine-west-road', x: 644, y: 626, w: 80, h: 116, baseY: 744 },
    { name: 'pine-west-road-west', x: 548, y: 660, w: 80, h: 78, baseY: 744 },
    { name: 'pine-west-road-east', x: 736, y: 676, w: 68, h: 62, baseY: 744 },
    { name: 'pine-market-back', x: 440, y: 684, w: 18, h: 14, baseY: 736 },
    { name: 'tree-notice-lawn', x: 1064, y: 626, w: 178, h: 184, baseY: 808 },
    { name: 'tree-stepping-stones', x: 1624, y: 570, w: 138, h: 164, baseY: 733 },
    { name: 'tree-guardhouse-road', x: 2210, y: 780, w: 64, h: 46, baseY: 824 },
    { name: 'bush-guardhouse-road', x: 2336, y: 788, w: 104, h: 38, baseY: 824 },
    { name: 'tree-magic-garden', x: 298, y: 1100, w: 84, h: 54, baseY: 1168 },
    { name: 'tree-forge-strip', x: 1202, y: 1156, w: 74, h: 126, baseY: 1280 },
    { name: 'pine-bar-garden', x: 588, y: 1300, w: 80, h: 110, baseY: 1411 },
    { name: 'tree-ranch-west', x: 2082, y: 1334, w: 74, h: 92, baseY: 1424 },
    { name: 'tree-ranch-middle', x: 2220, y: 1330, w: 72, h: 82, baseY: 1411 },
    { name: 'tree-forest-road', x: 192, y: 1566, w: 104, h: 180, baseY: 1744 },
    { name: 'pine-magic-yard', x: 464, y: 1466, w: 58, h: 66, baseY: 1533 },
    { name: 'pine-ranch', x: 2376, y: 1338, w: 106, h: 172, baseY: 1509 },
    { name: 'tree-meadow', x: 1806, y: 1770, w: 176, h: 170, baseY: 1939 },
    { name: 'pine-meadow', x: 2460, y: 1832, w: 94, h: 122, baseY: 1952 },
    { name: 'tree-forge-lawn', x: 1062, y: 1632, w: 140, h: 154, baseY: 1784 },
    { name: 'bush-south-road', x: 700, y: 2312, w: 152, h: 87, baseY: 2400 },
    { name: 'grove-meadow-south', x: 2034, y: 1870, w: 104, h: 52, baseY: 2104 },
    { name: 'banner-windmill-lane', x: 852, y: 206, w: 56, h: 234, baseY: 438 },
    { name: 'lamp-east-north', x: 2510, y: 364, w: 30, h: 116, baseY: 478 },
    { name: 'banner-west-road', x: 850, y: 612, w: 68, h: 190, baseY: 800 },
    { name: 'banner-notice-lawn', x: 982, y: 578, w: 68, h: 214, baseY: 792 },
    { name: 'stall-roof-notice-lawn', x: 1296, y: 520, w: 88, h: 38, baseY: 630 },
    { name: 'lamp-notice-board', x: 1442, y: 648, w: 28, h: 114, baseY: 760 },
    { name: 'lantern-museum-road', x: 1488, y: 752, w: 26, h: 24, baseY: 800 },
    { name: 'lamp-north-bridge-west', x: 1766, y: 740, w: 46, h: 94, baseY: 800 },
    { name: 'lamp-north-bridge-east', x: 2026, y: 738, w: 48, h: 96, baseY: 800 },
    { name: 'lamp-middle-road', x: 1592, y: 1056, w: 30, h: 128, baseY: 1182 },
    { name: 'statue-fountain', x: 918, y: 978, w: 68, h: 40, baseY: 1024 },
    { name: 'banner-magic-garden', x: 576, y: 1122, w: 56, h: 200, baseY: 1322 },
    { name: 'lamp-magic-corner', x: 272, y: 1138, w: 26, h: 120, baseY: 1256 },
    { name: 'vane-magic-roof', x: 436, y: 1098, w: 40, h: 24, baseY: 1376 },
    { name: 'roof-magic-north', x: 418, y: 1122, w: 62, h: 32, baseY: 1376 },
    { name: 'banner-plaza-west', x: 704, y: 1040, w: 66, h: 210, baseY: 1250 },
    { name: 'banner-plaza-east', x: 1146, y: 1040, w: 58, h: 210, baseY: 1250 },
    { name: 'lamp-plaza-south-west', x: 852, y: 1276, w: 54, h: 116, baseY: 1392 },
    { name: 'lamp-plaza-south-east', x: 996, y: 1278, w: 50, h: 116, baseY: 1392 },
    { name: 'lamp-middle-bridge-west', x: 1674, y: 1284, w: 46, h: 70, baseY: 1354 },
    { name: 'lamp-middle-bridge-east', x: 1984, y: 1288, w: 46, h: 66, baseY: 1354 },
    { name: 'lamp-west-lawn', x: 148, y: 1452, w: 32, h: 130, baseY: 1582 },
    { name: 'lamp-magic', x: 268, y: 1400, w: 32, h: 124, baseY: 1522 },
    { name: 'post-yard-corner', x: 1006, y: 1632, w: 12, h: 48, baseY: 1680 },
    { name: 'roof-forge-back', x: 1270, y: 1274, w: 204, h: 48, baseY: 1576 },
    { name: 'post-forge-apron', x: 1308, y: 1640, w: 16, h: 88, baseY: 1725 },
    { name: 'lamp-east-meadow', x: 2506, y: 1776, w: 32, h: 64, baseY: 1854 },
    { name: 'lamp-bar-stairs', x: 748, y: 1674, w: 18, h: 128, baseY: 1802 },
    { name: 'lamp-south-bridge-west', x: 856, y: 1702, w: 46, h: 100, baseY: 1802 },
    { name: 'post-bar-stairs-west', x: 610, y: 1700, w: 20, h: 90, baseY: 1798 },
    { name: 'lamp-fishing-garden', x: 268, y: 2180, w: 34, h: 126, baseY: 2304 },
    { name: 'roof-fishing-back', x: 320, y: 1996, w: 242, h: 150, baseY: 2256 },
  ],
  // The glass of every painted lamp and lantern, and the forge's open fire (measured on the packed town.png:
  // the centre of each lamp's bright glass).
  lights: [
    { kind: 'torch', x: 893, y: 95, size: 28 }, // main road, north pair: west lamp glass (x 880-905, y 80-109)
    { kind: 'torch', x: 1009, y: 95, size: 28 }, // main road, north pair: east lamp glass (x 994-1023, y 82-107)
    { kind: 'torch', x: 2292, y: 177, size: 28 }, // shrine pair: left lamp glass (x 2276-2306, y 158-197)
    { kind: 'torch', x: 2404, y: 177, size: 28 }, // shrine pair: right lamp glass (x 2387-2417, y 156-197)
    { kind: 'torch', x: 877, y: 241, size: 28 }, // banner lamp by the windmill lane: lantern glass (x 860-895, y 224-257)
    { kind: 'torch', x: 1007, y: 322, size: 28 }, // glass of the lamp at the manor lane's corner (x 31.16-31.74, y 9.64-10.35)
    { kind: 'torch', x: 2524, y: 396, size: 28 }, // glass of the lamp at the north end of the east road (centre x 78.89, y 12.38)
    { kind: 'torch', x: 894, y: 517, size: 28 }, // glass of the lamp on the grass strip west of the main road (x 27.59-28.31, y 15.84-16.46)
    { kind: 'torch', x: 905, y: 638, size: 28 }, // banner lamp where the west road meets the main road
    { kind: 'torch', x: 996, y: 610, size: 28 }, // lantern on the notice lawn banner post, east curb of the main road
    { kind: 'torch', x: 1457, y: 677, size: 28 }, // glass of the iron lamp west of the notice board (x 45.18-45.85, y 20.76-21.54)
    { kind: 'torch', x: 1789, y: 678, size: 28 }, // lamp on the rock pillar at the north-west end of the bridge
    { kind: 'torch', x: 2051, y: 677, size: 28 }, // lamp on the rock pillar at the north-east end of the bridge
    { kind: 'torch', x: 2461, y: 682, size: 28 }, // lamp by the watch-house stairs (glass at x 76.89, y 21.29)
    { kind: 'torch', x: 1789, y: 767, size: 28 }, // lamp on the west bridge-end pillar
    { kind: 'torch', x: 2050, y: 768, size: 28 }, // lamp on the east bridge-end pillar
    { kind: 'torch', x: 1608, y: 941, size: 28 }, // lamp on the west verge of the middle road, beside the museum
    { kind: 'torch', x: 703, y: 1008, size: 28 }, // lamp at the north-west plaza garden
    { kind: 'torch', x: 1203, y: 1007, size: 28 }, // lamp west of the museum garden
    { kind: 'torch', x: 739, y: 1069, size: 28 }, // lantern on the west plaza banner pole
    { kind: 'torch', x: 1174, y: 1068, size: 28 }, // lantern on the east plaza banner pole
    { kind: 'torch', x: 1607, y: 1088, size: 28 }, // lamp-middle-road, middle road beside the museum
    { kind: 'torch', x: 284, y: 1167, size: 28 }, // lamp at the magic shop corner by the west road
    { kind: 'torch', x: 644, y: 1165, size: 28 }, // lamp behind the magic shop garden
    { kind: 'torch', x: 1717, y: 1168, size: 28 }, // lamp on the east bank of the middle road
    { kind: 'torch', x: 2465, y: 1171, size: 28 }, // lamp east of the clinic by the east road
    { kind: 'torch', x: 1696, y: 1225, size: 28 }, // glass of the north-west bridge lamp
    { kind: 'torch', x: 2008, y: 1225, size: 28 }, // glass of the north-east bridge lamp
    { kind: 'torch', x: 879, y: 1311, size: 28 }, // glass of the south-west plaza lamp (lamp-plaza-south-west)
    { kind: 'torch', x: 1019, y: 1312, size: 28 }, // glass of the south-east plaza lamp (lamp-plaza-south-east)
    { kind: 'torch', x: 1696, y: 1318, size: 28 }, // glass of the west bridge lamp (lamp-middle-bridge-west)
    { kind: 'torch', x: 2008, y: 1317, size: 28 }, // glass of the east bridge lamp (lamp-middle-bridge-east)
    { kind: 'torch', x: 280, y: 1429, size: 28 }, // glass of the street lamp at the magic shop's south-west corner (band5 piece lamp-magic)
    { kind: 'torch', x: 164, y: 1487, size: 28 }, // glass of front piece lamp-west-lawn (5.11, 46.47): west lawn and forest road
    { kind: 'brazier', x: 1341, y: 1518, size: 48 }, // the forge's open hearth fire (41.92, 47.45)
    { kind: 'torch', x: 505, y: 1587, size: 28 }, // bar west lamp glass (15.78, 49.6): bar apron
    { kind: 'torch', x: 839, y: 1583, size: 28 }, // bar east lamp glass (26.23, 49.48): bar apron and main road
    { kind: 'torch', x: 2214, y: 1705, size: 28 }, // ranch left wall lantern by the door (69.19, 53.27)
    { kind: 'torch', x: 2287, y: 1705, size: 28 }, // ranch right wall lantern by the door (71.48, 53.27)
    { kind: 'torch', x: 878, y: 1736, size: 28 }, // lantern of lamp-south-bridge-west (27.44, 54.25)
    { kind: 'torch', x: 1017, y: 1739, size: 28 }, // lantern of the south bridge east lamp (31.78, 54.34)
    { kind: 'torch', x: 2522, y: 1805, size: 28 }, // lantern of the meadow lamp on the east road (glass centre x 78.81, y 56.4)
    { kind: 'torch', x: 878, y: 2077, size: 28 }, // west lamp on the south bridge (glass centre 27.44, 64.91)
    { kind: 'torch', x: 1017, y: 2073, size: 28 }, // east lamp on the south bridge (glass centre 31.77, 64.79)
    { kind: 'torch', x: 2096, y: 2083, size: 28 }, // lamp west of the carpenter shop (glass centre 65.49, 65.10)
    { kind: 'torch', x: 2434, y: 2108, size: 28 }, // lamp east of the carpenter shop, behind the barrels (glass centre 76.06, 65.87); new
    { kind: 'torch', x: 282, y: 2211, size: 28 }, // fishing garden lamp (glass centre 8.81, 69.10)
    { kind: 'torch', x: 1196, y: 2210, size: 28 }, // tailor lamp (glass centre 37.36, 69.06)
    { kind: 'torch', x: 875, y: 2363, size: 28 }, // beach path lamp (glass centre 27.34, 73.85)
  ],
  // The moving water, printed by scripts/pack-town-art.py (keep in step). Each sheet is opaque only on blue
  // water, so the painted bridges, dock and lily pads show through; it draws just above the backdrop, under
  // the keeper and every front piece.
  animations: [
    { name: 'water-fall-north', texture: TextureKey.TownWaterFallNorth, x: 1856, y: 0, frameWidth: 160, frameHeight: 72, frames: 8, fps: 10 },
    { name: 'water-river-north', texture: TextureKey.TownWaterRiverNorth, x: 1844, y: 0, frameWidth: 212, frameHeight: 752, frames: 8, fps: 6 },
    { name: 'water-river-middle', texture: TextureKey.TownWaterRiverMiddle, x: 1762, y: 846, frameWidth: 260, frameHeight: 426, frames: 8, fps: 6 },
    { name: 'water-river-bend-north', texture: TextureKey.TownWaterRiverBendNorth, x: 1674, y: 1390, frameWidth: 268, frameHeight: 210, frames: 8, fps: 6 },
    { name: 'water-river-bend-south', texture: TextureKey.TownWaterRiverBendSouth, x: 1408, y: 1600, frameWidth: 438, frameHeight: 272, frames: 8, fps: 6 },
    { name: 'water-river-east', texture: TextureKey.TownWaterRiverEast, x: 1030, y: 1680, frameWidth: 570, frameHeight: 336, frames: 8, fps: 6 },
    { name: 'water-river-west', texture: TextureKey.TownWaterRiverWest, x: 0, y: 1844, frameWidth: 866, frameHeight: 204, frames: 8, fps: 6 },
    { name: 'water-fall-west', texture: TextureKey.TownWaterFallWest, x: 104, y: 336, frameWidth: 72, frameHeight: 184, frames: 8, fps: 10 },
    { name: 'water-pool-west', texture: TextureKey.TownWaterPoolWest, x: 86, y: 500, frameWidth: 156, frameHeight: 116, frames: 8, fps: 6 },
    { name: 'water-fountain-spray', texture: TextureKey.TownWaterFountainSpray, x: 904, y: 1006, frameWidth: 106, frameHeight: 82, frames: 8, fps: 10 },
    { name: 'water-fountain-basin', texture: TextureKey.TownWaterFountainBasin, x: 882, y: 1056, frameWidth: 140, frameHeight: 102, frames: 8, fps: 6 },
  ],
  // Place sounds (x, y in texels at the animated water; radius in world px). The river's own soft loop is
  // the map-wide water sound (SoundPlans: 'river'), so these only add the falls and the fountain on top.
  // All three kinds are silent for now (AmbientSound SILENT_KINDS); the places wait for real recordings.
  sounds: [
    // The plaza fountain: a light trickle heard across the fountain square, gone by the shops around it.
    { kind: 'fountain', x: 955, y: 1080, radius: 80 },
    // The north waterfall at the top edge: heard on the north-east road and bridge.
    { kind: 'waterfall', x: 1936, y: 36, radius: 120 },
    // The west waterfall and its pool: heard along the west bank and the dock.
    { kind: 'waterfall', x: 140, y: 450, radius: 110 },
  ],
};

/** The Town as painted; the lamps burn warm and the forge fire a deeper orange. */
export const TOWN_STYLE: PaintedRoomStyle = { tint: 0xffffff, glow: { torch: 0xffb060, brazier: 0xff9a3c } };
