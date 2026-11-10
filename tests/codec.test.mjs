// The acoustic codec, pushed through a simulated room: attenuation, noise, an echo, an
// unknown start offset, chunked delivery and a slightly-off sample clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Demodulator, modulate, frameSymbols, crc16, frameLength, geometry,
  MAX_PAYLOAD, ULTRA, CHIME_LOW, CHIME_HIGH, SYMBOL_SECONDS } from '../src/audio/codec.js';
import { eventsAt, STEP, LOOP } from '../src/audio/music.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/// Simulated speaker → air → microphone.
function channel(pcm, sr, { gain = 0.08, noise = 0.004, echo = 0.35, offset = 0.37, drift = 1, seed = 1,
  ultraLoss = 1, tail = 0.5 } = {}) {
  const r = rng(seed);
  const pre = Math.round(sr * offset), post = Math.round(sr * tail);
  const n = Math.round(pcm.length / drift);
  const out = new Float32Array(pre + n + post);
  const d = Math.round(sr * 0.023);
  for (let i = 0; i < n; i++) {
    const x = i * drift, i0 = Math.floor(x), fr = x - i0;
    const s = (pcm[i0] || 0) * (1 - fr) + (pcm[i0 + 1] || 0) * fr;
    out[pre + i] += s * gain;
    if (pre + i + d < out.length) out[pre + i + d] += s * gain * echo;
  }
  void ultraLoss;
  for (let i = 0; i < out.length; i++) out[i] += noise * gauss(r);
  return out;
}

function receive(pcm, sr, chunk = 1024) {
  const frames = [];
  const d = new Demodulator(sr, (f) => frames.push(f));
  for (let i = 0; i < pcm.length; i += chunk) d.push(pcm.subarray(i, Math.min(i + chunk, pcm.length)));
  return frames;
}

test('crc16 matches the CCITT check value', () => {
  assert.equal(crc16([...'123456789'].map((c) => c.charCodeAt(0))), 0x29B1);
});

test('ultrasonic tones are orthogonal; chime notes are well apart and above the music', () => {
  const bin = 1 / (SYMBOL_SECONDS / 2);
  for (const f of ULTRA) assert.ok(Math.abs(f / bin - Math.round(f / bin)) < 1e-9);
  assert.ok(Math.max(...ULTRA) < 19500 && Math.min(...ULTRA) >= 17500);
  const chime = [...CHIME_LOW, ...CHIME_HIGH];
  for (let i = 1; i < chime.length; i++) assert.ok(chime[i] - chime[i - 1] > 4 * bin, 'at least four bins between notes');
  let top = 0;
  for (let s = 0; s < LOOP; s++) for (const e of eventsAt(s)) top = Math.max(top, e.f);
  assert.ok(top <= 440.01, 'the bed stays at or below A4');
  assert.ok(2 * top < Math.min(...chime), 'and its octave overtone stays under the lowest chime');
  assert.equal(STEP, SYMBOL_SECONDS, 'one data symbol is one 32nd note');
});

/// The phone's OWN background music as its microphone hears it: much louder than the far
/// phone's signal, with the overtones a small speaker adds.
function bed(length, sr, level) {
  const out = new Float32Array(length);
  for (let s = 0; s * STEP * sr < length; s++) {
    for (const e of eventsAt(s % LOOP)) {
      const start = Math.round(s * STEP * sr), n = Math.round(e.len * STEP * sr);
      for (let i = 0; i < n && start + i < length; i++) {
        const env = Math.min(1, i / 500) * Math.min(1, (n - i) / 1500), ph = 2 * Math.PI * e.f * i / sr;
        out[start + i] += level * e.vol * env * (Math.sin(ph) + 0.03 * Math.sin(2 * ph) + 0.03 * Math.sin(3 * ph));
      }
    }
  }
  return out;
}

