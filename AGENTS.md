# AGENTS.md

番茄小说（fanqienovel.com）作者后台自动发布 MCP 服务：TypeScript，传输为 stdio（默认）/ Streamable HTTP（远程），30 个工具 + 8 个只读资源。
用户侧用法见 `README.md`；**本文件只写"改这个仓库时必须知道的"**。

## 命令
- `npm install` → `npm run build`（tsc → `dist/`）→ `npm run smoke`
- `npm run smoke` 是本仓库**唯一自动化验证**：以 stdio 拉起 `dist/index.js`，走真实 MCP 协议断言 30 工具 / 8 资源 / 本地工具调用；再以 `--http` 拉起独立进程验证远程链路（端点通告 / 带 Token 时无 Token 请求 401 / **本机免鉴权下不带 Authorization 也能列 30 工具并调用** / 非回环缺 Token 与短 Token 均拒绝启动 / 30 工具 / 写工具 / `FANQIE_HTTP_READONLY=1` 拦截）。**全程不触网**（临时 `FANQIE_DATA_DIR` + `FANQIE_ENABLE_BROWSER=0`，远程用 `FANQIE_HTTP_PORT=0` 由系统分配端口）。exit 0 = 全绿。
- **增删工具或资源后，必须同步更新 `scripts/smoke.mjs` 里的 `EXPECTED_TOOLS` / `EXPECTED_RESOURCES`**，否则冒烟会失败。
- 没有测试框架（无 jest/vitest），不要去找。
- 直连 MCP 调试：`node scripts/mcp-cli.mjs --list` / `node scripts/mcp-cli.mjs <tool> key=value` / `--res <uri>`
- 运行服务：`npm start`（stdio）/ `npm run start:http`（远程，需 `FANQIE_HTTP_TOKEN`）

## 提交前必须知道
- **`dist/` 特意入库**（clone 后免 build 即可运行）。改了 `src/` 就必须 `npm run build`，并把新的 `dist/` 一起提交，否则运行的是旧产物。
- `package.json` 的 `bin.fanqie-autopub-mcp` 指向 `dist/index.js`。
- **发布到 npm（维护者）**：npm 现要求「2FA **或** 带 Bypass 2FA 的 granular token」才能发布——账号 `tfa=false` 时（`npm profile get` 可查）只剩 token 一条路，否则 `PUT` 报 `E403 … granular access token with bypass 2fa enabled is required`。token 在官网 Access Tokens → Generate New Token → **Granular**：勾 **Bypass two-factor authentication**、权限 **Read and write (publish and stage)**、包选 **All Packages**（新包在「Only select packages」下拉里搜不到），有效期设最短，发完立即 revoke。发布前先 `npm run smoke` + `npm pack --dry-run --json`（`prepack` 会自动 build）。首版发布会在 registry 上留下 npm 自动创建的 `0.0.0-stage` 占位版本（staged publishing 机制，340 B 空壳，无害；`npm stage list` 可确认暂存区为空）。

## 运行前置
- Node ≥ 20；ESM（`"type": "module"`）。
- `puppeteer-core`（optionalDependency）+ 本机 Chrome/Edge；路径用 `FANQIE_CHROME_PATH`，否则自动探测。
- 需有效登录态 `data/tomato_cookies.json`（由工具 `login_tomato` 生成）。`get_publish_status` 是权威自检，`ready=true` 再继续。
- **改了 `src/` 后，跑着的 MCP 服务不会自动换新代码**：连接器（WorkBuddy 等）里的 `node dist/index.js` 是启动时就把代码加载完了的长驻进程，不重启就一直用旧 `dist/`（症状是「改了没生效 / 又复现了」）。改用 `node scripts/mcp-cli.mjs <tool>` 验证——那是新进程，拿到的是当前 `dist/`。

