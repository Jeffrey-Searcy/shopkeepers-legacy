/**
 * Composes the keeper's finite wardrobe over the hand-authored keeper sheets (tools/keeper-art).
 * Physics and animation keys remain unchanged. Two fixed player banks and finite visitor/resident banks
 * keep their outfits isolated.
 *
 * How a sheet is recolored: every keeper sheet is drawn from one palette in which each RGB value is unique
 * (KeeperArt.generated.ts), so each opaque pixel names its material exactly (hair, skin, shirt, tool...).
 * Materials map to the chosen swatch through a shade ramp; style options (tee, stripes, cuffs, shorts) are
 * pixel rules on those materials; hairstyles, facial hair and hats are hand-drawn overlays placed with the
 * per-frame head offset that the art build measured. Tool, effect, boot and outline pixels are never changed.
 *
 * Bodies and garments: animations always play the original body's sheets (KEEPER_BASE_SHEETS). The wardrobe
 * renders each base sheet from the chosen body's matching sheet (KEEPER_BODY_SHEETS), so a feminine keeper keeps
 * every animation key and frame number. A garment is a diff image baked by the art build; its opaque pixels
 * replace the body's pixels before recoloring and take color only (never stripes, tee, cuff or shorts rules).
 */
import type Phaser from 'phaser';
import { APPEARANCE_OPTIONS, appearanceColor, appearanceKey, assertAppearance, originalAppearance, type Appearance } from '../config/Appearance';
import { TAVERN_VISITORS } from '../config/Tavern';
import { TOWN_RESIDENTS, validateTownResidents } from '../config/TownResidents';
import {
  KEEPER_BASE_SHEETS, KEEPER_BODIES, KEEPER_BODY_ORIGIN, KEEPER_BODY_SHEETS, KEEPER_FACINGS, KEEPER_GARMENTS,
  KEEPER_HAT_PALETTES, KEEPER_HEAD_DY, KEEPER_MASTERS, KEEPER_MATERIALS, KEEPER_OVERLAYS, KEEPER_PALETTE,
  type KeeperBaseSheet, type KeeperGarmentTexture, type KeeperOverlay, type KeeperSheet,
} from '../config/KeeperArt.generated';

/** Base keeper sheets (the animation keys), each sixteen 96x64 frames in south/north/west/east row order. */
export const APPEARANCE_SHEETS: readonly KeeperBaseSheet[] = KEEPER_BASE_SHEETS;
export type AppearanceChannel = 'active' | 'preview';
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 64;
const SHEET_WIDTH = 384;
const SHEET_HEIGHT = 256;
/** A garment diff stacks one 384x256 slice per base sheet, in KEEPER_BASE_SHEETS order. */
const GARMENT_HEIGHT = SHEET_HEIGHT * KEEPER_BASE_SHEETS.length;
const ORIGINAL_KEY = appearanceKey(originalAppearance());
/** Cream used for the light rows of the striped shirt. */
const STRIPE_COLOR = 0xe8ddc5;
/** Overlay kind drawn for each head field, in draw order: a later overlay paints over an earlier one. */
const OVERLAY_FIELDS = [['hairStyle', 'hair'], ['facialHair', 'face'], ['hat', 'hat']] as const;

/**
 * Check once, at load, that every wardrobe option has its art: each body has sheets, each garment has a diff
 * per body, and each hairstyle, facial hair and hat id has an overlay of the right kind. A mismatch means the
 * generated art module and Appearance.ts drifted apart, so it throws instead of rendering a bare keeper.
 */
