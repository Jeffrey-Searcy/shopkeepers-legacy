/**
 * WorldRoutesUI renders a paused, read-only weekly atlas from the live Town schedule system.
 * It owns no schedule or save data. Interior time ends at each resident's exterior door.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import type { ResidentId } from '../config/ResidentRelationships';
import { MAP_TILES } from '../config/GameConfig';
import { TOWN_BUILDINGS, townDoor } from '../config/TownBuildings';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { GameState } from '../state/GameState';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { Sfx } from '../systems/SfxSystem';
import { residentRouteSnapshot, type ResidentRouteSnapshot } from '../systems/TownScheduleSystem';
import { isWorldRoutesModalOpen, setWorldRoutesModalOpen } from '../systems/WorldRoutesModalSystem';
import { getMapData, type Ground, type MapData } from '../world/MapDef';
import { COZY_THEME, cozyPanel, cozyPop } from './CozyTheme';
import { createScreenShade } from './UILayout';
import { mapEditorEnabled, mapEditorUrl } from '../debug/MapEditorMode';

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
/** High-contrast thread colors stay distinct over both grass and dirt atlas colors. */
const ROUTE_COLORS = [0xe24f54, 0x2b78c6, 0xe1922d, 0x7b55bb, 0x2b9b72, 0xd75c9e,
  0x8c5a35, 0x268d9d, 0xb9a326, 0x5869d8, 0xb34b2f, 0x548b37] as const;
/**
 * Where the painted Town (MAP_TILES.town, 82x75 tiles) sits inside the 562x422 atlas panel (x 70-632, y 67-489).
 * 5.15 px per tile gives a 422x386 map, centered across the panel, with its frame at y 71-469. That leaves a
 * band above the map (beside the subtitle) and below it (above the footer line) for the Mountain and Beach cards.
 */
const MAP = { x: 140, y: 77, scale: 5.15, w: MAP_TILES.town.w, h: MAP_TILES.town.h } as const;
/**
 * How a surrounding-region card joins the map. West cards line up with their exit row. North and south cards
 * sit beside the main road, not on it, because the title and footer leave no room to center them on it:
 * their line runs from the card's left edge to `roadX`, then along the road to the map edge.
 */
type RegionLink = { side: 'west' } | { side: 'north' | 'south'; roadX: number };

/** Small serializable view used by browser tests and future map accessibility work. */
export interface WorldRoutesDebugView {
  selectedDay: number;
  dayLabel: string;
  isolatedResidentId: ResidentId | null;
  routes: Array<{ residentId: ResidentId; color: number; visible: boolean; inside: boolean;
    locationLabel: string; partnerId: ResidentId; pointCount: number; marker: { tx: number; ty: number } }>;
}

/** Owns the nested travel ledger while PauseMenu keeps world simulation frozen. */
export class WorldRoutesUI {
  private readonly root: Phaser.GameObjects.Container;
  private readonly mapRoot: Phaser.GameObjects.Container;
  private readonly legendRoot: Phaser.GameObjects.Container;
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly clockText: Phaser.GameObjects.Text;
  private readonly selectionText: Phaser.GameObjects.Text;
  private selectedWeekday = 0;
  private isolatedResidentId: ResidentId | null = null;
  private keyboardEvents = new WeakSet<KeyboardEvent>();
  private map!: MapData;

