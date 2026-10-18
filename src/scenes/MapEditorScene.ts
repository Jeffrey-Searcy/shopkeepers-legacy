/** Development-only farm/town layout desk. It renders detached layouts without owning an adventure save. */
import Phaser from 'phaser';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { NODE_DEF } from '../config/Items';
import { renderWangTerrain } from '../world/TerrainRenderer';
import { ShopFront } from '../world/ShopFront';
import { displayPixelRatio, installCrispText } from '../ui/TextRendering';
import { MapEditorPanel, type MapEditorTool } from '../ui/MapEditorPanel';
import { mapEditorMap, mapEditorMode, mapEditorUrl } from '../debug/MapEditorMode';
import { LayoutWorkshop, type WorkshopDraft, type WorkshopEntity, type WorkshopMap } from '../debug/LayoutWorkshop';
import { renderTownWorkshop } from '../world/TownWorkshop';

type Entity = WorkshopEntity;
/** One pointer gesture owns its uncommitted preview; releasing outside the map cancels it. */
type Gesture =
  | { kind: 'move'; entity: Entity; start: { tx: number; ty: number }; target: { tx: number; ty: number }; candidate: WorkshopDraft | null; error: string }
  | { kind: 'paint'; cells: Map<string, { tx: number; ty: number }>; last: { tx: number; ty: number }; ground: 'grass' | 'dirt' }
  | { kind: 'pan'; x: number; y: number; scrollX: number; scrollY: number };
/** Read-only browser evidence. No editor mutation bypasses the same controls used by the user. */
declare global {
  interface Window {
    __MAP_EDITOR__?: {
      state(): { ready: boolean; map: WorkshopMap; draft: WorkshopDraft | null; tool: MapEditorTool; dirty: boolean; undo: number; redo: number };
      point(tx: number, ty: number): { x: number; y: number };
    };
  }
}

/** Own the disposable layout view, gesture history and native UI for one editor page. */
export class MapEditorScene extends Phaser.Scene {
  private panel!: MapEditorPanel;
  private workshop!: LayoutWorkshop;
  private draft: WorkshopDraft | null = null;
  private savedText = '';
  private past: WorkshopDraft[] = [];
  private future: WorkshopDraft[] = [];
  private tool: MapEditorTool = 'move';
  private gesture: Gesture | null = null;
  private selectedId: string | null = null;
  private images = new Map<string, Phaser.GameObjects.Image>();
  private plotLabels: Phaser.GameObjects.Text[] = [];
  private entities: Entity[] = [];
  private outline!: Phaser.GameObjects.Graphics;
  private ghost: Phaser.GameObjects.Image | null = null;
  private space = false;
  private zoomLevel = 2;
  private density = 1;

  /** Register a non-world scene; ordinary world warps cannot target this editor. */
  constructor() { super(SceneKey.MapEditor); }

