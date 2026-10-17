# AGENTS.md

番茄小说（fanqienovel.com）作者后台自动发布 MCP 服务：TypeScript + stdio，28 个工具 + 8 个只读资源。
用户侧用法见 `README.md`；**本文件只写"改这个仓库时必须知道的"**。

## 命令
- `npm install` → `npm run build`（tsc → `dist/`）→ `npm run smoke`
- `npm run smoke` 是本仓库**唯一自动化验证**：以 stdio 拉起 `dist/index.js`，走真实 MCP 协议断言 28 工具 / 8 资源 / 本地工具调用，**不触网**（用临时 `FANQIE_DATA_DIR` + `FANQIE_ENABLE_BROWSER=0`）。exit 0 = 全绿。
- **增删工具或资源后，必须同步更新 `scripts/smoke.mjs` 里的 `EXPECTED_TOOLS` / `EXPECTED_RESOURCES`**，否则冒烟会失败。
- 没有测试框架（无 jest/vitest），不要去找。
- 直连 MCP 调试：`node scripts/mcp-cli.mjs --list` / `node scripts/mcp-cli.mjs <tool> key=value` / `--res <uri>`
- 运行服务：`npm start`

## 提交前必须知道
- **`dist/` 特意入库**（clone 后免 build 即可运行）。改了 `src/` 就必须 `npm run build`，并把新的 `dist/` 一起提交，否则运行的是旧产物。
- `package.json` 的 `bin.fanqie-autopub-mcp` 指向 `dist/index.js`。

## 运行前置
- Node ≥ 20；ESM（`"type": "module"`）。
- `puppeteer-core`（optionalDependency）+ 本机 Chrome/Edge；路径用 `FANQIE_CHROME_PATH`，否则自动探测。
- 需有效登录态 `data/tomato_cookies.json`（由工具 `login_tomato` 生成）。`get_publish_status` 是权威自检，`ready=true` 再继续。

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

## 架构
- 分层：`services/*`（业务 + 浏览器驱动，统一返回 `{ ok, message, ... }`）→ `tools/*`（薄 MCP 包装，用 `core/result.ts` 的 `fromService()` 转 MCP 结果）→ `resources/*`（只读、不联网）。
- 改行为优先落在 `services/`；`tools/` 只做参数解析与转发。
- 入口 `src/index.ts`：`buildServer()` 注册全部工具与资源后接 `StdioServerTransport`；传 `--selfcheck` 只打印环境自检后退出。
- SDK 用法：`server.registerTool(name, { description, inputSchema: { ...zodRawShape } }, handler)`（MCP SDK 1.x + zod v4）。
- 存储：`core/store.ts` 的 `Collection<T>`（JSON 原子写 tmp → rename），集合为 `novels` / `shortStories` / `articles` / `tasks`。
- 纯本地能力不碰浏览器：知识数据在 `knowledge/`（`list_genres` + 两个资源），检测算法在 `services/originality.ts`（`check_originality`）。
- 背景与决策记录见 `docs/PLAN.md`。

## Windows / PowerShell
- PowerShell 5.1 会吞掉传给 node 的 JSON 引号 → 用 `$env:MCP_ARGS='{"book_id":"123"}'` 传参，不要写 `node x.mjs t '{...}'`。
- 控制台中文可能显示乱码，但**文件内容本身是 UTF-8 正常的**，不要据此判断编码问题。
