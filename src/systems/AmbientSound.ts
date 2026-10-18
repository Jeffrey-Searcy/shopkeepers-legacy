/**
 * AmbientSound — looping sounds that belong to a place: a portal's hum, toxic sludge that bubbles, lava
 * that rumbles and pops, and the slow waves of the sea. Still water (ponds, lakes) makes no sound, so it
 * has no kind here.
 *
 * Running water (waterfalls, fountains, streams) is silent for now (SILENT_KINDS): the made-up running
 * water never sounded right, and it waits for real recordings. Its places stay in the art data (TownArt,
 * DungeonRooms) and SoundPlans, so a recording can be dropped in later without placing them again.
 *
 * Every sound is made live with WebAudio (no sound files), like SfxSystem's effects, and runs
 * through SfxSystem's master gain, so the player's sound volume applies. Each source has a place in
 * the world and a hearing radius: it is loudest when the keeper stands on it and fades to silence at
 * the radius (ambientGain). The PaintedRoomRenderer creates one AmbientSoundscape per painted room
 * from the art data's `sounds`, calls update() every frame and destroy() when the room goes away.
 * A source is a point (AmbientSource) or an area (AmbientArea: all the water tiles of a map, heard
 * from the nearest one); BaseWorldScene plays its map's water as one area source.
 *
 * In test mode (?test=1) SfxSystem gives no audio output, so a soundscape plays nothing, exactly
 * like Sfx.play. The voice builders take any BaseAudioContext, so a probe can render them in an
 * OfflineAudioContext and check the result without speakers.
 */
import { Sfx } from './SfxSystem';

/** The kinds of place sound. Each audible kind has one recipe in VOICES; the silent ones are in SILENT_KINDS. */
export type AmbientKind = 'portal' | 'waterfall' | 'fountain' | 'toxic' | 'lava' | 'river' | 'sea';

/** Running water: placed in the world, but silent until real recordings replace the made-up sound. */
type SilentKind = 'waterfall' | 'fountain' | 'river';
export const SILENT_KINDS: ReadonlySet<AmbientKind> = new Set<SilentKind>(['waterfall', 'fountain', 'river']);

/** One sound source in world pixels; radius is how far away it can still be heard. */
export interface AmbientSource {
  readonly kind: AmbientKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * A sound spread over an area (a river, the sea): heard as loud as a point source at the area's nearest
 * spot. distanceFrom returns world px from (x, y) to that spot, or Infinity when none is within reach.
 */
export interface AmbientArea {
  readonly kind: AmbientKind;
  readonly radius: number;
  distanceFrom(x: number, y: number): number;
}

/** Whatever hears the sounds: the keeper sprite (its x, y are the keeper's position in world pixels). */
export interface AmbientListener {
  readonly x: number;
  readonly y: number;
}

/**
 * One playing loop. `output` is its volume knob for distance; the soundscape turns it.
 * tick(until) schedules the loop's short one-off sounds (bubbles, pops, drips) up to context time `until`.
 */
export interface AmbientVoice {
  readonly output: GainNode;
  tick(until: number): void;
  /** Stop at context time `at` (now when omitted); `ended` runs once the voice is unplugged. */
  stop(at?: number, ended?: () => void): void;
}

/** Overall level of place sounds under the master volume: a quiet background under the action effects. */
const AMBIENT_LEVEL = 0.55;
/** Seconds ahead that one-off sounds are scheduled each frame (covers a slow frame without gaps). */
const SCHEDULE_AHEAD_S = 0.25;
/** Time constant (seconds) of the distance fade, so walking does not make the volume jump. */
const FADE_S = 0.12;
/** Time constant (seconds) of the fade when a room's sounds end, so leaving a room never cuts sound off. */
const END_FADE_S = 0.08;
/** Seconds after destroy() that the loops stop: a few END_FADE_S, when the fade is silent. */
const END_STOP_S = 0.4;

/**
 * Volume of a source heard from `distance` world px away: 1 on top of it, 0 at `radius` and beyond.
 * Squared, so a sound fades quickly as the keeper walks away, as it would through stone halls.
 * @throws when radius is not positive
 */
export function ambientGain(distance: number, radius: number): number {
  if (!(radius > 0)) throw new Error(`AmbientSound: hearing radius must be positive, got ${radius}`);
  if (distance >= radius) return 0;
  const near = 1 - distance / radius;
  return near * near;
}

/** The noise buffer of each context; every loop and burst shares it (sources only read a buffer). */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, played on loop as the body of rushing and rumbling sounds. */
function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  const made = noiseBuffers.get(ac);
  if (made) return made;
  const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ac, buffer);
  return buffer;
}

/**
 * Builds the node chains of one voice, and remembers every looping source so stop() can end them.
 * One builder per voice; its output gain starts silent until the soundscape sets the distance volume.
 */
class VoiceBuilder {
  readonly output: GainNode;
  private readonly loops: AudioScheduledSourceNode[] = [];

