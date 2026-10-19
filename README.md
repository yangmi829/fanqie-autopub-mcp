# fanqie-autopub-mcp

番茄小说（fanqienovel.com）作者后台**自动发布 MCP**：登录、新增小说、新增小说章节、新建/发布短故事、新建微头条（给短故事引流），并附带定时发布、短故事分章、批量上传、本地文稿库。

- 传输：stdio（WorkBuddy / Claude Desktop / 任意 MCP 客户端）；也可用 Streamable HTTP 远程接入（见 §1.2）
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

### 1.1 注册到 WorkBuddy

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

> 不想 clone 仓库的，见 §1.3 的 npm / npx 安装方式。

### 1.2 远程接入（Streamable HTTP）

默认仍是 stdio（本地零改动）。要让别的机器 / 云端 Agent 接入，用 `--http` 或 `FANQIE_TRANSPORT=http` 启动 HTTP 端点。

**本机自用：零配置、免鉴权**（默认只监听 `127.0.0.1`，不设任何环境变量即可）：

```powershell
npm run start:http                     # 等价于 node dist/index.js --http
```

启动后 stderr 会打印真实端点（`FANQIE_HTTP_PORT=0` 时由系统分配空闲端口）：

```
远程端点已就绪: http://127.0.0.1:8765/mcp（本机免鉴权 / 可写模式）
```

客户端侧（任何支持 Streamable HTTP 的 MCP 客户端）——本机免鉴权时**不用带任何请求头**：

