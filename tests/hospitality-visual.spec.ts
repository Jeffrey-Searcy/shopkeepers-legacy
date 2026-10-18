/** Browser layout evidence for hospitality panels and non-obscuring world order bubbles. */
import { expect, test } from '@playwright/test';
import { getState } from './helpers/gameHarness';
import { enterFurnishedShop, openHospitalityStation, clickHospitalityControl, closeHospitalityStation } from './helpers/hospitalityHarness';

for (const variant of [
  { name: 'desktop-dpr1', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  { name: 'compact-dpr2', viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 },
] as const) {
test.describe(variant.name, () => {
test.use({ viewport: variant.viewport, deviceScaleFactor: variant.deviceScaleFactor });
test('kitchen notes fit and world order bubbles stay character-sized', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Phaser's Canvas text renderer ignores high-density glyph resolution; visual evidence uses the
  // same WebGL path as normal play so text bounds and rendered pixels agree.
  await page.goto('/?test=1&seed=42&renderer=webgl');
  await page.waitForFunction(() => window.__TEST__?.ready === true);
  await enterFurnishedShop(page, true);
  await openHospitalityStation(page, 'kitchen');
  const note = await page.evaluate(() => {
    type Node = { type: string; text?: string; list?: Node[]; width: number; height: number; y: number; style?: { fontSize: string; resolution: number }; context?: { font: string } };
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel') as unknown as Node;
    const node = root.list!.find(item => item.text?.startsWith('From your kitchen'))!;
    return { width: node.width, height: node.height, y: node.y, fontSize: node.style!.fontSize, resolution: node.style!.resolution, font: node.context!.font };
  });
  await page.screenshot({ path: `output/playwright/hospitality/kitchen-${variant.name}.png` });
  expect.soft(note.width).toBeLessThanOrEqual(187);
  expect.soft(note.y + note.height).toBeLessThan(427);
  await closeHospitalityStation(page);
  await openHospitalityStation(page, 'ledger');
  await clickHospitalityControl(page, 'tavern-action-open-tavern');
  await expect.poll(async () => (await getState(page)).tavern.tavernOpen).toBe(true);
  await closeHospitalityStation(page);
  await expect.poll(async () => (await getState(page)).tavern.guests.filter(guest => guest.phase === 'waiting').length, { timeout: 40_000 }).toBe(3);
  const evidence = await page.evaluate(() => {
    const game = window.__GAME__!;
    const scene = game.scene.getScene('TavernScene');
    const camera = scene.cameras.main;
    const origin = camera.getWorldPoint(0, 0);
    const bubbles = scene.children.list.filter(item => item.name.startsWith('shop-order-')).map(item => {
      const text = item as unknown as { name: string; visible: boolean; width: number; height: number;
        getBounds(): { left: number; top: number; right: number; bottom: number } };
      const bounds = text.getBounds();
      return { name: text.name, visible: text.visible, width: text.width, height: text.height,
        left: (bounds.left - origin.x) * camera.zoom, top: (bounds.top - origin.y) * camera.zoom,
        right: (bounds.right - origin.x) * camera.zoom, bottom: (bounds.bottom - origin.y) * camera.zoom };
    });
    return { bubbles, width: game.scale.width, height: game.scale.height, renderer: game.renderer.type };
  });
  expect(evidence.renderer).toBe(2); // Phaser.WEBGL: the same glyph path used by normal play.
  const visible = evidence.bubbles.filter(bubble => bubble.visible);
  expect(visible).toHaveLength(3);
  for (const bubble of visible) {
    expect.soft(bubble.width, bubble.name).toBeLessThanOrEqual(32);
    expect.soft(bubble.height, bubble.name).toBeLessThanOrEqual(32);
    expect.soft(bubble.left, bubble.name).toBeGreaterThanOrEqual(0);
    expect.soft(bubble.top, bubble.name).toBeGreaterThanOrEqual(0);
    expect.soft(bubble.right, bubble.name).toBeLessThanOrEqual(evidence.width);
    expect.soft(bubble.bottom, bubble.name).toBeLessThanOrEqual(evidence.height);
  }
  for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) {
    const first = visible[a], second = visible[b];
    const overlaps = first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
    expect.soft(overlaps, `${first.name} must not cover ${second.name}`).toBe(false);
  }
  await page.screenshot({ path: `output/playwright/hospitality/orders-${variant.name}.png` });
  expect(errors).toEqual([]);
});
});
}
