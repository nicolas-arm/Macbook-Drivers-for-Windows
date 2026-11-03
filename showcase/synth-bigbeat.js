// Big-beat soundtrack for the MDfW showcase (original composition, 140 bpm, E phrygian):
// crushed breakbeats, distorted riff bass, power-chord stabs, acid line, sirens, snare-roll builds, tape stop.
// The video timeline is authored on a 120 bpm grid; it is played 7/6x faster so every cut lands on a 140 bpm bar.
//   node synth-bigbeat.js  -> soundtrack-bigbeat.wav
const fs = require("fs");
const path = require("path");
const { DURATION: COMP_DURATION, EVENTS } = JSON.parse(fs.readFileSync(path.join(__dirname, "events.json"), "utf8"));

const SPEED = 7 / 6, SCALE = 1 / SPEED;            // comp seconds -> real seconds
const DURATION = COMP_DURATION * SCALE;
const SR = 48000, N = Math.ceil(DURATION * SR);
const BPM = 140, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4; // one bar == 2 comp seconds
const SWING = S16 * .1;
const step = (bar, s) => bar * BAR + s * S16 + (s % 2 ? SWING : 0);

const bus = () => [new Float32Array(N), new Float32Array(N)];
const DRUMS = bus(), BASS = bus(), SYN = bus(), SFX = bus(), VERB = bus(), ECHO = bus();
const duck = new Float32Array(N);

let seed = 11;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const hash = i => { const x = Math.sin(i * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const E1 = 28, E2 = 40, E3 = 52;

const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
function osc(wave, ph, dt, duty = .5) {
  if (wave === "sine") return Math.sin(2 * Math.PI * ph);
  if (wave === "tri") return 1 - 4 * Math.abs(ph - .5);
  if (wave === "saw") return 2 * ph - 1 - blep(ph, dt);
  let v = ph < duty ? 1 : -1; v += blep(ph, dt); v -= blep((ph + 1 - duty) % 1, dt); return v;
}
function put(target, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  const a = (pan + 1) * Math.PI / 4;
  target[0][i] += v * Math.cos(a); target[1][i] += v * Math.sin(a);
}
// Chamberlin state-variable filter
function svf() {
  let low = 0, band = 0;
  return (x, fc, q) => {
    const F = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6.5) / SR);
    low += F * band; const high = x - low - q * band; band += F * high;
    return { low, band, high };
  };
}

// generic voice: oscillators -> optional resonant LP with envelope -> drive
function voice({ t, dur, notes, wave = "saw", duty = .5, det = 0, a = .002, d = 1e9, sus = 1, rel = .03, gain = .2, pan = 0,
  fc = 0, fc1 = fc, fenv = .08, q = .7, drive = 0, glideFrom = null, glide = .04, bend = 0, to = SYN, verb = 0, echo = 0, ducked = false, sub = 0 }) {
  const i0 = Math.round(t * SR), len = Math.round((dur + rel) * SR);
  const voices = [];
  for (const m of notes) for (const dc of det ? [-det, det] : [0]) voices.push({ m, dc, ph: hash(m * 3 + dc) });
  const filt = fc ? svf() : null;
  let subPh = 0;
  for (let j = 0; j < len; j++) {
    const i = i0 + j; if (i >= N) break;
    const x = j / SR;
    let v = 0;
    for (const o of voices) {
      let m = o.m;
      if (glideFrom != null && x < glide) m = glideFrom + (m - glideFrom) * (x / glide) + (o.m - voices[0].m);
      if (bend && x > dur * .6) m += bend * (x - dur * .6) / (dur * .4);
      const f = mtof(m) * Math.pow(2, o.dc / 1200), dt = f / SR;
      o.ph += dt; if (o.ph >= 1) o.ph -= 1;
      v += osc(wave, o.ph, dt, duty);
    }
    v /= Math.sqrt(voices.length);
    if (sub) { const f = mtof(notes[0] - 12), dt = f / SR; subPh = (subPh + dt) % 1; v += sub * Math.sin(2 * Math.PI * subPh); }
    if (filt) v = filt(v, fc1 + (fc - fc1) * Math.exp(-x / fenv), q).low;
    if (drive) v = Math.tanh(v * drive) / Math.tanh(drive);
    let e = x < a ? x / a : sus + (1 - sus) * Math.exp(-(x - a) / d);
    if (x > dur) e *= Math.max(0, 1 - (x - dur) / rel);
    let g = v * e * gain;
    if (ducked) g *= 1 - .6 * duck[i];
    put(to, i, g, pan);
    if (verb) put(VERB, i, g * verb, pan);
    if (echo) put(ECHO, i, g * echo, pan);
  }
}
function hiss({ t, dur, a = .001, d = .05, gain = .2, pan = 0, mode = "hp", fc = 6000, fc1 = fc, q = .7, to = DRUMS, verb = 0, shape = null }) {
  const i0 = Math.round(t * SR), len = Math.round(dur * SR), f = svf();
  for (let j = 0; j < len; j++) {
    const i = i0 + j; if (i >= N) break;
    const x = j / SR, p = x / dur;
    const o = f(noise(), fc * Math.pow(fc1 / fc, p), q);
    const v = mode === "lp" ? o.low : mode === "bp" ? o.band : o.high;
    let e = shape ? shape(p) : (x < a ? x / a : Math.exp(-(x - a) / d));
    e *= Math.min(1, (dur - x) / .004);
    put(to, i, v * e * gain, pan);
    if (verb) put(VERB, i, v * e * gain * verb, pan);
  }
}

