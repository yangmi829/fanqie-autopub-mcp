import { sleep, shot } from "../browser/driver.js";
import { automationReadiness } from "./auth.js";
import { openSession, isError, apiGet, API, chapterUrlTemplate, modifyChapterPath, authorApiBase } from "../browser/endpoints.js";
import { loadCookies } from "../browser/cookies.js";
import { toPlainText, cleanChapterTitle } from "../core/text.js";
import { logger } from "../core/logger.js";
import { NEXT_STEP_CHAPTER_PUBLISHED } from "../core/reminders.js";

/* ------------------------------ 章节列表 ------------------------------ */

export interface ChapterListItem {
  id: string;
  title: string;
  wordNumber?: number;
  status?: number;
  createTime?: string;
}

export async function listChapters(
  bookId: string,
  pageCount = 200
): Promise<{ ok: boolean; message: string; chapters?: ChapterListItem[]; total?: number }> {
  const readiness = automationReadiness();
  if (!readiness.ready) return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  if (!bookId) return { ok: false, message: "缺少 book_id" };

  const session = await openSession(true, "/main/writer/book-manage");
  if (isError(session)) return { ok: false, message: session.error };
  const { browser, page } = session;
  try {
    const data = await apiGet(page, API.chapterList, {
      book_id: bookId,
      page_count: pageCount,
      page_index: 0,
    });
    await browser.close().catch(() => {});
    if (data?.code !== 0) return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
    const items: any[] = data?.data?.item_list ?? [];
    const chapters: ChapterListItem[] = items.map((c: any) => ({
      id: String(c.item_id ?? c.chapter_id ?? ""),
      title: String(c.title ?? ""),
      wordNumber: c.word_number ?? c.word_count,
      status: c.status,
      createTime: c.create_time ?? c.modify_time,
    }));
    return { ok: true, message: `共 ${data?.data?.total_count ?? chapters.length} 章`, chapters, total: Number(data?.data?.total_count ?? chapters.length) };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, message: `读取章节列表失败: ${(e as Error).message}` };
  }
}

/* ------------------------------ 上传章节 ------------------------------ */

export interface UploadChapterOptions {
  bookId: string;
  title: string;
  /** 改稿（传了 chapterId）时可以不给：不给就保留线上正文，只改标题 */
  content?: string;
  chapterNumber?: number | string;
  scheduledTime?: string;
  detection?: "basic" | "full";
  /** 发布设置「是否使用AI」；**默认 true（选「是」）**，显式传 false 才选「否」 */
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
  /** 传了就是「改已发布章节」：走 modifychapter 路由，按 chapterId 复核 */
  chapterId?: string;
}

export type UploadAction =
  | "published"
  | "scheduled"
  | "updated"
  | "filled-not-submitted"
  | "aborted"
  | "error"
  | "already-exists";

export interface UploadChapterResult {
  ok: boolean;
  action: UploadAction;
  message: string;
  url?: string;
  screenshotPath?: string;
  publishedBefore?: number;
  publishedAfter?: number;
}

async function firstMatch(page: any, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    try {
      if (await page.$(sel)) return sel;
    } catch {
      // 个别选择器在部分 puppeteer 版本不被支持，跳过
    }
  }
  return null;
}

/**
 * 等编辑器真正挂载后再取选择器（SPA 在 networkidle2 之后仍可能只显示 loading）。
 * 轮询到三个输入框都出现即返回，避免「未能定位输入框」的竞态。
 */
async function waitForEditor(
  page: any,
  timeoutMs = 35000
): Promise<{ num: string | null; title: string | null; content: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let num: string | null = null;
  let title: string | null = null;
  let content: string | null = null;
  while (Date.now() < deadline) {
    if (!num) num = await firstMatch(page, [".serial-editor-title-left input"]);
    if (!title)
      title = await firstMatch(page, ['input[placeholder="请输入标题"]', ".serial-editor-input-hint-area"]);
    if (!content) content = await firstMatch(page, [".syl-editor-container .ProseMirror", ".ProseMirror"]);
    if (num && title && content) break;
    await sleep(500);
  }
  return { num, title, content };
}

