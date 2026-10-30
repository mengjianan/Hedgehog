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
  var PASSAGES = []; // 雅思阅读真题文章库 [{id, lang, title, paras, qs}]
  var SCRIPTS = []; // 雅思听力情景脚本库 [{id, lang, part, title, script, qs}]
  var GBY = {}; // id -> grammar wing
  var session = null; // 当前巡游 {queue:[ref], idx, good, bad, mode, kind, ...}
  var pickMode = 'card'; // 选厅模式：card 认卡 / spell 拼写
  var sessionSize = lsGet('hedgehog:session-size', 10); // 每轮站数（#4 背词页可设）
  var sceneLang = 'all'; // 词库页场景厅语言筛选：all/en/ko/ja
  var listShown = 100; // 词库列表懒渲染：首屏 100，滚动加载更多
  var listShownFor = '';

  var LANG_NAME = { en: '英语', ko: '韩语', ja: '日语' };
  var APP_VER = 'v2026-10-28.14'; // 页脚版本号：看到它就知道手机跑的是哪版

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
    PASSAGES = data.passages || []; // 雅思阅读真题文章库
    SCRIPTS = data.scripts || []; // 雅思听力情景脚本库
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

  // 跟读卡片：播发音 → 录自己 → 回放对比 → 自评（录音回放后即弃，不落盘）
  function shadowCardHTML(e, ref) {
    var st = session.shState || 'idle'; // idle 待跟读 / rec 录音中 / done 回放对比
    var base =
      '<div class="card study-card shadow">' +
      '<div class="spell-hint">听发音 → 按住跟读 → 回放对比</div>' +
      '<div class="sw">' + esc(e.x.w) + '</div>' +
      '<div class="sipa">' + esc(e.x.pron) + ' · ' + esc(e.x.zh) + '</div>' +
      '<div class="spell-tools">' +
      '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">' + ICON.sound + '</button>' +
      '<span class="tour-slot">先听原声</span></div>';
    if (st === 'idle') {
      return base +
        '<div class="study-actions">' +
        '<button class="btn" data-act="sh-record">🎙 开始录音跟读</button>' +
        '</div>' +
        '<button class="btn ghost" data-act="blur" style="width:100%;margin-top:8px">先跳过（模糊）</button>' +
        '</div>';
    }
    if (st === 'rec') {
      return base +
        '<div class="study-actions"><span class="tour-slot">● 录音中… 说这个词</span></div>' +
        '<button class="btn" data-act="sh-stop" style="width:100%;margin-top:10px">⏹ 停止并回放</button>' +
        '</div>';
    }
    // done：回放对比 + 自评
    var pronHtml = '';
    if (pronOn() && pronAvailable() && session.pronText != null) {
      var said = session.pronText;
      var hit = pronMatch(e.x.w, said);
      pronHtml =
        '<div class="pron-line' + (hit ? ' ok' : '') + '">' +
        '🗣 识别：<b>' + (said ? esc(said) : '（没听清）') + '</b>' +
        (hit ? ' ✓ 接近原词' : ' · 再试一次？') + '</div>';
    }
    return base + pronHtml +
      '<div class="spell-tools"><span class="tour-slot">🔊 回放你的跟读，和原声对比</span></div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="sh-play">▶ 再听我的</button>' +
      '<button class="btn ghost" data-act="sh-again">重录</button>' +
      '</div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="blur">✗ 模糊</button>' +
      '<button class="btn" data-act="good">✓ 对了</button>' +
      '</div>' +
      pronToggleHTML() +
      '</div>';
  }

  // 发音评分开关（默认关；开启提示联网）
  function pronToggleHTML() {
    if (!pronAvailable()) return '<p class="pron-off">本机浏览器不支持发音识别</p>';
    var on = pronOn();
    return (
      '<button class="pron-toggle' + (on ? ' on' : '') + '" data-act="pron-toggle">' +
      '发音评分：' + (on ? '开 · 会联网（音频发 Google）' : '关') +
      '</button>'
    );
  }

  // 搭配跟读卡片：播整个搭配短语 → 录自己跟读整块 → 回放对比 → 自评
  function shadowColCardHTML(e, ref) {
    var collos = (e.x.collo || []).filter(function (c) { return c && c.length > 2; });
    if (!collos.length) {
      return '<div class="card study-card shadow"><div class="spell-hint">这个词暂无搭配，跳过</div>' +
        '<button class="btn" data-act="good" style="width:100%;margin-top:12px">下一站</button></div>';
    }
    // 本轮固定用第一个搭配
    var phrase = collos[0];
    var st = session.shState || 'idle';
    var base =
      '<div class="card study-card shadow">' +
      '<div class="spell-hint">听整个搭配 → 跟读整块 → 回放对比</div>' +
      '<div class="sw" style="font-size:26px;line-height:1.4">' + esc(phrase) + '</div>' +
      '<div class="sipa">' + esc(e.x.w) + ' · ' + esc(e.x.zh) + '</div>' +
      '<div class="spell-tools">' +
      '<button class="icon-btn" data-act="shcol-play-native" data-ref="' + esc(ref) + '" data-phrase="' + esc(phrase) + '">' + ICON.sound + '</button>' +
      '<span class="tour-slot">先听整块发音</span></div>';
    if (st === 'idle') {
      return base +
        '<div class="study-actions">' +
        '<button class="btn" data-act="sh-record">🎙 开始录音跟读</button>' +
        '</div>' +
        '<button class="btn ghost" data-act="blur" style="width:100%;margin-top:8px">先跳过（模糊）</button>' +
        '</div>';
    }
    if (st === 'rec') {
      return base +
        '<div class="study-actions"><span class="tour-slot">● 录音中… 整块读出来</span></div>' +
        '<button class="btn" data-act="sh-stop" style="width:100%;margin-top:10px">⏹ 停止并回放</button>' +
        '</div>';
    }
    var pronHtml2 = '';
    if (pronOn() && pronAvailable() && session.pronText != null) {
      var said2 = session.pronText;
      var hit2 = pronMatch(phrase, said2);
      pronHtml2 =
        '<div class="pron-line' + (hit2 ? ' ok' : '') + '">' +
        '🗣 识别：<b>' + (said2 ? esc(said2) : '（没听清）') + '</b>' +
        (hit2 ? ' ✓ 接近搭配' : ' · 再试一次？') + '</div>';
    }
    return base + pronHtml2 +
      '<div class="spell-tools"><span class="tour-slot">🔊 回放你的跟读，和原声对比</span></div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="sh-play">▶ 再听我的</button>' +
      '<button class="btn ghost" data-act="sh-again">重录</button>' +
      '</div>' +
      '<div class="study-actions">' +
      '<button class="btn ghost" data-act="blur">✗ 模糊</button>' +
      '<button class="btn" data-act="good">✓ 对了</button>' +
      '</div>' +
      pronToggleHTML() +
      '</div>';
  }

  // 播搭配整块发音（Youdao 读整个短语）
  function speakCol(ref, phrase) {
    var e = IDX[ref];
    if (!e) return;
    playAudio(phrase, YOUDAO_LE[e.l.lang] || 'en', phrase, e);
  }

  var shRec = null;   // MediaRecorder 实例
  var shChunks = [];  // 录音片段
  var shURL = null;   // 回放 blob URL（回放后即弃）
  function shRecord() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('本机不支持录音'); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      shChunks = [];
      shRec = new MediaRecorder(stream);
      shRec.stream = stream;
      shRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) shChunks.push(ev.data); };
      shRec.onstop = function () {
        if (shURL) URL.revokeObjectURL(shURL);
        shURL = URL.createObjectURL(new Blob(shChunks, { type: 'audio/webm' }));
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (er) {}
        if (session) { session.shState = 'done'; route(); }
      };
      shRec.start();
      // 发音评分（默认关）：并行跑 SpeechRecognition 识别你说的内容
      if (pronOn() && pronAvailable()) {
        var cur = IDX[session.queue[session.idx]];
        session.pronText = null;
        pronStart((cur && cur.l.speech) || 'en-US');
      }
      if (session) { session.shState = 'rec'; route(); }
    }, function () { toast('麦克风被拒绝，无法录音'); });
  }
  function shStop() {
    pronStop(); // 关发音识别（若开了）
    if (shRec && shRec.state !== 'inactive') { shRec.stop(); shRec = null; }
  }
  function shPlay() {
    if (!shURL) { toast('还没有录音'); return; }
    var a = new Audio(shURL);
    a.play().catch(function () { toast('回放失败，再点一次'); });
  }
  function shDispose() {
    if (shURL) { URL.revokeObjectURL(shURL); shURL = null; }
    shChunks = [];
  }

  // ---------- 发音评分（Web Speech API，默认关；开启会联网，音频发给 Google）----------
  var pronRec = null, pronText = '', pronEnded = false;
  function pronOn() { return lsGet('hedgehog:pron', false) === true; }
  function setPron(v) { lsSet('hedgehog:pron', !!v); }
  function pronAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  // 开始识别（与录音并行，录完用 transcript 比对）
  function pronStart(lang) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      pronRec = new SR();
      pronRec.lang = lang || 'en-US';
      pronRec.interimResults = false;
      pronRec.maxAlternatives = 3;
      pronText = ''; pronEnded = false;
      pronRec.onresult = function (ev) {
        var r = ev.results && ev.results[0];
        if (r && r[0]) pronText = r[0].transcript || '';
      };
      pronRec.onerror = function () { pronEnded = true; pronText = ''; };
      pronRec.onend = function () { pronEnded = true; if (session) { session.pronText = pronText; route(); } };
      pronRec.start();
    } catch (err) { pronEnded = true; }
  }
  function pronStop() {
    if (pronRec) { try { pronRec.stop(); } catch (err) {} pronRec = null; }
  }
  // 比对发音：转写里是否含目标词（忽略大小写/空格）
  function pronMatch(target, said) {
    if (!target || !said) return false;
    var t = target.toLowerCase().replace(/[^a-z0-9À-ɏ぀-ヿ가-힯]/g, '');
    var s = said.toLowerCase().replace(/[^a-z0-9À-ɏ぀-ヿ가-힯]/g, '');
    if (!t || !s) return false;
    if (s.indexOf(t) >= 0) return true;
    // 词根近似：目标前 60% 前缀出现在转写里也算接近
    var head = t.slice(0, Math.max(3, Math.floor(t.length * 0.6)));
    return s.indexOf(head) >= 0;
  }

  // 听力理解卡片：先播发音（不显示文字）→ 猜词义 → 显示答案自评
  function listeningCardHTML(e, ref) {
    if (!session.liOpts) {
      // 生成 4 个中文义选项：正确义 + 3 个同词性/同场景干扰
      var used = {};
      var dis = pickDis3(e.x, e.l.words, used, e.l.id, function (x) { return x.zh; });
      var opts = dis.map(function (d) { return { t: d, ok: false }; });
      opts.push({ t: e.x.zh, ok: true });
      session.liOpts = shuffle(opts);
      session.liChecked = false;
    }
    var optsHtml = session.liOpts.map(function (o, idx) {
      var cls = 'exam-opt';
      if (session.liChecked) {
        if (o.ok) cls += ' reveal';
        else if (session.liPicked === idx) cls += ' wrong';
      }
      return '<button class="' + cls + '" data-act="li-pick" data-i="' + idx + '"' +
        (session.liChecked ? ' disabled' : '') + '>' + esc(o.t) + '</button>';
    }).join('');
    return (
      '<div class="card study-card listen">' +
      '<div class="spell-hint">听发音 · 选出正确的中文意思</div>' +
      '<div class="spell-tools">' +
      '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">' + ICON.sound + '</button>' +
      '<span class="tour-slot">先听发音，不看文字</span></div>' +
      (session.liChecked
        ? '<div class="sw" style="margin-top:8px">' + esc(e.x.w) + '</div>' +
          '<div class="sipa">' + esc(e.x.pron) + '</div>' +
          (session.liOk ? '' : '<div class="spell-answer">正确：' + esc(e.x.zh) + '</div>')
        : '') +
      '<div class="exam-opts">' + optsHtml + '</div>' +
      (session.liChecked
        ? '<div class="study-actions">' +
          '<button class="btn ghost" data-act="blur">✗ 模糊</button>' +
          '<button class="btn" data-act="good">✓ 认识</button>' +
          '</div>'
        : '') +
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
        '<button type="button" class="seg' + (pickMode === 'listen' ? ' on' : '') +
        '" data-act="set-mode" data-mode="listen">听力</button>' +
        '<button type="button" class="seg' + (pickMode === 'shadow' ? ' on' : '') +
        '" data-act="set-mode" data-mode="shadow">跟读</button>' +
        '<button type="button" class="seg' + (pickMode === 'shadowcol' ? ' on' : '') +
        '" data-act="set-mode" data-mode="shadowcol">搭配</button>' +
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
        '<a class="entry-card exam-entry" href="#/exam"><b>考场</b>' +
        '<small>JLPT / TOPIK / IELTS 仿真卷 · 倒计时 · 成绩换算 · 错题入复习</small></a>' +
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

    if (session.mode === 'shadow') return head + shadowCardHTML(e, ref);
    if (session.mode === 'shadowcol') return head + shadowColCardHTML(e, ref);
    if (session.mode === 'listen') return head + listeningCardHTML(e, ref);
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
    session.shState = 'idle';
    shDispose(); // 跟读录音即弃：换站时释放 blob
    session.liOpts = null; // 听力理解：换站重新生成选项
    session.liChecked = false;
    session.liPicked = -1;
    session.liOk = false;
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
      '<a class="btn" href="#/tables/' + esc(id) + '/practice" style="display:inline-block;margin-top:8px">开始练习</a>' +
      '</div>' + body +
      '<p class="footnote">Hedgehog · 基础表 · 内容全部原创</p>'
    );
  }

  // ---------- 基础表练习（词根/韩语字母/五十音）----------
  var tableQuiz = null; // {tid, qs, qi, good, bad, picked}

  function buildTableQuiz(t) {
    var items = [];
    (t.sections || []).forEach(function (s) {
      if (s.type === 'grid') {
        (s.rows || []).forEach(function (r) {
          if (!r[0] || !r[2]) return;
          items.push({ speak: r[0], display: r[0], alt: String(r[2]).split('/')[0].trim(), tip: r[3] || '' });
        });
      } else if (s.type === 'matrix') {
        (s.rows || []).forEach(function (r) {
          (r.cells || []).forEach(function (c) {
            if (!c || c === '・') return;
            var p = String(c).split('·');
            if (!p[0] || !p[2]) return;
            items.push({ speak: p[0], display: p[0], alt: p[2], tip: '' });
          });
        });
      } else if (s.type === 'morphemes') {
        (s.rows || []).forEach(function (r) {
          if (!r.form || !r.meaning) return;
          items.push({ speak: null, display: r.form, alt: r.meaning, tip: (r.examples || [])[0] || '' });
        });
      }
    });
    if (items.length < 4) return [];
    var qs = [];
    var used = {};
    function pickItem() {
      var g = 0, it;
      do { it = items[Math.floor(Math.random() * items.length)]; g++; } while (used[displayKey(it)] && g < items.length * 3);
      used[displayKey(it)] = 1;
      return it;
    }
    function displayKey(it) { return it.display + '|' + it.alt; }
    function distract(correct, pool, valFn) {
      var seen = {}, out = [], g = 0;
      while (out.length < 3 && g < pool.length * 3) {
        var c = pool[Math.floor(Math.random() * pool.length)];
        var v = valFn(c);
        if (!v || v === correct || seen[v]) { g++; continue; }
        seen[v] = 1; out.push(v); g++;
      }
      return out;
    }
    var nQ = Math.min(10, items.length);
    for (var i = 0; i < nQ; i++) {
      var it = pickItem();
      var kind = i % 2 === 0 ? 'listen' : 'read';
      if (kind === 'listen' && it.speak) {
        // 听发音 → 选字母/假名
        var opts = distract(it.display, items, function (x) { return x.display; })
          .map(function (v) { return { t: v, ok: false }; });
        opts.push({ t: it.display, ok: true });
        qs.push({ type: '听音选字', stem: '听发音，选出对应的字母 / 假名', say: it.speak, le: t.lang, options: shuffle(opts), tip: it.tip });
      } else if (it.alt && it.display) {
        // 看字母/词根 → 选读音/含义（或反向）
        var rev = Math.random() < 0.3 && it.speak;
        var correct = rev ? it.display : it.alt;
        var pool2 = items.filter(function (x) { return x.alt !== it.alt; });
        var opts2 = distract(correct, pool2, function (x) { return rev ? x.display : x.alt; })
          .map(function (v) { return { t: v, ok: false }; });
        opts2.push({ t: correct, ok: true });
        qs.push({
          type: rev ? '看读音选字' : (it.speak ? '看字选读音' : '看词缀选含义'),
          stem: rev ? it.alt : it.display, say: rev ? null : it.speak, le: t.lang,
          options: shuffle(opts2), tip: it.tip
        });
      }
    }
    return qs;
  }

  function viewTablePractice(id) {
    var t = TBY[id];
    if (!t) return viewTablesHub();
    if (!tableQuiz || tableQuiz.tid !== id) {
      tableQuiz = { tid: id, qs: buildTableQuiz(t), qi: 0, good: 0, bad: 0, picked: -1 };
    }
    var q = tableQuiz.qs[tableQuiz.qi];
    if (!q) return viewTablesHub();
    var head =
      '<a class="back-link" href="#/tables/' + esc(id) + '">← ' + esc(t.title) + '</a>' +
      '<h2>练习 · ' + esc(t.title) + '</h2>' +
      '<div class="study-meta"><span>第 ' + (tableQuiz.qi + 1) + '/' + tableQuiz.qs.length + ' 题 · ' + esc(q.type) + '</span>' +
      '<span>对 ' + tableQuiz.good + ' · 错 ' + tableQuiz.bad + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round((tableQuiz.qi / tableQuiz.qs.length) * 100) + '%"></i></div>';
    if (!tableQuiz.qs.length) {
      return head + '<div class="card study-card"><p>表数据不足以出题。</p></div>';
    }
    var opts = q.options.map(function (o, idx) {
      var cls = 'exam-opt';
      if (tableQuiz.picked === idx) cls += o.ok ? ' right' : ' wrong';
      else if (tableQuiz.picked >= 0 && o.ok) cls += ' reveal';
      return '<button class="' + cls + '" data-act="tbl-pick" data-i="' + idx + '"' +
        (tableQuiz.picked >= 0 ? ' disabled' : '') + '>' + esc(o.t) + '</button>';
    }).join('');
    var body =
      '<div class="card study-card">' +
      (q.say ? '<button class="icon-btn" data-say="' + esc(q.say) + '" data-le="' + esc(LE_FOR[q.le] || 'ko') + '">' + ICON.sound + '</button>' : '') +
      '<div class="sw">' + esc(q.stem) + '</div>' +
      '<div class="exam-opts">' + opts + '</div>' +
      (tableQuiz.picked >= 0
        ? '<p class="lit-banner" style="text-align:center">' + (q.options[tableQuiz.picked] && q.options[tableQuiz.picked].ok ? '✓ 答对' : '✗ 答错 · 正确答案：' + esc((q.options.filter(function (o) { return o.ok; })[0] || {}).t || '')) + '</p>' +
          (q.tip ? '<p class="table-note">' + esc(q.tip) + '</p>' : '')
        : '') +
      '<div class="study-actions">' +
      (tableQuiz.picked >= 0
        ? (tableQuiz.qi + 1 >= tableQuiz.qs.length
          ? '<button class="btn" data-act="tbl-done">完成本轮</button>'
          : '<button class="btn" data-act="tbl-next">下一题</button>')
        : '') +
      '<a class="btn ghost" href="#/tables/' + esc(id) + '">回表格</a>' +
      '</div></div>';
    return head + body;
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
  // ---------- 考场（仿真卷 + 本机真题卷） ----------
  // 双仿真卷：JLPT N1 / TOPIK II（题型按真题结构、题目原创）；倒计时/答题卡/成绩换算/错题入复习。
  // 真题不入库（版权）：经「导入真题卷」存本机 IndexedDB（#②）。
  var exam = null;
  var examTimerId = null;
  var examType = 'jlpt-n1';
  var examPapers = null;       // 本机导入的真题卷（IndexedDB，不进仓库）
  var examPapersLoading = false;
  // 雅思 raw→band 官方换算近似（40 题制，听力/阅读共用；部分组卷按比例折算）
  var IELTS_BAND = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [0, 0]];
  function ieltsBandFromRaw(raw40) {
    for (var i = 0; i < IELTS_BAND.length; i++) if (raw40 >= IELTS_BAND[i][0]) return IELTS_BAND[i][1];
    return 0;
  }
  function fillOk(q, a) { // 填空题判分：文本精确匹配（忽略大小写/首尾空格）
    if (!q.fill || typeof a !== 'string') return false;
    var t = a.trim().toLowerCase();
    return !!t && q.fill.accept.some(function (x) { return x.toLowerCase() === t; });
  }
  // 仿真卷 = 原创题按真题结构组卷（可入库）；真题卷 = 本机导入（版权，不入库）。
  // 成绩按各考试自己的标尺显示（JLPT 180 / TOPIK 300 / IELTS band 9），导入卷只报对错数。
  var EXAM_TYPES = {
    'jlpt-n1': {
      name: 'JLPT N1 仿真卷', grammarLang: 'ja', speech: 'ja-JP', scale: 180, pass: 100,
      sections: [
        { key: 'kanji', title: '文字・語彙 · 漢字読み', qn: 20, minutes: 15, note: '看汉字词选正确读音' },
        { key: 'context', title: '文字・語彙 · 文脈規定', qn: 20, minutes: 20, note: '句中挖空，选最贴切的词' },
        { key: 'meaning', title: '文字・語彙 · 意味規定', qn: 15, minutes: 10, note: '选词语的正确中文义' },
        { key: 'grammar', title: '文法', qn: 20, minutes: 20, note: '选出句子所用的语法形式' },
        { key: 'read-s', title: '読解 · 短文', qn: 4, minutes: 8, note: '1篇 · 内容理解・指示語理解' },
        { key: 'read-m', title: '読解 · 中文', qn: 5, minutes: 10, note: '1篇 · 内容理解・理由' },
        { key: 'read-l', title: '読解 · 長文', qn: 6, minutes: 15, note: '1篇 · 統合理解・主旨把握' },
        { key: 'listen', title: '聴解 · 即時応答', qn: 20, minutes: 15, note: '听发音选词义（可重播）' }
      ] // 110 题 · 113 分钟（真题顺序：文字語彙→文法→読解→聴解）
    },
    'topik-ii': {
      name: 'TOPIK II 仿真卷', grammarLang: 'ko', speech: 'ko-KR', scale: 300, pass: 120,
      sections: [
        { key: 'l-s', title:'듣기 · 대화', qn: 3, minutes: 8, note: '对话整段朗读 · 内容 이해' },
        { key: 'l-l', title:'듣기 · 안내・독백', qn: 3, minutes: 7, note: '独白/公告整段朗读 · 内容 이해' },
        { key: 'v-mean', title:'어휘 · 뜻 고르기', qn: 25, minutes: 20, note: '看词选正确的中文义' },
        { key: 'v-ctx', title:'어휘 · 문맥 채우기', qn: 25, minutes: 30, note: '句中挖空，选最贴切的词' },
        { key: 'g-form', title:'문법 · 연결어미', qn: 20, minutes: 25, note: '选出句子所用的语法形式' },
        { key: 'r-s', title:'읽기 · 단문', qn: 3, minutes: 6, note: '1篇 짧은 글 · 내용 이해・주제 파악' },
        { key: 'r-m', title:'읽기 · 중문', qn: 4, minutes: 8, note: '1편 중간 글 · 내용 이해・빈칸 추론' },
        { key: 'r-order', title:'읽기 · 순서 배열・문장 삽입', qn: 3, minutes: 7, note: '문맥 순서 ・ 빈칸에 들어갈 문장' },
        { key: 'w1', title:'쓰기 · 51번 完成型①', qn: 1, minutes: 10, note: '문장 완성（자동判分）' },
        { key: 'w2', title:'쓰기 · 52번 完成型②', qn: 1, minutes: 10, note: '문장 완성（자동判分）' },
        { key: 'w3', title:'쓰기 · 53번 论述', qn: 1, minutes: 25, note: '200~300자，自评' }
      ] // 113 题位 · 176 分钟（≈真题结构：듣기+어휘+문법+읽기+쓰기）· 近似满分 300、3급参考线 120
    },
    'ielts': {
      name: 'IELTS 仿真卷', grammarLang: 'en', speech: 'en-GB', scale: 9, pass: 6.5,
      sections: [
        { key: 'l1', title: 'Listening · Part 1 日常对话', qn: 10, minutes: 7, note: '情景对话整段朗读 · 填表+选择' },
        { key: 'l2', title: 'Listening · Part 2 场景独白', qn: 10, minutes: 8, note: '场景独白整段朗读 · 填表+选择' },
        { key: 'l3', title: 'Listening · Part 3 学术讨论', qn: 10, minutes: 8, note: '师生讨论整段朗读 · 选择+填空' },
        { key: 'l4', title: 'Listening · Part 4 学术讲座', qn: 10, minutes: 7, note: '讲座整段朗读 · 填空+选择' },
        { key: 'r1', title: 'Reading · Passage 1', qn: 13, minutes: 20, note: '真题文章 + 判断/配对标题/填空/选择' },
        { key: 'r2', title: 'Reading · Passage 2', qn: 13, minutes: 20, note: '真题文章 + 判断/配对标题/填空/选择' },
        { key: 'r3', title: 'Reading · Passage 3', qn: 13, minutes: 20, note: '真题文章 + 判断/配对标题/填空/选择' },
        { key: 'w1', title: 'Writing · Task 1 图表描述', qn: 1, minutes: 20, note: '150 词+，机打，不判分自评' },
        { key: 'w2', title: 'Writing · Task 2 议论文', qn: 1, minutes: 40, note: '250 词+，机打，不判分自评' }
      ] // 客观题 80 · 90 分钟 + 写作 2 题 60 分钟 · band 0~9 按客观题折算
    }
  };
  // 雅思写作原创题库（题干为文字数据描述——仿真练习用，不配真图表）；批改不可自动，考后自评
  var IELTS_WRITING = {
    w1: [ // Task 1：150 词+
      'The table below shows the percentage of households owning a car in three countries between 2000 and 2020. Country A: 15%, 28%, 41%, 55%. Country B: 88%, 89%, 91%, 92%. Country C: 48%, 52%, 58%, 62%. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.',
      'The chart below shows changes in the number of students enrolled in four subjects at a university over five years. Science: 1200, 1150, 1080, 1020, 980. Arts: 800, 850, 900, 980, 1050. Business: 600, 720, 860, 950, 1100. Engineering: 900, 880, 870, 860, 870. Summarise the main features and make comparisons. Write at least 150 words.',
      'The table below gives information about the number of tourists visiting a European city from four regions in 2010 and 2020. Europe: 2.1m, 2.4m. Asia: 0.8m, 1.9m. Americas: 1.2m, 1.1m. Africa & Middle East: 0.3m, 0.7m. Summarise the information and make comparisons where relevant. Write at least 150 words.',
      'The chart below shows the average daily minutes spent on three types of media by age groups in a country. 16-24: TV 45, social media 190, print 15. 25-44: TV 80, social media 120, print 30. 45-64: TV 130, social media 60, print 55. 65+: TV 190, social media 25, print 80. Summarise the main features. Write at least 150 words.',
      'The table below shows water consumption (litres per person per day) in five countries and how it is used. Country X: total 400 (home 150, farm 200, factory 50). Country Y: total 300 (home 100, farm 150, factory 50). Country Z: total 500 (home 200, farm 220, factory 80). Country W: total 250 (home 90, farm 120, factory 40). Country V: total 350 (home 130, farm 160, factory 60). Summarise the information. Write at least 150 words.',
      'The chart below shows the number of public libraries in a city and visitor numbers (millions per year) from 2005 to 2025. Libraries: 42, 40, 36, 33, 30. Visitors: 5.2, 4.8, 4.1, 3.9, 4.5. Summarise the main features and comment on possible reasons for the changes. Write at least 150 words.',
      'The bar chart compares the proportion of men and women in full-time employment in five occupational categories. Doctors: 55% men, 45% women. Nursing: 12% men, 88% women. Teaching: 38% men, 62% women. Engineering: 87% men, 13% women. Law: 49% men, 51% women. Summarise the information by selecting and reporting the main features. Write at least 150 words.',
      'The line graph shows the number of cars sold in three European countries between 2010 and 2024. Country P: 800k, 850k, 760k, 900k, 1.05m. Country Q: 600k, 540k, 500k, 620k, 700k. Country R: 450k, 470k, 480k, 460k, 440k. Summarise the main features and make comparisons where relevant. Write at least 150 words.',
      'The pie charts show how households in a country spent their income in 2005 and 2025. 2005: housing 32%, food 24%, transport 15%, entertainment 8%, savings 21%. 2025: housing 38%, food 14%, transport 11%, entertainment 15%, savings 22%. Summarise the information. Write at least 150 words.',
      'The table below shows the percentage of the population living in urban areas in five Asian countries in 1990 and 2025. Country J: 62%, 84%. Country K: 45%, 71%. Country L: 30%, 55%. Country M: 70%, 88%. Country N: 22%, 48%. Summarise the main features and make comparisons. Write at least 150 words.',
      'The chart below shows the main sources of electricity in a country in 2010 and 2025. 2010: coal 55%, gas 20%, nuclear 15%, wind and solar 5%, hydro 5%. 2025: coal 28%, gas 22%, nuclear 18%, wind and solar 25%, hydro 7%. Summarise the information and comment on the most significant changes. Write at least 150 words.',
      'The table below compares the amount of rubbish produced per person per week (kilograms) in four towns in 2010 and 2024, along with the percentage recycled. Town A: 14kg 8% → 11kg 34%. Town B: 16kg 6% → 13kg 41%. Town C: 10kg 12% → 9kg 48%. Town D: 18kg 5% → 15kg 27%. Summarise the main features. Write at least 150 words.',
      'The line graph compares the average number of hours spent online per day by people in three age groups between 2000 and 2025. Ages 16-24: 1.5h, 3.0h, 5.5h, 7.0h. Ages 35-49: 1.0h, 2.2h, 3.8h, 5.0h. Ages 60+: 0.3h, 0.8h, 1.9h, 3.5h. Summarise the main features and make comparisons. Write at least 150 words.',
      'The chart below shows the number of international students at a university in 2010, 2018 and 2025 by region of origin. Europe: 4,200, 5,100, 5,600. Asia: 2,800, 6,300, 9,400. Africa: 900, 1,600, 2,700. Americas: 1,300, 1,500, 1,700. Summarise the main features. Write at least 150 words.',
      'The diagram below shows the process by which recycled paper is produced, in seven stages beginning with collection and ending with the sale of new paper products. Summarise the information by selecting and reporting the main features, and describe the steps in detail. Write at least 150 words.',
      'The table below shows the number of visitors to three museums in a city and their entrance fees in 2015 and 2025. Museum X: 1.2m visitors, free → 0.8m visitors, free. Museum Y: 0.6m visitors, £8 → 1.1m visitors, £12. Museum Z: 0.9m visitors, £5 → 0.5m visitors, £10. Summarise the main features and make comparisons. Write at least 150 words.',
      'The bar chart compares the percentage of people in four age groups who did voluntary work in 2000 and 2022. Ages 18-24: 12%, 24%. Ages 25-44: 18%, 22%. Ages 45-64: 25%, 30%. Ages 65+: 30%, 35%. Summarise the information. Write at least 150 words.',
      'The chart below shows the average price of a first-night ticket for three types of entertainment in a city between 2005 and 2025, adjusted for inflation. Cinema: £5, £6, £7, £9. Theatre: £12, £15, £19, £26. Concert: £18, £22, £28, £38. Summarise the main features and make comparisons. Write at least 150 words.',
      'The table below shows the number of bicycles and cars registered in four European cities in 2010 and 2024, together with the kilometres of dedicated cycle lanes. City 1: bikes 120k→310k, cars 480k→420k, lanes 45km→190km. City 2: bikes 80k→150k, cars 350k→370k, lanes 20km→75km. City 3: bikes 200k→260k, cars 500k→460k, lanes 60km→140km. City 4: bikes 40k→130k, cars 290k→250k, lanes 10km→85km. Summarise the main features. Write at least 150 words.',
      'The diagram below illustrates two ways of producing electricity: a traditional coal-fired power station and a wind farm, showing the main components of each system. Compare the two methods by selecting and reporting the main features of both. Write at least 150 words.'
    ],
    w2: [ // Task 2：250 词+
      'Some people believe that universities should focus on preparing students for employment, while others think their main role is to advance knowledge. Discuss both views and give your own opinion.',
      'In many cities, cycling is encouraged as a green transport choice. What are the advantages and disadvantages of this policy for ordinary residents?',
      'Some people think that children should start learning a foreign language at primary school, while others believe it should begin later. Discuss both views and give your opinion.',
      'Nowadays more people work from home than ever before. Is this a positive or negative development for employees and employers?',
      'Governments spend a lot of money on the arts (music, theatre, museums) rather than on public services like hospitals and schools. To what extent do you agree or disagree that arts funding should be reduced?',
      'Some people argue that strict laws are the only way to reduce traffic accidents, while others think education and better road design matter more. Discuss both views and give your opinion.',
      'In many countries, the gap between the rich and the poor is widening. What problems does this cause, and what measures can governments take to reduce it?',
      'Some people believe that international travel makes people more tolerant, while others say it has little effect on attitudes. Discuss both views and give your own opinion.',
      'Many young people today choose to delay marriage and children until their thirties or later. What are the reasons for this trend, and is it positive or negative for society?',
      'With the development of artificial intelligence, some people worry that machines will replace most human jobs. To what extent do you agree or disagree that governments should prepare for mass job losses?',
      'Some people think that remote learning will completely replace classroom teaching in the future, while others believe the two should be combined. Discuss both views and give your own opinion.',
      'Many historic buildings are pulled down to make way for modern offices and flats. What problems does this cause, and what can be done to protect old buildings?',
      'Some people argue that parents should be legally responsible for the behaviour of their children. To what extent do you agree or disagree?',
      'In most countries, the recycling rate remains low. Why is this so, and what measures could increase the amount of waste people recycle?',
      'Some people prefer to eat in restaurants, while others prefer home-cooked meals. What are the reasons for each choice, and which do you think is better for family life?',
      'Governments should make public transport free rather than invest in new roads. To what extent do you agree or disagree with this view?',
      'Some people believe that violent films and video games cause violent behaviour in society. Others think the connection is exaggerated. Discuss both views and give your opinion.',
      'In the past, students studied hard to gain knowledge; nowadays they mainly study to pass exams. What are the reasons for this change, and is it a positive or negative development?',
      'Some people think that space exploration is a waste of money, while others believe it benefits humanity in many ways. Discuss both views and give your own opinion.',
      'Traffic congestion is a growing problem in big cities. What are the causes of this problem, and what measures could be taken to reduce it?',
      'Some people think that job satisfaction is more important than job security, while others believe that a stable job is essential. Discuss both views and give your own opinion.',
      'Nowadays museums and art galleries are offering more digital access to their collections. Is this a positive or negative development for the preservation of culture?',
      'Many people today suffer from stress caused by work. What are the causes of this problem, and what can employers and employees do to reduce stress at work?',
      'Some people believe that foreign tourists should pay more for their visits than local residents do. To what extent do you agree or disagree?',
      'Children nowadays spend less time playing outdoors than in the past. What are the reasons for this change, and what effects does it have on their health and development?',
      'Some people think that zoos should be closed because animals suffer in captivity, while others believe zoos play an important role in conservation. Discuss both views and give your opinion.',
      'In the digital age, newspapers and print media are disappearing. Is this a positive or negative development for society?',
      'Some people prefer to live in the countryside, while others prefer city life. What are the advantages of each, and where would you prefer to live?',
      'Many companies now allow their employees to work four days a week instead of five. Is this a positive or negative development for workers and employers?',
      'Some people think that governments should ban dangerous sports, while others believe individuals should be free to choose what they do. Discuss both views and give your own opinion.'
    ]
  };
  // TOPIK 쓰기 题库：51/52번 = 문장 완성（选正确词尾/连接，自动判分）；53번 = 论述（自评）
  var TOPIK_WRITING = {
    w1: [ // 51번：完成型①（连接词尾）
      { stem: '비가 오는데도 공원에서 운동하(           ).', answer: '는 사람이 많아요' },
      { stem: '주말에 시간이 있으면 박물관에 가(        ).', answer: '서 구경하고 싶어요' },
      { stem: '한국어를 공부할수록 재미(        ).', answer: '있어졌어요' },
      { stem: '어제 친구를 만나(        ) 영화를 봤습니다.', answer: '서 같이' },
      { stem: '약속 시간을 잊(        ) 동생에게 물어봤어요.', answer: '어서' }
    ],
    w2: [ // 52번：完成型②（语法填空）
      { stem: '시간이 없어서 아침을 안 먹(        ).', answer: '었어요' },
      { stem: '지갑을 놓고 (       ) 다시 집에 돌아왔습니다.', answer: '와서' },
      { stem: '이 일은 혼자 하(        ) 힘들 거예요.', answer: '기엔' },
      { stem: '부모님께 전화(        ) 드리려고 해요.', answer: '드리' },
      { stem: '책을 빌리려고 도서관에 (        ).', answer: '갔어요' }
    ],
    w3: [ // 53번：论述（200~300자，自评）
      '요즘 젊은 사람들이 결혼을 늦게 하거나 하지 않는 경우가 늘고 있습니다. 그 이유가 무엇이라고 생각합니까? 200자 이상 300자 이하로 쓰십시오.',
      '도시에서 살면서 가장 불편한 점은 무엇이며, 그것을 해결할 방법은 무엇이라고 생각합니까? 200자 이상 300자 이하로 쓰십시오.',
      '스마트폰 사용 시간이 늘어난 것이 우리 삶에 어떤 좋은 점과 나쁜 점을 가져왔습니까? 200자 이상 300자 이하로 쓰십시오.',
      '환경을 지키기 위해 우리가 일상생활에서 할 수 있는 일은 무엇이라고 생각합니까? 200자 이상 300자 이하로 쓰십시오.',
      '일주일에 하루 쉬다가 이틀을 쉬게 된다면 그 시간을 어떻게 보내겠습니까? 200자 이상 300자 이하로 쓰십시오.'
    ]
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

  // 干扰项三级抽样：同词性 → 同场景 → 随机（词库题专用；返回 3 个干扰值字符串，不含正确项）
  function pickDis3(correctW, all, used, lid, fieldFn) {
    var out = [];
    var correctVal = fieldFn(correctW);
    function take(pool) {
      var tries = 0;
      while (out.length < 3 && tries++ < pool.length * 3 + 9) {
        var it = pool[Math.floor(Math.random() * pool.length)];
        if (!it) break;
        var k = fieldFn(it);
        if (!k || k === correctVal || used[k] || out.indexOf(k) >= 0) continue;
        used[k] = 1;
        out.push(k);
      }
    }
    // ① 同词性
    take(all.filter(function (x) { return x.pos === correctW.pos; }));
    // ② 同场景（TAGS 按 listid/word 映射）
    if (out.length < 3 && lid && correctW.w) {
      var sc = TAGS[lid + '/' + correctW.w];
      if (sc) take(all.filter(function (x) { return TAGS[lid + '/' + x.w] === sc; }));
    }
    // ③ 随机兜底
    if (out.length < 3) take(all);
    return out.slice(0, 3);
  }

  // 组卷：typeKey 选试卷，sel 选板块
  function buildPaper(typeKey, sel) {
    var spec = EXAM_TYPES[typeKey];
    if (!spec) return null;
    // 词表按考试：ielts 用 ielts-core，topik 用 topik-core，jlpt 用 jlpt-core
    var wordList = typeKey === 'ielts' ? (LIST['ielts-core'] || LIST['jlpt-core'])
      : typeKey === 'topik-ii' ? (LIST['topik-core'] || LIST['jlpt-core'])
      : (LIST['jlpt-core'] || LIST['topik-core']);
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

    // 雅思阅读：文章库洗牌副本，r1/r2/r3 依次 splice 取（三篇互不重复）
    var passPool = [];
    // 雅思听力：各 Part 脚本洗牌副本，l1~l4 各抽一篇（情景脚本真题型）
    var scriptPool = {};
    // JLPT 読解 / TOPIK 읽기：按 kind 分池，各板块抽一篇（kind 对应板块后缀）
    var readPool = { s: [], m: [], l: [] };
    if (typeKey === 'ielts') {
      PASSAGES.forEach(function (p) { if (p.lang === 'en') passPool.push(p); });
      passPool = shuffle(passPool);
      ['l1', 'l2', 'l3', 'l4'].forEach(function (k) {
        scriptPool[k] = shuffle(SCRIPTS.filter(function (s) { return s.lang === 'en' && s.part === k; }));
      });
    }
    if (typeKey === 'topik-ii') {
      // TOPIK 듣기 장문：l-s（대화）/ l-l（안내・독백）两个脚本池，各抽一篇
      ['l-s', 'l-l'].forEach(function (k) {
        scriptPool[k] = shuffle(SCRIPTS.filter(function (s) { return s.lang === 'ko' && s.part === k; }));
      });
    }
    if (typeKey === 'jlpt-n1') {
      PASSAGES.forEach(function (p) {
        if (p.lang === 'ja' && readPool[p.kind]) readPool[p.kind].push(p);
      });
      ['s', 'm', 'l'].forEach(function (k) { readPool[k] = shuffle(readPool[k]); });
    }
    if (typeKey === 'topik-ii') {
      PASSAGES.forEach(function (p) {
        if (p.lang === 'ko' && readPool[p.kind]) readPool[p.kind].push(p);
      });
      ['s', 'm', 'l'].forEach(function (k) { readPool[k] = shuffle(readPool[k]); });
    }
    var secs = [];
    spec.sections.forEach(function (s) {
      if (!sel[s.key]) return;
      var qs = [];
      var secPassage = null;
      var secScript = null;
      var i;
      if ((typeKey === 'ielts' || typeKey === 'topik-ii') && scriptPool[s.key] && scriptPool[s.key].length) {
        // 听力真题型：抽一篇情景脚本（整段朗读一次），题挂脚本上（选择/填空）
        var scp = scriptPool[s.key].shift();
        secScript = { title: scp.title, text: scp.script };
        (scp.qs || []).forEach(function (pq) {
          qs.push({ type: pq.type, stem: pq.stem, options: pq.options || [], fill: pq.fill || null, num: !!pq.num, ref: null });
        });
      } else if (s.key === 'read-s' || s.key === 'read-m' || s.key === 'read-l' ||
                 s.key === 'r-s' || s.key === 'r-m' || s.key === 'r-order') {
        // JLPT 読解 / TOPIK 읽기 真题型：按 kind 抽一篇（内容理解/빈칸/순서/삽입/주제），题挂文章上
        var rk = s.key === 'r-order' ? 'l' : // TOPIK r-order 复用 l（순서/삽입）池
          (s.key === 'r-s' ? 's' : s.key === 'r-m' ? 'm' : s.key.slice(5)); // JLPT read-s/m/l 与 TOPIK r-s/r-m
        var rPool = readPool[rk] || [];
        if (rPool.length) {
          var rpg = rPool.splice(0, 1)[0];
          secPassage = { title: rpg.title, paras: rpg.paras };
          (rpg.qs || []).forEach(function (pq) {
            qs.push({ type: pq.type, stem: pq.stem, options: pq.options || [], num: true, ref: null });
          });
        }
      } else if (s.key === 'kanji') {
        var usedW = {};
        for (i = 0; i < s.qn; i++) {
          var usedOpt = {};
          var cand = exPick(kanjiW.length ? kanjiW : all, 1, usedW, function (x) { return x.w; })[0];
          if (!cand) break;
          var correct = cand.pron.split(' / ')[0];
          var dis = pickDis3(cand, all, usedOpt, wordList.id, function (x) { return x.pron.split(' / ')[0]; });
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
          var disC = pickDis3(c, all, usedOptC, wordList.id, function (x) { return x.w; });
          if (disC.length < 3) break;
          qs.push({ type: s.key === 'v-ctx' ? '문맥 채우기' : '文脈規定', stem: stem, options: optSet(c.w, disC), ref: wordList.id + '/' + c.w });
        }
      } else if (s.key === 'meaning' || s.key === 'v-mean') {
        var usedM = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptM = {};
          var m = exPick(all, 1, usedM, function (x) { return x.w; })[0];
          if (!m) break;
          var disM = pickDis3(m, all, usedOptM, wordList.id, function (x) { return x.zh; });
          if (disM.length < 3) break;
          qs.push({
            type: s.key === 'v-mean' ? '뜻 고르기' : '意味規定',
            stem: m.w + '（' + m.pron.split(' / ')[0] + '）',
            options: optSet(m.zh, disM), ref: wordList.id + '/' + m.w
          });
        }
      } else if (s.key === 'grammar' || s.key === 'g-form') {
        if (spec.grammarLang === 'ja') {
          // JLPT 文法真题型：整序（点带 ord 4 片段）+ 誤用訂正（点带 err 错例），各半；无该字段的点退回公式选择
          var usedOrd = {}, usedErr = {};
          var nJum = Math.ceil(s.qn / 2);
          for (i = 0; i < s.qn; i++) {
            var gpt;
            if (i < nJum) { // 整序：片段 ①-④ 打乱显示，选项 = 4 种排序（num ①②③④样式）
              var candJ = exPick(gpts.filter(function (p) { return p.ord; }), 1, usedOrd, function (p) { return p.t; })[0];
              if (!candJ) { gpt = exPick(gpts, 1, usedOrd, function (p) { return p.t; })[0]; if (!gpt) break; }
              if (candJ) {
                var frags = candJ.ord;
                var disp = shuffle(frags.slice()); // 显示序（乱序）
                var stemJ = '次の文を正しい語順に並べよ。';
                var fragHtml = disp.map(function (f, fi) { return '①②③④'[fi] + '「' + f + '」'; }).join(' ');
                // 正确排序：按 frags 原序在 disp 中的位置（+1 转题号）
                var correctSeq = frags.map(function (f) { return disp.indexOf(f) + 1; });
                var correctStr = correctSeq.map(function (n) { return '①②③④'[n - 1]; }).join('→');
                var seqs = [correctStr], tries = 0;
                while (seqs.length < 4 && tries++ < 40) { // 3 个干扰排序（相邻交换生成，贴近真题）
                  var a = correctSeq.slice(), swapAt = Math.floor(Math.random() * 3);
                  var tmp = a[swapAt]; a[swapAt] = a[swapAt + 1]; a[swapAt + 1] = tmp;
                  var sStr = a.map(function (n) { return '①②③④'[n - 1]; }).join('→');
                  if (seqs.indexOf(sStr) < 0) seqs.push(sStr);
                }
                qs.push({ type: '文法・語順整序', stem: stemJ + ' ' + fragHtml, num: true,
                  options: shuffle(seqs.map(function (s, si) { return { t: s, ok: si === 0 }; })), ref: null });
                continue;
              }
            } else { // 誤用訂正：给错句，4 个修正选 1
              var candE = exPick(gpts.filter(function (p) { return p.err; }), 1, usedErr, function (p) { return p.t; })[0];
              if (!candE) { // 无 err 点时退回原「公式选择」
                var g1 = exPick(gpts, 1, usedErr, function (p) { return p.t; })[0];
                if (!g1 || !(g1.ex && g1.ex[0] && g1.ex[0].en) || !g1.formula) break;
                var disG2 = exPick(gpts, 3, {}, function (p) {
                  return p.t === g1.t || p.formula === g1.formula ? null : p.formula;
                }).map(function (p) { return p.formula; });
                if (disG2.length < 3) break;
                qs.push({ type: '文法', stem: g1.ex[0].en, num: true, options: optSet(g1.formula, disG2), ref: null });
                continue;
              }
              var disG3 = exPick(gpts.filter(function (p) { return p.err && p.err !== candE.err; }), 3, {}, function (p) {
                return p.err.wrong === candE.err.wrong ? null : p.err.wrong;
              }).map(function (p) { return p.err.wrong; });
              qs.push({ type: '文法・誤用訂正', num: true,
                stem: '文中の誤りを改正せよ。「' + candE.err.wrong + '」',
                options: optSet(candE.err.fixes, disG3.length === 3 ? disG3 : ['正しい形', 'そのままでよい', '文全体の書き換え']), ref: null });
              continue;
            }
            gpt = gpt || null; // 兜底（正常走不到）
            void gpt;
            var g2 = exPick(gpts, 1, {}, function (p) { return p.t; })[0];
            if (!g2 || !(g2.ex && g2.ex[0] && g2.ex[0].en) || !g2.formula) break;
            var disG4 = exPick(gpts, 3, {}, function (p) {
              return p.t === g2.t || p.formula === g2.formula ? null : p.formula;
            }).map(function (p) { return p.formula; });
            if (disG4.length < 3) break;
            qs.push({ type: '文法', stem: g2.ex[0].en, num: true, options: optSet(g2.formula, disG4), ref: null });
          }
        } else { // 韩语：沿用连接词尾公式选择
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
        }
      } else if (s.key === 'listen' || s.key === 'l-word') {
        var usedL = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptL = {};
          var l1 = exPick(all, 1, usedL, function (x) { return x.w; })[0];
          if (!l1) break;
          var spoken = s.key === 'l-word' || !(l1.collo && l1.collo[0]) ? l1.w : l1.collo[0];
          var disL = pickDis3(l1, all, usedOptL, wordList.id, function (x) { return x.zh; });
          if (disL.length < 3) break;
          qs.push({
            type: '聴解・即時応答', stem: '🔊 ' + spoken, spoken: spoken,
            options: optSet(l1.zh, disL), ref: wordList.id + '/' + l1.w
          });
        }
      } else if (s.key === 'l-cont' || s.key === 'l1' || s.key === 'l2' || s.key === 'l4') {
        // 听句子选中文义：TOPIK 내용 파악 / 雅思 Listening Part 1·2·4
        var usedLC = {};
        for (i = 0; i < s.qn; i++) {
          var usedOptLC = {};
          var l2 = exPick(all, 1, usedLC, function (x) { return x.w; })[0];
          if (!l2) break;
          var sents = (l2.ex || []).filter(function (e) { return e.en && e.zh; });
          if (!sents.length) continue;
          var pick = sents[0];
          var disLC = pickDis3({ pos: l2.pos, w: l2.w, zh: pick.zh }, all, usedOptLC, wordList.id, function (x) { return x.zh; });
          if (disLC.length < 3) break;
          // 雅思听力（l1/l2/l4）不把原文打上屏幕（否则看着句子选中文不用听）；原文存 raw，交卷后解析区才显示
          qs.push({
            type: s.key === 'l-cont' ? '내용 파악' : '听句选义',
            stem: s.key === 'l-cont' ? '🔊 ' + pick.en : '听句子，选出正确的中文意思',
            spoken: pick.en, raw: s.key === 'l-cont' ? null : pick.en,
            options: optSet(pick.zh, disLC), ref: wordList.id + '/' + l2.w
          });
        }
      } else if (typeKey === 'topik-ii' && (s.key === 'w1' || s.key === 'w2' || s.key === 'w3')) {
        // TOPIK 쓰기：51/52번 = 完成型（选项选正确词尾，自动判分）；53번 = 论述（自评）
        if (s.key === 'w3') { // 53번 论述
          var w3pool = TOPIK_WRITING.w3;
          if (w3pool && w3pool.length) {
            qs.push({ type: '쓰기 · 53번 论述（200~300자）',
              stem: w3pool[Math.floor(Math.random() * w3pool.length)],
              writing: true, options: [], ref: null });
          }
        } else { // 51/52번 完成型：正确项 + 3 干扰（从 anderen 题的 answer 借）
          var wPool = TOPIK_WRITING[s.key];
          var usedW = {};
          for (i = 0; i < Math.max(s.qn, 1); i++) {
            var wq = exPick(wPool, 1, usedW, function (x) { return x.stem; })[0];
            if (!wq) break;
            var disW = exPick(wPool, 3, {}, function (x) {
              return x.answer === wq.answer ? null : x.answer;
            }).map(function (x) { return x.answer; });
            if (disW.length < 3) break;
            qs.push({
              type: s.key === 'w1' ? '쓰기 · 51번 完成型①' : '쓰기 · 52번 完成型②',
              stem: wq.stem, num: true, options: optSet(wq.answer, disW), ref: null
            });
          }
        }
      } else if (s.key === 'w1' || s.key === 'w2') {
        // IELTS 写作：抽一道原创题；无选项，机打作文，不判分自评
        var wPool2 = IELTS_WRITING[s.key];
        if (wPool2 && wPool2.length) {
          qs.push({
            type: s.key === 'w1' ? 'Task 1 图表描述（150 词+）' : 'Task 2 议论文（250 词+）',
            stem: wPool2[Math.floor(Math.random() * wPool2.length)],
            writing: true, options: [], ref: null
          });
        }
      } else if (s.key === 'l3') {
        // 雅思听力填空：听整句选空格词（朗读完整句）
        var poolR = ctxW.length ? ctxW : all;
        var usedFill = {};
        for (i = 0; i < s.qn; i++) {
          var fw = exPick(poolR, 1, usedFill, function (x) { return x.w; })[0];
          if (!fw) break;
          var fsent = null;
          (fw.ex || []).forEach(function (e) { if (!fsent && e.en && fw.w && e.en.indexOf(fw.w) >= 0) fsent = e.en; });
          if (!fsent) continue;
          var disF = exPick(all, 3, {}, function (x) {
            return x.w === fw.w ? null : x.w;
          }).map(function (x) { return x.w; });
          if (disF.length < 3) break;
          qs.push({
            type: '选词填空', stem: '🔊 ' + fsent.split(fw.w).join('（　）'),
            spoken: fsent, raw: fsent, // 完整句（含答案词），交卷后解析区显示
            options: optSet(fw.w, disF), ref: wordList.id + '/' + fw.w
          });
        }
      } else if (typeKey === 'ielts' && (s.key === 'r1' || s.key === 'r2' || s.key === 'r3')) {
        // 雅思阅读真题型：从文章库随机抽一篇（三篇互不重复），判断/配对标题/填空/选择挂在文章上
        if (passPool.length) {
          var pg = passPool.splice(Math.floor(Math.random() * passPool.length), 1)[0];
          secPassage = { title: pg.title, paras: pg.paras };
          (pg.qs || []).forEach(function (pq) {
            qs.push({
              type: pq.type, stem: pq.stem, options: pq.options || [], plain: !!pq.plain,
              fill: pq.fill || null, ref: null
            });
          });
        }
      }
      if (qs.length) secs.push({ key: s.key, title: s.title, minutes: s.minutes, qs: qs, passage: secPassage, script: secScript });
    });
    if (!secs.length) return null;
    var totalQ = secs.reduce(function (n, s) { return n + s.qs.length; }, 0);
    var totalMin = secs.reduce(function (n, s) { return n + s.minutes; }, 0);
    var objQ = 0; // 客观题数（写作不判分，band 只按客观题折算）
    secs.forEach(function (s) { s.qs.forEach(function (q) { if (!q.writing) objQ++; }); });
    return {
      typeKey: typeKey, name: spec.name,
      scale: spec.scale || 0, pass: spec.pass || 0, band: spec.scale === 9, // IELTS 用 band 0~9
      secs: secs, totalQ: totalQ, totalMin: totalMin, objQ: objQ,
      secIdx: 0, qi: 0,
      answers: secs.map(function (s) { return s.qs.map(function () { return -1; }); }),
      texts: secs.map(function (s) { return s.qs.map(function () { return ''; }); }), // 写作用
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
      if (s.qs.length && s.qs[0].writing) { // 写作板块：报字数，不判分不入错题
        var et = (exam.texts && exam.texts[si] && exam.texts[si][0]) || '';
        var ewc = et.trim() ? et.trim().split(/\s+/).length : 0;
        return { title: s.title, qn: 1, correct: 0, scaled: 0, words: ewc };
      }
      var correct = 0;
      s.qs.forEach(function (q, qi) {
        var a = exam.answers[si][qi];
        // 判分：填空按文本匹配，选择按选项 ok
        var ok = q.fill ? fillOk(q, a) : (a >= 0 && q.options[a] && q.options[a].ok);
        if (ok) correct++;
        if (!ok && q.ref) { // 错题（含未答）进复习队列
          exam.wrongRefN = (exam.wrongRefN || 0) + 1;
          try {
            scheduleRef(q.ref, false);
            var k = known();
            if (k[q.ref]) { delete k[q.ref]; lsSet('hedgehog:known', k); }
          } catch (e) {}
        }
      });
      // 板块折分先占位 0，下面按客观题总分统一重算（写作板块保持 0）
      return { title: s.title, qn: s.qs.length, correct: correct, scaled: 0 };
    });
    // 板块折分重算：每板块 correct/该场客观题总数 × 总分
    var objTotal = 0;
    exam.secs.forEach(function (s, si) {
      if (s.qs.length && s.qs[0].writing) return;
      objTotal += exam.result[si].correct;
    });
    var objCount = exam.secs.reduce(function (n, s) {
      return n + ((s.qs.length && s.qs[0].writing) ? 0 : s.qs.length);
    }, 0);
    exam.result.forEach(function (r, si) {
      if (r.words != null) return;
      r.scaled = exam.scale ? Math.round((r.correct / (objCount || 1)) * exam.scale * 10) / 10 : 0;
    });
    exam.wrongN = exam.result.reduce(function (n, r) { return r.words != null ? n : n + (r.qn - r.correct); }, 0);
    exam.correctN = objTotal;
    exam.objQ = objCount;
    if (exam.band) { // 雅思：官方 raw→band 换算表（40 题制，部分组卷按比例折算）
      exam.approx = ieltsBandFromRaw((exam.correctN / (objCount || 1)) * 40);
    } else if (exam.scale) { // JLPT/TOPIK 按卷标尺换算
      exam.approx = Math.round((exam.correctN / (objCount || 1)) * exam.scale * 10) / 10;
    }
    try { localStorage.removeItem('hedgehog:exam'); } catch (e) {}
    if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
    route();
    window.scrollTo(0, 0); // 交卷进成绩单，回顶
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

  function importHtml() {
    if (examPapers === null) return '<p class="picker-h">真题卷（本机导入）</p><p class="sub">读取中…</p>';
    var papers = examPapers || [];
    return (
      '<p class="picker-h">真题卷（本机导入 · 仅存你的浏览器，不上传不入库）</p>' +
      (papers.length
        ? papers.map(function (p) {
            return '<div class="entry-card import-row">' +
              '<span><b>' + esc(p.name) + '</b><small>' + p.totalQ + ' 题 · ' + p.totalMin + ' 分钟</small></span>' +
              '<span class="import-acts">' +
              '<button class="mini-btn" data-act="exam-begin-import" data-id="' + esc(String(p.id)) + '">开始</button>' +
              '<button class="mini-btn" data-act="exam-del-import" data-id="' + esc(String(p.id)) + '">删除</button>' +
              '</span></div>';
          }).join('')
        : '<p class="sub">还没有导入的真题卷</p>') +
      '<div class="exam-import"><button class="btn ghost" data-act="exam-pick-file">📥 导入真题卷（.json）</button>' +
      '<small class="import-tip">用 tools/exam-pdf2json.py 从真题 PDF 在本机转换</small>' +
      '<input type="file" id="examImportFile" accept=".json,application/json" hidden /></div>'
    );
  }

  // 校验导入卷：每题恰一个正确选项
  function validateExamPaper(p) {
    if (!p || !Array.isArray(p.secs) || !p.secs.length) return '缺少 secs';
    var total = 0, i, j, k;
    for (i = 0; i < p.secs.length; i++) {
      var sec = p.secs[i];
      if (!Array.isArray(sec.qs) || !sec.qs.length) return '板块缺题目';
      for (j = 0; j < sec.qs.length; j++) {
        var q = sec.qs[j];
        if (typeof q.stem !== 'string' || !q.stem) return '题干缺失';
        if (!Array.isArray(q.options) || q.options.length < 2) return '选项不足';
        var okN = 0;
        for (k = 0; k < q.options.length; k++) {
          if (typeof q.options[k].t !== 'string' || !q.options[k].t) return '选项文本缺失';
          if (q.options[k].ok) okN++;
        }
        if (okN !== 1) return '每题须恰好 1 个正确选项';
        total++;
      }
    }
    if (!total) return '没有题目';
    p.totalQ = total;
    if (!p.minutes || p.minutes < 1) p.minutes = 60;
    p.totalMin = p.minutes;
    return '';
  }

  function examScreen() {
    if (!exam) exam = lsGet('hedgehog:exam', null);
    if (!exam || !exam.secs || exam.phase === 'setup') {
      if (examPapers === null && !examPapersLoading) {
        examPapersLoading = true;
        idbGet('exam-papers').then(function (ps) {
          examPapers = ps || []; examPapersLoading = false; route();
        }, function () { examPapers = []; examPapersLoading = false; route(); });
      }
      // 试卷选择 + 板块勾选
      var typeCards = Object.keys(EXAM_TYPES).map(function (k) {
        var t = EXAM_TYPES[k];
        var on = examType === k;
        return (
          '<button class="entry-card exam-type' + (on ? ' on' : '') + '" data-act="exam-pick-type" data-key="' + k + '">' +
          '<b>' + t.name + '</b>' +
          '<small>' + t.sections.reduce(function (n, s) { return n + s.qn; }, 0) + ' 题 · ' +
          t.sections.reduce(function (n, s) { return n + s.minutes; }, 0) + ' 分钟</small></button>'
        );
      }).join('');
      var cur = EXAM_TYPES[examType];
      var cards = cur.sections.map(function (s) {
        var on = examSels[examType][s.key];
        return (
          '<button class="entry-card exam-sec' + (on ? ' on' : '') + '" data-act="exam-toggle" data-key="' + s.key + '">' +
          '<b>' + s.title + '</b>' +
          '<small>' + s.qn + ' 题 · ' + s.minutes + ' 分钟 · ' + s.note + '</small></button>'
        );
      }).join('');
      var onKeys = cur.sections.filter(function (s) { return examSels[examType][s.key]; });
      var tq = onKeys.reduce(function (n, s) { return n + s.qn; }, 0);
      var tm = onKeys.reduce(function (n, s) { return n + s.minutes; }, 0);
      return (
        '<a class="back-link" href="#/study">← 巡游</a>' +
        '<h2>考场</h2>' +
        '<p class="sub">仿真卷为原创题（按真题题型结构） · 成绩按各考试标尺换算</p>' +
        '<p class="picker-h">仿真卷（原创题 · 按真题题型）</p>' + typeCards +
        '<p class="picker-h">选择板块 · ' + esc(cur.name) + '</p>' + cards +
        '<div class="exam-start"><button class="btn" data-act="exam-begin"' + (tq ? '' : ' disabled') + '>' +
        '开始考试（' + tq + ' 题 · ' + tm + ' 分钟）</button></div>' +
        '<p class="footnote">倒计时中途刷新不丢 · 仿真卷错题自动进复习队列</p>'
      );
    }
    if (exam.phase === 'result') {
      var rows = (exam.result || []).map(function (r) {
        if (r.words != null) { // 写作板块：报字数自评
          return '<div class="exam-row"><span>' + esc(r.title) + '</span>' +
            '<span>' + r.words + ' 词</span><span>自评</span></div>';
        }
        return '<div class="exam-row"><span>' + esc(r.title) + '</span>' +
          '<span>' + r.correct + '/' + r.qn + '</span>' +
          (exam.scale ? '<span>折 ' + r.scaled + ' 分</span>' : '') + '</div>';
      }).join('');
      var pass = exam.scale ? exam.approx >= exam.pass : 0;
      var scoreHtml = exam.scale
        ? exam.approx + '<small>/' + exam.scale + (exam.band ? ' band' : ' 近似分') + '</small>'
        : exam.correctN + '<small>/' + exam.totalQ + ' 题正确</small>';
      var passHtml = exam.scale
        ? (exam.band
            ? '<p class="exam-passline">' + esc(exam.name || '') + ' · 总分按正确率折算 band · ' +
              (pass ? '常见留学线 ' + exam.pass + ' 以上 ✓' : '常见留学线 ' + exam.pass + '，还差 ' + Math.round((exam.pass - exam.approx) * 2) / 2 + ' band') + '</p>'
            : '<p class="exam-passline">' + esc(exam.name || '') + ' · 参考合格线 ' + exam.pass + ' · ' +
              (pass ? '达标线以上 ✓' : '距合格线还差 ' + Math.round((exam.pass - exam.approx) * 10) / 10 + ' 分') + '</p>')
        : '<p class="exam-passline">' + esc(exam.name || '') + ' · 真题卷按对错计分，无换算标尺</p>';
      // 逐题解析（默认折叠）：听力原文 raw 此时才出现；错题行标出正确答案；写作显示作文全文
      var revBase = 0;
      var review = exam.secs.map(function (s, si) {
        var revRows = s.qs.map(function (q, qi) {
          var no = '<b>' + (revBase + qi + 1) + '.</b>';
          if (q.writing) {
            var myEssay = (exam.texts && exam.texts[si] && exam.texts[si][qi]) || '';
            var mwc = myEssay.trim() ? myEssay.trim().split(/\s+/).length : 0;
            return '<div class="rev-row rev-essay">' + no +
              '<span class="rev-stem">' + esc(q.stem) +
              '<div class="rev-myessay">' + (myEssay ? esc(myEssay) : '（未写）') + '</div>' +
              '</span><span class="rev-pick">' + mwc + ' 词 · 自评</span></div>';
          }
          var a = exam.answers[si][qi];
          var ok = q.fill ? fillOk(q, a) : (a >= 0 && q.options[a] && q.options[a].ok);
          var okT = '', yourT;
          if (q.fill) { // 填空：显示正确词 vs 你填的词
            okT = q.fill.accept.join(' / ');
            yourT = typeof a === 'string' && a.trim() ? a : '未答';
          } else {
            q.options.forEach(function (o) { if (o.ok) okT = o.t; });
            yourT = a >= 0 && q.options[a] ? q.options[a].t : '未答';
          }
          return '<div class="rev-row' + (ok ? '' : ' wrong') + '">' + no +
            '<span class="rev-stem">' + esc(q.raw || q.stem) +
            (q.spoken ? ' <button class="mini-btn" data-act="exam-rev-play" data-si="' + si + '" data-qi="' + qi + '">🔊</button>' : '') +
            '</span>' +
            '<span class="rev-pick">你选 ' + esc(yourT) + (ok ? ' ✓' : '') + '</span>' +
            (ok ? '' : '<span class="rev-ok">正确 ' + esc(okT) + '</span>') +
            '</div>';
        }).join('');
        revBase += s.qs.length;
        // 听力脚本板块：解析区板块头显示整段脚本 + 重播（考中不显示的原文此时出现）
        var revScript = s.script
          ? '<div class="rev-script"><span class="rev-script-t">' + esc(s.script.title) +
            ' <button class="mini-btn" data-act="exam-rev-script" data-si="' + si + '">🔊 重播</button></span>' +
            '<p>' + esc(s.script.text) + '</p></div>'
          : '';
        return '<div class="rev-sec"><b>' + esc(s.title) + '</b>' + revScript + revRows + '</div>';
      }).join('');
      return (
        '<h2>考场 · 成绩单</h2>' +
        '<div class="card exam-result">' +
        '<div class="exam-score' + (pass ? ' pass' : '') + '">' + scoreHtml + '</div>' +
        passHtml +
        rows +
        '<div class="exam-total">总正确 ' + exam.correctN + '/' + (exam.objQ || exam.totalQ) +
        (exam.objQ && exam.objQ !== exam.totalQ ? '（客观题）' : '') +
        ' · 错 ' + exam.wrongN +
        (exam.imported ? '（真题卷 · 错题不自动入复习）'
          : exam.wrongRefN ? '（' + exam.wrongRefN + ' 题错词已进复习）' : '（已进复习队列）') + '</div>' +
        '<details class="exam-review"><summary>解析 · 逐题对照（含听力原文）</summary>' + review + '</details>' +
        '<div class="study-actions">' +
        '<button class="btn" data-act="exam-again">再战一场</button>' +
        '<button class="btn ghost" data-act="exam-reset">换一份卷</button>' +
        '<a class="btn ghost" href="#/study">回巡游</a>' +
        '</div></div>'
      );
    }
    // 考试中
    if (examTimerId == null) examStartTimer();
    var sec = examCur();
    var q = examCurQ();
    var ans = exam.answers[exam.secIdx][exam.qi];
    if (sec.script) { // 听力脚本板块：进板块第一题自动朗读整段（题干不显示脚本）
      if (exam.qi === 0 && exam.spoken !== 'sec-' + exam.secIdx) {
        exam.spoken = 'sec-' + exam.secIdx;
        setTimeout(function () { examSpeak(sec.script.text); }, 150);
      }
    } else if (q.spoken && exam.spoken !== exam.secIdx + '-' + exam.qi) {
      exam.spoken = exam.secIdx + '-' + exam.qi;
      setTimeout(function () { examSpeak(q.spoken); }, 150);
    }
    var qNo = 0, i;
    for (i = 0; i < exam.secIdx; i++) qNo += exam.secs[i].qs.length;
    qNo += exam.qi + 1;
    var opts = (q.writing || q.fill) ? '' : q.options.map(function (o, idx) {
      var cls = 'exam-opt';
      if (ans === idx) cls += o.ok ? ' right' : ' wrong';
      else if (ans >= 0 && o.ok) cls += ' reveal';
      return '<button class="' + cls + '" data-act="exam-pick" data-i="' + idx + '">' +
        (q.plain ? '' : '<em>' + (q.num ? '①②③④'[idx] : 'ABCD'[idx]) + '</em>') + esc(o.t) + '</button>';
    }).join('');
    var off = 0;
    var sheet = exam.secs.map(function (s, si) {
      var base = off; off += s.qs.length;
      return '<div class="exam-sheet-sec"><b>' + esc(s.title.split(' · ').pop()) + '</b>' +
        s.qs.map(function (q2, qi) {
          var a = exam.answers[si][qi];
          var hasText = (q2.writing || q2.fill) && typeof a === 'string' && a.trim() ||
            q2.writing && exam.texts && exam.texts[si] && (exam.texts[si][qi] || '').trim();
          var cls = 'sheet-no' + (si === exam.secIdx && qi === exam.qi ? ' cur' : '') + (a >= 0 || hasText ? ' done' : '');
          return '<button class="' + cls + '" data-act="exam-goto" data-si="' + si + '" data-qi="' + qi + '">' +
            (base + qi + 1) + '</button>';
        }).join('') + '</div>';
    }).join('');
    var lastSec = exam.secIdx === exam.secs.length - 1;
    var lastQ = exam.qi === exam.secs[exam.secIdx].qs.length - 1;
    var mid;
    if (q.writing) { // 写作：机打作文 + 实时字数（输入不整页重渲染，防丢焦点）
      var etxt = (exam.texts && exam.texts[exam.secIdx] && exam.texts[exam.secIdx][exam.qi]) || '';
      var ewc = etxt.trim() ? etxt.trim().split(/\s+/).length : 0;
      mid =
        '<textarea id="examEssay" class="exam-essay" spellcheck="false" ' +
        'placeholder="在此机打作文。不自动判分，交卷后可回看自评。">' + esc(etxt) + '</textarea>' +
        '<div class="exam-wc" id="examWc">已写 ' + ewc + ' 词</div>';
    } else if (q.fill) { // 填空（句子填空/真题卷填空）：直接输入单词，交卷判分
      var fval = typeof ans === 'string' ? ans : '';
      mid = '<input id="examFill" class="exam-fill" type="text" autocomplete="off" ' +
        'autocapitalize="none" spellcheck="false" placeholder="输入单词" value="' + esc(fval) + '" />';
    } else {
      mid = '<div class="exam-opts">' + opts + '</div>';
    }
    var passHtml = '';
    if (sec.passage) { // 雅思阅读真题型：文章置顶（分段标号，可滚动）
      passHtml = '<div class="exam-passage">' +
        '<b>' + esc(sec.passage.title) + '</b>' +
        sec.passage.paras.map(function (t, pi) {
          return '<p><em>' + 'ABCDEFGH'[pi] + '.</em> ' + esc(t) + '</p>';
        }).join('') + '</div>';
    }
    return (
      '<div class="exam-head">' +
      '<span class="exam-secname">' + esc(sec.title) + '</span>' +
      '<span class="exam-timer" id="examTimer">--:--</span>' +
      '<button class="mini-btn" data-act="exam-exit">✕ 交卷退出</button>' +
      '</div>' +
      '<div class="exam-prog"><span>第 ' + qNo + '/' + exam.totalQ + ' 题</span>' +
      '<span>' + (exam.secIdx + 1) + '/' + exam.secs.length + ' 板块</span></div>' +
      '<div class="exam-two">' +
      '<div class="exam-main">' +
      passHtml +
      '<div class="card exam-card">' +
      '<div class="exam-qtype">' + esc(q.type) + '</div>' +
      '<div class="exam-stem">' + esc(q.stem) +
      ((q.spoken || sec.script) ? ' <button class="mini-btn" data-act="exam-replay">🔁 重播</button>' : '') +
      '</div>' +
      mid +
      '<div class="exam-nav">' +
      '<button class="btn ghost" data-act="exam-prev"' +
      (exam.qi === 0 && exam.secIdx === 0 ? ' disabled' : '') + '>上一题</button>' +
      '<button class="btn" data-act="exam-next">' + (lastSec && lastQ ? '交卷' : '下一题') + '</button>' +
      '</div></div>' +
      '</div>' +
      '<div class="exam-sheet">' + sheet + '</div>' +
      '</div>'
    );
  }

  var lastRouteHash = null; // 区分「换页」与「页内重渲染」：后者不滚顶，防选卷/勾板块时页面颤动
  function route() {
    if (!DATA) return;
    var h = location.hash.replace(/^#\/?/, '');
    var pageChanged = h !== lastRouteHash;
    lastRouteHash = h;
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
      if (parts[2] === 'practice') view.innerHTML = viewTablePractice(parts[1]);
      else view.innerHTML = parts[1] ? viewTable(parts[1]) : viewTablesHub();
      nav = 'categories';
    } else if (name === 'grammar') {
      if (parts[2]) view.innerHTML = viewGrammarRoom(parts[1], parts[2]);
      else if (parts[1]) view.innerHTML = viewGrammarWing(parts[1]);
      else view.innerHTML = viewGrammarHub();
      nav = 'categories';
    } else if (name === 'exam') {
      view.innerHTML = examScreen();
      nav = 'study';
      // 考场专注模式：考试进行中隐藏本子装饰（螺旋/页眉/页码/活页孔），沉浸答题
      document.body.classList.toggle('exam-focus', !!(exam && exam.phase === 'run'));
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
    // 离开考场即退出专注模式（隐藏本子装饰）
    if (name !== 'exam') document.body.classList.remove('exam-focus');

    document.querySelectorAll('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === nav);
    });
    var pnum = { home: 1, categories: 2, word: 2, tables: 3, study: 4, favorites: 5, grammar: 6, copybook: 7, exam: 4 }[name] || 1;
    var pn = $('pageNum');
    if (pn) pn.textContent = '— ' + pnum + ' —';
    if (pageChanged) window.scrollTo(0, 0); // 只在真正换页时回顶；页内操作保持滚动位置

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

    var fillEl = $('examFill'); // 填空题：输入存 answers（字符串），不整页重渲染防丢焦点
    if (fillEl) {
      fillEl.addEventListener('input', function () {
        if (!exam || exam.phase !== 'run') return;
        exam.answers[exam.secIdx][exam.qi] = fillEl.value;
        examPersist();
        var cur = document.querySelector('.sheet-no.cur');
        if (cur) cur.classList.toggle('done', !!fillEl.value.trim());
      });
    }

    var essay = $('examEssay'); // 写作题：输入存 exam.texts 并更新字数（不整页重渲染防丢焦点）
    if (essay) {
      essay.addEventListener('input', function () {
        if (!exam || exam.phase !== 'run') return;
        exam.texts = exam.texts || [];
        exam.texts[exam.secIdx] = exam.texts[exam.secIdx] || [];
        exam.texts[exam.secIdx][exam.qi] = essay.value;
        examPersist();
        var wcEl = $('examWc');
        if (wcEl) {
          var n = essay.value.trim() ? essay.value.trim().split(/\s+/).length : 0;
          wcEl.textContent = '已写 ' + n + ' 词';
        }
        // 答题卡标记：写满才算已答样式（页内局部改 class）
        var cur = document.querySelector('.sheet-no.cur');
        if (cur) cur.classList.toggle('done', !!essay.value.trim());
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
      if (exam) { examPersist(); route(); window.scrollTo(0, 0); } // 阶段切换（选卷→考试）回顶
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
      if (exam && exam.phase === 'run') {
        var rq2 = examCurQ();
        examSpeak(rq2.spoken || (examCur().script ? examCur().script.text : '') || '');
      }
    } else if (act === 'exam-rev-play') { // 成绩单解析区重播单题音频
      if (exam && exam.phase === 'result') {
        var rsi = parseInt(el.getAttribute('data-si'), 10), rqi = parseInt(el.getAttribute('data-qi'), 10);
        var rq = exam.secs[rsi] && exam.secs[rsi].qs[rqi];
        if (rq && rq.spoken) examSpeak(rq.spoken);
      }
    } else if (act === 'exam-rev-script') { // 解析区重播整段听力脚本
      if (exam && exam.phase === 'result') {
        var ssi = parseInt(el.getAttribute('data-si'), 10);
        var ssec = exam.secs[ssi];
        if (ssec && ssec.script) examSpeak(ssec.script.text);
      }
    } else if (act === 'exam-exit') {
      if (exam && exam.phase === 'run' && confirm('现在交卷？未答的题按错计并进入复习。')) examFinish();
    } else if (act === 'exam-again') {
      if (exam.imported) { // 导入卷：同题重开一场，重置作答与计时
        exam.secIdx = 0; exam.qi = 0;
        exam.answers = exam.secs.map(function (s) { return s.qs.map(function () { return -1; }); });
        exam.deadline = Date.now() + exam.totalMin * 60000;
        exam.phase = 'run'; exam.spoken = null;
        delete exam.result; delete exam.approx; delete exam.correctN; delete exam.wrongN; delete exam.wrongRefN;
        examPersist(); route(); window.scrollTo(0, 0); return;
      }
      exam = buildPaper(exam.typeKey || examType, examSels[exam.typeKey || examType]);
      if (exam) { examPersist(); route(); window.scrollTo(0, 0); }
    } else if (act === 'exam-reset') { // 成绩单 → 回选卷页重选试卷/板块
      exam = null;
      try { localStorage.removeItem('hedgehog:exam'); } catch (er) {}
      if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
      route(); window.scrollTo(0, 0);
    } else if (act === 'tbl-pick') { // 基础表练习：选答案
      if (!tableQuiz) return;
      var tq = tableQuiz.qs[tableQuiz.qi];
      if (!tq || tableQuiz.picked >= 0) return;
      var pi = parseInt(el.getAttribute('data-i'), 10);
      tableQuiz.picked = pi;
      if (tq.options[pi] && tq.options[pi].ok) tableQuiz.good++; else tableQuiz.bad++;
      route();
    } else if (act === 'tbl-next') { // 基础表练习：下一题
      if (!tableQuiz) return;
      tableQuiz.qi++; tableQuiz.picked = -1;
      route();
    } else if (act === 'tbl-done') { // 基础表练习：完成本轮，记打卡
      if (!tableQuiz) return;
      logStamp();
      tableQuiz = null;
      route();
    } else if (act === 'exam-pick-file') {
      var fi = $('examImportFile');
      if (fi) fi.click();
    } else if (act === 'exam-begin-import') {
      var pid = el.getAttribute('data-id');
      var pp = (examPapers || []).filter(function (x) { return String(x.id) === pid; })[0];
      if (!pp) return;
      var mins = pp.minutes || 60;
      exam = {
        typeKey: 'import', imported: true, name: pp.name,
        secs: pp.secs.map(function (x, xi) {
          return {
            key: x.key || 'q' + xi, title: x.title || '기출문제',
            minutes: x.minutes || Math.max(1, Math.round(mins / pp.secs.length)),
            qs: x.qs
          };
        }),
        secIdx: 0, qi: 0,
        answers: pp.secs.map(function (x) { return x.qs.map(function () { return -1; }); }),
        deadline: Date.now() + mins * 60000,
        phase: 'run', spoken: null
      };
      exam.totalQ = exam.secs.reduce(function (n, x) { return n + x.qs.length; }, 0);
      exam.totalMin = mins;
      examPersist(); route(); window.scrollTo(0, 0);
    } else if (act === 'exam-del-import') {
      var did = el.getAttribute('data-id');
      if (confirm('删除这份本机真题卷？')) {
        examPapers = (examPapers || []).filter(function (x) { return String(x.id) !== did; });
        idbSet('exam-papers', examPapers).then(function () { route(); });
      }
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
    } else if (act === 'li-pick') { // 听力理解：选词义
      if (!session || session.liChecked) return;
      var liI = parseInt(el.getAttribute('data-i'), 10);
      session.liPicked = liI;
      session.liOk = !!(session.liOpts[liI] && session.liOpts[liI].ok);
      session.liChecked = true;
      recordStudy(session.liOk);
      route();
    } else if (act === 'sh-record') {
      shRecord();
    } else if (act === 'sh-stop') {
      shStop();
    } else if (act === 'sh-play') {
      shPlay();
    } else if (act === 'sh-again') {
      shDispose();
      if (session) { session.shState = 'idle'; route(); }
    } else if (act === 'shcol-play-native') { // 搭配跟读：播整块原声
      speakCol(el.getAttribute('data-ref'), el.getAttribute('data-phrase'));
    } else if (act === 'pron-toggle') { // 发音评分开关（默认关）
      if (!pronOn() && !confirm('开启后识别发音需要联网：你说的音频会发送给 Google 服务器。\n只用于跟读打分，不保存。确定开启？')) return;
      setPron(!pronOn());
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
    if (e.target && e.target.id === 'examImportFile') {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var paper = JSON.parse(String(reader.result));
          var verr = validateExamPaper(paper);
          if (verr) { toast('导入失败：' + verr); return; }
          paper.id = 'p' + Date.now();
          paper.name = paper.name || String(file.name).replace(/\.json$/i, '');
          idbGet('exam-papers').then(function (list) {
            list = list || [];
            list.push(paper);
            return idbSet('exam-papers', list);
          }).then(function () {
            examPapers = null; route(); toast('已导入：' + paper.name);
          }).catch(function () { toast('保存失败'); });
        } catch (err2) { toast('JSON 解析失败'); }
      };
      reader.readAsText(file);
      e.target.value = '';
      return;
    }
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