// ---------- drums ----------
function kick(t, g = 1, to = DRUMS) {
  const i0 = Math.round(t * SR);
  let ph = 0;
  for (let j = 0; j < .34 * SR; j++) {
    const i = i0 + j; if (i >= N) break;
    const x = j / SR, f = 48 + 125 * Math.exp(-x / .035);
    ph += f / SR;
    const v = Math.tanh(2.2 * Math.sin(2 * Math.PI * ph)) * Math.exp(-x / .16) * g * .8;
    put(to, i, v);
    duck[i] = Math.max(duck[i], Math.exp(-x / .11) * Math.min(1, g));
  }
  hiss({ t, dur: .015, d: .004, gain: .35 * g, mode: "bp", fc: 3500, to });
}
function snare(t, g = 1, to = DRUMS) {
  voice({ t, dur: .12, notes: [55], wave: "tri", d: .045, sus: 0, gain: .35 * g, to, bend: -3 });
  hiss({ t, dur: .24, d: .07, gain: .55 * g, mode: "bp", fc: 2600, q: .35, to, verb: .25 });
  hiss({ t, dur: .12, d: .035, gain: .3 * g, mode: "hp", fc: 7000, to });
}
const hat = (t, open, g = 1, pan = .2) => hiss({ t, dur: open ? .2 : .05, d: open ? .07 : .014, gain: .12 * g, mode: "hp", fc: 8500, pan });
const crash = (t, g = 1) => { hiss({ t, dur: 1.6, d: .42, gain: .17 * g, mode: "hp", fc: 5200, verb: .4, pan: -.15 }); hiss({ t, dur: 1.6, d: .36, gain: .14 * g, mode: "hp", fc: 6400, pan: .15 }); };
function roll(t0, len, g0 = .15, g1 = .9) {
  const n = Math.round(len / S16);
  for (let k = 0; k < n; k++) {
    const p = k / n, sub = p > .6 ? 2 : 1;
    for (let s = 0; s < sub; s++) snare(t0 + (k + s / sub) * S16, g0 + (g1 - g0) * p);
  }
}

// two-bar breakbeat (16 steps per bar): kicks, snares, ghosts
const BREAK = [
  { k: [0, 10], s: [4, 12], gh: [7, 9, 15] },
  { k: [0, 3, 10, 11], s: [4, 12, 14], gh: [6, 9] },
];
function breakbeat(bar, g = 1, { hats = true } = {}) {
  const P = BREAK[bar % 2];
  P.k.forEach(s => kick(step(bar, s), g * (s === 0 ? 1 : .85)));
  P.s.forEach(s => snare(step(bar, s), g * (s === 14 ? .7 : 1)));
  P.gh.forEach(s => snare(step(bar, s), g * (.16 + .1 * hash(bar * 16 + s))));
  if (hats) for (let s = 0; s < 16; s += 2) hat(step(bar, s + 1), s === 6 || s === 14, g * (.65 + .35 * hash(bar + s)), s % 4 ? .3 : -.3);
  if (hats) for (let s = 0; s < 16; s += 4) hat(step(bar, s), false, g * .45, 0);
}

