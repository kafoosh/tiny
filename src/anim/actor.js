// The figure on stage: plays clips one after another on the shared clock, blends between
// them, falls back to an idle loop, and bobs along to the background music.

import { worldPoint, copyPose } from '../rig/model.js';
import { smooth, lerp } from './support.js';
import { now } from '../clock.js';

const BLEND_MS = 180;
const POSE_KEYS = ['rootAngle', 'scaleX', 'scaleY', 'headAngle', 'leftArmAngle', 'rightArmAngle',
  'leftForearmAngle', 'rightForearmAngle', 'leftLegAngle', 'rightLegAngle', 'leftShinAngle', 'rightShinAngle'];

export class Actor {
  /// `getCtx` returns a 2D context pre-scaled to CSS pixels.
  constructor(canvas, getCtx, kit) {
    this.canvas = canvas;
    this.getCtx = getCtx;
    this.kit = kit;
    this.current = null;        // { clip, start, resolve }
    this.pending = null;        // { clip, at, resolve } — replaces `current` at `at`
    this.queue = [];
    this.beat = null;           // () → phase 0…1 within the music's beat, or -1
    this.lastPose = null;
    this.blendFrom = null;
    this.blendStart = 0;
    this.raf = 0;
    this.hold = 'none';
    this.clipName = '';         // for tests / diagnostics
  }

  start() {
    if (this.raf) return;
    const tick = () => { this.raf = requestAnimationFrame(tick); this.frame(now()); };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const ctx = this.getCtx();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  /// Replace whatever is playing with `clip` at time `at` (default: now). Anything queued is
  /// dropped. Resolves true when the clip finishes, false if it was replaced first.
  play(clip, { at = now(), name = '' } = {}) {
    this.queue = [];
    this.pending?.resolve(false);
    return new Promise((resolve) => { this.pending = { clip, at, resolve, name }; });
  }

  /// Play `clip` after everything already playing / queued.
  then(clip, name = '') {
    return new Promise((resolve) => { this.queue.push({ clip, resolve, name }); });
  }

  switchTo(entry, startMs) {
    this.current?.resolve(false);
    this.blendFrom = this.lastPose ? copyPose(this.lastPose) : null;
    this.blendStart = startMs;
    this.current = { clip: entry.clip, start: startMs, resolve: entry.resolve || (() => {}) };
    this.clipName = entry.name || '';
    if (entry.clip.hold) this.hold = entry.clip.hold;
  }

  frame(t) {
    if (this.pending && t >= this.pending.at) {
      const p = this.pending;
      this.pending = null;
      this.switchTo(p, Math.min(t, Math.max(p.at, t - 400)));     // late? start (almost) now
    }
    if (!this.current) return;
    let cur = this.current;
    let ct = (t - cur.start) / 1000;
    while (!cur.clip.loop && ct >= cur.clip.duration) {
      const end = cur.start + cur.clip.duration * 1000;
      const resolve = cur.resolve;
      this.hold = cur.clip.leaves || 'none';
      this.current = null;
      const next = this.queue.shift() || { clip: this.kit.clips.idle(this.hold), name: `idle:${this.hold}` };
      this.switchTo(next, end);
      resolve(true);
      cur = this.current;
      ct = (t - cur.start) / 1000;
    }
    const clipT = cur.clip.loop ? ct % cur.clip.duration : ct;

    let pose = this.kit.base();
    cur.clip.pose(clipT, pose);
    const beat = this.beat ? this.beat() : -1;         // a little bob in time with the music
    if (beat >= 0 && !cur.clip.still) {
      const b = 0.5 - 0.5 * Math.cos(beat * Math.PI * 2);
      pose.offset.y -= this.kit.propScale * 0.012 * b;
      pose.headAngle += 0.025 * Math.sin(beat * Math.PI * 2);
    }
    if (this.blendFrom) {
      const u = (t - this.blendStart) / BLEND_MS;
      if (u >= 1) this.blendFrom = null;
      else pose = blend(this.blendFrom, pose, smooth(u));
    }
    this.lastPose = pose;
    this.draw(pose, cur.clip, clipT, t);
  }

  draw(pose, clip, clipT, t) {
    const ctx = this.getCtx();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    const rig = this.kit.rig;
    for (const stroke of rig.strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      for (let i = 0; i < stroke.points.length; i++) {
        const w = worldPoint(rig, stroke.points[i], stroke.parts[i], pose);
        if (i === 0) ctx.moveTo(w.x, w.y); else ctx.lineTo(w.x, w.y);
      }
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    clip.props?.(ctx, clipT, pose);
  }
}

function blend(a, b, u) {
  const out = copyPose(b);
  for (const key of POSE_KEYS) out[key] = lerp(a[key], b[key], u);
  out.offset = { x: lerp(a.offset.x, b.offset.x, u), y: lerp(a.offset.y, b.offset.y, u) };
  return out;
}