## ⚠️ 硬约束（不了解必踩坑）
1. **写接口只能驱动真实页面**：番茄 author 写接口带 `msToken`/`a_bogus` 签名，手工 fetch 必返回 `-2 参数有误`。只有**只读 GET**（list / edit / category 类）能走 `browser/endpoints.ts` 的 `apiGet()` 免签名。注意：删除短故事草稿同样是写接口 → 必须走草稿箱 UI（hover → `.serial-icon-general_delete` → 确认弹窗）；且 SVG 元素**没有 `.click()`**，得用 `page.mouse.click(x, y)`。
2. **写操作两段式**：默认 `confirm=false`（只填表 / 截图，不提交），`confirm=true` 才提交。新增写工具必须沿用该约定，`publish_*` / `delete_*` 默认走预览。
3. **stdout 属于 MCP 协议**：日志只能走 stderr（`core/logger.ts`）。任何 `console.log` 都会破坏 stdio 协议。
4. **禁止 `process.cwd()`**：MCP 子进程的 cwd 不可靠；路径统一走 `core/paths.ts`（基于 `import.meta.url` 解析）。
5. **ESM + NodeNext：相对 import 必须带 `.js` 后缀**（如 `from "../core/logger.js"`），即使源文件是 `.ts`。
6. **`tsconfig` 的 `lib` 里刻意没有 DOM**：`page.evaluate` 用到的 `document` / `window` / `Event` / `location` / `fetch` 由 `src/globals.d.ts` 声明为 `any`。删掉会报 TS2584 / TS2304；不要为了绕过它往 `lib` 加 `"dom"`。
7. **可选依赖必须用变量 specifier 动态 import**（见 `browser/driver.ts`）：写死 `import "puppeteer-core"` 会让 tsc 因缺类型报 TS2307。
8. **编辑器有副作用**：打开**不带 item_id** 的 `/main/writer/publish-short/` 会让前端**自动创建一条空草稿**。做侦察 / 预览时尽量带 `item_id`，别反复造草稿。小说章节编辑器同理**边输入边自动保存**；改已发布章节（`publish/{chapterId}/?enter_from=modifychapter`）时，**预览绝不填充**（填充即可能改动线上正文），只读现状 + 截图。
9. **选择器与路由集中管理**：API / 路由常量在 `browser/endpoints.ts`，页面选择器在各 `services/*.ts` 顶部的 `*_SELECTORS`。番茄改版通常只需改这些位置；失败会自动截图到 `data/screenshots/`。
10. **`data/` 里有有效登录 cookies，绝不能提交**（`.gitignore` 用 `data/*` + `!data/.gitkeep`）。
11. **作品信息页不是弹窗，标签选择是二级弹窗**（2026-10 实测）：`book-info/{id}?type=1` 点 `button.create-btn`（文字「修改」）展开的是**页面内联表单**（底部才有「立即修改」）；点标签行（`#selectRow` 阅读 / `#activitySelectRow` 内容）才会弹**独立分类弹窗** `.arco-modal.category-modal`（选项 `.category-choose-item`，`active`=已选，按钮「取消/确认」）。坑：① 弹窗容器一出现就带 `zoomModal-appear` 动画类，**选项是延迟渲染的**，必须等到选项数 > 0 再点，否则全部判为「未找到」；② DOM 里可能同时存在多个 `.arco-modal`，必须**按弹窗标题**（`阅读标签`/`内容标签`）定位，不能取「第一个可见」；③ 点选项后必须点弹窗「确认」才落到表单（点「取消」丢弃）——但**「确认」≠ 提交**，已验证点完「确认」不点「立即修改」线上不变。
12. **微头条不是短故事编辑页里的东西**（2026-10 实测）：入口是「作品管理 → 短篇作品 → **作品推荐**」=`/main/writer/short-recommend`（另见 `/main/writer/short-recommend-draft` 草稿箱）。API 前缀 `short_article/wtt_*`：`wtt_list` / `wtt_draft_list` / `card_list` 是**只读**（`card_list` 是 POST 但免签名，走 `endpoints.ts` 的 `apiPostQuery`），`publish_wtt` / `delete_wtt` 是**写**→ 必须点页面按钮。编辑器是右侧抽屉：正文 `textarea`（默认值 `#故事推荐#`）+「添加图片」+「添加短篇」（弹 `.arco-modal.short-modal`「插入短篇」，点 `.short-select-item` → `.short-select-item-selected` → 「确定」）。前端硬门（只弹提示，不报错）：正文 <10 或 >1500 字、未选短篇。改版只改 `services/microHeadline.ts` 顶部的 `MICRO_SELECTORS`。
13. **远程传输（Streamable HTTP）的安全红线**：① 只有显式 `--http` / `FANQIE_TRANSPORT=http` 才开，stdio 默认路径**不许**引入 http 相关副作用（`src/index.ts` 用动态 `import("./http.js")`，别改成顶层 import）；② **回环地址免鉴权、非回环必填 Token**（2026-10-18 调整）：`FANQIE_HTTP_HOST` 是 `127.0.0.1` / `localhost` / `::1` 时允许不设 `FANQIE_HTTP_TOKEN`（本机零配置），此时 `http.ts` 完全不校验 `Authorization`；一旦绑非回环地址，`remoteOptions()` 在缺 Token 时**必须**抛错拒绝启动（宁可起不来也不能裸奔暴露写权限），Token 给得短（<16 字符）同样拒绝。判断依据只能用 `isLoopback(host)`，不要写死 `127.0.0.1` 字面量；Token 比对用 `crypto.timingSafeEqual`（哈希后比，避免长度泄漏）；③ 默认只监听 `127.0.0.1`，绑非回环要告警；④ 新增写工具时**必须**确认 `core/remote.ts` 的 `isWriteTool()` 能判到它（显式名单 + 前缀正则兜底），否则 `FANQIE_HTTP_READONLY=1` 会漏；⑤ 只读拦截做在 HTTP 协议入口（`tools/call` 的 `params.name`），不改 `buildServer()`，因为 stdio 本地用法要保持全功能；⑥ `/health` 是唯一免鉴权端点，只许回最小信息，别往里塞 cookies / 路径等敏感内容；⑦ 启动日志里的 `远程端点已就绪: http://…` 一行是 `scripts/smoke.mjs` 的解析锚点，改文案要同步改冒烟正则。
14. **npm 发布（2026-10-18）**：① `package.json` 的 `files` 是**白名单**（`dist` / `README.md` / `LICENSE`）——`data/*` **绝不能**进 tarball。`.gitignore` 只保护 git：npm 仅在既无 `files` 又无 `.npmignore` 时才回退读 `.gitignore`，所以一旦白名单被删或加了 `.npmignore`，**有效 cookies 会被发到公共 registry，不可逆**。改发布配置后必跑 `npm pack --dry-run --json` 核对文件清单。② `prepack` 钩子会 `npm run build`（发出去的产物一定有构建），但**仓库里的 `dist/` 仍必须同步提交**（clone 用法靠它，见「提交前必须知道」）。③ `core/paths.ts` 的数据目录是**三级解析**：`FANQIE_DATA_DIR` → `<项目根>/data`（目录存在即用，保住仓库内 / clone 的历史行为）→ `~/.fanqie-autopub`（npm / npx 安装：发布包不含 `data/`，且包目录在 npm 缓存里会被清）。`DATA_DIR_SOURCE` 会进启动日志与 `get_publish_status` / `--selfcheck` 的 `details`，排障先看它。**别把默认值改回「包目录」**，那等于让 npx 用户的登录态和文稿库随时蒸发。④ **版本号不许写死**：`src/index.ts` 的 `SERVER_VERSION` 必须取 `core/paths.ts` 的 `PACKAGE_VERSION`（读 `package.json`）。曾经写死 `"1.0.0"`，`npm version` 升到 1.1.0 后 `/health`、MCP `serverInfo`、stdio 启动日志一起报旧版本；`scripts/smoke.mjs` 现在有 2 条断言（stdio `getServerVersion()` 与远程 `/health` 的 `version` 都须等于 `package.json` 的 `version`）盯着这件事。
15. **页面级文本判断会被「编辑器正文」污染**（2026-10-19 血泪）：`document.body.innerText` **包含正在编辑的稿件正文**。短故事实名守卫原来用 `/实名|人脸|认证|身份验证/` 扫整页，被《402的草莓》正文「…一是**记人脸**…」命中 → 工具在**正常的「提交确认」弹窗**处判成"要求实名"并中止发布；同账号另一篇正文没这些词所以能发，于是被误判成"偶发/回归"。写守卫/校验一律**只看可见模态 + 精确指令句**（见 `services/short.ts` 的 `authWallText()`），兜底也按容器（`.syl-editor-container`）剔除正文；返回里带上命中文案，别只回「疑似实名」。
16. **真实鼠标点击必须先 `scrollIntoView` 再取 `boundingBox`**：`boundingBox()` 给的是文档坐标，编辑页极长（实测「是否使用AI」在 y≈39205，视口仅 900）→ 直接 `page.mouse.click(box.x, box.y)` 点的是**视口外的空气**，字段看起来"没反应"其实根本没点上。仓库里统一用 `realClick()` / `realClickText()`（`services/short.ts`）。`page.click(sel)` 自带滚动所以没事——**手写的 `boundingBox` + `mouse.click` 最容易漏这一步**。

