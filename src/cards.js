// Cards as cut-out white paper on the blueprint: backs, a deck with a little thickness, a
// fan, typed faces, and the slip the spectator wrote on.

import { BP } from './palette.js';
import { line, roundedRectPath, centredRect } from './anim/pen.js';
import { drawCardFace, drawWordStrip } from './faces.js';

function at(ctx, c, angle, sx, fn) {
  ctx.save();
  ctx.translate(c.x, c.y);
  if (angle) ctx.rotate(angle);
  if (sx !== 1) ctx.scale(sx, 1);
  fn();
  ctx.restore();
}

function sheet(ctx, r, radius, opacity) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  roundedRectPath(ctx, r, radius);
  ctx.fillStyle = BP.paper;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, Math.min(r.width, r.height) * 0.035);
  ctx.strokeStyle = BP.sheetDeep;
  ctx.stroke();
  ctx.restore();
}

/// One card back, centred on `c`: white paper with a fine blue grid inside a border.
export function drawBack(ctx, c, w, h, angle, kit, { opacity = 1, sx = 1 } = {}) {
  at(ctx, c, angle, sx, () => {
    const r = centredRect(w, h);
    sheet(ctx, r, w * 0.08, opacity);
    const ix = w * 0.36, iy = h * 0.4, lw = Math.max(1, w * 0.022);
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.strokeStyle = BP.sheet;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.rect(-ix, -iy, ix * 2, iy * 2);
    for (let i = 1; i < 4; i++) { ctx.moveTo(-ix + (ix * 2 * i) / 4, -iy); ctx.lineTo(-ix + (ix * 2 * i) / 4, iy); }
    for (let i = 1; i < 6; i++) { ctx.moveTo(-ix, -iy + (iy * 2 * i) / 6); ctx.lineTo(ix, -iy + (iy * 2 * i) / 6); }
    ctx.stroke();
    ctx.restore();
  });
}

/// A squared-up deck: a few edges peeking out under the top card.
export function drawDeck(ctx, c, w, h, angle, kit, { opacity = 1, layers = 3 } = {}) {
  const step = Math.max(1.5, w * 0.045);
  at(ctx, c, angle, 1, () => {
    for (let i = layers; i >= 1; i--) {
      const r = centredRect(w, h);
      sheet(ctx, { ...r, x: r.x + i * step * 0.6, y: r.y + i * step }, w * 0.08, opacity);
    }
  });
  drawBack(ctx, c, w, h, angle, kit, { opacity });
}

/// A hand of card backs fanned about `pivot` (the bottom-centre of the closed deck).
export function drawFan(ctx, pivot, w, h, baseAngle, spread, kit, count = 7) {
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread);
    drawBack(ctx, { x: pivot.x + Math.sin(a) * h * 0.5, y: pivot.y - Math.cos(a) * h * 0.5 }, w, h, a, kit);
  }
}

/// The chosen thing, face up and typed. `sel` = {kind:'card', value, suit} | {kind:'word', text}.
export function drawFace(ctx, c, w, h, angle, kit, sel, { sx = 1, opacity = 1, typed = 1 } = {}) {
  at(ctx, c, angle, sx, () => {
    if (sel.kind === 'card') drawCardFace(ctx, centredRect(w, h), sel, opacity);
    else drawWordStrip(ctx, centredRect(w, h), sel.text, opacity, typed);
  });
}

/// The slip the spectator wrote on, with their own handwriting on it.
/// `writing` = { strokes: [{points}], box: {minX, minY, w, h} }.
export function drawWriting(ctx, c, w, h, angle, kit, writing, { opacity = 1 } = {}) {
  at(ctx, c, angle, 1, () => {
    sheet(ctx, centredRect(w, h), h * 0.07, opacity);
    const b = writing.box, k = Math.min((w * 0.84) / Math.max(b.w, 1), (h * 0.76) / Math.max(b.h, 1));
    const ox = -(b.minX + b.w / 2) * k, oy = -(b.minY + b.h / 2) * k;
    for (const s of writing.strokes) {
      const pts = s.points.length > 1 ? s.points : [s.points[0], { x: s.points[0].x + 0.5, y: s.points[0].y }];
      line(ctx, pts.map((p) => ({ x: p.x * k + ox, y: p.y * k + oy })), BP.sheetDeep, Math.max(1.2, 5 * k), { opacity });
    }
  });
}

/// Short speed lines trailing something that just flew off toward `dir` (unit vector).
export function motionLines(ctx, from, dir, len, kit, opacity) {
  if (opacity <= 0) return;
  const nx = -dir.y, ny = dir.x;
  for (let i = -1; i <= 1; i++) {
    const o = { x: from.x + nx * i * len * 0.35, y: from.y + ny * i * len * 0.35 };
    const l = len * (i === 0 ? 1 : 0.6);
    line(ctx, [o, { x: o.x + dir.x * l, y: o.y + dir.y * l }], BP.cyan, Math.max(1.5, kit.lw * 0.5), { opacity });
  }
}
