/** Candidate furniture must preserve authored room circulation before inventory can change. */
import { test, expect } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

test('remote furniture cannot seal off either room entrance or surround the keeper', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { ItemPlacementSystem } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Vite resolves runtime TypeScript modules.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance;
    const map = getMapData('TavernScene');
    gs.activeScene = map.key;
    gs.player.x = 10 * 16 + 8;
    gs.player.y = 10 * 16 + 4;
    const chair = (tx: number, ty: number) => ({ item: 'chair', scene: map.key, tx, ty, rotation: 0 });
    // Seal the rear doorway's two-cell apron, leaving one final legal floor tile to test.
    gs.placedItems = [chair(21, 3), chair(21, 4), chair(24, 3), chair(24, 4), chair(22, 5)];
    const before = JSON.stringify(gs.serialize());
    const blockedDoor = ItemPlacementSystem.canPlace(map, 23, 5, () => false, 'chair', 0);
    const unchanged = before === JSON.stringify(gs.serialize());
    gs.placedItems = [chair(9, 10), chair(11, 10), chair(10, 9)];
    const trappedKeeper = ItemPlacementSystem.canPlace(map, 10, 11, () => false, 'chair', 0);
    const openFloor = ItemPlacementSystem.canPlace(map, 18, 10, () => false, 'table', 0);
    // A floor rug cannot block circulation, even at the last opening.
    const floorRug = ItemPlacementSystem.canPlace(map, 10, 11, () => false, 'rug', 0);
    gs.placedItems = [];
    const doorsRemainUsable = ItemPlacementSystem.canPlace(map, 18, 10, () => false, 'table', 0);
    return { blockedDoor, trappedKeeper, openFloor, floorRug, doorsRemainUsable, unchanged };
  });
  expect(result).toEqual({ blockedDoor: false, trappedKeeper: false, openFloor: true,
    floorRug: true, doorsRemainUsable: true, unchanged: true });
});
