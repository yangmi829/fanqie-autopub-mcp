import fs from "node:fs";
import { sleep, shot } from "../browser/driver.js";
import { automationReadiness } from "./auth.js";
import { openSession, isError, apiGet, API, authorApiBase, shortPublishUrl } from "../browser/endpoints.js";
import { toPlainText, countCjk } from "../core/text.js";
import { logger } from "../core/logger.js";

/** 短故事官方字数区间：6000–80000 字（最佳 1w–3w） */
export const SHORT_MIN_WORDS = 6000;
export const SHORT_MAX_WORDS = 80000;

/* ------------------------------ 列表 / 详情 ------------------------------ */

export interface ShortStoryListItem {
  itemId: string;
  title: string;
  wordNumber?: number;
  /** 分类 id 数组 */
  category?: number[];
  signType?: number;
  signStatus?: number;
  publishStatus?: number;
  displayStatus?: number;
  createTime?: string;
  modifyTime?: string;
}

function mapShortItem(s: any): ShortStoryListItem {
  return {
    itemId: String(s?.item_id ?? s?.itemId ?? ""),
    title: String(s?.multi_title ?? s?.title ?? ""),
    wordNumber: s?.word_number ?? s?.wordNumber,
    category: Array.isArray(s?.category) ? s.category : undefined,
    signType: s?.sign_type,
    signStatus: s?.sign_status,
    publishStatus: s?.publish_status,
    displayStatus: s?.display_status,
    createTime: s?.create_time ?? s?.createTime,
    modifyTime: s?.modify_time ?? s?.modifyTime,
  };
}

/**
 * 读短故事列表。status="draft" 走草稿箱接口，其余走「我的短故事」。
 * 均为只读 GET，无需签名。
 */
export async function listShortStories(opts: {
  status?: "all" | "draft";
  pageIndex?: number;
  pageCount?: number;
  headless?: boolean;
} = {}): Promise<{ ok: boolean; message: string; stories?: ShortStoryListItem[]; total?: number }> {
  const readiness = automationReadiness();
  if (!readiness.ready) return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };

  const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
  if (isError(session)) return { ok: false, message: session.error };
  const { browser, page } = session;
  try {
    const path = opts.status === "draft" ? API.shortArticleDraftList : API.shortArticleList;
    const data = await apiGet(page, path, {
      page_count: opts.pageCount ?? 50,
      page_index: opts.pageIndex ?? 0,
      status: 0,
      time_sort: 0,
      image_fmt_list: "450x800",
      book_image_fmt_list: "190x250",
      pack_type: 1,
    });
    await browser.close().catch(() => {});
    if (data?.code !== 0) return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
    const raw: any[] = data?.data?.item_list ?? data?.data?.list ?? [];
    const stories = raw.map(mapShortItem);
    const total = Number(data?.data?.total_count ?? stories.length);
    return {
      ok: true,
      message: `共 ${total} 条${opts.status === "draft" ? "草稿" : "短故事"}`,
      stories,
      total,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, message: `读取短故事列表失败: ${(e as Error).message}` };
  }
}

export interface ShortStoryDetail {
  itemId: string;
  title: string;
  content: string;
  wordNumber: number;
  category: number[];
  categoryMaxCount?: number;
  thumbUri?: string;
  bookThumbUri?: string;
  signType?: number;
  signStatus?: number;
  publishStatus?: number;
  displayStatus?: number;
  latestVersion?: number;
  auditFailInfos?: any[];
}

