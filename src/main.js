// Tiny — two phones, two drawn figures, one deck of cards thrown between them.
//
// What the audience sees: a little tune plays; one figure throws a deck off the edge of its
// screen and the other catches it; the spectator writes a word or draws a card by hand, it
// is shuffled away and thrown back, and the magician's figure finds it and types it out.
//
// How: the sparkle of chimes over the tune is a data link (src/audio), and the handwriting
// is read on the spectator's phone (src/hand). Nothing touches the network after load.

import { BP, PENS, FONT_TYPE, FONT_HAND } from './palette.js';
import { Drawing } from './drawing.js';
import { fit } from './rig/fitter.js';
import { stabilizeSeams } from './rig/seams.js';
import { rigIsConfident, nonArticulated } from './rig/model.js';
import { makeKit, EDGES } from './anim/setup.js';
import { Actor } from './anim/actor.js';
import { throwStart, catchStart } from './anim/timing.js';
import { Link, T, ROLE, encodeSelection, decodeSelection } from './link/protocol.js';
import { AudioEngine } from './audio/engine.js';
import { AudioTransport } from './audio/modem.js';
import { LoopbackTransport } from './link/loopback.js';
import { WritePad } from './ui/writepad.js';
import { now } from './clock.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- state

const app = {
  role: null,             // 'magician' | 'spectator'
  edge: 'right',          // which edge of THIS screen the other phone is past
  step: 'role',           // see the flows below
  selection: null,        // spectator: what they wrote, as read · magician: what was revealed
  writing: null,          // spectator: the ink itself
  round: 0,
};
const engine = new AudioEngine();
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

/// The drawing sheet: blueprint blue, a fine grid with heavier lines every fourth, a border
/// with corner ticks, and a little title block.
function drawPaper(size) {
  const ctx = ctxOf(paperCanvas), { width: W, height: H } = size;
  ctx.fillStyle = BP.sheet;
  ctx.fillRect(0, 0, W, H);
  const pitch = Math.max(18, Math.round(W / 18));
  ctx.save();
  ctx.strokeStyle = '#BEDCFF';
  for (const [every, alpha, lw] of [[1, 0.08, 0.5], [4, 0.16, 1]]) {
    ctx.globalAlpha = alpha; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = W / 2 % (pitch * every); x < W; x += pitch * every) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = pitch * every; y < H; y += pitch * every) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }
  // Sheet border + corner ticks.
  const m = 7, ins = safeInsets(), top = m + ins.top, bottom = H - m - ins.bottom;
  ctx.globalAlpha = 0.5; ctx.strokeStyle = BP.line; ctx.lineWidth = 1;
  ctx.strokeRect(m, top, W - 2 * m, bottom - top);
  ctx.globalAlpha = 0.8; ctx.strokeStyle = BP.cyan; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[m, top, 1, 1], [W - m, top, -1, 1], [m, bottom, 1, -1], [W - m, bottom, -1, -1]]) {
    ctx.moveTo(x + 14 * sx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + 14 * sy);
  }
  ctx.stroke();
  // Title block, bottom-left.
  ctx.globalAlpha = 0.55; ctx.fillStyle = BP.line; ctx.strokeStyle = BP.line; ctx.lineWidth = 1;
  ctx.font = `10px ${FONT_TYPE}`; ctx.textBaseline = 'middle';
  const label = app.role ? (app.role === 'magician' ? 'FIG. A  MAGICIAN' : 'FIG. B  SPECTATOR') : 'TINY';
  const bw = 124, bh = 30, bx = m + 6, by = bottom - bh - 6;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath(); ctx.moveTo(bx, by + bh / 2); ctx.lineTo(bx + bw, by + bh / 2); ctx.stroke();
  ctx.fillText(label, bx + 6, by + bh * 0.26);
  ctx.fillText('SCALE 1:1   NOT TO SCALE', bx + 6, by + bh * 0.76, bw - 12);
  ctx.restore();
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
  $('action').textContent = label;
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
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M5 5l14 14M19 5 5 19"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="m4 13 5 5L20 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M3 12h16M13 6l6 6-6 6M21 4v16"/></svg>',
};
const EDGE_ROTATION = { right: 0, left: 180, top: -90 };
const EDGE_WORDS = { right: 'on your right', left: 'on your left', top: 'above (top to top)' };

