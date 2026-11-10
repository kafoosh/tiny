// The page's one AudioContext and its life cycle, shared by the music and the data link.
// The phone-proofing follows kafoosh/play:
//   • build the context inside a tap, and play a silent blip there to fully wake iOS;
//   • claim the iOS audio session, so sound comes out of the loudspeaker even with the
//     silent switch on ('play-and-record' when the microphone is open, else 'playback');
//   • call unlock() on EVERY tap, and keep nudging a paused context back to life, because
//     phones suspend audio whenever they like (a permission prompt, a notification, a
//     trip to another app).

import { Music } from './music.js';
import { now } from '../clock.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.music = null;
    this.out = null;
    this.retry = 0;
  }

  get ready() { return !!this.ctx; }

  /// Must run inside a user gesture. Safe to call again.
  open({ mic = false } = {}) {
    if (this.ctx) { this.unlock(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.sessionType = mic ? 'play-and-record' : 'playback';
    this.claimSession();
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.ctx = null; return false; }
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(ctx.destination);
    this.music = new Music(ctx, this.out);
    this.speakingUntil = 0;   // context time our own current message ends
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, 22050);
    blip.connect(ctx.destination);
    blip.start(0);
    setInterval(() => this.tick(), 30);
    ctx.onstatechange = () => { if (ctx.state !== 'running') this.retry = 0; };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.unlock(); });
    window.addEventListener('pageshow', () => this.unlock());
    this.unlock();
    return true;
  }

  claimSession() {
    try { const s = navigator.audioSession; if (s && s.type !== this.sessionType) s.type = this.sessionType; } catch { /* not supported */ }
  }

  /// Wake the context if the phone paused it. Called from every tap.
  unlock() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    this.claimSession();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  tick() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      // On screen but paused: try about once a second. Where a tap is required, the next
      // tap's unlock() does it.
      if (document.visibilityState === 'visible' && (this.retry++ % 33) === 0) ctx.resume().catch(() => {});
      return;
    }
    this.music.tick();
  }

  /// Shared clock (ms) ↔ context time (s), for something scheduled on the output.
  toCtx(epoch) { return this.ctx.currentTime + (epoch - now()) / 1000; }
  toEpoch(ctxTime) { return now() + (ctxTime - this.ctx.currentTime) * 1000; }
  get outputLatency() { return (this.ctx.outputLatency || this.ctx.baseLatency || 0.02) * 1000; }

  /// Play samples starting at context time `at`.
  play(pcm, at) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    src.start(at);
  }

  /// Play a message, starting on the music's next 16th note. If `stamp` is set, the
  /// first payload byte is overwritten with the loop position at the frame's end, so the
  /// listener can lock its own music to ours. Returns the frame as sent and its timing.
  speak(frame, symbolsOf, modulate, { stamp = false, ultra = true, chime = false } = {}) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const t0 = this.music.nextBeat(ctx.currentTime + 0.07);
    let sent = frame;
    const count = symbolsOf(frame).length;
    if (stamp && this.music.playing) {
      sent = { ...frame, payload: [this.music.positionAt(t0) + count & 127, ...frame.payload.slice(1)] };
    }
    const syms = symbolsOf(sent);
    // Ultrasonic only unless the chimes are asked for (or are all this phone can do).
    const { pcm, lead } = modulate({ ultra: ultra ? syms : null, chime: chime || !ultra ? syms : null }, sr);
    this.play(pcm, t0 - lead / sr);
    this.speakingUntil = t0 + pcm.length / sr;
    const startTime = this.toEpoch(t0) + this.outputLatency;
    return { frame: sent, startTime, endTime: startTime + syms.length * (1000 * pcmSymbol(sr, pcm, lead, syms.length)), symbols: syms };
  }
}

// Seconds per symbol as actually rendered at this sample rate (differs from the nominal
// value by a rounding sample or two; using it keeps long frames on time).
function pcmSymbol(sr, pcm, lead, count) {
  return (pcm.length - lead - Math.round(sr * 0.12)) / count / sr;
}
