/* Hedgehog service worker：满足安卓 PWA 安装条件 + 壳资源缓存（离线可开）
 * 数据文件（data/*）不缓存，保证词库更新即时生效
 */
var CACHE = 'hedgehog-v15';
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'site.webmanifest',
  'icons/hedgehog.svg',
  'icons/sticker-hog.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/data/') !== -1) return; // 词库数据走网络
  // 网络优先：联网时永远拿最新版，缓存只做断网兜底（解决手机端旧壳问题）
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || (req.mode === 'navigate' ? caches.match('./') : Response.error());
        });
      })
  );
});
