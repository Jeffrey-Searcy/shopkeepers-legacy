/**
 * CombatController — the shared real-time combat loop for combat scenes (the Mines and the portal
 * dungeon). It was lifted out of MinesScene so both scenes play the same way.
 *
 * It owns, per scene instance:
 *  - scene-local keys: SPACE = sword (when the sword tool is active), SHIFT = dodge roll; the touch
 *    Dodge button arrives as the InputBus 'dodge' action;
 *  - the live enemy list (AI, contact damage, knockback) and the scene-local loot drops;
 *  - the HP bar HUD (drawn in camera space, so it survives the zoomed world camera).
 *
 * The scene keeps the rules that differ between combat areas through CombatHooks: sword damage,
 * what a dead enemy drops, how loot is collected, and what a knockout does. CombatSystem still owns
 * the HP and i-frame numbers. Everything here dies with the scene.
 */
import Phaser from 'phaser';
import { TILE } from '../config/GameConfig';
import { ToolId } from '../config/Items';
import { GameState } from '../state/GameState';
import { CombatSystem, DODGE_SPEED, DODGE_DASH_MS } from './CombatSystem';
import type { Enemy } from './Enemy';
import { DroppedItem } from '../entities/DroppedItem';
import { ToolSystem } from '../systems/ToolSystem';
import { Sfx } from '../systems/SfxSystem';
import { InputBus } from '../input/InputBus';
import type { Player } from '../entities/Player';
import { POTION_HEAL } from '../config/Dungeon';

/** px from the player's feet to an enemy centre, in the facing half-plane. */
const SWORD_RANGE = 26;
const ATTACK_COOLDOWN_MS = 350;
const CONTACT_RANGE = 14;
const KNOCKBACK_SPEED = 220;
const KNOCKBACK_MS = 160;

/** Scene-specific combat rules. */
export interface CombatHooks {
  /** Damage of one sword hit (the dungeon adds the forge level). */
  swordDamage(): number;
  /** A sword hit killed `enemy` at tile (tx, ty). The scene usually calls dropLoot here. */
  onEnemyKilled(enemy: Enemy, tx: number, ty: number): void;
  /** Try to collect a loot drop the player touched. Return false to leave it on the ground. */
  collect(item: string): boolean;
  /** HP reached zero. Called once; the controller stops all combat afterwards. */
  onKnockedOut(): void;
}

/** Unit vector for each facing. */
const FACING: Record<'up' | 'down' | 'left' | 'right', readonly [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};

export class CombatController {
  /** Live enemies. Scenes add them with addEnemy and may read the list (test hooks, clear checks). */
  enemies: Enemy[] = [];
  private lootDrops: DroppedItem[] = [];
  private attackCooldown = 0;
  private dashUntil = 0;
  private dashVx = 0;
  private dashVy = 0;
  private knockUntil = 0;
  private knockVx = 0;
  private knockVy = 0;
  /** True after a knockout: combat stops until the scene leaves. */
  private down = false;
  private readonly hpBar: Phaser.GameObjects.Rectangle;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly swordKey: Phaser.Input.Keyboard.Key;
  private readonly dodgeKey: Phaser.Input.Keyboard.Key;
  /** Set by the touch Dodge button; consumed once by the next update, like JustDown(Shift). */
  private dodgeRequested = false;

