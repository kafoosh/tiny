// The "kit" every clip is built from: the rigged figure plus the stage geometry, computed in
// one place — where the floor is, where the figure stands, which edge the other phone is
// past, how big props are — and the helpers clips use to pose arms and find hands.
//
// Unlike the single-phone reveal this grew out of (which walks to whichever side has room),
// the figure here always faces a FIXED edge: the one the other phone sits beyond.

import { P, inkColor, inkWidth } from '../rig/model.js';
import { restPose, worldHand, worldJoint } from './support.js';
import { ClipLibrary } from './routines/index.js';

export const EDGES = ['right', 'left', 'top'];

export function makeKit(rig, bounds, { edge = 'right', topInset = 96, bottomInset = 110 } = {}) {
  return new Kit(rig, bounds, edge, topInset, bottomInset);
}

export class Kit {
  constructor(rig, bounds, edge, topInset, bottomInset) {
    this.rig = rig;
    this.skel = rig.skeleton;
    this.screen = { width: bounds.width, height: bounds.height };
    this.edge = edge;
    this.sideSign = edge === 'left' ? -1 : 1;
    this.armLeft = edge === 'left';              // the arm nearest the other phone
    this.topInset = topInset;
    this.bottomInset = bottomInset;
    this.ink = inkColor(rig);
    this.lw = Math.max(inkWidth(rig) * 0.9, 3);

    const { width: W, height: H } = this.screen;
    const b = this.skel.bbox;
    this.floorY = Math.max(H * 0.5, H - bottomInset - 6);
    this.ground = this.floorY - b.maxY;
    const homeX = edge === 'top' ? W * 0.5 : W * 0.5 - this.sideSign * W * 0.10;
    this.homeDX = homeX - b.midX;
    // Props are sized to the figure, within what the page can hold.
    const room = Math.min(W * 0.75, (this.floorY - topInset) / 1.2);
    this.propScale = Math.max(60, Math.min(Math.max(b.height * 0.8, 110), room));
    this.deckW = this.propScale * 0.27;
    this.deckH = this.deckW * 1.4;

    // The drawn direction of each arm (shoulder → hand), so clips can ask for ABSOLUTE arm
    // directions whatever pose the figure was drawn in.
    const dir = (sh, hand, fallback) => {
      const dx = hand.x - sh.x, dy = hand.y - sh.y;
      return Math.hypot(dx, dy) < 2 ? fallback : Math.atan2(dy, dx);
    };
    let l = dir(this.skel.leftShoulder, this.skel.leftHand, Math.PI * 0.6);
    if (l < 0) l += 2 * Math.PI;                 // left arm angles live in [0, 2π)
    this.restL = l;
    this.restR = dir(this.skel.rightShoulder, this.skel.rightHand, Math.PI * 0.4);

    // Where the big presented card / slip sits: the open page above the figure's head.
    const headTop = b.minY + this.ground;
    this.headroom = Math.max(90, headTop - topInset - 28);

    this.clips = new ClipLibrary(this);
  }

  /// The planted rest pose every clip starts from.
  base() {
    const p = restPose(this.skel);
    p.offset = { x: this.homeDX, y: this.ground };
    return p;
  }

  /// Point an arm. `elev` is radians above horizontal, pointing AWAY from the body on that
  /// arm's own side (−π/2 hangs straight down, 0 reaches out sideways, +π/2 straight up,
  /// beyond that back over the head). `bend` curls the forearm; `w` (0…1) blends from the
  /// drawn pose. Defaults to the arm nearest the other phone.
  arm(p, elev, bend = 0, w = 1, left = this.armLeft) {
    if (left) {
      p.leftArmAngle = ((Math.PI + elev) - this.restL) * w;
      p.leftForearmAngle = bend * w;
    } else {
      p.rightArmAngle = ((-elev) - this.restR) * w;
      p.rightForearmAngle = -bend * w;
    }
  }

  hand(pose, left = this.armLeft) { return worldHand(this.rig, left, pose, ZERO); }
  shoulder(pose, left = this.armLeft) {
    return worldJoint(this.rig, left ? this.skel.leftShoulder : this.skel.rightShoulder, P.torso, pose, ZERO);
  }
  head(pose) { return worldJoint(this.rig, this.skel.headCenter, P.head, pose, ZERO); }

  /// Unit vector from the shoulder through the hand, and its angle.
  reach(pose, left = this.armLeft) {
    const h = this.hand(pose, left), s = this.shoulder(pose, left);
    const dx = h.x - s.x, dy = h.y - s.y, m = Math.hypot(dx, dy);
    return m < 1 ? { x: this.sideSign, y: 0, angle: 0 } : { x: dx / m, y: dy / m, angle: Math.atan2(dy, dx) };
  }

  /// Where a flying deck crosses the edge of the screen, given the hand it leaves / lands in.
  edgePoint(hand, rise) {
    const { width: W } = this.screen;
    if (this.edge === 'top') return { x: hand.x, y: -this.deckH };
    return { x: this.edge === 'right' ? W + this.deckH : -this.deckH, y: hand.y - rise };
  }

  /// Size + centre of the big presented card (or word slip).
  bigCard(kind) {
    const { width: W } = this.screen;
    let w, h;
    if (kind === 'word') { w = Math.min(W * 0.86, 340); h = Math.min(w * 0.36, this.headroom); }
    else { h = Math.min(this.headroom, 280, W * 0.62); w = h / 1.4; }
    return { w, h, center: { x: W / 2, y: this.topInset + 14 + h / 2 } };
  }
}

const ZERO = { x: 0, y: 0 };
