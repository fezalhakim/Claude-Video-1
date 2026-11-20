const CACHE = 'mgear-v33';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icon.svg', './media/awake.mp4', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './js/app.js', './js/analysis.js', './js/i18n.js', './js/importer.js', './js/ocrimport.js', './js/chartdigitize.js', './js/detail.js', './js/perf.js', './js/nmea.js', './js/ble.js',
  './js/devices/racebox.js', './js/devices/dragy.js',
  './js/devices/phonegps.js', './js/devices/simulator.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // 'no-cache': sentiasa semak versi terkini dengan pelayan (elak campuran fail lama & baru
    // akibat cache HTTP 10 minit GitHub Pages); cache hanya digunakan bila luar talian.
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
