/** Player-owned farm trees: seed conservation, protected land, species growth, and durable reload. */
import { test, expect } from '@playwright/test';
import { bootGame, teleport, getState, sleepInGame } from './helpers/gameHarness';

/** Make one real axe swing and wait for its animation-owned input lock, not a guessed delay. */
async function chopOnce(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => !(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()) as unknown as { player: { busy: boolean } }).player.busy);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()) as unknown as { player: { busy: boolean } }).player.busy);
  await page.waitForFunction(() => !(window.__GAME__!.scene.getScene(window.__TEST__!.activeScene()) as unknown as { player: { busy: boolean } }).player.busy);
}

test('farm trees and rocks stay cleared while wild trees retain regrowth', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Runtime module served by Vite.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { TreeSystem } = await import('/src/systems/TreeSystem.ts');
    const gs = GameState.instance;
    gs.removedNodes = { 'FarmScene:20,20': { kind: 'tree', day: 1 }, 'FarmScene:21,20': { kind: 'rock', day: 1 }, 'ForestScene:20,20': { kind: 'tree', day: 1 } };
    gs.day = 10; TreeSystem.advanceDay();
    const first = structuredClone(gs.treeStages);
    gs.day = 12; TreeSystem.advanceDay();
    const second = structuredClone(gs.treeStages);
    gs.day = 14; TreeSystem.advanceDay();
    return { first, second, final: gs.treeStages, removed: gs.removedNodes };
  });
  expect(result.first['ForestScene:20,20'].stage).toBe('sapling');
  expect(result.second['ForestScene:20,20'].stage).toBe('small');
  expect(result.final['ForestScene:20,20']).toBeUndefined();
  expect(result.removed['FarmScene:20,20'].kind).toBe('tree');
  expect(result.removed['FarmScene:21,20'].kind).toBe('rock');
  expect(result.first['FarmScene:20,20']).toBeUndefined();
});

test('both species grow on cleared authored tiles, save all stages, and clear without regrowing', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Runtime module served by Vite.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { TreeSystem } = await import('/src/systems/TreeSystem.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { treeCellAvailable, validatePlantedTrees } = await import('/src/config/Trees.ts');
    const gs = GameState.instance, map = getMapData('FarmScene');
    const stages: string[] = [], replanted: string[] = [];
    for (const [kind, species] of [['tree', 'oak'], ['weed', 'pine']]) {
      const target = map.objects.find((p: { kind: string; tx: number; ty: number }) => {
        if (p.kind !== kind) return false;
        const key = `FarmScene:${p.tx},${p.ty}`;
        gs.removedNodes[key] = { kind, day: gs.day };
        return treeCellAvailable(gs, p.tx, p.ty);
      });
      if (!target) throw new Error(`No clearable ${kind} grass fixture`);
      const key = `FarmScene:${target.tx},${target.ty}`;
      // Version7 left a stale stump override after clearing; removal must still permit replanting.
      if (kind === 'tree') gs.treeStages[key] = { stage: 'stump', sinceDay: gs.day };
      gs.addItem(`${species}-seed`, 2);
      if (TreeSystem.plant(`${species}-seed`, target.tx, target.ty, { nodeAt: () => null }) !== 'planted') throw new Error('Expected planting');
      if (gs.treeStages[key]) throw new Error('Replanting retained a stale map-tree override');
      for (let step = 0; step < 3; step++) {
        stages.push(gs.plantedTrees[key].stage);
        const clone = validatePlantedTrees(gs.toSaveData().plantedTrees, gs);
        if (clone[key].species !== species) throw new Error('Lost species on save');
        clone[key].sinceDay = 999;
        if (gs.plantedTrees[key].sinceDay === 999) throw new Error('Aliased saved tree');
        gs.day += 2; TreeSystem.advanceDay();
      }
      if (TreeSystem.seedAt('FarmScene', target.tx, target.ty) !== `${species}-seed`) throw new Error('Wrong seed drop');
      TreeSystem.leaveStump('FarmScene', target.tx, target.ty);
      validatePlantedTrees(gs.toSaveData().plantedTrees, gs);
      TreeSystem.clear('FarmScene', target.tx, target.ty);
      replanted.push(TreeSystem.plant(`${species}-seed`, target.tx, target.ty, { nodeAt: () => null }));
      TreeSystem.clear('FarmScene', target.tx, target.ty);
    }
    gs.day += 10; TreeSystem.advanceDay();
    return { stages, replanted, trees: gs.plantedTrees, oakSeeds: gs.inventory['oak-seed'], pineSeeds: gs.inventory['pine-seed'] };
  });
  expect(result.stages).toEqual(['sapling', 'small', 'full', 'sapling', 'small', 'full']);
  expect(result.replanted).toEqual(['planted', 'planted']);
  expect(result.trees).toEqual({});
  expect(result.oakSeeds).toBeUndefined(); expect(result.pineSeeds).toBeUndefined();
});

