// The spectator's sheet: a blank area to write any word on, or draw any card (a value and a
// suit). No boxes, no keyboard, and nothing is read back — what they wrote goes into the
// deck in their own handwriting. The reading happens quietly, on this phone.

import { Drawing } from '../drawing.js';
import { read } from '../hand/read.js';
import { BP } from '../palette.js';

export class WritePad {
  constructor({ onEmpty } = {}) {
    this.el = document.getElementById('pad');
    this.canvas = document.getElementById('pad-canvas');
    this.onEmpty = onEmpty || (() => {});
    this.resolve = null;
    this.drawing = new Drawing(this.canvas, () => this.canvas.getContext('2d'));
    this.drawing.color = BP.line;
    document.getElementById('pad-undo').addEventListener('click', () => this.drawing.undo());
    document.getElementById('pad-clear').addEventListener('click', () => this.drawing.clear());
    document.getElementById('pad-done').addEventListener('click', () => this.finish());
    window.addEventListener('resize', () => { if (!this.el.hidden) this.fit(); });
  }

  fit() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawing.render();
  }

  /// Resolves with { selection, writing } once something legible has been written.
  /// selection = {kind:'card', value, suit} | {kind:'word', text};
  /// writing = { strokes, box } — the ink itself, for showing back as handwriting.
  open() {
    this.el.hidden = false;
    this.drawing.clear();
    this.drawing.history = [];
    this.drawing.enabled = true;
    this.fit();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  finish() {
    if (!this.resolve) return;
    const strokes = this.drawing.strokes.map((s) => ({ points: s.points.slice() }));
    const selection = strokes.length ? read(strokes) : null;
    if (!selection || (selection.kind === 'word' && !selection.text.trim())) { this.onEmpty(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) for (const p of s.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const r = this.resolve;
    this.resolve = null;
    this.drawing.enabled = false;
    this.el.hidden = true;
    r({ selection, writing: { strokes, box: { minX, minY, w: maxX - minX, h: maxY - minY } } });
  }
}
