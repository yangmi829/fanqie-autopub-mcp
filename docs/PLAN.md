# 计划文档：番茄小说自动发布 MCP（新建项目）

> 状态：**已确认，P0–P5 已完成（19 工具，构建 0 错，冒烟全绿）**
> 目标后台：https://fanqienovel.com/main/writer/home
> 编写日期：2026-10-17
>
> **已确认的决策**
> 1. 路线 A：新建独立项目 `fanqie-autopub-mcp/`，移植已验证的逆向内核（不重写）。
> 2. 允许实施阶段做只读侦察（只开页面/只读接口，不提交表单）。
> 3. 安全策略：所有写操作默认只填表不提交，必须 `confirm=true` 才真正提交。
> 4. 追加功能（全部纳入）：**定时发布**（小说章节）、**短故事分章**、**批量上传**、**本地文稿库**。

---

## 0. 先说结论与三个需要你拍板的点

工作区里**已经有两个相关项目**（详见第 1 节），其中 `tomato-novel-mcp/` 是当前在用、且已经把
「登录 / 新建小说 / 上传小说章节」跑通的版本，**唯独缺「短故事」**。所以本计划有两条路线：

- **路线 A（推荐）**：新建独立项目 `fanqie-autopub-mcp/`，把已验证的浏览器自动化内核**移植**过来（不是从零重写），
  再补上短故事能力。项目干净、职责单一，不影响现有在用服务。
- **路线 B**：直接在现有 `tomato-novel-mcp/` 上加短故事工具，改动最小、但会继续膨胀。

**需要你确认：选 A 还是 B。**

另外两点：

2. 是否允许我在实施阶段做一次「只读侦察」（打开后台页面/接口看结构，不提交任何表单），用于敲定短故事编辑器的选择器。
3. 默认安全策略是否维持：**默认只填表不提交（`confirm=false`），必须显式 `confirm=true` 才真正发布**。

---

## 1. 现状调研（已完成，均为只读）

### 1.1 工作区已有资产

| 目录 | 状态 | 说明 |
|---|---|---|
| `tomato-novel-mcp/` | **在用，已验证** | v2.0.0，已注册到 `~/.workbuddy/mcp.json`。已跑通：半自动扫码登录、真实建书、小说章节真实上传（含内容检测弹窗/发布设置/错别字二次确认/API 复核） |
| `tomato-novel-mcp-tool/` | 废弃原型 | 选择器是猜的（`author.fanqienovel.com` 域名都不对），node_modules 为空、从未构建成功。仅作参考 |
| `output/` | 创作产物 | 大纲、章节正文等 |
| `data/tomato_cookies.json` | 有效 | 今日 01:50 保存，只读侦察验证**仍处于登录态** |

**关键复用价值**：`tomato-novel-mcp/src/services/tomato.ts`（1439 行）里是**逆向 + 实测**出来的番茄后台细节，
是全套方案里最贵的东西，不应重写：

- 登录页 `https://fanqienovel.com/main/writer/login`（半自动扫码，只轮询登录态 + 存 cookies，不碰账号密码）
- 建书页 `/main/writer/create`：表单字段（书名≤15字、频道 radio `name="pindao"` 男1女0、主角名1/2 必填≤5字、简介 50–500 字必填）、
  真实请求是 `application/x-www-form-urlencoded` + `msToken`/`a_bogus` 签名 → **只能驱动真实表单**，手工拼签名不可行
- 章节发布页 `/main/writer/{bookId}/publish/?enter_from=newchapter_1`；
  正文是 **ProseMirror** 富文本（`.syl-editor-container .ProseMirror`），需 `execCommand` 逐段插入
- 发布链路：下一步 → 「请选择内容检测方式」→「发布设置」（是否使用AI）→「确认提交」→ 错别字二次确认
- 复核方式：`GET /api/author/chapter/chapter_list/v1` 比对已发布章节数（比页面 toast 可靠）
- 标签系统：`#selectRow`(阅读标签) / `#activitySelectRow`(内容标签)，4 组上限 情节≤4/情感≤2/人设≤4/世界观≤1
- 已知坑：puppeteer v22+ 无 `page.waitForTimeout`；可选依赖要用**变量 specifier** 动态 import；cwd 不可靠要基于 `import.meta.url` 定位

### 1.2 短故事（本次新增能力）—— 逆向结果

官网教程确认流程为：**作品管理 → 短故事 → 新建短故事 → 下一步 → 填写作品信息 → 发布**

