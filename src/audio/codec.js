// Data-over-sound codec. Pure functions + a streaming demodulator; no Web Audio here, so the
// whole thing runs (and is tested) in Node.
//
// One nibble per 75 ms symbol — a 32nd note at 100 bpm, so a frame sits on the beat of the
// background music — carried twice at once:
//   • ULTRA — one of 16 tones in 17.6…19.2 kHz, inaudible to most adults;
//   • CHIME — a two-note chord in the music's own pentatonic scale: one of four lower notes
//     (the nibble's top two bits) with one of four higher notes (its bottom two). To a
//     listener it is a sparkle of glockenspiel over the tune.
// The ultrasonic tones sit on exact multiples of 1 / (analysis window), so they are
// orthogonal under a plain rectangular Goertzel window; the chime notes are real musical
// pitches, so they are read through a Hann window instead.
//
// Frame (in symbols):  PREAMBLE(4)  head  seq  lenHi lenLo  payload(2·len)  crc16(4)
//   head = role << 3 | type. Everything after the preamble is XORed with a fixed scramble
//   sequence so repeated nibbles never produce a monotone.

export const TONES = 16;
export const SYMBOL_SECONDS = 0.075;
const BIN = 1 / (SYMBOL_SECONDS / 2);                       // 26.67 Hz
export const ULTRA = Array.from({ length: TONES }, (_, i) => (660 + 4 * i) * BIN);
// C major pentatonic, C6…E7. Low group picks bits 3-2, high group bits 1-0.
export const CHIME_LOW = [1046.50, 1174.66, 1318.51, 1567.98];     // C6 D6 E6 G6
export const CHIME_HIGH = [1760.00, 2093.00, 2349.32, 2637.02];    // A6 C7 D7 E7
export const PREAMBLE = [0, 15, 5, 10];
export const MAX_PAYLOAD = 12;
const HEADER = 4;                       // head, seq, lenHi, lenLo
const CRC_SYMS = 4;
const NV = TONES + 8;                   // analysed tones: 16 ultra + 4 low + 4 high

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

/// Frame → symbol list (nibbles 0…15), preamble included.
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

/// Symbols → PCM. `ultra` / `chime` are symbol lists (either may be null). Returns the samples
/// with a short silent lead-in and a tail for the last chime to ring out; `lead` samples
/// precede symbol 0.
export function modulate({ ultra = null, chime = null }, sampleRate,
                         { ultraGain = 0.3, chimeGain = 0.2 } = {}) {
  const { S } = geometry(sampleRate);
  const count = Math.max(ultra ? ultra.length : 0, chime ? chime.length : 0);
  const lead = Math.round(sampleRate * 0.02);
  const tail = Math.round(sampleRate * 0.12);
  const out = new Float32Array(lead + count * S + tail);
  const on = Math.round(S * 0.8);
  const ramp = Math.round(sampleRate * 0.006);
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
    if (chime && n < chime.length) {
      // Two soft sine "bars": a quick strike, then a gentle fall across the note. Pure
      // sines on purpose — an overtone of a low bar would land on a high one.
      const notes = [CHIME_LOW[chime[n] >> 2], CHIME_HIGH[chime[n] & 3]];
      const attack = Math.round(sampleRate * 0.004), release = Math.round(sampleRate * 0.012);
      for (let v = 0; v < 2; v++) {
        const w = twoPi * notes[v] / sampleRate;
        const g = chimeGain * (v ? 0.8 : 1);
        for (let i = 0; i < on; i++) {
          let env = 0.55 + 0.45 * Math.exp(-i / (sampleRate * 0.03));
          if (i < attack) env *= 0.5 - 0.5 * Math.cos(Math.PI * i / attack);
          if (on - 1 - i < release) env *= 0.5 - 0.5 * Math.cos(Math.PI * (on - 1 - i) / release);
          out[base + i] += g * env * Math.sin(w * i);
        }
      }
    }
  }
  return { pcm: out, lead, symbolSamples: S, count };
}

// ---------------------------------------------------------------- demodulator

