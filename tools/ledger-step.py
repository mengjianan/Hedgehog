"""台账+日志机械更新：python tools/ledger-step.py <批次名> <新增词> <新增钩子> <总钩子> <进度行说明>
- 更新 wordbank-ledger.md 韩语进度行与批次表、追加变更记录
- 更新当日 docs/YYYY-MM-DD.md（无则创建）
"""
import sys, re, os, datetime
sys.stdout.reconfigure(encoding='utf-8')

batch, add_w, add_h, hooks_total, note = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
round_no = re.search(r'(\d+)$', batch).group(1)
today = datetime.date.today().isoformat()

# ---- 台账进度行（按 | 分格解析）----
p = 'docs/wordbank-ledger.md'
s = open(p, encoding='utf-8').read()
lines = s.split('\n')
found = False
for i, ln in enumerate(lines):
    if ln.startswith('| 韩语 TOPIK |'):
        cells = ln.split(' | ')
        prog = cells[3]
        prev_total = int(re.match(r'[\d,]+', prog).group(0).replace(',', ''))
        prev_hooks = int(re.search(r'钩子 ([\d,]+)', prog).group(1).replace(',', ''))
        new_total = prev_total + add_w
        left = -(-(4000 - new_total) // 240)
        cells[3] = f'{new_total:,}（ko-01~{round_no} 净增 {new_total - 30:,} + 钩子 {prev_hooks + add_h:,}）'
        cells[4] = f'ko-01~{round_no} ✅（{new_total / 40:.1f}%），剩 {left} 批'
        lines[i] = ' | '.join(cells)
        found = True
        break
if not found:
    sys.exit('未找到韩语进度行')
s = '\n'.join(lines)

# 批次表：在「待建」行前插入本批行
row = f'| {batch} | words-topik-{round_no}a~f.json + hooks-topik-{round_no}a~f.json | {note} | ✅ {today} |\n'
if re.search(r'\| ko-\d+~\d+ \| 待建', s):
    s = re.sub(r'(\| ko-\d+~\d+ \| 待建[^\n]*\n)', row + r'\1', s, count=1)
s = s.rstrip('\n') + f'\n- {today}：{batch} 入库（{add_w} 词），topik-core {new_total:,}（{new_total / 40:.1f}%）\n'
open(p, 'w', encoding='utf-8').write(s)

# ---- 当日日志 ----
lp = f'docs/{today}.md'
if not os.path.exists(lp):
    open(lp, 'w', encoding='utf-8').write(f'# {today} · hedgehog 项目日志\n\n## 今日进度\n')
ls = open(lp, encoding='utf-8').read()
sec = f'\n### 韩语 TOPIK 第 {round_no} 批入库（{batch}）\n\n- {note}\n- 四查（含钩子）PASS；topik-core → {new_total:,}（{new_total / 40:.1f}%）；钩子总数 {hooks_total:,}\n'
if '## 今日进度' in ls:
    ls = ls.replace('## 今日进度', '## 今日进度' + sec, 1)
else:
    ls = ls + sec
open(lp, 'w', encoding='utf-8').write(ls)
print(f'ledger+log updated: topik-core {prev_total} -> {new_total} ({new_total / 40:.1f}%), hooks {hooks_total}')
