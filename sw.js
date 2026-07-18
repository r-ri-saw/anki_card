/**
 * sw.js  ─  Service Worker（PWA オフライン対応）
 *
 * キャッシュ戦略:
 *   アプリシェル（HTML/CSS/JS）: Cache First
 *   CDN ライブラリ:              Network First → Cache フォールバック
 *   cards.xlsx / cards.json:     Network First → Cache フォールバック
 *
 * ※ CACHE_SHELL のバージョン番号を上げると古いキャッシュが自動削除される
 */

const CACHE_SHELL = 'anki-shell-v6';   // ← アプリ更新時はここを変更
const CACHE_CDN   = 'anki-cdn-v1';
const CACHE_DATA  = 'anki-data-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/loader.js',
  './js/sm2.js',
  './js/session.js',
  './js/ui.js',
  './js/app.js',
  './images/icon-192.png',
  './images/icon-512.png',
  './icons/icon-16.png',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

// ── インストール ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => Promise.allSettled(
        SHELL_FILES.map(url => cache.add(url).catch(err => {
          console.warn('[SW] cache.add failed:', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート ────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_SHELL && k !== CACHE_CDN && k !== CACHE_DATA)
          .map(k => {
            console.log('[SW] delete old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── フェッチ ──────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith('http')) return;

  // CDN → Network First
  if (url.includes('xlsx.full.min.js')) {
    e.respondWith(networkFirst(e.request, CACHE_CDN));
    return;
  }

  // 問題データファイル → Network First（SW でもキャッシュ）
  if (url.includes('cards.xlsx') || url.includes('cards.json')) {
    e.respondWith(networkFirst(e.request, CACHE_DATA));
    return;
  }

  // アプリシェル → Cache First
  e.respondWith(cacheFirst(e.request, CACHE_SHELL));
});

// ── キャッシュ戦略 ────────────────────────────────────────
async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch {
    return offline();
  }
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || offline();
  }
}

function offline() {
  return new Response('オフラインです', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
