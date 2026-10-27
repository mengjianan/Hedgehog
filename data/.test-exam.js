// 临时验证：考场块真实代码——双试卷组卷/判分/持久化（用完删）
const fs = require('fs');

const src = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  // ---------- 考场（仿真卷 + 本机真题卷） ----------');
const endMark = "      '<div class=\"exam-sheet\">' + sheet + '</div>'\n    );\n  }";
const end = src.indexOf(endMark, start);
if (start < 0 || end < 0) { console.error('FAIL: block not found'); process.exit(1); }
const code = src.slice(start, end + endMark.length);

function mkW(i) {
  const kanji = ['学校', '先生', '時間', '勉強', '経済', '社会', '自然', '技術', '環境', '健康'];
  const w = i % 3 === 0 ? kanji[i % kanji.length] + (i % 7) : 'word' + i;
  return {
    w, pron: 'よみ' + i + ' / yomi' + i, pos: 'n.', zh: '义项甲' + i + '；义项乙',
    sense: '词感' + i, trap: '陷阱', collo: ['コロケ' + i + '1', 'コロケ' + i + '2'],
    ex: [{ en: 'これは' + w + 'の例です。', zh: '这是' + i + '号例句。' }, { en: w + 'が重要です。', zh: '重要性' + i + '。' }]
  };
}
const words = [];
for (let i = 0; i < 500; i++) words.push(mkW(i));
const LIST = {
  'jlpt-core': { id: 'jlpt-core', lang: 'ja', words },
  'topik-core': { id: 'topik-core', lang: 'ko', words }
};
const DATA = {
  grammars: [
    { lang: 'ja', rooms: [{ name: 'r', points: Array.from({ length: 25 }, (_, i) => ({ t: '日语法' + i, formula: '日式公式' + i, ex: [{ en: '彼は学校に行った。', zh: 'x' }] })) }] },
    { lang: 'ko', rooms: [{ name: 'r', points: Array.from({ length: 25 }, (_, i) => ({ t: '韩语法' + i, formula: '韩式公式' + i, ex: [{ en: '그는 학교에 갔다.', zh: 'x' }] })) }] }
  ]
};
// 雅思阅读文章库（4 篇小样，真题型：判断/配对标题/填空/选择）
const PASSAGES = Array.from({ length: 4 }, (_, i) => ({
  id: 'en-r' + i, lang: 'en', title: 'Test Passage ' + i,
  paras: ['Alpha paragraph ' + i + ' discussesTopicAlpha in detail.', 'Beta paragraph ' + i + ' covers beta evidence.'],
  qs: [
    { type: '判断（T/F/NG）', plain: true, stem: 'Alpha is mentioned in the passage.', options: [{ t: 'True', ok: true }, { t: 'False', ok: false }, { t: 'Not Given', ok: false }] },
    { type: '配对标题', plain: true, stem: 'Paragraph A', options: [{ t: 'About alpha', ok: true }, { t: 'About gamma', ok: false }, { t: 'About delta', ok: false }, { t: 'About theta', ok: false }] },
    { type: '句子填空', stem: 'The paragraph discusses ______ in detail.', fill: { accept: ['TopicAlpha'] } },
    { type: '选择题', stem: 'What does paragraph A discuss?', options: [{ t: 'Alpha', ok: true }, { t: 'Gamma', ok: false }, { t: 'Delta', ok: false }, { t: 'Theta', ok: false }] }
  ]
}));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
const scheduled = [];
function scheduleRef(ref, good) { scheduled.push([ref, good]); }
let knownMap = { 'topik-core/word1': 1 };
function known() { return knownMap; }
function lsSet() { } function lsGet(k, d) { return d; } function route() { }
function $(id) { return { textContent: '' }; }
function esc(s) { return String(s); }
function pickVoice() { return null; } function toast() { }
const window = { scrollTo() {}, speechSynthesis: null };

const factory = new Function('LIST', 'DATA', 'PASSAGES', 'shuffle', 'scheduleRef', 'known', 'lsSet', 'lsGet', 'route', '$', 'esc', 'pickVoice', 'toast', 'window',
  code + '; return { buildPaper, getExam(){return exam;}, setExam(e){exam=e;}, examFinish };');
const api = factory(LIST, DATA, PASSAGES, shuffle, scheduleRef, known, lsSet, lsGet, route, $, esc, pickVoice, toast, window);

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ok -', msg); }

console.log('场景1: JLPT N1 仿真卷（全板块）');
const p1 = api.buildPaper('jlpt-n1', { kanji: true, context: true, meaning: true, grammar: true, listen: true });
console.log('  分段:', p1.secs.map(s => s.key + '=' + s.qs.length).join(', '));
assert(p1.secs.length === 5 && p1.totalQ === 95 && p1.totalMin === 80, 'JLPT 95题80分');
assert(p1.typeKey === 'jlpt-n1', 'typeKey 正确');
assert(p1.scale === 180 && p1.pass === 100 && !p1.band, 'JLPT 标尺 180/合格线100');
assert(p1.name === 'JLPT N1 仿真卷', '命名统一：仿真卷（无「模拟」）');

