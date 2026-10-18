/**
 * TavernScene renders the inherited tavern and its first customers. Durable business rules live
 * in TavernSystem; this scene owns furniture, customer motion and nearby world interactions.
 * The room layout is authored in maps/tavern.json and uses the shared world/collision pipeline.
 */
import Phaser from 'phaser';
import { SceneKey, TextureKey } from '../config/AssetKeys';
import { TILE, FEET_CENTER_DY } from '../config/GameConfig';
import { seatedOffsetX } from '../config/Furniture';
import { GameState } from '../state/GameState';
import { TavernSystem } from '../systems/TavernSystem';
import { AppearanceTextureSystem } from '../systems/AppearanceTextureSystem';
import { ItemPlacementSystem } from '../systems/ItemPlacementSystem';
import { Sfx } from '../systems/SfxSystem';
import { InputBus } from '../input/InputBus';
import { ToolSystem } from '../systems/ToolSystem';
import { GuestThoughtCloud } from '../world/GuestThoughtCloud';
import { GuestFightCloud, GuestSocialEffects } from '../world/GuestSocialEffects';
import { SettingsSystem } from '../systems/SettingsSystem';
import { BaseWorldScene } from './BaseWorldScene';
import { tavernLights, type InteriorLight } from '../config/InteriorLights';
import tavernMap from '../world/maps/tavern.json' with { type: 'json' };

/** A walkable, persistent business room; all temporary display objects die with scene shutdown. */
/** Top-left pixel of each north-wall window; shared by the window art and the window light. */
const TAVERN_WINDOWS: readonly { x: number; y: number }[] = [4, 14].map(tx => ({ x: tx * TILE, y: 9 }));

export class TavernScene extends BaseWorldScene {
  /** Scene-local visuals keyed by durable visit identity; no payment or occupancy lives on sprites. */
  private readonly visitors = new Map<number, { sprite: Phaser.GameObjects.Sprite; order: GuestThoughtCloud; shadow: Phaser.GameObjects.Ellipse; emotion: GuestSocialEffects }>();
  private readonly fights = new Map<string, GuestFightCloud>();

  /** Register the dedicated room under the world's checked scene-key contract. */
  constructor() {
    super(SceneKey.Tavern);
  }

