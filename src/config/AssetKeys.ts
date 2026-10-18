/**
 * AssetKeys — the single string-const registry of every scene key, texture key, and animation key.
 *
 * Game code references these constants, NEVER raw filenames or literal strings (CLAUDE.md Hard
 * Rule 4). `manifest.json` maps texture keys to placeholder-or-PNG sources; the SceneKey enum lets
 * SceneTransitionSystem validate a warp target at compile time (a warp to a non-existent scene
 * won't type-check) — the structural guard against the "player vanished on a bad transition" bug.
 */

/** All scenes. Extend this as scenes are added; transitions validate against it. */
export enum SceneKey {
  Boot = 'BootScene',
  Preload = 'PreloadScene',
  MainMenu = 'MainMenuScene',
  MapEditor = 'MapEditorScene',
  RouteEditor = 'RouteEditorScene',
  Farm = 'FarmScene',
  Town = 'TownScene',
  Market = 'TownMarketScene',
  Forge = 'TownForgeScene',
  Museum = 'TownMuseumScene',
  Magic = 'TownMagicScene',
  Clinic = 'TownClinicScene',
  Guild = 'TownGuildScene',
  Ranch = 'TownRanchScene',
  TownBar = 'TownBarScene',
  Carpenter = 'TownCarpenterScene',
  FishingShop = 'TownFishingShopScene',
  Alchemy = 'TownAlchemyScene',
  Tailor = 'TownTailorScene',
  Jail = 'TownJailScene',
  Home = 'HomeInteriorScene',
  Tavern = 'TavernScene',
  Bedroom = 'BedroomScene',
  Forest = 'ForestScene',
  Beach = 'BeachScene',
  Mountain = 'MountainScene',
  Mines = 'MinesScene',
  /** Stone plaza beyond the farm's north trail; holds the first portal gate. */
  GatePlaza = 'GatePlazaScene',
  /** The first portal dungeon: three room floors and a boss room. Runs are never saved mid-dungeon. */
  Dungeon = 'DungeonScene',
  UI = 'UIScene',
}

/** The set of world (walkable, player-bearing) scenes. Used to guard transition targets. */
export const WORLD_SCENE_KEYS: ReadonlySet<SceneKey> = new Set([
  SceneKey.Farm,
  SceneKey.Town,
  SceneKey.Market, SceneKey.Forge, SceneKey.Museum, SceneKey.Magic,
  SceneKey.Clinic, SceneKey.Guild, SceneKey.Ranch, SceneKey.TownBar,
  SceneKey.Carpenter, SceneKey.FishingShop, SceneKey.Alchemy, SceneKey.Tailor,
  SceneKey.Jail,
  SceneKey.Home,
  SceneKey.Tavern,
  SceneKey.Bedroom,
  SceneKey.Forest,
  SceneKey.Beach,
  SceneKey.Mountain,
  SceneKey.Mines,
  SceneKey.GatePlaza,
  SceneKey.Dungeon,
]);

