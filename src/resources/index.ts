import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { articles, novels, shortStories, tasks } from "../core/store.js";
import { automationReadiness } from "../services/auth.js";
import { cookiesSummary } from "../browser/cookies.js";
import { SHORT_MIN_WORDS, SHORT_MAX_WORDS } from "../services/short.js";
import { CONTENT_TAG_CAPS } from "../services/novel.js";
import { chapterUrlTemplate, createBookUrl, shortManageUrl } from "../browser/endpoints.js";

const MIME = "application/json";

function json(uri: URL, data: unknown) {
  return { contents: [{ uri: uri.href, mimeType: MIME, text: JSON.stringify(data, null, 2) }] };
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "status",
    "fanqie://status",
    { title: "登录与环境状态", description: "cookies / 浏览器驱动 / 后台地址等只读状态", mimeType: MIME },
    async (uri) => {
      const readiness = automationReadiness();
      return json(uri, {
        ready: readiness.ready,
        reasons: readiness.reasons,
        cookies: cookiesSummary(),
        details: readiness.details,
      });
    }
  );

  server.registerResource(
    "novels",
    "fanqie://novels",
    { title: "本地小说登记", description: "本地登记的小说与绑定的番茄 book_id（不联网）", mimeType: MIME },
    async (uri) => json(uri, { total: (await novels.all()).length, novels: await novels.all() })
  );

  server.registerResource(
    "short-stories",
    "fanqie://short-stories",
    { title: "本地短故事登记", description: "本地登记的短故事与番茄 item_id（不联网）", mimeType: MIME },
    async (uri) => json(uri, { total: (await shortStories.all()).length, shortStories: await shortStories.all() })
  );

  server.registerResource(
    "articles",
    "fanqie://articles",
    { title: "本地文稿库", description: "本地文稿库条目（不含正文全文）", mimeType: MIME },
    async (uri) => {
      const items = await articles.all();
      return json(uri, {
        total: items.length,
        articles: items.map(({ content, ...rest }) => ({ ...rest, preview: content.slice(0, 60) })),
      });
    }
  );

  server.registerResource(
    "tasks",
    "fanqie://tasks",
    { title: "发布任务日志", description: "批量/单章上传的任务日志", mimeType: MIME },
    async (uri) => json(uri, { total: (await tasks.all()).length, tasks: await tasks.all() })
  );

  server.registerResource(
    "publish-rules",
    "fanqie://publish-rules",
    { title: "发布限制须知", description: "短故事字数区间、标签上限、定时发布支持范围等", mimeType: MIME },
    async (uri) =>
      json(uri, {
        shortStory: {
          words: `${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS}`,
          best: "1w–3w 字",
          oneShot: true,
          recommend: "第一人称",
          schedulable: false,
          note: "短故事接口无定时字段，定时发布仅用于小说章节。",
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
      })
  );
}
