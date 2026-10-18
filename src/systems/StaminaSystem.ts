/**
 * StaminaSystem — thin wrapper over GameState.player.stamina.
 *
 * Tool use costs stamina; sleeping (M6) and food restore it. The Well Fed buff lowers the tool cost
 * (VitalitySystem.toolStaminaCost). Kept as a system (not scattered) so the UI
 * and tests read one place. Fail-loud is not needed here — running out of stamina is a valid game
 * state, not an error — but we clamp at 0 and never silently go negative.
 */
import { GameState } from '../state/GameState';
import { STAMINA_MAX } from '../config/GameConfig';
import { VitalitySystem } from './VitalitySystem';

export const StaminaSystem = {
  /** Current stamina. */
  get(): number {
    return GameState.instance.player.stamina;
  },

  /** True if the player has enough stamina to act at today's tool cost. */
  canAct(): boolean {
    return GameState.instance.player.stamina >= VitalitySystem.toolStaminaCost();
  },

  /** Spend the current tool cost (lower while Well Fed). Returns true if it was spent, false if too tired. */
  spendForTool(): boolean {
    const p = GameState.instance.player, cost = VitalitySystem.toolStaminaCost();
    if (p.stamina < cost) return false;
    p.stamina = Math.max(0, p.stamina - cost);
    return true;
  },

  /** Restore stamina on sleep. `frac` < 1 models a rough night (passing out at 2am). */
  restore(frac = 1): void {
    GameState.instance.player.stamina = Math.round(STAMINA_MAX * frac);
  },
};