// ---------- tonal parts ----------
// riff bass, semitones above E2 (null = rest)
const RIFF = [
  [0, 0, null, 12, 0, null, 3, null, 0, 0, null, 6, 5, null, 3, null],
  [0, 0, null, 12, 0, null, 3, null, 0, null, 10, null, 7, null, 5, 3],
];
function bass(bar, g = 1, fc = 2600) {
  const R = RIFF[bar % 2];
  let prev = null;
  R.forEach((st, s) => {
    if (st == null) { prev = null; return; }
    const long = R[s + 1] == null ? 1.7 : .85;
    voice({ t: step(bar, s), dur: S16 * long, notes: [E2 + st], wave: "saw", det: 9, a: .002, d: .12, sus: .55, rel: .02,
      fc: fc * (s % 4 === 0 ? 1.25 : 1), fc1: 180, fenv: .07, q: .45, drive: 3.2, sub: .9, gain: .2 * g, to: BASS, ducked: true,
      glideFrom: prev != null && Math.abs(prev - st) <= 3 ? E2 + prev : null });
    prev = st;
  });
}
// crunchy power-chord stabs: [step, root offset from E3, length in steps]
const STABS = [
  [[0, 0, 2], [3, 0, 2], [6, 0, 1], [8, 3, 2], [11, 5, 4]],
  [[0, 0, 2], [3, 0, 2], [6, 0, 1], [8, -2, 2], [11, -4, 4]],
];
function stab(t, root, len, g = 1) {
  voice({ t, dur: len, notes: [root, root + 7, root + 12], wave: "saw", det: 14, a: .003, d: .35, sus: .45, rel: .06,
    fc: 4200, fc1: 1900, fenv: .25, q: .9, drive: 9, gain: .085 * g, to: SYN, pan: -.25, bend: len > .3 ? -1.2 : 0, verb: .15 });
  voice({ t: t + .012, dur: len, notes: [root, root + 7, root + 12], wave: "pulse", duty: .3, det: 11, a: .003, d: .35, sus: .45, rel: .06,
    fc: 3800, fc1: 1700, fenv: .25, q: .9, drive: 9, gain: .075 * g, to: SYN, pan: .25, bend: len > .3 ? -1.2 : 0 });
}
function stabs(bar, g = 1) { STABS[bar % 2].forEach(([s, r, l]) => stab(step(bar, s), E3 + r, l * S16 * .92, g)); }
// acid line: 16ths, resonant squelch, accents on the downbeats
const ACID = [0, 12, 0, 1, 0, 15, 12, 0, 3, 0, 12, 1, 0, 7, 5, 12];
function acid(bar, g = 1, open = 1) {
  ACID.forEach((st, s) => {
    const acc = s % 4 === 0 || s === 6 || s === 13;
    voice({ t: step(bar, s), dur: S16 * .8, notes: [E3 + st - 12], wave: "saw", a: .001, d: .09, sus: .5, rel: .015,
      fc: (acc ? 3600 : 1700) * open + 300, fc1: 260, fenv: acc ? .09 : .05, q: .12, drive: 2.4, gain: .085 * g, to: SYN, pan: .1, echo: .25,
      glideFrom: s === 2 || s === 9 ? E3 + ACID[s - 1] - 12 : null, glide: .05 });
  });
}
function drone(bar, g = 1, fc = 380) {
  voice({ t: bar * BAR, dur: BAR, notes: [E1, E1 + 12, E1 + 19], wave: "saw", det: 12, a: .25, sus: 1, rel: .3, fc, fc1: fc, q: .35, drive: 2,
    gain: .13 * g, to: SYN, verb: .35 });
}
function siren(t, dur, g = 1) {
  const i0 = Math.round(t * SR); let ph = 0;
  for (let j = 0; j < dur * SR; j++) {
    const i = i0 + j; if (i >= N) break;
    const x = j / SR, f = 900 + 500 * Math.sin(2 * Math.PI * 2.2 * x) + 900 * (x / dur);
    ph = (ph + f / SR) % 1;
    const e = Math.min(1, x / .2) * Math.min(1, (dur - x) / .1);
    const v = Math.tanh(3 * (2 * ph - 1)) * e * .03 * g;
    put(SYN, i, v, Math.sin(x * 3) * .5); put(VERB, i, v * .4);
  }
}
const GAP = S16 * 2; // a beat of air before every drop
const riser = (t, dur, g = 1) => hiss({ t, dur, gain: .22 * g, mode: "bp", fc: 300, fc1: 9000, q: .25, to: SYN, verb: .3, shape: p => Math.pow(p, 2.2) });