## 短故事发布页（2026-10-19 真机实测）
- **分类浮层的 `Escape` 关不掉**：`.publish-short-category-select-pop` 按 Escape 仍在（实测高 214），它盖在表单上会**吃掉后续所有真实鼠标点击** → 点「发布协议」实际点到浮层里的分类项 → 报「发布必填项未补齐：发布协议未勾选」。只能**点浮层外空白**关（`closeCategoryPop()`，并校验真的关了）；`acceptPublishTerms` 每次重试前都先调它，并校验「短故事发布事项」弹窗真的打开了。
- **「发布协议」/「是否使用AI」不随「存草稿」保留**：重开页面就是未勾 / 未选，每次发布都要现补（试读比例是正文里的节点 `window.adapter.getExistNodes("payNode")`，实测重开仍在）。这几道门缺一个只弹 **3 秒即消失**的 toast，所以顺序必须是「先补齐 → `readPublishGates` 自检 → 再点下一步」。
- **新 item 平台会默认挂一个分类「西方古典」**（**不是「西方奇幻」**，写脚本别凭印象）。`selectCategories` 现在会回读已选列表、删掉请求集合外的标签（`pruneCategories`），且**每次删除都回读校验**——没有校验时，被浮层吃掉点击照样打「已移除多余分类」的假日志。已选标签 DOM = `.publish-short-category-select-selected` + `svg.serial-icon-general_close`（svg 无 `.click()`）。
- 平台页面显示的「正文字数」与本地 `wordCount` 口径不同（实测 10304 vs 8329），别据此判断正文缺失/超限。
- 排障先看 `data/screenshots/short-*.png`（每步都截图）：`short-realname-required-*.png` **未必**是实名墙（历史上那两张就是正常「提交确认」弹窗）。

