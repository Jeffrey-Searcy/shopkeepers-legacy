/**
 * Player foundation regression tests.
 *
 * These checks keep navigation art, feet geometry, movement response, pixel scaling, and the
 * visible interaction marker under one contract. They use real keyboard input for movement and
 * tool use because the reported defects appear during ordinary play, not state injection.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { test, expect, type Page } from '@playwright/test';
import type Phaser from 'phaser';
import { advanceFrames, bootGame, getState, nodes, teleport } from './helpers/gameHarness';

const SCREENSHOT_DIR = '.frontend-loop/player-foundation-pass/screenshots';
const NAV_TEXTURE = 'player-navigation';
const ACTION_TEXTURES = ['player-chop', 'player-dig', 'player-mine', 'player-sweep', 'player-broom', 'player-water', 'player-sword'] as const;
const TILE = 16;

interface SpriteState {
  texture: string;
  animation: string | null;
  flipX: boolean;
  velocityX: number;
  velocityY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bodyWidth: number;
  bodyHeight: number;
  bodyOffsetX: number;
  bodyOffsetY: number;
  scaleX: number;
  displayHeight: number;
}

/** Read the active player sprite and physics values from the documented raw-game test seam. */
async function playerSprite(page: Page): Promise<SpriteState> {
  return page.evaluate(() => {
    const game = window.__GAME__;
    if (!game) throw new Error('player-foundation: window.__GAME__ is unavailable');
    const world = game.scene.getScenes(true).find((scene) => scene.scene.key !== 'UIScene');
    if (!world) throw new Error('player-foundation: no active world scene');
    const sprite = world.children.list.find((child) => {
      const candidate = child as Phaser.Physics.Arcade.Sprite;
      return candidate.texture?.key.startsWith('player') && candidate.body !== null;
    }) as Phaser.Physics.Arcade.Sprite | undefined;
    if (!sprite) throw new Error('player-foundation: player sprite not found');
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    return {
      texture: sprite.texture.key,
      animation: sprite.anims.currentAnim?.key ?? null,
      flipX: sprite.flipX,
      velocityX: body.velocity.x,
      velocityY: body.velocity.y,
      x: sprite.x,
      y: sprite.y,
      width: sprite.width,
      height: sprite.height,
      bodyWidth: body.width,
      bodyHeight: body.height,
      bodyOffsetX: body.offset.x,
      bodyOffsetY: body.offset.y,
      scaleX: sprite.scaleX,
      displayHeight: sprite.displayHeight,
    };
  });
}

/** Return the opaque bounds of one frame in a uniform spritesheet. */
function opaqueBounds(
  png: PNG,
  frameWidth: number,
  frameHeight: number,
  column: number,
  row: number
): { minX: number; minY: number; maxX: number; maxY: number; height: number } {
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const sourceX = column * frameWidth + x;
      const sourceY = row * frameHeight + y;
      const alpha = png.data[(sourceY * png.width + sourceX) * 4 + 3];
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0 || maxY < 0) throw new Error(`player-foundation: empty frame ${column},${row}`);
  return { minX, minY, maxX, maxY, height: maxY - minY + 1 };
}

/** Count RGBA byte differences between two same-sized frame cells. */
function frameByteDifference(
  png: PNG,
  frameWidth: number,
  frameHeight: number,
  first: { column: number; row: number },
  second: { column: number; row: number }
): number {
  let changed = 0;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const a = ((first.row * frameHeight + y) * png.width + first.column * frameWidth + x) * 4;
      const b = ((second.row * frameHeight + y) * png.width + second.column * frameWidth + x) * 4;
      if (
        png.data[a] !== png.data[b] ||
        png.data[a + 1] !== png.data[b + 1] ||
        png.data[a + 2] !== png.data[b + 2] ||
        png.data[a + 3] !== png.data[b + 3]
      ) {
        changed += 1;
      }
    }
  }
  return changed;
}

