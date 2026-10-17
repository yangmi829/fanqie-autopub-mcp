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
/* ------------- 作品信息页 / 修改表单 / 标签分类弹窗 的选择器与操作 ------------- */
/**
 * 实测结构（2026-10 番茄后台）：
 * - 作品信息页 type=1 → 点 `button.create-btn`（文字「修改」）展开**页面内联**的「修改作品信息」表单
 * - 表单底部按钮：取消 / 立即修改（**只有它会提交到番茄**）
 * - 标签行 `#selectRow`（阅读标签）/ `#activitySelectRow`（内容标签）→ 点开**独立分类弹窗**
 *   `.arco-modal.category-modal`：选项 `.category-choose-item`（`active`=已选），按钮 取消 / 确认
 *   —— 点选项只在弹窗内生效，必须点弹窗「确认」才落到表单行（点「取消」则丢弃）。
 * 番茄改版只需改这里。
 */
const BOOK_INFO_SELECTORS = {
    /** 「修改」按钮：展开「修改作品信息」表单 */
    editButton: "button.create-btn",
    /** 表单容器（内联，不在 modal 里） */
    form: ".serial-card.content-card-wrap, .content-card-wrap",
    /** 阅读标签行 / 内容标签行：点它打开分类弹窗 */
    readingTags: "#selectRow .select-view",
    contentTags: "#activitySelectRow .select-view",
    /** 标签分类弹窗（可能残留隐藏的同名节点，一律按「可见」筛） */
    tagModal: ".arco-modal.category-modal, .arco-modal",
    tagOption: ".category-choose-item",
    tagOptionTitle: ".category-choose-item-title",
    /** 分类弹窗的按钮（只落到表单行，≠ 提交作品信息） */
    tagModalConfirm: "确认",
    tagModalCancel: "取消",
    /** 作品信息表单的提交按钮 */
    submitText: "立即修改",
};
/**
 * 作品信息页地址。注意 type 决定子页：1=作品信息（有「修改」入口），0/3 空，2=签约。
 * 之前 set_book_tags 用的 `/main/writer/{bookId}/edit` 是错的（该路由不存在）。
 */
export function bookInfoPath(bookId) {
    return `/main/writer/book-info/${bookId}?experienceInfo=&experienceLevel=0&isNewSign=1&type=1`;
}
/** JS 点击（不做真实鼠标命中测试，避免元素被浮层遮挡时点不到） */
async function jsClick(page, sel) {
    await page.evaluate((s) => document.querySelector(s)?.click(), sel).catch(() => { });
}
/** 读取标签行上「已选中」的标签（读表单行展示区，不是弹窗） */
async function readRowTags(page, viewSel) {
    return page.evaluate((sel) => {
        const view = document.querySelector(sel);
        if (!view)
            return [];
        const visible = (e) => !!(e.offsetWidth || e.offsetHeight || (e.getClientRects && e.getClientRects().length));
        const leaves = Array.from(view.querySelectorAll("span,div,label"))
            .filter((e) => visible(e) && !(e.children && e.children.length > 0))
            .map((e) => (e.textContent || "").trim())
            .filter(Boolean);
        if (leaves.length)
            return leaves;
        const whole = (view.textContent || "").trim();
        return whole ? [whole] : [];
    }, viewSel);
}
/** 分类弹窗是否开着 */
async function tagModalOpen(page) {
    return page
        .evaluate((sel) => Array.from(document.querySelectorAll(sel)).some((e) => !!(e.offsetWidth || e.offsetHeight)), BOOK_INFO_SELECTORS.tagModal)
        .catch(() => false);
}
/** 在分类弹窗里勾选一个标签（已在 active 态的视为成功，避免手滑点成取消） */
async function clickTagOption(page, tag, label) {
    return page.evaluate((t, o) => {
        const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
        const all = Array.from(document.querySelectorAll(o.modal)).filter(vis);
        const modal = all.find((m) => ((m.querySelector(".arco-modal-title") || {}).textContent || "").trim() === o.label) || all[0];
        if (!modal)
            return false;
        const items = Array.from(modal.querySelectorAll(o.item));
        const item = items.find((x) => ((x.querySelector(o.title) || x).textContent || "").trim() === t);
        if (!item)
            return false;
        if ((item.className || "").includes("active"))
            return true;
        (item.querySelector(o.title) || item).click();
        return true;
    }, tag, {
        modal: BOOK_INFO_SELECTORS.tagModal,
        item: BOOK_INFO_SELECTORS.tagOption,
        title: BOOK_INFO_SELECTORS.tagOptionTitle,
        label,
    });
}
/** 点分类弹窗里的按钮（确认 / 取消） */
async function clickInTagModal(page, text, label) {
    return page.evaluate((t, o) => {
        const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
        const all = Array.from(document.querySelectorAll(o.modal)).filter(vis);
        const modal = all.find((m) => ((m.querySelector(".arco-modal-title") || {}).textContent || "").trim() === o.label) || all[0];
        if (!modal)
            return false;
        const btns = Array.from(modal.querySelectorAll("button"));
        const btn = btns.find((b) => (b.textContent || "").trim() === t);
        if (!btn)
            return false;
        btn.click();
        return true;
    }, text, { modal: BOOK_INFO_SELECTORS.tagModal, label });
}
/**
 * 在某个标签行上「确保这些标签处于选中」。
 * 实测机制：点标签行 → 打开独立分类弹窗（`.arco-modal.category-modal`，标题即 label）
 * → 点选项立即在弹窗内生效 → 必须点弹窗「确认」才落到表单行（点「取消」则丢弃）。
 * 注意：弹窗「确认」≠ 提交作品信息（后者是表单底部的「立即修改」）；已实测点完「确认」
 * 后不点「立即修改」，线上标签原样不变。
 */