```json
{
  "mcpServers": {
    "fanqie-autopub": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

**让别的机器 / 云端 Agent 接入：绑非回环地址时必须设 Token**（不带 Token 会直接拒绝启动）：

```powershell
$token = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:FANQIE_HTTP_TOKEN = $token        # 绑 0.0.0.0 等非回环地址时必填
$env:FANQIE_HTTP_HOST  = "0.0.0.0"     # 默认 127.0.0.1；对外会打印告警
npm run start:http
```

```
远程端点已就绪: http://127.0.0.1:8765/mcp（Bearer 鉴权 / 可写模式）
```

这时客户端要在 `headers` 里带上 `"Authorization": "Bearer <你的 FANQIE_HTTP_TOKEN>"`。

手动核对（PowerShell）：

```powershell
Invoke-WebRequest http://127.0.0.1:8765/health -UseBasicParsing   # 探活：{"ok":true,...}
```

安全约定：

| 项 | 行为 |
|---|---|
| 监听地址 | 默认 `127.0.0.1`，只对本机开放；`FANQIE_HTTP_HOST=0.0.0.0` 才对外，届时会打印醒目告警 |
| 鉴权 | **回环地址（127.0.0.1 / localhost / ::1）可省略 Token ＝ 本机免鉴权**；一旦绑非回环地址则**强制** `FANQIE_HTTP_TOKEN`，缺失直接拒绝启动，短于 16 字符也拒绝。配了 Token 才校验请求，比对走常量时间，401 响应带 `WWW-Authenticate` |
| 只读模式 | `FANQIE_HTTP_READONLY=1`：协议入口拦截全部写工具（`publish_*` / `delete_*` / `save_article` / `export_article` …），只读工具与资源照常 |
| 传输 | MCP 标准 Streamable HTTP（会话按 `mcp-session-id` 维护），非废弃的 SSE 老协议 |

> 免鉴权只对**回环地址**开放：同机任何进程（包括别的 Agent / 脚本）都能调用该端点、含写工具。
> 这个端点能驱动真实浏览器改线上内容，所以**别把它绑到 0.0.0.0 还不设 Token**（服务会直接拒绝）；要对外暴露请放在反向代理 + HTTPS 之后，并给 Token 加轮换。

### 1.3 npm / npx 安装（不 clone 仓库）

包名 `fanqie-autopub-mcp`。**不需要 clone、不需要 build**，MCP 客户端里直接指 `npx`：

```json
{
  "mcpServers": {
    "fanqie-autopub": {
      "command": "npx",
      "args": ["-y", "fanqie-autopub-mcp@latest"],
      "env": {
        "FANQIE_ENABLE_BROWSER": "1"
      }
    }
  }
}
```

好处是这份配置**换机器 / 换系统都不用改路径**（§1.1 的 clone 方式要写死 `dist\index.js` 的绝对路径），升级就是 `@latest`。

命令行试跑（不启动传输，只打印环境自检后退出）：

```powershell
npx -y fanqie-autopub-mcp@latest --selfcheck
```

> ⚠️ **数据目录（必读）**：npm / npx 安装时包目录在 npm 缓存里（会被清理），所以数据**不会**放进包目录，而是落到用户目录 **`~/.fanqie-autopub`**（Windows 即 `C:\Users\<你>\.fanqie-autopub`）——cookies、文稿库、截图都在那里。
>
> - 想固定在别处（或从旧的 clone 用法**迁移**过来、继续用旧数据）：在 `env` 里显式指定 `"FANQIE_DATA_DIR": "D:\\fanqie-data"`。
> - 启动日志与 `--selfcheck` 都会打印**实际生效**的数据目录及来源（`env` / `project` / `user`），排障先看这行。

> 📌 已发布到 npm（`fanqie-autopub-mcp`，2026-10-18 v1.1.0）；想用本地 clone 方式（改代码 / 离线）照旧走 §1，功能完全一致。

---


## 2. 工具清单（30 个）

### 2.1 登录与状态（3）

| 工具 | 说明 |
|---|---|
| `login_tomato` | 半自动登录：开真实浏览器，你扫码/过验证码；服务只轮询登录态并保存 cookies，**不碰账号密码** |
| `set_tomato_cookies` | 手动导入 cookies（文本或文件路径） |
| `get_publish_status` | 环境自检：cookies / 浏览器驱动 / 后台可达性；`verify_login=true` 时实开浏览器校验登录态 |

### 2.2 番茄后台 · 小说与作品（4）

| 工具 | 说明 |
|---|---|
| `list_novels_tomato` | 读后台真实小说列表；`sync_local=true` 可同步进本地登记（供批量上传用） |
| `create_novel_tomato` | 驱动 `/main/writer/create` 真实建书 → 返回 `book_id`。必填：书名(≤15字)/频道/主角名1、2(≤5字)/简介(50–500字) |
| `update_novel_info_tomato` | **改已有作品信息**：书名(≤15字)/主角名1、2(≤5字)/简介(50–500字)/阅读标签/内容标签。走「作品信息(type=1) → 修改 → 立即修改」；受作品信息审核锁保护。默认 `confirm=false` 只展开表单并截图 |
| `set_book_tags` | 只改「阅读标签 / 内容标签」的快捷入口（内部就是 `update_novel_info_tomato` 的薄包装）。**语义是「确保这些标签处于选中」**：已经选中的会跳过，不会误取消 |

> 改**本地**创作设定用 `update_novel`（纯本地、不碰后台），见下面 2.7「本地设定与知识」。

> 标签的真实机制（实测）：点标签行 → 弹出独立分类弹窗（标题即「阅读标签」/「内容标签」，选项 `.category-choose-item`，`active`=已选）→ 点选项 → 点弹窗「确认」才落到**表单**。弹窗「确认」**不等于**提交作品信息，最后仍需表单底部的「立即修改」；已验证点完弹窗「确认」但不点「立即修改」时，线上标签原样不变。

### 2.3 番茄后台 · 小说章节（4，含批量）

| 工具 | 说明 |
|---|---|
| `list_chapters_tomato` | 读某本书的章节列表，用于复核与避重 |
| `add_chapter_tomato` | 序号+标题+正文 → 下一步 → 内容检测方式 → 发布设置(是否使用AI) → 确认提交 → 错别字二次确认 → 接口复核；支持 `scheduled_time` 定时发布 |
| `update_chapter_tomato` | **改已发布章节**：走章节列表的编辑入口 `publish/{chapterId}/?enter_from=modifychapter`，复用上面同一条发布链路，最后按 `chapter_id` 复核标题。正文可用 `content`/`file_path`/`article_id`；**都不给＝保留线上正文、只改标题**。⚠️ 该编辑器边输入边自动保存，所以 `confirm=false` 时**只打开修改页读现状 + 截图，完全不填充**（避免误改线上）；`confirm=true` 才填入并提交 |
| `batch_publish_chapters` | 从本地文稿库挑「待发布」章节，按序限速依次上传；单章失败不中断 |

### 2.4 番茄后台 · 短故事（7）

| 工具 | 说明 |
|---|---|
| `list_short_stories_tomato` | 短故事列表 / 草稿箱（`status=draft`） |
| `get_short_story_tomato` | 读详情：标题/字数/分类/签约状态/可否修改 |
| `create_short_story_tomato` | 新建并（可选）保存草稿；返回 `item_id` |
| `update_short_story_tomato` | **改已存在短故事**（`/publish-short/{item_id}` 编辑页）：标题/正文/分类/封面/是否AI。只覆盖显式传入的字段；`confirm=true` **只点「存草稿」（不发布）**；默认 `confirm=false` 只打开编辑页读现状 + 截图、**完全不填充** |
| `publish_short_story_tomato` | 发布：`item_id` 直发，或 `title`+`content` 新建并发布。**平台强制四项**：封面（`cover_path` 或沿用已有）、`use_ai=true\|false`（必须显式声明）、发布协议 + 试读比例（自动补齐）。发布后按 `publish_status=1` 复核，并**自动回写本地文稿库**（`status=published`；按 `article_id` → `tomato_item_id` → 标题匹配，匹配不到返回 warning） |
| `set_short_story_cover_tomato` | 上传本地封面图片（「封面设置 → 本地上传」抽屉；建议 600×800、jpg/png、≤5MB） |
| `delete_short_story_tomato` | 删除短故事/草稿（默认预览；confirm=true 时驱动草稿箱真实 UI 删除） |

> `publish_short_story_tomato` 发布成功后，会在返回里带一个 `microHeadline` 建议块（**请询问用户「要不要再发一条微头条引流」**，并附上自动生成的引导语草稿）。

### 2.5 番茄后台 · 微头条（短故事「作品推荐」）（2）

| 工具 | 说明 |
|---|---|
| `create_micro_headline_tomato` | **新建微头条**：给短故事引流（文字 + 书籍卡片）。给 `item_id` 会自动读短故事的标题/正文并**生成引导语**（`#故事推荐#` + 开篇节选 + 作品卡点句 + 话题标签），驱动 `作品推荐 → 新建微头条` 抽屉填表并关联作品卡片。**默认 `confirm=false` 只填表 + 截图，并把 `content` 回给你确认**；`confirm=true` 才提交（`draft=true` 则只存草稿箱） |
| `list_micro_headlines_tomato` | 读微头条列表（`drafts=true` 读草稿箱），含推荐状态、阅读量、可否编辑/删除 |

