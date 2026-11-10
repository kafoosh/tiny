// Selection packing and the ACK / retry conversation, over an in-memory transport pair.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Link, T, ROLE, encodeSelection, decodeSelection, cleanWord, WORD_MAX } from '../src/link/protocol.js';
import { frameSymbols, MAX_PAYLOAD } from '../src/audio/codec.js';
import { SUITS } from '../src/faces.js';
import { now } from '../src/clock.js';

test('every card survives the round trip in one byte', () => {
  for (const suit of SUITS) for (let value = 1; value <= 13; value++) {
    const bytes = encodeSelection({ kind: 'card', value, suit });
    assert.equal(bytes.length, 1);
    assert.deepEqual(decodeSelection(bytes), { kind: 'card', value, suit });
  }
});

test('words survive the round trip and fit one frame', () => {
  for (const text of ['a', 'hi', 'pineapple', "don't panic!", 'zzzzzzzzzzzzzzzz', 'what? no.', 'x-ray specs']) {
    const bytes = encodeSelection({ kind: 'word', text });
    assert.ok(bytes.length <= MAX_PAYLOAD, `${text}: ${bytes.length} bytes`);
    assert.deepEqual(decodeSelection(bytes), { kind: 'word', text });
  }
  assert.equal(cleanWord('  HeLLo,   Wörld#1  '), ' hello wrld ');
  assert.equal(cleanWord('a'.repeat(40)).length, WORD_MAX);
  assert.equal(decodeSelection([60]), null);
  assert.equal(decodeSelection([0x85, 1]), null);
});

/// Two transports wired to each other with frame-accurate timing, sped up 10×.
function pair({ dropFirst = 0 } = {}) {
  const mk = () => ({ onFrame: null, sent: [] });
  const a = mk(), b = mk();
  let drops = dropFirst;
  const wire = (from, to) => {
    from.transmit = async (frame, opts) => {
      const dur = frameSymbols(frame).length * 5;
      const sent = opts.stamp ? { ...frame, payload: [42, ...frame.payload.slice(1)] } : frame;
      const info = { frame: sent, startTime: now(), endTime: now() + dur, symbols: [] };
      from.sent.push({ frame: sent, opts });
      if (!(drops-- > 0)) setTimeout(() => to.onFrame({ ...sent, band: 'both', endTime: info.endTime }), dur + 2);
      return info;
    };
  };
  wire(a, b); wire(b, a);
  return [a, b];
}

test('a message is acknowledged and handled exactly once', async () => {
  const [ta, tb] = pair();
  const m = new Link(ta, ROLE.magician), s = new Link(tb, ROLE.spectator);
  const got = [];
  s.on(T.THROW, (p) => got.push(p));
  assert.equal(await m.send(T.THROW, [7]), true);
  assert.deepEqual(got, [[7]]);
  assert.equal(ta.sent.length, 1);
  assert.equal(tb.sent[0].frame.type, T.ACK);
});

test('a lost message is sent again; the repeat is not handled twice', async () => {
  const [ta, tb] = pair({ dropFirst: 1 });
  const m = new Link(ta, ROLE.magician), s = new Link(tb, ROLE.spectator);
  let n = 0;
  s.on(T.HELLO, () => { n += 1; });
  assert.equal(await m.send(T.HELLO), true);
  assert.equal(n, 1);
  assert.equal(ta.sent.length, 2);
});

test('a stamped message carries the music position the transport wrote into it', async () => {
  const [ta, tb] = pair();
  const m = new Link(ta, ROLE.magician), s = new Link(tb, ROLE.spectator);
  const got = [];
  s.on(T.HELLO, (p) => got.push(p));
  assert.equal(await m.send(T.HELLO, [0], null, { stamp: true }), true);
  assert.deepEqual(got, [[42]]);
});

test('a lost ACK causes a repeat that is re-acknowledged but handled once', async () => {
  const [ta, tb] = pair();
  const m = new Link(ta, ROLE.magician), s = new Link(tb, ROLE.spectator);
  let n = 0, swallowed = false;
  s.on(T.THROW, () => { n += 1; });
  const deliver = ta.onFrame;
  ta.onFrame = (f) => { if (!swallowed && f.type === T.ACK) { swallowed = true; return; } deliver(f); };
  assert.equal(await m.send(T.THROW), true);
  assert.equal(n, 1);
  assert.equal(tb.sent.filter((x) => x.frame.type === T.ACK).length, 2);
});

test('nobody listening: gives up after four attempts', async () => {
  const [ta] = pair({ dropFirst: 99 });
  const m = new Link(ta, ROLE.magician);
  assert.equal(await m.send(T.HELLO), false);
  assert.equal(ta.sent.length, 4);
});

test('a device ignores its own voice', async () => {
  const [ta] = pair();
  const m = new Link(ta, ROLE.magician);
  let n = 0;
  m.on(T.THROW, () => { n += 1; });
  ta.onFrame({ type: T.THROW, role: ROLE.magician, seq: 1, payload: [], endTime: now() });
  assert.equal(n, 0);
  assert.equal(ta.sent.length, 0);
});