test('invalid planting never spends seeds and corrupt planted-tree records fail explicitly', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Runtime module served by Vite.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { TreeSystem } = await import('/src/systems/TreeSystem.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { treeCellAvailable, validatePlantedTrees } = await import('/src/config/Trees.ts');
    const gs = GameState.instance;
    let target: { tx: number; ty: number } | null = null;
    for (let ty = 5; ty < 50 && !target; ty++) for (let tx = 5; tx < 50; tx++) if (treeCellAvailable(gs, tx, ty)) { target = { tx, ty }; break; }
    if (!target) throw new Error('Missing free grass');
    const { tx, ty } = target, key = `FarmScene:${tx},${ty}`;
    gs.addItem('oak-seed', 1);
    const failures = [TreeSystem.plant('oak-seed', -1, ty, { nodeAt: () => null }), TreeSystem.plant('oak-seed', tx, ty, { nodeAt: () => ({ kind: 'tree' }) })];
    gs.tiles[key] = 'tilled'; failures.push(TreeSystem.plant('oak-seed', tx, ty, { nodeAt: () => null })); delete gs.tiles[key];
    gs.placedItems.push({ item: 'workbench', scene: 'FarmScene', tx, ty, rotation: 0 });
    failures.push(TreeSystem.plant('oak-seed', tx, ty, { nodeAt: () => null })); gs.placedItems = [];
    gs.player.x = tx * 16 + 8; gs.player.y = ty * 16 + 4;
    failures.push(TreeSystem.plant('oak-seed', tx, ty, { nodeAt: () => null }));
    const base = { species: 'oak', stage: 'sapling', sinceDay: gs.day };
    const bad = [{ 'TownScene:10,10': base }, { 'FarmScene:999,999': base }, { [key]: { ...base, species: 'birch' } },
      { [key]: { ...base, stage: 'huge' } }, { [key]: { ...base, sinceDay: gs.day + 1 } }, { [key]: { ...base, extra: true } }];
    const rejected = bad.map(record => { try { validatePlantedTrees(record, gs); return false; } catch { return true; } });
    gs.treeStages[key] = { stage: 'small', sinceDay: gs.day };
    try { validatePlantedTrees({ [key]: base }, gs); rejected.push(false); } catch { rejected.push(true); }
    return { failures, rejected, seeds: gs.inventory['oak-seed'], planted: gs.plantedTrees };
  });
  expect(result.failures.every(r => r === 'blocked')).toBe(true);
  expect(result.rejected.every(Boolean)).toBe(true);
  expect(result.seeds).toBe(1); expect(result.planted).toEqual({});
});