/** Find a clear Farm tile and the clear tile directly below it for a deterministic hoe action. */
async function clearDownPlot(page: Page): Promise<{ px: number; py: number; tx: number; ty: number }> {
  const occupied = new Set((await nodes(page)).map((node) => `${node.tx},${node.ty}`));
  for (let py = 40; py < 80; py += 1) {
    for (let px = 10; px < 90; px += 1) {
      const tx = px;
      const ty = py + 1;
      if (!occupied.has(`${px},${py}`) && !occupied.has(`${tx},${ty}`)) return { px, py, tx, ty };
    }
  }
  throw new Error('player-foundation: no clear down-facing plot exists');
}

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('art: navigation frames have a full body, stable feet, and distinct down/right pixels', async () => {
  const manifest = JSON.parse(
    readFileSync(resolve('public/assets/manifest.json'), 'utf8')
  ) as { textures: Record<string, { file?: string; frameWidth?: number; frameHeight?: number }> };
  const entry = manifest.textures[NAV_TEXTURE];
  expect(entry, `${NAV_TEXTURE} manifest entry`).toBeTruthy();
  expect(entry.frameWidth).toBe(96);
  expect(entry.frameHeight).toBe(64);
  if (!entry.file || !entry.frameWidth || !entry.frameHeight) {
    throw new Error('player-foundation: navigation manifest entry is incomplete');
  }
  const png = PNG.sync.read(readFileSync(resolve('public/assets', entry.file)));
  expect(png.width).toBe(entry.frameWidth * 4);
  expect(png.height).toBe(entry.frameHeight * 4);

  const bounds = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => opaqueBounds(png, entry.frameWidth!, entry.frameHeight!, column, row))
  ).flat();
  expect(Math.min(...bounds.map((box) => box.height))).toBeGreaterThanOrEqual(24);
  expect(Math.max(...bounds.map((box) => box.maxY)) - Math.min(...bounds.map((box) => box.maxY))).toBeLessThanOrEqual(1);
  expect(frameByteDifference(png, entry.frameWidth, entry.frameHeight, { column: 0, row: 0 }, { column: 0, row: 3 })).toBeGreaterThan(20);
});

test('art: every visible action uses the matching four-direction sheet contract', async () => {
  const manifest = JSON.parse(
    readFileSync(resolve('public/assets/manifest.json'), 'utf8')
  ) as { textures: Record<string, { file?: string; frameWidth?: number; frameHeight?: number }> };

  for (const textureKey of ACTION_TEXTURES) {
    const entry = manifest.textures[textureKey];
    expect(entry, `${textureKey} manifest entry`).toBeTruthy();
    expect(entry.frameWidth, `${textureKey} frame width`).toBe(96);
    expect(entry.frameHeight, `${textureKey} frame height`).toBe(64);
    if (!entry.file || !entry.frameWidth || !entry.frameHeight) {
      throw new Error(`player-foundation: ${textureKey} manifest entry is incomplete`);
    }
    const png = PNG.sync.read(readFileSync(resolve('public/assets', entry.file)));
    expect(png.width, `${textureKey} sheet width`).toBe(entry.frameWidth * 4);
    expect(png.height, `${textureKey} sheet height`).toBe(entry.frameHeight * 4);
  }
});

test('direction: real keys select four distinct navigation animations', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await bootGame(page);
  await advanceFrames(page, 80);
  expect(await playerSprite(page)).toMatchObject({ texture: NAV_TEXTURE, animation: 'player-idle-down', flipX: false });

  for (const direction of ['down', 'up', 'left', 'right'] as const) {
    await page.keyboard.down(`Arrow${direction[0].toUpperCase()}${direction.slice(1)}`);
    await advanceFrames(page, 180);
    const moving = await playerSprite(page);
    expect(moving).toMatchObject({ texture: NAV_TEXTURE, animation: `player-walk-${direction}`, flipX: false });
    await page.keyboard.up(`Arrow${direction[0].toUpperCase()}${direction.slice(1)}`);
    await advanceFrames(page, 180);
    expect(await playerSprite(page)).toMatchObject({ texture: NAV_TEXTURE, animation: `player-idle-${direction}`, flipX: false });
  }
});

test('direction: every action registers a dedicated animation for all four facings', async ({ page }) => {
  await bootGame(page);
  const registrations = await page.evaluate((textureKeys) => {
    const game = window.__GAME__;
    if (!game) throw new Error('player-foundation: window.__GAME__ is unavailable');
    const facings = ['down', 'up', 'left', 'right'];
    return textureKeys.flatMap((textureKey) =>
      facings.map((facing) => {
        const key = `${textureKey}-${facing}`;
        const animation = game.anims.get(key);
        return { key, exists: game.anims.exists(key), frames: animation?.frames.length ?? 0, rate: animation?.frameRate ?? 0 };
      })
    );
  }, ACTION_TEXTURES);
  expect(registrations).toHaveLength(ACTION_TEXTURES.length * 4);
  for (const registration of registrations) {
    expect(registration, registration.key).toMatchObject({ exists: true, frames: 4, rate: 10 });
  }
});