> 微头条规则（官方教程 + 2026-10 实测）：正文 **10–1500 字**（官方建议 ≤500）、图片最多 **3** 张、**每天最多 10 条**、**必须关联一个短篇**；推荐状态按内容质量给量（小流量推荐 → 热推中 / 审核不通过）。

### 2.6 本地文稿库与质检（7，纯本地不触网）

| 工具 | 说明 |
|---|---|
| `save_article` | 正文入库（`data/articles.json`），返回 `article_id`，避免长文本反复走工具参数。带 `article_id` 时为 **upsert**（改稿），只覆盖显式传入的字段 |
| `list_articles` | 按 kind / novel_id / status 过滤列出 |
| `get_article` | 取回全文 |
| `export_article` | 导出成可直接粘贴到后台的文本文件（txt/md），返回绝对路径；适合人工发布 |
| `import_articles_from_dir` | **从磁盘工作稿目录批量导入**（`章节\第NN章_标题.md`）：自动识别章号/标题、剥掉 `> **本章概要**` 元信息块、跳过合稿文件，按 `novel_id + 章号` upsert（已存在则覆盖正文、保留状态与发布时间）。默认 `confirm=false` 只预览清单 |
| `delete_article` | 删除本地文稿（默认预览） |
| `check_originality` | 原创性 / AI 味检测：与文稿库其余条目做 n-gram 比对，并查自我复读、套话密度、对话占比、段落均匀度、字数门槛 |

### 2.7 本地设定与知识（3，纯本地不触网）

