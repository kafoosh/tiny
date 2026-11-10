// The acoustic codec, pushed through a simulated room: attenuation, noise, an echo, an
// unknown start offset, chunked delivery and a slightly-off sample clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Demodulator, modulate, frameSymbols, coverSymbols, crc16, frameLength, geometry,
  MAX_PAYLOAD, ULTRA, VOICE } from '../src/audio/codec.js';

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

test('tones are orthogonal: every frequency is a multiple of 1/window', () => {
  for (const f of [...ULTRA, ...VOICE]) assert.equal(f % 40, 0);
  assert.ok(Math.max(...VOICE) < 2 * Math.min(...VOICE), 'voice band stays inside one octave');
});

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
      const { pcm } = modulate({ ultra: syms, voice: syms }, sr);
      const got = receive(channel(pcm, sr, { seed: k + 1, offset: 0.2 + r() * 0.3, drift: 1 + (r() - 0.5) * 4e-4 }), sr,
        [128, 512, 1024, 4096][k % 4]);
      if (got.length === 1 && got[0].type === frame.type && got[0].role === frame.role
        && got[0].seq === frame.seq && got[0].payload.join() === payload.join()) ok += 1;
    }
    assert.equal(ok, N);
  });

  test(`ultra carries the data while the voice band babbles @${sr}`, () => {
    for (let k = 0; k < 12; k++) {
      const frame = { type: 2, role: 1, seq: k, payload: [k, 200 - k, 7] };
      const syms = frameSymbols(frame);
      const { pcm } = modulate({ ultra: syms, voice: coverSymbols(syms.length, rng(k + 3)) }, sr);
      const got = receive(channel(pcm, sr, { seed: 50 + k }), sr);
      assert.equal(got.length, 1);
      assert.equal(got[0].band, 'ultra');
      assert.deepEqual(got[0].payload, frame.payload);
    }
  });

  test(`voice band alone still gets through (a phone with no ultrasound) @${sr}`, () => {
    for (let k = 0; k < 12; k++) {
      const frame = { type: 1, role: 0, seq: k, payload: [k * 3] };
      const { pcm } = modulate({ voice: frameSymbols(frame) }, sr);
      const got = receive(channel(pcm, sr, { seed: 90 + k }), sr);
      assert.equal(got.length, 1);
      assert.equal(got[0].band, 'voice');
      assert.deepEqual(got[0].payload, frame.payload);
    }
  });
}

test('a 24 kHz context falls back to the voice band', () => {
  const frame = { type: 0, role: 0, seq: 3, payload: [1, 2, 3] };
  const { pcm } = modulate({ voice: frameSymbols(frame) }, 24000);
  const got = receive(channel(pcm, 24000, { seed: 5 }), 24000);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].payload, [1, 2, 3]);
});

test('frame end is located to within a hop or two', () => {
  const sr = 48000, { H } = geometry(sr);
  for (let k = 0; k < 10; k++) {
    const syms = frameSymbols({ type: 1, role: 0, seq: k, payload: [k] });
    const { pcm, lead, symbolSamples } = modulate({ ultra: syms, voice: syms }, sr);
    const offset = 0.2 + k * 0.0137;
    const got = receive(channel(pcm, sr, { seed: k + 20, offset, echo: 0 }), sr);
    assert.equal(got.length, 1);
    const truth = Math.round(sr * offset) + lead + syms.length * symbolSamples;
    assert.ok(Math.abs(got[0].endSample - truth) <= 2 * H, `off by ${got[0].endSample - truth} samples`);
  }
});

test('noise, babble and silence never produce a frame', () => {
  const sr = 48000, r = rng(11);
  const noise = new Float32Array(sr * 20);
  for (let i = 0; i < noise.length; i++) noise[i] = 0.05 * gauss(r);
  assert.equal(receive(noise, sr).length, 0);
  let frames = 0;
  for (let k = 0; k < 30; k++) {
    const cover = coverSymbols(24, rng(k + 100));
    frames += receive(channel(modulate({ ultra: cover, voice: cover }, sr).pcm, sr, { seed: k }), sr).length;
  }
  assert.equal(frames, 0);
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
