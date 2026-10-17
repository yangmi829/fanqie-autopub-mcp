import { z } from "zod";
import { ok, fail, fromService } from "../core/result.js";
import { listBooks, createBook, setBookTags, updateBookInfo, validateContentTagCaps, CONTENT_TAG_CAPS } from "../services/novel.js";
import { updateNovel } from "../services/localNovel.js";
import { novels, newId, nowIso } from "../core/store.js";
const tagShape = z.array(z.string()).optional();
/** 番茄作品信息的字段限制（与前端 maxlength / 计数一致） */
const BOOK_INFO_LIMITS = { title: 15, protagonist: 5, abstractMin: 50, abstractMax: 500 };
/** 非空字符数（去掉空白，中文按字计） */
function charCount(s) {
    return [...s.replace(/\s/g, "")].length;
}
/** 提交前校验作品信息字段；返回错误文案或 null */
function validateBookInfoFields(args) {
    if (args.title !== undefined && charCount(args.title) > BOOK_INFO_LIMITS.title)
        return `书名不能超过 ${BOOK_INFO_LIMITS.title} 字（当前 ${charCount(args.title)}）。`;
    for (const [label, v] of [
        ["主角名1", args.protagonist1],
        ["主角名2", args.protagonist2],
    ]) {
        if (v !== undefined && charCount(v) > BOOK_INFO_LIMITS.protagonist)
            return `${label}不能超过 ${BOOK_INFO_LIMITS.protagonist} 字（当前 ${charCount(v)}）。`;
    }
    if (args.abstract !== undefined) {
        const n = charCount(args.abstract);
        if (n < BOOK_INFO_LIMITS.abstractMin || n > BOOK_INFO_LIMITS.abstractMax)
            return `作品简介需 ${BOOK_INFO_LIMITS.abstractMin}–${BOOK_INFO_LIMITS.abstractMax} 字（当前 ${n}）。`;
    }
    const hasTag = (args.reading_tags?.length ?? 0) > 0 ||
        Object.values(args.content_tags ?? {}).some((v) => (v?.length ?? 0) > 0);
    const hasField = [args.title, args.protagonist1, args.protagonist2, args.abstract].some((v) => v !== undefined && v.trim() !== "");
    if (!hasField && !hasTag)
        return "至少要提供一个要修改的字段（书名/主角名/简介/标签）。";
    return null;
}
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
        description: `为已存在的番茄书设置「阅读标签」与「内容标签」（走「作品信息 → 修改」弹窗）。先查作品是否处于审核锁（can_modify），被锁则直接告知原因不修改。` +
            `语义是「确保这些标签处于选中」：已经选中的会跳过（不会误取消）。` +
            `内容标签上限：情节≤${CONTENT_TAG_CAPS.plot}/情感≤${CONTENT_TAG_CAPS.emotion}/人设≤${CONTENT_TAG_CAPS.character}/世界观≤${CONTENT_TAG_CAPS.worldview}。` +
            `默认 confirm=false 只打开弹窗填表 + 截图（不提交）；confirm=true 才点「立即修改」。`,
        inputSchema: {
            book_id: z.string().describe("番茄书 ID"),
            reading_tags: tagShape.describe("阅读标签（要处于选中状态的标签）"),
            content_tags: z
                .object({
                plot: tagShape.describe("情节标签"),
                emotion: tagShape.describe("情感标签"),
                character: tagShape.describe("人设标签"),
                worldview: tagShape.describe("世界观标签"),
            })
                .optional()
                .describe("内容标签（4 组，各有上限）"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false（只填表 + 截图）"),
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
    server.registerTool("update_novel_info_tomato", {
        title: "修改已有作品信息（书名 / 主角名 / 简介 / 标签）",
        description: `改「已发布」番茄书的作品信息：书名(≤${BOOK_INFO_LIMITS.title}字)、主角名1/2(各≤${BOOK_INFO_LIMITS.protagonist}字)、` +
            `作品简介(${BOOK_INFO_LIMITS.abstractMin}–${BOOK_INFO_LIMITS.abstractMax}字)、阅读标签、内容标签。` +
            `走作品信息页(type=1) → 「修改」→「修改作品信息」弹窗；受作品信息审核锁保护，被锁直接返回 locked。` +
            `标签语义是「确保选中」：已选中的会跳过，不会误取消。只覆盖显式传入的字段。` +
            `默认 confirm=false 只打开弹窗填表 + 截图（不提交）；confirm=true 才点「立即修改」。` +
            `⚠️ 改书名/简介可能触发重新审核、影响曝光，请谨慎。`,
        inputSchema: {
            book_id: z.string().describe("番茄书 ID"),
            title: z.string().optional().describe(`书名（≤${BOOK_INFO_LIMITS.title} 字）`),
            protagonist1: z.string().optional().describe(`主角名1（≤${BOOK_INFO_LIMITS.protagonist} 字）`),
            protagonist2: z.string().optional().describe(`主角名2（≤${BOOK_INFO_LIMITS.protagonist} 字）`),
            abstract: z
                .string()
                .optional()
                .describe(`作品简介（${BOOK_INFO_LIMITS.abstractMin}–${BOOK_INFO_LIMITS.abstractMax} 字）`),
            reading_tags: tagShape.describe("阅读标签（要处于选中状态）"),
            content_tags: z
                .object({
                plot: tagShape.describe("情节标签"),
                emotion: tagShape.describe("情感标签"),
                character: tagShape.describe("人设标签"),
                worldview: tagShape.describe("世界观标签"),
            })
                .optional()
                .describe("内容标签（4 组，各有上限）"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false（只填表 + 截图）"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        const over = args.content_tags ? validateContentTagCaps(args.content_tags) : [];
        if (over.length)
            return fail(`内容标签超出上限：${over.join("；")}`);
        const invalid = validateBookInfoFields(args);
        if (invalid)
            return fail(invalid);
        const r = await updateBookInfo({
            bookId: args.book_id,
            title: args.title,
            protagonist1: args.protagonist1,
            protagonist2: args.protagonist2,
            abstract: args.abstract,
            readingTags: args.reading_tags,
            contentTags: args.content_tags,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (r.action === "preview" || r.action === "locked")
            return ok(r);
        return fromService(r);
    });
    server.registerTool("update_novel", {
        title: "修改本地小说登记 / 创作设定",
        description: "改本地小说登记（data/novels.json）的登记信息与创作设定：书名、频道、简介、主角名、阅读/内容标签、番茄书号绑定，" +
            "以及 genre/synopsis/outline/world_setting/golden_hook/characters/target_words_per_chapter/status 等创作字段。" +
            "只覆盖显式传入的字段，未传的保持原值。长文本（大纲/世界观等）可用 *_file 指到磁盘文件，避免把几万字塞进参数。" +
            "**纯本地，不改动番茄后台**；阅读用资源 fanqie://novels。",
        inputSchema: {
            novel_id: z.string().describe("本地小说 id（novel_xxx）"),
            title: z.string().optional().describe("书名"),
            gender: z.number().int().min(0).max(1).optional().describe("频道：1=男频，0=女频"),
            abstract: z.string().optional().describe("作品简介"),
            protagonist1: z.string().optional().describe("主角名1"),
            protagonist2: z.string().optional().describe("主角名2"),
            reading_tags: tagShape.describe("阅读标签"),
            content_tags: z
                .object({
                plot: tagShape.describe("情节标签"),
                emotion: tagShape.describe("情感标签"),
                character: tagShape.describe("人设标签"),
                worldview: tagShape.describe("世界观标签"),
            })
                .optional()
                .describe("内容标签（4 组）"),
            tomato_book_id: z.string().optional().describe("番茄 book_id（绑定用）"),
            tomato_book_name: z.string().optional().describe("番茄书名"),
            genre: z.string().optional().describe("赛道 key（参见 list_genres）"),
            synopsis: z.string().optional().describe("一句话简介 / 核心卖点"),
            outline: z.string().optional().describe("全书大纲（长文本建议改用 outline_file）"),
            world_setting: z.string().optional().describe("世界观设定（长文本建议改用 world_setting_file）"),
            golden_hook: z.string().optional().describe("开篇钩子"),
            characters: z
                .array(z.object({
                name: z.string(),
                role: z.string().optional(),
                traits: z.string().optional(),
            }))
                .optional()
                .describe("主要人物设定"),
            target_words_per_chapter: z.number().int().optional().describe("单章目标字数"),
            status: z.string().optional().describe("本地创作状态标记（如 连载中/已完结）"),
            synopsis_file: z.string().optional().describe("synopsis 的文本文件路径"),
            outline_file: z.string().optional().describe("outline 的文本文件路径（如 大纲.md）"),
            world_setting_file: z.string().optional().describe("world_setting 的文本文件路径"),
            golden_hook_file: z.string().optional().describe("golden_hook 的文本文件路径"),
            characters_file: z.string().optional().describe("characters 的 JSON 文件路径：[{name,role?,traits?}]"),
        },
    }, async (args) => {
        const r = await updateNovel({
            novelId: args.novel_id,
            title: args.title,
            gender: args.gender,
            abstract: args.abstract,
            protagonist1: args.protagonist1,
            protagonist2: args.protagonist2,
            readingTags: args.reading_tags,
            contentTags: args.content_tags,
            tomatoBookId: args.tomato_book_id,
            tomatoBookName: args.tomato_book_name,
            genre: args.genre,
            synopsis: args.synopsis,
            outline: args.outline,
            worldSetting: args.world_setting,
            goldenHook: args.golden_hook,
            characters: args.characters,
            targetWordsPerChapter: args.target_words_per_chapter,
            status: args.status,
            synopsisFile: args.synopsis_file,
            outlineFile: args.outline_file,
            worldSettingFile: args.world_setting_file,
            goldenHookFile: args.golden_hook_file,
            charactersFile: args.characters_file,
        });
        if (!r.ok)
            return fail(r.message);
        // 只回摘要：大纲等长字段不往响应里塞
        return ok({
            ok: true,
            action: r.action,
            message: r.message,
            novel_id: r.novel?.id,
            title: r.novel?.title,
            changed: r.changed,
            wordCounts: r.wordCounts,
        });
    });
}
