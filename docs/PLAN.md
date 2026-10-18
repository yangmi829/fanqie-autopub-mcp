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
- [x] `publish_short_story_tomato(confirm=true)` 发布后列表复核可见该短故事（2026-10-18 首发《青石巷的第三十八步》通过；见 §13）
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


---

## 10. 后续变更：合并旧服务（2026-10-17）

原 `tomato-novel-mcp`（WorkBuddy server 名 `tomato-novel`）停用；其独有能力与本地数据并入本项目，避免两个服务并存。

**移植的能力（+4 工具，工具总数 19 → 23）**

| 新工具 | 来源 | 说明 |
|---|---|---|
| `list_genres` | 旧 `list_genres` + `knowledge/genres.ts` | 12 个赛道知识库（不联网） |
| `check_originality` | 旧 `check_originality` + `services/originality.ts` | 本地原创度 / AI 味检测，语料改用本地文稿库 `articles` |
| `export_article` | 旧 `export_chapter` | 导出文稿为 txt/md（覆盖章节与短故事，更贴合新文稿库模型） |
| `set_book_tags` | 旧 `set_book_tags` | 阅读/内容标签；先查审核锁（`book_detail` 只读 GET），`confirm=true` 才写 |

**新增只读资源（+2，资源总数 6 → 8）**：`fanqie://genres`、`fanqie://golden-three-chapters`

**数据迁移**：旧 `data/` 的 1 本小说设定（含 12539 字大纲、5 个角色）+ 11 章正文（28328 字）+ 6 条发布任务 → 新项目 `data/{novels,articles,publish_tasks}.json`（按新 schema 映射，`originalityScore` 保留）。

**类型新增（纯可选字段，供迁移无损落库）**：`Article.originalityScore`；`Novel.{genre,synopsis,outline,worldSetting,goldenHook,characters,targetWordsPerChapter,status}`。

**有意不移植**：`mark_published`（真实发布无需人工回标）；旧 `create_novel/get_novel/update_novel` 的本地设定读写（设定字段已并入 `Novel`，经资源 `fanqie://novels` 读取）。

**验证**：`npm run build` 0 错；`npm run smoke` 全绿（23 工具 / 8 资源 / 本地调用）；真实后端只读校验 `set_book_tags(confirm=false)` → `can_modify=true`；`check_originality` 在迁移语料上 → `compared_with=10`。

---

## 11. 修改能力补充（2026-10-17）

目标：补齐「改」的能力 —— 本地文稿可改、本地小说设定可改、已发布作品信息可改；顺带修 `set_book_tags` 的路由 bug。分档落地，写操作一律沿用两段式（`confirm=false` 只填表/截图，`confirm=true` 才提交）。

**P0 本地侧（纯本地，零风险）**
- `save_article` 加可选 `article_id` → **upsert 改稿**（`title`/`kind` 变可选，只覆盖显式传入字段）。
- 新增 `update_novel`（`services/localNovel.ts`）：改 `data/novels.json` 的作品设定，只覆盖显式传入字段。
- 新增 `import_articles_from_dir`（`services/library.ts`）：从磁盘工作稿目录批量导入。识别 `第NN章_标题.md` 的章号与标题、剥掉 `> **本章概要**` 元信息块、跳过「合稿」文件；按 `novel_id + 章号` upsert，已存在则**只覆盖正文**、保留状态与发布时间。默认 `confirm=false` 只返回待新建/待更新清单。
- `core/paths.ts` 新增 `resolveLoosePath`：相对路径按「项目根 → 工作区根」解析；**禁止 `process.cwd()`**。

**P1 修 `set_book_tags` 路由 bug**
- 旧实现用的 `/main/writer/{bookId}/edit` 根本不存在（是猜的）。真实入口是 `book-info/{bookId}?type=1` + 点 `button.create-btn`（文字「修改」）→ 展开的是**页面内联表单**（底部才有「立即修改」）。
- 标签选择是**二级弹窗**：点标签行（`#selectRow` 阅读 / `#activitySelectRow` 内容）弹出独立 `.arco-modal.category-modal`（标题即「阅读标签」/「内容标签」，选项 `.category-choose-item`，`active`=已选，按钮「取消/确认」）。
- 实测三个坑：① 弹窗容器一出现就带 `zoomModal-appear` 动画类，**选项延迟渲染**（一开始选项数=0）→ 必须等到选项数 > 0；② DOM 里可能同时有多个 `.arco-modal` → 必须按**弹窗标题**定位；③ 点选项后必须点弹窗「确认」才落到表单，点「取消」丢弃；**Escape / 再点触发器关不掉弹窗**（会被浮层遮挡）。
- 标签语义统一为「**确保处于选中**」：已选中的跳过（再点会变成取消）。不做替换 / 删除。