/** 读短故事详情（edit/v1）。返回正文全文与作品信息。 */
export async function getShortStory(
  itemId: string,
  opts: { headless?: boolean } = {}
): Promise<{ ok: boolean; message: string; story?: ShortStoryDetail }> {
  const readiness = automationReadiness();
  if (!readiness.ready) return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  if (!itemId) return { ok: false, message: "缺少 item_id。" };

  const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
  if (isError(session)) return { ok: false, message: session.error };
  const { browser, page } = session;
  try {
    const data = await apiGet(page, API.shortArticleEditV1, { item_id: itemId, image_fmt_list: "270x480" });
    await browser.close().catch(() => {});
    if (data?.code !== 0) return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
    const d = data?.data ?? {};
    return {
      ok: true,
      message: `读取成功：《${d.multi_title ?? ""}》${d.word_number ?? 0} 字`,
      story: {
        itemId: String(d.item_id ?? itemId),
        title: String(d.multi_title ?? ""),
        content: String(d.content ?? ""),
        wordNumber: Number(d.word_number ?? 0),
        category: Array.isArray(d.category) ? d.category : [],
        categoryMaxCount: d.category_max_count,
        thumbUri: d.thumb_uri,
        bookThumbUri: d.book_thumb_uri,
        signType: d.sign_type,
        signStatus: d.sign_status,
        publishStatus: d.publish_status,
        displayStatus: d.display_status,
        latestVersion: d.latest_version,
        auditFailInfos: d.audit_fail_infos,
      },
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, message: `读取短故事详情失败: ${(e as Error).message}` };
  }
}

/** 读作品分类表（只读）。 */
export async function listShortCategories(opts: { headless?: boolean } = {}): Promise<{
  ok: boolean;
  message: string;
  categories?: { categoryId: number; name: string; label?: string }[];
}> {
  const readiness = automationReadiness();
  if (!readiness.ready) return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
  if (isError(session)) return { ok: false, message: session.error };
  const { browser, page } = session;
  try {
    const data = await apiGet(page, API.shortArticleCategoryV1, {});
    await browser.close().catch(() => {});
    if (data?.code !== 0) return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
    const categories = (data?.data?.category_list ?? []).map((c: any) => ({
      categoryId: Number(c.category_id),
      name: String(c.name ?? ""),
      label: c.label,
    }));
    return { ok: true, message: `共 ${categories.length} 个分类`, categories };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, message: `读取分类失败: ${(e as Error).message}` };
  }
}

/* ------------------------------ 编辑器交互 ------------------------------ */

/** 短故事编辑器选择器（集中在这里，番茄改版只改此处） */
export const SHORT_SELECTORS = {
  title: [
    'textarea.serial-textarea[placeholder="请输入短故事名称"]',
    'textarea[placeholder*="短故事名称"]',
    "textarea.byte-textarea",
  ],
  /** 正文：优先可编辑区，避免命中 payNode-helper-content 占位层 */
  body: [
    '.syl-editor-container [contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    ".syl-editor-container .ProseMirror:not(.payNode-helper-content)",
    ".serial-editor-content .ProseMirror",
  ],
  saveDraft: [".short-publish-save", 'button[data-apm-action="core_chain_short_story_save_draft"]'],
  next: [".publish-short-header .btn-primary-varian"],
  categoryBox: [".publish-short-config-category", '[class*="category"]'],
} as const;

async function firstMatch(page: any, selectors: readonly string[]): Promise<string | null> {
  for (const sel of selectors) {
    try {
      if (await page.$(sel)) return sel;
    } catch {
      // 个别选择器在部分 puppeteer 版本不被支持，跳过
    }
  }
  return null;
}

/** 在已打开页面里提取当前短故事 item_id（从 URL /publish-short/{id} 解析） */
export async function currentShortItemId(page: any): Promise<string | null> {
  const m = String(page.url()).match(/publish-short\/(\d+)/);
  return m ? m[1] : null;
}

/** 等待页面从空白编辑页重定向到 /publish-short/{item_id}（番茄自动建草稿） */
async function waitForItemId(page: any, timeoutMs = 25000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = await currentShortItemId(page);
    if (id) return id;
    await sleep(700);
  }
  return await currentShortItemId(page);
}

/** 填标题（TEXTAREA 原生 setter） */
async function fillTitle(page: any, sel: string, title: string): Promise<void> {
  await page.click(sel, { clickCount: 3 }).catch(() => {});
  await page.evaluate(
    (s: string, v: string) => {
      const el: any = document.querySelector(s);
      if (!el) return;
      const proto = (window as any).HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, v);
      else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    sel,
    title
  );
}

/**
 * 填正文。短故事正文同样是 ProseMirror：
 * 空段用 insertParagraph 分段，段内换行用 insertLineBreak，字符用 insertText。
 */
