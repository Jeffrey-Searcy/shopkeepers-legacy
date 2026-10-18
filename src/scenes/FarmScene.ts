/**
 * FarmScene owns the inherited shop's layered porch, its short walk-in entrance and the mailbox.
 * Map data owns the door trigger; BaseWorldScene and SceneTransitionSystem own all travel locks.
 * The mailbox shows a raised red flag while unread letters wait; E opens the oldest one
 * (letters and delivery rules: config/Letters.ts and systems/MailSystem.ts).
 * Until NORTH_TRAIL_OPEN_DAY a barricade blocks the north trail to the Gate Plaza; the scene adds
 * its collider at create time, so the trail opens the first time the farm loads on that day.
 * On a brand-new adventure (day 1, mayor not yet met) Mayor Hollis greets the keeper on the east
 * road and walks them to the shop door (entities/MayorHollis.ts).
 */
import { SceneKey } from '../config/AssetKeys';
import { FEET_CENTER_DY } from '../config/GameConfig';
import { GameState } from '../state/GameState';
import { BaseWorldScene } from './BaseWorldScene';
import { ShopFront } from '../world/ShopFront';
import { getShopGeometry } from '../config/Shop';
import type { WarpDef } from '../world/MapDef';
import { shopFacade } from '../config/ShopFacades';
import { SettingsSystem, SETTINGS_CHANGED_EVENT } from '../systems/SettingsSystem';
import { Prop } from '../entities/Prop';
import { TILE } from '../config/GameConfig';
import { ITEM_CATALOG } from '../config/Items';
import { openNextLetter } from '../systems/MailSystem';
import { TAVERN_RECIPES } from '../config/Tavern';
import { MAILBOX_TILE } from '../config/Letters';
import { Sfx } from '../systems/SfxSystem';
import { NORTH_TRAIL_OPEN_DAY } from '../config/Dungeon';
import { RUNTIME_ART, ensureRuntimeArt } from '../world/RuntimeArt';
import { MayorHollis } from '../entities/MayorHollis';
import { SaveSystem } from '../systems/SaveSystem';

/** Runtime-drawn placeholder textures until authored mailbox art exists (flag down / flag up). */

/** Mayor Hollis's walk: west along the dirt road, then north to the spot beside the shop door. */
const MAYOR_ROAD_TURN = { tx: 85, ty: 30 };
const MAYOR_DOOR_SPOT = { tx: 85, ty: 27 };
/** Where the mayor fades out on his way back to town (the east end of the road). */
const MAYOR_TOWN_EXIT = { tx: 97, ty: 30 };

/** The inherited farm, with a shop-neutral building that hosts the existing tavern business. */
export class FarmScene extends BaseWorldScene {
  private shopFront!: ShopFront;
  private mailbox!: Prop;
  /** Wall-clock time of the last "trail closed" toast, so bumping the barricade does not spam. */
  private barricadeToastAt = -Infinity;
  /** The day-1 welcome walk, or null when the mayor is not on the farm. */
  private mayor: MayorHollis | null = null;

  /** Register the farm under the checked world scene key. */
  constructor() {
    super(SceneKey.Farm);
  }

  /** Draw separate layers; the exact visible porch edges/posts collide, leaving the stairs open. */
  protected override onCreated(): void {
    if (!this.map.shopOffset) throw new Error('FarmScene: map shop offset is missing');
    this.shopFront = new ShopFront(this, this.map.shopOffset, shopFacade(SettingsSystem.get().shopFacade).texture);
    /** Apply a validated cosmetic setting to existing art without restarting the scene or changing physics. */
    const refreshFacade = (): void => this.shopFront.setFacade(shopFacade(SettingsSystem.get().shopFacade).texture);
    window.addEventListener(SETTINGS_CHANGED_EVENT, refreshFacade);
    this.events.once('shutdown', () => window.removeEventListener(SETTINGS_CHANGED_EVENT, refreshFacade));
    for (const part of getShopGeometry(this.map.shopOffset).bodies) {
      const foot = this.add.zone(part.x, part.y, part.width, part.height)
        .setOrigin(0, 0).setName(`shop-collision-${part.name}`);
      this.physics.add.existing(foot, true);
      this.physics.add.collider(this.player, foot);
    }
    this.createMailbox();
    this.createNorthTrailBarricade();
    this.startMayorWalk();
  }

