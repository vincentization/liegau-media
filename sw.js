// Service Worker – macht die App offline-fähig und installierbar.
//
// Strategie:
//  • Beim Installieren wird eine kleine App-Shell vorab gespeichert (CORE).
//  • Alle weiteren Dateien derselben Herkunft (GET) werden beim ersten Abruf
//    automatisch gecacht („stale-while-revalidate“): sofort aus dem Cache, im
//    Hintergrund aktualisiert. Neue Dateien (Views, Module, Vorlagen …) müssen
//    deshalb NICHT in einer Liste nachgetragen werden.
//  • Seitenaufrufe: erst Netz, offline Fallback auf index.html.
//  • Lokale Entwicklung (localhost/127.0.0.1): immer erst Netz → keine veralteten Dateien.
//  • Fremde Server (Supabase-API, Anmeldung, Uploads) werden nie gecacht – einzige
//    Ausnahme: das versionierte supabase-js-Modul vom CDN.
//
// Bei grundlegenden Änderungen VERSION erhöhen → alte Caches werden gelöscht.

const VERSION = 'v1';
const CACHE = `svl-media-${VERSION}`;

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/brand.js',
  'js/storage.js',
  'js/config.js',
  'js/views/home.js',
  'js/views/logo.js',
  'js/views/create.js',
  'js/views/archive.js',
  'css/views/archive.css',
  'assets/sv-logo.svg',
  'icons/icon.svg',
  'icons/icon-192.png',
  'fonts/TitilliumWeb-Regular.ttf',
  'fonts/TitilliumWeb-SemiBold.ttf',
  'fonts/TitilliumWeb-Bold.ttf',
  'fonts/TitilliumWeb-BoldItalic.ttf',
  'fonts/TitilliumWeb-Black.ttf',
];

// Fremd-URLs, die gecacht werden dürfen: supabase-js und seine Teilmodule vom CDN
// (nur fest versionierte Pfade wie /npm/@supabase/auth-js@2.65.0/+esm – unveränderlich).
const CDN_CACHEABLE = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[^/]+\/)?[^/@]+@\d[^/]*\/\+esm/;

const IS_DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Einzeln laden: eine fehlende Datei soll die Installation nicht verhindern.
    await Promise.all(CORE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(err => console.warn('SW: nicht gecacht', url, err))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('svl-media-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    if (CDN_CACHEABLE.test(req.url)) event.respondWith(cacheFirst(req));
    return; // alles andere (Supabase-API, Storage …) direkt ans Netz
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 'index.html'));
    return;
  }

  event.respondWith(IS_DEV ? networkFirst(req) : staleWhileRevalidate(req, event));
});

async function put(req, res) {
  if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
  }
}

async function networkFirst(req, fallback) {
  try {
    const res = await fetch(req);
    put(req, res.clone());
    return res;
  } catch (err) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' }) || (fallback && await cache.match(fallback));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then(async res => { await put(req, res.clone()); return res; });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  put(req, res.clone());
  return res;
}