test('movement: acceleration, braking, and diagonal speed stay within the feel contract', async ({ page }) => {
  await bootGame(page);
  const response = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { approachVelocity } = await import('/src/entities/Player.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules in browser tests.
    const { PLAYER_ACCELERATION, PLAYER_BRAKING, PLAYER_SPEED } = await import('/src/config/GameConfig.ts');
    const ramp = approachVelocity(0, 0, PLAYER_SPEED, 0, PLAYER_ACCELERATION * 0.032);
    const full = approachVelocity(ramp.x, ramp.y, PLAYER_SPEED, 0, PLAYER_ACCELERATION * 0.118);
    const stopped = approachVelocity(full.x, full.y, 0, 0, PLAYER_BRAKING * 0.15);
    return {
      ramp: Math.hypot(ramp.x, ramp.y),
      full: Math.hypot(full.x, full.y),
      stopped: Math.hypot(stopped.x, stopped.y),
      top: PLAYER_SPEED,
    };
  });
  expect(response.ramp).toBeGreaterThan(0);
  expect(response.ramp).toBeLessThan(response.top);
  expect(response.full).toBe(response.top);
  expect(response.stopped).toBe(0);

  await page.keyboard.down('ArrowRight');
  await expect
    .poll(async () => {
      const sprite = await playerSprite(page);
      return Math.hypot(sprite.velocityX, sprite.velocityY);
    }, { timeout: 1_000, intervals: [16, 32, 64] })
    .toBeGreaterThanOrEqual(response.top - 1);
  const cardinal = await playerSprite(page);
  const cardinalSpeed = Math.hypot(cardinal.velocityX, cardinal.velocityY);

  await page.keyboard.up('ArrowRight');
  const brakingFrame = await page.evaluate(() => {
    const game = window.__GAME__!;
    const world = game.scene.getScenes(true).find((scene) => scene.scene.key !== 'UIScene');
    if (!world) throw new Error('player-foundation: active world is missing during braking check');
    const sprite = world.children.list.find((child) => {
      const candidate = child as Phaser.Physics.Arcade.Sprite;
      return candidate.texture?.key === 'player-navigation' && candidate.body !== null;
    }) as (Phaser.Physics.Arcade.Sprite & { update(deltaMs: number): void }) | undefined;
    if (!sprite) throw new Error('player-foundation: player is missing during braking check');
    (sprite.body as Phaser.Physics.Arcade.Body).setVelocity(96, 0);
    window.__TEST__!.stopMove();
    sprite.update(16);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    return { speed: Math.hypot(body.velocity.x, body.velocity.y), animation: sprite.anims.currentAnim?.key ?? null };
  });
  expect(brakingFrame.speed).toBeGreaterThan(0);
  expect(brakingFrame.animation).toBe('player-walk-right');
  await expect
    .poll(async () => {
      const sprite = await playerSprite(page);
      return Math.hypot(sprite.velocityX, sprite.velocityY);
    }, { timeout: 1_000, intervals: [16, 32, 64] })
    .toBeLessThanOrEqual(1);

  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowDown');
  await expect
    .poll(async () => {
      const sprite = await playerSprite(page);
      return Math.abs(Math.hypot(sprite.velocityX, sprite.velocityY) - cardinalSpeed);
    }, { timeout: 1_000, intervals: [16, 32, 64] })
    .toBeLessThanOrEqual(1);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
});

