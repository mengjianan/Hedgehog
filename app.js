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

  // ---------- 视图：首页 / 搜索 ----------
  function viewHome() {
    var k = Object.keys(known()).length;
    return (
      '<div class="hero">' +
      '<img class="sticker hero-sticker" src="icons/sticker-hog.svg" alt="" />' +
      '<h2>用语感学词，不死背中文</h2>' +
      '<p class="sub">英语 · 韩语 · 日语，先建立母语者的直觉</p>' +
      '<div class="search-row"><input id="q" type="search" placeholder="三语通查：abolish / 마음 / 環境" autocomplete="off" /></div>' +
      '<div class="stats">' +
      '<span><b>' + ALL.length + '</b>词库</span>' +
      '<span><b>' + LISTS.length + '</b>词表</span>' +
      '<span><b>' + k + '</b>已掌握</span>' +
      '<span><b>' + favs().length + '</b>收藏</span>' +
      '</div></div>' +
      '<div class="results" id="results"></div>' +
      '<p class="footnote">Hedgehog · 三语语感词库 · 词条内容全部原创</p>'
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
    var wordCards = LISTS.map(function (l) {
      var pend = pendingCount(l);
      return (
        '<a class="card cat-card lang-' + l.lang + '" href="#/categories/' + l.id + '">' +
        '<span><b>' + esc(l.title) + '</b><small>' +
        (LANG_NAME[l.lang] || l.lang) + ' · ' + l.words.length + ' 词 · 待学 ' + pend +
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
      (tableCards ? '<h2 class="group-h">基础表</h2>' + tableCards : '')
    );
  }

  function viewList(listId) {
    var l = LIST[listId];
    if (!l) return viewCategories();
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

  function viewWord(listId, w) {
    var e = IDX[listId + '/' + w];
    if (!e) {
      return (
        '<a class="back-link" href="#/categories">← 词库</a>' +
        '<div class="empty"><div class="big">🧐</div>词库里还没有「' + esc(w) + '」</div>'
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
    return (
      '<a class="back-link" href="#/categories/' + l.id + '">← ' + esc(l.title) + '</a>' +
      '<div class="card lang-card lang-' + l.lang + '">' +
      '<div class="word-head">' +
      '<h2>' + esc(x.w) + '</h2>' +
      '<span class="ipa">' + esc(x.pron) + '</span>' +
      '<span class="pos">' + esc(x.pos) + '</span>' +
      '<em class="lang-tag lang-' + l.lang + '">' + (LANG_NAME[l.lang] || l.lang) + '</em>' +
      '<button class="icon-btn" data-act="speak" data-ref="' + esc(e.ref) + '" title="发音">🔊</button>' +
      '<button class="icon-btn star' + (fav ? ' on' : '') + '" data-act="star" data-ref="' + esc(e.ref) + '" title="收藏">★</button>' +
      '</div>' +
      '<p class="zh-line">' + esc(x.zh) + '</p>' +
      '<div class="entry-section"><span class="entry-label">词感</span><p>' + esc(x.sense) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">中式误区</span><p class="trap">' + esc(x.trap) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">高频搭配</span><div class="collo">' + collo + '</div></div>' +
      '<div class="entry-section"><span class="entry-label">例句</span><div class="ex-list">' + ex + '</div></div>' +
      '</div>'
    );
  }

  // ---------- 视图：背词 ----------
  function studyScreen() {
    if (!session) {
      var picks = LISTS.map(function (l) {
        var pend = pendingCount(l);
        return (
          '<button class="word-chip" data-act="start-study" data-list="' + l.id + '">' +
          '<b>' + esc(l.title.replace(/（.*?）/, '')) + '</b>' +
          '<small>' + (pend ? '待学 ' + pend + ' 词' : '已全会 · 可复习') + '</small></button>'
        );
      }).join('');
      return (
        '<h2>背词</h2>' +
        '<p class="sub">每轮 10 词，选一个词库开始 · 进度存在本机浏览器</p>' +
        '<div class="wordlist">' + picks + '</div>'
      );
    }
    if (session.idx >= session.queue.length) {
      return (
        '<h2>背词</h2>' +
        '<div class="card study-done">' +
        '<img class="sticker" src="icons/sticker-hog.svg" alt="" />' +
        '<div class="stamp">完成</div>' +
        '<p>本轮完成：认识 <b>' + session.good + '</b> · 模糊 <b>' + session.bad + '</b></p>' +
        '<div class="study-actions">' +
        '<button class="btn" data-act="study-home">再背一轮</button>' +
        '<a class="btn ghost" href="#/home" style="text-align:center">回首页</a>' +
        '</div></div>'
      );
    }
    var l = LIST[session.listId];
    var w = session.queue[session.idx];
    var ref = session.listId + '/' + w;
    var e = IDX[ref];
    var x = e.x;
    var pct = Math.round((session.idx / session.queue.length) * 100);
    var head =
      '<h2>背词</h2>' +
      '<div class="study-meta"><span>' + esc(l.title.replace(/（.*?）/, '')) + ' · ' +
      (session.idx + 1) + ' / ' + session.queue.length + '</span>' +
      '<span>认识 ' + session.good + ' · 模糊 ' + session.bad + '</span></div>' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>';
    if (!session.revealed) {
      return (
        head +
        '<div class="card study-card">' +
        '<div class="sw">' + esc(x.w) + '</div>' +
        '<div class="sipa">' + esc(x.pron) + '</div>' +
        '<div class="study-actions">' +
        '<button class="icon-btn" data-act="speak" data-ref="' + esc(ref) + '">🔊</button>' +
        '</div>' +
        '<button class="btn" data-act="reveal" style="margin-top:14px">显示词感</button>' +
        '</div>'
      );
    }
    var collo = (x.collo || []).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
    return (
      head +
      '<div class="card study-card">' +
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

  // 本会话已解锁过则直接进入（关掉标签页后需重新输密码）
  try {
    var cached = sessionStorage.getItem('hedgehog:data');
    if (cached) { setData(JSON.parse(cached)); openApp(); }
  } catch (e) {}
})();
