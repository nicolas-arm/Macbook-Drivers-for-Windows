// Heavy-metal soundtrack for the MDfW showcase (original composition, 120 bpm, E minor / phrygian).
// Guitars are Karplus-Strong strings recorded "DI", then run through a high-gain amp + cab sim and double-tracked L/R.
// Plays on the original 120 bpm timeline, so the original video is reused as-is.
//   node synth-metal.js  -> soundtrack-metal.wav
const fs = require("fs");
const path = require("path");
const { DURATION, EVENTS } = JSON.parse(fs.readFileSync(path.join(__dirname, "events.json"), "utf8"));

const SR = 48000, N = Math.ceil(DURATION * SR);
const BEAT = .5, BAR = 2, S16 = BEAT / 4;
const mono = () => new Float32Array(N), stereo = () => [mono(), mono()];
const DI_L = mono(), DI_R = mono(), DI_BASS = mono(), DI_LEAD = mono();
const DRUMS = stereo(), SFX = stereo(), ROOM = stereo();

let seed = 3;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const hash = i => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function put(target, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
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

// ---------- strings ----------
// Karplus-Strong with fractional delay, so pitch can bend; mute = palm mute (dark, short)
function ks(di, t, f, dur, { mute = false, vel = 1, bright = .55, rho = .9985, rel = .025, bend = null, vib = 0 } = {}) {
  const i0 = Math.round(t * SR), len = Math.round((dur + rel) * SR);
  const maxL = Math.ceil(SR / (f * .45)) + 4, buf = new Float32Array(maxL);
  const L0 = SR / f; let lp = 0;
  for (let k = 0; k < Math.ceil(L0); k++) { lp += bright * (noise() - lp); buf[k] = lp; }
  let w = Math.ceil(L0) % maxL, prev = 0, damp = 0;
  const loopLp = mute ? .32 : .75, r = mute ? .985 : rho;
  for (let j = 0; j < len; j++) {
    const i = i0 + j; if (i >= N) break;
    const x = j / SR;
    let ff = f;
    if (bend) ff *= Math.pow(2, bend(x) / 12);
    if (vib) ff *= 1 + vib * Math.min(1, x / .3) * Math.sin(2 * Math.PI * 5.8 * x);
    const L = SR / ff, rp = (w - L + maxL * 2) % maxL, k0 = Math.floor(rp), fr = rp - k0;
    const y = buf[k0] * (1 - fr) + buf[(k0 + 1) % maxL] * fr;
    let nv = r * .5 * (y + prev); prev = y;
    damp += loopLp * (nv - damp); nv = damp;
    buf[w] = nv; w = (w + 1) % maxL;
    let e = Math.min(1, x / .0015) * (mute ? Math.exp(-x / .085) : 1);
    if (x > dur) e *= Math.max(0, 1 - (x - dur) / rel);
    di[i] += y * e * vel;
  }
}
// power chord: root, fifth, octave, strummed down a few ms apart
const POWER = { E5: 40, F5: 41, G5: 43, A5: 45, Bb5: 46, B5: 47, C5: 48, D5: 50 };
function chord(di, t, name, dur, o = {}) {
  const r = POWER[name];
  [r, r + 7, r + 12].forEach((m, k) => ks(di, t + k * .004 + (o.slop || 0), mtof(m) * (o.detune || 1), dur, Object.assign({ vel: k ? .8 : 1 }, o)));
}
// riff language, one token per 16th: chord name = hit, "x" = palm-muted low E, "-" = let ring, "." = stop
function riff(bar, str, { gtr = true, bass = true } = {}) {
  const tok = str.trim().split(/\s+/), t0 = bar * BAR;
  for (let s = 0; s < tok.length; s++) {
    const tk = tok[s]; if (tk === "-" || tk === ".") continue;
    let len = 1; while (tok[s + len] === "-") len++;
    const t = t0 + s * S16, dur = len * S16 * .97;
    if (tk === "x") {
      if (gtr) { ks(DI_L, t, mtof(40), dur, { mute: true, vel: .9 }); ks(DI_R, t + .003, mtof(40) * 1.002, dur, { mute: true, vel: .9 }); }
      if (bass) ks(DI_BASS, t, mtof(28), dur, { mute: true, vel: 1, bright: .4 });
    } else {
      if (gtr) { chord(DI_L, t, tk, dur); chord(DI_R, t, tk, dur, { slop: .004, detune: 1.0017 }); }
      if (bass) ks(DI_BASS, t, mtof(POWER[tk] - 12), dur, { vel: 1, bright: .35, rho: .997 });
    }
  }
}

// ---------- amp + cab ----------
function amp(di, { gain = 60, tight = 220, lp = 4800, scoop = .45, presence = .3, gate = .002, out = 1 } = {}) {
  const y = new Float32Array(N), f1 = svf(), f2 = svf(), f3 = svf(), fs_ = svf(), fp = svf(), fh = svf();
  let hpl = 0, env = 0, g = 0;
  const kt = 1 - Math.exp(-2 * Math.PI * tight / SR);
  for (let i = 0; i < N; i++) {
    const x = di[i];
    env = Math.max(Math.abs(x), env * .9993);
    g += ((env > gate ? 1 : env / gate) - g) * .004;          // noise gate
    hpl += kt * (x - hpl);
    const pre = (x - hpl) * gain;
    const s1 = Math.tanh(pre + .25) - Math.tanh(.25);           // asymmetric first stage
    let s = Math.tanh(s1 * 2.6);                                 // second stage
    s = f1(s, lp, .75).low; s = f2(s, lp * 1.3, .9).low;        // speaker roll-off
    s = fh(s, 85, .8).high;
    s = s - scoop * fs_(s, 480, 1.2).band + presence * fp(s, 2700, 1.5).band;
    y[i] = f3(s, 7500, .7).low * g * out;
  }
  return y;
}

// ---------- drums ----------
function render(t, dur, fn, to, pan = 0, room = 0) {
  const i0 = Math.round(t * SR), len = Math.round(dur * SR);
  for (let j = 0; j < len; j++) { const i = i0 + j; if (i >= N) break; const v = fn(j / SR); put(to, i, v, pan); if (room) put(ROOM, i, v * room, pan); }
}
function nz({ t, dur, d, g, mode = "hp", fc = 6000, q = .7, pan = 0, room = 0, to = DRUMS }) {
  const f = svf();
  render(t, dur, x => { const o = f(noise(), fc, q); return (mode === "lp" ? o.low : mode === "bp" ? o.band : o.high) * Math.exp(-x / d) * g * Math.min(1, (dur - x) / .003); }, to, pan, room);
}
function kick(t, g = 1) {
  let ph = 0;
  render(t, .22, x => { ph += (52 + 110 * Math.exp(-x / .018)) / SR; return Math.tanh(1.8 * Math.sin(2 * Math.PI * ph)) * Math.exp(-x / .09) * .75 * g; }, DRUMS);
  nz({ t, dur: .012, d: .003, g: .55 * g, mode: "bp", fc: 3800, q: .5 }); // beater click, cuts through guitars
}
function snare(t, g = 1) {
  let ph = 0;
  render(t, .2, x => { ph += (210 - 30 * x) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-x / .05) * .45 * g; }, DRUMS, 0, .3);
  nz({ t, dur: .28, d: .085, g: .55 * g, mode: "bp", fc: 2800, q: .45, room: .45 });
  nz({ t, dur: .1, d: .03, g: .25 * g, mode: "hp", fc: 7000 });
}
function tom(t, f, g = 1, pan = 0) {
  let ph = 0;
  render(t, .45, x => { ph += f * (1 + .5 * Math.exp(-x / .03)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-x / .18) * .6 * g; }, DRUMS, pan, .35);
  nz({ t, dur: .03, d: .01, g: .2 * g, mode: "bp", fc: 2500, pan });
}
const crash = (t, g = 1, pan = -.4) => nz({ t, dur: 2.2, d: .6, g: .2 * g, fc: 5500, q: .6, pan, room: .2 });
const china = (t, g = 1) => { nz({ t, dur: 1.2, d: .3, g: .22 * g, mode: "bp", fc: 4200, q: .25, pan: .45, room: .2 }); nz({ t, dur: 1.2, d: .25, g: .12 * g, fc: 8000, pan: .45 }); };
function ride(t, g = 1) { // metallic: a few inharmonic squares
  const fr = [3150, 4370, 5210, 6830]; const ph = [0, 0, 0, 0];
  render(t, .5, x => { let v = 0; for (let k = 0; k < 4; k++) { ph[k] += fr[k] / SR; v += (ph[k] % 1 < .5 ? 1 : -1); } return v * .012 * g * Math.exp(-x / .22); }, DRUMS, .35);
}
const hat = (t, g = 1, open = false) => nz({ t, dur: open ? .25 : .05, d: open ? .1 : .015, g: .11 * g, fc: 9000, pan: .3 });
function fill(t0, beats, toms = [180, 140, 110, 82]) {
  const n = beats * 4;
  for (let k = 0; k < n; k++) tom(t0 + k * S16, toms[Math.min(toms.length - 1, Math.floor(k / n * toms.length))], .8 + .3 * k / n, [-.4, -.1, .2, .45][Math.floor(k / n * 4)]);
}
const roll = (t0, len, g0 = .2, g1 = 1) => { const n = Math.round(len / (S16 / 2)); for (let k = 0; k < n; k++) snare(t0 + k * S16 / 2, g0 + (g1 - g0) * k / n); };

