import fs from "node:fs";
import path from "node:path";
import { articles, novels, shortStories, tasks, newId, nowIso } from "../core/store.js";
import { DATA_DIR, ensureDir } from "../core/paths.js";
import { countCjk, toPlainText } from "../core/text.js";
import { logger } from "../core/logger.js";
import type { Article, PublishTask } from "../types.js";
import { uploadChapter } from "./chapter.js";
import { sleep } from "../browser/driver.js";

/** 把长正文写到 data/export 下的文件，返回路径（避免超长文本塞进工具参数） */
export function writeExportFile(fileName: string, content: string): string {
  const dir = path.join(DATA_DIR, "export");
  ensureDir(dir);
  const safe = fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "article";
  const file = path.join(dir, `${safe}-${Date.now()}.txt`);
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

/** 从 file_path 或 content 取正文（二者必居其一） */
export function resolveContent(content?: string, filePath?: string): { text: string; source: string } {
  if (filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`正文文件不存在：${filePath}`);
    return { text: fs.readFileSync(filePath, "utf-8"), source: filePath };
  }
  if (content && content.trim()) return { text: content, source: "inline" };
  throw new Error("缺少正文：请提供 content 或 file_path。");
}

/* ------------------------------ 文稿库 CRUD ------------------------------ */

export interface SaveArticleInput {
  kind: "chapter" | "short";
  title: string;
  content?: string;
  filePath?: string;
  novelId?: string;
  chapterNumber?: number;
  status?: "draft" | "published" | "failed";
  tomatoBookId?: string;
  tomatoItemId?: string;
}

export async function saveArticle(input: SaveArticleInput): Promise<{ ok: boolean; message: string; article?: Article }> {
  if (!input.title?.trim()) return { ok: false, message: "缺少标题 title。" };
  let text = "";
  let source = "";
  try {
    const r = resolveContent(input.content, input.filePath);
    text = r.text;
    source = r.source;
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const plain = toPlainText(text);
  const now = nowIso();
  const item: Article = {
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

export interface ListArticlesFilter {
  kind?: "chapter" | "short";
  novelId?: string;
  status?: "draft" | "published" | "failed";
}

export async function listArticles(filter: ListArticlesFilter = {}): Promise<Article[]> {
  let items = await articles.all();
  if (filter.kind) items = items.filter((a) => a.kind === filter.kind);
  if (filter.novelId) items = items.filter((a) => a.novelId === filter.novelId);
  if (filter.status) items = items.filter((a) => a.status === filter.status);
  return items.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
}

export async function getArticle(id: string): Promise<Article | undefined> {
  return articles.get(id);
}

export async function deleteArticle(id: string, confirm?: boolean): Promise<{ ok: boolean; action: "preview" | "deleted" | "error"; message: string }> {
  const item = await articles.get(id);
  if (!item) return { ok: false, action: "error", message: `未找到 article_id=${id}` };
  if (!confirm) {
    return { ok: true, action: "preview", message: `将删除本地文稿「${item.title}」(${id})。confirm=true 才真正删除。` };
  }
  await articles.remove(id);
  return { ok: true, action: "deleted", message: `已删除本地文稿「${item.title}」(${id})。` };
}

/* ------------------------------ 批量上传 ------------------------------ */

export interface BatchPublishOptions {
  novelId?: string;
  bookId?: string;
  articleIds?: string[];
  limit?: number;
  intervalSeconds?: number;
  detection?: "basic" | "full";
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

export interface BatchPublishResult {
  ok: boolean;
  message: string;
  total: number;
  succeeded: number;
  failed: number;
  results: { articleId: string; title: string; ok: boolean; action: string; message: string }[];
}

/**
 * 从本地文稿库挑「待发布」章节，按章节号顺序限速依次上传。
 * 单章失败不中断；每章结果写回 articles 与 publish_tasks。
 * confirm=false 时只做一次「填表不提交」演练（只跑第一章预览），避免在后台留下大量草稿。
 */
export async function batchPublishChapters(opts: BatchPublishOptions): Promise<BatchPublishResult> {
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
  } else {
    targets = targets.filter((a) => a.status === "draft" && (!opts.novelId || a.novelId === opts.novelId));
    targets = targets.filter((a) => !a.tomatoBookId || a.tomatoBookId === bookId);
  }
  const limit = opts.limit && opts.limit > 0 ? opts.limit : targets.length;
  targets = targets.slice(0, limit);

  if (targets.length === 0) {
    return { ok: true, message: "没有符合条件的待发布章节。", total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const interval = Math.max(0, opts.intervalSeconds ?? 5) * 1000;
  const results: BatchPublishResult["results"] = [];

  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    const isPreviewOnly = !opts.confirm && i > 0; // 非提交模式只演练第一章
    if (isPreviewOnly) break;

    const task: PublishTask = {
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
    } else if (!r.ok) {
      await articles.update(a.id, { status: "failed", lastMessage: r.message, updatedAt: nowIso() });
    }

    results.push({ articleId: a.id, title: a.title, ok: published || (r.ok && !opts.confirm), action: r.action, message: r.message });

    if (i < targets.length - 1 && interval > 0) await sleep(interval);
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
