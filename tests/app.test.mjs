// Whole-app invariants that don't need a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { throwStart, catchStart, THROW_WINDUP, RELEASE_AFTER, FLIGHT_OUT, FLIGHT_IN } from '../src/anim/timing.js';
import { fit } from '../src/rig/fitter.js';
import { nonArticulated } from '../src/rig/model.js';
import { makeKit, EDGES } from '../src/anim/setup.js';
import { deckInHand } from '../src/anim/routines/basics.js';
import * as F from './figures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the service worker precaches every file the app loads (offline = complete)', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|html|png|woff2|webmanifest))'/g)].map((m) => m[1]));
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const needed = [...walk('src'), 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.png', 'fonts/ShareTechMono.woff2', 'fonts/ArchitectsDaughter.woff2'];
  for (const f of needed) assert.ok(listed.has(f), `${f} is missing from sw.js`);
  for (const f of listed) assert.ok(fs.existsSync(path.join(root, f)), `sw.js lists ${f}, which does not exist`);
});

test('nothing in the shipped app reaches for the network', () => {
  const files = ['index.html', 'styles.css', ...fs.readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((f) => String(f).endsWith('.js')).map((f) => `src/${f}`)];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (!/model-data|words\.js/.test(f)) assert.ok(!/https?:\/\//.test(text.replace(/\/\/.*$/gm, '')), `${f} contains an absolute URL`);
    assert.ok(!/\b(XMLHttpRequest|WebSocket|RTCPeerConnection|sendBeacon)\b/.test(text), `${f} uses a network API`);
  }
});

test('the deck leaves one screen before it appears on the other', () => {
  const frameEnd = 10_000;
  const leavesHand = throwStart(frameEnd) + THROW_WINDUP * 1000;
  assert.equal(leavesHand, frameEnd + RELEASE_AFTER);
  const offScreen = leavesHand + FLIGHT_OUT * 1000;
  assert.ok(catchStart(frameEnd) > offScreen, 'a moment in the air between the phones');
  assert.ok(catchStart(frameEnd) - offScreen < 250, 'but not long enough to look broken');
  assert.ok(throwStart(frameEnd) > frameEnd - 600, 'the wind-up fits inside even the shortest frame');
  assert.ok(FLIGHT_IN > 0.2);
});

test('throw and catch meet the hand: the deck is continuous across release and landing', () => {
  const bounds = { width: 390, height: 844 };
  const { strokes } = F.build(F.makeSpec({ head: 'circle', torso: 'spineLine', arm: 'lineDown', leg: 'lineStraight', seed: 7 }));
  for (const rig of [fit(strokes), nonArticulated(fit(strokes))]) {
    for (const edge of EDGES) {
      const kit = makeKit(rig, bounds, { edge });
      const p = kit.base();
      kit.clips.throwDeck().pose(THROW_WINDUP, p);
      const from = deckInHand(kit, p).center;
      const exit = kit.edgePoint(from, 0);
      if (edge === 'right') assert.ok(exit.x > bounds.width);
      if (edge === 'left') assert.ok(exit.x < 0);
      if (edge === 'top') assert.ok(exit.y < 0);
      const q = kit.base();
      kit.clips.catchDeck().pose(FLIGHT_IN, q);
      const land = deckInHand(kit, q).center;
      assert.ok(land.x > 0 && land.x < bounds.width && land.y > 0 && land.y < bounds.height, `${edge}: lands on the page`);
      for (const b of [kit.bigCard('card'), kit.bigCard('word'), kit.bigCard('note')]) {
        assert.ok(b.center.x - b.w / 2 >= 0 && b.center.x + b.w / 2 <= bounds.width, 'presented face fits the width');
        assert.ok(b.center.y - b.h / 2 >= 0, 'presented face fits under the top');
      }
    }
  }
});
