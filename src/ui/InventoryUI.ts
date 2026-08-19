/**
 * InventoryUI — the cohesive Toolbelt + Backpack presentation used by UIScene.
 *
 * The visual direction is the "Picnic Satchel": a warm canvas bag with teal stitching and
 * marigold selection charms, inspired by Coral Island's clear Toolbelt/Backpack hierarchy but
 * authored for ShopkeepersLegacy's pixel world. Gameplay state remains in GameState; this class
 * owns only transient selection and Phaser display objects. Shared grid helpers are exported so
 * chest and shipping panels use the same overflow-safe 24-slot renderer instead of silently
 * hiding stack nine and beyond.
 */
import Phaser from 'phaser';
import { GameState } from '../state/GameState';
import {
  ITEM_CATALOG,
  ITEM_ORDER,
  PLACEABLE_ITEMS,
  TOOL_LABEL,
  type ToolId,
} from '../config/Items';
import { cropForSeed } from '../config/Crops';
import { ToolSystem } from '../systems/ToolSystem';
import { CraftingSystem } from '../systems/CraftingSystem';
import {
  BACKPACK_CAPACITY,
  InventoryLayoutSystem,
  TOOLBELT_CAPACITY,
  itemFromEntry,
  toolFromEntry,
  type PlayerSlotEntry,
  type PlayerSlotRef,
} from '../systems/InventoryLayoutSystem';
import { Sfx } from '../systems/SfxSystem';

/** Picnic Satchel palette shared by inventory-like panels. */
export const INVENTORY_THEME = {
  canvas: 0xf3e7c9,
  canvasShadow: 0xcdb58f,
  cocoa: 0x5a3f2a,
  espresso: '#2f241d',
  teal: 0x4f8c87,
  tealDark: 0x315f5c,
  marigold: 0xe7b94c,
  coral: 0xd97a5e,
  slot: 0x6a5650,
  slotInset: 0xefe0bf,
  sage: 0x92a88a,
  cream: '#fff8df',
} as const;

/** One rendered inventory slot and its transient item mapping. */
export interface InventoryGridSlot {
  bg: Phaser.GameObjects.Rectangle;
  inset: Phaser.GameObjects.Rectangle;
  marker: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Image;
  fallback: Phaser.GameObjects.Text;
  countChip: Phaser.GameObjects.Rectangle;
  count: Phaser.GameObjects.Text;
  item: string | null;
}

/** Options for an overflow-safe fixed-capacity inventory grid. */
export interface InventoryGridOptions {
  columns: number;
  rows: number;
  slotSize: number;
  gap: number;
  onClick: ((item: string) => void) | null;
}

/** The 19 catalog ids first, followed by explicit unknown positive-count ids in sorted order. */
function orderedInventoryEntries(store: Record<string, number>): string[] {
  const cataloged = ITEM_ORDER.filter((item) => (store[item] ?? 0) > 0);
  const unknown = Object.keys(store)
    .filter((item) => (store[item] ?? 0) > 0 && !ITEM_CATALOG[item])
    .sort();
  return [...cataloged, ...unknown];
}

/**
 * Create a grid of interactive item medallions inside `parent`.
 *
 * @param scene owning Phaser scene
 * @param parent container receiving every display object
 * @param offX grid left in container coordinates
 * @param offY grid top in container coordinates
 * @param options dimensions and optional click behavior
 * @returns stable slot objects refreshed by `refreshInventoryGrid`
 */
