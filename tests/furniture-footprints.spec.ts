/** Furniture data, multi-cell placement, inventory transactions and versioned-save recovery. */
import { test, expect } from '@playwright/test';
import { bootGame } from './helpers/gameHarness';

test('legacy outdoor arrival furniture recovers exactly once with safe full-bag drops and unchanged slot bytes', async ({ page }) => {
  await bootGame(page);
  const outcomes = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Legacy envelopes require their historical tavern shape, not current state.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const base = GameState.instance.toSaveData();
    const map = getMapData('FarmScene');
    const results = [];
    for (const [version, full] of [[1, false], [2, false], [3, false], [4, false], [5, false], [5, true]] as const) {
      // Each loop entry represents a separate historical slot, not an attempt to replace its immutable original backup.
      localStorage.removeItem(SaveSystem.farmLayoutBackupKey(2));
      localStorage.removeItem(SaveSystem.townLayoutBackupKey(2));
      localStorage.removeItem(SaveSystem.townBuildingsBackupKey(2));
      localStorage.removeItem(SaveSystem.relationshipsBackupKey(2));
      localStorage.removeItem(SaveSystem.socialNetworkBackupKey(2));
      localStorage.removeItem(SaveSystem.justiceBackupKey(2));
      localStorage.removeItem(SaveSystem.cuddleBackupKey(2));
      const candidate = GameState.candidateFromSaveData(base);
      if (full) {
        for (const item of Object.keys(ITEM_CATALOG)) if (item !== 'chair' && item !== 'parsnip-seeds') candidate.addItem(item, 1);
        for (let index = 0; index < candidate.toolbeltSlots.length && candidate.backpackSlots.includes(null); index++) {
          const item = candidate.toolbeltSlots[index];
          if (typeof item === 'string' && item.startsWith('tool:')) InventoryLayoutSystem.moveOrSwap(candidate,
            { container: 'toolbelt', index }, { container: 'backpack', index: candidate.backpackSlots.indexOf(null) });
        }
        if (candidate.backpackSlots.includes(null)) throw new Error('Fixture requires a full backpack');
      }
      const source = candidate.toSaveData();
      source.tavern = createLegacyTavernState();
      source.placedItems = [{ item: 'chair', scene: 'FarmScene', tx: 72, ty: 15, rotation: 3 }];
      source.groundDrops = [{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 }];
      const raw = JSON.stringify({ version, slot: 2, savedAt: 123, state: source });
      localStorage.setItem(SaveSystem.storageKey(2), raw);
      const identity = GameState.instance;
      const inspect = SaveSystem.inspectSlot(2);
      const inspectAtomic = GameState.instance === identity;
      const loaded = SaveSystem.load(2);
      const notice = SaveSystem.consumeMigrationNotice();
      const second = SaveSystem.load(2);
      SaveSystem.consumeMigrationNotice();
      const drop = loaded.groundDrops.find((item: { item: string }) => item.item === 'chair');
      const safeDrop = !drop || (!map.solid[drop.ty][drop.tx] && map.ground[drop.ty][drop.tx] !== 'water' &&
        !map.spawns.some((spawn: { tx: number; ty: number }) => spawn.tx === drop.tx && spawn.ty === drop.ty) &&
        !map.warps.some((warp: { tx: number; ty: number; w: number; h: number }) => drop.tx >= warp.tx && drop.tx < warp.tx + warp.w && drop.ty >= warp.ty && drop.ty < warp.ty + warp.h));
      const count = (loaded.inventory.chair || 0) + loaded.placedItems.filter((item: { item: string }) => item.item === 'chair').length +
        loaded.groundDrops.filter((item: { item: string }) => item.item === 'chair').length;
      results.push({ version, full, inspect: inspect.status, inspectAtomic, notice, safeDrop, count,
        bag: loaded.inventory.chair || 0, dropCount: loaded.groundDrops.filter((item: { item: string }) => item.item === 'chair').length,
        originalDrop: loaded.groundDrops[0], bytes: localStorage.getItem(SaveSystem.storageKey(2)) === raw,
        repeated: JSON.stringify(loaded) === JSON.stringify(second) });
      SaveSystem.save(2, 124);
      if (localStorage.getItem(SaveSystem.farmLayoutBackupKey(2)) !== raw) throw new Error('Historical raw backup changed');
      if (localStorage.getItem(SaveSystem.townLayoutBackupKey(2)) !== raw) throw new Error('Historical Town backup changed');
      if (localStorage.getItem(SaveSystem.townBuildingsBackupKey(2)) !== raw) throw new Error('Historical civic backup changed');
      if (localStorage.getItem(SaveSystem.relationshipsBackupKey(2)) !== raw) throw new Error('Historical relationship backup changed');
      if (localStorage.getItem(SaveSystem.socialNetworkBackupKey(2)) !== raw) throw new Error('Historical social-network backup changed');
      if (localStorage.getItem(SaveSystem.justiceBackupKey(2)) !== raw) throw new Error('Historical justice backup changed');
    }
    return results;
  });
  for (const outcome of outcomes) {
    expect(outcome).toMatchObject({ inspect: 'ready', inspectAtomic: true, safeDrop: true, count: 1, bytes: true, repeated: true });
    expect(outcome.notice).toContain('outdoor arrivals');
    expect(outcome.bag).toBe(outcome.full ? 0 : 1);
    expect(outcome.dropCount).toBe(outcome.full ? 1 : 0);
    expect(outcome.originalDrop).toEqual({ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 });
  }
});