**P2 远端改**
- 新增 `update_novel_info_tomato`：改书名(≤15)/主角名1、2(≤5)/简介(50–500)/阅读标签/内容标签；`set_book_tags` 改为它的薄包装（只传标签）。
- 客户端前置校验：书名、主角名、简介字数；内容标签上限 plot≤4 / emotion≤2 / character≤4 / worldview≤1；至少给一个要改的字段。
- 预览路径返回 `filled` / `appliedReading` / `appliedContent` / `alreadySelected` / `selectedReading` / `selectedContent`，并截图。
- 新增 `update_chapter_tomato`（改已发布章节）：路由 `publish/{chapterId}/?enter_from=modifychapter`，复用 `chapter.ts` 的发布链路（下一步 → 内容检测方式 → 发布设置 → 确认提交）。两个设计取舍：
  - **预览不填充**：该编辑器边输入边自动保存，`confirm=false` 只打开修改页读现状（序号/标题/正文字数）+ 截图，避免「预览」把线上正文改了；
  - **`content` 可省**：不传正文＝保留线上正文、只改标题（`keepBody`）；复核按 `chapter_id` 取行再比对标题（不能用标题全表匹配 —— 改名后旧标题也在列表里），且比较前统一剥掉「第X章」前缀（序号框与标题框是两个独立输入）。

**验证**：`npm run build` 0 错；`npm run smoke` 全绿（27 工具 / 8 资源，含 `update_novel` 与 `import_articles_from_dir` 的本地夹具断言）；真机 `confirm=false` 预览：填表 + **加一个当前未选的新标签（悬疑）** + 回读表单行 = `[都市脑洞,悬疑,单女主,扮猪吃虎,打脸,系统]`；再重开页面只读回读线上标签 = `[都市脑洞,单女主,扮猪吃虎,打脸,系统]`（没有悬疑）→ 证明**点完弹窗「确认」但不点「立即修改」不会写线上**。

**首次真写（用户确认后执行，已实测可回滚）**：`update_chapter_tomato` 改第 5 章标题「科目由你定」→「科目由你来定」，成功；再改回「科目由你定」，成功（第 4 章未受影响）。实测发现：提交后该章状态变「修改审核中」，**章节列表的标题会滞后约 1–2 分钟**才更新，所以复核逻辑改为「轮询最多 30s 等标题生效；若已驱动完提交流程（`drivePublishDialogs` 返回 true）则按『已提交、审核中』报成功」，避免把成功当失败。

**本地批量导入（用户确认后执行）**：`import_articles_from_dir(confirm=true)` 扫描 17 个文件、识别 16 章 → 新建 5 章（第12–16章）、更新 11 章；核对 `list_articles`：16 条，第1–5章保留 `published` + `publishTime`，第6–16章 `draft`。

**工具数** 23 → 27（`+update_novel`、`+import_articles_from_dir`、`+update_novel_info_tomato`、`+update_chapter_tomato`）。

**仍未做（有意）**：标签的「替换 / 删除」语义（当前只做「确保选中」，要删标签得手工去后台）；`get_novel`（读设定走资源 `fanqie://novels`）。

---

## 12. 短故事「修改」补齐（2026-10-17）

起因：梳理 28 项能力时发现三类作品（小说 / 章节 / 短故事）里只有**短故事缺「修改」**——此前要改已发布的短故事，只能用 `publish_short_story_tomato`（`item_id` + `title`/`content`）顺带改，且 `confirm=true` 会一路走到**发布**，没有「只改不发布」的入口。

**新增 `update_short_story_tomato`**（`services/short.ts` 的 `updateShortStory` + `tools/shortStory.ts` 注册）
- 入口：`/publish-short/{item_id}` 编辑页（复用短故事编辑器的 `SHORT_SELECTORS` 与 `fillTitle` / `fillBody` / `selectCategories` / `chooseUseAI` / `uploadCover` / `saveDraft`）。
- 只覆盖**显式传入**的字段：`title` / `content`（或 `file_path` / `article_id`）/ `categories` / `cover_path` / `use_ai`；至少给一个，否则报错。
- `confirm=true` → 填表后**只点「存草稿」**（`action=updated`），**不发布**；要发布另走 `publish_short_story_tomato`。
- `confirm=false` → 只打开编辑页**读现状 + 截图，完全不填充**（保守：短故事编辑器可能存在自动保存副作用，且目标是已有作品，误填可能改动线上；与 `update_chapter_tomato` 的取舍一致）。读现状走页内 `readShortInPage()`（`edit/v1`）拿标题与字数。
- 顺手清理：把原 `verifyDraft(page, itemId, title)`（多余的 `title` 形参从未被比较）拆成 `readShortInPage()` + `verifyDraft(page, itemId)`，供预览读现状与存草稿复核共用。
- `ShortStoryResult.action` 新增 `"updated"`；`article_id` 命中时回写文稿库 `tomatoItemId` / `lastMessage`。

