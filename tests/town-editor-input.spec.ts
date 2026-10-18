/**
 * The Farm editor's Town button since the Town layout workshop was retired (save version 27): the Town is one
 * painting, so the button is "Town routes" and opens the resident route editor. Leaving still respects a dirty
 * cancel, and the saved Farm draft bytes never change on the way out.
 */
import { expect, test, type Page } from '@playwright/test';

/** Wait two renders before reading camera matrices after framing or zooming. */
async function rendered(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Read the detached Farm editor state; the seam cannot change the draft. */
async function farmState(page: Page) {
  return page.evaluate(() => {
    const seam = window.__MAP_EDITOR__;
    if (!seam) throw new Error('Farm editor seam missing');
    return seam.state();
  });
}

test('the Farm editor Town routes button respects a dirty cancel, then opens the route editor without touching the Farm draft', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1&seed=42&mapEditor=1');
  await page.waitForFunction(() => window.__MAP_EDITOR__?.state().ready === true);
  await expect(page.getByRole('region', { name: 'Farm map editor' })).toBeVisible();
  await expect(page.locator('#map-select-town')).toHaveText('Town routes');
  await page.locator('#map-save').click();
  const farmBytes = await page.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'));
  expect(farmBytes).not.toBeNull();
  // Paint a known-legal path stroke beside the shop so the draft is dirty (the same stroke map-editor-input uses).
  await page.locator('#map-shop').click();
  await page.locator('#map-tool-path').click(); await rendered(page);
  const points = await page.evaluate(() => [window.__MAP_EDITOR__!.point(77, 32), window.__MAP_EDITOR__!.point(81, 32)]);
  await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 8 }); await page.mouse.up();
  const dirty = await farmState(page);
  expect(dirty).toMatchObject({ map: 'farm', dirty: true, undo: 1 });
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#map-select-town').click();
  expect(await farmState(page)).toEqual(dirty);
  expect(new URL(page.url()).searchParams.get('mapEditor')).toBe('1');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#map-select-town').click();
  await page.waitForURL(url => url.searchParams.get('routeEditor') === '1' && !url.searchParams.has('editorMap'));
  await page.waitForFunction(() => window.__ROUTE_EDITOR__?.state().ready === true);
  await expect(page.locator('.route-editor')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('skl-map-editor.farm-draft.v1'))).toBe(farmBytes);
  expect(errors).toEqual([]);
});