test('current saves protect entrances and room access while the moved legacy rear door recovers narrowly', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Historical fixture conversion is explicit and remains test-only.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const source = GameState.instance.toSaveData();
    const chair = { item: 'chair', scene: 'TavernScene', tx: 22, ty: 3, rotation: 0 };
    const barrier = Array.from({ length: 28 }, (_, index) => ({ ...chair, tx: index + 1, ty: 8 }));
    const cage = [[9, 10], [11, 10], [10, 9], [10, 11]].map(([tx, ty]) => ({ ...chair, tx, ty }));
    const cases = [
      { version: 10, state: { ...source, placedItems: [chair] } },
      { version: 10, state: { ...source, placedItems: [{ ...chair, tx: 14, ty: 15 }] } },
      { version: 10, state: { ...source, placedItems: barrier } },
      { version: 5, state: { ...source, tavern: createLegacyTavernState(), placedItems: barrier } },
      { version: 10, state: { ...source, activeScene: 'TavernScene', player: { ...source.player, x: 168, y: 168 }, placedItems: cage } },
    ].map(({ version, state }) => {
      const raw = JSON.stringify({ version, state, slot: 2, savedAt: 123 });
      localStorage.setItem(SaveSystem.storageKey(2), raw);
      const live = GameState.instance;
      let error = '';
      try { SaveSystem.load(2); } catch (caught) { error = String(caught); }
      return { error, unchanged: GameState.instance === live && raw === localStorage.getItem(SaveSystem.storageKey(2)) };
    });
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 5, slot: 2, savedAt: 123, state: { ...source, tavern: createLegacyTavernState(), placedItems: [chair] } }));
    const migrated = SaveSystem.load(2);
    const notice = SaveSystem.consumeMigrationNotice();
    SaveSystem.save(2, 124);
    return { cases, migrated: migrated.placedItems, recovered: migrated.inventory.chair, notice, resaved: SaveSystem.inspectSlot(2).status };
  });
  for (const item of result.cases) { expect(item.error.length).toBeGreaterThan(0); expect(item.unchanged).toBe(true); }
  expect(result.cases[2].error).toContain('required room route');
  expect(result.cases[3].error).toContain('required room route');
  expect(result.cases[4].error).toContain('required room route');
  expect(result).toMatchObject({ migrated: [], recovered: 1, resaved: 'ready' });
  expect(result.notice).toContain('rebuilt wall');
});

