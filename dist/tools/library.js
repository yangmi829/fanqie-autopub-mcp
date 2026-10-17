import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { saveArticle, listArticles, getArticle, deleteArticle, exportArticle, checkOriginality } from "../services/library.js";
export function registerLibraryTools(server) {
    server.registerTool("save_article", {
        title: "保存正文到本地文稿库",
        description: "把用户写好的正文入库（data/articles.json），返回 article_id，避免把长文本反复塞进工具参数。" +
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
    }, async (args) => fromService((await saveArticle({
        kind: args.kind,
        title: args.title,
        content: args.content,
        filePath: args.file_path,
        novelId: args.novel_id,
        chapterNumber: args.chapter_number,
        status: args.status,
        tomatoBookId: args.tomato_book_id,
        tomatoItemId: args.tomato_item_id,
    }))));
    server.registerTool("list_articles", {
        title: "列出本地文稿",
        description: "按 kind / novel_id / status 过滤列出本地文稿库条目（不含正文全文）。",
        inputSchema: {
            kind: z.enum(["chapter", "short"]).optional(),
            novel_id: z.string().optional(),
            status: z.enum(["draft", "published", "failed"]).optional(),
        },
    }, async (args) => {
        const items = await listArticles({ kind: args.kind, novelId: args.novel_id, status: args.status });
        return ok({
            total: items.length,
            articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
        });
    });
    server.registerTool("get_article", {
        title: "读取本地文稿",
        description: "按 article_id 取回本地文稿全文（含正文）。",
        inputSchema: { article_id: z.string().describe("本地文稿 article_id") },
    }, async ({ article_id }) => {
        const art = await getArticle(article_id);
        if (!art)
            return fail(`未找到 article_id=${article_id}`);
        return ok(art);
    });
    server.registerTool("delete_article", {
        title: "删除本地文稿",
        description: "删除本地文稿库条目（不影响番茄后台）。默认 confirm=false 只预览。",
        inputSchema: {
            article_id: z.string().describe("本地文稿 article_id"),
            confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
        },
    }, async ({ article_id, confirm }) => fromService((await deleteArticle(article_id, confirm))));
    server.registerTool("export_article", {
        title: "导出本地文稿为文本",
        description: "把本地文稿导出成可直接粘贴到番茄作者后台的文本文件（txt/md），返回绝对路径。适合人工发布流程。" +
            "默认带书名抬头；不联网、不改动番茄后台。",
        inputSchema: {
            article_id: z.string().describe("本地文稿 article_id"),
            format: z.enum(["txt", "md"]).optional().describe("导出格式，默认 txt"),
            include_novel_title: z.boolean().optional().describe("是否在文件头带上所属书名，默认 true"),
            export_dir: z.string().optional().describe("自定义导出目录，省略则用 data/export"),
        },
    }, async ({ article_id, format, include_novel_title, export_dir }) => fromService((await exportArticle({
        articleId: article_id,
        format,
        includeNovelTitle: include_novel_title,
        exportDir: export_dir,
    }))));
    server.registerTool("check_originality", {
        title: "原创性 / AI 味检测",
        description: "本地原创性检测：与文稿库其它条目做 n-gram 相似度比对，同时检查自我复读、套话密度、对话占比、段落均匀度、字数是否达日更门槛。" +
            "不联网、不消耗额度。用 article_id 或直接传 content。",
        inputSchema: {
            article_id: z.string().optional().describe("本地文稿 article_id（与 content 二选一）"),
            content: z.string().optional().describe("待检测正文（与 article_id 二选一）"),
            threshold: z.number().optional().describe("相似度阈值，默认 0.25，越低越严格"),
        },
    }, async ({ article_id, content, threshold }) => fromService((await checkOriginality({ articleId: article_id, content, threshold }))));
}