| 工具 | 说明 |
|---|---|
| `update_novel` | 改**本地** `data/novels.json` 里的作品设定：书名/频道/简介/主角名/标签/番茄书号绑定 + `genre`/`synopsis`/`outline`/`world_setting`/`golden_hook`/`characters`/`target_words_per_chapter`/`status`。长文本可用 `*_file` 指向磁盘文件；只覆盖显式传入的字段 |
| `list_genres` | 番茄主流赛道知识库：爽点机制、开篇要求、节奏、避坑清单、建议单章字数 |
| `get_stats` | 本地文稿/任务/登记汇总 + 环境自检；`remote=true` 时再读一次后台真实数据 |

> 分类小计：3 + 4 + 4 + 7 + 2 + 7 + 3 = **30**（与 `npm run smoke` 的 `EXPECTED_TOOLS` 断言一致）。

---

## 3. MCP 资源（只读，不联网）

| URI | 内容 |
|---|---|
| `fanqie://status` | cookies / 浏览器驱动 / 后台地址等状态 |
| `fanqie://novels` | 本地小说登记 |
| `fanqie://short-stories` | 本地短故事登记 |
| `fanqie://articles` | 本地文稿库（不含正文全文） |
| `fanqie://tasks` | 发布任务日志 |
| `fanqie://publish-rules` | 发布限制须知（短故事字数区间、标签上限、定时支持范围、微头条规则） |
| `fanqie://genres` | 番茄赛道知识库（12 个赛道的完整设定） |
| `fanqie://golden-three-chapters` | 黄金三章方法论（markdown） |

---

## 4. 安全策略（重要）

- **两段式写操作**：所有写工具默认 `confirm=false`，只驱动页面填表并截图，**不点提交**；核对无误后传 `confirm=true` 才真正提交。
- **一律驱动真实页面**：番茄的写接口带 `msToken`/`a_bogus` 签名，手工拼签名不可行（会返回 `-2 参数有误`）。本服务让页面自身的 JS 计算签名，所以是「像人一样操作后台表单」，不是伪造请求。
- **限速与人工确认**：批量上传章节之间有 `interval_seconds` 间隔；发布链路保留人工确认环节，规避平台风控。
- **实名/人脸验证**：短故事发布可能触发实名/人脸验证；命中时服务会停止并截图提示，**不硬闯**。
- **失败必有证据**：失败自动截图到 `data/screenshots/`，并在返回里给出路径。
- **远程端点默认关闭且不裸奔**：只有显式 `--http` / `FANQIE_TRANSPORT=http` 才开；默认只监听 `127.0.0.1`（**本机免鉴权，零配置**），一旦绑非回环地址就**强制** `FANQIE_HTTP_TOKEN`（Bearer，常量时间比对），缺 Token 直接拒绝启动；并可用 `FANQIE_HTTP_READONLY=1` 在协议入口拦掉所有写工具（见 §1.2）。

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
| `FANQIE_DATA_DIR` | 仓库内（clone）运行：`<项目>/data`；npm / npx 安装：`~/.fanqie-autopub` | 数据目录（cookies / 文稿库 / 截图）。启动日志会打印实际生效值与来源 |
| `FANQIE_COOKIES_FILE` | `<data>/tomato_cookies.json` | cookies 文件 |
| `FANQIE_CHROME_PATH` | 自动探测 | Chrome/Edge 可执行文件路径 |
| `FANQIE_ENABLE_BROWSER` | 开启 | 设为 `0`/`false`/`off` 则彻底禁用浏览器能力 |
| `FANQIE_CHAPTER_URL_TEMPLATE` | 内置 | 章节发布页地址模板 |
| `FANQIE_DEBUG` | 关闭 | 设为 `1` 输出调试日志（stderr） |

### 6.1 远程（Streamable HTTP）专用

