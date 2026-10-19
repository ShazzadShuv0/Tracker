// App-shell cache. Never reads or writes IndexedDB. A new version is fully cached before it replaces the old one.
const V = 'lifeos-shell-v3', RT = 'lifeos-runtime-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './db.js', './calculations.js', './charts.js', './academic.js', './tracking.js', './reports.js', './backup.js', './portability.js', './config.js', './sync.js', './syncmerge.js', './syncui.js', './manifest.webmanifest', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))); // if any file fails, install fails and the old version keeps running
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('lifeos-') && k !== V && k !== RT).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url); if (r.method !== 'GET') return;
  if (u.origin === location.origin) { // network first so fixes arrive; cache is the offline fallback
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
      .catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  } else if (u.hostname === 'cdnjs.cloudflare.com' || u.hostname === 'cdn.jsdelivr.net') { // chart + Supabase libraries: cache after first successful load
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(RT).then(c => c.put(r, cp)); return res; })));
  }
});
