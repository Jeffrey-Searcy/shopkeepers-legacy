/** Native farm-editor gestures, draft persistence, and isolated playable preview evidence. */
import { test, expect, type Page } from '@playwright/test';
import type { FarmLayoutDraft } from '../src/debug/FarmLayoutDraft';
import { bootGame, getState, teleport, uiCanvasPoint } from './helpers/gameHarness';

/** Read detached editor state; this seam cannot mutate the draft. */
async function editorState(page: Page) {
  return page.evaluate(() => {
    if (!window.__MAP_EDITOR__) throw new Error('Editor evidence seam is missing');
    const state = window.__MAP_EDITOR__.state();
    const draft = state.draft;
    if (draft && !('shop' in draft)) throw new Error('Farm test opened a town layout');
    return { ...state, draft };
  });
}

/** Open the isolated editor and wait for its own readiness, not the gameplay seam. */
async function openEditor(page: Page, renderer = 'canvas'): Promise<void> {
  await page.goto(`/?test=1&seed=42&mapEditor=1&renderer=${renderer}`);
  await page.waitForFunction(() => window.__MAP_EDITOR__?.state().ready === true);
  await expect(page.getByRole('region', { name: 'Farm map editor' })).toBeVisible();
}

/** Wait two renders before reading camera matrices after framing, zooming, or resizing. */
async function rendered(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Use the read-only CSS coordinate conversion, then send actual pointer events. */
async function stroke(page: Page, from: { tx: number; ty: number }, to: { tx: number; ty: number }): Promise<void> {
  await rendered(page);
  const points = await page.evaluate(({ from, to }) => {
    if (!window.__MAP_EDITOR__) throw new Error('Missing editor');
    return [window.__MAP_EDITOR__.point(from.tx, from.ty), window.__MAP_EDITOR__.point(to.tx, to.ty)];
  }, { from, to });
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 8 });
  await page.mouse.up();
}

