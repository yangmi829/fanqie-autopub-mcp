import fs from "node:fs";
import path from "node:path";
import { articles, novels, tasks, newId, nowIso } from "../core/store.js";
import { DATA_DIR, EXPORT_DIR, ensureDir } from "../core/paths.js";
import { countCjk, toPlainText } from "../core/text.js";
import { logger } from "../core/logger.js";
import { uploadChapter } from "./chapter.js";
import { analyzeOriginality } from "./originality.js";
import { sleep } from "../browser/driver.js";
/** 把长正文写到 data/export 下的文件，返回路径（避免超长文本塞进工具参数） */
export function writeExportFile(fileName, content) {
    const dir = path.join(DATA_DIR, "export");
    ensureDir(dir);
    const safe = fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "article";
    const file = path.join(dir, `${safe}-${Date.now()}.txt`);
    fs.writeFileSync(file, content, "utf-8");
    return file;
}
/** 从 file_path 或 content 取正文（二者必居其一） */
export function resolveContent(content, filePath) {
    if (filePath) {
        if (!fs.existsSync(filePath))
            throw new Error(`正文文件不存在：${filePath}`);
        return { text: fs.readFileSync(filePath, "utf-8"), source: filePath };
    }
    if (content && content.trim())
        return { text: content, source: "inline" };
    throw new Error("缺少正文：请提供 content 或 file_path。");
}
export async function saveArticle(input) {
    if (!input.title?.trim())
        return { ok: false, message: "缺少标题 title。" };
    let text = "";
    let source = "";
    try {
        const r = resolveContent(input.content, input.filePath);
        text = r.text;
        source = r.source;
    }
    catch (e) {
        return { ok: false, message: e.message };
    }
    const plain = toPlainText(text);
    const now = nowIso();
    const item = {
        id: newId("art"),
        kind: input.kind === "short" ? "short" : "chapter",
        title: input.title.trim(),
        content: plain,
        wordCount: countCjk(plain),
        novelId: input.novelId,
        chapterNumber: input.chapterNumber,
        status: input.status ?? "draft",
        tomatoBookId: input.tomatoBookId,
        tomatoItemId: input.tomatoItemId,
        createdAt: now,
        updatedAt: now,
    };
    await articles.insert(item);
    logger.info(`[library] 入库 ${item.kind} 《${item.title}》 ${item.wordCount} 字（来源 ${source}）`);
    return { ok: true, message: `已入库 article_id=${item.id}（${item.wordCount} 字）。`, article: item };
}
export async function listArticles(filter = {}) {
    let items = await articles.all();
    if (filter.kind)
        items = items.filter((a) => a.kind === filter.kind);
    if (filter.novelId)
        items = items.filter((a) => a.novelId === filter.novelId);
    if (filter.status)
        items = items.filter((a) => a.status === filter.status);
    return items.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
}
export async function getArticle(id) {
    return articles.get(id);
}
export async function deleteArticle(id, confirm) {
    const item = await articles.get(id);
    if (!item)
        return { ok: false, action: "error", message: `未找到 article_id=${id}` };
    if (!confirm) {
        return { ok: true, action: "preview", message: `将删除本地文稿「${item.title}」(${id})。confirm=true 才真正删除。` };
    }
    await articles.remove(id);
    return { ok: true, action: "deleted", message: `已删除本地文稿「${item.title}」(${id})。` };
}
function safeFileName(name) {
    return name.replace(/[\\/:*?"<>|\n\r\t]/g, "_").slice(0, 80) || "article";
}
/** 把本地文稿导出成可直接粘贴到番茄后台的文本文件（供人工发布流程） */
export async function exportArticle(input) {
    const art = await articles.get(input.articleId);
    if (!art)
        return { ok: false, message: `未找到 article_id=${input.articleId}` };
    const fmt = input.format === "md" ? "md" : "txt";
    const dir = input.exportDir || EXPORT_DIR;
    ensureDir(dir);
    const novel = art.novelId ? await novels.get(art.novelId) : undefined;
    const base = typeof art.chapterNumber === "number" && art.chapterNumber > 0
        ? `${String(art.chapterNumber).padStart(3, "0")}-${safeFileName(art.title)}`
        : `${safeFileName(art.title)}-${art.id}`;
    const filePath = path.join(dir, `${base}.${fmt}`);
    const head = input.includeNovelTitle !== false && novel ? `《${novel.title}》\n` : "";
    const body = fmt === "md" ? `${head}# ${art.title}\n\n${art.content}\n` : `${head}${art.title}\n\n${art.content}\n`;
    await fs.promises.writeFile(filePath, body, "utf-8");
    return {
        ok: true,
        message: `已导出到 ${filePath}`,
        filePath,
        format: fmt,
        wordCount: art.wordCount,
        preview: body.slice(0, 300),
    };
}
/**
 * 本地原创性 / AI 味检测：与本地文稿库其它条目做 n-gram 相似度比对，
 * 并检查自我复读、套话密度、对话占比、段落均匀度。不联网、不消耗额度。
 */
export async function checkOriginality(input) {
    let text = input.content && input.content.trim() ? input.content : "";
    let articleId;
    if (!text && input.articleId) {
        const art = await articles.get(input.articleId);
        if (!art)
            return { ok: false, message: `未找到 article_id=${input.articleId}` };
        text = art.content;
        articleId = art.id;
    }
    if (!text.trim())
        return { ok: false, message: "需要提供 article_id 或 content。" };
    const all = await articles.all();
    const corpus = all.filter((a) => a.id !== articleId).map((a) => ({ id: a.id, text: a.content }));
    const threshold = typeof input.threshold === "number" && Number.isFinite(input.threshold) ? input.threshold : 0.25;
    const report = analyzeOriginality(text, corpus, threshold);
    return {
        ok: true,
        message: report.passed
            ? `相似度 ${report.similarity}（阈值 ${threshold}），通过。`
            : `相似度 ${report.similarity} 超过阈值 ${threshold}，建议按 findings 修改。`,
        article_id: articleId,
        similarity: report.similarity,
        passed: report.passed,
        threshold: report.threshold,
        metrics: report.metrics,
        findings: report.findings,
        suggestions: report.suggestions,
        compared_with: corpus.length,
    };
}
/**
 * 从本地文稿库挑「待发布」章节，按章节号顺序限速依次上传。
 * 单章失败不中断；每章结果写回 articles 与 publish_tasks。
 * confirm=false 时只做一次「填表不提交」演练（只跑第一章预览），避免在后台留下大量草稿。
 */
export async function batchPublishChapters(opts) {
    let bookId = opts.bookId;
    if (!bookId && opts.novelId) {
        const novel = await novels.get(opts.novelId);
        bookId = novel?.tomatoBookId;
    }
    if (!bookId) {
        return {
            ok: false,
            message: "缺少番茄书 ID：请提供 book_id，或在本地小说登记里绑定 tomatoBookId（novel_id）。",
            total: 0,
            succeeded: 0,
            failed: 0,
            results: [],
        };
    }
    let targets = await listArticles({ kind: "chapter" });
    if (opts.articleIds?.length) {
        const set = new Set(opts.articleIds);
        targets = targets.filter((a) => set.has(a.id));
    }
    else {
        targets = targets.filter((a) => a.status === "draft" && (!opts.novelId || a.novelId === opts.novelId));
        targets = targets.filter((a) => !a.tomatoBookId || a.tomatoBookId === bookId);
    }
    const limit = opts.limit && opts.limit > 0 ? opts.limit : targets.length;
    targets = targets.slice(0, limit);
    if (targets.length === 0) {
        return { ok: true, message: "没有符合条件的待发布章节。", total: 0, succeeded: 0, failed: 0, results: [] };
    }
    const interval = Math.max(0, opts.intervalSeconds ?? 5) * 1000;
    const results = [];
    for (let i = 0; i < targets.length; i++) {
        const a = targets[i];
        const isPreviewOnly = !opts.confirm && i > 0; // 非提交模式只演练第一章
        if (isPreviewOnly)
            break;
        const task = {
            id: newId("task"),
            kind: "chapter",
            targetId: a.id,
            title: a.title,
            status: "pending",
            mode: "batch",
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        await tasks.insert(task);
        const r = await uploadChapter({
            bookId,
            title: a.title,
            content: a.content,
            chapterNumber: a.chapterNumber,
            detection: opts.detection,
            useAI: opts.useAI,
            confirm: opts.confirm,
            headless: opts.headless,
        });
        const published = r.action === "published" || r.action === "scheduled";
        await tasks.update(task.id, {
            status: published ? "done" : r.ok ? "pending" : "failed",
            message: `${r.action}: ${r.message}`,
            screenshotPath: r.screenshotPath,
            updatedAt: nowIso(),
        });
        if (published) {
            await articles.update(a.id, {
                status: "published",
                publishTime: nowIso(),
                tomatoBookId: bookId,
                lastMessage: r.message,
                updatedAt: nowIso(),
            });
        }
        else if (!r.ok) {
            await articles.update(a.id, { status: "failed", lastMessage: r.message, updatedAt: nowIso() });
        }
        results.push({ articleId: a.id, title: a.title, ok: published || (r.ok && !opts.confirm), action: r.action, message: r.message });
        if (i < targets.length - 1 && interval > 0)
            await sleep(interval);
    }
    const succeeded = results.filter((x) => x.ok).length;
    const failed = results.length - succeeded;
    return {
        ok: failed === 0,
        message: opts.confirm
            ? `批量上传完成：成功 ${succeeded} / 失败 ${failed}（共 ${results.length} 章）。`
            : `演练模式（confirm=false）：仅对第 1 章做了「填表不提交」预览，共待发布 ${targets.length} 章。`,
        total: results.length,
        succeeded,
        failed,
        results,
    };
}
