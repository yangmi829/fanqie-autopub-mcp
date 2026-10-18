> ⚠️ **归档稿（2026-10-18 移入 `docs/archive/`）**：这是「修改能力补充」的**动手前方案**，内容已过时 ——
> 其中的 P0/P1/P2 全部已落地（工具数 23 → 30），落地结论与真机实测见 `../PLAN.md` §11 / §12 / §14。
> 保留原文仅为过程可追溯（含 §0 那次并发改动的处置记录），**不要按本文档的「现状盘点」去操作**。

---

# PLAN — fanqie-autopub-mcp「修改」能力补充

> 状态：**方案已定，等待执行窗口** —— §0 的在途工作落地后再动手；本次未动任何代码
> 日期：2026-10-17
> 前置：当前 23 工具 / 8 资源，`main` = `3ab0c5b`（已推送、已脱敏）

---

## 0. ⚠️ 写方案时发现的并发改动（需要你先说明）

我准备动手前查了工作树，发现**不是本次会话产生的改动**，且时间就在几分钟内：

| 时间 | 变动 | 说明 |
|---|---|---|
| 21:47:48 | 新建 `scripts/diag-dialog.mjs` | 诊断脚本，**会真的点「提交」发布章节** |
| 21:52:30 | 改 `src/services/chapter.ts` | +191 行：`waitForEditor` / `readEditorLength` / `waitForEnabled` / `chooseDetection` / `confirmPublishSettings` / `drivePublishDialogs` |
| 21:52:40 | `npm run build` | `dist/` 全量重编译 |
| 21:53:04–05 | 一次真实发布尝试 | 新增 `data/screenshots/chapter-publish-result-*.png`，并写回 `data/articles.json`、`data/publish_tasks.json` |
| 当前 | 3 个 node + 一批 chrome 常驻 | 有会话在跑浏览器自动化 |

另外 `data/screenshots/` 里还有 `chapter-detection-missing-*`、`chapter-selectors-missing-*`，说明这条链路正在调试中（内容检测方式那一步没找到）。

**线上未受影响**：`list_chapters_tomato` 仍是「共 1 章」，没有多发布出章节。

**我的处置**：不 build、不 commit、不改 `chapter.ts`。等你说清这批改动是谁的、是否还在进行。

> ✅ **已确认（2026-10-17）**：这批改动是**你本人的在途工作** → 本会话**停手**，不改仓库、不 build、不 commit，等它落地。期间**不做任何轮询**。

---

## 1. 现状盘点

### 已支持「修改」
| 工具 | 能改 |
|---|---|
| `set_book_tags` | 作品阅读/内容标签 |
| `publish_short_story_tomato`（带 `item_id`） | 已有短故事正文/标题/分类/封面 |
| `set_short_story_cover_tomato` | 已有短故事封面 |

### 不支持「修改」（只能增/删）
| 目标 | 现状 |
|---|---|
| 已发布的小说章节 | 只有 `add_chapter_tomato`（新建）；路由写死 `enter_from=newchapter_1` |
| 小说作品信息（书名/简介/主角名） | 只有 `create_novel_tomato`（建书时） |
| 本地文稿 `articles.json` | `save_article` 无 `article_id` → 只能新建；有 delete/export |
| 本地小说设定 `novels.json` | 只有资源 `fanqie://novels` 能读，无写工具 |

---

## 2. 只读侦察结论（2026-10-17 实测，未提交任何表单）

| 用途 | 真实路径 | 关键控件 |
|---|---|---|
| 章节管理 | `/main/writer/chapter-manage/{bookId}&{urlencode(书名)}?type=1` | 每章有 `<a href="/main/writer/{bookId}/publish/{chapterId}/?enter_from=modifychapter">`（图标，无文字）；另有「新建章节」→ `/publish/?enter_from=newchapter` |
| **改章节页** | `/main/writer/{bookId}/publish/{chapterId}/?enter_from=modifychapter` | 与新建章节**同一个编辑器**：`.serial-editor-title-left input`（序号）、`input[placeholder="请输入标题"]`（**已预填**）、`.ProseMirror`（**正文已载入**，实测 3043 字符）、顶部显示「已保存」、按钮 `button.publish-button`（下一步） |
| 作品信息（视图） | `/main/writer/book-info/{bookId}?experienceInfo=&experienceLevel=0&isNewSign=1&type=1` | 展示 书籍封面/书本名称/目标读者/签约模式/阅读标签/内容标签/主角名/作品简介/书号/创建时间/安全状态 |
| **作品信息（编辑）** | 同上，点 `button.create-btn`（文字「修改」） | 弹窗「修改作品信息」：`请输入作品名称`(max 15)、`请输入主角名1`(max 5)、`请输入主角名2`(max 5)、`请输入50-500字以内的作品简介`、`#selectRow .select-view` ×4（阅读标签 + 内容标签）、按钮 选择封面 / 取消 / **立即修改** |
| 其他 tab | `type=0` 空；`type=2` 签约；`type=3` 无数据 | — |
| 「更多」下拉 | `button.button-list-more` | 只有「删除」 |