/** 填值：INPUT/TEXTAREA 走原生 setter；contenteditable/ProseMirror 走 execCommand */
async function fillField(page: any, selector: string, text: string): Promise<void> {
  await page.click(selector, { clickCount: 3 }).catch(() => {});
  await page.evaluate(
    (sel: string, value: string) => {
      const el: any = document.querySelector(sel);
      if (!el) return;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") {
        const proto =
          tag === "TEXTAREA"
            ? (window as any).HTMLTextAreaElement.prototype
            : (window as any).HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      el.focus();
      try {
        el.click();
      } catch {
        /* noop */
      }
      if (el.classList?.contains("ProseMirror")) {
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        const paras = value
          .split(/\n{2,}/)
          .map((p: string) => p.trim())
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
        // 兜底：逐段插入偶发失败（编辑器未聚焦），整体再插一次
        if (!(el.textContent || "").trim()) {
          el.focus();
          document.execCommand("insertText", false, value);
        }
      } else {
        el.innerText = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    text
  );
}

/** 读取编辑器当前正文去空白字符数，用于校验填充是否成功 */
async function readEditorLength(page: any, selector: string): Promise<number> {
  return page
    .evaluate((sel: string) => {
      const el: any = document.querySelector(sel);
      if (!el) return -1;
      return (el.textContent || "").replace(/\s/g, "").length;
    }, selector)
    .catch(() => -1);
}

/** 轮询直到元素存在且可用（未禁用、可见） */
async function waitForEnabled(page: any, selector: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page
      .evaluate(
        (s: string) => {
          const b: any = document.querySelector(s);
          return !!b && !b.disabled && b.offsetParent !== null;
        },
        selector
      )
      .catch(() => false);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

async function trySchedule(page: any, iso: string): Promise<boolean> {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const pad = (n: number) => String(n).padStart(2, "0");
  const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sel = await firstMatch(page, ['input[placeholder*="时间"]', 'input[name="publishTime"]', ".publish-time input"]);
  if (!sel) return false;
  try {
    await fillField(page, sel, value);
    await page.keyboard.press("Enter").catch(() => {});
    await sleep(800);
    return true;
  } catch {
    return false;
  }
}

async function hasModalMatching(page: any, re: string): Promise<boolean> {
  return page
    .evaluate((src: string) => {
      const r = new RegExp(src);
      return Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="dialog"]')).some((d: any) =>
        r.test(d.textContent || "")
      );
    }, re)
    .catch(() => false);
}

/** 关闭「这里可以设置分卷…」新手引导弹窗 */
async function dismissVolumeGuide(page: any): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (!(await hasModalMatching(page, "设置分卷"))) return;
    const clicked = await page
      .evaluate(() => {
        const ds = Array.from(
          document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="dialog"]')
        ) as any[];
        for (const d of ds) {
          if (!/设置分卷/.test(d.textContent || "")) continue;
          const btn = Array.from(d.querySelectorAll("button")).find(
            (b: any) => /^(下一步|知道了|知道|完成|跳过|关闭)$/.test((b.textContent || "").trim()) && b.offsetParent !== null
          ) as any;
          if (btn) {
            btn.click();
            return true;
          }
          const close = d.querySelector('[class*="close"]');
          if (close) {
            (close as any).click();
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
    if (!clicked) return;
    await sleep(1200);
  }
}

/** 「请选择内容检测方式」→ 仅基础检测 / 全面检测 */
async function chooseDetection(page: any, mode: "basic" | "full", timeoutMs = 20000): Promise<boolean> {
  const label = mode === "full" ? "全面检测" : "仅基础检测";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const has = await page
      .evaluate(
        () =>
          Array.from(document.querySelectorAll("button")).some(
            (b: any) => b.offsetParent !== null && /^(仅基础检测|全面检测)$/.test((b.textContent || "").trim())
          )
      )
      .catch(() => false);
    if (has) {
      return Boolean(
        await page
          .evaluate((t: string) => {
            const b = Array.from(document.querySelectorAll("button")).find(
              (x: any) => (x.textContent || "").trim() === t && x.offsetParent !== null
            ) as any;
            if (b) {
              b.click();
              return true;
            }
            return false;
          }, label)
          .catch(() => false)
      );
    }
    await sleep(500);
  }
  return false;
}

/**
 * 「是否使用AI」的选项文案。
 * 番茄现版是「是 / 否」；平台若改成「AI生成 / 非AI生成」，这里兜住。
 * ⚠️ 业务要求：AI 相关声明一律选**肯定项**（是 / AI生成），默认 useAI=true。
 */
const AI_YES_LABELS = ["是", "AI生成", "AI 生成", "含AI生成内容", "AI创作", "AI辅助创作", "人工智能生成"];
const AI_NO_LABELS = ["否", "非AI生成", "不是AI生成", "本人原创", "人工创作"];

/** 在指定容器里点中目标选项，并回读是否真的选中（返回点中的文案） */
async function clickChoiceInBox(
  page: any,
  boxTextRe: RegExp,
  labels: string[],
  fallbackDocument = true
): Promise<string | null> {
  return page
    .evaluate(
      (src: string, wanted: string[], fallback: boolean) => {
        const rx = new RegExp(src);
        const ds = Array.from(
          document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="dialog"]')
        ) as any[];
        const box = ds.find((d) => rx.test(d.textContent || "")) || (fallback ? document : null);
        if (!box) return null;
        const all = Array.from(box.querySelectorAll("label,[role=radio],.arco-radio,.arco-checkbox")) as any[];
        const norm = (s: string) => s.replace(/\s+/g, "");
        let lab: any = null;
        for (const t of wanted) {
          lab =
            all.find((l) => norm(l.textContent || "") === norm(t)) ||
            all.find((l) => norm(t).length > 1 && norm(l.textContent || "").includes(norm(t)));
          if (lab) break;
        }
        if (!lab) return null;
        const hit = norm(lab.textContent || "");
        const input = lab.querySelector('input[type="radio"],input[type="checkbox"]');
        try {
          (input ?? lab).click();
          lab.click();
        } catch {
          /* 忽略 */
        }
        const checked =
          (input && input.checked) ||
          /is-checked|is-active|checked/.test(String(lab.className || "")) ||
          lab.getAttribute("aria-checked") === "true";
        return checked ? hit : checked === false ? null : hit;
      },
      boxTextRe.source,
      labels,
      fallbackDocument
    )
    .catch(() => null);
}

