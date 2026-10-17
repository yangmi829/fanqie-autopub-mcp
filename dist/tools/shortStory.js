import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import { listShortStories, getShortStory, createShortStory, updateShortStory, publishShortStory, deleteShortStory, setShortStoryCover, validateShortContent, SHORT_MIN_WORDS, SHORT_MAX_WORDS, } from "../services/short.js";
import { articles, nowIso } from "../core/store.js";
import { resolveContent } from "../services/library.js";
const categoryShape = z.array(z.string()).optional().describe("作品分类名称（如 婚姻家庭/现言甜宠），主分类必选，最多 8 个");
/** article_id / file_path / content 三选一取正文 */
async function pickContent(args) {
    if (args.article_id) {
        const art = await articles.get(args.article_id);
        if (!art)
            throw new Error(`本地文稿库未找到 article_id=${args.article_id}`);
        return art.content;
    }
    if (args.content)
        return args.content;
    if (args.file_path)
        return resolveContent(undefined, args.file_path).text;
    return "";
}
export function registerShortStoryTools(server) {
    server.registerTool("list_short_stories_tomato", {
        title: "列出短故事",
        description: "读取作者后台短故事列表；status=draft 时读草稿箱。",
        inputSchema: {
            status: z.enum(["all", "draft"]).optional().describe("all=我的短故事（默认），draft=草稿箱"),
            page_index: z.number().int().min(0).optional(),
            page_count: z.number().int().positive().max(200).optional(),
        },
    }, async (args) => fromService((await listShortStories({ status: args.status, pageIndex: args.page_index, pageCount: args.page_count }))));
    server.registerTool("get_short_story_tomato", {
        title: "读取短故事详情",
        description: "读取某条短故事的标题/正文字数/分类/签约状态/可否修改等（edit/v1）。",
        inputSchema: {
            item_id: z.string().describe("短故事 item_id"),
        },
    }, async ({ item_id }) => fromService((await getShortStory(item_id))));
    server.registerTool("create_short_story_tomato", {
        title: "新建短故事（+保存草稿）",
        description: `新建短故事并可选保存草稿。打开空白编辑页时番茄会自动建一条草稿 item（返回 item_id）。` +
            `短故事正文官方区间 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（最佳 1w–3w）。` +
            `正文可用 content/file_path/article_id。默认 confirm=false 只填表不存草稿；confirm=true 才点「存草稿」。`,
        inputSchema: {
            title: z.string().describe("短故事名称"),
            content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
            file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
            article_id: z.string().optional().describe("本地文稿库 article_id（优先）"),
            categories: categoryShape,
            cover_path: z.string().optional().describe("本地封面图片路径（可选）"),
            use_ai: z.boolean().optional().describe("是否使用AI（发布信息项）"),
            divided_chapters: z.boolean().optional().describe("是否使用「分章」（对应 story_origin_divided_chapters）"),
            confirm: z.boolean().optional().describe("是否真正保存草稿，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        let content = "";
        try {
            content = await pickContent(args);
        }
        catch (e) {
            return fail(e.message);
        }
        const r = await createShortStory({
            title: args.title,
            content,
            categories: args.categories,
            coverPath: args.cover_path,
            useAI: args.use_ai,
            dividedChapters: args.divided_chapters,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && r.itemId && (r.action === "draft-saved" || r.action === "published")) {
            await articles.update(args.article_id, {
                status: "published",
                tomatoItemId: r.itemId,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        return fromService(r);
    });
    server.registerTool("update_short_story_tomato", {
        title: "修改短故事",
        description: "改「已存在」短故事的标题 / 正文 / 分类 / 封面 / 是否使用AI（打开 /publish-short/{item_id} 编辑页）。" +
            "正文可用 content/file_path/article_id；**只覆盖显式传入的字段**，未传的保持线上原值。" +
            "confirm=true 只点「存草稿」（**不会发布**，且至少要给一个要改的字段）；默认 confirm=false 只打开编辑页读现状 + 截图，**完全不填充**（可只传 item_id 探现状）。" +
            "⚠️ 已发布的短故事可能不允许再次修改（以页面/后台为准）；要发布请用 publish_short_story_tomato。",
        inputSchema: {
            item_id: z.string().describe("要修改的短故事 item_id"),
            title: z.string().optional().describe("短故事名称（不给＝不改标题）"),
            content: z.string().optional().describe("正文（与 file_path/article_id 三选一；不给＝不改正文）"),
            file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
            article_id: z.string().optional().describe("本地文稿库 article_id（优先于 file_path/content）"),
            categories: categoryShape,
            cover_path: z.string().optional().describe("本地封面图片路径（可选）"),
            use_ai: z.boolean().optional().describe("是否使用AI（不给＝不改）"),
            confirm: z.boolean().optional().describe("是否真正保存修改，默认 false（只读预览）"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        let content;
        if (args.content || args.file_path || args.article_id) {
            try {
                content = (await pickContent(args)) || undefined;
            }
            catch (e) {
                return fail(e.message);
            }
        }
        const r = await updateShortStory({
            itemId: args.item_id,
            title: args.title,
            content,
            categories: args.categories,
            coverPath: args.cover_path,
            useAI: args.use_ai,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && r.action === "updated") {
            await articles.update(args.article_id, {
                tomatoItemId: args.item_id,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        return fromService(r);
    });
    server.registerTool("publish_short_story_tomato", {
        title: "发布短故事",
        description: `发布短故事。可给 item_id 直接发布已有作品，或给 title(+content) 新建并发布。` +
            `confirm=false 只填表预览；confirm=true 才走 存草稿 → 下一步 → 发布。` +
            `若命中实名/人脸验证会停止并提示人工完成。字数需在 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}。`,
        inputSchema: {
            item_id: z.string().optional().describe("要发布的短故事 item_id（与 title 二选一）"),
            title: z.string().optional().describe("短故事名称（配合 content 新建并发布）"),
            content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
            file_path: z.string().optional(),
            article_id: z.string().optional(),
            categories: categoryShape,
            cover_path: z.string().optional(),
            sign_type: z.number().int().optional().describe("签约类型（一般不用改）"),
            divided_chapters: z.boolean().optional().describe("是否使用分章"),
            use_ai: z.boolean().optional(),
            confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        if (!args.item_id && !args.title)
            return fail("需提供 item_id，或 title（+content）以新建并发布。");
        let content = "";
        try {
            content = await pickContent(args);
        }
        catch (e) {
            return fail(e.message);
        }
        if (content) {
            const { wordCount, warnings } = validateShortContent(content);
            if (args.confirm && (wordCount < SHORT_MIN_WORDS || wordCount > SHORT_MAX_WORDS)) {
                return fail(`正文字数 ${wordCount} 不在短故事区间 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}，发布会被拦截。`, warnings.join("；"));
            }
        }
        const r = await publishShortStory({
            itemId: args.item_id,
            title: args.title,
            content,
            categories: args.categories,
            coverPath: args.cover_path,
            signType: args.sign_type,
            dividedChapters: args.divided_chapters,
            useAI: args.use_ai,
            confirm: args.confirm,
            headless: args.headless,
        });
        if (args.article_id && r.itemId && r.action === "published") {
            await articles.update(args.article_id, {
                status: "published",
                tomatoItemId: r.itemId,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        return fromService(r);
    });
    server.registerTool("set_short_story_cover_tomato", {
        title: "设置短故事封面",
        description: "为已有短故事上传本地封面图片（通过编辑页文件上传入口，由页面自身完成 cover/v0 签名）。默认 confirm=false 只上传不保存。",
        inputSchema: {
            item_id: z.string().describe("短故事 item_id"),
            cover_path: z.string().describe("本地封面图片路径"),
            confirm: z.boolean().optional().describe("是否保存草稿以持久化封面，默认 false"),
            headless: z.boolean().optional(),
        },
    }, async (args) => fromService((await setShortStoryCover(args.item_id, { coverPath: args.cover_path, confirm: args.confirm, headless: args.headless }))));
    server.registerTool("delete_short_story_tomato", {
        title: "删除短故事/草稿",
        description: "删除指定短故事或草稿（破坏性）。默认 confirm=false 只预览；confirm=true 才真正删除。",
        inputSchema: {
            item_id: z.string().describe("短故事 item_id"),
            confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
        },
    }, async ({ item_id, confirm }) => fromService((await deleteShortStory(item_id, { confirm }))));
}
