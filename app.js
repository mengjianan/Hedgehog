/* Hedgehog 语感词库 — 纯原生单文件应用（无框架、无构建、无外部请求）
 * 数据结构: {version, updated, lists: [{id, lang, title, speech, words: [...]}]}
 * 词条 ref = listId + '/' + 词头，收藏/进度都按 ref 存
 */
(function () {
  'use strict';

  var DATA = null;
  var LISTS = [];
  var LIST = {}; // id -> list
  var IDX = {}; // "listId/w" -> {l, x}
  var ALL = []; // 扁平索引（跨语言搜索用）
  var TAGS = {}; // 场景标签：ref -> edu/tech/env/health/travel/work（#2 场景厅装全库）
  var TABLES = []; // 基础表 [{id, lang, title, sections}]
  var TBY = {}; // id -> table
  var GRAMMARS = []; // 语法翼楼 [{id, lang, title, rooms}]
  var GBY = {}; // id -> grammar wing
  var session = null; // 当前巡游 {queue:[ref], idx, good, bad, mode, kind, ...}
  var pickMode = 'card'; // 选厅模式：card 认卡 / spell 拼写
  var sessionSize = lsGet('hedgehog:session-size', 10); // 每轮站数（#4 背词页可设）
  var sceneLang = 'all'; // 词库页场景厅语言筛选：all/en/ko/ja
  var listShown = 100; // 词库列表懒渲染：首屏 100，滚动加载更多
  var listShownFor = '';

  var LANG_NAME = { en: '英语', ko: '韩语', ja: '日语' };
  var APP_VER = 'v2026-10-27.2'; // 页脚版本号：看到它就知道手机跑的是哪版

  // 细线图标（韩系极简：不用 emoji）
  var ICON = {
    sound:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M17.8 6.8a7 7 0 0 1 0 10.4"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6l2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.6 1.1-5.6-4.2-3.9 5.7-.7L12 3.6z"/></svg>'
  };

  var PAPER_CLASSES = ['paper-grid', 'paper-lined', 'paper-blank'];

  function applyPaper(p) {
    var page = $('page');
    if (!page) return;
    PAPER_CLASSES.forEach(function (c) { page.classList.remove(c); });
    page.classList.add(PAPER_CLASSES.indexOf(p) >= 0 ? p : 'paper-grid');
  }

  function initPage() {
    var d = new Date();
    var days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var pd = $('pageDate');
    if (pd) {
      pd.textContent =
        d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + days[d.getDay()];
    }
    applyPaper(lsGet('hedgehog:paper', 'paper-grid'));
    var pb = $('paperBtn');
    if (pb) {
      pb.addEventListener('click', function () {
        var cur = lsGet('hedgehog:paper', 'paper-grid');
        var next = PAPER_CLASSES[(PAPER_CLASSES.indexOf(cur) + 1) % PAPER_CLASSES.length];
        lsSet('hedgehog:paper', next);
        applyPaper(next);
      });
    }
  }

  // ---------- 小工具 ----------
  var $ = function (id) { return document.getElementById(id); };
  var te = new TextEncoder();
  var td = new TextDecoder();

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function b64ToU8(s) {
    var bin = atob(s);
    var a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function lsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  // ---------- 词库缓存（IndexedDB）----------
  // localStorage 只有 5MB，三语全量词库解密后装不下，大对象一律进 IDB
  var IDB_NAME = 'hedgehog';
  var idbDb = null;
  function idbOpen() {
    if (!idbDb) {
      idbDb = new Promise(function (resolve, reject) {
        var rq = indexedDB.open(IDB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      });
    }
    return idbDb;
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var rq = db.transaction('kv').objectStore('kv').get(key);
        rq.onsuccess = function () { resolve(rq.result || null); };
        rq.onerror = function () { reject(rq.error); };
      });
    });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function favs() { return lsGet('hedgehog:favs', []); }
  function known() { return lsGet('hedgehog:known', {}); }
  function isFav(ref) { return favs().indexOf(ref) !== -1; }

  function toggleFav(ref) {
    var list = favs();
    var i = list.indexOf(ref);
    if (i === -1) list.push(ref); else list.splice(i, 1);
    lsSet('hedgehog:favs', list);
    return i === -1;
  }

  function wordHref(e) {
    return '#/word/' + e.l.id + '/' + encodeURIComponent(e.x.w);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function now() { return Date.now(); }
  var DAY_MS = 86400000;

  // ---------- 间隔重复（hedgehog:due = {ref: {s:阶段, d:到期毫秒}}） ----------
  var DUE_INTERVALS = [1, 3, 7, 15]; // 天

  function dueMap() { return lsGet('hedgehog:due', {}); }
  function saveDue(m) { lsSet('hedgehog:due', m); }

  function dueRefsNow() {
    var m = dueMap();
    return Object.keys(m).filter(function (ref) {
      return IDX[ref] && m[ref].d <= now();
    });
  }
  function listDueCount(l) {
    var m = dueMap();
    var t = now();
    return l.words.reduce(function (n, x) {
      var e = m[l.id + '/' + x.w];
      return n + (e && e.d <= t ? 1 : 0);
    }, 0);
  }
  // 学习结果入调度：good 晋级 1→3→7→15 天；bad 回炉明天再来
  function scheduleRef(ref, good) {
    var m = dueMap();
    if (good) {
      var s = m[ref] ? Math.min(m[ref].s + 1, DUE_INTERVALS.length - 1) : 0;
      m[ref] = { s: s, d: now() + DUE_INTERVALS[s] * DAY_MS };
    } else {
      m[ref] = { s: 0, d: now() + DAY_MS };
    }
    saveDue(m);
  }

  // ---------- 打卡格（hedgehog:stamps = {"YYYY-MM-DD": 轮数}） ----------
  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function logStamp() {
    var m = lsGet('hedgehog:stamps', {});
    var k = dateKey(new Date());
    m[k] = (m[k] || 0) + 1;
    lsSet('hedgehog:stamps', m);
  }
  function weeklyHTML() {
    var m = lsGet('hedgehog:stamps', {});
    var names = ['一', '二', '三', '四', '五', '六', '日'];
    var d = new Date();
    var dow = (d.getDay() + 6) % 7; // 周一=0
    var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    var cells = '';
    for (var i = 0; i < 7; i++) {
      var dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      var n = m[dateKey(dt)] || 0;
      cells +=
        '<div class="wk-cell ' + (n ? 'on ' : '') + (i === dow ? 'today' : '') + '">' +
        '<em>' + names[i] + '</em><span>' + (n || '·') + '</span></div>';
    }
    return (
      '<div class="weekly"><p class="picker-h">本周打卡</p>' +
      '<div class="wk-row">' + cells + '</div></div>'
    );
  }

  // ---------- 拼写判定（英文精确；韩日接受本国字或罗马音） ----------
  function normText(s) {
    return String(s)
      .toLowerCase()
      .trim()
      .replace(/['’.\s\-_/·[\]]/g, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
  function checkSpelling(input, x) {
    if (!input) return false;
    var a = normText(input);
    if (!a) return false;
    if (a === normText(x.w)) return true;
    // 非 ASCII 目标（韩/日）：罗马音也算对（取 pron 中的拉丁片段）
    if (/[^\x00-\x7F]/.test(x.w)) {
      var lat = String(x.pron || '').match(/[a-zA-Z][a-zA-Z ōūēīāśń]*/);
      if (lat && normText(lat[0]) === a) return true;
    }
    return false;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ---------- 密码解密（PBKDF2 -> AES-GCM） ----------
  // data/words.enc.gz：明文预压缩 + 双层 gzip（原 10.5MB → 3.1MB）。
  // 下载源链：国内代理优先（gh-proxy/ghfast）→ GitHub Pages 兜底，按字节数校验防串源；
  // 进度按同字节单位计算，不再超 100%。密文暂存 Cache Storage（按 ETag 指纹）。
  var ENC_CACHE = 'hedgehog-enc';
  var ENC_PATH = 'data/words.enc.gz';
  var ENC_SOURCES = [
    'https://gh-proxy.com/https://raw.githubusercontent.com/mengjianan/hedgehog/main/data/words.enc.gz',
    'https://ghfast.top/https://raw.githubusercontent.com/mengjianan/hedgehog/main/data/words.enc.gz',
    'data/words.enc.gz'
  ];
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); },
             function (e) { clearTimeout(t); reject(e); });
    });
  }
  function netErr(e) {
    var err = e instanceof Error ? e : new Error(String(e));
    err.net = true; // 标记网络失败：界面提示「网络太慢」而非「密码不对」
    return err;
  }

  // gzip 解压（浏览器 DecompressionStream）
  function gunzipBuf(buf) {
    return new Promise(function (resolve, reject) {
      if (typeof DecompressionStream === 'undefined') {
        var e = new Error('浏览器过旧无法解压词库，请更新 Chrome/Safari/Edge');
        e.friendly = true;
        reject(e);
        return;
      }
      try {
        var ds = new DecompressionStream('gzip');
        var stream = new Blob([buf]).stream().pipeThrough(ds);
        new Response(stream).arrayBuffer().then(resolve, reject);
      } catch (e2) { reject(e2); }
    });
  }

  // 文件字节 → {iv, data, z}（外壳 gunzip + JSON）
  function parseEncBytes(bytes) {
    return gunzipBuf(bytes).then(function (ab) {
      return JSON.parse(td.decode(ab));
    });
  }

  // 多源下载：每源最多 2 次尝试，失败/尺寸不符换下一源
  // expectSize 来自 GitHub HEAD（同文件字节数），尺寸不符视为串源/损坏
  function downloadEnc(onProgress, expectSize) {
    var srcIdx = 0;
    function trySource() {
      var url = ENC_SOURCES[srcIdx];
      var attempt = 0;
      function once() {
        attempt++;
        return fetch(url, { cache: 'no-store' }).then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          var total = expectSize || parseInt(res.headers.get('Content-Length'), 10) || 0;
          if (!res.body || typeof res.body.getReader !== 'function' || !total) {
            // 老浏览器不支持流式读取：整块拿，120 秒看门狗
            return withTimeout(res.arrayBuffer(), 120000).then(function (buf) {
              onProgress(buf.byteLength, total || buf.byteLength);
              if (expectSize && buf.byteLength !== expectSize) {
                var em = new Error('size mismatch'); em.srcFail = true; throw em;
              }
              return new Uint8Array(buf);
            });
          }
          var reader = res.body.getReader();
          var chunks = [], got = 0;
          function readChunk() {
            return new Promise(function (resolve, reject) {
              var t = setTimeout(function () {
                try { reader.cancel(); } catch (e) {}
                reject(new Error('enc read timeout'));
              }, 60000);
              reader.read().then(
                function (r) { clearTimeout(t); resolve(r); },
                function (e) { clearTimeout(t); reject(e); }
              );
            });
          }
          function loop() {
            return readChunk().then(function (r) {
              if (r.done) {
                // 尺寸不符且还有下一源 → 换源；最后一源接受（GCM 认证兜底）
                if (expectSize && got !== expectSize && srcIdx < ENC_SOURCES.length - 1) {
                  var em = new Error('size mismatch'); em.srcFail = true; throw em;
                }
                var out = new Uint8Array(got), off = 0;
                chunks.forEach(function (c) { out.set(c, off); off += c.length; });
                return out;
              }
              chunks.push(r.value); got += r.value.length;
              onProgress(got, total);
              return loop();
            });
          }
          return loop();
        }).catch(function (e) {
          if (e.srcFail) throw e; // 尺寸错直接换源，不在本源重试
          if (attempt < 2) {
            return new Promise(function (r) { setTimeout(r, 1000); }).then(once);
          }
          var se = new Error('source fail: ' + e.message); se.srcFail = true; throw se;
        });
      }
      return once().catch(function (e) {
        if (e.srcFail && srcIdx < ENC_SOURCES.length - 1) { srcIdx++; return trySource(); }
        throw netErr(e);
      });
    }
    return trySource();
  }

  // 取密文：HEAD 拿指纹+尺寸 → Cache 命中且指纹一致直接用；否则多源现下
  function loadEnc(onProgress) {
    return withTimeout(fetch('data/salt'), 30000).then(function (saltResp) {
      if (!saltResp.ok) throw new Error('salt missing');
      return withTimeout(saltResp.arrayBuffer(), 30000);
    }).then(function (saltBuf) {
      var salt = new Uint8Array(saltBuf);
      return withTimeout(fetch(ENC_PATH, { method: 'HEAD', cache: 'no-store' }), 30000)
        .then(function (head) {
          var et = head.ok ? (head.headers.get('ETag') || head.headers.get('Last-Modified')) : null;
          var size = head.ok ? (parseInt(head.headers.get('Content-Length'), 10) || 0) : 0;
          if (typeof caches === 'undefined') return { salt: salt, etag: et, size: size, bytes: null };
          return caches.open(ENC_CACHE).then(function (c) {
            return c.match(ENC_PATH).then(function (hit) {
              if (!hit) return null;
              var cet = hit.headers.get('ETag') || hit.headers.get('Last-Modified');
              // et 为空（HEAD 失败，如离线）时有缓存就用；否则指纹必须一致
              if (!et || (cet && cet === et)) {
                return withTimeout(hit.arrayBuffer(), 30000).then(function (ab) {
                  return { salt: salt, etag: et, size: size, bytes: new Uint8Array(ab) };
                });
              }
              return null;
            });
          }).catch(function () { return null; })
            .then(function (cached) { return cached || { salt: salt, etag: et, size: size, bytes: null }; });
        }).catch(function () {
          // HEAD 失败（离线等）：没有可靠指纹，直接走现下，成败由 downloadEnc 决定
          return { salt: salt, etag: null, size: 0, bytes: null };
        });
    }).then(function (ctx) {
      if (ctx.bytes) {
        onProgress(ctx.bytes.length, ctx.bytes.length); // 缓存命中：直接满格
        return parseEncBytes(ctx.bytes).then(function (blob) {
          return { salt: ctx.salt, etag: ctx.etag, blob: blob };
        });
      }
      return downloadEnc(onProgress, ctx.size).then(function (bytes) {
        // 暂存密文备输错密码重试（失败不影响解锁）
        if (ctx.etag && typeof caches !== 'undefined') {
          try {
            var store = new Response(bytes.slice(0), {
              headers: { 'Content-Type': 'application/gzip', 'ETag': ctx.etag }
            });
            caches.open(ENC_CACHE).then(function (c) { c.put(ENC_PATH, store); }).catch(function () {});
          } catch (e2) {}
        }
        return parseEncBytes(bytes).then(function (blob) {
          return { salt: ctx.salt, etag: ctx.etag, blob: blob };
        });
      });
    });
  }

  // onStage('download'|'decrypt') 驱动界面分段提示；onProgress(got, total) 汇报字节进度
  async function unlock(password, onStage, onProgress) {
    onStage('download');
    var ctx = await loadEnc(onProgress);
    onStage('decrypt');
    var blob = ctx.blob;
    var base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: ctx.salt, iterations: blob.iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    var plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToU8(blob.iv) },
      key,
      b64ToU8(blob.data)
    );
    // z:1 = 明文在加密前做过 gzip，需要再解一层
    var bankBuf = blob.z ? await gunzipBuf(plain) : plain;
    // 记下词库指纹：下次启动对比线上，词库更新过就要求重新解锁
    try {
      if (ctx.etag) localStorage.setItem('hedgehog:etag', ctx.etag);
    } catch (e) {}
    return JSON.parse(td.decode(bankBuf));
  }

  function setData(data) {
    DATA = data;
    TAGS = data.tags || {};
    LISTS = data.lists || [];
    LIST = {};
    IDX = {};
    ALL = [];
    LISTS.forEach(function (l) {
      LIST[l.id] = l;
      (l.words || []).forEach(function (x) {
        var ref = l.id + '/' + x.w;
        var e = { l: l, x: x, ref: ref };
        IDX[ref] = e;
        ALL.push(e);
      });
    });
    TABLES = data.tables || [];
    TBY = {};
    TABLES.forEach(function (t) { TBY[t.id] = t; });
    GRAMMARS = data.grammars || [];
    GBY = {};
    GRAMMARS.forEach(function (g) { GBY[g.id] = g; });
    // 图像钩子 / 助记 旁路表挂到词条上
    var hooks = data.hooks || {};
    LISTS.forEach(function (l) {
      (l.words || []).forEach(function (x) {
        var h = hooks[l.id + '/' + x.w];
        if (h) {
          x.img = h.img;
          x.mn = h.mn;
        }
      });
    });
  }

  var voicesCache = [];
  function loadVoices() {
    try { voicesCache = window.speechSynthesis.getVoices() || []; } catch (e) { voicesCache = []; }
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  function pickVoice(lang) {
    if (!voicesCache.length) loadVoices();
    var pref = String(lang || 'en').slice(0, 2).toLowerCase();
    for (var i = 0; i < voicesCache.length; i++) {
      var vl = String(voicesCache[i].lang || '').toLowerCase().replace('_', '-');
      if (vl.slice(0, 2) === pref) return voicesCache[i];
    }
    return null; // 没有匹配语言的语音：交给系统默认（可能无声，见说明）
  }

  var YOUDAO_LE = { en: 'en', ja: 'jap', ko: 'ko' };

  function toast(msg) {
    var t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  // 发音：自动按语种路由——优先有道发音音频（英日韩真人级，国内可直连），
  // 拿不到（断网/接口挂）再回退系统 TTS（选设备里对应语言的语音包）
  // 原始文本发音（表格点读共用）：text=要读的内容，le=语言，label=提示词，e=词条（可选，失败时回退系统朗读）
  function playAudio(text, le, label, e) {
    var url =
      'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&le=' + le;
    var a = new Audio();
    a.preload = 'auto';
    a.src = url;
    var settled = false;
    a.addEventListener('canplay', function () {
      if (!settled) { settled = true; toast('▶ ' + label); }
    });
    a.addEventListener('error', function () {
      if (!settled) { settled = true; toast('发音源不可用：' + label); }
      if (e) speakTTS(e);
    });
    var p = a.play();
    if (p && p.catch) {
      p.catch(function () {
        if (!settled) { settled = true; toast('播放被拦，再点一次试试'); }
        if (e) speakTTS(e);
      });
    }
  }

  function speak(ref) {
    var e = IDX[ref];
    if (!e) return;
    playAudio(e.x.w, YOUDAO_LE[e.l.lang] || 'en', e.x.w, e);
  }

  function speakTTS(e) {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance(e.x.w);
    u.lang = e.l.speech || 'en-US';
    var v = pickVoice(u.lang);
    if (v) u.voice = v;
    else if (e.l.lang && e.l.lang !== 'en') {
      toast('本机无' + (LANG_NAME[e.l.lang] || '') + '语音包（系统朗读会无声）');
    }
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // iOS/Safari 有时念完前一句就卡住：300ms 后兜底 resume
    setTimeout(function () {
      try { if (window.speechSynthesis.speaking) window.speechSynthesis.resume(); } catch (err) {}
    }, 300);
  }

  var lastAutoRef = null; // 自动朗读去重：同一词页内交互不重复播

  function pendingCount(l) {
    var k = known();
    return l.words.filter(function (x) { return !k[l.id + '/' + x.w]; }).length;
  }

  function isScene(l) { return l.group === 'scene'; }
  function coreLists() { return LISTS.filter(function (l) { return !isScene(l); }); }
  function sceneLists() { return LISTS.filter(isScene); }
  function isLit(l) { return l.words.length > 0 && pendingCount(l) === 0; }

  // 场景厅词条 = 同语言同主题的全库标签词（#2 选A：贴切才归类）+ 场景厅原精选词，按词形去重
  function sceneEntries(l) {
    var topic = (l.id.split('-').pop() || '').toLowerCase();
    var out = [], seen = {};
    (l.words || []).forEach(function (x) {
      seen[x.w] = 1;
      out.push({ l: l, x: x, ref: l.id + '/' + x.w });
    });
    ALL.forEach(function (e) {
      if (e.l.lang === l.lang && TAGS[e.ref] === topic && !seen[e.x.w]) {
        seen[e.x.w] = 1;
        out.push(e);
      }
    });
    return out;
  }

  // ---------- 视图：首页（门厅搜索 + 快捷入口） ----------
  function viewHome() {
    var coreWords = coreLists().reduce(function (n, l) { return n + l.words.length; }, 0);
    var scenes = sceneLists();
    var litCount = scenes.filter(isLit).length;
    var dueAll = dueRefsNow().length;
    var halls =
      '<div class="halls">' +
      '<a class="hall hall-link" href="#/categories">' +
      '<span class="k">HALL</span><b>词库</b><small>核心词 ' + coreWords + ' · 场景厅</small></a>' +
      '<a class="hall hall-link" href="#/study">' +
      '<span class="k">TOUR</span><b>背词</b><small>巡游与复习</small></a>' +
      '<a class="hall hall-link" href="#/tables">' +
      '<span class="k">STUDY</span><b>基础表</b><small>词根 · 音表</small></a>' +
      '<a class="hall hall-link" href="#/grammar">' +
      '<span class="k">GRAMMAR</span><b>语法</b><small>三语语法宫</small></a>' +
      '<a class="hall hall-link" href="#/favorites">' +
      '<span class="k">CABINET</span><b>收藏</b><small>' + favs().length + ' 件</small></a>' +
      '</div>';
    return (
      '<div class="hero">' +
      '<img class="sticker hero-sticker" src="icons/sticker-hog.svg" alt="" />' +
      '<h2>语感宫殿</h2>' +
      '<p class="sub">学习走宫殿 · 查询走门厅</p>' +
      '<div class="search-row"><input id="q" type="search" placeholder="门厅搜索：abolish / 마음 / 環境" autocomplete="off" /></div>' +
      '</div>' +
      '<div class="results" id="results"></div>' +
      halls +
      '<div class="home-stat">场景厅 <b>' + litCount + '/' + scenes.length + '</b> 已点亮' +
      (dueAll ? ' · ↻ <b>' + dueAll + '</b> 待复习' : '') + '</div>' +
      '<div class="data-row">' +
      '<button class="mini-btn" data-act="export-data">导出进度</button>' +
      '<button class="mini-btn" data-act="import-data">导入进度</button>' +
      '<button class="mini-btn" data-act="refresh-words">刷新词库</button>' +
      '<input type="file" id="importFile" accept=".json,application/json" hidden />' +
      '</div>' +
      '<p class="footnote">Hedgehog · 语感宫殿 · ' + APP_VER + '</p>'
    );
  }

  function renderResults(q) {
    var box = $('results');
    if (!box) return;
    q = q.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var hits = ALL.filter(function (e) {
      return (
        e.x.w.toLowerCase().indexOf(q) !== -1 ||
        (e.x.zh || '').indexOf(q) !== -1 ||
        (e.x.sense || '').toLowerCase().indexOf(q) !== -1 ||
        (e.x.pron || '').toLowerCase().indexOf(q) !== -1
      );
    });
    if (!hits.length) {
      box.innerHTML = '<div class="empty">没找到「' + esc(q) + '」</div>';
      return;
    }
    box.innerHTML = hits
      .map(function (e) {
        return (
          '<a class="result" href="' + wordHref(e) + '">' +
          '<b>' + esc(e.x.w) + '</b><i>' + esc(e.x.pron) + '</i>' +
          '<span>' + esc(e.x.zh) + '</span>' +
          '<em class="lang-tag lang-' + e.l.lang + '">' + (LANG_NAME[e.l.lang] || e.l.lang) + '</em></a>'
        );
      })
      .join('');
  }

  // ---------- 视图：词库 / 列表 / 详情 ----------
  function viewCategories() {
    var wordCards = coreLists().map(function (l) {
      var pend = pendingCount(l);
      return (
        '<a class="card cat-card lang-' + l.lang + '" href="#/categories/' + l.id + '">' +
        '<span><b>' + esc(l.title) + '</b><small>' +
        (LANG_NAME[l.lang] || l.lang) + ' · ' + l.words.length + ' 词 · 待学 ' + pend +
        '</small></span><span>→</span></a>'
      );
    }).join('');
    var mini = function (title, en, meta, href, lang) {
      return (
        '<a class="mini-card' + (lang ? ' lang-' + lang : '') + '" href="' + href + '">' +
        '<span class="en">' + esc(en) + '</span>' +
        '<b>' + esc(title) + '</b>' +
        '<small>' + meta + '</small></a>'
      );
    };
    var sceneChips =
      '<div class="filter-chips">' +
      [['all', '全部'], ['en', '英语'], ['ko', '韩语'], ['ja', '日语']]
        .map(function (p) {
          return (
            '<button class="fchip' + (sceneLang === p[0] ? ' on' : '') +
            '" data-act="scene-filter" data-lang="' + p[0] + '">' + p[1] + '</button>'
          );
        })
        .join('') +
      '</div>';
    var sceneCards = sceneLists()
      .filter(function (l) { return sceneLang === 'all' || l.lang === sceneLang; })
      .map(function (l) {
        var es = sceneEntries(l); // 全库该场景词（#2）
        var total = es.length;
        var k = known();
        var mastered = es.filter(function (e) { return k[e.ref]; }).length;
        var dc = listDueCount(l);
        return mini(
          l.title,
          l.enName || '',
          total + ' 词 · ' + (isLit(l) ? '● 已点亮' : mastered + '/' + total) + (dc ? ' · ↻' + dc : ''),
          '#/categories/' + l.id,
          l.lang
        );
      })
      .join('');
    return (
      '<h2>词库</h2>' + wordCards +
      '<h2 class="group-h">场景厅</h2>' + sceneChips +
      '<div class="wordlist">' + sceneCards + '</div>'
    );
  }

  function viewList(listId) {
    var l = LIST[listId];
    if (!l) return viewCategories();
    if (isScene(l)) return viewRoom(l);
    // 懒渲染：整页 5,500+ 词块会卡 1-3 秒，首屏 100 +「加载更多」
    if (listShownFor !== listId) { listShownFor = listId; listShown = 100; }
    var shown = l.words.slice(0, listShown);
    var chips = shown
      .map(function (x) {
        return (
          '<a class="word-chip" href="#/word/' + l.id + '/' + encodeURIComponent(x.w) + '">' +
          '<b>' + esc(x.w) + '</b><small>' + esc(x.zh) + '</small></a>'
        );
      })
      .join('');
    var more = l.words.length > listShown
      ? '<button class="mini-btn" data-act="list-more">加载更多（已显示 ' + shown.length + '/' + l.words.length + '）</button>'
      : '';
    return (
      '<a class="back-link" href="#/categories">← 词库</a>' +
      '<h2>' + esc(l.title) + '</h2>' +
      '<div class="wordlist">' + chips + '</div>' + more
    );
  }

  // 场景厅房间页（展位号 + 陈设钩子）
  function viewRoom(l) {
    // 场景厅 = 全库该场景标签词 + 原精选词（#2 选A），同样懒渲染
    if (listShownFor !== 'room:' + l.id) { listShownFor = 'room:' + l.id; listShown = 100; }
    var entries = sceneEntries(l);
    var total = entries.length;
    var k = known();
    var mastered = entries.filter(function (e) { return k[e.ref]; }).length;
    var lit = isLit(l);
    var dc = listDueCount(l);
    var chips = entries.slice(0, listShown)
      .map(function (e, i) {
        return (
          '<a class="word-chip" href="#/word/' + e.l.id + '/' + encodeURIComponent(e.x.w) + '">' +
          '<span class="slot">No.' + (i + 1) + ' 展台</span>' +
          '<b>' + esc(e.x.w) + '</b><small>' + esc(e.x.zh) + '</small></a>'
        );
      })
      .join('');
    var more = entries.length > listShown
      ? '<button class="mini-btn" data-act="list-more">加载更多（已显示 ' + Math.min(listShown, entries.length) + '/' + total + '）</button>'
      : '';
    return (
      '<a class="back-link" href="#/home">← 宫殿总图</a>' +
      '<div class="room-head lang-' + l.lang + '">' +
      '<span class="room-en">' + esc(l.enName || l.title) + '</span>' +
      '<h2>' + esc(l.title) + '</h2>' +
      '<span class="prog' + (lit ? ' on' : '') + '">' +
      (lit ? '● 已点亮' : '○ 未点亮') + ' · ' + mastered + '/' + total +
      (dc ? ' · <span class="due-b">↻ ' + dc + ' 待复习</span>' : '') +
      '</span></div>' +
      '<div class="dress">' + esc(l.dress || '') + '</div>' +
      '<div class="wordlist">' + chips + '</div>' + more +
      '<p class="footnote">走完整厅点亮房间 · 点词进详情看宫殿地址</p>'
    );
  }

  // 构词解剖：扫描词根词缀表，找出这个单词里藏着的已知语素（零人工，纯计算）
  function morphemesOf(w) {
    var t = TBY['en-roots'];
    if (!t) return [];
    var low = w.toLowerCase();
    var out = [];
    (t.sections || []).forEach(function (s) {
      var kind = /前缀/.test(s.title) ? '前缀' : /后缀/.test(s.title) ? '后缀' : '词根';
      (s.rows || []).forEach(function (r) {
        String(r.form || '')
          .split('/')
          .forEach(function (f0) {
            var f = f0.trim().toLowerCase().replace(/[①②]/g, '');
            if (f.length < 2) return;
            var hit = '';
            if (kind === '前缀' && low.indexOf(f) === 0 && low.length > f.length) hit = '前缀';
            else if (kind === '后缀' && low.length > f.length + 2 && low.lastIndexOf(f) === low.length - f.length) hit = '后缀';
            else if (kind === '词根' && low.indexOf(f) !== -1 && low.length > f.length) hit = '词根';
            if (hit && out.length < 5 && !out.some(function (o) { return o.f === f; })) {
              out.push({ f: f, m: r.meaning, kind: hit });
            }
          });
      });
    });
    return out;
  }

  function viewWord(listId, w) {
    var e = IDX[listId + '/' + w];
    if (!e) {
      return (
        '<a class="back-link" href="#/categories">← 词库</a>' +
        '<div class="empty"><img class="sticker sticker-sm" src="icons/sticker-hog.svg" alt="" />' +
        '<div>词库里还没有「' + esc(w) + '」</div></div>'
      );
    }
    var x = e.x;
    var l = e.l;
    var fav = isFav(e.ref);
    var ex = (x.ex || [])
      .map(function (it) {
        return '<div class="ex"><div class="en">' + esc(it.en) + '</div><div class="zh">' + esc(it.zh) + '</div></div>';
      })
      .join('');
    var collo = (x.collo || [])
      .map(function (c) { return '<span>' + esc(c) + '</span>'; })
      .join('');
    var addr = '';
    if (isScene(l)) {
      var slotNo = l.words.indexOf(x) + 1;
      addr =
        '<div class="locus-addr"><i>PALACE ADDRESS</i> ' +
        esc(l.title) + ' · No.' + slotNo + ' 展台</div>';
    }
    var hookSec = '';
    if (x.img || x.mn) {
      hookSec =
        '<div class="entry-section"><span class="entry-label">记忆钩子</span>' +
        (x.img ? '<p class="hook-img">' + esc(x.img) + '</p>' : '') +
        (x.mn ? '<p class="hook-mn">' + esc(x.mn) + '</p>' : '') +
        '</div>';
    }
    var morphSec = '';
    if (l.lang === 'en') {
      var mm = morphemesOf(x.w);
      if (mm.length) {
        morphSec =
          '<div class="entry-section"><span class="entry-label">构词解剖</span><div class="collo">' +
          mm
            .map(function (o) {
              return '<span><b>' + esc(o.f) + '</b> ' + esc(o.m) + '（' + o.kind + '）</span>';
            })
            .join('') +
          '</div></div>';
      }
    }
    var sents = lsGet('hedgehog:sentences', {});
    var sentSec =
      '<div class="entry-section"><span class="entry-label">造句本 · 我的例句</span>' +
      '<div class="sent-box">' +
      '<textarea id="sentInput" rows="2" placeholder="用这个词造一个你自己的句子…">' +
      esc(sents[e.ref] || '') +
      '</textarea>' +
      '<button class="btn ghost" data-act="save-sent" data-ref="' + esc(e.ref) + '">保存</button>' +
      '<span class="sent-hint" id="sentHint"></span>' +
      '</div></div>';
    var writeSec =
      '<div class="entry-section"><span class="entry-label">书写练习</span>' +
      '<canvas id="wmCanvas" width="720" height="280"></canvas>' +
      '<div class="cb-tools">' +
      '<button class="btn ghost" data-act="wm-clear">清一下</button>' +
      '<span class="tour-slot">在这块板上写写这个词</span>' +
      '</div></div>';
    var idxW = l.words.indexOf(x);
    var nextX = l.words[(idxW + 1) % l.words.length];
    var prevX = l.words[(idxW - 1 + l.words.length) % l.words.length];
    var nextBtn =
      '<div class="word-foot">' +
      '<a class="btn ghost" href="#/word/' + l.id + '/' + encodeURIComponent(prevX.w) + '">' +
      '← 上一个：' + esc(prevX.w) + '</a>' +
      '<a class="btn ghost" href="#/word/' + l.id + '/' + encodeURIComponent(nextX.w) + '">' +
      '下一个：' + esc(nextX.w) + ' →</a></div>';
    return (
      '<a class="back-link" href="#/categories/' + l.id + '">← ' + esc(l.title) + '</a>' +
      '<div class="card lang-card lang-' + l.lang + '">' +
      '<div class="word-head">' +
      '<h2>' + esc(x.w) + '</h2>' +
      '<span class="ipa">' + esc(x.pron) + '</span>' +
      '<span class="pos">' + esc(x.pos) + '</span>' +
      '<em class="lang-tag lang-' + l.lang + '">' + (LANG_NAME[l.lang] || l.lang) + '</em>' +
      '<button class="icon-btn" data-act="speak" data-ref="' + esc(e.ref) + '" title="发音">' + ICON.sound + '</button>' +
      '<button class="icon-btn star' + (fav ? ' on' : '') + '" data-act="star" data-ref="' + esc(e.ref) + '" title="收藏">' + ICON.star + '</button>' +
      '</div>' +
      '<p class="zh-line">' + esc(x.zh) + '</p>' + addr +
      '<div class="entry-section"><span class="entry-label">词感</span><p>' + esc(x.sense) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">中式误区</span><p class="trap">' + esc(x.trap) + '</p></div>' +
      hookSec +
      '<div class="entry-section"><span class="entry-label">高频搭配</span><div class="collo">' + collo + '</div></div>' +
      morphSec +
      '<div class="entry-section"><span class="entry-label">例句</span><div class="ex-list">' + ex + '</div></div>' +
      sentSec +
      writeSec +
      '</div>' + nextBtn
    );
  }

  // ---------- 视图：巡游（背词的宫殿化） ----------
  function minimapHTML() {
    var stops = session.queue
      .map(function (_, i) {
        var cls = i < session.idx ? 'done' : i === session.idx ? 'cur' : '';
        return '<span class="stop ' + cls + '">' + (i + 1) + '</span>';
      })
      .join('<span class="seg"></span>');
    return '<div class="minimap">' + stops + '</div>';
  }

  function pickBtn(l) {
    // 场景厅按钮与词库一致：按全库该场景词算待学数（#2）
    var pend;
    if (isScene(l)) {
      var k = known();
      pend = sceneEntries(l).filter(function (e) { return !k[e.ref]; }).length;
    } else {
      pend = pendingCount(l);
    }
    var dc = listDueCount(l);
    var sub = isScene(l)
      ? isLit(l)
        ? '● 已点亮'
        : pend + ' 词待学 · 走完点灯'
      : pend
        ? '待学 ' + pend + ' 词'
        : '已全会 · 可复习';
    if (dc) sub += ' · ↻' + dc + ' 待复习';
    return (
      '<button class="word-chip' + (isScene(l) && isLit(l) ? ' lit' : '') + '" ' +
      'data-act="start-study" data-kind="normal" data-list="' + l.id + '">' +
      '<b>' + esc(l.title.replace(/（.*?）/, '')) + '</b>' +
      '<small>' + sub + '</small></button>'
    );
  }

  // 拼写模式卡片：看中文写词（系统手写输入可直接填入）
  function spellCardHTML(e, ref) {
    if (!session.spellChecked) {
      return (
        '<div class="card study-card spell">' +
        '<div class="spell-hint">看中文，写出这个词</div>' +
        '<div class="spell-zh">' + esc(e.x.zh) + '</div>' +
        '<div class="spell-tools">' +
        '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">' + ICON.sound + '</button>' +
        '<span class="tour-slot">可先听发音 · 支持手写输入</span></div>' +
        '<div class="spell-row">' +
        '<input id="spellInput" type="text" autocomplete="off" autocapitalize="none" ' +
        'autocorrect="off" spellcheck="false" placeholder="输入或手写" />' +
        '<button class="btn" id="spellCheckBtn" data-act="spell-check">检查</button>' +
        '</div></div>'
      );
    }
    return (
      '<div class="card study-card spell">' +
      '<div class="spell-result ' + (session.spellOk ? 'ok' : 'err') + '">' +
      (session.spellOk ? '✓ 正确' : '✗ 不对') +
      '</div>' +
      '<div class="sw">' + esc(e.x.w) + '</div>' +
      '<div class="sipa">' + esc(e.x.pron) + ' · ' + esc(e.x.zh) + '</div>' +
      (session.spellOk
        ? ''
        : '<div class="spell-answer">正确答案：<b>' + esc(e.x.w) + '</b></div>') +
      '<button class="btn" data-act="spell-next" style="margin-top:16px">下一站</button>' +
      '</div>'
    );
  }

  // 书写模式卡片：凭记忆手写 → 与答案并排比对 → 自评
  function writeCardHTML(e, ref) {
    if (!session.wmCompare) {
      return (
        '<div class="card study-card write">' +
        '<div class="spell-hint">凭记忆在板子上手写这个词</div>' +
        '<div class="spell-zh">' + esc(e.x.zh) + '</div>' +
        '<div class="spell-tools">' +
        '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">' + ICON.sound + '</button>' +
        '<span class="tour-slot">听发音可选 · 写完点比对</span></div>' +
        '<canvas id="wmCanvas" width="720" height="300"></canvas>' +
        '<div class="cb-tools">' +
        '<button class="btn" data-act="wm-done">写好了 · 比对</button>' +
        '<button class="btn ghost" data-act="wm-clear">清一下</button>' +
        '</div></div>'
      );
    }
    return (
      '<div class="card study-card write">' +
      '<div class="wm-compare">' +
      '<figure class="wm-ours"><figcaption>你写的</figcaption>' +
      (session.wmShot ? '<img src="' + session.wmShot + '" alt="我的书写" />' : '') +
      '</figure>' +
      '<figure class="wm-model"><figcaption>正确答案</figcaption>' +
      '<div class="write-model">' + esc(e.x.w) + '</div>' +
      '<div class="sipa">' + esc(e.x.pron) + '</div>' +
      '</figure></div>' +
      '<div class="spell-zh">' + esc(e.x.zh) + '</div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="wm-again">✗ 再练</button>' +
      '<button class="btn" data-act="wm-good">✓ 对了</button>' +
      '</div></div>'
    );
  }

  function studyScreen() {
    if (!session) {
      var dueN = dueRefsNow().length;
      var modeSeg =
        '<div class="seg-ctl">' +
        '<button type="button" class="seg' + (pickMode === 'card' ? ' on' : '') +
        '" data-act="set-mode" data-mode="card">认卡</button>' +
        '<button type="button" class="seg' + (pickMode === 'spell' ? ' on' : '') +
        '" data-act="set-mode" data-mode="spell">拼写</button>' +
        '<button type="button" class="seg' + (pickMode === 'write' ? ' on' : '') +
        '" data-act="set-mode" data-mode="write">书写</button>' +
        '</div>';
      var cards = '';
      if (dueN) {
        cards +=
          '<button class="entry-card review" data-act="start-study" data-kind="review">' +
          '<b>今日复习 · ' + Math.min(dueN, sessionSize) + ' 站</b>' +
          '<small>到期的词自动回到这里 · 记忆间隔 1 / 3 / 7 / 15 天</small></button>';
      }
      cards +=
        '<button class="entry-card" data-act="start-study" data-kind="mix">' +
        '<b>串门混考</b>' +
        '<small>随机跨厅抽 ' + sessionSize + ' 站 · 交错练习记得更牢</small></button>' +
        '<a class="entry-card exam-entry" href="#/exam"><b>📝 考场 · JLPT N1 模拟</b>' +
        '<small>按真题题型原创组卷 · 倒计时 · 成绩换算 · 错题入复习</small></a>' +
        '<a class="entry-card" href="#/copybook"><b>练字本</b>' +
        '<small>画板写写贴贴 · 字形肌肉记忆</small></a>';
      var scenes = sceneLists();
      var cores = coreLists();
      var groups = '';
      if (scenes.length) {
        groups +=
          '<p class="picker-h">场景厅 · 巡游点灯</p>' +
          '<div class="wordlist">' + scenes.map(pickBtn).join('') + '</div>';
      }
      if (cores.length) {
        groups +=
          '<p class="picker-h">词库</p>' +
          '<div class="wordlist">' + cores.map(pickBtn).join('') + '</div>';
      }
      var sizeRow =
        '<div class="size-row">每轮 <input id="sizeInput" type="number" min="5" max="100" step="1" value="' +
        sessionSize + '" /> 站 <small>5~100，改完自动生效</small></div>';
      return (
        '<h2>巡游</h2>' +
        '<p class="sub">先选模式，再选出发点 · 每轮 ' + sessionSize + ' 站 · 进度存在本机</p>' +
        sizeRow +
        modeSeg + cards + groups + weeklyHTML()
      );
    }
    if (session.idx >= session.queue.length) {
      var doneList = session.listId ? LIST[session.listId] : null;
      var banner;
      if (session.kind === 'review') {
        banner = '<div class="lit-banner">↻ 今日复习完成 · ' + session.queue.length + ' 站</div>';
      } else if (session.kind === 'mix') {
        banner = '<div class="lit-banner">✦ 串门混考完成 · ' + session.queue.length + ' 站</div>';
      } else if (doneList && isLit(doneList)) {
        banner = '<div class="lit-banner">✦ ' + esc(doneList.title) + ' 已点亮</div>';
      } else {
        banner = '';
      }
      return (
        '<h2>巡游</h2>' +
        '<div class="card study-done">' + banner +
        '<img class="sticker" src="icons/sticker-hog.svg" alt="" />' +
        '<div class="stamp">完成</div>' +
        '<p>本轮完成：认识 <b>' + session.good + '</b> · 模糊 <b>' + session.bad + '</b></p>' +
        '<div class="study-actions">' +
        '<button class="btn" data-act="study-home">再巡一轮</button>' +
        '<a class="btn ghost" href="#/home" style="text-align:center">回总图</a>' +
        '</div></div>'
      );
    }
    var ref = session.queue[session.idx];
    var e = IDX[ref];
    var x = e.x;
    var l = e.l;
    var pct = Math.round((session.idx / session.queue.length) * 100);
    var kindLabel =
      session.kind === 'review' ? '今日复习' : session.kind === 'mix' ? '串门混考' : '巡游中';
    var slotNote =
      '<span class="tour-slot">' + esc(l.title.replace(/（.*?）/, '')) +
      (isScene(l) ? ' · No.' + (l.words.indexOf(x) + 1) + ' 展台' : '') +
      '</span> ';
    var head =
      '<h2>巡游</h2>' +
      '<div class="study-meta"><span>' + kindLabel + ' · ' + esc(l.title.replace(/（.*?）/, '')) +
      ' · 第 ' + (session.idx + 1) + '/' + session.queue.length + ' 站</span>' +
      '<span><button class="mini-btn" data-act="study-home">✕ 退出重选</button>' +
      ' 认识 ' + session.good + ' · 模糊 ' + session.bad + '</span></div>' +
      minimapHTML() +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>';

    if (session.mode === 'spell') return head + spellCardHTML(e, ref);
    if (session.mode === 'write') return head + writeCardHTML(e, ref);

    if (!session.revealed) {
      return (
        head +
        '<div class="card study-card">' +
        slotNote +
        '<div class="sw">' + esc(x.w) + '</div>' +
        '<div class="sipa">' + esc(x.pron) + '</div>' +
        '<div class="study-actions">' +
        '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">' + ICON.sound + '</button>' +
        '</div>' +
        '<button class="btn" data-act="reveal" style="margin-top:14px">显示词感</button>' +
        '</div>'
      );
    }
    var collo = (x.collo || []).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
    return (
      head +
      '<div class="card study-card">' +
      slotNote +
      '<div class="sw">' + esc(x.w) + '</div>' +
      '<div class="sipa">' + esc(x.pron) + ' · ' + esc(x.zh) + '</div>' +
      '<div class="study-back">' +
      '<div class="entry-section"><span class="entry-label">词感</span><p style="text-align:left">' + esc(x.sense) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">搭配</span><div class="collo">' + collo + '</div></div>' +
      '</div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="blur">模糊</button>' +
      '<button class="btn" data-act="good">认识</button>' +
      '</div></div>'
    );
  }

  // 开一轮：kind = normal(按厅) / review(今日到期) / mix(串门混考)
  function startSession(opts) {
    var refs = [];
    var k = known();
    var N = sessionSize; // 每轮站数（#4 可设置）
    if (opts.kind === 'review') {
      refs = shuffle(dueRefsNow()).slice(0, N);
    } else if (opts.kind === 'mix') {
      var m = dueMap();
      var t = now();
      var pool = ALL.filter(function (e) {
        return !k[e.ref] || (m[e.ref] && m[e.ref].d <= t);
      }).map(function (e) { return e.ref; });
      refs = shuffle(pool).slice(0, N);
    } else {
      var l = LIST[opts.listId];
      if (!l) return false;
      var fresh = [];
      var rev = [];
      // 场景厅学全库该场景词（#2 与词库一致）；普通词表学本表
      var entries = isScene(l)
        ? sceneEntries(l)
        : l.words.map(function (x) { return { ref: l.id + '/' + x.w }; });
      entries.forEach(function (e) {
        (k[e.ref] ? rev : fresh).push(e.ref);
      });
      refs = fresh.slice(0, N);
      if (refs.length < N) refs = fresh.concat(rev).slice(0, N);
    }
    if (!refs.length) return false;
    session = {
      queue: refs,
      idx: 0,
      good: 0,
      bad: 0,
      mode: opts.mode || 'card',
      kind: opts.kind || 'normal',
      listId: opts.listId || null,
      revealed: false,
      spellChecked: false,
      spellOk: false,
      wmCompare: false,
      wmShot: null,
      logged: false,
    };
    return true;
  }

  // 记录一站的结果：认识→掌握+间隔晋级；模糊→退出掌握+明天回访
  function recordStudy(good) {
    var ref = session.queue[session.idx];
    var k = known();
    if (good) {
      k[ref] = 1;
      session.good++;
    } else {
      delete k[ref];
      session.bad++;
    }
    lsSet('hedgehog:known', k);
    scheduleRef(ref, good);
  }

  function advanceSession() {
    session.idx++;
    session.revealed = false;
    session.spellChecked = false;
    session.spellOk = false;
    session.wmCompare = false;
    session.wmShot = null;
    if (session.idx >= session.queue.length && !session.logged) {
      session.logged = true;
      logStamp();
    }
  }

  // ---------- 视图：收藏 ----------
  function viewFavorites() {
    var list = favs().map(function (ref) { return IDX[ref]; }).filter(Boolean);
    if (!list.length) {
      return (
        '<h2>我的收藏</h2>' +
        '<div class="empty"><img class="sticker sticker-sm" src="icons/sticker-hog.svg" alt="" />' +
        '<div>还没有收藏。在词页点 ★ 收藏</div></div>'
      );
    }
    var chips = list
      .map(function (e) {
        return (
          '<a class="word-chip" href="' + wordHref(e) + '">' +
          '<b>' + esc(e.x.w) + '</b><small>' + esc(e.x.zh) + '</small></a>'
        );
      })
      .join('');
    return '<h2>我的收藏</h2><div class="wordlist">' + chips + '</div>';
  }

  // ---------- 视图：语法翼楼 ----------
  function totalPoints(g) {
    return (g.rooms || []).reduce(function (n, r) { return n + (r.points || []).length; }, 0);
  }

  function viewGrammarHub() {
    var cards = GRAMMARS.map(function (g) {
      return (
        '<a class="card cat-card lang-' + g.lang + '" href="#/grammar/' + g.id + '">' +
        '<span><b>' + esc(g.title) + '</b><small>' + esc(g.enName || '') +
        ' · ' + (g.rooms || []).length + ' 宫室 · ' + totalPoints(g) + ' 点</small></span>' +
        '<span>→</span></a>'
      );
    }).join('');
    var have = {};
    GRAMMARS.forEach(function (g) { have[g.lang] = true; });
    var soon = '';
    [['ko', '韩语语法翼楼'], ['ja', '日语语法翼楼']].forEach(function (p) {
      if (!have[p[0]]) {
        soon +=
          '<div class="card cat-card" style="opacity:.65;margin-top:12px">' +
          '<span><b>' + p[1] + '</b><small>建設中</small></span><span>Coming</span></div>';
      }
    });
    return (
      '<h2>语法翼楼</h2>' +
      '<p class="sub">一条走廊走完宫室，就是背语法的顺序</p>' +
      cards + soon
    );
  }

  function viewGrammarWing(gid) {
    var g = GBY[gid];
    if (!g) return viewGrammarHub();
    var rooms = (g.rooms || [])
      .map(function (r, i) {
        return (
          '<a class="room lit" href="#/grammar/' + gid + '/' + r.id + '">' +
          '<span class="door" aria-hidden="true"></span>' +
          '<span class="lit-dot">ROOM No.' + (i + 1) + '</span>' +
          '<div class="room-en">' + esc(r.enName || '') + '</div>' +
          '<h4>' + esc(r.name) + '</h4>' +
          '<div class="room-meta">' + (r.points || []).length + ' 个语法点 · ' +
          esc(r.summary || '') + '</div></a>'
        );
      })
      .join('');
    return (
      '<a class="back-link" href="#/grammar">← 语法翼楼</a>' +
      '<div class="room-head"><span class="room-en">' + esc(g.enName || '') +
      '</span><h2>' + esc(g.title) + '</h2></div>' +
      '<div class="floor">' + rooms + '</div>' +
      '<p class="footnote">按号走完宫室 · 每点先回想再展开</p>'
    );
  }

  function viewGrammarRoom(gid, rid) {
    var g = GBY[gid];
    var r = g && (g.rooms || []).filter(function (x) { return x.id === rid; })[0];
    if (!r) return viewGrammarWing(gid);
    var no = g.rooms.indexOf(r) + 1;
    var pts = (r.points || [])
      .map(function (p, i) {
        var formulaSec =
          p.formula && !/—/.test(p.formula)
            ? '<span class="lbl">公式</span><span class="formula">' + esc(p.formula) + '</span>'
            : '';
        var exSec = (p.ex || [])
          .map(function (e0) {
            return '<div class="ex"><b>' + esc(e0.en) + '</b><small>' + esc(e0.zh) + '</small></div>';
          })
          .join('');
        return (
          '<details class="pt"><summary><span class="n">' + (i + 1) + '.</span> ' +
          esc(p.t) + '</summary><div class="body">' +
          '<span class="lbl">核心语感</span>' + esc(p.core) +
          formulaSec +
          '<span class="lbl">例句</span>' + exSec +
          '<span class="lbl">中式误区</span><div class="trap">' + esc(p.trap) + '</div>' +
          '</div></details>'
        );
      })
      .join('');
    return (
      '<a class="back-link" href="#/grammar/' + gid + '">← ' + esc(g.title) + '</a>' +
      '<div class="room-head"><span class="room-en">ROOM No.' + no +
      (r.enName ? ' · ' + esc(r.enName) : '') + '</span><h2>' + esc(r.name) + '</h2></div>' +
      '<p class="sub">' + esc(r.summary || '') + '</p>' + pts
    );
  }

  // ---------- 视图：练字本（画板 + 贴图册） ----------
  function viewCopybook() {
    var items = lsGet('hedgehog:copybook', []);
    var gallery = items.length
      ? '<div class="cb-gallery">' +
        items
          .map(function (it, i) {
            return (
              '<figure class="cb-item">' +
              '<img src="' + it.img + '" alt="练字" />' +
              '<figcaption>' + new Date(it.t).toLocaleDateString() + '</figcaption>' +
              '<button class="cb-del" data-act="cb-del" data-i="' + i + '" title="删除">×</button>' +
              '</figure>'
            );
          })
          .join('') +
        '</div>'
      : '<div class="empty">画点什么贴进来，这里就是你的练字页</div>';
    return (
      '<a class="back-link" href="#/study">← 巡游</a>' +
      '<h2>练字本</h2>' +
      '<p class="sub">用笔在下面写（字、词、涂鸦都行）· 贴进本子存本机 · 最多 20 张</p>' +
      '<div class="card cb-card">' +
      '<canvas id="cbCanvas" width="720" height="360"></canvas>' +
      '<div class="cb-tools">' +
      '<button class="btn" data-act="cb-save">贴进本子</button>' +
      '<button class="btn ghost" data-act="cb-clear">清空画板</button>' +
      '<span class="sent-hint" id="cbHint"></span>' +
      '</div></div>' +
      gallery
    );
  }

  // 就地清空画板（不整页重渲染，避免跳回顶部）
  function clearPad(id) {
    var cv = $(id);
    if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fdfbf4';
    ctx.fillRect(0, 0, cv.width, cv.height);
  }

  function initCanvas() {
    var cv = $('cbCanvas') || $('wmCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fdfbf4';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#3c3a36';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var drawing = false;
    var last = null;
    function pos(ev) {
      var r = cv.getBoundingClientRect();
      return {
        x: ((ev.clientX - r.left) * cv.width) / r.width,
        y: ((ev.clientY - r.top) * cv.height) / r.height,
      };
    }
    cv.addEventListener('pointerdown', function (ev) {
      drawing = true;
      last = pos(ev);
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drawing) return;
      var p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () { drawing = false; });
    });
  }

  // 书阁：基础表入口页
  function viewTablesHub() {
    var cards = TABLES.map(function (t) {
      return (
        '<a class="mini-card lang-' + t.lang + '" href="#/tables/' + t.id + '">' +
        '<span class="en">' + esc(String(t.id || '').toUpperCase().replace(/-/g, ' ')) + '</span>' +
        '<b>' + esc(t.title) + '</b>' +
        '<small>' + esc(t.subtitle || '') + '</small></a>'
      );
    }).join('');
    return (
      '<h2>基础表</h2>' +
      '<p class="sub">词根 · 韩语音表 · 日语五十音</p>' +
      '<div class="wordlist">' + cards + '</div>'
    );
  }

  // ---------- 视图：基础表 ----------
  function viewTable(id) {
    var t = TBY[id];
    if (!t) return viewTablesHub();
    var body = (t.sections || []).map(function (sec) { return renderSection(sec, t.lang); }).join('');
    return (
      '<a class="back-link" href="#/tables">← 基础表</a>' +
      '<div class="table-head lang-' + t.lang + '">' +
      '<h2>' + esc(t.title) + '</h2>' +
      '<em class="lang-tag lang-' + t.lang + '">' + (LANG_NAME[t.lang] || t.lang) + '</em>' +
      '<p class="sub">' + esc(t.subtitle || '') + '</p>' +
      '</div>' + body +
      '<p class="footnote">Hedgehog · 基础表 · 内容全部原创</p>'
    );
  }

  var LE_FOR = { ja: 'jap', ko: 'ko', en: 'en' };
  function sayable(c, lang) {
    var t = String(c || '').trim();
    if (!t || t.length > 2) return null;
    if (lang === 'ja' && /^[぀-ヿー]$|^[ぁ-んァ-ン]$|^[ぁ-ん]{1,2}$|^[ァ-ン]{1,2}$/.test(t)) return t;
    if (lang === 'ko' && /^[ㄱ-ㅎㅏ-ㅣ가-힣]{1,2}$/.test(t)) return t;
    return null;
  }

  function renderSection(s, lang) {
    var note = s.note ? '<p class="table-note">' + esc(s.note) + '</p>' : '';
    var inner = '';
    if (s.type === 'morphemes') {
      inner =
        '<div class="morph-list">' +
        s.rows.map(function (r) {
          return (
            '<div class="card morph-row">' +
            '<div class="morph-top"><b class="morph-form">' + esc(r.form) + '</b>' +
            '<span class="morph-mean">' + esc(r.meaning) + '</span></div>' +
            '<div class="morph-ex">' +
            (r.examples || []).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') +
            '</div></div>'
          );
        }).join('') +
        '</div>';
    } else if (s.type === 'grid') {
      var sayGrid = '';
      inner =
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        s.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        s.rows.map(function (r) {
          return (
            '<tr>' +
            r.map(function (c, i) {
              var sy = lang ? sayable(c, lang) : null;
              if (sy) sayGrid = '1';
              var sayAttr = sy
                ? ' class="sayable" data-say="' + esc(sy) + '" data-le="' + (LE_FOR[lang] || 'ko') + '"'
                : '';
              return i === 0
                ? '<th scope="row"' + sayAttr + '>' + esc(c) + '</th>'
                : '<td' + sayAttr + '>' + esc(c) + '</td>';
            }).join('') +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div><p class="scroll-hint">← 左右滑动查看完整表格 →</p>' +
        (sayGrid ? '<p class="table-note">点字母 / 音节即可发音</p>' : '');
    } else if (s.type === 'matrix') {
      inner =
        '<div class="table-wrap"><table class="matrix-table"><thead><tr>' +
        '<th class="corner">' + esc(s.colHead || '') + '</th>' +
        s.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        s.rows.map(function (r) {
          return (
            '<tr><th scope="row">' + esc(r.label) + '</th>' +
            r.cells.map(function (c) {
              if (c === '・') return '<td class="blank">・</td>';
              var p = c.split('·');
              return (
                '<td class="sayable" data-say="' + esc(p[0]) + '" data-le="' + (LE_FOR[lang] || 'jap') + '">' +
                '<b>' + esc(p[0]) + '</b>' +
                (p[1] ? '<i>' + esc(p[1]) + '</i>' : '') +
                (p[2] ? '<small>' + esc(p[2]) + '</small>' : '') +
                '</td>'
              );
            }).join('') +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>' +
        '<p class="scroll-hint">← 左右滑动查看完整表格 →</p>' +
        '<p class="table-note">点格子即可发音（读假名）</p>' +
        (s.footnote ? '<p class="table-note">' + esc(s.footnote) + '</p>' : '');
    } else if (s.type === 'rules') {
      inner =
        '<div class="rule-grid">' +
        s.cards.map(function (c) {
          return (
            '<div class="card rule-card"><h4>' + esc(c.name) + '</h4>' +
            '<p>' + esc(c.desc) + '</p>' +
            (c.ex ? '<div class="rule-ex">' + esc(c.ex) + '</div>' : '') +
            '</div>'
          );
        }).join('') +
        '</div>';
    }
    return (
      '<section class="table-section"><h3>' + esc(s.title) + '</h3>' +
      note + inner + '</section>'
    );
  }

  // ---------- 路由 ----------
  // ---------- 考场（模拟考试） ----------
  // 双仿真卷：JLPT N1 / TOPIK II（题型按真题结构、题目原创）；倒计时/答题卡/成绩换算/错题入复习。
  // 真题不入库（版权）：经「导入真题卷」存本机 IndexedDB（#②）。
  var exam = null;
  var examTimerId = null;
  var examType = 'jlpt-n1';
  var EXAM_TYPES = {
    'jlpt-n1': {
      name: 'JLPT N1 模拟卷（仿真）', grammarLang: 'ja', speech: 'ja-JP',
      sections: [
        { key: 'kanji', title: '文字・語彙 · 漢字読み', qn: 20, minutes: 15, note: '看汉字词选正确读音' },
        { key: 'context', title: '文字・語彙 · 文脈規定', qn: 20, minutes: 20, note: '句中挖空，选最贴切的词' },
        { key: 'meaning', title: '文字・語彙 · 意味規定', qn: 15, minutes: 10, note: '选词语的正确中文义' },
        { key: 'grammar', title: '文法', qn: 20, minutes: 20, note: '选出句子所用的语法形式' },
        { key: 'listen', title: '聴解 · 即時応答', qn: 20, minutes: 15, note: '听发音选词义（可重播）' }
      ] // 95 题 · 80 分钟
    },
    'topik-ii': {
      name: 'TOPIK II 模拟卷（仿真）', grammarLang: 'ko', speech: 'ko-KR',
      sections: [
        { key: 'l-cont', title:'듣기 · 내용 파악', qn: 15, minutes: 20, note: '听句子，选正确的中文翻译' },
        { key: 'l-word', title:'듣기 · 어휘', qn: 15, minutes: 15, note: '听词，选中文义（可重播）' },
        { key: 'v-mean', title:'어휘 · 뜻 고르기', qn: 25, minutes: 20, note: '看词选正确的中文义' },
        { key: 'v-ctx', title:'어휘 · 문맥 채우기', qn: 25, minutes: 30, note: '句中挖空，选最贴切的词' },
        { key: 'g-form', title:'문법 · 연결어미', qn: 20, minutes: 25, note: '选出句子所用的语法形式' }
      ] // 100 题 · 110 分钟（≈真题 2 教时）
    }
  };
  var examSels = {};
  Object.keys(EXAM_TYPES).forEach(function (k) {
    examSels[k] = {};
    EXAM_TYPES[k].sections.forEach(function (s) { examSels[k][s.key] = true; });
  });

  function examSpeechLang() {
    var t = EXAM_TYPES[exam ? exam.typeKey : examType];
    return (t && t.speech) || 'ja-JP';
  }

  function examSpeak(text) {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = examSpeechLang();
    var v = pickVoice(u.lang);
    if (v) u.voice = v;
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setTimeout(function () {
      try { if (window.speechSynthesis.speaking) window.speechSynthesis.resume(); } catch (err) {}
    }, 300);
  }

  function exPick(arr, n, used, keyFn) {
    var out = [], guard = 0;
    while (out.length < n && guard++ < arr.length * 4) {
      var it = arr[Math.floor(Math.random() * arr.length)];
      var k = keyFn(it);
      if (!k || used[k]) continue;
      used[k] = 1;
      out.push(it);
    }
    return out;
  }

  function optSet(correct, distractors) {
    var opts = [{ t: correct, ok: true }];
    distractors.forEach(function (d) { opts.push({ t: d, ok: false }); });
    return shuffle(opts);
  }

  // 组卷：typeKey 选试卷，sel 选板块
  function buildPaper(typeKey, sel) {
    var spec = EXAM_TYPES[typeKey];
    if (!spec) return null;
    var core = LIST['jlpt-core'] || LIST['topik-core'] || LIST['jlpt-core'];
    // 词表按语种：jlpt 用 jlpt-core，topik 用 topik-core
    var wordList = typeKey === 'topik-ii' ? (LIST['topik-core'] || LIST['jlpt-core']) : (LIST['jlpt-core'] || LIST['topik-core']);
    if (!wordList) return null;
    var all = wordList.words;
    var kanjiW = all.filter(function (x) { return /[一-鿿]/.test(x.w); });
    var ctxW = all.filter(function (x) {
      return (x.ex || []).some(function (e) { return e.en && x.w && e.en.indexOf(x.w) >= 0; });
    });
    var gpts = [];
    (DATA.grammars || []).forEach(function (g) {
      if (g.lang !== spec.grammarLang) return;
      (g.rooms || []).forEach(function (r) { (r.points || []).forEach(function (p) { gpts.push(p); }); });
    });
    if (!all.length || !gpts.length) return null;

    var secs = [];
    spec.sections.forEach(function (s) {
      if (!sel[s.key]) return;
      var qs = [];
      var i;
      if (s.key === 'kanji') {
        var usedW = {};
        for (i = 0; i < s.qn; i++) {
          var usedOpt = {};
          var cand = exPick(kanjiW.length ? kanjiW : all, 1, usedW, function (x) { return x.w; })[0];
          if (!cand) break;
          var correct = cand.pron.split(' / ')[0];
          var dis = exPick(all, 3, usedOpt, function (x) {
            var r = x.pron.split(' / ')[0];
            return r === correct ? null : r;
          }).map(function (x) { return x.pron.split(' / ')[0]; });
          if (dis.length < 3) break;
          qs.push({ type: '漢字読み', stem: cand.w, options: optSet(correct, dis), ref: wordList.id + '/' + cand.w });
        }
      } else if (s.key === 'context' || s.key === 'v-ctx') {
        var poolC = ctxW.length ? ctxW : all;
        var usedC = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptC = {};
          var c = exPick(poolC, 1, usedC, function (x) { return x.w; })[0];
          if (!c) break;
          var sent = null;
          (c.ex || []).forEach(function (e) { if (!sent && e.en && c.w && e.en.indexOf(c.w) >= 0) sent = e.en; });
          if (!sent) continue;
          var stem = sent.split(c.w).join('（　）');
          var disC = exPick(all, 3, usedOptC, function (x) { return x.w === c.w ? null : x.w; })
            .map(function (x) { return x.w; });
          if (disC.length < 3) break;
          qs.push({ type: s.key === 'v-ctx' ? '문맥 채우기' : '文脈規定', stem: stem, options: optSet(c.w, disC), ref: wordList.id + '/' + c.w });
        }
      } else if (s.key === 'meaning' || s.key === 'v-mean') {
        var usedM = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptM = {};
          var m = exPick(all, 1, usedM, function (x) { return x.w; })[0];
          if (!m) break;
          var disM = exPick(all, 3, usedOptM, function (x) {
            return x.w === m.w || x.zh === m.zh ? null : x.zh;
          }).map(function (x) { return x.zh; });
          if (disM.length < 3) break;
          qs.push({
            type: s.key === 'v-mean' ? '뜻 고르기' : '意味規定',
            stem: m.w + '（' + m.pron.split(' / ')[0] + '）',
            options: optSet(m.zh, disM), ref: wordList.id + '/' + m.w
          });
        }
      } else if (s.key === 'grammar' || s.key === 'g-form') {
        var usedG = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptG = {};
          var g1 = exPick(gpts, 1, usedG, function (p) { return p.t; })[0];
          if (!g1 || !(g1.ex && g1.ex[0] && g1.ex[0].en) || !g1.formula) continue;
          var disG = exPick(gpts, 3, usedOptG, function (p) {
            return p.t === g1.t || p.formula === g1.formula ? null : p.formula;
          }).map(function (p) { return p.formula; });
          if (disG.length < 3) break;
          qs.push({
            type: spec.grammarLang === 'ko' ? '연결어미' : '文法',
            stem: g1.ex[0].en, options: optSet(g1.formula, disG), ref: null
          });
        }
      } else if (s.key === 'listen' || s.key === 'l-word') {
        var usedL = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptL = {};
          var l1 = exPick(all, 1, usedL, function (x) { return x.w; })[0];
          if (!l1) break;
          var spoken = s.key === 'l-word' || !(l1.collo && l1.collo[0]) ? l1.w : l1.collo[0];
          var disL = exPick(all, 3, usedOptL, function (x) {
            return x.w === l1.w || x.zh === l1.zh ? null : x.zh;
          }).map(function (x) { return x.zh; });
          if (disL.length < 3) break;
          qs.push({
            type: '聴解・即時応答', stem: '🔊 ' + spoken, spoken: spoken,
            options: optSet(l1.zh, disL), ref: wordList.id + '/' + l1.w
          });
        }
      } else if (s.key === 'l-cont') {
        var usedLC = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptLC = {};
          var l2 = exPick(all, 1, usedLC, function (x) { return x.w; })[0];
          if (!l2) break;
          var sents = (l2.ex || []).filter(function (e) { return e.en && e.zh; });
          if (!sents.length) continue;
          var pick = sents[0];
          var disLC = exPick(all, 3, usedOptLC, function (x) {
            return x.w === l2.w || x.zh === pick.zh ? null : x.zh;
          }).map(function (x) { return x.zh; });
          if (disLC.length < 3) break;
          qs.push({
            type: '내용 파악', stem: '🔊 ' + pick.en, spoken: pick.en,
            options: optSet(pick.zh, disLC), ref: wordList.id + '/' + l2.w
          });
        }
      }
      if (qs.length) secs.push({ key: s.key, title: s.title, minutes: s.minutes, qs: qs });
    });
    if (!secs.length) return null;
    var totalQ = secs.reduce(function (n, s) { return n + s.qs.length; }, 0);
    var totalMin = secs.reduce(function (n, s) { return n + s.minutes; }, 0);
    return {
      typeKey: typeKey, name: spec.name,
      secs: secs, totalQ: totalQ, totalMin: totalMin,
      secIdx: 0, qi: 0,
      answers: secs.map(function (s) { return s.qs.map(function () { return -1; }); }),
      deadline: Date.now() + totalMin * 60000,
      phase: 'run', spoken: null
    };
  }

  function examCur() { return exam.secs[exam.secIdx]; }
  function examCurQ() { return examCur().qs[exam.qi]; }
  function examRemaining() { return Math.max(0, Math.round((exam.deadline - Date.now()) / 1000)); }

  function examPersist() {
    try {
      var copy = {};
      for (var k in exam) { if (k !== 'timerId') copy[k] = exam[k]; }
      lsSet('hedgehog:exam', copy);
    } catch (e) {}
  }

  function examFinish() {
    if (!exam || exam.phase !== 'run') return;
    exam.phase = 'result';
    exam.result = exam.secs.map(function (s, si) {
      var correct = 0;
      s.qs.forEach(function (q, qi) {
        var a = exam.answers[si][qi];
        var ok = a >= 0 && q.options[a] && q.options[a].ok;
        if (ok) correct++;
        if (!ok && q.ref) { // 错题（含未答）进复习队列
          try {
            scheduleRef(q.ref, false);
            var k = known();
            if (k[q.ref]) { delete k[q.ref]; lsSet('hedgehog:known', k); }
          } catch (e) {}
        }
      });
      return { title: s.title, qn: s.qs.length, correct: correct, scaled: Math.round((correct / s.qs.length) * 60) };
    });
    exam.wrongN = exam.result.reduce(function (n, r) { return n + (r.qn - r.correct); }, 0);
    exam.correctN = exam.result.reduce(function (n, r) { return n + r.correct; }, 0);
    exam.approx = Math.round((exam.correctN / exam.totalQ) * 180); // 近似 180 制参考分
    try { localStorage.removeItem('hedgehog:exam'); } catch (e) {}
    if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
    route();
  }

  function examTick() {
    if (!exam || exam.phase !== 'run') {
      if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
      return;
    }
    var el = $('examTimer');
    var rem = examRemaining();
    if (el) {
      var m = Math.floor(rem / 60), s = rem % 60;
      el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    if (rem <= 0) examFinish();
  }

  function examStartTimer() {
    if (examTimerId) clearInterval(examTimerId);
    examTimerId = setInterval(examTick, 1000);
    examTick();
  }

  function examScreen() {
    if (!exam) exam = lsGet('hedgehog:exam', null);
    if (!exam || !exam.secs || exam.phase === 'setup') {
      // 试卷选择 + 板块勾选
      var typeCards = Object.keys(EXAM_TYPES).map(function (k) {
        var t = EXAM_TYPES[k];
        var on = examType === k;
        return (
          '<button class="entry-card exam-type' + (on ? ' on' : '') + '" data-act="exam-pick-type" data-key="' + k + '">' +
          '<b>' + (on ? '◆ ' : '◇ ') + t.name + '</b>' +
          '<small>' + t.sections.reduce(function (n, s) { return n + s.qn; }, 0) + ' 题 · ' +
          t.sections.reduce(function (n, s) { return n + s.minutes; }, 0) + ' 分钟</small></button>'
        );
      }).join('');
      var cur = EXAM_TYPES[examType];
      var cards = cur.sections.map(function (s) {
        var on = examSels[examType][s.key];
        return (
          '<button class="entry-card exam-sec' + (on ? ' on' : '') + '" data-act="exam-toggle" data-key="' + s.key + '">' +
          '<b>' + (on ? '☑ ' : '☐ ') + s.title + '</b>' +
          '<small>' + s.qn + ' 题 · ' + s.minutes + ' 分钟 · ' + s.note + '</small></button>'
        );
      }).join('');
      var onKeys = cur.sections.filter(function (s) { return examSels[examType][s.key]; });
      var tq = onKeys.reduce(function (n, s) { return n + s.qn; }, 0);
      var tm = onKeys.reduce(function (n, s) { return n + s.minutes; }, 0);
      return (
        '<a class="back-link" href="#/study">← 巡游</a>' +
        '<h2>考场 · 模拟考试</h2>' +
        '<p class="sub">题型按真题结构原创出题 · 选试卷与板块组卷 · 成绩近似换算</p>' +
        '<p class="picker-h">选择试卷</p>' + typeCards +
        '<p class="picker-h">选择板块 · ' + esc(cur.name) + '</p>' + cards +
        '<div class="exam-start"><button class="btn" data-act="exam-begin"' + (tq ? '' : ' disabled') + '>' +
        '开始考试（' + tq + ' 题 · ' + tm + ' 分钟）</button></div>' +
        '<p class="footnote">倒计时中途刷新不丢 · 错题自动进复习队列</p>'
      );
    }
    if (exam.phase === 'result') {
      var rows = (exam.result || []).map(function (r) {
        return '<div class="exam-row"><span>' + esc(r.title) + '</span>' +
          '<span>' + r.correct + '/' + r.qn + '</span>' +
          '<span>折 ' + r.scaled + ' 分</span></div>';
      }).join('');
      var pass = exam.approx >= 100;
      return (
        '<h2>考场 · 成绩单</h2>' +
        '<div class="card exam-result">' +
        '<div class="exam-score' + (pass ? ' pass' : '') + '">' + exam.approx + '<small>/180 近似分</small></div>' +
        '<p class="exam-passline">' + esc(exam.name || '') + ' · 参考合格线 100 · ' +
        (pass ? '达标线以上 ✓' : '距合格线还差 ' + (100 - exam.approx) + ' 分') + '</p>' +
        rows +
        '<div class="exam-total">总正确 ' + exam.correctN + '/' + exam.totalQ +
        ' · 错 ' + exam.wrongN + (exam.wrongRefN ? '（' + exam.wrongRefN + ' 题错词已进复习）' : '（已进复习队列）') + '</div>' +
        '<div class="study-actions">' +
        '<button class="btn" data-act="exam-again">再战一场</button>' +
        '<a class="btn ghost" href="#/study">回巡游</a>' +
        '</div></div>'
      );
    }
    // 考试中
    if (examTimerId == null) examStartTimer();
    var sec = examCur();
    var q = examCurQ();
    var ans = exam.answers[exam.secIdx][exam.qi];
    if (q.spoken && exam.spoken !== exam.secIdx + '-' + exam.qi) {
      exam.spoken = exam.secIdx + '-' + exam.qi;
      setTimeout(function () { examSpeak(q.spoken); }, 150);
    }
    var qNo = 0, i;
    for (i = 0; i < exam.secIdx; i++) qNo += exam.secs[i].qs.length;
    qNo += exam.qi + 1;
    var opts = q.options.map(function (o, idx) {
      var cls = 'exam-opt';
      if (ans === idx) cls += o.ok ? ' right' : ' wrong';
      else if (ans >= 0 && o.ok) cls += ' reveal';
      return '<button class="' + cls + '" data-act="exam-pick" data-i="' + idx + '">' +
        '<em>' + 'ABCD'[idx] + '</em>' + esc(o.t) + '</button>';
    }).join('');
    var off = 0;
    var sheet = exam.secs.map(function (s, si) {
      var base = off; off += s.qs.length;
      return '<div class="exam-sheet-sec"><b>' + esc(s.title.split(' · ').pop()) + '</b>' +
        s.qs.map(function (_, qi) {
          var a = exam.answers[si][qi];
          var cls = 'sheet-no' + (si === exam.secIdx && qi === exam.qi ? ' cur' : '') + (a >= 0 ? ' done' : '');
          return '<button class="' + cls + '" data-act="exam-goto" data-si="' + si + '" data-qi="' + qi + '">' +
            (base + qi + 1) + '</button>';
        }).join('') + '</div>';
    }).join('');
    var lastSec = exam.secIdx === exam.secs.length - 1;
    var lastQ = exam.qi === exam.secs[exam.secIdx].qs.length - 1;
    return (
      '<div class="exam-head">' +
      '<span class="exam-secname">' + esc(sec.title) + '</span>' +
      '<span class="exam-timer" id="examTimer">--:--</span>' +
      '<button class="mini-btn" data-act="exam-exit">✕ 交卷退出</button>' +
      '</div>' +
      '<div class="exam-prog"><span>第 ' + qNo + '/' + exam.totalQ + ' 题</span>' +
      '<span>' + (exam.secIdx + 1) + '/' + exam.secs.length + ' 板块</span></div>' +
      '<div class="card exam-card">' +
      '<div class="exam-qtype">' + esc(q.type) + '</div>' +
      '<div class="exam-stem">' + esc(q.stem) +
      (q.spoken ? ' <button class="mini-btn" data-act="exam-replay">🔁 重播</button>' : '') +
      '</div>' +
      '<div class="exam-opts">' + opts + '</div>' +
      '<div class="exam-nav">' +
      '<button class="btn ghost" data-act="exam-prev"' +
      (exam.qi === 0 && exam.secIdx === 0 ? ' disabled' : '') + '>上一题</button>' +
      '<button class="btn" data-act="exam-next">' + (lastSec && lastQ ? '交卷' : '下一题') + '</button>' +
      '</div></div>' +
      '<div class="exam-sheet">' + sheet + '</div>'
    );
  }

  function route() {
    if (!DATA) return;
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'home';
    var nav = name;
    var view = $('view');

    if (name === 'word') {
      var listId = parts[1] || '';
      var w = decodeURIComponent(parts.slice(2).join('/'));
      view.innerHTML = viewWord(listId, w);
      nav = 'categories';
    } else if (name === 'categories') {
      view.innerHTML = parts[1] ? viewList(parts[1]) : viewCategories();
      nav = 'categories';
    } else if (name === 'tables') {
      view.innerHTML = parts[1] ? viewTable(parts[1]) : viewTablesHub();
      nav = 'categories';
    } else if (name === 'grammar') {
      if (parts[2]) view.innerHTML = viewGrammarRoom(parts[1], parts[2]);
      else if (parts[1]) view.innerHTML = viewGrammarWing(parts[1]);
      else view.innerHTML = viewGrammarHub();
      nav = 'categories';
    } else if (name === 'exam') {
      view.innerHTML = examScreen();
      nav = 'study';
    } else if (name === 'study') {
      view.innerHTML = studyScreen();
    } else if (name === 'copybook') {
      view.innerHTML = viewCopybook();
      nav = 'study';
    } else if (name === 'favorites') {
      view.innerHTML = viewFavorites();
    } else {
      name = 'home';
      nav = 'home';
      view.innerHTML = viewHome();
    }

    document.querySelectorAll('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === nav);
    });
    var pnum = { home: 1, categories: 2, word: 2, tables: 3, study: 4, favorites: 5, grammar: 6, copybook: 7, exam: 4 }[name] || 1;
    var pn = $('pageNum');
    if (pn) pn.textContent = '— ' + pnum + ' —';
    window.scrollTo(0, 0);

    // 进词详情自动朗读（同词不重复；需设备装有对应语言语音包）
    if (name === 'word' && parts[1] && parts[2]) {
      var aref = parts[1] + '/' + decodeURIComponent(parts.slice(2).join('/'));
      if (aref !== lastAutoRef && IDX[aref]) {
        lastAutoRef = aref;
        setTimeout(function () { speak(aref); }, 180);
      }
    }

    var q = $('q');
    if (q) {
      q.addEventListener('input', function () { renderResults(q.value); });
    }

    var si = $('spellInput');
    if (si) {
      si.focus();
      si.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var b = $('spellCheckBtn');
          if (b) b.click();
        }
      });
    }

    initCanvas();

    var ifile = $('importFile');
    if (ifile) {
      ifile.addEventListener('change', function () {
        var f = ifile.files && ifile.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var obj = JSON.parse(reader.result);
            var d = obj && obj.data;
            if (!d || typeof d !== 'object') throw new Error('bad');
            var n = 0;
            Object.keys(d).forEach(function (k) {
              if (k === 'hedgehog:data') return; // 词库缓存不走导入/导出，避免塞爆 localStorage
              if (k.indexOf('hedgehog:') === 0 && d[k] != null) {
                lsSet(k, d[k]);
                n++;
              }
            });
            if (!n) throw new Error('empty');
            alert('已导入 ' + n + ' 项进度，页面将刷新');
            location.reload();
          } catch (e) {
            alert('文件格式不对，导入失败');
          }
        };
        reader.readAsText(f);
      });
    }
  }

  // ---------- 事件委托（只绑一次） ----------
  $('view').addEventListener('click', function (e) {
    // 表格点读：假名/字母格子
    var sayEl = e.target.closest('[data-say]');
    if (sayEl) {
      playAudio(
        sayEl.getAttribute('data-say'),
        sayEl.getAttribute('data-le') || 'ko',
        sayEl.getAttribute('data-say')
      );
      sayEl.classList.add('ping');
      setTimeout(function () { sayEl.classList.remove('ping'); }, 400);
      return;
    }
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var ref = el.getAttribute('data-ref');

    if (act === 'speak') speak(ref);
    else if (act === 'star') {
      el.classList.toggle('on', toggleFav(ref));
    } else if (act === 'list-more') {
      listShown += 100;
      route();
    } else if (act === 'scene-filter') {
      sceneLang = el.getAttribute('data-lang') || 'all';
      route();
    } else if (act === 'exam-pick-type') {
      examType = el.getAttribute('data-key') || 'jlpt-n1';
      route();
    } else if (act === 'exam-toggle') {
      var ek = el.getAttribute('data-key');
      examSels[examType][ek] = !examSels[examType][ek];
      route();
    } else if (act === 'exam-begin') {
      exam = buildPaper(examType, examSels[examType]);
      if (exam) { examPersist(); route(); }
    } else if (act === 'exam-pick') {
      if (!exam || exam.phase !== 'run') return;
      exam.answers[exam.secIdx][exam.qi] = parseInt(el.getAttribute('data-i'), 10);
      examPersist();
      route();
    } else if (act === 'exam-next') {
      if (!exam || exam.phase !== 'run') return;
      var cs = examCur();
      if (exam.qi < cs.qs.length - 1) exam.qi++;
      else if (exam.secIdx < exam.secs.length - 1) { exam.secIdx++; exam.qi = 0; }
      else { examFinish(); return; }
      examPersist();
      route();
    } else if (act === 'exam-prev') {
      if (!exam || exam.phase !== 'run') return;
      if (exam.qi > 0) exam.qi--;
      else if (exam.secIdx > 0) { exam.secIdx--; exam.qi = exam.secs[exam.secIdx].qs.length - 1; }
      examPersist();
      route();
    } else if (act === 'exam-goto') {
      if (!exam || exam.phase !== 'run') return;
      exam.secIdx = parseInt(el.getAttribute('data-si'), 10);
      exam.qi = parseInt(el.getAttribute('data-qi'), 10);
      route();
    } else if (act === 'exam-replay') {
      if (exam && exam.phase === 'run') examSpeak(examCurQ().spoken || '');
    } else if (act === 'exam-exit') {
      if (exam && exam.phase === 'run' && confirm('现在交卷？未答的题按错计并进入复习。')) examFinish();
    } else if (act === 'exam-again') {
      exam = buildPaper(exam.typeKey || examType, examSels[exam.typeKey || examType]);
      if (exam) { examPersist(); route(); }
    } else if (act === 'set-mode') {
      pickMode = el.getAttribute('data-mode');
      route();
    } else if (act === 'start-study') {
      startSession({
        listId: el.getAttribute('data-list'),
        kind: el.getAttribute('data-kind') || 'normal',
        mode: pickMode,
      });
      route();
    } else if (act === 'study-home') {
      session = null;
      route();
    } else if (act === 'reveal') {
      session.revealed = true;
      route();
    } else if (act === 'good' || act === 'blur') {
      recordStudy(act === 'good');
      advanceSession();
      route();
    } else if (act === 'spell-check') {
      var si = $('spellInput');
      var sent = IDX[session.queue[session.idx]];
      session.spellOk = checkSpelling(si ? si.value : '', sent.x);
      session.spellChecked = true;
      recordStudy(session.spellOk);
      route();
    } else if (act === 'spell-next') {
      advanceSession();
      route();
    } else if (act === 'save-sent') {
      var ta = $('sentInput');
      var sentMap = lsGet('hedgehog:sentences', {});
      if (ta && ta.value.trim()) sentMap[ref] = ta.value.trim();
      else delete sentMap[ref];
      lsSet('hedgehog:sentences', sentMap);
      var sh = $('sentHint');
      if (sh) sh.textContent = ta && ta.value.trim() ? '已保存到本机 ✓' : '已清空';
    } else if (act === 'wm-done') {
      var wmc = $('wmCanvas');
      session.wmShot = wmc ? wmc.toDataURL('image/jpeg', 0.6) : null;
      session.wmCompare = true;
      route();
    } else if (act === 'wm-clear') {
      clearPad('wmCanvas');
    } else if (act === 'wm-good') {
      recordStudy(true);
      advanceSession();
      route();
    } else if (act === 'wm-again') {
      recordStudy(false);
      advanceSession();
      route();
    } else if (act === 'export-data') {
      var dump = {};
      Object.keys(localStorage).forEach(function (k) {
        if (k === 'hedgehog:data') return; // 词库缓存不进进度导出
        if (k.indexOf('hedgehog:') === 0) dump[k] = lsGet(k, null);
      });
      var blob = new Blob([JSON.stringify({ v: 1, t: now(), data: dump })], {
        type: 'application/json',
      });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hedgehog-progress-' + dateKey(new Date()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    } else if (act === 'import-data') {
      var fi = $('importFile');
      if (fi) {
        fi.value = '';
        fi.click();
      }
    } else if (act === 'refresh-words') {
      // 手动兜底：作废词库缓存回密码门，重输密码即拉最新词库
      idbDel('data').catch(function () {});
      try { localStorage.removeItem('hedgehog:data'); } catch (e) {}
      try { localStorage.removeItem('hedgehog:etag'); } catch (e2) {}
      if (typeof caches !== 'undefined') caches.delete('hedgehog-enc').catch(function () {});
      location.reload();
    } else if (act === 'cb-save') {
      var cv = $('cbCanvas');
      if (cv) {
        var off = document.createElement('canvas');
        off.width = 360;
        off.height = Math.round((cv.height * 360) / cv.width);
        off.getContext('2d').drawImage(cv, 0, 0, off.width, off.height);
        var url = off.toDataURL('image/jpeg', 0.55);
        var pics = lsGet('hedgehog:copybook', []);
        pics.push({ t: now(), img: url });
        while (pics.length > 20) pics.shift();
        try {
          lsSet('hedgehog:copybook', pics);
        } catch (err) {
          // 存储接近上限：挤掉更多旧图再试
          while (pics.length > 5) {
            pics.shift();
            try { lsSet('hedgehog:copybook', pics); break; } catch (e2) {}
          }
        }
        route();
      }
    } else if (act === 'cb-clear') {
      clearPad('cbCanvas');
    } else if (act === 'cb-del') {
      var pics2 = lsGet('hedgehog:copybook', []);
      pics2.splice(parseInt(el.getAttribute('data-i'), 10) || 0, 1);
      lsSet('hedgehog:copybook', pics2);
      route();
    }
  });

  // ---------- 启动 ----------
  function openApp() {
    $('gate').hidden = true;
    $('app').hidden = false;
    if (!location.hash) location.hash = '#/home';
    route();
  }

  // 每轮站数设置（#4）：背词页输入框改完即生效并记住
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sizeInput') {
      var n = parseInt(e.target.value, 10);
      if (!isNaN(n)) {
        sessionSize = Math.max(5, Math.min(100, n));
        lsSet('hedgehog:session-size', sessionSize);
        route();
      }
    }
  });

  $('gateForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('gateBtn');
    var hint = $('gateHint');
    btn.disabled = true;
    hint.style.color = 'var(--mut)';
    hint.textContent = '下载词库中…';
    try {
      var data = await unlock(
        $('gatePassword').value,
        function (stage) {
          hint.textContent = stage === 'decrypt' ? '解密中…' : '下载词库中…';
        },
        function (got, total) {
          if (got < 0) return; // 缓存命中，无下载过程
          if (total > 0) hint.textContent = '下载词库中… ' + Math.min(100, Math.round((got * 100) / total)) + '%';
        }
      );
      if (!data || !data.lists || !data.lists.length) throw new Error('empty');
      setData(data);
      idbSet('data', data).catch(function () {});
      $('gatePassword').value = '';
      hint.textContent = '';
      openApp();
    } catch (err) {
      hint.style.color = 'var(--red)';
      if (err && err.friendly) {
        hint.textContent = err.message; // 浏览器过旧等明确提示
      } else if (err && err.net) {
        hint.textContent = '网络太慢或中断，请点重试';
        // 保留已输密码，方便直接重试
      } else {
        hint.textContent = '密码不对';
        $('gatePassword').select();
      }
    }
    btn.disabled = false;
  });

  window.addEventListener('hashchange', route);

  initPage();

  // 注册 service worker（安卓 Chrome 的 PWA 安装条件 + 壳离线）
  // updateViaCache:none —— sw 脚本本身不走 HTTP 缓存，版本更新秒级生效
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=17', { updateViaCache: 'none' }).catch(function () {});
  }

  // 本机已解锁过则直接进入（数据存 IndexedDB：解锁一次本机永久记住）。
  // 更新守卫：启动时 HEAD 对比 words.enc.gz 的 ETag，词库更新过就作废缓存回密码门
  // （旧缓存没有 ETag 记录也视作过期，部署后各设备重输一次密码即拿新词库）。
  // 旧版 localStorage 缓存自动搬进 IDB 后删除；断网时跳过对比直接用缓存。
  (function bootFromCache() {
    function adopt(cd) {
      if (cd && cd.version >= 6 && cd.tables && cd.tables.length) {
        setData(cd);
        openApp();
        return true;
      }
      return false;
    }
    function evict() {
      idbDel('data').catch(function () {});
      try { localStorage.removeItem('hedgehog:data'); } catch (e) {}
      var hint = $('gateHint');
      if (hint) {
        hint.style.color = 'var(--mut)';
        hint.textContent = '词库已更新，请重新解锁';
      }
    }
    function loadCached() {
      return idbGet('data').then(function (cd) {
        if (adopt(cd)) return;
        // IDB 无有效缓存：看看 localStorage 里有没有旧版缓存，有就搬过来
        var legacy = null;
        try { legacy = localStorage.getItem('hedgehog:data'); } catch (e) {}
        if (legacy) {
          try { localStorage.removeItem('hedgehog:data'); } catch (e2) {}
          var lcd = JSON.parse(legacy);
          if (adopt(lcd)) return idbSet('data', lcd).catch(function () {});
        }
        if (cd) idbDel('data').catch(function () {});
      });
    }
    fetch('data/words.enc.gz', { method: 'HEAD', cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('head');
        var remote = resp.headers.get('ETag') || resp.headers.get('Last-Modified');
        if (!remote) return loadCached(); // 服务器没给指纹：无法比对，宁可不折腾
        var mine = null;
        try { mine = localStorage.getItem('hedgehog:etag'); } catch (e) {}
        if (mine && remote === mine) return loadCached();
        // 词库更新过（或旧缓存没有指纹）：作废缓存，要求重新解锁
        idbGet('data').then(function (cd) {
          if (cd || localStorage.getItem('hedgehog:data')) evict();
        }).catch(function () {});
      })
      .catch(function () {
        // 断网/HEAD 失败：离线可用优先，直接用本地缓存
        loadCached();
      });
  })();

  // PWA 壳 + 词库缓存一起申请持久化存储，防止浏览器回收
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
})();
