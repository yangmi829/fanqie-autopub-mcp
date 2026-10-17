import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { listBooks, createBook, setBookTags, validateContentTagCaps, CONTENT_TAG_CAPS } from "../services/novel.js";
import { novels, newId, nowIso } from "../core/store.js";
const tagShape = z.array(z.string()).optional();
export function registerNovelTools(server) {
    server.registerTool("list_novels_tomato", {
        title: "列出番茄小说",
        description: "读取作者后台真实小说列表（拿真实 book_id），用于核对与回填。可选把结果同步进本地小说登记（供批量上传用）。",
        inputSchema: {
            sync_local: z.boolean().optional().describe("是否把后台书籍同步为本地小说登记（默认 false）"),
        },
    }, async ({ sync_local }) => {
        const r = await listBooks();
        if (!r.ok)
            return fail(r.message);
        if (sync_local) {
            const existing = await novels.all();
            let added = 0;
            for (const b of r.books ?? []) {
                if (existing.some((n) => n.tomatoBookId === b.bookId))
                    continue;
                const now = nowIso();
                await novels.insert({
                    id: newId("nov"),
                    title: b.bookName,
                    gender: 1,
                    tomatoBookId: b.bookId,
                    tomatoBookName: b.bookName,
                    createdAt: now,
                    updatedAt: now,
                });
                added++;
            }
            return ok({ ...r, synced_local: added });
        }
        return ok(r);
    });
    server.registerTool("create_novel_tomato", {
        title: "新增小说（建书）",
        description: `在番茄作者后台真实建书。必填：title(书名≤15字)、gender(1男频/0女频)、protagonist1/2(主角名各≤5字)、abstract(简介50–500字)。` +
            `内容标签上限：情节≤${CONTENT_TAG_CAPS.plot}/情感≤${CONTENT_TAG_CAPS.emotion}/人设≤${CONTENT_TAG_CAPS.character}/世界观≤${CONTENT_TAG_CAPS.worldview}。` +
            `默认 confirm=false 只做预检与预览，不建书；confirm=true 才真正提交。`,
        inputSchema: {
            title: z.string().describe("书名（≤15 字）"),
            gender: z.number().int().min(0).max(1).describe("频道：1=男频，0=女频"),
            protagonist1: z.string().describe("主角名1（≤5 字，必填）"),
            protagonist2: z.string().optional().describe("主角名2（≤5 字，可选）"),
            abstract: z.string().describe("作品简介（50–500 字）"),
            reading_tags: tagShape.describe("阅读标签"),
            content_tags: z
                .object({
                plot: tagShape.describe("情节标签"),
                emotion: tagShape.describe("情感标签"),
                character: tagShape.describe("人设标签"),
                worldview: tagShape.describe("世界观标签"),
            })
                .optional()
                .describe("内容标签（4 组，各有上限）"),
            confirm: z.boolean().optional().describe("是否真正提交建书，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
            register_local: z.boolean().optional().describe("建书成功后是否登记到本地小说（默认 true）"),
        },
    }, async (args) => {
        const over = args.content_tags ? validateContentTagCaps(args.content_tags) : [];
        if (over.length)
            return fail(`内容标签超出上限：${over.join("；")}`);
        const r = await createBook({
            bookName: args.title,
            gender: args.gender,
            protagonist1: args.protagonist1,
            protagonist2: args.protagonist2 ?? "",
            abstract: args.abstract,
            readingTags: args.reading_tags,
            contentTags: args.content_tags,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (r.ok && r.action === "created" && r.bookId && args.register_local !== false) {
            const now = nowIso();
            await novels.insert({
                id: newId("nov"),
                title: args.title,
                gender: args.gender,
                protagonist1: args.protagonist1,
                protagonist2: args.protagonist2,
                abstract: args.abstract,
                tomatoBookId: r.bookId,
                tomatoBookName: args.title,
                readingTags: args.reading_tags,
                contentTags: args.content_tags,
                createdAt: now,
                updatedAt: now,
            });
        }
        return fromService(r);
    });
    server.registerTool("set_book_tags", {
        title: "设置作品标签（阅读 / 内容）",
        description: `为已存在的番茄书设置「阅读标签」与「内容标签」。先查作品是否处于审核锁（can_modify），被锁则直接告知原因不修改。` +
            `内容标签上限：情节≤${CONTENT_TAG_CAPS.plot}/情感≤${CONTENT_TAG_CAPS.emotion}/人设≤${CONTENT_TAG_CAPS.character}/世界观≤${CONTENT_TAG_CAPS.worldview}。` +
            `默认 confirm=false 只查锁 + 预览；confirm=true 才打开编辑页勾选并保存。`,
        inputSchema: {
            book_id: z.string().describe("番茄书 ID"),
            reading_tags: tagShape.describe("阅读标签"),
            content_tags: z
                .object({
                plot: tagShape.describe("情节标签"),
                emotion: tagShape.describe("情感标签"),
                character: tagShape.describe("人设标签"),
                worldview: tagShape.describe("世界观标签"),
            })
                .optional()
                .describe("内容标签（4 组，各有上限）"),
            confirm: z.boolean().optional().describe("是否真正打开编辑页勾选并保存，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        const over = args.content_tags ? validateContentTagCaps(args.content_tags) : [];
        if (over.length)
            return fail(`内容标签超出上限：${over.join("；")}`);
        const r = await setBookTags({
            bookId: args.book_id,
            readingTags: args.reading_tags,
            contentTags: args.content_tags,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (r.action === "preview" || r.action === "locked")
            return ok(r);
        return fromService(r);
    });
}
