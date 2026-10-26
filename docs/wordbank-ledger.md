# 考试词库全量精写 · 进度台账

**总目标（2026-10-17 确认）**：~12,000 词全量精写，80 词/轮，共约 152 轮
**条目标准**：词感 ≤150 字（母语者直觉四要素，2026-10-21 起） / 误区 ≤50 字 / 搭配 2-3 条 / 例句 1-2 句（学术语境）
**词感四要素**：破意象·边界/近义辨析·搭配内嵌·语体/母语者反应（至少占两项；禁"XX类核心："+搭配清单体）
**分批规则**：每轮一个源文件 `src/words-{lang}-{tag}-NN.json`，同 id 自动合并进词表；频度优先（随时停都好用）

## 目标与进度

| 语言 | 词表 id | 目标 | 已入库（计入） | 批次进度 |
|---|---|---|---|---|
| 英语（8 分向） | `ielts-core` | 5,500 | **5,500 ✅ 目标达成（2026-10-22）** | awl-01~19 + zj-20~23 + ext-24~26 全部完成 |
| 日语 N1 | `jlpt-core` | **3,070**（OpenJLPT 标准 N1） | **3,093 ✅ 目标达成（2026-10-24）**（N1 3,070 全覆盖：3,063 新入库 + 7 原已在库 + 旧核心 30） | ja-n1-01~13 全部完成 |
| 韩语 TOPIK | `topik-core` | **4,000**（B 方案：中급 3,729 + 初级词频补 271） | 4,030（ko-01~17 净增 4,000 + 钩子 1,618） | ko-01~17 ✅（100.8%），剩 0 批
| 场景厅/语法宫/基础表 | — | 不动 | — | — |

## 英语批次明细

| 批次 | 文件 | 内容 | 状态 |
|---|---|---|---|
| awl-01 | words-en-awl-01a/b.json | AWL 子列表1-2 前 80 词（abandon→channel，不含已有10词） | ✅ 2026-10-17 |
| awl-02 | words-en-awl-02a/b.json | 下 80 词（cease→integrate） | ✅ 2026-10-17 |
| awl-03 | words-en-awl-03a/b.json | 下 80 词（interpret→significant） | ✅ 2026-10-19 |
| awl-04 | words-en-awl-04a/b/c.json | 120 词（via→electronic + significant 后续高频群），并行写手产出 | ✅ 2026-10-19 |
| awl-05 | words-en-awl-05a~f.json | 240 词（emotional→public），6写手并行，质检零缺陷 | ✅ 2026-10-19 |
| awl-06 | words-en-awl-06a~f.json | 240 词（promise→well 高频群），净增221 | ✅ 2026-10-19 |
| awl-07 | words-en-awl-07a~f.json | 240 词（whether→dependent），净增237 | ✅ 2026-10-19 |
| awl-08 | words-en-awl-08a~f.json | 240 词（deposit→problem），净增235 | ✅ 2026-10-19 |
| awl-09 | words-en-awl-09a~f.json | 240 词（候选池+写手自去重），净增240零重复 | ✅ 2026-10-19 |
| awl-10 | words-en-awl-10a~f.json | 240 词（种子词+写手续选），净增240 | ✅ 2026-10-20 |
| awl-11 | words-en-awl-11a~f.json | 240 词（scrutinize→affinity 高频群），净增240 | ✅ 2026-10-20 |
| awl-12 | words-en-awl-12a~f.json | 240 词（aftermath→ironic 高频群），净增240 | ✅ 2026-10-20 |
| awl-13 | words-en-awl-13a~f.json | 240 词（jargon→ridicule 高频群），净增240 | ✅ 2026-10-20 |
| awl-14 | words-en-awl-14a~f.json | 240 词（ruthless→bliss 衔接群），净增240 | ✅ 2026-10-20 |
| awl-15 | words-en-awl-15a~f.json | 240 词（spouse→verify 群），净增240 | ✅ 2026-10-20 |
| awl-16 | words-en-awl-16a~d.json | 240 词（4写手×60，wrestle→customary 进阶群），净增240零重复 | ✅ 2026-10-20 |
| awl-17 | words-en-awl-17a~d.json | 240 词（4写手×60，aberration→imperious 进阶群），净增240零重复 | ✅ 2026-10-21 |
| awl-18 | words-en-awl-18a~d.json | 240 词（4写手×60，impertinent→revile 进阶群，首批按新词感标准），净增240零重复 | ✅ 2026-10-21 |
| awl-19 | words-en-awl-19a~c.json | 141 词（3写手×47，rife→zestful，GRE向候选池收尾清空），净增141零重复 | ✅ 2026-10-22 |
| zj-20 | words-en-zj-20a~d.json | 240 词（4写手×60，abnormal→dress 实战基础向，「精度盲区」写法），净增240零重复 | ✅ 2026-10-22 |
| zj-21 | words-en-zj-21a~d.json | 240 词（leap→leaflet，frigde typo 修正、drift 撞库换 leap），净增240零重复 | ✅ 2026-10-22 |
| zj-22 | words-en-zj-22a~d.json | 240 词（radiate→radar，3 typo 修正；practical/prevail typo 修后撞库换 radioactive/radius），净增240零重复 | ✅ 2026-10-22 |
| zj-23 | words-en-zj-23a~d.json | 238 词（rainbow→zoologist 收尾；wax/vegetation 撞库剔除），净增238零重复；真经词表 963 词全部消化 | ✅ 2026-10-22 |
| ext-24 | words-en-ext-24a~d.json | 240 词（4写手×60，say→boot，ECDICT 词频回填基础层，「替换梯度」写法），净增240零重复 | ✅ 2026-10-22 |
| ext-25 | words-en-ext-25a~d.json | 240 词（resistance→descend，含敏感话题词中性处理+语法陷阱词），净增240零重复 | ✅ 2026-10-22 |
| ext-26 | words-en-ext-26a~d.json | 198 词（cabin→furious 收尾），净增198零重复；**ielts-core 达 5,500 目标** | ✅ 2026-10-22 |

