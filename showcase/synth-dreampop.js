// Dream-pop soundtrack for the MDfW showcase (original composition, 120 bpm, D major):
// music box, FM electric piano, lush pads, formant "vocal chop" melody, crisp glitchy beats, reverse swells, stutters.
// Plays on the original 120 bpm timeline, so the original video is reused as-is.
//   node synth-dreampop.js  -> soundtrack-dreampop.wav
const fs = require("fs");
const path = require("path");
const { DURATION, EVENTS } = JSON.parse(fs.readFileSync(path.join(__dirname, "events.json"), "utf8"));

const SR = 48000, N = Math.ceil(DURATION * SR);
const BEAT = .5, BAR = 2, S16 = BEAT / 4, E8 = BEAT / 2;
const bus = (n = N) => [new Float32Array(n), new Float32Array(n)];
const DRUMS = bus(), MUSIC = bus(), SFX = bus(), VERB = bus(), ECHO = bus();
const duck = new Float32Array(N);

let seed = 5;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const hash = i => { const x = Math.sin(i * 78.233 + 4.1) * 43758.5453; return x - Math.floor(x); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const n = s => { const m = s.match(/^([A-G])(#?)(-?\d)$/); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); };
const ns = str => str.split(" ").map(n);

function put(target, i, v, pan = 0) {
  if (i < 0 || i >= target[0].length) return;
  const a = (pan + 1) * Math.PI / 4;
  target[0][i] += v * Math.cos(a); target[1][i] += v * Math.sin(a);
}
function svf() {
  let low = 0, band = 0;
  return (x, fc, q) => {
    const F = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6.5) / SR);
    low += F * band; const high = x - low - q * band; band += F * high;
    return { low, band, high };
  };
}
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
// render a sample function into a bus: fn(x, j) -> value, for dur seconds starting at t
function render(t, dur, fn, { to = MUSIC, pan = 0, verb = 0, echo = 0, ducked = false } = {}) {
  const i0 = Math.round(t * SR), len = Math.round(dur * SR);
  for (let j = 0; j < len; j++) {
    const i = i0 + j; if (i >= to[0].length) break;
    let v = fn(j / SR, j);
    if (ducked && to === MUSIC) v *= 1 - .3 * duck[i];
    const p = typeof pan === "function" ? pan(j / SR) : pan;
    put(to, i, v, p);
    if (verb) put(VERB, i, v * verb, p);
    if (echo) put(ECHO, i, v * echo, p);
  }
}

// ---------- instruments ----------
// FM electric piano: ratio-1 body plus a fast-decaying high "tine"
function epiano(t, m, { len = 1.6, g = .1, pan = 0, verb = .35, to = MUSIC } = {}) {
  const f = mtof(m), vel = g;
  let pc = 0, pm = 0, pt = 0;
  render(t, len + .3, x => {
    pm += f / SR; pt += f * 14 / SR; pc += f / SR;
    const idx = 1.6 * Math.exp(-x / .28) + .25, tine = .9 * Math.exp(-x / .025);
    const mod = Math.sin(2 * Math.PI * pm) * idx + Math.sin(2 * Math.PI * pt) * tine;
    const env = Math.min(1, x / .003) * Math.exp(-x / (len * .55)) * (x > len ? Math.max(0, 1 - (x - len) / .3) : 1);
    return Math.sin(2 * Math.PI * pc + mod) * env * vel * (1 + .12 * Math.sin(2 * Math.PI * 4.5 * x));
  }, { to, pan: x => pan + .25 * Math.sin(2 * Math.PI * .7 * (t + x)), verb, ducked: true });
}
// music box / celesta: slightly inharmonic sines, quick decay
function pluck(t, m, { g = .05, pan = 0, verb = .45, echo = .35, dec = .55 } = {}) {
  const f = mtof(m); let a = 0, b = 0, c = 0;
  render(t, dec * 3, x => {
    a += f / SR; b += f * 2 / SR; c += f * 3.98 / SR;
    const e = Math.min(1, x / .002) * Math.exp(-x / dec);
    return (Math.sin(2 * Math.PI * a) + .35 * Math.sin(2 * Math.PI * b) * Math.exp(-x / .15) + .12 * Math.sin(2 * Math.PI * c) * Math.exp(-x / .06)) * e * g;
  }, { pan, verb, echo });
}
// warm pad: detuned saws through a soft low-pass, slow swell
function pad(t, notes, dur, { g = .028, fc = 1500, a = .5, rel = .8, verb = .6 } = {}) {
  for (const m of notes) for (const [det, pan] of [[-9, -.7], [8, .7], [0, 0]]) {
    const f = mtof(m) * Math.pow(2, det / 1200), filt = svf(); let ph = hash(m + det);
    render(t, dur + rel, x => {
      const dt = f / SR * (1 + .0015 * Math.sin(2 * Math.PI * .25 * x + det));
      ph += dt; if (ph >= 1) ph -= 1;
      const v = filt(2 * ph - 1 - blep(ph, dt), fc * (1 + .15 * Math.sin(2 * Math.PI * .1 * (t + x))), .9).low;
      const e = Math.min(1, x / a) * (x > dur ? Math.max(0, 1 - (x - dur) / rel) : 1);
      return v * e * g;
    }, { pan, verb, ducked: true });
  }
}
// formant voice: a glottal pulse through three vowel resonances ("ooh", "aah" ...)
const VOWEL = { a: [[800, 1], [1150, .5], [2900, .12]], o: [[450, 1], [800, .45], [2830, .08]], u: [[325, 1], [700, .25], [2530, .05]],
  e: [[400, 1], [1700, .35], [2600, .15]], i: [[290, 1], [2100, .3], [3000, .2]] };
function vox(t, m, dur, { g = .09, vowel = "a", to = "o", pan = 0, verb = .55, echo = .3, vib = .012, a = .04, rel = .18, slideFrom = null } = {}) {
  const F0 = VOWEL[vowel], F1 = VOWEL[to] || F0, fl = [svf(), svf(), svf()], br = svf();
  let ph = 0;
  render(t, dur + rel, x => {
    const p = Math.min(1, x / Math.max(dur, .01));
    let mm = m;
    if (slideFrom != null && x < .08) mm = slideFrom + (m - slideFrom) * (x / .08);
    const f = mtof(mm) * (1 + vib * Math.min(1, x / .25) * Math.sin(2 * Math.PI * 5.4 * x));
    ph += f / SR; if (ph >= 1) ph -= 1;
    const src = (ph < .35 ? 1 : -.55) + .25 * noise();
    let v = 0;
    for (let k = 0; k < 3; k++) {
      const fc = F0[k][0] + (F1[k][0] - F0[k][0]) * p, gk = F0[k][1] + (F1[k][1] - F0[k][1]) * p;
      v += fl[k](src, fc, .12).band * gk;
    }
    v += br(noise(), 3000, .5).band * .05; // breath
    const e = Math.min(1, x / a) * (x > dur ? Math.max(0, 1 - (x - dur) / rel) : 1);
    return v * e * g;
  }, { pan, verb, echo });
}
function bassNote(t, m, len, g = .2) {
  const f = mtof(m); let a = 0, b = 0;
  render(t, len + .08, x => {
    a += f / SR; b += f * 2 / SR;
    const e = Math.min(1, x / .006) * Math.exp(-x / 1.1) * (x > len ? Math.max(0, 1 - (x - len) / .08) : 1);
    return (Math.sin(2 * Math.PI * a) + .22 * (1 - 4 * Math.abs(b % 1 - .5))) * e * g;
  }, { ducked: true });
}

// ---------- drums: crisp, small, glitchy ----------
function noiseHit({ t, dur, d, g, mode = "hp", fc = 7000, q = .7, to = DRUMS, pan = 0, verb = 0, bursts = 1 }) {
  const f = svf();
  render(t, dur, x => {
    const o = f(noise(), fc, q), v = mode === "lp" ? o.low : mode === "bp" ? o.band : o.high;
    let e = Math.exp(-x / d);
    if (bursts > 1) { const k = Math.floor(x / .009); e = k < bursts - 1 ? Math.exp(-(x - k * .009) / .003) : Math.exp(-(x - (bursts - 1) * .009) / d); }
    return v * e * g * Math.min(1, (dur - x) / .003);
  }, { to, pan, verb });
}
function kick(t, g = 1) {
  let ph = 0;
  render(t, .3, x => { ph += (48 + 90 * Math.exp(-x / .03)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-x / .13) * g * .7; }, { to: DRUMS });
  const i0 = Math.round(t * SR);
  for (let j = 0; j < .3 * SR && i0 + j < N; j++) duck[i0 + j] = Math.max(duck[i0 + j], Math.exp(-j / SR / .1) * g);
}
const clap = (t, g = 1) => { noiseHit({ t, dur: .3, d: .09, g: .32 * g, mode: "bp", fc: 1500, q: .5, verb: .55, bursts: 3 }); noiseHit({ t, dur: .06, d: .02, g: .12 * g, mode: "hp", fc: 6000 }); };
const rim = (t, g = 1) => { let p = 0; render(t, .05, x => { p += 1700 / SR; return (1 - 4 * Math.abs(p % 1 - .5)) * Math.exp(-x / .012) * .1 * g; }, { to: DRUMS, pan: .3, verb: .3 }); };
const hat = (t, g = 1, pan = .25) => noiseHit({ t, dur: .04, d: .011, g: .09 * g, fc: 9000, pan });
const shaker = (t, g = 1) => noiseHit({ t, dur: .05, d: .018, g: .035 * g, mode: "bp", fc: 6500, q: .4, pan: -.35 });

function beat(bar, g = 1, { glitch = false, full = true } = {}) {
  const t = bar * BAR;
  [[0, 1], [7, .5], [10, .85]].forEach(([s, v]) => kick(t + s * S16, v * g));
  clap(t + 4 * S16, g); clap(t + 12 * S16, g);
  if (full) for (let s = 0; s < 16; s++) shaker(t + s * S16, (s % 2 ? .6 : 1) * g * (.7 + .3 * hash(bar * 16 + s)));
  for (let s = 2; s < 16; s += 4) hat(t + s * S16, g);
  if (bar % 2) rim(t + 14 * S16, .8 * g);
  if (glitch) { // micro-edits: a 64th hat roll and a stuttered clap tail
    for (let k = 0; k < 6; k++) hat(t + 15 * S16 + k * S16 / 4, (1 - k / 7) * g, (k % 2 ? .5 : -.5));
    for (let k = 1; k < 4; k++) clap(t + 12 * S16 + k * S16 / 2, .35 * g / k);
  }
}

// ---------- harmony (D major): Gmaj9 - A6/9 - F#m7(9) - Bm9, then Dmaj9 to close ----------
const CH = [
  { root: n("G2"), v: ns("B3 D4 F#4 A4"), arp: ns("G4 B4 D5 F#5 A5 F#5 D5 B4") },
  { root: n("A2"), v: ns("C#4 E4 F#4 B4"), arp: ns("A4 C#5 E5 F#5 B5 F#5 E5 C#5") },
  { root: n("F#2"), v: ns("A3 C#4 E4 G#4"), arp: ns("F#4 A4 C#5 E5 G#5 E5 C#5 A4") },
  { root: n("B1"), v: ns("A3 D4 F#4 C#5"), arp: ns("B4 D5 F#5 A5 C#6 A5 F#5 D5") },
];
const DMAJ9 = { root: n("D2"), v: ns("F#3 A3 C#4 E4"), arp: ns("D5 F#5 A5 C#6 E6 C#6 A5 F#5") };
const chord = bar => CH[((bar % 4) + 4) % 4];

function keys(bar, g = 1) {
  const c = chord(bar), t = bar * BAR;
  [[0, 1.3], [3 * E8, .45], [6 * E8, .9]].forEach(([o, l], k) =>
    c.v.forEach((m, i) => epiano(t + o + i * .006, m, { len: l, g: .045 * g * (k === 1 ? .7 : 1), pan: (i - 1.5) * .25 })));
}
function bass(bar, g = 1) {
  const c = chord(bar), t = bar * BAR;
  bassNote(t, c.root, 1.2, .2 * g); bassNote(t + 1.5 * BEAT, c.root, .35, .14 * g); bassNote(t + 2.5 * BEAT, c.root + 12, .5, .1 * g);
  bassNote(t + 3.5 * BEAT, c.root + 7, .4, .12 * g);
}
function arp(bar, g = 1, every = 1, c = chord(bar)) {
  const t = bar * BAR;
  for (let k = 0; k < 8; k += every) pluck(t + k * E8, c.arp[k] + 12 * (k === 4 && hash(bar) > .5 ? 1 : 0), { g: .04 * g, pan: k % 2 ? .45 : -.45 });
}
// vocal-chop melody: [8th position in a 4-bar phrase, note, length in 8ths, vowel from, vowel to]
const MEL_A = [[0, "F#5", 3, "a", "o"], [3, "E5", 1, "o", "o"], [4, "D5", 2, "a", "a"], [6, "E5", 2, "u", "o"],
  [8, "E5", 3, "a", "o"], [11, "C#5", 1, "o", "o"], [12, "A4", 4, "a", "u"],
  [16, "C#5", 3, "e", "a"], [19, "A4", 1, "o", "o"], [20, "F#4", 2, "a", "a"], [22, "A4", 2, "u", "o"],
  [24, "B4", 2, "a", "a"], [26, "D5", 2, "o", "a"], [28, "F#5", 4, "a", "u"]];
const MEL_B = MEL_A.slice(0, 11).concat([[24, "B4", 2, "a", "a"], [26, "D5", 2, "o", "a"], [28, "E5", 2, "a", "o"], [30, "A5", 2, "a", "u"]]);
function melody(bar0, mel, g = 1) {
  let prev = null;
  mel.forEach(([p, nt, l, v0, v1]) => {
    const m = n(nt);
    vox(bar0 * BAR + p * E8, m, l * E8 * .9, { g: .085 * g, vowel: v0, to: v1, slideFrom: prev != null && Math.abs(prev - m) <= 4 ? prev : null });
    vox(bar0 * BAR + p * E8 + .012, m - 12, l * E8 * .9, { g: .03 * g, vowel: v0, to: v1, pan: .4, echo: .15 }); // soft octave double
    prev = m;
  });
}
function choir(bar, dur = BAR, g = 1, c = chord(bar)) {
  c.v.forEach((m, i) => vox(bar * BAR, m, dur - .1, { g: .028 * g, vowel: "o", to: "a", a: .5, rel: .7, vib: .006, pan: (i - 1.5) * .5, verb: .8, echo: 0 }));
}
// reverse swell: render a chord with reverb-ish tail into a scratch buffer, then play it backwards ending at tEnd
function reverseSwell(tEnd, dur, notes, g = 1) {
  const len = Math.round(dur * SR), tmp = bus(len), saveMusic = MUSIC;
  for (const m of notes) {
    const f = mtof(m); let a = 0;
    for (let j = 0; j < len; j++) { a += f / SR; const x = j / SR; put(tmp, j, (Math.sin(2 * Math.PI * a) + .3 * Math.sin(4 * Math.PI * a)) * Math.exp(-x / (dur * .35)) * .05 * g, (m % 3 - 1) * .5); }
  }
  for (let j = 0; j < len; j++) { const nz = noise() * .02 * g * Math.exp(-j / SR / (dur * .3)); put(tmp, j, nz); }
  const i0 = Math.round((tEnd - dur) * SR);
  for (let j = 0; j < len; j++) for (const ch of [0, 1]) {
    const v = tmp[ch][len - 1 - j];
    if (i0 + j >= 0 && i0 + j < N) { saveMusic[ch][i0 + j] += v; VERB[ch][i0 + j] += v * .4; }
  }
}
// stutter: repeat a short slice of the mix (applied to MUSIC + DRUMS after everything is written)
const STUTTERS = [];
const stutter = (t, dur, slice) => STUTTERS.push({ t, dur, slice });

// ---------- arrangement (bars of 2 s, same grid as the video) ----------
const BARS = Math.ceil(DURATION / BAR);
for (let b = 0; b < BARS; b++) {
  const t = b * BAR, c = chord(b);
  if (t < 6) {                                    // boot: music box alone, pad blooming in
    arp(b, 1.15 + b * .15, b === 0 ? 2 : 1);
    if (b >= 1) pad(t, c.v, BAR, { g: .024 + b * .008, fc: 900 + b * 300 });
    continue;
  }
  if (t < 12) {                                   // problem: keys + bass, no beat
    keys(b, .9); bass(b, .85); pad(t, c.v, BAR, { g: .024, fc: 1300 }); arp(b, .5, 2);
    if (t === 10) reverseSwell(12, 2, CH[0].v.map(m => m + 12), 1.2);
    continue;
  }
  if (t < 16) {                                   // brand: the lift
    keys(b); bass(b); pad(t, c.v, BAR, { g: .032, fc: 2000 }); choir(b, BAR, 1); arp(b, .7);
    kick(t, .9); clap(t + BEAT, .6); clap(t + 3 * BEAT, .6); for (let s = 2; s < 16; s += 4) hat(t + s * S16, .8);
    if (t === 12) { pad(t, CH[0].v.map(m => m + 12), BAR, { g: .02, fc: 4000, a: .05, rel: 1.5, verb: 1 }); noiseHit({ t, dur: 2.5, d: .9, g: .08, fc: 6000, verb: .8, to: MUSIC }); }
    if (t === 14) reverseSwell(16, 1.5, CH[2].v, .8);
    continue;
  }
  if (t < 32) {                                   // demo: verse groove
    beat(b, .9, { glitch: b % 4 === 3 }); keys(b); bass(b); pad(t, c.v, BAR, { g: .024, fc: 1500 }); arp(b, .55, 2);
    if (t === 30) reverseSwell(32, 2, CH[0].v.map(m => m + 12), 1);
    continue;
  }
  if (t < 48) {                                   // chorus: vocal chops on top
    beat(b, 1, { glitch: b % 2 === 1 }); keys(b, .85); bass(b); pad(t, c.v, BAR, { g: .026, fc: 1900 }); choir(b, BAR, .8); arp(b, .6);
    if (t === 32) melody(b, MEL_A);
    if (t === 40) melody(b, MEL_B);
    if (t === 36 || t === 46) stutter(t + 1.75, .25, S16 / 2); // glitch into 38 (find section) and 48 (models)
    continue;
  }
  if (t < 52) {                                   // coverage counters: build
    beat(b, 1, { glitch: true }); keys(b); bass(b); pad(t, c.v, BAR, { g: .028, fc: 2400 }); arp(b, .8);
    if (t === 50) { reverseSwell(52, 2, CH[0].v.map(m => m + 12), 1.3); stutter(51.5, .5, S16 / 2); }
    continue;
  }
  if (t < 56) {                                   // languages: breakdown, the voice sings alone
    pad(t, c.v, BAR, { g: .03, fc: 1200 }); arp(b, .8); choir(b, BAR, .6);
    if (t === 52) melody(b, MEL_A.slice(0, 7), .9);
    if (t === 54) reverseSwell(56, 1.5, CH[3].v.map(m => m + 12), .9);
    continue;
  }
  if (t < 58) {                                   // Type. Download. Install.
    [0, 1, 2].forEach(k => {
      const cc = CH[[0, 1, 3][k]], tt = t + k * BEAT;
      cc.v.forEach((m, i) => epiano(tt + i * .005, m + 12, { len: .45, g: .05, pan: (i - 1.5) * .3 }));
      bassNote(tt, cc.root, .4, .2); kick(tt, .9); clap(tt, .5);
      vox(tt, cc.v[3] + 12, .3, { g: .06, vowel: "a", to: "o", vib: 0 });
    });
    stutter(t + 2 * BEAT + .3, .2, S16 / 4);
    reverseSwell(58, 1, DMAJ9.v.map(m => m + 12), 1.1);
    continue;
  }
  // final: everything resolves to D major and rings until the CRT dies
  if (t === 58) {
    pad(t, DMAJ9.v, 3.4, { g: .034, fc: 2600, a: .05, rel: 1 });
    DMAJ9.v.forEach((m, i) => epiano(t + i * .01, m, { len: 3, g: .05, pan: (i - 1.5) * .3 }));
    choir(b, 3.4, .9, DMAJ9);
    bassNote(t, DMAJ9.root, 3, .22); kick(t, 1);
    noiseHit({ t, dur: 2.5, d: .9, g: .08, fc: 6000, verb: .8, to: MUSIC });
    for (let k = 0; k < 12; k++) pluck(t + .25 + k * E8 * .5, DMAJ9.arp[k % 8] + (k >= 8 ? 12 : 0), { g: .035 * (1 - k / 14), pan: k % 2 ? .5 : -.5, dec: .8 });
  }
}

// vinyl crackle + room tone, so the quiet parts breathe
render(0, DURATION, () => (noise() > .9986 ? noise() * .12 : 0) + noise() * .0025, { to: MUSIC });

// ---------- sfx on the video cues ----------
const PENTA = ns("D5 E5 F#5 A5 B5 D6 E6");
for (const e of EVENTS) {
  const t = e.t, r = e.n ?? .5;
  const blip = (tt, m, len, g, wave = "sine", extra = {}) => { let p = 0; const f = mtof(m);
    render(tt, len + .02, x => { p += f / SR; const s = wave === "sine" ? Math.sin(2 * Math.PI * p) : 1 - 4 * Math.abs(p % 1 - .5);
      return s * Math.min(1, x / .002) * Math.exp(-x / (len * .6)) * g; }, Object.assign({ to: SFX }, extra)); };
  switch (e.type) {
    case "key": noiseHit({ t, dur: .03, d: .006, g: .2, mode: "bp", fc: 3000 + r * 1500, q: .6, to: SFX, pan: (r - .5) * .3 }); blip(t, 50 + r * 3, .03, .12); break;
    case "blip": if (!(e.i % 2)) blip(t, PENTA[(r * PENTA.length) | 0] + 12, .06, .06, "tri", { verb: .3 }); break;
    case "boot": blip(t, [86, 90, 93, 98][e.i % 4], .12, .07, "sine", { verb: .4 }); break;
    case "robot": [74, 78, 81].forEach((m, k) => blip(t + k * .06, m, .15, .05, "tri", { verb: .4 })); break;
    case "line": blip(t, 81, .04, .04, "tri"); break;
    case "err": blip(t, 57, .16, .1, "tri"); blip(t, 58, .16, .07, "tri"); break;
    case "strike": noiseHit({ t, dur: .3, d: .12, g: .16, mode: "bp", fc: 3000, q: .3, to: SFX, verb: .3 }); break;
    case "hit": case "stamp": break; // the music lands these
    case "whoosh": render(t - .3, .38, x => noise() * .06 * Math.pow(x / .38, 2), { to: SFX, verb: .5 }); break;
    case "crt_on": blip(t, 84, .35, .06, "sine", { verb: .5 }); noiseHit({ t, dur: .35, d: .12, g: .1, fc: 2500, to: SFX }); break;
    case "crt_off": noiseHit({ t, dur: .45, d: .12, g: .1, mode: "lp", fc: 2500, to: SFX }); break;
    case "ok": [[n("D6"), 0], [n("F#6"), .07], [n("A6"), .14], [n("D7"), .21]].forEach(([m, o]) => pluck(t + o, m, { g: .07, verb: .5, echo: .3, dec: .4 })); break;
    case "warn": [[n("B5"), 0], [n("F#5"), .1]].forEach(([m, o]) => blip(t + o, m, .14, .09, "tri", { verb: .3 })); break;
    case "click": noiseHit({ t, dur: .012, d: .003, g: .25, mode: "bp", fc: 2500, q: .5, to: SFX }); noiseHit({ t: t + .065, dur: .01, d: .003, g: .15, mode: "bp", fc: 3200, q: .5, to: SFX }); break;
    case "dl_done": ns("A5 D6 F#6 A6").forEach((m, k) => pluck(t + k * .06, m, { g: .06, echo: .3 })); break;
    case "copy": pluck(t, n("E6"), { g: .06 }); pluck(t + .06, n("A6"), { g: .06 }); break;
    case "tick": blip(t, 96 + (e.i % 5), .02, .035, "tri"); break;
    case "cap": blip(t, 79, .08, .045, "tri", { verb: .3 }); break;
  }
}

// ---------- fx ----------
(function echoFx() {
  const dl = Math.round(BEAT * .75 * SR), fb = .42, [eL, eR] = ECHO;
  const bL = new Float32Array(N), bR = new Float32Array(N); let lL = 0, lR = 0;
  for (let i = 0; i < N; i++) {
    const inL = i >= dl ? bR[i - dl] : 0, inR = i >= dl ? bL[i - dl] : 0;
    lL += .25 * (inL - lL); lR += .25 * (inR - lR);
    bL[i] = eL[i] + eR[i] * .5 + lL * fb; bR[i] = lR * fb;
    MUSIC[0][i] += lL * .55; MUSIC[1][i] += lR * .55;
  }
})();
(function reverb() { // big soft hall: pre-delay, long damped combs, diffusing allpasses
  const pre = Math.round(.03 * SR), combs = [1687, 1601, 2053, 2251, 1867, 1979], aps = [347, 113, 37];
  for (const ch of [0, 1]) {
    const x = VERB[ch], out = new Float32Array(N), sp = ch ? 31 : 0;
    for (const c of combs) { const d = Math.round((c + sp) * SR / 44100), b = new Float32Array(d); let k = 0, lp = 0;
      for (let i = 0; i < N; i++) { const y = b[k]; lp += .3 * (y - lp); b[k] = (i >= pre ? x[i - pre] : 0) + lp * .87; out[i] += y; k = (k + 1) % d; } }
    for (const a of aps) { const d = Math.round((a + sp) * SR / 44100), b = new Float32Array(d); let k = 0;
      for (let i = 0; i < N; i++) { const bb = b[k], y = -out[i] + bb; b[k] = out[i] + bb * .6; out[i] = y; k = (k + 1) % d; } }
    for (let i = 0; i < N; i++) MUSIC[ch][i] += out[i] * .05;
  }
})();

// ---------- master: stutters, tape stop at the CRT, gentle glue ----------
const MIX = [new Float32Array(N), new Float32Array(N)];
for (const ch of [0, 1]) for (let i = 0; i < N; i++) MIX[ch][i] = MUSIC[ch][i] + DRUMS[ch][i] * .9;
for (const { t, dur, slice } of STUTTERS) for (const ch of [0, 1]) {
  const i0 = Math.round(t * SR), L = Math.round(slice * SR), len = Math.round(dur * SR), src = MIX[ch].slice(i0, i0 + L);
  for (let j = 0; j < len; j++) { const k = j % L, fade = Math.min(1, k / 40, (L - k) / 40); MIX[ch][i0 + j] = src[k] * fade * (1 - .4 * j / len); }
}
const stopAt = EVENTS.find(e => e.type === "crt_off").t, stopLen = .6;
for (const ch of [0, 1]) {
  const src = MIX[ch].slice(), i0 = Math.round(stopAt * SR); let pos = i0;
  for (let i = i0; i < N; i++) {
    const x = (i - i0) / SR, rate = Math.max(0, 1 - x / stopLen);
    pos += rate * rate; const k = Math.floor(pos), f = pos - k;
    MIX[ch][i] = rate === 0 ? 0 : ((src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f) * Math.min(1, rate * 3);
  }
}
const sfxEnv = new Float32Array(N);
for (let i = 0, e = 0; i < N; i++) { const x = Math.max(Math.abs(SFX[0][i]), Math.abs(SFX[1][i])); e = x > e ? e + (x - e) * .02 : e * Math.exp(-1 / (.12 * SR)); sfxEnv[i] = e; }
const OUT = [new Float32Array(N), new Float32Array(N)];
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / .3) * (t > DURATION - .15 ? Math.max(0, (DURATION - t) / .15) : 1);
  const dip = 1 - .22 * Math.min(1, sfxEnv[i] * 5);
  for (const ch of [0, 1]) {
    const v = (MIX[ch][i] * dip + SFX[ch][i]) * fade;
    OUT[ch][i] = Math.tanh(v * 1.4) / 1.4 * 1.1;
    peak = Math.max(peak, Math.abs(OUT[ch][i]));
  }
}
const norm = .74 / peak; // headroom for AAC inter-sample peaks
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, OUT[0][i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, OUT[1][i] * norm)) * 32767), 46 + i * 4);
}
fs.writeFileSync(path.join(__dirname, "soundtrack-dreampop.wav"), buf);
console.log(`wrote soundtrack-dreampop.wav (${DURATION}s at 120 bpm, peak ${peak.toFixed(2)})`);
