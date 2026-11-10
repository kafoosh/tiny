// Data-over-sound codec. Pure functions + a streaming demodulator; no Web Audio here, so the
// whole thing runs (and is tested) in Node.
//
// Modulation: 16-tone MFSK, one nibble per 50 ms symbol, in TWO bands at once:
//   • ULTRA — 17.6…19.4 kHz, inaudible to most adults;
//   • VOICE — 2.2…4.3 kHz, shaped to sound like a little creature chirping.
// Every tone sits on a multiple of 40 Hz = 1 / (analysis window), so the tones are orthogonal
// under a plain rectangular Goertzel window.
//
// Frame (in symbols):  PREAMBLE(4)  head  seq  lenHi lenLo  payload(2·len)  crc16(4)
//   head = role << 3 | type. Everything after the preamble is XORed with a fixed scramble
//   sequence so repeated nibbles never produce a monotone.

export const TONES = 16;
export const SYMBOL_SECONDS = 0.05;
export const ULTRA = Array.from({ length: TONES }, (_, i) => 17600 + 120 * i);
export const VOICE = [2200, 2320, 2440, 2560, 2680, 2800, 2920, 3040,
  3200, 3360, 3520, 3680, 3840, 4000, 4160, 4320];
export const PREAMBLE = [0, 15, 5, 10];
export const MAX_PAYLOAD = 12;
const HEADER = 4;                       // head, seq, lenHi, lenLo
const CRC_SYMS = 4;

/// Samples per hop (¼ symbol), per symbol, and per analysis window (½ symbol).
export function geometry(sampleRate) {
  const H = Math.round(sampleRate * SYMBOL_SECONDS / 4);
  return { H, S: H * 4, W: H * 2 };
}

/// Whether this sample rate can carry the ultrasonic band at all.
export const ultraUsable = (sampleRate) => sampleRate >= 44000;

export function crc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc;
}

/// Fixed pseudo-random nibble for symbol position `i` (after the preamble).
export function scramble(i) {
  const x = Math.sin((i + 1) * 91.7) * 15731.743;
  return Math.floor((x - Math.floor(x)) * 16) & 15;
}

/// Frame → symbol list (tone indices 0…15), preamble included.
export function frameSymbols({ type, role, seq = 0, payload = [] }) {
  if (payload.length > MAX_PAYLOAD) throw new Error('payload too long');
  const head = ((role & 1) << 3) | (type & 7);
  const bytes = [(head << 4) | (seq & 15), payload.length, ...payload];
  const crc = crc16(bytes);
  const nibbles = [];
  for (const b of bytes) nibbles.push(b >> 4, b & 15);
  nibbles.push((crc >> 12) & 15, (crc >> 8) & 15, (crc >> 4) & 15, crc & 15);
  return [...PREAMBLE, ...nibbles.map((n, i) => n ^ scramble(i))];
}

export const frameLength = (payloadLength) => PREAMBLE.length + HEADER + 2 * payloadLength + CRC_SYMS;

/// A cover melody: starts with the same four notes every "sentence" does, then babbles.
export function coverSymbols(count, rand = Math.random) {
  const out = PREAMBLE.slice();
  while (out.length < count) out.push(Math.floor(rand() * TONES) & 15);
  return out.slice(0, count);
}

