/**
 * Wardrobe pixel, validation, bounded-cache, and animation contracts over the keeper sheets (tools/keeper-art).
 * Covers both bodies (original and feminine), the garment diffs, hairstyles, facial hair and hats. Node tests
 * render straight from the PNG files; the browser tests check the live texture banks against the same renderer.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { test, expect } from '@playwright/test';
import { APPEARANCE_OPTIONS, assertAppearance, originalAppearance, type Appearance } from '../src/config/Appearance';
import { APPEARANCE_SHEETS, appearanceGarmentTexture, appearanceSourceSheet, renderAppearancePixels } from '../src/systems/AppearanceTextureSystem';
import {
  KEEPER_BASE_SHEETS, KEEPER_BODIES, KEEPER_BODY_ORIGIN, KEEPER_BODY_SHEETS, KEEPER_GARMENT_FILES, KEEPER_GARMENTS, KEEPER_HEAD_DY, KEEPER_MATERIALS,
  KEEPER_OVERLAYS, KEEPER_PALETTE, KEEPER_SHEET_FILES, type KeeperBaseSheet, type KeeperBody, type KeeperGarmentTexture, type KeeperSheet,
} from '../src/config/KeeperArt.generated';
import { bootGame } from './helpers/gameHarness';

/** Load approved source pixels, without rewriting art or relying on the Phaser renderer. */
function sheet(key: KeeperSheet): PNG {
  return PNG.sync.read(readFileSync(`public/assets/characters/${KEEPER_SHEET_FILES[key]}`));
}

/** Decoded garment diffs, keyed by texture; each is the eight base sheets stacked (384 x 2048). */
const garmentPngs = new Map<KeeperGarmentTexture, PNG>();

/**
 * One base sheet's 384x256 slice of the outfit's garment diff, or null when no garment is worn.
 * Mirrors AppearanceTextureSystem.garmentSlice, but reads the PNG file directly.
 */
function garmentSlice(appearance: Appearance, baseKey: KeeperBaseSheet): Uint8ClampedArray | null {
  const texture = appearanceGarmentTexture(appearance);
  if (texture === null) return null;
  let png = garmentPngs.get(texture);
  if (!png) {
    png = PNG.sync.read(readFileSync(`public/assets/characters/${KEEPER_GARMENT_FILES[texture]}`));
    if (png.width !== 384 || png.height !== 256 * KEEPER_BASE_SHEETS.length) throw new Error(`${texture} has the wrong size`);
    garmentPngs.set(texture, png);
  }
  const bytes = 384 * 256 * 4, index = KEEPER_BASE_SHEETS.indexOf(baseKey);
  return new Uint8ClampedArray(png.data.buffer, png.data.byteOffset + index * bytes, bytes);
}

/**
 * Render one base sheet for an outfit exactly as the game does: from the outfit's body sheet and garment slice.
 * @returns the body sheet pixels (source), the rendered pixels, and the garment slice used (or null).
 */
function renderOutfit(baseKey: KeeperBaseSheet, appearance: Appearance): { source: Uint8ClampedArray; rendered: Uint8ClampedArray; garment: Uint8ClampedArray | null } {
  const png = sheet(appearanceSourceSheet(baseKey, appearance));
  const source = new Uint8ClampedArray(png.data);
  const garment = garmentSlice(appearance, baseKey);
  return { source, rendered: renderAppearancePixels(baseKey, source, png.width, png.height, appearance, garment), garment };
}

/**
 * The frame-pixel box that hairstyles and hats may draw into: every overlay cell of every facing, shifted by
 * the full range of measured head offsets. Derived from the generated art data so a redrawn overlay cannot drift.
 */
function headMask(): { x0: number; x1: number; y0: number; y1: number } {
  const dys = Object.values(KEEPER_HEAD_DY).flat();
  // cells is body -> facing -> list, so flatten both levels
  const cells = Object.values(KEEPER_OVERLAYS).flatMap(overlay => Object.values(overlay.cells).flatMap(byFacing => Object.values(byFacing).flat()));
  const gx = cells.map(([x]) => x), gy = cells.map(([, y]) => y);
  return {
    x0: Math.min(...gx) + KEEPER_BODY_ORIGIN.x, x1: Math.max(...gx) + KEEPER_BODY_ORIGIN.x,
    y0: Math.min(...gy) + KEEPER_BODY_ORIGIN.y + Math.min(...dys), y1: Math.max(...gy) + KEEPER_BODY_ORIGIN.y + Math.max(...dys),
  };
}

