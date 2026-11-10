// Tiny — two phones, two drawn figures, one deck of cards thrown between them.
//
// What the audience sees: the figures chatter, one throws a deck off the edge of its screen,
// the other catches it; the spectator picks a card (or writes a word), it is shuffled away and
// thrown back, and the magician's figure finds it.
//
// How: the chatter is a data link (src/audio). Nothing here touches the network after load.

import { LG } from './palette.js';
import { drawBackdrop } from './backdrop.js';
import { Drawing } from './drawing.js';
import { fit } from './rig/fitter.js';
import { stabilizeSeams } from './rig/seams.js';
import { rigIsConfident, nonArticulated } from './rig/model.js';
import { makeKit, EDGES } from './anim/setup.js';
import { Actor } from './anim/actor.js';
import { throwStart, catchStart } from './anim/timing.js';
import { FONT_FAMILY } from './reveal.js';
import { Link, T, ROLE, encodeSelection, decodeSelection } from './link/protocol.js';
import { AudioTransport } from './audio/modem.js';
import { LoopbackTransport } from './link/loopback.js';
import { Picker } from './ui/picker.js';
import { now } from './clock.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state

const app = {
  role: null,             // 'magician' | 'spectator'
  edge: 'right',          // which edge of THIS screen the other phone is past
  step: 'role',           // see the flows below
  selection: null,        // spectator: what they chose · magician: what was revealed
  round: 0,
};
let transport = null, link = null, actor = null, kit = null;
let pendingTap = null;    // what a tap on the page does right now

// ---------------------------------------------------------------- canvases

const paperCanvas = $('paper'), inkCanvas = $('ink'), stageCanvas = $('stage');
const ctxOf = (c) => c.getContext('2d');
let dpr = 1, stageSize = { width: 0, height: 0 };

function sizeCanvas(c) {
  const r = c.getBoundingClientRect();
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  ctxOf(c).setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: r.width, height: r.height };
}

function safeInsets() {
  const cs = getComputedStyle($('safe-probe'));
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

/// Sketchbook paper: cream, a faint squared ruling, a few doodles round the edge.
function drawPaper(size) {
  const ctx = ctxOf(paperCanvas);
  ctx.fillStyle = LG.paper;
  ctx.fillRect(0, 0, size.width, size.height);
  const pitch = Math.max(20, Math.round(size.width / 16));
  ctx.save();
  ctx.strokeStyle = LG.decor;
  for (const [every, alpha, lw] of [[1, 0.07, 0.5], [4, 0.08, 1]]) {
    ctx.globalAlpha = alpha; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = pitch * every; x < size.width; x += pitch * every) { ctx.moveTo(x, 0); ctx.lineTo(x, size.height); }
    for (let y = pitch * every; y < size.height; y += pitch * every) { ctx.moveTo(0, y); ctx.lineTo(size.width, y); }
    ctx.stroke();
  }
  ctx.restore();
  drawBackdrop(ctx, size);
}

const drawing = new Drawing(inkCanvas, () => ctxOf(inkCanvas));

function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const btn = Math.max(40, Math.min(window.innerWidth, 430) / 8.6);
  document.documentElement.style.setProperty('--btn', `${btn}px`);
  drawPaper(sizeCanvas(paperCanvas));
  sizeCanvas(inkCanvas);
  stageSize = sizeCanvas(stageCanvas);
  drawing.render();
}

/// Playfield insets in stage coordinates: the hint line above, the action button below.
function stageInsets() {
  const ins = safeInsets();
  const hint = $('hint').getBoundingClientRect();
  return { top: Math.max(70, hint.bottom - ins.top + 8), bottom: ins.bottom + 104 };
}

// ---------------------------------------------------------------- small UI pieces

let toastTimer = 0;
function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function hint(text) {
  const el = $('hint');
  if (text) el.textContent = text;
  el.classList.toggle('show', !!text);
}

let actionHandler = null;
function showAction(label, fn) {
  $('action-text').textContent = label;
  actionHandler = fn;
  $('action').hidden = false;
}
function hideAction() { $('action').hidden = true; actionHandler = null; }
$('action').addEventListener('click', () => { const fn = actionHandler; if (fn) fn(); });

