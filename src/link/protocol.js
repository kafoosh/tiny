// The conversation between the two phones. Strict turn-taking over a half-duplex transport:
// every message is acknowledged, and an unacknowledged one is simply played again.
//
// A transport provides:
//   start() → Promise
//   transmit(frame, { stamp }) → { frame, startTime, endTime, symbols }      (times: clock.js)
//   onFrame = (frame) => …      frame = { type, role, seq, payload, band, endTime }
// With `stamp`, the transport overwrites payload[0] with the music's loop position at the
// frame's end, which lets the listener lock its own music to the sender's.

import { frameLength, SYMBOL_SECONDS } from '../audio/codec.js';
import { now } from '../clock.js';
import { SUITS } from '../faces.js';

export const T = Object.freeze({ HELLO: 0, THROW: 1, RETURN: 2, ACK: 3 });
export const ROLE = Object.freeze({ magician: 0, spectator: 1 });

export const WORD_MAX = 16;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz '-!?.";      // 32 symbols → 5 bits each

/// Keep only what the link can carry.
export function cleanWord(s) {
  return Array.from(String(s).toLowerCase()).filter((c) => ALPHABET.includes(c)).join('')
    .replace(/\s+/g, ' ').slice(0, WORD_MAX);
}

/// selection = { kind:'card', value:1…13, suit } | { kind:'word', text }
export function encodeSelection(sel) {
  if (sel.kind === 'card') return [SUITS.indexOf(sel.suit) * 13 + (sel.value - 1)];
  const text = cleanWord(sel.text);
  const out = [0x80 | text.length];
  let acc = 0, bits = 0;
  for (const ch of text) {
    acc = (acc << 5) | ALPHABET.indexOf(ch); bits += 5;
    while (bits >= 8) { out.push((acc >> (bits - 8)) & 0xFF); bits -= 8; }
  }
  if (bits) out.push((acc << (8 - bits)) & 0xFF);
  return out;
}

export function decodeSelection(bytes) {
  if (!bytes.length) return null;
  if (!(bytes[0] & 0x80)) {
    if (bytes[0] > 51) return null;
    return { kind: 'card', value: (bytes[0] % 13) + 1, suit: SUITS[Math.floor(bytes[0] / 13)] };
  }
  const n = bytes[0] & 0x7F;
  if (n > WORD_MAX || bytes.length < 1 + Math.ceil(n * 5 / 8)) return null;
  let text = '', acc = 0, bits = 0, i = 1;
  while (text.length < n) {
    if (bits < 5) { acc = ((acc & 0xFF) << 8) | bytes[i++]; bits += 8; }
    text += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5;
  }
  return { kind: 'word', text };
}

const ACK_DELAY = 150;                                                // ms after a frame ends
// The answer starts on the far phone's next beat, so allow for that as well.
const ACK_WAIT = ACK_DELAY + frameLength(0) * SYMBOL_SECONDS * 1000 + 950;
export const MAX_ATTEMPTS = 4;
const sleepUntil = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - now())));

export class Link {
  constructor(transport, role) {
    this.transport = transport;
    this.role = role;
    this.seq = Math.floor(Math.random() * 16);
    this.handlers = new Map();
    this.pendingAck = null;         // { seq, resolve }
    this.lastHandled = null;
    this.busy = false;
    transport.onFrame = (f) => this.receive(f);
  }

  on(type, fn) { this.handlers.set(type, fn); }

  /// Send `type` until the other phone answers. Resolves true when acknowledged, false if
  /// every attempt went unanswered. `onAttempt(info, attempt)` fires as each one starts.
  async send(type, payload = [], onAttempt = null, { stamp = false } = {}) {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.seq = (this.seq + 1) & 15;
      const frame = { type, role: this.role, seq: this.seq, payload };
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const info = await this.transport.transmit(frame, { stamp });
        onAttempt?.(info, attempt);
        const acked = await new Promise((resolve) => {
          this.pendingAck = { seq: frame.seq, resolve };
          sleepUntil(info.endTime + ACK_WAIT).then(() => resolve(false));
        });
        this.pendingAck = null;
        if (acked) return true;
      }
      return false;
    } finally { this.busy = false; }
  }

  receive(f) {
    if (f.role === this.role) return;                 // our own speaker, heard by our own mic
    if (f.type === T.ACK) {
      if (this.pendingAck && this.pendingAck.seq === f.seq) this.pendingAck.resolve(true);
      return;
    }
    const key = `${f.type}:${f.seq}`;
    const repeat = key === this.lastHandled;          // a replay of something we already did
    this.lastHandled = key;
    if (!repeat) this.handlers.get(f.type)?.(f.payload, f);
    sleepUntil(f.endTime + ACK_DELAY).then(() => {
      this.transport.transmit({ type: T.ACK, role: this.role, seq: f.seq, payload: [] }, {});
    });
  }
}
