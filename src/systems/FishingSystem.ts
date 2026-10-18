/**
 * FishingSystem — the Stardew-style fishing loop:
 *   cast at water → wait → bite window → REEL MINIGAME (keep the fish inside your bar) → catch/escape.
 *
 * Reel minigame model (all state in GameState.fishing, serialized for tests):
 *  - A vertical track 0..TRACK. The player's catch ZONE (height ZONE_H) is pushed UP while the
 *    reel input is held (Space / mouse / seam 'reel:on') and sinks under gravity when released —
 *    tap or hold to keep it around the fish.
 *  - The FISH wanders toward seeded-random targets.
 *  - PROGRESS fills while the fish is inside the zone and drains while outside; full = caught,
 *    empty = it escapes. Tuned forgiving for V1 (gain > drain).
 * The scene calls tickReel() each frame with the input state; UIScene renders the bar.
 */
import { GameState } from '../state/GameState';
import { Rng } from '../state/Rng';
import { SceneKey } from '../config/AssetKeys';

/**
 * The fish table. `weight` = how often it bites; rarer fish are HARDER (the designer's rule): `speed` is
 * how fast it darts around the track, `drainMult` scales how quickly progress bleeds when it's
 * outside your zone. Icons exist as `icon-<id>`.
 * `waters` lists the scenes where the fish bites; null = any water. The first three bite anywhere
 * (the farm pond keeps its original catch table); the week-one fish reward visiting new places.
 */
export const FISH: readonly { id: string; label: string; weight: number; speed: number; drainMult: number; waters: readonly SceneKey[] | null }[] = [
  { id: 'fish-sardine', label: 'Sardine', weight: 5, speed: 42, drainMult: 1.0, waters: null },
  { id: 'fish-bass', label: 'Bass', weight: 3, speed: 62, drainMult: 1.25, waters: null },
  { id: 'fish-carp', label: 'Carp', weight: 2, speed: 85, drainMult: 1.6, waters: null },
  { id: 'fish-trout', label: 'Trout', weight: 3, speed: 70, drainMult: 1.3, waters: [SceneKey.Forest] },
  { id: 'fish-pike', label: 'Pike', weight: 1, speed: 95, drainMult: 1.7, waters: [SceneKey.Forest] },
  { id: 'fish-eel', label: 'Eel', weight: 3, speed: 80, drainMult: 1.45, waters: [SceneKey.Beach] },
];

/**
 * The fish that can bite in one scene.
 * @throws when no fish lives there (fishing must never silently fall back to another table)
 */
export function fishForScene(scene: SceneKey): readonly (typeof FISH)[number][] {
  const pool = FISH.filter(fish => fish.waters === null || fish.waters.includes(scene));
  if (pool.length === 0) throw new Error(`FishingSystem: no fish live in ${scene}`);
  return pool;
}

/** How long a bite stays hookable (ms). */
export const BITE_WINDOW_MS = 700;

/** Reel-minigame geometry/tuning (track units; UIScene scales to pixels). */
export const TRACK = 100;
export const ZONE_H = 32;
const ZONE_FORCE = 320; // upward accel while reeling (units/s^2)
const GRAVITY = 240; // downward accel (units/s^2)
const ZONE_MAX_V = 130;
const GAIN = 0.3; // progress/s while the fish is in the zone
const DRAIN = 0.12; // base progress/s while it isn't (scaled by the fish's drainMult)