/** 「发布设置」弹窗：选「是否使用AI」→「确认提交」（真正触发发布） */
async function confirmPublishSettings(page: any, useAI: boolean, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let present = false;
  while (Date.now() < deadline) {
    present = await hasModalMatching(page, "发布设置");
    if (present) break;
    await sleep(500);
  }
  if (!present) return false;

  const labels = useAI ? AI_YES_LABELS : AI_NO_LABELS;
  const picked = await clickChoiceInBox(page, /发布设置/, labels);
  await sleep(800);
  if (!picked) logger.warn(`[发布设置] 未点中「是否使用AI=${useAI ? "是" : "否"}」的选项`);

  return clickByEvaluate(page, (b: any) => (b.textContent || "").trim() === "确认提交");
}

/** 在页面里找 button，打标记后用真实鼠标点击（SPA 依赖真实事件） */
async function clickByEvaluate(page: any, pred: (btn: any) => boolean): Promise<boolean> {
  const found = await page
    .evaluate((predSrc: string) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function("b", `return (${predSrc})(b)`);
      const btn = (Array.from(document.querySelectorAll("button")) as any[]).find(
        (b: any) => b.offsetParent !== null && fn(b)
      ) as any;
      if (!btn) return false;
      btn.setAttribute("data-autopub-target", "1");
      return true;
    }, pred.toString())
    .catch(() => false);
  if (!found) return false;
  try {
    await page.click('[data-autopub-target="1"]');
  } catch {
    await page
      .evaluate(() => {
        const b = document.querySelector('[data-autopub-target="1"]') as any;
        if (b) b.click();
      })
      .catch(() => {});
  }
  await page
    .evaluate(() => document.querySelector('[data-autopub-target="1"]')?.removeAttribute("data-autopub-target"))
    .catch(() => {});
  return true;
}