## 架构
- 分层：`services/*`（业务 + 浏览器驱动，统一返回 `{ ok, message, ... }`）→ `tools/*`（薄 MCP 包装，用 `core/result.ts` 的 `fromService()` 转 MCP 结果）→ `resources/*`（只读、不联网）。
- 改行为优先落在 `services/`；`tools/` 只做参数解析与转发。
- 入口 `src/index.ts`：`buildServer()` 注册全部工具与资源后接 `StdioServerTransport`；传 `--selfcheck` 只打印环境自检后退出；`--http` / `FANQIE_TRANSPORT=http` 时动态 import `src/http.ts` 起 Streamable HTTP 端点（同一份 `buildServer()`，会话按 `mcp-session-id` 管理）。
- 远程相关：`core/remote.ts`（纯配置解析 + 写工具判定，不 import SDK / http）+ `http.ts`（node:http 手写路由、Bearer 鉴权、只读拦截、信号优雅关闭），不引入 express。
- SDK 用法：`server.registerTool(name, { description, inputSchema: { ...zodRawShape } }, handler)`（MCP SDK 1.x + zod v4）。
- 存储：`core/store.ts` 的 `Collection<T>`（JSON 原子写 tmp → rename），集合为 `novels` / `shortStories` / `articles` / `tasks`。⚠️ `publish_short_story_tomato` 发布成功后会**自动回写** `articles.json`（`status=published` + `tomatoItemId`/`tomatoBookId`），匹配顺序 `article_id` → `tomato_item_id` → 标题精确匹配（仅 `kind=short`）；匹配不到会在返回的 `warnings` 里明确说明并给出 `localArticle.otherCandidates`，**绝不静默**（历史数据仍不一致时可手动 `save_article(article_id=…, status="published")` 兜底）。
- 纯本地能力不碰浏览器：知识数据在 `knowledge/`（`list_genres` + 两个资源），检测算法在 `services/originality.ts`（`check_originality`）。
- 背景与决策记录见 `docs/PLAN.md`。

## Windows / PowerShell
- PowerShell 5.1 会吞掉传给 node 的 JSON 引号 → 用 `$env:MCP_ARGS='{"book_id":"123"}'` 传参，不要写 `node x.mjs t '{...}'`。
- 控制台中文可能显示乱码，但**文件内容本身是 UTF-8 正常的**，不要据此判断编码问题。
