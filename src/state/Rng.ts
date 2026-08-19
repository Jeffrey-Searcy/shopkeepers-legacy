/**
 * Rng — a tiny deterministic pseudo-random generator (mulberry32).
 *
 * Per CLAUDE.md / GAME_SPEC, all gameplay randomness must be seeded from the `seed` URL param so
 * Playwright runs are reproducible (no flaky tests). Never call Math.random() in gameplay code —
 * use this. The seed is read once from the URL at boot (see main.ts).
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Ensure a non-zero 32-bit state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** The shared instance, seeded at boot. */
  private static _instance: Rng | null = null;
  static seed(seed: number): void {
    Rng._instance = new Rng(seed);
  }
  static get instance(): Rng {
    if (!Rng._instance) Rng._instance = new Rng(42);
    return Rng._instance;
  }
}
