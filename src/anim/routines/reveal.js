// The two moments a face is shown: the spectator's figure holding up what was picked before
// burying it, and the magician's figure finding it.

import { lerp, smooth, easeOut, easeIn, phase } from '../support.js';
import { sparkles } from '../sketchInk.js';
import { drawBack, drawFace } from '../../cards.js';
import { drawLooseText } from '../../reveal.js';
import { deckInHand, heldDeck } from './basics.js';
import { fanInHand } from './deck.js';

const TAU = Math.PI * 2;

/// Spectator side: the fan closes, the chosen card (or slip) floats up big so they can take a
/// good look, then slides back into the deck.
export function showPick(k, sel) {
  const big = k.bigCard(sel.kind);
  const aspect = big.w / big.h;
  const tUp = 0.3, tHold = 1.0, tBack = 2.5, tIn = 3.2;
  return {
    duration: 3.5, leaves: 'deck',
    pose(t, p) {
      const down = smooth(phase(t, tBack, tIn));
      k.arm(p, lerp(0.45, -0.5, down), lerp(0.3, 0.4, down));
      const look = smooth(phase(t, tUp, tHold)) * (1 - down);
      p.headAngle = -k.sideSign * 0.16 * look;
      p.offset.y -= k.propScale * 0.04 * Math.sin(phase(t, tIn, 3.5) * Math.PI);
    },
    props(ctx, t, pose) {
      fanInHand(ctx, k, pose, 1 - easeOut(phase(t, 0, 0.45)), t);
      const d = deckInHand(k, pose);
      const up = easeOut(phase(t, tUp, tHold)), back = easeIn(phase(t, tBack, tIn));
      const g = up * (1 - back);
      if (t < tUp || back >= 1) return;
      const h = lerp(k.deckH, big.h, g), w = h * lerp(k.deckW / k.deckH, aspect, g);
      const c = { x: lerp(d.center.x, big.center.x, g), y: lerp(d.center.y, big.center.y, g) };
      const sway = 0.04 * Math.sin(TAU * t / 1.6) * g;
      drawFace(ctx, c, w, h, lerp(d.angle, 0, g) + sway, k, sel, { opacity: Math.min(1, phase(t, tUp, tUp + 0.12) * (1 - phase(t, tIn - 0.1, tIn))) });
    },
  };
}

/// Magician side: riffle through the caught deck, puzzle over it, get it, and pull the
/// chosen card (or slip) out to show the whole page.
export function reveal(k, sel) {
  const big = k.bigCard(sel.kind);
  const aspect = big.w / big.h;
  const tThink = 0.9, tAha = 1.9, tPull = 2.3, tFlip = 3.1, tShow = 3.7;
  return {
    duration: Infinity, leaves: 'deck',
    pose(t, p) {
      const riffle = Math.sin(phase(t, 0, tThink) * Math.PI);
      const think = smooth(phase(t, tThink, tThink + 0.3)) * (1 - smooth(phase(t, tAha, tAha + 0.15)));
      const aha = Math.sin(phase(t, tAha, tAha + 0.4) * Math.PI);
      const show = smooth(phase(t, tPull, tShow));
      k.arm(p, -0.5 + 0.12 * riffle, 0.4 + 0.2 * Math.sin(t * TAU * 5) * riffle);
      // The free arm: scratches the head while thinking, then presents the card.
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
      // Riffle: cards flutter up off the deck.
      if (t < tThink) {
        const u = phase(t, 0, tThink), on = Math.sin(u * Math.PI);
        for (let i = 0; i < 3; i++) {
          const ph = (u * 6 + i / 3) % 1;
          const c = { x: d.center.x + k.sideSign * k.deckW * 0.5 * ph, y: d.center.y - k.deckH * 0.55 * Math.sin(ph * Math.PI) };
          drawBack(ctx, c, k.deckW * 0.85, k.deckH * 0.85, d.angle + k.sideSign * ph * 1.3, k, { opacity: on * (1 - ph), seed: 6 + i });
        }
      }
      // "?" … "!" over the head.
      const head = k.head(pose), r = k.skel.headRadius || k.propScale * 0.15;
      const mark = { x: head.x - k.sideSign * r * 0.9, y: head.y - r * 1.9 };
      const q = smooth(phase(t, tThink + 0.1, tThink + 0.35)) * (1 - phase(t, tAha - 0.1, tAha));
      if (q > 0) { ctx.save(); ctx.globalAlpha *= q; drawLooseText(ctx, '?', { x: mark.x, y: mark.y + 3 * Math.sin(t * 6) }, r * 1.3, k.ink, 3.3); ctx.restore(); }
      const bang = phase(t, tAha, tAha + 0.12) * (1 - phase(t, tPull, tPull + 0.3));
      if (bang > 0) { ctx.save(); ctx.globalAlpha *= bang; drawLooseText(ctx, '!', mark, r * 1.6, k.ink, 4.4); ctx.restore(); }
      if (t < tPull) return;
      // Pull → flip → present.
      const g = easeOut(phase(t, tPull, tFlip));
      const h = lerp(k.deckH, big.h, g), w = h * lerp(k.deckW / k.deckH, aspect, g);
      const bob = 3 * Math.sin(TAU * t / 2.4) * phase(t, tShow, tShow + 0.5);
      const c = { x: lerp(d.center.x, big.center.x, g), y: lerp(d.center.y, big.center.y, g) + bob };
      const f = phase(t, tFlip, tShow);
      const sx = Math.max(0.03, Math.abs(Math.cos(f * Math.PI)));
      const ang = lerp(d.angle, 0, g) + 0.03 * Math.sin(TAU * t / 3) * phase(t, tShow, tShow + 0.5);
      if (f < 0.5) drawBack(ctx, c, w, h, ang, k, { sx });
      else drawFace(ctx, c, w, h, ang, k, sel, { sx });
      const sp = Math.sin(phase(t, tShow - 0.1, tShow + 0.9) * Math.PI);
      if (sp > 0) sparkles(ctx, c, Math.min(Math.max(big.w, big.h), 210) * 1.15, sp, k.ink, k.lw);
    },
  };
}