/** 「错别字未修改」之类的二次确认：点提交 */async function clickSubmitInModal(page: any): Promise<boolean> {
  const found = await page.evaluate(() => {
    const ds = Array.from(
      document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"]')
    ) as any[];
    for (const d of ds) {
      if (/错别字|是否确定提交|确定提交/.test(d.textContent || "")) {
        const btn = Array.from(d.querySelectorAll("button")).find((b: any) =>
          /提交|确定|确认/.test((b.textContent || "").trim())
        ) as any;
        if (btn) {
          btn.setAttribute("data-autopub-modal", "1");
          return true;
        }
      }
    }
    return false;
  });
  if (!found) return false;
  try {
    await page.click('[data-autopub-modal="1"]');
  } catch {
    await page
      .evaluate(() => {
        const b = document.querySelector('[data-autopub-modal="1"]') as any;
        if (b) b.click();
      })
      .catch(() => {});
  }
  await page
    .evaluate(() => document.querySelector('[data-autopub-modal="1"]')?.removeAttribute("data-autopub-modal"))
    .catch(() => {});
  return true;
}

/**
 * 依次处理发布过程中的各类弹窗，直到页面不再弹窗为止。
 * 实测顺序并非固定：常见为「错别字确认 → 内容检测方式 → 发布设置」，
 * 首章之后也可能跳过检测/设置。因此不假设顺序，出现谁就处理谁；
 * 错别字弹窗的「提交」只是继续流程，不能当作发布完成。
 */
async function drivePublishDialogs(page: any, detection: "basic" | "full", useAI: boolean): Promise<boolean> {
  const deadline = Date.now() + 90000;
  let detDone = false;
  let setDone = false;
  let typoCount = 0;
  let sawAny = false;
  let quiet = 0;
  let i = 0;
  while (Date.now() < deadline) {
    i++;
    if (await chooseDetection(page, detection, 1200)) {
      detDone = true;
      sawAny = true;
      quiet = 0;
      logger.warn(`[dialog#${i}] 已选择内容检测方式`);
      await sleep(1500);
      continue;
    }
    if (await confirmPublishSettings(page, useAI, 1200)) {
      setDone = true;
      sawAny = true;
      quiet = 0;
      logger.warn(`[dialog#${i}] 已完成发布设置（是否使用AI=${useAI ? "是" : "否"}）`);
      await sleep(2500);
      continue;
    }
    if (await clickSubmitInModal(page)) {
      typoCount++;
      sawAny = true;
      quiet = 0;
      logger.warn(`[dialog#${i}] 错别字确认点提交（第 ${typoCount} 次），继续后续步骤`);
      await sleep(2500);
      if (typoCount >= 6) break;
      continue;
    }
    quiet++;
    if (sawAny && quiet >= 4) break; // 连续多次无弹窗 → 流程结束
    await sleep(1000);
  }
  logger.warn(`[dialogs] 结束 det=${detDone} set=${setDone} typo=${typoCount}`);
  return typoCount > 0 || detDone || setDone;
}

/** 读「已发布」章节数与是否包含指定标题 */
async function fetchChapterStats(page: any, bookId: string, title: string): Promise<{ count: number; found: boolean }> {
  return page
    .evaluate(
      async (p: { bookId: string; title: string }) => {
        try {
          const r = await fetch(
            `https://fanqienovel.com/api/author/chapter/chapter_list/v1?aid=2503&app_name=muye_novel&book_id=${p.bookId}&page_count=200&page_index=0`,
            { credentials: "include" }
          );
          const j: any = await r.json();
          const items: any[] = j?.data?.item_list ?? [];
          return {
            count: Number(j?.data?.total_count ?? 0),
            found: items.some((c) => String(c?.title ?? "").includes(p.title)),
          };
        } catch {
          return { count: -1, found: false };
        }
      },
      { bookId, title }
    )
    .catch(() => ({ count: -1, found: false }));
}

/**
 * 按 chapterId 复核章节当前标题/字数（改稿后判断是否真的生效；不能用标题匹配，改名时旧标题也在列表里）。
 */