function setPhase(name) {
  document.body.classList.remove('role', 'drawing', 'live');
  document.body.classList.add(name);
}

const ICONS = {
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 13 5 5L20 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
};
const SWATCHES = ['#1C1B19', '#FF3B30', '#2FB344', '#2D7BF6'];
const EDGE_ROTATION = { right: 0, left: 180, top: -90 };
const EDGE_WORDS = { right: 'on your right', left: 'on your left', top: 'above (top to top)' };

function sticker(html, label, fill, onTap) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sticker';
  b.setAttribute('aria-label', label);
  if (fill) b.style.setProperty('--fill', fill);
  b.innerHTML = `<span class="sticker-back"></span><span class="sticker-face">${html}</span>`;
  b.addEventListener('click', onTap);
  return b;
}

let edgeButton = null;
function buildDrawRow() {
  const row = $('draw-row');
  row.append(sticker(ICONS.undo, 'Undo', 'var(--purple)', () => drawing.undo()));
  row.append(sticker(ICONS.clear, 'Clear', null, () => drawing.clear()));
  SWATCHES.forEach((hex, i) => {
    const b = sticker('', `Pen ${hex}`, null, () => {
      drawing.color = hex;
      row.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === b));
    });
    b.classList.add('swatch');
    b.style.setProperty('--c', hex);
    if (i === 0) b.classList.add('sel');
    row.append(b);
  });
  // Where is the other phone? (Each phone needs to know which edge the deck leaves by.)
  edgeButton = sticker(ICONS.right, 'Where the other phone is', null, () => {
    setEdge(EDGES[(EDGES.indexOf(app.edge) + 1) % EDGES.length]);
    toast(`other phone: ${EDGE_WORDS[app.edge]}`);
  });
  edgeButton.id = 'edge';
  row.append(edgeButton);
  row.append(sticker(ICONS.done, 'Done', 'var(--orange)', () => done()));
}

function setEdge(edge) {
  app.edge = edge;
  edgeButton.querySelector('svg').style.transform = `rotate(${EDGE_ROTATION[edge]}deg)`;
  try { localStorage.setItem(`tiny-edge-${app.role}`, edge); } catch { /* private mode */ }
}

// ---------------------------------------------------------------- role → draw

function chooseRole(role) {
  app.role = role;
  let edge = params.get('edge');
  if (!EDGES.includes(edge)) { try { edge = localStorage.getItem(`tiny-edge-${role}`); } catch { edge = null; } }
  // Default: phones side by side, magician on the left.
  setEdge(EDGES.includes(edge) ? edge : (role === 'magician' ? 'right' : 'left'));
  startDrawing();
}

function startDrawing() {
  app.step = 'drawing';
  $('ribbon-text').textContent = app.role === 'magician' ? 'DRAW A MAGICIAN' : 'DRAW A LITTLE YOU';
  hint('');
  hideAction();
  setPhase('drawing');
  drawing.enabled = true;
  drawing.clear();
  drawing.history = [];
}

let fontReady = null;
function loadFont() {
  if (!fontReady) {
    const load = document.fonts?.load ? document.fonts.load(`48px ${FONT_FAMILY}`) : Promise.resolve();
    fontReady = Promise.race([load.catch(() => {}), sleep(2500)]);
  }
  return fontReady;
}