for (const sr of [48000, 44100]) {
  test(`round trip, both bands, noisy echoing room @${sr}`, () => {
    const r = rng(7);
    let ok = 0;
    const N = 40;
    for (let k = 0; k < N; k++) {
      const payload = Array.from({ length: Math.floor(r() * (MAX_PAYLOAD + 1)) }, () => Math.floor(r() * 256));
      const frame = { type: k % 4, role: k & 1, seq: k % 16, payload };
      const syms = frameSymbols(frame);
      assert.equal(syms.length, frameLength(payload.length));
      const { pcm } = modulate({ ultra: syms, chime: syms }, sr);
      const got = receive(channel(pcm, sr, { seed: k + 1, offset: 0.2 + r() * 0.3, drift: 1 + (r() - 0.5) * 4e-4 }), sr,
        [128, 512, 1024, 4096][k % 4]);
      if (got.length === 1 && got[0].type === frame.type && got[0].role === frame.role
        && got[0].seq === frame.seq && got[0].payload.join() === payload.join()) ok += 1;
    }
    assert.equal(ok, N);
  });

  test(`chimes alone still get through (a phone with no ultrasound) @${sr}`, () => {
    for (let k = 0; k < 12; k++) {
      const frame = { type: 1, role: 0, seq: k, payload: [k * 3] };
      const { pcm } = modulate({ chime: frameSymbols(frame) }, sr);
      const got = receive(channel(pcm, sr, { seed: 90 + k }), sr);
      assert.equal(got.length, 1);
      assert.equal(got[0].band, 'chime');
      assert.deepEqual(got[0].payload, frame.payload);
    }
  });

  test(`ultrasound alone still gets through @${sr}`, () => {
    for (let k = 0; k < 12; k++) {
      const frame = { type: 2, role: 1, seq: k, payload: [k, 200 - k, 7] };
      const { pcm } = modulate({ ultra: frameSymbols(frame) }, sr);
      const got = receive(channel(pcm, sr, { seed: 50 + k }), sr);
      assert.equal(got.length, 1);
      assert.equal(got[0].band, 'ultra');
      assert.deepEqual(got[0].payload, frame.payload);
    }
  });

  test(`received while this phone's own music plays loudly into its microphone @${sr}`, () => {
    for (const bands of ['both', 'chime']) {
      let ok = 0;
      const N = 20;
      for (let k = 0; k < N; k++) {
        const frame = { type: 2, role: 1, seq: k, payload: [k, 99, 3 * k, 7, 1] };
        const syms = frameSymbols(frame);
        const { pcm } = modulate(bands === 'both' ? { ultra: syms, chime: syms } : { chime: syms }, sr);
        const heard = channel(pcm, sr, { seed: 300 + k, offset: 0.4 + k * 0.031 });
        const own = bed(heard.length, sr, 0.5);           // ≈ 20 dB over the far signal
        for (let i = 0; i < heard.length; i++) heard[i] += own[i];
        const got = receive(heard, sr);
        if (got.length === 1 && got[0].payload.join() === frame.payload.join()) ok += 1;
      }
      assert.ok(ok >= N - 1, `${bands}: ${ok}/${N}`);
    }
  });
}

test('a 24 kHz context falls back to the chimes', () => {
  const frame = { type: 0, role: 0, seq: 3, payload: [1, 2, 3] };
  const { pcm } = modulate({ chime: frameSymbols(frame) }, 24000);
  const got = receive(channel(pcm, 24000, { seed: 5 }), 24000);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].payload, [1, 2, 3]);
});

test('frame end is located to within a hop or two', () => {
  const sr = 48000, { H } = geometry(sr);
  for (let k = 0; k < 10; k++) {
    const syms = frameSymbols({ type: 1, role: 0, seq: k, payload: [k] });
    const { pcm, lead, symbolSamples } = modulate({ ultra: syms, chime: syms }, sr);
    const offset = 0.2 + k * 0.0137;
    const got = receive(channel(pcm, sr, { seed: k + 20, offset, echo: 0 }), sr);
    assert.equal(got.length, 1);
    const truth = Math.round(sr * offset) + lead + syms.length * symbolSamples;
    assert.ok(Math.abs(got[0].endSample - truth) <= 2 * H, `off by ${got[0].endSample - truth} samples`);
  }
});

test('noise, music and silence never produce a frame', () => {
  const sr = 48000, r = rng(11);
  const noise = new Float32Array(sr * 20);
  for (let i = 0; i < noise.length; i++) noise[i] = 0.05 * gauss(r);
  assert.equal(receive(noise, sr).length, 0);
  const music = bed(sr * 30, sr, 0.5);
  for (let i = 0; i < music.length; i++) music[i] += 0.002 * gauss(r);
  assert.equal(receive(music, sr).length, 0);
  assert.equal(receive(new Float32Array(sr * 3), sr).length, 0);
});

test('two frames back to back are both received, once each', () => {
  const sr = 48000;
  const a = modulate({ ultra: frameSymbols({ type: 1, role: 0, seq: 1, payload: [] }) }, sr).pcm;
  const b = modulate({ ultra: frameSymbols({ type: 3, role: 1, seq: 1, payload: [] }) }, sr).pcm;
  const both = new Float32Array(a.length + b.length + 4800);
  both.set(a); both.set(b, a.length + 4800);
  const got = receive(channel(both, sr, { seed: 4 }), sr);
  assert.deepEqual(got.map((f) => f.type), [1, 3]);
});