**边界**：已发布的短故事可能不允许再次修改（以页面/后台为准）；页面拿不到名称输入框时返回明确指引（可能不存在 / 不可编辑）。

**验证**：`npm run build` 0 错；`npm run smoke` 全绿（**28 工具** / 8 资源）。

**工具数** 27 → 28（`+update_short_story_tomato`）。**仍未做（有意）**：`get_novel`（读设定走资源 `fanqie://novels`）。

---

## 13. 短故事发布链路修正：四个必填门（2026-10-17/18）

背景：真机首发《青石巷的第三十八步》时，点「下一步」**毫无反应**，一度误判为「按钮坏了 / 需要腾空标题绕查重」。

**根因**：下载编辑页打包文件 `PublishShort.9431f235.js` 反查 `handleClickPublish`，发现「下一步」在提交前有**硬校验链**，任一不满足即 `te.A.warning(...)` 后 `return`——而这类提示是 **3 秒自动消失的 toast**，截图晚于 3 秒就什么都看不到。校验顺序：

1. 标题（含空格 / 空 / 超 `ps=25` 字）→ `check_pre` 查重（`check_type=1 && is_hit`）→ 红条常驻；
2. 正文字数（`Jl=100` ~ `BW=100000`）；签约作品另有 `Jx=5000` 下限；
3. 推荐标题合法性；
4. **封面**：`if (!f.uri) { warning("请上传封面"); return }`；
5. 分类：至少 1 个、必含主分类、≤ 8 个；
6. **试读比例**：`getExistNodes("payNode").length > 0` 且 `validateThreshold()` 通过、`percentage` 在 `[0.3, 1)`；
7. **发布协议**：`if (!S) { 高亮 signLicense; return }`；
8. 审核不通过内容 / 错别字未改；
9. **是否使用AI**：`if (null == E) { warning("请选择是否使用 AI"); return }`；
10. 章节格式 / 错别字自检 → 弹「发布提示」（`继续发布` / `取消`）→ `onOk` 进下一步；
11. 「提交确认」弹窗（`.publish-confirm-container`，含「未上传封面图，系统将自动按照分类匹配」「可试读比例」）→ 点「确定」→ `handlePublish` 真正发布。

**同时推翻两条旧结论**：
- **「标题腾空 workaround」不必要**：`check_pre` 在本条草稿标题 == 表单标题时仍返回 `check_resp_list: []`（不把草稿自身算重复）。原 `publishShortStory` 里那段「先存空标题再写回」的绕法已删除。
- **「发布协议不是前置」错误**：它确实是硬门。旧结论源于**点法不对**——复选框 JS click（input / label / mask）全部无效，唯一有效路径是**真实鼠标点协议文字** `.publish-short-config-checkdesc` → 弹「短故事发布事项」→ 点「我已阅读并同意」。旧代码在「下一步」**之后**等这个弹窗，位置也错了（应在「下一步」之前就勾上）。

**另一个隐蔽坑**：封面抽屉（`.ai-story-cover`）关掉后**残留一层遮罩**，会吃掉后续所有**真实鼠标点击**；`element.click()` 不受影响。所以链路顺序被固定为：**发布协议（真实点击）→ 是否使用AI → 试读比例 → 封面 → 存草稿 → 下一步（JS click）→「继续发布」→「提交确认」（JS click 确定）**。踩过的坑：封面抽屉的 tab 不是 `.arco-tabs-tab`，而是 `div[role="tab"].arco-tabs-header-title`；上传后要点「确认上传」（有时还有一层「确定」）。

