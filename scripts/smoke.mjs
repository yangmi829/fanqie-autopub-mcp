/**
 * 协议级冒烟测试（不触网）：
 * 以 stdio 方式拉起 dist/index.js，走真实 MCP 协议列出工具/资源，
 * 并调用若干个纯本地（不联网）工具验证返回结构。
 *
 * 使用临时数据目录，避免污染真实 data/。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fanqie-smoke-"));

const EXPECTED_TOOLS = [
  // 登录/状态
  "login_tomato",
  "set_tomato_cookies",
  "get_publish_status",
  // 小说
  "list_novels_tomato",
  "create_novel_tomato",
  // 章节
  "list_chapters_tomato",
  "add_chapter_tomato",
  "batch_publish_chapters",
  // 短故事
  "list_short_stories_tomato",
  "get_short_story_tomato",
  "create_short_story_tomato",
  "publish_short_story_tomato",
  "set_short_story_cover_tomato",
  "delete_short_story_tomato",
  // 文稿库
  "save_article",
  "list_articles",
  "get_article",
  "delete_article",
  // 统计
  "get_stats",
];

const EXPECTED_RESOURCES = [
  "fanqie://status",
  "fanqie://novels",
  "fanqie://short-stories",
  "fanqie://articles",
  "fanqie://tasks",
  "fanqie://publish-rules",
];

let failures = 0;
function check(name, cond, extra = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${name}${extra ? "  " + extra : ""}`);
}

function parse(res) {
  const text = res?.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { _text: text };
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "dist", "index.js")],
  env: { ...process.env, FANQIE_DATA_DIR: TMP, FANQIE_ENABLE_BROWSER: "0" },
  stderr: "pipe",
});

const client = new Client({ name: "smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  console.log("已连接 server（stdio）。\n");

  // 1) 工具清单
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  check("工具总数=19", names.length === 19, `实际=${names.length}`);
  for (const t of EXPECTED_TOOLS) check(`工具存在: ${t}`, names.includes(t));

  // 2) 资源清单
  const resources = await client.listResources();
  const uris = resources.resources.map((r) => r.uri);
  for (const u of EXPECTED_RESOURCES) check(`资源存在: ${u}`, uris.includes(u));

  // 3) 纯本地工具调用
  let r = parse(await client.callTool({ name: "get_stats", arguments: { remote: false } }));
  check("get_stats 返回 local 统计", r?.local && typeof r.local.articles?.total === "number");

  r = parse(await client.callTool({ name: "list_articles", arguments: {} }));
  check("list_articles 空库返回 total=0", r?.total === 0);

  r = parse(await client.callTool({ name: "save_article", arguments: { kind: "chapter", title: "冒烟章节", content: "第一段。\n\n第二段。", chapter_number: 1 } }));
  check("save_article 返回 article_id", typeof r?.article?.id === "string", `id=${r?.article?.id ?? "?"}`);
  const artId = r?.article?.id;

  r = parse(await client.callTool({ name: "get_article", arguments: { article_id: artId } }));
  check("get_article 取回正文", typeof r?.content === "string" && r.content.includes("第一段"));

  r = parse(await client.callTool({ name: "delete_article", arguments: { article_id: artId, confirm: false } }));
  check("delete_article(confirm=false) 为预览", r?.action === "preview" && r?.ok !== false);

  r = parse(await client.callTool({ name: "get_publish_status", arguments: { verify_login: false } }));
  check("get_publish_status 可调用并返回 ready 字段", typeof r?.ready === "boolean");

  // 4) 资源读取（只读、不联网）
  const res = await client.readResource({ uri: "fanqie://publish-rules" });
  const body = JSON.parse(res.contents[0].text);
  check("publish-rules 含短故事字数规则", /6000/.test(JSON.stringify(body)) && /80000/.test(JSON.stringify(body)));

  console.log(`\n===== 冒烟结果：${failures === 0 ? "全绿 ✅" : failures + " 项失败 ❌"} =====`);
} catch (e) {
  failures++;
  console.error("冒烟执行异常：", e);
} finally {
  await client.close().catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
