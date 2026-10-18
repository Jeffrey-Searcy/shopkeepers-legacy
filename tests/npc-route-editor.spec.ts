/** Development route workshop model, browser controls, preview, and adventure-save isolation. */
import { expect, test } from '@playwright/test';

test('route draft covers every resident and weekday with strict home anchors and shaped paths', async ({ page }) => {
  await page.goto('/?test=1&seed=42');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const route = await import('/src/debug/NpcRouteDraft.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const draft = route.createNpcRouteDraft(), before = route.npcRouteSegments(draft, 'nyra', 0);
    let blockedError = '';
    try { route.moveNpcRouteStop(draft, 'nyra', 0, 'social', 0, 0); }
    catch (error) { blockedError = (error as Error).message; }
    const map = getMapData(SceneKey.Town);
    let shaped = null;
    for (let ty = 2; ty < map.h - 2 && shaped === null; ty++) for (let tx = 2; tx < map.w - 2 && shaped === null; tx++) {
      if (map.solid[ty][tx] || map.ground[ty][tx] === 'water') continue;
      try {
        const candidate = route.addNpcRouteWaypoint(draft, 'nyra', 0, 'social', tx, ty);
        const after = route.npcRouteSegments(candidate, 'nyra', 0);
        if (JSON.stringify(after) !== JSON.stringify(before)) shaped = candidate;
      } catch { /* Other authored blockers remain invalid route points. */ }
    }
    const days: Array<{ first: { id: string; arrive: number; leave: number }; last: { id: string; arrive: number; leave: number } }> =
      draft.residents.flatMap((resident: { days: Array<{ stops: Array<{ id: string; arrive: number; leave: number }> }> }) =>
        resident.days.map(day => ({ first: day.stops[0], last: day.stops[day.stops.length - 1] })));
    const categories = ['home', 'private', 'work', 'meal', 'errand', 'social', 'leisure'];
    const detailed = draft.residents.every((resident: { days: Array<{ stops: Array<{ category?: string; tx: number; ty: number }> }> }) =>
      resident.days.every(day => day.stops.length >= 8 && day.stops.length <= 10
        && categories.every(category => day.stops.some(stop => stop.category === category))));
    const privateWeeks = draft.residents.map((resident: { residentId: string; days: Array<{ stops: Array<{
      category?: string; label: string; arrive: number; leave: number; tx: number; ty: number }> }> }) => {
      const privateStops = resident.days.map(day => day.stops.find(stop => stop.category === 'private'));
      const home = resident.days[0].stops[0];
      const destinations = new Set(resident.days.flatMap(day => day.stops
        .filter(stop => !['home', 'private', 'work'].includes(stop.category ?? ''))
        .map(stop => `${stop.tx},${stop.ty}`)));
      return { id: resident.residentId, privateLabels: new Set(privateStops.filter(stop => stop !== undefined).map(stop => stop.label)).size,
        daydream: privateStops.filter(stop => stop?.label === 'Daydreaming').length,
        daydreamIsEvening: privateStops.filter(stop => stop?.label === 'Daydreaming')
          .every(stop => stop !== undefined && stop.arrive >= 705 && stop.leave <= 885),
        privateAtHome: privateStops.length === 7 && privateStops.every(stop => stop !== undefined && stop.tx === home.tx && stop.ty === home.ty),
        destinations: destinations.size };
    });
    const routeLabels = (residentId: string): string[] => draft.residents.find((resident: { residentId: string }) => resident.residentId === residentId)
      .days.flatMap((day: { stops: Array<{ label: string }> }) => day.stops.map(stop => stop.label));
    return { version: draft.version, residents: draft.residents.length, dayCounts: draft.residents.map((resident: { days: unknown[] }) => resident.days.length),
      anchored: days.every(({ first, last }) => first.id === 'home-morning' && first.arrive === 0
        && last?.id === 'home-night' && last.leave === 1080), blockedError, unchanged: route.serializeNpcRouteDraft(draft) === route.serializeNpcRouteDraft(route.createNpcRouteDraft()),
      shaped: shaped !== null, shapedVia: shaped ? route.npcRouteDay(shaped, 'nyra', 0).stops.find((stop: { id: string }) => stop.id === 'social').via.length : 0,
      detailed, privateWeeks, nyraLabels: routeLabels('nyra'), rheaLabels: routeLabels('rhea'), kitLabels: routeLabels('kit') };
  });
  expect(result.version).toBe(2);
  expect(result.residents).toBe(12);
  expect(result.dayCounts).toEqual(Array(12).fill(7));
  expect(result.anchored).toBe(true);
  expect(result.blockedError).toContain('blocked');
  expect(result.unchanged).toBe(true);
  expect(result).toMatchObject({ shaped: true, shapedVia: 1 });
  expect(result.detailed).toBe(true);
  expect(result.privateWeeks.every((week: { privateLabels: number; daydream: number; daydreamIsEvening: boolean;
    privateAtHome: boolean; destinations: number }) =>
    week.privateLabels === 7 && week.daydream === 1 && week.daydreamIsEvening
      && week.privateAtHome && week.destinations >= 5)).toBe(true);
  expect(result.nyraLabels).toContain('Studying a curious trinket');
  expect(result.rheaLabels).toContain('Fitting a new work jacket');
  expect(result.kitLabels).toContain('Fishing the south bank');
});