async function pickTagsOnRow(page, rowSel, tags, label) {
    const result = { applied: [], missing: [], alreadySelected: [], selected: [] };
    if (!tags.length) {
        result.selected = await readRowTags(page, rowSel);
        return result;
    }
    const before = await readRowTags(page, rowSel);
    let opened = false;
    for (let attempt = 0; attempt < 2 && !opened; attempt++) {
        await jsClick(page, rowSel);
        // 弹窗容器一出现就有动画类，但选项是延迟渲染的 → 必须等到「标题匹配 + 选项数 > 0」
        opened = await page
            .waitForFunction((o) => {
            const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
            const all = Array.from(document.querySelectorAll(o.modal)).filter(vis);
            const m = all.find((x) => ((x.querySelector(".arco-modal-title") || {}).textContent || "").trim() === o.label) ||
                all[0];
            return !!m && m.querySelectorAll(".category-choose-item").length > 0;
        }, { timeout: 20000 }, { modal: BOOK_INFO_SELECTORS.tagModal, label })
            .then(() => true)
            .catch(() => false);
        if (!opened)
            await sleep(1500);
    }
    if (!opened) {
        result.missing = tags.map((t) => `${label}:${t}`);
        result.selected = before;
        return result;
    }
    const modalInfo = await page
        .evaluate((o) => {
        const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
        const all = Array.from(document.querySelectorAll(o.modal)).filter(vis);
        const m = all.find((x) => ((x.querySelector(".arco-modal-title") || {}).textContent || "").trim() === o.label) || all[0];
        return {
            title: (m?.querySelector(".arco-modal-title")?.textContent || "").trim(),
            optionCount: m ? m.querySelectorAll(".category-choose-item").length : 0,
            visibleModals: all.map((x) => String(x.className || "").slice(0, 60)),
        };
    }, { modal: BOOK_INFO_SELECTORS.tagModal, label })
        .catch(() => ({}));
    logger.info(`[pickTagsOnRow] ${label}：可见弹窗 ${JSON.stringify(modalInfo.visibleModals ?? [])}，标题「${modalInfo.title ?? ""}」，选项数 ${modalInfo.optionCount ?? 0}`);
    for (const t of tags) {
        if (before.includes(t)) {
            result.alreadySelected.push(`${label}:${t}`);
            continue;
        }
        if (await clickTagOption(page, t, label))
            result.applied.push(t);
        else
            result.missing.push(`${label}:${t}`);
        await sleep(300);
    }
    if (!(await clickInTagModal(page, BOOK_INFO_SELECTORS.tagModalConfirm, label))) {
        result.missing.push(`${label}:弹窗「确认」按钮`);
    }
    await page
        .waitForFunction((sel) => !Array.from(document.querySelectorAll(sel)).some((e) => !!(e.offsetWidth || e.offsetHeight)), { timeout: 12000 }, BOOK_INFO_SELECTORS.tagModal)
        .catch(() => { });
    await sleep(800);
    result.selected = await readRowTags(page, rowSel);
    return result;
}
const CONTENT_TAG_ORDER = ["plot", "emotion", "character", "worldview"];
/** 把 4 组内容标签摊平成一串（固定顺序，便于复现） */
function flattenContentTags(tags = {}) {
    return CONTENT_TAG_ORDER.flatMap((k) => tags[k] ?? []);
}
/**
 * 展开「修改作品信息」表单：轮询点「修改」按钮，直到标签行（表单标志）出现。
 * 该表单是页面内联的，不是 modal。
 */
