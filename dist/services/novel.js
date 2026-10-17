import { sleep, shot } from "../browser/driver.js";
import { automationReadiness } from "./auth.js";
import { openSession, isError, apiGet, API, authorApiBase, withParams, createBookUrl } from "../browser/endpoints.js";
import { logger } from "../core/logger.js";
/* ------------------------------ 内容标签上限 ------------------------------ */
/** 内容标签 4 组的字数上限，对应番茄 config serial_book_label_setting */
export const CONTENT_TAG_CAPS = { plot: 4, emotion: 2, character: 4, worldview: 1 };
export function validateContentTagCaps(ct) {
    const over = [];
    if ((ct.plot?.length ?? 0) > CONTENT_TAG_CAPS.plot)
        over.push(`情节≤${CONTENT_TAG_CAPS.plot}`);
    if ((ct.emotion?.length ?? 0) > CONTENT_TAG_CAPS.emotion)
        over.push(`情感≤${CONTENT_TAG_CAPS.emotion}`);
    if ((ct.character?.length ?? 0) > CONTENT_TAG_CAPS.character)
        over.push(`人设≤${CONTENT_TAG_CAPS.character}`);
    if ((ct.worldview?.length ?? 0) > CONTENT_TAG_CAPS.worldview)
        over.push(`世界观≤${CONTENT_TAG_CAPS.worldview}`);
    return over;
}
export async function listBooks() {
    const readiness = automationReadiness();
    if (!readiness.ready)
        return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    const session = await openSession(true, "/main/writer/book-manage");
    if (isError(session))
        return { ok: false, message: session.error };
    const { browser, page } = session;
    try {
        const data = await apiGet(page, API.bookList, {
            page_count: 50,
            page_index: 0,
            image_fmt_list: "270x480",
        });
        await browser.close().catch(() => { });
        if (data?.code !== 0) {
            return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
        }
        const list = (data?.data?.book_list ?? []).map((b) => ({
            bookId: String(b.book_id),
            bookName: String(b.book_name ?? ""),
            status: b.status,
            verifyStatus: b.verify_status,
        }));
        return { ok: true, message: `共 ${list.length} 本书`, books: list };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, message: `读取作品列表失败: ${e.message}` };
    }
}
/** 在已打开的标签面板里，按精确文本点击叶子选项 */
async function clickTagByText(page, tag) {
    return page.evaluate((t) => {
        const cand = Array.from(document.querySelectorAll("span,div,li,a,button,label"));
        const el = cand.find((e) => {
            if (e.children && e.children.length > 0)
                return false;
            return (e.textContent || "").trim() === t;
        });
        if (el) {
            el.click();
            return true;
        }
        return false;
    }, tag);
}
/**
 * 勾选阅读标签(#selectRow) 与内容标签(#activitySelectRow)。
 * 先确保已选频道（标签下拉框在选频道前不会打开），再分别勾选。
 */
async function selectTagsOnCreatePage(page, readingTags = [], contentTags = {}) {
    const appliedReading = [];
    const appliedContent = [];
    const missing = [];
    await page.keyboard.press("Escape").catch(() => { });
    await sleep(600);
    // 暖场：先开关一次内容标签，规避「选完频道后表单重渲染导致 #selectRow 暂时消失」
    try {
        await page.click("#activitySelectRow .select-view", { delay: 120 });
        await sleep(1600);
        await page.keyboard.press("Escape");
        await sleep(600);
    }
    catch { }
    if (readingTags.length) {
        try {
            await page.click("#selectRow .select-view", { delay: 150 });
        }
        catch { }
        await sleep(1800);
        for (const t of readingTags) {
            if (await clickTagByText(page, t))
                appliedReading.push(t);
            else
                missing.push(`阅读标签:${t}`);
            await sleep(300);
        }
        await page.keyboard.press("Escape").catch(() => { });
        await sleep(500);
    }
    const allContent = [
        ...(contentTags.plot ?? []),
        ...(contentTags.emotion ?? []),
        ...(contentTags.character ?? []),
        ...(contentTags.worldview ?? []),
    ];
    if (allContent.length) {
        try {
            await page.click("#activitySelectRow .select-view", { delay: 150 });
        }
        catch { }
        await sleep(1800);
        for (const t of allContent) {
            if (await clickTagByText(page, t))
                appliedContent.push(t);
            else
                missing.push(`内容标签:${t}`);
            await sleep(300);
        }
        await page.keyboard.press("Escape").catch(() => { });
        await sleep(500);
    }
    return { appliedReading, appliedContent, missing };
}
/**
 * 在作者后台真实建书。
 * 建书接口对参数格式与签名（a_bogus/msToken）都很敏感，手工拼签名不可行，
 * 因此驱动真实表单：填表 → 点「立即创建」→ 监听 response 解析 book_id。
 * confirm=false 时只做频率预检 + 预览，不填表不提交。
 */
