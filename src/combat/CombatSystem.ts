/**
 * CombatSystem — the Moonlighter-style combat core (V1: Mines-only).
 *
 * Pure-ish helpers over GameState's combat fields (hp/maxHp/invulnMs/dodgeCooldownMs). The
 * MinesScene owns all the Phaser wiring (enemies, HUD, knockback, death flow); this module owns
 * the rules so specs can reason about them deterministically:
 *  - damagePlayer respects i-frames (dodge grants DODGE_INVULN_MS; taking a hit grants a short
 *    HIT_INVULN_MS so contact damage ticks, not melts).
 *  - startDodge only fires off cooldown; the scene applies the dash velocity.
 *  - Combat exists ONLY in the Mines for V1: nothing outside MinesScene calls these.
 */
import { GameState } from '../state/GameState';

/** i-frames granted by a dodge roll (ms). */
export const DODGE_INVULN_MS = 400;
/** Cooldown between dodges (ms). */
export const DODGE_COOLDOWN_MS = 900;
/** Brief i-frames after taking a hit (prevents per-frame contact melt). */
export const HIT_INVULN_MS = 600;
/** Dodge dash speed (px/s) — the scene applies this along the held/facing direction. */
export const DODGE_SPEED = 300;
/** How long the dash burst lasts (ms). */
export const DODGE_DASH_MS = 180;

export const CombatSystem = {
  /**
   * Apply damage to the player unless invulnerable. Returns true if damage landed (the scene then
   * applies knockback/SFX and checks for death).
   */
  damagePlayer(n: number): boolean {
    const gs = GameState.instance;
    if (gs.invulnMs > 0) return false;
    gs.hp = Math.max(0, gs.hp - n);
    gs.invulnMs = HIT_INVULN_MS;
    return true;
  },

  /** Begin a dodge roll if off cooldown. Returns true when the dodge starts. */
  startDodge(): boolean {
    const gs = GameState.instance;
    if (gs.dodgeCooldownMs > 0) return false;
    gs.invulnMs = Math.max(gs.invulnMs, DODGE_INVULN_MS);
    gs.dodgeCooldownMs = DODGE_COOLDOWN_MS;
    return true;
  },

  /** Decay the combat timers; call once per frame from the scene update. */
  tick(deltaMs: number): void {
    const gs = GameState.instance;
    gs.invulnMs = Math.max(0, gs.invulnMs - deltaMs);
    gs.dodgeCooldownMs = Math.max(0, gs.dodgeCooldownMs - deltaMs);
  },

  /** Restore to full health (leaving the mines / after the knockout wake-up). */
  heal(): void {
    const gs = GameState.instance;
    gs.hp = gs.maxHp;
    gs.invulnMs = 0;
    gs.dodgeCooldownMs = 0;
  },
};
