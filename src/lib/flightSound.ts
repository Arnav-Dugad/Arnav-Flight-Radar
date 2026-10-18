// Procedural sound for the followed aircraft — synthesised entirely with the
// Web Audio API (no audio files). Off by default; the user switches it on from
// the follow chip, and it is torn down as soon as following stops.
//
// Graph:  voice (per aircraft kind) ─┐
//         wind  ─────────────────────┼─▶ mix ─▶ fade ─▶ volume ─▶ compressor ─▶ out
//         airport ambience ──────────┘

import type { AircraftClass } from '@shared/classify';

export type SoundKind = 'jet' | 'turboprop' | 'heli' | 'piston' | 'glider';

export interface FlightSoundState {
  kind: SoundKind;
  onGround: boolean;
  /** Ground speed, kt. */
  gs: number;
  /** Vertical rate, ft/min. */
  vr: number;
  /** Altitude, ft. */
  alt: number;
}

export interface FlightSoundHandle {
  stop(): void;
  setVolume(v: number): void;
}

export type FlightPhase = 'parked' | 'taxi' | 'takeoff' | 'reverse' | 'rollout' | 'climb' | 'cruise' | 'descent' | 'approach';

export interface ThrustModel {
  phase: FlightPhase;
  /** Engine power setting, 0 (shut-down) … 1 (take-off thrust). */
  thrust: number;
  /** Reverse-thrust roar, 0 … 1. */
  reverse: number;
}

