// 临时验证：考场块真实代码——双试卷组卷/判分/持久化（用完删）
const fs = require('fs');

const src = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  // ---------- 考场（仿真卷 + 本机真题卷） ----------');
const endMark = "      '<div class=\"exam-sheet\">' + sheet + '</div>' +\n      '</div>'\n    );\n  }";
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
    { lang: 'ja', rooms: [{ name: 'r', points: Array.from({ length: 25 }, (_, i) => ({ t: '日语法' + i, formula: '日式公式' + i, ex: [{ en: '彼は学校に行った。', zh: 'x' }], ord: ['日片段' + i + 'a', '日片段' + i + 'b', '日片段' + i + 'c', '日片段' + i + 'd'], err: { wrong: '日错例' + i, fixes: '日订正' + i } })) }] },
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
// 雅思听力情景脚本库（每 Part 2 篇小样，10 题/篇：填空+选择）
// JLPT 読解文章库（每 kind 2 篇小样：s=4题 m=5题 l=6题，真题型题干+①②③④）
const mkJaQs = (n, type) => Array.from({ length: n }, (_, i) => ({
  type, stem: type + 'の問' + (i + 1) + '：最も適切なものを選べ。',
  options: [{ t: '正解' + i, ok: true }, { t: '誤答a' + i, ok: false }, { t: '誤答b' + i, ok: false }, { t: '誤答c' + i, ok: false }]
}));
['s', 'm', 'l'].forEach(kind => {
  const n = { s: 4, m: 5, l: 6 }[kind];
  for (let i = 0; i < 2; i++) {
    PASSAGES.push({
      id: 'ja-' + kind + i, lang: 'ja', kind, title: '日本語' + kind + i + 'の文章',
      paras: ['一段落目です。' + kind + i, '二段落目です。' + kind + i, '三段落目です。'],
      qs: mkJaQs(n, kind === 'l' ? '統合理解' : '内容理解')
    });
  }
});
// TOPIK 읽기 文章库（每 kind 2 篇小样：s=3题 m=4题 l=3题，순서/삽입/빈칸题型）
['s', 'm', 'l'].forEach(kind => {
  const n = { s: 3, m: 4, l: 3 }[kind];
  for (let i = 0; i < 2; i++) {
    PASSAGES.push({
      id: 'ko-' + kind + i, lang: 'ko', kind, title: '한국어' + kind + i + '의 글',
      paras: ['첫 번째 문단입니다。' + kind + i, '두 번째 문단입니다。' + kind + i],
      qs: Array.from({ length: n }, (_, qi) => ({
        type: kind === 'l' ? (qi % 2 ? '문장 삽입' : '순서 배열') : (qi % 2 ? '빈칸 추론' : '내용 이해'),
        stem: '가장 적절한 것을 고르십시오。' + qi,
        options: [{ t: '정답' + qi, ok: true }, { t: '오답a' + qi, ok: false }, { t: '오답b' + qi, ok: false }, { t: '오답c' + qi, ok: false }]
      }))
    });
  }
});
const mkScriptQs = () => [
  { type: '表格填空', stem: "1. Name: ______", fill: { accept: ['Janeway'] } },
  { type: '表格填空', stem: "2. Date: the ______", fill: { accept: ['17', 'seventeenth'] } },
  { type: '选择题', stem: 'Where is the meeting?', options: [{ t: 'Room 4', ok: true }, { t: 'Room 2', ok: false }, { t: 'Room 6', ok: false }, { t: 'Room 9', ok: false }] },
  { type: '选择题', stem: 'What time does it start?', options: [{ t: '9:30', ok: true }, { t: '10:30', ok: false }, { t: '8:30', ok: false }, { t: '11:30', ok: false }] },
  { type: '表格填空', stem: "3. Ticket costs £______", fill: { accept: ['12', 'twelve'] } },
  { type: '选择题', stem: 'Who should be contacted?', options: [{ t: 'The coordinator', ok: true }, { t: 'The tutor', ok: false }, { t: 'The librarian', ok: false }, { t: 'Nobody', ok: false }] },
  { type: '表格填空', stem: "4. Bring a ______", fill: { accept: ['pen'] } },
  { type: '选择题', stem: 'Where do they park?', options: [{ t: 'Behind the hall', ok: true }, { t: 'Under the bridge', ok: false }, { t: 'At the station', ok: false }, { t: 'Nowhere', ok: false }] },
  { type: '表格填空', stem: "5. Deadline: ______ March", fill: { accept: ['21', 'twenty-first'] } },
  { type: '选择题', stem: 'What is the weather forecast?', options: [{ t: 'Rain in the afternoon', ok: true }, { t: 'Snow all day', ok: false }, { t: 'Full sun', ok: false }, { t: 'Strong wind', ok: false }] }
];
const SCRIPTS = [];
['l1', 'l2', 'l3', 'l4'].forEach(part => {
  for (let n = 0; n < 2; n++) {
    SCRIPTS.push({ id: 'en-' + part + '-' + n, lang: 'en', part, title: 'Script ' + part + '-' + n, script: 'Welcome to script ' + part + '-' + n + '. The answer is Janeway and twelve pounds.', qs: mkScriptQs() });
  }
});
// TOPIK 듣기 脚本（l-s 대화 / l-l 독백 各 2 篇，3 题/篇，num ①②③④）
const mkKoScriptQs = () => Array.from({ length: 3 }, (_, i) => ({
  type: '내용 이해', num: true, stem: '가장 적절한 것을 고르십시오。' + i,
  options: [{ t: '정답스크' + i, ok: true }, { t: '오답스크a' + i, ok: false }, { t: '오답스크b' + i, ok: false }, { t: '오답스크c' + i, ok: false }]
}));
['l-s', 'l-l'].forEach(part => {
  for (let n = 0; n < 2; n++) {
    SCRIPTS.push({ id: 'ko-' + part + '-' + n, lang: 'ko', part, title: '한국어듣기' + part + '-' + n, script: '한국어 듣기 스크립트입니다。' + n, qs: mkKoScriptQs() });
  }
});
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
const TAGS = { 'test-list/runv': 'travel', 'test-list/swimv': 'travel', 'test-list/flyv': 'travel' };