test('target: marker is one facing tile from saved feet and the hoe affects that tile', async ({ page }) => {
  await bootGame(page);
  const plot = await clearDownPlot(page);
  const deltas = {
    down: { x: 0, y: 1 },
    up: { x: 0, y: -1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  } as const;

  for (const facing of Object.keys(deltas) as Array<keyof typeof deltas>) {
    await teleport(page, plot.px, plot.py, facing);
    await advanceFrames(page, 60);
    const geometry = await page.evaluate(() => {
      const game = window.__GAME__!;
      const world = game.scene.getScenes(true).find((scene) => scene.scene.key !== 'UIScene');
      if (!world) throw new Error('player-foundation: active world is missing');
      const marker = world.children.getByName('target-tile-highlight') as Phaser.GameObjects.Rectangle | null;
      if (!marker) throw new Error('player-foundation: named target marker is missing');
      return { x: marker.x, y: marker.y, width: marker.width, height: marker.height };
    });
    const saved = (await getState(page)).player;
    const feetTile = { x: Math.floor(saved.x / TILE), y: Math.floor(saved.y / TILE) };
    expect(geometry).toEqual({
      x: (feetTile.x + deltas[facing].x) * TILE + 1,
      y: (feetTile.y + deltas[facing].y) * TILE + 1,
      width: TILE - 2,
      height: TILE - 2,
    });
  }

  await teleport(page, plot.px, plot.py, 'down');
  await advanceFrames(page, 80);
  await page.keyboard.down('Space');
  await advanceFrames(page, 120);
  await page.keyboard.up('Space');
  await advanceFrames(page, 450);
  expect((await getState(page)).tiles[`${plot.tx},${plot.ty}`]).toBe('tilled');
});

test('action: a tool sheet returns to the same navigation feet anchor', async ({ page }) => {
  await bootGame(page);
  await teleport(page, 50, 50, 'down');
  await advanceFrames(page, 100);
  const before = await playerSprite(page);

  await page.keyboard.press('4');
  await page.keyboard.down('Space');
  await advanceFrames(page, 100);
  const action = await playerSprite(page);
  expect(action).toMatchObject({ texture: 'player-sweep', animation: 'player-sweep-down', scaleX: 1 });
  expect(action.displayHeight).toBe(64);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/round-04-action-scythe-down-webgl.png` });
  await page.keyboard.up('Space');
  await advanceFrames(page, 500);

  const after = await playerSprite(page);
  expect(after).toMatchObject({
    texture: NAV_TEXTURE,
    animation: 'player-idle-down',
    x: before.x,
    y: before.y,
    bodyWidth: 8,
    bodyHeight: 6,
    bodyOffsetX: 44,
    bodyOffsetY: 33,
    scaleX: 1,
    displayHeight: 64,
  });
});

test('scale: browser is filled with native canvas pixels and integer world zoom', async ({ page }) => {
  for (const viewport of [
    { width: 800, height: 500 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await bootGame(page);
    const canvas = await page.locator('canvas').evaluate((element: HTMLCanvasElement) => {
      const box = element.getBoundingClientRect();
      return { width: element.width, height: element.height, cssWidth: box.width, cssHeight: box.height };
    });
    expect(canvas.width).toBe(viewport.width);
    expect(canvas.height).toBe(viewport.height);
    expect(canvas.cssWidth / canvas.width).toBe(1);
    expect(canvas.cssHeight / canvas.height).toBe(1);
    const zoom = await page.evaluate(() => window.__GAME__!.scene.getScene('FarmScene').cameras.main.zoom);
    expect(Number.isInteger(zoom)).toBe(true);
  }
});

test('visual: WebGL player stays readable during real movement and after returning to idle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__GAME__!.renderer.type)).toBe(2);

  await teleport(page, 50, 50, 'right');
  await page.keyboard.down('ArrowRight');
  await advanceFrames(page, 220);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/round-01-moving-right-webgl.png` });
  await page.keyboard.up('ArrowRight');
  // GPU screenshot readback can delay the next frame under parallel workers. Capture the actual
  // settled pose; the separate movement test still verifies the precise 150ms braking model.
  await expect.poll(() => playerSprite(page), { timeout: 1_000, intervals: [16, 32, 64] })
    .toMatchObject({ texture: NAV_TEXTURE, animation: 'player-idle-right' });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/round-01-idle-right-webgl.png` });

  for (const facing of ['down', 'up', 'left', 'right'] as const) {
    await teleport(page, 50, 50, facing);
    await advanceFrames(page, 100);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/round-02-facing-${facing}-webgl.png` });
  }

  await page.setViewportSize({ width: 720, height: 405 });
  await advanceFrames(page, 100);
  await teleport(page, 50, 50, 'down');
  await advanceFrames(page, 100);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/round-02-compact-down-webgl.png` });

  await page.setViewportSize({ width: 1280, height: 720 });
  for (const direction of ['down', 'up', 'left', 'right'] as const) {
    await teleport(page, 50, 50, direction);
    const key = `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`;
    await page.keyboard.down(key);
    await advanceFrames(page, 180);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/round-03-moving-${direction}-webgl.png` });
    await page.keyboard.up(key);
    await advanceFrames(page, 120);
  }
});
