import { articles, novels, shortStories, tasks } from "../core/store.js";
import { automationReadiness } from "./auth.js";
import { listBooks } from "./novel.js";
import { listShortStories, SHORT_MIN_WORDS, SHORT_MAX_WORDS } from "./short.js";
/** 汇总本地文稿库 + 番茄后台的真实数据概览 */
export async function getStats(opts = {}) {
    const [arts, ns, ss, ts] = await Promise.all([
        articles.all(),
        novels.all(),
        shortStories.all(),
        tasks.all(),
    ]);
    const articleStatus = {};
    for (const a of arts)
        articleStatus[a.status] = (articleStatus[a.status] ?? 0) + 1;
    const taskStatus = {};
    for (const t of ts)
        taskStatus[t.status] = (taskStatus[t.status] ?? 0) + 1;
    const readiness = automationReadiness();
    const stats = {
        ok: true,
        message: "本地统计已生成" + (opts.remote ? "，并尝试读取后台数据" : "（未联网，远程数据未读取）"),
        local: {
            novels: ns.length,
            shortStories: ss.length,
            articles: { total: arts.length, ...articleStatus },
            tasks: { total: ts.length, ...taskStatus },
        },
        readiness,
        rules: {
            shortStoryWords: `${SHORT_MIN_WORDS}–${SHORT_MAX_WORDS} 字`,
            chaptersSchedulable: true,
            shortStorySchedulable: false,
        },
    };
    if (opts.remote && readiness.ready) {
        const [books, shorts] = await Promise.all([
            listBooks().catch((e) => ({ ok: false, message: e.message })),
            listShortStories({ pageCount: 200, headless: opts.headless }).catch((e) => ({ ok: false, message: e.message })),
        ]);
        stats.remote = {
            novels: books?.ok
                ? { count: books.books?.length ?? 0, items: (books.books ?? []).map((b) => ({ bookId: b.bookId, bookName: b.bookName })) }
                : { error: books?.message ?? "读取失败" },
            shortStories: shorts?.ok
                ? {
                    count: shorts.stories?.length ?? 0,
                    items: (shorts.stories ?? []).map((s) => ({ itemId: s.itemId, title: s.title, wordNumber: s.wordNumber })),
                }
                : { error: shorts?.message ?? "读取失败" },
        };
    }
    return stats;
}
