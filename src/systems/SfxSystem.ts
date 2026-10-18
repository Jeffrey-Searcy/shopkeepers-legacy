/**
 * SfxSystem — tiny synthesized sound effects via WebAudio. Zero external assets.
 *
 * Each effect is a short envelope built from oscillators and filtered noise, tuned to read as "cozy
 * farming game" feedback: chop/mine/scythe/sword/till/water/plant/harvest/pickup/stash/sleep/
 * select/deny/talk/eat/magic/fell/crumble, plus quiet footsteps per ground surface (Sfx.step).
 *
 * Cozy rules every recipe follows:
 *  - round waveforms only (sine and triangle); no square or sawtooth buzz;
 *  - every envelope fades in over a few milliseconds, so nothing clicks or snaps;
 *  - noise is always filtered (lowpass or bandpass), so no hiss is sharp;
 *  - peak levels stay low, and the whole mix passes a soft treble filter (SOFT_TOP_HZ).
 *
 * The AudioContext is created lazily on the first play() (which follows a user gesture, satisfying
 * browser autoplay policy). Disabled entirely in test mode (?test=1) so headless Playwright runs stay
 * silent and deterministic.
 */
import { SettingsSystem, SETTINGS_CHANGED_EVENT } from './SettingsSystem';

export type SfxName =
  | 'chop'
  | 'mine'
  | 'scythe'
  | 'sword'
  | 'till'
  | 'water'
  | 'plant'
  | 'harvest'
  | 'pickup'
  | 'stash'
  | 'sleep'
  | 'select'
  | 'deny'
  | 'talk'
  | 'eat'
  | 'magic'
  | 'fell'
  | 'crumble';

/** The ground a footstep lands on; each has one quiet recipe in STEPS. */
export type FootSurface = 'grass' | 'dirt' | 'stone' | 'wood' | 'sand';

/** Every surface, for callers that check authored data against the known set. */
export const FOOT_SURFACES: readonly FootSurface[] = ['grass', 'dirt', 'stone', 'wood', 'sand'];

/**
 * The treble ceiling (Hz) of the whole mix. Effects and place sounds pass this lowpass after the master
 * volume, so even the brightest recipe stays soft on laptop speakers and headphones.
 */
const SOFT_TOP_HZ = 6500;

let ctx: AudioContext | null = null;
/** One master gain connects every effect to the user's actual sound-volume preference. */
let masterGain: GainNode | null = null;
/** One second of white noise per context, shared by every noise burst (read from a random offset). */
let noiseBuf: AudioBuffer | null = null;
let disabled = false;

/** Lazily create (or resume) the shared AudioContext. Returns null when audio is unavailable. */
function audio(): AudioContext | null {
  if (disabled) return null;
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('test') === '1') {
    disabled = true; // deterministic, silent test runs
    return null;
  }
  // Preference corruption is not an audio-capability failure; surface it before the audio catch.
  const volume = SettingsSystem.get().soundVolume;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      // why: the master gain carries ONLY the player's volume (the settings test reads its values), so
      // the cozy treble ceiling is a separate filter after it.
      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(volume, ctx.currentTime);
      const softTop = ctx.createBiquadFilter();
      softTop.type = 'lowpass';
      softTop.frequency.value = SOFT_TOP_HZ;
      softTop.Q.value = 0.5;
      masterGain.connect(softTop);
      softTop.connect(ctx.destination);
      window.addEventListener(SETTINGS_CHANGED_EVENT, () => {
        if (!ctx || !masterGain) throw new Error('SfxSystem: initialized audio is missing its master gain.');
        masterGain.gain.setValueAtTime(SettingsSystem.get().soundVolume, ctx.currentTime);
      });
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    disabled = true; // no audio support — stay silent rather than crash the game loop
    return null;
  }
}

/** The master gain, or a loud error: every recipe runs after audio() succeeded, so a missing one is a bug. */
function bus(): GainNode {
  if (!masterGain) throw new Error('SfxSystem: cannot play without a master gain.');
  return masterGain;
}

/** One pitched note of a recipe. Times are seconds after the recipe starts. */
interface ToneSpec {
  freq: number;
  /** Slide to this pitch by the end of the note. */
  freqEnd?: number;
  dur: number;
  type?: 'sine' | 'triangle';
  /** Peak level before the master volume. */
  gain: number;
  /** Fade-in time; a few ms takes the click off the start. */
  attack?: number;
  /** Start delay. */
  at?: number;
}