/** Choose an opaque rendered pixel and a nearby valid tile; no fixture writes bypass input. */
async function moveEntity(page: Page, kind: string): Promise<{ id: string; tx: number; ty: number }> {
  // The approved bin lies beyond the shop close-up on narrow screens. Use real framing controls.
  if (kind === 'bin') await page.locator('#map-frame').click();
  if (kind === 'shop') await page.locator('#map-shop').click();
  await rendered(page);
  const gesture = await page.evaluate(async kind => {
    // @ts-expect-error Vite serves the pure runtime layout module.
    const { getFarmLayoutEntities, moveFarmLayoutEntity } = await import('/src/debug/FarmLayoutDraft.ts');
    const seam = window.__MAP_EDITOR__, game = window.__GAME__;
    if (!seam || !game) throw new Error('Missing editor runtime');
    const draft = seam.state().draft;
    if (!draft) throw new Error('Missing draft');
    const scene = game.scene.getScene('MapEditorScene');
    /** Browser mouse coordinates are integer CSS pixels, especially important below 1x zoom. */
    const pointerWorld = (point: { x: number; y: number }) => scene.cameras.main.getWorldPoint(
      game.scale.transformX(point.x), game.scale.transformY(point.y));
    const entities = getFarmLayoutEntities(draft) as Array<{ id: string; kind: string; tx: number; ty: number }>;
    /** Resolve actual foreground opacity, so a rear tree cannot borrow a nearer canopy's pixel. */
    const foreground = (wx: number, wy: number): string | null => {
      for (const value of [...entities].sort((a, b) => b.ty - a.ty)) {
        if (value.kind === 'shop') {
          if (wx >= value.tx * 16 && wx < (value.tx + 10) * 16 && wy >= value.ty * 16 && wy < (value.ty + 10) * 16) return value.id;
          continue;
        }
        const image = scene.children.getByName(`layout-${value.id}`) as Phaser.GameObjects.Image;
        if (!image) throw new Error(`No rendered ${value.id}`);
        const bounds = image.getBounds();
        if (!bounds.contains(wx, wy)) continue;
        const alpha = scene.textures.getPixelAlpha(Math.floor((wx - bounds.x) / image.scaleX),
          Math.floor((wy - bounds.y) / image.scaleY), image.texture.key, image.frame.name);
        if (alpha !== null && alpha > 0) return value.id;
      }
      return null;
    };
    for (const entity of entities.filter(value => value.kind === kind)) {
      let start: { x: number; y: number } | null = null;
      if (kind === 'shop') start = seam.point(entity.tx + 4, entity.ty + 4);
      else {
        const image = scene.children.getByName(`layout-${entity.id}`) as Phaser.GameObjects.Image;
        if (!image) throw new Error(`No image for ${entity.id}`);
        const bounds = image.getBounds();
        // The bottom-middle of the art avoids most overlapping tree canopies. Scan if transparent.
        for (let y = image.frame.height - 2; y >= 0 && !start; y--) {
          for (const x of [Math.floor(image.frame.width / 2), Math.floor(image.frame.width / 2) - 2, Math.floor(image.frame.width / 2) + 2]) {
            const alpha = scene.textures.getPixelAlpha(x, y, image.texture.key, image.frame.name);
            if (alpha !== null && alpha > 0) {
              const wx = bounds.x + (x + 0.5) * image.scaleX, wy = bounds.y + (y + 0.5) * image.scaleY;
              if (foreground(wx, wy) !== entity.id) continue;
              const precise = seam.point(wx / 16 - 0.5, wy / 16 - 0.5);
              const native = { x: Math.round(precise.x), y: Math.round(precise.y) };
              const actual = pointerWorld(native);
              if (foreground(actual.x, actual.y) !== entity.id) continue;
              start = native;
              break;
            }
          }
        }
      }
      if (!start || start.x < 230 || start.x >= innerWidth - 10 || start.y < 225 || start.y >= innerHeight - 55) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [2, 0], [-2, 0]]) {
        try { moveFarmLayoutEntity(draft, entity.id, entity.tx + dx, entity.ty + dy); }
        catch { continue; } // Rejected candidates only select a legal fixture; the real drag performs the edit.
        const origin = seam.point(entity.tx, entity.ty), target = seam.point(entity.tx + dx, entity.ty + dy);
        const end = { x: Math.round(start.x + target.x - origin.x), y: Math.round(start.y + target.y - origin.y) };
        if (end.x < 230 || end.x >= innerWidth - 10 || end.y < 225 || end.y >= innerHeight - 55) continue;
        const actualStart = pointerWorld(start), actualEnd = pointerWorld(end);
        if (Math.floor(actualEnd.x / 16) - Math.floor(actualStart.x / 16) !== dx ||
          Math.floor(actualEnd.y / 16) - Math.floor(actualStart.y / 16) !== dy) continue;
        return { start, end, id: entity.id, tx: entity.tx + dx, ty: entity.ty + dy };
      }
    }
    throw new Error(`No visible legal ${kind} gesture`);
  }, kind);
  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.mouse.down();
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const draft = (await editorState(page)).draft;
    if (!draft) throw new Error('Missing draft');
    return [draft.shop, ...draft.objects, ...draft.decor].find(entity => entity.id === gesture.id);
  }).toMatchObject({ id: gesture.id, tx: gesture.tx, ty: gesture.ty });
  return { id: gesture.id, tx: gesture.tx, ty: gesture.ty };
}

/** Capture all gameplay-slot bytes, including absent slots, without reading editor preferences. */
async function slotBytes(page: Page): Promise<Array<string | null>> {
  return page.evaluate(() => [1, 2, 3].map(slot => localStorage.getItem(`shopkeeperslegacy.save.v1.slot.${slot}`)));
}

