# fanqie-autopub-mcp

番茄小说（fanqienovel.com）作者后台**自动发布 MCP**：登录、新增小说、新增小说章节、新建/发布短故事、新建微头条（给短故事引流），并附带定时发布、短故事分章、批量上传、本地文稿库。

- 传输：stdio（WorkBuddy / Claude Desktop / 任意 MCP 客户端）
- 运行时：Node ≥ 20 + 本机 Chrome/Edge（`puppeteer-core`，不下载 Chromium）
- 存储：`data/` 下的 JSON（原子写），无原生模块、无数据库
- 安全策略：**所有写操作默认 `confirm=false`（只填表不提交），必须显式 `confirm=true` 才真正提交**

---

## 1. 快速开始

```powershell
cd D:\番茄小说\fanqie-autopub-mcp
npm install
npm run build      # tsc -> dist/
npm run smoke      # 协议级冒烟（不触网，全绿才算就绪）
```

登录并自检：

```
login_tomato              # 弹出真实浏览器，你扫码/过验证码，服务只轮询登录态并保存 cookies
get_publish_status        # 返回 ready=true 即可开始使用
```

命令行排障（连接器未生效时）：

```powershell
node scripts\mcp-cli.mjs --list                                  # 列出工具
node scripts\mcp-cli.mjs --resources                             # 列出资源
node scripts\mcp-cli.mjs get_publish_status verify_login=false   # 调用工具（key=value）
node scripts\mcp-cli.mjs --res fanqie://publish-rules            # 读资源
```

> Windows PowerShell 传复杂 JSON 建议用环境变量：
> `$env:MCP_ARGS='{"book_id":"1234567890"}'; node scripts\mcp-cli.mjs list_chapters_tomato`

### 注册到 WorkBuddy

`~/.workbuddy/mcp.json` 已加入：

```json
{
  "mcpServers": {
    "fanqie-autopub": {
      "command": "node",
      "args": ["D:\\番茄小说\\fanqie-autopub-mcp\\dist\\index.js"],
      "env": {
        "FANQIE_ENABLE_BROWSER": "1",
        "FANQIE_CHROME_PATH": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
    }
  }
}
```

改完后需在 WorkBuddy 连接器页点「信任」并重启会话。

---

## 2. 工具清单（30 个）

### 2.1 登录与状态（3）

| 工具 | 说明 |
|---|---|
| `login_tomato` | 半自动登录：开真实浏览器，你扫码/过验证码；服务只轮询登录态并保存 cookies，**不碰账号密码** |
| `set_tomato_cookies` | 手动导入 cookies（文本或文件路径） |
| `get_publish_status` | 环境自检：cookies / 浏览器驱动 / 后台可达性；`verify_login=true` 时实开浏览器校验登录态 |

### 2.2 小说：新建与修改（5）

| 工具 | 说明 |
|---|---|
| `list_novels_tomato` | 读后台真实小说列表；`sync_local=true` 可同步进本地登记（供批量上传用） |
| `create_novel_tomato` | 驱动 `/main/writer/create` 真实建书 → 返回 `book_id`。必填：书名(≤15字)/频道/主角名1、2(≤5字)/简介(50–500字) |
| `update_novel_info_tomato` | **改已有作品信息**：书名(≤15字)/主角名1、2(≤5字)/简介(50–500字)/阅读标签/内容标签。走「作品信息(type=1) → 修改 → 立即修改」；受作品信息审核锁保护。默认 `confirm=false` 只展开表单并截图 |
| `set_book_tags` | 只改「阅读标签 / 内容标签」的快捷入口（内部就是 `update_novel_info_tomato` 的薄包装）。**语义是「确保这些标签处于选中」**：已经选中的会跳过，不会误取消 |
| `update_novel` | **改本地小说登记 / 创作设定**（`data/novels.json`，**纯本地不碰后台**）：书名/频道/简介/主角名/标签/番茄书号绑定 + `genre`/`synopsis`/`outline`/`world_setting`/`golden_hook`/`characters`/`target_words_per_chapter`/`status`。只覆盖显式传入的字段，长文本可用 `*_file` 指向磁盘文件 |