export function createInventoryGrid(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  offX: number,
  offY: number,
  options: InventoryGridOptions
): InventoryGridSlot[] {
  const slots: InventoryGridSlot[] = [];
  const { columns, rows, slotSize, gap, onClick } = options;
  for (let i = 0; i < columns * rows; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x = offX + column * (slotSize + gap);
    const y = offY + row * (slotSize + gap);
    const bg = scene.add
      .rectangle(x, y, slotSize, slotSize, INVENTORY_THEME.slot, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const inset = scene.add
      .rectangle(x + 3, y + 3, slotSize - 6, slotSize - 6, INVENTORY_THEME.slotInset, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, INVENTORY_THEME.sage, 0.7);
    const marker = scene.add
      .rectangle(x + slotSize / 2, y - 3, 16, 5, INVENTORY_THEME.marigold, 1)
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    const icon = scene.add
      .image(x + slotSize / 2, y + slotSize / 2, '__DEFAULT')
      .setDisplaySize(slotSize - 14, slotSize - 14)
      .setVisible(false);
    const fallback = scene.add
      .text(x + slotSize / 2, y + slotSize / 2, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.max(8, Math.floor(slotSize / 5))}px`,
        color: INVENTORY_THEME.espresso,
        align: 'center',
        wordWrap: { width: slotSize - 8 },
      })
      .setOrigin(0.5, 0.5);
    const countChip = scene.add
      .rectangle(x + slotSize - 2, y + slotSize - 2, 21, 15, INVENTORY_THEME.tealDark, 1)
      .setOrigin(1, 1)
      .setStrokeStyle(1, INVENTORY_THEME.canvas)
      .setVisible(false);
    const count = scene.add
      .text(x + slotSize - 5, y + slotSize - 4, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: INVENTORY_THEME.cream,
      })
      .setOrigin(1, 1)
      .setVisible(false);
    const slot: InventoryGridSlot = { bg, inset, marker, icon, fallback, countChip, count, item: null };
    if (onClick) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(
        'pointerdown',
        (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          if (slot.item) onClick(slot.item);
        }
      );
      bg.on('pointerover', () => {
        if (slot.item) inset.setFillStyle(0xfff3d4, 1);
      });
      bg.on('pointerout', () => inset.setFillStyle(INVENTORY_THEME.slotInset, 1));
    }
    parent.add([bg, inset, marker, icon, fallback, countChip, count]);
    slots.push(slot);
  }
  return slots;
}

/**
 * Refresh a grid from an item-count map without dropping positive-count ids.
 * Unknown ids remain visibly inspectable as text; exceeding the declared capacity throws loudly.
 */
export function refreshInventoryGrid(
  scene: Phaser.Scene,
  slots: InventoryGridSlot[],
  store: Record<string, number>,
  selectedItem: string | null = null
): void {
  const entries = orderedInventoryEntries(store);
  if (entries.length > slots.length) {
    throw new Error(`Inventory grid overflow: ${entries.length} stacks exceed ${slots.length} visible slots`);
  }
  slots.forEach((slot, index) => {
    const item = entries[index] ?? null;
    const selected = item !== null && item === selectedItem;
    slot.item = item;
    slot.marker.setVisible(selected);
    slot.bg.setStrokeStyle(selected ? 3 : 2, selected ? INVENTORY_THEME.marigold : INVENTORY_THEME.cocoa);
    slot.inset.setScale(selected ? 1.04 : 1);
    if (!item) {
      slot.icon.setVisible(false);
      slot.fallback.setText('');
      slot.countChip.setVisible(false);
      slot.count.setVisible(false).setText('');
      return;
    }
    const meta = ITEM_CATALOG[item];
    if (meta) {
      if (!scene.textures.exists(meta.icon)) {
        throw new Error(`InventoryUI: item "${item}" requires missing texture key "${meta.icon}"`);
      }
      slot.icon.setTexture(meta.icon).setDisplaySize(slot.bg.width - 14, slot.bg.height - 14).setVisible(true);
      slot.fallback.setText('');
    } else {
      // Explicit visible handling for future content added before its catalog metadata.
      slot.icon.setVisible(false);
      slot.fallback.setText(item.split('-').join('\n'));
    }
    slot.countChip.setVisible(true);
    slot.count.setVisible(true).setText(String(store[item]));
  });
}

/** Visual state for one authoritative player slot in the live bar or inventory modal. */
interface PlayerSlotVisual {
  /** Thick outer marigold plate reserved exclusively for the equipped toolbelt slot. */
  activeRing: Phaser.GameObjects.Rectangle;
  bg: Phaser.GameObjects.Rectangle;
  inset: Phaser.GameObjects.Rectangle;
  marker: Phaser.GameObjects.Triangle;
  icon: Phaser.GameObjects.Image;
  fallback: Phaser.GameObjects.Text;
  number: Phaser.GameObjects.Text;
  countChip: Phaser.GameObjects.Rectangle;
  count: Phaser.GameObjects.Text;
  ref: PlayerSlotRef;
  entry: PlayerSlotEntry;
}

/**
 * Builds and updates the live hotbar plus the full Picnic Satchel inventory modal.
 * All gameplay mutations call existing systems/state fields; selectedItem is intentionally local.
 */
export class InventoryUI {
  private readonly scene: Phaser.Scene;
  private hotbar!: Phaser.GameObjects.Container;
  private hotbarSlots: PlayerSlotVisual[] = [];
  private dimmer!: Phaser.GameObjects.Rectangle;
  private panel!: Phaser.GameObjects.Container;
  private toolbeltSlots: PlayerSlotVisual[] = [];
  private backpackSlots: PlayerSlotVisual[] = [];
  private selectedItem: string | null = null;
  /** Tool inspection is separate from item-stack inspection because tools have no inventory count. */
  private selectedTool: ToolId | null = null;
  private detailIcon!: Phaser.GameObjects.Image;
  private detailName!: Phaser.GameObjects.Text;
  private detailCategory!: Phaser.GameObjects.Text;
  private detailCount!: Phaser.GameObjects.Text;
  private detailDescription!: Phaser.GameObjects.Text;
  private actionButton!: Phaser.GameObjects.Rectangle;
  private actionLabel!: Phaser.GameObjects.Text;
  private passiveHint!: Phaser.GameObjects.Text;
  private craftButton!: Phaser.GameObjects.Rectangle;
  private craftLabel!: Phaser.GameObjects.Text;
  /** Floating copy follows the pointer; authoritative slot art never moves during a gesture. */
  private dragGhost: Phaser.GameObjects.Container | null = null;

  /** @param scene UIScene that owns the display objects and game event bridge. */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Build the always-on hotbar and hidden inventory modal. */
  create(): void {
    // A short press/release remains inspect-only; Phaser promotes to drag only past this threshold.
    this.scene.input.dragDistanceThreshold = 7;
    this.scene.input.dragTimeThreshold = 80;
    this.buildHotbar();
    this.buildSatchel();
  }

  /** Create the compact always-visible tool hotbar at the bottom center. */
  private buildHotbar(): void {
    const slotSize = 42;
    const gap = 6;
    const totalW = TOOLBELT_CAPACITY * slotSize + (TOOLBELT_CAPACITY - 1) * gap;
    const startX = (this.scene.scale.width - totalW) / 2;
    const y = this.scene.scale.height - 51;
    const shadow = this.scene.add.rectangle(-10, -8, totalW + 20, 58, INVENTORY_THEME.cocoa, 0.88).setOrigin(0, 0);
    const canvas = this.scene.add
      .rectangle(-6, -12, totalW + 12, 54, INVENTORY_THEME.canvas, 0.97)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.tealDark);
    this.hotbar = this.scene.add.container(startX, y, [shadow, canvas]).setDepth(9);
    for (let index = 0; index < TOOLBELT_CAPACITY; index++) {
      this.hotbarSlots.push(
        this.createPlayerSlot(
          this.hotbar,
          index * (slotSize + gap),
          -6,
          slotSize,
          { container: 'toolbelt', index },
          false
        )
      );
    }
  }

  /** Create the dimmed full inventory with Toolbelt, Backpack, details, and crafting action. */
  private buildSatchel(): void {
    const panelW = 760;
    const panelH = 402;
    const x = (this.scene.scale.width - panelW) / 2;
    const y = (this.scene.scale.height - panelH) / 2;
    this.dimmer = this.scene.add
      .rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0x18211f, 0.62)
      .setOrigin(0, 0)
      .setInteractive()
      .setVisible(false)
      .setDepth(9);
    this.dimmer.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        GameState.instance.inventoryOpen = false;
        Sfx.play('select');
      }
    );

    // The handle, rounded side gussets, and lower lip make the modal read as a physical satchel
    // rather than a generic rectangle while preserving the fixed click geometry inside it.
    const handleShadow = this.scene.add
      .rectangle(111, -12, panelW - 222, 34, 0x2b2119, 0.7)
      .setOrigin(0, 0)
      .setStrokeStyle(5, INVENTORY_THEME.cocoa);
    const handle = this.scene.add
      .rectangle(116, -9, panelW - 232, 27, INVENTORY_THEME.canvasShadow, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, INVENTORY_THEME.cocoa);
    const leftGusset = this.scene.add
      .ellipse(4, 222, 36, 252, INVENTORY_THEME.canvasShadow, 1)
      .setStrokeStyle(3, INVENTORY_THEME.cocoa);
    const rightGusset = this.scene.add
      .ellipse(panelW - 4, 222, 36, 252, INVENTORY_THEME.canvasShadow, 1)
      .setStrokeStyle(3, INVENTORY_THEME.cocoa);
    const shadow = this.scene.add.rectangle(7, 8, panelW, panelH, 0x2b2119, 0.75).setOrigin(0, 0);
    const shell = this.scene.add
      .rectangle(0, 0, panelW, panelH, INVENTORY_THEME.canvas, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(4, INVENTORY_THEME.cocoa);
    const topFlap = this.scene.add
      .rectangle(12, 42, panelW - 24, 73, INVENTORY_THEME.teal, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, INVENTORY_THEME.tealDark);
    const stitchTop = this.scene.add
      .rectangle(22, 51, panelW - 44, 2, INVENTORY_THEME.canvas, 0.85)
      .setOrigin(0, 0);
    const flapCap = this.scene.add
      .rectangle(15, 3, panelW - 30, 39, 0xe6d2aa, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.canvasShadow);
    const leftLeather = this.scene.add
      .rectangle(142, 35, 17, 79, 0x8a5e3b, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const rightLeather = this.scene.add
      .rectangle(699, 35, 17, 79, 0x8a5e3b, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const leftBuckle = this.scene.add
      .ellipse(150.5, 52, 25, 20, INVENTORY_THEME.marigold, 1)
      .setStrokeStyle(3, 0x8a6428);
    const rightBuckle = this.scene.add
      .ellipse(707.5, 52, 25, 20, INVENTORY_THEME.marigold, 1)
      .setStrokeStyle(3, 0x8a6428);
    const leftPocket = this.scene.add
      .rectangle(18, 137, 402, 206, INVENTORY_THEME.canvasShadow, 0.72)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const detailPocket = this.scene.add
      .rectangle(435, 137, 307, 206, 0xfff1cf, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.tealDark);
    const bottomLip = this.scene.add
      .rectangle(18, 355, panelW - 36, 32, 0xd8c19a, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const title = this.scene.add.text(24, 10, "Farmer's Satchel", {
      fontFamily: 'Trebuchet MS',
      fontStyle: 'bold',
      fontSize: '22px',
      color: INVENTORY_THEME.espresso,
    });
    const closeHint = this.scene.add
      .text(panelW - 22, 16, 'TAB / I  CLOSE', {
        fontFamily: 'monospace',
        fontStyle: 'bold',
        fontSize: '11px',
        color: '#5f554a',
      })
      .setOrigin(1, 0);
    const toolbeltTitle = this.scene.add.text(28, 57, 'TOOLBELT', {
      fontFamily: 'monospace',
      fontStyle: 'bold',
      fontSize: '12px',
      color: INVENTORY_THEME.cream,
    });
    const backpackTag = this.scene.add
      .rectangle(24, 116, 170, 20, INVENTORY_THEME.tealDark, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const detailTag = this.scene.add
      .rectangle(442, 116, 145, 20, INVENTORY_THEME.tealDark, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const backpackTitle = this.scene.add.text(34, 120, 'BACKPACK · 24 SLOTS', {
      fontFamily: 'monospace',
      fontStyle: 'bold',
      fontSize: '11px',
      color: INVENTORY_THEME.cream,
    });
    const detailTitle = this.scene.add.text(452, 120, 'SELECTED CHARM', {
      fontFamily: 'monospace',
      fontStyle: 'bold',
      fontSize: '11px',
      color: INVENTORY_THEME.cream,
    });
    this.panel = this.scene.add
      .container(x, y, [
        handleShadow,
        handle,
        leftGusset,
        rightGusset,
        shadow,
        shell,
        flapCap,
        topFlap,
        stitchTop,
        leftLeather,
        rightLeather,
        leftBuckle,
        rightBuckle,
        leftPocket,
        detailPocket,
        bottomLip,
        title,
        closeHint,
        toolbeltTitle,
        backpackTag,
        detailTag,
        backpackTitle,
        detailTitle,
      ])
      .setVisible(false)
      .setDepth(10);

    const toolSize = 42;
    const toolGap = 7;
    const toolStartX = 173;
    for (let index = 0; index < TOOLBELT_CAPACITY; index++) {
      this.toolbeltSlots.push(
        this.createPlayerSlot(
          this.panel,
          toolStartX + index * (toolSize + toolGap),
          61,
          toolSize,
          { container: 'toolbelt', index },
          true
        )
      );
    }
    for (let index = 0; index < BACKPACK_CAPACITY; index++) {
      const column = index % 8;
      const row = Math.floor(index / 8);
      this.backpackSlots.push(
        this.createPlayerSlot(
          this.panel,
          29 + column * 47,
          148 + row * 47,
          40,
          { container: 'backpack', index },
          true
        )
      );
    }
    this.buildDetailPocket();
    this.buildCraftButton();
    const footerPlate = this.scene.add
      .rectangle(panelW / 2, 371, 300, 22, 0xdce7d5, 1)
      .setStrokeStyle(2, INVENTORY_THEME.teal);
    const footer = this.scene.add.text(panelW / 2, 371, 'drag to move or swap  ·  click to inspect', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#6d5b49',
    }).setOrigin(0.5, 0.5);
    this.panel.add([footerPlate, footer]);
  }

  /** Build one player slot; modal slots are both drag sources and drop zones. */
  private createPlayerSlot(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    size: number,
    ref: PlayerSlotRef,
    draggable: boolean
  ): PlayerSlotVisual {
    const activeRing = this.scene.add
      .rectangle(x - 4, y - 4, size + 8, size + 8, INVENTORY_THEME.marigold, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, 0x2f241d)
      .setVisible(false)
      .setName(`active-${ref.container}-${ref.index}`);
    const bg = this.scene.add
      .rectangle(x, y, size, size, INVENTORY_THEME.slot, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa)
      .setInteractive({ useHandCursor: true });
    if (draggable && bg.input) bg.input.dropZone = true;
    const inset = this.scene.add
      .rectangle(x + 3, y + 3, size - 6, size - 6, INVENTORY_THEME.slotInset, 1)
      .setOrigin(0, 0);
    const marker = this.scene.add
      .triangle(x + size / 2, y - 5, -7, 0, 7, 0, 0, 7, INVENTORY_THEME.marigold, 1)
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    const icon = this.scene.add
      .image(x + size / 2, y + size / 2, '__DEFAULT')
      .setDisplaySize(size - 13, size - 13)
      .setVisible(false);
    const fallback = this.scene.add
      .text(x + size / 2, y + size / 2, '', {
        fontFamily: 'monospace',
        fontSize: `${Math.max(7, Math.floor(size / 6))}px`,
        color: INVENTORY_THEME.espresso,
        align: 'center',
        wordWrap: { width: size - 8 },
      })
      .setOrigin(0.5, 0.5);
    const number = this.scene.add.text(
      x + 4,
      y + 2,
      ref.container === 'toolbelt' ? String(ref.index + 1) : '',
      {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#574637',
      }
    );
    const countChip = this.scene.add
      .rectangle(x + size - 2, y + size - 2, 21, 15, INVENTORY_THEME.tealDark, 1)
      .setOrigin(1, 1)
      .setVisible(false);
    const count = this.scene.add
      .text(x + size - 5, y + size - 4, '', { fontFamily: 'monospace', fontSize: '10px', color: INVENTORY_THEME.cream })
      .setOrigin(1, 1)
      .setVisible(false);

    let draggedThisGesture = false;
    bg.on('pointerdown', () => {
      draggedThisGesture = false;
    });
    bg.on(
      'pointerup',
      (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (!draggedThisGesture) this.handleSlotClick(ref);
      }
    );
    bg.on('pointerover', () => inset.setFillStyle(0xfff3d4, 1));
    bg.on('pointerout', () => inset.setFillStyle(INVENTORY_THEME.slotInset, 1));

    const visual: PlayerSlotVisual = {
      activeRing,
      bg,
      inset,
      marker,
      icon,
      fallback,
      number,
      countChip,
      count,
      ref,
      entry: null,
    };
    if (draggable) {
      this.scene.input.setDraggable(bg);
      bg.on('dragstart', (pointer: Phaser.Input.Pointer) => {
        draggedThisGesture = true;
        if (!visual.entry) return;
        this.createDragGhost(visual.entry, pointer);
        visual.inset.setFillStyle(INVENTORY_THEME.marigold, 0.4);
      });
      bg.on('drag', (pointer: Phaser.Input.Pointer) => {
        this.dragGhost?.setPosition(pointer.x, pointer.y);
      });
      bg.on('drop', (_pointer: Phaser.Input.Pointer, dropZone: Phaser.GameObjects.Rectangle) => {
        const destination = dropZone.getData('player-slot-ref') as PlayerSlotRef | undefined;
        if (!destination) throw new Error('InventoryUI: drop zone is missing its player-slot-ref');
        const result = InventoryLayoutSystem.moveOrSwap(GameState.instance, ref, destination);
        Sfx.play(result === 'noop' ? 'deny' : 'select');
        if (result !== 'noop') this.scene.game.events.emit('toast', result === 'swapped' ? 'Slots swapped' : 'Item moved');
      });
      bg.on('dragend', () => {
        this.destroyDragGhost();
        visual.inset.setFillStyle(INVENTORY_THEME.slotInset, 1);
      });
      bg.setData('player-slot-ref', ref);
    }
    parent.add([activeRing, bg, inset, marker, icon, fallback, number, countChip, count]);
    return visual;
  }

  /** Click behavior remains inspect-first; toolbelt clicks also select their reordered index. */
  private handleSlotClick(ref: PlayerSlotRef): void {
    const entry = ref.container === 'toolbelt'
      ? GameState.instance.toolbeltSlots[ref.index]
      : GameState.instance.backpackSlots[ref.index];
    if (!entry) return;
    if (ref.container === 'toolbelt') ToolSystem.select(ref.index);
    const tool = toolFromEntry(entry);
    if (tool) {
      this.selectTool(tool);
      return;
    }
    const item = itemFromEntry(entry);
    if (item) this.selectItem(item);
    else Sfx.play('select');
  }

  /** Create a non-authoritative floating icon for drag feedback. */
  private createDragGhost(entry: string, pointer: Phaser.Input.Pointer): void {
    this.destroyDragGhost();
    const plate = this.scene.add
      .ellipse(0, 0, 48, 48, INVENTORY_THEME.canvas, 0.94)
      .setStrokeStyle(3, INVENTORY_THEME.marigold);
    const texture = this.textureForEntry(entry);
    const icon = this.scene.add.image(0, 0, texture).setDisplaySize(34, 34);
    this.dragGhost = this.scene.add.container(pointer.x, pointer.y, [plate, icon]).setDepth(30);
  }

  /** Destroy drag feedback after a valid drop or off-grid release (which is a state no-op). */
  private destroyDragGhost(): void {
    this.dragGhost?.destroy(true);
    this.dragGhost = null;
  }

  /** Resolve a logical icon key for a physical tool or item stack, failing loud if it is absent. */
  private textureForEntry(entry: string): string {
    const tool = toolFromEntry(entry);
    const texture = tool ? `icon-${tool}` : ITEM_CATALOG[entry]?.icon;
    if (!texture) throw new Error(`InventoryUI: entry "${entry}" has no icon metadata`);
    if (!this.scene.textures.exists(texture)) {
      throw new Error(`InventoryUI: entry "${entry}" requires missing texture key "${texture}"`);
    }
    return texture;
  }

  /** Create the selected-item charm and its explicit contextual action. */
  private buildDetailPocket(): void {
    const medallionShadow = this.scene.add
      .ellipse(493, 196, 94, 94, 0xc9b089, 1)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa);
    const medallion = this.scene.add
      .ellipse(487, 190, 94, 94, INVENTORY_THEME.canvasShadow, 1)
      .setStrokeStyle(3, INVENTORY_THEME.marigold);
    const nameRibbon = this.scene.add
      .rectangle(538, 149, 190, 48, 0xdce7d5, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.teal);
    const infoCard = this.scene.add
      .rectangle(448, 228, 281, 62, 0xf9edd6, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xc8a97e);
    this.detailIcon = this.scene.add.image(487, 190, '__DEFAULT').setDisplaySize(58, 58).setVisible(false);
    this.detailName = this.scene.add.text(548, 155, 'Nothing selected', {
      fontFamily: 'Trebuchet MS',
      fontStyle: 'bold',
      fontSize: '17px',
      color: INVENTORY_THEME.espresso,
      wordWrap: { width: 172 },
    });
    this.detailCategory = this.scene.add.text(548, 179, '', {
      fontFamily: 'monospace',
      fontStyle: 'bold',
      fontSize: '11px',
      color: '#39716d',
    });
    this.detailCount = this.scene.add.text(548, 199, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#735331',
    });
    this.detailDescription = this.scene.add.text(458, 239, 'Choose a backpack item to see what it is and what you can do with it.', {
      fontFamily: 'Trebuchet MS',
      fontSize: '14px',
      color: '#564537',
      lineSpacing: 2,
      wordWrap: { width: 260 },
    });
    this.actionButton = this.scene.add
      .rectangle(452, 300, 272, 36, INVENTORY_THEME.coral, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(3, 0x7f4330)
      .setInteractive({ useHandCursor: true })
      .setVisible(true);
    this.actionLabel = this.scene.add.text(588, 318, '', {
      fontFamily: 'Trebuchet MS',
      fontStyle: 'bold',
      fontSize: '14px',
      color: INVENTORY_THEME.cream,
    }).setOrigin(0.5, 0.5).setVisible(true);
    this.passiveHint = this.scene.add.text(588, 294, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#746858',
    }).setOrigin(0.5, 1).setVisible(false);
    this.actionButton.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.performSelectedAction();
      }
    );
    this.panel.add([
      medallionShadow,
      medallion,
      nameRibbon,
      infoCard,
      this.detailIcon,
      this.detailName,
      this.detailCategory,
      this.detailCount,
      this.detailDescription,
      this.actionButton,
      this.actionLabel,
      this.passiveHint,
    ]);
  }

  /** Build the bag-level workbench recipe action and show its affordability before clicking. */
  private buildCraftButton(): void {
    this.craftButton = this.scene.add
      .rectangle(29, 303, 374, 34, INVENTORY_THEME.coral, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(2, INVENTORY_THEME.cocoa)
      .setInteractive({ useHandCursor: true });
    this.craftLabel = this.scene.add.text(216, 320, '', {
      fontFamily: 'Trebuchet MS',
      fontStyle: 'bold',
      fontSize: '12px',
      color: INVENTORY_THEME.cream,
    }).setOrigin(0.5, 0.5);
    this.craftButton.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (CraftingSystem.craft('workbench')) {
          Sfx.play('harvest');
          this.scene.game.events.emit('toast', '+1 Workbench — select it, then choose Place');
        } else {
          Sfx.play('deny');
          this.scene.game.events.emit('toast', 'Need 15 wood');
        }
      }
    );
    this.panel.add([this.craftButton, this.craftLabel]);
  }

  /** Select an item for inspection without mutating gameplay state. */
  private selectItem(item: string): void {
    this.selectedItem = item;
    this.selectedTool = null;
    Sfx.play('select');
    this.refreshDetail(GameState.instance);
  }

  /** Show tool metadata in the same charm panel used for item stacks. */
  private selectTool(tool: ToolId): void {
    this.selectedTool = tool;
    this.selectedItem = null;
    Sfx.play('select');
    this.refreshDetail(GameState.instance);
  }

  /** Execute the explicit seed-equip or world-placement action for the selected item. */
  private performSelectedAction(): void {
    const item = this.selectedItem;
    if (!item || (GameState.instance.inventory[item] ?? 0) < 1) return;
    const crop = cropForSeed(item);
    if (crop) {
      const gs = GameState.instance;
      const source = InventoryLayoutSystem.findEntrySlot(gs, item);
      if (!source) throw new Error(`InventoryUI: seed stack "${item}" has no player slot`);
      if (source.container === 'toolbelt') {
        ToolSystem.select(source.index);
      } else {
        const existingSeedIndex = gs.toolbeltSlots.findIndex((entry) => {
          const beltItem = itemFromEntry(entry);
          return beltItem !== null && cropForSeed(beltItem) !== null;
        });
        const targetIndex = existingSeedIndex >= 0 ? existingSeedIndex : gs.hotbarIndex;
        InventoryLayoutSystem.moveOrSwap(gs, source, { container: 'toolbelt', index: targetIndex });
        ToolSystem.select(targetIndex);
      }
      gs.selectedSeed = item;
      this.scene.game.events.emit('toast', `${crop.label} seeds equipped (slot ${gs.hotbarIndex + 1})`);
      Sfx.play('select');
      return;
    }
    if (PLACEABLE_ITEMS.has(item)) {
      GameState.instance.placingItem = item;
      GameState.instance.inventoryOpen = false;
      this.scene.game.events.emit('toast', 'Pick a spot — Space/click places, E cancels');
      Sfx.play('select');
    }
  }

  /** Refresh the selected-item charm and action affordance from current counts. */
  private refreshDetail(gs: GameState): void {
    if (this.selectedTool) {
      const entry = `tool:${this.selectedTool}`;
      const located = gs.toolbeltSlots.includes(entry) || gs.backpackSlots.includes(entry);
      if (!located) this.selectedTool = null;
    }
    if (this.selectedTool) {
      const tool = this.selectedTool;
      const descriptions: Record<ToolId, string> = {
        hoe: 'Turns open grass into soft planting soil.',
        axe: 'Chops trees, stumps, and placed wooden furniture.',
        pickaxe: 'Breaks stone and restores empty tilled soil.',
        scythe: 'Sweeps weeds and wild growth aside.',
        'watering-can': 'Waters crops. Refill it at the pond.',
        seeds: 'Plants the selected seed stack.',
        rod: 'Cast into water, then keep the fish inside the reel bar.',
        sword: 'A dependable blade for mine creatures.',
      };
      const entry = `tool:${tool}`;
      this.detailIcon.setTexture(this.textureForEntry(entry)).setDisplaySize(52, 52).setAngle(tool === 'hoe' ? -45 : 0).setVisible(true);
      this.detailName.setText(TOOL_LABEL[tool]);
      this.detailCategory.setText('TOOL');
      this.detailCount.setText(gs.toolbeltSlots.includes(entry) ? 'In toolbelt' : 'In backpack');
      this.detailDescription.setText(descriptions[tool]);
      this.setAction(null, 'INSPECTED · TOOL INFO');
      return;
    }
    if (this.selectedItem && (gs.inventory[this.selectedItem] ?? 0) < 1) this.selectedItem = null;
    if (!this.selectedItem && !this.selectedTool) this.selectedItem = orderedInventoryEntries(gs.inventory)[0] ?? null;
    const item = this.selectedItem;
    if (!item) {
      this.detailIcon.setVisible(false);
      this.detailName.setText('Satchel is empty');
      this.detailCategory.setText('');
      this.detailCount.setText('');
      this.detailDescription.setText('There is plenty of room for the next harvest.');
      this.setAction(null);
      return;
    }
    const meta = ITEM_CATALOG[item];
    if (!meta) {
      this.detailIcon.setVisible(false);
      this.detailName.setText(item);
      this.detailCategory.setText('UNCATALOGED ITEM');
      this.detailCount.setText(`In satchel: ${gs.inventory[item]}`);
      this.detailDescription.setText('This item is visible, but it still needs display metadata before release.');
      this.setAction(null);
      return;
    }
    if (!this.scene.textures.exists(meta.icon)) {
      throw new Error(`InventoryUI: detail for "${item}" requires missing texture key "${meta.icon}"`);
    }
    this.detailIcon.setTexture(meta.icon).setDisplaySize(52, 52).setVisible(true);
    this.detailName.setText(meta.label);
    this.detailCategory.setText(meta.category.toUpperCase());
    this.detailCount.setText(`In satchel: ${gs.inventory[item]}`);
    this.detailDescription.setText(meta.description);
    const crop = cropForSeed(item);
    this.setAction(crop ? 'Equip Seeds' : PLACEABLE_ITEMS.has(item) ? 'Place in World' : null);
  }

  /** Toggle contextual action controls; passive items remain inspectable without a fake action. */
  private setAction(label: string | null, passiveLabel = 'INSPECT ONLY · NO ACTION'): void {
    const actionable = label !== null;
    const selectionExists = this.selectedItem !== null || this.selectedTool !== null;
    this.actionButton
      .setVisible(selectionExists)
      .setFillStyle(actionable ? INVENTORY_THEME.coral : 0xb7aa92, 1)
      .setStrokeStyle(3, actionable ? 0x7f4330 : 0x766a57);
    this.actionLabel
      .setVisible(selectionExists)
      .setText(actionable ? label : passiveLabel);
    if (actionable) this.actionButton.setInteractive({ useHandCursor: true });
    else this.actionButton.disableInteractive();
    this.passiveHint.setVisible(false);
  }

  /** Refresh authoritative player slots without compacting away deliberate empty positions. */
  private refreshPlayerSlots(
    slots: PlayerSlotVisual[],
    entries: readonly PlayerSlotEntry[],
    gs: GameState
  ): void {
    if (slots.length !== entries.length) {
      throw new Error(`InventoryUI: ${slots.length} visuals cannot render ${entries.length} entries`);
    }
    slots.forEach((slot, index) => {
      const entry = entries[index];
      slot.entry = entry;
      const active = slot.ref.container === 'toolbelt' && index === gs.hotbarIndex;
      const selectedItem = entry !== null && itemFromEntry(entry) === this.selectedItem;
      const selectedTool = entry !== null && toolFromEntry(entry) === this.selectedTool;
      const inspected = selectedItem || selectedTool;
      // Equipped and inspected are intentionally different signals: the equipped slot gets a
      // chunky marigold outer plate + pointer, while inspection gets a coral inner outline only.
      slot.activeRing.setVisible(active);
      slot.marker.setVisible(active);
      slot.bg.setStrokeStyle(
        inspected ? 4 : active ? 3 : 2,
        inspected ? INVENTORY_THEME.coral : active ? INVENTORY_THEME.tealDark : INVENTORY_THEME.cocoa
      );
      slot.inset.setFillStyle(active ? 0xffd978 : INVENTORY_THEME.slotInset, 1);
      slot.inset.setScale(inspected ? 1.02 : 1);
      slot.bg.setData('equipped', active).setData('inspected', inspected);

      if (!entry) {
        slot.icon.setVisible(false);
        slot.fallback.setText('');
        slot.countChip.setVisible(false);
        slot.count.setVisible(false).setText('');
        slot.bg.setName(`${slot.ref.container} ${index + 1}: empty`);
        return;
      }

      const tool = toolFromEntry(entry);
      const item = itemFromEntry(entry);
      if (tool || ITEM_CATALOG[entry]) {
        slot.icon
          .setTexture(this.textureForEntry(entry))
          .setDisplaySize(slot.bg.width - 13, slot.bg.height - 13)
          // A vertical spade silhouette cannot be mistaken for the diagonal axe beside it.
          .setAngle(tool === 'hoe' ? -45 : 0)
          .setVisible(true);
        slot.fallback.setText('');
      } else {
        slot.icon.setVisible(false);
        slot.fallback.setText(entry.split('-').join('\n'));
      }
      const count = item ? gs.inventory[item] : null;
      slot.countChip.setVisible(count !== null);
      slot.count.setVisible(count !== null).setText(count === null ? '' : String(count));
      const label = tool ? TOOL_LABEL[tool] : ITEM_CATALOG[entry]?.label ?? entry;
      slot.bg.setName(
        slot.ref.container === 'toolbelt' ? `${index + 1}: ${label}` : `Backpack ${index + 1}: ${label}`
      );
    });
  }

  /**
   * Synchronize visibility and values from GameState.
   *
   * @param gs authoritative game state
   * @param otherModalOpen true when chest/crafting/shipping owns the modal layer
   */
  update(gs: GameState, otherModalOpen: boolean): void {
    const inventoryVisible = gs.inventoryOpen && !otherModalOpen;
    this.dimmer.setVisible(inventoryVisible);
    this.panel.setVisible(inventoryVisible);
    this.hotbar.setVisible(!inventoryVisible && !otherModalOpen);
    InventoryLayoutSystem.assert(gs);
    this.refreshPlayerSlots(this.hotbarSlots, gs.toolbeltSlots, gs);
    this.refreshPlayerSlots(this.toolbeltSlots, gs.toolbeltSlots, gs);
    this.refreshPlayerSlots(this.backpackSlots, gs.backpackSlots, gs);
    if (inventoryVisible) {
      this.refreshDetail(gs);
      const affordable = (gs.inventory.wood ?? 0) >= 15;
      this.craftButton.setFillStyle(affordable ? INVENTORY_THEME.coral : 0x9a8d7c, 1);
      this.craftLabel.setText(affordable ? 'Craft Workbench · 15 wood' : `Workbench · need ${15 - (gs.inventory.wood ?? 0)} more wood`);
    }
  }
}