for (const width of [1280, 700]) test(`${width}px editor: native moves, one-stroke history, saved reload and live resize`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 850 });
  await openEditor(page);
  const initial = await editorState(page), gameBefore = await getState(page);
  expect(initial).toMatchObject({ dirty: false, undo: 0, redo: 0 });
  await moveEntity(page, 'bin');
  await moveEntity(page, 'shop');
  const moved = (await editorState(page)).draft;
  expect(moved).not.toEqual(initial.draft);
  await page.locator('#map-tool-path').focus();
  await page.keyboard.press('Enter');
  await stroke(page, { tx: 77, ty: 32 }, { tx: 81, ty: 32 });
  const painted = await editorState(page);
  expect(painted.undo).toBe(3);
  for (let tx = 77; tx <= 81; tx++) expect(painted.draft?.ground).toContainEqual({ tx, ty: 32, ground: 'dirt' });
  await page.keyboard.press('ControlOrMeta+z');
  expect((await editorState(page)).draft).toEqual(moved);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect((await editorState(page)).draft).toEqual(painted.draft);
  await page.locator('#map-save').click();
  expect((await editorState(page)).dirty).toBe(false);
  await page.reload(); await page.waitForFunction(() => window.__MAP_EDITOR__?.state().ready === true);
  expect((await editorState(page)).draft).toEqual(painted.draft);
  expect((await editorState(page)).undo).toBe(0);
  await page.locator('#map-tool-path').click(); await rendered(page);
  const unfinished = await page.evaluate(() => [window.__MAP_EDITOR__!.point(77, 33), window.__MAP_EDITOR__!.point(81, 33)]);
  await page.mouse.move(unfinished[0].x, unfinished[0].y); await page.mouse.down();
  await page.mouse.move(unfinished[1].x, unfinished[1].y, { steps: 5 });
  // Resize cancels an unfinished new stroke before pointer-up can commit it under a changed camera.
  await page.setViewportSize({ width: width === 1280 ? 900 : 1000, height: 850 });
  await rendered(page); await page.mouse.up();
  expect((await editorState(page)).draft).toEqual(painted.draft);
  expect((await editorState(page)).undo).toBe(0);
  await page.locator('#map-shop').click();
  await page.locator('#map-tool-grass').click();
  await stroke(page, { tx: 77, ty: 32 }, { tx: 81, ty: 32 });
  expect((await editorState(page)).draft).toEqual(moved);
  await page.locator('#map-undo').click();
  expect((await editorState(page)).draft).toEqual(painted.draft);
  // Editor shortcuts and canvas input never start the clock, move the keeper, or spend items.
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
  expect(await getState(page)).toEqual(gameBefore);
  await page.setViewportSize({ width, height: 850 });
  await page.locator('#map-shop').click(); await rendered(page);
  await page.screenshot({ path: `output/map-editor/editor-${width}.png` });
  expect(await slotBytes(page)).toEqual([null, null, null]);
  expect(errors).toEqual([]);
});