> 标签的真实机制（实测）：点标签行 → 弹出独立分类弹窗（标题即「阅读标签」/「内容标签」，选项 `.category-choose-item`，`active`=已选）→ 点选项 → 点弹窗「确认」才落到**表单**。弹窗「确认」**不等于**提交作品信息，最后仍需表单底部的「立即修改」；已验证点完弹窗「确认」但不点「立即修改」时，线上标签原样不变。

### 2.3 小说章节（4，含批量）

| 工具 | 说明 |
|---|---|
| `list_chapters_tomato` | 读某本书的章节列表，用于复核与避重 |
| `add_chapter_tomato` | 序号+标题+正文 → 下一步 → 内容检测方式 → 发布设置(是否使用AI) → 确认提交 → 错别字二次确认 → 接口复核；支持 `scheduled_time` 定时发布 |
| `update_chapter_tomato` | **改已发布章节**：走章节列表的编辑入口 `publish/{chapterId}/?enter_from=modifychapter`，复用上面同一条发布链路，最后按 `chapter_id` 复核标题。正文可用 `content`/`file_path`/`article_id`；**都不给＝保留线上正文、只改标题**。⚠️ 该编辑器边输入边自动保存，所以 `confirm=false` 时**只打开修改页读现状 + 截图，完全不填充**（避免误改线上）；`confirm=true` 才填入并提交 |
| `batch_publish_chapters` | 从本地文稿库挑「待发布」章节，按序限速依次上传；单章失败不中断 |

### 2.4 短故事（7）

| 工具 | 说明 |
|---|---|
| `list_short_stories_tomato` | 短故事列表 / 草稿箱（`status=draft`） |
| `get_short_story_tomato` | 读详情：标题/字数/分类/签约状态/可否修改 |
| `create_short_story_tomato` | 新建并（可选）保存草稿；返回 `item_id` |
| `update_short_story_tomato` | **改已存在短故事**（`/publish-short/{item_id}` 编辑页）：标题/正文/分类/封面/是否AI。只覆盖显式传入的字段；`confirm=true` **只点「存草稿」（不发布）**；默认 `confirm=false` 只打开编辑页读现状 + 截图、**完全不填充** |
| `publish_short_story_tomato` | 发布：`item_id` 直发，或 `title`+`content` 新建并发布。**平台强制四项**：封面（`cover_path` 或沿用已有）、`use_ai=true\|false`（必须显式声明）、发布协议 + 试读比例（自动补齐）。发布后按 `publish_status=1` 复核 |
| `set_short_story_cover_tomato` | 上传本地封面图片（「封面设置 → 本地上传」抽屉；建议 600×800、jpg/png、≤5MB） |
| `delete_short_story_tomato` | 删除短故事/草稿（默认预览；confirm=true 时驱动草稿箱真实 UI 删除） |

> `publish_short_story_tomato` 发布成功后，会在返回里带一个 `microHeadline` 建议块（**请询问用户「要不要再发一条微头条引流」**，并附上自动生成的引导语草稿）。

### 2.5 微头条（短故事「作品推荐」）（2）

| 工具 | 说明 |
|---|---|
| `create_micro_headline_tomato` | **新建微头条**：给短故事引流（文字 + 书籍卡片）。给 `item_id` 会自动读短故事的标题/正文并**生成引导语**（`#故事推荐#` + 开篇节选 + 作品卡点句 + 话题标签），驱动 `作品推荐 → 新建微头条` 抽屉填表并关联作品卡片。**默认 `confirm=false` 只填表 + 截图，并把 `content` 回给你确认**；`confirm=true` 才提交（`draft=true` 则只存草稿箱） |
| `list_micro_headlines_tomato` | 读微头条列表（`drafts=true` 读草稿箱），含推荐状态、阅读量、可否编辑/删除 |

> 微头条规则（官方教程 + 2026-10 实测）：正文 **10–1500 字**（官方建议 ≤500）、图片最多 **3** 张、**每天最多 10 条**、**必须关联一个短篇**；推荐状态按内容质量给量（小流量推荐 → 热推中 / 审核不通过）。

### 2.6 本地文稿库（6）

