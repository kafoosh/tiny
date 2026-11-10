// A stand-in transport for development and automated tests: two tabs of one browser talk
// over a BroadcastChannel instead of through the air. Same interface and same timing as the
// audio modem. Never used in a real performance (select with ?link=loopback).
//
//   ?drop=N      lose the first N transmissions (exercises retries)
//   ?noultra=1   only frames sent with audible data arrive (exercises the hybrid fallback)

import { frameSymbols, coverSymbols, SYMBOL_SECONDS } from '../audio/codec.js';
import { now } from '../clock.js';

export class LoopbackTransport {
  constructor(params = new URLSearchParams()) {
    this.onFrame = null;
    this.drop = Number(params.get('drop') || 0);
    this.noUltra = params.get('noultra') === '1';
    this.kind = 'loopback';
  }

  async start() {
    this.channel = new BroadcastChannel('tiny-loopback');
    this.channel.onmessage = (e) => {
      const { frame, endTime, voiceData } = e.data;
      if (this.noUltra && !voiceData) return;
      setTimeout(() => this.onFrame?.({ ...frame, band: voiceData && this.noUltra ? 'voice' : 'ultra', endTime }),
        Math.max(0, endTime + 25 - now()));
    };
  }

  async transmit(frame, { voiceData = false } = {}) {
    const syms = frameSymbols(frame);
    const symbolMs = SYMBOL_SECONDS * 1000;
    const startTime = now() + 70;
    const endTime = startTime + syms.length * symbolMs;
    if (this.drop > 0) this.drop -= 1;
    else this.channel.postMessage({ frame, endTime, voiceData });
    return { startTime, endTime, symbolMs, tones: voiceData ? syms : coverSymbols(syms.length) };
  }

  levels() { return null; }
}