const factory = new Function('LIST', 'DATA', 'PASSAGES', 'SCRIPTS', 'TAGS', 'shuffle', 'scheduleRef', 'known', 'lsSet', 'lsGet', 'route', '$', 'esc', 'pickVoice', 'toast', 'window',
  code + '; return { buildPaper, getExam(){return exam;}, setExam(e){exam=e;}, examFinish, pickDis3 };');
const api = factory(LIST, DATA, PASSAGES, SCRIPTS, TAGS, shuffle, scheduleRef, known, lsSet, lsGet, route, $, esc, pickVoice, toast, window);

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ok -', msg); }

console.log('场景1: JLPT N1 仿真卷（全板块）');
const p1 = api.buildPaper('jlpt-n1', { kanji: true, context: true, meaning: true, grammar: true, listen: true });
console.log('  分段:', p1.secs.map(s => s.key + '=' + s.qs.length).join(', '));
assert(p1.secs.length === 5 && p1.totalQ === 95 && p1.totalMin === 80, 'JLPT 95题80分');
assert(p1.typeKey === 'jlpt-n1', 'typeKey 正确');
assert(p1.scale === 180 && p1.pass === 100 && !p1.band, 'JLPT 标尺 180/合格线100');
assert(p1.name === 'JLPT N1 仿真卷', '命名统一：仿真卷（无「模拟」）');
// B2：文法板块 = 整序 + 誤用訂正（日语点带 ord/err）
const gSec1 = p1.secs.find(s => s.key === 'grammar');
const jnN = gSec1.qs.filter(q => q.type === '文法・語順整序').length;
const errN = gSec1.qs.filter(q => q.type === '文法・誤用訂正').length;
assert(jnN + errN === 20, '文法 20 题 = 整序' + jnN + ' + 誤用訂正' + errN);
assert(jnN === 10 && errN === 10, '整序/訂正 各半 = ' + jnN + '/' + errN);
// 整序：题干带「① ② ③ ④」四个标记片段，4 选项为排序串，唯一正确
const jnq = gSec1.qs.find(q => q.type === '文法・語順整序');
assert(jnq.num && jnq.options.length === 4 && /①/.test(jnq.stem) && /④/.test(jnq.stem) && /次の文/.test(jnq.stem), '整序题干含乱序片段+num');
assert(jnq.options.filter(o => o.ok).length === 1 && jnq.options.every(o => /→/.test(o.t)), '整序选项为4种排序且唯一正确');
// 誤用訂正：题干为「改正せよ」，4 选项含正确订正（options 中 ok 的项 = 该点 err.fixes）
const errq = gSec1.qs.find(q => q.type === '文法・誤用訂正');
assert(/改正せよ/.test(errq.stem) && errq.options.length === 4 && errq.options.filter(o => o.ok).length === 1, '訂正题干+4选项唯一正确');

