/**
 * TownScene — the Town east of the Farm: the plaza and market stalls, the river, and thirteen painted
 * buildings (the twelve businesses and the watch house) along its roads.
 *
 * Map data (MapDef.buildPaintedTown, from TOWN_GRID, TOWN_DOORS and TOWN_NODES) owns ground, collision, the
 * door and road warps and the meadow stones. This scene draws the painting (TOWN_ART through
 * PaintedRoomRenderer: backdrop, the walk-behind roofs, trees and lamps, and the lamp and forge glows), keeps
 * the watch-house guard by its stairs, and runs the scheduled residents.
 *
 * Doors: the painted doors do not swing, so entering a building is one short step up to the door's middle.
 * Visiting hours (TownBuildingAccessSystem) can turn the keeper back at the door, and the watch house's door
 * always does (its holding cells are not public).
 *
 * Town life shown here:
 *  - resident meetings: a speech bubble over whoever is talking, stepping through the scene's 4-6 lines
 *    across the meeting window;
 *  - local-model scenes asked for ahead of time (TownSocialLifeSystem.pregenerateUpcomingVoices);
 *  - kept invites (TownLifeSystem.checkInvite) and kept keeper plans (KeeperSocialSystem.checkPlans),
 *    announced with a toast.
 */
import { AnimKey, SceneKey } from '../config/AssetKeys';
import { BaseWorldScene } from './BaseWorldScene';
import { TOWN_BUILDINGS, townDoor } from '../config/TownBuildings';
import type { WarpDef } from '../world/MapDef';
import { TOWN_ANCHORS, TOWN_ART, TOWN_STYLE } from '../world/TownArt';
import { PaintedRoomRenderer } from '../world/PaintedRoomRenderer';
import { FEET_CENTER_DY, TILE } from '../config/GameConfig';
import { GameState } from '../state/GameState';
import { KeeperSocialSystem } from '../systems/KeeperSocialSystem';
import { TOWN_RESIDENTS } from '../config/TownResidents';
import { TownResident } from '../entities/TownResident';
import { activeTownMeetings } from '../systems/TownScheduleSystem';
import { pregenerateUpcomingVoices, requestLocalVoiceForEvent, townSocialEvent } from '../systems/TownSocialLifeSystem';
import { TownLifeSystem } from '../systems/TownLifeSystem';
import { SettingsSystem } from '../systems/SettingsSystem';
import { townBuildingAccess } from '../systems/TownBuildingAccessSystem';
import { TownGuard } from '../entities/TownGuard';
import { tryStartNpcPairCuddle, witnessCuddleInScene } from '../systems/CuddleSystem';
import { CompanionWalkSystem } from '../systems/CompanionWalkSystem';
import type { ResidentId } from '../config/ResidentRelationships';

/** Speech bubble for one meeting pair. `shown` is the last text drawn, so the paper is redrawn only on change. */
interface TownConversationBubble {
  root: Phaser.GameObjects.Container;
  paper: Phaser.GameObjects.Graphics;
  speaker: Phaser.GameObjects.Text;
  line: Phaser.GameObjects.Text;
  shown: string;
}

/** Bubble width in world pixels. Text renders at 8px and is halved, so wrap width is twice this, minus padding. */
const BUBBLE_WIDTH = 132;
/** Most wrapped rows a bubble shows. Scene lines are capped at 180 characters, which fits in four rows. */
const BUBBLE_MAX_ROWS = 4;
/** Real milliseconds between checks for upcoming meetings that need a local-model scene. */
const PREGENERATE_INTERVAL_MS = 2000;
/** Hedge green behind the painting (the median of its edge), seen only when a wide window shows past the map's edge. */
const SURROUND_COLOR = 0x395f2a;

