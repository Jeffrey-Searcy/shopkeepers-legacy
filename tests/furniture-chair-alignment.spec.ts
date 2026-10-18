/**
 * Chair/table alignment gates (playtester report: chairs beside a table "are off").
 *
 * Reads the real loaded chair and table pixels in the browser and checks where they land in world
 * tiles, so a crop or art change that reopens a gap fails here:
 *  - every chair view lands on whole pixels (no half-pixel centering);
 *  - a side chair's seat front lands exactly on the neighbouring table's outline column;
 *  - chairs draw just under a same-row table, and seated people shift with the tucked seat.
 */
import { test, expect } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

/** Opaque column range of one cropped furniture view, measured in tile-local pixels. */
interface ViewColumns { rotation: number; displayW: number; first: number; last: number }

test('chair views sit on whole pixels and side seats meet the table outline', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { furnitureView } = await import('/src/config/Furniture.ts');
    const scene = window.__GAME__!.scene.getScene(window.__TEST__!.activeScene());
    /** Opaque columns of a texture region, as tile-local x when drawn centered on a 16px tile. */
    const columns = (texture: string, crop: { x: number; y: number; w: number; h: number }, displayW: number) => {
      const source = scene.textures.get(texture).getSourceImage() as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
      const data = ctx.getImageData(crop.x, crop.y, crop.w, crop.h).data;
      let first = Infinity, last = -Infinity;
      for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
        if (data[(y * crop.w + x) * 4 + 3] > 0) { first = Math.min(first, x); last = Math.max(last, x); }
      }
      const left = 8 - displayW / 2;
      return { first: left + first, last: left + last };
    };
    const chairs: ViewColumns[] = [0, 1, 2, 3].map(rotation => {
      const view = furnitureView('chair', rotation);
      return { rotation, displayW: view.displayW, ...columns(view.texture, view.crop, view.displayW) };
    });
    const table = furnitureView('table', 0);
    const tableCols = columns(table.texture, { x: 0, y: 0, w: 32, h: 24 }, 16);
    return { chairs, table: { first: tableCols.first, last: tableCols.last, displayW: table.displayW } };
  });
  for (const chair of result.chairs) {
    // Even leftover width means the art's left edge is a whole pixel.
    expect(chair.displayW % 2, `rotation ${chair.rotation} width ${chair.displayW}`).toBe(0);
  }
  // The 32px table drawn over a 2-tile footprint: its outline is at local 1 (left tile) and 30.
  expect(result.table).toEqual({ first: 1, last: 30, displayW: 32 });
  const west = result.chairs[1], east = result.chairs[3];
  // West-facing chair to the RIGHT of a table: seat front on the table's right outline column (30 - 32 = -2).
  expect(west.first).toBe(result.table.last - 32);
  // East-facing chair to the LEFT of a table: seat front on the table's left outline column (1 + 16 = 17).
  expect(east.last).toBe(result.table.first + 16);
});

test('chairs draw under a same-row table and seated people follow the tucked seat', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite browser module.
    const { furnitureDepth, seatedOffsetX, CHAIR_TUCK_PX } = await import('/src/config/Furniture.ts');
    return {
      chair: furnitureDepth('chair', 8, 1), table: furnitureDepth('table', 8, 1), chairBelow: furnitureDepth('chair', 9, 1),
      offsets: ['left', 'right', 'up', 'down'].map(f => seatedOffsetX(f)), tuck: CHAIR_TUCK_PX,
    };
  });
  expect(result.chair).toBeLessThan(result.table);
  // A chair in the row below the table still draws in front of it.
  expect(result.chairBelow).toBeGreaterThan(result.table);
  expect(result.offsets).toEqual([-result.tuck, result.tuck, 0, 0]);
});
