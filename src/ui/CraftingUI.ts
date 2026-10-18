/** Recipe pockets and a live detail panel. CraftingSystem alone owns inventory transactions. */
import Phaser from 'phaser';
import { ITEM_CATALOG, PLACEABLE_ITEMS } from '../config/Items';
import { furnitureView } from '../config/Furniture';
import { GameState } from '../state/GameState';
import { CraftingSystem, RECIPES, type Recipe } from '../systems/CraftingSystem';
import { Sfx } from '../systems/SfxSystem';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { createScreenShade } from './UILayout';

/** A modal recipe book: selection is local; ingredients, capacity, and results stay authoritative. */
export class CraftingUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly detail: Phaser.GameObjects.Container;
  private readonly pockets: Phaser.GameObjects.Rectangle[] = [];
  private readonly note: Phaser.GameObjects.Text;
  private readonly confirm: Phaser.GameObjects.Rectangle;
  private readonly confirmLabel: Phaser.GameObjects.Text;
  private readonly recipes = RECIPES.filter(recipe => recipe.station === 'workbench');
  private readonly keys = new WeakSet<KeyboardEvent>();
  private selected = 0;
  private wasOpen = false;
  private signature = '';

  /** Build stable pointer targets and one keyboard listener, removed when this scene shuts down. */
  constructor(private readonly scene: Phaser.Scene) {
    if (this.recipes.length === 0 || this.recipes.length > 9) throw new Error('CraftingUI requires one to nine workbench recipes.');
    const shade = createScreenShade(scene, COZY_THEME.shadow, 0.58).setInteractive();
    shade.on('pointerdown', this.stopPointer);
    this.root = scene.add.container(0, 0, [shade]).setDepth(16).setVisible(false).setName('crafting-panel');
    const surface = cozyPanel(scene, 480, 270, 792, 420).setInteractive();
    surface.on('pointerdown', this.stopPointer);
    this.root.add(surface);
    this.root.add(scene.add.text(116, 85, 'At the workbench', {
      fontFamily: COZY_THEME.font, fontSize: '28px', fontStyle: 'bold', color: COZY_THEME.ink,
    }));
    this.root.add(scene.add.text(118, 123, 'Small things. Made by you.', {
      fontFamily: COZY_THEME.font, fontSize: '14px', color: COZY_THEME.muted,
    }));
    this.root.add(cozyPanel(scene, 642, 288, 410, 276, COZY_THEME.pocket, 20));
    this.recipes.forEach((recipe, index) => {
      const x = 163 + (index % 3) * 99;
      const y = 193 + Math.floor(index / 3) * 83;
      const pocket = cozyPanel(scene, x, y, 88, 74, COZY_THEME.pocket, 16)
        .setInteractive({ useHandCursor: true }).setName(`crafting-recipe-${recipe.id}`);
      pocket.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (this.isOpen()) this.choose(index);
      });
      this.pockets.push(pocket);
      this.root.add(pocket);
      this.root.add(this.icon(recipe, x, y - 5, 44));
      this.root.add(scene.add.text(x, y + 25, recipe.label.replace(' Counter', '').replace(' Stand', '').replace('Cooking ', ''), {
        fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.ink,
      }).setOrigin(0.5));
    });
    this.detail = scene.add.container(0, 0);
    this.root.add(this.detail);
    this.confirm = cozyPanel(scene, 642, 394, 348, 40, COZY_THEME.green, 14)
      .setInteractive({ useHandCursor: true }).setName('crafting-confirm');
    this.confirm.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.craft();
    });
    this.confirmLabel = scene.add.text(642, 394, '', {
      fontFamily: COZY_THEME.font, fontSize: '16px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    this.root.add([this.confirm, this.confirmLabel]);
    this.note = scene.add.text(480, 442, '', {
      fontFamily: COZY_THEME.font, fontSize: '14px', color: COZY_THEME.ink, align: 'center', wordWrap: { width: 704 },
    }).setOrigin(0.5).setName('crafting-note');
    this.root.add(this.note);
    this.root.add(scene.add.text(480, 469, 'Arrows choose  ·  Enter craft  ·  E / Esc close', {
      fontFamily: COZY_THEME.font, fontSize: '12px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    const close = scene.add.text(839, 96, '×', {
      fontFamily: COZY_THEME.font, fontSize: '28px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setName('crafting-close');
    close.on('pointerdown', (_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); if (this.isOpen()) GameState.instance.craftingOpen = false;
    });
    this.root.add(close);
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('CraftingUI requires keyboard input');
    keyboard.on('keydown', this.onKey, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => keyboard.off('keydown', this.onKey, this));
  }

  /** Consume the full modal surface so clicks cannot swing a tool behind the recipe book. */
  private stopPointer(_p: unknown, _x: number, _y: number, event: Phaser.Types.Input.EventData): void { event.stopPropagation(); }

  /** Read the active modal owner; transitions and pause screens prevent recipe input. */
  private isOpen(): boolean {
    const gs = GameState.instance;
    return gs.craftingOpen && !gs.paused && !gs.transitionActive;
  }

  /** Preserve native furniture proportions inside a fixed preview area. */
  private icon(recipe: Recipe, x: number, y: number, size: number): Phaser.GameObjects.Image {
    if (!PLACEABLE_ITEMS.has(recipe.yields)) {
      const meta = ITEM_CATALOG[recipe.yields];
      if (!meta) throw new Error(`CraftingUI: missing crafted item ${recipe.yields}`);
      const frame = this.scene.textures.getFrame(meta.icon);
      if (!frame) throw new Error(`CraftingUI: missing crafted icon ${meta.icon}`);
      const ratio = Math.min(size / frame.width, size / frame.height);
      return this.scene.add.image(x, y, meta.icon).setDisplaySize(frame.width * ratio, frame.height * ratio);
    }
    const view = furnitureView(recipe.yields, 0);
    const ratio = Math.min(size / view.displayW, size / view.displayH);
    return this.scene.add.image(x, y, view.texture, view.frame).setDisplaySize(view.displayW * ratio, view.displayH * ratio);
  }

  /** Select a recipe without spending ingredients; feedback belongs to the current selection. */
  private choose(index: number): void {
    this.selected = index; this.signature = ''; this.note.setText(''); Sfx.play('select'); this.refresh();
  }

  /** Navigate real recipes and accept one transaction per non-repeat Enter event. */
  private onKey(event: KeyboardEvent): void {
    if (!this.isOpen() || this.keys.has(event)) return;
    this.keys.add(event);
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (Object.prototype.hasOwnProperty.call(offsets, event.code)) {
      event.preventDefault(); this.choose((this.selected + offsets[event.code] + this.recipes.length) % this.recipes.length);
    } else if (event.code === 'Enter') {
      event.preventDefault(); if (!event.repeat) this.craft();
    }
  }

  /** Explain capacity separately from ingredients; commit only through the atomic crafting system. */
  private craft(): void {
    if (!this.isOpen()) return;
    const recipe = this.recipes[this.selected];
    const result = CraftingSystem.getCraftability(recipe.id);
    if (!result.ok) {
      this.note.setText(result.reason === 'capacity' ? 'Your pockets are full. Store an item before crafting.' : 'You need the missing materials shown above.');
      Sfx.play('deny'); return;
    }
    if (!CraftingSystem.craft(recipe.id)) throw new Error(`CraftingUI: checked recipe ${recipe.id} failed its atomic transaction.`);
    this.note.setText(`Made 1 ${recipe.label}. Find it in your pockets.`);
    Sfx.play('harvest'); this.refresh();
  }

  /** Rebuild detail text only when selection or inventory changes; cached labels remain crisp. */
  private refresh(): void {
    const recipe = this.recipes[this.selected];
    const gs = GameState.instance;
    const signature = JSON.stringify([this.selected, gs.inventory, gs.backpackSlots, gs.toolbeltSlots]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.detail.removeAll(true);
    this.pockets.forEach((pocket, index) => pocket.setFillStyle(index === this.selected ? COZY_THEME.mint : COZY_THEME.pocket)
      .setStrokeStyle(index === this.selected ? 3 : 1, index === this.selected ? COZY_THEME.green : COZY_THEME.border));
    const meta = ITEM_CATALOG[recipe.yields];
    if (!meta) throw new Error(`CraftingUI: missing item metadata for ${recipe.yields}`);
    const style = { fontFamily: COZY_THEME.font, color: COZY_THEME.ink };
    this.detail.add(this.icon(recipe, 489, 199, 48));
    this.detail.add(this.scene.add.text(527, 171, recipe.label, { ...style, fontSize: '20px', fontStyle: 'bold' }));
    const view = PLACEABLE_ITEMS.has(recipe.yields) ? furnitureView(recipe.yields, 0) : null;
    this.detail.add(this.scene.add.text(528, 199, view ? `${view.w} × ${view.h} tiles  ·  Makes 1` : `${meta.category}  ·  Makes 1`, { ...style, fontSize: '13px', color: COZY_THEME.muted }));
    this.detail.add(this.scene.add.text(465, 234, meta.description, { ...style, fontSize: '14px', wordWrap: { width: 351 } }));
    this.detail.add(this.scene.add.text(465, 281, 'MATERIALS', { ...style, fontSize: '12px', fontStyle: 'bold', color: COZY_THEME.muted }));
    Object.entries(recipe.cost).forEach(([item, needed], index) => {
      const ingredient = ITEM_CATALOG[item];
      if (!ingredient) throw new Error(`CraftingUI: missing ingredient metadata for ${item}`);
      const owned = Object.prototype.hasOwnProperty.call(gs.inventory, item) ? gs.inventory[item] : 0;
      this.detail.add(this.scene.add.image(477, 312 + index * 29, ingredient.icon).setDisplaySize(21, 21));
      this.detail.add(this.scene.add.text(497, 312 + index * 29, ingredient.label, { ...style, fontSize: '15px' }).setOrigin(0, 0.5));
      this.detail.add(this.scene.add.text(811, 312 + index * 29, `${owned} / ${needed}`, {
        ...style, fontSize: '15px', fontStyle: 'bold', color: owned >= needed ? COZY_THEME.ink : '#98513f',
      }).setOrigin(1, 0.5).setName(`crafting-ingredient-${item}`));
    });
    const availability = CraftingSystem.getCraftability(recipe.id);
    this.confirm.setFillStyle(availability.ok ? COZY_THEME.green : 0x7e8472);
    this.confirmLabel.setText(availability.ok ? 'Craft one  ·  Enter' : availability.reason === 'capacity' ? 'Pockets full' : 'Missing materials');
  }

  /** Match visibility to game state and refresh quantities after external inventory changes. */
  update(): void {
    const open = this.isOpen(); this.root.setVisible(open);
    if (!open) { this.wasOpen = false; return; }
    if (!this.wasOpen) {
      this.wasOpen = true; this.selected = 0; this.signature = ''; this.note.setText('Choose a recipe to see what you need.');
      cozyPop(this.scene, this.root);
    }
    this.refresh();
  }
}