async function fetchChapterById(
  page: any,
  bookId: string,
  chapterId: string
): Promise<{ title: string; wordNumber: number } | null> {
  return page
    .evaluate(
      async (p: { bookId: string; chapterId: string }) => {
        try {
          const r = await fetch(
            `https://fanqienovel.com/api/author/chapter/chapter_list/v1?aid=2503&app_name=muye_novel&book_id=${p.bookId}&page_count=200&page_index=0`,
            { credentials: "include" }
          );
          const j: any = await r.json();
          const items: any[] = j?.data?.item_list ?? [];
          const hit = items.find((c) => String(c?.item_id ?? c?.chapter_id ?? "") === p.chapterId);
          return hit
            ? { title: String(hit.title ?? ""), wordNumber: Number(hit.word_number ?? hit.word_count ?? 0) }
            : null;
        } catch {
          return null;
        }
      },
      { bookId, chapterId }
    )
    .catch(() => null);
}

/**
 * 真实上传章节。流程（逆向 + 实测）：
 *  Step1 进 /publish/ 自动建草稿；填序号/标题/ProseMirror 正文
 *  Step2 关「设置分卷」引导 → 下一步
 *  Step3 「请选择内容检测方式」→ 仅基础检测/全面检测
 *  Step4 「发布设置」→ 是否使用AI → 确认提交（真正发布）
 *  Step5 「错别字未修改」二次确认 → 提交
 *  Step6 chapter_list/v1 复核已发布数
 *  只有 confirm=true 才真正点发布，否则只填表不提交（会在后台留下未发布草稿）。
 */
