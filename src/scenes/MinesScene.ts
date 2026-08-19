/**
 * MinesScene — Mines L1, now a Moonlighter-style combat dungeon (the designer's directive: the mines PLAY
 * like Moonlighter — real-time combat, dodge-roll i-frames, loot drops — while combat stays
 * CONFINED to this scene; outside the mines there is no HP, damage, or combat HUD).
 *
 * Everything combat lives scene-locally on top of BaseWorldScene (which we do not modify):
 *  - scene-local keys: SPACE = sword attack (when the sword tool is active), SHIFT = dodge-roll.
 *  - deterministic enemy spawns (local lcg over open cave tiles, never near the entrance),
 *  - a scene-local HP bar HUD (destroyed with the scene; UIScene is untouched),
 *  - loot via scene-local DroppedItem magnetism (the base scene's drop list is private),
 *  - knockout: 20% gold penalty, day advances (sleep path), wake at Home,
 *  - leaving the mines (any scene shutdown) heals to full.
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { BaseWorldScene } from './BaseWorldScene';
import { GameState } from '../state/GameState';
import { CombatSystem, DODGE_SPEED, DODGE_DASH_MS } from '../combat/CombatSystem';
import { Enemy } from '../combat/Enemy';
import { Slime } from '../entities/Slime';
import { Bat } from '../entities/Bat';
import { DroppedItem } from '../entities/DroppedItem';
import { ToolSystem } from '../systems/ToolSystem';
import { ToolId } from '../config/Items';
import { Sfx } from '../systems/SfxSystem';
import { transitionTo } from '../systems/SceneTransitionSystem';
import { registerEnemyProvider } from '../debug/DebugHooks';

/** Local deterministic scatter for enemy spawn points (never the gameplay Rng — layout-stable). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SWORD_DAMAGE = 2;
const SWORD_RANGE = 26; // px from the player's feet to the enemy center, in the facing half-plane
const ATTACK_COOLDOWN_MS = 350;
const CONTACT_RANGE = 14;
const KNOCKBACK_SPEED = 220;
const KNOCKBACK_MS = 160;

export class MinesScene extends BaseWorldScene {
  private enemies: Enemy[] = [];
  private lootDrops: DroppedItem[] = [];
  private attackCooldown = 0;
  private dashUntil = 0;
  private dashVx = 0;
  private dashVy = 0;
  private knockUntil = 0;
  private knockVx = 0;
  private knockVy = 0;
  private clearedToastShown = false;
  private dying = false;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private swordKey!: Phaser.Input.Keyboard.Key;
  private dodgeKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super(SceneKey.Mines);
  }

  create(): void {
    super.create();
    this.enemies = [];
    this.lootDrops = [];
    this.attackCooldown = 0;
    this.dashUntil = 0;
    this.knockUntil = 0;
    this.clearedToastShown = false;
    this.dying = false;

    this.spawnEnemies();
    this.buildHud();

    // Scene-local combat keys; the base scene owns all eight tool digits and Space-for-tools.
    const kb = this.input.keyboard!;
    kb.addCapture(['SHIFT']);
    this.swordKey = kb.addKey('SPACE');
    this.dodgeKey = kb.addKey('SHIFT');

    // The test seam's enemies() reads from whichever Mines instance is live.
    registerEnemyProvider(() =>
      this.enemies.map((e) => ({
        kind: e.lootItem === 'slime-gel' ? 'slime' : 'bat',
        tx: Math.floor(e.x / TILE),
        ty: Math.floor(e.y / TILE),
        hp: e.hp,
      }))
    );

    // Leaving the mines — by the mountain ladder OR the knockout warp — always heals to full.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      CombatSystem.heal();
      registerEnemyProvider(null);
    });
  }

  /** Deterministic spawns: 4 slimes + 3 bats on open cave tiles, well away from the entrance. */
  private spawnEnemies(): void {
    const rand = lcg(777);
    const entrance = this.map.spawns[0]; // 'entrance' (25,4)
    const spots: Array<{ tx: number; ty: number }> = [];
    let guard = 0;
    while (spots.length < 7 && guard++ < 500) {
      const tx = 2 + Math.floor(rand() * (this.map.w - 4));
      const ty = 2 + Math.floor(rand() * (this.map.h - 4));
      if (this.map.solid[ty][tx] || this.map.ground[ty][tx] !== 'cave') continue;
      if (Math.abs(tx - entrance.tx) + Math.abs(ty - entrance.ty) < 8) continue; // never near entry
      if (spots.some((s) => Math.abs(s.tx - tx) + Math.abs(s.ty - ty) < 4)) continue;
      spots.push({ tx, ty });
    }
    spots.forEach((s, i) => {
      const x = s.tx * TILE + TILE / 2;
      const y = s.ty * TILE + TILE / 2;
      this.enemies.push(i < 4 ? new Slime(this, x, y) : new Bat(this, x, y));
    });
  }

  /**
   * Scene-local HP bar (top-left, under the UIScene stamina meter). Dies with the scene.
   *
   * The world camera is ZOOMED (GameConfig.ZOOM) and zoom scales scrollFactor-0 objects around
   * the camera CENTER — a naive (12,52) placement lands off-screen left (found via screenshot
   * review: the HUD was invisible). So convert target SCREEN pixels into camera space with the
   * inverse transform p = center + (screen - center) / zoom, and divide sizes by zoom too.
   */
  private buildHud(): void {
    const z = this.cameras.main.zoom;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const px = (screenX: number) => cx + (screenX - cx) / z; // screen-px -> camera space
    const py = (screenY: number) => cy + (screenY - cy) / z;

    this.add
      .text(px(12), py(124), 'HP', { fontSize: '12px', color: '#e8b0b0' })
      .setScale(1 / z)
      .setScrollFactor(0)
      .setDepth(999_990);
    this.add
      .rectangle(px(12), py(142), 160 / z, 12 / z, 0x000000, 0.4)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(999_990);
    this.hpBar = this.add
      .rectangle(px(12), py(142), 160 / z, 12 / z, 0xd45a5a, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(999_991);
    this.hpText = this.add
      .text(px(16), py(143), '', { fontSize: '9px', color: '#2a0a0a' })
      .setScale(1 / z)
      .setScrollFactor(0)
      .setDepth(999_992);
  }

  /** Sword swing: anim + hit every enemy in range within the facing half-plane. */
  private swordAttack(): void {
    const gs = GameState.instance;
    this.player.playAction('sword');
    Sfx.play('sword');
    const px = gs.player.x;
    const py = gs.player.y;
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gs.player.facing];

    for (const enemy of [...this.enemies]) {
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      const dist = Math.hypot(dx, dy);
      const inFront = dx * dir[0] + dy * dir[1] > -4; // facing half-plane (small grace behind)
      if (dist > SWORD_RANGE || !inFront) continue;

      const died = enemy.hit(SWORD_DAMAGE, px, py);
      Sfx.play('mine'); // impact
      if (died) {
        const tx = Math.floor(enemy.x / TILE);
        const ty = Math.floor(enemy.y / TILE);
        this.lootDrops.push(new DroppedItem(this, enemy.lootItem, tx, ty));
        this.enemies = this.enemies.filter((e) => e !== enemy);
        enemy.destroy();
      }
    }

    if (!this.clearedToastShown && this.enemies.length === 0) {
      this.clearedToastShown = true;
      Sfx.play('harvest');
      this.game.events.emit('toast', 'Level cleared! The way deeper is blocked... (coming soon)');
    }
  }

  /** Knockout: lose 20% gold, end the day, and wake outside the unfinished Tavern healed. */
  private knockOut(): void {
    if (this.dying) return;
    this.dying = true;
    const gs = GameState.instance;
    Sfx.play('deny');
    this.game.events.emit('toast', 'You were knocked out!');
    gs.gold = Math.floor(gs.gold * 0.8);
    CombatSystem.heal();
    this.sleep(0.5); // rough night — half stamina, day advances, bin pays out
    transitionTo(this, SceneKey.Farm, 'from_home');
  }

  update(time: number, deltaMs: number): void {
    super.update(time, deltaMs);
    if (this.dying) return;
    const gs = GameState.instance;
    CombatSystem.tick(deltaMs);
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaMs);

    // Feet position (authoritative for range checks).
    const px = gs.player.x;
    const py = gs.player.y;

    // Sword attacks: Space while the sword is the active tool (base swing() no-ops on the sword,
    // so this scene-local path is the only handler — no double actions).
    if (this.swordKey.isDown && ToolSystem.active() === ToolId.Sword && this.attackCooldown <= 0) {
      this.attackCooldown = ATTACK_COOLDOWN_MS;
      this.swordAttack();
    }

    // Dodge roll: burst of speed along the current motion (or facing) + i-frames.
    if (Phaser.Input.Keyboard.JustDown(this.dodgeKey) && CombatSystem.startDodge()) {
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      let vx = body.velocity.x;
      let vy = body.velocity.y;
      if (vx === 0 && vy === 0) {
        const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[gs.player.facing];
        vx = dir[0];
        vy = dir[1];
      }
      const len = Math.hypot(vx, vy) || 1;
      this.dashVx = (vx / len) * DODGE_SPEED;
      this.dashVy = (vy / len) * DODGE_SPEED;
      this.dashUntil = time + DODGE_DASH_MS;
      Sfx.play('select');
    }
    // Apply dash/knockback AFTER the base update (which set velocity from held input) so it wins.
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (time < this.dashUntil) body.setVelocity(this.dashVx, this.dashVy);
    if (time < this.knockUntil) body.setVelocity(this.knockVx, this.knockVy);

    // i-frame flicker.
    this.player.setAlpha(gs.invulnMs > 0 ? 0.55 : 1);

    // Enemies: AI + contact damage.
    for (const enemy of this.enemies) {
      enemy.update(time, deltaMs, px, py);
      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, px, py);
      if (dist < CONTACT_RANGE && CombatSystem.damagePlayer(enemy.touchDamage)) {
        Sfx.play('deny');
        // Knock the player away from the enemy; shove the enemy back a touch too.
        const a = Math.atan2(py - enemy.y, px - enemy.x);
        this.knockVx = Math.cos(a) * KNOCKBACK_SPEED;
        this.knockVy = Math.sin(a) * KNOCKBACK_SPEED;
        this.knockUntil = time + KNOCKBACK_MS;
        (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(-Math.cos(a) * 120, -Math.sin(a) * 120);
        if (gs.hp <= 0) {
          this.knockOut();
          return;
        }
      }
    }

    // Loot magnetism (scene-local drops list; the base scene's is private).
    if (this.lootDrops.length > 0) {
      const remaining: DroppedItem[] = [];
      for (const drop of this.lootDrops) {
        drop.age += deltaMs;
        if (drop.magnetTo(px, py, deltaMs) && gs.addItem(drop.item, 1)) {
          Sfx.play('select');
          this.game.events.emit('toast', `+1 ${drop.item === 'slime-gel' ? 'Slime Gel' : 'Bat Wing'}`);
          drop.destroy();
        } else {
          remaining.push(drop);
        }
      }
      this.lootDrops = remaining;
    }

    // HUD.
    const frac = Math.max(0, Math.min(1, gs.hp / gs.maxHp));
    this.hpBar.setScale(frac, 1);
    this.hpText.setText(`${gs.hp}/${gs.maxHp}`);
  }
}
