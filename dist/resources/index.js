import { articles, novels, shortStories, tasks } from "../core/store.js";
import { automationReadiness } from "../services/auth.js";
import { cookiesSummary } from "../browser/cookies.js";
import { SHORT_MIN_WORDS, SHORT_MAX_WORDS } from "../services/short.js";
import { WTT_MIN_CHARS, WTT_MAX_CHARS, WTT_HINT_CHARS, WTT_MAX_IMAGES, WTT_DAILY_LIMIT } from "../services/microHeadline.js";
import { CONTENT_TAG_CAPS } from "../services/novel.js";
import { GENRES } from "../knowledge/genres.js";
import { renderGoldenThree } from "../knowledge/goldenThree.js";
import { chapterUrlTemplate, createBookUrl, shortManageUrl } from "../browser/endpoints.js";
const MIME = "application/json";
function json(uri, data) {
    return { contents: [{ uri: uri.href, mimeType: MIME, text: JSON.stringify(data, null, 2) }] };
}
export function registerResources(server) {
    server.registerResource("status", "fanqie://status", { title: "登录与环境状态", description: "cookies / 浏览器驱动 / 后台地址等只读状态", mimeType: MIME }, async (uri) => {
        const readiness = automationReadiness();
        return json(uri, {
            ready: readiness.ready,
            reasons: readiness.reasons,
            cookies: cookiesSummary(),
            details: readiness.details,
        });
    });
    server.registerResource("novels", "fanqie://novels", { title: "本地小说登记", description: "本地登记的小说与绑定的番茄 book_id（不联网）", mimeType: MIME }, async (uri) => json(uri, { total: (await novels.all()).length, novels: await novels.all() }));
    server.registerResource("short-stories", "fanqie://short-stories", { title: "本地短故事登记", description: "本地登记的短故事与番茄 item_id（不联网）", mimeType: MIME }, async (uri) => json(uri, { total: (await shortStories.all()).length, shortStories: await shortStories.all() }));
    server.registerResource("articles", "fanqie://articles", { title: "本地文稿库", description: "本地文稿库条目（不含正文全文）", mimeType: MIME }, async (uri) => {
        const items = await articles.all();
        return json(uri, {
            total: items.length,
            articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
        });
    });
    server.registerResource("tasks", "fanqie://tasks", { title: "发布任务日志", description: "批量/单章上传的任务日志", mimeType: MIME }, async (uri) => json(uri, { total: (await tasks.all()).length, tasks: await tasks.all() }));
    server.registerResource("publish-rules", "fanqie://publish-rules", { title: "发布限制须知", description: "短故事字数区间、标签上限、定时发布支持范围等；写操作前先读", mimeType: MIME }, async (uri) => json(uri, {
        shortStory: {
            words: `${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}`,
            best: "1w–3w 字",
            oneShot: true,
            recommend: "第一人称",
            schedulable: false,
            note: "短故事接口无定时字段，定时发布仅用于小说章节。",
        },
        microHeadline: {
            words: `${WTT_MIN_CHARS}–${WTT_MAX_CHARS}`,
            best: `≤${WTT_HINT_CHARS} 字（官方教程建议）`,
            images: `最多 ${WTT_MAX_IMAGES} 张（页面 UI 提示；官方教程写 9 张）`,
            dailyLimit: WTT_DAILY_LIMIT,
            requires: "必须关联一个已发布的短篇（卡片）",
            statuses: "小流量推荐 → 热推中 / 审核不通过（按内容质量给量）",
            tool: "create_micro_headline_tomato（默认 confirm=false 只填表，返回 content 供用户确认）",
            note: "发布短故事后建议顺带发一条微头条引流；列表可用 list_micro_headlines_tomato 查看推荐状态与阅读量。",
        },
        novelChapter: {
            schedulable: true,
            note: "add_chapter_tomato / batch_publish_chapters 支持 scheduled_time。",
        },
        contentTagCaps: CONTENT_TAG_CAPS,
        safetyPolicy: "所有写操作默认 confirm=false（只填表不提交），必须 confirm=true 才真正提交。",
        urls: {
            createBook: createBookUrl(),
            chapterTemplate: chapterUrlTemplate(),
            shortManage: shortManageUrl(),
        },
    }));
    server.registerResource("genres", "fanqie://genres", { title: "番茄赛道知识库", description: "主流赛道的爽点机制、开篇要求、节奏、避坑清单与建议单章字数（不联网）；定赛道 / 写开篇前先读", mimeType: MIME }, async (uri) => json(uri, GENRES));
    server.registerResource("golden-three-chapters", "fanqie://golden-three-chapters", { title: "黄金三章方法论", description: "前三章逐章目标与通用节奏要求（markdown）；写前三章前先读", mimeType: "text/markdown" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderGoldenThree() }] }));
}
