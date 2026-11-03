// Soundtrack for the MDfW showcase: a 120 bpm chiptune bed in A minor plus SFX on the cues in events.json.
//   node synth-chiptune.js  -> soundtrack-chiptune.wav (48 kHz, 16-bit stereo)
const fs = require("fs");
const path = require("path");
const { DURATION, EVENTS } = JSON.parse(fs.readFileSync(path.join(__dirname, "events.json"), "utf8"));

const SR = 48000, N = Math.ceil(DURATION * SR);
const BEAT = 0.5, BAR = 2, S16 = BEAT / 4;
const bus = () => [new Float32Array(N), new Float32Array(N)];
const MUSIC = bus(), SFX = bus(), VERB = bus(), ECHO = bus();
const duck = new Float32Array(N); // kick sidechain envelope

let seed = 7;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const n = s => { const m = s.match(/^([A-G])(#?)(-?\d)$/); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] ? 1 : 0); };

// polyBLEP band-limited oscillators
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
function osc(wave, ph, dt, duty) {
  switch (wave) {
    case "sine": return Math.sin(2 * Math.PI * ph);
    case "tri": return 1 - 4 * Math.abs(ph - .5);
    case "saw": return 2 * ph - 1 - blep(ph, dt);
    default: { // pulse
      let v = ph < duty ? 1 : -1;
      v += blep(ph, dt); v -= blep((ph + 1 - duty) % 1, dt);
      return v;
    }
  }
}

function mixTo(target, i, v, pan) {
  const a = (pan + 1) * Math.PI / 4;
  target[0][i] += v * Math.cos(a); target[1][i] += v * Math.sin(a);
}

// one tonal note; f may glide to f1; a = attack, d = decay time-constant, sus = sustain level
function tone({ t, dur, f, f1 = f, wave = "pulse", duty = .5, a = .002, d = 1e9, sus = 1, rel = .03, gain = .2, pan = 0,
  lp = 0, to = MUSIC, verb = 0, echo = 0, ducked = false, vib = 0, detune = 0 }) {
  const i0 = Math.max(0, Math.round(t * SR)), len = Math.round((dur + rel) * SR);
  let ph = wave === "sine" ? 0 : (noise() + 1) / 2, y1 = 0, y2 = 0; // seeded, so every run is identical
  const k = lp ? 1 - Math.exp(-2 * Math.PI * lp / SR) : 1;
  for (let j = 0; j < len && i0 + j < N; j++) {
    const x = j / SR, p = Math.min(1, x / dur);
    const f_ = f * Math.pow(f1 / f, p) * (1 + vib * Math.sin(2 * Math.PI * 5.5 * x)) * Math.pow(2, detune / 1200);
    const dt = f_ / SR;
    ph += dt; if (ph >= 1) ph -= 1;
    let v = osc(wave, ph, dt, duty);
    if (lp) { y1 += k * (v - y1); y2 += k * (y1 - y2); v = y2; }
    let e = x < a ? x / a : sus + (1 - sus) * Math.exp(-(x - a) / d);
    if (x > dur) e *= Math.max(0, 1 - (x - dur) / rel);
    let g = v * e * gain;
    if (ducked) g *= 1 - .55 * duck[i0 + j];
    mixTo(to, i0 + j, g, pan);
    if (verb) mixTo(VERB, i0 + j, g * verb, pan);
    if (echo) mixTo(ECHO, i0 + j, g * echo, pan);
  }
}

// filtered noise burst; mode lp | hp | bp, cutoff may sweep fc -> fc1
function hiss({ t, dur, a = .001, d = .05, gain = .2, pan = 0, mode = "hp", fc = 6000, fc1 = fc, q = .7, to = MUSIC, verb = 0, shape = null }) {
  const i0 = Math.max(0, Math.round(t * SR)), len = Math.round(dur * SR);
  let low = 0, band = 0;
  for (let j = 0; j < len && i0 + j < N; j++) {
    const x = j / SR, p = x / dur;
    const c = fc * Math.pow(fc1 / fc, p);
    const F = 2 * Math.sin(Math.PI * Math.min(c, SR / 6) / SR);
    const inp = noise();
    low += F * band; const high = inp - low - q * band; band += F * high;
    let v = mode === "lp" ? low : mode === "bp" ? band : high;
    let e = shape ? shape(p) : (x < a ? x / a : Math.exp(-(x - a) / d));
    e *= Math.min(1, (dur - x) / .005);
    mixTo(to, i0 + j, v * e * gain, pan);
    if (verb) mixTo(VERB, i0 + j, v * e * gain * verb, pan);
  }
}

// ---------- drums ----------
function kick(t, gain = .9, to = MUSIC) {
  tone({ t, dur: .32, f: 150, f1: 42, wave: "sine", a: .001, d: .12, sus: 0, rel: .02, gain, to });
  hiss({ t, dur: .012, d: .004, gain: .18 * gain, mode: "lp", fc: 3000, to });
  const i0 = Math.round(t * SR);
  for (let j = 0; j < .3 * SR && i0 + j < N; j++) duck[i0 + j] = Math.max(duck[i0 + j], Math.exp(-j / SR / .09));
}
function snare(t, gain = .38) {
  hiss({ t, dur: .22, d: .06, gain, mode: "bp", fc: 1900, q: .5, verb: .35 });
  tone({ t, dur: .08, f: 220, f1: 160, wave: "tri", d: .03, sus: 0, gain: gain * .6 });
}
function hat(t, open = false, gain = .1, pan = .25) {
  hiss({ t, dur: open ? .16 : .045, d: open ? .07 : .014, gain, mode: "hp", fc: 7500, pan });
}
function crash(t, gain = .22) { hiss({ t, dur: 2.2, d: .55, gain, mode: "hp", fc: 4800, verb: .5 }); }

// ---------- harmony ----------
// A minor: Am F C G, one chord per bar
const PROG = [["A2", ["A3", "C4", "E4"]], ["F2", ["F3", "A3", "C4"]], ["C3", ["G3", "C4", "E4"]], ["G2", ["G3", "B3", "D4"]]];
const chordAt = bar => PROG[((bar % 4) + 4) % 4];

function pad(bar, gain = .05, lp = 1400) {
  const [, notes] = chordAt(bar);
  for (const nt of notes) for (const [det, pan] of [[-7, -.6], [6, .6], [0, 0]])
    tone({ t: bar * BAR, dur: BAR - .05, f: mtof(n(nt)), wave: "saw", a: .25, sus: 1, rel: .35, gain, pan, lp, verb: .5, ducked: true, detune: det });
}
function bass(bar, gain = .17, pattern = "8") {
  const [root] = chordAt(bar), f = mtof(n(root));
  const hits = pattern === "8" ? [0, 1, 2, 3, 4, 5, 6, 7].map(k => k * BEAT / 2) : [0, BEAT * 2];
  hits.forEach((o, k) => {
    const oct = pattern === "8" && k % 4 === 3 ? 2 : 1;
    tone({ t: bar * BAR + o, dur: pattern === "8" ? .2 : .9, f: f * oct, wave: "pulse", duty: .25, d: .12, sus: .35, rel: .04, gain, lp: 900, ducked: true });
    tone({ t: bar * BAR + o, dur: pattern === "8" ? .2 : .9, f: f / 2 * oct, wave: "sine", d: .2, sus: .5, rel: .04, gain: gain * .9, ducked: true });
  });
}
function arp(bar, gain = .05, lp = 3200) {
  const [, notes] = chordAt(bar);
  const seq = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 3, 2];
  const tones = [...notes.map(x => n(x) + 12), n(notes[0]) + 24];
  seq.forEach((s, k) => tone({ t: bar * BAR + k * S16, dur: .08, f: mtof(tones[s]), wave: "pulse", duty: k % 2 ? .25 : .5, d: .05, sus: .1, rel: .03,
    gain: gain * (k % 4 === 0 ? 1 : .7), pan: k % 2 ? .35 : -.35, lp, echo: .45 }));
}
// lead motif in A minor pentatonic, one phrase per two bars
const MOTIF = [["E5", 0, 1.5], ["D5", 1.5, .5], ["C5", 2, 1], ["A4", 3, 1], ["C5", 4, .5], ["D5", 4.5, .5], ["E5", 5, 1.5], ["G5", 6.5, .5], ["A5", 7, 1]];
const MOTIF2 = [["A5", 0, 1], ["G5", 1, .5], ["E5", 1.5, 1.5], ["D5", 3, 1], ["E5", 4, .5], ["G5", 4.5, .5], ["E5", 5, 1], ["D5", 6, 1], ["C5", 7, 1]];
function lead(bar, which, gain = .045) {
  (which ? MOTIF2 : MOTIF).forEach(([nt, b, l]) =>
    tone({ t: bar * BAR + b * BEAT / 2, dur: l * BEAT / 2 * .92, f: mtof(n(nt)), wave: "pulse", duty: .125, a: .01, d: .3, sus: .6, rel: .08,
      gain, vib: .004, lp: 4200, verb: .35, echo: .25 }));
}

// ---------- arrangement (bars of 2 s) ----------
const bars = Math.ceil(DURATION / BAR);
for (let b = 0; b < bars; b++) {
  const t = b * BAR;
  if (t < 6) { pad(b, .035, 900); if (b >= 1) arp(b, .022, 1600); continue; }           // boot
  if (t < 12) {                                                                          // problem
    pad(b, .04, 1100); arp(b, .03, 2000); bass(b, .13, "half");
    for (let k = 0; k < 8; k++) hat(t + k * BEAT / 2 + BEAT / 4, false, .05);
    if (t >= 10) { kick(t, .7); kick(t + BEAT * 2, .7); for (let k = 0; k < 8; k++) snare(t + BEAT * 2 + k * S16, .05 + k * .025); }
    continue;
  }
  if (t < 16) {                                                                          // brand
    pad(b, .05, 1800); arp(b, .045, 2800); bass(b, .14, "half");
    kick(t); kick(t + BEAT * 2); hat(t + BEAT, true, .07); hat(t + BEAT * 3, true, .07);
    continue;
  }
  if (t < 52) {                                                                          // demo: full groove
    const lift = t >= 38 ? 1 : 0;
    pad(b, .042, 1600 + lift * 600); arp(b, .045, 3000 + lift * 800); bass(b, .16);
    for (let k = 0; k < 4; k++) kick(t + k * BEAT, .85);
    snare(t + BEAT); snare(t + BEAT * 3);
    for (let k = 0; k < 8; k++) hat(t + k * BEAT / 2 + BEAT / 4, k % 2 === 1, k % 2 ? .07 : .09, k % 2 ? .3 : -.3);
    if (lift) for (let k = 0; k < 16; k += 2) hat(t + k * S16, false, .035, 0);
    if (t >= 24 && t < 32 || t >= 40 && t < 48) lead(b, ((t - 24) / 4 | 0) % 2, t >= 40 ? .05 : .04);
    if (t === 50) for (let k = 0; k < 8; k++) snare(t + BEAT * 2 + k * S16, .06 + k * .03);
    continue;
  }
  if (t < 56) { pad(b, .05, 1300); arp(b, .04, 2400); for (let k = 0; k < 4; k++) hat(t + k * BEAT + BEAT / 2, false, .05); continue; } // languages
  if (t < 58) { pad(b, .05, 2000); bass(b, .15, "half"); continue; }                    // type / download / install
  if (t < 62) {                                                                          // logo: final A minor chord rings out
    if (t === 58) {
      for (const nt of ["A2", "A3", "C4", "E4", "A4", "E5"]) for (const det of [-6, 6])
        tone({ t, dur: 3.1, f: mtof(n(nt)), wave: "saw", a: .02, d: 1.6, sus: .15, rel: .5, gain: .03, pan: det / 10, lp: 2200, verb: .6, detune: det });
      bass(b, .14, "half");
      [0, 1, 2, 3, 4, 5, 6, 7].forEach(k => tone({ t: t + k * S16 * 2, dur: .1, f: mtof(n(["A5", "E5", "C5", "A4", "E5", "C5", "A4", "E4"][k])), wave: "pulse", duty: .25, d: .06, sus: .1, gain: .03 * (1 - k / 10), pan: k % 2 ? .4 : -.4, echo: .5 }));
    }
  }
}

// ---------- sfx on cues ----------
const PENTA = [69, 72, 74, 76, 79, 81, 84];
for (const e of EVENTS) {
  const t = e.t, r = e.n ?? .5;
  switch (e.type) {
    case "key": // mechanical key: thock + click
      tone({ t, dur: .03, f: 190 + r * 60, f1: 120, wave: "sine", d: .012, sus: 0, gain: .2, to: SFX, pan: (r - .5) * .3 });
      hiss({ t, dur: .03, d: .006, gain: .16, mode: "bp", fc: 3200 + r * 1800, q: .6, to: SFX, pan: (r - .5) * .3 });
      break;
    case "blip": // robot voice
      if (e.i % 2) break;
      tone({ t, dur: .045, f: mtof(PENTA[(r * PENTA.length) | 0]), wave: "pulse", duty: .25, d: .03, sus: .3, rel: .01, gain: .07, to: SFX });
      break;
    case "boot":
      tone({ t, dur: .07, f: [1046, 1318, 1568, 2093][e.i % 4], wave: "pulse", duty: .5, d: .05, sus: .4, rel: .01, gain: .06, to: SFX });
      break;
    case "robot":
      tone({ t, dur: .3, f: 180, f1: 900, wave: "pulse", duty: .25, d: .2, sus: .6, rel: .04, gain: .07, to: SFX, verb: .3 });
      break;
    case "line": tone({ t, dur: .03, f: 880, wave: "pulse", d: .015, sus: 0, gain: .04, to: SFX }); break;
    case "err":
      tone({ t, dur: .14, f: 98, wave: "pulse", duty: .5, d: .2, sus: .8, rel: .02, gain: .1, to: SFX, lp: 1800 });
      tone({ t, dur: .14, f: 104, wave: "pulse", duty: .3, d: .2, sus: .8, rel: .02, gain: .07, to: SFX, lp: 1800 });
      break;
    case "strike": hiss({ t, dur: .32, gain: .22, mode: "bp", fc: 600, fc1: 6000, q: .3, to: SFX, shape: p => Math.sin(Math.PI * p) }); break;
    case "stamp":
      kick(t, e.big ? 1 : .8, SFX);
      tone({ t, dur: .09, f: e.big ? 440 : 220, wave: "pulse", duty: .5, d: .06, sus: .2, gain: .05, to: SFX, lp: 2500 });
      if (e.big) crash(t, .16);
      break;
    case "hit": kick(t, 1, SFX); crash(t, .2); tone({ t, dur: 1.2, f: 55, wave: "sine", d: .5, sus: 0, gain: .25, to: SFX }); break;
    case "whoosh": hiss({ t: t - .28, dur: .4, gain: .16, mode: "bp", fc: 400, fc1: 5000, q: .4, to: SFX, verb: .2, shape: p => Math.pow(p, 2) * (1 - Math.pow(p, 8)) }); break;
    case "crt_on":
      tone({ t, dur: .35, f: 60, f1: 2400, wave: "sine", a: .005, d: .3, sus: .3, gain: .12, to: SFX });
      hiss({ t, dur: .45, d: .15, gain: .12, mode: "hp", fc: 2000, to: SFX });
      tone({ t: t + .42, dur: 1.4, f: 15700, wave: "sine", a: .02, d: .3, sus: 0, gain: .008, to: SFX });
      break;
    case "crt_off":
      tone({ t, dur: .45, f: 1800, f1: 40, wave: "sine", a: .002, d: .35, sus: .2, gain: .16, to: SFX });
      hiss({ t, dur: .5, d: .12, gain: .1, mode: "lp", fc: 3000, fc1: 300, to: SFX });
      break;
    case "ok":
      [[n("E6"), 0], [n("A6"), .075], [n("E7"), .15]].forEach(([m, o]) =>
        tone({ t: t + o, dur: .09, f: mtof(m), wave: "pulse", duty: .25, d: .08, sus: .3, rel: .05, gain: .07, to: SFX, verb: .4, echo: .3 }));
      break;
    case "warn":
      [[n("A5"), 0], [n("E5"), .1]].forEach(([m, o]) =>
        tone({ t: t + o, dur: .09, f: mtof(m), wave: "tri", d: .1, sus: .5, rel: .03, gain: .14, to: SFX, verb: .2 }));
      break;
    case "click":
      hiss({ t, dur: .012, d: .003, gain: .25, mode: "bp", fc: 2500, q: .5, to: SFX });
      hiss({ t: t + .07, dur: .01, d: .003, gain: .15, mode: "bp", fc: 3200, q: .5, to: SFX });
      break;
    case "dl_start": tone({ t, dur: .25, f: 330, f1: 660, wave: "pulse", duty: .25, d: .2, sus: .3, gain: .045, to: SFX }); break;
    case "dl_done":
      [[n("C6"), 0], [n("E6"), .06], [n("G6"), .12], [n("C7"), .18]].forEach(([m, o]) =>
        tone({ t: t + o, dur: .08, f: mtof(m), wave: "pulse", duty: .5, d: .07, sus: .3, gain: .05, to: SFX, echo: .35 }));
      break;
    case "copy":
      tone({ t, dur: .05, f: 1318, wave: "pulse", duty: .25, d: .04, sus: .3, gain: .05, to: SFX });
      tone({ t: t + .06, dur: .06, f: 1760, wave: "pulse", duty: .25, d: .05, sus: .3, gain: .05, to: SFX });
      break;
    case "tick": tone({ t, dur: .018, f: 2600 + e.i * 40, wave: "pulse", d: .01, sus: 0, gain: .04, to: SFX }); break;
    case "cap": tone({ t, dur: .05, f: 523, f1: 784, wave: "tri", d: .05, sus: .2, gain: .05, to: SFX }); break;
  }
}

// ---------- effects: ping-pong echo, small Schroeder reverb ----------
(function echoFx() {
  const dl = Math.round(BEAT * .75 * SR), fb = .38;
  const [eL, eR] = ECHO, [mL, mR] = MUSIC;
  const bL = new Float32Array(N), bR = new Float32Array(N);
  let lpL = 0, lpR = 0;
  for (let i = 0; i < N; i++) {
    const inL = i >= dl ? bR[i - dl] : 0, inR = i >= dl ? bL[i - dl] : 0;
    lpL += .35 * (inL - lpL); lpR += .35 * (inR - lpR);
    bL[i] = eL[i] + eR[i] * .5 + lpL * fb; bR[i] = lpR * fb;
    mL[i] += lpL * .7; mR[i] += lpR * .7;
  }
})();
(function reverb() {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356], aps = [225, 556, 441];
  for (const ch of [0, 1]) {
    const x = VERB[ch], out = new Float32Array(N), spread = ch ? 23 : 0;
    for (const c of combs) {
      const d = Math.round((c + spread) * SR / 44100), buf = new Float32Array(d); let k = 0, lp = 0;
      for (let i = 0; i < N; i++) { const y = buf[k]; lp += .4 * (y - lp); buf[k] = x[i] + lp * .82; out[i] += y; k = (k + 1) % d; }
    }
    for (const a of aps) {
      const d = Math.round((a + spread) * SR / 44100), buf = new Float32Array(d); let k = 0;
      for (let i = 0; i < N; i++) { const b = buf[k], y = -out[i] + b; buf[k] = out[i] + b * .5; out[i] = y; k = (k + 1) % d; }
    }
    for (let i = 0; i < N; i++) MUSIC[ch][i] += out[i] * .07;
  }
})();

// ---------- master ----------
const L = new Float32Array(N), R = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let fade = 1;
  if (t < .2) fade = t / .2;
  if (t > 61.3) fade = Math.max(0, 1 - (t - 61.3) / .55);
  for (const [o, ch] of [[L, 0], [R, 1]]) {
    const v = (MUSIC[ch][i] * .85 + SFX[ch][i]) * fade;
    o[i] = Math.tanh(v * 1.15) / 1.15;
    peak = Math.max(peak, Math.abs(o[i]));
  }
}
const norm = .78 / peak; // headroom for AAC inter-sample peaks
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), 46 + i * 4);
}
fs.writeFileSync(path.join(__dirname, "soundtrack-chiptune.wav"), buf);
console.log(`wrote soundtrack-chiptune.wav (${DURATION}s, peak ${peak.toFixed(2)} -> normalised)`);
