/**
 * main.ts — entry point. Creates the Phaser.Game, registers all scenes, seeds deterministic RNG
 * from the `seed` URL param (for reproducible Playwright runs), and installs the window.__TEST__
 * debug seam. This is the only file that constructs the game.
 */
import Phaser from 'phaser';
import { GameState } from './state/GameState';
import { Rng } from './state/Rng';
import { installDebugHooks } from './debug/DebugHooks';
import { TimeSystem } from './systems/TimeSystem';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { FarmScene } from './scenes/FarmScene';
import { TownScene } from './scenes/TownScene';
import { CivicInteriorScene } from './scenes/CivicInteriorScene';
import { TOWN_BUILDINGS } from './config/TownBuildings';
import { TavernScene } from './scenes/TavernScene';
import { BedroomScene } from './scenes/BedroomScene';
import { HomeInteriorScene } from './scenes/HomeInteriorScene';
import { ForestScene } from './scenes/ForestScene';
import { BeachScene } from './scenes/BeachScene';
import { MountainScene } from './scenes/MountainScene';
import { MinesScene } from './scenes/MinesScene';
import { GatePlazaScene } from './scenes/GatePlazaScene';
import { DungeonScene } from './scenes/DungeonScene';
import { UIScene } from './scenes/UIScene';
import { displayPixelRatio, installHiDpiCanvas } from './ui/TextRendering';
import { MapEditorScene } from './scenes/MapEditorScene';
import { mapEditorMap, mapEditorMode, mapEditorUrl } from './debug/MapEditorMode';
import { readFarmLayoutPreviewSnapshot } from './debug/FarmLayoutStorage';
import { compileFarmLayoutDraft } from './debug/FarmLayoutDraft';
import { setFarmPreviewMap } from './world/MapDef';
import { JailScene } from './scenes/JailScene';
import { RouteEditorScene } from './scenes/RouteEditorScene';
import { installTouchDetection } from './input/TouchMode';

// Deterministic RNG: seed from ?seed=NN (defaults to 42). Gameplay code must use Rng, not Math.random.
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') ?? '42') || 42;
Rng.seed(seed);
GameState.reset();

// A preview installs one validated, frozen layout before any map consumer or world scene runs.
// Its separate page starts fresh; the original play session is never swapped or restored.
try {
  if (mapEditorMode() === 'preview') {
    // why: MapEditorMode refuses a Town preview (the Town is a painting), so every preview is the Farm's.
    if (mapEditorMap() !== 'farm') throw new Error(`No layout preview exists for the ${mapEditorMap()} map.`);
    setFarmPreviewMap(compileFarmLayoutDraft(readFarmLayoutPreviewSnapshot()));
    const banner = document.createElement('aside');
    banner.className = 'map-preview-banner';
    banner.textContent = 'Layout preview · No adventure saves';
    const back = document.createElement('a'); back.href = mapEditorUrl('edit'); back.textContent = 'Back to editor';
    banner.append(back); document.body.append(banner);
  }
} catch (error) {
  const notice = document.createElement('aside'); notice.className = 'map-preview-banner';
  notice.textContent = `Workshop could not start: ${error instanceof Error ? error.message : String(error)}. `;
  const back = document.createElement('a'); back.href = '/?mapEditor=1'; back.textContent = 'Open Farm editor';
  notice.append(back); document.body.append(notice);
  throw error; // Keep the failure visible; never silently boot the original map as a preview.
}

// Renderer choice: WebGL's generateTexture()/readback path stalls badly in headless Chromium
// (the "GPU stall due to ReadPixels" warnings), which made the test seam never go ready. In test
// mode we use the CANVAS renderer, which has no GPU readback and is plenty fast for a 2D tile game;
// normal play still uses AUTO (WebGL when available).
const isTest = new URLSearchParams(window.location.search).get('test') === '1';
const forceWebGL = params.get('renderer') === 'webgl';

// iPad play: the first real touch anywhere turns on the on-screen controls (desktop never sees them).
installTouchDetection();

const GAME_WIDTH = Math.round(window.innerWidth * displayPixelRatio());
const GAME_HEIGHT = Math.round(window.innerHeight * displayPixelRatio());

const game = new Phaser.Game({
  type: forceWebGL ? Phaser.WEBGL : isTest ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  // Use actual display pixels, including Retina/DPR2. Phaser maps the smaller CSS presentation
  // back to this native buffer; per-scene cameras preserve world and UI proportions.
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / displayPixelRatio(),
    // The parent flexbox owns centering. A second Phaser centering offset makes margins uneven.
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  backgroundColor: '#1a1420',
  pixelArt: true,
  roundPixels: true,
  callbacks: { postBoot: installHiDpiCanvas },
  // Phaser tracks one touch by default. Touch play needs the joystick thumb, the Use/Action thumb,
  // and a spare finger at the same time; 4 extra pointers cover that with room to spare.
  input: { activePointers: 4 },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [
    BootScene,
    PreloadScene,
    MainMenuScene,
    MapEditorScene,
    RouteEditorScene,
    FarmScene,
    TownScene,
    ...TOWN_BUILDINGS.map(building => new CivicInteriorScene(building)),
    JailScene,
    TavernScene,
    BedroomScene,
    HomeInteriorScene,
    ForestScene,
    BeachScene,
    MountainScene,
    MinesScene,
    GatePlazaScene,
    DungeonScene,
    UIScene,
  ],
});

// Map the test seam's stepTime() to the clock, and expose the game + seam.
TimeSystem.install();
installDebugHooks(game);
