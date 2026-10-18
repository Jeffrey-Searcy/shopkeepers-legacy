/**
 * TavernUI presents the current chapter, nearby station prompts, and ledger/kitchen menus in
 * UIScene. The chapter strip walks the first-day task chain (restore the shop → meet three
 * neighbors → first sale), derived each frame from tavern level, resident talks and revenue. It reads GameState and delegates all transactions to TavernSystem. No business state
 * or inventory counts live here; menu selection and feedback are presentation-only.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { TAVERN_RECIPES, TAVERN_ROOM_COUNT, TAVERN_ROOM_PRICE } from '../config/Tavern';
import { ItemPlacementSystem } from '../systems/ItemPlacementSystem';
import { GameState } from '../state/GameState';
import { TavernSystem, type TavernResult } from '../systems/TavernSystem';
import { InventorySystem } from '../systems/InventorySystem';
import { ITEM_CATALOG } from '../config/Items';
import { MAILBOX_TILE } from '../config/Letters';
import { getMapData } from '../world/MapDef';
import { InputBus } from '../input/InputBus';
import { facingTile } from '../systems/InteractionSystem';
import { Sfx } from '../systems/SfxSystem';
import { createScreenShade } from './UILayout';
import { COZY_THEME, cozyPanel } from './CozyTheme';

/** Neighbors the keeper must talk to before the first-sale step opens. */
export const TASK_NEIGHBORS = 3;

/** One first-day task as the strip shows it: collapsed label, expanded title, expanded body. */
interface TaskStep { short: string; title: string; body: string }

/** Count residents the keeper has talked to at least once (a talk records lastTalkDay). */
export function neighborsMet(): number {
  return Object.values(GameState.instance.relationships.residents).filter(state => state.lastTalkDay !== null).length;
}

/** A selectable intent; its action revalidates price, location and state at activation time. */
interface TavernOption { id: string; label: string; detail: string; action: () => TavernResult }

/** UIScene-owned presentation with keyboard and mouse parity and a shared GameState modal flag. */
export class TavernUI {
  private readonly chapter: Phaser.GameObjects.Container;
  private readonly chapterTitle: Phaser.GameObjects.Text;
  private readonly chapterBody: Phaser.GameObjects.Text;
  /** Optional task details expand only on request; the play area's center stays unobstructed. */
  private chapterExpanded = false;
  private readonly chapterBackground: Phaser.GameObjects.Rectangle;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly root: Phaser.GameObjects.Container;
  private readonly title: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly balance: Phaser.GameObjects.Text;
  private readonly feedback: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Container;
  private options: TavernOption[] = [];
  private selection = 0;
  private signature = '';
  private previousPanel: GameState['tavernPanel'] = null;
  /** A preparation quantity, not a stock count; every action rechecks the actual ingredients. */
  private batch: 1 | 5 | 'max' = 1;
  private readonly batches: Phaser.GameObjects.Container;
  private readonly seenKeys = new WeakSet<KeyboardEvent>();