export async function createBook(opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    if (!opts.bookName?.trim())
        return { ok: false, action: "aborted", message: "缺少书名 book_name。" };
    const session = await openSession(opts.headless ?? true, "/main/writer/create");
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
    const { browser, page } = session;
    try {
        // 频率预检
        const pre = await page.evaluate(async (u) => {
            try {
                const r = await fetch(u, {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/json" },
                    body: "{}",
                });
                return await r.json();
            }
            catch (e) {
                return { error: String(e) };
            }
        }, withParams(API.bookCheckFrequency, {}));
        if (pre?.data?.hit_create_book) {
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "aborted",
                message: "预检未通过：该账号当前命中建书频率限制，请稍后再试。",
            };
        }
        const channel = opts.gender === 0 ? "女频" : "男频";
        if (!opts.confirm) {
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                message: `预检通过，未真正建书（confirm=false）。将要创建：书名《${opts.bookName}》，频道=${channel}` +
                    `，主角=${opts.protagonist1}${opts.protagonist2 ? `/${opts.protagonist2}` : ""}` +
                    `。确认无误后传 confirm=true 执行建书。`,
                url: createBookUrl(),
            };
        }
        // 填表
        await page.evaluate((p) => {
            const setVal = (el, v) => {
                if (!el)
                    return;
                const proto = el.tagName === "TEXTAREA"
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                if (setter)
                    setter.call(el, v);
                else
                    el.value = v;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            };
            setVal(document.querySelector('input[placeholder="请输入作品名称"]'), p.bookName);
            setVal(document.querySelector('input[placeholder="请输入主角名1"]'), p.protagonist1 || "");
            setVal(document.querySelector('input[placeholder="请输入主角名2"]'), p.protagonist2 || "");
            setVal(document.querySelector("textarea"), p.abstract || "");
            const target = Array.from(document.querySelectorAll("label,div,span")).find((l) => (p.gender === 0 ? /女频/ : /男频/).test(l.textContent || ""));
            const radio = target?.querySelector('input[name="pindao"]');
            if (radio)
                radio.click();
        }, {
            bookName: opts.bookName.trim(),
            protagonist1: opts.protagonist1 ?? "",
            protagonist2: opts.protagonist2 ?? "",
            abstract: opts.abstract ?? "",
            gender: opts.gender === 0 ? 0 : 1,
        });
        if ((opts.readingTags?.length || 0) > 0 || opts.contentTags) {
            const tagRes = await selectTagsOnCreatePage(page, opts.readingTags ?? [], opts.contentTags ?? {});
            logger.info(`[createBook] 标签：阅读[${tagRes.appliedReading.join(",")}] 内容[${tagRes.appliedContent.join(",")}]` +
                (tagRes.missing.length ? ` 未找到：${tagRes.missing.join("；")}` : ""));
        }
        await sleep(500);
        const screenshotPath = await shot(page, "create-book-filled").catch(() => "");
        // 点「立即创建」并从响应解析 book_id
        const bookId = await new Promise((resolve) => {
            const onResp = async (resp) => {
                const u = resp.url();
                if (u.includes(API.bookCreate) && resp.request().method() === "POST") {
                    try {
                        const j = JSON.parse(await resp.text());
                        resolve(j?.data?.book_id ? String(j.data.book_id) : null);
                    }
                    catch {
                        resolve(null);
                    }
                }
            };
            page.on("response", onResp);
            page
                .evaluate(() => {
                const btn = Array.from(document.querySelectorAll("button")).find((b) => /立即创建/.test(b.textContent || ""));
                if (btn)
                    btn.click();
            })
                .catch(() => { });
            setTimeout(() => resolve(null), 30000);
        });
        await browser.close().catch(() => { });
        if (!bookId) {
            return {
                ok: false,
                action: "error",
                message: "已提交建书请求，但未从响应解析到 book_id（可能表单校验未过或服务端未返回）。请到作者后台确认是否创建成功。",
                screenshotPath,
            };
        }
        return {
            ok: true,
            action: "created",
            message: `建书成功，番茄书 ID = ${bookId}`,
            bookId,
            url: `${authorApiBase()}/main/writer/book-manage`,
            screenshotPath,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `建书异常: ${e.message}` };
    }
}
/**
 * 查询某本书是否处于「作品信息审核中」等锁定状态（此时阅读/内容标签无法修改）。
 * 走 author API book_detail（只读 GET，免签名）。
 */