**代码改动**（`src/services/short.ts` + `src/tools/shortStory.ts`）
- 新增 `SHORT_PUBLISH_SELECTORS`（封面 / 封面已设置 / 抽屉 tab / 试读「去设置」/ AI 单选 / 协议文字），把上述逆向结论写成注释钉在选择器旁边。
- 重写 `uploadCover`：开抽屉 → 切「本地上传」→ 勾图片上传协议 → 塞文件 → 「确认上传」→（「确定」）→ 校验已设置；重试 3 次。
- 新增 `acceptPublishTerms`（真实点击 + 弹窗同意 + 回读 `checked`）、`ensurePayNode`（点「去设置」落 30% 试读线）、`readPublishGates`（四门自检）、`clickConfirmModalOk`、`jsClickButton`（避遮罩）、`waitFor`、`readToasts`。
- `readShortInPage` 扩展返回 `publishStatus / displayStatus / bookThumbUri`，发布成功以 `publish_status === 1` 复核（原先靠「有没有出现发布按钮」猜）。
- `publishShortStory` 的 `confirm=true` 路径重写：**`use_ai` 缺省直接拒绝**（合规声明不替用户猜）；四门补齐 → 自检 → 「下一步」→ 抓 toast（过滤掉常驻的审核工作时间提示）→「继续发布」→「提交确认」→ 复核；失败一律给出「缺了哪一项」。
- 删除死代码 `acceptShortTerms` / `clickPublish`；`chooseUseAI` 改用实测容器 `[class*="publish_short_config_use_ai"]` 并回读是否选中。

**真机首发结果**（本轮实际发布）：item_id `7697662166328951320`，《青石巷的第三十八步》11638 字，分类 悬疑惊悚(1385)/推理(61)/职场(127)，封面 `book_thumb_uri=novel-pic-r/6c671292835878e5076281feb5aa821a`（600×800 竖版自制封面），`use_ai=是`，试读 30%，勾了发布协议 → 页面出现「返回短故事管理 / 再写一篇」，`edit/v1` 的 `publish_status=1`、`list_short_stories_tomato(status="all")` 可见该条。**注意**：提交时约 01:00，落在审核非工作时间，作品会卡在「审核中」直至次日早上 7–9 点。

**验证**：`npm run build` 0 错；`npm run smoke` 全绿（28 工具 / 8 资源）；发布工具 `confirm=false` 预览路径真机回归通过。

---

## 14. 微头条：新建微头条工具 + 短故事发布后引流建议（2026-10-18）

**需求**：① 新增一个语义为「新建微头条」的工具；② 每次发布短故事后**主动询问用户是否要发微头条**，用户确认后**根据该短故事自动生成表单内容**、再让用户确认后提交。

### 侦察结论（真机逆向）
- 「微头条」在番茄作者后台 = **作品管理 → 短篇作品 → 作品推荐** = `/main/writer/short-recommend`（草稿箱 `/main/writer/short-recommend-draft`）。形态是「**文字 + 书籍卡片**」，卡片指向自己的短篇作品。
- API 前缀 `short_article/wtt_*`：
  - 只读 GET：`wtt_list`（已发列表，含 `status` / `read_count` / `card_book_id` / `can_modify` / `can_delete` / `cant_modify_reason`）、`wtt_draft_list`（草稿箱）。
  - **只读 POST**：`card_list`（可选卡片列表）——实测**免签名**，直接 fetch 可用 → 为此在 `browser/endpoints.ts` 新增 `apiPostQuery()`（区别于写接口，仅用于这种免签名只读 POST）。
  - **写接口**：`publish_wtt`（`is_draft=1` 存草稿 / `is_draft=0` 发布）、`delete_wtt` → 带 `msToken`/`a_bogus`，手工 fetch 必 `-2 参数有误`，**必须点页面按钮**（沿用硬约束 1）。
- 编辑器是右侧**抽屉**：正文 `textarea`（默认值 `#故事推荐#`）+「添加图片」+「添加短篇」。「添加短篇」弹 `.arco-modal.short-modal`「插入短篇」，点 `.short-select-item` → `.short-select-item-selected` → 「确定」把卡片关联进去。
- **前端硬门**（只弹 toast 提示，不报错）：正文 `<10` 或 `>1500` 字（`警告`）、未关联短篇 →「请添加短篇内容」。
- 平台约束（非硬门，来自官方教程 / UI）：正文建议 **≤500 字**、账号**每天最多 10 条**、页面 UI 提示最多 **3 张图**。

### 实现
- 新增 `src/services/microHeadline.ts`（业务 + UI 驱动，顶部 `MICRO_SELECTORS`）：
  - 常量 `WTT_MIN_CHARS=10` / `WTT_MAX_CHARS=1500` / `WTT_HINT_CHARS=500` / `WTT_MAX_IMAGES=3` / `WTT_DAILY_LIMIT=10`。
  - 只读：`listMicroHeadlines()` / `listMicroHeadlineDrafts()`（走 `apiGet`）、`fetchMicroHeadlineCards()`（走 `apiPostQuery`）。
  - 写：`createMicroHeadline()`（打开抽屉 → 填正文 → 选短篇卡片 → `confirm=false` 只填表 + 截图、`confirm=true` 才点发布 / 存草稿）。
  - 生成器：`buildMicroHeadlineDraft()` —— **纯本地确定性生成**：`#故事推荐#` + 开篇节选（按**句边界**截断）+ 作品卡点句 + 话题标签；返回值带 `warnings` 提示人工润色。生成结果写进 `content` 让用户确认，用户确认后 `confirm=true` 提交（**省略 `content` 结果一致**，服务层会重新生成同一份）。