/// ✓ — open the audio link (first time only: this tap is the user gesture that unlocks sound
/// and asks for the microphone), rig the drawing, and bring it to life.
async function done() {
  if (app.step !== 'drawing') return;
  const strokes = drawing.strokes.map((s) => ({ points: s.points.slice(), width: s.width, color: s.color }));
  if (!strokes.length) { toast('draw someone first!'); return; }
  app.step = 'starting';
  if (!transport) {
    const t = params.get('link') === 'loopback' ? new LoopbackTransport(params) : new AudioTransport();
    try { await t.start(); } catch (err) {
      app.step = 'drawing';
      toast(err?.name === 'NotAllowedError'
        ? 'your little guy needs the microphone to hear its friend'
        : 'this browser can’t open the microphone here', 4200);
      return;
    }
    transport = t;
    link = new Link(transport, ROLE[app.role]);
    link.onTransmit = (info) => actor?.say(info);
    link.on(T.HELLO, onHello);
    link.on(T.THROW, onThrow);
    link.on(T.RETURN, onReturn);
    if (params.get('debug') === '1') startMeter();
  }
  await loadFont();

  // A drawing the fitter can't read confidently as a little guy still performs — it just
  // moves as one piece.
  let rig = stabilizeSeams(fit(strokes));
  if (!rigIsConfident(rig)) rig = nonArticulated(rig);
  const ins = stageInsets();
  kit = makeKit(rig, stageSize, { edge: app.edge, topInset: ins.top, bottomInset: ins.bottom });
  actor?.stop();
  actor = new Actor(stageCanvas, () => ctxOf(stageCanvas), kit);
  drawing.enabled = false;
  setPhase('live');
  actor.start();
  app.round += 1;
  app.selection = null;
  app.step = 'waking';
  await actor.play(kit.clips.wake(), { name: 'wake' });
  if (app.role === 'magician') {
    app.step = 'hello';
    hint('tap your little guy to say hello');
    pendingTap = sayHello;
  } else {
    app.step = 'waiting';
    hint('shh… your little guy is listening');
  }
}

// ---------------------------------------------------------------- magician

async function sayHello() {
  if (app.step !== 'hello') return;
  app.step = 'helloing';
  pendingTap = null;
  hint('');
  actor.play(kit.clips.wave(), { name: 'wave' });
  const ok = await link.send(T.HELLO);
  if (app.step !== 'helloing') return;
  if (!ok) {
    app.step = 'hello';
    pendingTap = sayHello;
    hint('no answer… scoot the phones closer and tap again');
    return;
  }
  await actor.play(kit.clips.cheer(), { name: 'cheer' });
  await getDeck();
}

async function getDeck() {
  app.step = 'producing';
  hint('');
  await actor.play(kit.clips.produce(), { name: 'produce' });
  app.step = 'ready';
  showAction('THROW!', throwOver);
}

async function throwOver() {
  if (app.step !== 'ready') return;
  app.step = 'throwing';
  hideAction();
  hint('');
  const ok = await sendWithThrow(T.THROW, []);
  if (app.step !== 'throwing') return;                // the deck already came back
  if (ok) { app.step = 'away'; return; }
  app.step = 'away';
  callAgain();
}

/// The throw went unanswered: any tap calls across again (the deck is already in the air).
function callAgain() {
  hint('tap to call out again');
  pendingTap = async () => {
    pendingTap = null;
    hint('');
    const ok = await link.send(T.THROW, []);
    if (!ok && app.step === 'away') callAgain();
  };
}

/// Say `type`; on the first attempt the figure also winds up and throws, released on the beat
/// just after the last note.
function sendWithThrow(type, payload) {
  let thrown = false;
  return link.send(type, payload, (info) => {
    if (thrown) return;
    thrown = true;
    actor.play(kit.clips.throwDeck(), { at: throwStart(info.endTime), name: 'throw' });
    actor.then(kit.clips.idle(app.role === 'magician' ? 'wait' : 'none'), 'idle:after-throw');
  });
}

function onReturn(payload, f) {
  if (app.role !== 'magician') return;
  const sel = decodeSelection(payload);
  if (!sel || !['away', 'throwing'].includes(app.step)) return;
  app.step = 'revealing';
  pendingTap = null;
  hint('');
  app.selection = sel;
  actor.play(kit.clips.catchDeck(), { at: catchStart(f.endTime), name: 'catch' });
  actor.then(kit.clips.reveal(sel), 'reveal');
  const round = app.round;
  setTimeout(() => { if (app.round === round && app.step === 'revealing') { app.step = 'revealed'; showAction('AGAIN', startDrawing); } }, 9000);
}

// ---------------------------------------------------------------- spectator