/// Symbols → PCM. `ultra` / `voice` are symbol lists (either may be null). Returns a
/// Float32Array with a short silent lead-in and tail; `lead` samples precede symbol 0.
export function modulate({ ultra = null, voice = null }, sampleRate,
                         { ultraGain = 0.4, voiceGain = 0.22 } = {}) {
  const { S } = geometry(sampleRate);
  const count = Math.max(ultra ? ultra.length : 0, voice ? voice.length : 0);
  const lead = Math.round(sampleRate * 0.02);
  const out = new Float32Array(lead * 2 + count * S);
  const on = Math.round(S * 0.8);
  const ramp = Math.round(sampleRate * 0.004);
  const twoPi = 2 * Math.PI;
  for (let n = 0; n < count; n++) {
    const base = lead + n * S;
    if (ultra && n < ultra.length) {
      const w = twoPi * ULTRA[ultra[n]] / sampleRate;
      for (let i = 0; i < on; i++) {
        const edge = Math.min(i, on - 1 - i);
        const env = edge >= ramp ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge / ramp);
        out[base + i] += ultraGain * env * Math.sin(w * i);
      }
    }
    if (voice && n < voice.length) {
      // A chirpy voice: a quick upward scoop into the note, a plucked envelope and two soft
      // overtones (both above the band, so they never look like another data tone).
      const f = VOICE[voice[n]];
      let ph = 0;
      const scoopTau = sampleRate * 0.006;
      for (let i = 0; i < on; i++) {
        const edge = Math.min(i, on - 1 - i);
        const fade = edge >= ramp ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * edge / ramp);
        const env = fade * (0.72 + 0.28 * Math.exp(-i / (sampleRate * 0.012)));
        ph += twoPi * f * (1 - 0.07 * Math.exp(-i / scoopTau)) / sampleRate;
        out[base + i] += voiceGain * env
          * (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph));
      }
    }
  }
  return { pcm: out, lead, symbolSamples: S, count };
}

// ---------------------------------------------------------------- demodulator

const HIST = 512;            // hops of history (6.4 s) — longer than any frame
const MODES = ['ultra', 'voice', 'both'];

/// Streaming receiver. `push()` PCM chunks in; `onFrame({type, role, seq, payload, band,
/// endSample})` fires for every frame whose checksum passes. `endSample` is the index (in
/// the pushed stream) of the end of the frame's last symbol.
export class Demodulator {
  constructor(sampleRate, onFrame) {
    this.sampleRate = sampleRate;
    this.onFrame = onFrame;
    const g = geometry(sampleRate);
    this.H = g.H; this.S = g.S; this.W = g.W;
    this.useUltra = ultraUsable(sampleRate);
    this.freqs = [...ULTRA, ...VOICE];
    this.coeff = this.freqs.map((f) => 2 * Math.cos(2 * Math.PI * f / sampleRate));
    this.floor = new Float64Array(TONES * 2);
    this.raw = new Float64Array(TONES * 2);
    this.seen = 0;
    this.hist = Array.from({ length: HIST }, () => new Float32Array(TONES * 2));
    this.hop = 0;                    // hops analysed so far
    this.pending = new Float32Array(0);
    this.consumed = 0;               // samples dropped from the front of `pending`
    this.candidates = [];
    this.quietBefore = 0;            // ignore candidates that start before this hop
    this.levels = new Float32Array(TONES * 2);   // latest normalised levels (diagnostics)
  }

  reset() {
    this.pending = new Float32Array(0);
    this.candidates = [];
    this.quietBefore = this.hop;
  }

  push(chunk) {
    let buf;
    if (this.pending.length) {
      buf = new Float32Array(this.pending.length + chunk.length);
      buf.set(this.pending); buf.set(chunk, this.pending.length);
    } else buf = chunk;
    let pos = 0;
    while (pos + this.W <= buf.length) {
      this.analyse(buf, pos);
      pos += this.H;
    }
    this.pending = buf.slice(pos);
    this.consumed += pos;
  }

  analyse(buf, pos) {
    const v = this.hist[this.hop % HIST];
    const W = this.W, norm = 4 / (W * W);
    for (let k = 0; k < this.coeff.length; k++) {
      if (k < TONES && !this.useUltra) { this.raw[k] = 1e-9; continue; }
      const c = this.coeff[k];
      let s1 = 0, s2 = 0;
      for (let i = 0; i < W; i++) {
        const s0 = buf[pos + i] + c * s1 - s2;
        s2 = s1; s1 = s0;
      }
      const e = (s1 * s1 + s2 * s2 - c * s1 * s2) * norm + 1e-12;
      this.raw[k] = e;
    }
    // Slow per-tone noise floor: seeded from the first few hops, follows quiet energy
    // quickly, creeps up under a sustained tone (so a steady whine in the room is
    // normalised away), and is never allowed far below its band's average — one lucky
    // near-zero sample must not make a tone look permanently loud.
    this.seen += 1;
    for (let band = 0; band < 2; band++) {
      const o = band * TONES;
      let mean = 0;
      for (let i = 0; i < TONES; i++) {
        const k = o + i, e = this.raw[k];
        let f = this.floor[k];
        if (this.seen <= 16) f += (e - f) / this.seen;
        else if (e < 3 * f) f += 0.05 * (e - f);
        else f *= 1.05;
        this.floor[k] = f;
        mean += f / TONES;
      }
      for (let i = 0; i < TONES; i++) {
        const k = o + i;
        if (this.floor[k] < 0.25 * mean) this.floor[k] = 0.25 * mean;
        v[k] = this.raw[k] / (this.floor[k] + 1e-12);
      }
    }
    this.levels.set(v);
    const h = this.hop;
    this.hop += 1;
    this.detect(h);
    this.advance(h);
  }