test('v5 preserves rotated furniture, recovers only expanded workbenches, and explicitly closes legacy service', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    const source = GameState.instance.toSaveData();
    source.placedItems = [
      { item: 'workbench', scene: 'TavernScene', tx: 8, ty: 10, rotation: 0 },
      { item: 'chair', scene: 'TavernScene', tx: 9, ty: 10, rotation: 3 },
      { item: 'table', scene: 'TavernScene', tx: 12, ty: 10, rotation: 1 },
      { item: 'rug', scene: 'TavernScene', tx: 16, ty: 10, rotation: 0 },
    ];
    source.tavern = { level: 1, welcomeClaimed: true, portions: 3, serviceDay: 1, quota: 3,
      servedToday: 1, totalServed: 1, revenue: 12, phase: 'waiting', phaseElapsedMs: 0 };
    source.gold = 12;
    const raw = JSON.stringify({ version: 5, slot: 2, savedAt: 123, state: source });
    localStorage.setItem(SaveSystem.storageKey(2), raw);
    const inspected = SaveSystem.inspectSlot(2);
    const silentInspect = SaveSystem.consumeMigrationNotice();
    const loaded = SaveSystem.load(2);
    const notice = SaveSystem.consumeMigrationNotice();
    const once = SaveSystem.consumeMigrationNotice();
    const second = SaveSystem.load(2);
    const unchanged = localStorage.getItem(SaveSystem.storageKey(2)) === raw;
    SaveSystem.save(2, 124);
    return { inspected, silentInspect, loaded, notice, once, repeat: JSON.stringify(loaded) === JSON.stringify(second), unchanged,
      resaved: JSON.parse(localStorage.getItem(SaveSystem.storageKey(2))!).version };
  });
  expect(result.inspected.status).toBe('ready');
  expect(result.silentInspect).toBeNull();
  expect(result.loaded.inventory.workbench).toBe(1);
  expect(result.loaded.placedItems.map((item: { item: string; rotation: number }) => [item.item, item.rotation])).toEqual([['chair', 3], ['table', 1], ['rug', 0]]);
  expect(result.loaded).toMatchObject({ gold: 12, inventory: { stew: 3 }, tavern: { servedToday: 1, totalServed: 1, revenue: 12,
    foodSold: 1, aleSold: 0, roomBookings: 0, innOpen: false, tavernOpen: false, guests: [], reservations: [] } });
  expect(result.notice).toContain('old service closed');
  expect(result.once).toBeNull();
  expect(result.repeat && result.unchanged).toBe(true);
  expect(result.resaved).toBe(30);
  expect(result.notice).toContain('approved layout');
});

test('workbench and stove use two tiles and crafting distinguishes materials from final bag capacity', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { furnitureCells } = await import('/src/config/Furniture.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { CraftingSystem } = await import('/src/systems/CraftingSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    const missing = CraftingSystem.getCraftability('stove');
    for (const item of Object.keys(ITEM_CATALOG)) {
      if (item !== 'stove' && item !== 'parsnip-seeds') gs.addItem(item, item === 'wood' || item === 'stone' ? 30 : 1);
    }
    for (let index = 0; index < gs.toolbeltSlots.length && gs.backpackSlots.includes(null); index++) {
      const item = gs.toolbeltSlots[index];
      if (typeof item === 'string' && item.startsWith('tool:')) InventoryLayoutSystem.moveOrSwap(gs,
        { container: 'toolbelt', index }, { container: 'backpack', index: gs.backpackSlots.indexOf(null) });
    }
    if (gs.backpackSlots.includes(null)) throw new Error('Fixture must fill the backpack');
    const before = JSON.stringify(gs.toSaveData());
    const capacity = CraftingSystem.getCraftability('stove');
    const failed = CraftingSystem.craft('stove');
    const atomic = before === JSON.stringify(gs.toSaveData());
    gs.removeItem('stone', 10); // Exactly consuming this stack frees the stove's final slot.
    const freed = CraftingSystem.getCraftability('stove');
    const crafted = CraftingSystem.craft('stove');
    return { missing, capacity, failed, atomic, freed, crafted, stove: gs.inventory.stove,
      workbench: furnitureCells('workbench', 8, 8, 0), stoveCells: furnitureCells('stove', 8, 8, 0) };
  });
  expect(result).toMatchObject({ missing: { ok: false, reason: 'ingredients' }, capacity: { ok: false, reason: 'capacity' },
    failed: false, atomic: true, freed: { ok: true }, crafted: true, stove: 1 });
  expect(result.workbench).toEqual([{ tx: 8, ty: 8 }, { tx: 9, ty: 8 }]);
  expect(result.stoveCells).toEqual(result.workbench);
});