test('editor: resource/decor drags, pan/zoom, invalid input and confirmed reset preserve atomic history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 850 }); await openEditor(page);
  const original = (await editorState(page)).draft;
  await page.locator('#map-frame').click();
  for (const kind of ['tree', 'rock', 'weed', 'flowers']) await moveEntity(page, kind);
  const moved = await editorState(page);
  const beforePoint = await page.evaluate(() => window.__MAP_EDITOR__!.point(50, 50));
  await page.locator('#map-zoom-in').click(); await rendered(page);
  await page.locator('#map-tool-pan').click();
  await page.mouse.move(750, 450); await page.mouse.down(); await page.mouse.move(800, 480, { steps: 5 }); await page.mouse.up();
  await rendered(page);
  expect(await page.evaluate(() => window.__MAP_EDITOR__!.point(50, 50))).not.toEqual(beforePoint);
  expect((await editorState(page)).draft).toEqual(moved.draft);
  await page.locator('#map-frame').click(); await page.locator('#map-tool-path').click();
  // The known east pond is frozen; one rejected brush keeps both model and history exact.
  await stroke(page, { tx: 74, ty: 43 }, { tx: 75, ty: 43 });
  await expect(page.getByRole('status')).toHaveClass(/is-error/);
  expect(await editorState(page)).toMatchObject({ draft: moved.draft, undo: moved.undo });
  await page.locator('#map-tool-move').click();
  if (!moved.draft) throw new Error('Missing moved draft');
  const bin = moved.draft.objects.find(object => object.kind === 'bin');
  if (!bin) throw new Error('Missing shipping bin');
  await stroke(page, bin, { tx: moved.draft.shop.tx + 4, ty: moved.draft.shop.ty + 4 });
  await expect(page.getByRole('status')).toHaveClass(/is-error/);
  expect(await editorState(page)).toMatchObject({ draft: moved.draft, undo: moved.undo });
  await page.locator('#map-save').click();
  const stored = await page.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'));
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await expect(page.getByRole('status')).toHaveClass(/is-error/);
  expect((await editorState(page)).draft).toEqual(moved.draft);
  expect(await page.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'))).toBe(stored);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#map-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('shopkeepers-farm-layout.json');
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Export did not supply a readable JSON file');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(moved.draft);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#map-reset').click();
  expect((await editorState(page)).draft).toEqual(moved.draft);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#map-reset').click();
  expect((await editorState(page)).draft).toEqual(original);
  await page.locator('#map-undo').click();
  expect((await editorState(page)).draft).toEqual(moved.draft);
  expect(errors).toEqual([]);
});

