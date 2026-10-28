// Synthesized sound effects (WebAudio) — no extra audio files needed.
let ctx = null;
let master = null;
let noiseBuf = null;
let volume = 0.8;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSfxVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

const ready = () => ctx && ctx.state === 'running';

function env(gainNode, t, attack, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, peak = 0.5, attack = 0.002, sweepTo = null, pan = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, attack, peak, dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = pan; src.connect(f).connect(g).connect(p).connect(master); }
  else src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.05);
}

function tone(t, dur, { type = 'sine', freq = 440, to = null, peak = 0.3, attack = 0.005, pan = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
  const g = ctx.createGain();
  env(g, t, attack, peak, dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(master); }
  else o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

export const sfx = {
  shoot(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(t, 0.12, { type: 'highpass', freq: 1800, peak: 0.35, pan });
    noise(t, 0.18, { type: 'lowpass', freq: 900, sweepTo: 120, peak: 0.5, pan });
    tone(t, 0.12, { type: 'square', freq: 220, to: 55, peak: 0.12, pan });
  },
  zap(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    // electric crack + buzzing arc + distant rumble
    noise(t, 0.08, { type: 'highpass', freq: 3000, peak: 0.55, pan });
    for (let i = 0; i < 5; i++) noise(t + 0.02 + i * 0.035 + Math.random() * 0.02, 0.025, { type: 'bandpass', freq: 2500 + Math.random() * 3000, q: 3, peak: 0.3, pan });
    tone(t, 0.22, { type: 'sawtooth', freq: 1800, to: 90, peak: 0.12, pan });
    tone(t, 0.18, { type: 'square', freq: 60, to: 40, peak: 0.1, pan });
    noise(t + 0.05, 0.6, { type: 'lowpass', freq: 400, sweepTo: 60, peak: 0.35, pan });
  },
  explode(pan = 0, big = false) {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(t, big ? 1.1 : 0.7, { type: 'lowpass', freq: 2400, sweepTo: 60, peak: 0.9, pan });
    noise(t, 0.25, { type: 'bandpass', freq: 3200, q: 0.7, peak: 0.35, pan });
    tone(t, 0.5, { type: 'sine', freq: 140, to: 30, peak: 0.7, pan });
    // sparkle crackle
    for (let i = 0; i < 6; i++) noise(t + 0.08 + i * 0.05 + Math.random() * 0.04, 0.03, { type: 'highpass', freq: 5000, peak: 0.25, pan });
  },
  hit(streak = 1, pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const base = 660 * Math.pow(1.122, Math.min(streak - 1, 8));
    tone(t, 0.12, { type: 'triangle', freq: base, peak: 0.25, pan });
    tone(t + 0.06, 0.18, { type: 'triangle', freq: base * 1.5, peak: 0.22, pan });
  },
  golden(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    [988, 1319, 1568, 1976].forEach((f, i) => tone(t + i * 0.06, 0.2, { type: 'triangle', freq: f, peak: 0.2, pan }));
  },
  miss(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    noise(t, 0.25, { type: 'bandpass', freq: 600, sweepTo: 2400, q: 2, peak: 0.12, pan });
  },
  squeak(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) tone(t + i * 0.07, 0.05, { type: 'sine', freq: 3200 + Math.random() * 900, to: 2200, peak: 0.08, pan });
  },
  laugh(pan = 0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) tone(t + i * 0.11, 0.08, { type: 'sawtooth', freq: 520 - i * 30, to: 380 - i * 30, peak: 0.06, pan });
  },
  join() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.08, 0.22, { type: 'square', freq: f, peak: 0.09 }));
    noise(t, 0.4, { type: 'bandpass', freq: 400, sweepTo: 4000, q: 1.5, peak: 0.1 });
  },
  beep() {
    if (!ready()) return;
    tone(ctx.currentTime, 0.15, { type: 'square', freq: 660, peak: 0.15 });
  },
  go() {
    if (!ready()) return;
    const t = ctx.currentTime;
    tone(t, 0.45, { type: 'square', freq: 990, peak: 0.16 });
    tone(t, 0.45, { type: 'sawtooth', freq: 495, peak: 0.08 });
  },
  tick() {
    if (!ready()) return;
    tone(ctx.currentTime, 0.04, { type: 'square', freq: 1400, peak: 0.06 });
  },
  gameOver() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [784, 659, 523, 392].forEach((f, i) => tone(t + i * 0.14, 0.25, { type: 'triangle', freq: f, peak: 0.2 }));
  },
  fanfare() {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.11, i === 5 ? 0.6 : 0.16, { type: 'square', freq: f, peak: 0.12 }));
  },
  click() {
    if (!ready()) return;
    tone(ctx.currentTime, 0.05, { type: 'triangle', freq: 880, to: 1200, peak: 0.12 });
  },
};