/** Map the shared symbol class onto the handful of sound models we synthesise. */
export function soundKindFor(cls: AircraftClass): SoundKind {
  switch (cls) {
    case 'turboprop':
      return 'turboprop';
    case 'helicopter':
      return 'heli';
    case 'light':
    case 'drone':
    case 'ground':
      return 'piston';
    case 'glider':
    case 'balloon':
      return 'glider';
    default:
      // widebody / narrowbody / regional / bizjet / military / unknown
      return 'jet';
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);

/**
 * Pure flight-phase → thrust mapping.
 * @param decel ground-speed loss rate in kt/s (positive = slowing down), from the
 *   last two distinct ground-speed observations; null when unknown.
 */
export function thrustForState(s: Pick<FlightSoundState, 'onGround' | 'gs' | 'vr' | 'alt'>, decel: number | null = null): ThrustModel {
  const gs = Math.max(0, num(s.gs));
  const vr = num(s.vr);
  const alt = Math.max(0, num(s.alt));
  const d = decel === null ? 0 : num(decel);

  if (s.onGround) {
    if (gs > 60 && d > 1.5) return { phase: 'reverse', thrust: 0.7, reverse: clamp01((d - 1.5) / 3 + 0.6) };
    if (gs > 30 && d > 0.3) return { phase: 'rollout', thrust: 0.14, reverse: 0 };
    if (gs > 30) return { phase: 'takeoff', thrust: 1, reverse: 0 };
    if (gs >= 3) return { phase: 'taxi', thrust: 0.2, reverse: 0 };
    return { phase: 'parked', thrust: 0.12, reverse: 0 };
  }
  if (vr > 500) return { phase: 'climb', thrust: 0.92 - 0.12 * clamp01(alt / 36_000), reverse: 0 };
  if (vr < -500) return alt < 4000 ? { phase: 'approach', thrust: 0.38, reverse: 0 } : { phase: 'descent', thrust: 0.18, reverse: 0 };
  if (alt < 5000) return { phase: 'approach', thrust: 0.5, reverse: 0 };
  return { phase: 'cruise', thrust: 0.64, reverse: 0 };
}

// ─── Audio building blocks ────────────────────────────────────────────────

interface Voice {
  out: GainNode;
  update(p: { thrust: number; reverse: number; gs: number; onGround: boolean }): void;
  sources: AudioScheduledSourceNode[];
}

function noiseBuffer(ctx: BaseAudioContext, color: 'white' | 'brown', seconds = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') d[i] = w;
    else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

function makeKit(ctx: AudioContext) {
  const white = noiseBuffer(ctx, 'white');
  const brown = noiseBuffer(ctx, 'brown', 4);
  const sources: AudioScheduledSourceNode[] = [];
  const noise = (color: 'white' | 'brown') => {
    const src = ctx.createBufferSource();
    src.buffer = color === 'white' ? white : brown;
    src.loop = true;
    // Random offset so parallel layers never phase-align.
    src.start(ctx.currentTime, Math.random() * (src.buffer.duration - 0.1));
    sources.push(src);
    return src;
  };
  const osc = (type: OscillatorType, freq: number, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start();
    sources.push(o);
    return o;
  };
  const gain = (v = 0) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  /** Smoothly glide an AudioParam towards a target. */
  const to = (p: AudioParam, v: number, tau = 0.25) => {
    if (Number.isFinite(v)) p.setTargetAtTime(v, ctx.currentTime, tau);
  };
  /** Low-frequency oscillator feeding `param` with ±depth around its base value. */
  const lfo = (param: AudioParam, freq: number, depth: number, type: OscillatorType = 'sine') => {
    const o = osc(type, freq);
    const g = gain(depth);
    o.connect(g).connect(param);
    return { osc: o, depth: g };
  };
  const chain = (...nodes: AudioNode[]) => {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.connect(nodes[i + 1]!);
    return nodes[nodes.length - 1]!;
  };
  return { sources, noise, osc, gain, filter, to, lfo, chain };
}
type Kit = ReturnType<typeof makeKit>;

/** Low rumble shared by the turbine voices. */
function rumble(k: Kit, out: AudioNode) {
  const lp = k.filter('lowpass', 140, 0.9);
  const g = k.gain(0);
  k.chain(k.noise('brown'), lp, g, out);
  return {
    set(level: number, cutoff: number) {
      k.to(g.gain, level, 0.4);
      k.to(lp.frequency, cutoff, 0.4);
    },
  };
}

function jetVoice(k: Kit, out: GainNode): Voice['update'] {
  const rum = rumble(k, out);
  // Fan whine: detuned partials through a resonant band-pass.
  const bp = k.filter('bandpass', 1800, 5);
  const whine = k.gain(0);
  const partials = [
    { o: k.osc('sawtooth', 600, -7), m: 1, g: 0.35 },
    { o: k.osc('sine', 600, 6), m: 1, g: 0.6 },
    { o: k.osc('sine', 1200, 3), m: 2.01, g: 0.25 },
    { o: k.osc('sine', 1800), m: 3.02, g: 0.12 },
  ];
  for (const p of partials) {
    const g = k.gain(p.g);
    p.o.connect(g).connect(bp);
  }
  k.chain(bp, whine, out);
  // High-frequency air / exhaust hiss.
  const hp = k.filter('highpass', 2600, 0.5);
  const air = k.gain(0);
  k.chain(k.noise('white'), hp, air, out);
  // Reverse-thrust roar: broadband mid noise.
  const revBp = k.filter('bandpass', 500, 0.6);
  const rev = k.gain(0);
  k.chain(k.noise('white'), revBp, rev, out);

  return ({ thrust, reverse }) => {
    const f = 420 + 1900 * Math.pow(thrust, 1.25); // fan blade-pass, Hz
    for (const p of partials) k.to(p.o.frequency, f * p.m, 0.3);
    k.to(bp.frequency, f * 1.15, 0.3);
    k.to(whine.gain, 0.012 + 0.05 * thrust, 0.3);
    rum.set(0.05 + 0.2 * thrust * thrust, 90 + 160 * thrust);
    k.to(air.gain, 0.004 + 0.03 * thrust * thrust, 0.4);
    k.to(rev.gain, 0.16 * reverse, reverse > 0 ? 0.35 : 0.9);
    k.to(revBp.frequency, 350 + 400 * reverse, 0.5);
  };
}

function turbopropVoice(k: Kit, out: GainNode): Voice['update'] {
  const rum = rumble(k, out);
  // Propeller drone: blade-pass fundamental + harmonics, beating between the
  // two props gives the characteristic slow "wow-wow" amplitude modulation.
  const lp = k.filter('lowpass', 500, 1.2);
  const drone = k.gain(0);
  const am = k.gain(1);
  const h1 = k.osc('sawtooth', 80);
  const h1b = k.osc('sawtooth', 80, 9);
  const h2 = k.osc('sine', 160);
  const h3 = k.osc('sine', 240);
  [
    [h1, 0.5],
    [h1b, 0.4],
    [h2, 0.5],
    [h3, 0.25],
  ].forEach(([o, g]) => (o as OscillatorNode).connect(k.gain(g as number)).connect(lp));
  k.chain(lp, am, drone, out);
  const beat = k.lfo(am.gain, 2.2, 0.22);
  // Turbine whine, quieter than a jet.
  const tw = k.osc('sine', 3200);
  const twG = k.gain(0);
  k.chain(tw, k.filter('bandpass', 3400, 3), twG, out);

  return ({ thrust }) => {
    const bpf = 58 + 46 * thrust; // RPM/60 × blades
    k.to(h1.frequency, bpf, 0.5);
    k.to(h1b.frequency, bpf, 0.5);
    k.to(h2.frequency, bpf * 2, 0.5);
    k.to(h3.frequency, bpf * 3, 0.5);
    k.to(lp.frequency, 300 + 900 * thrust, 0.5);
    k.to(drone.gain, 0.05 + 0.11 * thrust, 0.4);
    k.to(beat.osc.frequency, 1.4 + 1.6 * thrust, 1);
    k.to(tw.frequency, 2800 + 1600 * thrust, 0.6);
    k.to(twG.gain, 0.004 + 0.012 * thrust, 0.5);
    rum.set(0.03 + 0.1 * thrust, 80 + 120 * thrust);
  };
}

/** Narrow, positive-going pulse wave used as the rotor-blade envelope. */
function pulseWave(ctx: AudioContext): PeriodicWave {
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) real[i] = Math.exp(-i / 6);
  return ctx.createPeriodicWave(real, imag);
}

function heliVoice(k: Kit, out: GainNode, ctx: AudioContext): Voice['update'] {
  // Blade-slap: filtered noise chopped by a pulse LFO at the blade-pass rate.
  const lp = k.filter('lowpass', 420, 0.8);
  const chop = k.gain(0.25);
  const level = k.gain(0);
  k.chain(k.noise('brown'), lp, chop, level, out);
  const rotor = k.osc('sine', 5);
  rotor.setPeriodicWave(pulseWave(ctx));
  const depth = k.gain(0.3);
  rotor.connect(depth).connect(chop.gain);
  // Thump transient: a low sine gated by the rectified, sharpened pulse.
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = x > 0 ? x * x * x : 0;
  }
  shaper.curve = curve;
  const thumpOsc = k.osc('sine', 52);
  const thump = k.gain(0);
  const thumpDepth = k.gain(0);
  rotor.connect(shaper).connect(thumpDepth).connect(thump.gain);
  k.chain(thumpOsc, thump, level);
  // Turbine whine.
  const tw = k.osc('sawtooth', 2400);
  const tw2 = k.osc('sine', 4900);
  const twBp = k.filter('bandpass', 2600, 4);
  const twG = k.gain(0);
  tw.connect(twBp);
  tw2.connect(k.gain(0.5)).connect(twBp);
  k.chain(twBp, twG, out);

  return ({ thrust }) => {
    k.to(rotor.frequency, 4.4 + 1.4 * thrust, 1.2); // ~4–6 Hz blade-pass
    k.to(level.gain, 0.1 + 0.16 * thrust, 0.5);
    k.to(depth.gain, 0.32 + 0.2 * thrust, 0.5);
    k.to(thumpDepth.gain, 0.5 + 0.9 * thrust, 0.5);
    k.to(lp.frequency, 300 + 400 * thrust, 0.5);
    k.to(tw.frequency, 2200 + 900 * thrust, 0.8);
    k.to(tw2.frequency, 4500 + 1800 * thrust, 0.8);
    k.to(twBp.frequency, 2400 + 1000 * thrust, 0.8);
    k.to(twG.gain, 0.008 + 0.014 * thrust, 0.5);
  };
}

