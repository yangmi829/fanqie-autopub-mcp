# fanqie-autopub-mcp

番茄小说（fanqienovel.com）作者后台**自动发布 MCP**：登录、新增小说、新增小说章节、新建/发布短故事，并附带定时发布、短故事分章、批量上传、本地文稿库。

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

## 2. 工具清单（19 个）

### 2.1 登录与状态（3）

| 工具 | 说明 |
|---|---|
| `login_tomato` | 半自动登录：开真实浏览器，你扫码/过验证码；服务只轮询登录态并保存 cookies，**不碰账号密码** |
| `set_tomato_cookies` | 手动导入 cookies（文本或文件路径） |
| `get_publish_status` | 环境自检：cookies / 浏览器驱动 / 后台可达性；`verify_login=true` 时实开浏览器校验登录态 |

### 2.2 新增小说（2）

| 工具 | 说明 |
|---|---|
| `list_novels_tomato` | 读后台真实小说列表；`sync_local=true` 可同步进本地登记（供批量上传用） |
| `create_novel_tomato` | 驱动 `/main/writer/create` 真实建书 → 返回 `book_id`。必填：书名(≤15字)/频道/主角名1、2(≤5字)/简介(50–500字) |

### 2.3 新增小说章节（3，含批量）

| 工具 | 说明 |
|---|---|
| `list_chapters_tomato` | 读某本书的章节列表，用于复核与避重 |
| `add_chapter_tomato` | 序号+标题+正文 → 下一步 → 内容检测方式 → 发布设置(是否使用AI) → 确认提交 → 错别字二次确认 → 接口复核；支持 `scheduled_time` 定时发布 |
| `batch_publish_chapters` | 从本地文稿库挑「待发布」章节，按序限速依次上传；单章失败不中断 |

### 2.4 短故事（6）

| 工具 | 说明 |
|---|---|
| `list_short_stories_tomato` | 短故事列表 / 草稿箱（`status=draft`） |
| `get_short_story_tomato` | 读详情：标题/字数/分类/签约状态/可否修改 |
| `create_short_story_tomato` | 新建并（可选）保存草稿；返回 `item_id` |
| `publish_short_story_tomato` | 发布：`item_id` 直发，或 `title`+`content` 新建并发布 |
| `set_short_story_cover_tomato` | 上传本地封面图片 |
| `delete_short_story_tomato` | 删除短故事/草稿（默认预览；confirm=true 时驱动草稿箱真实 UI 删除） |

### 2.5 本地文稿库（4）

| 工具 | 说明 |
|---|---|
| `save_article` | 正文入库（`data/articles.json`），返回 `article_id`，避免长文本反复走工具参数 |
| `list_articles` | 按 kind / novel_id / status 过滤列出 |
| `get_article` | 取回全文 |
| `delete_article` | 删除本地文稿（默认预览） |

### 2.6 统计（1）

| 工具 | 说明 |
|---|---|
| `get_stats` | 本地文稿/任务/登记汇总 + 环境自检；`remote=true` 时再读一次后台真实数据 |

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

---

## 4. 安全策略（重要）

- **两段式写操作**：所有写工具默认 `confirm=false`，只驱动页面填表并截图，**不点提交**；核对无误后传 `confirm=true` 才真正提交。
- **一律驱动真实页面**：番茄的写接口带 `msToken`/`a_bogus` 签名，手工拼签名不可行（会返回 `-2 参数有误`）。本服务让页面自身的 JS 计算签名，所以是「像人一样操作后台表单」，不是伪造请求。
- **限速与人工确认**：批量上传章节之间有 `interval_seconds` 间隔；发布链路保留人工确认环节，规避平台风控。
- **实名/人脸验证**：短故事发布可能触发实名/人脸验证；命中时服务会停止并截图提示，**不硬闯**。
- **失败必有证据**：失败自动截图到 `data/screenshots/`，并在返回里给出路径。

## 5. 已知边界

- **短故事的「发布」全自动程度有限**：`create_short_story_tomato`（存草稿）路径已逆向完整；`publish_short_story_tomato` 的最终发布按「存草稿 → 下一步 → 发布」驱动真实 UI，若页面改版或命中实名验证，会明确报错并截图，此时请到后台手动发布。
- **定时发布仅用于小说章节**：短故事接口没有定时字段。
- **短故事删除走 UI**：`short_article/delete/v0/` 需页面签名，`delete_short_story_tomato` 通过驱动草稿箱（hover → 删除图标 → 确认弹窗）完成删除。
- **短故事字数**：官方要求 6000–80000 字（最佳 1w–3w）；低于/高于区间可存草稿但发布会失败。

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
├── services/             # auth / novel / chapter / short / library / stats
├── tools/                # auth / novel / chapter / shortStory / library / stats
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