test('legacy wall migration preserves every item and reports keeper/drop relocation while current wall conflicts reject', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Historical fixture conversion is explicit and remains test-only.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    const gs = GameState.instance;
    for (const item of Object.keys(ITEM_CATALOG)) if (item !== 'chair' && item !== 'workbench' && item !== 'parsnip-seeds') gs.addItem(item, 1);
    for (let index = 0; index < gs.toolbeltSlots.length && gs.backpackSlots.includes(null); index++) {
      const item = gs.toolbeltSlots[index];
      if (typeof item === 'string' && item.startsWith('tool:')) InventoryLayoutSystem.moveOrSwap(gs,
        { container: 'toolbelt', index }, { container: 'backpack', index: gs.backpackSlots.indexOf(null) });
    }
    if (gs.backpackSlots.includes(null)) throw new Error('Fixture requires a full backpack');
    const source = gs.toSaveData();
    source.activeScene = 'TavernScene';
    source.player = { ...source.player, x: 88, y: 40, facing: 'down' };
    source.placedItems = [
      { item: 'chair', scene: 'TavernScene', tx: 7, ty: 2, rotation: 3 },
      { item: 'workbench', scene: 'BedroomScene', tx: 8, ty: 2, rotation: 0 },
    ];
    source.groundDrops = [{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 }];
    const legacySource = { ...source, tavern: createLegacyTavernState() };
    const raw = JSON.stringify({ version: 5, slot: 2, savedAt: 123, state: legacySource });
    localStorage.setItem(SaveSystem.storageKey(2), raw);
    const migrated = SaveSystem.load(2);
    const notice = SaveSystem.consumeMigrationNotice();
    const repeated = SaveSystem.load(2);
    const cases = [
      { version: 10, state: source },
      { version: 5, state: { ...legacySource, player: { ...source.player, y: 24 } } },
    ].map(({ version, state }) => {
      localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version, state, slot: 2, savedAt: 124 }));
      const live = GameState.instance;
      let failed = false;
      try { SaveSystem.load(2); } catch { failed = true; }
      return failed && GameState.instance === live;
    });
    return { migrated, notice, repeated: JSON.stringify(migrated) === JSON.stringify(repeated), cases };
  });
  expect(result.migrated.placedItems).toEqual([]);
  expect(result.migrated.groundDrops).toEqual([
    { item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 },
    { item: 'workbench', scene: 'BedroomScene', tx: 9, ty: 11 },
    { item: 'chair', scene: 'TavernScene', tx: 14, ty: 15 },
  ]);
  expect(result.migrated.player).toMatchObject({ x: 232, y: 248, facing: 'up' });
  expect(result.notice).toContain('entrance');
  expect(result.repeated).toBe(true);
  expect(result.cases).toEqual([true, true]);
});

test('authored furniture views use whole footprints and reject unknown orientations', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { furnitureView, furnitureCells, nextFurnitureRotation } = await import('/src/config/Furniture.ts');
    const errors: string[] = [];
    for (const [item, rotation] of [['chair', 4], ['table', 2], ['chest', 1], ['__proto__', 0], ['chair', 0.5]]) {
      try { furnitureView(item, rotation); } catch (error) { errors.push(String(error)); }
    }
    return { horizontal: furnitureCells('table', 4, 5, 0), vertical: furnitureCells('table', 4, 5, 1),
      rug: furnitureCells('rug', 4, 5, 0), chair: [0, 1, 2, 3].map(rotation => furnitureView('chair', rotation).texture),
      cycle: [nextFurnitureRotation('table', 0), nextFurnitureRotation('table', 1), nextFurnitureRotation('chair', 3)], errors };
  });
  expect(result.horizontal).toEqual([{ tx: 4, ty: 5 }, { tx: 5, ty: 5 }]);
  expect(result.vertical).toEqual([{ tx: 4, ty: 5 }, { tx: 4, ty: 6 }]);
  expect(result.rug).toHaveLength(4);
  expect(new Set(result.chair).size).toBe(4);
  expect(result.cycle).toEqual([1, 0, 0]);
  expect(result.errors).toHaveLength(5);
});

