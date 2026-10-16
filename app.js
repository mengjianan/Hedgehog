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
  var session = null; // 当前背词轮次 {listId, queue, idx, good, bad, revealed}

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

  // ---------- 视图：宫殿总图（首页） ----------
  function sceneRoomHTML(l) {
    var total = l.words.length;
    var mastered = total - pendingCount(l);
    var lit = isLit(l);
    return (
      '<a class="room ' + (lit ? 'lit' : 'dim') + ' lang-' + l.lang + '" href="#/categories/' + l.id + '">' +
      '<span class="door" aria-hidden="true"></span>' +
      '<span class="lit-dot">' + (lit ? '● 已点亮' : '○ 未点亮') + '</span>' +
      '<div class="room-en">' + esc(l.enName || l.title) + '</div>' +
      '<h4>' + esc(l.title) + '</h4>' +
      '<div class="room-meta">' + total + ' 词 · ' + mastered + '/' + total + ' 已掌握</div>' +
      '</a>'
    );
  }

  // ---------- 视图：首页（宫殿总图 + 门厅搜索） ----------
  function viewHome() {
    var coreWords = coreLists().reduce(function (n, l) { return n + l.words.length; }, 0);
    var scenes = sceneLists();
    var litCount = scenes.filter(isLit).length;
    var halls =
      '<div class="halls">' +
      '<div class="hall"><span class="k">FOYER</span><b>门厅</b><small>上方搜索 · 迎宾台</small></div>' +
      '<div class="hall"><span class="k">MAIN HALL</span><b>词库大厅</b><small>核心词 ' + coreWords + ' 词</small></div>' +
      '<div class="hall"><span class="k">STUDY</span><b>图书室</b><small>基础表 ' + TABLES.length + ' 张</small></div>' +
      '<div class="hall"><span class="k">CABINET</span><b>藏品室</b><small>收藏 ' + favs().length + ' 件</small></div>' +
      '</div>';
    return (
      '<div class="hero">' +
      '<img class="sticker hero-sticker" src="icons/sticker-hog.svg" alt="" />' +
      '<h2>语感宫殿</h2>' +
      '<p class="sub">学习走宫殿，查询走门厅 · 词条内容全原创</p>' +
      '<div class="search-row"><input id="q" type="search" placeholder="门厅搜索：abolish / 마음 / 環境" autocomplete="off" /></div>' +
      '</div>' +
      '<div class="results" id="results"></div>' +
      halls +
      '<h2 class="group-h">场景厅</h2>' +
      '<div class="floor">' + scenes.map(sceneRoomHTML).join('') + '</div>' +
      '<div class="legend">' +
      '<span class="lg-lit">● 全会 = 点亮</span>' +
      '<span class="lg-dim">○ 还有词没掌握</span>' +
      '<span>┈ 中央虚线 = 巡游路线</span>' +
      '<span>' + litCount + '/' + scenes.length + ' 厅已点亮</span>' +
      '</div>' +
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
    var sceneCards = sceneLists().map(function (l) {
      var total = l.words.length;
      var mastered = total - pendingCount(l);
      return (
        '<a class="card cat-card lang-' + l.lang + '" href="#/categories/' + l.id + '">' +
        '<span><b>' + esc(l.title) + '</b><small>' +
        esc(l.enName || '') + ' · ' + total + ' 词 · ' +
        (isLit(l) ? '● 已点亮' : mastered + '/' + total + ' 已掌握') +
        '</small></span><span>→</span></a>'
      );
    }).join('');
    var tableCards = TABLES.map(function (t) {
      return (
        '<a class="card cat-card lang-' + t.lang + '" href="#/tables/' + t.id + '">' +
        '<span><b>' + esc(t.title) + '</b><small>' +
        (LANG_NAME[t.lang] || t.lang) + ' · ' + esc(t.subtitle || (t.sections || []).length + ' 节') +
        '</small></span><span>→</span></a>'
      );
    }).join('');
    return (
      '<h2>词库</h2>' + wordCards +
      (sceneCards ? '<h2 class="group-h">场景厅</h2>' + sceneCards : '') +
      (tableCards ? '<h2 class="group-h">基础表</h2>' + tableCards : '')
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
      '</span></div>' +
      '<div class="dress">' + esc(l.dress || '') + '</div>' +
      '<div class="wordlist">' + chips + '</div>' +
      '<p class="footnote">走完整厅点亮房间 · 点词进详情看宫殿地址</p>'
    );
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
      '<div class="entry-section"><span class="entry-label">高频搭配</span><div class="collo">' + collo + '</div></div>' +
      '<div class="entry-section"><span class="entry-label">例句</span><div class="ex-list">' + ex + '</div></div>' +
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
    var sub = isScene(l)
      ? isLit(l)
        ? '● 已点亮'
        : pend + ' 词待学 · 走完点灯'
      : pend
        ? '待学 ' + pend + ' 词'
        : '已全会 · 可复习';
    return (
      '<button class="word-chip' + (isScene(l) && isLit(l) ? ' lit' : '') + '" ' +
      'data-act="start-study" data-list="' + l.id + '">' +
      '<b>' + esc(l.title.replace(/（.*?）/, '')) + '</b>' +
      '<small>' + sub + '</small></button>'
    );
  }

  function studyScreen() {
    if (!session) {
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
        '<p class="sub">每轮 10 站 · 选一间厅出发 · 整厅走完房间点亮</p>' +
        groups
      );
    }
    if (session.idx >= session.queue.length) {
      var doneList = LIST[session.listId];
      var nowLit = doneList && isLit(doneList);
      var banner = nowLit
        ? '<div class="lit-banner">✦ ' + esc(doneList.title) + ' 已点亮</div>'
        : '';
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
    var l = LIST[session.listId];
    var w = session.queue[session.idx];
    var ref = session.listId + '/' + w;
    var e = IDX[ref];
    var x = e.x;
    var pct = Math.round((session.idx / session.queue.length) * 100);
    var slotNote = isScene(l)
      ? '<span class="tour-slot">No.' + (l.words.indexOf(x) + 1) + ' 展台</span> '
      : '';
    var head =
      '<h2>巡游</h2>' +
      '<div class="study-meta"><span>巡游中 · ' + esc(l.title.replace(/（.*?）/, '')) +
      ' · 第 ' + (session.idx + 1) + '/' + session.queue.length + ' 站</span>' +
      '<span>认识 ' + session.good + ' · 模糊 ' + session.bad + '</span></div>' +
      minimapHTML() +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>';
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

  function startSession(listId) {
    var l = LIST[listId];
    if (!l) return;
    var k = known();
    var fresh = [];
    var review = [];
    l.words.forEach(function (x) {
      if (k[l.id + '/' + x.w]) review.push(x.w); else fresh.push(x.w);
    });
    var queue = fresh.slice(0, 10);
    if (queue.length < 10 && review.length) {
      queue = fresh.concat(review).slice(0, 10);
    }
    session = { listId: listId, queue: queue, idx: 0, good: 0, bad: 0, revealed: false };
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
    } else if (name === 'study') {
      view.innerHTML = studyScreen();
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
    var pnum = { home: 1, categories: 2, word: 2, tables: 3, study: 4, favorites: 5 }[name] || 1;
    var pn = $('pageNum');
    if (pn) pn.textContent = '— ' + pnum + ' —';
    window.scrollTo(0, 0);

    var q = $('q');
    if (q) {
      q.addEventListener('input', function () { renderResults(q.value); });
      q.focus();
    }
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
    } else if (act === 'start-study') {
      startSession(el.getAttribute('data-list'));
      route();
    } else if (act === 'study-home') {
      session = null;
      route();
    } else if (act === 'reveal') {
      session.revealed = true;
      route();
    } else if (act === 'good' || act === 'blur') {
      var k = known();
      var sref = session.listId + '/' + session.queue[session.idx];
      if (act === 'good') { k[sref] = 1; session.good++; }
      else { delete k[sref]; session.bad++; }
      lsSet('hedgehog:known', k);
      session.idx++;
      session.revealed = false;
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

  // 本会话已解锁过则直接进入（关掉标签页后需重新输密码）
  // 版本守卫：旧结构缓存（如无 tables 的 v2）自动作废，强制重新解密
  try {
    var cached = sessionStorage.getItem('hedgehog:data');
    if (cached) {
      var cd = JSON.parse(cached);
      if (cd && cd.version >= 4 && cd.tables && cd.tables.length) {
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