export const FishingSystem = {
  /** Begin a cast. Returns how long until the bite (ms), seeded-random 1.2–3.6s. */
  startCast(): number {
    GameState.instance.fishing = { phase: 'waiting' };
    return 1200 + Rng.instance.next() * 2400;
  },

  /** The bobber dips — the hook window opens. No-op if the cast was cancelled meanwhile. */
  bite(): void {
    const gs = GameState.instance;
    if (gs.fishing?.phase === 'waiting') gs.fishing = { phase: 'bite' };
  },

  /** Hooking during the bite window starts the reel minigame — the fish on the line is decided
   *  NOW (weighted), so its difficulty shapes the fight and the bar can show which fish it is. */
  startReel(): void {
    const gs = GameState.instance;
    if (gs.fishing?.phase !== 'bite') return;
    const pool = fishForScene(gs.activeScene);
    const total = pool.reduce((a, f) => a + f.weight, 0);
    let roll = Rng.instance.next() * total;
    let picked: (typeof FISH)[number] = pool[0];
    for (const f of pool) {
      roll -= f.weight;
      if (roll <= 0) {
        picked = f;
        break;
      }
    }
    gs.fishing = {
      phase: 'reeling',
      fishId: picked.id,
      progress: 0.4,
      zonePos: 20,
      zoneVel: 0,
      fishPos: 50,
      fishTarget: 50,
    };
  },

  /**
   * One physics step of the reel minigame. On 'caught' the weighted fish has been added to the
   * bag (returned for the toast); on 'escaped' the fishing state has been cleared.
   */
  tickReel(
    deltaMs: number,
    reelHeld: boolean
  ):
    | { status: 'idle' | 'ongoing' | 'escaped' }
    | { status: 'caught'; fish: { id: string; label: string; stored: boolean } } {
    const gs = GameState.instance;
    const f = gs.fishing;
    if (!f || f.phase !== 'reeling') return { status: 'idle' };
    const dt = deltaMs / 1000;

    // Zone: thrust up while held, gravity down; clamp to the track (kill velocity at the ends).
    f.zoneVel = (f.zoneVel ?? 0) + (reelHeld ? ZONE_FORCE : -GRAVITY) * dt;
    f.zoneVel = Math.max(-ZONE_MAX_V, Math.min(ZONE_MAX_V, f.zoneVel));
    f.zonePos = (f.zonePos ?? 0) + f.zoneVel * dt;
    if (f.zonePos < 0) {
      f.zonePos = 0;
      f.zoneVel = 0;
    }
    if (f.zonePos > TRACK - ZONE_H) {
      f.zonePos = TRACK - ZONE_H;
      f.zoneVel = 0;
    }

    // Fish: wander toward a seeded-random target at ITS species' speed; retarget when reached.
    const species = FISH.find((x) => x.id === f.fishId) ?? FISH[0];
    const target = f.fishTarget ?? 50;
    const pos = f.fishPos ?? 50;
    if (Math.abs(target - pos) < 2) {
      f.fishTarget = Rng.instance.next() * (TRACK - 8);
    } else {
      f.fishPos = pos + Math.sign(target - pos) * species.speed * dt;
    }

    // Progress: rarer fish bleed the bar faster when they slip out of the zone.
    const inZone = (f.fishPos ?? 50) >= (f.zonePos ?? 0) && (f.fishPos ?? 50) <= (f.zonePos ?? 0) + ZONE_H;
    f.progress = (f.progress ?? 0.4) + (inZone ? GAIN : -DRAIN * species.drainMult) * dt;

    if (f.progress >= 1) {
      const fish = this.awardFish();
      return { status: 'caught', fish };
    }
    if (f.progress <= 0) {
      gs.fishing = null;
      return { status: 'escaped' };
    }
    return { status: 'ongoing' };
  },

  /** Award the fish that was on the line (picked at startReel); clears the fishing state. */
  awardFish(): { id: string; label: string; stored: boolean } {
    const gs = GameState.instance;
    const picked = FISH.find((f) => f.id === gs.fishing?.fishId) ?? FISH[0];
    const stored = gs.addItem(picked.id, 1);
    gs.fishing = null;
    return { id: picked.id, label: picked.label, stored };
  },

  /** Reel in / cancel (moving, recasting, missing the window). */
  cancel(): void {
    GameState.instance.fishing = null;
  },
};
