/**
 * The finite cosmetic wardrobe saved with each keeper, each named townsperson and each shop visitor.
 * Identifiers, not rendering data, enter saves; AppearanceTextureSystem turns them into pixels.
 * `body` picks the hand-authored body (KEEPER_BODIES), `garment` a baked outfit layer (KEEPER_GARMENTS), and
 * `hairStyle`, `hat` and `facialHair` the drawn head overlays (KEEPER_OVERLAYS); the rest are recolors and pixel rules.
 */

/**
 * Labeled options shared by the editor and strict save validation. Color entries carry their swatch.
 * Key order is the editor's row order and the field order of appearanceKey.
 */
export const APPEARANCE_OPTIONS = {
  body: [{ id: 'original', label: 'Masculine' }, { id: 'feminine', label: 'Feminine' }],
  hairStyle: [{ id: 'original', label: 'Classic' }, { id: 'tousled', label: 'Tousled' }, { id: 'bob', label: 'Soft bob' }],
  hat: [{ id: 'none', label: 'No hat' }, { id: 'knit', label: 'Knit cap' }, { id: 'straw', label: 'Sun hat' }, { id: 'cap', label: 'Flat cap' },
    { id: 'helmet', label: 'Watch helmet' }, { id: 'wizard', label: 'Wizard hat' }, { id: 'hood', label: 'Hood' }],
  facialHair: [{ id: 'none', label: 'None' }, { id: 'mustache', label: 'Mustache' }, { id: 'beard', label: 'Full beard' }],
  shirtStyle: [{ id: 'original', label: 'Work shirt' }, { id: 'tee', label: 'Simple tee' }, { id: 'striped', label: 'Breton stripes' }],
  garment: [{ id: 'none', label: 'None' }, { id: 'apron', label: 'Shop apron' }, { id: 'smith', label: 'Smith apron' },
    { id: 'overalls', label: 'Overalls' }, { id: 'vest', label: 'Wool vest' }, { id: 'tabard', label: 'Watch tabard' }, { id: 'robe', label: 'Long robe' }],
  pantsStyle: [{ id: 'original', label: 'Work trousers' }, { id: 'cuffed', label: 'Rolled cuffs' }, { id: 'shorts', label: 'Summer shorts' }],
  eyeColor: [{ id: 'original', label: 'Midnight', color: '#1b1730' }, { id: 'brown', label: 'Hazel', color: '#875537' }, { id: 'green', label: 'Fern', color: '#4b875a' }, { id: 'grey', label: 'Slate', color: '#7f9aab' }],
  skinTone: [{ id: 'original', label: 'Peach', color: '#eba57a' }, { id: 'ivory', label: 'Ivory', color: '#f3d5bd' }, { id: 'warm', label: 'Warm', color: '#ce9971' }, { id: 'brown', label: 'Brown', color: '#986548' }, { id: 'deep', label: 'Deep', color: '#694736' }],
  hairColor: [{ id: 'original', label: 'Chestnut', color: '#6a3826' }, { id: 'black', label: 'Ink', color: '#34313b' }, { id: 'blonde', label: 'Honey', color: '#c39852' }, { id: 'copper', label: 'Copper', color: '#b66a43' }, { id: 'silver', label: 'Silver', color: '#b7b8bf' }],
  shirtColor: [{ id: 'original', label: 'Navy', color: '#2a4a73' }, { id: 'sage', label: 'Sage', color: '#7ea68a' }, { id: 'cream', label: 'Cream', color: '#e9d7ac' }, { id: 'blue', label: 'Lake', color: '#729fb6' }, { id: 'rose', label: 'Rose', color: '#c88791' }, { id: 'berry', label: 'Berry', color: '#8a3b5c' }],
  pantsColor: [{ id: 'original', label: 'Denim', color: '#36435f' }, { id: 'earth', label: 'Earth', color: '#876446' }, { id: 'moss', label: 'Moss', color: '#627b59' }, { id: 'slate', label: 'Slate', color: '#586570' }, { id: 'plum', label: 'Plum', color: '#79617e' }, { id: 'umber', label: 'Umber', color: '#5a4334' }],
} as const;

/** Complete serializable wardrobe; every field is mandatory in the current save version. */
export type Appearance = { -readonly [K in keyof typeof APPEARANCE_OPTIONS]: (typeof APPEARANCE_OPTIONS)[K][number]['id'] };
export type AppearanceField = keyof Appearance;

/** Return a detached original outfit, used only for new keepers and explicit legacy save migration. */
export function originalAppearance(): Appearance {
  return { body: 'original', hairStyle: 'original', hat: 'none', facialHair: 'none', shirtStyle: 'original', garment: 'none', pantsStyle: 'original',
    eyeColor: 'original', skinTone: 'original', hairColor: 'original', shirtColor: 'original', pantsColor: 'original' };
}

/** Validate an unknown save/editor value and return a detached copy; malformed or extra fields reject. */
export function assertAppearance(value: unknown): Appearance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Appearance must be an object');
  const record = value as Record<string, unknown>;
  const fields = Object.keys(APPEARANCE_OPTIONS) as (keyof Appearance)[];
  if (Object.keys(record).length !== fields.length) throw new Error('Appearance has missing or unknown fields');
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field) || !APPEARANCE_OPTIONS[field].some(option => option.id === record[field])) {
      throw new Error(`Appearance has an invalid ${field}`);
    }
  }
  return Object.fromEntries(fields.map(field => [field, record[field]])) as Appearance;
}

/** Stable cache identity independent of object property order. Validates before serialization. */
export function appearanceKey(value: Appearance): string {
  const appearance = assertAppearance(value);
  return Object.values(appearance).join('|');
}

/** Resolve a finite color identifier to its RGB swatch; non-color fields cannot be passed. */
export function appearanceColor(field: 'eyeColor' | 'skinTone' | 'hairColor' | 'shirtColor' | 'pantsColor', id: string): number {
  const option = APPEARANCE_OPTIONS[field].find(candidate => candidate.id === id);
  if (!option) throw new Error(`Unknown ${field}: ${id}`);
  return Number.parseInt(option.color.slice(1), 16);
}
