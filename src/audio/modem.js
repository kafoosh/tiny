// The real transport: speaker + microphone.

import { Demodulator, modulate, frameSymbols, ultraUsable } from './codec.js';
import { now } from '../clock.js';

export class AudioTransport {
  constructor(engine) {
    this.engine = engine;
    this.onFrame = null;
    this.kind = 'audio';
    this.demod = null;
    this.base = 0;            // context frame of the demodulator's sample 0
    this.expect = -1;         // next context frame we expect from the tap
    this.inputLatency = 0.02;
    this.onVoice = null;      // fires once, after listenForVoice(), when someone speaks up
    this.voice = { armed: false, floor: 0, run: 0 };
  }

  /// Must be called from a user gesture (it unlocks audio and asks for the microphone).
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !this.engine.open({ mic: true })) throw new Error('no-audio');
    const ctx = this.ctx = this.engine.ctx;
    // The three processing flags are essential: left on, the browser "cleans away" exactly
    // the tones we are listening for (and on iOS switches the speaker to a quiet call mode).
    const stream = this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    });
    // The permission prompt often leaves the context paused, and can reset the session.
    this.engine.unlock();
    const lat = stream.getAudioTracks()[0]?.getSettings?.().latency;
    if (lat > 0 && lat < 0.5) this.inputLatency = lat;

    this.newDemod();
    const src = ctx.createMediaStreamSource(stream);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    let node;
    try {
      await ctx.audioWorklet.addModule(new URL('./rx-worklet.js', import.meta.url));
      node = new AudioWorkletNode(ctx, 'rx-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        channelCountMode: 'explicit' });
      node.port.onmessage = (e) => this.chunk(e.data.pcm, e.data.frame);
    } catch {
      node = ctx.createScriptProcessor(2048, 1, 1);
      let frame = 0;
      node.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        if (!frame) frame = Math.round(e.playbackTime * ctx.sampleRate);
        this.chunk(data, frame);
        frame += data.length;
      };
    }
    src.connect(node);
    node.connect(mute);
    this.node = node; this.src = src;
    // The tune's fill keeps out of the way while a message is going out or coming in.
    this.engine.music.busy = () => ctx.currentTime < this.engine.speakingUntil || this.demod.candidates.length > 0;
  }

  newDemod() {
    this.demod = new Demodulator(this.ctx.sampleRate, (f) => this.deliver(f));
  }

  chunk(pcm, frame) {
    if (frame !== this.expect) {          // first batch, or the audio thread glitched: re-anchor
      this.newDemod();
      this.base = frame;
    }
    this.expect = frame + pcm.length;
    if (this.voice.armed) this.hearVoice(pcm);
    this.demod.push(pcm);
  }

  /// Start waiting for a voice: not what is said, just that somebody said something.
  listenForVoice() { this.voice = { armed: true, floor: 0, run: 0, seen: 0 }; }

  /// Loudness against the room's own level: a few batches in a row well above it is speech
  /// (or a clap, or a laugh — all fine).
  hearVoice(pcm) {
    const v = this.voice;
    let e = 0;
    for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i];
    const rms = Math.sqrt(e / pcm.length);
    v.seen += 1;
    if (v.seen <= 12) { v.floor += (rms - v.floor) / v.seen; return; }     // learn the room first
    const loud = rms > Math.max(0.004, v.floor * 3.5);
    v.run = loud ? v.run + 1 : Math.max(0, v.run - 1);
    if (!loud) v.floor += (rms - v.floor) * 0.05;
    if (v.run >= 3) { v.armed = false; this.onVoice?.(); }
  }

  deliver(f) {
    const ctxSeconds = (this.base + f.endSample) / this.ctx.sampleRate;
    const endTime = now() - (this.ctx.currentTime - ctxSeconds) * 1000 - this.inputLatency * 1000;
    this.onFrame?.({ ...f, endTime });
  }

  async transmit(frame, opts = {}) {
    this.engine.unlock();
    return this.engine.speak(frame, frameSymbols, modulate, { ...opts, ultra: ultraUsable(this.ctx.sampleRate) });
  }

  /// Latest per-tone levels (ultra 0…15, chime 16…23), for the diagnostics overlay.
  levels() { return this.demod ? this.demod.levels : null; }
}