// drum grooves (one bar each)
const groove = {
  verse(b) { const t = b * BAR; for (let s = 0; s < 16; s += 2) kick(t + s * S16, s % 4 ? .8 : 1); snare(t + BEAT); snare(t + 3 * BEAT);
    for (let s = 0; s < 16; s += 2) hat(t + s * S16, s % 4 ? .7 : 1); if (b % 2 === 0) crash(t, .8); },
  gallop(b) { const t = b * BAR; for (let q = 0; q < 4; q++) [0, 2, 3].forEach(s => kick(t + q * BEAT + s * S16, s ? .85 : 1));
    snare(t + BEAT); snare(t + 3 * BEAT); for (let q = 0; q < 4; q++) ride(t + q * BEAT); if (b % 2 === 0) crash(t); },
  blast(b) { const t = b * BAR; for (let s = 0; s < 16; s++) kick(t + s * S16, s % 2 ? .8 : 1); snare(t + BEAT); snare(t + 3 * BEAT);
    for (let q = 0; q < 4; q++) crash(t + q * BEAT, .55, q % 2 ? .4 : -.4); if (b % 2 === 0) china(t); },
  half(b, kicks) { const t = b * BAR; kicks.forEach(s => kick(t + s * S16)); snare(t + 2 * BEAT, 1.1); china(t, .8); china(t + 2 * BEAT, .6);
    for (let q = 0; q < 4; q++) hat(t + q * BEAT + S16 * 2, .8); },
};