export async function uploadChapter(opts: UploadChapterOptions): Promise<UploadChapterResult> {
  const readiness = automationReadiness();
  if (!readiness.ready) {
    return { ok: false, action: "aborted", message: `上传前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
  }
  if (!opts.bookId) {
    return { ok: false, action: "aborted", message: "缺少番茄书 ID（book_id）。" };
  }

  // 新建章节走 /publish/?enter_from=newchapter_1；改已发布章节走 /publish/{chapterId}/?enter_from=modifychapter
  const path = opts.chapterId
    ? modifyChapterPath(opts.bookId, opts.chapterId)
    : chapterUrlTemplate().replace("{bookId}", opts.bookId);
  const session = await openSession(opts.headless ?? false, path);
  if (isError(session)) return { ok: false, action: "aborted", message: session.error };
  const { browser, page } = session;

  const url = `${authorApiBase()}${path}`;
  try {
    const { num: numSel, title: titleSel, content: contentSel } = await waitForEditor(page);
    if (!numSel || !titleSel || !contentSel) {
      const file = await shot(page, "chapter-selectors-missing");
      return {
        ok: false,
        action: "aborted",
        message:
          `未能定位输入框（num=${numSel ?? "未找到"}，title=${titleSel ?? "未找到"}，content=${contentSel ?? "未找到"}）。` +
          `番茄后台若已改版，可用 FANQIE_CHAPTER_URL_TEMPLATE 指定发布页地址，或在 src/services/chapter.ts 的候选选择器里补充。`,
        url: page.url(),
        screenshotPath: file,
      };
    }

    // 改章节的「只读预览」：编辑器会边输入边自动保存 → 预览阶段一律不填充，避免误改线上
    if (opts.chapterId && !opts.confirm) {
      const cur = await page
        .evaluate(
          (s: { num: string; title: string; content: string }) => {
            const pick = (sel: string) => document.querySelector(sel) as any;
            const n = pick(s.num);
            const t = pick(s.title);
            const c = pick(s.content);
            return {
              chapterNumber: n ? String(n.value ?? "").trim() : "",
              title: t ? String(t.value ?? "").trim() : "",
              contentLength: c ? String(c.innerText ?? "").replace(/\s/g, "").length : 0,
            };
          },
          { num: numSel, title: titleSel, content: contentSel }
        )
        .catch(() => null);
      const file = await shot(page, "chapter-modify-preview").catch(() => "");
      const previewLen = toPlainText(opts.content || "").replace(/\s/g, "").length;
      return {
        ok: true,
        action: "filled-not-submitted",
        message:
          `已打开章节 ${opts.chapterId} 的修改页（enter_from=modifychapter）。当前线上：序号「${
            cur?.chapterNumber ?? "?"
          }」标题「${cur?.title ?? "?"}」，正文 ${cur?.contentLength ?? 0} 字。` +
          `confirm=false 下**没有做任何填充**（该编辑器边输入边自动保存，预览阶段填充有改动线上的风险）。` +
          `确认后传 confirm=true：标题 →「${cleanChapterTitle(opts.title || "")}」，${
            previewLen > 0 ? `正文一并替换为 ${previewLen} 字` : "正文保持不变（只改标题）"
          }，并走完后续流程。`,
        url: page.url(),
        screenshotPath: file,
      };
    }

    const num = String(opts.chapterNumber ?? "").trim();
    // 番茄的「序号框」与「标题框」是两个独立输入：标题框里不含「第X章」，所以统一剥前缀
    const plainTitle = cleanChapterTitle(opts.title || "");
    const plainContent = toPlainText(opts.content || "");
    const expectLen = plainContent.replace(/\s/g, "").length;
    // 改稿时不传正文 = 保留线上正文（编辑器里已载入），只改标题
    const keepBody = !!opts.chapterId && expectLen === 0;

    // 正文走 ProseMirror 的 execCommand，偶发填充不完整 → 校验字数并重试
    let editorLen = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (num) await fillField(page, numSel, num);
      await fillField(page, titleSel, plainTitle);
      if (!keepBody) await fillField(page, contentSel, plainContent);
      await sleep(1000);
      editorLen = await readEditorLength(page, contentSel);
      if (keepBody ? editorLen > 0 : editorLen >= expectLen * 0.8) break;
      logger.warn(`正文填充不完整（${editorLen}/${expectLen}），第 ${attempt + 1} 次重试`);
      await sleep(800);
    }
    if (keepBody ? editorLen === 0 : editorLen < expectLen * 0.8) {
      const file = await shot(page, "chapter-content-too-short");
      return {
        ok: false,
        action: "aborted",
        message: keepBody
          ? "改稿页读不到线上正文（编辑器字数 0），为避免把正文改空，已中止。请显式传 content/article_id。"
          : `正文填充不完整（编辑器中 ${editorLen} 字 / 应为 ${expectLen} 字），已中止，避免发布空章。`,
        url: page.url(),
        screenshotPath: file,
      };
    }

    // 校验红字（如「章节序号只支持阿拉伯数字」）
    const err = await page.evaluate(() => {
      const e: any = Array.from(document.querySelectorAll("*")).find(
        (x: any) => x.children.length === 0 && /章节序号|请(输入|填写)/.test(x.textContent || "")
      );
      return (e?.textContent || "").trim() || undefined;
    });
    if (err) {
      const file = await shot(page, "chapter-validation-error");
      return {
        ok: false,
        action: "aborted",
        message: `表单校验未过：${err}。请检查章节序号是否为阿拉伯数字、标题是否已填。`,
        url: page.url(),
        screenshotPath: file,
      };
    }

    if (!opts.confirm) {
      const file = await shot(page, "chapter-filled");
      return {
        ok: true,
        action: "filled-not-submitted",
        message:
          "已打开作者后台并填入序号/标题/正文，但未点击发布（confirm=false）。" +
          "注意：该编辑器会边打字边自动存草稿，后台可能出现一条未发布草稿（仅作者可见）。" +
          "核对无误后传 confirm=true 才会真正发布。",
        url: page.url(),
        screenshotPath: file,
      };
    }

    if (opts.scheduledTime && !(await trySchedule(page, opts.scheduledTime))) {
      logger.warn("未能设置定时发布时间，将按立即发布处理");
    }

    const before = await fetchChapterStats(page, opts.bookId, plainTitle);

    await dismissVolumeGuide(page);
    if (!(await page.$("button.publish-button"))) {
      const file = await shot(page, "chapter-next-missing");
      return { ok: false, action: "aborted", message: "未找到「下一步」按钮，无法进入发布确认页。", url: page.url(), screenshotPath: file };
    }
    if (!(await waitForEnabled(page, "button.publish-button", 10000))) {
      const file = await shot(page, "chapter-next-disabled");
      return {
        ok: false,
        action: "aborted",
        message: "「下一步」按钮一直不可用（正文或标题未填全），已中止。",
        url: page.url(),
        screenshotPath: file,
      };
    }
    await page.click("button.publish-button");
    await sleep(2500);

    const detection: "basic" | "full" = opts.detection === "full" ? "full" : "basic";

    // Step3-5 轮流处理：内容检测方式 → 发布设置 → 错别字确认（后两者可能被跳过）
    // 「是否使用AI」默认选「是」（AI 相关声明一律选肯定项），显式 useAI=false 才选「否」
    const submitted = await drivePublishDialogs(page, detection, opts.useAI !== false);
    if (!submitted) {
      await shot(page, "chapter-submit-missing").catch(() => "");
      logger.warn("未检测到「提交」确认弹窗，仍尝试复核发布结果");
    }

    // 改稿：按 chapterId 复核（不能按标题匹配 —— 改名后列表里可能还残留旧标题）
    if (opts.chapterId) {
      const match = (t?: string) => !!t && (cleanChapterTitle(t) === plainTitle || t.trim() === plainTitle);
      let afterCh = await fetchChapterById(page, opts.bookId, opts.chapterId);
      // 提交后先进「修改审核」，列表标题会滞后（实测约 1–2 分钟）→ 轮询一会儿
      for (let i = 0; i < 6 && !match(afterCh?.title); i++) {
        await sleep(5000);
        afterCh = (await fetchChapterById(page, opts.bookId, opts.chapterId)) ?? afterCh;
      }
      const titleOk = match(afterCh?.title);
      const ok = titleOk || submitted;
      const file = await shot(page, titleOk ? "chapter-updated" : "chapter-update-result").catch(() => "");
      return {
        ok,
        action: ok ? "updated" : "error",
        message: titleOk
          ? `章节 ${opts.chapterId} 已修改为「${plainTitle}」（线上标题「${afterCh!.title}」，正文 ${afterCh!.wordNumber} 字）。改动可能需要重新审核。`
          : submitted
            ? `已提交修改（后台按「修改审核」处理），列表暂仍读回「${afterCh?.title ?? "（读不到）"}」；标题将在审核通过后生效，请稍后复核。`
            : `未检测到提交流程（可能未找到「下一步/提交」按钮），列表读回「${afterCh?.title ?? "（读不到）"}」。请到作者后台确认。`,
        url,
        screenshotPath: file,
      };
    }

    const finalUrl = page.url();
    let after = await fetchChapterStats(page, opts.bookId, plainTitle);
    if (!after.found && (after.count === -1 || after.count <= before.count)) {
      await sleep(4000);
      after = await fetchChapterStats(page, opts.bookId, plainTitle);
    }
    const success = after.found || (before.count >= 0 && after.count > before.count);
    const file = await shot(page, success ? "chapter-published" : "chapter-publish-result").catch(() => "");

    return {
      ok: success,
      action: success ? (opts.scheduledTime ? "scheduled" : "published") : "error",
      message: success
        ? `章节「${plainTitle}」已发布${opts.scheduledTime ? "（定时）" : "（立即）"}。已发布章节数 ${before.count} → ${after.count}。${NEXT_STEP_CHAPTER_PUBLISHED}`
        : `已走完发布流程，但后台未确认到该章节（已发布数 ${before.count} → ${after.count}）。请到作者后台确认；若仍在草稿箱可手动发布或重试。`,
      url: finalUrl !== url ? finalUrl : url,
      screenshotPath: file,
      publishedBefore: before.count,
      publishedAfter: after.count,
    };
  } catch (e) {
    logger.error(`上传章节异常: ${(e as Error).message}`);
    return { ok: false, action: "error", message: `上传失败: ${(e as Error).message}` };
  } finally {
    await browser.close().catch(() => {});
  }
}