  /** Build an isolated authoring surface after the shared asset loader has finished. */
  create(): void {
    if (mapEditorMode() !== 'edit') throw new Error('MapEditorScene: development editor mode is required');
    this.workshop = new LayoutWorkshop(mapEditorMap());
    installCrispText(this);
    this.panel = new MapEditorPanel({
      map: map => this.run(() => this.switchMap(map)),
      tool: tool => { this.cancelGesture(); this.tool = tool; this.panel.tool(tool); this.panel.message(this.toolHint()); },
      undo: () => this.run(() => this.undo()), redo: () => this.run(() => this.redo()),
      zoom: direction => this.zoom(direction), frame: () => this.frameFarm(), shop: () => this.focusShop(),
      save: () => this.run(() => this.save()), preview: () => this.run(() => this.preview()),
      export: () => this.run(() => this.export()), import: file => { void this.import(file); },
      reset: () => this.run(() => this.reset()),
    }, this.workshop.map);
    this.cameras.main.setBackgroundColor('#293c31').setBounds(0, 0, this.workshop.base.w * TILE, this.workshop.base.h * TILE);
    this.resize();
    this.run(() => {
      this.draft = this.workshop.read(); this.savedText = JSON.stringify(this.draft);
      this.renderLayout();
      if (this.workshop.map === 'town') this.frameFarm(); else this.focusShop();
    });
    this.input.on('pointerdown', this.pointerDown, this);
    this.input.on('pointermove', this.pointerMove, this);
    this.input.on('pointerup', this.pointerUp, this);
    this.input.on('pointerupoutside', this.cancelGesture, this);
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.inside(pointer)) this.zoom(dy < 0 ? 1 : -1);
    });
    this.game.canvas.addEventListener('contextmenu', this.preventMenu);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    window.addEventListener('beforeunload', this.beforeUnload);
    this.scale.on('resize', this.resize, this);
    window.__MAP_EDITOR__ = {
      state: () => ({ ready: this.draft !== null, map: this.workshop.map, draft: structuredClone(this.draft), tool: this.tool,
        dirty: this.dirty(), undo: this.past.length, redo: this.future.length }),
      point: (tx, ty) => this.screenPoint((tx + 0.5) * TILE, (ty + 0.5) * TILE),
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.resize, this);
      window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
      window.removeEventListener('blur', this.blur); window.removeEventListener('beforeunload', this.beforeUnload);
      this.game.canvas.removeEventListener('contextmenu', this.preventMenu);
      this.panel.destroy(); delete window.__MAP_EDITOR__;
    });
  }

  /** Report expected validation/storage failures without replacing the rejected draft or swallowing its reason. */
  private run(action: () => void): void {
    try { action(); }
    catch (error) { this.panel.message(error instanceof Error ? error.message : String(error), true); }
  }

  /** Require a loaded layout; corrupt stored drafts need explicit reset or import. */
  private current(): WorkshopDraft {
    if (!this.draft) throw new Error('Draft could not load. Import a layout or use Reset to original.');
    return this.draft;
  }

  /** Compare the current model to its last persisted version, including undo back to the saved state. */
  private dirty(): boolean { return this.draft !== null && JSON.stringify(this.draft) !== this.savedText; }

  /** Render the same terrain and native object sizes as FarmScene, with no physics, harvest or clock. */
  private renderLayout(): void {
    const draft = this.current(), map = this.workshop.compile(draft);
    // Destroy old layers, not only references: editing paths must never accumulate 100×100 tilemaps.
    for (const child of [...this.children.list]) {
      if (child instanceof Phaser.Tilemaps.TilemapLayer) child.tilemap.destroy();
      else if (child.scene) child.destroy();
    }
    this.images.clear(); this.plotLabels = []; this.ghost = null;
    if (!renderWangTerrain(this, map)) throw new Error('MapEditor: required terrain art is not loaded');
    if ('shop' in draft) new ShopFront(this, { tx: draft.shop.tx - 68, ty: draft.shop.ty - 5 });
    else {
      renderTownWorkshop(this, map);
      if (!map.townPlan) throw new Error('Town editor requires future connection metadata.');
      for (const site of map.townPlan.futureSites) {
        const x = site.tx * TILE, y = site.ty * TILE, w = site.w * TILE, h = site.h * TILE;
        const outline = this.add.graphics().lineStyle(1, 0x93becb, 0.95).setDepth(900_000)
          .setName(`layout-future-${site.id}`);
        // These locked reservation marks have no picking record, collider or travel destination.
        for (let offset = 0; offset < w; offset += 12) {
          outline.lineBetween(x + offset, y, x + Math.min(offset + 7, w), y)
            .lineBetween(x + offset, y + h, x + Math.min(offset + 7, w), y + h);
        }
        for (let offset = 0; offset < h; offset += 12) {
          outline.lineBetween(x, y + offset, x, y + Math.min(offset + 7, h))
            .lineBetween(x + w, y + offset, x + w, y + Math.min(offset + 7, h));
        }
        this.plotLabels.push(this.add.text(x + 2, y + 2, 'Future connection', {
          fontFamily: 'Trebuchet MS', fontSize: '10px', resolution: this.density, color: '#e8f4f6', backgroundColor: '#385967',
          padding: { x: 2, y: 1 },
        }).setDepth(900_001).setName(`layout-future-label-${site.id}`));
      }
    }
    this.entities = this.workshop.entities(draft);
    for (const entity of this.entities) {
      if (entity.group === 'shop') continue;
      if (entity.group === 'plot') {
        const rect = entity.footprint;
        this.add.graphics().lineStyle(1, 0xe5c880, 0.8).strokeRect(rect.x, rect.y, rect.w, rect.h)
          .setDepth(900_000).setName(`layout-${entity.id}`);
        this.plotLabels.push(this.add.text(rect.x + 2, rect.y + 2, entity.id, {
          fontFamily: 'Trebuchet MS', fontSize: '10px', resolution: this.density, color: '#fff9e9', backgroundColor: '#315345', padding: { x: 2, y: 1 },
        }).setDepth(900_001).setName(`layout-label-${entity.id}`));
        continue;
      }
      let texture = entity.kind, width: number | undefined, height: number | undefined;
      if (entity.group === 'object') {
        if (entity.kind === 'bin') { texture = 'shipping-bin'; width = 40; height = 26; }
        else {
          const definition = NODE_DEF[entity.kind === 'tree' ? 'tree:full' : entity.kind];
          if (!definition) throw new Error(`MapEditor: unsupported object ${entity.kind}`);
          texture = definition.tex; width = definition.dw; height = definition.dh;
        }
      }
      if (!this.textures.exists(texture)) throw new Error(`MapEditor: missing ${texture} art`);
      const image = this.add.image((entity.tx + 0.5) * TILE, (entity.ty + 1) * TILE, texture)
        .setOrigin(0.5, 1).setDepth((entity.ty + 1) * TILE).setName(`layout-${entity.id}`);
      if (width !== undefined && height !== undefined) image.setDisplaySize(width, height);
      this.images.set(entity.id, image);
    }
    this.outline = this.add.graphics().setDepth(1_000_000);
    this.refreshHistory(); this.drawSelection(); this.sizePlotLabels();
  }

  /** Keep editor-only plot IDs readable at whole-map zoom without enlarging world art. */
  private sizePlotLabels(): void {
    // Counter camera zoom with object scale. Raster resolution stays at device density instead of
    // repeatedly changing Canvas texture resolution, which Phaser stores separately from text style.
    for (const label of this.plotLabels) label.setScale(1 / this.zoomLevel);
  }

  /** Let Phaser center maps smaller than the editor viewport while retaining bounded panning at close zoom. */
  private sizeCameraBounds(): void {
    const camera = this.cameras.main, w = this.workshop.base.w * TILE, h = this.workshop.base.h * TILE;
    const paddingX = Math.max(0, camera.displayWidth - w) / 2, paddingY = Math.max(0, camera.displayHeight - h) / 2;
    camera.setBounds(-paddingX, -paddingY, w + paddingX * 2, h + paddingY * 2);
  }

  /** Reserve panel space in physical pixels so controls never cover editable map tiles. */
  private resize(): void {
    this.cancelGesture(); // A gesture's pointer coordinates belong to the previous camera viewport.
    const viewport = this.panel.viewport(); this.density = displayPixelRatio();
    this.cameras.main.setViewport(viewport.x * this.density, viewport.y * this.density,
      Math.max(1, viewport.width) * this.density, Math.max(1, viewport.height) * this.density);
    this.cameras.main.setZoom(this.zoomLevel * this.density).setRoundPixels(true);
    this.sizeCameraBounds();
    this.sizePlotLabels();
  }

  /** Convert a world position to a browser pointer position, using the active camera transform. */
  private screenPoint(x: number, y: number): { x: number; y: number } {
    const camera = this.cameras.main, topLeft = camera.getWorldPoint(camera.x, camera.y);
    return { x: (camera.x + (x - topLeft.x) * camera.zoom) / this.density,
      y: (camera.y + (y - topLeft.y) * camera.zoom) / this.density };
  }

  /** Reject pointer events outside the unobscured camera viewport. */
  private inside(pointer: Phaser.Input.Pointer): boolean {
    const camera = this.cameras.main;
    return pointer.x >= camera.x && pointer.y >= camera.y && pointer.x < camera.x + camera.width && pointer.y < camera.y + camera.height;
  }

  /** Read the tile under the pointer using Phaser's camera conversion, including zoom and pan. */
  private tile(pointer: Phaser.Input.Pointer): { tx: number; ty: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { tx: Math.floor(world.x / TILE), ty: Math.floor(world.y / TILE) };
  }

  /** Select the foremost visible object; alpha-aware art picking avoids grabbing empty tree-canvas corners. */
  private hit(pointer: Phaser.Input.Pointer): Entity | null {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    for (const entity of [...this.entities].sort((a, b) => b.ty - a.ty)) {
      if (entity.group === 'shop') {
        if (world.x >= entity.tx * TILE && world.x < (entity.tx + 10) * TILE &&
          world.y >= entity.ty * TILE && world.y < (entity.ty + 10) * TILE) return entity;
      } else if (entity.group === 'plot') {
        const rect = entity.footprint;
        if (world.x >= rect.x && world.x < rect.x + rect.w && world.y >= rect.y && world.y < rect.y + rect.h) return entity;
      } else {
        const image = this.images.get(entity.id);
        if (!image) throw new Error(`MapEditor: missing rendered entity ${entity.id}`);
        const bounds = image.getBounds();
        if (!bounds.contains(world.x, world.y)) continue;
        const x = Math.floor((world.x - bounds.x) / image.scaleX), y = Math.floor((world.y - bounds.y) / image.scaleY);
        const alpha = this.textures.getPixelAlpha(x, y, image.texture.key, image.frame.name);
        if (alpha !== null && alpha > 0) return entity;
      }
    }
    return null;
  }

  /** Begin exactly one drag, brush stroke or camera gesture; no layout changes occur on pointer-down. */
  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.draft || !this.inside(pointer)) return;
    this.cancelGesture();
    if (this.space || pointer.middleButtonDown() || pointer.rightButtonDown() || this.tool === 'pan') {
      const camera = this.cameras.main;
      this.gesture = { kind: 'pan', x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY };
      return;
    }
    const tile = this.tile(pointer);
    if (this.tool === 'path' || this.tool === 'grass') {
      this.gesture = { kind: 'paint', cells: new Map(), last: tile, ground: this.tool === 'path' ? 'dirt' : 'grass' };
      this.extendStroke(tile); return;
    }
    const entity = this.hit(pointer); this.selectedId = entity ? entity.id : null;
    if (entity) {
      this.gesture = { kind: 'move', entity, start: tile, target: { tx: entity.tx, ty: entity.ty }, candidate: this.draft, error: '' };
      const image = this.images.get(entity.id);
      if (image) this.ghost = this.add.image(image.x, image.y, image.texture.key, image.frame.name)
        .setOrigin(image.originX, image.originY).setDisplaySize(image.displayWidth, image.displayHeight)
        .setAlpha(0.7).setDepth(999_999);
      else if (entity.group === 'shop') this.ghost = this.add.image(entity.tx * TILE, entity.ty * TILE + 2, TextureKey.ShopFacade)
        .setOrigin(0, 0).setAlpha(0.7).setDepth(999_999);
      this.panel.select(`${entity.kind === 'bin' ? 'Shipping bin' : entity.kind} · ${entity.tx}, ${entity.ty}`);
    } else this.panel.select('Choose an object');
    this.drawSelection();
  }

  /** Track tile changes during drag; invalid targets stay only as a red uncommitted preview. */
  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.gesture) return;
    const gesture = this.gesture;
    if (gesture.kind === 'pan') {
      const camera = this.cameras.main;
      camera.setScroll(gesture.scrollX - (pointer.x - gesture.x) / camera.zoom,
        gesture.scrollY - (pointer.y - gesture.y) / camera.zoom); return;
    }
    const tile = this.tile(pointer);
    if (gesture.kind === 'paint') { this.extendStroke(tile); return; }
    const target = { tx: gesture.entity.tx + tile.tx - gesture.start.tx, ty: gesture.entity.ty + tile.ty - gesture.start.ty };
    if (target.tx === gesture.target.tx && target.ty === gesture.target.ty) return;
    gesture.target = target;
    try { gesture.candidate = this.workshop.move(this.current(), gesture.entity.id, target.tx, target.ty); gesture.error = ''; }
    catch (error) { gesture.candidate = null; gesture.error = error instanceof Error ? error.message : String(error); }
    if (this.ghost) this.ghost.setPosition(
      (target.tx + (gesture.entity.group === 'shop' ? 0 : 0.5)) * TILE,
      gesture.entity.group === 'shop' ? target.ty * TILE + 2 : (target.ty + 1) * TILE)
      .setTint(gesture.candidate ? 0xffffff : 0xff8888);
    this.panel.select(`${gesture.entity.kind} · ${target.tx}, ${target.ty}`);
    this.panel.message(gesture.error || 'Release to place · Esc to cancel', gesture.candidate === null);
    this.drawSelection();
  }

  /** Fill fast brush motion with contiguous grid cells; one whole stroke is validated at release. */
  private extendStroke(tile: { tx: number; ty: number }): void {
    if (!this.gesture || this.gesture.kind !== 'paint') return;
    const gesture = this.gesture, dx = tile.tx - gesture.last.tx, dy = tile.ty - gesture.last.ty;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let step = 0; step <= steps; step++) {
      const cell = { tx: Math.round(gesture.last.tx + dx * step / steps), ty: Math.round(gesture.last.ty + dy * step / steps) };
      // Limit one gesture to the map; invalid outside endpoints reject at pointer-up rather than growing unbounded history.
      if (cell.tx >= 0 && cell.ty >= 0 && cell.tx < this.workshop.base.w && cell.ty < this.workshop.base.h) gesture.cells.set(`${cell.tx},${cell.ty}`, cell);
    }
    gesture.last = tile; this.drawSelection();
  }

  /** Atomically commit an accepted gesture, or preserve both layout and undo history on rejection. */
  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (!this.inside(pointer)) { this.cancelGesture(); return; }
    this.run(() => {
      if (gesture.kind === 'move') {
        if (!gesture.candidate) throw new Error(gesture.error);
        this.commit(gesture.candidate, 'Object moved.');
      } else if (gesture.kind === 'paint') {
        this.commit(this.workshop.paint(this.current(), [...gesture.cells.values()], gesture.ground), 'Path stroke applied.');
      }
    });
    this.cancelGesture();
  }

  /** Dispose the pointer-only preview; cancellation never touches authored or saved data. */
  private cancelGesture = (): void => {
    this.gesture = null;
    if (this.ghost) { this.ghost.destroy(); this.ghost = null; }
    if (this.outline && this.outline.scene) this.drawSelection();
  };

  /** Draw a tile grid only around the current gesture, leaving the rest of the map unobstructed. */
  private drawSelection(): void {
    this.outline.clear();
    const gesture = this.gesture;
    if (gesture && gesture.kind === 'paint') {
      this.outline.fillStyle(gesture.ground === 'dirt' ? 0xc59449 : 0x82a66b, 0.55).lineStyle(1, 0xfff9e9, 0.5);
      for (const tile of gesture.cells.values()) this.outline.fillRect(tile.tx * TILE, tile.ty * TILE, TILE, TILE)
        .strokeRect(tile.tx * TILE, tile.ty * TILE, TILE, TILE);
      return;
    }
    const entity = this.entities.find(value => value.id === this.selectedId);
    if (!entity) return;
    const moving = gesture && gesture.kind === 'move' ? gesture : null;
    const dx = moving ? (moving.target.tx - entity.tx) * TILE : 0, dy = moving ? (moving.target.ty - entity.ty) * TILE : 0;
    const rect = entity.footprint, color = moving && !moving.candidate ? 0xe76f60 : 0xf1ce77;
    this.outline.lineStyle(1, color, 1).fillStyle(color, 0.16)
      .fillRect(rect.x + dx, rect.y + dy, rect.w, rect.h).strokeRect(rect.x + dx, rect.y + dy, rect.w, rect.h);
    if (moving && entity.group === 'shop') {
      // The entire facade stays visible as a ghost, while validation outlines include its protected approach.
      this.outline.lineStyle(1, color, 0.8).strokeRect(moving.target.tx * TILE, moving.target.ty * TILE + 2, 160, 160);
    }
  }

  /** Commit one validated model snapshot; retained history is bounded to the latest 100 actions. */
  private commit(next: WorkshopDraft, message: string): void {
    this.cancelGesture();
    if (JSON.stringify(next) === JSON.stringify(this.draft)) return;
    if (this.draft) { this.past.push(this.draft); if (this.past.length > 100) this.past.shift(); }
    this.future = []; this.draft = next; this.renderLayout(); this.panel.message(message);
  }

  /** Undo one drag or complete brush stroke, never gameplay events. */
  private undo(): void {
    this.cancelGesture(); const prior = this.past.pop();
    if (!prior) return;
    this.future.push(this.current()); this.draft = prior; this.renderLayout(); this.panel.message('Undone.');
  }

  /** Restore one undone action without generating an extra history entry. */
  private redo(): void {
    this.cancelGesture(); const next = this.future.pop();
    if (!next) return;
    this.past.push(this.current()); this.draft = next; this.renderLayout(); this.panel.message('Redone.');
  }

  /** Synchronize visible history and changed-state controls. */
  private refreshHistory(): void { this.panel.history(this.past.length > 0, this.future.length > 0, this.dirty()); }

  /** Zoom around the camera center; camera bounds and Phaser transforms remain authoritative. */
  private zoom(direction: number): void {
    this.cancelGesture(); const camera = this.cameras.main;
    const center = camera.getWorldPoint(camera.x + camera.width / 2, camera.y + camera.height / 2);
    this.zoomLevel = Phaser.Math.Clamp(this.zoomLevel * (direction > 0 ? 1.25 : 0.8), 0.25, 4);
    camera.setZoom(this.zoomLevel * this.density); this.sizeCameraBounds(); camera.centerOn(center.x, center.y);
    this.sizePlotLabels();
  }

  /** Fit the selected map's actual dimensions inside the unobscured editor viewport. */
  private frameFarm(): void {
    this.cancelGesture(); const camera = this.cameras.main;
    const { w, h } = this.workshop.base;
    const inset = 12 * this.density;
    this.zoomLevel = Math.min(Math.max(1, camera.width - inset * 2) / (w * TILE),
      Math.max(1, camera.height - inset * 2) / (h * TILE)) / this.density;
    camera.setZoom(this.zoomLevel * this.density); this.sizeCameraBounds(); camera.centerOn(w * TILE / 2, h * TILE / 2);
    this.sizePlotLabels();
  }

  /** Focus the current farm shop or the town's authored central arrival. */
  private focusShop(): void {
    if (!this.draft) return;
    this.cancelGesture(); this.zoomLevel = 2;
    const focus = 'shop' in this.draft ? { tx: this.draft.shop.tx + 5, ty: this.draft.shop.ty + 7 }
      : this.workshop.base.spawns.find(spawn => spawn.id === 'start');
    if (!focus) throw new Error('Town workshop has no named central arrival.');
    this.cameras.main.setZoom(this.zoomLevel * this.density); this.sizeCameraBounds();
    this.cameras.main.centerOn(focus.tx * TILE, focus.ty * TILE);
    this.sizePlotLabels();
  }

  /** Save only the editor-owned versioned key after strict validation. */
  private save(): void {
    this.workshop.save(this.current()); this.savedText = JSON.stringify(this.current());
    this.refreshHistory(); this.panel.message('Draft saved in this browser. Export a copy to share the layout.');
  }

  /** Freeze a validated preview snapshot and open a fresh page with no normal save access. */
  private preview(): void {
    this.workshop.preview(this.current());
    window.open(mapEditorUrl('preview', this.workshop.map), '_blank', 'noopener');
    this.panel.previewLink(mapEditorUrl('preview', this.workshop.map));
  }

  /** Download exact validated layout data as JSON; no screenshot interpretation is needed. */
  private export(): void {
    const text = this.workshop.serialize(this.current());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `shopkeepers-${this.workshop.map}-layout.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    this.panel.message('Layout exported. Send that file to me when you like the design.');
  }

  /** Strictly import one bounded JSON file; rejected data leaves the current draft and storage intact. */
  private async import(file: File): Promise<void> {
    if (file.size > this.workshop.maxBytes) { this.panel.message('Layout file exceeds the 1 MB limit.', true); return; }
    try {
      const next = this.workshop.parse(await file.text());
      this.commit(next, 'Layout imported. Save draft to keep it in this browser.'); this.focusShop();
    } catch (error) { this.panel.message(error instanceof Error ? error.message : String(error), true); }
  }

  /** Reset requires an explicit confirmation and remains undoable when an earlier valid layout exists. */
  private reset(): void {
    if (!window.confirm(`Reset this editor draft to the original ${this.workshop.map}? Your adventure saves will not change.`)) return;
    this.commit(this.workshop.create(), 'Original layout restored.'); this.save(); this.focusShop();
  }

  /**
   * Leave for another map's editor only after the user accepts discarding unsaved edits; saved keys stay separate.
   * The Town choice opens the route editor, because the Town layout workshop is retired (the Town is one painting).
   * @param map the map button the user pressed
   */
  private switchMap(map: WorkshopMap): void {
    if (map === this.workshop.map) return;
    if (this.dirty() && !window.confirm('Discard unsaved layout changes and switch maps? Saved drafts and adventure saves stay unchanged.')) return;
    // The explicit dialog already owns this decision; do not ask a second browser leave-page question.
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.location.assign(map === 'town' ? mapEditorUrl('routes') : mapEditorUrl('edit', map));
  }

  /** Keep concise control instructions outside the map art. */
  private toolHint(): string {
    return this.tool === 'move' ? 'Drag an object · Grid snapping is on' : this.tool === 'pan' ? 'Drag to pan · Wheel to zoom' :
      'Drag to paint · One stroke = one undo · Ponds, cliffs and exits stay fixed';
  }

  /** Route editor shortcuts only when a text field or native button is not taking the key. */
  private keyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); this.space = true; }
    if (event.code === 'Escape') { this.cancelGesture(); this.panel.message('Gesture cancelled.'); }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault(); this.run(() => event.shiftKey ? this.redo() : this.undo());
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); this.run(() => this.save()); }
  };

  /** Release the temporary pan modifier. */
  private keyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') this.space = false; };
  /** Losing focus cancels incomplete edits rather than leaving a stuck drag behind. */
  private blur = (): void => { this.space = false; this.cancelGesture(); };
  /** Warn before discarding unsaved layout changes; never intercept normal game pages. */
  private beforeUnload = (event: BeforeUnloadEvent): void => { if (this.dirty()) { event.preventDefault(); event.returnValue = ''; } };
  /** Right-drag pans the editor instead of opening the browser menu over the canvas. */
  private preventMenu = (event: Event): void => { event.preventDefault(); };
}