/** Texture/sprite keys. Each maps to an entry in public/assets/manifest.json. */
export enum TextureKey {
  // Distinct town architecture; source crops are registered separately from collision geometry.
  TownMarket = 'town-market',
  TownForge = 'town-forge',
  TownMuseum = 'town-museum',
  TownMagic = 'town-magic',
  TownClinic = 'town-clinic',
  TownGuild = 'town-guild',
  TownRanch = 'town-ranch',
  TownBar = 'town-bar',
  TownCarpenter = 'town-carpenter',
  TownFishing = 'town-fishing',
  TownAlchemy = 'town-alchemy',
  TownTailor = 'town-tailor',
  TownInteriorProps = 'town-interior-props',
  MarketCounter = 'market-counter',
  MarketProduce = 'market-produce',
  MarketCabinet = 'market-cabinet',
  MarketStove = 'market-stove',
  MarketTable = 'market-table',
  MarketBed = 'market-bed',
  MarketDresser = 'market-dresser',
  MarketDoorway = 'market-doorway',
  PlayerNavigation = 'player-navigation',
  Player = 'player',
  PlayerCardinal = 'player-cardinal',
  Tree = 'tree',
  Rock = 'rock',
  Weed = 'weed',
  Chest = 'chest',
  Workbench = 'workbench',
  WorkbenchVertical = 'workbench-vertical',
  FurnitureTableHorizontal = 'furniture-table-horizontal',
  FurnitureTableVertical = 'furniture-table-vertical',
  FurnitureChairSouth = 'furniture-chair-south',
  FurnitureChairWest = 'furniture-chair-west',
  FurnitureChairNorth = 'furniture-chair-north',
  FurnitureChairEast = 'furniture-chair-east',
  FurnitureBarHorizontal = 'furniture-bar-horizontal',
  FurnitureBarVertical = 'furniture-bar-vertical',
  FurnitureRegister = 'furniture-register',
  FurnitureRug = 'furniture-rug',
  FurnitureStove = 'furniture-stove',
  InteriorStairs = 'interior-stairs',
  InteriorDoorway = 'interior-doorway',
  Bed = 'bed',
  StoreShelf = 'store-shelf',
  House = 'house',
  TavernExterior = 'tavern-exterior',
  ShopFacade = 'shop-facade',
  ShopFacadeInn = 'shop-facade-inn',
  ShopFacadeBlacksmith = 'shop-facade-blacksmith',
  ShopFacadeMagic = 'shop-facade-magic',
  ShopFacadeFarm = 'shop-facade-farm',
  ShopFacadeChurch = 'shop-facade-church',
  ShopFacadeLibrary = 'shop-facade-library',
  ShopFacadeTailor = 'shop-facade-tailor',
  ShopFacadeAlchemist = 'shop-facade-alchemist',
  InteriorFloor = 'interior-floor',
  InteriorWall = 'interior-wall',
  TavernRosa = 'tavern-rosa',
  TavernFinn = 'tavern-finn',
  TavernMara = 'tavern-mara',
  Crop = 'crop',
  // Per-growth-stage crop sprites (stage 0..3 -> crop-1..crop-4).
  Crop1 = 'crop-1',
  Crop2 = 'crop-2',
  Crop3 = 'crop-3',
  Crop4 = 'crop-4',
  // Terrain tile textures (placeholder solid colors until the PixelLab tileset lands).
  TileGrass = 'tile-grass',
  TileDirt = 'tile-dirt',
  TileWater = 'tile-water',
  TileFloor = 'tile-floor',
  // Painted title screen, its two menu-button skins, and the three Willowbrook Papers intro pages.
  // scripts/pack-title-art.py builds them from docs/art-source/title/ (live text replaces the removed words).
  TitleScreen = 'title-screen',
  TitleButton = 'title-button',
  TitleButtonSelected = 'title-button-selected',
  PapersLetter = 'papers-letter',
  PapersDeparture = 'papers-departure',
  PapersChoice = 'papers-choice',
  // Painted portal-dungeon rooms (src/world/DungeonRooms.ts): the fountain hub (1536x1024 texels = 48x32 tiles,
  // with a pillars front layer), the crystal cave, moon library, old sewer and the Warden's lava pit (1152x832 =
  // 36x26 tiles each). Spritesheets animate their water, sludge and lava; seals wall up unused far doors; the
  // boss exit is the swirl that opens when the Warden falls. scripts/pack-dungeon-rooms-art.py builds them all
  // from docs/art-source/dungeon-rooms/.
  DungeonHub = 'dungeon-rooms-hub',
  DungeonHubFront = 'dungeon-rooms-hub-front',
  DungeonHubFall = 'dungeon-rooms-hub-fall',
  DungeonHubPool = 'dungeon-rooms-hub-pool',
  DungeonCave = 'dungeon-rooms-cave',
  DungeonCaveFallRight = 'dungeon-rooms-cave-fall-right',
  DungeonCavePoolRight = 'dungeon-rooms-cave-pool-right',
  DungeonCaveFallMid = 'dungeon-rooms-cave-fall-mid',
  DungeonCaveFallLeft = 'dungeon-rooms-cave-fall-left',
  DungeonCaveSeal = 'dungeon-rooms-cave-seal',
  DungeonLibrary = 'dungeon-rooms-library',
  DungeonLibrarySeal = 'dungeon-rooms-library-seal',
  DungeonSewer = 'dungeon-rooms-sewer',
  DungeonSewerFallLeft = 'dungeon-rooms-sewer-fall-left',
  DungeonSewerFallRight = 'dungeon-rooms-sewer-fall-right',
  DungeonSewerPoolTop = 'dungeon-rooms-sewer-pool-top',
  DungeonSewerPoolLow = 'dungeon-rooms-sewer-pool-low',
  DungeonSewerSeal = 'dungeon-rooms-sewer-seal',
  DungeonBoss = 'dungeon-rooms-boss',
  DungeonBossLavaLeft = 'dungeon-rooms-boss-lava-left',
  DungeonBossLavaRight = 'dungeon-rooms-boss-lava-right',
  DungeonBossFallBl = 'dungeon-rooms-boss-fall-bl',
  DungeonBossFallBr = 'dungeon-rooms-boss-fall-br',
  DungeonBossFallBack = 'dungeon-rooms-boss-fall-back',
  DungeonBossExit = 'dungeon-rooms-boss-exit',
  // Painted Gate Plaza (1088x544 texels = 34x17 tiles, the whole map), its pillars-braziers-signpost front layer,
  // and the portal panel's swirl (a 24-frame spritesheet). scripts/pack-gate-plaza-art.py builds all three
  // from docs/art-source/gate-plaza/plaza.webp.
  GatePlaza = 'gate-plaza',
  GatePlazaFront = 'gate-plaza-front',
  GatePlazaPortal = 'gate-plaza-portal',
  // Painted Beach (2560x1600 texels = 80x50 tiles, the whole map), its palms-and-lamp front layer, and the
  // atlas of painted trees and rocks that stand as real resource nodes (src/world/BeachArt.ts BEACH_NODES).
  // scripts/pack-beach-art.py builds all three from docs/art-source/beach/.
  Beach = 'beach',
  BeachFront = 'beach-front',
  BeachNodes = 'beach-nodes',
  // Painted Forest (2560x2240 texels = 80x70 tiles, the whole map), its lamp-post front layer, and the atlas
  // of painted trees and rocks that stand as real resource nodes (src/world/ForestArt.ts FOREST_NODES).
  Forest = 'forest',
  ForestFront = 'forest-front',
  ForestNodes = 'forest-nodes',
  // Painted Town (2624x2400 texels = 82x75 tiles, the whole map), its front layer of trees, lamp posts and plaza
  // banners, and the atlas of the meadow stones (src/world/TownArt.ts TOWN_NODES).
  // scripts/pack-town-art.py builds all three from docs/art-source/town/.
  Town = 'town',
  TownFront = 'town-front',
  TownNodes = 'town-nodes',
  // The Town's moving water (TOWN_ART.animations): river parts, two waterfalls and the plaza fountain, each an
  // 8-frame spritesheet cut from town.png by scripts/pack-town-art.py.
  TownWaterFallNorth = 'town-water-fall-north',
  TownWaterRiverNorth = 'town-water-river-north',
  TownWaterRiverMiddle = 'town-water-river-middle',
  TownWaterRiverBendNorth = 'town-water-river-bend-north',
  TownWaterRiverBendSouth = 'town-water-river-bend-south',
  TownWaterRiverEast = 'town-water-river-east',
  TownWaterRiverWest = 'town-water-river-west',
  TownWaterFallWest = 'town-water-fall-west',
  TownWaterPoolWest = 'town-water-pool-west',
  TownWaterFountainSpray = 'town-water-fountain-spray',
  TownWaterFountainBasin = 'town-water-fountain-basin',
  // Painted town interiors (src/world/CivicRoomArt.ts): eleven shop rooms and the town jail, each one painting at
  // 32 texels per tile (2 per world px), sized to its room. The jail adds a front layer of cell bars the keeper
  // stands behind. scripts/pack-civic-interiors-art.py builds them all from docs/art-source/civic-interiors/.
  CivicInteriorMagic = 'civic-interiors-magic',
  CivicInteriorForge = 'civic-interiors-forge',
  CivicInteriorMuseum = 'civic-interiors-museum',
  CivicInteriorGuild = 'civic-interiors-guild',
  CivicInteriorRanch = 'civic-interiors-ranch',
  CivicInteriorBar = 'civic-interiors-bar',
  CivicInteriorCarpenter = 'civic-interiors-carpenter',
  CivicInteriorFishing = 'civic-interiors-fishing',
  CivicInteriorAlchemy = 'civic-interiors-alchemy',
  CivicInteriorTailor = 'civic-interiors-tailor',
  CivicInteriorMarket = 'civic-interiors-market',
  CivicInteriorJail = 'civic-interiors-jail',
  CivicInteriorJailFront = 'civic-interiors-jail-front',
}

/** Four-direction navigation keys. Tool actions keep their existing `player-<action>` keys. */
export enum AnimKey {
  PlayerWalkDown = 'player-walk-down',
  PlayerIdleDown = 'player-idle-down',
  PlayerWalkUp = 'player-walk-up',
  PlayerIdleUp = 'player-idle-up',
  PlayerWalkLeft = 'player-walk-left',
  PlayerIdleLeft = 'player-idle-left',
  PlayerWalkRight = 'player-walk-right',
  PlayerIdleRight = 'player-idle-right',
}

/** Actor-local semantic action captured at swing start; visuals must not infer it from a changing hotbar. */
export const PLAYER_ACTION_DATA_KEY = 'player-action';
