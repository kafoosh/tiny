// The deck, spread out for the spectator: tap any of the 52 cards, or flip to the other tab
// and write a word on a slip of paper. A completely free choice — the method never needs to
// steer it.

import { rect } from '../rig/model.js';
import { LG } from '../palette.js';
import { sketch, rectPts, roundedRectPath } from '../anim/sketchInk.js';
import { SUITS, isRed, valueLabel, drawLooseText, drawSuit } from '../reveal.js';
import { cleanWord } from '../link/protocol.js';

const COLS = 4, ROWS = 13;
const RED = 'rgb(217, 41, 41)';

export class Picker {
  constructor() {
    this.el = document.getElementById('picker');
    this.grid = document.getElementById('card-grid');
    this.wordPane = document.getElementById('word-pane');
    this.input = document.getElementById('word-input');
    this.tabs = Array.from(this.el.querySelectorAll('.tab'));
    this.resolve = null;
    this.picked = -1;

    for (const tab of this.tabs) tab.addEventListener('click', () => this.show(tab.dataset.tab));
    this.grid.addEventListener('click', (e) => this.tapGrid(e));
    this.input.addEventListener('input', () => {
      const clean = cleanWord(this.input.value);
      if (clean !== this.input.value) this.input.value = clean;
    });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitWord(); });
    document.getElementById('word-ok').addEventListener('click', () => this.submitWord());
    window.addEventListener('resize', () => { if (!this.el.hidden) this.draw(); });
  }

  /// Resolves with {kind:'card', value, suit} or {kind:'word', text}.
  open() {
    this.picked = -1;
    this.input.value = '';
    this.el.hidden = false;
    this.show('card');
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  show(tab) {
    for (const t of this.tabs) t.classList.toggle('on', t.dataset.tab === tab);
    this.grid.hidden = tab !== 'card';
    this.wordPane.hidden = tab !== 'word';
    if (tab === 'card') this.draw(); else setTimeout(() => this.input.focus(), 50);
  }

  finish(sel) {
    const r = this.resolve;
    this.resolve = null;
    this.input.blur();
    this.el.hidden = true;
    r?.(sel);
  }

  submitWord() {
    const text = cleanWord(this.input.value).trim();
    if (!text) { this.input.focus(); return; }
    this.finish({ kind: 'word', text });
  }

  cell(i) {
    const b = this.grid.getBoundingClientRect();
    const cw = b.width / COLS, ch = b.height / ROWS;
    const col = i % COLS, row = Math.floor(i / COLS);
    return rect(col * cw + 3, row * ch + 3, cw - 6, ch - 6);
  }

  tapGrid(e) {
    if (!this.resolve || this.picked >= 0) return;
    const b = this.grid.getBoundingClientRect();
    const col = Math.min(COLS - 1, Math.max(0, Math.floor((e.clientX - b.left) / (b.width / COLS))));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((e.clientY - b.top) / (b.height / ROWS))));
    this.picked = row * COLS + col;
    this.draw();
    const sel = { kind: 'card', value: row + 1, suit: SUITS[col] };
    setTimeout(() => this.finish(sel), 260);
  }

  draw() {
    const c = this.grid, b = c.getBoundingClientRect();
    if (!(b.width > 0 && b.height > 0)) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(b.width * dpr); c.height = Math.round(b.height * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    for (let i = 0; i < COLS * ROWS; i++) {
      const r = this.cell(i), col = i % COLS, row = Math.floor(i / COLS);
      const suit = SUITS[col], color = isRed(suit) ? RED : LG.ink;
      roundedRectPath(ctx, r, 7);
      ctx.fillStyle = i === this.picked ? LG.yellow : '#FFFFFF';
      ctx.fill();
      sketch(ctx, rectPts(r, 3), LG.ink, 1.8, { closed: true, amp: 1.6, seed: i * 1.3 + 2 });
      const size = Math.min(r.height * 0.78, r.width * 0.36);
      drawLooseText(ctx, valueLabel(row + 1), { x: r.midX - r.width * 0.17, y: r.midY }, size, color, i + 0.5, r.width * 0.4);
      drawSuit(ctx, suit, { x: r.midX + r.width * 0.2, y: r.midY }, size * 1.15, color, i + 9.1);
    }
  }
}