## 日语 / 韩语

**词源署名**：日语 N1 词表来自 [evanclan/OpenJLPT](https://github.com/evanclan/OpenJLPT)（CC BY-SA 4.0）；本项目衍生词条内容同以 CC BY-SA 4.0 提供。

**日语条目规格**：w（词形）/ pron（假名 / 罗马音）/ pos / zh（2-4 义）/ sense ≤150（四要素）/ trap ≤50 / collo 2-3 / ex 1-2（日文句+中译）；id=jlpt-core、speech=ja-JP。
**钩子规则（10-22 用户定）**：只给难理解的词——同形异义/语感微妙/外来语陷阱/核心多义；简单直白不给。侧车 `src/hooks-ja-n1-*.json`，key=`jlpt-core/词形`。

| 批次 | 文件 | 内容 | 状态 |
|---|---|---|---|
| ja-n1-01 | words-ja-n1-01a~d.json + hooks-ja-n1-01a~d.json | 240 词（嗚呼→運賃），钩子 105 条 | ✅ 2026-10-23 |
| ja-n1-02 | words-ja-n1-02a~d.json + hooks-ja-n1-02a~d.json | 240 词（云々→気質），钩子 109 条 | ✅ 2026-10-23 |
| ja-n1-03 | words-ja-n1-03a~d.json + hooks-ja-n1-03a~d.json | 240 词（片言→清らか），钩子 100 条 | ✅ 2026-10-23 |
| ja-n1-04 | words-ja-n1-04a~d.json + hooks-ja-n1-04a~d.json | 240 词（距離→極楽），钩子 105 条 | ✅ 2026-10-23 |
| ja-n1-05 | words-ja-n1-05a~d.json + hooks-ja-n1-05a~d.json | 240 词（国連→下心），钩子 103 条 | ✅ 2026-10-23 |
| ja-n1-06 | words-ja-n1-06a~d.json + hooks-ja-n1-06a~d.json | 240 词（下地→新入生），钩子 98 条 | ✅ 2026-10-23 |
| ja-n1-07 | words-ja-n1-07a~d.json + hooks-ja-n1-07a~d.json | 240 词（信任→滞納），钩子 94 条 | ✅ 2026-10-23 |
| ja-n1-08 | words-ja-n1-08a~d.json + hooks-ja-n1-08a~d.json | 240 词（対比→邸宅），钩子 102 条 | ✅ 2026-10-23 |
| ja-n1-09 | words-ja-n1-09a~d.json + hooks-ja-n1-09a~d.json | 240 词（ティッシュ→生身，外来语密集段），钩子 99 条 | ✅ 2026-10-23 |
| ja-n1-10 | words-ja-n1-10a~d.json + hooks-ja-n1-10a~d.json | 240 词（鉛→ビジネス），钩子 107 条 | ✅ 2026-10-23 |
| ja-n1-11 | words-ja-n1-11a~d.json + hooks-ja-n1-11a~d.json | 240 词（比重→干し物），钩子 104 条 | ✅ 2026-10-24 |
| ja-n1-12 | words-ja-n1-12a~d.json + hooks-ja-n1-12a~d.json | 240 词（保守→役場），钩子 93 条 | ✅ 2026-10-24 |
| ja-n1-13 | words-ja-n1-13a~d.json + hooks-ja-n1-13a~d.json | 183 词（優→悪者 收尾），钩子 77 条；**N1 目标达成** | ✅ 2026-10-24 |

**韩语词源署名**：[julienshim/combined_korean_vocabulary_list](https://github.com/julienshim/combined_korean_vocabulary_list)（MIT 代码）——国립국어원 한국어 학습용 어휘 목록（2003）+ TOPIK 官方词表（2015）合并的衍生 TSV；原词表权利归 NIKL/TOPIK 机构。

**韩语条目规格**：w（한글）/ pron（RR 罗马音）/ pos / zh（2-4 义）/ sense ≤150（四要素，汉字词走 한자어 秒懂）/ trap ≤50 / collo 2-3 / ex 1-2（韩文句+中译）；id=topik-core、speech=ko-KR。
**钩子规则**：同日语——汉字词同形异义/外来语/近义辨析/核心多义给，透明汉字词与简单直白词不给；侧车 `src/hooks-topik-*.json`，key=`topik-core/词形`。

| 批次 | 文件 | 内容 | 状态 |
|---|---|---|---|
| ko-01 | words-topik-01a~d.json + hooks-topik-01a~d.json | 240 词（등→평가），钩子 108 条 | ✅ 2026-10-24 |
| ko-02 | words-topik-02a~d.json + hooks-topik-02a~d.json | 240 词（달라지다→소문），钩子 102 条 | ✅ 2026-10-24 |
| ko-03 | words-topik-03a~d.json + hooks-topik-03a~d.json | 240 词（자녀→비우다），钩子 101 条 | ✅ 2026-10-24 |
| ko-04 | words-topik-04a~d.json + hooks-topik-04a~d.json | 240 词（싸다→둘러보다），钩子 98 条 | ✅ 2026-10-24 |
| ko-05 | words-topik-05a~d.json + hooks-topik-05a~d.json | 240 词（분노→뚫다），钩子 86 条 | ✅ 2026-10-24 |
| ko-06 | words-topik-06a~d.json + hooks-topik-06a~d.json | 240 词（상→동의），钩子 92 条 | ✅ 2026-10-24 |
| ko-07 | words-topik-07a~d.json + hooks-topik-07a~d.json | 240 词（마무리→병들다），钩子 108 条 | ✅ 2026-10-24 |
| ko-08 | words-topik-08a~d.json + hooks-topik-08a~d.json | 240 词（부러지다→프린터），钩子 90 条 | ✅ 2026-10-24 |
| ko-09 | words-topik-09a~d.json + hooks-topik-09a~d.json | 240 词（하나하나→씩씩하다），钩子 91 条 | ✅ 2026-10-24 |
| ko-10 | words-topik-10a~d.json + hooks-topik-10a~d.json | 240 词（연구실→마사지），钩子 100 条 | ✅ 2026-10-26 |
| ko-11 | words-topik-11a~f.json + hooks-topik-11a~f.json | 240 词（먹히다→어저께，6×40），钩子 88 条；**haiku+指南模板试验批** | ✅ 2026-10-26 |
| ko-12 | words-topik-12a~f.json + hooks-topik-12a~f.json | 큰어머니→두드러지다（6×40，钩子 99 条，零自查最低成本配置） | ✅ 2026-10-26 |
| ko-13 | words-topik-13a~f.json + hooks-topik-13a~f.json | 두통약→사항（6×40，钩子 91 条；C包词性未映射已修29处） | ✅ 2026-10-26 |
| ko-14 | words-topik-14a~f.json + hooks-topik-14a~f.json | 삭제→욕망（6×40，钩子 105 条；修14f裸tab、14c施行→시행） | ✅ 2026-10-26 |
| ko-15 | words-topik-15a~f.json + hooks-topik-15a~f.json | -용→초록（6×40，钩子 96 条；A包剥离多余hanja字段40处） | ✅ 2026-10-26 |
| ko-16 | words-topik-16a~f.json + hooks-topik-16a~f.json | 초봄→이름（6×40，钩子 101 条；C路分类器拦截重发成功） | ✅ 2026-10-26 |
| ko-17 | words-topik-17a~f.json + hooks-topik-17a~f.json | 내리다→빠르다（4×40 收尾，钩子 62 条） | ✅ 2026-10-26 |
| ko-12~17 | 待建 | 池剩 1,360 词 | 待开始 |

## 写手模板（2026-10-26 起生效）

- 标准集中在 `docs/writer-guide.md`，写手提示词只含任务+路径（~400 token）
- **haiku 模型** + 6 路 × 40 词 + 分批写入（30+Edit）+ 内联一次自查 + 一行式报告
- ko-11 试验批验证：四查 PASS + 人工抽查 12 样本质量达标；批次墙钟 ~19 分（原 ~38 分），token 单价降一个档

## 变更记录

- 2026-10-17：立项；确认英语目标 5,500（8 分向）/ N1 全量 4,042 / TOPIK ~2,500
- 2026-10-20：批 11~16 连跑入库，ielts-core 3,243（59.0%）；发现词库缓存逼近 localStorage 上限，改走 IndexedDB（见当日日志）
- 2026-10-21：批 17 入库，ielts-core 3,483（63.3%）；词库缓存 ETag 更新守卫上线（见当日日志）
- 2026-10-21：**全量词感返工完成**——awl-01~17 共 3,480 条 sense 按四要素标准重写（9 轮×400 内 280，4 写手并行），零标签体残留；词感标准升级为 ≤150 字（见当日日志）
- 2026-10-21：批 18 入库，ielts-core 3,723（67.7%）；首批按新词感标准写成；解锁卡「解密中」修复上线（v2026-10-21.2）
- 2026-10-22：批 19 入库（141 词收尾），ielts-core 3,864（70.3%）；GRE 向候选池（814 词）清空；确认后续词源顺序：先雅思真经词表（963 全新）后扩词表
- 2026-10-22：zj-20 入库（240 词，真经首批，「精度盲区」写法），ielts-core 4,104（74.6%）；源表 typo 修正 4 处；approach 撞库换 drift
- 2026-10-22：zj-21 入库（240 词），ielts-core 4,344（79.0%）；frigde typo 修正、drift 撞库换 leap
- 2026-10-22：zj-22 入库（240 词），ielts-core 4,584（83.3%）；3 typo 修正；practical/prevail 修后撞库换 radioactive/radius
- 2026-10-22：zj-23 入库（238 词收尾），ielts-core 4,822（87.7%）；真经词表 963 词全部消化；剩 678 词待扩词表补齐
- 2026-10-22：ext-24 入库（240 词，ECDICT 词频回填基础层），ielts-core 5,062（92.0%）；ECDICT 池 1,200 词已建（BNC/COCA 双频+IELTS 加权+虚词过滤）
- 2026-10-22：ext-25 入库（240 词），ielts-core 5,302（96.4%）；最后 198 词（ext-26）即达 5,500
- 2026-10-22：**ext-26 入库（198 词），ielts-core = 5,500，英语 8 分向主体目标达成** 🎯（2026-10-17 立项 → 10-22 达成，6 天 26 批）
- 2026-10-24：**ja-n1-13 入库（183 词），jlpt-core = 3,093，日语 N1 目标达成** 🎯（10-22 立项 → 10-24 达成，13 批，钩子累计 1,458）
- 2026-10-24：韩语 TOPIK 词源确认（NIKL+TOPIK 合并 TSV，B 方案 4,000）；ko-01 入库（240 词），topik-core 270（6.8%）
- 2026-10-26：ko-12 入库（240 词），topik-core 2,910（72.8%）
- 2026-10-26：ko-13 入库（240 词），topik-core 3,150（78.8%）
- 2026-10-26：ko-14 入库（240 词），topik-core 3,390（84.8%）
- 2026-10-26：ko-15 入库（240 词），topik-core 3,630（90.8%）
- 2026-10-26：ko-16 入库（240 词），topik-core 3,870（96.8%）
- 2026-10-26：ko-17 入库（160 词），topik-core 4,030（100.8%）
