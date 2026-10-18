import { z } from "zod";
import { fromService } from "../core/result.js";
import { createMicroHeadline, listMicroHeadlines, listMicroHeadlineDrafts, WTT_MIN_CHARS, WTT_MAX_CHARS, WTT_HINT_CHARS, WTT_MAX_IMAGES, WTT_DAILY_LIMIT, } from "../services/microHeadline.js";
export function registerMicroHeadlineTools(server) {
    server.registerTool("create_micro_headline_tomato", {
        title: "新建微头条",
        description: `给短故事发一条「微头条」引流（番茄：作品管理 → 短篇作品 → 作品推荐 → 新建微头条）。` +
            `形式是「文字 + 书籍卡片」，必须关联一个短篇；正文 ${WTT_MIN_CHARS}–${WTT_MAX_CHARS} 字（官方建议 ≤${WTT_HINT_CHARS} 字），` +
            `图片最多 ${WTT_MAX_IMAGES} 张（可选），每天最多 ${WTT_DAILY_LIMIT} 条。` +
            `\n\n**推荐工作流（两段式）**：` +
            `① 先 confirm=false（默认）：工具读取该短故事的标题/正文，**自动生成引导语**（#故事推荐# + 开篇节选 + 作品卡点句 + 话题标签）、` +
            `填好表单并截图，返回里带 \`content\`——把这段 content 给用户过目确认；` +
            `② 用户认可后 confirm=true 才真正提交，写入由页面自身签名（publish_wtt）。` +
            `\n若用户已有更好的引导语，直接传 content 覆盖自动生成；只存草稿传 draft=true。`,
        inputSchema: {
            item_id: z.string().optional().describe("要推荐的短故事 item_id（推荐：用它取标题/正文自动生成引导语）"),
            title: z.string().optional().describe("短故事作品名（无 item_id 时用；必须与后台「插入短篇」里的名字一致）"),
            content: z
                .string()
                .optional()
                .describe(`微头条正文（${WTT_MIN_CHARS}–${WTT_MAX_CHARS} 字）；不给则按短故事自动生成引导语`),
            image_paths: z.array(z.string()).optional().describe(`配图本地路径（最多 ${WTT_MAX_IMAGES} 张 png/jpg，可选）`),
            draft: z.boolean().optional().describe("true=只存草稿箱（不发布）；默认 false=发布"),
            confirm: z.boolean().optional().describe("是否真正提交，默认 false（只填表 + 截图，等用户确认后再提交）"),
            headless: z.boolean().optional().describe("是否无头运行，默认 true"),
        },
    }, async (args) => {
        if (!args.item_id && !args.title) {
            return fromService({ ok: false, message: "需提供 item_id（短故事 id），或与后台作品名一致的 title。" });
        }
        const r = await createMicroHeadline({
            itemId: args.item_id,
            title: args.title,
            content: args.content,
            imagePaths: args.image_paths,
            draft: args.draft,
            confirm: args.confirm,
            headless: args.headless,
        });
        return fromService(r);
    });
    server.registerTool("list_micro_headlines_tomato", {
        title: "列出微头条",
        description: "读「作品推荐」里的微头条：drafts=true 读草稿箱，否则读已发布列表（含推荐状态、阅读量、可否编辑/删除）。",
        inputSchema: {
            drafts: z.boolean().optional().describe("true=读草稿箱，默认 false=读已发布列表"),
        },
    }, async ({ drafts }) => fromService((drafts ? await listMicroHeadlineDrafts() : await listMicroHeadlines())));
}
