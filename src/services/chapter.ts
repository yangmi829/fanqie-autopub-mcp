import { sleep, shot } from "../browser/driver.js";
import { automationReadiness } from "./auth.js";
import { openSession, isError, apiGet, API, chapterUrlTemplate } from "../browser/endpoints.js";
import { loadCookies } from "../browser/cookies.js";
import { toPlainText, cleanChapterTitle } from "../core/text.js";
import { logger } from "../core/logger.js";

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
  content: string;
  chapterNumber?: number | string;
  scheduledTime?: string;
  detection?: "basic" | "full";
  useAI?: boolean;
  confirm?: boolean;
  headless?: boolean;
}

export type UploadAction = "published" | "scheduled" | "filled-not-submitted" | "aborted" | "error" | "already-exists";

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
      } else {
        el.innerText = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    text
  );
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
async function chooseDetection(page: any, mode: "basic" | "full"): Promise<boolean> {
  const label = mode === "full" ? "全面检测" : "仅基础检测";
  const deadline = Date.now() + 20000;
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

/** 「发布设置」弹窗：选「是否使用AI」→「确认提交」（真正触发发布） */
async function confirmPublishSettings(page: any, useAI: boolean): Promise<boolean> {
  const deadline = Date.now() + 20000;
  let present = false;
  while (Date.now() < deadline) {
    present = await hasModalMatching(page, "发布设置");
    if (present) break;
    await sleep(500);
  }
  if (!present) return false;

  const target = useAI ? "是" : "否";
  await page
    .evaluate((t: string) => {
      const ds = Array.from(
        document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="dialog"]')
      ) as any[];
      const box = ds.find((d) => /发布设置/.test(d.textContent || "")) || document;
      const lab = (Array.from(box.querySelectorAll("label")) as any[]).find(
        (l) => (l.textContent || "").trim() === t
      );
      if (lab) {
        const input = lab.querySelector('input[type="radio"]');
        if (input) (input as any).click();
        else lab.click();
      }
    }, target)
    .catch(() => {});
  await sleep(800);

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

/** 「错别字未修改」之类的二次确认：点提交 */
async function clickSubmitInModal(page: any): Promise<boolean> {
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

  const session = await openSession(opts.headless ?? false, chapterUrlTemplate().replace("{bookId}", opts.bookId));
  if (isError(session)) return { ok: false, action: "aborted", message: session.error };
  const { browser, page } = session;

  const url = chapterUrlTemplate().replace("{bookId}", opts.bookId);
  try {
    const numSel = await firstMatch(page, [".serial-editor-title-left input"]);
    const titleSel = await firstMatch(page, ['input[placeholder="请输入标题"]', ".serial-editor-input-hint-area"]);
    const contentSel = await firstMatch(page, [".syl-editor-container .ProseMirror", ".ProseMirror"]);
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

    const num = String(opts.chapterNumber ?? "").trim();
    const plainTitle = cleanChapterTitle(opts.title || "");
    const plainContent = toPlainText(opts.content || "");

    if (num) await fillField(page, numSel, num);
    await fillField(page, titleSel, plainTitle);
    await fillField(page, contentSel, plainContent);
    await sleep(1200);

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
    await page.click("button.publish-button");
    await sleep(2500);

    const detection: "basic" | "full" = opts.detection === "full" ? "full" : "basic";
    if (!(await chooseDetection(page, detection))) {
      const file = await shot(page, "chapter-detection-missing");
      return {
        ok: false,
        action: "aborted",
        message: "未出现「请选择内容检测方式」弹窗（常见原因：正文长度不足，或页面改版）。请检查正文，或手动完成发布。",
        url: page.url(),
        screenshotPath: file,
      };
    }
    await sleep(3000);

    if (!(await confirmPublishSettings(page, opts.useAI === true))) {
      const file = await shot(page, "chapter-settings-missing");
      return {
        ok: false,
        action: "aborted",
        message: "未出现「发布设置」弹窗或未能点击「确认提交」，章节仍为草稿。请到作者后台草稿箱手动发布。",
        url: page.url(),
        screenshotPath: file,
      };
    }
    await sleep(5000);

    if (await clickSubmitInModal(page)) await sleep(4000);

    const finalUrl = page.url();
    let after = await fetchChapterStats(page, opts.bookId, plainTitle);
    if (!after.found && (after.count === -1 || after.count <= before.count)) {
      await sleep(4000);
      after = await fetchChapterStats(page, opts.bookId, plainTitle);
    }
    const success = after.found || (before.count >= 0 && after.count > before.count);
    const file = await shot(page, success ? "chapter-published" : "chapter-publish-result").catch(() => "");

    await browser.close().catch(() => {});
    return {
      ok: success,
      action: success ? (opts.scheduledTime ? "scheduled" : "published") : "error",
      message: success
        ? `章节「${plainTitle}」已发布${opts.scheduledTime ? "（定时）" : "（立即）"}。已发布章节数 ${before.count} → ${after.count}。`
        : `已走完发布流程，但后台未确认到该章节（已发布数 ${before.count} → ${after.count}）。请到作者后台确认；若仍在草稿箱可手动发布或重试。`,
      url: finalUrl !== url ? finalUrl : url,
      screenshotPath: file,
      publishedBefore: before.count,
      publishedAfter: after.count,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    logger.error(`上传章节异常: ${(e as Error).message}`);
    return { ok: false, action: "error", message: `上传失败: ${(e as Error).message}` };
  }
}
