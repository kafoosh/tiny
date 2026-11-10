// The two moments a face is shown: the spectator's figure holding up the slip they wrote on
// before burying it, and the magician's figure finding it — and answering in type.

import { lerp, smooth, easeOut, easeIn, phase } from '../support.js';
import { burst } from '../pen.js';
import { BP, FONT_TYPE } from '../../palette.js';
import { drawBack, drawFace, drawWriting } from '../../cards.js';
import { deckInHand, heldDeck } from './basics.js';
import { fanInHand } from './deck.js';

const TAU = Math.PI * 2;

/// Spectator side: the fan closes, the slip with their own handwriting floats up so they
/// can take a last look, then slides into the deck.
export function showPick(k, writing) {
  const big = k.bigCard('note');
  const aspect = big.w / big.h;
  const tUp = 0.3, tHold = 1.0, tBack = 2.3, tIn = 3.0;
  return {
    duration: 3.3, leaves: 'deck',
    pose(t, p) {
      const down = smooth(phase(t, tBack, tIn));
      k.arm(p, lerp(0.45, -0.5, down), lerp(0.3, 0.4, down));
      const look = smooth(phase(t, tUp, tHold)) * (1 - down);
      p.headAngle = -k.sideSign * 0.16 * look;
      p.offset.y -= k.propScale * 0.04 * Math.sin(phase(t, tIn, 3.3) * Math.PI);
    },
    props(ctx, t, pose) {
      fanInHand(ctx, k, pose, 1 - easeOut(phase(t, 0, 0.45)), t);
      const d = deckInHand(k, pose);
      const up = easeOut(phase(t, tUp, tHold)), back = easeIn(phase(t, tBack, tIn));
      const g = up * (1 - back);
      if (t < tUp || back >= 1) return;
      const h = lerp(k.deckH, big.h, g), w = h * lerp(k.deckW / k.deckH, aspect, g);
      const c = { x: lerp(d.center.x, big.center.x, g), y: lerp(d.center.y, big.center.y, g) };
      const sway = 0.03 * Math.sin(TAU * t / 1.6) * g;
      drawWriting(ctx, c, w, h, lerp(d.angle, 0, g) + sway, k, writing,
        { opacity: Math.min(1, phase(t, tUp, tUp + 0.12) * (1 - phase(t, tIn - 0.1, tIn))) });
    },
  };
}

function mark(ctx, text, c, size, color, opacity) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.font = `${size}px ${FONT_TYPE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, c.x, c.y);
  ctx.restore();
}

/// Magician side: riffle through the caught deck, puzzle over it, get it, and pull the
/// selection out. A card turns over; a word is typed out letter by letter.
export function reveal(k, sel) {
  const big = k.bigCard(sel.kind);
  const aspect = big.w / big.h;
  const tThink = 0.9, tAha = 1.9, tPull = 2.3, tFlip = 3.1, tShow = 3.7;
  const typing = sel.kind === 'word' ? Math.min(2.2, 0.16 * sel.text.length) : 0;
  return {
    duration: Infinity, leaves: 'deck',
    pose(t, p) {
      const riffle = Math.sin(phase(t, 0, tThink) * Math.PI);
      const think = smooth(phase(t, tThink, tThink + 0.3)) * (1 - smooth(phase(t, tAha, tAha + 0.15)));
      const aha = Math.sin(phase(t, tAha, tAha + 0.4) * Math.PI);
      const show = smooth(phase(t, tPull, tShow));
      k.arm(p, -0.5 + 0.12 * riffle, 0.4 + 0.2 * Math.sin(t * TAU * 5) * riffle);
      // The free arm: scratches the head while thinking, then presents.
      k.arm(p, lerp(lerp(-1.2, 0.9, think), 0.8 + 0.04 * Math.sin(TAU * t / 2), show),
        lerp(0.9 * think, 0, show), Math.max(think, show), !k.armLeft);
      p.headAngle = k.sideSign * (0.14 * riffle) - k.sideSign * 0.18 * think - 0.06 * show
        + 0.03 * Math.sin(TAU * t / 3) * show;
      p.offset.y -= k.propScale * (0.10 * aha + 0.012 * Math.sin(TAU * t / 2) * show);
      p.scaleY = 1 + 0.05 * aha;
      p.rootAngle = -k.sideSign * 0.05 * think;
    },
    props(ctx, t, pose) {
      heldDeck(ctx, k, pose);
      const d = deckInHand(k, pose);
      if (t < tThink) {                                   // riffle: cards flutter off the deck
        const u = phase(t, 0, tThink), on = Math.sin(u * Math.PI);
        for (let i = 0; i < 3; i++) {
          const ph = (u * 6 + i / 3) % 1;
          const c = { x: d.center.x + k.sideSign * k.deckW * 0.5 * ph, y: d.center.y - k.deckH * 0.55 * Math.sin(ph * Math.PI) };
          drawBack(ctx, c, k.deckW * 0.85, k.deckH * 0.85, d.angle + k.sideSign * ph * 1.3, k, { opacity: on * (1 - ph) });
        }
      }
      const head = k.head(pose), r = k.skel.headRadius || k.propScale * 0.15;
      const at = { x: head.x - k.sideSign * r * 0.9, y: head.y - r * 1.9 };
      mark(ctx, '?', { x: at.x, y: at.y + 3 * Math.sin(t * 6) }, r * 1.5, BP.cyan,
        smooth(phase(t, tThink + 0.1, tThink + 0.35)) * (1 - phase(t, tAha - 0.1, tAha)));
      mark(ctx, '!', at, r * 1.8, BP.yellow, phase(t, tAha, tAha + 0.12) * (1 - phase(t, tPull, tPull + 0.3)));
      if (t < tPull) return;
      const g = easeOut(phase(t, tPull, tFlip));
      const h = lerp(k.deckH, big.h, g), w = h * lerp(k.deckW / k.deckH, aspect, g);
      const settled = phase(t, tShow, tShow + 0.5);
      const c = { x: lerp(d.center.x, big.center.x, g), y: lerp(d.center.y, big.center.y, g) + 3 * Math.sin(TAU * t / 2.4) * settled };
      const f = phase(t, tFlip, tShow);
      const sx = Math.max(0.03, Math.abs(Math.cos(f * Math.PI)));
      const ang = lerp(d.angle, 0, g) + 0.02 * Math.sin(TAU * t / 3) * settled;
      if (f < 0.5) drawBack(ctx, c, w, h, ang, k, { sx });
      else drawFace(ctx, c, w, h, ang, k, sel, { sx, typed: typing ? phase(t, tShow, tShow + typing) : 1 });
      burst(ctx, c, Math.min(Math.max(big.w, big.h), 220) * 0.62, phase(t, tShow + typing - 0.1, tShow + typing + 0.9), BP.yellow, Math.max(2, k.lw * 0.6), 14);
    },
  };
}
