// The background tune: a soft four-bar loop (C · Am · F · G at 100 bpm) scheduled a little
// ahead on the Web Audio clock, in the manner of the chiptune engine in kafoosh/play.
//
// It exists to make the data link disappear:
//   • Normally the data is ultrasonic only, so NOTHING audible happens when the phones
//     exchange a message. The tune just plays.
//   • The tune has a glockenspiel line, and at the end of every loop a quick sparkling fill
//     in the high register. That fill is the same instrument, register, rhythm and two-note
//     voicing as the audible form of the data, which is only used when a phone turns out not
//     to hear ultrasound. So if data ever has to be audible, it is one more fill.
//   • A 32nd note is exactly one data symbol, the bed stays at or below A4 and is
//     low-passed, and nothing but fills and data ever sounds in the chime notes' range.
// Two phones lock their loops together from the end of a message (see sync()).

import { SYMBOL_SECONDS, CHIME_LOW, CHIME_HIGH, PREAMBLE } from './codec.js';

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

// The glockenspiel line, one bar per row: [note, length in 32nds]. It rests under the fill.
const LEAD = [
  [['E5', 8], ['G5', 8], ['E5', 4], ['D5', 4], ['C5', 8]],
  [['A5', 8], ['G5', 4], ['E5', 4], ['C5', 8], ['E5', 8]],
  [['A5', 8], ['F5', 8], ['C5', 8], ['F5', 8]],
  [['G5', 8], ['D5', 8]],
];
const LEAD_AT = new Map();
LEAD.forEach((bar, b) => { let at = b * 32; for (const [n, len] of bar) { LEAD_AT.set(at, { f: hz(n), len }); at += len; } });

/// The lead note starting at loop step `s`, or null.
export const leadAt = (s) => LEAD_AT.get(s) || null;

export const FILL_START = 112;               // the last half-bar of the loop

/// The fill's two-note chord at loop step `s` of loop number `n` (as a data nibble: low note
/// = bits 3-2, high note = bits 1-0), or -1 outside the fill. Runs up, down or in waves, a
/// little different each time round; never the data preamble.
export function fillAt(s, n) {
  if (s < FILL_START) return -1;
  const i = s - FILL_START, shape = ((n % 4) + 4) % 4;
  const tri = (k) => { const m = ((k % 6) + 6) % 6; return m < 4 ? m : 6 - m; };
  let lo, hi;
  if (shape === 0) { lo = tri(i); hi = tri(i + 1); }
  else if (shape === 1) { lo = 3 - tri(i); hi = tri(i >> 1); }
  else if (shape === 2) { lo = tri(i >> 1); hi = 3 - tri(i + 2); }
  else { lo = tri(i + 3); hi = tri(2 * i); }
  // Thin it out so it breathes: rests on a few off-beats.
  if (i % 8 === 5 || (shape === 2 && i % 4 === 3)) return -1;
  return (lo << 2) | hi;
}
void PREAMBLE;

export class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    // Two cascaded low-passes: the bed must not leak into the data bands.
    const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
    for (const f of [a, b]) { f.type = 'lowpass'; f.frequency.value = 750; f.Q.value = 0.6; }
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(a); a.connect(b); b.connect(dest);
    // The glockenspiel (lead + fills) is NOT low-passed: it lives up where the chimes do.
    this.bells = ctx.createGain();
    this.bells.gain.value = 0;
    this.bells.connect(dest);
    this.lead = true;         // the lead line plays (it steps aside once data must be audible)
    this.busy = null;         // () → true while a message is being played or received
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
      this.bells.gain.cancelScheduledValues(t);
      this.bells.gain.setValueAtTime(0, t);
      this.bells.gain.linearRampToValueAtTime(1, t + 1.2);
    }
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    this.bells.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
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
      const step = ((this.next % LOOP) + LOOP) % LOOP;
      for (const e of eventsAt(step)) this.tone(e, t);
      const lead = this.lead ? leadAt(step) : null;
      if (lead) this.bell(lead.f, t, lead.len * STEP, 0.16);
      // The fill steps aside for a message: both would be in the same notes.
      const fill = fillAt(step, Math.floor(this.next / LOOP));
      if (fill >= 0 && !(this.busy && this.busy())) {
        this.bell(CHIME_LOW[fill >> 2], t, STEP * 0.8, 0.11);
        this.bell(CHIME_HIGH[fill & 3], t, STEP * 0.8, 0.09);
      }
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

  /// One glockenspiel bar: a pure sine with a quick strike and a soft fall.
  bell(f, t, dur, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setTargetAtTime(vol * 0.5, t + 0.006, 0.03);
    g.gain.setTargetAtTime(0, t + Math.max(0.02, dur - 0.012), Math.min(0.08, dur * 0.25));
    o.connect(g); g.connect(this.bells);
    o.start(t); o.stop(t + dur + 0.4);
  }
}