function onHello(payload, f) {
  if (app.role !== 'spectator' || app.step !== 'waiting' || !actor) return;
  hint('');
  actor.play(kit.clips.wave(), { at: f.endTime + 60, name: 'wave' });
}

async function onThrow(payload, f) {
  if (app.role !== 'spectator' || app.step !== 'waiting' || !actor) return;
  await receiveDeck(catchStart(f.endTime));
}

async function receiveDeck(at) {
  app.step = 'caught';
  hint('');
  const round = app.round;
  const caught = actor.play(kit.clips.catchDeck(), { at, name: 'catch' });
  actor.then(kit.clips.fan(), 'fan');
  await caught;
  await sleep(1100);
  if (app.round !== round) return;
  app.step = 'picking';
  const sel = await picker.open();
  if (app.round !== round) return;
  app.selection = sel;
  app.step = 'burying';
  await actor.play(kit.clips.showPick(sel), { name: 'show' });
  await actor.play(kit.clips.shuffle(), { name: 'shuffle' });
  if (app.round !== round) return;
  app.step = 'holding';
  showAction('THROW IT BACK!', throwBack);
}

async function throwBack() {
  if (app.step !== 'holding') return;
  app.step = 'returning';
  hideAction();
  const round = app.round;
  let ok = await sendWithThrow(T.RETURN, encodeSelection(app.selection));
  while (!ok && app.round === round) {
    hint('tap to call out again');
    await new Promise((resolve) => { pendingTap = resolve; });
    pendingTap = null; hint('');
    ok = await link.send(T.RETURN, encodeSelection(app.selection));
  }
  if (app.round !== round) return;
  app.step = 'finished';
  await actor.play(kit.clips.cheer(), { name: 'cheer' });
  setTimeout(() => { if (app.round === round && app.step === 'finished') showAction('AGAIN', startDrawing); }, 7000);
}

// ---------------------------------------------------------------- input wiring

const picker = new Picker();
buildDrawRow();
$('role-magician').addEventListener('click', () => chooseRole('magician'));
$('role-spectator').addEventListener('click', () => chooseRole('spectator'));

// A tap anywhere on the page while a figure is alive.
stageCanvas.addEventListener('pointerdown', () => { const fn = pendingTap; if (fn) fn(); });

// Performer's out: double-tap the top-left corner to push the routine on if a phone never
// heard its cue (the spectator's catch, or skipping the hello).
let cornerAt = 0;
$('corner').addEventListener('pointerdown', (e) => {
  const fn = pendingTap; if (fn && app.step !== 'hello') fn();
  const t = e.timeStamp;
  if (t - cornerAt < 450) {
    cornerAt = 0;
    if (app.role === 'spectator' && app.step === 'waiting') receiveDeck(now() + 250);
    else if (app.role === 'magician' && app.step === 'hello') { pendingTap = null; getDeck(); }
  } else cornerAt = t;
});

for (const type of ['gesturestart', 'dblclick', 'contextmenu']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
layout();
loadFont();

// ---------------------------------------------------------------- diagnostics (?debug=1)

function startMeter() {
  const c = $('meter');
  c.hidden = false;
  const draw = () => {
    requestAnimationFrame(draw);
    const lv = transport.levels?.();
    const b = c.getBoundingClientRect();
    if (c.width !== Math.round(b.width)) { c.width = Math.round(b.width); c.height = Math.round(b.height); }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!lv) return;
    const w = c.width / lv.length;
    for (let i = 0; i < lv.length; i++) {
      const h = Math.min(1, Math.log10(1 + lv[i]) / 4) * c.height;
      ctx.fillStyle = i < 16 ? LG.purple : LG.orange;       // ultra | voice
      ctx.fillRect(i * w + 1, c.height - h, w - 2, h);
    }
  };
  draw();
}

// Offline: cache the whole app on first load.
if ('serviceWorker' in navigator && params.get('sw') !== '0') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// For automated tests and the diagnostics overlay.
window.__tiny = { app, get actor() { return actor; }, get link() { return link; }, get kit() { return kit; } };