// ---------- riffs (16 tokens per bar) ----------
const R = {
  main1: "E5 x x x E5 x G5 - x x F5 - x x x x",
  main2: "E5 x x x E5 x Bb5 - x x A5 - G5 - F5 -",
  gal1: "E5 . x x E5 . x x E5 . x x G5 - F5 -",
  gal2: "E5 . x x E5 . x x D5 . x x C5 - D5 -",
  half1: "x . . x . . x . E5 - - - . . x x",
  half2: "x . . x . . x . Bb5 - - - A5 - - -",
  brk1: "x . . x . . x . x . . . x x . .",
  brk2: "x . . x . . Bb5 - - . x . F5 - - -",
  build1: "E5 E5 E5 E5 G5 G5 G5 G5 A5 A5 A5 A5 B5 B5 B5 B5",
  build2: "C5 C5 C5 C5 D5 D5 D5 D5 E5 E5 E5 E5 F5 F5 F5 F5",
};
const open8 = c => Array.from({ length: 16 }, (_, s) => s % 2 ? "-" : c).join(" "); // 8th-note picked open chord
const kicksOf = str => str.trim().split(/\s+/).map((tk, s) => tk !== "-" && tk !== "." ? s : -1).filter(s => s >= 0);

// lead: [bar offset, 8th position, midi, length in 8ths], harmonised a diatonic third above (E natural minor)
const LEAD = [
  [0, 0, 71, 2], [0, 2, 76, 4], [0, 6, 74, 1], [0, 7, 71, 1],
  [1, 0, 72, 5], [1, 5, 71, 1], [1, 6, 67, 2],
  [2, 0, 74, 2], [2, 2, 71, 1], [2, 3, 74, 1], [2, 4, 79, 4],
  [3, 0, 78, 3], [3, 3, 76, 1], [3, 4, 74, 2], [3, 6, 69, 2],
  [4, 0, 71, 1], [4, 1, 72, 1], [4, 2, 74, 1], [4, 3, 76, 1], [4, 4, 76, 4],
];
const SCALE = [4, 6, 7, 9, 11, 0, 2]; // E F# G A B C D
function thirdAbove(m) { const pc = m % 12, k = SCALE.indexOf(pc); if (k < 0) return m + 3; let up = SCALE[(k + 2) % 7] - pc; if (up <= 0) up += 12; return m + up; }
function lead(bar0) {
  for (const [b, p, m, l] of LEAD) {
    const t = (bar0 + b) * BAR + p * BEAT / 2, dur = l * BEAT / 2 * .96, long = l >= 3;
    ks(DI_LEAD, t, mtof(m), dur, { rho: .9995, bright: .7, vel: .9, vib: long ? .012 : 0, bend: l >= 2 && hash(m + b) > .6 ? x => -1 + Math.min(1, x / .06) : null });
    ks(DI_LEAD, t + .006, mtof(thirdAbove(m)), dur, { rho: .9995, bright: .7, vel: .6, vib: long ? .012 : 0 });
  }
}