| 工具 | 说明 |
|---|---|
| `save_article` | 正文入库（`data/articles.json`），返回 `article_id`，避免长文本反复走工具参数。带 `article_id` 时为 **upsert**（改稿），只覆盖显式传入的字段 |
| `list_articles` | 按 kind / novel_id / status 过滤列出 |
| `get_article` | 取回全文 |
| `export_article` | 导出成可直接粘贴到后台的文本文件（txt/md），返回绝对路径；适合人工发布 |
| `import_articles_from_dir` | **从磁盘工作稿目录批量导入**（`章节\第NN章_标题.md`）：自动识别章号/标题、剥掉 `> **本章概要**` 元信息块、跳过合稿文件，按 `novel_id + 章号` upsert（已存在则覆盖正文、保留状态与发布时间）。默认 `confirm=false` 只预览清单 |
| `delete_article` | 删除本地文稿（默认预览） |

### 2.7 知识库 / 质检（2）

| 工具 | 说明 |
|---|---|
| `list_genres` | 番茄主流赛道知识库：爽点机制、开篇要求、节奏、避坑清单、建议单章字数（不联网） |
| `check_originality` | 原创性 / AI 味检测：与文稿库其余条目做 n-gram 比对，并查自我复读、套话密度、对话占比、段落均匀度、字数门槛（不联网） |

### 2.8 统计（1）

| 工具 | 说明 |
|---|---|
| `get_stats` | 本地文稿/任务/登记汇总 + 环境自检；`remote=true` 时再读一次后台真实数据 |

### 2.9 本地小说设定（1）

| 工具 | 说明 |
|---|---|
| `update_novel` | 改**本地** `data/novels.json` 里的作品设定：书名/赛道(`genre`)/简介/大纲/世界观/黄金钩子/角色/目标单章字数/状态。长文本（简介、大纲、世界观、黄金钩子）可改传 `*_file` 给文件路径。纯本地、不碰浏览器，只覆盖显式传入的字段 |

---

## 3. MCP 资源（只读，不联网）

| URI | 内容 |
|---|---|
| `fanqie://status` | cookies / 浏览器驱动 / 后台地址等状态 |
| `fanqie://novels` | 本地小说登记 |
| `fanqie://short-stories` | 本地短故事登记 |
| `fanqie://articles` | 本地文稿库（不含正文全文） |
| `fanqie://tasks` | 发布任务日志 |
| `fanqie://publish-rules` | 发布限制须知（短故事字数区间、标签上限、定时支持范围） |
| `fanqie://genres` | 番茄赛道知识库（12 个赛道的完整设定） |
| `fanqie://golden-three-chapters` | 黄金三章方法论（markdown） |

---

## 4. 安全策略（重要）

- **两段式写操作**：所有写工具默认 `confirm=false`，只驱动页面填表并截图，**不点提交**；核对无误后传 `confirm=true` 才真正提交。
- **一律驱动真实页面**：番茄的写接口带 `msToken`/`a_bogus` 签名，手工拼签名不可行（会返回 `-2 参数有误`）。本服务让页面自身的 JS 计算签名，所以是「像人一样操作后台表单」，不是伪造请求。
- **限速与人工确认**：批量上传章节之间有 `interval_seconds` 间隔；发布链路保留人工确认环节，规避平台风控。
- **实名/人脸验证**：短故事发布可能触发实名/人脸验证；命中时服务会停止并截图提示，**不硬闯**。
- **失败必有证据**：失败自动截图到 `data/screenshots/`，并在返回里给出路径。

## 5. 已知边界