  /**
   * @param ac the audio context (live or offline)
   * @param destination where the voice plays (the master gain, or an offline destination)
   */
  constructor(readonly ac: BaseAudioContext, destination: AudioNode) {
    this.output = ac.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
  }

  /**
   * A looping noise band (lowHz..highHz) at `level`.
   * @returns the band's gain node, so a slow wobble can be added to it
   */
  noiseBand(lowHz: number, highHz: number, level: number): GainNode {
    const source = this.ac.createBufferSource();
    source.buffer = noiseBuffer(this.ac);
    source.loop = true;
    const high = this.ac.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = lowHz;
    const low = this.ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = highHz;
    const gain = this.ac.createGain();
    gain.gain.value = level;
    source.connect(high).connect(low).connect(gain).connect(this.output);
    // why: voices share one noise buffer; a random start keeps two loops of it from sounding alike.
    source.start(0, Math.random() * 2);
    this.loops.push(source);
    return gain;
  }

  /** A steady tone at `level` (portal hums). */
  tone(type: OscillatorType, hz: number, level: number): GainNode {
    const osc = this.ac.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = this.ac.createGain();
    gain.gain.value = level;
    osc.connect(gain).connect(this.output);
    osc.start();
    this.loops.push(osc);
    return gain;
  }

  /** A slow sine wobble of `depth` around a gain's level, `hz` times a second (breathing hums, surging falls). */
  wobble(target: GainNode, hz: number, depth: number): void {
    const lfo = this.ac.createOscillator();
    lfo.frequency.value = hz;
    const amount = this.ac.createGain();
    amount.gain.value = depth;
    lfo.connect(amount).connect(target.gain);
    lfo.start();
    this.loops.push(lfo);
  }

