// The background tune: a soft four-bar loop (C · Am · F · G at 100 bpm) scheduled a little
// ahead on the Web Audio clock, in the manner of the chiptune engine in kafoosh/play.
//
// It is also the cover for the data link, so it is built around it:
//   • a 32nd note is exactly one data symbol, so a frame's chimes land on the beat;
//   • every voice stays at or below A4 and the whole bed is low-passed, leaving the chime
//     notes (C6 and up) and the ultrasonic band clear;
//   • the chimes are in the tune's own pentatonic scale, so they sound like part of it.
// Two phones lock their loops together from the end of a spoken frame (see sync()).

import { SYMBOL_SECONDS } from './codec.js';

export const STEP = SYMBOL_SECONDS;          // one 32nd note
export const LOOP = 128;                     // 32nds in the four-bar loop

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hz = (name) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  return 440 * 2 ** ((12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] ? 1 : 0) - 69) / 12);
};

// Per bar: bass note, and the chord tones the middle voice rocks through in 8th notes.
const BARS = [
  { bass: 'C3', arp: ['C4', 'E4', 'G4', 'E4'], top: ['E4', 'G4'] },
  { bass: 'A2', arp: ['A3', 'C4', 'E4', 'C4'], top: ['E4', 'C4'] },
  { bass: 'F3', arp: ['A3', 'C4', 'F4', 'C4'], top: ['F4', 'A4'] },
  { bass: 'G3', arp: ['G3', 'B3', 'D4', 'B3'], top: ['G4', 'D4'] },
];

/// Everything that sounds at 32nd-step `s` of the loop: [{ f, len (steps), vol, type }].
export function eventsAt(s) {
  const bar = BARS[Math.floor(s / 32) % 4], i = s % 32, out = [];
  if (i === 0 || i === 20) out.push({ f: hz(bar.bass), len: i === 0 ? 18 : 10, vol: 0.5, type: 'triangle' });
  if (i % 4 === 0) out.push({ f: hz(bar.arp[(i / 4) % 4]), len: 5, vol: 0.34, type: 'sine' });
  if (i === 0 || i === 16) out.push({ f: hz(bar.top[i / 16]), len: 14, vol: 0.22, type: 'triangle' });
  return out;
}

export class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    // Two cascaded low-passes: the bed must not leak into the data bands.
    const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
    for (const f of [a, b]) { f.type = 'lowpass'; f.frequency.value = 750; f.Q.value = 0.6; }
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(a); a.connect(b); b.connect(dest);
    this.playing = false;
    this.origin = 0;          // context time of loop step 0
    this.next = 0;            // next absolute step to schedule
  }

  /// Start (or re-lock) the loop so that loop position `pos` (in 32nds) falls at `ctxTime`.
  sync(ctxTime, pos = 0) {
    const t = this.ctx.currentTime;
    this.origin = ctxTime - pos * STEP;
    this.next = Math.ceil((t + 0.05 - this.origin) / STEP);
    if (!this.playing) {
      this.playing = true;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(0, t);
      this.gain.gain.linearRampToValueAtTime(0.5, t + 1.2);
    }
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  /// Loop position (32nds, 0…127) at a context time.
  positionAt(ctxTime) {
    return ((Math.round((ctxTime - this.origin) / STEP) % LOOP) + LOOP) % LOOP;
  }

  /// The first 16th-note boundary at or after `ctxTime` (or `ctxTime` itself when silent).
  nextBeat(ctxTime) {
    if (!this.playing) return ctxTime;
    return this.origin + Math.ceil((ctxTime - this.origin) / (2 * STEP) - 1e-6) * 2 * STEP;
  }

  /// Phase within the current quarter note, 0…1 (for the figures' little bob), or -1.
  beatPhase(ctxTime) {
    if (!this.playing) return -1;
    const q = (ctxTime - this.origin) / (8 * STEP);
    return q - Math.floor(q);
  }

  /// Called every ~30 ms: schedule whatever starts in the next 150 ms.
  tick() {
    if (!this.playing) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.origin + this.next * STEP < now - 0.1) this.next = Math.ceil((now + 0.05 - this.origin) / STEP);
    while (this.origin + this.next * STEP < now + 0.15) {
      const t = this.origin + this.next * STEP;
      for (const e of eventsAt(((this.next % LOOP) + LOOP) % LOOP)) this.tone(e, t);
      this.next += 1;
    }
  }

  tone(e, t) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), dur = e.len * STEP;
    o.type = e.type;
    o.frequency.value = e.f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(e.vol, t + 0.012);
    g.gain.setTargetAtTime(e.vol * 0.5, t + 0.03, 0.18);
    g.gain.setTargetAtTime(0, t + Math.max(0.03, dur - 0.05), 0.03);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur + 0.2);
  }
}
