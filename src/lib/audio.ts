import { rand, chance } from "./rng";

/**
 * Fully synthesised audio — no asset files, nothing to download, infinite
 * variation. Every call jitters its own parameters so the cats never hear the
 * exact same sound twice, which is most of the reason these apps stop working
 * after a week.
 *
 * Tuning notes: domestic cats hear well past 60 kHz and are most sensitive
 * roughly 500 Hz - 32 kHz, with prey-relevant detail up around 4-10 kHz. We
 * bias the interesting content there rather than at the human-pleasing low end.
 * Everything is deliberately short and quiet; sustained or loud audio is
 * stressful and is exactly what we're trying not to build.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const AC: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // Shared white-noise bed used by the skitter/crunch/rustle voices.
  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function setVolume(v: number) {
  if (master) master.gain.value = v;
}

export function audioReady() {
  return !!ctx && ctx.state === "running";
}

function noiseSource() {
  if (!ctx || !noiseBuf) return null;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = rand(1.4, 0.7);
  return s;
}

/** Stereo placement so a bug on the left actually sounds like it's on the left. */
function panner(pan: number) {
  if (!ctx) return null;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

function chain(nodes: (AudioNode | null)[]) {
  const ns = nodes.filter(Boolean) as AudioNode[];
  for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
  return ns;
}

/**
 * Dry, granular scratching — six legs on a hard surface. Built from bandpassed
 * noise chopped by a fast tremolo rather than a loop, so the rhythm drifts.
 */
export function skitter(pan = 0, intensity = 1, dur = 0.22) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const src = noiseSource();
  if (!src) return;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = rand(6500, 3200);
  bp.Q.value = rand(9, 4);

  const g = ctx.createGain();
  g.gain.value = 0;

  // Chop into discrete leg-strikes.
  const steps = Math.max(3, Math.round(dur / rand(0.045, 0.022)));
  for (let i = 0; i < steps; i++) {
    const st = t + (i / steps) * dur + rand(0.006);
    const amp = 0.16 * intensity * rand(1.0, 0.35);
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(amp, st + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, st + rand(0.02, 0.008));
  }
  chain([src, bp, g, panner(pan), master]);
  src.start(t);
  src.stop(t + dur + 0.1);
}

/** Wet, low crunch + a short shell-crack transient. The payoff for a catch. */
export function crunch(pan = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;

  const src = noiseSource();
  if (!src) return;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(rand(2600, 1500), t);
  lp.frequency.exponentialRampToValueAtTime(220, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  chain([src, lp, g, panner(pan), master]);
  src.start(t);
  src.stop(t + 0.3);

  // Shell snap.
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(rand(900, 420), t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.22, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  chain([o, og, panner(pan), master]);
  o.start(t);
  o.stop(t + 0.15);
}

/** Startled squeak — frequency-swept sine in the prey band. */
export function squeak(pan = 0, up = true) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  const f0 = rand(5200, 3600);
  const f1 = up ? f0 * rand(1.9, 1.4) : f0 * rand(0.75, 0.5);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  chain([o, g, panner(pan), master]);
  o.start(t);
  o.stop(t + 0.2);
}

/** Soft muffled thump for a paw landing on the glass. */
export function thump(pan = 0, force = 1) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(rand(150, 90), t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3 * force, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  chain([o, g, panner(pan), master]);
  o.start(t);
  o.stop(t + 0.22);
}

/**
 * Occasional bird/insect chirp used as an attention re-hook when a cat has
 * disengaged. Deliberately rare — a looping chirp is nagging, not interesting.
 */
export function chirp(pan = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const n = chance(0.5) ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const st = t + i * rand(0.1, 0.055);
    const o = ctx.createOscillator();
    o.type = "triangle";
    const f0 = rand(7200, 4200);
    o.frequency.setValueAtTime(f0, st);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.7, 1.15), st + 0.035);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, st + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.16, st + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
    chain([o, g, panner(pan), master]);
    o.start(st);
    o.stop(st + 0.12);
  }
}

/** Dry leaf-litter rustle for when a bug ducks under cover. */
export function rustle(pan = 0, intensity = 1) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const src = noiseSource();
  if (!src) return;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = rand(4200, 2400);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.14 * intensity, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.3, 0.16));
  chain([src, hp, g, panner(pan), master]);
  src.start(t);
  src.stop(t + 0.5);
}