- **短故事「发布会静默失败」的三个必填门**（2026-10 逆向编辑页 `PublishShort.*.js` 的 `handleClickPublish` 实测）：点「下一步」时若 **封面**、**是否使用AI**、**发布协议**、**试读比例** 任一未补齐，页面**只弹一个 3 秒就消失的 toast**（`请上传封面` / `请选择是否使用 AI` / …）然后原样返回——很容易误判成「按钮没反应」。本工具的做法是：先按固定顺序补齐四项（协议 → AI → 试读 30% → 封面），再用 `readPublishGates` 自检，缺项直接报出原因而不是空跑。其中封面与「是否使用AI」是内容/合规决策，**工具不替用户猜**：封面靠 `cover_path`（或沿用草稿已有封面），AI 必须显式传 `use_ai`。
- **顺序坑**：封面抽屉关闭后会残留一层遮罩，**吃掉后续所有真实鼠标点击**（`element.click()` 不受影响）。所以「发布协议」必须点在最前面，其它按钮一律走 JS 点击。
- **发布成功判据**：`下一步` →（可能弹「发布提示」→「继续发布」）→「提交确认」弹窗 → 点「确定」才真正提交；本工具以 `edit/v1` 的 `publish_status=1` 复核。
- **夜间审核**：番茄审核工作时间 7:00–24:00，夜间提交会卡在「审核中」（期间无法修改/删除）直至次日早上 7–9 点。
- **定时发布仅用于小说章节**：短故事接口没有定时字段。
- **短故事删除走 UI**：`short_article/delete/v0/` 需页面签名，`delete_short_story_tomato` 通过驱动草稿箱（hover → 删除图标 → 确认弹窗）完成删除。
- **短故事字数**：官方要求 6000–80000 字（最佳 1w–3w）；低于/高于区间可存草稿但发布会失败。
- **微头条（作品推荐）**：入口在「作品管理 → 短篇作品 → 作品推荐」而非短故事编辑页。写入接口 `short_article/publish_wtt/v0/`（`is_draft=1` 存草稿 / `0` 发布）带签名，**只能点页面按钮**；本工具全程驱动抽屉 UI，并用只读的 `wtt_list` / `wtt_draft_list` 复核。前置校验（前端拦截、只弹提示不报错）：正文 <10 字 / >1500 字 / 未关联短篇。列表页的「编辑/删除」在部分状态（如审核中）会被置灰。
- **引导语是自动生成的底稿**：`create_micro_headline_tomato` 在没给 `content` 时按「开篇节选 + 作品卡点 + 话题标签」生成（纯本地、确定性），返回里带 `warnings` 提示人工润色——平台按内容质量给量，建议发布前过一遍。

---

## 6. 环境变量（都可省略）

| 变量 | 默认 | 说明 |
|---|---|---|
| `FANQIE_DATA_DIR` | `<项目>/data` | 数据目录 |
| `FANQIE_COOKIES_FILE` | `<data>/tomato_cookies.json` | cookies 文件 |
| `FANQIE_CHROME_PATH` | 自动探测 | Chrome/Edge 可执行文件路径 |
| `FANQIE_ENABLE_BROWSER` | 开启 | 设为 `0`/`false`/`off` 则彻底禁用浏览器能力 |
| `FANQIE_CHAPTER_URL_TEMPLATE` | 内置 | 章节发布页地址模板 |
| `FANQIE_DEBUG` | 关闭 | 设为 `1` 输出调试日志（stderr） |

---

## 7. 目录结构

```
src/
├── index.ts              # MCP 入口（stdio）
├── globals.d.ts          # page.evaluate 用到的 DOM 全局声明
├── types.ts
├── core/                 # paths / logger / result / store(原子写) / text(去 markdown)
├── browser/              # driver(puppeteer-core) / cookies / endpoints(路由与接口常量)
├── knowledge/            # genres(赛道知识库) / goldenThree(黄金三章)
├── services/             # auth / novel / chapter / short / library / stats / originality
├── tools/                # auth / novel / chapter / shortStory / library / knowledge / stats
└── resources/index.ts
scripts/
├── smoke.mjs             # 协议级冒烟（不触网）
└── mcp-cli.mjs           # 命令行直连 MCP
data/                     # cookies / articles.json / novels.json / ... / screenshots
dist/                     # WorkBuddy 实际加载入口（已入库，clone 后可免 build 直接运行）
```

> `dist/` 已特意入库以支持开箱即用；**修改 `src/` 后请 `npm run build`，并把新的 `dist/` 一并提交**，否则运行的是旧产物。

## 8. 故障排查

| 症状 | 处理 |
|---|---|
| 返回「cookies 已失效」 | 重新执行 `login_tomato` |
| 找不到本机浏览器 | 设置 `FANQIE_CHROME_PATH`，或 `npm i puppeteer`（自带 Chromium） |
| 选择器找不到 / 页面改版 | 选择器集中在 `src/browser/endpoints.ts` 与各 `services/*.ts` 顶部，按需补充；失败截图在 `data/screenshots/` |
| 章节发布后未复核到 | 到后台草稿箱确认；`list_chapters_tomato` 复核已发布数 |