test('real toolbelt input plants a visible pine once and cannot till its occupied trunk', async ({ page }) => {
  await bootGame(page);
  const target = await page.evaluate(async () => {
    // @ts-expect-error Runtime module served by Vite.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { treeCellAvailable } = await import('/src/config/Trees.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    gs.addItem('pine-seed', 2);
    const source = InventoryLayoutSystem.findEntrySlot(gs, 'pine-seed');
    if (!source) throw new Error('Pine seed stack has no slot');
    InventoryLayoutSystem.moveOrSwap(gs, source, { container: 'toolbelt', index: 5 });
    for (let ty = 8; ty < 50; ty++) for (let tx = 8; tx < 50; tx++) {
      if (treeCellAvailable(gs, tx, ty) && treeCellAvailable(gs, tx, ty - 1)) return { tx, ty };
    }
    throw new Error('No safe native planting position');
  });
  await teleport(page, target.tx, target.ty - 1, 'down');
  await page.keyboard.press('6');
  await page.keyboard.press('Space');
  const key = `FarmScene:${target.tx},${target.ty}`;
  await expect.poll(async () => (await getState(page)).plantedTrees[key]?.species).toBe('pine');
  expect((await getState(page)).inventory['pine-seed']).toBe(1);
  await page.keyboard.press('Space');
  expect((await getState(page)).inventory['pine-seed']).toBe(1);
  await page.keyboard.press('1'); await page.keyboard.press('Space');
  expect((await getState(page)).tiles[`${target.tx},${target.ty}`]).toBeUndefined();
  const node = await page.evaluate(target => window.__TEST__!.nodes().find(n => n.tx === target.tx && n.ty === target.ty), target);
  expect(node?.stage).toBe('sapling');
  for (let day = 0; day < 4; day++) await sleepInGame(page);
  await expect.poll(async () => (await getState(page)).plantedTrees[key]?.stage).toBe('full');
  await page.keyboard.press('2');
  for (let hit = 0; hit < 3; hit++) await chopOnce(page);
  await expect.poll(async () => (await getState(page)).plantedTrees[key]?.stage).toBe('stump');
  await expect.poll(async () => (await getState(page)).inventory['pine-seed']).toBe(2);
  for (let hit = 0; hit < 2; hit++) await chopOnce(page);
  await expect.poll(async () => (await getState(page)).plantedTrees[key]).toBeUndefined();
  expect((await getState(page)).inventory['pine-seed']).toBe(2);
});

test('v8 save and load preserve tree species and stumps without accepting corrupt growth dates', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Runtime module served by Vite.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Runtime module served by Vite.
    const { treeCellAvailable } = await import('/src/config/Trees.ts');
    const gs = GameState.instance, keys: string[] = [];
    for (let ty = 8; ty < 50 && keys.length < 2; ty++) for (let tx = 8; tx < 50 && keys.length < 2; tx++) {
      if (treeCellAvailable(gs, tx, ty)) keys.push(`FarmScene:${tx},${ty}`);
    }
    if (keys.length !== 2) throw new Error('Need two free farm tree tiles');
    gs.day = 7;
    gs.plantedTrees[keys[0]] = { species: 'oak', stage: 'stump', sinceDay: 6 };
    gs.plantedTrees[keys[1]] = { species: 'pine', stage: 'small', sinceDay: 5 };
    const before = structuredClone(gs.plantedTrees);
    SaveSystem.save(3);
    gs.plantedTrees = {};
    SaveSystem.load(3);
    const restored = structuredClone(GameState.instance.plantedTrees);
    const source = GameState.instance.toSaveData();
    const invalid = structuredClone(source); invalid.plantedTrees[keys[0]].sinceDay = 8;
    let rejected = false;
    try { GameState.candidateFromSaveData(invalid, 9); } catch { rejected = true; }
    return { before, restored, rejected, liveUnchanged: JSON.stringify(GameState.instance.plantedTrees) === JSON.stringify(before) };
  });
  expect(result.restored).toEqual(result.before);
  expect(result.rejected && result.liveUnchanged).toBe(true);
});

test('the forest trail supplies a pine seed through real axe use, not free inventory injection', async ({ page }) => {
  await bootGame(page);
  await teleport(page, 21, 98, 'down');
  await page.keyboard.down('s');
  try {
    await expect.poll(async () => (await getState(page)).activeScene).toBe('ForestScene');
    await page.waitForFunction(() => window.__TEST__!.ready && window.__GAME__!.scene.isActive('ForestScene'));
  } finally { await page.keyboard.up('s'); }
  // The painted pine west of the south-west clearing (TREE_SPECIES 'ForestScene:19,51'), chopped from the grass above it.
  await teleport(page, 19, 50, 'down');
  await page.keyboard.press('2');
  for (let hit = 0; hit < 3; hit++) await chopOnce(page);
  await expect.poll(async () => (await getState(page)).inventory['pine-seed']).toBe(1);
  const node = await page.evaluate(() => window.__TEST__!.nodes().find(n => n.tx === 19 && n.ty === 51));
  expect(node?.kind).toBe('stump');
});