  /** Build fixed ledger chrome once and defer all schedule reads until the player opens it. */
  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(2_000_020).setVisible(false).setName('world-routes-map');
    this.root.add(createScreenShade(scene, COZY_THEME.shadow, 0.78).setInteractive());
    this.root.add(cozyPanel(scene, 480, 280, 930, 516, COZY_THEME.shadow, 28).setAlpha(0.38));
    this.root.add(cozyPanel(scene, 480, 271, 930, 516, COZY_THEME.leather, 28).setInteractive().setStrokeStyle(3, COZY_THEME.leatherDark));
    this.root.add(cozyPanel(scene, 480, 271, 906, 492, COZY_THEME.paper, 21).setStrokeStyle(2, COZY_THEME.border));
    this.root.add(cozyPanel(scene, 351, 278, 562, 422, COZY_THEME.paperDark, 18).setAlpha(0.5).setStrokeStyle(1, COZY_THEME.border));
    this.root.add(cozyPanel(scene, 765, 278, 252, 422, COZY_THEME.paperDark, 18).setAlpha(0.62).setStrokeStyle(1, COZY_THEME.border));
    this.root.add(scene.add.text(44, 29, 'THE KEEPER’S ATLAS', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'bold', fontSize: '20px', color: COZY_THEME.ink,
    }));
    this.root.add(scene.add.text(45, 57, 'Follow the colored threads to find your neighbors.', {
      fontFamily: COZY_THEME.titleFont, fontStyle: 'italic', fontSize: '11px', color: COZY_THEME.muted,
    }));
    this.root.add(scene.add.text(651, 57, 'DAILY ROUTES', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.muted,
    }));
    const close = cozyPanel(scene, 887, 43, 58, 27, COZY_THEME.peach, 11)
      .setInteractive({ useHandCursor: true }).setName('world-routes-close');
    close.on('pointerdown', () => this.close());
    this.root.add([close, scene.add.text(887, 43, 'Close', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5)]);
    this.mapRoot = scene.add.container(0, 0).setName('world-routes-map-layer');
    this.legendRoot = scene.add.container(0, 0).setName('world-routes-legend');
    this.root.add([this.mapRoot, this.legendRoot]);
    this.selectionText = scene.add.text(650, 393, '', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.ink,
      wordWrap: { width: 230, useAdvancedWrap: true }, lineSpacing: 2,
    }).setName('world-routes-selection');
    this.root.add(this.selectionText);
    const showAll = cozyPanel(scene, 765, 431, 222, 24, COZY_THEME.mint, 9)
      .setInteractive({ useHandCursor: true }).setName('world-routes-show-all');
    showAll.on('pointerdown', () => { this.isolatedResidentId = null; Sfx.play('select'); this.refresh(); });
    this.root.add([showAll, scene.add.text(765, 431, 'SHOW ALL ROUTES', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink,
    }).setOrigin(0.5)]);
    const previous = cozyPanel(scene, 681, 469, 34, 30, COZY_THEME.green, 11)
      .setInteractive({ useHandCursor: true }).setName('world-routes-day-previous');
    const next = cozyPanel(scene, 849, 469, 34, 30, COZY_THEME.green, 11)
      .setInteractive({ useHandCursor: true }).setName('world-routes-day-next');
    previous.on('pointerdown', () => this.moveDay(-1));
    next.on('pointerdown', () => this.moveDay(1));
    this.dayText = scene.add.text(765, 463, '', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '11px', color: COZY_THEME.ink,
    }).setOrigin(0.5).setName('world-routes-day-label');
    this.clockText = scene.add.text(765, 484, '', {
      fontFamily: COZY_THEME.font, fontSize: '8px', color: COZY_THEME.muted,
    }).setOrigin(0.5).setName('world-routes-clock-label');
    this.root.add([previous, next,
      scene.add.text(681, 469, '‹', { fontFamily: COZY_THEME.font, fontSize: '22px', color: COZY_THEME.cream }).setOrigin(0.5),
      scene.add.text(849, 469, '›', { fontFamily: COZY_THEME.font, fontSize: '22px', color: COZY_THEME.cream }).setOrigin(0.5),
      this.dayText, this.clockText]);
    this.root.add(scene.add.text(351, 505, 'Colored pin = where they are now  •  A door pin means they are inside', {
      fontFamily: COZY_THEME.font, fontSize: '9px', color: COZY_THEME.muted,
    }).setOrigin(0.5));
    if (mapEditorEnabled()) {
      const edit = cozyPanel(scene, 765, 505, 222, 24, COZY_THEME.peach, 9)
        .setInteractive({ useHandCursor: true }).setName('world-routes-edit');
      edit.on('pointerdown', () => window.open(mapEditorUrl('routes'), '_blank', 'noopener'));
      this.root.add([edit, scene.add.text(765, 505, 'EDIT NPC ROUTES  ↗', {
        fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink,
      }).setOrigin(0.5)]);
    }
    this.bindKeyboard();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => setWorldRoutesModalOpen(false));
  }

  /** Open at the current weekday and retain the paused world. */
  open(event?: KeyboardEvent): void {
    if (event) this.keyboardEvents.add(event);
    const day = GameState.instance.day;
    this.selectedWeekday = (day - 1) % WEEK_DAYS.length;
    this.isolatedResidentId = null;
    setWorldRoutesModalOpen(true);
    this.root.setVisible(true);
    cozyPop(this.scene, this.root);
    this.refresh();
  }

  /** Mirror the local modal state without changing any saved GameState field. */
  update(): void {
    this.root.setVisible(isWorldRoutesModalOpen() && GameState.instance.paused);
  }

  /** Tell UIScene whether this nested atlas owns pause input. */
  isOpen(): boolean { return isWorldRoutesModalOpen(); }

  /** Return to Pause and keep the simulation paused. */
  private close(): void {
    setWorldRoutesModalOpen(false);
    this.root.setVisible(false);
    Sfx.play('select');
  }

  /** Cycle within the current seven-day page while preserving save-specific day numbers. */
  private moveDay(direction: -1 | 1): void {
    this.selectedWeekday = (this.selectedWeekday + direction + WEEK_DAYS.length) % WEEK_DAYS.length;
    Sfx.play('select');
    this.refresh();
  }

  /** Convert the selected weekday into the actual day number in the current game week. */
  private selectedDay(): number {
    const currentDay = GameState.instance.day;
    return currentDay - ((currentDay - 1) % WEEK_DAYS.length) + this.selectedWeekday;
  }

  /** Format the game's minutes-since-06:00 clock for the selected-day locator caption. */
  private clockLabel(): string {
    const total = (6 * 60 + GameState.instance.timeOfDay) % (24 * 60);
    const hour24 = Math.floor(total / 60), minute = Math.floor(total % 60);
    const hour = hour24 % 12 || 12;
    return `${hour}:${String(minute).padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
  }

  /** Rebuild all detached routes and their click targets for the selected day. */
  private refresh(): void {
    this.map = getMapData(SceneKey.Town);
    if (this.map.w !== MAP.w || this.map.h !== MAP.h) {
      throw new Error(`World routes: Town is ${this.map.w}x${this.map.h}, atlas expects ${MAP.w}x${MAP.h}`);
    }
    const day = this.selectedDay(), timeOfDay = GameState.instance.timeOfDay;
    const snapshots = TOWN_RESIDENTS.map(resident => residentRouteSnapshot(resident.id as ResidentId, day, timeOfDay, this.map));
    this.dayText.setText(`${WEEK_DAYS[this.selectedWeekday]}  ·  Day ${day}`);
    this.clockText.setText(`Routes at ${this.clockLabel()}   •   ‹  › change day`);
    this.mapRoot.removeAll(true);
    this.legendRoot.removeAll(true);
    this.drawAtlasBase();
    snapshots.forEach((snapshot, index) => this.drawRoute(snapshot, index));
    snapshots.forEach((snapshot, index) => this.drawMarker(snapshot, index));
    snapshots.forEach((snapshot, index) => this.drawLegendRow(snapshot, index));
    const selected = this.isolatedResidentId ? snapshots.find(snapshot => snapshot.residentId === this.isolatedResidentId) : null;
    const resident = selected ? TOWN_RESIDENTS.find(value => value.id === selected.residentId) : null;
    this.selectionText.setText(selected && resident
      ? `${resident.name} · ${selected.inside ? 'Inside' : this.activityLabel(selected.activity)}\n${selected.locationLabel}`
      : 'Select a name or portrait pin to follow one route.');
    const debug: WorldRoutesDebugView = {
      selectedDay: day,
      dayLabel: WEEK_DAYS[this.selectedWeekday],
      isolatedResidentId: this.isolatedResidentId,
      routes: snapshots.map((snapshot, index) => ({ residentId: snapshot.residentId, color: ROUTE_COLORS[index],
        visible: this.isolatedResidentId === null || this.isolatedResidentId === snapshot.residentId,
        inside: snapshot.inside, locationLabel: snapshot.locationLabel, partnerId: snapshot.partnerId,
        pointCount: snapshot.path.length, marker: { ...snapshot.position } })),
    };
    this.root.setData('debugView', debug);
  }

  /**
   * Draw the world-region tabs, the painted Town's traced ground, its doors, and the exits.
   * Solid tiles (buildings, fences, trees) are drawn darker than open ground, so roads and
   * lawns read as the walkable shape of the Town. Each door gets a dot in its building's accent.
   */
  private drawAtlasBase(): void {
    const graphics = this.scene.add.graphics().setName('world-routes-atlas-base');
    const terrain: Record<Ground, number> = { grass: 0x91ad72, dirt: 0xc6a36b, water: 0x6e9fb1,
      floor: 0xd3ba87, sand: 0xd9c485, stone: 0x8f9384, cave: 0x6a695f, cliff: 0x66725c };
    const solidTerrain: Record<Ground, number> = { grass: 0x5f7d4a, dirt: 0x8c6f4f, water: 0x4f7f93,
      floor: 0x9c8660, sand: 0xa8955f, stone: 0x666a5d, cave: 0x4c4b44, cliff: 0x4c5745 };
    graphics.fillStyle(0x789163, 1).fillRoundedRect(MAP.x - 6, MAP.y - 6, MAP.w * MAP.scale + 12, MAP.h * MAP.scale + 12, 13);
    for (let ty = 0; ty < this.map.h; ty++) for (let tx = 0; tx < this.map.w; tx++) {
      const ground = this.map.ground[ty][tx];
      graphics.fillStyle(this.map.solid[ty][tx] ? solidTerrain[ground] : terrain[ground], 1)
        .fillRect(MAP.x + tx * MAP.scale, MAP.y + ty * MAP.scale, Math.ceil(MAP.scale), Math.ceil(MAP.scale));
    }
    for (const building of TOWN_BUILDINGS) {
      const door = townDoor(building);
      // The 2-tile door spans doorTx..doorTx+1, so its center is the right edge of doorTx.
      const x = MAP.x + (door.doorTx + 1) * MAP.scale, y = this.mapY(door.doorTy);
      graphics.fillStyle(COZY_THEME.leatherDark, 1).fillCircle(x, y, 4.2);
      graphics.fillStyle(building.accent, 1).fillCircle(x, y, 2.8);
    }
    this.mapRoot.add(graphics);
    // Card rows match the painted edge exits: Farm row 20 and Forest row 50 on the west edge,
    // and the 2-wide main road (columns 29-30) at the top (Mountain) and bottom (Beach).
    const roadX = MAP.x + 30 * MAP.scale;
    // The Mountain and Beach cards sit just right of the road. Centered on it, the Mountain card covered the
    // end of the title and subtitle (they end near x 292) and the Beach card covered the map's bottom rows.
    const besideRoadX = roadX + 10 + 96 / 2;
    this.addRegionCard(58, this.mapY(20), 84, 62, 'FARM', 'Home road', { side: 'west' });
    this.addRegionCard(58, this.mapY(50), 84, 62, 'FOREST', 'Lower trail', { side: 'west' });
    this.addRegionCard(besideRoadX, 55, 96, 26, 'MOUNTAIN', 'Mine road', { side: 'north', roadX });
    this.addRegionCard(besideRoadX, 484, 96, 26, 'BEACH', 'South road', { side: 'south', roadX });
    const townLabel = cozyPanel(this.scene, 440, 91, 92, 22, COZY_THEME.green, 9);
    this.mapRoot.add([townLabel, this.scene.add.text(440, 91, 'TOWN', {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '8px', color: COZY_THEME.cream,
    }).setOrigin(0.5)]);
  }

  /**
   * Add one surrounding-region tab without pretending its interior route exists.
   * @param x card center x, in atlas pixels
   * @param y card center y, in atlas pixels
   * @param width card width
   * @param height card height; at least 26, so the title and hint lines fit
   * @param title region name, e.g. 'MOUNTAIN'
   * @param hint the road that leads there, e.g. 'Mine road'
   * @param link which map edge the card joins and, for north and south, the road's x (see RegionLink)
   */
  private addRegionCard(x: number, y: number, width: number, height: number, title: string, hint: string,
    link: RegionLink): void {
    const card = cozyPanel(this.scene, x, y, width, height, COZY_THEME.pocket, 12).setStrokeStyle(1, COZY_THEME.border);
    // The two lines are grouped at the card's center; this spacing fits the 26 px Mountain and Beach cards.
    this.mapRoot.add([card,
      this.scene.add.text(x, y - 6, title, { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: COZY_THEME.ink }).setOrigin(0.5),
      this.scene.add.text(x, y + 7, hint, { fontFamily: COZY_THEME.font, fontSize: '7px', color: COZY_THEME.muted }).setOrigin(0.5)]);
    const line = this.scene.add.graphics().lineStyle(3, COZY_THEME.border, 0.8);
    if (link.side === 'west') {
      line.lineBetween(x + width / 2, y, MAP.x - 3, y);
    } else {
      // An L-shaped line: from the card's left edge across to the road, then along the road to the map edge.
      const mapEdgeY = link.side === 'north' ? MAP.y - 4 : MAP.y + MAP.h * MAP.scale + 4;
      line.lineBetween(x - width / 2, y, link.roadX, y);
      line.lineBetween(link.roadX, y, link.roadX, mapEdgeY);
    }
    this.mapRoot.add(line);
  }

  /** Draw one resident's exact home-to-social path with a dark readability stroke. */
  private drawRoute(snapshot: ResidentRouteSnapshot, index: number): void {
    const visible = this.isolatedResidentId === null || this.isolatedResidentId === snapshot.residentId;
    if (!visible) return;
    const draw = (width: number, color: number, alpha: number): Phaser.GameObjects.Graphics => {
      const graphics = this.scene.add.graphics().lineStyle(width, color, alpha).setName(`world-route-${snapshot.residentId}`);
      const offset = (index - (TOWN_RESIDENTS.length - 1) / 2) * 0.12;
      graphics.beginPath();
      snapshot.path.forEach((point, pointIndex) => {
        const x = this.mapX(point.tx) + offset, y = this.mapY(point.ty) + offset;
        if (pointIndex === 0) graphics.moveTo(x, y); else graphics.lineTo(x, y);
      });
      graphics.strokePath();
      return graphics;
    };
    this.mapRoot.add(draw(4.2, COZY_THEME.leatherDark, 0.52));
    this.mapRoot.add(draw(2.1, ROUTE_COLORS[index], this.isolatedResidentId ? 1 : 0.9));
  }

  /** Draw a clickable current-position portrait bubble for one visible route. */
  private drawMarker(snapshot: ResidentRouteSnapshot, index: number): void {
    if (this.isolatedResidentId !== null && this.isolatedResidentId !== snapshot.residentId) return;
    const x = this.mapX(snapshot.position.tx), y = this.mapY(snapshot.position.ty);
    const radius = this.isolatedResidentId ? 15 : 12;
    const bubble = this.scene.add.circle(x, y, radius, 0xfff5d6, 1)
      .setStrokeStyle(3, ROUTE_COLORS[index]).setName(`world-route-marker-${snapshot.residentId}`)
      .setInteractive({ useHandCursor: true });
    bubble.on('pointerdown', () => this.toggleResident(snapshot.residentId));
    const portrait = this.residentPortrait(snapshot.residentId, x, y + (snapshot.inside ? -1 : 0), radius);
    const badge = snapshot.inside
      ? this.scene.add.text(x + 10, y + 9, '⌂', { fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '8px', color: COZY_THEME.cream,
        backgroundColor: '#4c3a30', padding: { x: 2, y: 0 } }).setOrigin(0.5)
      : null;
    this.mapRoot.add(badge ? [bubble, portrait, badge] : [bubble, portrait]);
  }

  /**
   * Build a compact face crop of one resident's pixel-art figure for a map pin.
   * @param id the resident shown
   * @param x pin centre x
   * @param y pin centre y
   * @param radius pin radius; the face fills about 1.65 of it
   * @returns the cropped sprite, not yet added to any container
   * @throws for an unknown resident
   */
  private residentPortrait(id: ResidentId, x: number, y: number, radius: number): Phaser.GameObjects.Sprite {
    if (!TOWN_RESIDENTS.some(value => value.id === id)) throw new Error(`World routes: missing resident ${id}`);
    const cropY = 1, cropHeight = 21, scale = radius * 1.65 / cropHeight;
    const offsetY = (64 / 2 - cropY - cropHeight / 2) * scale;
    return this.scene.add.sprite(x, y + offsetY, AppearanceTextureSystem.forGame(this.scene.game).residentTextureFor(id), 0)
      .setCrop(38, cropY, 20, cropHeight).setOrigin(0.5).setScale(scale).setName(`world-route-portrait-${id}`);
  }

  /** Draw one clickable route key with partner and indoor status. */
  private drawLegendRow(snapshot: ResidentRouteSnapshot, index: number): void {
    const resident = TOWN_RESIDENTS.find(value => value.id === snapshot.residentId);
    const partner = TOWN_RESIDENTS.find(value => value.id === snapshot.partnerId);
    if (!resident || !partner) throw new Error(`World routes: incomplete legend for ${snapshot.residentId}`);
    const selected = this.isolatedResidentId === snapshot.residentId;
    const y = 91 + index * 25;
    const row = cozyPanel(this.scene, 765, y, 230, 22, selected ? COZY_THEME.green : COZY_THEME.paper, 8)
      .setStrokeStyle(selected ? 2 : 1, selected ? ROUTE_COLORS[index] : COZY_THEME.border)
      .setInteractive({ useHandCursor: true }).setName(`world-route-legend-${snapshot.residentId}`);
    row.on('pointerdown', () => this.toggleResident(snapshot.residentId));
    const color = this.scene.add.circle(660, y, 5, ROUTE_COLORS[index]).setStrokeStyle(1, COZY_THEME.leatherDark);
    const name = this.scene.add.text(672, y, resident.name, {
      fontFamily: COZY_THEME.font, fontStyle: 'bold', fontSize: '9px', color: selected ? COZY_THEME.cream : COZY_THEME.ink,
    }).setOrigin(0, 0.5);
    const note = this.scene.add.text(834, y, snapshot.inside ? `⌂ ${partner.name}` : `with ${partner.name}`, {
      fontFamily: COZY_THEME.font, fontSize: '8px', color: selected ? '#f3e8c3' : COZY_THEME.muted,
    }).setOrigin(1, 0.5);
    this.legendRoot.add([row, color, name, note]);
  }

  /** Toggle one isolated route and redraw every layer with the new visibility state. */
  private toggleResident(id: ResidentId): void {
    this.isolatedResidentId = this.isolatedResidentId === id ? null : id;
    Sfx.play('select');
    this.refresh();
  }

  /** Convert a schedule activity into a short atlas label. */
  private activityLabel(activity: ResidentRouteSnapshot['activity']): string {
    if (activity === 'traveling') return 'Walking';
    if (activity === 'socializing') return 'Visiting';
    return activity === 'work' ? 'Working' : 'At home';
  }

  /** Project one Town tile center onto the ledger. */
  private mapX(tx: number): number { return MAP.x + (tx + 0.5) * MAP.scale; }

  /** Project one Town tile center onto the ledger. */
  private mapY(ty: number): number { return MAP.y + (ty + 0.5) * MAP.scale; }

  /** Keep map-only keyboard controls local and consume each native event once. */
  private bindKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) throw new Error('World routes: keyboard input unavailable');
    keyboard.addCapture(['LEFT', 'RIGHT']);
    keyboard.on('keydown-LEFT', (event: KeyboardEvent) => {
      if (!isWorldRoutesModalOpen() || this.keyboardEvents.has(event)) return;
      this.keyboardEvents.add(event); this.moveDay(-1);
    });
    keyboard.on('keydown-RIGHT', (event: KeyboardEvent) => {
      if (!isWorldRoutesModalOpen() || this.keyboardEvents.has(event)) return;
      this.keyboardEvents.add(event); this.moveDay(1);
    });
  }
}
