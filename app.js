/* Hedgehog 语感词库 — 纯原生单文件应用（无框架、无构建、无外部请求） */
(function () {
  'use strict';

  var DATA = null; // 解密后的词库
  var IDX = {}; // 词 -> 词条
  var session = null; // 当前背词轮次

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
  function isFav(w) { return favs().indexOf(w) !== -1; }

  function toggleFav(w) {
    var list = favs();
    var i = list.indexOf(w);
    if (i === -1) list.push(w); else list.splice(i, 1);
    lsSet('hedgehog:favs', list);
    return i === -1;
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
    IDX = {};
    DATA.words.forEach(function (x) { IDX[x.w] = x; });
  }

  function speak(w) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(w);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  // ---------- 视图 ----------
  function viewHome() {
    var k = Object.keys(known()).length;
    return (
      '<div class="hero">' +
      '<h2>用语感学词，不死背中文</h2>' +
      '<p class="sub">先建立母语者对这个词的直觉，再谈释义</p>' +
      '<div class="search-row"><input id="q" type="search" placeholder="查一个词，如 inhibit / accumulate" autocomplete="off" /></div>' +
      '<div class="stats">' +
      '<span><b>' + DATA.words.length + '</b>词库</span>' +
      '<span><b>' + k + '</b>已掌握</span>' +
      '<span><b>' + favs().length + '</b>收藏</span>' +
      '</div></div>' +
      '<div class="results" id="results"></div>' +
      '<p class="footnote">Hedgehog · 自用语感词库 · 词条内容全部原创</p>'
    );
  }

  function renderResults(q) {
    var box = $('results');
    if (!box) return;
    q = q.trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var hits = DATA.words.filter(function (x) {
      return (
        x.w.toLowerCase().indexOf(q) !== -1 ||
        x.zh.indexOf(q) !== -1 ||
        x.sense.toLowerCase().indexOf(q) !== -1
      );
    });
    if (!hits.length) {
      box.innerHTML = '<div class="empty">没找到「' + esc(q) + '」</div>';
      return;
    }
    box.innerHTML = hits
      .map(function (x) {
        return (
          '<a class="result" href="#/word/' + encodeURIComponent(x.w) + '">' +
          '<b>' + esc(x.w) + '</b><i>' + esc(x.ipa) + '</i>' +
          '<span>' + esc(x.zh) + '</span></a>'
        );
      })
      .join('');
  }

  function viewCategories() {
    return (
      '<h2>词库</h2>' +
      '<a class="card cat-card" href="#/categories/ielts-core">' +
      '<span><b>雅思核心词（首批）</b><small>IELTS Core · ' + DATA.words.length + ' 词 · 词感全原创</small></span>' +
      '<span>→</span></a>' +
      '<div class="card cat-card" style="margin-top:12px;opacity:.65">' +
      '<span><b>TOPIK 韩语词库</b><small>规划中 · 第二批</small></span><span>Coming</span></div>' +
      '<div class="card cat-card" style="margin-top:12px;opacity:.65">' +
      '<span><b>JLPT 日语词库</b><small>规划中 · 第三批</small></span><span>Coming</span></div>'
    );
  }

  function viewList(cat) {
    var chips = DATA.words
      .map(function (x) {
        return (
          '<a class="word-chip" href="#/word/' + encodeURIComponent(x.w) + '">' +
          '<b>' + esc(x.w) + '</b><small>' + esc(x.zh) + '</small></a>'
        );
      })
      .join('');
    return (
      '<a class="back-link" href="#/categories">← 词库</a>' +
      '<h2>' + esc(DATA.title || '词表') + '</h2>' +
      '<div class="wordlist">' + chips + '</div>'
    );
  }

  function viewWord(w) {
    var x = IDX[w];
    if (!x) {
      return (
        '<a class="back-link" href="#/home">← 返回</a>' +
        '<div class="empty"><div class="big">🧐</div>词库里还没有「' + esc(w) + '」</div>'
      );
    }
    var fav = isFav(x.w);
    var ex = (x.ex || [])
      .map(function (e) {
        return '<div class="ex"><div class="en">' + esc(e.en) + '</div><div class="zh">' + esc(e.zh) + '</div></div>';
      })
      .join('');
    var collo = (x.collo || [])
      .map(function (c) { return '<span>' + esc(c) + '</span>'; })
      .join('');
    return (
      '<a class="back-link" href="#/categories">← 词库</a>' +
      '<div class="card">' +
      '<div class="word-head">' +
      '<h2>' + esc(x.w) + '</h2>' +
      '<span class="ipa">' + esc(x.ipa) + '</span>' +
      '<span class="pos">' + esc(x.pos) + '</span>' +
      '<button class="icon-btn" data-act="speak" data-w="' + esc(x.w) + '" title="发音">🔊</button>' +
      '<button class="icon-btn star' + (fav ? ' on' : '') + '" data-act="star" data-w="' + esc(x.w) + '" title="收藏">★</button>' +
      '</div>' +
      '<p class="zh-line">' + esc(x.zh) + '</p>' +
      '<div class="entry-section"><span class="entry-label">词感</span><p>' + esc(x.sense) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">中式误区</span><p class="trap">' + esc(x.trap) + '</p></div>' +
      '<div class="entry-section"><span class="entry-label">高频搭配</span><div class="collo">' + collo + '</div></div>' +
      '<div class="entry-section"><span class="entry-label">例句</span><div class="ex-list">' + ex + '</div></div>' +
      '</div>'
    );
  }

  // ---------- 背词 ----------
  function startSession() {
    var k = known();
    var fresh = [];
    var review = [];
    DATA.words.forEach(function (x) {
      if (k[x.w]) review.push(x.w); else fresh.push(x.w);
    });
    var queue = (fresh.length ? fresh : review).slice(0, 10);
    if (fresh.length < 10 && review.length) {
      queue = fresh.concat(review).slice(0, 10);
    }
    session = { queue: queue, idx: 0, good: 0, bad: 0, revealed: false };
  }

  function studyScreen() {
    if (!session) {
      var k = Object.keys(known()).length;
      var left = DATA.words.length - k;
      return (
        '<h2>背词</h2>' +
        '<div class="card study-card">' +
        '<p style="font-size:17px">本轮 10 词 · 还有 <b style="color:var(--green)">' + (left || DATA.words.length) + '</b> 词待学</p>' +
        '<p class="sub">认识 / 模糊 自评，进度存在本机浏览器里</p>' +
        '<button class="btn" data-act="start-study">开始本轮</button>' +
        '</div>'
      );
    }
    if (session.idx >= session.queue.length) {
      var html =
        '<h2>背词</h2>' +
        '<div class="card study-done">' +
        '<div class="big">🎉</div>' +
        '<p>本轮完成：认识 <b>' + session.good + '</b> · 模糊 <b>' + session.bad + '</b></p>' +
        '<div class="study-actions">' +
        '<button class="btn" data-act="start-study">再来一轮</button>' +
        '<a class="btn ghost" href="#/home" style="text-align:center">回首页</a>' +
        '</div></div>';
      return html;
    }
    var w = session.queue[session.idx];
    var x = IDX[w];
    var pct = Math.round((session.idx / session.queue.length) * 100);
    var head =
      '<h2>背词</h2>' +
      '<div class="study-meta"><span>' + (session.idx + 1) + ' / ' + session.queue.length + '</span>' +
      '<span>认识 ' + session.good + ' · 模糊 ' + session.bad + '</span></div>' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>';
    if (!session.revealed) {
      return (
        head +
        '<div class="card study-card">' +
        '<div class="sw">' + esc(w) + '</div>' +
        '<div class="sipa">' + esc(x.ipa) + '</div>' +
        '<div class="study-actions">' +
        '<button class="icon-btn" data-act="speak" data-w="' + esc(w) + '">🔊</button>' +
        '</div>' +
        '<button class="btn" data-act="reveal" style="margin-top:14px">显示词感</button>' +
        '</div>'
      );
    }
    var collo = (x.collo || []).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
    return (
      head +
      '<div class="card study-card">' +
      '<div class="sw">' + esc(w) + '</div>' +
      '<div class="sipa">' + esc(x.ipa) + ' · ' + esc(x.zh) + '</div>' +
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

  function viewFavorites() {
    var list = favs().filter(function (w) { return IDX[w]; });
    if (!list.length) {
      return (
        '<h2>我的收藏</h2>' +
        '<div class="empty"><div class="big">☆</div>还没有收藏。在词页点 ★ 收藏</div>'
      );
    }
    var chips = list
      .map(function (w) {
        var x = IDX[w];
        return (
          '<a class="word-chip" href="#/word/' + encodeURIComponent(w) + '">' +
          '<b>' + esc(x.w) + '</b><small>' + esc(x.zh) + '</small></a>'
        );
      })
      .join('');
    return '<h2>我的收藏</h2><div class="wordlist">' + chips + '</div>';
  }

  // ---------- 路由 ----------
  function route() {
    if (!DATA) return;
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'home';
    var arg = parts.length > 1 ? decodeURIComponent(parts.slice(1).join('/')) : '';
    var view = $('view');
    if (name === 'word') view.innerHTML = viewWord(arg);
    else if (name === 'categories') view.innerHTML = arg ? viewList(arg) : viewCategories();
    else if (name === 'study') view.innerHTML = studyScreen();
    else if (name === 'favorites') view.innerHTML = viewFavorites();
    else { name = 'home'; view.innerHTML = viewHome(); }

    document.querySelectorAll('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === name);
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
    var w = el.getAttribute('data-w');

    if (act === 'speak') speak(w);
    else if (act === 'star') {
      var on = toggleFav(w);
      el.classList.toggle('on', on);
    } else if (act === 'start-study') { startSession(); route(); }
    else if (act === 'reveal') { session.revealed = true; route(); }
    else if (act === 'good' || act === 'blur') {
      var k = known();
      if (act === 'good') { k[session.queue[session.idx]] = 1; session.good++; }
      else { delete k[session.queue[session.idx]]; session.bad++; }
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
      if (!data || !data.words || !data.words.length) throw new Error('empty');
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