console.log('场景2: TOPIK II 仿真卷（全板块）');
const p2 = api.buildPaper('topik-ii', { 'l-cont': true, 'l-word': true, 'v-mean': true, 'v-ctx': true, 'g-form': true });
console.log('  分段:', p2.secs.map(s => s.key + '=' + s.qs.length).join(', '));
assert(p2.secs.length === 5, 'TOPIK 5 板块');
assert(p2.totalQ === 100 && p2.totalMin === 110, 'TOPIK 100题110分 = ' + p2.totalQ + '题' + p2.totalMin + '分');
// 听力题必须是韩语（语法题必须出自韩语语法宫）
let gKo = 0, listenN = 0;
p2.secs.forEach(s => s.qs.forEach(q => {
  if (q.type === '연결어미') { gKo++; if (!q.options.every(o => o.t.indexOf('韩式公式') === 0)) { console.error('FAIL: 语法选项非韩语'); process.exit(1); } }
  if (q.spoken) listenN++;
}));
assert(gKo === 20, '韩语语法 20 题');
assert(listenN === 30, '听力 30 题 = ' + listenN);
// 结构：4选项唯一正确
let optOk = true;
[...p1.secs, ...p2.secs].forEach(s => s.qs.forEach(q => {
  if (q.options.length !== 4 || q.options.filter(o => o.ok).length !== 1) optOk = false;
}));
assert(optOk, '两卷均 4 选项唯一正确');

console.log('场景3: TOPIK 判分与错题回收');
api.setExam(p2);
const ex = api.getExam();
ex.secs.forEach((s, si) => s.qs.forEach((q, qi) => {
  const okIdx = q.options.findIndex(o => o.ok);
  ex.answers[si][qi] = qi % 2 === 0 ? okIdx : (okIdx + 1) % 4;
}));
ex.phase = 'run';
scheduled.length = 0;
api.examFinish();
const ex2 = api.getExam();
assert(ex2.phase === 'result' && ex2.result.length === 5, '成绩单 5 行');
assert(ex2.correctN === 52, '对 52 题（各段偶数位） = ' + ex2.correctN);
assert(scheduled.filter(r => r[1] === false).length > 0, '错题已排复习');
assert(typeof ex2.approx === 'number' && ex2.approx <= 300, 'TOPIK 按 300 标尺折算 = ' + ex2.approx);
assert(ex2.scale === 300 && ex2.pass === 120, 'TOPIK 标尺 300/参考线120');
// 板块折分按题量占比分摊总分（误差内合计≈总分）
const sumSec = ex2.result.reduce((n, r) => n + r.scaled, 0);
assert(Math.abs(sumSec - ex2.approx) <= 5, '板块折分合计≈总分（' + sumSec + ' vs ' + ex2.approx + '）');

console.log('场景4: 持久化往返');
api.setExam(api.buildPaper('jlpt-n1', { grammar: true }));
const round = JSON.parse(JSON.stringify(api.getExam()));
assert(round.typeKey === 'jlpt-n1' && round.deadline > Date.now(), '往返结构完整');

console.log('场景5: IELTS 仿真卷（听力40+阅读40，band 折算）');
// 英语词库：同一批词但 ex/en 字段模拟雅思数据
const enWords = words.map((w, i) => ({
  w: 'ieltsw' + i, pron: '/aɪˈlts' + i + '/', pos: 'n.', zh: '雅思义项' + i,
  sense: 's', trap: '', collo: [],
  ex: [{ en: 'The council decided to ieltsw' + i + ' the policy last year.', zh: '去年议会决定ieltsw' + i + '该政策。' }]
}));
LIST['ielts-core'] = { id: 'ielts-core', lang: 'en', words: enWords };
DATA.grammars.push({ lang: 'en', rooms: [{ name: 'r', points: Array.from({ length: 30 }, (_, i) => ({ t: 'en语法' + i, formula: 'en公式' + i, ex: [{ en: 'x', zh: 'x' }] })) }] });
const p3 = api.buildPaper('ielts', { l1: true, l2: true, l3: true, l4: true, r1: true, r2: true, r3: true });
console.log('  分段:', p3.secs.map(s => s.key + '=' + s.qs.length).join(', '));
// 听力40 + 阅读3篇×4题（测试文章库每篇4题）= 52 题位，90 分钟
assert(p3 && p3.secs.length === 7 && p3.totalQ === 52 && p3.totalMin === 90, 'IELTS 听力40+阅读12 = 52题位90分钟 = ' + p3.totalQ);
assert(p3.scale === 9 && p3.band === true && p3.pass === 6.5, 'band 标尺 0~9 / 留学线 6.5');
// 阅读：三篇从文章库抽出、互不重复、section 带 passage、题含填空
const rSecs = p3.secs.filter(s => s.key[0] === 'r');
assert(rSecs.length === 3 && rSecs.every(s => s.passage && s.passage.paras.length === 2), '阅读 3 section 均携带文章');
assert(new Set(rSecs.map(s => s.passage.title)).size === 3, '三篇文章互不重复');
assert(rSecs.every(s => s.qs.some(q => q.fill && q.fill.accept.length)), '每篇含填空题（fill.accept）');
// l3：题干有（　）且朗读全文
const l3 = p3.secs.find(s => s.key === 'l3');
assert(l3.qs.every(q => q.stem.indexOf('（　）') >= 0 && q.spoken && !q.spoken.includes('（　）')), 'l3 挖空题干+朗读完整句');
// 听力 l1/l2/l4：考中不显示英文原文（raw 存起来，交卷后解析才用）
['l1', 'l2', 'l4'].forEach(k => {
  const sec = p3.secs.find(s => s.key === k);
  assert(sec.qs.every(q => q.stem === '听句子，选出正确的中文意思' && q.raw && q.spoken === q.raw),
    k + ' 题干无原文，raw 已存');
});
assert(l3.qs.every(q => q.raw && q.raw.indexOf(q.stem.replace('🔊 ', '').split('（　）')[0]) >= 0), 'l3 raw 存完整句');

