/**
 * One world-scene implementation serves twelve permanently keyed public interiors and their fixed residents.
 * Eleven rooms are hand-painted (one backdrop image, see world/CivicRoomArt.ts) and the clinic is still built
 * from shared furniture and procedural walls. Both kinds share one blueprint contract (config/CivicInteriors.ts)
 * for the service point, resident route, bedroom, heart gate, and bed.
 */
import { BaseWorldScene } from './BaseWorldScene';
import type { TownBuilding } from '../config/TownBuildings';
import { furnitureView, furnitureDefinition, furnitureDepth } from '../config/Furniture';
import { FurnitureSurfaceRenderer } from '../world/FurnitureSurfaceRenderer';
import { FEET_CENTER_DY, TILE, worldToTile } from '../config/GameConfig';
import { TownResident } from '../entities/TownResident';
import { residentForBuilding } from '../config/TownResidents';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { renderCivicFeatures } from '../world/CivicDecor';
import { GameState } from '../state/GameState';
import { relationshipView } from '../systems/RelationshipSystem';
import { InputBus } from '../input/InputBus';
import { Sfx } from '../systems/SfxSystem';
import { civicInteriorBlueprint, type CivicInteriorBlueprint, type CivicTileRect } from '../config/CivicInteriors';
import { CIVIC_ROOM_STYLE } from '../world/CivicRoomArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { renderExpandedCivicInterior } from '../world/CivicInteriorRenderer';
import { interactWithWaitingCuddle, witnessCuddleInScene } from '../systems/CuddleSystem';
import { SceneKey } from '../config/AssetKeys';
import { KeeperSocialSystem } from '../systems/KeeperSocialSystem';
import type { ResidentId } from '../config/ResidentRelationships';
import { civicInteriorLights, type InteriorLight } from '../config/InteriorLights';

/** Scene lifecycle recreates immutable civic fixtures; all player travel and saving remain in shared systems. */
export class CivicInteriorScene extends BaseWorldScene {
  /** Every permanent resident has one scene-owned actor; the schedule activates only current visitors. */
  private readonly residents = new Map<string, TownResident>();
  private privateGate: Phaser.GameObjects.Zone | null = null;
  private privateGateView: Phaser.GameObjects.Graphics | null = null;
  private privateExitOpen = false;
  private privateGateInitialized = false;
  private privateGateWasUnlocked = false;
  /** Solid tiles ("tx,ty") that block a witness's line of sight inside this room. Rebuilt on create. */
  private readonly blockedSightTiles = new Set<string>();
  /** Register one catalog building under its stable world key. */
  constructor(private readonly building: TownBuilding) { super(building.scene); }

  /**
   * Draw the room (one painting, or built walls plus furniture), then add every resident actor and the heart gate.
   * The painting's renderer removes itself on scene shutdown, so the scene keeps no handle to it.
   */
  protected override onCreated(): void {
    const room = this.room();
    if (room.layout === 'painted') {
      // why: a painted room's furniture is part of the image; collision comes from the room's walk rows.
      new PaintedRoomRenderer(this, room.art, CIVIC_ROOM_STYLE, 0, 0, `civic-${room.id}`, this.player);
    } else {
      renderExpandedCivicInterior(this, room);
      renderCivicFeatures(this, this.building);
      this.renderFixtures();
    }
    const owner = residentForBuilding(this.building.id);
    const routeAnchor = room.residentRoute;
    this.residents.clear();
    this.blockedSightTiles.clear();
    for (let ty = 0; ty < this.map.h; ty++) for (let tx = 0; tx < this.map.w; tx++) {
      if (this.map.solid[ty][tx]) this.blockedSightTiles.add(`${tx},${ty}`);
    }
    // Visitors stay interactable but never trap the player against furniture or the room exit.
    for (const definition of TOWN_RESIDENTS) {
      const actor = new TownResident(this, definition, this.map, definition.id !== owner.id, routeAnchor);
      this.residents.set(definition.id, actor);
    }
    this.createPrivateGate();
  }

