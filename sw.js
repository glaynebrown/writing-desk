/* Lets the app open (and keep working) with no internet.
   App files: network first -- and always asking GitHub for a fresh copy (GitHub Pages
   otherwise lets the browser reuse a file for 10 minutes), so an upload shows up right away.
   Firebase SDK, fonts and helper libraries: saved copy first -- those never change.
   The writing itself is kept on the device by Firestore, not here. */
const APP_CACHE = 'qc-app-v6';
const APP_FILES = [
  './', 'index.html', 'styles.css', 'themes.js', 'store.js', 'demo.js', 'ui.js', 'vault.js', 'editor.js', 'project.js', 'pages.js', 'io.js', 'lookup.js', 'lockin.js', 'research.js', 'goals.js', 'backdrop.js', 'worldmap.js', 'find.js', 'book.js', 'app.js',
  'firebase-config.js', 'manifest.json', 'candle.webp', 'candle-mark.webp', 'scene-arrow.png', 'icon-192.png', 'apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];
const HOME = new URL('./', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE)
    .then(cache => Promise.allSettled(APP_FILES.map(url => cache.add(url))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== APP_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  const forever = url.startsWith('https://www.gstatic.com/firebasejs/') || url.startsWith('https://fonts.g') || url.startsWith('https://cdnjs.cloudflare.com/') || url.startsWith('https://images.unsplash.com/');
  if (forever) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(APP_CACHE).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (url.startsWith(HOME)) {
    event.respondWith(fetch(url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./'))));
  }
});
