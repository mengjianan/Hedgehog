# 考试词库全量精写 · 进度台账

**总目标（2026-10-17 确认）**：~12,000 词全量精写，80 词/轮，共约 152 轮
**条目标准**：词感 ≤150 字（母语者直觉四要素，2026-10-21 起） / 误区 ≤50 字 / 搭配 2-3 条 / 例句 1-2 句（学术语境）
**词感四要素**：破意象·边界/近义辨析·搭配内嵌·语体/母语者反应（至少占两项；禁"XX类核心："+搭配清单体）
**分批规则**：每轮一个源文件 `src/words-{lang}-{tag}-NN.json`，同 id 自动合并进词表；频度优先（随时停都好用）

## 目标与进度

| 语言 | 词表 id | 目标 | 已入库（计入） | 批次进度 |
|---|---|---|---|---|
| 英语（8 分向） | `ielts-core` | 5,500 | 4,344（批21净增240零重复） | awl-01~19 + zj-20~21 ✅（79.0%） |
| 日语 N1 | `jlpt-core` | 4,042 | 30（旧核心，非 N1 不计入）→ 0 | 未开始 |
| 韩语 TOPIK | `topik-core` | ~2,500 | 30（旧核心，基础词不计入）→ 0 | 未开始 |
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
| zj-22~23 | 待建 | 真经词表剩 483 词（2批），之后扩词表补到 5,500 | 待开始 |

## 日语 / 韩语

（开始时按同规则建批次明细）

## 变更记录

- 2026-10-17：立项；确认英语目标 5,500（8 分向）/ N1 全量 4,042 / TOPIK ~2,500
- 2026-10-20：批 11~16 连跑入库，ielts-core 3,243（59.0%）；发现词库缓存逼近 localStorage 上限，改走 IndexedDB（见当日日志）
- 2026-10-21：批 17 入库，ielts-core 3,483（63.3%）；词库缓存 ETag 更新守卫上线（见当日日志）
- 2026-10-21：**全量词感返工完成**——awl-01~17 共 3,480 条 sense 按四要素标准重写（9 轮×400 内 280，4 写手并行），零标签体残留；词感标准升级为 ≤150 字（见当日日志）
- 2026-10-21：批 18 入库，ielts-core 3,723（67.7%）；首批按新词感标准写成；解锁卡「解密中」修复上线（v2026-10-21.2）
- 2026-10-22：批 19 入库（141 词收尾），ielts-core 3,864（70.3%）；GRE 向候选池（814 词）清空；确认后续词源顺序：先雅思真经词表（963 全新）后扩词表
- 2026-10-22：zj-20 入库（240 词，真经首批，「精度盲区」写法），ielts-core 4,104（74.6%）；源表 typo 修正 4 处；approach 撞库换 drift
- 2026-10-22：zj-21 入库（240 词），ielts-core 4,344（79.0%）；frigde typo 修正、drift 撞库换 leap