  vec(hop) { return this.hist[hop % HIST]; }

  /// Is the preamble present with its first symbol's window at hop `h - 12`?
  detect(h) {
    const k0 = h - 4 * (PREAMBLE.length - 1);
    if (k0 < 0 || k0 < this.quietBefore) return;
    let ok = false;
    for (let band = 0; band < 2 && !ok; band++) {
      if (band === 0 && !this.useUltra) continue;
      let good = true;
      for (let j = 0; j < PREAMBLE.length && good; j++) {
        const v = this.vec(k0 + 4 * j), o = band * TONES;
        const want = v[o + PREAMBLE[j]];
        if (want < 4) { good = false; break; }
        for (let i = 0; i < TONES; i++) if (v[o + i] > want) { good = false; break; }
      }
      ok = good;
    }
    if (ok && this.candidates.length < 64) this.candidates.push({ k0, dead: [false, false, false] });
  }

  symbolAt(k0, n, mode) {
    const v = this.vec(k0 + 4 * n);
    let best = 0, bestScore = -1;
    let su = 0, sv = 0;
    if (mode === 2) for (let i = 0; i < TONES; i++) { su += v[i]; sv += v[TONES + i]; }
    for (let i = 0; i < TONES; i++) {
      const score = mode === 0 ? v[i] : mode === 1 ? v[TONES + i] : v[i] / su + v[TONES + i] / sv;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best ^ scramble(n - PREAMBLE.length);
  }

  advance(h) {
    if (!this.candidates.length) return;
    const keep = [];
    for (const c of this.candidates) {
      if (c.k0 < this.quietBefore || h - c.k0 > HIST - 8) continue;
      let alive = false;
      for (let mode = 0; mode < 3; mode++) {
        if (c.dead[mode]) continue;
        if (mode !== 1 && !this.useUltra) { c.dead[mode] = true; continue; }
        const r = this.tryDecode(c.k0, mode, h);
        if (r === 'wait') { alive = true; continue; }
        if (!r) { c.dead[mode] = true; continue; }
        this.quietBefore = r.endHop - 2;
        alive = false;
        this.onFrame(r.frame);
        break;
      }
      if (alive) keep.push(c);
    }
    this.candidates = keep.filter((c) => c.k0 >= this.quietBefore);
  }

  tryDecode(k0, mode, h) {
    const P = PREAMBLE.length;
    if (h < k0 + 4 * (P + HEADER - 1)) return 'wait';
    const len = (this.symbolAt(k0, P + 2, mode) << 4) | this.symbolAt(k0, P + 3, mode);
    if (len > MAX_PAYLOAD) return null;
    const total = frameLength(len);
    if (h < k0 + 4 * (total - 1)) return 'wait';
    const nib = [];
    for (let n = P; n < total; n++) nib.push(this.symbolAt(k0, n, mode));
    const bytes = [];
    for (let i = 0; i + 1 < nib.length - CRC_SYMS; i += 2) bytes.push((nib[i] << 4) | nib[i + 1]);
    const c = nib.slice(-CRC_SYMS);
    const crc = (c[0] << 12) | (c[1] << 8) | (c[2] << 4) | c[3];
    if (crc16(bytes) !== crc) return null;
    const head = bytes[0] >> 4;
    // The best window sits ≈0.6 hop into the symbol; undo that to recover the symbol grid.
    const start = Math.round((k0 - 0.6) * this.H);
    return {
      endHop: k0 + 4 * total,
      frame: {
        type: head & 7, role: head >> 3, seq: bytes[0] & 15, payload: bytes.slice(2),
        band: MODES[mode], endSample: start + total * this.S,
      },
    };
  }
}