我从前端 bundle 里挖出了短故事的**路由与接口**（已实测 `list` 接口在登录态下返回 `code:0`）：

- 实例路由（`/main/writer` 下）：
  `/short-manage`（我的短故事）、`/short-draft`（草稿箱）、`/short-sign`（签约管理）、
  `/short-recommend`（作品推荐）、`/short-data`、`/short-income`
- 接口（`short_article` 命名空间）：
  - `POST /api/author/short_article/new/v0/` —— 新建（建空 item）
  - `GET  /api/author/short_article/edit/v1/?item_id=` —— 读取详情
  - `POST /api/author/short_article/check_pre/v0` —— 发布前预检（`item_id, check_type_list, book_name`）
  - `POST /api/author/short_article/publish/v0/` —— 发布
    （字段：`content, item_id, multi_title, thumb_uri, category, sign_type, book_thumb_uri, activity_id, story_origin_divided_chapters, use_ai`）
  - `POST /api/author/short_article/cover/v0/` —— 封面/保存草稿（`item_id, content, multi_title, thumb_uri, category…`）
  - `GET  /api/author/short_article/list/v0/`、`draft_list/v0/`、`delete/v0/?item_id=`、`get_category_list/v1/`
- item 字段：`item_id, multi_title(标题), word_number, thumb_url_list, category, sign_type, sign_status, can_modify, can_delete, display_status, appeal_status, activity_info, read_count`
- 编辑器埋点序列揭示步骤：`editor_show → zhengwen_choose(选正文) → next_click(下一步) → typo(错别字) → format(排版) → save`
- 短故事设定：**6000–80000 字**（最佳 1w–3w），一篇完结，官方推荐第一人称

**两个待验证的未知项**（实施阶段要确认，可能影响能否全自动）：
1. 发布时可能触发**实名/人脸验证**（前端有 `short_publish_auth_check_go_app_img` 资源）——若命中，需你手动过一次；
2. `check_pre` 预检的具体拦截项（字数下限、内容合规、活动归属等）。

---

## 2. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（Node ≥ 20，本机 v22.22.1） | 与现有项目一致，类型安全 |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方，WorkBuddy 兼容 |
| 浏览器 | `puppeteer-core` + 本机 Chrome | 免 150MB Chromium；本机已装 Chrome 并已探测到 |
| 传输 | stdio | WorkBuddy 子进程方式 |
| 存储 | JSON 文件（原子写 tmp→rename） | 免 SQLite/better-sqlite3 的 Windows 编译坑 |
| 日志 | stderr（stdout 被协议占用） | stdio 传输必须 |
| 路径 | 基于 `import.meta.url` 解析 | cwd 不可靠 |

**不引入**：typeorm / better-sqlite3 / ioredis / node-cron / winston / AI 生成链路（正文由你提供）。

---

## 3. 架构

```
fanqie-autopub-mcp/
├── src/
│   ├── index.ts                 # MCP 入口（stdio），注册工具与资源
│   ├── types.ts
│   ├── core/                    # paths / logger / result / store(原子写) / text(去markdown)
│   ├── browser/
│   │   ├── driver.ts            # puppeteer-core 加载 + 本机 Chrome 探测（变量 specifier 动态 import）
│   │   ├── session.ts           # 起浏览器 + 注入 cookies + 登录失效检测
│   │   └── cookies.ts           # cookies 保存/加载
│   ├── services/
│   │   ├── auth.ts              # 半自动登录（轮询登录态）
│   │   ├── novel.ts             # ★ 新增小说：驱动 /main/writer/create
│   │   ├── chapter.ts           # ★ 新增小说章节：驱动 /{bookId}/publish/ 全链路
│   │   ├── short.ts             # ★ 短故事：新建 / 详情 / 保存 / 发布
│   │   └── verify.ts            # 发布后用 author API 复核
│   ├── tools/
│   │   ├── auth.ts  novel.ts  chapter.ts  shortStory.ts  status.ts
│   └── resources/index.ts       # 赛道知识库、黄金三章、账号状态等只读资源
├── data/                        # cookies / 本地文稿 / 截图 / 发布任务
├── scripts/
│   ├── smoke.mjs                # 协议级冒烟（不触网）
│   └── mcp-cli.mjs              # 命令行直连 MCP（连接器未生效时用）
└── dist/                        # WorkBuddy 实际加载入口
```