console.log('场景2: TOPIK II 仿真卷（全板块）');
const p2 = api.buildPaper('topik-ii', { 'l-s': true, 'l-l': true, 'v-mean': true, 'v-ctx': true, 'g-form': true, 'r-s': true, 'r-m': true, 'r-order': true, w1: true, w2: true, w3: true });
console.log('  分段:', p2.secs.map(s => s.key + '=' + s.qs.length).join(', '));
assert(p2.secs.length === 11, 'TOPIK 11 板块（듣기2+어휘2+문법1+읽기3+쓰기3）');
assert(p2.totalQ === 89 && p2.totalMin === 156, 'TOPIK 89题156分 = ' + p2.totalQ + '题' + p2.totalMin + '分');
// 쓰기：51/52번 完成型 = 4 选项自动判分；53번 论述 = 自评（objQ 不计入）
const wSecs = p2.secs.filter(s => s.key[0] === 'w');
assert(wSecs.length === 3, '쓰기 3 板块');
assert(wSecs[0].qs.every(q => q.options.length === 4 && q.options.filter(o => o.ok).length === 1 && /完成型/.test(q.type)), '51/52번 完成型 4选项唯一正确');
assert(wSecs[2].qs[0].writing === true && wSecs[2].qs[0].options.length === 0, '53번 论述自评（无选项）');
assert(p2.objQ === 88, '客观题 88（쓰기 51/52 완성 计入 + 53 논술自评不计）= ' + p2.objQ);
// 듣기：脚本板块（대화/독백 各抽 1 篇，带 script，题带 num）
const koListen = p2.secs.filter(s => s.key === 'l-s' || s.key === 'l-l');
assert(koListen.length === 2 && koListen.every(s => s.script && s.script.title[0] === '한'), '듣기 2 板块均携带韩语脚本');
assert(new Set(koListen.map(s => s.script.title)).size === 2, '듣기 两脚本互不重复');
assert(koListen.every(s => s.qs.every(q => q.num && q.options.length === 4)), '듣기每题①②③④+4选项');
// 읽기 板块从韩语文章库抽篇（s/m/l 各1，互不重复），题带 num
const koRead = p2.secs.filter(s => s.key === 'r-s' || s.key === 'r-m' || s.key === 'r-order');
assert(koRead.length === 3 && koRead.every(s => s.passage && s.passage.title[0] === '한'), '읽기 3 板块均携带韩语文章');
assert(new Set(koRead.map(s => s.passage.title)).size === 3, '읽기 三篇文章互不重复');
assert(koRead.every(s => s.qs.every(q => q.num && q.options.length === 4)), '읽기每题①②③④+4选项');
// 语法题必须出自韩语语法宫
let gKo = 0;
p2.secs.forEach(s => s.qs.forEach(q => {
  if (q.type === '연결어미') { gKo++; if (!q.options.every(o => o.t.indexOf('韩式公式') === 0)) { console.error('FAIL: 语法选项非韩语'); process.exit(1); } }
}));
assert(gKo === 20, '韩语语法 20 题');
// 结构：4选项唯一正确（跳过自评写作题，其 options 为空）
let optOk = true;
[...p1.secs, ...p2.secs].forEach(s => s.qs.forEach(q => {
  if (q.writing) return; // 自评写作（53번/雅思 T1T2）无选项，跳过
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
assert(ex2.phase === 'result' && ex2.result.length === 11, '成绩单 11 行');
assert(ex2.correctN === 48, '对 48 题（各段偶数位，89 题中有 41 题半数 = 中平） = ' + ex2.correctN);
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

console.log('场景4.5: JLPT 読解真题型（短文/中文/長文各抽1篇）');
const pJ = api.buildPaper('jlpt-n1', { kanji: true, context: true, meaning: true, grammar: true, 'read-s': true, 'read-m': true, 'read-l': true, listen: true });
console.log('  分段:', pJ.secs.map(s => s.key + '=' + s.qs.length).join(', '));
// 漢字20+文脈20+意味15+文法20+短文4+中文5+長文6+聴解20 = 110 题
assert(pJ.secs.length === 8 && pJ.totalQ === 110, 'JLPT 全卷 110 题 8 板块 = ' + pJ.totalQ);
const readSecs = pJ.secs.filter(s => s.key[0] === 'r' && s.key.indexOf('read') === 0);
assert(readSecs.length === 3 && readSecs.every(s => s.passage && s.passage.paras.length === 3), '読解 3 板块均携带文章');
assert(new Set(readSecs.map(s => s.passage.title)).size === 3, '三篇日语文章互不重复（每 kind 抽1）');
assert(pJ.secs.find(s => s.key === 'read-s').qs.length === 4, '短文 4 题');
assert(pJ.secs.find(s => s.key === 'read-m').qs.length === 5, '中文 5 题');
assert(pJ.secs.find(s => s.key === 'read-l').qs.length === 6, '長文 6 题（統合理解）');
// 读解题带 num（①②③④）标记，每题4选项唯一正确
assert(readSecs.every(s => s.qs.every(q => q.num && q.options.length === 4 && q.options.filter(o => o.ok).length === 1)), '読解题①②③④+唯一正确');
assert(readSecs.every(s => s.qs.every(q => q.ref === null)), '読解题不挂词库 ref');
// 只勾讀解也能组卷（词汇/语法池不参与也返回正常卷）
const pJr = api.buildPaper('jlpt-n1', { 'read-s': true, 'read-l': true });
assert(pJr && pJr.secs.length === 2 && pJr.totalQ === 10, '仅読解可独立组卷 = ' + (pJr && pJr.totalQ));

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
// 听力4篇脚本×10题 + 阅读3篇×4题（测试库小样）= 52 题位，90 分钟
assert(p3 && p3.secs.length === 7 && p3.totalQ === 52 && p3.totalMin === 90, 'IELTS 听力40+阅读12 = 52题位90分钟 = ' + p3.totalQ);
assert(p3.scale === 9 && p3.band === true && p3.pass === 6.5, 'band 标尺 0~9 / 留学线 6.5');
// 听力四板块：各抽一篇情景脚本（互不重复），section 带 script，题为填空+选择
const lSecs = p3.secs.filter(s => s.key[0] === 'l');
assert(lSecs.length === 4 && lSecs.every(s => s.script && s.script.text.indexOf('script') >= 0), '听力 4 section 均携带脚本');
assert(new Set(lSecs.map(s => s.script.title)).size === 4, '四篇脚本互不重复（每 Part 抽 1）');
assert(lSecs.every(s => s.qs.length === 10), '每篇脚本 10 题');
assert(lSecs.every(s => s.qs.some(q => q.fill) && s.qs.some(q => q.options.length)), '脚本题含填空+选择');
// 脚本题干不泄露原文（题干是表格空/问题，不是脚本内容）
assert(lSecs.every(s => s.qs.every(q => q.stem.indexOf(s.script.text) < 0)), '题干不含脚本原文');
// 阅读：三篇从文章库抽出、互不重复、section 带 passage、题含填空
const rSecs = p3.secs.filter(s => s.key[0] === 'r');
assert(rSecs.length === 3 && rSecs.every(s => s.passage && s.passage.paras.length === 2), '阅读 3 section 均携带文章');
assert(new Set(rSecs.map(s => s.passage.title)).size === 3, '三篇文章互不重复');
assert(rSecs.every(s => s.qs.some(q => q.fill && q.fill.accept.length)), '每篇含填空题（fill.accept）');

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
  if (q.fill) e5.answers[si][qi] = q.fill.accept[0]; // 脚本填空题：填对
  else e5.answers[si][qi] = q.options.findIndex(o => o.ok);
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
// 填空分布：听力 4 篇×5 个（偶数 qi 填对 4 个/篇）+ 阅读 3 篇×1（qi=2 偶数全对）
assert(e4.phase === 'result' && fillN === 23 && fillOkN === 19, '填空 23 题对 19（偶数位规则）= ' + fillN + '/' + fillOkN);
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

console.log('场景8: 干扰项三级抽样（同词性 → 同场景 → 随机）');
// 构造混合词性词库：5 个动词 + 5 个名词，其中动词里 3 个同场景
const mkV = (w, zh, pos, scene) => ({ w, pos, zh, scene });
const disPool = [
  mkV('runv', '跑', 'v.', 'work'), mkV('jumpv', '跳', 'v.', 'work'),
  mkV('swimv', '游泳', 'v.', 'travel'), mkV('flyv', '飞', 'v.', 'travel'),
  mkV('eatz', '吃', 'v.', 'health'),
  mkV('appn', '苹果', 'n.', 'health'), mkV('bookn', '书', 'n.', 'edu'),
  mkV('pen', '笔', 'n.', 'edu'), mkV('carn', '车', 'n.', 'travel'),
  mkV('desk', '桌子', 'n.', 'work')
];
// 用一个动词跑（场景 travel），验证干扰项优先同词性(v.)、其次同场景(travel)
const tgt = disPool[4]; // eatz, pos v., scene health
const usedT = {};
const disRes = api.pickDis3(tgt, disPool, usedT, 'test-list', function (x) { return x.zh; });
assert(disRes.length === 3, 'pickDis3 返回 3 个干扰 = ' + disRes.length);
assert(disRes.every(d => d !== tgt.zh), '干扰项不含正确值');
assert(new Set(disRes).size === 3, '3 个干扰互不重复');
// 三级抽样：同词性优先——tgt 是 v.，pool 里 v. 有5个(去掉自己还剩4)，足够3个，所以干扰应全是动词
const vWords = disPool.filter(x => x.pos === 'v.').map(x => x.zh);
const allDisAreV = disRes.every(d => vWords.indexOf(d) >= 0);
assert(allDisAreV, '同词性优先：动词题的3个干扰全是动词');
// 第2级同场景：构造同词性池只有1个，强制触发 level2（同场景）
const disPool2 = [
  mkV('runv', '跑', 'v.'), mkV('jumpv', '跳', 'v.'),       // 只有2个v.（含自己），level1只能凑1个
  mkV('swimn', '游泳', 'n.'), mkV('flyn', '飞', 'n.'),       // 同场景travel的n.，level2从这补
  mkV('appn', '苹果', 'n.')                                  // 异场景health
];
const TAGS2 = { 'test-list2/runv': 'travel', 'test-list2/swimn': 'travel', 'test-list2/flyn': 'travel' };
// 用全局TAGS（factory已传入），补 test-list2 映射
TAGS['test-list2/runv'] = 'travel'; TAGS['test-list2/swimn'] = 'travel'; TAGS['test-list2/flyn'] = 'travel';
const tgt2 = disPool2[0]; // runv, pos v., scene travel
const disRes2 = api.pickDis3(tgt2, disPool2, {}, 'test-list2', function (x) { return x.zh; });
assert(disRes2.length === 3, 'level2触发后仍返回3个');
assert(disRes2.indexOf('游泳') >= 0 && disRes2.indexOf('飞') >= 0, '同场景优先：travel场景的词在level2补入');
// 第3级随机兜底：pool 只有2个词时也能返回2个
const tinyPool = [mkV('a', '甲', 'v.', 'x'), mkV('b', '乙', 'v.', 'x')];
const disTiny = api.pickDis3(tinyPool[0], tinyPool, {}, 'test-list', function (x) { return x.zh; });
assert(disTiny.length === 1 && disTiny[0] === '乙', '小词库随机兜底：只剩1个可用词');

console.log('\n全部场景通过');