  /**
   * Build the HUD and keys and hook scene shutdown (which heals the player to full).
   * @param scene the combat scene (must already have run BaseWorldScene.create)
   * @param player the scene's player sprite
   * @param hooks the scene's combat rules
   */
  constructor(private readonly scene: Phaser.Scene, private readonly player: Player, private readonly hooks: CombatHooks) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('CombatController: the scene has no keyboard plugin');
    kb.addCapture(['SHIFT']);
    this.swordKey = kb.addKey('SPACE');
    this.dodgeKey = kb.addKey('SHIFT');
    const offDodge = InputBus.instance.onAction(action => {
      if (action === 'dodge') this.dodgeRequested = true;
    });
    ({ bar: this.hpBar, text: this.hpText } = this.buildHud());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offDodge();
      // Leaving a combat scene by any route always heals to full.
      CombatSystem.heal();
    });
  }

  /** Track a new enemy (already added to the scene by its constructor). */
  addEnemy(enemy: Enemy): void {
    this.enemies.push(enemy);
  }

  /** Spawn a collectible drop at a tile; the player collects it through hooks.collect. */
  dropLoot(item: string, tx: number, ty: number): void {
    this.lootDrops.push(new DroppedItem(this.scene, item, tx, ty));
  }

  /**
   * Drink one healing potion from the bag (+POTION_HEAL HP, capped at max). A full-health keeper
   * keeps the potion. Scenes call this from handleHeldItemUse('healing-potion').
   */
  drinkPotion(): void {
    const gs = GameState.instance;
    if (this.down) return;
    if (gs.hp >= gs.maxHp) {
      this.scene.game.events.emit('toast', 'You are already at full health.');
      Sfx.play('deny');
      return;
    }
    if (!gs.removeItem('healing-potion', 1)) throw new Error('CombatController: no healing potion to drink');
    gs.hp = Math.min(gs.maxHp, gs.hp + POTION_HEAL);
    Sfx.play('harvest');
    this.scene.game.events.emit('toast', `+${POTION_HEAL} HP`);
  }

  /** Remove every loot drop still on the ground (a room change leaves them behind). */
  clearLoot(): void {
    for (const drop of this.lootDrops) drop.destroy();
    this.lootDrops = [];
  }

  /**
   * Scene-local HP bar (top-left, under the stamina meter).
   *
   * The world camera is zoomed, and zoom scales scrollFactor-0 objects around the camera centre.
   * A naive (12,52) placement lands off-screen, so screen pixels are converted into camera space
   * with p = centre + (screen - centre) / zoom, and sizes are divided by zoom.
   */
  private buildHud(): { bar: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    const scene = this.scene;
    const z = scene.cameras.main.zoom;
    const cx = scene.scale.width / 2;
    const cy = scene.scale.height / 2;
    const px = (screenX: number): number => cx + (screenX - cx) / z;
    const py = (screenY: number): number => cy + (screenY - cy) / z;
    scene.add.text(px(12), py(124), 'HP', { fontSize: '12px', color: '#e8b0b0' }).setScale(1 / z).setScrollFactor(0).setDepth(999_990);
    scene.add.rectangle(px(12), py(142), 160 / z, 12 / z, 0x000000, 0.4).setOrigin(0, 0).setScrollFactor(0).setDepth(999_990);
    const bar = scene.add.rectangle(px(12), py(142), 160 / z, 12 / z, 0xd45a5a, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(999_991);
    const text = scene.add.text(px(16), py(143), '', { fontSize: '9px', color: '#2a0a0a' }).setScale(1 / z).setScrollFactor(0).setDepth(999_992);
    return { bar, text };
  }

  /**
   * Add a small HUD text line in camera space (same zoom correction as the HP bar), for scene
   * extras such as the dungeon bag counter.
   * @param screenX screen pixel x of the text's top-left
   * @param screenY screen pixel y of the text's top-left
   * @param color CSS colour of the text
   */
  addHudText(screenX: number, screenY: number, color: string): Phaser.GameObjects.Text {
    const scene = this.scene;
    const z = scene.cameras.main.zoom;
    const cx = scene.scale.width / 2;
    const cy = scene.scale.height / 2;
    return scene.add.text(cx + (screenX - cx) / z, cy + (screenY - cy) / z, '', { fontSize: '11px', color })
      .setScale(1 / z).setScrollFactor(0).setDepth(999_992);
  }

  /** Sword swing: play the animation and hit every enemy in range in the facing half-plane. */
  private swordAttack(): void {
    const gs = GameState.instance;
    this.player.playAction('sword');
    Sfx.play('sword');
    const px = gs.player.x;
    const py = gs.player.y;
    const dir = FACING[gs.player.facing];
    for (const enemy of [...this.enemies]) {
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      // why: a small grace behind the player keeps point-blank hits from whiffing.
      const inFront = dx * dir[0] + dy * dir[1] > -4;
      if (Math.hypot(dx, dy) > SWORD_RANGE || !inFront) continue;
      this.strikeEnemy(enemy, this.hooks.swordDamage(), px, py);
    }
  }

  /**
   * Land one hit on a live enemy. This is the single damage-and-kill path: the keeper's sword and
   * party companions both use it, so a companion kill drops loot, clears floors, and records the
   * Warden exactly like a keeper kill.
   * @param enemy a live enemy that is still in `enemies`
   * @param damage hit points to remove (a positive integer)
   * @param fromX world x the hit comes from (the enemy is knocked away from it)
   * @param fromY world y the hit comes from
   * @returns true when the hit killed the enemy
   * @throws when the enemy is not live in this controller or the damage is not a positive integer
   * Side effects: plays the hit sound; on a kill removes the enemy, calls hooks.onEnemyKilled, and
   * destroys the sprite.
   */
  strikeEnemy(enemy: Enemy, damage: number, fromX: number, fromY: number): boolean {
    if (!this.enemies.includes(enemy)) throw new Error('CombatController: cannot strike an enemy that is not live');
    if (!Number.isSafeInteger(damage) || damage <= 0) throw new Error(`CombatController: invalid hit damage ${damage}`);
    const died = enemy.hit(damage, fromX, fromY);
    Sfx.play('mine');
    if (!died) return false;
    const tx = Math.floor(enemy.x / TILE);
    const ty = Math.floor(enemy.y / TILE);
    this.enemies = this.enemies.filter(other => other !== enemy);
    this.hooks.onEnemyKilled(enemy, tx, ty);
    enemy.destroy();
    return true;
  }

  /**
   * Run one frame of combat. Call after BaseWorldScene.update so dash and knockback velocities win
   * over the walking velocity the base scene just set.
   * @returns false once the player is knocked out (the scene should stop its own per-frame work)
   */
  update(time: number, deltaMs: number): boolean {
    if (this.down) return false;
    const gs = GameState.instance;
    CombatSystem.tick(deltaMs);
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaMs);
    const px = gs.player.x;
    const py = gs.player.y;

    // The base swing() ignores the sword, so this is the only sword handler (no double action).
    if ((this.swordKey.isDown || InputBus.instance.toolHeld) && ToolSystem.active() === ToolId.Sword && this.attackCooldown <= 0) {
      this.attackCooldown = ATTACK_COOLDOWN_MS;
      this.swordAttack();
    }

    const dodgePressed = Phaser.Input.Keyboard.JustDown(this.dodgeKey) || this.dodgeRequested;
    this.dodgeRequested = false;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (dodgePressed && CombatSystem.startDodge()) {
      let vx = body.velocity.x;
      let vy = body.velocity.y;
      if (vx === 0 && vy === 0) [vx, vy] = FACING[gs.player.facing];
      const len = Math.hypot(vx, vy);
      this.dashVx = (vx / len) * DODGE_SPEED;
      this.dashVy = (vy / len) * DODGE_SPEED;
      this.dashUntil = time + DODGE_DASH_MS;
      Sfx.play('select');
    }
    if (time < this.dashUntil) body.setVelocity(this.dashVx, this.dashVy);
    if (time < this.knockUntil) body.setVelocity(this.knockVx, this.knockVy);
    this.player.setAlpha(gs.invulnMs > 0 ? 0.55 : 1);

    for (const enemy of this.enemies) {
      enemy.update(time, deltaMs, px, py);
      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, px, py);
      if (dist < CONTACT_RANGE && CombatSystem.damagePlayer(enemy.touchDamage)) {
        Sfx.play('deny');
        // Knock the player away from the enemy, and shove the enemy back a little too.
        const a = Math.atan2(py - enemy.y, px - enemy.x);
        this.knockVx = Math.cos(a) * KNOCKBACK_SPEED;
        this.knockVy = Math.sin(a) * KNOCKBACK_SPEED;
        this.knockUntil = time + KNOCKBACK_MS;
        (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(-Math.cos(a) * 120, -Math.sin(a) * 120);
        if (gs.hp <= 0) {
          this.down = true;
          this.hooks.onKnockedOut();
          return false;
        }
      }
    }

    if (this.lootDrops.length > 0) {
      const remaining: DroppedItem[] = [];
      for (const drop of this.lootDrops) {
        drop.age += deltaMs;
        if (drop.magnetTo(px, py, deltaMs) && this.hooks.collect(drop.item)) {
          Sfx.play('select');
          drop.destroy();
        } else {
          remaining.push(drop);
        }
      }
      this.lootDrops = remaining;
    }

    this.hpBar.setScale(Math.max(0, Math.min(1, gs.hp / gs.maxHp)), 1);
    this.hpText.setText(`${gs.hp}/${gs.maxHp}`);
    return true;
  }
}
