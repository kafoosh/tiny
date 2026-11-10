// Pen strokes → the 28×28 picture the recogniser expects: the glyph scaled to fit a 20-pixel
// box (keeping its proportions), centred, drawn with a soft round nib — the same framing as
// the handwriting samples the network learned from.

const N = 28, FIT = 20, NIB = 1.25, SOFT = 0.85;

/// `strokes` = [{ points: [{x, y}] }]. Returns Float32Array(784), 0 = paper, 1 = ink.
export function rasterize(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const p of s.points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const img = new Float32Array(N * N);
  if (!(maxX >= minX)) return img;
  const size = Math.max(maxX - minX, maxY - minY, 1e-3);
  const k = FIT / size, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const segs = [];
  for (const s of strokes) {
    const pts = s.points.map((p) => ({ x: (p.x - cx) * k + N / 2, y: (p.y - cy) * k + N / 2 }));
    if (pts.length === 1) segs.push([pts[0], pts[0]]);
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  }
  for (const [a, b] of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - 3)), x1 = Math.min(N - 1, Math.ceil(Math.max(a.x, b.x) + 3));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - 3)), y1 = Math.min(N - 1, Math.ceil(Math.max(a.y, b.y) + 3));
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a.x, py = y + 0.5 - a.y;
      const t = len2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      const v = Math.min(1, Math.max(0, (NIB + SOFT - d) / (2 * SOFT)));
      if (v > img[y * N + x]) img[y * N + x] = v;
    }
  }
  return img;
}