// ---------- arrangement: bar b == comp seconds [2b, 2b+2) ----------
const BARS = Math.ceil(COMP_DURATION / 2);
for (let b = 0; b < BARS; b++) {
  const t = b * BAR, c = b * 2; // real time, comp time
  if (c < 6) {                                   // boot: menace
    drone(b, .9, 260 + b * 120);
    for (let s = 0; s < 16; s += 4) hat(step(b, s + 2), false, .35);
    if (b >= 1) siren(t, BAR, .6 + b * .2);
    if (b === 2) { riser(t, BAR - GAP, 1.2); roll(t + BAR / 2, BAR / 2 - GAP, .1, .75); }
    continue;
  }
  if (c < 9.5) {                                 // problem: filtered break + riff
    breakbeat(b, .7); bass(b, .85, 1300); drone(b, .5, 500);
    if (b === 3) crash(t, .7);
    if (c === 8) { kick(step(b, 12), 1); }
    continue;
  }
  if (c < 12) {                                  // "you don't need it" -> build
    kick(t, 1); voice({ t, dur: BAR * .5, notes: [E1 + 12], wave: "saw", det: 15, fc: 900, fc1: 200, fenv: .4, q: .3, drive: 4, sub: 1, gain: .22, to: BASS });
    roll(t + BEAT, BEAT * 3 - GAP, .12, 1); riser(t, BAR - GAP, 1.4); siren(t, BAR - GAP, 1);
    continue;
  }
  const full = (o = {}) => {
    breakbeat(b, 1); bass(b, 1, o.fc || 2600);
    if (o.stabs) stabs(b, o.stabs);
    if (o.acid) acid(b, o.acid, o.open ?? 1);
  };
  if (c < 16) { full({ stabs: 1 }); if (c === 12) crash(t, 1.1); continue; }       // brand: DROP
  if (c < 24) { full({ fc: 2000 }); if (c === 16) crash(t, .8); continue; }         // typing: keep the mids clear
  if (c < 32) { full({ stabs: .8 }); if (c === 24) crash(t, .8); continue; }
  if (c < 38) { full({ fc: 2200, acid: .8, open: .6 + (c - 32) * .08 }); if (c === 32) crash(t, .8); continue; }
  if (c < 48) { full({ stabs: .9, acid: .9, open: 1 }); if (c === 38 || c === 44) crash(t, .9); continue; }
  if (c < 52) {
    full({ stabs: c === 48 ? .9 : 0, acid: 1, open: 1.2 });
    if (c === 48) crash(t, .9);
    if (c === 50) { riser(t, BAR - GAP, 1.3); roll(t + BAR / 2, BAR / 2 - GAP, .2, 1); }
    continue;
  }
  if (c < 56) {                                  // languages: breakdown
    drone(b, .9, 700); acid(b, .7, .35 + (c - 52) * .15); siren(t, BAR, .5);
    if (c === 54) { riser(t, BAR - GAP, 1.2); roll(t + BAR / 2, BAR / 2 - GAP, .1, .9); }
    continue;
  }
  if (c < 58) {                                  // Type. Download. Install.
    [0, 1, 2].forEach(k => { kick(t + k * BEAT, 1.1); crash(t + k * BEAT, .45 + k * .2); stab(t + k * BEAT, E3 + [0, 3, 5][k], BEAT * .85, 1.1); });
    roll(t + BEAT * 3, BEAT - GAP / 2, .3, 1);
    continue;
  }
  full({ stabs: 1, acid: .8 });                  // logo: last drop until the CRT dies
  if (c === 58) crash(t, 1.2);
}

