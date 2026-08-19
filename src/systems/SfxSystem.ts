/**
 * SfxSystem — tiny synthesized sound effects via WebAudio. Zero external assets.
 *
 * Each effect is a short (<300ms) envelope built from oscillators and filtered noise, tuned to read
 * as "cozy farming game" feedback: chop/mine/scythe/sword/till/water/plant/harvest/stash/sleep/
 * select/deny/talk. The AudioContext is created lazily on the first play() (which follows a user
 * gesture, satisfying browser autoplay policy). Disabled entirely in test mode (?test=1) so
 * headless Playwright runs stay silent and deterministic.
 */

export type SfxName =
  | 'chop'
  | 'mine'
  | 'scythe'
  | 'sword'
  | 'till'
  | 'water'
  | 'plant'
  | 'harvest'
  | 'stash'
  | 'sleep'
  | 'select'
  | 'deny'
  | 'talk';

let ctx: AudioContext | null = null;
let disabled = false;

/** Lazily create (or resume) the shared AudioContext. Returns null when audio is unavailable. */
function audio(): AudioContext | null {
  if (disabled) return null;
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).get('test') === '1') {
    disabled = true; // deterministic, silent test runs
    return null;
  }
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    disabled = true; // no audio support — stay silent rather than crash the game loop
    return null;
  }
}

/** Play a short oscillator blip. */
function blip(
  ac: AudioContext,
  freq: number,
  dur = 0.06,
  type: OscillatorType = 'square',
  gain = 0.12,
  freqEnd?: number
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + dur);
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

/** Play a filtered white-noise burst (thock/swish/scrape textures). */
function noise(ac: AudioContext, dur: number, filterFreq: number, gain = 0.1): void {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start();
}

/** The effect recipes. Kept small and punchy; tweak freely. */
const RECIPES: Record<SfxName, (ac: AudioContext) => void> = {
  chop: (ac) => {
    noise(ac, 0.09, 900, 0.14);
    blip(ac, 180, 0.07, 'triangle', 0.12);
  },
  mine: (ac) => {
    noise(ac, 0.05, 2500, 0.1);
    blip(ac, 1200, 0.04, 'square', 0.07);
  },
  scythe: (ac) => noise(ac, 0.12, 1600, 0.09),
  sword: (ac) => {
    noise(ac, 0.08, 3200, 0.07);
    blip(ac, 980, 0.06, 'triangle', 0.07, 540);
  },
  till: (ac) => noise(ac, 0.13, 500, 0.12),
  water: (ac) => noise(ac, 0.25, 700, 0.07),
  plant: (ac) => blip(ac, 520, 0.08, 'sine', 0.12, 300),
  harvest: (ac) => {
    blip(ac, 660, 0.07, 'square', 0.09);
    setTimeout(() => blip(ac, 880, 0.09, 'square', 0.09), 70);
  },
  stash: (ac) => blip(ac, 240, 0.09, 'sine', 0.13, 180),
  sleep: (ac) => blip(ac, 600, 0.45, 'sine', 0.1, 180),
  select: (ac) => blip(ac, 660, 0.04, 'square', 0.06),
  deny: (ac) => blip(ac, 110, 0.15, 'sawtooth', 0.07),
  talk: (ac) => blip(ac, 440, 0.05, 'square', 0.06),
};

export const Sfx = {
  /** Play a named effect (no-op in test mode / when audio is unavailable). */
  play(name: SfxName): void {
    const ac = audio();
    if (!ac) return;
    RECIPES[name](ac);
  },
};