// ---------- arrangement ----------
const BARS = Math.ceil(DURATION / BAR);
for (let b = 0; b < BARS; b++) {
  const t = b * BAR;
  if (t < 6) {                                    // boot: a low E rings out, toms rumble, then the drums build
    if (b === 0) { chord(DI_L, .3, "E5", 5.4, { rho: .9997, vel: .5 }); chord(DI_R, .31, "E5", 5.4, { rho: .9997, vel: .5, detune: 1.002 }); ks(DI_BASS, .3, mtof(28), 5.4, { rho: .9995, vel: .7 }); }
    if (b === 1) { for (let q = 0; q < 4; q++) tom(t + q * BEAT, 70, .6 + q * .1); crash(t, .4); }
    if (b === 2) { fill(t, 2, [180, 150, 120, 95]); roll(t + 2 * BEAT, 2 * BEAT, .3, 1.1); }
    continue;
  }
  if (t < 9.5) {                                  // problem: the main riff, NO DRIVER stamps ride on it
    riff(b, t === 8 ? "E5 x x x E5 x G5 - x x F5 - E5 - - -" : R.main1); groove.verse(b); // last beat rings into the stop
    if (t === 6) crash(t, 1.2);
    continue;
  }
  if (t < 12) {                                   // "Boot Camp Assistant?" ... stop time, a squeal, then a fill
    if (t === 10) {
      // 10.2 strike: pinch harmonic dives down
      ks(DI_LEAD, 10.2, mtof(88), .5, { rho: .9997, bright: .9, vel: .9, bend: x => -12 * Math.min(1, x / .5) });
      chord(DI_L, 10, "E5", .9); chord(DI_R, 10.004, "E5", .9, { detune: 1.0017 }); kick(10); crash(10, 1);
      fill(11, 2);
    }
    continue;
  }
  if (t < 16) { riff(b, b % 2 ? R.gal2 : R.gal1); groove.gallop(b); if (t === 12) { crash(t, 1.3); china(t); } continue; } // brand
  if (t < 32) {                                   // demo verse
    riff(b, b % 2 ? R.main2 : R.main1); groove.verse(b);
    if (t === 30) fill(t + 3 * BEAT, 1);
    continue;
  }
  if (t < 38) {                                   // half-time pre-chorus
    const str = b % 2 ? R.half2 : R.half1; riff(b, str); groove.half(b, kicksOf(str));
    if (t === 36) fill(t + 3 * BEAT, 1);
    continue;
  }
  if (t < 48) {                                   // chorus: open chords, double kick, harmonised lead
    riff(b, open8(["E5", "C5", "G5", "D5", "E5"][(t - 38) / 2])); groove.blast(b);
    if (t === 38) lead(b);
    continue;
  }
  if (t < 52) {                                   // coverage counters: the climb
    riff(b, t === 48 ? R.build1 : R.build2); groove.blast(b);
    if (t === 50) { roll(t + 2 * BEAT, 2 * BEAT - S16, .4, 1.2); }
    continue;
  }
  if (t < 56) {                                   // languages: breakdown
    const str = b % 2 ? R.brk2 : R.brk1; riff(b, str); groove.half(b, kicksOf(str));
    if (t === 54) fill(t + 3 * BEAT, 1);
    continue;
  }
  if (t < 58) {                                   // Type. Download. Install. -- three hits, then a fill
    ["E5", "G5", "Bb5"].forEach((c, k) => {
      const tt = t + k * BEAT;
      chord(DI_L, tt, c, BEAT * .9); chord(DI_R, tt + .004, c, BEAT * .9, { detune: 1.0017 });
      ks(DI_BASS, tt, mtof(POWER[c] - 12), BEAT * .9, { rho: .997 }); kick(tt, 1.1); crash(tt, .9, k % 2 ? .4 : -.4);
      if (k === 2) china(tt, 1);
    });
    fill(t + 3 * BEAT, 1, [150, 110, 82]);
    continue;
  }
  // final: one huge E5, a cymbal-and-tom wash, and a last hit right before the CRT dies
  if (t === 58) {
    chord(DI_L, 58, "E5", 3.1, { rho: .9998 }); chord(DI_R, 58.004, "E5", 3.1, { rho: .9998, detune: 1.0017 });
    ks(DI_BASS, 58, mtof(28), 3.1, { rho: .9996 }); kick(58, 1.2); crash(58, 1.4); china(58, 1.1);
    for (let k = 0; k < 20; k++) tom(59 + k * S16 / 1.2, [190, 150, 120, 90][k % 4], .5 + k * .03, [-.4, -.1, .2, .45][k % 4]);
    for (let k = 0; k < 6; k++) crash(59.2 + k * .25, .5, k % 2 ? .5 : -.5);
    // a rising lick over the ring, ending on a screaming E with wide vibrato
    [64, 67, 69, 71, 74, 76].forEach((m, k) => ks(DI_LEAD, 58.5 + k * S16, mtof(m), S16 * .95, { rho: .9995, bright: .7, vel: .85 }));
    ks(DI_LEAD, 58.5 + 6 * S16, mtof(79), 2.2, { rho: .9998, bright: .75, vel: .95, vib: .02, bend: x => -2 + Math.min(2, x / .08 * 2) });
    ks(DI_LEAD, 58.5 + 6 * S16 + .006, mtof(83), 2.2, { rho: .9998, bright: .75, vel: .6, vib: .02, bend: x => -2 + Math.min(2, x / .08 * 2) });
  }
}