  /**
   * Start Mayor Hollis's welcome walk on a brand-new adventure: day 1, mayor not met, a real save
   * slot in play (direct test/dev boots have no slot and skip the story intro), and the keeper just
   * placed at the "start" spawn by New Game. The keeper arrives on the east road; the mayor stands
   * two tiles ahead and speaks first.
   */
  private startMayorWalk(): void {
    const gs = GameState.instance;
    this.mayor = null;
    if (gs.progress.mayorMet || gs.day !== 1 || SaveSystem.currentSlot() === null) return;
    // why: only New Game lands on "start" without a saved position. Coming out of the shop, back
    // from town, or Continue on a day-1 save must never yank the keeper to the road mid-errand.
    if (this.arrival.spawnId !== 'start' || this.arrival.resumed) return;
    const road = this.map.spawns.find(spawn => spawn.id === 'from_town');
    if (!road) throw new Error('FarmScene: the east road spawn "from_town" is missing');
    this.teleport(road.tx, road.ty, 'left');
    this.mayor = new MayorHollis(this, { tx: road.tx - 2, ty: road.ty }, [MAYOR_ROAD_TURN, MAYOR_DOOR_SPOT]);
    gs.dialogue = { name: 'Mayor Hollis', line: 'Welcome to Willowbrook! You must be the new keeper. Come along, I will walk you to the shop. It is just down this road.' };
    Sfx.play('talk');
  }

  /** Per-frame mayor walk: follow, wait, and give the shop speech once the keeper reaches the door. */
  private updateMayor(deltaMs: number): void {
    const mayor = this.mayor;
    if (!mayor) return;
    const gs = GameState.instance;
    const busy = gs.dialogue !== null || gs.paused || gs.inventoryOpen || gs.daySummary !== null;
    mayor.update(deltaMs, gs.player.x, gs.player.y, busy);
    if (mayor.phase === 'arrived' && !busy && Math.hypot(gs.player.x - mayor.x, gs.player.y - mayor.y) <= 2.5 * TILE) {
      gs.progress.mayorMet = true;
      gs.dialogue = { name: 'Mayor Hollis', line: 'Here it is: your grandfather\'s shop. It needs love, but the bones are good. Fix up the front room, meet three neighbors in town, then make your first sale. Welcome home!' };
      Sfx.play('talk');
      mayor.leave([MAYOR_ROAD_TURN, MAYOR_TOWN_EXIT]);
    }
    if (mayor.phase === 'gone') this.mayor = null;
  }

  /** Base world frame, then the mayor's walk. */
  override update(time: number, deltaMs: number): void {
    super.update(time, deltaMs);
    this.updateMayor(deltaMs);
  }

  /** The farm's north-trail warp (to the Gate Plaza). The map must author exactly this exit. */
  private northTrailWarp(): WarpDef {
    const warp = this.map.warps.find(candidate => candidate.target === SceneKey.GatePlaza);
    if (!warp) throw new Error('FarmScene: the north trail warp to the Gate Plaza is missing');
    return warp;
  }

  /**
   * Before NORTH_TRAIL_OPEN_DAY, block the trail mouth with a solid barricade one row below the warp.
   * Bumping it explains why (at most once every few seconds).
   */
  private createNorthTrailBarricade(): void {
    if (GameState.instance.day >= NORTH_TRAIL_OPEN_DAY) return;
    ensureRuntimeArt(this);
    const warp = this.northTrailWarp();
    const centerX = (warp.tx + warp.w / 2) * TILE;
    const barricade = this.add.image(centerX, (warp.ty + 2) * TILE, RUNTIME_ART.barricade)
      .setOrigin(0.5, 1).setDisplaySize(warp.w * TILE + 4, 24).setName('north-trail-barricade');
    barricade.setDepth(barricade.y);
    // why: a zone over the full row below the warp (warp width + the grass shoulders) so no gap is left.
    const block = this.add.zone((warp.tx - 1) * TILE, (warp.ty + 1) * TILE, (warp.w + 2) * TILE, TILE).setOrigin(0, 0);
    this.physics.add.existing(block, true);
    this.physics.add.collider(this.player, block, () => {
      if (this.time.now - this.barricadeToastAt < 4000) return;
      this.barricadeToastAt = this.time.now;
      this.game.events.emit('toast', `The guild is still clearing the north trail. It opens on day ${NORTH_TRAIL_OPEN_DAY}.`);
    });
  }

