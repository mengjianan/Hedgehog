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
  var TABLES = []; // 基础表 [{id, lang, title, sections}]
  var TBY = {}; // id -> table
  var GRAMMARS = []; // 语法翼楼 [{id, lang, title, rooms}]
  var GBY = {}; // id -> grammar wing
  var session = null; // 当前巡游 {queue:[ref], idx, good, bad, mode, kind, ...}
  var pickMode = 'card'; // 选厅模式：card 认卡 / spell 拼写

  var LANG_NAME = { en: '英语', ko: '韩语', ja: '日语' };

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
  async function unlock(password) {
    var saltResp = await fetch('data/salt');
    if (!saltResp.ok) throw new Error('salt missing');
    var salt = new Uint8Array(await saltResp.arrayBuffer());
    var blob = await (await fetch('data/words.enc')).json();
    var base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: blob.iter, hash: 'SHA-256' },
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
    return JSON.parse(td.decode(plain));
  }

  function setData(data) {
    DATA = data;
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

  function speak(ref) {
    if (!window.speechSynthesis) return;
    var e = IDX[ref];
    if (!e) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(e.x.w);
    u.lang = e.l.speech || 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  function pendingCount(l) {
    var k = known();
    return l.words.filter(function (x) { return !k[l.id + '/' + x.w]; }).length;
  }

  function isScene(l) { return l.group === 'scene'; }
  function coreLists() { return LISTS.filter(function (l) { return !isScene(l); }); }
  function sceneLists() { return LISTS.filter(isScene); }
  function isLit(l) { return l.words.length > 0 && pendingCount(l) === 0; }

  // ---------- 视图：首页（门厅搜索 + 快捷入口） ----------
  function viewHome() {
    var coreWords = coreLists().reduce(function (n, l) { return n + l.words.length; }, 0);
    var scenes = sceneLists();
    var litCount = scenes.filter(isLit).length;
    var dueAll = dueRefsNow().length;
    var halls =
      '<div class="halls">' +
      '<a class="hall hall-link" href="#/home" data-act="focus-search">' +
      '<span class="k">SEARCH</span><b>搜索</b><small>三语通查</small></a>' +
      '<a class="hall hall-link" href="#/categories">' +
      '<span class="k">HALL</span><b>词库</b><small>核心词 ' + coreWords + ' · 场景厅</small></a>' +
      '<a class="hall hall-link" href="#/study">' +
      '<span class="k">TOUR</span><b>巡游</b><small>背词与复习</small></a>' +
      '<a class="hall hall-link" href="#/favorites">' +
      '<span class="k">CABINET</span><b>藏品</b><small>收藏 ' + favs().length + ' 件</small></a>' +
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
      '<p class="footnote">Hedgehog · 语感宫殿 · 内容全部原创</p>'
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
    var sceneCards = sceneLists()
      .map(function (l) {
        var total = l.words.length;
        var mastered = total - pendingCount(l);
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
    var tableCards = TABLES.map(function (t) {
      return mini(
        t.title,
        String(t.id || '').toUpperCase().replace(/-/g, ' '),
        esc(t.subtitle || (t.sections || []).length + ' 节'),
        '#/tables/' + t.id,
        t.lang
      );
    }).join('');
    return (
      '<h2>词库</h2>' + wordCards +
      '<h2 class="group-h">场景厅</h2><div class="wordlist">' + sceneCards + '</div>' +
      '<h2 class="group-h">基础表</h2><div class="wordlist">' + tableCards + '</div>' +
      '<h2 class="group-h">语法翼楼</h2><div class="wordlist">' +
      mini('英语语法宫', 'GRAMMAR', '6 宫室 · 30 点', '#/grammar', 'en') +
      '</div>'
    );
  }

  function viewList(listId) {
    var l = LIST[listId];
    if (!l) return viewCategories();
    if (isScene(l)) return viewRoom(l);
    var chips = l.words
      .map(function (x) {
        return (
          '<a class="word-chip" href="#/word/' + l.id + '/' + encodeURIComponent(x.w) + '">' +
          '<b>' + esc(x.w) + '</b><small>' + esc(x.zh) + '</small></a>'
        );
      })
      .join('');
    return (
      '<a class="back-link" href="#/categories">← 词库</a>' +
      '<h2>' + esc(l.title) + '</h2>' +
      '<div class="wordlist">' + chips + '</div>'
    );
  }

  // 场景厅房间页（展位号 + 陈设钩子）
  function viewRoom(l) {
    var total = l.words.length;
    var mastered = total - pendingCount(l);
    var lit = isLit(l);
    var dc = listDueCount(l);
    var chips = l.words
      .map(function (x, i) {
        return (
          '<a class="word-chip" href="#/word/' + l.id + '/' + encodeURIComponent(x.w) + '">' +
          '<span class="slot">No.' + (i + 1) + ' 展台</span>' +
          '<b>' + esc(x.w) + '</b><small>' + esc(x.zh) + '</small></a>'
        );
      })
      .join('');
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
      '<div class="wordlist">' + chips + '</div>' +
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
      '</div>'
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
    var pend = pendingCount(l);
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
          '<b>今日复习 · ' + Math.min(dueN, 10) + ' 站</b>' +
          '<small>到期的词自动回到这里 · 记忆间隔 1 / 3 / 7 / 15 天</small></button>';
      }
      cards +=
        '<button class="entry-card" data-act="start-study" data-kind="mix">' +
        '<b>串门混考</b>' +
        '<small>随机跨厅抽 10 站 · 交错练习记得更牢</small></button>' +
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
      return (
        '<h2>巡游</h2>' +
        '<p class="sub">先选模式，再选出发点 · 每轮 10 站 · 进度存在本机</p>' +
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
      '<span>认识 ' + session.good + ' · 模糊 ' + session.bad + '</span></div>' +
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
    if (opts.kind === 'review') {
      refs = shuffle(dueRefsNow()).slice(0, 10);
    } else if (opts.kind === 'mix') {
      var m = dueMap();
      var t = now();
      var pool = ALL.filter(function (e) {
        return !k[e.ref] || (m[e.ref] && m[e.ref].d <= t);
      }).map(function (e) { return e.ref; });
      refs = shuffle(pool).slice(0, 10);
    } else {
      var l = LIST[opts.listId];
      if (!l) return false;
      var fresh = [];
      var rev = [];
      l.words.forEach(function (x) {
        var r = l.id + '/' + x.w;
        (k[r] ? rev : fresh).push(r);
      });
      refs = fresh.slice(0, 10);
      if (refs.length < 10) refs = fresh.concat(rev).slice(0, 10);
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
    var soon =
      '<div class="card cat-card" style="opacity:.65;margin-top:12px">' +
      '<span><b>韩语语法翼楼</b><small>建設中</small></span><span>Coming</span></div>' +
      '<div class="card cat-card" style="opacity:.65;margin-top:12px">' +
      '<span><b>日语语法翼楼</b><small>建設中</small></span><span>Coming</span></div>';
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

  // ---------- 视图：基础表 ----------
  function viewTable(id) {
    var t = TBY[id];
    if (!t) return viewCategories();
    var body = (t.sections || []).map(renderSection).join('');
    return (
      '<a class="back-link" href="#/categories">← 词库</a>' +
      '<div class="table-head lang-' + t.lang + '">' +
      '<h2>' + esc(t.title) + '</h2>' +
      '<em class="lang-tag lang-' + t.lang + '">' + (LANG_NAME[t.lang] || t.lang) + '</em>' +
      '<p class="sub">' + esc(t.subtitle || '') + '</p>' +
      '</div>' + body +
      '<p class="footnote">Hedgehog · 基础表 · 内容全部原创</p>'
    );
  }

  function renderSection(s) {
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
      inner =
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        s.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        s.rows.map(function (r) {
          return (
            '<tr>' +
            r.map(function (c, i) {
              return i === 0
                ? '<th scope="row">' + esc(c) + '</th>'
                : '<td>' + esc(c) + '</td>';
            }).join('') +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>';
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
                '<td><b>' + esc(p[0]) + '</b>' +
                (p[1] ? '<i>' + esc(p[1]) + '</i>' : '') +
                (p[2] ? '<small>' + esc(p[2]) + '</small>' : '') +
                '</td>'
              );
            }).join('') +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>' +
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
      view.innerHTML = viewTable(parts[1] || '');
      nav = 'categories';
    } else if (name === 'grammar') {
      if (parts[2]) view.innerHTML = viewGrammarRoom(parts[1], parts[2]);
      else if (parts[1]) view.innerHTML = viewGrammarWing(parts[1]);
      else view.innerHTML = viewGrammarHub();
      nav = 'categories';
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
    var pnum = { home: 1, categories: 2, word: 2, tables: 3, study: 4, favorites: 5, grammar: 6, copybook: 7 }[name] || 1;
    var pn = $('pageNum');
    if (pn) pn.textContent = '— ' + pnum + ' —';
    window.scrollTo(0, 0);

    var q = $('q');
    if (q) {
      q.addEventListener('input', function () { renderResults(q.value); });
      q.focus();
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
  }

  // ---------- 事件委托（只绑一次） ----------
  $('view').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var ref = el.getAttribute('data-ref');

    if (act === 'speak') speak(ref);
    else if (act === 'star') {
      el.classList.toggle('on', toggleFav(ref));
    } else if (act === 'focus-search') {
      var qi = $('q');
      if (qi) qi.focus();
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
      route();
    } else if (act === 'wm-good') {
      recordStudy(true);
      advanceSession();
      route();
    } else if (act === 'wm-again') {
      recordStudy(false);
      advanceSession();
      route();
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
      route();
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

  $('gateForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('gateBtn');
    var hint = $('gateHint');
    btn.disabled = true;
    hint.style.color = 'var(--mut)';
    hint.textContent = '解密中…';
    try {
      var data = await unlock($('gatePassword').value);
      if (!data || !data.lists || !data.lists.length) throw new Error('empty');
      setData(data);
      try { sessionStorage.setItem('hedgehog:data', JSON.stringify(data)); } catch (err) {}
      $('gatePassword').value = '';
      hint.textContent = '';
      openApp();
    } catch (err) {
      hint.style.color = 'var(--red)';
      hint.textContent = '密码不对';
      $('gatePassword').select();
    }
    btn.disabled = false;
  });

  window.addEventListener('hashchange', route);

  initPage();

  // 注册 service worker（安卓 Chrome 的 PWA 安装条件 + 壳离线）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // 本会话已解锁过则直接进入（关掉标签页后需重新输密码）
  // 版本守卫：旧结构缓存（如无 tables 的 v2）自动作废，强制重新解密
  try {
    var cached = sessionStorage.getItem('hedgehog:data');
    if (cached) {
      var cd = JSON.parse(cached);
      if (cd && cd.version >= 5 && cd.tables && cd.tables.length) {
        setData(cd);
        openApp();
      } else {
        sessionStorage.removeItem('hedgehog:data');
      }
    }
  } catch (e) {
    try { sessionStorage.removeItem('hedgehog:data'); } catch (e2) {}
  }
})();