| 变量 | 默认 | 说明 |
|---|---|---|
| `FANQIE_TRANSPORT` | `stdio` | 设为 `http` 启用远程端点（等价于命令行加 `--http`） |
| `FANQIE_HTTP_TOKEN` | 无 | Bearer Token。**回环地址可省略（＝本机免鉴权）**；绑非回环地址时必填，缺失或 <16 字符拒绝启动。生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FANQIE_HTTP_HOST` | `127.0.0.1` | 监听地址；改成 `0.0.0.0` 即对外暴露（会告警，且**此时必须设 Token**） |
| `FANQIE_HTTP_PORT` | `8765` | 监听端口；`0` = 由系统分配空闲端口 |
| `FANQIE_HTTP_PATH` | `/mcp` | MCP 端点路径（`/health` 为免鉴权探活端点） |
| `FANQIE_HTTP_READONLY` | 关闭 | 设为 `1` 时远程端点拦截全部写工具，只留只读能力 |

---

## 7. 目录结构

```
src/
├── index.ts              # MCP 入口（stdio；--http / FANQIE_TRANSPORT=http 走远程）
├── http.ts               # 远程传输：Streamable HTTP（node:http + Bearer 鉴权 + 只读模式）
├── globals.d.ts          # page.evaluate 用到的 DOM 全局声明
├── types.ts
├── core/                 # paths / logger / result / store(原子写) / text(去 markdown) / remote(远程配置与写工具判定)
├── browser/              # driver(puppeteer-core) / cookies / endpoints(路由与接口常量)
├── knowledge/            # genres(赛道知识库) / goldenThree(黄金三章)
├── services/             # auth / novel / chapter / short / library / stats / originality
├── tools/                # auth / novel / chapter / shortStory / library / knowledge / stats
└── resources/index.ts
scripts/
├── smoke.mjs             # 协议级冒烟（不触网）：stdio 30 工具/8 资源 + 远程鉴权/只读模式
└── mcp-cli.mjs           # 命令行直连 MCP
data/                     # cookies / articles.json / novels.json / ... / screenshots
dist/                     # WorkBuddy 实际加载入口（已入库，clone 后可免 build 直接运行）
```

> `dist/` 已特意入库以支持开箱即用；**修改 `src/` 后请 `npm run build`，并把新的 `dist/` 一并提交**，否则运行的是旧产物。

> `data/` 只是**仓库内运行**时的默认落点；npm / npx 安装时数据在 `~/.fanqie-autopub`（见 §1.3），可用 `FANQIE_DATA_DIR` 统一到任意位置。

## 8. 故障排查

| 症状 | 处理 |
|---|---|
| 返回「cookies 已失效」 | 重新执行 `login_tomato` |
| npx 装的，找不到 cookies / 文稿库 | 数据在用户目录 `~/.fanqie-autopub`（不在包目录）；要沿用旧目录就设 `FANQIE_DATA_DIR`。启动日志 / `--selfcheck` 会打印实际生效目录及来源 |
| 找不到本机浏览器 | 设置 `FANQIE_CHROME_PATH`，或 `npm i puppeteer`（自带 Chromium） |
| 选择器找不到 / 页面改版 | 选择器集中在 `src/browser/endpoints.ts` 与各 `services/*.ts` 顶部，按需补充；失败截图在 `data/screenshots/` |
| 章节发布后未复核到 | 到后台草稿箱确认；`list_chapters_tomato` 复核已发布数 |
| 远程启动即退出，报 `绑定非回环地址 … 必须设置 FANQIE_HTTP_TOKEN` | 你绑了 `0.0.0.0` 之类非回环地址却没给 Token。只在本机用：把 `FANQIE_HTTP_HOST` 设为 `127.0.0.1` 或删掉该变量（回环地址免鉴权）；要对外则按 §1.2 生成并导出 Token（<16 字符也会被拒） |
| 远程客户端 401 | 只在服务端配了 Token 时才会 401：请求头缺 `Authorization: Bearer <Token>`，或 Token 不匹配 |
| 远程客户端 404 | 路径不是 `FANQIE_HTTP_PATH`（默认 `/mcp`；探活是 `/health`） |
| 远程调用写工具报「只读模式」 | 服务端设了 `FANQIE_HTTP_READONLY=1`，按需去掉（本地 stdio 不受此开关影响） |
| 远程客户端初始化报 400 / 404 会话过期 | Streamable HTTP 会话在服务端内存里，重启服务后客户端需重连 |
| `FANQIE_HTTP_PORT` 被占用 | 改端口，或设 `FANQIE_HTTP_PORT=0` 让系统分配 |