/** A representative outfit changes every cosmetic category without altering body dimensions. */
function sampleOutfit(body: KeeperBody = 'original', garment: Appearance['garment'] = 'apron'): Appearance {
  return { body, hairStyle: 'bob', hat: 'straw', facialHair: 'beard', shirtStyle: 'striped', garment, pantsStyle: 'cuffed',
    eyeColor: 'green', skinTone: 'brown', hairColor: 'blonde', shirtColor: 'sage', pantsColor: 'earth' };
}

/** Count pixel differences in a single directional animation frame. */
function differencesInFrame(before: Uint8ClampedArray, after: Uint8ClampedArray, frame: number): number {
  let count = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    const i = (((Math.floor(frame / 4) * 64 + y) * 384) + (frame % 4) * 96 + x) * 4;
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2] || before[i + 3] !== after[i + 3]) count++;
  }
  return count;
}

test('appearance validates a finite complete record and original records are detached', () => {
  const original = originalAppearance();
  const detached = assertAppearance(original);
  detached.hat = 'knit';
  expect(original.hat).toBe('none');
  expect(originalAppearance()).toEqual(original);
  for (const bad of [null, [], {}, { ...original, hat: 'missing' }, { ...original, extra: true }, { ...original, eyeColor: 1 }]) {
    expect(() => assertAppearance(bad)).toThrow(/Appearance/);
  }
  const missing: Partial<Appearance> = { ...original };
  delete missing.skinTone;
  expect(() => assertAppearance(missing)).toThrow(/Appearance/);
});

test('all 128 original animation frames of each body remain byte-identical and source pixels never mutate', () => {
  for (const body of KEEPER_BODIES) for (const key of APPEARANCE_SHEETS) {
    const bare = { ...originalAppearance(), body };
    const png = sheet(KEEPER_BODY_SHEETS[body][key]);
    const pixels = new Uint8ClampedArray(png.data);
    const original = renderAppearancePixels(key, pixels, png.width, png.height, bare, null);
    expect(Buffer.from(original).equals(png.data), `${body} ${key}`).toBe(true);
    const dressed = sampleOutfit(body, 'robe');
    const garment = garmentSlice(dressed, key);
    const garmentBefore = Buffer.from(garment!);
    renderAppearancePixels(key, pixels, png.width, png.height, dressed, garment);
    expect(Buffer.from(pixels).equals(png.data), `${body} ${key} immutable`).toBe(true);
    expect(Buffer.from(garment!).equals(garmentBefore), `${body} ${key} garment immutable`).toBe(true);
    expect(() => renderAppearancePixels(key, pixels, 96, 64, bare, null)).toThrow(/384x256/);
    // The garment argument must match the outfit: no silent skipping of a worn garment, no stray pixels.
    expect(() => renderAppearancePixels(key, pixels, png.width, png.height, dressed, null)).toThrow(/garment/);
    expect(() => renderAppearancePixels(key, pixels, png.width, png.height, bare, garment)).toThrow(/garment/);
  }
});