原则：**业务逻辑与传输解耦**；**选择器全部集中在一个文件**（番茄改版只改一处）；
每个写操作分「预检 → 预览(confirm=false) → 执行(confirm=true)」三段。

---

## 4. MCP 工具清单（草案，共 13 个）

> 约定：所有真实写操作默认 `confirm=false`（只填表/预览），`confirm=true` 才提交；
> 失败自动截图到 `data/`，返回截图路径。

### 4.1 登录与状态
| 工具 | 入参 | 说明 |
|---|---|---|
| `login_tomato` | `timeout_seconds?` | 半自动登录：开真实浏览器窗口，你扫码/过验证码，服务轮询登录态并保存 cookies。不碰账号密码 |
| `set_tomato_cookies` | `cookies` \| `file_path` | 手动导入 cookies（备用） |
| `get_publish_status` | — | 前置检查：cookies 是否有效、puppeteer/Chrome 是否就绪、后台是否可访问，并给出补齐指引 |

### 4.2 新增小说（需求 3）
| 工具 | 入参 | 说明 |
|---|---|---|
| `list_novels_tomato` | `page_index?` | 读后台真实小说列表（拿真实 `book_id`），用于核对/回填 |
| `create_novel_tomato` | `title, gender(1男/0女), protagonist1, protagonist2, abstract, reading_tags?, content_tags?, confirm?, headless?` | 驱动 `/main/writer/create` 真实建书，从响应解析 `book_id` 返回。预检 `check_frequency` 频率限制 |

### 4.3 新增小说章节（需求 4）
| 工具 | 入参 | 说明 |
|---|---|---|
| `list_chapters_tomato` | `book_id` | 读后台章节列表（标题/字数/状态），用于复核与避重 |
| `add_chapter_tomato` | `book_id, chapter_number, title, content`(或 `file_path`), `detection?`, `use_ai?`, `scheduled_time?`, `confirm?, headless?` | 序号+标题+ProseMirror 正文 → 下一步 → 内容检测方式 → 发布设置 → 确认提交 → 错别字二次确认 → API 复核；markdown 自动转纯文本 |

### 4.4 新建短故事（需求 2，本次新增）
| 工具 | 入参 | 说明 |
|---|---|---|
| `list_short_stories_tomato` | `status?`(全部/草稿) `page_index?` | 读短故事/草稿列表 |
| `get_short_story_tomato` | `item_id` | 读详情（`edit/v1`）：标题/字数/分类/签约状态/能否修改 |
| `create_short_story_tomato` | `title, abstract, category?, sign_type?, cover?/cover_template?, confirm?, headless?` | 新建短故事：`new/v0` 建 item → 打开作品信息 → 填标题/简介/分类/封面 → 保存草稿（返回 `item_id`） |
| `publish_short_story_tomato` | `item_id`(或 `title`+`content` 新建并发布), `content`(或 `file_path`), `multi_title?`, `category?`, `thumb_uri?`, `sign_type?`, `divided_chapters?`, `use_ai?, confirm?, headless?` | 先 `check_pre` 预检（字数/合规）→ 填正文与作品信息 → 发布 → 复核列表确认落库 |
| `delete_short_story_tomato` | `item_id, confirm?` | 删除短故事/草稿（谨慎，默认预览） |
| `set_short_story_cover_tomato` | `item_id, cover_uri?` \| `use_template?` | 封面：`cover/v0` 上传或 `cover_template` 模板 |

### 4.4.1 便捷封装（"包括但不限于"部分）
- `mark_published`：人工发完后登记状态
- `get_stats`：本书/全部作品的章节数、字数、发布状态、短故事数量、本地文稿库概览

### 4.5 本地文稿库 / 批量（已确认纳入）
| 工具 | 入参 | 说明 |
|---|---|---|
| `save_article` | `kind`(chapter/short), `title`, `content`(或 `file_path`), `novel_id?`, `chapter_number?`, `status?` | 正文入库（写入 `data/articles.json`），返回 `article_id`，避免长文本塞进工具参数 |
| `list_articles` | `kind?`, `novel_id?`, `status?` | 列出本地文稿与发布状态 |
| `get_article` | `article_id` | 取回正文 |
| `delete_article` | `article_id, confirm?` | 删除本地文稿（默认预览） |
| `batch_publish_chapters` | `novel_id`(或 `book_id`), `article_ids?`, `limit?`, `interval_seconds?`, `confirm?`, `headless?` | 从本地文稿库挑「待发布」章节，按序限速依次上传；单章失败不中断，返回逐章结果 |