  /** The north trail stays shut before its opening day, even if something moves the keeper past the barricade. */
  protected override enterWarp(warp: WarpDef): void {
    if (warp.target === SceneKey.GatePlaza && GameState.instance.day < NORTH_TRAIL_OPEN_DAY) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      const feetY = (warp.ty + warp.h + 1) * TILE + TILE / 2;
      this.player.setY(feetY - FEET_CENTER_DY);
      GameState.instance.player.y = feetY;
      return;
    }
    super.enterWarp(warp);
  }

  /**
   * Place the solid one-tile mailbox and keep its flag in sync with unread mail every frame.
   * Its two textures (flag down / flag up) come from RuntimeArt until an authored PNG replaces them.
   */
  private createMailbox(): void {
    ensureRuntimeArt(this);
    this.mailbox = new Prop(this, RUNTIME_ART.mailbox, MAILBOX_TILE.tx, MAILBOX_TILE.ty, TILE, TILE * 1.5).setName('mailbox');
    this.physics.add.collider(this.player, this.mailbox);
    /** The raised flag is the at-a-glance "you have mail" signal, like Stardew's mailbox. */
    const syncFlag = (): void => {
      const key = GameState.instance.mail.inbox.length > 0 ? RUNTIME_ART.mailboxFlag : RUNTIME_ART.mailbox;
      if (this.mailbox.texture.key !== key) this.mailbox.setTexture(key).setDisplaySize(TILE, TILE * 1.5);
    };
    syncFlag();
    this.events.on('postupdate', syncFlag);
    this.events.once('shutdown', () => this.events.off('postupdate', syncFlag));
  }

  /**
   * Open the oldest unread letter into the dialogue box and grant its gift.
   * A full bag keeps the letter unread (gift never lost) and says so.
   */
  private readMail(): void {
    const gs = GameState.instance;
    const result = openNextLetter(gs.mail, (item, qty) => gs.addItem(item, qty));
    if (result.kind === 'empty') {
      gs.dialogue = { name: 'Mailbox', line: 'No new mail today.' };
      Sfx.play('select');
      return;
    }
    if (result.kind === 'bag-full') {
      this.game.events.emit('toast', `Make room in your bag for ${result.letter.from}'s gift first`);
      Sfx.play('deny');
      return;
    }
    const { letter } = result;
    gs.dialogue = { name: `${letter.from} — ${letter.subject}`, line: letter.body };
    if (letter.gift) this.game.events.emit('toast', `+${letter.gift.qty} ${ITEM_CATALOG[letter.gift.item].label}`);
    if (letter.recipe) this.game.events.emit('toast', `Recipe learned: ${TAVERN_RECIPES[letter.recipe].label}`);
    Sfx.play('talk');
  }

  /** Mailbox E reads mail; the old door shortcut stays an optional convenience (walking needs no E press). */
  protected override handleWorldInteraction(tx: number, ty: number): boolean {
    if (this.mayor && this.mayor.phase !== 'gone') {
      const at = this.mayor.tile();
      if (at.tx === tx && at.ty === ty) {
        const gs = GameState.instance;
        this.mayor.faceToward(gs.player.x, gs.player.y);
        gs.dialogue = { name: 'Mayor Hollis', line: this.mayor.phase === 'leaving' ? 'Off to town hall. Come find me any time!' : 'Follow me! The shop is just along this road.' };
        Sfx.play('talk');
        return true;
      }
    }
    if (tx === MAILBOX_TILE.tx && ty === MAILBOX_TILE.ty) {
      this.readMail();
      return true;
    }
    const door = this.map.warps.find(warp => warp.target === SceneKey.Tavern);
    if (!door) throw new Error('FarmScene: authored shop doorway is missing');
    if (tx < door.tx || tx >= door.tx + door.w || ty !== door.ty) return false;
    this.enterWarp(door);
    return true;
  }

  /** Open the leaf while the keeper steps through; fade only after both short motions finish. */
  protected override animateEntrance(warp: WarpDef, onReady: () => void): void {
    if (warp.target !== SceneKey.Tavern) { onReady(); return; }
    if (!this.map.shopOffset) throw new Error('FarmScene: map shop offset is missing');
    const { front } = getShopGeometry(this.map.shopOffset);
    let doorReady = false;
    let keeperReady = false;
    /** Both animations own the entrance together, so no serial pause precedes the keeper's step. */
    const complete = (): void => { if (doorReady && keeperReady) onReady(); };
    const opened = this.shopFront.openDoor(() => {
      doorReady = true;
      complete();
    });
    if (!opened) throw new Error('FarmScene: a second door animation bypassed the transition guard');
    GameState.instance.player.facing = 'up';
    this.player.play('player-walk-up', true);
    this.tweens.add({
      targets: this.player,
      x: front.door.centerX,
      y: front.door.sillY - 15 - FEET_CENTER_DY,
      duration: 100,
      ease: 'Linear',
      onUpdate: () => {
        GameState.instance.player.x = this.player.x;
        GameState.instance.player.y = this.player.y + FEET_CENTER_DY;
        this.player.setDepth(this.player.y + FEET_CENTER_DY);
      },
      onComplete: () => { keeperReady = true; complete(); },
    });
  }
}