  /** Draw a built room's shared furniture on its exact collision footprints (painted rooms have none). */
  private renderFixtures(): void {
    const surfaces = new FurnitureSurfaceRenderer(this);
    const pieces = this.building.room.fixtures.map(piece => ({ ...piece, scene: this.building.scene }));
    for (const piece of pieces) {
      const view = furnitureView(piece.item, piece.rotation), texture = this.textures.get(view.texture);
      if (!this.textures.exists(view.texture)) throw new Error(`Civic interior: missing ${view.texture}`);
      if (view.crop && view.frame && !texture.has(view.frame)) texture.add(view.frame, 0, view.crop.x, view.crop.y, view.crop.w, view.crop.h);
      const presentation = surfaces.resolve(piece, pieces);
      this.add.image((piece.tx + view.w / 2) * TILE, (piece.ty + view.h) * TILE, presentation.texture, presentation.frame)
        .setOrigin(view.originX, view.originY).setDisplaySize(view.displayW, view.displayH).setAngle(view.angle)
        .setDepth(furnitureDefinition(piece.item).blocking ? furnitureDepth(piece.item, piece.ty, view.h) : -8)
        .setName(`civic-fixture-${this.building.id}-${piece.tx}-${piece.ty}`);
    }
  }

  /** Light this building with its wall sconces, home-wing stove and lamp, and any room extras. */
  protected override interiorLights(): readonly InteriorLight[] {
    return civicInteriorLights(this.building);
  }

  /** This building's room contract (painted or built); throws for an unknown building. */
  private room(): CivicInteriorBlueprint {
    return civicInteriorBlueprint(this.building.id);
  }

  /** The bedroom threshold row and the hearts it needs. */
  private privateThreshold(): CivicTileRect & { requiredHearts: number } {
    return this.room().privateThreshold;
  }

  /** The actual bedroom, so public floor below the threshold never counts as trapped. */
  private bedroomBounds(): CivicTileRect {
    return this.room().bedroom;
  }

  /** Create this resident home's live relationship gate without hiding the visible bedroom. */
  private createPrivateGate(): void {
    const threshold = this.privateThreshold();
    const gateName = `civic-private-gate-${this.building.id}`;
    const viewName = `civic-private-gate-view-${this.building.id}`;
    const gate = this.add.zone((threshold.tx + threshold.w / 2) * TILE, (threshold.ty + 0.5) * TILE,
      threshold.w * TILE, 8).setName(gateName);
    this.physics.add.existing(gate, true);
    this.physics.add.collider(this.player, gate);
    this.privateGate = gate;
    const x = threshold.tx * TILE, y = threshold.ty * TILE;
    const view = this.add.graphics().setDepth((threshold.ty + 1) * TILE + 2).setName(viewName);
    // A low heart gate communicates private access while keeping the bedroom visible.
    view.fillStyle(0x2a1e21, 0.22).fillEllipse(x + threshold.w * TILE / 2, y + 15, threshold.w * TILE + 8, 6);
    view.fillStyle(0x4b302d).fillRect(x - 2, y + 1, 5, 15).fillRect(x + threshold.w * TILE - 3, y + 1, 5, 15);
    view.fillStyle(0xc28a52).fillRect(x, y + 3, 2, 10).fillRect(x + threshold.w * TILE - 2, y + 3, 2, 10);
    view.lineStyle(3, 0xa96a43).lineBetween(x + 2, y + 8, x + threshold.w * TILE / 2 - 4, y + 12)
      .lineBetween(x + threshold.w * TILE / 2 + 4, y + 12, x + threshold.w * TILE - 2, y + 8);
    // why: every painting already shows a heart on its bedroom door, so a painted room draws only the rope;
    // a second heart under the painted one reads as clutter. The built clinic has no painted heart and keeps its own.
    if (this.room().layout !== 'painted') {
      const heartX = x + threshold.w * TILE / 2;
      view.fillStyle(0xd66b62).fillCircle(heartX - 3, y + 8, 4).fillCircle(heartX + 3, y + 8, 4)
        .fillTriangle(heartX - 7, y + 9, heartX + 7, y + 9, heartX, y + 17);
      view.fillStyle(0xf3c093).fillCircle(heartX - 3, y + 6, 1);
    }
    this.privateGateView = view;
    this.refreshPrivateGate();
  }

