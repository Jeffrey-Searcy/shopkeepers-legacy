/**
 * JailScene is the locked watch-house cell used after a validated severe resident-chat outcome.
 * The player can walk inside the cell and use its cot, but cannot use tools, inventory, or shop actions.
 * The room is one painting (world/CivicRoomArt.ts JAIL_ART): the cell bars are a front layer that draws over
 * anyone standing behind them, and Captain Maren stands at the watch table outside the cell.
 */
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { GameState } from '../state/GameState';
import { SaveSystem } from '../systems/SaveSystem';
import { transitionTo } from '../systems/SceneTransitionSystem';
import { getMapData } from '../world/MapDef';
import { BaseWorldScene } from './BaseWorldScene';
import { TownGuard } from '../entities/TownGuard';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { TownResident } from '../entities/TownResident';
import { jailLights, type InteriorLight } from '../config/InteriorLights';
import { CIVIC_ROOM_STYLE, JAIL_ANCHORS, JAIL_ART } from '../world/CivicRoomArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';

/** Locked service room. Captain Maren remains outside the bars and outside the romance pool. */
export class JailScene extends BaseWorldScene {
  private readonly jailedResidents: TownResident[] = [];
  /** Register the dedicated holding-cell world scene. */
  constructor() {
    super(SceneKey.Jail);
  }

  /**
   * Draw the painted watch house, put Captain Maren at her table, and add every resident (only jailed ones show).
   * The painting's renderer removes itself on scene shutdown, so the scene keeps no handle to it.
   */
  protected override onCreated(): void {
    new PaintedRoomRenderer(this, JAIL_ART, CIVIC_ROOM_STYLE, 0, 0, 'jail', this.player);
    new TownGuard(this, JAIL_ANCHORS.guard.tx, JAIL_ANCHORS.guard.ty);
    this.jailedResidents.length = 0;
    for (const definition of TOWN_RESIDENTS) {
      const actor = new TownResident(this, definition, this.map, true);
      this.jailedResidents.push(actor);
      this.physics.add.collider(this.player, actor.collider);
    }
  }

  /** Keep caught residents visible in the holding cells until their release day. */
  override update(time: number, delta: number): void {
    super.update(time, delta);
    for (const resident of this.jailedResidents) resident.update();
  }

  /** Light the jail with its painted lanterns and candles instead of the flat night overlay. */
  protected override interiorLights(): readonly InteriorLight[] {
    return jailLights();
  }

  /** Keep movement and bed interaction, while BaseWorldScene blocks every other player action. */
  protected override restrictPlayerActions(): boolean {
    return true;
  }

  /** Complete the sentence, then save the next morning at Farm with exactly half stamina. */
  protected override sleep(): void {
    const gs = GameState.instance;
    gs.dialogue = null;
    super.sleep(0.5, false);
    const farm = getMapData(SceneKey.Farm);
    const spawn = farm.spawns.find(candidate => candidate.id === 'from_home');
    if (!spawn) throw new Error('JailScene: Farm has no morning release spawn');
    gs.player = { x: spawn.tx * TILE + TILE / 2, y: spawn.ty * TILE + TILE / 2, facing: 'down', stamina: gs.player.stamina };
    transitionTo(this, SceneKey.Farm, 'from_home');
    // transitionTo sets activeScene before validation, so the save contains a valid Farm position.
    SaveSystem.saveCurrent();
  }
}