function tool(html, label, onTap, extra = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn tool ${extra}`;
  b.setAttribute('aria-label', label);
  b.innerHTML = html;
  b.addEventListener('click', onTap);
  return b;
}

let edgeButton = null;
function buildDrawRow() {
  const row = $('draw-row');
  row.append(tool(ICONS.undo, 'Undo', () => drawing.undo()));
  row.append(tool(ICONS.clear, 'Clear', () => drawing.clear()));
  PENS.forEach((hex, i) => {
    const b = tool('<i></i>', `Pen ${i + 1}`, () => {
      drawing.color = hex;
      row.querySelectorAll('.pen').forEach((s) => s.classList.toggle('sel', s === b));
    }, 'pen');
    b.style.setProperty('--c', hex);
    if (i === 0) b.classList.add('sel');
    row.append(b);
  });
  // Where is the other phone? (Each phone needs to know which edge the deck leaves by.)
  edgeButton = tool(ICONS.right, 'Where the other phone is', () => {
    setEdge(EDGES[(EDGES.indexOf(app.edge) + 1) % EDGES.length]);
    toast(`other phone: ${EDGE_WORDS[app.edge]}`);
  });
  edgeButton.id = 'edge';
  row.append(edgeButton);
  const ok = tool(ICONS.done, 'Done', () => done(), 'primary');
  row.append(ok);
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
  $('title-text').textContent = app.role === 'magician' ? 'DRAW A MAGICIAN' : 'DRAW YOURSELF';
  $('title-sub').textContent = app.role === 'magician' ? 'SHEET 1 OF 2' : 'SHEET 2 OF 2';
  drawPaper(sizeCanvas(paperCanvas));
  hint('');
  hideAction();
  setPhase('drawing');
  drawing.enabled = true;
  drawing.clear();
  drawing.history = [];
  drawing.color = drawing.color || BP.line;
}

let fontReady = null;
function loadFont() {
  if (!fontReady) {
    const load = document.fonts?.load
      ? Promise.all([document.fonts.load(`48px ${FONT_TYPE}`), document.fonts.load(`20px ${FONT_HAND}`)]) : Promise.resolve();
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
  // The prompt comes first, so the microphone request that follows reads as part of it.
  hint('say hello to your creation!');
  if (!transport) {
    const t = params.get('link') === 'loopback' ? new LoopbackTransport(engine, params) : new AudioTransport(engine);
    try { await t.start(); } catch (err) {
      app.step = 'drawing';
      hint('');
      toast(err?.name === 'NotAllowedError'
        ? 'your creation can\u2019t hear you without the microphone'
        : 'this browser can\u2019t open the microphone here', 4200);
      return;
    }
    transport = t;
    link = new Link(transport, ROLE[app.role]);
    link.on(T.HELLO, onHello);
    link.on(T.THROW, onThrow);
    link.on(T.RETURN, onReturn);
    if (params.get('debug') === '1') startMeter();
  }
  await loadFont();

  // A drawing the fitter can't read confidently as a figure still performs — it just
  // moves as one piece.
  let rig = stabilizeSeams(fit(strokes));
  if (!rigIsConfident(rig)) rig = nonArticulated(rig);
  const ins = stageInsets();
  kit = makeKit(rig, stageSize, { edge: app.edge, topInset: ins.top, bottomInset: ins.bottom });
  actor?.stop();
  actor = new Actor(stageCanvas, () => ctxOf(stageCanvas), kit);
  actor.beat = () => (engine.ready ? engine.music.beatPhase(engine.ctx.currentTime) : -1);
  drawing.enabled = false;
  setPhase('live');
  actor.start();
  app.round += 1;
  app.selection = null;
  app.writing = null;
  app.step = 'waking';
  // It listens for a voice from the moment it lands (or a tap will do; and it won't sulk
  // for long if nobody says anything).
  const round = app.round;
  const heard = new Promise((resolve) => {
    transport.onVoice = resolve;
    transport.listenForVoice();
    pendingTap = resolve;
    setTimeout(resolve, 15000);
  });
  await actor.play(kit.clips.wake(), { name: 'wake' });
  // (If the other phone's deck arrives while all this is going on, that takes over.)
  const still = (step) => app.round === round && app.step === step;
  if (!still('waking')) return;
  app.step = 'greeting';
  await heard;
  if (!still('greeting')) return;
  pendingTap = null;
  transport.onVoice = null;
  hint('');
  await actor.play(kit.clips.wave(), { name: 'wave' });
  if (!still('greeting')) return;
  await actor.play(kit.clips.cheer(), { name: 'cheer' });
  if (!still('greeting')) return;
  if (app.role === 'magician') {
    // The magician's phone starts the tune; the spectator's joins in, in time, at the hello.
    if (engine.ready && !engine.music.playing) engine.music.sync(engine.ctx.currentTime + 0.1, 0);
    app.step = 'hello';
    hint('tap your figure to find its friend');
    pendingTap = sayHello;
  } else {
    app.step = 'waiting';
    hint('wait for it\u2026');
  }
}

// ---------------------------------------------------------------- magician

async function sayHello() {
  if (app.step !== 'hello') return;
  app.step = 'helloing';
  pendingTap = null;
  hint('');
  actor.play(kit.clips.wave(), { name: 'wave' });
  const ok = await link.send(T.HELLO, [0], null, { stamp: true });
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
  showAction('THROW', throwOver);
}

async function throwOver() {
  if (app.step !== 'ready') return;
  app.step = 'throwing';
  hideAction();
  hint('');
  const ok = await sendWithThrow(T.THROW, [0], true);
  if (app.step !== 'throwing') return;                // the deck already came back
  if (ok) { app.step = 'away'; return; }
  app.step = 'away';
  callAgain();
}

/// The throw went unanswered: any tap calls across again (the deck is already in the air).
function callAgain() {
  hint('tap to try again');
  pendingTap = async () => {
    pendingTap = null;
    hint('');
    const ok = await link.send(T.THROW, [0], null, { stamp: true });
    if (!ok && app.step === 'away') callAgain();
  };
}

/// Send `type`; on the first attempt the figure also winds up and throws, released on the beat
/// just after the last chime.
function sendWithThrow(type, payload, stamp = false) {
  let thrown = false;
  return link.send(type, payload, (info) => {
    if (thrown) return;
    thrown = true;
    actor.play(kit.clips.throwDeck(), { at: throwStart(info.endTime), name: 'throw' });
    actor.then(kit.clips.idle(app.role === 'magician' ? 'wait' : 'none'), 'idle:after-throw');
  }, { stamp });
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

/// Join the other phone's tune, in time: its frame told us where in the loop it ended.
function joinMusic(payload, f) {
  if (!engine.ready || engine.music.playing || payload.length < 1) return;
  engine.music.sync(engine.toCtx(f.endTime), payload[0]);
}

const READY = ['waking', 'greeting', 'waiting'];

function onHello(payload, f) {
  if (app.role !== 'spectator' || !READY.includes(app.step) || !actor) return;
  joinMusic(payload, f);
  if (app.step !== 'waiting') return;               // busy meeting its maker; just join the tune
  hint('');
  actor.play(kit.clips.wave(), { at: f.endTime + 60, name: 'wave' });
}

async function onThrow(payload, f) {
  if (app.role !== 'spectator' || !READY.includes(app.step) || !actor) return;
  joinMusic(payload, f);
  await receiveDeck(catchStart(f.endTime));
}

async function receiveDeck(at) {
  app.step = 'caught';
  pendingTap = null;
  hint('');
  if (engine.ready && !engine.music.playing) engine.music.sync(engine.ctx.currentTime + 0.1, 0);
  const round = app.round;
  const caught = actor.play(kit.clips.catchDeck(), { at, name: 'catch' });
  actor.then(kit.clips.fan(), 'fan');
  await caught;
  await sleep(1100);
  if (app.round !== round) return;
  app.step = 'writing';
  const { selection, writing } = await pad.open();
  if (app.round !== round) return;
  app.selection = selection;
  app.writing = writing;
  app.step = 'burying';
  await actor.play(kit.clips.showPick(writing), { name: 'show' });
  await actor.play(kit.clips.shuffle(), { name: 'shuffle' });
  if (app.round !== round) return;
  app.step = 'holding';
  showAction('THROW IT BACK', throwBack);
}

async function throwBack() {
  if (app.step !== 'holding') return;
  app.step = 'returning';
  hideAction();
  const round = app.round;
  let ok = await sendWithThrow(T.RETURN, encodeSelection(app.selection));
  while (!ok && app.round === round) {
    hint('tap to try again');
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

const pad = new WritePad({ onEmpty: () => toast('write something first') });
buildDrawRow();
$('role-magician').addEventListener('click', () => chooseRole('magician'));
$('role-spectator').addEventListener('click', () => chooseRole('spectator'));

// A tap anywhere on the page while a figure is alive.
stageCanvas.addEventListener('pointerdown', () => { const fn = pendingTap; if (fn) fn(); });

// Performer's out: double-tap the top-left corner to push the routine on if a phone never
// heard its cue (the spectator's catch, or skipping the hello).
let cornerAt = 0;
$('corner').addEventListener('pointerdown', (e) => {
  const fn = pendingTap; if (fn && app.step !== 'hello' && app.step !== 'greeting' && app.step !== 'waking') fn();
  const t = e.timeStamp;
  if (t - cornerAt < 450) {
    cornerAt = 0;
    if (app.role === 'spectator' && READY.includes(app.step)) receiveDeck(now() + 250);
    else if (app.role === 'magician' && app.step === 'hello') { pendingTap = null; getDeck(); }
  } else cornerAt = t;
});

// Phones pause audio whenever they like; every touch gets a chance to wake it (as in play).
for (const type of ['touchend', 'click', 'pointerdown']) {
  document.addEventListener(type, () => engine.unlock(), { passive: true, capture: true });
}

for (const type of ['gesturestart', 'dblclick', 'contextmenu']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
layout();
loadFont().then(() => drawPaper(sizeCanvas(paperCanvas)));

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
      ctx.fillStyle = i < 16 ? BP.cyan : BP.yellow;         // ultrasonic | chimes
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
window.__tiny = { app, engine, get actor() { return actor; }, get link() { return link; }, get kit() { return kit; } };
