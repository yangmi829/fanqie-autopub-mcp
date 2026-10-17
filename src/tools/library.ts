import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { saveArticle, listArticles, getArticle, deleteArticle } from "../services/library.js";

export function registerLibraryTools(server: McpServer): void {
  server.registerTool(
    "save_article",
    {
      title: "保存正文到本地文稿库",
      description:
        "把用户写好的正文入库（data/articles.json），返回 article_id，避免把长文本反复塞进工具参数。" +
        "kind=chapter 可带 novel_id/chapter_number；kind=short 用于短故事。正文可用 content 或 file_path。",
      inputSchema: {
        kind: z.enum(["chapter", "short"]).describe("chapter=小说章节，short=短故事正文"),
        title: z.string().describe("标题"),
        content: z.string().optional().describe("正文（与 file_path 二选一）"),
        file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
        novel_id: z.string().optional().describe("归属的本地小说 id（kind=chapter）"),
        chapter_number: z.number().int().optional().describe("章节号（kind=chapter）"),
        status: z.enum(["draft", "published", "failed"]).optional().describe("初始状态，默认 draft"),
        tomato_book_id: z.string().optional().describe("已绑定的番茄 book_id（可选）"),
        tomato_item_id: z.string().optional().describe("已绑定的番茄短故事 item_id（可选）"),
      },
    },
    async (args) =>
      fromService(
        (await saveArticle({
          kind: args.kind,
          title: args.title,
          content: args.content,
          filePath: args.file_path,
          novelId: args.novel_id,
          chapterNumber: args.chapter_number,
          status: args.status,
          tomatoBookId: args.tomato_book_id,
          tomatoItemId: args.tomato_item_id,
        })) as any
      )
  );

  server.registerTool(
    "list_articles",
    {
      title: "列出本地文稿",
      description: "按 kind / novel_id / status 过滤列出本地文稿库条目（不含正文全文）。",
      inputSchema: {
        kind: z.enum(["chapter", "short"]).optional(),
        novel_id: z.string().optional(),
        status: z.enum(["draft", "published", "failed"]).optional(),
      },
    },
    async (args) => {
      const items = await listArticles({ kind: args.kind, novelId: args.novel_id, status: args.status });
      return ok({
        total: items.length,
        articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
      });
    }
  );

  server.registerTool(
    "get_article",
    {
      title: "读取本地文稿",
      description: "按 article_id 取回本地文稿全文（含正文）。",
      inputSchema: { article_id: z.string().describe("本地文稿 article_id") },
    },
    async ({ article_id }) => {
      const art = await getArticle(article_id);
      if (!art) return fail(`未找到 article_id=${article_id}`);
      return ok(art);
    }
  );

  server.registerTool(
    "delete_article",
    {
      title: "删除本地文稿",
      description: "删除本地文稿库条目（不影响番茄后台）。默认 confirm=false 只预览。",
      inputSchema: {
        article_id: z.string().describe("本地文稿 article_id"),
        confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
      },
    },
    async ({ article_id, confirm }) => fromService((await deleteArticle(article_id, confirm)) as any)
  );
}