test('the feminine body is its own drawing in every frame, with matching sheet format and garment art', () => {
  for (const key of APPEARANCE_SHEETS) {
    const original = sheet(KEEPER_BODY_SHEETS.original[key]), feminine = sheet(KEEPER_BODY_SHEETS.feminine[key]);
    expect([feminine.width, feminine.height]).toEqual([original.width, original.height]);
    const a = new Uint8ClampedArray(original.data), b = new Uint8ClampedArray(feminine.data);
    for (let frame = 0; frame < 16; frame++) expect(differencesInFrame(a, b, frame), `${key} frame ${frame}`).toBeGreaterThan(0);
    for (const garment of APPEARANCE_OPTIONS.garment) {
      if (garment.id === 'none') continue;
      // The garment shows in every frame of every sheet, on every body.
      for (const body of KEEPER_BODIES) {
        const slice = garmentSlice({ ...originalAppearance(), body, garment: garment.id }, key)!;
        for (let frame = 0; frame < 16; frame++) {
          expect(differencesInFrame(new Uint8ClampedArray(slice.length), slice, frame), `${garment.id} on ${body} ${key} frame ${frame}`).toBeGreaterThan(0);
        }
      }
    }
  }
  // why: the build shares one garment file between bodies when the fit is identical, so no two shipped garment
  // files may be byte copies, and every file must be worn by some garment and body
  const files = Object.keys(KEEPER_GARMENT_FILES) as KeeperGarmentTexture[];
  const used = new Set(Object.values(KEEPER_GARMENTS).flatMap(bodies => Object.values(bodies)));
  expect([...used].sort()).toEqual([...files].sort());
  const bytes = files.map(texture => readFileSync(`public/assets/characters/${KEEPER_GARMENT_FILES[texture]}`));
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    expect(bytes[i].equals(bytes[j]), `${files[i]} and ${files[j]} are copies`).toBe(false);
  }
});

test('every hairstyle, hat, facial hair, garment and clothing style changes all directions and remains inside its frame', () => {
  const mask = headMask();
  for (const body of KEEPER_BODIES) for (const key of APPEARANCE_SHEETS) {
    for (const field of ['hairStyle', 'hat', 'facialHair', 'shirtStyle', 'garment', 'pantsStyle'] as const) {
      for (const option of APPEARANCE_OPTIONS[field]) {
        if (option.id === 'original' || option.id === 'none') continue;
        const outfit = assertAppearance({ ...originalAppearance(), body, [field]: option.id });
        const { source: pixels, rendered, garment } = renderOutfit(key, outfit);
        for (let direction = 0; direction < 4; direction++) {
          const label = `${body} ${key} ${field}:${option.id} direction ${direction}`;
          // A hand or tool can hide a clothing detail in one action frame. Its direction's cycle
          // must still show the option; hairstyles and hats remain visible in every single pose.
          const differences = Array.from({ length: 4 }, (_, index) => differencesInFrame(pixels, rendered, direction * 4 + index));
          const total = differences.reduce((sum, count) => sum + count, 0);
          // why: row 1 is the north facing; facial hair is drawn on the face, so the back of the head shows none
          if (field === 'facialHair' && direction === 1) expect(total, label).toBe(0);
          else expect(total, label).toBeGreaterThan(0);
          if (field === 'hat' || field === 'hairStyle') expect(differences.every(count => count > 0), label).toBe(true);
        }
        for (let i = 0; i < pixels.length; i += 4) {
          // No wardrobe choice erases the existing silhouette. Garments add pixels only where their diff is
          // opaque; hairstyles, facial hair and hats add pixels only inside the head mask.
          if (pixels[i + 3]) {
            if (rendered[i + 3] !== pixels[i + 3]) throw new Error(`${body} ${key} erased body alpha at ${i}`);
          }
          else if (rendered[i + 3]) {
            const x = (i / 4) % 384 % 96;
            const y = Math.floor(i / 4 / 384) % 64;
            if (field === 'garment') {
              if (!garment || !garment[i + 3]) throw new Error(`${body} ${key} garment:${option.id} adds a pixel outside its diff at ${x},${y}`);
            } else if (!['hairStyle', 'hat', 'facialHair'].includes(field) || x < mask.x0 || x > mask.x1 || y < mask.y0 || y > mask.y1) {
              throw new Error(`${body} ${key} ${field}:${option.id} adds a pixel outside its head mask at ${x},${y}`);
            }
          }
        }
      }
    }
  }
});

