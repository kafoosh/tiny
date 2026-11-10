// Doodled cards: backs, a deck with a little thickness, a fan, and faces (a playing card or
// a slip of paper with a word on it). All drawn in the figure's own pen so they belong to
// the same sketch.

import { rect } from './rig/model.js';
import { LG, CARD_PAPER } from './palette.js';
import { sketch, rectPts, roundedRectPath, cardFace } from './anim/sketchInk.js';
import { drawLooseText } from './reveal.js';

function at(ctx, c, angle, sx, fn) {
  ctx.save();
  ctx.translate(c.x, c.y);
  if (angle) ctx.rotate(angle);
  if (sx !== 1) ctx.scale(sx, 1);
  fn();
  ctx.restore();
}

/// One card back, centred on `c`.
export function drawBack(ctx, c, w, h, angle, kit, { opacity = 1, seed = 3.1, sx = 1 } = {}) {
  at(ctx, c, angle, sx, () => {
    const r = rect(-w / 2, -h / 2, w, h);
    ctx.save();
    ctx.globalAlpha *= opacity;
    roundedRectPath(ctx, r, w * 0.08);
    ctx.fillStyle = CARD_PAPER;
    ctx.fill();
    ctx.restore();
    const lw = Math.max(1.5, Math.min(kit.lw, w * 0.07));
    sketch(ctx, rectPts(r, 3), kit.ink, lw, { closed: true, amp: w * 0.03, seed, opacity });
    // A scribbled diamond lattice in orange — reads as "card back" at any size.
    const ix = w * 0.30, iy = h * 0.34;
    const o = { opacity: opacity * 0.9, amp: w * 0.03, seed: seed + 4 };
    const thin = Math.max(1.2, lw * 0.6);
    sketch(ctx, [{ x: 0, y: -iy }, { x: ix, y: 0 }, { x: 0, y: iy }, { x: -ix, y: 0 }], LG.orange, thin, { ...o, closed: true });
    sketch(ctx, [{ x: -ix * 0.5, y: -iy * 0.5 }, { x: ix * 0.5, y: iy * 0.5 }], LG.orange, thin, o);
    sketch(ctx, [{ x: ix * 0.5, y: -iy * 0.5 }, { x: -ix * 0.5, y: iy * 0.5 }], LG.orange, thin, o);
  });
}

/// A squared-up deck: a few edges peeking out under the top card.
export function drawDeck(ctx, c, w, h, angle, kit, { opacity = 1, layers = 3 } = {}) {
  const step = Math.max(1.5, w * 0.045);
  at(ctx, c, angle, 1, () => {
    for (let i = layers; i >= 1; i--) {
      const r = rect(-w / 2 + i * step * 0.6, -h / 2 + i * step, w, h);
      ctx.save();
      ctx.globalAlpha *= opacity;
      roundedRectPath(ctx, r, w * 0.08);
      ctx.fillStyle = CARD_PAPER;
      ctx.fill();
      ctx.restore();
      sketch(ctx, rectPts(r, 3), kit.ink, Math.max(1.2, kit.lw * 0.6), { closed: true, amp: w * 0.02, seed: 8 + i, opacity });
    }
  });
  drawBack(ctx, c, w, h, angle, kit, { opacity });
}

/// A hand of card backs fanned about `pivot` (the bottom-centre of the closed deck).
export function drawFan(ctx, pivot, w, h, baseAngle, spread, kit, count = 7) {
  for (let i = 0; i < count; i++) {
    const a = baseAngle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * spread);
    const c = { x: pivot.x + Math.sin(a) * h * 0.5, y: pivot.y - Math.cos(a) * h * 0.5 };
    drawBack(ctx, c, w, h, a, kit, { seed: 3.1 + i });
  }
}

/// The chosen thing, face up. `sel` = {kind:'card', value, suit} | {kind:'word', text}.
export function drawFace(ctx, c, w, h, angle, kit, sel, { sx = 1, opacity = 1 } = {}) {
  at(ctx, c, angle, sx, () => {
    const r = rect(-w / 2, -h / 2, w, h);
    const lw = Math.max(1.5, Math.min(kit.lw, Math.min(w, h) * 0.07));
    if (sel.kind === 'card') {
      cardFace(ctx, r, opacity, kit.ink, lw, CARD_PAPER, sel);
      return;
    }
    ctx.save();
    ctx.globalAlpha *= opacity;
    roundedRectPath(ctx, r, h * 0.08);
    ctx.fillStyle = CARD_PAPER;
    ctx.fill();
    ctx.restore();
    sketch(ctx, rectPts(r, 4), kit.ink, lw, { closed: true, amp: h * 0.03, seed: 2.2, opacity });
    ctx.save();
    ctx.globalAlpha *= opacity;
    drawLooseText(ctx, sel.text, { x: 0, y: 0 }, h * 0.56, LG.ink, 5.5, w * 0.86);
    ctx.restore();
  });
}

/// Short speed lines trailing something that just flew off toward `dir` (unit vector).
export function motionLines(ctx, from, dir, len, kit, opacity) {
  if (opacity <= 0) return;
  const nx = -dir.y, ny = dir.x;
  for (let i = -1; i <= 1; i++) {
    const o = { x: from.x + nx * i * len * 0.35, y: from.y + ny * i * len * 0.35 };
    const l = len * (i === 0 ? 1 : 0.6);
    sketch(ctx, [o, { x: o.x + dir.x * l, y: o.y + dir.y * l }], kit.ink, Math.max(1.5, kit.lw * 0.6),
      { amp: 1.5, seed: 12 + i, opacity });
  }
}