test('all footprint cells validate map bounds, reservations, obstacles and scene-scoped soil', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ItemPlacementSystem: placement } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance;
    const map = getMapData('TavernScene');
    map.solid = Array.from({ length: map.h }, () => Array(map.w).fill(false));
    map.ground = Array.from({ length: map.h }, () => Array(map.w).fill('floor'));
    map.reservedTiles = [];
    const free = () => placement.canPlace(map, 10, 10, () => false, 'table', 0);
    const clear = free();
    map.solid[10][11] = true;
    const solid = free(); map.solid[10][11] = false;
    map.ground[10][11] = 'water';
    const water = free(); map.ground[10][11] = 'floor';
    map.reservedTiles = [{ tx: 11, ty: 10 }];
    const reserved = free(); map.reservedTiles = [];
    const live = placement.canPlace(map, 10, 10, (x: number) => x === 11, 'table', 0);
    const bounds = placement.canPlace(map, map.w - 2, 10, () => false, 'table', 0);
    gs.tiles['FarmScene:11,10'] = 'tilled';
    const otherScene = free();
    gs.tiles['TavernScene:11,10'] = 'tilled';
    const soil = free(); delete gs.tiles['TavernScene:11,10'];
    gs.crops['TavernScene:11,10'] = { type: 'parsnip', stage: 0, maxStage: 4, watered: false, daysInStage: 0 };
    const crop = free();
    return { clear, solid, water, reserved, live, bounds, otherScene, soil, crop };
  });
  expect(result).toEqual({ clear: true, solid: false, water: false, reserved: false, live: false, bounds: false, otherScene: true, soil: false, crop: false });
});

test('pickup from a non-anchor tile resolves the table above a rug without losing either item', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ItemPlacementSystem: placement } = await import('/src/systems/ItemPlacementSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { getMapData } = await import('/src/world/MapDef.ts');
    const gs = GameState.instance;
    const map = getMapData('TavernScene');
    gs.addItem('rug', 1); gs.addItem('table', 1);
    const rugPlaced = placement.place('rug', 'TavernScene', 10, 10, 0);
    const aboveRug = placement.canPlace(map, 10, 10, () => false, 'table', 0);
    const tablePlaced = placement.place('table', 'TavernScene', 10, 10, 0);
    const overlap = placement.canPlace(map, 11, 10, () => false, 'chair', 0);
    const target = placement.itemAt('TavernScene', 11, 10);
    const tablePickup = placement.pickup('TavernScene', 11, 10);
    const rugTarget = placement.itemAt('TavernScene', 11, 11);
    const rugPickup = placement.pickup('TavernScene', 11, 11);
    const before = JSON.stringify(gs.toSaveData());
    let unknown = '';
    try { placement.place('bad-item', 'TavernScene', 10, 10, 0); } catch (error) { unknown = String(error); }
    return { rugPlaced, aboveRug, tablePlaced, overlap, target, tablePickup, rugTarget, rugPickup,
      inventory: gs.inventory, remaining: gs.placedItems.length, unchanged: before === JSON.stringify(gs.toSaveData()), unknown };
  });
  expect(result).toMatchObject({ rugPlaced: true, aboveRug: true, tablePlaced: true, overlap: false,
    target: { item: 'table', tx: 10, ty: 10, rotation: 0 }, tablePickup: 'table',
    rugTarget: { item: 'rug', tx: 10, ty: 10 }, rugPickup: 'rug', inventory: { table: 1, rug: 1 }, remaining: 0, unchanged: true });
  expect(result.unknown).toContain('unknown item');
});

test('v1-v4 furniture migration recovers expanded items once and preserves other anchors and stored bytes', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Historical fixture conversion is explicit and remains test-only.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const source = GameState.instance.toSaveData();
    source.tavern = createLegacyTavernState();
    source.placedItems = [
      { item: 'table', scene: 'TavernScene', tx: 10, ty: 10 },
      { item: 'rug', scene: 'TavernScene', tx: 11, ty: 10 },
      { item: 'chair', scene: 'TavernScene', tx: 12, ty: 10 },
      { item: 'workbench', scene: 'TavernScene', tx: 13, ty: 10 },
    ];
    source.groundDrops = [{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 }];
    const outcomes = [];
    for (const version of [1, 2, 3, 4]) {
      const envelope = { version, slot: 2, savedAt: 123, state: structuredClone(source) };
      if (version === 1) delete envelope.state.tavern;
      if (version < 3) delete envelope.state.appearance;
      const raw = JSON.stringify(envelope);
      localStorage.setItem(SaveSystem.storageKey(2), raw);
      const liveBefore = JSON.stringify(GameState.instance.toSaveData());
      const inspect = SaveSystem.inspectSlot(2);
      const inspectUnchanged = liveBefore === JSON.stringify(GameState.instance.toSaveData());
      const loaded = SaveSystem.load(2);
      const second = SaveSystem.load(2);
      outcomes.push({ version, inspect: inspect.status, inspectUnchanged, inventory: loaded.inventory,
        placed: loaded.placedItems, drops: loaded.groundDrops, exactAgain: JSON.stringify(loaded) === JSON.stringify(second),
        bytesUnchanged: localStorage.getItem(SaveSystem.storageKey(2)) === raw });
    }
    return outcomes;
  });
  for (const outcome of result) {
    expect(outcome).toMatchObject({ inspect: 'ready', inspectUnchanged: true, inventory: { table: 1, rug: 1, workbench: 1 }, exactAgain: true, bytesUnchanged: true });
    expect(outcome.placed).toEqual([{ item: 'chair', scene: 'TavernScene', tx: 12, ty: 10, rotation: 0 }]);
    expect(outcome.drops).toEqual([{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 }]);
  }
});