/** World scene whose map and route resolution remain owned by the shared transition system. */
export class TownScene extends BaseWorldScene {
  private readonly residents = new Map<string, TownResident>();
  private readonly conversationBubbles = new Map<string, TownConversationBubble>();
  private readonly voiceRequests = new Set<string>();
  private readonly blockedSightTiles = new Set<string>();
  private guard: TownGuard | null = null;
  private deniedWarpTarget: SceneKey | null = null;
  /** Scene time of the last pregeneration check (see PREGENERATE_INTERVAL_MS). */
  private lastPregenerateAt = -Infinity;
  /** Register under the Town world key. */
  constructor() {
    super(SceneKey.Town);
  }

  /**
   * Draw the painted Town, place the watch-house guard and create the scheduled residents.
   * @throws when the guard's anchor is not open ground (a tracing mistake in TownArt)
   */
  protected override onCreated(): void {
    new PaintedRoomRenderer(this, TOWN_ART, TOWN_STYLE, 0, 0, 'town', this.player);
    this.cameras.main.setBackgroundColor(SURROUND_COLOR);
    this.residents.clear();
    this.conversationBubbles.clear();
    this.voiceRequests.clear();
    this.guard = null;
    this.lastPregenerateAt = -Infinity;
    // why: a loaded or migrated save may not have run today's favor/invite upkeep yet; the "!" marker reads it.
    TownLifeSystem.refreshDay();
    KeeperSocialSystem.refreshDay();
    const post = TOWN_ANCHORS.guard;
    // why: the guard is a solid body; on a wall it would be unreachable, and on a spawn or a warp it would trap the keeper.
    const onWarp = this.map.warps.some(warp => post.tx >= warp.tx && post.tx < warp.tx + warp.w && post.ty >= warp.ty && post.ty < warp.ty + warp.h);
    if (this.map.solid[post.ty][post.tx] || onWarp || this.map.spawns.some(spawn => spawn.tx === post.tx && spawn.ty === post.ty)) {
      throw new Error(`TownScene: the guard's post (${post.tx},${post.ty}) must be open ground off every warp and arrival`);
    }
    this.guard = new TownGuard(this, post.tx, post.ty);
    this.physics.add.collider(this.player, this.guard.collider);
    this.blockedSightTiles.clear();
    for (let ty = 0; ty < this.map.h; ty++) for (let tx = 0; tx < this.map.w; tx++) {
      if (this.map.solid[ty][tx]) this.blockedSightTiles.add(`${tx},${ty}`);
    }
    // Scheduled residents stay interactable but do not hard-block doors or narrow public paths.
    for (const resident of TOWN_RESIDENTS) {
      const actor = new TownResident(this, resident, this.map);
      this.residents.set(resident.id, actor);
    }
  }

  /** Update all scheduled actors and nearby witnessed conversations after the shared world loop. */
  override update(time: number, delta: number): void {
    super.update(time, delta);
    this.resetDeniedDoorAfterLeaving();
    for (const resident of this.residents.values()) resident.update();
    this.updateCuddleSocialEvents();
    if (this.residents.size) {
      this.updateTownConversations();
      this.pregenerateMeetingVoices(time);
      this.checkKeptInvite();
      this.checkKeptPlans();
    }
  }

  /**
   * Count a keeper plan as kept when the keeper and the planned resident are both at the spot in its window.
   * KeeperSocialSystem decides; this scene only supplies live tiles and toasts the thank-you lines.
   */
  private checkKeptPlans(): void {
    const gs = GameState.instance;
    const lines = KeeperSocialSystem.checkPlans(SceneKey.Town, { tx: Math.floor(gs.player.x / TILE), ty: Math.floor(gs.player.y / TILE) },
      id => this.residentTile(id));
    for (const line of lines) this.game.events.emit('toast', line);
  }

