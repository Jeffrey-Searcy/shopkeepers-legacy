/**
 * Development-only weekly NPC route workshop.
 * It renders the production Town as read-only art while all edits stay in one isolated draft key.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import type { ResidentId } from '../config/ResidentRelationships';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { mapEditorMode } from '../debug/MapEditorMode';
import { addNpcRouteStop, createNpcRouteDraft, insertNpcRouteWaypoint, isNpcRoutePointPassable, moveNpcRouteStop, moveNpcRouteWaypoint,
  npcRouteDay, npcRouteSegments, npcRouteStopInsertionIssue, NPC_ROUTE_DRAFT_MAX_BYTES, removeNpcRouteStop, removeNpcRouteWaypoint,
  parseNpcRouteDraft, sampleNpcRoute, serializeNpcRouteDraft, updateNpcRouteNote, updateNpcRouteStop, validateNpcRouteDraft,
  type NpcRouteDayDraft, type NpcRouteDraft, type NpcRouteSegment, type NpcRouteStopDraft } from '../debug/NpcRouteDraft';
import { readNpcRouteDraft, writeNpcRouteDraft } from '../debug/NpcRouteStorage';
import { displayPixelRatio, installCrispText } from '../ui/TextRendering';
import { RouteEditorPanel, type RouteEditorTool } from '../ui/RouteEditorPanel';
import { getMapData, type MapData } from '../world/MapDef';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { TOWN_ART, TOWN_STYLE } from '../world/TownArt';

type RouteGesture =
  | { kind: 'pan'; x: number; y: number; scrollX: number; scrollY: number }
  | { kind: 'stop'; stopId: string }
  | { kind: 'waypoint'; stopId: string; waypointIndex: number };

/** One visible route-leg hit and the ordered bend-point slot it represents. */
interface RouteLineHit {
  stopId: string;
  waypointIndex: number;
  tx: number;
  ty: number;
}

/** One transient pointer location that has not changed the route draft or undo history. */
interface RoutePointerPreview {
  kind: 'stop' | 'waypoint' | 'add-stop' | 'line';
  tx: number;
  ty: number;
  valid: boolean;
}

/** Read-only browser seam for deterministic pointer tests and visual inspection. */
declare global {
  interface Window {
    __ROUTE_EDITOR__?: {
      state(): { ready: boolean; residentId: ResidentId; weekday: number; selectedStopId: string; selectedWaypoint: number | null;
        tool: RouteEditorTool; dirty: boolean; undo: number; redo: number; previewMinute: number; playing: boolean;
        draft: NpcRouteDraft | null; routePointCount: number; pointerPreview: RoutePointerPreview | null };
      point(tx: number, ty: number): { x: number; y: number };
      linePoint(stopId: string): { x: number; y: number };
    };
  }
}

/** Own one disposable route authoring page with bounded history and no gameplay systems. */
export class RouteEditorScene extends Phaser.Scene {
  private panel!: RouteEditorPanel;
  private map!: MapData;
  private draft: NpcRouteDraft | null = null;
  private savedText = '';
  private past: NpcRouteDraft[] = [];
  private future: NpcRouteDraft[] = [];
  private residentId = TOWN_RESIDENTS[0].id as ResidentId;
  private weekday = 0;
  private selectedStopId = 'social';
  private selectedWaypoint: number | null = null;
  private tool: RouteEditorTool = 'edit';
  private gesture: RouteGesture | null = null;
  private routeLayer!: Phaser.GameObjects.Container;
  private pointerLayer!: Phaser.GameObjects.Container;
  private pointerPreview: RoutePointerPreview | null = null;
  private activeDay!: NpcRouteDayDraft;
  private activeSegments: NpcRouteSegment[] = [];
  private previewMinute = 0;
  private playing = false;
  private zoomLevel = 0.5;
  private density = 1;

  /** Register a non-world scene that normal warps cannot target. */
  constructor() { super(SceneKey.RouteEditor); }

