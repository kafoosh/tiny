// The real transport: speaker + microphone. Wraps the codec in Web Audio.

import { Demodulator, modulate, frameSymbols, coverSymbols, ultraUsable, SYMBOL_SECONDS } from './codec.js';
import { now } from '../clock.js';

export class AudioTransport {
  constructor() {
    this.onFrame = null;
    this.kind = 'audio';
    this.ctx = null;
    this.demod = null;
    this.base = 0;            // context frame of the demodulator's sample 0
    this.expect = -1;         // next context frame we expect from the tap
    this.inputLatency = 0.02;
  }

  /// Must be called from a user gesture (it unlocks audio and asks for the microphone).
  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices?.getUserMedia) throw new Error('no-audio');
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    // iOS: keep the loudspeaker (not the earpiece) while the microphone is open.
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* optional */ }
    const resume = ctx.resume();
    // The three processing flags are essential: left on, the browser "cleans away" exactly
    // the tones we are listening for.
    const stream = this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    });
    await resume;
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

    document.addEventListener('visibilitychange', () => { if (!document.hidden) ctx.resume(); });
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
    this.demod.push(pcm);
  }

  /// Context time (seconds) → the shared clock, for something happening at the microphone.
  micTime(ctxSeconds) {
    return now() - (this.ctx.currentTime - ctxSeconds) * 1000 - this.inputLatency * 1000;
  }

  deliver(f) {
    const endTime = this.micTime((this.base + f.endSample) / this.ctx.sampleRate);
    this.onFrame?.({ ...f, endTime });
  }

  async transmit(frame, { voiceData = false } = {}) {
    const ctx = this.ctx;
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* keep going */ } }
    const sr = ctx.sampleRate;
    const syms = frameSymbols(frame);
    const ultra = ultraUsable(sr) ? syms : null;
    const tones = (voiceData || !ultra) ? syms : coverSymbols(syms.length);
    const { pcm, lead } = modulate({ ultra, voice: tones }, sr);
    const buffer = ctx.createBuffer(1, pcm.length, sr);
    buffer.getChannelData(0).set(pcm);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.06;
    source.start(t0);
    const outLatency = (ctx.outputLatency || ctx.baseLatency || 0.02) * 1000;
    const startTime = now() + (t0 - ctx.currentTime) * 1000 + (lead / sr) * 1000 + outLatency;
    const symbolMs = SYMBOL_SECONDS * 1000;
    return { startTime, endTime: startTime + syms.length * symbolMs, symbolMs, tones };
  }

  /// Latest per-tone levels (ultra 0…15, voice 16…31), for the diagnostics overlay.
  levels() { return this.demod ? this.demod.levels : null; }
}
