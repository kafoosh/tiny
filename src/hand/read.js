// Reads what the spectator wrote: either a playing card (a value and a suit symbol, in any
// order, side by side or stacked — or spelled out, "queen of hearts") or a word or two.
// Returns the same selection objects the rest of the app passes around.

import { segment } from './segment.js';
import { rasterize } from './raster.js';
import { classify } from './net.js';
import { TIERS } from './words.js';
import { SUITS } from '../faces.js';

const A = 'abcdefghijklmnopqrstuvwxyz';
// Class layout of the network: 0-9, A-Z, then the lowercase letters that differ in shape.
const LOWER = 'abdefghnqrt';
const letterOf = (c) => (c >= 10 && c < 36 ? c - 10 : c >= 36 && c < 47 ? A.indexOf(LOWER[c - 36]) : -1);
const SUIT0 = 47;                                    // clubs, hearts, spades, diamonds
// Digits a letter is often mistaken for (we know a word has no digits in it).
const DIGIT_AS_LETTER = { 0: 'o', 1: 'l', 2: 'z', 5: 's', 6: 'b', 8: 'b', 9: 'g' };
const FLOOR = 2.5e-3;

function letterLogs(p) {
  const l = new Float64Array(26);
  for (let c = 10; c < 47; c++) l[letterOf(c)] += p[c];
  for (const [d, ch] of Object.entries(DIGIT_AS_LETTER)) l[A.indexOf(ch)] += 0.5 * p[d];
  let s = 0;
  for (const v of l) s += v;
  return l.map((v) => Math.log(Math.max(v / (s || 1), FLOOR)));
}

// Card values 1…13 ← the classes that can mean them (with look-alikes at a discount).
const cls = (ch) => (/[0-9]/.test(ch) ? Number(ch) : /[A-Z]/.test(ch) ? 10 + A.indexOf(ch.toLowerCase()) : 36 + LOWER.indexOf(ch));
const VALUE_CLASSES = [
  null,
  [['A', 1], ['a', 1]],
  [['2', 1], ['Z', 0.4]], [['3', 1]], [['4', 1]], [['5', 1], ['S', 0.4]], [['6', 1], ['G', 0.3], ['b', 0.3]],
  [['7', 1]], [['8', 1], ['B', 0.3]], [['9', 1], ['g', 0.4], ['q', 0.4]],
  null,                                              // 10 is two glyphs
  [['J', 1]], [['Q', 1], ['q', 0.6]], [['K', 1]],
];
function valueScores(p) {
  return VALUE_CLASSES.map((list) => (list ? list.reduce((s, [ch, w]) => s + w * p[cls(ch)], 0) : 0));
}

// ---- dictionary ------------------------------------------------------------------------

let lexicon = null;       // length → [{ word, codes, penalty }]
function loadLexicon() {
  lexicon = new Map();
  TIERS.forEach((text, tier) => {
    for (const word of text.split(' ')) {
      if (!lexicon.has(word.length)) lexicon.set(word.length, []);
      lexicon.get(word.length).push({ word, codes: Array.from(word, (ch) => A.indexOf(ch)), penalty: 0.5 * tier });
    }
  });
}

/// One run of letters → text. Takes the letters as read unless a dictionary word explains
/// the ink nearly as well (tuned on held-out handwriting: this turns roughly half-right
/// words into about 98% right for dictionary words, without bending other words much).
export function decodeToken(logs) {
  if (!lexicon) loadLexicon();
  const n = logs.length;
  let raw = '', rawScore = 0;
  for (const l of logs) {
    let b = 0;
    for (let i = 1; i < 26; i++) if (l[i] > l[b]) b = i;
    raw += A[b]; rawScore += l[b];
  }
  let best = null, bestScore = -Infinity;
  for (const e of lexicon.get(n) || []) {
    let s = -e.penalty;
    for (let i = 0; i < n && s > bestScore; i++) s += logs[i][e.codes[i]];
    if (s > bestScore) { bestScore = s; best = e.word; }
  }
  if (best && rawScore - bestScore <= 3.0 + 0.3 * n) return { text: best, sure: true };
  return { text: raw, sure: false };
}

const VALUE_WORDS = { ace: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, jack: 11, queen: 12, king: 13 };
const SUIT_WORDS = { club: 'clubs', clubs: 'clubs', heart: 'hearts', hearts: 'hearts', spade: 'spades', spades: 'spades', diamond: 'diamonds', diamonds: 'diamonds' };

// ---- the reader -----------------------------------------------------------------------

/// `strokes` = [{ points: [{x, y}] }] as drawn. Returns
/// { kind: 'card', value, suit } | { kind: 'word', text } | null (nothing legible).
export function read(strokes) {
  const { glyphs } = segment(strokes);
  if (!glyphs.length) return null;
  const probs = glyphs.map((g) => classify(rasterize(g.strokes)));

  // A card? Exactly one glyph must be unmistakably a suit, with one or two more for the value.
  if (glyphs.length >= 2 && glyphs.length <= 3) {
    const suitMass = probs.map((p) => p[SUIT0] + p[SUIT0 + 1] + p[SUIT0 + 2] + p[SUIT0 + 3]);
    const si = suitMass.indexOf(Math.max(...suitMass));
    if (suitMass[si] > 0.5) {
      let suit = 0;
      for (let k = 1; k < 4; k++) if (probs[si][SUIT0 + k] > probs[si][SUIT0 + suit]) suit = k;
      const rest = probs.filter((_, i) => i !== si);
      let value = 10;
      if (rest.length === 1) {
        const v = valueScores(rest[0]);
        value = v.indexOf(Math.max(...v));
        // A lone "1" or "I" with a suit is how some people write an ace.
        if (v[value] < 0.08) value = 1;
      }
      return { kind: 'card', value, suit: SUITS[suit] };
    }
  }

  // Otherwise words.
  const tokens = [];
  let run = [];
  glyphs.forEach((g, i) => {
    if (g.spaceBefore && run.length) { tokens.push(run); run = []; }
    run.push(letterLogs(probs[i]));
  });
  if (run.length) tokens.push(run);
  const words = tokens.map((t) => decodeToken(t).text);

  const value = words.map((w) => VALUE_WORDS[w]).find(Boolean);
  const suit = words.map((w) => SUIT_WORDS[w]).find(Boolean);
  if (value && suit) return { kind: 'card', value, suit };
  return { kind: 'word', text: words.join(' ').slice(0, 16) };
}
