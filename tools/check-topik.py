"""TOPIK 批次四查：python tools/check-topik.py <round>
自动发现 data/.seeds-ko<round>*.json 对应的 words/hooks 文件并全量校验。
"""
import json, sys, glob, os, re
sys.stdout.reconfigure(encoding='utf-8')

FIELDS = {'w', 'pron', 'pos', 'zh', 'sense', 'trap', 'collo', 'ex'}
POS_RE = re.compile(r'^(n|v|adj|adv|prep|conj|det|pron|intj|int|num|pref|prefix|suf|suff|sfx|pfx|dep\.n|prn)\.(/(n|v|adj|adv|prep|conj|det|pron|intj|int|num|pref|prefix|suf|suff|sfx|pfx|dep\.n|prn)\.)*$')
round_no = sys.argv[1]
seeds = sorted(glob.glob(f'data/.seeds-ko{round_no}*.json'))
if not seeds:
    print(f'no seeds for round {round_no}'); sys.exit(1)

errors, words, hook_total = [], [], 0
for sp in seeds:
    tag = re.search(rf'ko{round_no}(\w+)\.json$', sp).group(1)
    wf, hf = f'src/words-topik-{round_no}{tag}.json', f'src/hooks-topik-{round_no}{tag}.json'
    try:
        data = json.load(open(wf, encoding='utf-8'))
    except Exception as e:
        errors.append(f'{wf}: 解析失败 {e}'); continue
    if data.get('id') != 'topik-core' or data.get('lang') != 'ko':
        errors.append(f'{wf}: 顶层不符')
    ws = data.get('words', [])
    expect = [s['w'] for s in json.load(open(sp, encoding='utf-8'))]
    if len(ws) != len(expect):
        errors.append(f'{wf}: 条数 {len(ws)} != {len(expect)}')
    if [x.get('w', '') for x in ws] != expect:
        errors.append(f'{wf}: 与词包顺序/内容不符')
    for x in ws:
        w = x.get('w', '?'); words.append(w)
        lack = FIELDS - set(x.keys())
        if lack: errors.append(f'{w}: 缺字段 {lack}')
        extra = set(x.keys()) - FIELDS
        if extra: errors.append(f'{w}: 多余字段 {extra}')
        if not str(x.get('pron', '')).strip(): errors.append(f'{w}: pron 空')
        if len(str(x.get('sense', ''))) > 150: errors.append(f'{w}: sense >150')
        if len(str(x.get('trap', ''))) > 50: errors.append(f'{w}: trap >50')
        cl = x.get('collo', [])
        if not (isinstance(cl, list) and 2 <= len(cl) <= 3 and all(isinstance(c, str) and c for c in cl)):
            errors.append(f'{w}: collo 不是2-3条')
        ex = x.get('ex', [])
        if not (isinstance(ex, list) and 1 <= len(ex) <= 2 and all(set(e.keys()) == {'en', 'zh'} for e in ex)):
            errors.append(f'{w}: ex 结构错')
        if not POS_RE.match(str(x.get('pos', ''))):
            errors.append(f'{w}: pos 异常 {x.get("pos")}')
    try:
        hooks = json.load(open(hf, encoding='utf-8')).get('hooks', {})
    except Exception as e:
        errors.append(f'{hf}: 解析失败 {e}'); hooks = {}
    hook_total += len(hooks)
    refs = {f'topik-core/{w}' for w in expect}
    for k, v in hooks.items():
        if k not in refs: errors.append(f'{hf}: 钩子 key 无效 {k}')
        if not (isinstance(v.get('img'), str) and v['img'].strip() and isinstance(v.get('mn'), str) and v['mn'].strip()):
            errors.append(f'{hf}: 钩子 img/mn 空 {k}')
        if set(v.keys()) != {'img', 'mn'}: errors.append(f'{hf}: 钩子字段多余 {k}')

if len(words) != len(set(words)):
    errors.append('批内重复')
ban = set()
for f in glob.glob('src/words-ko*.json'):
    if f'topik-{round_no}' in f: continue
    d = json.load(open(f, encoding='utf-8'))
    items = d['words'] if isinstance(d, dict) and 'words' in d else d
    ban.update(x['w'] for x in items)
d = json.load(open('src/scenes-ko.json', encoding='utf-8'))
lists = d if isinstance(d, list) else d.get('lists', [])
for l in lists: ban.update(x['w'] for x in l.get('words', []))
cross = [w for w in words if w in ban]
if cross: errors.append(f'跨批重复 {len(cross)}: {cross[:10]}')

senses = []
for sp in seeds:
    tag = re.search(rf'ko{round_no}(\w+)\.json$', sp).group(1)
    senses += [len(x['sense']) for x in json.load(open(f'src/words-topik-{round_no}{tag}.json', encoding='utf-8'))['words']]
print(f'条目 {len(words)}, 唯一 {len(set(words))}, 跨批重复 {len(cross)}, 钩子 {hook_total}')
print(f'sense: min {min(senses)} / avg {sum(senses)//len(senses)} / max {max(senses)}')
if errors:
    print(f'ERRORS ({len(errors)}):')
    for e in errors[:30]: print(' ', e)
    sys.exit(1)
print('四查（含钩子）PASS')