test('route stop times apply together through clear choices and reject invalid ranges atomically', async ({ page }, testInfo) => {
  await page.goto('/?test=1&seed=42&routeEditor=1');
  await page.waitForFunction(() => window.__ROUTE_EDITOR__?.state().ready === true);
  const before = await page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    const stop = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(entry => entry.id === 'social')!;
    return { arrive: stop.arrive, leave: stop.leave, undo: state.undo };
  });

  await expect(page.locator('#route-arrive')).toHaveValue(String(before.arrive));
  await expect(page.locator('#route-leave')).toHaveValue(String(before.leave));
  // Pick the first 15-minute slot strictly inside the authored meeting so neighbors keep their walking time.
  const arrive = Math.ceil((before.arrive + 1) / 15) * 15, leave = arrive + 15;
  expect(leave).toBeLessThanOrEqual(before.leave);
  await page.locator('#route-arrive').selectOption(String(arrive));
  await page.locator('#route-leave').selectOption(String(leave));
  expect(await page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    const stop = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(entry => entry.id === 'social')!;
    return { arrive: stop.arrive, leave: stop.leave, undo: state.undo };
  })).toEqual(before);
  await page.locator('#route-apply-times').click();
  await expect.poll(() => page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    const stop = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(entry => entry.id === 'social')!;
    return { arrive: stop.arrive, leave: stop.leave, undo: state.undo };
  })).toEqual({ arrive, leave, undo: before.undo + 1 });
  await page.screenshot({ path: testInfo.outputPath('route-time-range.png') });

  await page.locator('#route-arrive').selectOption(String(leave));
  await page.locator('#route-leave').selectOption(String(arrive));
  await page.locator('#route-apply-times').click();
  await expect(page.locator('.route-editor-map-guide')).toContainText('CHECK TIMES');
  expect(await page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    const stop = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(entry => entry.id === 'social')!;
    return { arrive: stop.arrive, leave: stop.leave, undo: state.undo };
  })).toEqual({ arrive, leave, undo: before.undo + 1 });

  await page.locator('#route-stop-home-morning').click();
  await expect(page.locator('#route-arrive')).toBeDisabled();
  await expect(page.locator('#route-leave')).toBeDisabled();
  await expect(page.locator('#route-apply-times')).toBeDisabled();
});