// ---------- sfx on the video cues (comp time -> real time) ----------
const PENTA = [64, 67, 69, 71, 74, 76, 79];
for (const e0 of EVENTS) {
  const t = e0.t * SCALE, r = e0.n ?? .5, e = e0;
  const tone = (o) => voice(Object.assign({ to: SFX }, o));
  switch (e.type) {
    case "key":
      tone({ t, dur: .03, notes: [53 + r * 4], wave: "sine", d: .012, sus: 0, gain: .26, bend: -8 });
      hiss({ t, dur: .03, d: .006, gain: .22, mode: "bp", fc: 3200 + r * 1800, q: .6, to: SFX, pan: (r - .5) * .3 });
      break;
    case "blip": if (!(e.i % 2)) tone({ t, dur: .045, notes: [PENTA[(r * PENTA.length) | 0] + 12], wave: "pulse", duty: .25, d: .03, sus: .3, rel: .01, gain: .1 }); break;
    case "boot": tone({ t, dur: .07, notes: [84 + [0, 4, 7, 12][e.i % 4]], wave: "pulse", d: .05, sus: .4, rel: .01, gain: .08 }); break;
    case "robot": tone({ t, dur: .3, notes: [57], wave: "pulse", duty: .25, d: .2, sus: .6, gain: .09, glideFrom: 45, glide: .3, verb: .3 }); break;
    case "line": tone({ t, dur: .03, notes: [81], wave: "pulse", d: .015, sus: 0, gain: .05 }); break;
    case "err": tone({ t, dur: .14, notes: [43, 44], wave: "pulse", d: .2, sus: .8, rel: .02, gain: .14, fc: 2200, drive: 3 }); break;
    case "strike": hiss({ t, dur: .32, gain: .3, mode: "bp", fc: 600, fc1: 6000, q: .3, to: SFX, shape: p => Math.sin(Math.PI * p) }); break;
    case "stamp": break; // the music hits on these
    case "hit": voice({ t, dur: 1.2, notes: [E1], wave: "sine", d: .5, sus: 0, gain: .35, to: SFX }); break;
    case "whoosh": hiss({ t: t - .24, dur: .34, gain: .2, mode: "bp", fc: 400, fc1: 6000, q: .4, to: SFX, verb: .2, shape: p => p * p * (1 - Math.pow(p, 8)) }); break;
    case "crt_on": tone({ t, dur: .32, notes: [96], wave: "sine", glideFrom: 36, glide: .3, d: .25, sus: .3, gain: .12 });
      hiss({ t, dur: .4, d: .14, gain: .18, mode: "hp", fc: 2000, to: SFX }); break;
    case "crt_off": hiss({ t, dur: .5, d: .14, gain: .16, mode: "lp", fc: 3000, fc1: 300, to: SFX }); break;
    case "ok": [[76, 0], [81, .065], [88, .13]].forEach(([m, o]) => tone({ t: t + o, dur: .09, notes: [m], wave: "pulse", duty: .25, d: .08, sus: .3, rel: .05, gain: .11, verb: .3 })); break;
    case "warn": [[81, 0], [76, .09]].forEach(([m, o]) => tone({ t: t + o, dur: .085, notes: [m], wave: "pulse", duty: .5, d: .1, sus: .5, rel: .03, gain: .1, fc: 3000, drive: 2 })); break;
    case "click":
      hiss({ t, dur: .012, d: .003, gain: .32, mode: "bp", fc: 2500, q: .5, to: SFX });
      hiss({ t: t + .06, dur: .01, d: .003, gain: .2, mode: "bp", fc: 3200, q: .5, to: SFX }); break;
    case "dl_done": [[84, 0], [88, .05], [91, .1], [96, .15]].forEach(([m, o]) => tone({ t: t + o, dur: .07, notes: [m], wave: "pulse", d: .07, sus: .3, gain: .07, echo: .3 })); break;
    case "copy": [[88, 0], [93, .055]].forEach(([m, o]) => tone({ t: t + o, dur: .05, notes: [m], wave: "pulse", duty: .25, d: .04, sus: .3, gain: .07 })); break;
    case "tick": tone({ t, dur: .018, notes: [100 + (e.i % 5)], wave: "pulse", d: .01, sus: 0, gain: .05 }); break;
    case "cap": tone({ t, dur: .05, notes: [79], wave: "tri", d: .05, sus: .2, gain: .06, glideFrom: 72, glide: .05 }); break;
  }
}