  /** Build the isolated desk after shared assets load, then install only editor-owned listeners. */
  create(): void {
    if (mapEditorMode() !== 'routes') throw new Error('RouteEditorScene: development route mode is required.');
    this.map = getMapData(SceneKey.Town);
    installCrispText(this);
    this.panel = new RouteEditorPanel({
      resident: id => this.selectResident(id), weekday: day => this.selectWeekday(day),
      tool: tool => { this.cancelGesture(); this.tool = tool; this.setCursor(tool === 'pan' ? 'grab' : tool === 'add-stop' ? 'crosshair' : 'default');
        this.panel.tool(tool); this.panel.message(this.toolHint()); },
      stop: id => this.selectStop(id), note: value => this.run(() => this.commit(updateNpcRouteNote(this.current(), this.residentId, this.weekday, value), 'Day context updated.')),
      stopField: (id, field, value) => this.run(() => this.commit(updateNpcRouteStop(this.current(), this.residentId, this.weekday, id, { [field]: value }), 'Stop updated.')),
      stopTimes: (id, arrive, leave) => this.run(() => this.commit(updateNpcRouteStop(this.current(), this.residentId, this.weekday, id,
        { arrive, leave }), 'Stop times updated.'), 'CHECK TIMES'),
      removeStop: () => this.run(() => this.removeStop()),
      removeWaypoint: () => this.run(() => this.removeWaypoint()), undo: () => this.run(() => this.undo()), redo: () => this.run(() => this.redo()),
      save: () => this.run(() => this.save()), export: () => this.run(() => this.exportDraft()), import: file => { void this.importDraft(file); },
      reset: () => this.run(() => this.resetDraft()), zoom: direction => { this.zoom(direction); this.refreshRoute(false); },
      frame: () => { this.frameTown(); this.refreshRoute(false); },
      play: () => this.togglePreview(), preview: minute => this.setPreview(minute),
    });
    this.cameras.main.setBackgroundColor('#263b31');
    this.renderTown();
    this.routeLayer = this.add.container(0, 0).setDepth(1_500_000).setName('route-editor-layer');
    this.pointerLayer = this.add.container(0, 0).setDepth(1_500_100).setName('route-editor-pointer-layer');
    this.resize();
    this.run(() => {
      this.draft = readNpcRouteDraft(); this.savedText = serializeNpcRouteDraft(this.draft);
      this.ensureSelection(); this.frameTown(); this.refreshRoute();
    });
    this.input.on('pointerdown', this.pointerDown, this); this.input.on('pointermove', this.pointerMove, this);
    this.input.on('pointerup', this.pointerUp, this); this.input.on('pointerupoutside', this.cancelGesture, this);
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (this.inside(pointer)) { this.zoom(dy < 0 ? 1 : -1); this.refreshRoute(false); }
    });
    window.addEventListener('keydown', this.keyDown); window.addEventListener('beforeunload', this.beforeUnload);
    this.scale.on('resize', this.resize, this);
    window.__ROUTE_EDITOR__ = {
      state: () => ({ ready: this.draft !== null, residentId: this.residentId, weekday: this.weekday,
        selectedStopId: this.selectedStopId, selectedWaypoint: this.selectedWaypoint, tool: this.tool,
        dirty: this.dirty(), undo: this.past.length, redo: this.future.length, previewMinute: this.previewMinute,
        playing: this.playing, draft: this.draft ? structuredClone(this.draft) : null,
        routePointCount: this.activeSegments.reduce((sum, segment) => sum + segment.points.length, 0),
        pointerPreview: this.pointerPreview ? { ...this.pointerPreview } : null }),
      point: (tx, ty) => this.screenPoint((tx + 0.5) * TILE, (ty + 0.5) * TILE),
      linePoint: stopId => {
        const segment = npcRouteSegments(this.current(), this.residentId, this.weekday).find(entry => entry.stopId === stopId);
        if (!segment || segment.points.length < 2) throw new Error(`Route editor has no visible line into ${stopId}.`);
        const point = segment.points[Math.floor(segment.points.length / 2)];
        return this.screenPoint((point.tx + 0.5) * TILE, (point.ty + 0.5) * TILE);
      },
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.resize, this); window.removeEventListener('keydown', this.keyDown);
      window.removeEventListener('beforeunload', this.beforeUnload); this.setCursor('default'); this.panel.destroy(); delete window.__ROUTE_EDITOR__;
    });
  }

  /** Advance the route preview using world time units without starting the game clock. */
  update(_time: number, delta: number): void {
    if (!this.playing || !this.draft) return;
    this.previewMinute += delta * 0.06;
    if (this.previewMinute >= 1080) { this.previewMinute = 1080; this.playing = false; }
    this.drawPreview();
  }

  /** Draw the painted Town once as non-interactive context (the same painting TownScene draws). */
  private renderTown(): void {
    // why: the Town painting has no place sounds, so the listener's position never matters here.
    new PaintedRoomRenderer(this, TOWN_ART, TOWN_STYLE, 0, 0, 'route-editor-town', { x: 0, y: 0 });
  }

  /** Surface validation failures and restore form fields from the unchanged valid draft. */
  private run(action: () => void, errorLabel = 'CAN’T PLACE THAT'): void {
    try { action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.draft) this.refreshRoute(false);
      this.panel.message(message, true); this.panel.mapMessage(errorLabel, message, true);
    }
  }

  /** Require the loaded draft after explicit storage parsing succeeds. */
  private current(): NpcRouteDraft {
    if (!this.draft) throw new Error('Route draft could not load. Import a valid file or reset all routes.');
    return this.draft;
  }

  /** Compare canonical current and saved route bytes. */
  private dirty(): boolean { return this.draft !== null && serializeNpcRouteDraft(this.draft) !== this.savedText; }

  /** Keep selection attached to an existing stop after imports, undo, or deletion. */
  private ensureSelection(): void {
    const day = npcRouteDay(this.current(), this.residentId, this.weekday);
    if (!day.stops.some(stop => stop.id === this.selectedStopId)) this.selectedStopId = day.stops[Math.min(1, day.stops.length - 1)].id;
    const stop = day.stops.find(entry => entry.id === this.selectedStopId);
    if (!stop || this.selectedWaypoint !== null && this.selectedWaypoint >= stop.via.length) this.selectedWaypoint = null;
  }

  /** Select a resident and retain the same weekday without mutating the draft. */
  private selectResident(id: ResidentId): void {
    if (!TOWN_RESIDENTS.some(resident => resident.id === id)) throw new Error(`Unknown route resident ${id}.`);
    this.residentId = id; this.selectedStopId = 'social'; this.selectedWaypoint = null; this.previewMinute = 0; this.playing = false;
    this.ensureSelection(); this.refreshRoute();
  }

  /** Select one weekday and reset transient preview state. */
  private selectWeekday(day: number): void {
    if (!Number.isSafeInteger(day) || day < 0 || day > 6) throw new Error(`Unknown route weekday ${day}.`);
    this.weekday = day; this.selectedStopId = 'social'; this.selectedWaypoint = null; this.previewMinute = 0; this.playing = false;
    this.ensureSelection(); this.refreshRoute();
  }

  /** Select one named stop from the current validated day. */
  private selectStop(id: string): void {
    const day = npcRouteDay(this.current(), this.residentId, this.weekday);
    if (!day.stops.some(stop => stop.id === id)) throw new Error(`Unknown route stop ${id}.`);
    this.selectedStopId = id; this.selectedWaypoint = null; this.refreshRoute();
  }

  /** Commit one validated route snapshot and keep at most 100 undo states. */
  private commit(next: NpcRouteDraft, message: string): void {
    const valid = validateNpcRouteDraft(next);
    if (serializeNpcRouteDraft(valid) === serializeNpcRouteDraft(this.current())) return;
    this.past.push(this.current()); if (this.past.length > 100) this.past.shift();
    this.future = []; this.draft = valid; this.ensureSelection(); this.refreshRoute(); this.panel.message(message);
  }

  /** Insert a new activity after the selected stop and place it atomically on the clicked map tile. */
  private addStop(tx: number, ty: number): void {
    const before = new Set(npcRouteDay(this.current(), this.residentId, this.weekday).stops.map(stop => stop.id));
    const inserted = addNpcRouteStop(this.current(), this.residentId, this.weekday, this.selectedStopId);
    const added = npcRouteDay(inserted, this.residentId, this.weekday).stops.find(stop => !before.has(stop.id));
    if (!added) throw new Error('Route editor could not identify the added stop.');
    const next = moveNpcRouteStop(inserted, this.residentId, this.weekday, added.id, tx, ty);
    this.selectedStopId = added.id; this.selectedWaypoint = null; this.tool = 'edit'; this.panel.tool(this.tool);
    this.setCursor('default');
    this.commit(next, 'Stop placed. Set its name, time, and reason in the right panel.');
  }

  /** Remove the selected non-home activity. */
  private removeStop(): void {
    const day = npcRouteDay(this.current(), this.residentId, this.weekday), index = day.stops.findIndex(stop => stop.id === this.selectedStopId);
    const nextId = day.stops[Math.max(0, index - 1)]?.id;
    const next = removeNpcRouteStop(this.current(), this.residentId, this.weekday, this.selectedStopId);
    if (!nextId) throw new Error('Route editor lost the next selected stop.');
    this.selectedStopId = nextId; this.selectedWaypoint = null; this.commit(next, 'Activity removed.');
  }

  /** Remove only the selected via point. */
  private removeWaypoint(): void {
    if (this.selectedWaypoint === null) throw new Error('Select a diamond via point first.');
    const next = removeNpcRouteWaypoint(this.current(), this.residentId, this.weekday, this.selectedStopId, this.selectedWaypoint);
    this.selectedWaypoint = null; this.commit(next, 'Via point removed.');
  }

  /** Restore the last route edit without affecting persisted draft bytes. */
  private undo(): void {
    const prior = this.past.pop(); if (!prior) return;
    this.future.push(this.current()); this.draft = prior; this.ensureSelection(); this.refreshRoute(); this.panel.message('Undone.');
  }

  /** Reapply one undone route edit. */
  private redo(): void {
    const next = this.future.pop(); if (!next) return;
    this.past.push(this.current()); this.draft = next; this.ensureSelection(); this.refreshRoute(); this.panel.message('Redone.');
  }

  /** Persist only the isolated route key after complete validation. */
  private save(): void {
    this.draft = writeNpcRouteDraft(this.current()); this.savedText = serializeNpcRouteDraft(this.draft);
    this.refreshRoute(); this.panel.message('Route draft saved in this browser. Adventure saves were not touched.');
  }

  /** Download the complete canonical weekly route document. */
  private exportDraft(): void {
    const source = serializeNpcRouteDraft(this.current()), url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'shopkeepers-npc-routes.json';
    document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    this.panel.message('Routes exported. Send me this JSON when the week feels right.');
  }

  /** Read one bounded JSON file and replace the current draft only after full validation. */
  private async importDraft(file: File): Promise<void> {
    if (file.size > NPC_ROUTE_DRAFT_MAX_BYTES) { this.panel.message('Route file exceeds the 1 MB limit.', true); return; }
    try {
      const source = await file.text();
      this.commit(parseNpcRouteDraft(source), 'Routes imported. Save the draft to keep it in this browser.');
    } catch (error) { this.panel.message(error instanceof Error ? error.message : String(error), true); }
  }

  /** Reset all route design data only after one explicit confirmation. */
  private resetDraft(): void {
    if (!window.confirm('Reset every resident route to the current authored schedule? Adventure saves will not change.')) return;
    this.commit(createNpcRouteDraft(), 'All route drafts restored to the current schedule.'); this.save();
  }

  /** Rebuild only the selected route overlay and native inspector. */
  private refreshRoute(updateMessage = true): void {
    const draft = this.current(), day = npcRouteDay(draft, this.residentId, this.weekday);
    this.activeDay = day;
    this.activeSegments = npcRouteSegments(draft, this.residentId, this.weekday);
    this.clearPointerPreview();
    this.routeLayer.removeAll(true);
    const segments = this.activeSegments;
    const visualScale = 1 / this.zoomLevel;
    for (const segment of segments.slice(1)) {
      const selected = segment.stopId === this.selectedStopId;
      const under = this.add.graphics().lineStyle((selected ? 9 : 6) * visualScale, 0x35271f, selected ? 0.76 : 0.38);
      const line = this.add.graphics().lineStyle((selected ? 4 : 2.5) * visualScale, selected ? 0xffcf57 : 0xb9c8a4, selected ? 1 : 0.58);
      for (const graphics of [under, line]) {
        graphics.beginPath(); segment.points.forEach((point, index) => {
          const x = (point.tx + 0.5) * TILE, y = (point.ty + 0.5) * TILE;
          if (index === 0) graphics.moveTo(x, y); else graphics.lineTo(x, y);
        }); graphics.strokePath(); this.routeLayer.add(graphics);
      }
      if (selected) this.drawLineInsertHint(segment.points);
    }
    day.stops.forEach((stop, index) => this.drawStop(stop, index));
    const selected = day.stops.find(stop => stop.id === this.selectedStopId);
    if (!selected) throw new Error(`RouteEditorScene: selected stop ${this.selectedStopId} disappeared.`);
    day.stops.slice(1).forEach(stop => stop.via.forEach((point, index) => this.drawWaypoint(stop.id, point, index)));
    this.drawPreview();
    this.panel.tool(this.tool);
    this.panel.render(this.residentId, this.weekday, day, this.selectedStopId, this.selectedWaypoint, this.previewMinute, this.playing);
    this.panel.history(this.past.length > 0, this.future.length > 0, this.dirty());
    if (updateMessage) this.panel.message(this.toolHint());
  }

  /** Draw one numbered draggable stop above Town art. */
  private drawStop(stop: NpcRouteStopDraft, index: number): void {
    const selected = stop.id === this.selectedStopId, x = (stop.tx + 0.5) * TILE, y = (stop.ty + 0.5) * TILE;
    const visualScale = 1 / this.zoomLevel;
    const circle = this.add.circle(x, y, (selected ? 12 : 10) * visualScale, selected ? 0x7a4d36 : 0x315345, 1)
      .setStrokeStyle(2.5 * visualScale, selected ? 0xf7d679 : 0xfff7dd).setName(`route-editor-stop-marker-${stop.id}`);
    const label = this.add.text(x, y, String(index + 1), { fontFamily: 'Trebuchet MS', fontStyle: 'bold',
      fontSize: `${10 * visualScale}px`, color: '#fff9e9' }).setOrigin(0.5);
    this.routeLayer.add([circle, label]);
  }

  /** Draw one authored bend point. The selected arrival leg keeps its handles visually dominant. */
  private drawWaypoint(stopId: string, point: { tx: number; ty: number }, index: number): void {
    const x = (point.tx + 0.5) * TILE, y = (point.ty + 0.5) * TILE;
    const onSelectedLeg = stopId === this.selectedStopId, selected = onSelectedLeg && this.selectedWaypoint === index;
    const visualScale = 1 / this.zoomLevel, size = (selected ? 13 : 10) * visualScale;
    const diamond = this.add.rectangle(x, y, size, size, selected ? 0xd66d4c : onSelectedLeg ? 0x4a8a78 : 0x718174,
      onSelectedLeg ? 1 : 0.66).setRotation(Math.PI / 4).setStrokeStyle(2 * visualScale, 0xfff7dd)
      .setName(`route-editor-waypoint-${stopId}-${index}`);
    this.routeLayer.add(diamond);
  }

  /** Place a visible plus sign on the selected leg so line editing is discoverable. */
  private drawLineInsertHint(points: readonly { tx: number; ty: number }[]): void {
    if (points.length < 5) return;
    const point = points[Math.floor(points.length / 2)], x = (point.tx + 0.5) * TILE, y = (point.ty + 0.5) * TILE;
    const visualScale = 1 / this.zoomLevel;
    const circle = this.add.circle(x, y, 8 * visualScale, 0xfff4cf, 0.96)
      .setStrokeStyle(2 * visualScale, 0x7a4d36).setName('route-editor-line-insert-hint');
    const plus = this.add.graphics().lineStyle(2.5 * visualScale, 0x7a4d36, 1).setName('route-editor-line-insert-plus');
    plus.beginPath(); plus.moveTo(x - 4 * visualScale, y); plus.lineTo(x + 4 * visualScale, y);
    plus.moveTo(x, y - 4 * visualScale); plus.lineTo(x, y + 4 * visualScale); plus.strokePath();
    this.routeLayer.add([circle, plus]);
  }

  /** Draw the current preview marker and keep its native clock caption in sync. */
  private drawPreview(): void {
    if (!this.draft || !this.routeLayer) return;
    const old = this.routeLayer.getByName('route-editor-preview-marker'); if (old) old.destroy();
    const oldText = this.routeLayer.getByName('route-editor-preview-letter'); if (oldText) oldText.destroy();
    const sample = sampleNpcRoute(this.draft, this.residentId, this.weekday, Math.floor(this.previewMinute));
    const x = (sample.x + 0.5) * TILE, y = (sample.y + 0.5) * TILE;
    const visualScale = 1 / this.zoomLevel;
    const marker = this.add.circle(x, y, 13 * visualScale, 0xfff1c9, 1)
      .setStrokeStyle(3 * visualScale, 0xd85b43).setName('route-editor-preview-marker');
    const resident = TOWN_RESIDENTS.find(entry => entry.id === this.residentId);
    if (!resident) throw new Error(`RouteEditorScene: missing resident ${this.residentId}.`);
    const letter = this.add.text(x, y, resident.name.slice(0, 1), { fontFamily: 'Georgia', fontStyle: 'bold',
      fontSize: `${11 * visualScale}px`, color: '#603c2d' })
      .setOrigin(0.5).setName('route-editor-preview-letter');
    this.routeLayer.add([marker, letter]); this.panel.preview(this.previewMinute, this.playing, sample.label);
  }

  /** Return the nearest route node inside a zoom-aware world radius. */
  private hit(pointer: Phaser.Input.Pointer): { kind: 'stop'; stopId: string } | { kind: 'waypoint'; stopId: string; waypointIndex: number } | null {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y), day = this.activeDay;
    const radius = 12 / Math.max(0.3, this.cameras.main.zoom / this.density);
    for (const stop of [...day.stops].reverse()) for (let index = stop.via.length - 1; index >= 0; index--) {
      const point = stop.via[index];
      if (Math.hypot(world.x - (point.tx + 0.5) * TILE, world.y - (point.ty + 0.5) * TILE) <= radius)
        return { kind: 'waypoint', stopId: stop.id, waypointIndex: index };
    }
    for (const stop of [...day.stops].reverse()) if (Math.hypot(world.x - (stop.tx + 0.5) * TILE, world.y - (stop.ty + 0.5) * TILE) <= radius) {
      return { kind: 'stop', stopId: stop.id };
    }
    return null;
  }

  /** Find the closest rendered route line and its ordered bend-point insertion slot. */
  private lineHit(pointer: Phaser.Input.Pointer): RouteLineHit | null {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y), day = this.activeDay;
    const segments = this.activeSegments;
    const radius = 11 / Math.max(0.3, this.cameras.main.zoom / this.density);
    let best: { stopId: string; pairIndex: number; pointIndex: number; distance: number } | null = null;
    for (const segment of segments.slice(1)) for (let index = 0; index < segment.points.length - 1; index++) {
      const start = segment.points[index], end = segment.points[index + 1];
      const ax = (start.tx + 0.5) * TILE, ay = (start.ty + 0.5) * TILE;
      const bx = (end.tx + 0.5) * TILE, by = (end.ty + 0.5) * TILE, dx = bx - ax, dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((world.x - ax) * dx + (world.y - ay) * dy) / lengthSquared));
      const px = ax + dx * amount, py = ay + dy * amount, distance = Math.hypot(world.x - px, world.y - py);
      if (distance <= radius && (!best || distance < best.distance)) best = { stopId: segment.stopId, pairIndex: index,
        pointIndex: amount < 0.5 ? index : index + 1, distance };
    }
    if (!best) return null;
    const segment = segments.find(entry => entry.stopId === best.stopId), stop = day.stops.find(entry => entry.id === best.stopId);
    if (!segment || !stop) throw new Error(`RouteEditorScene: line hit lost route leg ${best.stopId}.`);
    let cursor = 0;
    const viaIndices = stop.via.map(via => {
      const found = segment.points.findIndex((point, index) => index >= cursor && point.tx === via.tx && point.ty === via.ty);
      if (found < 0) throw new Error(`RouteEditorScene: bend point disappeared from ${best!.stopId}.`);
      cursor = found; return found;
    });
    const waypointIndex = viaIndices.filter(index => best!.pairIndex >= index).length;
    const point = segment.points[best.pointIndex];
    return { stopId: best.stopId, waypointIndex, tx: point.tx, ty: point.ty };
  }

  /** Start a pan, live node drag, or direct click-to-place edit without changing draft bytes yet. */
  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.draft || !this.inside(pointer)) return;
    if (pointer.rightButtonDown() || pointer.middleButtonDown() || this.tool === 'pan') {
      const camera = this.cameras.main;
      this.clearPointerPreview(); this.setCursor('grabbing');
      this.gesture = { kind: 'pan', x: pointer.x, y: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY }; return;
    }
    const tile = this.tile(pointer);
    if (this.tool === 'add-stop') {
      const valid = this.canAddStop(tile.tx, tile.ty);
      if (!valid) { this.rejectDrop(this.addStopIssue(tile.tx, tile.ty)); return; }
      this.clearPointerPreview(); this.run(() => this.addStop(tile.tx, tile.ty)); return;
    }
    const hit = this.hit(pointer);
    if (hit?.kind === 'stop') {
      this.selectedStopId = hit.stopId; this.selectedWaypoint = null;
      const stopIndex = this.activeDay.stops.findIndex(stop => stop.id === hit.stopId);
      if (stopIndex === 0 || stopIndex === this.activeDay.stops.length - 1) {
        this.gesture = null; this.refreshRoute(false); this.setCursor('not-allowed');
        this.panel.message('Morning and night home stops stay at the resident home.'); return;
      }
      this.gesture = hit; this.refreshRoute(false); this.setCursor('grabbing'); return;
    }
    if (hit?.kind === 'waypoint') {
      this.selectedStopId = hit.stopId; this.selectedWaypoint = hit.waypointIndex; this.gesture = hit;
      this.refreshRoute(false); this.setCursor('grabbing'); return;
    }
    const line = this.lineHit(pointer);
    if (line) this.run(() => {
      this.clearPointerPreview();
      this.selectedStopId = line.stopId; this.selectedWaypoint = line.waypointIndex;
      this.commit(insertNpcRouteWaypoint(this.current(), this.residentId, this.weekday, line.stopId,
        line.waypointIndex, line.tx, line.ty), 'Bend point added. Drag its diamond to shape this route leg.');
    });
    else {
      const message = 'Drag a numbered stop, or click directly on a gold route line.';
      this.selectedWaypoint = null; this.panel.message(message); this.panel.mapMessage('NO ROUTE HERE', message, true);
    }
  }

  /** Update camera movement, node ghosts, placement previews, and pointer affordances every frame. */
  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.draft || !this.inside(pointer)) { this.clearPointerPreview(); this.setCursor('default'); return; }
    if (this.gesture?.kind === 'pan') {
      const camera = this.cameras.main;
      camera.setScroll(this.gesture.scrollX - (pointer.x - this.gesture.x) / camera.zoom,
        this.gesture.scrollY - (pointer.y - this.gesture.y) / camera.zoom);
      this.setCursor('grabbing'); return;
    }
    const tile = this.tile(pointer);
    if (this.gesture?.kind === 'stop' || this.gesture?.kind === 'waypoint') {
      const preview = { kind: this.gesture.kind, ...tile, valid: isNpcRoutePointPassable(tile.tx, tile.ty) } as RoutePointerPreview;
      this.drawPointerPreview(pointer, preview, this.gesture); this.setCursor(preview.valid ? 'grabbing' : 'not-allowed'); return;
    }
    if (this.tool === 'add-stop') {
      const preview: RoutePointerPreview = { kind: 'add-stop', ...tile, valid: this.canAddStop(tile.tx, tile.ty) };
      this.drawPointerPreview(pointer, preview, null); this.setCursor(preview.valid ? 'crosshair' : 'not-allowed'); return;
    }
    if (this.tool === 'pan') { this.clearPointerPreview(); this.setCursor('grab'); return; }
    const hit = this.hit(pointer);
    if (hit) {
      this.clearPointerPreview();
      const index = hit.kind === 'stop' ? this.activeDay.stops.findIndex(stop => stop.id === hit.stopId) : -1;
      this.setCursor(hit.kind === 'stop' && (index === 0 || index === this.activeDay.stops.length - 1) ? 'not-allowed' : 'grab');
      return;
    }
    const line = this.lineHit(pointer);
    if (line) {
      this.drawPointerPreview(pointer, { kind: 'line', tx: line.tx, ty: line.ty, valid: true }, null);
      this.setCursor('crosshair'); return;
    }
    this.clearPointerPreview(); this.setCursor('default');
  }

  /** Commit one valid dragged stop or via point to the release tile. */
  private pointerUp(pointer: Phaser.Input.Pointer): void {
    const gesture = this.gesture, preview = this.pointerPreview; this.gesture = null;
    if (!gesture) return;
    if (gesture.kind === 'pan') { this.clearPointerPreview(); this.setCursor(this.tool === 'pan' ? 'grab' : 'default'); return; }
    if (!this.inside(pointer)) { this.clearPointerPreview(); this.setCursor('default'); return; }
    const tile = this.tile(pointer);
    if (!preview) { this.setCursor('default'); return; }
    if (!isNpcRoutePointPassable(tile.tx, tile.ty)) {
      this.clearPointerPreview(); this.rejectDrop(`Town tile ${tile.tx},${tile.ty} is blocked.`); return;
    }
    this.clearPointerPreview(); this.setCursor('default');
    if (gesture.kind === 'stop') this.run(() => this.commit(moveNpcRouteStop(this.current(), this.residentId, this.weekday,
      gesture.stopId, tile.tx, tile.ty), 'Stop moved.'));
    else this.run(() => this.commit(moveNpcRouteWaypoint(this.current(), this.residentId, this.weekday,
      gesture.stopId, gesture.waypointIndex, tile.tx, tile.ty), 'Via point moved.'));
  }

  /** Cancel an incomplete pointer gesture without changing route history. */
  private cancelGesture = (): void => {
    this.gesture = null; this.clearPointerPreview(); this.setCursor(this.tool === 'pan' ? 'grab' : this.tool === 'add-stop' ? 'crosshair' : 'default');
  };

  /** Draw one unsaved pointer marker, its snapped tile, and its immediate route connections. */
  private drawPointerPreview(pointer: Phaser.Input.Pointer, preview: RoutePointerPreview,
    gesture: Exclude<RouteGesture, { kind: 'pan' }> | null): void {
    this.pointerLayer.removeAll(true); this.pointerPreview = preview;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y), visualScale = 1 / this.zoomLevel;
    const color = preview.valid ? 0x49a978 : 0xd75c50;
    const graphics = this.add.graphics().setName('route-editor-live-pointer');
    graphics.lineStyle(4 * visualScale, color, 0.72);
    for (const neighbor of this.previewNeighbors(preview.kind, gesture)) {
      graphics.beginPath(); graphics.moveTo((neighbor.tx + 0.5) * TILE, (neighbor.ty + 0.5) * TILE);
      graphics.lineTo(world.x, world.y); graphics.strokePath();
    }
    graphics.fillStyle(color, 0.2).fillRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE)
      .lineStyle(2.5 * visualScale, color, 0.95).strokeRect(preview.tx * TILE, preview.ty * TILE, TILE, TILE);
    const marker = preview.kind === 'waypoint'
      ? this.add.rectangle(world.x, world.y, 14 * visualScale, 14 * visualScale, color, 0.94).setRotation(Math.PI / 4)
        .setStrokeStyle(2.5 * visualScale, 0xfff7dd)
      : this.add.circle(world.x, world.y, 12 * visualScale, color, 0.94).setStrokeStyle(2.5 * visualScale, 0xfff7dd);
    marker.setName('route-editor-live-marker');
    const label = this.add.text(world.x, world.y, this.previewLabel(preview, gesture), { fontFamily: 'Trebuchet MS', fontStyle: 'bold',
      fontSize: `${11 * visualScale}px`, color: '#fff9e9' }).setOrigin(0.5).setName('route-editor-live-label');
    this.pointerLayer.add([graphics, marker, label]);
  }

  /** Return the two route controls that surround the transient point. */
  private previewNeighbors(kind: RoutePointerPreview['kind'], gesture: Exclude<RouteGesture, { kind: 'pan' }> | null): Array<{ tx: number; ty: number }> {
    if (kind === 'line') return [];
    if (kind === 'add-stop') {
      const index = this.activeDay.stops.findIndex(stop => stop.id === this.selectedStopId);
      return [this.activeDay.stops[index], this.activeDay.stops[index + 1]].filter((point): point is NpcRouteStopDraft => point !== undefined);
    }
    if (!gesture) return [];
    const stopIndex = this.activeDay.stops.findIndex(stop => stop.id === gesture.stopId);
    if (stopIndex < 0) return [];
    if (gesture.kind === 'stop') {
      return [this.activeDay.stops[stopIndex - 1], this.activeDay.stops[stopIndex + 1]].filter((point): point is NpcRouteStopDraft => point !== undefined);
    }
    const stop = this.activeDay.stops[stopIndex];
    const before = gesture.waypointIndex > 0 ? stop.via[gesture.waypointIndex - 1] : this.activeDay.stops[stopIndex - 1];
    const after = gesture.waypointIndex < stop.via.length - 1 ? stop.via[gesture.waypointIndex + 1] : stop;
    return [before, after].filter((point): point is { tx: number; ty: number } => point !== undefined);
  }

  /** Label the live point with its resulting route order or a concise edit symbol. */
  private previewLabel(preview: RoutePointerPreview, gesture: Exclude<RouteGesture, { kind: 'pan' }> | null): string {
    if (preview.kind === 'add-stop') {
      const index = this.activeDay.stops.findIndex(stop => stop.id === this.selectedStopId);
      return index >= 0 ? String(index + 2) : '+';
    }
    if (preview.kind === 'stop' && gesture?.kind === 'stop') {
      const index = this.activeDay.stops.findIndex(stop => stop.id === gesture.stopId);
      return index >= 0 ? String(index + 1) : '•';
    }
    return preview.kind === 'line' ? '+' : '•';
  }

  /** Check both the clicked Town tile and the selected route gap before showing a valid Add Stop preview. */
  private canAddStop(tx: number, ty: number): boolean {
    return isNpcRoutePointPassable(tx, ty) && npcRouteStopInsertionIssue(this.activeDay, this.selectedStopId) === null;
  }

  /** Explain an invalid Add Stop preview without changing route data. */
  private addStopIssue(tx: number, ty: number): string {
    if (!isNpcRoutePointPassable(tx, ty)) return `Town tile ${tx},${ty} is blocked.`;
    return npcRouteStopInsertionIssue(this.activeDay, this.selectedStopId) ?? 'That stop cannot be placed.';
  }

  /** Keep failed drops visible and explicit while preserving the current draft and history. */
  private rejectDrop(message: string): void {
    this.clearPointerPreview(); this.setCursor('not-allowed');
    this.panel.message(message, true); this.panel.mapMessage('CAN’T PLACE THAT', message, true);
  }

  /** Remove transient pointer art and browser-test state without touching the route. */
  private clearPointerPreview(): void {
    if (this.pointerLayer) this.pointerLayer.removeAll(true);
    this.pointerPreview = null;
  }

  /** Apply the active editing affordance to the game canvas. */
  private setCursor(cursor: CSSStyleDeclaration['cursor']): void { this.game.canvas.style.cursor = cursor; }

  /** Return the Town tile below one Phaser pointer. */
  private tile(pointer: Phaser.Input.Pointer): { tx: number; ty: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { tx: Math.floor(world.x / TILE), ty: Math.floor(world.y / TILE) };
  }

  /** Reject pointer events over native editor panels. */
  private inside(pointer: Phaser.Input.Pointer): boolean {
    const camera = this.cameras.main;
    return pointer.x >= camera.x && pointer.y >= camera.y && pointer.x < camera.x + camera.width && pointer.y < camera.y + camera.height;
  }

  /** Convert one world location to a browser mouse position for deterministic tests. */
  private screenPoint(x: number, y: number): { x: number; y: number } {
    const camera = this.cameras.main, topLeft = camera.getWorldPoint(camera.x, camera.y);
    return { x: (camera.x + (x - topLeft.x) * camera.zoom) / this.density,
      y: (camera.y + (y - topLeft.y) * camera.zoom) / this.density };
  }

  /** Reserve native panel space and preserve the current Town focus across browser resizes. */
  private resize = (): void => {
    if (!this.panel || !this.map) return;
    const viewport = this.panel.viewport(); this.density = displayPixelRatio();
    this.cameras.main.setViewport(viewport.x * this.density, viewport.y * this.density,
      Math.max(1, viewport.width) * this.density, Math.max(1, viewport.height) * this.density);
    this.cameras.main.setZoom(this.zoomLevel * this.density).setRoundPixels(true); this.sizeCameraBounds();
  };

  /** Pad small map views so center-on remains stable, then bound close zoom panning. */
  private sizeCameraBounds(): void {
    const camera = this.cameras.main, width = this.map.w * TILE, height = this.map.h * TILE;
    const paddingX = Math.max(0, camera.displayWidth - width) / 2, paddingY = Math.max(0, camera.displayHeight - height) / 2;
    camera.setBounds(-paddingX, -paddingY, width + paddingX * 2, height + paddingY * 2);
  }

  /** Fit the complete Town between both inspector panels. */
  private frameTown(): void {
    const viewport = this.panel.viewport();
    this.zoomLevel = Math.max(0.18, Math.min(viewport.width / (this.map.w * TILE), viewport.height / (this.map.h * TILE)) * 0.94);
    this.cameras.main.setZoom(this.zoomLevel * this.density); this.sizeCameraBounds();
    this.cameras.main.centerOn(this.map.w * TILE / 2, this.map.h * TILE / 2);
  }

  /** Apply one bounded zoom step around the current camera center. */
  private zoom(direction: number): void {
    this.zoomLevel = Math.max(0.18, Math.min(2.5, this.zoomLevel * (direction > 0 ? 1.2 : 1 / 1.2)));
    this.cameras.main.setZoom(this.zoomLevel * this.density); this.sizeCameraBounds();
  }

  /** Toggle the editor-owned route clock without touching GameState time. */
  private togglePreview(): void {
    if (this.previewMinute >= 1080) this.previewMinute = 0;
    this.playing = !this.playing; this.drawPreview();
  }

  /** Seek one explicit preview minute and pause playback for precise inspection. */
  private setPreview(minute: number): void {
    if (!Number.isFinite(minute) || minute < 0 || minute > 1080) throw new Error(`Invalid route preview time ${minute}.`);
    this.previewMinute = Math.floor(minute); this.playing = false; this.drawPreview();
  }

  /** Describe the active map gesture in plain design language. */
  private toolHint(): string {
    if (this.tool === 'add-stop') return 'Add stop: click an open road tile. Then edit its time and reason on the right.';
    if (this.tool === 'pan') return 'Move map: drag the map. Use the wheel or view buttons to zoom.';
    return 'Edit route: drag a numbered stop or diamond. Click a gold line to add a bend point.';
  }

  /** Keep editor shortcuts out of focused form controls. */
  private keyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); this.run(() => event.shiftKey ? this.redo() : this.undo()); }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); this.run(() => this.save()); }
    if (event.code === 'Space') { event.preventDefault(); this.togglePreview(); }
    if (event.code === 'Escape') { this.cancelGesture(); this.panel.message('Gesture cancelled.'); }
  };

  /** Warn before a page closes with unsaved route changes. */
  private beforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.dirty()) { event.preventDefault(); event.returnValue = ''; }
  };
}