const HIST = 512;            // hops of history (9.6 s) — longer than any frame
const MODES = ['ultra', 'chime', 'both'];

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
    this.freqs = [...ULTRA, ...CHIME_LOW, ...CHIME_HIGH];
    this.coeff = this.freqs.map((f) => 2 * Math.cos(2 * Math.PI * f / sampleRate));
    this.hann = Float32Array.from({ length: this.W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / this.W));
    this.scratch = new Float32Array(this.W);
    this.floor = new Float64Array(NV);
    this.raw = new Float64Array(NV);
    this.seen = 0;
    this.hist = Array.from({ length: HIST }, () => new Float32Array(NV));
    this.hop = 0;                    // hops analysed so far
    this.pending = new Float32Array(0);
    this.candidates = [];
    this.quietBefore = 0;            // ignore candidates that start before this hop
    this.levels = new Float32Array(NV);   // latest normalised levels (diagnostics)
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
  }

  analyse(buf, pos) {
    const v = this.hist[this.hop % HIST];
    const W = this.W, norm = 4 / (W * W), win = this.scratch;
    for (let i = 0; i < W; i++) win[i] = buf[pos + i] * this.hann[i];
    for (let k = 0; k < NV; k++) {
      if (k < TONES && !this.useUltra) { this.raw[k] = 1e-9; continue; }
      const c = this.coeff[k], src = k < TONES ? buf : win, off = k < TONES ? pos : 0;
      let s1 = 0, s2 = 0;
      for (let i = 0; i < W; i++) {
        const s0 = src[off + i] + c * s1 - s2;
        s2 = s1; s1 = s0;
      }
      this.raw[k] = (s1 * s1 + s2 * s2 - c * s1 * s2) * norm + 1e-12;
    }
    // Slow per-tone noise floor: seeded from the first few hops, follows quiet energy
    // quickly, creeps up under a sustained tone (so a steady whine — or a held note in the
    // background music — is normalised away), and is never allowed far below its band's
    // average: one lucky near-zero sample must not make a tone look permanently loud.
    this.seen += 1;
    for (const [o, n] of [[0, TONES], [TONES, 8]]) {
      let mean = 0;
      for (let i = 0; i < n; i++) {
        const k = o + i, e = this.raw[k];
        let f = this.floor[k];
        if (this.seen <= 16) f += (e - f) / this.seen;
        else if (e < 3 * f) f += 0.05 * (e - f);
        else f *= 1.05;
        this.floor[k] = f;
        mean += f / n;
      }
      for (let i = 0; i < n; i++) {
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
    let ultra = this.useUltra, chime = true;
    for (let j = 0; j < PREAMBLE.length && (ultra || chime); j++) {
      const v = this.vec(k0 + 4 * j), want = PREAMBLE[j];
      if (ultra) {
        const e = v[want];
        if (e < 4) ultra = false;
        else for (let i = 0; i < TONES; i++) if (v[i] > e) { ultra = false; break; }
      }
      if (chime) {
        const lo = v[TONES + (want >> 2)], hi = v[TONES + 4 + (want & 3)];
        if (lo < 4 || hi < 4) chime = false;
        else for (let i = 0; i < 4; i++) if (v[TONES + i] > lo || v[TONES + 4 + i] > hi) { chime = false; break; }
      }
    }
    if ((ultra || chime) && this.candidates.length < 64) this.candidates.push({ k0, dead: [false, false, false] });
  }

  symbolAt(k0, n, mode) {
    const v = this.vec(k0 + 4 * n);
    let nib;
    if (mode === 1) {
      let lo = 0, hi = 0;
      for (let i = 1; i < 4; i++) { if (v[TONES + i] > v[TONES + lo]) lo = i; if (v[TONES + 4 + i] > v[TONES + 4 + hi]) hi = i; }
      nib = (lo << 2) | hi;
    } else {
      let su = 0, sl = 0, sh = 0;
      if (mode === 2) {
        for (let i = 0; i < TONES; i++) su += v[i];
        for (let i = 0; i < 4; i++) { sl += v[TONES + i]; sh += v[TONES + 4 + i]; }
      }
      let best = -1;
      nib = 0;
      for (let i = 0; i < TONES; i++) {
        const score = mode === 0 ? v[i]
          : v[i] / su + 0.5 * (v[TONES + (i >> 2)] / sl + v[TONES + 4 + (i & 3)] / sh);
        if (score > best) { best = score; nib = i; }
      }
    }
    return nib ^ scramble(n - PREAMBLE.length);
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