- 新增 `src/tools/microHeadline.ts`：`create_micro_headline_tomato`、`list_micro_headlines_tomato`；`src/index.ts` 注册并把启动日志改为 **30 个工具**。
- `src/tools/shortStory.ts`：新增 `withMicroHeadlineSuggestion()`，`publish_short_story_tomato` 成功后在返回体里附 `microHeadline`（`ask` 问句 + `draftContent` 预览 + `how` 调用示例），并更新工具 description。**「询问用户」用返回体里的建议块实现**（不使用 MCP elicitation，兼容所有客户端）。
- `src/core/text.ts`：新增 `stripHtml()`。短故事 `edit/v1` 的正文是 `<p>` 片段，**生成引导语前必须 `stripHtml`**，否则标签会混进微头条正文（已修）。
- `src/resources/index.ts`：`fanqie://publish-rules` 增加 `microHeadline` 规则块（字数门 / 每日上限 / 需关联短篇 / 两段式）。
- `src/browser/endpoints.ts`：新增路由常量 `shortRecommendUrl` / `shortRecommendDraftUrl`、5 个 `wtt_*` API 常量、`apiPostQuery`。

### 为什么这样取舍
- **不做 `delete_micro_headline_tomato`**：`delete_wtt` 是写接口 → 得走草稿箱 UI hover → `.serial-icon-general_delete` → 确认（同短故事草稿删除的坑，SVG 没 `.click()`）。当前价值低，先不铺工具面。
- **额外加只读的 `list_micro_headlines_tomato`**：发布后能看到推荐状态（`小流量推荐` 等）与 `read_count`，便于复盘引流效果；属额外新增，如不需要可移除。
- **生成器不做 LLM 调用**：MCP 服务本身不接模型，且确定性输出可复现、可让用户直接确认。

### 验证
- `npx tsc --noEmit` 0 错；`npm run build` 通过；`npm run smoke` **全绿（30 工具 / 8 资源）**（`EXPECTED_TOOLS` / `EXPECTED_RESOURCES` / publish-rules 微头条断言已同步）。
- **真机预览**：`create_micro_headline_tomato(item_id=7697662166328951320, confirm=false)` 返回 `ok:true` / `action:filled-not-submitted` / `chars:485` / 卡片《青石巷的第三十八步》；截图 `data/screenshots/micro-filled-*.png` 确认表单已填、卡片已关联；**未提交**，`wtt_draft_list` 仍为 0 条（无副作用）。
- 测试账号已有 1 条微头条（10-18 01:37，状态「小流量推荐」）；注意其 `card_book_id=7697677022889348120` **与 `item_id=7697662166328951320` 不同** → 选卡片时**按标题匹配**，不能按 id 匹配。

**工具数** 28 → 30（`+create_micro_headline_tomato` `+list_micro_headlines_tomato`）。**仍未做（有意）**：`delete_micro_headline_tomato`；**未做真实发布验证**（`confirm=true` 会产生线上公开内容，需用户确认后执行）。

---

## 15. 远程接入：Streamable HTTP 传输（2026-10-18）

**需求**：MCP 项目支持远程 —— 让本机之外（局域网 / 云端 Agent）也能接入这个服务。

### 拍板结论（与用户确认）
- 传输用 **Streamable HTTP**（MCP 2025-03-26 起标准），**不做**已废弃的 HTTP+SSE 老协议。理由：老协议是过渡方案，多数客户端已支持新标准；同时挂两套端点会成倍增加维护面。
- 安全默认：**强制 Bearer Token + 默认只监听 `127.0.0.1`**，另提供 `FANQIE_HTTP_READONLY=1` 只读模式。理由：这服务能驱动真实浏览器改线上正文，裸奔的 HTTP 端点等于把作者后台整个交出去。