(function assertWardrobeArt(): void {
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every(id => b.includes(id));
  const bodies = APPEARANCE_OPTIONS.body.map(option => option.id);
  if (!same(bodies, KEEPER_BODIES)) throw new Error(`Appearance bodies [${bodies}] do not match the art [${KEEPER_BODIES}]`);
  const garments = APPEARANCE_OPTIONS.garment.map(option => option.id).filter(id => id !== 'none');
  if (!same(garments, Object.keys(KEEPER_GARMENTS))) throw new Error(`Appearance garments [${garments}] do not match the art [${Object.keys(KEEPER_GARMENTS)}]`);
  for (const [field, kind] of OVERLAY_FIELDS) {
    for (const { id } of APPEARANCE_OPTIONS[field]) {
      if (id === 'original' || id === 'none') continue;
      const overlay = KEEPER_OVERLAYS[id];
      if (!overlay || overlay.kind !== kind) throw new Error(`Appearance ${field} ${id} has no ${kind} overlay`);
      if (overlay.kind === 'hat') continue;
      // why: hairstyle and facial-hair cells are colored by overlayHairColor, which knows only hair keys, the
      // outline and the mouth a beard frames; any other key would only fail later, mid-render
      for (const byFacing of Object.values(overlay.cells)) for (const cells of Object.values(byFacing)) for (const [, , key] of cells) {
        if (key !== KEEPER_MATERIALS.outline && key !== KEEPER_MATERIALS.mouth && !KEEPER_MATERIALS.hair.includes(key)) {
          throw new Error(`Appearance ${field} ${id} uses palette key ${key}, which is not hair, outline or mouth`);
        }
      }
    }
  }
})();
/** How far a highlight shade moves toward white per unit of brightness above the reference shade. */
const LIGHTEN = 0.6;
/** Brightness kept by a chosen eye color (see outfitRamps). */
const EYE_DARKEN = 0.5;

/** Packed RGB -> palette key. Built once; a duplicate value would make materials ambiguous, so it throws. */
const KEY_OF_RGB: ReadonlyMap<number, string> = (() => {
  const map = new Map<number, string>();
  for (const [key, value] of Object.entries(KEEPER_PALETTE)) {
    if (map.has(value)) throw new Error(`Keeper palette reuses 0x${value.toString(16)} for ${map.get(value)} and ${key}`);
    map.set(value, key);
  }
  return map;
})();

/** Read one packed RGB pixel; alpha remains independent and is never inferred from black. */
function rgb(data: Uint8ClampedArray, index: number): number {
  return (data[index] << 16) | (data[index + 1] << 8) | data[index + 2];
}

/** Perceived brightness of a packed RGB color (Rec. 601 weights), used to read a ramp's shade steps. */
function luminance(color: number): number {
  return 0.299 * (color >> 16) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255);
}

/** Write one opaque palette pixel to an already bounded destination location. */
function paint(data: Uint8ClampedArray, index: number, color: number): void {
  data[index] = color >> 16;
  data[index + 1] = (color >> 8) & 255;
  data[index + 2] = color & 255;
  data[index + 3] = 255;
}

/** Palette color for a key; an unknown key is a broken generated module, so it throws. */
function paletteColor(key: string): number {
  const color = KEEPER_PALETTE[key];
  if (color === undefined) throw new Error(`Keeper palette has no key ${key}`);
  return color;
}

/**
 * Re-shade one material ramp around a new swatch.
 * Each key keeps its brightness relative to the reference key: darker shades scale the swatch down, and
 * lighter shades move the swatch toward white. Brightness ratios (not per-channel ratios) keep the swatch hue.
 * @param keys The material's palette keys, e.g. KEEPER_MATERIALS.shirt.
 * @param reference The key whose color the swatch replaces (the material's mid tone).
 * @param swatch The chosen packed RGB color.
 * @returns Palette key -> new packed RGB.
 */
function ramp(keys: string, reference: string, swatch: number): Map<string, number> {
  const base = luminance(paletteColor(reference));
  const out = new Map<string, number>();
  for (const key of keys) {
    const t = luminance(paletteColor(key)) / base;
    const channel = (shift: number): number => {
      const value = (swatch >> shift) & 255;
      const shaded = t <= 1 ? value * t : value + (255 - value) * Math.min(1, (t - 1) * LIGHTEN);
      return Math.max(0, Math.min(255, Math.round(shaded)));
    };
    out.set(key, (channel(16) << 16) | (channel(8) << 8) | channel(0));
  }
  return out;
}

/** The unchanged colors of a material, for options left on 'original'. */
function originalRamp(keys: string): Map<string, number> {
  return new Map([...keys].map(key => [key, paletteColor(key)]));
}

/** Look up a ramp entry; a missing key means the ramp and the rule disagree, so it throws. */
function shade(ramp: ReadonlyMap<string, number>, key: string): number {
  const color = ramp.get(key);
  if (color === undefined) throw new Error(`Appearance ramp has no shade ${key}`);
  return color;
}