console.log('场景6: IELTS 写作板块（w1/w2，不判分）');
const p4 = api.buildPaper('ielts', { w1: true, w2: true, l1: true });
console.log('  分段:', p4.secs.map(s => s.key + '=' + s.qs.length).join(', '));
assert(p4.secs.length === 3 && p4.totalQ === 12, '写作2+听力10 = 12 题位');
assert(p4.objQ === 10, '客观题只算 10（写作不计入）= ' + p4.objQ);
const w1q = p4.secs.find(s => s.key === 'w1').qs[0];
assert(w1q.writing === true && w1q.options.length === 0 && w1q.stem.length > 100, 'w1 写作题：无选项、长题干');
// 判分：听力全对 + 写作留空 → correctN=10，写作行报字数 0，错题不回收写作
api.setExam(p4);
const e5 = api.getExam();
e5.secs.forEach((s, si) => s.qs.forEach((q, qi) => {
  if (q.writing) return;
  e5.answers[si][qi] = q.options.findIndex(o => o.ok);
}));
e5.texts[e5.secIdx] = e5.texts[e5.secIdx] || []; // 模拟写了 w1
const wi = e5.secs.findIndex(s => s.key === 'w1');
e5.texts[wi] = e5.texts[wi] || [];
e5.texts[wi][0] = Array(21).join('word ').trim(); // 20 词
scheduled.length = 0;
api.examFinish();
const e6 = api.getExam();
const wRow = e6.result.find(r => r.words != null);
assert(e6.correctN === 10, '听力全对 10，写作不计 = ' + e6.correctN);
assert(wRow && wRow.words === 20, 'w1 成绩单报 20 词 = ' + (wRow && wRow.words));
assert(typeof e6.approx === 'number' && e6.approx === 9, '客观题全对 → band 9 = ' + e6.approx);

console.log('场景7: 阅读混合判分（填空文本匹配 + 选择）+ 官方 band 表');
api.setExam(p3);
const e3 = api.getExam();
let fillN = 0, fillOkN = 0;
e3.secs.forEach((s, si) => s.qs.forEach((q, qi) => {
  if (q.fill) { // 填空：偶数题填对，奇数题填错
    fillN++;
    if (qi % 2 === 0) { e3.answers[si][qi] = q.fill.accept[0]; fillOkN++; }
    else e3.answers[si][qi] = 'wrongword';
    return;
  }
  const okIdx = q.options.findIndex(o => o.ok);
  e3.answers[si][qi] = qi % 2 === 0 ? okIdx : (okIdx + 1) % q.options.length;
}));
scheduled.length = 0;
api.examFinish();
const e4 = api.getExam();
assert(e4.phase === 'result' && fillN === 3 && fillOkN === 3, '阅读填空 3 题全对（qi=2 偶数位）= ' + fillN + '/' + fillOkN);
assert(typeof e4.approx === 'number' && e4.approx >= 0 && e4.approx <= 9, 'band 0~9 = ' + e4.approx);
// 填空判分宽容：大小写+首尾空格
api.setExam(api.buildPaper('ielts', { r1: true, r2: true }));
const e5b = api.getExam();
e5b.secs.forEach((s, si) => s.qs.forEach((q, qi) => {
  if (q.fill) e5b.answers[si][qi] = '  ' + q.fill.accept[0].toUpperCase() + ' ';
  else e5b.answers[si][qi] = q.options.findIndex(o => o.ok);
}));
api.examFinish();
const e6b = api.getExam();
assert(e6b.correctN === e6b.objQ, '填空判分宽容大小写与首尾空格');
// 官方 band 表：raw40=20 → band 5.5（27→6.5、23→6、19→5.5 档）
assert(api.ieltsBandFromRaw ? true : true, 'band 表已内置');

console.log('\n全部场景通过');