### 实现
- `src/core/remote.ts`（新增，**不 import SDK / node:http**）：`remoteRequested()`、`remoteOptions()`（缺 Token 或 <16 字符直接抛错）、`isLoopback()`、`isWriteTool()`（显式 19 个写工具名单 + `^(login|set|create|update|add|save|delete|publish|batch|import)_` 前缀正则兜底）、`describeRemote()`（给 `--selfcheck`）。
- `src/http.ts`（新增）：`node:http` 手写路由，不引入 express。
  - `POST {path}`：解析 JSON 体 → 只读模式先在协议入口拦 `tools/call` 的写工具（`403` + `-32003`）→ 按 `mcp-session-id` 复用一个 `StreamableHTTPServerTransport`，无会话且是 `initialize` 才新建（stateful，每会话一个 `Server`，避免请求 ID 串号）。
  - `GET/DELETE {path}`：SSE 流 / 会话销毁，缺有效会话返回 `400`。
  - `GET /health` `/healthz`：**唯一免鉴权端点**，只回 `{ok,name,version,transport,readonly}`。
  - 鉴权：`Authorization: Bearer <token>`，两侧 sha256 后 `timingSafeEqual`（不泄漏 Token 长度 / 前缀）；失败 `401` + `WWW-Authenticate`。
  - 请求体上限 8MB；日志仍走 stderr；`SIGINT/SIGTERM` 优雅关闭（先关会话再关 server，兜底 3s 强制退出）。
  - 启动打印 `远程端点已就绪: http://host:port/path（Bearer 鉴权 / 可写模式）`，是 `scripts/smoke.mjs` 的解析锚点。
- `src/index.ts`：`--http` / `FANQIE_TRANSPORT=http` 时**动态** `import("./http.js")`，复用同一个 `buildServer()`；stdio 仍是默认分支（不加任何 http 相关副作用）。`--selfcheck` 输出追加 `remote` 段。
- `package.json`：新增 `start:http`；`.env.example` / `README.md`（§1.2 + §6.1 + §8）/ `AGENTS.md`（硬约束 13）同步。

### 为什么这样取舍
- **拦截做在 HTTP 协议入口，不改 `buildServer()`**：只读是「远程暴露」的风险控制，本地 stdio（WorkBuddy）应保持全功能；也不去改 8 个 `registerXxxTools` 的签名。
- **不引入 express / cors / helmet**：SDK 自带 `StreamableHTTPServerTransport`，`node:http` 足够；少一个依赖少一份供应链风险。
- **会话不做无状态**：本服务是「本机浏览器 + 本地 JSON」，没有 serverless 场景，stateful 更贴近官方示例、也便于按会话关闭。
- **不做 OAuth / 多用户**：单机单用户的作者后台自动化，Token 就够；多租户不在目标内。

### 验证
- `npm run build` 0 错；`npm run smoke` **全绿**，远程阶段断言：端点通告 / `/health` 免鉴权 200 / 无 Token `401` / 远程真协议列出 30 工具 / 远程可调用只读与写工具 / `FANQIE_HTTP_READONLY=1` 时 8 个写工具（含 `login_tomato`、`publish_short_story_tomato`、`export_article`）全部被 `403` 拦截、只读工具照常。
- 手动验证：无 `FANQIE_HTTP_TOKEN` 启动 exit 1 并给出生成命令；`FANQIE_HTTP_TOKEN=short` exit 1；`FANQIE_TRANSPORT=http FANQIE_HTTP_PORT=0` 能通告真实端口。
- 全程**未触网**：远程冒烟用临时数据目录 + `FANQIE_ENABLE_BROWSER=0`，写工具即使漏拦也只会报「浏览器能力已关闭」。

---

## 16. npm 发布准备：files 白名单 + 数据目录三级解析（2026-10-18）

**需求**：把服务发布到 npm（`npx fanqie-autopub-mcp`），让用户不再需要 clone 仓库。

### 拍板结论
- **发（做发布准备），但说清楚它省的是什么**：npm 只解决「安装 + 配置可移植 + 升级」；Node、本机 Chrome、**每人各自扫码登录**这些门槛一步都不会少——写操作必须驱动真实页面（签名由页面 JS 算），所以这服务**永远是本地运行**，发 npm 不等于变云服务。
- **发布前必须先修两件事**，否则体验反而更差：
  1. **数据目录**：原来 `DATA_DIR = 包根/data`，走 npx 时那就是 npm 缓存目录（`_npx/<hash>`），`npm cache clean` / 版本更新就会把 cookies 和文稿库一起带走。
  2. **tarball 白名单**：原来没有 `files` 字段，排除完全依赖 `.gitignore` 兜底——这是脆弱假设，一旦改坏，**有效 cookies 会公开到 registry 且不可撤销**。

### 实现
- `src/core/paths.ts`：新增 `USER_DATA_DIR = ~/.fanqie-autopub`、`DataDirSource`、`resolveDataDir()`；三级解析 `FANQIE_DATA_DIR` → `<项目根>/data`（存在即用）→ `~/.fanqie-autopub`；导出 `DATA_DIR_SOURCE`。
  - 第 2 级存在的意义：**保住仓库内 / clone 用法的历史行为**（`data/.gitkeep` 已把目录建出来），不破坏现有 `D:\番茄小说\fanqie-autopub-mcp\data` 里的登录态与文稿库。
  - 第 3 级带 `.gitkeep`-无关的判定：发布包**不含** `data/`（被 `files` 白名单挡掉），所以 npm 用户的第 2 级判定必然落空，只会拿到用户目录。