/**
 * Play one soft note: an oscillator with a fade-in and an exponential fade-out.
 * @param ac the live context
 * @param spec pitch, length, level and timing
 */
function tone(ac: AudioContext, spec: ToneSpec): void {
  const t = ac.currentTime + (spec.at ?? 0);
  const attack = spec.attack ?? 0.006;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = spec.type ?? 'sine';
  osc.frequency.setValueAtTime(spec.freq, t);
  if (spec.freqEnd) osc.frequency.exponentialRampToValueAtTime(spec.freqEnd, t + spec.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(spec.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
  osc.connect(g).connect(bus());
  osc.start(t);
  osc.stop(t + spec.dur + 0.02);
}

/** One filtered noise burst of a recipe (thock, swish, rustle, crunch). Times are seconds after the start. */
interface HushSpec {
  dur: number;
  /** 'lowpass' keeps the low rumble under `hz`; 'bandpass' keeps a band around `hz` (rustles, crunches). */
  filter: 'lowpass' | 'bandpass';
  hz: number;
  /** Band width for 'bandpass' (higher = narrower); ignored by 'lowpass'. */
  q?: number;
  gain: number;
  attack?: number;
  at?: number;
}

/** The shared noise buffer, made once per context. */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/**
 * Play one filtered noise burst with a fade-in and fade-out.
 * @param ac the live context
 * @param spec filter, length, level and timing
 */
function hush(ac: AudioContext, spec: HushSpec): void {
  const t = ac.currentTime + (spec.at ?? 0);
  const attack = spec.attack ?? 0.004;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = spec.filter;
  filter.frequency.value = spec.hz;
  if (spec.filter === 'bandpass') filter.Q.value = spec.q ?? 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(spec.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
  src.connect(filter).connect(g).connect(bus());
  // why: a random offset into the shared buffer, so repeated bursts never sound like a loop.
  src.start(t, Math.random() * 0.8, spec.dur + 0.02);
}

/** A random factor in 1 ± spread, so repeated sounds (steps, pickups, chatter) never repeat exactly. */
function vary(spread: number): number {
  return 1 + (Math.random() * 2 - 1) * spread;
}

/** Pickup chime state: pickups close together climb a gentle scale instead of repeating one note. */
const pickupRun = { lastAt: -Infinity, step: 0 };
/** Notes of the pickup run (a major pentatonic from E5), so any run of pickups sounds like a little tune. */
const PICKUP_NOTES = [659, 740, 831, 988, 1109];
/** Pickups closer than this (seconds) are one sound: five logs collected in one frame chime once. */
const PICKUP_MERGE_S = 0.04;
/** Pickups within this gap (seconds) of the last one continue the run upward. */
const PICKUP_RUN_S = 0.45;

/** Seconds from a tree starting to fall to its thump on the ground; NodeBreakFx's FELL_MS matches it. */
export const FELL_THUMP_S = 0.55;

/** The effect recipes. Levels are peaks before the master volume; keep them low and round. */
const RECIPES: Record<SfxName, (ac: AudioContext) => void> = {
  // Axe in wood: a dull woody knock with a short low body.
  chop: (ac) => {
    hush(ac, { dur: 0.1, filter: 'lowpass', hz: 700, gain: 0.08 });
    tone(ac, { freq: 150 * vary(0.05), freqEnd: 110, dur: 0.09, type: 'triangle', gain: 0.07 });
  },
  // Pick on stone: a rounded "tink" with a soft overtone and a little grit, not a sharp click.
  mine: (ac) => {
    hush(ac, { dur: 0.05, filter: 'lowpass', hz: 1400, gain: 0.04 });
    tone(ac, { freq: 520 * vary(0.04), freqEnd: 430, dur: 0.1, type: 'triangle', gain: 0.045 });
    tone(ac, { freq: 1040, freqEnd: 900, dur: 0.06, gain: 0.012 });
  },
  // Scythe through grass: a soft swish that swells in.
  scythe: (ac) => hush(ac, { dur: 0.15, filter: 'bandpass', hz: 1200, q: 0.8, gain: 0.05, attack: 0.03 }),
  // Sword swing: a short swish with a falling round tone.
  sword: (ac) => {
    hush(ac, { dur: 0.1, filter: 'bandpass', hz: 1800, q: 0.9, gain: 0.04, attack: 0.02 });
    tone(ac, { freq: 700, freqEnd: 450, dur: 0.08, gain: 0.025 });
  },
  // Hoe in soil: an earthy thud.
  till: (ac) => {
    hush(ac, { dur: 0.13, filter: 'lowpass', hz: 450, gain: 0.08, attack: 0.01 });
    tone(ac, { freq: 110, freqEnd: 80, dur: 0.1, gain: 0.04 });
  },
  // Watering can: a soft pour and two drips.
  water: (ac) => {
    hush(ac, { dur: 0.3, filter: 'lowpass', hz: 900, gain: 0.04, attack: 0.05 });
    tone(ac, { freq: 900, freqEnd: 620, dur: 0.06, gain: 0.015, at: 0.09 });
    tone(ac, { freq: 780, freqEnd: 540, dur: 0.06, gain: 0.012, at: 0.19 });
  },
  // Seed into soil: a small soft pat and a low settling note.
  plant: (ac) => {
    hush(ac, { dur: 0.06, filter: 'lowpass', hz: 500, gain: 0.04 });
    tone(ac, { freq: 420, freqEnd: 300, dur: 0.1, gain: 0.04 });
  },
  // Harvest: two soft rising notes (C5 then G5).
  harvest: (ac) => {
    tone(ac, { freq: 523, dur: 0.14, type: 'triangle', gain: 0.045 });
    tone(ac, { freq: 784, dur: 0.18, type: 'triangle', gain: 0.04, at: 0.08 });
  },
  // An item lands in the bag: a small round "bloop" that climbs the PICKUP_NOTES run on quick repeats.
  pickup: (ac) => {
    const now = ac.currentTime;
    const gap = now - pickupRun.lastAt;
    if (gap < PICKUP_MERGE_S) return;
    pickupRun.step = gap < PICKUP_RUN_S ? Math.min(pickupRun.step + 1, PICKUP_NOTES.length - 1) : 0;
    pickupRun.lastAt = now;
    const f = PICKUP_NOTES[pickupRun.step];
    tone(ac, { freq: f * 0.8, freqEnd: f, dur: 0.11, gain: 0.035, attack: 0.008 });
    tone(ac, { freq: f * 2, dur: 0.07, type: 'triangle', gain: 0.006, attack: 0.01 });
  },
  // Into a chest or bin: a soft wooden thump.
  stash: (ac) => {
    hush(ac, { dur: 0.06, filter: 'lowpass', hz: 400, gain: 0.03 });
    tone(ac, { freq: 260, freqEnd: 190, dur: 0.12, gain: 0.05 });
  },
  // Off to bed: two slow falling notes, like a small lullaby.
  sleep: (ac) => {
    tone(ac, { freq: 523, freqEnd: 392, dur: 0.6, gain: 0.04, attack: 0.04 });
    tone(ac, { freq: 392, freqEnd: 262, dur: 0.7, gain: 0.03, attack: 0.05, at: 0.25 });
  },
  // UI choice: a tiny soft tick (it plays a lot, so it is the quietest sound).
  select: (ac) => tone(ac, { freq: 880, freqEnd: 830, dur: 0.035, gain: 0.02, attack: 0.004 }),
  // Not allowed: a gentle low "bonk", never a buzz.
  deny: (ac) => tone(ac, { freq: 220, freqEnd: 165, dur: 0.15, type: 'triangle', gain: 0.045, attack: 0.008 }),
  // Chatter: a short soft blip that wanders a little in pitch.
  talk: (ac) => tone(ac, { freq: 520 * vary(0.06), dur: 0.05, gain: 0.022 }),
  // A soft crunch, then a small rising note: eating or drinking.
  eat: (ac) => {
    hush(ac, { dur: 0.06, filter: 'lowpass', hz: 900, gain: 0.045 });
    tone(ac, { freq: 520, freqEnd: 700, dur: 0.08, gain: 0.035, at: 0.06 });
  },
  // A rising shimmer: mana is felt, gained or spent.
  magic: (ac) => {
    tone(ac, { freq: 880, freqEnd: 1320, dur: 0.14, gain: 0.03, attack: 0.02 });
    tone(ac, { freq: 1320, freqEnd: 1760, dur: 0.18, gain: 0.025, attack: 0.02, at: 0.09 });
  },
  // A felled tree: a low creak as it tips, a rustle of leaves, and a soft thump as it lands. The thump is
  // timed to NodeBreakFx's fall (FELL_MS), so the sound lands with the picture.
  fell: (ac) => {
    tone(ac, { freq: 140 * vary(0.05), freqEnd: 95, dur: 0.35, type: 'triangle', gain: 0.03, attack: 0.08 });
    hush(ac, { dur: 0.4, filter: 'bandpass', hz: 1600, q: 0.7, gain: 0.03, attack: 0.2, at: 0.15 });
    hush(ac, { dur: 0.22, filter: 'lowpass', hz: 300, gain: 0.09, attack: 0.01, at: FELL_THUMP_S });
    tone(ac, { freq: 75, freqEnd: 50, dur: 0.2, gain: 0.05, at: FELL_THUMP_S });
  },
  // A rock breaks apart: three small rounded knocks tumbling down, over a little gravel.
  crumble: (ac) => {
    hush(ac, { dur: 0.25, filter: 'lowpass', hz: 900, gain: 0.04, attack: 0.01 });
    tone(ac, { freq: 300 * vary(0.05), freqEnd: 220, dur: 0.07, type: 'triangle', gain: 0.03 });
    tone(ac, { freq: 240 * vary(0.05), freqEnd: 180, dur: 0.07, type: 'triangle', gain: 0.025, at: 0.07 });
    tone(ac, { freq: 200 * vary(0.05), freqEnd: 150, dur: 0.08, type: 'triangle', gain: 0.02, at: 0.15 });
  },
};

/**
 * Footstep recipes: very quiet, each varied in pitch and level by the caller's `p` and `g` factors.
 * @param p pitch factor (about 1)
 * @param g level factor (about 1)
 */
const STEPS: Record<FootSurface, (ac: AudioContext, p: number, g: number) => void> = {
  // A soft leafy rustle.
  grass: (ac, p, g) => hush(ac, { dur: 0.07, filter: 'bandpass', hz: 2400 * p, q: 0.7, gain: 0.014 * g, attack: 0.012 }),
  // A muffled pat on packed earth.
  dirt: (ac, p, g) => {
    hush(ac, { dur: 0.07, filter: 'lowpass', hz: 650 * p, gain: 0.03 * g, attack: 0.006 });
    tone(ac, { freq: 95 * p, freqEnd: 70, dur: 0.05, gain: 0.014 * g });
  },
  // A light tap on cobbles and stone floors.
  stone: (ac, p, g) => {
    hush(ac, { dur: 0.035, filter: 'bandpass', hz: 2000 * p, q: 1.1, gain: 0.016 * g, attack: 0.003 });
    tone(ac, { freq: 330 * p, freqEnd: 290, dur: 0.035, type: 'triangle', gain: 0.009 * g, attack: 0.003 });
  },
  // A hollow knock on planks.
  wood: (ac, p, g) => {
    tone(ac, { freq: 205 * p, freqEnd: 165, dur: 0.07, type: 'triangle', gain: 0.026 * g, attack: 0.004 });
    hush(ac, { dur: 0.04, filter: 'lowpass', hz: 1100 * p, gain: 0.014 * g, attack: 0.004 });
  },
  // A soft crunch of sand.
  sand: (ac, p, g) => {
    hush(ac, { dur: 0.09, filter: 'bandpass', hz: 3000 * p, q: 0.6, gain: 0.014 * g, attack: 0.02 });
    hush(ac, { dur: 0.05, filter: 'lowpass', hz: 500 * p, gain: 0.012 * g, attack: 0.01 });
  },
};

export const Sfx = {
  /** Play a named effect (no-op in test mode / when audio is unavailable). */
  play(name: SfxName): void {
    const ac = audio();
    if (!ac) return;
    RECIPES[name](ac);
  },
  /**
   * Play one quiet footstep on a surface, varied a little so a walk never sounds like a loop.
   * No-op in test mode / when audio is unavailable.
   */
  step(surface: FootSurface): void {
    const ac = audio();
    if (!ac) return;
    STEPS[surface](ac, vary(0.08), vary(0.15));
  },
  /**
   * The shared audio context and the master gain (the player's sound volume), for long-running
   * sounds such as AmbientSound's room loops.
   * @returns null in test mode or when audio is unavailable, exactly when play() is silent
   */
  output(): { ac: AudioContext; out: GainNode } | null {
    const ac = audio();
    if (!ac) return null;
    return { ac, out: bus() };
  },
};