// ---------- sfx on the video cues ----------
function tone(t, f, len, g, wave = "sq", extra = {}) {
  let p = 0;
  render(t, len + .02, x => { p += f / SR; const s = wave === "sq" ? (p % 1 < .5 ? 1 : -1) : Math.sin(2 * Math.PI * p);
    return s * Math.min(1, x / .002) * Math.exp(-x / (len * .6)) * g; }, SFX, extra.pan || 0);
}
const PENTA = [64, 67, 69, 71, 74, 76, 79];
for (const e of EVENTS) {
  const t = e.t, r = e.n ?? .5;
  switch (e.type) {
    case "key": nz({ t, dur: .03, d: .006, g: .3, mode: "bp", fc: 3400 + r * 1600, q: .6, to: SFX, pan: (r - .5) * .3 }); tone(t, 180 + r * 40, .03, .2, "sine"); break;
    case "blip": if (!(e.i % 2)) tone(t, mtof(PENTA[(r * PENTA.length) | 0] + 12), .05, .1); break;
    case "boot": tone(t, [1046, 1318, 1568, 2093][e.i % 4], .08, .09); break;
    case "robot": tone(t, 440, .2, .1); tone(t + .08, 880, .2, .08); break;
    case "line": tone(t, 880, .03, .06); break;
    case "err": tone(t, 98, .14, .16); tone(t, 104, .14, .1); break;
    case "strike": case "stamp": case "hit": break; // the band plays these
    case "whoosh": nz({ t: t - .25, dur: .3, d: .3, g: .12, mode: "bp", fc: 2500, q: .3, to: SFX }); break;
    case "crt_on": tone(t, 1200, .3, .1, "sine"); nz({ t, dur: .4, d: .14, g: .15, fc: 2000, to: SFX }); break;
    case "crt_off": nz({ t, dur: .5, d: .14, g: .14, mode: "lp", fc: 3000, to: SFX }); break;
    case "ok": [[76, 0], [81, .07], [88, .14]].forEach(([m, o]) => tone(t + o, mtof(m), .09, .13)); break;
    case "warn": [[81, 0], [76, .1]].forEach(([m, o]) => tone(t + o, mtof(m), .09, .13)); break;
    case "click": nz({ t, dur: .012, d: .003, g: .4, mode: "bp", fc: 2500, q: .5, to: SFX }); nz({ t: t + .065, dur: .01, d: .003, g: .25, mode: "bp", fc: 3200, q: .5, to: SFX }); break;
    case "dl_done": [84, 88, 91, 96].forEach((m, k) => tone(t + k * .055, mtof(m), .08, .09)); break;
    case "copy": tone(t, 1318, .05, .09); tone(t + .06, 1760, .06, .09); break;
    case "tick": tone(t, 2600 + e.i * 40, .02, .06); break;
    case "cap": tone(t, 523, .05, .07); break;
  }
}