async function fillBody(page: any, sel: string, text: string): Promise<void> {
  await page.click(sel, { clickCount: 2 }).catch(() => {});
  await page.evaluate(
    (s: string, value: string) => {
      const el: any = document.querySelector(s);
      if (!el) return;
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      const paras = value
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      let first = true;
      for (const p of paras) {
        if (!first) document.execCommand("insertParagraph", false, null);
        const lines = p.split(/\n/);
        lines.forEach((line: string, i: number) => {
          if (i > 0) document.execCommand("insertLineBreak", false, null);
          document.execCommand("insertText", false, line);
        });
        first = false;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    sel,
    text
  );
}

/** 点页面上第一个「可见且文本等于 label」的按钮（真实鼠标点击，SPA 依赖真实事件） */
async function clickButtonByText(page: any, label: string): Promise<boolean> {
  const found = await page
    .evaluate((t: string) => {
      const btn = (Array.from(document.querySelectorAll("button")) as any[]).find(
        (b: any) => b.offsetParent !== null && (b.textContent || "").trim() === t
      ) as any;
      if (!btn) return false;
      btn.setAttribute("data-autopub-target", "1");
      return true;
    }, label)
    .catch(() => false);
  if (!found) return false;
  await page.click('[data-autopub-target="1"]').catch(() => {});
  await page
    .evaluate(() => document.querySelector('[data-autopub-target="1"]')?.removeAttribute("data-autopub-target"))
    .catch(() => {});
  return true;
}

/** 选「是否使用AI」单选 */
async function chooseUseAI(page: any, useAI: boolean): Promise<boolean> {
  const label = useAI ? "是" : "否";
  return page
    .evaluate((t: string) => {
      const groups = Array.from(document.querySelectorAll(".arco-radio-group")) as any[];
      // 取包含「是/否」且标题含「AI」的一组（其余单选组如协议不作为目标）
      const scope =
        groups.find((g) => {
          const text = (g.closest('[class*="block-item"]')?.textContent || "") + (g.parentElement?.textContent || "");
          return /使用AI|AI/.test(text);
        }) || groups.find((g) => /(^|\D)是(\D|$)/.test(g.textContent || ""));
      if (!scope) return false;
      const lab = (Array.from(scope.querySelectorAll("label")) as any[]).find(
        (l: any) => (l.textContent || "").trim() === t
      ) as any;
      if (!lab) return false;
      const input = lab.querySelector('input[type="radio"]');
      if (input) (input as any).click();
      else lab.click();
      return true;
    }, label)
    .catch(() => false);
}

/**
 * 选作品分类（主分类必选，最多 8 个）。
 * 分类选择器是一组可点击的标签，按分类名精确文本点击。返回实际选中/未找到。
 */
async function selectCategories(
  page: any,
  names: string[]
): Promise<{ applied: string[]; missing: string[] }> {
  const applied: string[] = [];
  const missing: string[] = [];
  if (!names.length) return { applied, missing };
  for (const name of names) {
    const ok = await page
      .evaluate((t: string) => {
        const cand = Array.from(
          document.querySelectorAll(
            '[class*="category"] span, [class*="category"] div, [class*="category"] label'
          )
        ) as any[];
        const el = cand.find((e: any) => e.children.length === 0 && (e.textContent || "").trim() === t);
        if (el) {
          el.click();
          return true;
        }
        return false;
      }, name)
      .catch(() => false);
    if (ok) applied.push(name);
    else missing.push(name);
    await sleep(300);
  }
  return { applied, missing };
}

/* ------------------------------ 新建 / 保存草稿 ------------------------------ */

export interface CreateShortStoryOptions {
  title: string;
  content?: string;
  categories?: string[];
  coverPath?: string;
  useAI?: boolean;
  dividedChapters?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

export interface ShortStoryResult {
  ok: boolean;
  action: "filled-not-submitted" | "draft-saved" | "published" | "aborted" | "error";
  message: string;
  itemId?: string;
  wordCount?: number;
  url?: string;
  screenshotPath?: string;
  warnings?: string[];
}

/** 短故事写操作的前置校验（字数与外部依赖） */
export function validateShortContent(content: string): { wordCount: number; warnings: string[] } {
  const plain = toPlainText(content || "");
  const wordCount = countCjk(plain);
  const warnings: string[] = [];
  if (plain.length === 0) warnings.push("未提供正文（仅保存作品外壳/标题）。");
  else if (wordCount < SHORT_MIN_WORDS) {
    warnings.push(`正文字数 ${wordCount} 低于短故事下限 ${SHORT_MIN_WORDS}，可存草稿但发布会被拦截。`);
  } else if (wordCount > SHORT_MAX_WORDS) {
    warnings.push(`正文字数 ${wordCount} 超过短故事上限 ${SHORT_MAX_WORDS}，发布会被拦截。`);
  }
  return { wordCount, warnings };
}

/**
 * 新建短故事（并可选保存草稿）。
 * 关键事实：打开 /publish-short/ 空白页时，番茄前端会自动 POST short_article/new/v0/
 * 建一条草稿 item 并跳转到 /publish-short/{item_id}；本方法据此拿到 item_id 后填表。
 * confirm=false 只填表不提交；confirm=true 才点「存草稿」把标题/正文/信息落库。
 */
export async function createShortStory(opts: CreateShortStoryOptions): Promise<ShortStoryResult> {
  const readiness = automationReadiness();
  if (!readiness.ready) {
    return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  }
  if (!opts.title?.trim()) return { ok: false, action: "aborted", message: "缺少短故事名称 title。" };

  const { wordCount, warnings } = validateShortContent(opts.content ?? "");

  const session = await openSession(opts.headless ?? true, "/main/writer/publish-short/?enter_from=NEWCHAPTER_1");
  if (isError(session)) return { ok: false, action: "aborted", message: session.error };
  const { browser, page } = session;

  try {
    const itemId = await waitForItemId(page);
    if (!itemId) {
      const file = await shot(page, "short-itemid-missing");
      return {
        ok: false,
        action: "aborted",
        message: "未能在 /publish-short/ 上拿到 item_id（番茄未自动建草稿或改版）。请检查 cookies 与后台页面。",
        url: page.url(),
        screenshotPath: file,
      };
    }
    logger.info(`[createShortStory] item_id=${itemId}`);

    const titleSel = await firstMatch(page, SHORT_SELECTORS.title);
    const bodySel = await firstMatch(page, SHORT_SELECTORS.body);
    if (!titleSel) {
      const file = await shot(page, "short-title-missing");
      return { ok: false, action: "aborted", message: "未找到短故事名称输入框。", url: page.url(), screenshotPath: file, itemId };
    }

    await fillTitle(page, titleSel, opts.title.trim());
    if (opts.content && bodySel) {
      await fillBody(page, bodySel, toPlainText(opts.content));
    }
    await sleep(800);

    if (typeof opts.useAI === "boolean") await chooseUseAI(page, opts.useAI);
    if (opts.categories?.length) {
      const cat = await selectCategories(page, opts.categories);
      if (cat.missing.length) warnings.push(`未找到分类：${cat.missing.join("、")}`);
      if (cat.applied.length) logger.info(`[createShortStory] 已选分类：${cat.applied.join("、")}`);
    }
    if (opts.coverPath) {
      const okCover = await uploadCover(page, opts.coverPath);
      if (!okCover) warnings.push("封面文件未能上传（未找到上传入口或格式不支持）。");
    }

    await sleep(500);

    if (!opts.confirm) {
      const file = await shot(page, "short-filled");
      return {
        ok: true,
        action: "filled-not-submitted",
        message:
          `已建草稿 item_id=${itemId} 并填入名称/正文（未点存草稿，confirm=false）。` +
          `当前正文字数≈${wordCount}。核对无误后传 confirm=true 保存草稿。`,
        itemId,
        wordCount,
        url: page.url(),
        screenshotPath: file,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    const saved = await saveDraft(page);
    const file = await shot(page, saved ? "short-draft-saved" : "short-draft-save-failed");
    if (!saved) {
      return {
        ok: false,
        action: "error",
        message: "未能点到「存草稿」按钮（可能页面结构变化）。草稿 item 可能已存在，请到草稿箱核对。",
        itemId,
        url: page.url(),
        screenshotPath: file,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    // 用 edit/v1 复核标题是否落库
    await sleep(1500);
    const verify = await verifyDraft(page, itemId, opts.title.trim());
    return {
      ok: true,
      action: "draft-saved",
      message:
        `已保存短故事草稿 item_id=${itemId}${verify.saved ? "（已复核标题已落库）" : "（未能在详情接口复核到标题，请到草稿箱确认）"}，` +
        `正文字数≈${wordCount}。`,
      itemId,
      wordCount,
      url: page.url(),
      screenshotPath: file,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    logger.error(`新建短故事异常: ${(e as Error).message}`);
    return { ok: false, action: "error", message: `新建短故事失败: ${(e as Error).message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 点「存草稿」，等待其发出 cover/v0 请求并返回是否成功 */
async function saveDraft(page: any): Promise<boolean> {
  const saveSel = await firstMatch(page, SHORT_SELECTORS.saveDraft);
  const done = new Promise<boolean>((resolve) => {
    const onResp = async (resp: any) => {
      if (resp.url().includes(API.shortArticleCover) && resp.request().method() === "POST") {
        try {
          const j = JSON.parse(await resp.text());
          resolve(j?.code === 0);
        } catch {
          resolve(true);
        }
      }
    };
    page.on("response", onResp);
    setTimeout(() => resolve(false), 20000);
  });
  if (saveSel) await page.click(saveSel).catch(() => {});
  else await clickButtonByText(page, "存草稿");
  const ok = await done;
  await sleep(1000);
  return ok;
}

/** 复核草稿：edit/v1 是否已带标题 */
async function verifyDraft(page: any, itemId: string, title: string): Promise<{ saved: boolean }> {
  return page
    .evaluate(
      async (p: { itemId: string; title: string }) => {
        try {
          const r = await fetch(
            `https://fanqienovel.com/api/author/short_article/edit/v1/?aid=2503&app_name=muye_novel&item_id=${p.itemId}&image_fmt_list=270x480`,
            { credentials: "include" }
          );
          const j: any = await r.json();
          const t = String(j?.data?.multi_title ?? "");
          return { saved: t.length > 0 || Number(j?.data?.word_number ?? 0) > 0 };
        } catch {
          return { saved: false };
        }
      },
      { itemId, title }
    )
    .catch(() => ({ saved: false }));
}

/** 上传封面（走页面文件输入框，由页面自身调用 cover/v0 签名） */
async function uploadCover(page: any, filePath: string): Promise<boolean> {
  try {
    const inputs = await page.$$('input[type="file"]');
    if (!inputs.length) return false;
    await inputs[0].uploadFile(filePath);
    await sleep(3000);
    return true;
  } catch (e) {
    logger.warn(`上传封面失败: ${(e as Error).message}`);
    return false;
  }
}

/* ------------------------------ 发布 ------------------------------ */

export interface PublishShortStoryOptions {
  itemId?: string;
  title?: string;
  content?: string;
  categories?: string[];
  coverPath?: string;
  signType?: number;
  dividedChapters?: boolean;
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

/**
 * 发布短故事。
 * 若给 itemId：打开 /publish-short/{itemId}，按需补正文/信息后走发布。
 * 若不给 itemId 而给 title/content：先在空白页建 item 再填再发。
 * confirm=false 只填表；confirm=true 才点「下一步」→「发布」。
 * ⚠️ 发布可能触发实名/人脸验证，命中时只提示、不硬闯。
 */
export async function publishShortStory(opts: PublishShortStoryOptions): Promise<ShortStoryResult> {
  const readiness = automationReadiness();
  if (!readiness.ready) {
    return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  }
  if (!opts.itemId && !opts.title?.trim()) {
    return { ok: false, action: "aborted", message: "需提供 item_id，或 title（+content）以新建并发布。" };
  }

  const content = opts.content ?? "";
  const { wordCount, warnings } = validateShortContent(content);
  const target = opts.itemId
    ? shortPublishUrl(opts.itemId)
    : "/main/writer/publish-short/?enter_from=NEWCHAPTER_1";

  const session = await openSession(opts.headless ?? true, target);
  if (isError(session)) return { ok: false, action: "aborted", message: session.error };
  const { browser, page } = session;

  try {
    const itemId = opts.itemId ?? (await waitForItemId(page));
    if (!itemId) {
      const file = await shot(page, "short-publish-itemid-missing");
      return { ok: false, action: "aborted", message: "未拿到 item_id。", url: page.url(), screenshotPath: file };
    }

    // 补填（title/content 提供时）
    if (opts.title?.trim()) {
      const titleSel = await firstMatch(page, SHORT_SELECTORS.title);
      if (titleSel) await fillTitle(page, titleSel, opts.title.trim());
    }
    if (content) {
      const bodySel = await firstMatch(page, SHORT_SELECTORS.body);
      if (bodySel) await fillBody(page, bodySel, toPlainText(content));
    }
    await sleep(800);
    if (typeof opts.useAI === "boolean") await chooseUseAI(page, opts.useAI);
    if (opts.categories?.length) {
      const cat = await selectCategories(page, opts.categories);
      if (cat.missing.length) warnings.push(`未找到分类：${cat.missing.join("、")}`);
    }
    if (opts.coverPath && !(await uploadCover(page, opts.coverPath))) {
      warnings.push("封面文件未能上传。");
    }

    if (!opts.confirm) {
      const file = await shot(page, "short-publish-filled");
      return {
        ok: true,
        action: "filled-not-submitted",
        message:
          `已打开 item_id=${itemId} 并填入信息（未发布，confirm=false）。` +
          (content ? `正文字数≈${wordCount}。` : "仅校验作品信息，未改动正文。") +
          "确认后传 confirm=true 执行发布。",
        itemId,
        wordCount: content ? wordCount : undefined,
        url: page.url(),
        screenshotPath: file,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    // 先存草稿确保正文/信息落库，再点发布
    await saveDraft(page);
    await sleep(1500);

    // 检测是否被要求实名/人脸验证
    const needAuth = await page
      .evaluate(() => /实名|人脸|认证|身份验证/.test(document.body?.innerText || ""))
      .catch(() => false);

    const clickedNext = (await clickButtonByText(page, "下一步")) || (await clickNextBySelector(page));
    if (!clickedNext) {
      const file = await shot(page, "short-next-missing");
      return {
        ok: false,
        action: "aborted",
        message: "未找到「下一步」按钮，无法进入发布确认。正文已存草稿，可到草稿箱手动发布。",
        itemId,
        url: page.url(),
        screenshotPath: file,
        warnings: warnings.length ? warnings : undefined,
      };
    }
    await sleep(2500);

    if (needAuth) {
      const file = await shot(page, "short-realname-required");
      return {
        ok: false,
        action: "aborted",
        message: "发布流程疑似要求实名/人脸验证，已停止自动提交。请在浏览器中手动完成验证后再发布。",
        itemId,
        url: page.url(),
        screenshotPath: file,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    const published = await clickPublish(page);
    const file = await shot(page, published ? "short-published" : "short-publish-result");
    return {
      ok: published,
      action: published ? "published" : "error",
      message: published
        ? `已提交发布 item_id=${itemId}（以作者后台列表复核为准）。`
        : `已走完发布流程，但未确认到「发布」按钮被成功点击。请到短故事列表/草稿箱核对。`,
      itemId,
      url: page.url(),
      screenshotPath: file,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    logger.error(`发布短故事异常: ${(e as Error).message}`);
    return { ok: false, action: "error", message: `发布短故事失败: ${(e as Error).message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function clickNextBySelector(page: any): Promise<boolean> {
  const sel = await firstMatch(page, SHORT_SELECTORS.next);
  if (!sel) return false;
  await page.click(sel).catch(() => {});
  return true;
}

/** 在发布确认步骤里点「发布」/「确认发布」/「提交」 */
async function clickPublish(page: any): Promise<boolean> {
  for (const label of ["发布", "确认发布", "提交", "确认提交"]) {
    if (await clickButtonByText(page, label)) return true;
  }
  return false;
}

/* ------------------------------ 封面 ------------------------------ */

/**
 * 为已有短故事设置封面：打开其编辑页，通过文件上传入口上传本地图片（由页面自身调用 cover/v0 签名）。
 * confirm=false 只上传预览不改库；confirm=true 上传后再点「存草稿」持久化。
 */
export async function setShortStoryCover(
  itemId: string,
  opts: { coverPath: string; confirm?: boolean; headless?: boolean }
): Promise<ShortStoryResult> {
  const readiness = automationReadiness();
  if (!readiness.ready) {
    return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  }
  if (!itemId) return { ok: false, action: "aborted", message: "缺少 item_id。" };
  if (!opts.coverPath) return { ok: false, action: "aborted", message: "缺少 cover_path（本地图片路径）。" };
  if (!fs.existsSync(opts.coverPath)) return { ok: false, action: "aborted", message: `封面文件不存在：${opts.coverPath}` };

  const session = await openSession(opts.headless ?? true, shortPublishUrl(itemId));
  if (isError(session)) return { ok: false, action: "aborted", message: session.error };
  const { browser, page } = session;
  try {
    await sleep(2000);
    const uploaded = await uploadCover(page, opts.coverPath);
    if (!uploaded) {
      const file = await shot(page, "short-cover-missing");
      return {
        ok: false,
        action: "aborted",
        message: "未找到封面上传入口（input[type=file]）。可能需先点开「封面设置」区域，或页面改版。",
        itemId,
        url: page.url(),
        screenshotPath: file,
      };
    }
    if (!opts.confirm) {
      const file = await shot(page, "short-cover-uploaded");
      return {
        ok: true,
        action: "filled-not-submitted",
        message: `已上传封面图片但未保存（confirm=false）。确认后传 confirm=true 保存草稿以持久化封面。`,
        itemId,
        url: page.url(),
        screenshotPath: file,
      };
    }
    const saved = await saveDraft(page);
    const file = await shot(page, saved ? "short-cover-saved" : "short-cover-save-failed");
    return {
      ok: saved,
      action: saved ? "draft-saved" : "error",
      message: saved ? `封面已上传并保存草稿 item_id=${itemId}。` : "封面已上传，但「存草稿」未成功，请手动保存。",
      itemId,
      url: page.url(),
      screenshotPath: file,
    };
  } catch (e) {
    return { ok: false, action: "error", message: `设置封面失败: ${(e as Error).message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ------------------------------ 删除 ------------------------------ */

/**
 * 删除短故事/草稿。
 * 注意：delete/v0 是写接口，需页面 JS 的签名（手工 fetch 会返回 -2 参数有误），
 * 因此这里驱动草稿箱真实 UI：hover 卡片 → 点删除图标 → 确认弹窗 → 监听 delete 响应。
 * 默认 confirm=false 只做预览。
 */
export async function deleteShortStory(
  itemId: string,
  opts: { confirm?: boolean; headless?: boolean } = {}
): Promise<{ ok: boolean; action: "preview" | "deleted" | "error"; message: string; screenshotPath?: string }> {
  if (!itemId) return { ok: false, action: "error", message: "缺少 item_id。" };
  if (!opts.confirm) {
    return {
      ok: true,
      action: "preview",
      message: `将删除短故事 item_id=${itemId}（confirm=false，未执行）。确认后传 confirm=true。`,
    };
  }
  const readiness = automationReadiness();
  if (!readiness.ready) return { ok: false, action: "error", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };

  const session = await openSession(opts.headless ?? true, "/main/writer/short-draft");
  if (isError(session)) return { ok: false, action: "error", message: session.error };
  const { browser, page } = session;
  try {
    await sleep(4000);

    // 用草稿列表得到当前草稿 id（仅用于更友好的报错）
    const list = await apiGet(page, API.shortArticleDraftList, {
      page_count: 200,
      page_index: 0,
      time_sort: 0,
      image_fmt_list: "450x800",
      book_image_fmt_list: "190x250",
      pack_type: 1,
    });
    const ids: string[] = (list?.data?.item_list ?? []).map((x: any) => String(x.item_id));
    if (!ids.includes(itemId)) {
      const file = await shot(page, "short-delete-not-found");
      return {
        ok: false,
        action: "error",
        message: `草稿箱中没有 item_id=${itemId}（可能是已发布作品，请到「我的短故事」删除）。当前草稿：${ids.join("、") || "无"}`,
        screenshotPath: file,
      };
    }

    // 按 item_id 定位卡片里的删除图标（卡片带 href=.../preview-short/{item_id}）
    const rect = await page.evaluate((id: string) => {
      const rows = Array.from(document.querySelectorAll(".short-draft-table-item")) as any[];
      const hit = rows.find((r) =>
        Array.from(r.querySelectorAll("a")).some((a: any) => String(a.getAttribute("href") || "").includes(id))
      );
      if (!hit) return null;
      hit.scrollIntoView({ block: "center" });
      const icon = hit.querySelector(".serial-icon-general_delete");
      if (!icon) return null;
      const b = icon.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return null;
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, itemId);
    if (!rect) {
      const file = await shot(page, "short-delete-icon-missing");
      return {
        ok: false,
        action: "error",
        message: "未找到该草稿的删除图标（选择器 .serial-icon-general_delete）。",
        screenshotPath: file,
      };
    }

    // 监听 delete 响应
    const respPromise = new Promise<{ code: number; message: string }>((resolve) => {
      const onResp = async (resp: any) => {
        if (resp.url().includes(API.shortArticleDelete)) {
          try {
            const j = JSON.parse(await resp.text());
            resolve({ code: j?.code, message: j?.message });
          } catch {
            resolve({ code: -1, message: "响应解析失败" });
          }
        }
      };
      page.on("response", onResp);
      setTimeout(() => resolve({ code: -999, message: "超时未收到删除响应" }), 20000);
    });

    // SVG 上没有 .click()，必须用真实鼠标事件
    await page.mouse.move(rect.x, rect.y);
    await sleep(400);
    await page.mouse.click(rect.x, rect.y);
    await sleep(1200);

    // 确认弹窗
    const confirmed = await clickModalConfirm(page);
    if (confirmed) await sleep(1500);

    const r = await respPromise;
    const file = await shot(page, r.code === 0 ? "short-delete-ok" : "short-delete-result");

    if (r.code === 0) {
      return { ok: true, action: "deleted", message: `已删除短故事 item_id=${itemId}。`, screenshotPath: file };
    }
    return {
      ok: false,
      action: "error",
      message: `删除未成功：code=${r.code} message=${r.message}${confirmed ? "" : "（未出现确认弹窗）"}。请在草稿箱手动删除。`,
      screenshotPath: file,
    };
  } catch (e) {
    return { ok: false, action: "error", message: `删除失败: ${(e as Error).message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 点确认弹窗里的确认按钮（番茄为「提示 / 确认删除作品？…」+ 取消/确认） */
async function clickModalConfirm(page: any): Promise<boolean> {
  const labels = ["确认", "确定", "确认删除", "确定删除", "删除", "是的"];
  // 等待弹窗出现
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const has = await page
      .evaluate((ls: string[]) => {
        const btns = Array.from(document.querySelectorAll("button")) as any[];
        return btns.some((b) => b.offsetParent !== null && ls.includes((b.textContent || "").trim()));
      }, labels)
      .catch(() => false);
    if (has) break;
    await sleep(400);
  }
  return page
    .evaluate((ls: string[]) => {
      // 只在弹窗容器内找，避免误点页面上的同名按钮
      const scopes = Array.from(
        document.querySelectorAll('.arco-modal:not(.arco-modal-mask),.arco-modal-wrapper,[role="dialog"]')
      ) as any[];
      for (const scope of scopes) {
        if (!scope.getClientRects().length) continue;
        const btns = Array.from(scope.querySelectorAll("button")) as any[];
        for (const l of ls) {
          const b = btns.find((x: any) => x.offsetParent !== null && (x.textContent || "").trim() === l);
          if (b) {
            b.click();
            return true;
          }
        }
      }
      return false;
    }, labels)
    .catch(() => false);
}

/** 供统计使用：短故事数量 */
export async function countShortStories(): Promise<number | undefined> {
  const r = await listShortStories({ pageCount: 200 });
  return r.ok ? r.total : undefined;
}

export function shortManageLink(): string {
  return `${authorApiBase()}/main/writer/short-manage`;
}