// ---------- fx ----------
(function echoFx() { // dotted-eighth ping-pong
  const dl = Math.round(BEAT * .75 * SR), fb = .4, [eL, eR] = ECHO;
  const bL = new Float32Array(N), bR = new Float32Array(N); let lL = 0, lR = 0;
  for (let i = 0; i < N; i++) {
    const inL = i >= dl ? bR[i - dl] : 0, inR = i >= dl ? bL[i - dl] : 0;
    lL += .3 * (inL - lL); lR += .3 * (inR - lR);
    bL[i] = eL[i] + eR[i] * .5 + lL * fb; bR[i] = lR * fb;
    SYN[0][i] += lL * .6; SYN[1][i] += lR * .6;
  }
})();
(function reverb() {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356], aps = [225, 556, 441];
  for (const ch of [0, 1]) {
    const x = VERB[ch], out = new Float32Array(N), sp = ch ? 23 : 0;
    for (const c of combs) { const d = Math.round((c + sp) * SR / 44100), b = new Float32Array(d); let k = 0, lp = 0;
      for (let i = 0; i < N; i++) { const y = b[k]; lp += .45 * (y - lp); b[k] = x[i] + lp * .78; out[i] += y; k = (k + 1) % d; } }
    for (const a of aps) { const d = Math.round((a + sp) * SR / 44100), b = new Float32Array(d); let k = 0;
      for (let i = 0; i < N; i++) { const bb = b[k], y = -out[i] + bb; b[k] = out[i] + bb * .5; out[i] = y; k = (k + 1) % d; } }
    for (let i = 0; i < N; i++) SYN[ch][i] += out[i] * .06;
  }
})();
// crushed drum bus: drive + a little sample-rate grit, like a sampled break
for (const ch of [0, 1]) {
  const d = DRUMS[ch]; let held = 0;
  for (let i = 0; i < N; i++) {
    if (i % 3 === 0) held = d[i];
    const x = d[i] * .7 + held * .3;
    d[i] = Math.tanh(x * 2.4) * .62 + x * .25;
  }
}

// ---------- master: sum, tape stop when the CRT dies, limit ----------
const MUSIC = [new Float32Array(N), new Float32Array(N)];
for (const ch of [0, 1]) for (let i = 0; i < N; i++) MUSIC[ch][i] = DRUMS[ch][i] * .95 + BASS[ch][i] * .9 + SYN[ch][i];
const stopAt = EVENTS.find(e => e.type === "crt_off").t * SCALE, stopLen = .55;
for (const ch of [0, 1]) {
  const src = MUSIC[ch].slice(), i0 = Math.round(stopAt * SR);
  let pos = i0;
  for (let i = i0; i < N; i++) {
    const x = (i - i0) / SR, rate = Math.max(0, 1 - x / stopLen);
    pos += rate * rate;
    const k = Math.floor(pos), f = pos - k;
    MUSIC[ch][i] = (src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f;
    if (rate === 0) MUSIC[ch][i] = 0;
  }
}
// UI sounds sit on top: music dips a little under each click / chime
const sfxEnv = new Float32Array(N);
for (let i = 0, e = 0; i < N; i++) {
  const x = Math.max(Math.abs(SFX[0][i]), Math.abs(SFX[1][i]));
  e = x > e ? e + (x - e) * .02 : e * Math.exp(-1 / (.12 * SR));
  sfxEnv[i] = e;
}
const L = new Float32Array(N), R = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / .15) * (t > DURATION - .12 ? Math.max(0, (DURATION - t) / .12) : 1);
  for (const [o, ch] of [[L, 0], [R, 1]]) {
    const dip = 1 - .3 * Math.min(1, sfxEnv[i] * 5);
    const v = (MUSIC[ch][i] * dip + SFX[ch][i] * 1.15) * fade;
    o[i] = Math.tanh(v * 1.05);
    peak = Math.max(peak, Math.abs(o[i]));
  }
}
const norm = .7 / peak; // headroom for AAC inter-sample peaks
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8); out.write("fmt ", 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
fs.writeFileSync(path.join(__dirname, "soundtrack-bigbeat.wav"), out);
console.log(`wrote soundtrack-bigbeat.wav (${DURATION.toFixed(2)}s at ${BPM} bpm, peak ${peak.toFixed(2)})`);
