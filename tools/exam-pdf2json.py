# -*- coding: utf-8 -*-
"""真题 PDF/TXT → 考场导入 JSON（只在本机运行，产物只存浏览器本地，不进仓库）
用法:
  python tools/exam-pdf2json.py 题册.pdf -o paper.json --name "TOPIK第68回" --minutes 110
  python tools/exam-pdf2json.py 雅思真题.pdf -o paper.json --name "Cam18Test1 Listening" --minutes 30
  python tools/exam-pdf2json.py 题册.txt -o paper.json [--answers "1:3,2:1,..."]  # 文本解析失败时手填答案
流程: 抽文本 → 识别题号/选项(①②③④ / (1)-(4) / A.-D.) → 从「정답 / Answer Key」段提取答案 → 输出考场 JSON
"""
import argparse, json, re, sys

OPT_CIRCLED = '①②③④⑤⑥⑦⑧'
OPT_MAP = {c: i for i, c in enumerate(OPT_CIRCLED)}
# 雅思等西式卷：A. B. C. D.（也兼容 "A text" 无点形）
LETTER_OPT = re.compile(r'(?:^|\s)([A-D])\s*[.．、:：)]\s*')

def extract_text(path):
    if path.lower().endswith('.txt'):
        return open(path, encoding='utf-8', errors='ignore').read()
    from pypdf import PdfReader
    r = PdfReader(path)
    return '\n'.join((p.extract_text() or '') for p in r.pages)

def parse_answers(text, n_q):
    """从含「정답 / Answer Key / 答案」的段落抓 (题号→选项下标0-3)"""
    answers = {}
    # 韩式 정답 段 + 西式 Answer Key / Answers / 答案 段
    for kw in (r'정답', r'Answer\s*Key', r'Answers?', r'答案'):
        for m in re.finditer(kw, text):
            win = text[m.end(): m.end() + 3000]
            # 数字题号 + (①-④ | 1-4 | A-D)，分隔符随意
            for qn, a in re.findall(
                    r'(\d{1,3})\s*[.．)）:：]?\s*(?:is\s+|:)?\s*([①②③④]|[1-4]|[A-D])(?!\w)', win):
                qn = int(qn)
                if 1 <= qn <= n_q:
                    if a in OPT_MAP:
                        idx = OPT_MAP[a]
                    elif a in 'ABCD':
                        idx = 'ABCD'.index(a)
                    else:
                        idx = int(a) - 1
                    if 0 <= idx <= 3:
                        answers[qn] = idx  # 后面的窗口覆盖前面
    return answers

def parse_questions(text):
    """按题号切题；选项取 ①-④ / (1)-(4) / A.-D. 四个一组"""
    lines = [l.rstrip() for l in text.splitlines()]
    qs = []  # [(num, stem, [opt texts])]
    cur = None  # [num, buffer_lines]
    def flush():
        nonlocal cur
        if cur is None: return
        num, buf = cur
        block = ' '.join(b.strip() for b in buf if b.strip())
        # 答案段标题（Answer Key/정답/答案）不成题号行，会粘进最后一题——按独立词截掉
        # （后面紧跟韩文/字母的不算，避免误伤「정답을 고르시오」这类题干）
        mk = re.search(r'(?:Answer\s*Key|정답|答案)(?![\w가-힣])', block)
        if mk: block = block[:mk.start()]
        # 找选项
        circ = re.findall(r'[①②③④]', block)
        opts = None
        if circ.count('①') and len(set(circ)) >= 4:
            parts = re.split(r'[①②③④]', block)
            marks = re.findall(r'[①②③④]', block)
            # parts[0]=题干, 后续4段=选项
            if len(parts) >= 5:
                stem = parts[0]
                opts = [parts[i + 1].strip() for i in range(4)]
                # 选项内部可能粘连下一个小题号——粗略去掉尾部题号
                qs.append((num, stem.strip(), opts))
                cur = None
                return
        # 备选: (1)(2)(3)(4)
        parts = re.split(r'\(([1-4])\)', block)
        if len(parts) >= 9:
            stem = parts[0]
            opts = [parts[i * 2 + 2].strip() for i in range(4)]
            qs.append((num, stem.strip(), opts))
            cur = None
            return
        # 备选: A. B. C. D.（雅思等西式卷；须恰含 A-D 各一，避免把正文里的 A 误认）
        letters = LETTER_OPT.findall(block)
        if letters and sorted(set(letters)) == ['A', 'B', 'C', 'D']:
            parts = LETTER_OPT.split(block)
            # parts = [前导, 'A', 选项A文本, 'B', 选项B文本, ..., 'D', 选项D文本]
            if len(parts) >= 9:
                stem = parts[0]
                opts = [parts[i * 2 + 2].strip() for i in range(4)]
                qs.append((num, stem.strip(), opts))
        cur = None
    for l in lines:
        m = re.match(r'^\s*(\d{1,3})\s*[.．]\s*(.*)$', l)
        if m:
            flush()
            cur = [int(m.group(1)), [m.group(2)]]
        elif cur is not None:
            cur[1].append(l)
    flush()
    # 连续题号去重（同号取最后）
    out, seen = [], set()
    for num, stem, opts in qs:
        if num in seen: continue
        seen.add(num); out.append((num, stem, opts))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--name', default='导入的真题卷')
    ap.add_argument('--minutes', type=int, default=110)
    ap.add_argument('--answers', default='')
    args = ap.parse_args()

    text = extract_text(args.input)
    qs = parse_questions(text)
    if not qs:
        sys.exit('未识别到题目（需题号 1. 2. … + 选项 ①②③④ 或 (1)-(4)）')
    n = len(qs)
    answers = {}
    if args.answers:  # 手填: "1:3,2:1,..."（1基选项号）
        for pair in args.answers.split(','):
            k, v = pair.split(':')
            answers[int(k)] = int(v) - 1
    else:
        answers = parse_answers(text, n)
    missing = [num for num, _, _ in qs if num not in answers]
    if len(answers) < n * 0.8:
        sys.exit(f'答案识别不足（{len(answers)}/{n}）。可用 --answers "1:3,2:1,..." 手填后重跑；缺号: {missing[:20]}')

    sec = {
        'key': 'imported', 'title': '기출문제', 'minutes': args.minutes,
        'qs': []
    }
    for num, stem, opts in qs:
        a = answers.get(num, 0)
        sec['qs'].append({
            'type': '기출',
            'stem': f'{num}. {stem}',
            'options': [{'t': o, 'ok': i == a} for i, o in enumerate(opts)],
            'ref': None,
        })
    paper = {
        'name': args.name, 'minutes': args.minutes,
        'secs': [sec], 'totalQ': len(sec['qs']), 'totalMin': args.minutes,
        'imported': True,
    }
    json.dump(paper, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    hit = sum(1 for q in sec['qs'] if any(o['ok'] for o in q['options']))
    print(f'OK: {len(sec["qs"])} 题 → {args.out}（答案命中 {hit}/{n}，缺 {len(missing)}）')

if __name__ == '__main__':
    main()
