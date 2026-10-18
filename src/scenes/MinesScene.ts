/**
 * MinesScene — Mines L1, now a Moonlighter-style combat dungeon (the designer's directive: the mines PLAY
 * like Moonlighter — real-time combat, dodge-roll i-frames, loot drops — while combat stays
 * CONFINED to this scene; outside the mines there is no HP, damage, or combat HUD).
 *
 * The shared combat loop (keys, enemies, loot magnetism, HP HUD) lives in CombatController, which
 * the portal dungeon also uses. This scene keeps the Mines rules:
 *  - deterministic enemy spawns (local lcg over open cave tiles, never near the entrance),
 *  - loot goes straight into the inventory,
 *  - knockout: 20% gold penalty, day advances (sleep path), wake at Home,
 *  - leaving the mines (any scene shutdown) heals to full,
 *  - the keeper's adventuring party (GameState.social.party) arrives beside the keeper and fights
 *    through the same kill path as the sword (see PartyCompanion).
 */
import Phaser from 'phaser';
import { SceneKey } from '../config/AssetKeys';
import { TILE } from '../config/GameConfig';
import { BaseWorldScene } from './BaseWorldScene';
import { GameState } from '../state/GameState';
import { CombatSystem } from '../combat/CombatSystem';
import { CombatController } from '../combat/CombatController';
import { Slime } from '../entities/Slime';
import { Bat } from '../entities/Bat';
import { PartyCompanions, mapWalkable } from '../entities/PartyCompanion';
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

/** Base damage of one sword hit in the Mines; each forge level (Rhea's tempering) adds one. */
const SWORD_DAMAGE = 2;

export class MinesScene extends BaseWorldScene {
  /** Shared combat loop (keys, enemies, loot, HP HUD); rebuilt on every create. */
  private combat!: CombatController;
  /** The keeper's recruited residents; rebuilt on every create. */
  private party!: PartyCompanions;
  private clearedToastShown = false;
  private dying = false;

  /** Register under the Mines world key. */
  constructor() {
    super(SceneKey.Mines);
  }

  /** Build the combat loop, spawn the monsters, bring the party in beside the keeper, and expose test hooks. */
  create(): void {
    super.create();
    this.clearedToastShown = false;
    this.dying = false;
    this.combat = new CombatController(this, this.player, {
      swordDamage: () => SWORD_DAMAGE + GameState.instance.progress.forgeLevel,
      onEnemyKilled: (enemy, tx, ty) => {
        this.combat.dropLoot(enemy.lootItem, tx, ty);
        if (!this.clearedToastShown && this.combat.enemies.length === 0) {
          this.clearedToastShown = true;
          Sfx.play('harvest');
          this.game.events.emit('toast', 'Level cleared! The way deeper is blocked... (coming soon)');
        }
      },
      collect: item => {
        if (!GameState.instance.addItem(item, 1)) return false;
        this.game.events.emit('toast', `+1 ${item === 'slime-gel' ? 'Slime Gel' : 'Bat Wing'}`);
        return true;
      },
      onKnockedOut: () => this.knockOut(),
    });
    this.spawnEnemies();
    this.party = new PartyCompanions(this, mapWalkable(this.map), () => GameState.instance.social.party, 'combat');
    this.party.placeNearKeeper();

    // The test seam's enemies() reads from whichever Mines instance is live.
    registerEnemyProvider(() =>
      this.combat.enemies.map((e) => ({
        kind: e.lootItem === 'slime-gel' ? 'slime' : 'bat',
        tx: Math.floor(e.x / TILE),
        ty: Math.floor(e.y / TILE),
        hp: e.hp,
      }))
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => registerEnemyProvider(null));
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
      this.combat.addEnemy(i < 4 ? new Slime(this, x, y) : new Bat(this, x, y));
    });
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

  /** A held healing potion is drunk in combat scenes; other held items use the base behaviour. */
  protected override handleHeldItemUse(item: string): boolean {
    if (item !== 'healing-potion') return false;
    this.combat.drinkPotion();
    return true;
  }

  /**
   * Base world update, then the shared combat frame and the party (both skipped once knocked out).
   * @param time scene clock in ms
   * @param deltaMs frame time in ms
   */
  update(time: number, deltaMs: number): void {
    super.update(time, deltaMs);
    if (this.dying) return;
    if (!this.combat.update(time, deltaMs)) return;
    this.party.update(deltaMs, this.combat);
  }
}