  /** Read current hearts every frame and keep a newly locked room from trapping its occupant. */
  private refreshPrivateGate(): void {
    if (!this.privateGate || !this.privateGateView) return;
    const threshold = this.privateThreshold();
    const resident = residentForBuilding(this.building.id);
    const hearts = relationshipView(resident.id).hearts;
    const playerTileX = Math.floor(this.player.x / TILE);
    const playerTileY = Math.floor((this.player.y + FEET_CENTER_DY) / TILE);
    const bedroom = this.bedroomBounds();
    const insideBedroom = playerTileX >= bedroom.tx && playerTileX < bedroom.tx + bedroom.w &&
      playerTileY >= bedroom.ty && playerTileY < bedroom.ty + bedroom.h;
    if (!this.privateGateInitialized) {
      this.privateExitOpen = hearts < threshold.requiredHearts && insideBedroom;
      this.privateGateWasUnlocked = hearts >= threshold.requiredHearts;
      this.privateGateInitialized = true;
    }
    if (hearts >= threshold.requiredHearts) {
      this.privateExitOpen = false;
      this.privateGateWasUnlocked = true;
    } else {
      if (this.privateGateWasUnlocked && insideBedroom) this.privateExitOpen = true;
      if (this.privateExitOpen && playerTileY < threshold.ty) this.privateExitOpen = false;
      this.privateGateWasUnlocked = false;
    }
    const locked = hearts < threshold.requiredHearts && !this.privateExitOpen;
    const body = this.privateGate.body as Phaser.Physics.Arcade.StaticBody;
    body.enable = locked;
    if (locked) body.updateFromGameObject();
    this.privateGateView.setVisible(locked);
  }

  /**
   * Preserve the shared update loop, animate this room's residents using their current clocks, then let any
   * visible resident witness an active private moment in this room (same facing cone and walls as Town).
   */
  override update(time: number, delta: number): void {
    super.update(time, delta);
    for (const resident of this.residents.values()) resident.update();
    this.witnessPrivateMoments();
    this.refreshPrivateGate();
    if (this.building.scene === SceneKey.TownBar) this.checkWayfarerPlans();
  }

  /**
   * Count a Wayfarer plan as kept when the keeper is inside while the planned resident's route has them here.
   * KeeperSocialSystem decides; this scene only reports the thank-you lines as toasts.
   */
  private checkWayfarerPlans(): void {
    const gs = GameState.instance;
    // why: a bar plan does not use a resident tile (the route itself places the resident inside), so none is passed.
    const lines = KeeperSocialSystem.checkPlans(SceneKey.TownBar, worldToTile(gs.player.x, gs.player.y), () => null);
    for (const line of lines) this.game.events.emit('toast', line);
  }

  /** Toast each new witness reaction. The witness pass itself owns odds, reports, and timing. */
  private witnessPrivateMoments(): void {
    const observers = [...this.residents].flatMap(([id, resident]) => {
      const observation = resident.observation();
      return observation ? [{ residentId: id as ResidentId, ...observation }] : [];
    });
    for (const reaction of witnessCuddleInScene(this.scene.key as SceneKey, observers, this.blockedSightTiles)) {
      this.game.events.emit('toast', reaction);
    }
  }

  /**
   * Open the building-fit service, explain its private threshold, or address the fixed resident.
   * @param tx tile column the keeper is acting on
   * @param ty tile row the keeper is acting on
   * @returns true when this room handled the action
   */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    const resident = residentForBuilding(this.building.id);
    if (interactWithWaitingCuddle(this.scene.key as SceneKey, tx, ty, resident.id)) return true;
    const room = this.room(), service = room.servicePoint;
    if (tx === service.tx && ty === service.ty) {
      const stand = room.serviceStand;
      const playerTile = worldToTile(GameState.instance.player.x, GameState.instance.player.y);
      if (playerTile.tx !== stand.tx || playerTile.ty !== stand.ty || GameState.instance.player.facing !== stand.facing) {
        this.game.events.emit('toast', `Stand in front of the ${room.station.toLowerCase()} and face it.`);
        Sfx.play('deny');
        return true;
      }
      // why: the Market's stock panel is the default shop panel; every other room names its civic service.
      GameState.instance.civicServiceBuilding = room.id === 'market' ? null : room.id;
      GameState.instance.marketPanelOpen = true;
      InputBus.instance.clearAll();
      Sfx.play('select');
      return true;
    }
    const threshold = this.privateThreshold();
    if (ty === threshold.ty && tx >= threshold.tx && tx < threshold.tx + threshold.w &&
      relationshipView(resident.id).hearts < threshold.requiredHearts) {
      this.game.events.emit('toast', `${resident.name}'s room opens at ${threshold.requiredHearts} hearts.`);
      Sfx.play('deny');
      return true;
    }
    for (const actor of this.residents.values()) if (actor.interact(tx, ty)) return true;
    return false;
  }
}
