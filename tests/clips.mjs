// Adapts this app's clips to the { totalDuration, pose(t) } shape the rig harness sweeps, so
// the fitter's regression gates (no flung limbs, no torn seams) run against the motion the
// figures actually perform here — on both a side edge and the top edge.

import { makeKit } from '../src/anim/setup.js';

const CARD = { kind: 'card', value: 7, suit: 'hearts' };
const BUILD = {
  wake: (c) => c.wake(), wave: (c) => c.wave(), cheer: (c) => c.cheer('deck'), produce: (c) => c.produce(),
  throwDeck: (c) => c.throwDeck(), catchDeck: (c) => c.catchDeck(), shuffle: (c) => c.shuffle(),
  showPick: (c) => c.showPick({ strokes: [], box: { minX: 0, minY: 0, w: 1, h: 1 } }), reveal: (c) => c.reveal(CARD), idleWait: (c) => c.idle('wait'),
};
export const SLOTS = Object.keys(BUILD).flatMap((n) => [`${n}@right`, `${n}@left`, `${n}@top`]);

export function makeSetup(rig, bounds, _offset, topInset, bottomInset) {
  return { rig, bounds, topInset, bottomInset };
}

export function makeRoutine(slot, s) {
  const [name, edge] = slot.split('@');
  const kit = makeKit(s.rig, s.bounds, { edge, topInset: s.topInset, bottomInset: s.bottomInset });
  const clip = BUILD[name](kit.clips);
  const totalDuration = Number.isFinite(clip.duration) ? clip.duration : 6;
  return { kit, clip, totalDuration, pose(t) { const p = kit.base(); clip.pose(t, p); return p; } };
}
