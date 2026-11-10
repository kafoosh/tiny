// Technical-pen drawing helpers shared by the props: clean lines, dashes, small ticks.

import { rect as mkRect } from '../rig/model.js';

export function roundedRectPath(ctx, r, radius) {
  const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.lineTo(r.x + r.width - rad, r.y);
  ctx.arcTo(r.x + r.width, r.y, r.x + r.width, r.y + rad, rad);
  ctx.lineTo(r.x + r.width, r.y + r.height - rad);
  ctx.arcTo(r.x + r.width, r.y + r.height, r.x + r.width - rad, r.y + r.height, rad);
  ctx.lineTo(r.x + rad, r.y + r.height);
  ctx.arcTo(r.x, r.y + r.height, r.x, r.y + r.height - rad, rad);
  ctx.lineTo(r.x, r.y + rad);
  ctx.arcTo(r.x, r.y, r.x + rad, r.y, rad);
  ctx.closePath();
}

/// Stroke a polyline (or closed polygon).
export function line(ctx, pts, color, lw, { closed = false, dash = null, opacity = 1 } = {}) {
  if (pts.length < 2 || opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (closed) ctx.closePath();
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

export const centredRect = (w, h) => mkRect(-w / 2, -h / 2, w, h);

/// A ring of short radial ticks — the blueprint's way of saying "ta-da".
export function burst(ctx, c, radius, grow, color, lw, count = 10) {
  if (grow <= 0) return;
  const a = Math.sin(Math.min(grow, 1) * Math.PI);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 + 0.2, r0 = radius * (0.72 + 0.25 * grow), r1 = r0 + radius * (i % 2 ? 0.16 : 0.28);
    line(ctx, [{ x: c.x + Math.cos(t) * r0, y: c.y + Math.sin(t) * r0 }, { x: c.x + Math.cos(t) * r1, y: c.y + Math.sin(t) * r1 }],
      color, lw, { opacity: a });
  }
}

/// A dashed flight path from `a` to `b` bowed upward by `lift`, drawn up to `u` (0…1), with
/// an arrowhead at its tip.
export function flightPath(ctx, a, b, lift, u, color, lw, opacity) {
  if (opacity <= 0 || u <= 0) return null;
  const pts = [];
  const n = 18, upTo = Math.max(1, Math.round(n * Math.min(u, 1)));
  for (let i = 0; i <= upTo; i++) {
    const t = i / n;
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - lift * Math.sin(t * Math.PI) });
  }
  line(ctx, pts, color, lw, { dash: [lw * 3, lw * 3.5], opacity });
  return pts[pts.length - 1];
}
