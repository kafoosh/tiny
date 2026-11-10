// Offline cache. Everything the app needs is fetched once at install; after that every
// request is answered from the cache (so the trick works in airplane mode), and refreshed in
// the background whenever there happens to be a connection.

const CACHE = 'tiny-v2';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.png',
  'fonts/ShareTechMono.woff2', 'fonts/ArchitectsDaughter.woff2',
  'src/main.js', 'src/clock.js', 'src/palette.js', 'src/drawing.js', 'src/faces.js', 'src/cards.js',
  'src/rig/model.js', 'src/rig/fitter.js', 'src/rig/plausibility.js', 'src/rig/seams.js',
  'src/anim/actor.js', 'src/anim/setup.js', 'src/anim/support.js', 'src/anim/pen.js',
  'src/anim/timing.js',
  'src/anim/routines/index.js', 'src/anim/routines/basics.js', 'src/anim/routines/deck.js',
  'src/anim/routines/reveal.js',
  'src/audio/codec.js', 'src/audio/engine.js', 'src/audio/music.js', 'src/audio/modem.js',
  'src/audio/rx-worklet.js',
  'src/link/protocol.js', 'src/link/loopback.js',
  'src/hand/read.js', 'src/hand/segment.js', 'src/hand/raster.js', 'src/hand/net.js',
  'src/hand/model-data.js', 'src/hand/words.js',
  'src/ui/writepad.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(req).then((res) => {
      if (res.ok) cache.put(key === './' ? './' : req.url.split('?')[0], res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    return (await refresh) || new Response('offline', { status: 503 });
  }));
});
