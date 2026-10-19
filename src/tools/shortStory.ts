import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fromService, fail } from "../core/result.js";
import {
  listShortStories,
  getShortStory,
  createShortStory,
  updateShortStory,
  publishShortStory,
  deleteShortStory,
  setShortStoryCover,
  validateShortContent,
  SHORT_MIN_WORDS,
  SHORT_MAX_WORDS,
} from "../services/short.js";
import { articles, nowIso } from "../core/store.js";
import { logger } from "../core/logger.js";
import { resolveContent, syncArticleAfterPublish } from "../services/library.js";
import { buildMicroHeadlineDraft, WTT_DAILY_LIMIT } from "../services/microHeadline.js";

const categoryShape = z.array(z.string()).optional().describe("作品分类名称（如 婚姻家庭/现言甜宠），主分类必选，最多 8 个");
const mainCategoryShape = z
  .string()
  .optional()
  .describe(
    "主分类名称（必须取自平台「主分类」组，如 女生生活/男生生活）。发布时主分类必选；" +
      "传了它就会自动并进 categories；不传则要求 categories 里自带主分类组的名字，否则发布被拒并返回可选值。"
  );

/** article_id / file_path / content 三选一取正文 */
async function pickContent(args: { content?: string; file_path?: string; article_id?: string }): Promise<string> {
  if (args.article_id) {
    const art = await articles.get(args.article_id);
    if (!art) throw new Error(`本地文稿库未找到 article_id=${args.article_id}`);
    return art.content;
  }
  if (args.content) return args.content;
  if (args.file_path) return resolveContent(undefined, args.file_path).text;
  return "";
}

/**
 * 短故事发布成功后，附上「是否顺便发一条微头条引流」的建议。
 *
 * 微头条（作品推荐）是番茄给短故事引流的官方玩法：文字 + 书籍卡片，每天最多 10 条。
 * 这里用**本地生成**的引导语草稿（确定性、不联网）让调用方直接拿给用户确认；
 * 用户点头后再调 `create_micro_headline_tomato`（confirm=false 预览 → confirm=true 提交）。
 */
function withMicroHeadlineSuggestion<T extends { ok: boolean; action?: string; itemId?: string }>(
  r: T,
  ctx: { title?: string; content?: string }
): T & { microHeadline?: Record<string, unknown> } {
  if (r.action !== "published" || !r.itemId) return r;
  const title = (ctx.title || "").trim();
  const draft = ctx.content ? buildMicroHeadlineDraft({ title, content: ctx.content }) : undefined;
  return {
    ...r,
    microHeadline: {
      ask:
        `已发布短故事（item_id=${r.itemId}）。**请问用户：要不要再发一条「微头条」给这篇短故事引流？**` +
        `（文字 + 作品卡片，每天最多 ${WTT_DAILY_LIMIT} 条；发布后按内容质量给量：小流量推荐 → 热推中。）`,
      ...(draft
        ? {
            draftContent: draft.content,
            chars: draft.chars,
            note: "上方 draftContent 是按短故事自动生成的引导语草稿，先给用户过目；用户认可后再提交。",
          }
        : { note: "未拿到正文，无法本地生成草稿：调 create_micro_headline_tomato(item_id=…, confirm=false) 会自动生成并返回 content。" }),
      how: `create_micro_headline_tomato(item_id="${r.itemId}"${draft ? `, content=<用户确认后的正文>` : ""}, confirm=false) 预览 → 用户确认 → confirm=true 发布。`,
      warnings: draft?.warnings,
    },
  };
}

