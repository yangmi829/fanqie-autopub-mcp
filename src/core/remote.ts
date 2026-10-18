/**
 * 远程（Streamable HTTP）传输的配置解析。
 *
 * 刻意不 import 任何 SDK / node:http：stdio 与 --selfcheck 路径也用它，
 * 保证默认用法零额外开销、也不因端口占用之类的原因影响本地启动。
 */

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8765;
export const DEFAULT_PATH = "/mcp";

/** 通用布尔开关解析：1/true/yes/on 视为真 */
export function truthy(v: string | undefined | null): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

export interface RemoteOptions {
  host: string;
  port: number;
  /** MCP 端点的 HTTP 路径，形如 /mcp */
  path: string;
  /** Bearer Token；远程模式必填 */
  token: string;
  /** 只读模式：拦截写工具（本地 stdio 不受影响） */
  readonly: boolean;
}

/** 是否走远程传输：`--http` 参数或 `FANQIE_TRANSPORT=http` */
export function remoteRequested(argv: string[] = process.argv): boolean {
  if (argv.includes("--http")) return true;
  return (process.env.FANQIE_TRANSPORT ?? "").trim().toLowerCase() === "http";
}

/** 解析远程配置；缺 Token 直接抛错（宁可起不来，也不要裸奔暴露写权限） */
export function remoteOptions(): RemoteOptions {
  const token = (process.env.FANQIE_HTTP_TOKEN ?? "").trim();
  if (!token) {
    throw new Error(
      "远程模式必须设置 FANQIE_HTTP_TOKEN（Bearer 鉴权）。生成一个强随机 Token：\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (token.length < 16) {
    throw new Error(`FANQIE_HTTP_TOKEN 太短（当前 ${token.length} 字符）：远程端点可驱动真实浏览器写入，请至少 16 字符的随机串。`);
  }

  const rawPath = (process.env.FANQIE_HTTP_PATH ?? "").trim() || DEFAULT_PATH;
  const parsedPort = Number.parseInt(process.env.FANQIE_HTTP_PORT ?? "", 10);

  return {
    host: (process.env.FANQIE_HTTP_HOST ?? "").trim() || DEFAULT_HOST,
    // 0 表示由系统分配空闲端口（冒烟测试用）
    port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT,
    path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
    token,
    readonly: truthy(process.env.FANQIE_HTTP_READONLY),
  };
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

/**
 * 写工具名单（远程只读模式的拦截依据）。
 *
 * 显式列表是当前 30 个工具的准确答案；前缀正则是兜底，
 * 保证以后新增的写工具即使忘了加进列表也能被拦下。
 * 命名前缀：login_/set_/create_/update_/add_/save_/delete_/publish_/batch_/import_
 */
const WRITE_TOOLS = new Set([
  "login_tomato",
  "set_tomato_cookies",
  "create_novel_tomato",
  "update_novel",
  "update_novel_info_tomato",
  "set_book_tags",
  "add_chapter_tomato",
  "update_chapter_tomato",
  "batch_publish_chapters",
  "create_short_story_tomato",
  "update_short_story_tomato",
  "publish_short_story_tomato",
  "set_short_story_cover_tomato",
  "delete_short_story_tomato",
  "create_micro_headline_tomato",
  "save_article",
  "delete_article",
  "export_article",
  "import_articles_from_dir",
]);

const WRITE_TOOL_PREFIX = /^(login|set|create|update|add|save|delete|publish|batch|import)_/;

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name) || WRITE_TOOL_PREFIX.test(name);
}

/** 给 --selfcheck 用：只报告配置（不猜 Token 内容） */
export function describeRemote(): Record<string, unknown> {
  let parsed: RemoteOptions | undefined;
  let error: string | undefined;
  try {
    parsed = remoteOptions();
  } catch (e) {
    error = (e as Error).message.split("\n")[0];
  }
  return {
    requested: remoteRequested(),
    host: parsed?.host ?? process.env.FANQIE_HTTP_HOST ?? DEFAULT_HOST,
    port: parsed?.port ?? process.env.FANQIE_HTTP_PORT ?? DEFAULT_PORT,
    path: parsed?.path ?? process.env.FANQIE_HTTP_PATH ?? DEFAULT_PATH,
    readonly: parsed?.readonly ?? truthy(process.env.FANQIE_HTTP_READONLY),
    token_set: Boolean(parsed?.token),
    error: error ?? null,
  };
}
