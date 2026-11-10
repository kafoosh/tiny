// The deck's journey: produced, thrown off the edge of one screen, caught on the other,
// fanned, shuffled.

import { lerp, smooth, easeOut, easeIn, phase } from '../support.js';
import { burst, flightPath } from '../pen.js';
import { BP } from '../../palette.js';
import { drawDeck, drawBack, drawFan, motionLines } from '../../cards.js';
import { THROW_WINDUP, FLIGHT_OUT, FLIGHT_IN } from '../timing.js';
import { deckInHand, heldDeck } from './basics.js';

const TAU = Math.PI * 2;

/// Reach behind the back… and there's a deck.
export function produce(k) {
  return {
    duration: 1.3, leaves: 'deck',
    pose(t, p) {
      const w = smooth(phase(t, 0, 0.3));
      const out = smooth(phase(t, 0.45, 0.9));
      k.arm(p, lerp(-1.9, -0.5, out), lerp(0.1, 0.4, out), w);
      p.rootAngle = -k.sideSign * 0.08 * w * (1 - out);
      p.headAngle = k.sideSign * 0.1 * out;
      p.offset.y -= k.propScale * 0.05 * Math.sin(phase(t, 0.85, 1.2) * Math.PI);
    },
    props(ctx, t, pose) {
      const pop = easeOut(phase(t, 0.5, 0.8));
      if (pop <= 0) return;
      const d = deckInHand(k, pose);
      const s = pop * (1 + 0.25 * Math.sin(phase(t, 0.5, 0.95) * Math.PI));
      drawDeck(ctx, d.center, k.deckW * s, k.deckH * s, d.angle, k);
      const g = Math.sin(phase(t, 0.6, 1.25) * Math.PI);
      burst(ctx, d.center, k.propScale * 0.42, phase(t, 0.6, 1.25), BP.cyan, Math.max(1.5, k.lw * 0.5));
      void g;
    },
  };
}

/// Wind up and hurl the deck off the edge the other phone is past. The release lands
/// exactly THROW_WINDUP into the clip, so the caller can put it on the beat.
export function throwDeck(k) {
  const top = k.edge === 'top';
  const windElev = top ? -1.0 : 1.9, relElev = top ? 1.45 : 0.15;
  const clip = {
    duration: 1.2, leaves: 'none',
    pose(t, p) {
      const wind = smooth(phase(t, 0, THROW_WINDUP - 0.14));
      const whip = easeIn(phase(t, THROW_WINDUP - 0.14, THROW_WINDUP + 0.04));
      const follow = smooth(phase(t, THROW_WINDUP + 0.04, 0.75));
      const settle = 1 - smooth(phase(t, 0.85, 1.2));
      let elev = lerp(-0.5, windElev, wind);
      elev = lerp(elev, relElev, whip);
      elev = lerp(elev, relElev - 0.5, follow);
      k.arm(p, elev, lerp(0.4, 0.7, wind) * (1 - whip), settle);
      const lean = (-0.14 * wind * (1 - whip) + 0.17 * whip * (1 - follow)) * settle;
      p.rootAngle = k.sideSign * lean;
      p.headAngle = k.sideSign * (0.12 * whip) * settle;
      p.scaleY = 1 - 0.05 * wind * (1 - whip) + 0.04 * whip * (1 - follow);
      p.offset.y -= k.propScale * 0.06 * Math.sin(phase(t, THROW_WINDUP - 0.05, THROW_WINDUP + 0.3) * Math.PI);
    },
    props(ctx, t, pose) {
      if (t < THROW_WINDUP) { heldDeck(ctx, k, pose); return; }
      const from = clip.release || (clip.release = deckInHand(k, releasePose(k, clip)));
      const to = k.edgePoint(from.center, k.propScale * 0.10);
      const u = phase(t, THROW_WINDUP, THROW_WINDUP + FLIGHT_OUT);
      const dx = to.x - from.center.x, dy = to.y - from.center.y, m = Math.max(Math.hypot(dx, dy), 1);
      if (u < 1) {
        const c = { x: lerp(from.center.x, to.x, u), y: lerp(from.center.y, to.y, u) };
        drawDeck(ctx, c, k.deckW, k.deckH, from.angle + k.sideSign * u * 2.6, k);
      }
      const fade = 1 - phase(t, THROW_WINDUP + 0.05, THROW_WINDUP + 0.45);
      const tail = { x: lerp(from.center.x, to.x, 0.35), y: lerp(from.center.y, to.y, 0.35) };
      motionLines(ctx, tail, { x: dx / m, y: dy / m }, k.propScale * 0.22, k, fade * phase(t, THROW_WINDUP, THROW_WINDUP + 0.06));
    },
  };
  return clip;
}

function releasePose(k, clip) {
  const p = k.base();
  clip.pose(THROW_WINDUP, p);
  return p;
}