test('custom palettes preserve tool materials and lower outlines across every action pose', () => {
  // Tools and effects (dust, water, sparks) are never part of the wardrobe; the palette names them exactly.
  const toolColors = new Set([...KEEPER_MATERIALS.tool, ...KEEPER_MATERIALS.fx].map(key => KEEPER_PALETTE[key]));
  const outline = KEEPER_PALETTE[KEEPER_MATERIALS.outline];
  const mask = headMask();
  let protectedCount = 0;
  const garments = APPEARANCE_OPTIONS.garment.map(option => option.id);
  for (const body of KEEPER_BODIES) for (const garmentId of garments) for (const key of APPEARANCE_SHEETS) {
    const { source: pixels, rendered, garment } = renderOutfit(key, sampleOutfit(body, garmentId));
    for (let i = 0; i < pixels.length; i += 4) {
      const color = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      const y = Math.floor(i / 4 / 384) % 64;
      // why: a garment hem may cover a leg outline with cloth, but tools and effects always stay in front of it
      const clothed = garment !== null && garment[i + 3] !== 0;
      if (pixels[i + 3] && (toolColors.has(color) || (color === outline && y > mask.y1 && !clothed))) {
        if (rendered[i] !== pixels[i] || rendered[i + 1] !== pixels[i + 1] || rendered[i + 2] !== pixels[i + 2] || rendered[i + 3] !== pixels[i + 3]) {
          throw new Error(`${body} ${garmentId} ${key} protected pixel ${i} changed`);
        }
        protectedCount++;
      }
    }
  }
  expect(protectedCount).toBeGreaterThan(5000 * KEEPER_BODIES.length * garments.length);
});

test('eye colors alter existing iris pixels without adding eyes to the back of the head', () => {
  for (const body of KEEPER_BODIES) {
    const { source: pixels, rendered } = renderOutfit('player-navigation', { ...originalAppearance(), body, eyeColor: 'green' });
    for (let frame = 0; frame < 4; frame++) expect(differencesInFrame(pixels, rendered, frame), `${body} frame ${frame}`).toBeGreaterThan(0);
    for (let frame = 4; frame < 8; frame++) expect(differencesInFrame(pixels, rendered, frame), `${body} frame ${frame}`).toBe(0);
    for (let i = 3; i < pixels.length; i += 4) if (rendered[i] !== pixels[i]) throw new Error(`${body} eye color changes alpha at ${i}`);
  }
});

test('the live texture bank draws a feminine garment outfit exactly like the file-based renderer', async ({ page }) => {
  await bootGame(page);
  const outfit = sampleOutfit('feminine', 'robe');
  const live = await page.evaluate(async value => {
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { AppearanceTextureSystem } = await import('/src/systems/AppearanceTextureSystem.ts');
    const game = window.__GAME__;
    if (!game) throw new Error('Missing game');
    const sheets: Record<string, string> = {};
    for (const key of ['player-navigation', 'player-sword']) {
      const textureKey = AppearanceTextureSystem.forGame(game).textureFor(key, value, 'preview');
      const canvas = game.textures.get(textureKey).getSourceImage() as HTMLCanvasElement;
      const data = canvas.getContext('2d')!.getImageData(0, 0, 384, 256).data;
      let binary = '';
      for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
      sheets[key] = btoa(binary);
    }
    return sheets;
  }, outfit);
  for (const key of ['player-navigation', 'player-sword'] as const) {
    const expected = Buffer.from(renderOutfit(key, outfit).rendered);
    expect(Buffer.from(live[key], 'base64').equals(expected), key).toBe(true);
  }
});

test('preview and active texture banks remain separate and bounded while animation identities stay original', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { AppearanceTextureSystem, APPEARANCE_SHEETS } = await import('/src/systems/AppearanceTextureSystem.ts');
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { originalAppearance } = await import('/src/config/Appearance.ts');
    const game = window.__GAME__;
    if (!game) throw new Error('Missing game');
    const system = AppearanceTextureSystem.forGame(game);
    const active = { ...originalAppearance(), hairColor: 'blonde', hat: 'knit' };
    const activeKey = system.textureFor('player-navigation', active);
    const activeCanvas = game.textures.get(activeKey).getSourceImage() as HTMLCanvasElement;
    const before = activeCanvas.toDataURL();
    for (let i = 0; i < 12; i++) {
      for (const sheet of APPEARANCE_SHEETS) {
        system.textureFor(sheet, active);
        system.textureFor(sheet, { ...active, hat: i % 2 ? 'straw' : 'none' }, 'preview');
      }
    }
    const unchanged = before === activeCanvas.toDataURL();
    const world = game.scene.getScene('FarmScene');
    const sprite = world.add.sprite(0, 0, 'player-navigation');
    const dispose = system.bind(sprite, () => active);
    sprite.play('player-walk-left');
    const walk = { animation: sprite.anims.currentAnim!.key, texture: sprite.texture.key, width: sprite.frame.width, height: sprite.frame.height };
    sprite.play('player-chop-right');
    const action = { animation: sprite.anims.currentAnim!.key, texture: sprite.texture.key, frame: sprite.frame.name };
    dispose();
    dispose();
    sprite.destroy();
    return { unchanged, textureCount: game.textures.getTextureKeys().filter(key => /-appearance-(active|preview)$/.test(key)).length,
      walk, action, original: system.textureFor('player-navigation', originalAppearance()) };
  });
  expect(actual.unchanged).toBe(true);
  expect(actual.textureCount).toBe(16);
  expect(actual.original).toBe('player-navigation');
  expect(actual.walk).toEqual({ animation: 'player-walk-left', texture: 'player-navigation-appearance-active', width: 96, height: 64 });
  expect(actual.action).toMatchObject({ animation: 'player-chop-right', texture: 'player-chop-appearance-active', frame: 12 });
});

