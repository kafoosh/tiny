// A stand-in transport for development and automated tests: two tabs of one browser talk
// over a BroadcastChannel instead of through the air. Same interface, same timing, and the
// same sounds from the speaker as the audio modem — it just doesn't listen. Never used in a
// real performance (select with ?link=loopback).
//
//   ?drop=N      lose the first N transmissions (exercises retries)

import { modulate, frameSymbols, SYMBOL_SECONDS } from '../audio/codec.js';
import { now } from '../clock.js';

export class LoopbackTransport {
  constructor(engine, params = new URLSearchParams()) {
    this.engine = engine;
    this.onFrame = null;
    this.onVoice = null;
    this.drop = Number(params.get('drop') || 0);
    this.kind = 'loopback';
  }

  async start() {
    this.engine.open({ mic: false });          // sound is a nicety here; carry on without it
    this.channel = new BroadcastChannel('tiny-loopback');
    this.channel.onmessage = (e) => {
      const { frame, endTime } = e.data;
      setTimeout(() => this.onFrame?.({ ...frame, band: 'both', endTime }), Math.max(0, endTime + 25 - now()));
    };
  }

  async transmit(frame, opts = {}) {
    let info;
    if (this.engine.ready) info = this.engine.speak(frame, frameSymbols, modulate, opts);
    else {
      const startTime = now() + 70, symbols = frameSymbols(frame);
      info = { frame, startTime, endTime: startTime + symbols.length * SYMBOL_SECONDS * 1000, symbols };
    }
    if (this.drop > 0) this.drop -= 1;
    else this.channel.postMessage({ frame: info.frame, endTime: info.endTime });
    return info;
  }

  /// No microphone here: pretend someone spoke after a moment.
  listenForVoice() { setTimeout(() => this.onVoice?.(), 900); }

  levels() { return null; }
}