### 4.5.1 定时发布与短故事分章（已确认纳入）
- **定时发布**：`add_chapter_tomato` / `batch_publish_chapters` 支持 `scheduled_time`（ISO，填番茄章节发布页的时间控件）。
  说明：短故事接口**没有**定时字段，故定时发布仅用于小说章节。
- **短故事分章**：`publish_short_story_tomato` 支持 `divided_chapters`（对应接口字段 `story_origin_divided_chapters`，
  以及编辑器里的「分章」开关）。

### 4.6 MCP 资源（只读）
`fanqie://status`（登录/环境状态）、`fanqie://novels`、`fanqie://short-stories`、`fanqie://articles`、
`fanqie://publish-rules`（发布限制须知：短故事 6000–80000 字、章节是否允许定时等）

**最终工具数：19 个** —— 登录/状态 3 + 小说 2 + 章节 3（含批量）+ 短故事 6 + 文稿库 4 + 统计 1。

---

## 5. 关键流程（时序）

### 5.1 登录
```
login_tomato → 起 Chrome(有头) → 打开 /main/writer/login
  → 用户扫码/过验证码 → 轮询(每2s) cookies + URL 不再是 login → 保存 data/tomato_cookies.json
  → 返回 cookie 数 + readiness
```

### 5.2 新增小说
```
get_publish_status → create_novel_tomato(confirm=false 预览)
  → confirm=true：注入 cookies → 打开 /main/writer/create → check_frequency 预检
    → 填 书名/主角名1/2/简介/频道(+标签) → 监听 response 抓 data.book_id → 返回
```

### 5.3 新增小说章节
```
add_chapter_tomato(confirm=false) → 打开 /{book_id}/publish/ → 填序号/标题/正文 → 截图（你核对）
  → confirm=true：关新手引导 → 下一步 → 选内容检测方式 → 发布设置(是否使用AI) → 确认提交
    → 错别字二次确认 → chapter_list/v1 复核已发布数 → 成功/失败 + 截图
```

### 5.4 新建短故事（本计划的重点新能力）
```
create_short_story_tomato(confirm=false) → 校验字数(6000–80000) → 预览将提交的信息
  → confirm=true：一个浏览器会话内
      ① POST /api/author/short_article/new/v0/        建 item → item_id
      ② 打开发布/编辑页（/short-manage 上的「新建短故事」向导）
      ③ 填 正文 → 下一步 → 填 标题/简介/分类/封面（作品信息）
      ④ check_pre 预检 → cover/v0 存草稿（此时 item 进草稿箱，可复核）
      ⑤ 若 confirm 且预检通过 → publish/v0 提交 → 列表复核出现该 item
  → 若命中实名/人脸验证 → 明确提示你手动过一次，不静默失败
```

---

## 6. 分阶段实施

| 阶段 | 内容 | 产出 / 验收 | 状态 |
|---|---|---|---|
| P0 脚手架 | 建项目、tsconfig、core（paths/logger/result/store）、`index.ts` 骨架、`smoke.mjs` | `npm run build` 0 错；`npm run smoke` 全绿（不触网） | ✅ 完成 |
| P1 登录 | driver + session + cookies + `login_tomato` / `set_tomato_cookies` / `get_publish_status` | 用**已有 cookies** 验证登录态；`get_publish_status` 返回 ready | ✅ 完成（ready=true） |
| P2 新增小说 | 移植建书逻辑 + `list_novels_tomato` / `create_novel_tomato` | `confirm=false` 预览通过；`list_novels_tomato` 能列出后台真实书（含 `<book_id>`） | ✅ 完成（列出 1 本） |
| P3 新增小说章节 | 移植上传全链路 + `list_chapters_tomato` / `add_chapter_tomato` | `confirm=false` 能填表并截图；复核 API 能读到章节数 | ✅ 完成（读到 1 章） |
| P4 短故事 | **只读侦察**编辑器 DOM → `short.ts` → 6 个短故事工具 | `list_short_stories_tomato` 有数据；`create_short_story_tomato(confirm=false)` 能走到草稿保存 | ✅ 完成（草稿箱读到 5 条） |
| P5 收尾 | 便捷封装工具、资源、README、清理脚本、注册 WorkBuddy | 全量冒烟通过；`~/.workbuddy/mcp.json` 已注册（需你在连接器页点「信任」并重启会话） | ✅ 完成 |