  /**
   * Where a resident stands in Town right now, for kept plans and invites.
   * @param id the resident
   * @returns their follower tile while they walk with the keeper, else their scheduled body's tile, or null
   *   while that body is indoors or off its route (then a plan or invite cannot be kept yet)
   * @throws when the resident has no Town actor
   */
  private residentTile(id: ResidentId): { tx: number; ty: number } | null {
    if (CompanionWalkSystem.isWalking(id)) return this.companionTile(id);
    const actor = this.residents.get(id);
    if (!actor) throw new Error(`TownScene: resident ${id} has no Town actor`);
    const point = actor.position();
    return point ? { tx: Math.floor(point.x / TILE), ty: Math.floor(point.y / TILE) } : null;
  }

  /**
   * Every few seconds, ask the local model for the next meeting starting soon, so its lines are
   * ready when the pair meets. One request runs at a time; failures surface as a toast.
   * @param time scene time in milliseconds
   */
  private pregenerateMeetingVoices(time: number): void {
    if (!SettingsSystem.get().localNpcChat || time - this.lastPregenerateAt < PREGENERATE_INTERVAL_MS) return;
    this.lastPregenerateAt = time;
    const gs = GameState.instance;
    void pregenerateUpcomingVoices(gs.day, gs.timeOfDay).catch(error => {
      this.game.events.emit('toast', error instanceof Error ? error.message : String(error));
    });
  }

  /** Count today's invite as kept when the keeper and the invited resident are both at the spot. */
  private checkKeptInvite(): void {
    const invite = TownLifeSystem.activeInvite();
    if (!invite) return;
    const gs = GameState.instance;
    const line = TownLifeSystem.checkInvite(gs.timeOfDay,
      { tx: Math.floor(gs.player.x / TILE), ty: Math.floor(gs.player.y / TILE) }, this.residentTile(invite.residentId));
    if (line) this.game.events.emit('toast', line);
  }

  /** Reuse active social meetings for rare pair events and scan standing sessions with true facing sight. */
  private updateCuddleSocialEvents(): void {
    const gs = GameState.instance;
    const meetings = activeTownMeetings(gs.day, gs.timeOfDay);
    for (const meeting of meetings) {
      const first = this.residents.get(meeting.pair.residents[0])?.position();
      const second = this.residents.get(meeting.pair.residents[1])?.position();
      if (!first || !second) continue;
      tryStartNpcPairCuddle(`${gs.day}:${meeting.pair.bondId}`, meeting.pair.residents[0], meeting.pair.residents[1], {
        scene: SceneKey.Town, tx: Math.floor((first.x + second.x) / 2 / TILE), ty: Math.floor((first.y + second.y) / 2 / TILE),
      });
    }
    const observers = [...this.residents].flatMap(([id, resident]) => {
      const observation = resident.observation();
      return observation ? [{ residentId: id as import('../config/ResidentRelationships').ResidentId, ...observation }] : [];
    });
    for (const reaction of witnessCuddleInScene(SceneKey.Town, observers, this.blockedSightTiles)) this.game.events.emit('toast', reaction);
  }

  /** Re-arm closed-door feedback only after the player leaves the doorway's contact area. */
  private resetDeniedDoorAfterLeaving(): void {
    if (!this.deniedWarpTarget) return;
    const warp = this.map.warps.find(candidate => candidate.target === this.deniedWarpTarget);
    if (!warp) throw new Error(`TownScene: missing denied doorway ${this.deniedWarpTarget}`);
    const player = GameState.instance.player;
    const nearX = player.x >= (warp.tx - 1) * TILE && player.x < (warp.tx + warp.w + 1) * TILE;
    const nearY = player.y >= (warp.ty - 1) * TILE && player.y < (warp.ty + warp.h + 2) * TILE;
    if (!nearX || !nearY) this.deniedWarpTarget = null;
  }