test('route workshop edits, previews, and undoes without reading or changing adventure saves', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('shopkeeperslegacy.save.v1.slot.1', 'adventure bytes stay untouched');
    localStorage.setItem('skl-npc-route-editor.draft.v1', 'older route draft stays untouched');
    localStorage.setItem('skl-npc-route-editor.draft.v2', 'detailed route draft stays untouched');
  });
  await page.goto('/?test=1&seed=42&routeEditor=1');
  await page.waitForFunction(() => window.__ROUTE_EDITOR__?.state().ready === true);
  await expect(page.locator('.route-editor')).toBeVisible();
  await expect(page.locator('.route-editor-stop')).toHaveCount(9);
  await page.screenshot({ path: testInfo.outputPath('route-workshop-1280.png') });
  expect((await page.evaluate(() => window.__ROUTE_EDITOR__!.state())).draft?.residents).toHaveLength(12);

  await page.locator('.route-editor-right textarea').fill('Nyra checks a rumor with her friend before heading home.');
  await page.locator('.route-editor-right textarea').blur();
  await expect.poll(() => page.evaluate(() => window.__ROUTE_EDITOR__!.state().dirty)).toBe(true);
  await expect(page.locator('#route-undo')).toBeEnabled();
  await page.locator('#route-undo').click();
  await expect.poll(() => page.evaluate(() => window.__ROUTE_EDITOR__!.state().dirty)).toBe(false);
  await expect(page.locator('#route-redo')).toBeEnabled();

  await page.locator('[data-area="resident"]').selectOption('tessa');
  await page.locator('[data-area="weekday"]').selectOption('4');
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state())).toMatchObject({ residentId: 'tessa', weekday: 4 });
  await page.locator('[data-area="preview-range"]').evaluate((element: HTMLInputElement) => {
    element.value = '600'; element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state().previewMinute)).toBe(600);
  await page.locator('#route-preview-play').click();
  await expect.poll(() => page.evaluate(() => window.__ROUTE_EDITOR__!.state().previewMinute)).toBeGreaterThan(600);
  await page.locator('#route-preview-play').click();

  expect(await page.evaluate(() => ({ save: localStorage.getItem('shopkeeperslegacy.save.v1.slot.1'),
    oldRoute: localStorage.getItem('skl-npc-route-editor.draft.v1'),
    detailedRoute: localStorage.getItem('skl-npc-route-editor.draft.v2'),
    route: localStorage.getItem('skl-npc-route-editor.draft.v3') })))
    .toEqual({ save: 'adventure bytes stay untouched', oldRoute: 'older route draft stays untouched',
      detailedRoute: 'detailed route draft stays untouched', route: null });
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.locator('.route-editor-left')).toBeVisible();
  await expect(page.locator('.route-editor-right')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('route-workshop-800.png') });
  expect(consoleErrors).toEqual([]);
});

