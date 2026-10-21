import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import { listChapters, uploadChapter } from "../services/chapter.js";
import { batchPublishChapters, resolveContent, missingArticleMessage } from "../services/library.js";
import { articles, nowIso } from "../core/store.js";
export function registerChapterTools(server) {
    server.registerTool("list_chapters_tomato", {
        title: "列出小说章节",
        description: "读取番茄后台某本书的章节列表（标题/字数/状态），用于复核发布结果与避免重号。",
        inputSchema: {
            book_id: z.string().describe("番茄书 ID（book_id）"),
        },
    }, async ({ book_id }) => fromService((await listChapters(book_id))));
    server.registerTool("add_chapter_tomato", {
        title: "新增小说章节",
        description: "向指定书籍上传一个章节：填序号+标题+正文 →（confirm=true 时）下一步 → 选择内容检测方式 → 发布设置(是否使用AI) → 确认提交 → 错别字二次确认 → 接口复核。" +
            "正文可用 content、file_path 或 article_id（本地文稿库）。支持 scheduled_time 定时发布。默认 confirm=false 只填表不提交。",
        inputSchema: {
            book_id: z.string().describe("番茄书 ID（book_id）"),
            title: z.string().describe("章节标题（可含「第X章」，会自动剥离序号前缀）"),
            chapter_number: z.union([z.number(), z.string()]).optional().describe("章节序号（阿拉伯数字）"),
            content: z.string().optional().describe("章节正文（与 file_path/article_id 三选一）"),
            file_path: z.string().optional().describe("章节正文所在文件路径（UTF-8 文本）"),
            article_id: z.string().optional().describe("本地文稿库 article_id（优先于 file_path/content）"),
            detection: z.enum(["basic", "full"]).optional().describe("内容检测方式：basic=仅基础检测，full=全面检测（默认 basic）"),
            use_ai: z.boolean().optional().describe("发布设置的「是否使用AI」：**默认 false＝选「否」/本人原创**；显式 true 才选「是」"),
            scheduled_time: z.string().optional().describe("定时发布时间（ISO 字符串）；仅小说章节支持"),
            confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 false（便于人工核对）"),
        },
    }, async (args) => {
        let content = args.content ?? "";
        if (args.article_id) {
            const art = await articles.get(args.article_id);
            if (!art)
                return fail(missingArticleMessage(args.article_id));
            content = art.content;
        }
        else if (!content && args.file_path) {
            try {
                content = resolveContent(undefined, args.file_path).text;
            }
            catch (e) {
                return fail(e.message);
            }
        }
        if (!content)
            return fail("缺少正文：请提供 content、file_path 或 article_id。");
        const r = await uploadChapter({
            bookId: args.book_id,
            title: args.title,
            content,
            chapterNumber: args.chapter_number,
            detection: args.detection,
            useAI: args.use_ai,
            scheduledTime: args.scheduled_time,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && (r.action === "published" || r.action === "scheduled")) {
            await articles.update(args.article_id, {
                status: "published",
                publishTime: nowIso(),
                tomatoBookId: args.book_id,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        return fromService(r);
    });
    server.registerTool("update_chapter_tomato", {
        title: "修改已发布章节",
        description: "改已发布章节的标题 / 正文（走章节列表里的编辑入口 `publish/{chapterId}/?enter_from=modifychapter`，复用发布链路：下一步 → 内容检测方式 → 发布设置 → 确认提交 → 按 chapter_id 复核）。" +
            "正文可用 content、file_path 或 article_id；**都不给就保留线上正文、只改标题**。" +
            "⚠️ 改已发布章节通常会触发重新审核、影响曝光；且该编辑器边输入边自动保存，所以**默认 confirm=false 只打开修改页读现状 + 截图，完全不填充**；confirm=true 才填入并提交。" +
            "复核按 chapter_id 比对标题（不按标题匹配，改名后旧标题也在列表里）。",
        inputSchema: {
            book_id: z.string().describe("番茄书 ID（book_id）"),
            chapter_id: z.string().describe("要修改的章节 ID（从 list_chapters_tomato 的 id 取）"),
            title: z.string().describe("修改后的章节标题（会剥掉「第X章」前缀，与新建章节一致）"),
            chapter_number: z.union([z.number(), z.string()]).optional().describe("章节序号（一般不用改，留空则沿用线上）"),
            content: z.string().optional().describe("修改后的正文（与 file_path/article_id 三选一；都不给＝只改标题）"),
            file_path: z.string().optional().describe("正文所在文件路径（UTF-8 文本）"),
            article_id: z.string().optional().describe("本地文稿库 article_id（优先于 file_path/content）"),
            detection: z.enum(["basic", "full"]).optional().describe("内容检测方式：basic=仅基础检测，full=全面检测（默认 basic）"),
            use_ai: z.boolean().optional().describe("发布设置的「是否使用AI」：**默认 false＝选「否」/本人原创**；显式 true 才选「是」"),
            confirm: z.boolean().optional().describe("是否真正提交修改，默认 false（只读预览）"),
            headless: z.boolean().optional().describe("是否无头运行，默认 false（便于人工核对）"),
        },
    }, async (args) => {
        if (!String(args.title ?? "").trim())
            return fail("缺少 title：改章节必须给出修改后的标题。");
        let content = args.content ?? "";
        if (args.article_id) {
            const art = await articles.get(args.article_id);
            if (!art)
                return fail(missingArticleMessage(args.article_id));
            content = art.content;
        }
        else if (!content && args.file_path) {
            try {
                content = resolveContent(undefined, args.file_path).text;
            }
            catch (e) {
                return fail(e.message);
            }
        }
        // content 为空 = 保留线上正文、只改标题（uploadChapter 里按 keepBody 处理）
        const r = await uploadChapter({
            bookId: args.book_id,
            chapterId: args.chapter_id,
            title: args.title,
            content,
            chapterNumber: args.chapter_number,
            detection: args.detection,
            useAI: args.use_ai,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && r.action === "updated") {
            await articles.update(args.article_id, {
                tomatoBookId: args.book_id,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        return fromService(r);
    });
    server.registerTool("batch_publish_chapters", {
        title: "批量上传章节",
        description: "从本地文稿库挑「待发布」章节，按章节号顺序限速依次上传；单章失败不中断，返回逐章结果。" +
            "confirm=false 时只演练第 1 章（填表不提交），避免在后台留下大量草稿。",
        inputSchema: {
            novel_id: z.string().optional().describe("本地小说 id（用于解析 tomatoBookId）"),
            book_id: z.string().optional().describe("番茄书 ID（与 novel_id 二选一，优先）"),
            article_ids: z.array(z.string()).optional().describe("指定要上传的 article_id 列表（缺省＝该小说下所有待发布章节）"),
            limit: z.number().int().positive().optional().describe("最多上传多少章"),
            interval_seconds: z.number().min(0).optional().describe("每章之间间隔秒数，默认 5"),
            detection: z.enum(["basic", "full"]).optional().describe("内容检测方式：basic=仅基础检测，full=全面检测（默认 basic）"),
            use_ai: z.boolean().optional().describe("发布设置「是否使用AI」：默认 false＝选「否」/本人原创（显式 true 才选「是」）"),
            confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 false"),
        },
    }, async (args) => fromService((await batchPublishChapters({
        novelId: args.novel_id,
        bookId: args.book_id,
        articleIds: args.article_ids,
        limit: args.limit,
        intervalSeconds: args.interval_seconds,
        detection: args.detection,
        useAI: args.use_ai,
        confirm: args.confirm,
        headless: args.headless,
    }))));
}
