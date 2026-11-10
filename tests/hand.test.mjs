// The handwriting reader, fed synthetic handwriting: a single-stroke font pushed through a
// wobbly, slanted, unevenly spaced "hand", plus drawn suit symbols.

import test from 'node:test';
import assert from 'node:assert/strict';
import { read, decodeToken } from '../src/hand/read.js';
import { segment } from '../src/hand/segment.js';
import { rasterize } from '../src/hand/raster.js';
import { classify, logits } from '../src/hand/net.js';
import { GLYPHS } from './strokefont.mjs';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/// Densify a polyline and run it through one writer's quirks.
function pen(pts, r, { slant, wob, ox, oy, k }) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) out.push([ax + (bx - ax) * j / n, ay + (by - ay) * j / n]);
  }
  const ph = r() * 6.28, ph2 = r() * 6.28;
  return { points: out.map(([x, y], i) => ({
    x: ox + k * (x + slant * (22 - y) + wob * Math.sin(i * 0.35 + ph)),
    y: oy + k * (y + wob * Math.cos(i * 0.31 + ph2)),
  })) };
}

/// Write `text` as strokes: letters from the stroke font, spaces as wide gaps.
function write(text, seed, { size = 3.2, slant = 0.12, wob = 0.35, gap = 2, upper = false } = {}) {
  const r = rng(seed), strokes = [];
  let x = 40;
  const sl = slant * (r() * 2 - 0.6);
  for (const ch0 of text) {
    if (ch0 === ' ') { x += 20 * size; continue; }
    const ch = upper ? ch0.toUpperCase() : ch0, g = GLYPHS[ch];
    const quirks = { slant: sl, wob, ox: x, oy: 120 + (r() - 0.5) * 6 * size / 3, k: size * (0.92 + r() * 0.16) };
    for (const s of g.s) strokes.push(pen(s, r, quirks));
    x += (g.w + gap + r() * 3) * size;
  }
  return strokes;
}

const SUIT_SHAPES = {
  hearts: () => { const p = []; for (let i = 0; i <= 60; i++) { const t = i / 60 * 2 * Math.PI; p.push([11 + 0.62 * 16 * Math.sin(t) ** 3, 10 - 0.62 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); } return [p]; },
  diamonds: () => [[[11, 0], [19, 11], [11, 22], [3, 11], [11, 0]]],
  clubs: () => { const c = (cx, cy) => Array.from({ length: 25 }, (_, i) => [cx + 5 * Math.cos(i / 24 * 6.283), cy + 5 * Math.sin(i / 24 * 6.283)]); return [c(11, 5), c(5, 13), c(17, 13), [[11, 13], [11, 22]]]; },
  spades: () => { const h = SUIT_SHAPES.hearts()[0].map(([x, y]) => [x, 17 - y * 0.85]); return [h, [[11, 15], [11, 22]], [[7, 22], [15, 22]]]; },
};
function suitStrokes(suit, x, y, size, seed) {
  const r = rng(seed);
  return SUIT_SHAPES[suit]().map((s) => pen(s, r, { slant: 0.05, wob: 0.3, ox: x, oy: y, k: size }));
}

test('the network runs and gives a probability distribution', () => {
  const p = classify(rasterize(write('A', 1, { upper: true })));
  assert.equal(p.length, 51);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-4);
  assert.equal(logits(new Float32Array(784)).length, 51);
});

test('printed letters are split one glyph per character, multi-stroke letters included', () => {
  for (const [text, n] of [['HELLO', 5], ['KITE', 4], ['banana', 6], ['FIX IT', 5], ['jeep', 4]]) {
    const { glyphs } = segment(write(text, 3));
    assert.equal(glyphs.length, n, text);
  }
  const { glyphs } = segment(write('big dog', 4));
  assert.deepEqual(glyphs.map((g) => g.spaceBefore), [false, false, false, true, false, false]);
});

test('dictionary words are read, in capitals and lowercase, across many "writers"', () => {
  const words = ['hello', 'magic', 'banana', 'pizza', 'dragon', 'purple', 'window', 'tiger', 'rocket', 'summer',
    'elephant', 'guitar', 'yellow', 'wizard', 'cheese', 'monkey', 'planet', 'silver', 'garden', 'coffee'];
  let ok = 0, n = 0;
  const miss = [];
  for (const [wi, w] of words.entries()) for (const upper of [true, false]) for (const seed of [1, 2, 3]) {
    const got = read(write(w, wi * 10 + seed, { upper, size: 2.4 + seed * 0.6, slant: 0.1 * seed }));
    n += 1;
    if (got && got.kind === 'word' && got.text === w) ok += 1; else miss.push(`${w}→${got && (got.text || JSON.stringify(got))}`);
  }
  console.log(`  words: ${ok}/${n}  ${miss.slice(0, 12).join('  ')}`);
  assert.ok(ok / n >= 0.9, `${ok}/${n}`);
});

test('sparsely sampled strokes (a fast hand on a slow phone) still group correctly', () => {
  const sparse = write('pizza', 7).map((s) => ({ points: s.points.filter((_, i) => i % 14 === 0 || i === s.points.length - 1) }));
  assert.equal(segment(sparse).glyphs.length, 5);
  assert.deepEqual(read(sparse), { kind: 'word', text: 'pizza' });
});

test('two words keep their space', () => {
  assert.deepEqual(read(write('red apple', 5)), { kind: 'word', text: 'red apple' });
  assert.deepEqual(read(write('BLUE MOON', 6, { upper: true })), { kind: 'word', text: 'blue moon' });
});

test('a value and a drawn suit are read as a card: side by side, stacked, or suit first', () => {
  const vals = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
  let ok = 0, n = 0;
  const miss = [];
  for (const [label, value] of Object.entries(vals)) for (const [si, suit] of ['clubs', 'hearts', 'spades', 'diamonds'].entries()) {
    for (const layout of ['side', 'stacked', 'suitFirst']) {
      const seed = value * 7 + si;
      const text = write(label, seed, { size: 3, upper: true });
      const maxX = Math.max(...text.flatMap((s) => s.points.map((p) => p.x)));
      let strokes;
      if (layout === 'side') strokes = [...text, ...suitStrokes(suit, maxX + 28, 120, 3, seed)];
      else if (layout === 'stacked') strokes = [...text, ...suitStrokes(suit, 40, 215, 3, seed)];
      else strokes = [...suitStrokes(suit, -60, 120, 3, seed), ...text];
      const got = read(strokes);
      n += 1;
      if (got && got.kind === 'card' && got.value === value && got.suit === suit) ok += 1;
      else miss.push(`${label}${suit[0]}/${layout}→${JSON.stringify(got)}`);
    }
  }
  console.log(`  cards: ${ok}/${n}  ${miss.slice(0, 10).join('  ')}`);
  assert.ok(ok / n >= 0.9, `${ok}/${n}`);
});

test('a card spelled out in words is a card too', () => {
  assert.deepEqual(read(write('queen of hearts', 8, { size: 2 })), { kind: 'card', value: 12, suit: 'hearts' });
  assert.deepEqual(read(write('ACE OF SPADES', 9, { size: 2, upper: true })), { kind: 'card', value: 1, suit: 'spades' });
});

test('a word outside the dictionary is left as written, not bent into another', () => {
  const logs = Array.from('zxqvk', (ch) => { const l = new Float64Array(26).fill(Math.log(0.0025)); l[ch.charCodeAt(0) - 97] = Math.log(0.95); return l; });
  assert.deepEqual(decodeToken(logs), { text: 'zxqvk', sure: false });
});

test('an empty page reads as nothing', () => {
  assert.equal(read([]), null);
});
