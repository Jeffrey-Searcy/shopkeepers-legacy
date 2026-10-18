/** Browser-free tests for derived furniture surface joins; durable placement and pickup stay individual. */
import { test, expect } from '@playwright/test';
import { SceneKey } from '../src/config/AssetKeys';
import type { PlacedFurniture, Rotation } from '../src/config/Furniture';
import { connectedFurnitureCells } from '../src/config/FurnitureConnections';

/** Build one explicit scene-local placement for a pure connection test. */
function placed(item: string, tx: number, ty: number, rotation: Rotation = 0, scene = SceneKey.Tavern): PlacedFurniture {
  return { item, tx, ty, rotation, scene };
}

test('horizontal and vertical tables expand into the exact saved footprint', () => {
  expect(connectedFurnitureCells([placed('table', 4, 5)], SceneKey.Tavern)).toEqual([
    { item: 'table', tx: 4, ty: 5, mask: 2 }, { item: 'table', tx: 5, ty: 5, mask: 8 },
  ]);
  expect(connectedFurnitureCells([placed('table', 4, 5, 1)], SceneKey.Tavern)).toEqual([
    { item: 'table', tx: 4, ty: 5, mask: 4 }, { item: 'table', tx: 4, ty: 6, mask: 1 },
  ]);
});

test('a square rug has all four exact outer-corner masks', () => {
  expect(connectedFurnitureCells([placed('rug', 4, 5)], SceneKey.Tavern)).toEqual([
    { item: 'rug', tx: 4, ty: 5, mask: 38 }, { item: 'rug', tx: 5, ty: 5, mask: 76 },
    { item: 'rug', tx: 4, ty: 6, mask: 19 }, { item: 'rug', tx: 5, ty: 6, mask: 137 },
  ]);
});

test('a larger rug block joins edges and fills every interior corner', () => {
  const items = [placed('rug', 4, 5), placed('rug', 6, 5), placed('rug', 4, 7), placed('rug', 6, 7)];
  const cells = connectedFurnitureCells(items, SceneKey.Tavern);
  expect(cells.map(cell => cell.mask)).toEqual([
    38, 110, 110, 76,
    55, 255, 255, 205,
    55, 255, 255, 205,
    19, 155, 155, 137,
  ]);
  expect(cells).toHaveLength(16);
});

for (const corner of [
  { label: 'northwest', removed: 0, tx: 6, ty: 7, mask: 127 },
  { label: 'northeast', removed: 1, tx: 5, ty: 7, mask: 239 },
  { label: 'southwest', removed: 2, tx: 6, ty: 6, mask: 191 },
  { label: 'southeast', removed: 3, tx: 5, ty: 6, mask: 223 },
]) {
  test(`an L-shaped rug surface preserves the ${corner.label} inner corner`, () => {
    const block = [placed('rug', 4, 5), placed('rug', 6, 5), placed('rug', 4, 7), placed('rug', 6, 7)];
    const cells = connectedFurnitureCells(block.filter((_, index) => index !== corner.removed), SceneKey.Tavern);
    expect(cells.find(cell => cell.tx === corner.tx && cell.ty === corner.ty))
      .toEqual({ item: 'rug', tx: corner.tx, ty: corner.ty, mask: corner.mask });
    expect(cells).toHaveLength(12);
  });
}

test('mixed table rotations form a corner with an explicit missing inner diagonal', () => {
  const cells = connectedFurnitureCells([placed('table', 4, 5), placed('table', 4, 6, 1)], SceneKey.Tavern);
  expect(cells).toEqual([
    { item: 'table', tx: 4, ty: 5, mask: 6 },
    { item: 'table', tx: 5, ty: 5, mask: 72 },
    { item: 'table', tx: 4, ty: 6, mask: 21 },
    { item: 'table', tx: 4, ty: 7, mask: 1 },
  ]);
});

test('removing the middle table splits a row without mutating the remaining placements', () => {
  const items = [placed('table', 4, 5), placed('table', 6, 5), placed('table', 8, 5)];
  const before = JSON.stringify(items);
  expect(connectedFurnitureCells(items, SceneKey.Tavern).map(cell => cell.mask)).toEqual([2, 10, 10, 10, 10, 8]);
  expect(connectedFurnitureCells([items[0], items[2]], SceneKey.Tavern).map(cell => cell.mask)).toEqual([2, 8, 2, 8]);
  expect(JSON.stringify(items)).toBe(before);
  expect(connectedFurnitureCells([...items].reverse(), SceneKey.Tavern)).toEqual(connectedFurnitureCells(items, SceneKey.Tavern));
});

test('tables over rugs retain independent masks and other scenes/items never connect', () => {
  const table = placed('table', 4, 5);
  const rug = placed('rug', 4, 5);
  const items = [table, rug, placed('table', 6, 5, 0, SceneKey.Bedroom), placed('workbench', 6, 5)];
  const result = connectedFurnitureCells(items, SceneKey.Tavern);
  expect(result.filter(cell => cell.item === 'table')).toEqual(connectedFurnitureCells([table], SceneKey.Tavern));
  expect(result.filter(cell => cell.item === 'rug')).toEqual(connectedFurnitureCells([rug], SceneKey.Tavern));
  expect(connectedFurnitureCells(items, SceneKey.Farm)).toEqual([]);
});

test('diagonal contact sets its own bit without inventing an edge connection', () => {
  const cells = connectedFurnitureCells([placed('table', 4, 5), placed('table', 6, 6)], SceneKey.Tavern);
  expect(cells.map(cell => cell.mask)).toEqual([2, 40, 130, 8]);
});

test('duplicate same-type cells and malformed footprints fail explicitly', () => {
  expect(() => connectedFurnitureCells([placed('table', 4, 5), placed('table', 5, 5, 1)], SceneKey.Tavern))
    .toThrow('duplicate table cell at TavernScene:5,5');
  expect(() => connectedFurnitureCells([placed('rug', 4, 5), placed('rug', 5, 6)], SceneKey.Tavern))
    .toThrow('duplicate rug cell at TavernScene:5,6');
  expect(() => connectedFurnitureCells([placed('table', 4.5, 5)], SceneKey.Tavern)).toThrow('anchor must use whole tiles');
  expect(() => connectedFurnitureCells([placed('table', 4, 5, 2)], SceneKey.Tavern)).toThrow('unsupported rotation');
});
