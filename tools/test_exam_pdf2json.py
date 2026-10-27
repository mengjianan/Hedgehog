# -*- coding: utf-8 -*-
"""exam-pdf2json.py 解析回归测试：雅思 A-D / Answer Key + 韩式 ①②③④ / (1)-(4)。跑法: python tools/test_exam_pdf2json.py"""
import importlib.util, os, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # Windows GBK 控制台打印韩文/日文用

_here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p2j', os.path.join(_here, 'exam-pdf2json.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def ok(cond, msg):
    assert cond, msg
    print('  ok -', msg)

# 雅思式：A.-D. 选项 + Answer Key
ielts_text = '''
Questions 1-4
Complete the form below.
1. Name of customer: A. Smith B. Brown C. Black D. Block
2. Date of arrival: A. 12 May B. 2 May C. 20 May D. 2 May
3. Type of room: A. single B. double C. twin D. triple
4. Number of nights: A. one B. two C. three D. four

Answer Key
1. A 2. C 3. C 4. B
'''
qs = m.parse_questions(ielts_text)
ok(len(qs) == 4 and all(len(o) == 4 for _, _, o in qs), 'A-D 四题四选项')
ok('Answer' not in qs[3][2][3], '答案段标题不粘连最后选项')
ok(m.parse_answers(ielts_text, 10) == {1: 0, 2: 2, 3: 2, 4: 1}, 'Answer Key A/C/C/B')

# 韩式回归：①-④ + 정답
ko_text = '''
1. 다음 중 옳은 것은?
① 보통 ② 포부 ③ 과거 ④ 고생
2. 뜻에 맞는 것을 고르시오.
① 학생 ② 교수 ③ 교실 ④ 교육
정답
1.② 2.①
'''
ok(len(m.parse_questions(ko_text)) == 2, '①-④ 两题')
ok(m.parse_answers(ko_text, 5) == {1: 1, 2: 0}, '정답 ②①')

# (1)-(4) 回归
paren_text = '''
1. Choose (1) apple (2) banana (3) cherry (4) date
2. Pick (1) red (2) blue (3) green (4) black
정답 1.2 2.3
'''
ok(len(m.parse_questions(paren_text)) == 2, '(1)-(4) 两题')
ok(m.parse_answers(paren_text, 5) == {1: 1, 2: 2}, '括号形答案 2/3')

print('全部转换器测试通过')
