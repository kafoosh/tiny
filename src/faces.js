// What a selection looks like face-up, TYPED: a playing card with a set value and a clean
// suit, or a strip of paper with the word on it in a monospaced face. (The spectator wrote
// it by hand; the magician's side answers in type.)

import { BP, FONT_TYPE } from './palette.js';
import { roundedRectPath } from './anim/pen.js';

export const SUITS = ['clubs', 'hearts', 'spades', 'diamonds'];   // CHaSeD
export const isRed = (suit) => suit === 'hearts' || suit === 'diamonds';

export function valueLabel(v) {
  return v === 1 ? 'A' : v === 11 ? 'J' : v === 12 ? 'Q' : v === 13 ? 'K' : String(v);
}

function heartPath(ctx, flip) {
  const s = flip ? -0.86 : 1, o = flip ? -0.07 : 0;
  ctx.moveTo(0, 0.42 * s + o);
  ctx.bezierCurveTo(-0.56, 0.05 * s + o, -0.5, -0.42 * s + o, -0.22, -0.42 * s + o);
  ctx.bezierCurveTo(-0.08, -0.42 * s + o, 0, -0.3 * s + o, 0, -0.2 * s + o);
  ctx.bezierCurveTo(0, -0.3 * s + o, 0.08, -0.42 * s + o, 0.22, -0.42 * s + o);
  ctx.bezierCurveTo(0.5, -0.42 * s + o, 0.56, 0.05 * s + o, 0, 0.42 * s + o);
  ctx.closePath();
}
function stemPath(ctx, top) {
  ctx.moveTo(0, top); ctx.lineTo(0.15, 0.46); ctx.lineTo(-0.15, 0.46); ctx.closePath();
}

/// One suit symbol, `size` tall, centred on `c`.
export function drawSuit(ctx, suit, c, size, color) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(size, size);
  ctx.beginPath();
  if (suit === 'hearts') heartPath(ctx, false);
  else if (suit === 'diamonds') { ctx.moveTo(0, -0.48); ctx.lineTo(0.35, 0); ctx.lineTo(0, 0.48); ctx.lineTo(-0.35, 0); ctx.closePath(); }
  else if (suit === 'spades') { heartPath(ctx, true); stemPath(ctx, 0.05); }
  else {
    for (const [x, y] of [[0, -0.25], [-0.23, 0.07], [0.23, 0.07]]) { ctx.moveTo(x + 0.21, y); ctx.arc(x, y, 0.21, 0, Math.PI * 2); }
    stemPath(ctx, -0.02);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function paper(ctx, r, radius, opacity) {
  ctx.save();
  ctx.globalAlpha *= opacity;
  roundedRectPath(ctx, r, radius);
  ctx.fillStyle = BP.paper;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, Math.min(r.width, r.height) * 0.018);
  ctx.strokeStyle = BP.sheetDeep;
  ctx.stroke();
  ctx.restore();
}

/// A playing card face in rect `r` (in the current transform). card = { value, suit }.
export function drawCardFace(ctx, r, card, opacity = 1) {
  paper(ctx, r, r.width * 0.07, opacity);
  const color = isRed(card.suit) ? BP.red : BP.sheetDeep;
  const label = valueLabel(card.value);
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const idx = r.height * 0.15;
  const index = (flip) => {
    ctx.save();
    ctx.translate(flip ? r.maxX - r.width * 0.15 : r.minX + r.width * 0.15, flip ? r.maxY - r.height * 0.16 : r.minY + r.height * 0.16);
    if (flip) ctx.rotate(Math.PI);
    ctx.font = `${idx}px ${FONT_TYPE}`;
    ctx.fillText(label, 0, -idx * 0.22, r.width * 0.26);
    drawSuit(ctx, card.suit, { x: 0, y: idx * 0.72 }, idx * 0.7, color);
    ctx.restore();
  };
  index(false); index(true);
  ctx.font = `${r.height * 0.34}px ${FONT_TYPE}`;
  ctx.fillText(label, r.midX, r.midY - r.height * 0.1, r.width * 0.6);
  drawSuit(ctx, card.suit, { x: r.midX, y: r.midY + r.height * 0.17 }, r.height * 0.2, color);
  ctx.restore();
}

/// A strip of paper with `text` typed on it. `typed` (0…1) is how much has been typed so
/// far; a block cursor follows the last letter while it is still going.
export function drawWordStrip(ctx, r, text, opacity = 1, typed = 1) {
  paper(ctx, r, r.height * 0.1, opacity);
  const full = text.toUpperCase(), n = Math.max(0, Math.min(full.length, Math.floor(typed * full.length + 1e-6)));
  ctx.save();
  ctx.globalAlpha *= opacity;
  let size = r.height * 0.5;
  ctx.font = `${size}px ${FONT_TYPE}`;
  const wFull = ctx.measureText(full).width, room = r.width * 0.86;
  if (wFull > room) { size *= room / wFull; ctx.font = `${size}px ${FONT_TYPE}`; }
  const w = Math.min(wFull, room), x0 = r.midX - w / 2;
  ctx.fillStyle = BP.sheetDeep;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const shown = full.slice(0, n);
  ctx.fillText(shown, x0, r.midY + size * 0.04);
  if (typed < 1) ctx.fillRect(x0 + ctx.measureText(shown).width + size * 0.06, r.midY - size * 0.42, size * 0.5, size * 0.84);
  ctx.restore();
}