async function openBookInfoForm(page) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const clicked = await page
            .evaluate((sel) => {
            const b = document.querySelector(sel);
            if (!b)
                return false;
            b.click();
            return true;
        }, BOOK_INFO_SELECTORS.editButton)
            .catch(() => false);
        if (clicked) {
            const opened = await page
                .waitForFunction((s) => !!(document.querySelector(s.reading) || document.querySelector(s.content)), { timeout: 20000 }, { reading: BOOK_INFO_SELECTORS.readingTags, content: BOOK_INFO_SELECTORS.contentTags })
                .then(() => true)
                .catch(() => false);
            if (opened)
                return { ok: true };
        }
        await sleep(1500);
    }
    return { ok: false, reason: `未找到「修改」按钮（${BOOK_INFO_SELECTORS.editButton}）或修改表单未出现` };
}
/** 填作品信息表单里的文本字段（只填显式传入的；按 placeholder 关键字定位，兼顾 input/textarea） */
async function fillBookInfoFields(page, v) {
    return page.evaluate((p, formSel) => {
        const setVal = (el, val) => {
            const proto = el.tagName === "TEXTAREA"
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter)
                setter.call(el, val);
            else
                el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const scope = document.querySelector(formSel) || document;
        const pick = (needle) => Array.from(scope.querySelectorAll("input,textarea")).find((e) => ((e.getAttribute("placeholder") || "").includes(needle)) && !!(e.offsetWidth || e.offsetHeight));
        const filled = [];
        const put = (needle, val, label) => {
            if (val === undefined || val === null || val === "")
                return;
            const el = pick(needle);
            if (!el)
                return;
            setVal(el, val);
            filled.push(label);
        };
        put("作品名称", p.title, "作品名称");
        put("主角名1", p.protagonist1, "主角名1");
        put("主角名2", p.protagonist2, "主角名2");
        put("简介", p.abstract, "作品简介");
        return filled;
    }, v, BOOK_INFO_SELECTORS.form);
}
/** 在作品信息表单里按精确文本点按钮（如「立即修改」/「取消」）；仅在可见表单内找 */
async function clickFormButtonByText(page, text) {
    return page.evaluate((t, formSel) => {
        const scope = document.querySelector(formSel) || document;
        const btn = Array.from(scope.querySelectorAll("button,span,a")).find((b) => (b.textContent || "").trim() === t && !!(b.offsetWidth || b.offsetHeight));
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    }, text, BOOK_INFO_SELECTORS.form);
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
            // 建书页与作品信息页共用同一套标签分类弹窗（.category-modal），因此复用同一逻辑
            const readingPick = await pickTagsOnRow(page, BOOK_INFO_SELECTORS.readingTags, opts.readingTags ?? [], "阅读标签");
            const contentPick = await pickTagsOnRow(page, BOOK_INFO_SELECTORS.contentTags, flattenContentTags(opts.contentTags), "内容标签");
            const miss = [...readingPick.missing, ...contentPick.missing];
            logger.info(`[createBook] 标签：阅读[${readingPick.applied.join(",")}] 内容[${contentPick.applied.join(",")}]` +
                `；回读 阅读[${readingPick.selected.join(",")}] 内容[${contentPick.selected.join(",")}]` +
                (miss.length ? `；未找到：${miss.join("；")}` : ""));
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
function hasAnyTag(readingTags, contentTags) {
    return (readingTags?.length ?? 0) > 0 || Object.values(contentTags ?? {}).some((v) => (v?.length ?? 0) > 0);
}
/**
 * 修改番茄「作品信息」：书名 / 主角名1、2 / 作品简介 / 阅读标签 / 内容标签。
 * 入口是作品信息页（type=1）→ 点「修改」→「修改作品信息」弹窗，提交按钮为「立即修改」。
 * 受作品信息审核锁保护：can_modify=false 直接返回 locked，不做任何改动。
 * confirm=false 只打开弹窗填表 + 截图（不提交）；confirm=true 才点「立即修改」。
 * ⚠️ 改动书名/简介可能触发重新审核，影响曝光。
 */
export async function updateBookInfo(opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    const bookId = String(opts.bookId || "");
    if (!bookId)
        return { ok: false, action: "aborted", message: "缺少 book_id。" };
    const wantTags = hasAnyTag(opts.readingTags, opts.contentTags);
    const wantFields = [opts.title, opts.protagonist1, opts.protagonist2, opts.abstract].some((v) => v !== undefined && v !== "");
    if (!wantFields && !wantTags) {
        return { ok: false, action: "aborted", message: "至少要提供一个要修改的字段（书名/主角名/简介/标签）。" };
    }
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
            message: `作品信息当前被锁定（${status.reason || "不可修改"}），暂无法修改。` +
                `通常审核通过后即可修改；或建书时用 create_novel_tomato 的 reading_tags / content_tags 直接带上。`,
        };
    }
    const path = bookInfoPath(bookId);
    const url = `${authorApiBase()}${path}`;
    const session = await openSession(opts.headless ?? true, path);
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
    const { browser, page } = session;
    try {
        const form = await openBookInfoForm(page);
        if (!form.ok) {
            const screenshotPath = await shot(page, "book-info-form-missing").catch(() => "");
            await browser.close().catch(() => { });
            return {
                ok: false,
                action: "aborted",
                message: `${form.reason}。请到作者后台手动修改作品信息。`,
                url,
                screenshotPath,
            };
        }
        const filled = await fillBookInfoFields(page, {
            title: opts.title,
            protagonist1: opts.protagonist1,
            protagonist2: opts.protagonist2,
            abstract: opts.abstract,
        });
        const readingPick = wantTags
            ? await pickTagsOnRow(page, BOOK_INFO_SELECTORS.readingTags, opts.readingTags ?? [], "阅读标签")
            : { applied: [], missing: [], alreadySelected: [], selected: await readRowTags(page, BOOK_INFO_SELECTORS.readingTags) };
        const contentPick = wantTags
            ? await pickTagsOnRow(page, BOOK_INFO_SELECTORS.contentTags, flattenContentTags(opts.contentTags), "内容标签")
            : {
                applied: [],
                missing: [],
                alreadySelected: [],
                selected: await readRowTags(page, BOOK_INFO_SELECTORS.contentTags),
            };
        const appliedReading = readingPick.applied;
        const appliedContent = contentPick.applied;
        const alreadySelected = [...readingPick.alreadySelected, ...contentPick.alreadySelected];
        const missing = [...readingPick.missing, ...contentPick.missing];
        const selectedReading = readingPick.selected;
        const selectedContent = contentPick.selected;
        const tagSummary = wantTags
            ? `；新勾选 阅读[${appliedReading.join(",") || "无"}] 内容[${appliedContent.join(",") || "无"}]` +
                `；回读 阅读[${selectedReading.join(",")}] 内容[${selectedContent.join(",")}]`
            : "";
        const skipSummary = alreadySelected.length ? `；本来已选（跳过）${alreadySelected.join("、")}` : "";
        const missSummary = missing.length ? `；未找到 ${missing.join("；")}` : "";
        if (!opts.confirm) {
            const screenshotPath = await shot(page, "book-info-preview").catch(() => "");
            await browser.close().catch(() => { });
            return {
                ok: true,
                action: "preview",
                canModify: true,
                message: `已展开《${status.bookName ?? bookId}》的「修改作品信息」表单，填入 ${filled.join("/") || "（无文本字段）"}${tagSummary}${skipSummary}${missSummary}。` +
                    `未提交（confirm=false）；确认后传 confirm=true 才会点「立即修改」。` +
                    `（注：标签行的分类弹窗「确认」只落到表单，不等于提交。）`,
                filled,
                appliedReading,
                appliedContent,
                missing: missing.length ? missing : undefined,
                alreadySelected: alreadySelected.length ? alreadySelected : undefined,
                selectedReading,
                selectedContent,
                url,
                screenshotPath,
            };
        }
        const submitted = await clickFormButtonByText(page, BOOK_INFO_SELECTORS.submitText);
        await sleep(2500);
        const screenshotPath = await shot(page, "book-info-submitted").catch(() => "");
        await browser.close().catch(() => { });
        return {
            ok: submitted,
            action: submitted ? "applied" : "error",
            message: submitted
                ? `已提交作品信息修改：${filled.join("/") || "（无文本字段）"}${tagSummary}${skipSummary}${missSummary}。改动可能需要重新审核。`
                : "已填表但未找到「立即修改」按钮，请到作者后台确认是否保存成功。",
            filled,
            appliedReading,
            appliedContent,
            missing: missing.length ? missing : undefined,
            alreadySelected: alreadySelected.length ? alreadySelected : undefined,
            selectedReading,
            selectedContent,
            url,
            screenshotPath,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, action: "error", message: `修改作品信息异常: ${e.message}`, url };
    }
}
/** `set_book_tags` 的实现：只改标签（复用 updateBookInfo 的弹窗链路） */
export async function setBookTags(opts) {
    if (!hasAnyTag(opts.readingTags, opts.contentTags)) {
        return { ok: false, action: "aborted", message: "请至少提供 reading_tags 或 content_tags。" };
    }
    const r = await updateBookInfo({
        bookId: opts.bookId,
        readingTags: opts.readingTags,
        contentTags: opts.contentTags,
        confirm: opts.confirm,
        headless: opts.headless,
    });
    return {
        ok: r.ok,
        action: r.action,
        message: r.message,
        canModify: r.canModify,
        lockReason: r.lockReason,
        appliedReading: r.appliedReading,
        appliedContent: r.appliedContent,
        missing: r.missing,
        alreadySelected: r.alreadySelected,
        selectedReading: r.selectedReading,
        selectedContent: r.selectedContent,
        url: r.url,
        screenshotPath: r.screenshotPath,
    };
}
