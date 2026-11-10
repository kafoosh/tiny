// Splits a page of freehand writing into characters, with no boxes or guides: strokes that
// touch, or sit over one another, belong to the same character; a wide gap is a space.
// Assumes one line of printed (not joined-up) writing, left to right — or a card's value
// stacked above its suit.

function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/// Points along a stroke no more than `step` apart, however sparsely it was sampled (a fast
/// flick on a slow phone can leave long straight gaps between points).
function dense(points, step) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for (let j = 1; j <= n; j++) out.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
  }
  return out;
}

/// Closest approach of two dense point runs.
function gap(a, b) {
  let best = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/// Returns { glyphs: [{ strokes, box, spaceBefore }], lineHeight, stacked }.
export function segment(strokes) {
  const items = strokes.filter((s) => s.points.length).map((s) => ({ strokes: [s], box: bounds(s.points) }));
  const trace = new Map();           // stroke → its dense points, for the touch test
  if (!items.length) return { glyphs: [], lineHeight: 0, stacked: false };
  const all = bounds(items.flatMap((it) => it.strokes[0].points));
  // Line height: the tallest stroke is a good proxy for a capital's height on one line.
  const lineHeight = Math.max(...items.map((it) => it.box.h), all.h * 0.4, 12);
  const touch = Math.max(4, lineHeight * 0.07);
  for (const it of items) trace.set(it.strokes[0], dense(it.strokes[0].points, Math.max(1.5, touch / 2)));

  const small = (it) => Math.max(it.box.w, it.box.h) < lineHeight * 0.3;
  const same = (a, b) => {
    const ox = Math.min(a.box.maxX, b.box.maxX) - Math.max(a.box.minX, b.box.minX);
    const oy = Math.min(a.box.maxY, b.box.maxY) - Math.max(a.box.minY, b.box.minY);
    const narrow = Math.max(Math.min(a.box.w, b.box.w), 6);
    // Sharing the same column AND the same rows: parts of one character (a t's bar, the
    // strokes of an x), not a value written above its suit.
    if (ox >= narrow * 0.3 && oy > -lineHeight * 0.1) return true;
    // A small mark floating just above or below something: an i's dot, a ! or ? point.
    if (small(a) !== small(b)) {
      const dx = Math.abs((a.box.minX + a.box.maxX) - (b.box.minX + b.box.maxX)) / 2;
      if (dx < lineHeight * 0.3 && oy > -lineHeight * 0.5) return true;
    }
    if (a.box.minX - b.box.maxX > touch || b.box.minX - a.box.maxX > touch) return false;
    if (a.box.minY - b.box.maxY > touch || b.box.minY - a.box.maxY > touch) return false;
    for (const s of a.strokes) for (const t of b.strokes) if (gap(trace.get(s), trace.get(t)) <= touch) return true;
    return false;
  };

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      if (!same(items[i], items[j])) continue;
      items[i].strokes.push(...items[j].strokes);
      items[i].box = bounds(items[i].strokes.flatMap((s) => s.points));
      items.splice(j, 1);
      merged = true;
      break outer;
    }
  }

  // Reading order: left to right — unless the ink is a short column (a card index: value
  // over suit), which reads top to bottom.
  const stacked = items.length >= 2 && items.length <= 3 && all.h > all.w * 1.25 && columnLike(items);
  items.sort(stacked ? (a, b) => a.box.minY - b.box.minY : (a, b) => (a.box.minX + a.box.maxX) - (b.box.minX + b.box.maxX));

  const gaps = [];
  for (let i = 1; i < items.length; i++) gaps.push(items[i].box.minX - items[i - 1].box.maxX);
  const sorted = gaps.slice().sort((a, b) => a - b), median = sorted.length ? sorted[sorted.length >> 1] : 0;
  // A space is a gap clearly wider than this writer's usual letter gap; with too few gaps
  // to know what is usual, it is a gap most of a letter wide.
  const wide = gaps.length >= 3 ? Math.max(lineHeight * 0.42, median * 1.8 + lineHeight * 0.1) : lineHeight * 0.6;
  items.forEach((it, i) => { it.spaceBefore = !stacked && i > 0 && gaps[i - 1] > wide; });
  return { glyphs: items, lineHeight, stacked };
}

function columnLike(items) {
  const ys = items.map((it) => it.box).sort((a, b) => a.minY - b.minY);
  for (let i = 1; i < ys.length; i++) if (ys[i].minY < ys[i - 1].maxY - 0.25 * Math.min(ys[i].h, ys[i - 1].h)) return false;
  return true;
}