### 顺带发现的 bug
`set_book_tags` 现在用的是**猜的** `/main/writer/{bookId}/edit`，真实入口是 `book-info?type=1` + 点「修改」开弹窗。也就是说 **`set_book_tags(confirm=true)` 目前很可能直接走 `aborted`**（此前只验证过 `confirm=false` 的审核锁查询）。

---

## 3. 方案

### P0 — 本地侧（纯本地、零风险、不触网）

**3.1 「改文稿」（已定：方案 A）**
给 `save_article` 加可选 `article_id`：传了则 upsert（改标题/正文/章节号/状态/绑定 id），没传则新建。不增加工具数。

**3.2 新增 `update_novel`** —— 改本地小说登记与创作设定
参数：`novel_id` + 以下任一：`title / gender / abstract / protagonist1 / protagonist2 / reading_tags / content_tags / tomato_book_id / tomato_book_name / genre / synopsis / outline / world_setting / golden_hook / characters / target_words_per_chapter / status`
纯本地写 `data/novels.json`，返回改后对象。

**3.3 新增 `import_articles_from_dir`（已确认要做）**
从 `小说/<书名>_<ID>/章节/*.md` 批量入库/更新：识别「第N章 标题」，正文剥 markdown，按 `novel_id` 归属；已存在（同章节号或同标题）则更新，否则新建。打通「本地工作稿 → 数据真身」。

### P1 — 修 `set_book_tags` 的路由（bug 修复）
改为：打开 `book-info/{bookId}?...&type=1` → 点 `button.create-btn` → 弹窗内用 `#selectRow .select-view` 勾选 → 「立即修改」。
`novel.ts` 里已有的 `selectTagsOnCreatePage` 可直接复用，改动很小。

### P2 — 新增 `update_novel_info_tomato`（改远端作品信息）
参数：`book_id`、`title?`、`protagonist1?`、`protagonist2?`、`abstract?`、`reading_tags?`、`content_tags?`、`confirm?`、`headless?`
流程：`book_detail` 查审核锁（`can_modify`）→ 打开 `book-info?type=1` → 点「修改」→ 填弹窗 → `confirm=true` 点「立即修改」→ 截图 + 复核
校验：书名 ≤15、主角名 ≤5、简介 50–500、标签上限（复用 `validateContentTagCaps`）

### P2 — 新增 `update_chapter_tomato`（改已发布章节）
参数：`book_id`、`chapter_id`、`title?`、`content?|file_path?`、`detection?`、`use_ai?`、`confirm?`、`headless?`
路由：`/main/writer/{bookId}/publish/{chapterId}/?enter_from=modifychapter`，复用 `add_chapter_tomato` 的后续步骤（内容检测方式 → 发布设置 → 确认提交 → 错别字二次确认 → `chapter_list` 复核）。
> ⚠️ **依赖 §0**：该文件正被并发修改（有人正在做 `drivePublishDialogs`》。必须等那条链路稳定后再动，否则冲突。

---

## 4. 计数与验证影响

- 工具：23 → **26**（+`update_novel`、+`update_novel_info_tomato`、+`update_chapter_tomato`）；若 3.1 走方案 A 则不额外增加
- 同步更新 `scripts/smoke.mjs` 的 `EXPECTED_TOOLS`，并加本地断言（`update_novel`、`save_article` upsert）
- `dist/` 需重编译并一并提交（仓库约定）

## 5. 安全约定（沿用现有）

- 所有写工具默认 `confirm=false`（只填表 + 截图），`confirm=true` 才提交
- 远端写操作全部驱动真实页面，不手工 fetch
- 首次 `confirm=true` 由你手动触发；我提供 `confirm=false` 的截图与参数预览
- 失败自动截图到 `data/screenshots/`

## 6. 风险

1. **改已发布章节 / 改书名简介可能触发重新审核**，影响曝光与推荐 → 非必要不改，默认只预览
2. 弹窗是 Arco 组件（`arco-modal`），选择器需集中到 `*_SELECTORS` 以便改版时单点修复
3. **并发写同一文件**（§0）→ 需要排期，避免冲突

## 7. 决策记录

| # | 事项 | 结论 |
|---|---|---|
| 1 | §0 并发改动 | **是你本人的在途工作** → 本会话停手等待，不碰仓库 |
| 2 | 改本地文稿 | **方案 A**：给 `save_article` 加可选 `article_id` 做 upsert |
| 3 | `import_articles_from_dir` | **要做** |
| 4 | 首次真写（`confirm=true`） | 默认由我提供 `confirm=false` 截图+参数预览，**真写由你触发**；若你要我代点请在开工时说明 |

## 8. 执行顺序（等你说「开始」后）

1. **P0**：`save_article` upsert + `update_novel` + `import_articles_from_dir`（纯本地，可先做、可独立提交）
2. **P1**：修 `set_book_tags` 路由（小改，独立提交）
3. **P2**：`update_novel_info_tomato` → `update_chapter_tomato`（**必须等 §0 的 `chapter.ts` 工作落地**）
4. 每步：`npm run build` → `npm run smoke`（同步 `EXPECTED_TOOLS`）→ 只读真机校验 → 提交（含 `dist/`）→ 走代理 push
5. 最后：更新 `README.md`、`AGENTS.md`、`docs/PLAN.md`