  /** Build architecture; guest displays are created lazily from the system's accepted visits. */
  protected override onCreated(): void {
    for (const window of TAVERN_WINDOWS) this.windowAt(window.x, window.y);
    this.drawGuestStairs();
    this.visitors.clear();
    this.fights.clear();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.visitors.clear(); this.fights.clear(); });
  }

  /** Render native guest stairs inside their authored solid recess; upstairs remains NPC-only. */
  private drawGuestStairs(): void {
    const { tx, ty, w, h } = tavernMap.guestStairs;
    const texture = this.textures.get(TextureKey.InteriorStairs);
    if (!this.textures.exists(TextureKey.InteriorStairs)) throw new Error('TavernScene: missing guest staircase');
    const source = texture.getSourceImage() as HTMLImageElement;
    if (source.width !== w * TILE || source.height !== h * TILE) throw new Error('TavernScene: staircase must match its native recess');
    this.add.image(tx * TILE, ty * TILE, TextureKey.InteriorStairs)
      .setOrigin(0).setDepth(h * TILE).setName('guest-only-stairs');
  }

  /** Draw a window with soft daylight; these shapes are architectural trim, not collision. */
  private windowAt(x: number, y: number): void {
    this.add.rectangle(x, y, 25, 23, 0x483024).setOrigin(0, 0).setDepth(33);
    this.add.rectangle(x + 3, y + 3, 19, 17, 0x8bbaba).setOrigin(0, 0).setDepth(34);
    this.add.rectangle(x + 12, y + 3, 2, 17, 0xdec08c).setOrigin(0, 0).setDepth(35);
    this.add.rectangle(x + 3, y + 11, 19, 2, 0xdec08c).setOrigin(0, 0).setDepth(35);
    this.add.ellipse(x + 12, y + 55, 48, 45, 0xffdd87, 0.08).setDepth(-9.5);
  }

  /** Light the Tavern with daylight through its windows and two wall lanterns. */
  protected override interiorLights(): readonly InteriorLight[] {
    return tavernLights(TAVERN_WINDOWS);
  }

  /** Resolve real placed footprints; empty floor can never act as an invisible station. */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    const gs = GameState.instance;
    const held = ToolSystem.activeItem();
    if (held === 'broom') return this.handleHeldItemUse(held);
    const item = ItemPlacementSystem.itemAt(SceneKey.Tavern, tx, ty);
    if (!item) {
      if (held === 'stew' || held === 'ale') return this.handleHeldItemUse(held);
      return false;
    }
    if (item.item === 'register') {
      if (TavernSystem.canCheckIn()) this.respond(TavernSystem.checkIn());
      else if (gs.tavern.level === 0) this.handleShopManagement();
      else this.respond({ ok: false, message: 'Stand behind the register to check in a waiting guest. Press M to manage your shop.' });
      return true;
    }
    if (item.item === 'stove') {
      const panel = 'kitchen';
      if (!TavernSystem.canInteract(panel)) return false;
      gs.tavernPanel = panel;
      InputBus.instance.clearAll();
      Sfx.play('select');
      return true;
    }
    if (item.item === 'bar' || item.item === 'table' || item.item === 'chair') {
      this.respond(TavernSystem.serve());
      return true;
    }
    return false;
  }

  /** Management has its own input so opening the ledger never accidentally charges a guest. */
  protected override handleShopManagement(): void {
    if (!TavernSystem.canInteract('ledger')) return;
    GameState.instance.tavernPanel = 'ledger';
    InputBus.instance.clearAll();
    Sfx.play('select');
  }

  /** Use the selected meal, mug, or broom through the same transactions as direct E interaction. */
  protected override handleHeldItemUse(item: string): boolean {
    if (item !== 'stew' && item !== 'ale' && item !== 'broom') return false;
    const result = item === 'broom' ? TavernSystem.eject() : TavernSystem.serve();
    if (item === 'broom' && result.ok) this.player.playAction('broom');
    this.respond(result);
    return true;
  }

  /** Show an action's honest result and matching sound, without owning the business rule. */
  private respond(result: { ok: boolean; message: string }): void {
    Sfx.play(result.ok ? 'stash' : 'deny');
    this.game.events.emit('toast', result.message);
  }

  /** Update business time only through its system, then derive all customer visuals from state. */
  override update(time: number, deltaMs: number): void {
    super.update(time, deltaMs);
    const gs = GameState.instance;
    if (gs.activeScene !== SceneKey.Tavern) return;
    TavernSystem.tick(deltaMs);
    this.drawCustomers();
  }

  /** Derive every pose from saved route progress; rendering never advances visits or owns stock. */
  private drawCustomers(): void {
    const views = TavernSystem.guestViews();
    const { reducedMotion } = SettingsSystem.get();
    const pairKeys = new Set<string>();
    const positions = new Map<number, { x: number; y: number }>();
    const clouds: Phaser.GameObjects.Container[] = [];
    const ids = new Set(views.map(view => view.guest.id));
    for (const [id, visual] of this.visitors) if (!ids.has(id)) {
      visual.sprite.destroy(); visual.order.destroy(); visual.shadow.destroy(); visual.emotion.destroy(); this.visitors.delete(id);
    }
    for (const view of views) {
      const { guest, path, durationMs, destination } = view;
      let visual = this.visitors.get(guest.id);
      const texture = AppearanceTextureSystem.forGame(this.game).visitorTextureFor(guest.visitorId);
      if (!visual) {
        const sprite = this.add.sprite(0, 0, texture, 0).setName(`shop-guest-${guest.id}`);
        const shadow = this.add.ellipse(0, 0, 12, 5, 0x2c211c, 0.2);
        const order = new GuestThoughtCloud(this, guest.id);
        visual = { sprite, shadow, order, emotion: new GuestSocialEffects(this, guest.id) };
        this.visitors.set(guest.id, visual);
      }
      const moving = ['arriving', 'wandering', 'ascending', 'descending', 'leaving'].includes(guest.phase);
      const position = moving ? Math.min(1, guest.elapsedMs / durationMs) * (path.length - 1) : path.length - 1;
      const index = Math.min(Math.floor(position), path.length - 1);
      const from = path[index];
      const to = path[Math.min(index + 1, path.length - 1)];
      const fraction = position - index;
      const x = (Phaser.Math.Linear(from.tx, to.tx, fraction) + 0.5) * TILE;
      const y = (Phaser.Math.Linear(from.ty, to.ty, fraction) + 0.5) * TILE;
      positions.set(guest.id, { x, y });
      const facing = moving && to.tx !== from.tx ? (to.tx > from.tx ? 'right' : 'left')
        : moving && to.ty !== from.ty ? (to.ty > from.ty ? 'down' : 'up') : destination.facing;
      const row = { down: 0, up: 1, left: 2, right: 3 }[facing];
      const angry = view.mood === 'angry';
      const drunk = view.intoxicated, fight = view.fight;
      const clock = reducedMotion ? 0 : guest.elapsedMs;
      const frame = row * 4 + (moving && fight === null ? Math.floor(clock / 145) % 4 : 0);
      const seated = fight === null && destination.kind === 'seat' && ['waiting', 'eating', 'lingering'].includes(guest.phase);
      const sway = drunk && fight === null ? Math.sin(clock / 640 + guest.id) * (reducedMotion ? 0 : 1.4) : 0;
      // why: side chairs tuck toward their table, so a seated guest shifts with the seat.
      const seatX = seated ? seatedOffsetX(destination.facing) : 0;
      const chat = view.conversation;
      const nod = chat !== null && !reducedMotion ? Math.sin(clock / (chat.speaking ? 170 : 350)) * (chat.speaking ? 0.6 : 0.35) : 0;
      const stomp = angry && !reducedMotion && clock % 1800 < 160 ? -0.8 : 0;
      const fightBeat = fight === null || reducedMotion ? 0 : Math.floor(fight.elapsedMs / 190);
      const glimpse = fight !== null && (reducedMotion || fightBeat % 5 === guest.id % 2);
      visual.sprite.setOrigin(0.5).setScale(1);
      // Lower the torso onto the cushion and hide the standing legs, retaining the approved outfit.
      visual.sprite.setTexture(texture, frame)
        .setPosition(x + seatX + sway, y - FEET_CENTER_DY + (seated ? 5 : 0) + nod + stomp - (glimpse ? 2 : 0))
        .setAngle(fight !== null ? (reducedMotion ? 0 : (guest.id % 2 ? -16 : 16)) : drunk ? sway * 3.8 : 0)
        .setTint(angry ? 0xffa28f : drunk ? 0xffe0d0 : 0xffffff).setAlpha(fight === null || glimpse ? 1 : 0)
        .setData('mood', view.mood).setData('intoxicated', drunk).setData('socialPartnerId', view.socialPartnerId)
        .setData('fightPartnerId', fight === null ? null : fight.partnerId).setData('fightGlimpse', glimpse)
        .setDepth(glimpse ? y + 6 : guest.phase === 'ascending' || guest.phase === 'descending' ? Math.max(81, y) : y);
      // Crop one pixel below the sprite origin (frame centre 32), so the chair hides the standing legs.
      if (seated) visual.sprite.setCrop(0, 0, 96, 33);
      else visual.sprite.setCrop();
      visual.shadow.setPosition(x, y + 1).setDepth(y - 0.2).setVisible(!seated);
      visual.emotion.update(view, x + seatX + sway, y + (seated ? 5 : 0), reducedMotion);
      const viewport = this.cameras.main.worldView;
      const safeTop = viewport.top + 36 / this.cameras.main.zoom;
      const belowGuest = y - 56 < safeTop;
      visual.order.update(view, belowGuest);
      // Near the top edge, put the request below the guest instead of under the HUD or offscreen.
      const bubbleY = belowGuest ? y + 18 : y - 42;
      const half = visual.order.root.width / 2 + 2;
      const bubbleX = Phaser.Math.Clamp(x, viewport.left + half, viewport.right - half);
      visual.order.root.setPosition(bubbleX, bubbleY);
      if (visual.order.root.visible) clouds.push(visual.order.root);
    }
    this.spaceThoughtClouds(clouds);
    for (const view of views) if (view.fight !== null && view.guest.id < view.fight.partnerId) {
      const key = `${view.guest.id}-${view.fight.partnerId}`;
      pairKeys.add(key);
      const first = positions.get(view.guest.id), second = positions.get(view.fight.partnerId);
      if (!first || !second) throw new Error('TavernScene: fight participant is not visible');
      let cloud = this.fights.get(key);
      if (!cloud) { cloud = new GuestFightCloud(this, key); this.fights.set(key, cloud); }
      const feet = Math.max(first.y, second.y);
      cloud.update((first.x + second.x) / 2, (first.y + second.y) / 2, feet,
        Math.abs(first.x - second.x), Math.abs(first.y - second.y), view.fight.elapsedMs, reducedMotion);
      // Both actors share the pair's depth anchor, even for a vertical encounter.
      for (const id of [view.guest.id, view.fight.partnerId]) {
        const actor = this.visitors.get(id);
        if (!actor) throw new Error('TavernScene: fight actor is missing');
        actor.sprite.setDepth(actor.sprite.getData('fightGlimpse') ? feet + 6 : feet + 1);
      }
    }
    for (const [key, cloud] of this.fights) if (!pairKeys.has(key)) { cloud.destroy(); this.fights.delete(key); }
  }

  /** Spread vertically overlapping clouds along their row, preserving guest order and viewport edges. */
  private spaceThoughtClouds(clouds: Phaser.GameObjects.Container[]): void {
    const viewport = this.cameras.main.worldView;
    const groups: Phaser.GameObjects.Container[][] = [];
    for (const cloud of clouds.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const previous = groups[groups.length - 1];
      if (previous && cloud.y - previous[previous.length - 1].y < 26) previous.push(cloud);
      else groups.push([cloud]);
    }
    for (const group of groups) {
      group.sort((a, b) => a.x - b.x);
      const originalCenter = group.reduce((sum, cloud) => sum + cloud.x, 0) / group.length;
      for (let index = 1; index < group.length; index++) group[index].x = Math.max(group[index].x,
        group[index - 1].x + (group[index - 1].width + group[index].width) / 2 + 3);
      const shift = originalCenter - group.reduce((sum, cloud) => sum + cloud.x, 0) / group.length;
      const left = viewport.left + group[0].width / 2 + 2, right = viewport.right - group[group.length - 1].width / 2 - 2;
      // Compact views share the available row width instead of letting edge requests disappear.
      if (group.length > 1 && group[group.length - 1].x - group[0].x > right - left) {
        group.forEach((cloud, index) => { cloud.x = left + index * (right - left) / (group.length - 1); });
      } else {
        const boundedShift = Phaser.Math.Clamp(shift, left - group[0].x, right - group[group.length - 1].x);
        group.forEach(cloud => { cloud.x = Math.round(cloud.x + boundedShift); });
      }
    }
  }
}