**真实发布的动作全部留到 P5 之后，由你逐次 `confirm=true` 触发**（先短故事草稿 → 再真发布）。

### 6.1 实施结果（2026-10-17）

- `npm run build` 0 错误；`npm run smoke` **全绿**（19 工具 + 6 资源 + 本地工具调用全部 PASS）。
- 只读验证（用现有 cookies，真机）：`list_novels_tomato` → 1 本（`<book_id>`）；`list_chapters_tomato` → 1 章；
  `list_short_stories_tomato(status=draft)` → 5 条空草稿；`get_stats(remote=true)` → 本地正常、远程书 1 本。
- 工具数按最终约定落地为 **19 个**：登录/状态 3 + 小说 2 + 章节 3（含批量）+ 短故事 6 + 文稿库 4 + 统计 1。
- 已注册到 `~/.workbuddy/mcp.json`（server 名 `fanqie-autopub`）。
- 侦察脚本与 `data/recon/` 已清理。

### 6.2 遗留与说明

- ~~只读侦察副产物：5 条空草稿~~ **已清理**（2026-10-17）。侦察时打开短故事空白编辑页，番茄前端会**自动**创建空草稿，
  共 5 条（`<item_id-1>`、`<item_id-2>`、`<item_id-3>`、`<item_id-4>`、`<item_id-5>`），
  已按你确认用 `delete_short_story_tomato(confirm=true)` 逐条删除；复核草稿箱现为 **0 条**。
- **删除短故事改走真实 UI**：`short_article/delete/v0/` 是写接口，手工 fetch 会返回 `-2 参数有误`（缺签名）。
  实现改为驱动草稿箱：按卡片 `href=.../preview-short/{item_id}` 定位 → 真实鼠标点击删除图标 → 确认弹窗（「确认删除作品？」）→ 监听 delete 响应。
- `publish_short_story_tomato` 的最终发布按真实 UI 驱动；若命中实名/人脸验证或页面改版，会停止并截图提示，需人工兜底。



---

## 7. 验收标准

- [ ] `npm run build` 0 错误；`npm run smoke` 全通过
- [ ] `get_publish_status` 在真机返回 `ready=true`
- [ ] `list_novels_tomato` 能列出后台真实小说；`list_short_stories_tomato` 能列出短故事
- [ ] `create_novel_tomato(confirm=false)` 返回预览；`confirm=true` 建书成功并返回 `book_id`
- [ ] `add_chapter_tomato(confirm=false)` 截图可见序号/标题/正文已正确填入
- [ ] `create_short_story_tomato(confirm=true)` 能在草稿箱看到新短故事
- [ ] `publish_short_story_tomato(confirm=true)` 发布后列表复核可见该短故事
- [ ] 写操作默认不提交；失败有截图；日志走 stderr

---

## 8. 风险与合规

| 风险 | 处置 |
|---|---|
| **平台风控/封号** | 默认只填表不提交；限速（工具间 sleep）；不批量刷量；保留人工确认环节 |
| 签名 `msToken/a_bogus` 无法手工复现 | 一律**驱动真实页面**，由页面自带 JS 计算签名（这是现有项目跑通的关键） |
| 后台改版导致选择器失效 | 选择器集中单文件 + 多候选 + 失败截图 + 明确报错 |
| 发布需人脸/实名验证 | 检测到即提示人工完成，不重试硬闯 |
| 短故事字数/合规 | 发布前 `check_pre` + 本地字数校验（6000–80000） |
| cookies 过期 | 登录态检测跳 login 页即报「cookies 失效」，引导重新 `login_tomato` |
| 误删/误发 | `delete_*` 与 `publish_*` 默认 `confirm=false` |

---

## 9. 决策记录（已确认 2026-10-17）

1. **路线**：✅ 新建独立项目 `fanqie-autopub-mcp/`（移植已验证内核）
2. **只读侦察**：✅ 允许
3. **安全策略**：✅ 默认只填表不提交（`confirm=true` 才真发）
4. **追加功能**：✅ 定时发布、短故事分章、批量上传、本地文稿库（全部纳入）
5. 遗留：真实发布动作仍由你逐次 `confirm=true` 触发。

> 执行中每阶段结束都会给出可验证证据（构建输出、冒烟结果、截图/接口返回）。