test('native preview keeps normal save bytes and state intact, freezes layout and follows the moved shop door', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await bootGame(page);
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the actual save API; create a real validated sentinel slot.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    SaveSystem.save(1, 123456);
  });
  // Discover the actual F10 entry and open its separate editor page through native input.
  await page.keyboard.press('F10');
  const entry = await page.evaluate(() => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('dev-tuning-panel') as Phaser.GameObjects.Container;
    if (!panel.visible) throw new Error('F10 did not open development controls');
    const button = panel.getByName('dev-map-editor') as Phaser.GameObjects.Text;
    const bounds = button.getBounds(); return { x: bounds.centerX, y: bounds.centerY };
  });
  const editorPromise = context.waitForEvent('page');
  const editorPoint = await uiCanvasPoint(page, entry); await page.mouse.click(editorPoint.x, editorPoint.y);
  const editor = await editorPromise;
  await expect.poll(async () => (await getState(page)).paused).toBe(true);
  const original = await getState(page), bytes = await slotBytes(page);
  await editor.setViewportSize({ width: 1280, height: 850 });
  await editor.waitForFunction(() => window.__MAP_EDITOR__?.state().ready === true);
  await moveEntity(editor, 'shop'); await editor.locator('#map-save').click();
  const draft = (await editorState(editor)).draft as FarmLayoutDraft;
  const popup = context.waitForEvent('page'); await editor.locator('#map-preview').click();
  const preview = await popup; const errors: string[] = [];
  preview.on('pageerror', error => errors.push(error.message));
  await preview.waitForFunction(() => window.__TEST__?.ready === true);
  await expect(preview.locator('.map-preview-banner')).toBeVisible();
  const previewLayout = await preview.evaluate(async () => {
    // @ts-expect-error Inspect the same map resolver used by gameplay.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Inspect save guards without changing stored bytes.
    const { SaveSystem } = await import('/src/systems/SaveSystem.ts');
    const failures: string[] = [];
    for (const action of [() => SaveSystem.save(1), () => SaveSystem.load(1), () => SaveSystem.delete(1), () => SaveSystem.beginNewGame(2)]) {
      try { action(); } catch (error) { failures.push(String(error)); }
    }
    return { map: getMapData('FarmScene'), failures, slot: SaveSystem.currentSlot(), automatic: SaveSystem.saveCurrent() };
  });
  expect(previewLayout.failures).toHaveLength(4);
  expect(previewLayout.slot).toBeNull(); expect(previewLayout.automatic).toBeNull();
  expect(await slotBytes(page)).toEqual(bytes);
  const door = previewLayout.map.warps.find((warp: { target: string }) => warp.target === 'TavernScene');
  if (!door) throw new Error('Draft door is missing');
  expect(door.tx).toBe(draft.shop.tx + 4); expect(door.ty).toBe(draft.shop.ty + 7);
  await teleport(preview, door.tx, door.ty + 2, 'up');
  await preview.keyboard.down('ArrowUp');
  await preview.waitForFunction(() => window.__TEST__?.activeScene() === 'TavernScene' && window.__TEST__.ready);
  await preview.keyboard.up('ArrowUp');
  const exit = await preview.evaluate(async () => {
    // @ts-expect-error Read the actual authored interior exit, never invent a doorway position.
    const { getMapData } = await import('/src/world/MapDef.ts');
    return getMapData('TavernScene').warps.find((warp: { target: string }) => warp.target === 'FarmScene');
  });
  if (!exit) throw new Error('Shop exit is missing');
  await teleport(preview, exit.tx, exit.ty - 1, 'down'); await preview.keyboard.down('ArrowDown');
  await preview.waitForFunction(() => window.__TEST__?.activeScene() === 'FarmScene' && window.__TEST__.ready);
  await preview.keyboard.up('ArrowDown');
  const arrival = previewLayout.map.spawns.find((spawn: { id: string }) => spawn.id === 'from_home');
  if (!arrival) throw new Error('Draft return arrival is missing');
  expect((await getState(preview)).player.x).toBe(arrival.tx * 16 + 8);
  await editor.locator('#map-shop').click(); await moveEntity(editor, 'shop');
  await editor.locator('#map-save').click();
  expect(await preview.evaluate(async () => {
    // @ts-expect-error The open preview must retain its first validated snapshot.
    return (await import('/src/world/MapDef.ts')).getMapData('FarmScene');
  })).toEqual(previewLayout.map);
  await preview.screenshot({ path: 'output/map-editor/preview-moved-shop.png' });
  const beforeHarvest = await editorState(editor);
  const storedDraft = await editor.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'));
  const rock = previewLayout.map.objects.find((object: { kind: string; tx: number; ty: number }) => object.kind === 'rock' &&
    object.ty < 97 && !previewLayout.map.solid[object.ty + 1][object.tx] &&
    !previewLayout.map.objects.some((other: { tx: number; ty: number }) => other.tx === object.tx && other.ty === object.ty + 1));
  if (!rock) throw new Error('No accessible rock for native preview harvest');
  await teleport(preview, rock.tx, rock.ty + 1, 'up'); await preview.keyboard.press('3');
  await preview.keyboard.down('Space');
  await expect.poll(async () => (await getState(preview)).removedNodes[`FarmScene:${rock.tx},${rock.ty}`]?.kind).toBe('rock');
  await preview.keyboard.up('Space');
  expect(await editorState(editor)).toEqual(beforeHarvest);
  expect(await editor.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'))).toBe(storedDraft);
  expect(await slotBytes(page)).toEqual(bytes); expect(await getState(page)).toEqual(original);
  expect(errors).toEqual([]);
  await preview.close(); await editor.close();
});

test.describe('Retina production renderer', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 850 } });
  test('WebGL editor maps native CSS input correctly at DPR2', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openEditor(page, 'webgl');
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    expect(await page.evaluate(() => window.__GAME__!.renderer.type)).toBe(2);
    await moveEntity(page, 'bin'); await moveEntity(page, 'shop');
    const moved = (await editorState(page)).draft;
    await page.locator('#map-tool-path').click();
    await stroke(page, { tx: 77, ty: 32 }, { tx: 81, ty: 32 });
    expect((await editorState(page)).undo).toBe(3);
    await page.locator('#map-undo').click(); expect((await editorState(page)).draft).toEqual(moved);
    await page.locator('#map-save').click();
    await page.screenshot({ path: 'output/map-editor/editor-webgl-dpr2.png' });
    expect(errors).toEqual([]);
  });
});
