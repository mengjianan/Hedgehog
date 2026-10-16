# Hedgehog 语感词库

自用多语言语感学习站（原名复刻自对语感词典类产品形态的模仿，内容全部原创）。
纯静态 + 浏览器端加密，无后端、无框架、无构建工具。

## 特性

- **密码门**：词库以 AES-GCM 加密上传（`data/words.enc`），浏览器 PBKDF2 解密，仓库里没有明文词库
- **词感词条**：每个词 = 词感直觉 / 中式误区 / 高频搭配 / 原创例句
- **背词**：认识/模糊自评卡片，进度存 localStorage（本机）
- **收藏**：本机 localStorage
- **PWA**：手机可"添加到主屏幕"
- 响应式，国内手机/电脑直接访问（系统字体，无外部资源请求）

## 目录

```
index.html          单页骨架（密码门 + 4 视图）
styles.css          样式（深绿 #0b4638 + 米白 #faf8f0）
app.js              路由 / 解密 / 跨语言搜索 / 背词 / 收藏
src/words-en.json   英语词库明文源【仅本地，整个 src/ 不上传】
src/words-ko.json   韩语词库明文源【仅本地】
src/words-ja.json   日语词库明文源【仅本地】
data/words.enc      三语合并加密词库【上传】
data/salt           PBKDF2 盐值【上传，只生成一次】
tools/encrypt.js    合并 + 加解密工具
icons/              SVG 图标
site.webmanifest    PWA 清单
docs/               项目日志（每日一记）
```

## 修改词库

```bash
# 1. 编辑 src/words-en.json / words-ko.json / words-ja.json
# 2. 合并 + 重新加密（密码不入库：见本地 PRIVATE-NOTE.md 或私聊会话）
node tools/encrypt.js <密码>
node tools/encrypt.js <密码> --verify   # 校验（会打印各词表词数）
# 3. commit（src/ 被 gitignore，只会提交 words.enc）
```

**换密码**：重新执行第 2 步换新密码即可（salt 不变），告诉所有设备用新密码。

## 部署

Gitee `wuxiejiameng123/hedgehog` → 镜像 GitHub `mengjianan/hedgehog` → GitHub Pages（根目录）。

## 计划

- 批次 2：词库扩至 ~300 词、词库分类完善
- 批次 3：TOPIK 韩语词库（英→韩→日）
- 批次 4：JLPT 日语词库
- 以后：模考引擎（官方免费真题 + 原创题）、公版书阅读区