  /** Construct fixed UI objects and remove the keyboard listener when the owning scene stops. */
  constructor(private readonly scene: Phaser.Scene) {
    const textStyle = { fontFamily: 'monospace', color: '#e9dab5', fontSize: '11px' };
    this.chapterTitle = scene.add.text(8, 7, '', { ...textStyle, fontSize: '10px', color: '#e9bc72', fontStyle: 'bold' });
    this.chapterBody = scene.add.text(8, 29, '', { ...textStyle, fontSize: '10px', wordWrap: { width: 208 }, lineSpacing: 3 });
    this.chapterBackground = scene.add.rectangle(0, 0, 226, 25, 0x302a24, 0.88)
      .setOrigin(0).setStrokeStyle(1, 0x8c7449).setInteractive({ useHandCursor: true });
    this.chapterBackground.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!GameState.instance.transitionActive) this.chapterExpanded = !this.chapterExpanded;
    });
    // why: y is set every frame by update(chapterTop); 88 is only the first frame's spot.
    this.chapter = scene.add.container(12, 88, [
      this.chapterBackground, this.chapterTitle, this.chapterBody,
    ]).setDepth(8).setName('tavern-objective');
    this.hint = scene.add.text(480, 466, '', {
      ...textStyle, fontSize: '10px', backgroundColor: '#302a24', padding: { x: 8, y: 4 }, align: 'center',
    }).setOrigin(0.5).setDepth(9).setName('tavern-hint');
    this.hint.setInteractive({ useHandCursor: true });
    this.hint.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (TavernSystem.canInteract('ledger')) InputBus.instance.emit('manage-shop');
    });
    const shade = createScreenShade(scene, 0x18251f, 0.7).setInteractive();
    shade.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => event.stopPropagation());
    this.root = scene.add.container(0, 0, [shade]).setDepth(100).setVisible(false).setName('tavern-panel');
    this.root.add(cozyPanel(scene, 480, 275, 720, 466, COZY_THEME.shadow));
    this.root.add(cozyPanel(scene, 480, 270, 712, 458));
    this.root.add(cozyPanel(scene, 267, 285, 218, 282, COZY_THEME.pocket, 16));
    this.title = scene.add.text(162, 67, '', { fontFamily: COZY_THEME.titleFont, fontSize: '28px', color: COZY_THEME.ink });
    this.note = scene.add.text(174, 161, '', {
      fontFamily: COZY_THEME.font, fontSize: '15px', color: COZY_THEME.ink, wordWrap: { width: 187 }, lineSpacing: 7,
    });
    this.balance = scene.add.text(162, 112, '', { fontFamily: COZY_THEME.font, color: COZY_THEME.muted, fontSize: '13px' });
    this.feedback = scene.add.text(162, 438, '', {
      fontFamily: COZY_THEME.font, color: COZY_THEME.ink, fontSize: '13px', wordWrap: { width: 627 }, lineSpacing: 3,
    }).setName('tavern-menu-feedback');
    this.rows = scene.add.container(400, 158);
    this.batches = scene.add.container(547, 111).setVisible(false);
    this.root.add(this.batches);
    this.root.add([this.title, this.note, this.balance, this.feedback, this.rows]);
    this.root.add(scene.add.text(162, 476, '↑ ↓ choose · Enter confirm · ← → batch size · E / Esc close', {
      fontFamily: COZY_THEME.font, color: COZY_THEME.muted, fontSize: '12px',
    }));
    const close = scene.add.text(783, 64, '×', { fontSize: '27px', color: COZY_THEME.muted })
      .setInteractive({ useHandCursor: true }).setName('tavern-menu-close');
    close.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.close();
    });
    this.root.add(close);
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('TavernUI: keyboard input is required');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /** Close the active station panel and drop held input so a menu click cannot swing a tool. */
  private close(): void {
    GameState.instance.tavernPanel = null;
    InputBus.instance.clearAll();
    Sfx.play('select');
  }

  /** Handle each native event once; the world owns E/Escape closing to avoid reopening the panel. */
  private onKey(event: KeyboardEvent): void {
    const gs = GameState.instance;
    if (event.code === 'KeyJ' && !event.repeat && !gs.paused && !gs.transitionActive &&
      !gs.inventoryOpen && !gs.tavernPanel && !gs.chestOpen && !gs.craftingOpen && !gs.binOpen &&
      !gs.dialogue && !gs.daySummary && !this.seenKeys.has(event)) {
      this.seenKeys.add(event);
      this.chapterExpanded = !this.chapterExpanded;
      return;
    }
    if (!GameState.instance.tavernPanel || GameState.instance.paused || this.seenKeys.has(event)) return;
    this.seenKeys.add(event);
    this.refreshPanel();
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
      event.preventDefault();
      this.selection = (this.selection + (event.code === 'ArrowDown' ? 1 : -1) + this.options.length) % this.options.length;
      this.drawRows();
    } else if (event.code === 'Enter' && !event.repeat) {
      event.preventDefault(); this.activate(this.selection);
    } else if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && gs.tavernPanel === 'kitchen') {
      event.preventDefault();
      const values = [1, 5, 'max'] as const;
      this.batch = values[(values.indexOf(this.batch) + (event.code === 'ArrowRight' ? 1 : 2)) % 3];
      this.signature = '';
      this.refreshPanel();
    }
  }

  /** Delegate one selected transaction and keep the result visible until another action or close. */
  private activate(index: number): void {
    const option = this.options[index];
    if (!option) throw new Error(`TavernUI: missing menu option ${index}`);
    const result = option.action();
    this.feedback.setText(result.message).setColor(result.ok ? '#30594a' : '#9b442f');
    Sfx.play(result.ok ? 'stash' : 'deny');
    this.signature = '';
    this.refreshPanel();
  }

  /** Rebuild menu intent only when the durable values or station change. */
  private refreshPanel(): void {
    const gs = GameState.instance;
    const panel = gs.tavernPanel;
    if (panel === null) return;
    if (panel !== this.previousPanel) {
      this.previousPanel = panel;
      this.feedback.setText('');
      this.selection = 0;
    }
    const signature = JSON.stringify([panel, gs.tavern, gs.gold, gs.inventory, this.batch]);
    if (this.signature === signature) return;
    this.signature = signature;
    const t = gs.tavern;
    this.balance.setText(`${gs.gold} gold  ·  ${InventorySystem.count('stew')} stew  ·  ${InventorySystem.count('ale')} ale in your bag`);
    this.batches.setVisible(panel === 'kitchen');
    if (panel === 'ledger') {
      this.title.setText('Your shop');
      const incoming = t.guests.filter(guest => guest.kind === 'inn' && guest.phase !== 'leaving');
      const waiting = incoming.filter(guest => guest.phase === 'waiting' && guest.product === null &&
        !t.reservations.some(reservation => reservation.guestId === guest.id));
      this.note.setText(t.level === 0 ? 'Make it yours\n\nRestore your shop, then welcome travelers for a meal or a room.\n\nCraft and place your own furniture.' :
        `Guest rooms\n${t.reservations.length} / ${TAVERN_ROOM_COUNT} occupied\n${TAVERN_ROOM_PRICE} gold · one night\n\n${waiting.length ? 'A traveler is waiting to check in.' : 'Guests pay here, then head upstairs.'}\n\n${t.servedToday} orders served today`);
      this.options = gs.tavern.level === 0 ? [{
        id: 'restore',
        label: 'Restore the tavern',
        detail: `20 wood (${InventorySystem.count('wood')}) · 10 stone (${InventorySystem.count('stone')})`,
        action: () => TavernSystem.repair(),
      }] : [{
        id: t.tavernOpen ? 'close-tavern' : 'open-tavern',
        label: t.tavernOpen ? 'Tavern · taking orders' : 'Tavern · closed',
        detail: t.tavernOpen ? 'Close service and send waiting diners home' : TavernSystem.canOpen('tavern').message,
        action: () => t.tavernOpen ? TavernSystem.close() : TavernSystem.open(),
      }, {
        id: t.innOpen ? 'close-inn' : 'open-inn',
        label: t.innOpen ? 'Inn · accepting guests' : 'Inn · closed',
        detail: t.innOpen ? 'Close new bookings; paid guests keep their rooms' : TavernSystem.canOpen('inn').message,
        action: () => t.innOpen ? TavernSystem.closeInn() : TavernSystem.openInn(),
      }, {
        id: 'upgrade',
        label: gs.tavern.level === 2 ? 'Expanded tavern service' : 'Expand tavern service',
        detail: gs.tavern.level === 2 ? 'Up to five guests at once, with enough seating'
          : `60 gold + 10 wood · ${Math.min(3, gs.tavern.totalServed)}/3 guests served`,
        action: () => TavernSystem.upgrade(),
      }];
    } else {
      this.title.setText('The kitchen');
      const known = Object.keys(TAVERN_RECIPES).filter(id => TavernSystem.recipeKnown(id));
      const locked = Object.keys(TAVERN_RECIPES).length - known.length;
      this.note.setText(`From your kitchen\n\nStew · 12 gold\nAle · 8 gold\n\nMeals go into your bag. Equip one to serve.\n\n${locked > 0 ? `${locked} more recipe${locked === 1 ? '' : 's'} to learn. Neighbors share them by letter.` : 'Your recipe book is full.'}`);
      this.options = known.map(id => {
        const recipe = TAVERN_RECIPES[id];
        return {
          id: `cook-${id}`,
          label: `${recipe.label} ×${recipe.portions}`,
          // "have/need" per ingredient, e.g. "Potato 2/1 · Trout 0/1".
          detail: Object.entries(recipe.ingredients).map(([item, need]) => `${ITEM_CATALOG[item].label} ${InventorySystem.count(item)}/${need}`).join(' · '),
          action: () => TavernSystem.cook(id, this.batch),
        };
      });
      this.options.push({ id: 'brew', label: 'Brew house ale', detail: '8 gold of malt + 1 wood → 4 ales per batch', action: () => TavernSystem.brew(this.batch) });
      this.drawBatches();
    }
    this.selection = Math.min(this.selection, this.options.length - 1);
    this.drawRows();
  }

  /**
   * Draw named, comfortably sized menu rows with clear keyboard selection and pointer feedback.
   * Up to five options use one full-width column; more (the kitchen's recipe book) flow into two
   * half-width columns of five, so nine options still end above the feedback line.
   */
  private drawRows(): void {
    this.rows.removeAll(true);
    const twoColumns = this.options.length > 5;
    if (this.options.length > 10) throw new Error('TavernUI: more than ten menu options do not fit');
    const width = twoColumns ? 196 : 400;
    this.options.forEach((option, index) => {
      const x = twoColumns && index >= 5 ? 204 : 0;
      const y = (twoColumns ? index % 5 : index) * 53;
      const selected = index === this.selection;
      const background = cozyPanel(this.scene, x + width / 2, y + 24, width, 48, selected ? COZY_THEME.green : COZY_THEME.pocket, 10)
        .setInteractive({ useHandCursor: true }).setName(`tavern-action-${option.id}`).setData('optionIndex', index);
      background.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation(); this.selection = index; this.activate(index);
      });
      const label = this.scene.add.text(x + 10, y + 5, option.label, {
        fontFamily: COZY_THEME.font, fontSize: twoColumns ? '14px' : '15px', color: selected ? '#fff9e9' : COZY_THEME.ink,
      });
      const detail = this.scene.add.text(x + 10, y + 24, option.detail, {
        fontFamily: COZY_THEME.font, fontSize: '11px', color: selected ? '#e3eadc' : COZY_THEME.muted,
        wordWrap: { width: width - 23 },
      });
      this.rows.add([background, label, detail]);
    });
  }

  /** Render finite batch choices with the same pointer and keyboard intent as recipe actions. */
  private drawBatches(): void {
    this.batches.removeAll(true);
    ([1, 5, 'max'] as const).forEach((value, index) => {
      const selected = value === this.batch;
      const button = cozyPanel(this.scene, index * 83 + 37, 9, 76, 28,
        selected ? COZY_THEME.green : COZY_THEME.pocket, 9).setInteractive({ useHandCursor: true })
        .setName(`tavern-batch-${value}`);
      button.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation(); this.batch = value; this.signature = ''; this.refreshPanel();
      });
      const label = this.scene.add.text(index * 83 + 37, 9, value === 'max' ? 'Max' : `${value} batch${value === 1 ? '' : 'es'}`,
        { fontFamily: COZY_THEME.font, fontSize: '12px', color: selected ? '#fff9e9' : COZY_THEME.ink }).setOrigin(0.5);
      this.batches.add([button, label]);
    });
  }

  /**
   * Derive the current first-day task from durable progress (nothing about the chain is stored).
   * The steps run in order: furnish → restore the shop → meet three neighbors → make a first sale →
   * run the shop. The first unfinished step is shown, so each step opens the next.
   * @returns short label for the collapsed strip, the expanded title, and the expanded body
   */
  private objective(): TaskStep {
    const gs = GameState.instance;
    const t = gs.tavern;
    if (!gs.placedItems.some(item => item.scene === SceneKey.Tavern && item.item === 'register')) {
      return { short: 'Furnish the shop', title: 'MAKE THIS PLACE YOURS',
        body: 'Craft a workbench from your bag. Place it, then craft a register, stove and bar for your shop.' };
    }
    if (t.level === 0) return { short: 'Restore the shop', title: 'A PLACE WORTH COMING HOME TO',
      body: `Use your register to restore the shop.\nWood ${InventorySystem.count('wood')}/20 · Stone ${InventorySystem.count('stone')}/10` };
    const met = neighborsMet();
    if (met < TASK_NEIGHBORS) return { short: `Meet neighbors ${met}/${TASK_NEIGHBORS}`, title: 'NEW IN TOWN',
      body: `Walk east into town and say hello.\nPress E beside a neighbor, then choose Talk.\nNeighbors met: ${met}/${TASK_NEIGHBORS}` };
    if (t.revenue === 0) return { short: 'Make your first sale', title: 'OPEN FOR BUSINESS',
      body: 'Cook stew at the stove or brew ale.\nOpen the tavern at the register.\nEquip the order a guest asks for and serve it.' };
    return { short: 'Run your shop', title: 'MAKE YOURSELF AT HOME',
      body: `Inn ${t.innOpen ? 'open' : 'closed'} · ${t.reservations.length}/${TAVERN_ROOM_COUNT} rooms occupied\nTavern ${t.tavernOpen ? 'open' : 'closed'} · ${InventorySystem.count('stew')} stew · ${InventorySystem.count('ale')} ale\n[E] Check in · [M] Manage shop\nEquip the requested meal or drink to serve.` };
  }

  /**
   * Refresh the fixed overlay and the single nearby prompt from current GameState each frame.
   * @param chapterTop y (UI pixels) for the task strip; UIScene stacks it below the mana row when shown
   */
  update(chapterTop: number): void {
    const gs = GameState.instance;
    const step = this.objective();
    // why: the "meet neighbors" step happens in town, so the strip follows the keeper there only
    // for that step; town otherwise keeps its own uncluttered HUD.
    const inChapter = gs.activeScene === SceneKey.Farm || gs.activeScene === SceneKey.Tavern ||
      (gs.activeScene === SceneKey.Town && step.title === 'NEW IN TOWN');
    const blocked = gs.transitionActive || gs.paused || gs.inventoryOpen || gs.chestOpen || gs.craftingOpen || gs.binOpen || gs.daySummary !== null || gs.dialogue !== null;
    // During service the compact task strip can cover real guest dialogue. J still deliberately opens it;
    // the shared bottom-gutter hint keeps that shortcut discoverable without occupying the guest area.
    const servingGuests = gs.activeScene === SceneKey.Tavern && gs.tavern.guests.length > 0;
    this.chapter.setY(chapterTop);
    this.chapter.setVisible(inChapter && !blocked && gs.tavernPanel === null && (!servingGuests || this.chapterExpanded));
    this.chapterTitle.setText(this.chapterExpanded ? 'TASK  [J] close' : `TASK  [J] ${step.short}`);
    this.chapterBody.setText(step.body);
    this.chapterBody.setVisible(this.chapterExpanded);
    this.chapterBackground.setSize(226, this.chapterExpanded ? Math.max(66, this.chapterBody.height + 39) : 25);
    this.chapterTitle.setData('objectiveTitle', step.title);
    this.root.setVisible(gs.tavernPanel !== null && !gs.paused);
    if (gs.tavernPanel !== null) this.refreshPanel();
    else { this.previousPanel = null; this.signature = ''; }
    let prompt = '';
    const tile = facingTile();
    // why: read the door from the authored farm map. A hard-coded (72-73, 12) tile from the old
    // procedural farm meant this prompt never appeared on the current map.
    const shopDoor = gs.activeScene === SceneKey.Farm ? getMapData(SceneKey.Farm).warps.find(warp => warp.target === SceneKey.Tavern) : undefined;
    if (gs.activeScene === SceneKey.Farm && shopDoor === undefined) throw new Error('TavernUI: farm map has no shop door');
    if (shopDoor !== undefined && tile.tx >= shopDoor.tx && tile.tx < shopDoor.tx + shopDoor.w && tile.ty === shopDoor.ty) {
      prompt = 'Walk up through the door to enter your shop';
    } else if (gs.activeScene === SceneKey.Farm && tile.tx === MAILBOX_TILE.tx && tile.ty === MAILBOX_TILE.ty) {
      prompt = gs.mail.inbox.length > 0 ? `[E] Read mail (${gs.mail.inbox.length} new)` : '[E] Check mailbox';
    } else if (gs.activeScene === SceneKey.Tavern) {
      const item = ItemPlacementSystem.itemAt(SceneKey.Tavern, tile.tx, tile.ty);
      if (item?.item === 'register') prompt = '[E] Check in  ·  [M] Manage shop';
      else if (item?.item === 'stove') prompt = '[E] Cook';
      else if (item?.item === 'bar') prompt = '[E] Serve orders from behind the bar';
      else if (item?.item === 'table' || item?.item === 'chair') prompt = '[E] Serve a nearby table order';
    }
    this.hint.setText(prompt).setVisible(prompt.length > 0 && inChapter && !blocked && gs.tavernPanel === null);
  }
}
