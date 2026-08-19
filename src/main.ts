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
import { HomeInteriorScene } from './scenes/HomeInteriorScene';
import { ForestScene } from './scenes/ForestScene';
import { BeachScene } from './scenes/BeachScene';
import { MountainScene } from './scenes/MountainScene';
import { MinesScene } from './scenes/MinesScene';
import { UIScene } from './scenes/UIScene';

// Deterministic RNG: seed from ?seed=NN (defaults to 42). Gameplay code must use Rng, not Math.random.
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') ?? '42') || 42;
Rng.seed(seed);
GameState.reset();

// Renderer choice: WebGL's generateTexture()/readback path stalls badly in headless Chromium
// (the "GPU stall due to ReadPixels" warnings), which made the test seam never go ready. In test
// mode we use the CANVAS renderer, which has no GPU readback and is plenty fast for a 2D tile game;
// normal play still uses AUTO (WebGL when available).
const isTest = new URLSearchParams(window.location.search).get('test') === '1';

const game = new Phaser.Game({
  type: isTest ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 540,
  // Fill the window (keeping aspect + crisp pixels) instead of a fixed small box — a big part of
  // the game previously feeling cramped/unpolished.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  backgroundColor: '#1a1420',
  pixelArt: true,
  roundPixels: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [
    BootScene,
    PreloadScene,
    MainMenuScene,
    FarmScene,
    TownScene,
    HomeInteriorScene,
    ForestScene,
    BeachScene,
    MountainScene,
    MinesScene,
    UIScene,
  ],
});

// Map the test seam's stepTime() to the clock, and expose the game + seam.
TimeSystem.install();
installDebugHooks(game);