test('route workshop directly bends lines, drags points, and places timed stops on the map', async ({ page }, testInfo) => {
  await page.goto('/?test=1&seed=42&routeEditor=1');
  await page.waitForFunction(() => window.__ROUTE_EDITOR__?.state().ready === true);
  await expect(page.locator('.route-editor-map-guide')).toContainText('Click a gold line');
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state().tool)).toBe('edit');

  const empty = await page.evaluate(async () => {
    const state = window.__ROUTE_EDITOR__!.state();
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const route = await import('/src/debug/NpcRouteDraft.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const map = getMapData(SceneKey.Town), routeTiles = route.npcRouteSegments(state.draft!, 'nyra', 0)
      .flatMap((segment: { points: Array<{ tx: number; ty: number }> }) => segment.points);
    for (let ty = 2; ty < map.h - 2; ty++) for (let tx = 2; tx < map.w - 2; tx++) {
      if (!map.solid[ty][tx] && map.ground[ty][tx] !== 'water'
        && routeTiles.every((point: { tx: number; ty: number }) => Math.abs(point.tx - tx) + Math.abs(point.ty - ty) > 5)) {
        return window.__ROUTE_EDITOR__!.point(tx, ty);
      }
    }
    throw new Error('Test could not find empty Town ground away from the route.');
  });
  await page.mouse.click(empty.x, empty.y);
  await expect(page.locator('.route-editor-map-guide')).toContainText('NO ROUTE HERE');
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state().dirty)).toBe(false);

  const line = await page.evaluate(() => window.__ROUTE_EDITOR__!.linePoint('social'));
  await page.mouse.click(line.x, line.y);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    return state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via.length;
  })).toBe(1);
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state())).toMatchObject({ selectedStopId: 'social', selectedWaypoint: 0 });
  await page.screenshot({ path: testInfo.outputPath('route-bend-selected.png') });

  const drag = await page.evaluate(async () => {
    const state = window.__ROUTE_EDITOR__!.state();
    const via = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via[0];
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const map = getMapData(SceneKey.Town);
    const target = [{ tx: via.tx + 1, ty: via.ty }, { tx: via.tx, ty: via.ty + 1 },
      { tx: via.tx - 1, ty: via.ty }, { tx: via.tx, ty: via.ty - 1 }].find(point => map.solid[point.ty][point.tx] === false
        && map.ground[point.ty][point.tx] !== 'water' && !map.warps.some((warp: { tx: number; ty: number; w: number; h: number }) => point.tx >= warp.tx && point.tx < warp.tx + warp.w
          && point.ty >= warp.ty && point.ty < warp.ty + warp.h));
    if (!target) throw new Error('Test route bend has no adjacent passable tile.');
    return { from: window.__ROUTE_EDITOR__!.point(via.tx, via.ty), to: window.__ROUTE_EDITOR__!.point(target.tx, target.ty),
      origin: { tx: via.tx, ty: via.ty }, target };
  });
  await page.mouse.move(drag.from.x, drag.from.y);
  await page.mouse.down();
  await page.mouse.move(drag.to.x, drag.to.y, { steps: 4 });
  const liveDrag = await page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state() as ReturnType<NonNullable<typeof window.__ROUTE_EDITOR__>['state']> & {
      pointerPreview: { kind: string; tx: number; ty: number; valid: boolean } | null;
    };
    const via = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via[0];
    return { preview: state.pointerPreview, via };
  });
  expect(liveDrag).toEqual({ preview: { kind: 'waypoint', ...drag.target, valid: true }, via: drag.origin });
  await page.screenshot({ path: testInfo.outputPath('route-drag-live.png') });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    return state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via[0];
  })).toEqual(drag.target);

  const invalidDrag = await page.evaluate(async () => {
    const state = window.__ROUTE_EDITOR__!.state();
    const via = state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via[0];
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { getMapData } = await import('/src/world/MapDef.ts');
    // @ts-expect-error Vite serves source TypeScript to this isolated browser test.
    const { SceneKey } = await import('/src/config/AssetKeys.ts');
    const map = getMapData(SceneKey.Town);
    for (let ty = 2; ty < map.h - 2; ty++) for (let tx = 2; tx < map.w - 2; tx++) if (map.solid[ty][tx]) {
      return { from: window.__ROUTE_EDITOR__!.point(via.tx, via.ty), to: window.__ROUTE_EDITOR__!.point(tx, ty),
        blocked: { tx, ty }, undo: state.undo };
    }
    throw new Error('Test could not find a blocked Town tile.');
  });
  await page.mouse.move(invalidDrag.from.x, invalidDrag.from.y);
  await page.mouse.down();
  await page.mouse.move(invalidDrag.to.x, invalidDrag.to.y, { steps: 4 });
  expect(await page.evaluate(() => (window.__ROUTE_EDITOR__!.state() as unknown as {
    pointerPreview: { kind: string; tx: number; ty: number; valid: boolean } | null;
  }).pointerPreview)).toEqual({ kind: 'waypoint', ...invalidDrag.blocked, valid: false });
  await page.mouse.up();
  await expect(page.locator('.route-editor-map-guide')).toContainText('CAN’T PLACE THAT');
  expect(await page.evaluate(() => {
    const state = window.__ROUTE_EDITOR__!.state();
    return { via: state.draft!.residents.find(resident => resident.residentId === 'nyra')!.days[0].stops
      .find(stop => stop.id === 'social')!.via[0], undo: state.undo };
  })).toEqual({ via: drag.target, undo: invalidDrag.undo });

  const beforeStops = await page.locator('.route-editor-stop').count();
  await page.locator('#route-tool-add-stop').click();
  await expect(page.locator('.route-editor-map-guide')).toContainText('ADD A TIMED STOP');
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state().tool)).toBe('add-stop');
  const stopPoint = await page.evaluate(() => window.__ROUTE_EDITOR__!.linePoint('home-night'));
  await page.mouse.move(stopPoint.x, stopPoint.y);
  expect(await page.evaluate(() => (window.__ROUTE_EDITOR__!.state() as unknown as {
    pointerPreview: { kind: string; valid: boolean } | null;
  }).pointerPreview)).toMatchObject({ kind: 'add-stop', valid: true });
  await page.mouse.down(); await page.mouse.up();
  await expect(page.locator('.route-editor-stop')).toHaveCount(beforeStops + 1);
  expect(await page.evaluate(() => window.__ROUTE_EDITOR__!.state())).toMatchObject({ selectedStopId: 'activity-1', tool: 'edit' });
  await expect(page.locator('.route-editor-right')).toContainText('Route into this stop');
  await expect(page.locator('#route-undo')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('route-stop-placed.png') });
});