test('full bags preserve recovered furnishings as exact persistent drops and failed pickup remains atomic', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ItemPlacementSystem: placement } = await import('/src/systems/ItemPlacementSystem.ts');
    const gs = GameState.instance;
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { ITEM_CATALOG } = await import('/src/config/Items.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { InventoryLayoutSystem } = await import('/src/systems/InventoryLayoutSystem.ts');
    for (const item of Object.keys(ITEM_CATALOG)) {
      if (item !== 'table' && item !== 'rug' && item !== 'parsnip-seeds') gs.addItem(item, 1);
    }
    // Physical tools can occupy backpack slots too. Fill remaining cells with real entries so
    // the live UI never encounters invented items while this full-capacity fixture is installed.
    for (let index = 0; index < gs.toolbeltSlots.length && gs.backpackSlots.includes(null); index++) {
      const entry = gs.toolbeltSlots[index];
      if (typeof entry === 'string' && entry.startsWith('tool:')) {
        InventoryLayoutSystem.moveOrSwap(gs, { container: 'toolbelt', index },
          { container: 'backpack', index: gs.backpackSlots.indexOf(null) });
      }
    }
    if (gs.backpackSlots.includes(null)) throw new Error('Full-bag fixture requires every backpack cell occupied');
    const source = gs.toSaveData();
    source.placedItems = [{ item: 'table', scene: 'TavernScene', tx: 10, ty: 10 }, { item: 'rug', scene: 'TavernScene', tx: 11, ty: 11 }];
    source.groundDrops = [{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 }];
    // @ts-expect-error Historical fixture conversion is explicit and remains test-only.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify({ version: 4, slot: 2, savedAt: 123, state: { ...source, tavern: createLegacyTavernState() } }));
    const loaded = SaveSystem.load(2);
    const state = GameState.instance;
    state.placedItems.push({ item: 'table', scene: 'TavernScene', tx: 10, ty: 10, rotation: 1 });
    const before = JSON.stringify(state.toSaveData());
    const pickup = placement.pickup('TavernScene', 10, 11);
    return { drops: loaded.groundDrops, recovered: loaded.placedItems, pickup, atomic: before === JSON.stringify(state.toSaveData()) };
  });
  expect(result.drops).toEqual([{ item: 'wood', scene: 'FarmScene', tx: 20, ty: 20 },
    { item: 'table', scene: 'TavernScene', tx: 10, ty: 10 }, { item: 'rug', scene: 'TavernScene', tx: 11, ty: 11 }]);
  expect(result.recovered).toEqual([]);
  expect(result.pickup).toBeNull();
  expect(result.atomic).toBe(true);
});