// ---------- mix ----------
console.log("amping guitars...");
const GL = amp(DI_L, { gain: 70 }), GR = amp(DI_R, { gain: 70 });
const BASS = amp(DI_BASS, { gain: 6, tight: 40, lp: 2200, scoop: 0, presence: .2, gate: .003 });
const LEADG = amp(DI_LEAD, { gain: 90, tight: 300, lp: 5500, scoop: .2, presence: .45, gate: .0015 });
// gain staging: bring every stem to a target loudness (RMS over the parts where it plays) before summing
function rmsActive(x) { let s = 0, n = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-3) { s += x[i] * x[i]; n++; } return Math.sqrt(s / Math.max(1, n)); }
function stage(x, target, name) { const r = rmsActive(x), g = target / r; for (let i = 0; i < x.length; i++) x[i] *= g; console.log(`  ${name.padEnd(6)} rms ${r.toFixed(3)} -> ${target}`); }
stage(GL, .1, "gtr L"); stage(GR, .1, "gtr R"); stage(BASS, .08, "bass"); stage(LEADG, .075, "lead");
// intro: the ringing chord swells in under the boot screen instead of slamming in
for (let i = 0; i < Math.round(6 * SR); i++) {
  const t = i / SR, g = .5 * Math.min(1, Math.max(0, (t - .3) / 1.6)) * (t > 5.6 ? Math.max(0, 1 - (t - 5.6) / .4) : 1);
  GL[i] *= g; GR[i] *= g; BASS[i] *= g;
}
const drumMono = new Float32Array(N); for (let i = 0; i < N; i++) drumMono[i] = (DRUMS[0][i] + DRUMS[1][i]) / 2;
const dg = .085 / rmsActive(drumMono); console.log(`  drums  rms ${rmsActive(drumMono).toFixed(3)} -> .085`);
const MIX = stereo();
const ld = Math.round(BEAT * .75 * SR);
for (let i = 0; i < N; i++) {
  MIX[0][i] += GL[i] + GR[i] * .15; MIX[1][i] += GR[i] + GL[i] * .15;
  MIX[0][i] += BASS[i]; MIX[1][i] += BASS[i];
  // lead: centred dry, with a dotted-8th echo left and a longer one right
  MIX[0][i] += LEADG[i] + (i >= ld ? LEADG[i - ld] * .28 : 0);
  MIX[1][i] += LEADG[i] + (i >= 2 * ld ? LEADG[i - 2 * ld] * .2 : 0);
  ROOM[0][i] += LEADG[i] * .08; ROOM[1][i] += LEADG[i] * .08;
}
(function room() { // short, dense drum room
  const combs = [1116, 1188, 1277, 1356], aps = [225, 341];
  for (const ch of [0, 1]) {
    const x = ROOM[ch], out = new Float32Array(N), sp = ch ? 23 : 0;
    for (const c of combs) { const d = Math.round((c + sp) * SR / 44100), b = new Float32Array(d); let k = 0, lp = 0;
      for (let i = 0; i < N; i++) { const y = b[k]; lp += .4 * (y - lp); b[k] = x[i] + lp * .72; out[i] += y; k = (k + 1) % d; } }
    for (const a of aps) { const d = Math.round((a + sp) * SR / 44100), b = new Float32Array(d); let k = 0;
      for (let i = 0; i < N; i++) { const bb = b[k], y = -out[i] + bb; b[k] = out[i] + bb * .5; out[i] = y; k = (k + 1) % d; } }
    for (let i = 0; i < N; i++) DRUMS[ch][i] += out[i] * .12;
  }
})();
for (const ch of [0, 1]) for (let i = 0; i < N; i++) MIX[ch][i] += DRUMS[ch][i] * dg;

