// The figure on stage: plays clips one after another on the shared clock, blends between
// them, falls back to an idle loop, and draws the "speech" that streams out of its head
// while it is talking to the other phone.

import { worldPoint, copyPose } from '../rig/model.js';
import { smooth, lerp } from './support.js';
import { sketch } from './sketchInk.js';
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
    this.speech = null;
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

  /// info = { startTime, symbolMs, tones } from a transport's transmit().
  say(info) { this.speech = info; }

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
    const speaking = this.speakingAt(t);
    if (speaking) {                                   // chatter: the head bobs with each note
      pose.headAngle += 0.07 * Math.sin((t - this.speech.startTime) / this.speech.symbolMs * Math.PI);
      pose.scaleY *= 1 + 0.012 * Math.sin((t - this.speech.startTime) / this.speech.symbolMs * Math.PI * 2);
    }
    if (this.blendFrom) {
      const u = (t - this.blendStart) / BLEND_MS;
      if (u >= 1) this.blendFrom = null;
      else pose = blend(this.blendFrom, pose, smooth(u));
    }
    this.lastPose = pose;
    this.draw(pose, cur.clip, clipT, t);
  }

  speakingAt(t) {
    const s = this.speech;
    return !!s && t >= s.startTime && t < s.startTime + s.tones.length * s.symbolMs;
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
    this.drawSpeech(ctx, pose, t);
  }

  /// Each note the figure "says" pops out by its head as a little dash and drifts toward
  /// the other phone, higher notes floating higher — a visible stream of chatter.
  drawSpeech(ctx, pose, t) {
    const s = this.speech;
    if (!s) return;
    const k = this.kit;
    const life = 520;
    const total = s.tones.length * s.symbolMs;
    if (t < s.startTime || t > s.startTime + total + life) { if (t > s.startTime + total + life) this.speech = null; return; }
    const head = k.head(pose);
    const r = k.skel.headRadius || k.propScale * 0.15;
    const up = k.edge === 'top';
    const first = Math.max(0, Math.floor((t - s.startTime - life) / s.symbolMs));
    const last = Math.min(s.tones.length - 1, Math.floor((t - s.startTime) / s.symbolMs));
    for (let i = first; i <= last; i++) {
      const age = (t - (s.startTime + i * s.symbolMs)) / life;
      if (age < 0 || age > 1) continue;
      const tone = s.tones[i] / 15 - 0.5;
      const travel = r * (1.25 + 2.2 * age);
      const c = up
        ? { x: head.x + tone * r * 2.2, y: head.y - travel }
        : { x: head.x + k.sideSign * travel, y: head.y - r * 0.2 - tone * r * 1.8 - r * 0.5 * age };
      const len = r * 0.28;
      const a = up ? { x: c.x, y: c.y - len } : { x: c.x + k.sideSign * len, y: c.y - len * 0.5 };
      sketch(ctx, [c, a], k.ink, Math.max(2, k.lw * 0.7), { amp: 1, seed: i, opacity: Math.sin(Math.min(1, age * 4) * Math.PI / 2) * (1 - age) });
    }
  }
}

function blend(a, b, u) {
  const out = copyPose(b);
  for (const key of POSE_KEYS) out[key] = lerp(a[key], b[key], u);
  out.offset = { x: lerp(a.offset.x, b.offset.x, u), y: lerp(a.offset.y, b.offset.y, u) };
  return out;
}