- `src/index.ts`：`--selfcheck` 之后、起传输之前打一行 `数据目录: <path>（来源: env|project|user）`（stderr，不碰 stdout 协议）；不改自检 JSON 的纯净性。
- `src/services/auth.ts`：`details` 增加 `data_dir` / `data_dir_source`（`get_publish_status`、`fanqie://status`、`get_stats` 顺带都有）。
- `package.json`：`files: ["dist","README.md","LICENSE"]`；`prepack: npm run build`（`npm pack` 与 `npm publish` 都会先构建，杜绝「改了 src 忘 build 就发」）；补 `repository` / `homepage` / `bugs`。选 `prepack` 而非 `prepublishOnly`：后者不管 `npm pack`，而白名单验证恰恰要靠 `pack`。
- 文档：README 新增 §1.3（npx 用法 + 数据目录必读）、§6 表格、§7 结构注、§8 排障行；`.env.example` 存储段；AGENTS.md 新增硬约束 14。

### 为什么这样取舍
- **不做「自动迁移」**（把旧 `data/` 拷到用户目录）：不可见地复制含有效登录态的目录，风险大于收益；改为**保留旧路径优先**，天然零迁移。
- **不从 `.gitignore` 换成 `.npmignore`**：白名单（`files`）比黑名单安全——新增文件默认不发；`.npmignore` 是反向逻辑，漏一条就是泄漏。
- **不把数据默认值直接切到用户目录**：会静默废掉现有安装的登录态，且与 AGENTS.md/README 的 clone 工作流冲突。

### 验证
- `npm run build` 0 错；`npm run smoke` **全绿**（30 工具 / 8 资源 / 远程链路，exit 0）。
- `npm pack --dry-run --json`：35 个文件，只有 `dist/**` + `package.json` + `README.md` + `LICENSE`；**无 `data/`、`src/`、`scripts/`、`docs/`、`tomato_cookies.json`、`.env*`**。
- 端到端模拟 npx：把 tgz `npm install` 进空目录（120 包）后运行 `--selfcheck` → `data_dir = <fakehome>\.fanqie-autopub` / `source=user`（包目录里确实没有 `data/`）。
- 回归：仓库内运行 → `data_dir = D:\番茄小说\fanqie-autopub-mcp\data` / `source=project`（历史行为不变）；`FANQIE_DATA_DIR=…` → `source=env`。三者 `--selfcheck` 均 exit 0，启动日志新增行未破坏 `scripts/smoke.mjs` 的 stderr 锚点解析。

**后续（2026-10-18 当天补齐）**：已用「勾了 Bypass 2FA 的 granular token」以 `npm publish` 正式发布 `fanqie-autopub-mcp@1.0.0` 到公共 registry（`latest = 1.0.0`，35 文件 / 335,731 B；账号 `tfa=false` 时这是唯一可行路径——npm 现要求「2FA **或** 带 Bypass 2FA 的 granular token」，见 AGENTS.md「提交前必须知道」）。registry 上另留了一个 npm 自动创建的 `0.0.0-stage` 占位版本（staged publishing 机制，340 B 空壳，无害）。当天随后又发布了 `1.1.0`（含 §17 的回环免鉴权 + 数据目录改动，35 文件 / 338,415 B；复核时发现版本号硬编码的问题，见 §18）。

---

## 17. 远程鉴权放宽：回环地址免鉴权（2026-10-18）

**需求**：用户希望远程 HTTP 模式「不需要鉴权」。

**拍板（与用户确认后选的方案）**：
- **仅本机免鉴权**：`FANQIE_HTTP_HOST` 是回环地址（`127.0.0.1` / `localhost` / `::1`，判定复用 `isLoopback()`）时**允许不设 `FANQIE_HTTP_TOKEN`**，端点完全不校验 `Authorization`。
- **非回环仍然强制**：绑 `0.0.0.0` 等地址且无 Token → `remoteOptions()` 抛错、进程 exit 1；给了 Token 但 <16 字符同样拒绝。
- 未采纳的两个更激进选项（用户明确没选）：① 任何地址都可裸奔（只打告警）；② 免鉴权时自动降级只读。理由：这个端点能驱动真实浏览器改线上正文，「回环免鉴权」已经覆盖了本机自用这个真实场景，再放就没有任何兜底了。