/// The deck arrives over the edge; reach, catch, rock back. The deck is on screen from t=0
/// and in the hand at FLIGHT_IN.
export function catchDeck(k) {
  const top = k.edge === 'top';
  const clip = {
    duration: 1.05, leaves: 'deck',
    pose(t, p) {
      const reach = easeOut(phase(t, 0, 0.18));
      const hit = phase(t, FLIGHT_IN, FLIGHT_IN + 0.3);
      const bump = Math.sin(Math.min(hit, 1) * Math.PI);
      const settle = smooth(phase(t, FLIGHT_IN, 0.85));
      k.arm(p, lerp(top ? 1.2 : 0.3, -0.5, settle), lerp(0.1, 0.4, settle), reach);
      p.rootAngle = k.sideSign * (0.06 * reach * (1 - settle) - 0.13 * bump);
      p.scaleY = 1 - 0.07 * bump; p.scaleX = 1 + 0.05 * bump;
      p.headAngle = k.sideSign * 0.14 * reach * (1 - settle);
      p.offset.y -= k.propScale * 0.07 * Math.sin(phase(t, 0.7, 1.05) * Math.PI);
    },
    props(ctx, t, pose) {
      if (t >= FLIGHT_IN) {
        heldDeck(ctx, k, pose);
        burst(ctx, deckInHand(k, pose).center, k.propScale * 0.4, phase(t, FLIGHT_IN, FLIGHT_IN + 0.45), BP.cyan, Math.max(1.5, k.lw * 0.5));
        return;
      }
      if (!clip.land) { const p = k.base(); clip.pose(FLIGHT_IN, p); clip.land = deckInHand(k, p); }
      const to = clip.land, from = k.edgePoint(to.center, k.propScale * 0.22);
      const u = phase(t, 0, FLIGHT_IN), e = easeOut(u) * 0.5 + u * 0.5;
      const c = { x: lerp(from.x, to.center.x, e), y: lerp(from.y, to.center.y, e) - k.propScale * 0.10 * Math.sin(e * Math.PI) };
      flightPath(ctx, from, to.center, k.propScale * 0.10, e, BP.cyan, Math.max(1.2, k.lw * 0.4), 0.7);
      drawDeck(ctx, c, k.deckW, k.deckH, to.angle - k.sideSign * (1 - u) * 3.2, k);
    },
  };
  return clip;
}

/// Hold the deck up and spread it into a fan.
export function fan(k) {
  return {
    duration: Infinity, leaves: 'deck',
    pose(t, p) {
      const up = smooth(phase(t, 0, 0.4));
      k.arm(p, lerp(-0.5, 0.45, up), 0.3);
      p.headAngle = k.sideSign * 0.08 * up + 0.03 * Math.sin(TAU * t / 3);
      p.scaleY = 1 + 0.01 * Math.sin(TAU * t / 2);
    },
    props(ctx, t, pose) { fanInHand(ctx, k, pose, easeOut(phase(t, 0.25, 0.75)), t); },
  };
}

export function fanInHand(ctx, k, pose, open, t = 0) {
  const d = deckInHand(k, pose);
  const pivot = { x: d.center.x, y: d.center.y + k.deckH * 0.5 };
  if (open < 0.04) { drawDeck(ctx, d.center, k.deckW, k.deckH, d.angle, k); return; }
  drawFan(ctx, pivot, k.deckW, k.deckH, d.angle + 0.03 * Math.sin(TAU * t / 2.5), 1.7 * open, k);
}

/// A showy riffle: the deck splits, the halves chatter together, and it squares up.
export function shuffle(k) {
  return {
    duration: 1.9, leaves: 'deck',
    pose(t, p) {
      const u = phase(t, 0.1, 1.6);
      const busy = Math.sin(u * Math.PI);
      k.arm(p, -0.35, 0.4 + 0.22 * Math.sin(u * TAU * 4) * busy);
      k.arm(p, -0.5, 0.5 + 0.2 * Math.sin(u * TAU * 4 + 2) * busy, busy, !k.armLeft);
      p.headAngle = k.sideSign * 0.12 * busy + 0.04 * Math.sin(u * TAU * 4);
      p.offset.y -= k.propScale * 0.02 * Math.abs(Math.sin(u * TAU * 4)) * busy;
    },
    props(ctx, t, pose) {
      const d = deckInHand(k, pose);
      const u = phase(t, 0.1, 1.6);
      const split = Math.abs(Math.sin(u * Math.PI * 3)) * Math.sin(u * Math.PI);
      if (split < 0.03) { drawDeck(ctx, d.center, k.deckW, k.deckH, d.angle, k); return; }
      const off = k.deckW * 0.62 * split;
      for (const side of [-1, 1]) {
        const c = { x: d.center.x + side * off, y: d.center.y - k.deckH * 0.10 * split };
        drawDeck(ctx, c, k.deckW, k.deckH, d.angle + side * 0.35 * split, k, { layers: 2 });
      }
      // Cards flicking between the halves.
      for (let i = 0; i < 3; i++) {
        const ph = (u * 9 + i / 3) % 1;
        const c = { x: d.center.x + (ph - 0.5) * off * 2, y: d.center.y - k.deckH * (0.2 + 0.25 * Math.sin(ph * Math.PI)) };
        drawBack(ctx, c, k.deckW * 0.8, k.deckH * 0.8, d.angle + (ph - 0.5) * 1.6, k, { opacity: 0.9 * split, seed: 5 + i });
      }
    },
  };
}
