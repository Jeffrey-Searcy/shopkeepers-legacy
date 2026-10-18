import { teleportAtFarmShop } from './gameHarness';
/** Native hospitality controls and resource-only fixtures shared by full browser playthroughs. */
import { expect, type Page } from '@playwright/test';
import { getState, teleport, uiCanvasPoint } from './gameHarness';

/** Click a named Phaser control through the real canvas; never call its business action directly. */
export async function clickHospitalityControl(page: Page, name: string): Promise<void> {
  // Batch selection rebuilds controls inside pointerdown. Phaser queues their input registration
  // until preUpdate; visible artwork alone does not mean the next native click can hit the row.
  await page.waitForFunction(name => {
    const scene = window.__GAME__!.scene.getScene('UIScene');
    const input = scene.input as unknown as { _list: { name: string; input: { enabled: boolean } | null | undefined }[] };
    return input._list.some(control => control.name === name && control.input != null && control.input.enabled);
  }, name);
  const center = await page.evaluate(name => {
    type Control = { name: string; list?: Control[]; getBounds(): { centerX: number; centerY: number } };
    const root = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel') as unknown as Control;
    /** Traverse the UI's containers without depending on row positions or responsive scaling. */
    const locate = (node: Control): Control | undefined => {
      if (node.name === name) return node;
      if (node.list) for (const child of node.list) { const match = locate(child); if (match) return match; }
      return undefined;
    };
    const control = locate(root);
    if (!control) throw new Error(`Missing hospitality control: ${name}`);
    const bounds = control.getBounds();
    return { x: bounds.centerX, y: bounds.centerY };
  }, name);
  const point = await uiCanvasPoint(page, center);
  await page.mouse.click(point.x, point.y);
}

/** Wait until Phaser has rendered the station panel and installed its interactive controls. */
export async function hospitalityPanelVisible(page: Page, visible: boolean): Promise<void> {
  await page.waitForFunction(visible => {
    const panel = window.__GAME__!.scene.getScene('UIScene').children.getByName('tavern-panel') as unknown as { visible: boolean };
    return panel.visible === visible;
  }, visible);
}

/** Approach fixture furniture; M manages the register while E opens the kitchen. */
export async function openHospitalityStation(page: Page, station: 'ledger' | 'kitchen'): Promise<void> {
  await teleport(page, station === 'ledger' ? 5 : 6, station === 'ledger' ? 11 : 6, 'up');
  await page.keyboard.press(station === 'ledger' ? 'm' : 'e');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe(station);
  await hospitalityPanelVisible(page, true);
}

/** Release the modal through its normal keyboard path before waiting for customer movement. */
export async function closeHospitalityStation(page: Page): Promise<void> {
  await page.keyboard.press('e');
  await expect.poll(async () => (await getState(page)).tavernPanel).toBe(null);
  await hospitalityPanelVisible(page, false);
}

/** Place a compact fixture before entering; every business action remains native input. */
export async function enterFurnishedShop(page: Page, seating = false): Promise<void> {
  await page.evaluate(async seating => {
    // @ts-expect-error Vite serves the actual game module for fixture setup.
    const { GameState } = await import('/src/state/GameState.ts');
    const gs = GameState.instance;
    gs.placedItems = [
      { item: 'register', scene: 'TavernScene', tx: 5, ty: 10, rotation: 0 },
      { item: 'stove', scene: 'TavernScene', tx: 6, ty: 5, rotation: 0 },
      { item: 'bar', scene: 'TavernScene', tx: 14, ty: 6, rotation: 0 },
    ];
    if (seating) gs.placedItems.push(
      { item: 'table', scene: 'TavernScene', tx: 9, ty: 10, rotation: 0 },
      { item: 'chair', scene: 'TavernScene', tx: 9, ty: 11, rotation: 2 },
    );
    gs.addItem('wood', 40); gs.addItem('stone', 10);
  }, seating);
  await teleportAtFarmShop(page, 0, 1, 'up');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__GAME__!.scene.isActive('TavernScene') && window.__TEST__!.ready);
    await expect.poll(async () => (await getState(page)).transitionActive).toBe(false);
  } finally { await page.keyboard.up('w'); }
  await openHospitalityStation(page, 'ledger');
  await clickHospitalityControl(page, 'tavern-action-restore');
  await expect.poll(async () => (await getState(page)).tavern.level).toBe(1);
  await closeHospitalityStation(page);
}
