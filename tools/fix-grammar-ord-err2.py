# -*- coding: utf-8 -*-
"""补齐最后3个缺失点的 ord/err + 修 ～のに 例句的 quality 笔误。"""
import json

p = 'src/grammar-ja.json'
d = json.load(open(p, encoding='utf-8'))

fix = {
 '～こと（形式名詞）': {
   'ord': ['毎日', '運動する', 'こと', 'が大切です'],
   'err': {'wrong': '毎日運動することが大切です', 'fixes': '毎日運動することが大切です'}},
 '自謙語II（申し上げる・参る・拝見）': {
   'ord': ['明日', 'お伺い', 'いたし', 'ます'],
   'err': {'wrong': '明日お邪魔いたします', 'fixes': '明日お伺いいたします'}},
 '～ながら（一边…一边）': {
   'ord': ['音楽を', '聞きながら、', '勉強', 'します'],
   'err': {'wrong': '音楽を聞きがつ、勉強します', 'fixes': '音楽を聞きながら、勉強します'}},
}

n = 0
for room in d['rooms']:
    for pt in room['points']:
        f = fix.get(pt['t'])
        if not f:
            continue
        # ～こと 的 err 自相等——换成真错误
        if pt['t'] == '～こと（形式名詞）':
            f = {'ord': f['ord'], 'err': {'wrong': '毎日運動することが大切かったです', 'fixes': '毎日運動することが大切です'}}
        if not pt.get('ord') or len(pt.get('ord') or []) != 4:
            pt['ord'] = f['ord']; n += 1
        e = pt.get('err')
        if not e or not e.get('wrong') or e.get('wrong') == e.get('fixes'):
            pt['err'] = f['err']; n += 1
        # 修 ～のに 例句英文笔误（quality → 品質）
        for ex in pt.get('ex', []):
            if 'quality' in ex.get('en', ''):
                ex['en'] = '安くても、品質が悪いのに、買わないほうがいい。'

json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('done', n)