function pistonVoice(k: Kit, out: GainNode): Voice['update'] {
  // Firing-frequency buzz with a sub-harmonic for the uneven 4-cylinder beat.
  const lp = k.filter('lowpass', 700, 1.6);
  const am = k.gain(1);
  const g = k.gain(0);
  const fire = k.osc('sawtooth', 40);
  const sub = k.osc('square', 20);
  fire.connect(k.gain(0.6)).connect(lp);
  sub.connect(k.gain(0.18)).connect(lp);
  k.chain(lp, am, g, out);
  const flutter = k.lfo(am.gain, 8, 0.07);
  k.lfo(am.gain, 0.35, 0.05);

  return ({ thrust }) => {
    const f = 24 + 62 * thrust; // RPM/60 × 2 for a four-cylinder four-stroke
    k.to(fire.frequency, f, 0.6);
    k.to(sub.frequency, f / 2, 0.6);
    k.to(lp.frequency, 380 + 1500 * thrust, 0.6);
    k.to(g.gain, 0.05 + 0.12 * thrust, 0.5);
    k.to(flutter.osc.frequency, 5 + 6 * thrust, 1);
  };
}

function buildVoice(ctx: AudioContext, kind: SoundKind, dest: AudioNode): Voice {
  const k = makeKit(ctx);
  const out = k.gain(0);
  out.connect(dest);
  const update =
    kind === 'jet'
      ? jetVoice(k, out)
      : kind === 'turboprop'
        ? turbopropVoice(k, out)
        : kind === 'heli'
          ? heliVoice(k, out, ctx)
          : kind === 'piston'
            ? pistonVoice(k, out)
            : () => {}; // glider: wind only
  return { out, update, sources: k.sources };
}