  /** Let outdoor residents use the same authored Talk, Chat, and gift interaction as room residents. */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    if (this.guard?.interact(tx, ty)) return true;
    for (const resident of this.residents.values()) if (resident.interact(tx, ty)) return true;
    return false;
  }

  /**
   * Draw nearby meeting speech. The scene's lines are spread evenly across the meeting window, and the
   * bubble sits over whoever is speaking. Model work for an already-written authored event starts once
   * per witnessed event and never owns mechanics.
   */
  private updateTownConversations(): void {
    const gs = GameState.instance;
    const active = new Set<string>();
    for (const meeting of activeTownMeetings(gs.day, gs.timeOfDay)) {
      const first = this.residents.get(meeting.pair.residents[0]), second = this.residents.get(meeting.pair.residents[1]);
      const firstPosition = first?.position(), secondPosition = second?.position();
      if (!first || !second || !firstPosition || !secondPosition) continue;
      const centerX = (firstPosition.x + secondPosition.x) / 2, centerY = (firstPosition.y + secondPosition.y) / 2;
      if (Math.hypot(gs.player.x - centerX, gs.player.y - centerY) > 180) continue;
      const eventId = `${gs.day}:${meeting.pair.bondId}`, event = townSocialEvent(eventId);
      const span = meeting.endsAt - meeting.minute;
      if (span <= 0) throw new Error(`TownScene: meeting ${eventId} has an empty window`);
      const lineIndex = Math.min(event.lines.length - 1, Math.floor((gs.timeOfDay - meeting.minute) / span * event.lines.length));
      const line = event.lines[lineIndex];
      const resident = TOWN_RESIDENTS.find(candidate => candidate.id === line.residentId);
      if (!resident) throw new Error(`TownScene: missing speaker ${line.residentId}`);
      const speakerPosition = line.residentId === meeting.pair.residents[0] ? firstPosition : secondPosition;
      const bubble = this.conversationBubbles.get(meeting.pair.bondId) ?? this.createConversationBubble(meeting.pair.bondId);
      const visibleAction = event.action === 'friendly-chat' ? '' : ` · ${event.action.replace(/-/g, ' ').toUpperCase()}`;
      const speakerText = event.voiceError ? `${resident.name.toUpperCase()} · LOCAL VOICE ERROR` : `${resident.name.toUpperCase()}${visibleAction}`;
      this.drawConversationBubble(bubble, speakerText, event.voiceError ? '#b7473f' : '#684230', line.text);
      bubble.root.setPosition(speakerPosition.x, speakerPosition.y - 34)
        .setDepth(Math.max(firstPosition.y, secondPosition.y) + 120).setVisible(true);
      active.add(meeting.pair.bondId);
      if (SettingsSystem.get().localNpcChat && !this.voiceRequests.has(eventId) && event.source === 'authored') {
        this.voiceRequests.add(eventId);
        void requestLocalVoiceForEvent(eventId).catch(error => {
          this.game.events.emit('toast', error instanceof Error ? error.message : String(error));
        });
      }
    }
    for (const [bondId, bubble] of this.conversationBubbles) if (!active.has(bondId)) bubble.root.setVisible(false);
  }

  /** Create one empty world-space speech bubble. drawConversationBubble sizes it to its text. */
  private createConversationBubble(bondId: string): TownConversationBubble {
    const root = this.add.container(0, 0).setVisible(false).setName(`town-conversation-${bondId}`);
    const paper = this.add.graphics();
    const textLeft = -BUBBLE_WIDTH / 2 + 5;
    // Phaser's canvas text becomes unstable below 8px. Render at 8px, then halve the object.
    const speaker = this.add.text(textLeft, 0, '', { fontFamily: 'monospace', fontStyle: 'bold', fontSize: '8px', color: '#684230' }).setScale(0.5);
    const line = this.add.text(textLeft, 0, '', { fontFamily: 'monospace', fontSize: '8px', color: '#3a2720',
      wordWrap: { width: (BUBBLE_WIDTH - 10) * 2, useAdvancedWrap: true }, lineSpacing: 1, maxLines: BUBBLE_MAX_ROWS }).setScale(0.5);
    root.add([paper, speaker, line]);
    const result = { root, paper, speaker, line, shown: '' };
    this.conversationBubbles.set(bondId, result);
    return result;
  }

  /**
   * Fill a bubble and size its paper to the wrapped text. The bubble's origin is the tail tip, so the
   * bubble grows upward from the speaker's head. Redraws only when the text changes.
   * @param bubble bubble to fill
   * @param speakerText name line (with any action or error tag)
   * @param speakerColor name line color
   * @param text the spoken line
   */
  private drawConversationBubble(bubble: TownConversationBubble, speakerText: string, speakerColor: string, text: string): void {
    const key = `${speakerText}\u0000${speakerColor}\u0000${text}`;
    if (bubble.shown === key) return;
    bubble.shown = key;
    bubble.speaker.setText(speakerText).setColor(speakerColor);
    bubble.line.setText(text);
    const height = 4 + bubble.speaker.displayHeight + 1 + bubble.line.displayHeight + 3;
    const top = -6 - height, left = -BUBBLE_WIDTH / 2;
    bubble.speaker.setY(top + 3);
    bubble.line.setY(top + 4 + bubble.speaker.displayHeight);
    bubble.paper.clear()
      .fillStyle(0x3a2a24, 0.28).fillRoundedRect(left, top + 2, BUBBLE_WIDTH, height, 5)
      .fillStyle(0xfff0c8, 0.98).fillRoundedRect(left, top, BUBBLE_WIDTH, height, 5)
      .lineStyle(1, 0x8f684c, 1).strokeRoundedRect(left, top, BUBBLE_WIDTH, height, 5)
      .fillStyle(0xfff0c8, 0.98).fillTriangle(-5, -6, 5, -6, 0, 0);
  }

  /**
   * Step the keeper up to the middle of a building's door before the room loads; road exits stay immediate.
   * @param warp the warp the keeper walked onto
   * @param onReady called when the step ends (or at once for a road exit)
   */
  protected override animateEntrance(warp: WarpDef, onReady: () => void): void {
    const building = TOWN_BUILDINGS.find(candidate => candidate.scene === warp.target);
    if (!building) { onReady(); return; }
    const door = townDoor(building);
    GameState.instance.player.facing = 'up';
    this.player.play(AnimKey.PlayerWalkUp, true);
    this.tweens.add({ targets: this.player, x: door.centerX,
      y: door.sillY - 15 - FEET_CENTER_DY, duration: 100, ease: 'Linear',
      onUpdate: () => {
        GameState.instance.player.x = this.player.x;
        GameState.instance.player.y = this.player.y + FEET_CENTER_DY;
        this.player.setDepth(this.player.y + FEET_CENTER_DY);
      }, onComplete: onReady });
  }

  /** Enforce town visiting hours before the shared transition lock or door animation begins. */
  protected override enterWarp(warp: WarpDef): void {
    if (!this.canEnterDoor()) return;
    if (warp.target === SceneKey.Jail) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      const feetY = (warp.ty + warp.h) * TILE + 2;
      this.player.setY(feetY - FEET_CENTER_DY);
      GameState.instance.player.y = feetY;
      if (this.deniedWarpTarget !== warp.target) {
        this.deniedWarpTarget = warp.target;
        this.game.events.emit('toast', 'The watch office is open, but the holding cells are not public.');
      }
      return;
    }
    const building = TOWN_BUILDINGS.find(candidate => candidate.scene === warp.target);
    if (!building) { super.enterWarp(warp); return; }
    const gs = GameState.instance;
    const access = townBuildingAccess(building.id, gs.timeOfDay, { kind: 'player' }, gs.relationships);
    if (access.allowed) {
      this.deniedWarpTarget = null;
      super.enterWarp(warp);
      return;
    }
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    const feetY = (warp.ty + warp.h) * TILE + 2;
    this.player.setY(feetY - FEET_CENTER_DY);
    gs.player.y = feetY;
    if (this.deniedWarpTarget !== warp.target) {
      this.deniedWarpTarget = warp.target;
      this.game.events.emit('toast', access.message);
    }
  }
}