test('failed late preparation and failed GPU upload preserve every active sheet and saved appearance', async ({ page }) => {
  await bootGame(page);
  const actual = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { AppearanceTextureSystem, APPEARANCE_SHEETS } = await import('/src/systems/AppearanceTextureSystem.ts');
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { originalAppearance } = await import('/src/config/Appearance.ts');
    // @ts-expect-error Vite resolves this browser-only runtime module path.
    const { GameState } = await import('/src/state/GameState.ts');
    const game = window.__GAME__;
    if (!game) throw new Error('Missing game');
    const system = AppearanceTextureSystem.forGame(game);
    GameState.instance.appearance = system.prepareActive({ ...originalAppearance(), hairColor: 'blonde', hat: 'knit' });
    const stateBefore = JSON.stringify(GameState.instance.appearance);
    /** Snapshot pixels from all eight fixed live-bank entries. */
    const snapshots = (): string[] => APPEARANCE_SHEETS.map((key: string) => (game.textures.get(`${key}-appearance-active`).getSourceImage() as HTMLCanvasElement).toDataURL());
    const before = snapshots();
    const candidate = { ...GameState.instance.appearance, hat: 'straw', shirtColor: 'sage' };
    const readSource = system.sourceFor.bind(system);
    let reads = 0;
    system.sourceFor = (key: string) => {
      reads++;
      if (key === 'player-sword') throw new Error('Injected late source failure');
      return readSource(key);
    };
    let sourceError = '';
    try { GameState.instance.appearance = system.prepareActive(candidate); }
    catch (error) { sourceError = String(error); }
    system.sourceFor = readSource;
    const sourceAtomic = JSON.stringify(before) === JSON.stringify(snapshots()) && stateBefore === JSON.stringify(GameState.instance.appearance);
    const canvas = game.textures.get('player-mine-appearance-active').getSourceImage() as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing canvas context');
    const write = context.putImageData.bind(context);
    let writes = 0;
    context.putImageData = (data: ImageData, dx: number, dy: number): void => {
      writes++;
      if (writes === 1) throw new Error('Injected upload failure');
      write(data, dx, dy);
    };
    let uploadError = '';
    try { GameState.instance.appearance = system.prepareActive(candidate); }
    catch (error) { uploadError = String(error); }
    context.putImageData = write;
    const uploadAtomic = JSON.stringify(before) === JSON.stringify(snapshots()) && stateBefore === JSON.stringify(GameState.instance.appearance);
    GameState.instance.appearance = system.prepareActive(candidate);
    const success = GameState.instance.appearance.hat === 'straw' && JSON.stringify(before) !== JSON.stringify(snapshots());
    return { reads, sourceError, sourceAtomic, uploadError, uploadAtomic, writes, success };
  });
  expect(actual.reads).toBe(8);
  expect(actual.sourceError).toContain('Injected late source failure');
  expect(actual.sourceAtomic).toBe(true);
  expect(actual.uploadError).toContain('Injected upload failure');
  expect(actual.uploadAtomic).toBe(true);
  expect(actual.writes).toBe(2);
  expect(actual.success).toBe(true);
});