/** Every color ramp one outfit needs, resolved once per sheet render. */
interface OutfitRamps { hair: Map<string, number>; skin: Map<string, number>; shirt: Map<string, number>; stripe: Map<string, number>; pants: Map<string, number>; eye: number }

/** Resolve the outfit's swatches into ramps; 'original' fields keep the authored colors exactly. */
function outfitRamps(appearance: Appearance): OutfitRamps {
  const pick = (field: 'hairColor' | 'skinTone' | 'shirtColor' | 'pantsColor', keys: string, reference: string): Map<string, number> =>
    appearance[field] === 'original' ? originalRamp(keys) : ramp(keys, reference, appearanceColor(field, appearance[field]));
  return {
    hair: pick('hairColor', KEEPER_MATERIALS.hair, '3'),
    skin: pick('skinTone', KEEPER_MATERIALS.skin, 'c'),
    shirt: pick('shirtColor', KEEPER_MATERIALS.shirt, 'C'),
    stripe: ramp(KEEPER_MATERIALS.shirt, 'C', STRIPE_COLOR),
    pants: pick('pantsColor', KEEPER_MATERIALS.pants, 'P'),
    // why: the authored iris is near-black so it reads against every face. A chosen color keeps its hue but is
    // darkened to half, or the iris matches the darker skin tones and only the white glint shows ("glowing eyes").
    eye: appearance.eyeColor === 'original' ? paletteColor('e') : darken(appearanceColor('eyeColor', appearance.eyeColor), EYE_DARKEN),
  };
}

