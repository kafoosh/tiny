// Everyday clips: coming to life, standing around, waving hello.
//
// A clip is { duration, loop?, leaves?, pose(t, p), props?(ctx, t, pose) }:
//   • `pose` mutates `p`, a fresh planted rest pose (see Kit.base);
//   • `props` draws whatever the figure is holding or doing, in screen space;
//   • `leaves` says what is in its hand afterwards ('none' | 'deck'), which picks the idle
//     clip that follows; `duration: Infinity` holds until something replaces it.

import { DropLand, smooth, easeOut, easeIn, phase } from '../support.js';
import { drawDeck } from '../../cards.js';

const TAU = Math.PI * 2;

/// Drop from where it was drawn, land with a squash, then hop over to its mark.
export function wake(k) {
  const drop = new DropLand(0.7, 0.4, k.ground);
  const hopEnd = drop.done + 0.8;
  return {
    duration: hopEnd + 0.5, leaves: 'none',
    pose(t, p) {
      p.offset = { x: 0, y: 0 };
      drop.apply(p, Math.min(t, drop.done));
      if (t <= drop.done) return;
      const u = smooth(phase(t, drop.done, hopEnd));
      const bounce = Math.abs(Math.sin(u * TAU));
      p.offset.x = k.homeDX * u;
      p.offset.y = k.ground - k.propScale * 0.11 * bounce;
      p.scaleY = 1 + 0.05 * bounce; p.scaleX = 1 - 0.03 * bounce;
      p.leftArmAngle = 0.35 * bounce; p.rightArmAngle = -0.35 * bounce;
      p.headAngle = 0.12 * Math.sin(phase(t, hopEnd, hopEnd + 0.5) * TAU) * k.sideSign;
    },
  };
}

/// Standing around. `hold`: 'none' | 'deck' (deck in hand) | 'wait' (ready to catch).
export function idle(k, hold = 'none') {
  return {
    duration: 4, loop: true, leaves: hold === 'deck' ? 'deck' : 'none', hold,
    pose(t, p) {
      const breath = Math.sin(TAU * t / 2);
      p.scaleY = 1 + 0.012 * breath; p.scaleX = 1 - 0.006 * breath;
      p.headAngle = 0.05 * Math.sin(TAU * t / 4);
      if (hold === 'deck') k.arm(p, -0.5 + 0.03 * breath, 0.4);
      if (hold === 'wait') {
        k.arm(p, -0.25 + 0.05 * breath, 0.2);
        p.rootAngle = k.sideSign * 0.04;
        p.headAngle += k.sideSign * 0.10;
      }
    },
    props(ctx, t, pose) { if (hold === 'deck') heldDeck(ctx, k, pose); },
  };
}

/// A big hello toward the other phone, with a little hop.
export function wave(k) {
  return {
    duration: 1.3, leaves: 'none',
    pose(t, p) {
      const w = easeOut(phase(t, 0, 0.25)) * (1 - easeIn(phase(t, 1.05, 1.3)));
      k.arm(p, 0.95 + 0.4 * Math.sin(TAU * 3 * t), 0.2 * Math.sin(TAU * 3 * t + 1), w);
      const hop = Math.sin(phase(t, 0.1, 0.5) * Math.PI);
      p.offset.y -= k.propScale * 0.09 * hop;
      p.headAngle = k.sideSign * 0.12 * w;
      p.rootAngle = k.sideSign * 0.05 * w;
    },
  };
}

/// A happy little bounce (heard the other one answer).
export function cheer(k, hold = 'none') {
  return {
    duration: 0.8, leaves: hold === 'deck' ? 'deck' : 'none',
    pose(t, p) {
      const u = phase(t, 0, 0.8), b = Math.abs(Math.sin(u * TAU));
      p.offset.y -= k.propScale * 0.10 * b * (1 - u * 0.4);
      p.scaleY = 1 + 0.04 * b;
      if (hold === 'deck') k.arm(p, -0.5 + 0.5 * b, 0.4);
      k.arm(p, -0.2 + 0.9 * b, 0, Math.sin(u * Math.PI), !k.armLeft);
      p.headAngle = 0.08 * Math.sin(u * TAU * 2);
    },
    props(ctx, t, pose) { if (hold === 'deck') heldDeck(ctx, k, pose); },
  };
}

/// Where a held deck sits and how it is tilted: just past the hand, along the arm.
export function deckInHand(k, pose) {
  const hand = k.hand(pose), r = k.reach(pose);
  return {
    center: { x: hand.x + r.x * k.deckH * 0.18, y: hand.y + r.y * k.deckH * 0.18 - k.deckH * 0.12 },
    angle: k.sideSign * 0.18 + pose.rootAngle,
  };
}

export function heldDeck(ctx, k, pose, opacity = 1) {
  const d = deckInHand(k, pose);
  drawDeck(ctx, d.center, k.deckW, k.deckH, d.angle, k, { opacity });
}