// ─── Engine ───────────────────────────────────────────────────────────────

const POLL_MS = 200;

export function startFlightSound(getState: () => FlightSoundState | null): FlightSoundHandle {
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return { stop() {}, setVolume() {} };

  const ctx = new Ctor({ latencyHint: 'playback' });
  const k = makeKit(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  const volume = k.gain(0.6);
  const fade = k.gain(0);
  const mix = k.gain(1);
  k.chain(mix, fade, volume, comp);

  // Wind: band-passed noise with slow gusts, scaled by airspeed.
  const windBp = k.filter('bandpass', 500, 0.55);
  const windHs = k.filter('highshelf', 3000, 0.7);
  windHs.gain.value = -6;
  const windGust = k.gain(1);
  const wind = k.gain(0);
  k.chain(k.noise('white'), windBp, windHs, windGust, wind, mix);
  k.lfo(windGust.gain, 0.11, 0.18);
  k.lfo(windGust.gain, 0.037, 0.12);

  // Airport ambience: distant apron hum + a far-off APU tone; beeps scheduled below.
  const amb = k.gain(0);
  amb.connect(mix);
  k.chain(k.noise('brown'), k.filter('lowpass', 180, 0.7), k.gain(0.5), amb);
  const apu = k.osc('sine', 410);
  const apu2 = k.osc('sine', 412.5);
  apu.connect(k.gain(0.012)).connect(amb);
  apu2.connect(k.gain(0.008)).connect(amb);

  let voice: Voice | null = null;
  let voiceKind: SoundKind | null = null;
  let thrust = 0.15;
  let lastGs: number | null = null;
  let lastGsAt = 0;
  let decel: number | null = null;
  let bumpUntil = 0;
  let nextBeepAt = performance.now() + 6000 + Math.random() * 8000;
  let userVolume = 0.6;
  let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  let present = false;
  let stopped = false;
  let lastTick = performance.now();

  const retireVoice = (v: Voice) => {
    v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    setTimeout(() => {
      for (const s of v.sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      v.out.disconnect();
    }, 1200);
  };

  const beep = () => {
    // A faint, distant tug / vehicle reversing beep: two or three short pips.
    const t0 = ctx.currentTime + 0.05;
    const f = 950 + Math.random() * 250;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0;
      const t = t0 + i * 0.75;
      g.gain.setTargetAtTime(0.0035, t, 0.01);
      g.gain.setTargetAtTime(0, t + 0.22, 0.02);
      o.connect(k.filter('lowpass', 2200, 0.7)).connect(g).connect(amb);
      o.start(t);
      o.stop(t + 0.4);
    }
  };

  const fadeTarget = () => (present && !hidden ? 1 : 0);

  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const dt = Math.min(1, (now - lastTick) / 1000);
    lastTick = now;

    let s: FlightSoundState | null;
    try {
      s = getState();
    } catch {
      s = null;
    }
    const wasPresent = present;
    present = !!s;
    if (present !== wasPresent) k.to(fade.gain, fadeTarget(), present ? 0.6 : 0.35);
    if (!s) return;

    if (s.kind !== voiceKind) {
      if (voice) retireVoice(voice);
      voice = buildVoice(ctx, s.kind, mix);
      voiceKind = s.kind;
      voice.out.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
    }

    // Deceleration from successive distinct ground-speed observations (feeds
    // refresh slower than we poll, so only changes count).
    const gs = Math.max(0, num(s.gs));
    if (lastGs === null) {
      lastGs = gs;
      lastGsAt = now;
    } else if (gs !== lastGs) {
      const span = Math.max(0.2, (now - lastGsAt) / 1000);
      decel = (lastGs - gs) / span;
      lastGs = gs;
      lastGsAt = now;
    } else if (now - lastGsAt > 8000) decel = 0;

    const model = thrustForState(s, decel);
    let target = model.thrust;
    if (model.phase === 'taxi' || model.phase === 'parked') {
      // Occasional breakaway thrust bumps while taxiing.
      if (model.phase === 'taxi' && now > bumpUntil + 6000 && Math.random() < dt / 14) bumpUntil = now + 1800 + Math.random() * 1500;
      if (now < bumpUntil) target += 0.16;
    }
    // Engines spool up faster than they wind down.
    const tau = target > thrust ? (model.phase === 'takeoff' ? 2.2 : 1.6) : 3;
    thrust += (target - thrust) * (1 - Math.exp(-dt / tau));
    voice?.update({ thrust: clamp01(thrust), reverse: model.reverse, gs, onGround: s.onGround });

    // Wind with airspeed; louder for gliders (nothing else to hear).
    const v = clamp01(gs / 320);
    const windLevel = (s.kind === 'glider' ? 0.32 : 0.12) * Math.pow(v, 1.4) * (s.onGround ? 0.6 : 1);
    k.to(wind.gain, windLevel + (s.kind === 'glider' && !s.onGround ? 0.015 : 0), 0.6);
    k.to(windBp.frequency, 300 + 1500 * v, 0.8);

    // Airport ambience only while on the ground and slow.
    const ambOn = s.onGround && gs < 40;
    k.to(amb.gain, ambOn ? 0.05 : 0, ambOn ? 2 : 1);
    if (ambOn && !hidden && now > nextBeepAt) {
      beep();
      nextBeepAt = now + 9000 + Math.random() * 16_000;
    }
  };

  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) {
      k.to(fade.gain, 0, 0.08);
      setTimeout(() => {
        if (hidden && !stopped && ctx.state === 'running') void ctx.suspend().catch(() => {});
      }, 400);
    } else {
      void ctx.resume().catch(() => {});
      k.to(fade.gain, fadeTarget(), 0.4);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // If the context was created without a usable gesture it starts suspended;
  // resume on the next interaction.
  const unlock = () => {
    if (ctx.state === 'suspended' && !hidden) void ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  void ctx.resume().catch(() => {});

  tick();
  const timer = setInterval(tick, POLL_MS);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      fade.gain.cancelScheduledValues(ctx.currentTime);
      fade.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      setTimeout(() => {
        for (const src of [...k.sources, ...(voice?.sources ?? [])]) {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        }
        void ctx.close().catch(() => {});
      }, 600);
    },
    setVolume(v: number) {
      userVolume = clamp01(num(v, userVolume));
      if (!stopped) k.to(volume.gain, userVolume, 0.1);
    },
  };
}
