/* Hedgehog service worker：满足安卓 PWA 安装条件 + 壳资源缓存（离线可开）
 * 数据文件（data/*）不缓存，保证词库更新即时生效
 */
var CACHE = 'hedgehog-v2';
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
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () {
          // 断网：回退缓存；导航请求回退到本子首页
          return hit || (req.mode === 'navigate' ? caches.match('./') : Response.error());
        });
      return hit || net;
    })
  );
});