// the CRT dies: tape stop on the band
const stopAt = EVENTS.find(e => e.type === "crt_off").t, stopLen = .55;
for (const ch of [0, 1]) {
  const src = MIX[ch].slice(), i0 = Math.round(stopAt * SR); let pos = i0;
  for (let i = i0; i < N; i++) {
    const x = (i - i0) / SR, rate = Math.max(0, 1 - x / stopLen);
    pos += rate * rate; const k = Math.floor(pos), f = pos - k;
    MIX[ch][i] = rate === 0 ? 0 : ((src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f) * Math.min(1, rate * 2.5);
  }
}
const sfxEnv = new Float32Array(N);
for (let i = 0, e = 0; i < N; i++) { const x = Math.max(Math.abs(SFX[0][i]), Math.abs(SFX[1][i])); e = x > e ? e + (x - e) * .02 : e * Math.exp(-1 / (.1 * SR)); sfxEnv[i] = e; }
const OUT = stereo(); let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / .1) * (t > DURATION - .12 ? Math.max(0, (DURATION - t) / .12) : 1);
  const dip = 1 - .3 * Math.min(1, sfxEnv[i] * 4);
  for (const ch of [0, 1]) {
    const v = (MIX[ch][i] * dip + SFX[ch][i] * .9) * fade;
    OUT[ch][i] = Math.tanh(v * 1.6) / 1.6;
    peak = Math.max(peak, Math.abs(OUT[ch][i]));
  }
}
const norm = .72 / peak; // headroom for AAC inter-sample peaks
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, OUT[0][i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, OUT[1][i] * norm)) * 32767), 46 + i * 4);
}
fs.writeFileSync(path.join(__dirname, "soundtrack-metal.wav"), buf);
console.log(`wrote soundtrack-metal.wav (${DURATION}s at 120 bpm, peak ${peak.toFixed(2)})`);