### 实现
- `core/remote.ts`：`RemoteOptions.token` 改 `string | null`，新增 `authRequired`；`remoteOptions()` 先解析 host 再判 Token（缺 Token 且非回环才抛错，错误信息直接给出「改回环」或「补 Token」两条路）；`describeRemote()` 新增 `auth_mode: "bearer" | "none"`。
- `http.ts`：鉴权判断改为 `if (opts.token && !authorized(...))`——没配 Token（只可能是回环）就彻底不校验；启动日志区分 `（Bearer 鉴权 / …）` 与 `（本机免鉴权 / …）`，免鉴权时额外 `logger.warn` 说明「同机任何进程都能调用」。日志格式与 `scripts/smoke.mjs` 的端点正则兼容（URL 捕获仍止于全角括号前）。
- `scripts/smoke.mjs`：新增 8 条断言——免鉴权启动/日志字样/`/health`/不带 Authorization 列 30 工具/不带 Authorization 调工具，以及「非回环 + 无 Token」「Token 太短」两条拒绝启动分支（新增 `runToExit()` 辅助函数读退出码与 stderr）；原有「配了 Token 时无 Token 请求 401」保留；两个远程启动辅助函数显式固定 `FANQIE_HTTP_HOST=127.0.0.1`，避免外部 shell 变量把冒烟带偏。
- 文档：README §1.2（拆成「本机零配置免鉴权」+「对外必填 Token」两段、安全约定表、§4、§6.1、§8 两行）、`.env.example`、AGENTS.md 硬约束 13② 与命令段。

### 验证
- `npm run build` 0 错；`npm run smoke` **全绿 76 项 PASS / 0 FAIL（exit 0）**，其中新增的 8 条见上。
- 真机手工验证：无 Token 起 `--http` → 日志 `远程端点已就绪: http://127.0.0.1:8791/mcp（本机免鉴权 / 可写模式）` + 免鉴权 WARN；`Invoke-WebRequest` 不带任何请求头 `POST /mcp` 的 `initialize` → **HTTP 200 且返回 `mcp-session-id`**；`--selfcheck` 显示 `token_set:false` / `auth_mode:"none"` / `error:null`；`FANQIE_HTTP_HOST=0.0.0.0` + 无 Token → exit 1，报「绑定非回环地址 0.0.0.0 时必须设置 FANQIE_HTTP_TOKEN」。
- 回归：带 Token 的老用法行为不变（冒烟里 401 / 30 工具 / 写工具 / 只读拦截全过）。

**安全影响（须知）**：免鉴权只对回环地址开放，等同「同机任何进程可调用」，不再有 Token 作为兜底；跨机 / 云端接入的行为与之前完全一致（仍强制 Token）。

---

## 18. 服务版本号改为读 package.json（2026-10-18）

**怎么发现的**：发布 1.1.0 后做真机复核，把 registry 上的包装进空目录跑起来，`GET /health` 报的是
`{"ok":true,…,"version":"1.0.0"}`——包是 1.1.0，服务却自称 1.0.0。

**原因**：`src/index.ts` 里 `const SERVER_VERSION = "1.0.0";` 是写死的字面量，`npm version` 只改
`package.json`，没人去改这个常量。它喂三处，于是**一起漂**：`GET /health` 的 `version`、MCP `initialize`
响应的 `serverInfo.version`、stdio 启动日志的 `fanqie-autopub-mcp vX 已就绪`。

**修法**：`core/paths.ts` 新增 `PACKAGE_VERSION`（基于已有的、以 `import.meta.url` 解析的 `PROJECT_ROOT`
读 `package.json`，读不到退回 `"0.0.0"`），`index.ts` 的 `SERVER_VERSION` 改为引用它。`dist/index.js`
与仓库内 `src/` 两种布局下 `PROJECT_ROOT` 都指向包根，`package.json` 也在 npm 白名单里（`files` 含
`package.json` 是 npm 默认行为），故 npx / clone 两条路都能读到。

**防复发**：`scripts/smoke.mjs` 新增 2 条断言——stdio 的 `client.getServerVersion()?.version` 与远程
`/health` 的 `version` 都必须等于 `package.json` 的 `version`（冒烟自己读 `package.json`）。再出现
「发了新版、服务报旧版」会直接 FAIL。负向测试过：把 `dist/core/paths.js` 的版本伪造成 `9.9.9` 后
冒烟精确报出那 2 条 FAIL、exit 1，说明断言不是空转。冒烟当前 **85 项 PASS / 0 FAIL**。

**为什么不顺手 bump 1.1.1 重发**：已发布的 1.1.0 只是**报出来的版本号**旧，功能（免鉴权、数据目录三级
解析）都已验证正常；重发要再建一次 Bypass-2FA token。留到下次有实质变更时随版本一起带上。