/** Scale a packed RGB color toward black by amount (1 keeps it). */
function darken(color: number, amount: number): number {
  const c = (shift: number): number => Math.round(((color >> shift) & 255) * amount);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Move a packed RGB color toward white by amount (0 keeps it, 1 is white). */
function lighten(color: number, amount: number): number {
  const c = (shift: number): number => { const v = (color >> shift) & 255; return Math.round(v + (255 - v) * amount); };
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

const HAIR_KEYS = new Set(KEEPER_MATERIALS.hair);
const EYE_KEY = 'e';
const SKIN_KEYS = new Set(KEEPER_MATERIALS.skin);
const SHIRT_KEYS = new Set(KEEPER_MATERIALS.shirt);
const PANTS_KEYS = new Set(KEEPER_MATERIALS.pants);
const BOOT_KEYS = new Set(KEEPER_MATERIALS.boots);
/** The tee hides the neckerchief and belt under shirt cloth: palette key -> shirt key whose shade it takes. */
const TEE_COVER: Readonly<Record<string, string>> = { r: 'B', R: 'C', k: 'n', L: 'B', y: 'C' };
/** Shorts show skin where the lower trouser leg was: pants key -> skin key of the same depth. */
const SHORTS_SKIN: Readonly<Record<string, string>> = { p: 'a', P: 'b', Q: 'c' };

/** True when a body-grid row carries a light stripe on the striped shirt (every third row). */
function stripeRow(gridY: number): boolean {
  return gridY % 3 === 1;
}

/** The chosen overlay for one head field, or undefined for 'original' / 'none'. */
function overlayFor(appearance: Appearance, field: typeof OVERLAY_FIELDS[number][0]): KeeperOverlay | undefined {
  const id = appearance[field];
  if (id === 'original' || id === 'none') return undefined;
  const overlay = KEEPER_OVERLAYS[id];
  if (!overlay) throw new Error(`Appearance has no overlay for ${id}`);
  return overlay;
}

/** The body sheet the wardrobe renders a base sheet from for this outfit. */
export function appearanceSourceSheet(baseKey: KeeperBaseSheet, appearance: Appearance): KeeperSheet {
  return KEEPER_BODY_SHEETS[assertAppearance(appearance).body][baseKey];
}

/** The garment diff texture for this outfit, or null when no garment is worn. */
export function appearanceGarmentTexture(appearance: Appearance): KeeperGarmentTexture | null {
  const value = assertAppearance(appearance);
  if (value.garment === 'none') return null;
  const textures = KEEPER_GARMENTS[value.garment];
  if (!textures) throw new Error(`Appearance has no garment art for ${value.garment}`);
  return textures[value.body];
}

/**
 * Render one complete sheet without modifying its source.
 * Exact palette keys retain tools, outlines, effects, boots and pose geometry. Added pixels only come from the
 * garment diff and from hairstyle, facial-hair and hat overlays. Overlays are drawn only on empty pixels or on
 * pixels where the plain body shows its master head, so a hand or tool in front of the head always stays on top.
 * @param baseKey Which base sheet (animation key) the pixels are for; selects the body sheet's head offsets.
 * @param source RGBA pixels of the body sheet appearanceSourceSheet(baseKey, value) names, never written.
 * @param width Must be 384.
 * @param height Must be 256.
 * @param value The outfit; validated here.
 * @param garment RGBA pixels of this base sheet's 384x256 slice of the garment diff, or null when value.garment
 *   is 'none'. A mismatch with value.garment throws.
 * @returns Independent RGBA pixels, byte-for-byte identical to the source for the original outfit.
 */
export function renderAppearancePixels(baseKey: KeeperBaseSheet, source: Uint8ClampedArray, width: number, height: number, value: Appearance,
  garment: Uint8ClampedArray | null): Uint8ClampedArray {
  const appearance = assertAppearance(value);
  if (width !== SHEET_WIDTH || height !== SHEET_HEIGHT || source.length !== width * height * 4) throw new Error('Appearance requires a 384x256 RGBA sheet');
  if ((appearance.garment === 'none') !== (garment === null)) throw new Error(`Appearance garment ${appearance.garment} needs ${appearance.garment === 'none' ? 'no' : 'its'} garment pixels`);
  if (garment && garment.length !== source.length) throw new Error('Appearance garment pixels must be one 384x256 RGBA slice');
  const sheetKey = appearanceSourceSheet(baseKey, appearance);
  const headDy = KEEPER_HEAD_DY[sheetKey];
  if (!headDy || headDy.length !== 16) throw new Error(`Appearance has no head offsets for ${sheetKey}`);
  const output = new Uint8ClampedArray(source);
  if (appearanceKey(appearance) === ORIGINAL_KEY) return output;
  const ramps = outfitRamps(appearance);
  const overlays = OVERLAY_FIELDS.map(([field]) => overlayFor(appearance, field));
  const hat = overlays[2];
  if (hat && hat.kind !== 'hat') throw new Error(`Appearance hat ${appearance.hat} is not a hat overlay`);
  const masters = KEEPER_MASTERS[appearance.body];
  // plain: the body sheet's palette keys; worn: the garment's key where the garment covers that pixel.
  const plain: (string | undefined)[] = new Array(FRAME_WIDTH * FRAME_HEIGHT);
  const worn: (string | undefined)[] = new Array(FRAME_WIDTH * FRAME_HEIGHT);

  for (let frame = 0; frame < 16; frame++) {
    const ox = (frame % 4) * FRAME_WIDTH;
    const oy = Math.floor(frame / 4) * FRAME_HEIGHT;
    const facing = KEEPER_FACINGS[Math.floor(frame / 4)];
    const dy = headDy[frame];
    const at = (x: number, y: number): number => ((oy + y) * width + ox + x) * 4;
    // Pass 1: name every opaque pixel of the body and the garment. An unknown color means the art drifted from the palette.
    for (let y = 0; y < FRAME_HEIGHT; y++) for (let x = 0; x < FRAME_WIDTH; x++) {
      const index = at(x, y), cell = y * FRAME_WIDTH + x;
      plain[cell] = undefined; worn[cell] = undefined;
      if (source[index + 3]) {
        const key = KEY_OF_RGB.get(rgb(source, index));
        if (key === undefined) throw new Error(`Appearance: ${sheetKey} frame ${frame} pixel ${x},${y} is not a keeper palette color`);
        plain[cell] = key;
      }
      if (garment && garment[index + 3]) {
        const key = KEY_OF_RGB.get(rgb(garment, index));
        if (key === undefined) throw new Error(`Appearance: garment ${appearance.garment} on ${sheetKey} frame ${frame} pixel ${x},${y} is not a keeper palette color`);
        worn[cell] = key;
      }
    }
    const keyAt = (x: number, y: number): string | undefined =>
      x < 0 || x >= FRAME_WIDTH || y < 0 || y >= FRAME_HEIGHT ? undefined : worn[y * FRAME_WIDTH + x] ?? plain[y * FRAME_WIDTH + x];
    /** Rows (1..3) from a trouser pixel down to the nearest boot pixel in the same or a neighbouring column, else 0. */
    const bootBelow = (x: number, y: number): number => {
      for (let k = 1; k <= 3; k++) for (let d = -1; d <= 1; d++) {
        const below = keyAt(x + d, y + k);
        if (below !== undefined && BOOT_KEYS.has(below)) return k;
      }
      return 0;
    };
    // Pass 2: recolor materials and apply clothing styles. Garment pixels take color only.
    for (let y = 0; y < FRAME_HEIGHT; y++) for (let x = 0; x < FRAME_WIDTH; x++) {
      const cell = y * FRAME_WIDTH + x;
      const index = at(x, y);
      const garmentKey = worn[cell];
      if (garmentKey !== undefined) {
        // why: garment cloth is cut to its own shape, so shirt stripes, the tee cover and trouser cuffs never apply
        if (HAIR_KEYS.has(garmentKey)) paint(output, index, shade(ramps.hair, garmentKey));
        else if (SKIN_KEYS.has(garmentKey)) paint(output, index, shade(ramps.skin, garmentKey));
        else if (garmentKey === EYE_KEY) paint(output, index, ramps.eye);
        else if (SHIRT_KEYS.has(garmentKey)) paint(output, index, shade(ramps.shirt, garmentKey));
        else if (PANTS_KEYS.has(garmentKey)) paint(output, index, shade(ramps.pants, garmentKey));
        else paint(output, index, paletteColor(garmentKey));
        continue;
      }
      const key = plain[cell];
      if (key === undefined) continue;
      const gridY = y - KEEPER_BODY_ORIGIN.y - dy;
      if (HAIR_KEYS.has(key)) paint(output, index, shade(ramps.hair, key));
      else if (SKIN_KEYS.has(key)) paint(output, index, shade(ramps.skin, key));
      else if (key === EYE_KEY) paint(output, index, ramps.eye);
      else if (SHIRT_KEYS.has(key)) {
        const striped = appearance.shirtStyle === 'striped' && stripeRow(gridY);
        paint(output, index, shade(striped ? ramps.stripe : ramps.shirt, key));
      } else if (appearance.shirtStyle === 'tee' && TEE_COVER[key]) paint(output, index, shade(ramps.shirt, TEE_COVER[key]));
      else if (PANTS_KEYS.has(key)) {
        const boot = bootBelow(x, y);
        if (appearance.pantsStyle === 'shorts' && boot) paint(output, index, shade(ramps.skin, SHORTS_SKIN[key]));
        // why: a rolled cuff is a light band of turned-up cloth on the boot, with a shadow line under the fold
        else if (appearance.pantsStyle === 'cuffed' && boot === 1) paint(output, index, lighten(shade(ramps.pants, key), 0.3));
        else if (appearance.pantsStyle === 'cuffed' && boot === 2) paint(output, index, shade(ramps.pants, 'p'));
        else paint(output, index, shade(ramps.pants, key));
      }
    }
    // Pass 3: hairstyle, facial hair, then hat. Cells follow the head offset of this frame.
    const master = masters[facing];
    const drawOverlay = (cells: ReadonlyArray<readonly [number, number, string]>, color: (key: string) => number, minRow: number): void => {
      for (const [gx, gy, key] of cells) {
        if (gy < minRow) continue;
        const x = gx + KEEPER_BODY_ORIGIN.x;
        const y = gy + KEEPER_BODY_ORIGIN.y + dy;
        if (x < 0 || x >= FRAME_WIDTH || y < 0 || y >= FRAME_HEIGHT) throw new Error(`Appearance overlay cell ${gx},${gy} leaves ${sheetKey} frame ${frame}`);
        const here = plain[y * FRAME_WIDTH + x];
        const masterKey = gy >= 0 && gy < master.length && gx >= 0 && gx < master[gy].length ? master[gy][gx] : '.';
        // why: paint only empty space or the head as authored; anything else here is a hand or tool in front.
        // The plain body decides, so a beard or hood still lies over a garment's collar or bib.
        if (here !== undefined && (masterKey === '.' || here !== masterKey)) continue;
        paint(output, at(x, y), key === 'o' ? paletteColor('o') : color(key));
      }
    };
    // why: a full beard frames the mouth, so its cells carry the mouth key; the mouth keeps its authored color,
    // as it does on the plain face (pass 2). Every other hair or face cell follows the hair color.
    const hairColor = (key: string): number => key === KEEPER_MATERIALS.mouth ? paletteColor(key) : shade(ramps.hair, key);
    const [hair, face] = overlays;
    if (hair) drawOverlay(hair.cells[appearance.body][facing], hairColor, hat?.kind === 'hat' ? hat.crown : -Infinity);
    if (face) drawOverlay(face.cells[appearance.body][facing], hairColor, -Infinity);
    if (hat) {
      const colors = KEEPER_HAT_PALETTES[appearance.hat];
      if (!colors) throw new Error(`Appearance has no hat palette for ${appearance.hat}`);
      drawOverlay(hat.cells[appearance.body][facing], key => {
        const color = colors[key];
        if (color === undefined) throw new Error(`Hat ${appearance.hat} has no color ${key}`);
        return color;
      }, -Infinity);
    }
  }
  return output;
}

/** Narrow a texture key to a base keeper sheet (an animation key) the wardrobe can render. */
function isAppearanceSheet(key: string): key is KeeperBaseSheet {
  return (APPEARANCE_SHEETS as readonly string[]).includes(key);
}

/** One game-owned compositor. Destroying a game releases its fixed texture banks and weak reference. */
export class AppearanceTextureSystem {
  private static readonly instances = new WeakMap<Phaser.Game, AppearanceTextureSystem>();
  private readonly signatures = new Map<string, string>();
  private readonly sources = new Map<string, Uint8ClampedArray>();
  /** Garment diff texture -> its full 384 x (256 * base sheets) RGBA pixels, captured once. */
  private readonly garments = new Map<KeeperGarmentTexture, Uint8ClampedArray>();

  /** Acquire the compositor for this game's shared texture manager. */
  static forGame(game: Phaser.Game): AppearanceTextureSystem {
    let instance = this.instances.get(game);
    if (!instance) { instance = new AppearanceTextureSystem(game); this.instances.set(game, instance); }
    return instance;
  }

  /** Store the owning game; sources are captured lazily after preload has completed. */
  private constructor(private readonly game: Phaser.Game) {}

  /**
   * Prepare all eight active sheets as one transaction, then return a detached value for the
   * caller's final GameState assignment. Render/asset failures happen before any live texture write.
   * An upload failure restores the prior bank and signatures, and is always rethrown to the editor.
   */
  prepareActive(value: Appearance): Appearance {
    const appearance = assertAppearance(value);
    const signature = appearanceKey(appearance);
    const prepared = new Map<string, Uint8ClampedArray>();
    for (const key of APPEARANCE_SHEETS) {
      if (signature !== ORIGINAL_KEY) prepared.set(key, this.render(key, appearance));
    }
    const snapshots = new Map<string, { pixels: ImageData; signature: string | undefined }>();
    const created: string[] = [];
    for (const key of prepared.keys()) {
      const activeKey = `${key}-appearance-active`;
      if (this.game.textures.exists(activeKey)) {
        const texture = this.game.textures.get(activeKey) as Phaser.Textures.CanvasTexture;
        snapshots.set(activeKey, { pixels: texture.context.getImageData(0, 0, SHEET_WIDTH, SHEET_HEIGHT), signature: this.signatures.get(activeKey) });
      } else created.push(activeKey);
    }
    try {
      for (const [key, pixels] of prepared) this.upload(`${key}-appearance-active`, pixels, signature);
    } catch (error) {
      const failures: string[] = [];
      for (const [key, snapshot] of snapshots) {
        try {
          const texture = this.game.textures.get(key) as Phaser.Textures.CanvasTexture;
          texture.context.putImageData(snapshot.pixels, 0, 0);
          texture.refresh();
          if (snapshot.signature === undefined) this.signatures.delete(key);
          else this.signatures.set(key, snapshot.signature);
        } catch (rollbackError) { failures.push(`${key}: ${String(rollbackError)}`); }
      }
      for (const key of created) {
        if (this.game.textures.exists(key)) this.game.textures.remove(key);
        this.signatures.delete(key);
      }
      if (failures.length) throw new Error(`Appearance upload failed (${String(error)}); restoring the previous outfit also failed: ${failures.join('; ')}`);
      throw error;
    }
    return appearance;
  }

  /** Resolve or update a fixed-bank spritesheet. No full wardrobe combinations are retained. */
  textureFor(baseKey: string, value: Appearance, channel: AppearanceChannel = 'active'): string {
    const signature = appearanceKey(value);
    if (!isAppearanceSheet(baseKey)) throw new Error(`Appearance cannot render ${baseKey}`);
    if (!this.game.textures.exists(baseKey)) throw new Error(`Appearance source is missing: ${baseKey}`);
    if (signature === ORIGINAL_KEY) return baseKey;
    const key = `${baseKey}-appearance-${channel}`;
    if (this.signatures.get(key) === signature) return key;
    this.upload(key, this.render(baseKey, value), signature);
    return key;
  }

  /**
   * Render one base sheet for an outfit from the outfit's body sheet and garment slice.
   * @param baseKey The animation's sheet key.
   * @param appearance The outfit (validated by renderAppearancePixels).
   * @returns Detached RGBA pixels for a 384x256 sheet.
   */
  private render(baseKey: KeeperBaseSheet, appearance: Appearance): Uint8ClampedArray {
    const garment = appearanceGarmentTexture(appearance);
    return renderAppearancePixels(baseKey, this.sourceFor(appearanceSourceSheet(baseKey, appearance)), SHEET_WIDTH, SHEET_HEIGHT, appearance,
      garment === null ? null : this.garmentSlice(garment, baseKey));
  }

  /**
   * Resolve one immutable visitor navigation sheet. The finite visitor catalog bounds the cache;
   * separate keys prevent a guest outfit from replacing the keeper or another guest's pixels.
   * @param visitorId Stable catalog identity, never a per-visit instance id.
   * @returns Shared navigation texture owned by this game, without changing any source artwork.
   */
  visitorTextureFor(visitorId: string): string {
    const visitor = TAVERN_VISITORS.find(candidate => candidate.id === visitorId);
    if (!visitor) throw new Error(`Appearance: unknown shop visitor ${visitorId}`);
    const signature = appearanceKey(visitor.appearance);
    const key = `shop-visitor-${visitorId}`;
    if (this.signatures.get(key) === signature) return key;
    this.upload(key, this.render('player-navigation', visitor.appearance), signature);
    return key;
  }

  /** Resolve a finite resident-only texture bank without changing player, preview or visitor pixels. */
  residentTextureFor(residentId: string): string {
    validateTownResidents();
    const resident = TOWN_RESIDENTS.find(candidate => candidate.id === residentId);
    if (!resident) throw new Error(`Appearance: unknown town resident ${residentId}`);
    const signature = appearanceKey(resident.appearance), key = `town-resident-${residentId}`;
    if (this.signatures.get(key) === signature) return key;
    this.upload(key, this.render('player-navigation', resident.appearance), signature);
    return key;
  }

  /** Resolve one explicit service-NPC outfit without adding it to resident friendship or romance data. */
  serviceTextureFor(serviceId: 'captain-maren' | 'mayor-hollis', appearanceValue: Appearance): string {
    const appearance = assertAppearance(appearanceValue);
    const signature = appearanceKey(appearance), key = `town-service-${serviceId}`;
    if (this.signatures.get(key) === signature) return key;
    this.upload(key, this.render('player-navigation', appearance), signature);
    return key;
  }

  /**
   * One base sheet's 384x256 slice of a garment diff. The diff is captured once; dimensions fail explicitly.
   * @param texture The garment diff texture key (loaded as a plain image by the manifest).
   * @param baseKey Which base sheet's slice to return (its index in KEEPER_BASE_SHEETS).
   */
  private garmentSlice(texture: KeeperGarmentTexture, baseKey: KeeperBaseSheet): Uint8ClampedArray {
    let pixels = this.garments.get(texture);
    if (!pixels) {
      if (!this.game.textures.exists(texture)) throw new Error(`Appearance garment is missing: ${texture}`);
      const image = this.game.textures.get(texture).getSourceImage() as HTMLImageElement;
      if (image.width !== SHEET_WIDTH || image.height !== GARMENT_HEIGHT) throw new Error(`Appearance garment ${texture} must be ${SHEET_WIDTH}x${GARMENT_HEIGHT}`);
      const canvas = document.createElement('canvas');
      canvas.width = SHEET_WIDTH;
      canvas.height = GARMENT_HEIGHT;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Appearance cannot acquire a canvas context');
      context.drawImage(image, 0, 0);
      pixels = context.getImageData(0, 0, SHEET_WIDTH, GARMENT_HEIGHT).data;
      this.garments.set(texture, pixels);
    }
    const index = KEEPER_BASE_SHEETS.indexOf(baseKey);
    const size = SHEET_WIDTH * SHEET_HEIGHT * 4;
    return pixels.subarray(index * size, (index + 1) * size);
  }

  /** Capture each immutable approved source once; dimensions and frames fail explicitly if art drifts. */
  private sourceFor(baseKey: KeeperSheet): Uint8ClampedArray {
    if (!this.game.textures.exists(baseKey)) throw new Error(`Appearance source is missing: ${baseKey}`);
    let source = this.sources.get(baseKey);
    if (!source) {
      const original = this.game.textures.get(baseKey);
      if (original.frameTotal !== 17) throw new Error(`Appearance source ${baseKey} requires sixteen frames`);
      const canvas = document.createElement('canvas');
      canvas.width = SHEET_WIDTH;
      canvas.height = SHEET_HEIGHT;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Appearance cannot acquire a canvas context');
      const image = original.getSourceImage() as HTMLImageElement;
      if (image.width !== SHEET_WIDTH || image.height !== SHEET_HEIGHT) throw new Error(`Appearance source ${baseKey} has invalid dimensions`);
      context.drawImage(image, 0, 0);
      source = context.getImageData(0, 0, SHEET_WIDTH, SHEET_HEIGHT).data;
      this.sources.set(baseKey, source);
    }
    return source;
  }

  /** Upload one pre-rendered sheet into a fixed bank entry, recording its signature only on success. */
  private upload(key: string, pixels: Uint8ClampedArray, signature: string): void {
    let texture: Phaser.Textures.CanvasTexture;
    if (this.game.textures.exists(key)) texture = this.game.textures.get(key) as Phaser.Textures.CanvasTexture;
    else {
      const created = this.game.textures.createCanvas(key, SHEET_WIDTH, SHEET_HEIGHT);
      if (!created) throw new Error(`Appearance cannot create texture ${key}`);
      texture = created;
      for (let frame = 0; frame < 16; frame++) texture.add(frame, 0, (frame % 4) * FRAME_WIDTH, Math.floor(frame / 4) * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT);
    }
    const imageData = texture.context.createImageData(SHEET_WIDTH, SHEET_HEIGHT);
    imageData.data.set(pixels);
    texture.context.putImageData(imageData, 0, 0);
    texture.refresh();
    this.signatures.set(key, signature);
  }

  /**
   * Apply one outfit after Phaser selects its authored animation frame. Never changes animation or body geometry.
   * @param sprite the keeper sprite whose current frame is redrawn in the outfit
   * @param appearance the wardrobe to draw
   */
  apply(sprite: Phaser.GameObjects.Sprite, appearance: Appearance): void {
    const frame = sprite.anims.currentFrame;
    const baseKey = frame ? frame.textureKey : sprite.texture.key.replace(/-appearance-(active|preview)$/, '');
    const number = frame ? frame.textureFrame : sprite.frame.name;
    const key = this.textureFor(baseKey, appearance);
    if (sprite.texture.key !== key || String(sprite.frame.name) !== String(number)) sprite.setTexture(key, number);
  }

  /**
   * Bind live pose updates; the returned disposer removes listeners without touching shared textures.
   * @param sprite the keeper sprite to keep dressed
   * @param getAppearance reads the wardrobe to draw on each animation event
   * @returns a function that removes the listeners
   */
  bind(sprite: Phaser.GameObjects.Sprite, getAppearance: () => Appearance): () => void {
    const update = (): void => this.apply(sprite, getAppearance());
    const dispose = (): void => {
      sprite.off('animationupdate', update);
      sprite.off('animationstart', update);
      sprite.off('animationcomplete', update);
      sprite.off('destroy', dispose);
    };
    sprite.on('animationupdate', update);
    sprite.on('animationstart', update);
    sprite.on('animationcomplete', update);
    sprite.once('destroy', dispose);
    update();
    return dispose;
  }
}