  /** A short pitched note at context time `at`, sliding from `fromHz` to `toHz` (bubbles, drips, chimes). */
  note(at: number, type: OscillatorType, fromHz: number, toHz: number, seconds: number, level: number): void {
    const osc = this.ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(toHz, at + seconds);
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + Math.min(0.02, seconds / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(this.output);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  /** A short noise burst at context time `at` under `highHz` (lava pops, splashes). */
  burst(at: number, highHz: number, seconds: number, level: number): void {
    const source = this.ac.createBufferSource();
    source.buffer = noiseBuffer(this.ac);
    const low = this.ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = highHz;
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    source.connect(low).connect(gain).connect(this.output);
    source.start(at);
    source.stop(at + seconds + 0.02);
  }

  /**
   * Stop every loop at context time `at` (now when omitted) and unplug the voice once they have ended.
   * @param at when the loops stop; the caller fades the sound out before then
   * @param ended called once the voice is unplugged
   */
  stop(at?: number, ended?: () => void): void {
    const when = at ?? this.ac.currentTime;
    for (const loop of this.loops) loop.stop(when);
    const last = this.loops[this.loops.length - 1];
    if (!last) throw new Error('AmbientSound: a voice with no loops cannot be stopped');
    last.onended = () => {
      this.output.disconnect();
      ended?.();
    };
  }
}

/**
 * One-off sounds that repeat at random gaps (minS..maxS seconds) — bubbles, pops, drips.
 * tick(until) plays every event due before `until` and keeps the time of the next one.
 */
function randomEvents(builder: VoiceBuilder, minS: number, maxS: number, play: (at: number) => void): (until: number) => void {
  let next = builder.ac.currentTime + Math.random() * maxS;
  return (until) => {
    // why: while out of earshot no ticks run; restart the gaps from now instead of playing the missed backlog at once.
    if (next < builder.ac.currentTime) next = builder.ac.currentTime + Math.random() * minS;
    while (next < until) {
      play(next);
      next += minS + Math.random() * (maxS - minS);
    }
  };
}

/** The recipes: how each audible kind of place sounds. Levels are before AMBIENT_LEVEL and the master volume. */
const VOICES: Record<Exclude<AmbientKind, SilentKind>, (builder: VoiceBuilder) => (until: number) => void> = {
  // A low, slowly beating hum (two close tones), a breathing swell and a faint high shimmer, with a soft chime now and then.
  // why: the triangle overtones (147 Hz, 220 Hz) carry the hum on laptop speakers, which barely play 73 Hz.
  portal: (v) => {
    const hum = v.tone('sine', 73.4, 0.035);
    v.tone('sine', 74.1, 0.035);
    v.wobble(v.tone('triangle', 146.8, 0.03), 0.25, 0.015);
    v.tone('triangle', 220.6, 0.012);
    v.wobble(hum, 0.25, 0.015);
    v.wobble(v.noiseBand(2500, 4500, 0.012), 0.17, 0.01);
    return randomEvents(v, 3, 6, (at) => v.note(at, 'sine', 1320, 1760, 0.6, 0.02));
  },
  // Slow waves: a low wash that swells and falls on two slow cycles, with a soft hiss of foam.
  sea: (v) => {
    const wash = v.noiseBand(120, 900, 0.06);
    v.wobble(wash, 0.09, 0.045);
    v.wobble(wash, 0.053, 0.02);
    v.wobble(v.noiseBand(2000, 6000, 0.01), 0.09, 0.008);
    return () => undefined;
  },
  // A thick, low slosh with fat bubbles that rise in pitch as they pop.
  toxic: (v) => {
    v.noiseBand(60, 380, 0.08);
    return randomEvents(v, 0.35, 1.3, (at) => {
      const hz = 160 + Math.random() * 160;
      v.note(at, 'sine', hz, hz * 1.7, 0.13, 0.09);
    });
  },
  // A deep rumble that rolls, with crackling pops and a low gulp now and then.
  lava: (v) => {
    // why: up to 380 Hz so laptop speakers still play the rumble; below ~150 Hz they are nearly silent.
    v.wobble(v.noiseBand(30, 380, 0.16), 0.15, 0.06);
    return randomEvents(v, 0.4, 1.8, (at) => {
      v.burst(at, 900 + Math.random() * 1200, 0.06, 0.07);
      if (Math.random() < 0.35) v.note(at, 'sine', 95, 50, 0.25, 0.08);
    });
  },
};

/**
 * Start one place sound in `ac`, playing into `destination` (silent until its output gain is raised).
 * Exported for probes that render it in an OfflineAudioContext.
 */
export function startAmbientVoice(ac: BaseAudioContext, destination: AudioNode, kind: AmbientKind): AmbientVoice {
  if (SILENT_KINDS.has(kind)) throw new Error(`AmbientSound: ${kind} is silent and has no voice to start`);
  const builder = new VoiceBuilder(ac, destination);
  const tick = VOICES[kind as Exclude<AmbientKind, SilentKind>](builder);
  return { output: builder.output, tick, stop: (at, ended) => builder.stop(at, ended) };
}

/**
 * All the place sounds of one room, each fading with the keeper's distance.
 * Lifecycle: created with the room, update() once a frame, destroy() when the room goes away.
 */
export class AmbientSoundscape {
  /** Playing voices with their places; empty when audio is off (test mode or no WebAudio). */
  private readonly voices: { voice: AmbientVoice; source: AmbientSource | AmbientArea }[] = [];
  private readonly ac: AudioContext | null;
  /** The room's overall level (AMBIENT_LEVEL); destroy() fades it out. Null when audio is off. */
  private readonly level: GainNode | null = null;

  /**
   * Start every audible source now (silent until the first update()); SILENT_KINDS sources are skipped.
   * @param sources place sounds in world pixels: points, or areas heard from their nearest spot
   * @param listener the keeper; read every update()
   */
  constructor(sources: readonly (AmbientSource | AmbientArea)[], private readonly listener: AmbientListener) {
    for (const source of sources) ambientGain(0, source.radius); // fail early on a bad radius
    // why: silent kinds keep their places in the art data but must not build any audio nodes.
    const audible = sources.filter(source => !SILENT_KINDS.has(source.kind));
    const output = audible.length > 0 ? Sfx.output() : null;
    this.ac = output ? output.ac : null;
    if (!output) return;
    this.level = output.ac.createGain();
    this.level.gain.value = AMBIENT_LEVEL;
    this.level.connect(output.out);
    for (const source of audible) this.voices.push({ voice: startAmbientVoice(output.ac, this.level, source.kind), source });
  }

  /** How many sources are playing (0 in test mode); for tests and debugging. */
  get playing(): number {
    return this.voices.length;
  }

  /** Turn each source's volume to the keeper's distance, and schedule its next one-off sounds. */
  update(): void {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    for (const { voice, source } of this.voices) {
      const distance = 'distanceFrom' in source
        ? source.distanceFrom(this.listener.x, this.listener.y)
        : Math.hypot(this.listener.x - source.x, this.listener.y - source.y);
      const gain = ambientGain(distance, source.radius);
      voice.output.gain.setTargetAtTime(gain, now, FADE_S);
      // why: a voice nobody can hear skips its one-off sounds, so far rooms do not pile up notes.
      if (gain > 0) voice.tick(now + SCHEDULE_AHEAD_S);
    }
  }

  /** Fade every source out over a moment, then stop it. Safe to call twice. */
  destroy(): void {
    if (this.ac && this.level && this.voices.length > 0) {
      const now = this.ac.currentTime;
      const level = this.level;
      level.gain.setTargetAtTime(0, now, END_FADE_S);
      let playing = this.voices.length;
      // why: the level knob stays plugged into the master until its last voice has ended, then goes too.
      for (const { voice } of this.voices) voice.stop(now + END_STOP_S, () => { if (--playing === 0) level.disconnect(); });
    }
    this.voices.length = 0;
  }
}