test('current saves preserve rotation and reject malformed current furniture before load mutation', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem, SAVE_VERSION } = await import('/src/systems/SaveSystem.ts');
    const gs = GameState.instance;
    gs.placedItems = [{ item: 'table', scene: 'TavernScene', tx: 10, ty: 10, rotation: 1 }];
    SaveSystem.save(2, 123);
    const raw = localStorage.getItem(SaveSystem.storageKey(2));
    if (raw === null) throw new Error('Expected the current furniture fixture save');
    const loaded = SaveSystem.load(2);
    const cases = [];
    for (const invalid of [undefined, 0.5, 2, -1]) {
      const envelope = JSON.parse(raw);
      envelope.state.placedItems[0].rotation = invalid;
      const corrupt = JSON.stringify(envelope);
      localStorage.setItem(SaveSystem.storageKey(2), corrupt);
      const before = JSON.stringify(GameState.instance.toSaveData());
      let rejected = false;
      try { SaveSystem.load(2); } catch { rejected = true; }
      cases.push(rejected && before === JSON.stringify(GameState.instance.toSaveData()) && localStorage.getItem(SaveSystem.storageKey(2)) === corrupt);
    }
    return { version: SAVE_VERSION, loaded: loaded.placedItems, cases };
  });
  expect(result.version).toBe(30); // The current envelope advances the envelope without changing furniture rotation.
  expect(result.loaded).toEqual([{ item: 'table', scene: 'TavernScene', tx: 10, ty: 10, rotation: 1 }]);
  expect(result.cases).toEqual([true, true, true, true]);
});

test('new furnishing recipes keep atomic costs and do not change service progression', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { CraftingSystem } = await import('/src/systems/CraftingSystem.ts');
    const gs = GameState.instance;
    const before = JSON.stringify(gs.toSaveData());
    const missing = CraftingSystem.craft('bar');
    const atomic = before === JSON.stringify(gs.toSaveData());
    gs.addItem('wood', 34); gs.addItem('stone', 8);
    const tavern = JSON.stringify(gs.tavern);
    const bar = CraftingSystem.craft('bar');
    const register = CraftingSystem.craft('register');
    return { missing, atomic, bar, register, inventory: gs.inventory, sameService: tavern === JSON.stringify(gs.tavern) };
  });
  expect(result).toMatchObject({ missing: false, atomic: true, bar: true, register: true, inventory: { bar: 1, register: 1 }, sameService: true });
  expect(result.inventory.wood).toBeUndefined();
  expect(result.inventory.stone).toBeUndefined();
});

test('v5 rejects out-of-map and overlapping footprints atomically but accepts a table above a rug', async ({ page }) => {
  await bootGame(page);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { GameState } = await import('/src/state/GameState.ts');
    // @ts-expect-error Vite resolves browser runtime TypeScript modules.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    // @ts-expect-error Historical fixture conversion is explicit and remains test-only.
    const { createLegacyTavernState } = await import('/src/config/Tavern.ts');
    const source = GameState.instance.toSaveData();
    const table = { item: 'table', scene: 'TavernScene', tx: 10, ty: 10, rotation: 0 };
    const invalid = [
      [{ ...table, tx: 28 }],
      [{ ...table, rotation: 1, ty: 16 }],
      [table, { item: 'chair', scene: 'TavernScene', tx: 11, ty: 10, rotation: 0 }],
      [{ ...table, item: 'rug' }, { ...table, item: 'rug', tx: 11 }],
      [{ ...table, item: 'unknown-furnishing' }],
    ];
    const rejected = invalid.map(placedItems => {
      const raw = JSON.stringify({ version: 5, slot: 2, savedAt: 123, state: { ...source, tavern: createLegacyTavernState(), placedItems } });
      localStorage.setItem(SaveSystem.storageKey(2), raw);
      const before = JSON.stringify(GameState.instance.toSaveData());
      let failed = false;
      try { SaveSystem.load(2); } catch { failed = true; }
      return failed && before === JSON.stringify(GameState.instance.toSaveData()) && localStorage.getItem(SaveSystem.storageKey(2)) === raw;
    });
    const rug = { ...table, item: 'rug' };
    const stacked = [[table, rug], [rug, table]].map(placedItems =>
      GameState.candidateFromSaveData({ ...source, placedItems }).placedItems.length);
    // Legacy adjacent tables remain valid one-cell records until they are recovered into inventory.
    const legacy = { version: 4, slot: 2, savedAt: 123, state: { ...source, tavern: createLegacyTavernState(), placedItems: [table, { ...table, tx: 11 }] } };
    localStorage.setItem(SaveSystem.storageKey(2), JSON.stringify(legacy));
    const migrated = SaveSystem.load(2);
    return { rejected, stacked, recoveredTables: migrated.inventory.table, remaining: migrated.placedItems };
  });
  expect(result.rejected).toEqual([true, true, true, true, true]);
  expect(result.stacked).toEqual([2, 2]);
  expect(result.recoveredTables).toBe(2);
  expect(result.remaining).toEqual([]);
});