export function registerShortStoryTools(server: McpServer): void {
  server.registerTool(
    "list_short_stories_tomato",
    {
      title: "列出短故事",
      description: "读取作者后台短故事列表；status=draft 时读草稿箱。",
      inputSchema: {
        status: z.enum(["all", "draft"]).optional().describe("all=我的短故事（默认），draft=草稿箱"),
        page_index: z.number().int().min(0).optional(),
        page_count: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) =>
      fromService(
        (await listShortStories({ status: args.status, pageIndex: args.page_index, pageCount: args.page_count })) as any
      )
  );

  server.registerTool(
    "get_short_story_tomato",
    {
      title: "读取短故事详情",
      description: "读取某条短故事的标题/正文字数/分类/签约状态/可否修改等（edit/v1）。",
      inputSchema: {
        item_id: z.string().describe("短故事 item_id"),
      },
    },
    async ({ item_id }) => fromService((await getShortStory(item_id)) as any)
  );

  server.registerTool(
    "create_short_story_tomato",
    {
      title: "新建短故事（+保存草稿）",
      description:
        `新建短故事并可选保存草稿。打开空白编辑页时番茄会自动建一条草稿 item（返回 item_id）。` +
        `短故事正文官方区间 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字（最佳 1w–3w）。` +
        `正文可用 content/file_path/article_id。默认 confirm=false 只填表不存草稿；confirm=true 才点「存草稿」。`,
      inputSchema: {
        title: z.string().describe("短故事名称"),
        content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
        file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
        article_id: z.string().optional().describe("本地文稿库 article_id（优先）"),
        categories: categoryShape,
        main_category: mainCategoryShape,
        cover_path: z.string().optional().describe("本地封面图片路径（可选）"),
        use_ai: z.boolean().optional().describe("是否使用AI（发布信息项）"),
        divided_chapters: z.boolean().optional().describe("是否使用「分章」（对应 story_origin_divided_chapters）"),
        confirm: z.boolean().optional().describe("是否真正保存草稿，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      let content = "";
      try {
        content = await pickContent(args);
      } catch (e) {
        return fail((e as Error).message);
      }
      const r = await createShortStory({
        title: args.title,
        content,
        categories: args.categories,
        mainCategory: args.main_category,
        coverPath: args.cover_path,
        useAI: args.use_ai,
        dividedChapters: args.divided_chapters,
        confirm: args.confirm,
        headless: args.headless,
      });
      // 只「存草稿」的路径**不能**标 published（历史上这里误标过，会让本地库谎报已发布）。
      // 发布必须走 publish_short_story_tomato，那里有 publish_status 复核 + 回写。
      if (args.article_id && r.itemId) {
        await articles.update(args.article_id, {
          tomatoItemId: r.itemId,
          lastMessage: r.message,
          updatedAt: nowIso(),
        });
      }
      return fromService(r as any);
    }
  );

  server.registerTool(
    "update_short_story_tomato",
    {
      title: "修改短故事",
      description:
        "改「已存在」短故事的标题 / 正文 / 分类 / 封面 / 是否使用AI（打开 /publish-short/{item_id} 编辑页）。" +
        "正文可用 content/file_path/article_id；**只覆盖显式传入的字段**，未传的保持线上原值。" +
        "confirm=true 只点「存草稿」（**不会发布**，且至少要给一个要改的字段）；默认 confirm=false 只打开编辑页读现状 + 截图，**完全不填充**（可只传 item_id 探现状）。" +
        "封面走「封面设置 →（抽屉）本地上传」；use_ai 是发布时的必填项，这里可先存好。" +
        "⚠️ 已发布的短故事可能不允许再次修改（以页面/后台为准）；要发布请用 publish_short_story_tomato。",
      inputSchema: {
        item_id: z.string().describe("要修改的短故事 item_id"),
        title: z.string().optional().describe("短故事名称（不给＝不改标题）"),
        content: z.string().optional().describe("正文（与 file_path/article_id 三选一；不给＝不改正文）"),
        file_path: z.string().optional().describe("正文文件路径（UTF-8 文本）"),
        article_id: z.string().optional().describe("本地文稿库 article_id（优先于 file_path/content）"),
        categories: categoryShape,
        main_category: mainCategoryShape,
        cover_path: z.string().optional().describe("本地封面图片路径（可选）"),
        use_ai: z.boolean().optional().describe("是否使用AI（不给＝不改）"),
        confirm: z.boolean().optional().describe("是否真正保存修改，默认 false（只读预览）"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      let content: string | undefined;
      if (args.content || args.file_path || args.article_id) {
        try {
          content = (await pickContent(args)) || undefined;
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      const r = await updateShortStory({
        itemId: args.item_id,
        title: args.title,
        content,
        categories: args.categories,
        mainCategory: args.main_category,
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
      return fromService(r as any);
    }
  );

  server.registerTool(
    "publish_short_story_tomato",
    {
      title: "发布短故事",
      description:
        `发布短故事。可给 item_id 直接发布已有作品，或给 title(+content) 新建并发布。` +
        `confirm=false 只填表预览；confirm=true 才走 补齐必填项 → 存草稿 → 下一步 →（发布提示）→ 提交确认 → 发布。` +
        `⚠️ 平台强制三个必填项（缺一个「下一步」只会弹 3 秒即消失的 toast）：` +
        `① 封面（传 cover_path，或该草稿/作品已有封面）；② use_ai=true|false（发布必须显式声明，工具不替你猜）；` +
        `③ 发布协议（自动勾）+ 试读比例（自动点「去设置」落一条 30% 试读线）。` +
        `④ 分类：平台是「主分类 + 附加分类」，**主分类必选**——传 categories 时请把主分类组的名字一起给（或用 main_category），` +
        `否则本工具会在点「下一步」前直接返回错误并列出主分类可选值（不会干等弹窗超时）。` +
        `发布后按 edit/v1 的 publish_status=1 复核，并**回写本地文稿库**（article_id → tomato_item_id → 标题精确匹配；匹配不到返回 warning）。` +
        `若命中实名/人脸验证会停止并提示人工完成。字数需在 ${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}。` +
        `\n**发布成功后本工具会在返回里给出 \`microHeadline\` 建议：请据此询问用户「要不要再发一条微头条给这篇短故事引流」，` +
        `用户同意后用 create_micro_headline_tomato（先 confirm=false 预览自动生成的引导语，确认后再 confirm=true 发布）。**`,
      inputSchema: {
        item_id: z.string().optional().describe("要发布的短故事 item_id（与 title 二选一）"),
        title: z.string().optional().describe("短故事名称（配合 content 新建并发布）"),
        content: z.string().optional().describe("正文（与 file_path/article_id 三选一）"),
        file_path: z.string().optional(),
        article_id: z.string().optional(),
        categories: categoryShape,
        main_category: mainCategoryShape,
        cover_path: z.string().optional().describe("本地封面图片路径（发布必填项的来源之一；不给＝沿用该草稿已有封面）"),
        sign_type: z.number().int().optional().describe("签约类型（一般不用改）"),
        divided_chapters: z.boolean().optional().describe("是否使用分章"),
        use_ai: z
          .boolean()
          .optional()
          .describe("是否使用AI（**confirm=true 发布时必填**：平台强制声明，不给会被本工具直接拒绝）"),
        confirm: z.boolean().optional().describe("是否真正发布，默认 false"),
        headless: z.boolean().optional().describe("是否无头运行，默认 true"),
      },
    },
    async (args) => {
      if (!args.item_id && !args.title) return fail("需提供 item_id，或 title（+content）以新建并发布。");
      let content = "";
      try {
        content = await pickContent(args);
      } catch (e) {
        return fail((e as Error).message);
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
        mainCategory: args.main_category,
        coverPath: args.cover_path,
        signType: args.sign_type,
        dividedChapters: args.divided_chapters,
        useAI: args.use_ai,
        confirm: args.confirm,
        headless: args.headless,
      });
      // 发布成功 → 回写本地文稿库（article_id 优先，其次 tomatoItemId / 标题精确匹配），
      // 匹配不到就明确 warning，绝不静默（否则本地库长期显示 draft，容易重复发布）。
      if (r.itemId && r.action === "published") {
        const wb = await syncArticleAfterPublish({
          articleId: args.article_id,
          itemId: r.itemId,
          title: r.title ?? args.title,
          message: r.message,
        });
        (r as any).localArticle = { articleId: wb.articleId, matchedBy: wb.matchedBy, otherCandidates: wb.otherCandidates };
        if (!wb.ok) r.warnings = [...(r.warnings ?? []), wb.message];
        else logger.info(`[publish_short_story_tomato] ${wb.message}`);
      } else if (args.article_id && r.itemId && r.action !== "published") {
        // 没发成也别静默：把平台的实况写回 lastMessage，方便下次判断
        await articles.update(args.article_id, { tomatoItemId: r.itemId, lastMessage: r.message, updatedAt: nowIso() });
      }
      return fromService(withMicroHeadlineSuggestion(r, { title: args.title ?? r.title, content }) as any);
    }
  );

  server.registerTool(
    "set_short_story_cover_tomato",
    {
      title: "设置短故事封面",
      description:
        "为已有短故事上传本地封面图片：走编辑页「封面设置 →（抽屉）本地上传」→ 勾图片上传协议 → 确认上传，" +
        "由页面自身完成 cover/v0 签名。平台建议 600×800、jpg/png、≤5MB。默认 confirm=false 只上传不保存（不落库）。",
      inputSchema: {
        item_id: z.string().describe("短故事 item_id"),
        cover_path: z.string().describe("本地封面图片路径（建议 600x800 竖图 jpg/png，≤5MB）"),
        confirm: z.boolean().optional().describe("是否保存草稿以持久化封面，默认 false"),
        headless: z.boolean().optional(),
      },
    },
    async (args) =>
      fromService(
        (await setShortStoryCover(args.item_id, { coverPath: args.cover_path, confirm: args.confirm, headless: args.headless })) as any
      )
  );

  server.registerTool(
    "delete_short_story_tomato",
    {
      title: "删除短故事/草稿",
      description: "删除指定短故事或草稿（破坏性）。默认 confirm=false 只预览；confirm=true 才真正删除。",
      inputSchema: {
        item_id: z.string().describe("短故事 item_id"),
        confirm: z.boolean().optional().describe("是否真正删除，默认 false"),
      },
    },
    async ({ item_id, confirm }) => fromService((await deleteShortStory(item_id, { confirm })) as any)
  );
}