export async function getBookTagStatus(bookId) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, canModify: false, reason: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    const session = await openSession(true, "/main/writer/book-manage");
    if (isError(session))
        return { ok: false, canModify: false, reason: session.error };
    const { browser, page } = session;
    try {
        const detail = await apiGet(page, API.bookDetail, {
            book_id: bookId,
            image_fmt_list: "160x214",
        });
        if (detail?.error)
            return { ok: false, canModify: false, reason: `查询失败: ${detail.error}` };
        if (detail?.code !== undefined && detail.code !== 0) {
            return { ok: false, canModify: false, reason: `接口返回 code=${detail.code} message=${detail.message}` };
        }
        const d = detail?.data || {};
        return {
            ok: true,
            canModify: d.can_modify === true || d.can_modify === 1,
            reason: d.cannot_modify_reason || undefined,
            bookName: d.book_name,
            category: d.category,
        };
    }
    catch (e) {
        return { ok: false, canModify: false, reason: `查询异常: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
/**
 * 给「已存在」的书设置阅读/内容标签。
 * 番茄编辑作品信息受审核锁保护：若作品信息审核中（can_modify=false），直接返回 locked 并附原因，不修改。
 * confirm=true 时打开编辑页勾选并保存；编辑页 URL（/main/writer/{bookId}/edit）是尽最大努力估记，
 * 若打不开或找不到标签选择器，会返回 aborted 并提示改走人工编辑。
 */
export async function setBookTags(opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    const bookId = String(opts.bookId || "");
    if (!bookId)
        return { ok: false, action: "aborted", message: "缺少 book_id。" };
    // 先查审核锁（只读）
    const status = await getBookTagStatus(bookId);
    if (!status.ok)
        return { ok: false, action: "error", message: `查询作品状态失败：${status.reason}` };
    if (!status.canModify) {
        return {
            ok: false,
            action: "locked",
            canModify: false,
            lockReason: status.reason,
            message: `作品信息当前被锁定（${status.reason || "不可修改"}），暂无法设置标签。` +
                `通常审核通过后即可修改；或建书时用 create_novel_tomato 的 reading_tags / content_tags 直接带上。`,
        };
    }
    if (!opts.confirm) {
        return {
            ok: true,
            action: "preview",
            canModify: true,
            message: `作品《${status.bookName ?? bookId}》可修改，未真正写入（confirm=false）。` +
                `确认无误后传 confirm=true 执行（将打开编辑页勾选并保存）。`,
        };
    }
    const editPath = `/main/writer/${bookId}/edit`;
    const session = await openSession(opts.headless ?? true, editPath);
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
    const { browser, page } = session;
    try {
        const hasSelectors = await page.evaluate(() => !!document.querySelector("#selectRow .select-view") ||
            !!document.querySelector("#activitySelectRow .select-view"));
        if (!hasSelectors) {
            const screenshotPath = await shot(page, "book-edit-no-selectors").catch(() => "");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "aborted",
                message: `编辑页未如期加载标签选择器（预期 ${editPath}），可能 URL 已变或被重定向。` +
                    `请到作者后台手动编辑作品信息设置标签。`,
                url: `${authorApiBase()}${editPath}`,
                screenshotPath,
            };
        }
        const res = await selectTagsOnCreatePage(page, opts.readingTags ?? [], opts.contentTags ?? {});
        const saved = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll("button")).find((b) => /保存|确定|提交/.test(b.textContent || ""));
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });
        await sleep(2000);
        const screenshotPath = await shot(page, "book-edit-tags").catch(() => "");
        await browser.close().catch(() => { });
        return {
            ok: saved,
            action: saved ? "applied" : "error",
            message: saved
                ? `已尝试保存标签。已勾选 阅读[${res.appliedReading.join(",")}] 内容[${res.appliedContent.join(",")}]` +
                    (res.missing.length ? `；未找到：${res.missing.join("；")}` : "")
                : "已勾选标签但未找到保存按钮，请到作者后台确认是否保存成功。",
            appliedReading: res.appliedReading,
            appliedContent: res.appliedContent,
            missing: res.missing,
            url: `${authorApiBase()}${editPath}`,
            screenshotPath,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `设置标签异常: ${e.message}` };
    }
}
