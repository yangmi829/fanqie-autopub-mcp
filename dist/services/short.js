import fs from "node:fs";
import { sleep, shot } from "../browser/driver.js";
import { automationReadiness } from "./auth.js";
import { openSession, isError, apiGet, API, authorApiBase, shortPublishUrl } from "../browser/endpoints.js";
import { toPlainText, countCjk } from "../core/text.js";
import { logger } from "../core/logger.js";
/** 短故事官方字数区间：6000–80000 字（最佳 1w–3w） */
export const SHORT_MIN_WORDS = 6000;
export const SHORT_MAX_WORDS = 80000;
function mapShortItem(s) {
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
export async function listShortStories(opts = {}) {
    const readiness = automationReadiness();
    if (!readiness.ready)
        return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
    if (isError(session))
        return { ok: false, message: session.error };
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
        await browser.close().catch(() => { });
        if (data?.code !== 0)
            return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
        const raw = data?.data?.item_list ?? data?.data?.list ?? [];
        const stories = raw.map(mapShortItem);
        const total = Number(data?.data?.total_count ?? stories.length);
        return {
            ok: true,
            message: `共 ${total} 条${opts.status === "draft" ? "草稿" : "短故事"}`,
            stories,
            total,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, message: `读取短故事列表失败: ${e.message}` };
    }
}
/** 读短故事详情（edit/v1）。返回正文全文与作品信息。 */
export async function getShortStory(itemId, opts = {}) {
    const readiness = automationReadiness();
    if (!readiness.ready)
        return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    if (!itemId)
        return { ok: false, message: "缺少 item_id。" };
    const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
    if (isError(session))
        return { ok: false, message: session.error };
    const { browser, page } = session;
    try {
        const data = await apiGet(page, API.shortArticleEditV1, { item_id: itemId, image_fmt_list: "270x480" });
        await browser.close().catch(() => { });
        if (data?.code !== 0)
            return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
        const d = data?.data ?? {};
        // 实测 edit/v1 在部分账号下会把 item_id 回成 "0"（真值来自请求参数）→ 别把 "0" 当结果返回
        const apiItemId = String(d.item_id ?? "");
        const resolvedItemId = apiItemId && apiItemId !== "0" ? apiItemId : itemId;
        return {
            ok: true,
            message: `读取成功：《${d.multi_title ?? ""}》${d.word_number ?? 0} 字`,
            story: {
                itemId: resolvedItemId,
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
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, message: `读取短故事详情失败: ${e.message}` };
    }
}
/** 读作品分类表（只读）。 */
export async function listShortCategories(opts = {}) {
    const readiness = automationReadiness();
    if (!readiness.ready)
        return { ok: false, message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    const session = await openSession(opts.headless ?? true, "/main/writer/short-manage");
    if (isError(session))
        return { ok: false, message: session.error };
    const { browser, page } = session;
    try {
        const data = await apiGet(page, API.shortArticleCategoryV1, {});
        await browser.close().catch(() => { });
        if (data?.code !== 0)
            return { ok: false, message: `接口返回 code=${data?.code} message=${data?.message}` };
        const categories = (data?.data?.category_list ?? []).map((c) => ({
            categoryId: Number(c.category_id),
            name: String(c.name ?? ""),
            label: c.label,
        }));
        return { ok: true, message: `共 ${categories.length} 个分类`, categories };
    }
    catch (e) {
        await browser.close().catch(() => { });
        return { ok: false, message: `读取分类失败: ${e.message}` };
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
};
/**
 * 「下一步」发布链路的门 & 弹窗选择器（2026-10 逆向 `PublishShort.*.js` 的 `handleClickPublish` + 真机实测）。
 *
 * `下一步`（`data-apm-action="core_chain_short_story_next_confirm"`）被点后的校验顺序：
 * 标题（空格/空/超长/查重）→ 字数（100–100000）→ 推荐标题 → **封面** → 分类（含主分类、≤8）
 * → **试读比例**（≥30% 且校验通过）→ **发布协议**（已勾选）→ 审核不通过内容 → **是否使用AI**
 * → 章节格式/错别字（弹「发布提示」→「继续发布」）→ 「提交确认」→ 点「确定」= 真发布。
 *
 * 任一必填项缺失时只弹一个 **3 秒就消失的 toast**（`请上传封面` / `请选择是否使用 AI` / …），
 * 所以「点了下一步没反应」几乎都是这些门没补齐——不要按「按钮坏了」处理。
 */
export const SHORT_PUBLISH_SELECTORS = {
    /** 封面设置区（点它开「制作封面 / 本地上传」抽屉） */
    coverTrigger: '[class*="publish-short-config-book-cover-content"]',
    /** 封面已设置（未设置时该 class 不存在） */
    coverSet: '[class*="publish-short-config-book-cover-content-notempty"]',
    /** 抽屉里的 tab：⚠️ 不是 .arco-tabs-tab，实测是 div[role="tab"].arco-tabs-header-title */
    drawerTab: '[role="tab"]',
    /** 试读比例「去设置」（点它会在正文里落一条默认 30% 试读线） */
    paySetup: ".publish-short-config-pay-location-noicon",
    /** 是否使用AI 单选组容器 */
    useAi: '[class*="publish_short_config_use_ai"]',
    /** 发布协议文字（必须真实鼠标点击，会弹「短故事发布事项」） */
    licenseDesc: ".publish-short-config-checkdesc",
};
/**
 * 作品分类选择器（2026-10 实测二级浮层）：
 * 点 `.publish-short-category-select` 打开 `.publish-short-category-select-pop`；
 * 左侧 5 个组标题 `.publish-short-category-select-label`（主分类/情节/角色/情绪/背景），
 * 右侧 5 个 `.publish-short-category-select-item-list`（与组**同序**渲染，但只有激活组可见），
 * 组内选项 `.publish-short-category-select-item`（文本即分类名）。
 */
export const SHORT_CATEGORY_SELECTORS = {
    trigger: ".publish-short-category-select",
    pop: ".publish-short-category-select-pop",
    label: ".publish-short-category-select-label",
    itemList: ".publish-short-category-select-item-list",
    item: ".publish-short-category-select-item",
    selectedList: ".publish-short-category-select-selected-list",
};
async function firstMatch(page, selectors) {
    for (const sel of selectors) {
        try {
            if (await page.$(sel))
                return sel;
        }
        catch {
            // 个别选择器在部分 puppeteer 版本不被支持，跳过
        }
    }
    return null;
}
/** 在已打开页面里提取当前短故事 item_id（从 URL /publish-short/{id} 解析） */
export async function currentShortItemId(page) {
    const m = String(page.url()).match(/publish-short\/(\d+)/);
    return m ? m[1] : null;
}
/** 等待页面从空白编辑页重定向到 /publish-short/{item_id}（番茄自动建草稿） */
async function waitForItemId(page, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const id = await currentShortItemId(page);
        if (id)
            return id;
        await sleep(700);
    }
    return await currentShortItemId(page);
}
/** 填标题（TEXTAREA 原生 setter） */
async function fillTitle(page, sel, title) {
    await page.click(sel, { clickCount: 3 }).catch(() => { });
    await page.evaluate((s, v) => {
        const el = document.querySelector(s);
        if (!el)
            return;
        const proto = window.HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter)
            setter.call(el, v);
        else
            el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
    }, sel, title);
}
/**
 * 填正文。短故事正文同样是 ProseMirror：
 * 空段用 insertParagraph 分段，段内换行用 insertLineBreak，字符用 insertText。
 */
async function fillBody(page, sel, text) {
    await page.click(sel, { clickCount: 2 }).catch(() => { });
    await page.evaluate((s, value) => {
        const el = document.querySelector(s);
        if (!el)
            return;
        el.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        const paras = value
            .split(/\n{2,}/)
            .map((p) => p.trim())
            .filter(Boolean);
        let first = true;
        for (const p of paras) {
            if (!first)
                document.execCommand("insertParagraph", false, null);
            const lines = p.split(/\n/);
            lines.forEach((line, i) => {
                if (i > 0)
                    document.execCommand("insertLineBreak", false, null);
                document.execCommand("insertText", false, line);
            });
            first = false;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }, sel, text);
}
/** 点页面上第一个「可见且文本等于 label」的按钮（真实鼠标点击，SPA 依赖真实事件） */
async function clickButtonByText(page, label) {
    const found = await page
        .evaluate((t) => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.offsetParent !== null && (b.textContent || "").trim() === t);
        if (!btn)
            return false;
        btn.setAttribute("data-autopub-target", "1");
        return true;
    }, label)
        .catch(() => false);
    if (!found)
        return false;
    await page.click('[data-autopub-target="1"]').catch(() => { });
    await page
        .evaluate(() => document.querySelector('[data-autopub-target="1"]')?.removeAttribute("data-autopub-target"))
        .catch(() => { });
    return true;
}
/**
 * 选「是否使用AI」单选（发布必填项；不选则「下一步」弹「请选择是否使用 AI」并中止）。
 * 实测：容器 class 含 `publish_short_config_use_ai`，里面是 `label.arco-radio` 的「是 / 否」。
 */
async function chooseUseAI(page, useAI) {
    const label = useAI ? "是" : "否";
    const clicked = await page
        .evaluate((t, sel) => {
        const boxes = Array.from(document.querySelectorAll(sel));
        const box = boxes.find((b) => b.querySelectorAll("label").length > 0);
        if (!box)
            return false;
        const lab = Array.from(box.querySelectorAll("label")).find((l) => (l.textContent || "").trim() === t);
        if (!lab)
            return false;
        const input = lab.querySelector('input[type="radio"]');
        if (input)
            input.click();
        lab.click();
        return true;
    }, label, SHORT_PUBLISH_SELECTORS.useAi)
        .catch(() => false);
    if (!clicked)
        return false;
    await sleep(600);
    return page
        .evaluate((sel) => {
        const box = document.querySelector(sel);
        if (!box)
            return false;
        return Array.from(box.querySelectorAll("label.arco-radio")).some((l) => l.querySelector("input")?.checked);
    }, SHORT_PUBLISH_SELECTORS.useAi)
        .catch(() => false);
}
/**
 * 选作品分类（主分类必选，最多 8 个）。
 * 实测（2026-10）：不是「点标签」，而是**二级浮层**——必须先点开浮层，
 * 再按分类名反查它在第几组（组与选项列表同序），**激活该组**，最后点该组内的选项。
 * 返回实际选中 / 未找到（以浮层里的已选列表回读为准）。
 */
async function selectCategories(page, names) {
    const applied = [];
    const missing = [];
    if (!names.length)
        return { applied, missing };
    const S = SHORT_CATEGORY_SELECTORS;
    // 1) 打开浮层（选项是点开后才渲染的）
    const ensurePop = async () => {
        if (await page.$(S.pop))
            return true;
        await page.click(S.trigger).catch(() => { });
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            if (await page.$(S.pop))
                return true;
            await sleep(300);
        }
        return false;
    };
    if (!(await ensurePop())) {
        logger.warn("[selectCategories] 未能打开作品分类浮层");
        return { applied, missing: [...names] };
    }
    for (const name of names) {
        // 实测：每选一个，浮层会收起 → 下一个分类前必须重新打开
        if (!(await ensurePop())) {
            missing.push(name);
            continue;
        }
        // 2) 找该分类所在组的序号（5 组全量渲染，但只有激活组可见）
        const groupIdx = await page
            .evaluate((t, s) => {
            const lists = Array.from(document.querySelectorAll(s.itemList));
            for (let i = 0; i < lists.length; i++) {
                const hit = Array.from(lists[i].querySelectorAll(s.item)).some((e) => (e.textContent || "").trim() === t);
                if (hit)
                    return i;
            }
            return -1;
        }, name, S)
            .catch(() => -1);
        if (groupIdx < 0) {
            missing.push(name);
            continue;
        }
        // 3) 激活该组（真实鼠标事件——arco 的组切换对 JS click 不敏感，必须 hover）
        const labeled = await page
            .evaluate((i, s) => {
            const labels = document.querySelectorAll(s.label);
            const lab = labels[i];
            if (!lab)
                return false;
            lab.setAttribute("data-autopub-catlabel", "1");
            return true;
        }, groupIdx, S)
            .catch(() => false);
        if (!labeled) {
            missing.push(name);
            continue;
        }
        await page.hover('[data-autopub-catlabel="1"]').catch(() => { });
        await sleep(250);
        await page.click('[data-autopub-catlabel="1"]').catch(() => { });
        await page
            .evaluate(() => document.querySelector('[data-autopub-catlabel="1"]')?.removeAttribute("data-autopub-catlabel"))
            .catch(() => { });
        await sleep(500);
        // 4) 点该组内的选项（真实鼠标点击，SPA 依赖真实事件）；组未切过来（不可见）则再等一拍
        const findItem = () => page
            .evaluate((t, s, i) => {
            const lists = document.querySelectorAll(s.itemList);
            const list = lists[i];
            if (!list)
                return false;
            const el = Array.from(list.querySelectorAll(s.item)).find((e) => (e.textContent || "").trim() === t);
            if (!el || el.offsetParent === null)
                return false;
            el.setAttribute("data-autopub-cat", "1");
            return true;
        }, name, S, groupIdx)
            .catch(() => false);
        let ready = await findItem();
        if (!ready) {
            await sleep(700);
            ready = await findItem();
        }
        if (!ready) {
            logger.warn(`[selectCategories] 组 #${groupIdx} 内未找到可见选项「${name}」`);
            missing.push(name);
            continue;
        }
        await page.click('[data-autopub-cat="1"]').catch(() => { });
        await page
            .evaluate(() => document.querySelector('[data-autopub-cat="1"]')?.removeAttribute("data-autopub-cat"))
            .catch(() => { });
        await sleep(400);
    }
    // 5) 回读浮层里的已选列表（真实结果），并收起浮层
    const selectedText = await page
        .evaluate((s) => (document.querySelector(s.selectedList)?.textContent || "").trim(), S)
        .catch(() => "");
    await page.keyboard.press("Escape").catch(() => { });
    await sleep(300);
    for (const name of names) {
        if (selectedText.includes(name))
            applied.push(name);
        else
            missing.push(name);
    }
    if (applied.length)
        logger.info(`[selectCategories] 已选分类：${applied.join("、")}`);
    if (missing.length)
        logger.warn(`[selectCategories] 未选中：${missing.join("、")}（已选列表=${selectedText}）`);
    return { applied, missing };
}
/** 短故事写操作的前置校验（字数与外部依赖） */
export function validateShortContent(content) {
    const plain = toPlainText(content || "");
    const wordCount = countCjk(plain);
    const warnings = [];
    if (plain.length === 0)
        warnings.push("未提供正文（仅保存作品外壳/标题）。");
    else if (wordCount < SHORT_MIN_WORDS) {
        warnings.push(`正文字数 ${wordCount} 低于短故事下限 ${SHORT_MIN_WORDS}，可存草稿但发布会被拦截。`);
    }
    else if (wordCount > SHORT_MAX_WORDS) {
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
export async function createShortStory(opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    if (!opts.title?.trim())
        return { ok: false, action: "aborted", message: "缺少短故事名称 title。" };
    const { wordCount, warnings } = validateShortContent(opts.content ?? "");
    const session = await openSession(opts.headless ?? true, "/main/writer/publish-short/?enter_from=NEWCHAPTER_1");
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
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
        if (typeof opts.useAI === "boolean")
            await chooseUseAI(page, opts.useAI);
        if (opts.categories?.length) {
            const cat = await selectCategories(page, opts.categories);
            if (cat.missing.length)
                warnings.push(`未找到分类：${cat.missing.join("、")}`);
            if (cat.applied.length)
                logger.info(`[createShortStory] 已选分类：${cat.applied.join("、")}`);
        }
        if (opts.coverPath) {
            const okCover = await uploadCover(page, opts.coverPath);
            if (!okCover)
                warnings.push("封面文件未能上传（未找到上传入口或格式不支持）。");
        }
        await sleep(500);
        if (!opts.confirm) {
            const file = await shot(page, "short-filled");
            return {
                ok: true,
                action: "filled-not-submitted",
                message: `已建草稿 item_id=${itemId} 并填入名称/正文（未点存草稿，confirm=false）。` +
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
        const verify = await verifyDraft(page, itemId);
        return {
            ok: true,
            action: "draft-saved",
            message: `已保存短故事草稿 item_id=${itemId}${verify.saved ? "（已复核标题已落库）" : "（未能在详情接口复核到标题，请到草稿箱确认）"}，` +
                `正文字数≈${wordCount}。`,
            itemId,
            wordCount,
            url: page.url(),
            screenshotPath: file,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        logger.error(`新建短故事异常: ${e.message}`);
        return { ok: false, action: "error", message: `新建短故事失败: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
/**
 * 修改「已存在」的短故事（标题 / 正文 / 分类 / 封面 / 是否AI）：打开 /publish-short/{item_id} 编辑页。
 * 只覆盖**显式传入**的字段，未传的保持线上原值。
 * - confirm=false：只打开编辑页**读现状 + 截图，完全不填充**（保守：该编辑器可能存在自动保存副作用）。
 * - confirm=true：填入显式传入的字段 → 点「存草稿」（**只存草稿，不发布**）。
 * ⚠️ 已发布的短故事可能不允许再次修改（以页面/后台为准）；要重新发布请用 publishShortStory。
 */
export async function updateShortStory(opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    if (!opts.itemId)
        return { ok: false, action: "aborted", message: "缺少 item_id。" };
    const hasField = [opts.title, opts.content].some((v) => v !== undefined && v.trim() !== "") ||
        (opts.categories?.length ?? 0) > 0 ||
        !!opts.coverPath ||
        typeof opts.useAI === "boolean";
    // confirm=false 允许不带任何字段（纯探现状）；confirm=true 必须给至少一个要改的字段
    if (opts.confirm && !hasField) {
        return {
            ok: false,
            action: "aborted",
            message: "至少要提供一个要修改的字段（title / content / categories / cover_path / use_ai）。",
        };
    }
    // 只对「显式传入的正文」做字数校验；纯探现状（不带正文）不产生误导性告警
    const { wordCount, warnings } = opts.content
        ? validateShortContent(opts.content)
        : { wordCount: 0, warnings: [] };
    const session = await openSession(opts.headless ?? true, shortPublishUrl(opts.itemId));
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
    const { browser, page } = session;
    try {
        const titleSel = await firstMatch(page, SHORT_SELECTORS.title);
        if (!titleSel) {
            const file = await shot(page, "short-update-editor-missing");
            return {
                ok: false,
                action: "aborted",
                message: `未找到短故事编辑页（item_id=${opts.itemId} 可能不存在、或该作品已发布不可编辑）。`,
                itemId: opts.itemId,
                url: page.url(),
                screenshotPath: file,
            };
        }
        await sleep(800);
        // 预览：只读现状，不填充
        if (!opts.confirm) {
            const snap = await readShortInPage(page, opts.itemId);
            const file = await shot(page, "short-update-preview");
            return {
                ok: true,
                action: "filled-not-submitted",
                message: `已打开 item_id=${opts.itemId} 的编辑页读现状（confirm=false，**未做任何填充**）：` +
                    `当前标题《${snap.title}》，正文≈${snap.wordNumber} 字。确认后传 confirm=true 保存修改（只存草稿，不发布）。`,
                itemId: opts.itemId,
                wordCount: snap.wordNumber,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // 只覆盖显式传入的字段
        if (opts.title?.trim())
            await fillTitle(page, titleSel, opts.title.trim());
        if (opts.content) {
            const bodySel = await firstMatch(page, SHORT_SELECTORS.body);
            if (!bodySel)
                warnings.push("未找到正文编辑区，正文未改动。");
            else
                await fillBody(page, bodySel, toPlainText(opts.content));
        }
        await sleep(800);
        if (typeof opts.useAI === "boolean")
            await chooseUseAI(page, opts.useAI);
        if (opts.categories?.length) {
            const cat = await selectCategories(page, opts.categories);
            if (cat.missing.length)
                warnings.push(`未找到分类：${cat.missing.join("、")}`);
            if (cat.applied.length)
                logger.info(`[updateShortStory] 已选分类：${cat.applied.join("、")}`);
        }
        if (opts.coverPath && !(await uploadCover(page, opts.coverPath))) {
            warnings.push("封面文件未能上传（未找到上传入口或格式不支持）。");
        }
        const saved = await saveDraft(page);
        const file = await shot(page, saved ? "short-update-saved" : "short-update-save-failed");
        if (!saved) {
            return {
                ok: false,
                action: "error",
                message: "未能点到「存草稿」按钮（可能页面结构变化或该作品不可编辑）。请到作者后台核对。",
                itemId: opts.itemId,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        await sleep(1500);
        const snap = await readShortInPage(page, opts.itemId);
        return {
            ok: true,
            action: "updated",
            message: `已保存 item_id=${opts.itemId} 的修改（**只存草稿，未发布**）。` +
                `当前标题《${snap.title}》，正文≈${snap.wordNumber} 字（传入正文≈${wordCount} 字）。` +
                `⚠️ 若该短故事已发布，改动可能需要重新审核；要发布请用 publish_short_story_tomato。`,
            itemId: opts.itemId,
            wordCount: snap.wordNumber,
            url: page.url(),
            screenshotPath: file,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        logger.error(`修改短故事异常: ${e.message}`);
        return { ok: false, action: "error", message: `修改短故事失败: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
/**
 * JS 点击按钮（按文本）。实测：封面抽屉关掉后会留一层遮罩，**真实鼠标点击会被它吃掉**，
 * 而 `element.click()` 不受影响 → 发布链路里凡是在封面之后的按钮一律走这里。
 */
async function jsClickButton(page, label) {
    return page
        .evaluate((t) => {
        const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === t && x.getBoundingClientRect().height >= 0);
        if (!b)
            return false;
        b.scrollIntoView({ block: "center" });
        b.click();
        return true;
    }, label)
        .catch(() => false);
}
/** 轮询 cond 直到返回真值（或超时）；用于一切「等元素出现」的场景 */ async function waitFor(cond, timeoutMs = 15000, stepMs = 800) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const v = await cond().catch(() => null);
        if (v)
            return v;
        await sleep(stepMs);
    }
    return null;
}
/** 读当前页面上的 toast（`te.A.warning` 类提示 3 秒后自动消失，必须及时抓） */
async function readToasts(page) {
    return page
        .evaluate(() => Array.from(document.querySelectorAll('[class*="arco-message"], [class*="arco-alert"]'))
        .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100))
        .filter(Boolean))
        .catch(() => []);
}
/**
 * 勾「发布协议」——「下一步」的硬门之一（`if (!S) { 高亮 signLicense; return }`）。
 *
 * 实测（2026-10）：这个复选框是自绘组件，JS click（input / label / mask）**点不上**；
 * 唯一有效路径是**真实鼠标点击协议文字** `.publish-short-config-checkdesc`
 * → 弹「短故事发布事项」→ 点其中「我已阅读并同意」→ 复选框才变 checked。
 *
 * ⚠️ 必须排在**打开封面抽屉之前**：抽屉关闭后残留的遮罩会吃掉后续所有真实鼠标点击
 * （JS click 不受影响，所以其它步骤看起来都正常）。
 */
async function acceptPublishTerms(page) {
    const isChecked = () => page.evaluate(() => !!document.querySelector("label.arco-checkbox input")?.checked).catch(() => false);
    if (await isChecked())
        return true;
    for (let attempt = 1; attempt <= 3; attempt++) {
        await page.click(SHORT_PUBLISH_SELECTORS.licenseDesc).catch(() => { });
        await waitFor(() => page.evaluate(() => {
            const b = Array.from(document.querySelectorAll("button")).find((x) => /我已阅读并同意/.test(x.textContent || "") && x.getBoundingClientRect().height > 0);
            if (!b)
                return false;
            b.click();
            return true;
        }), 8000, 600);
        await sleep(1200);
        if (await isChecked())
            return true;
        logger.warn(`[short] 第 ${attempt} 次勾「发布协议」未生效`);
    }
    return false;
}
/**
 * 设置「试读比例」——「下一步」的硬门之一（`payNode` 为空 / 阈值非法都会拦）。
 * 实测：点「去设置」会在正文里落一条默认 **30%** 试读线（`window.adapter.getExistNodes("payNode")` 立刻变 1）；
 * 该试读线**不会**随「存草稿」持久化，所以每次发布前都要现点一次。
 */
async function ensurePayNode(page) {
    const hasNode = () => page
        .evaluate(() => {
        try {
            return window.adapter.getExistNodes("payNode").length > 0;
        }
        catch {
            return false;
        }
    })
        .catch(() => false);
    if (await hasNode())
        return true;
    await clickButtonByText(page, "去设置");
    return !!(await waitFor(hasNode, 15000, 800));
}
/** 封面是否已设置（封面设置区带 -notempty class） */
async function coverIsSet(page) {
    return page.evaluate((sel) => !!document.querySelector(sel), SHORT_PUBLISH_SELECTORS.coverSet).catch(() => false);
}
/** 读「下一步」的四个必填门：封面 / 是否使用AI / 发布协议 / 试读比例 */
async function readPublishGates(page) {
    return page
        .evaluate((sel) => {
        const box = document.querySelector(sel.useAi);
        let payNode = false;
        try {
            payNode = window.adapter.getExistNodes("payNode").length > 0;
        }
        catch {
            payNode = false;
        }
        return {
            cover: !!document.querySelector(sel.coverSet),
            useAI: !!(box && Array.from(box.querySelectorAll("label.arco-radio")).some((l) => l.querySelector("input")?.checked)),
            license: !!document.querySelector("label.arco-checkbox input")?.checked,
            payNode,
        };
    }, { coverSet: SHORT_PUBLISH_SELECTORS.coverSet, useAi: SHORT_PUBLISH_SELECTORS.useAi })
        .catch(() => ({ cover: false, useAI: false, license: false, payNode: false }));
}
/** 点「提交确认」弹窗页脚的主按钮（确定）——这一步才真正提交发布 */
async function clickConfirmModalOk(page) {
    return !!(await waitFor(() => page.evaluate(() => {
        const m = Array.from(document.querySelectorAll(".arco-modal")).find((x) => x.getBoundingClientRect().height > 40 && /提交确认/.test(x.textContent || ""));
        if (!m)
            return false;
        const visible = (bs) => bs.filter((b) => b.getBoundingClientRect().height > 0);
        const footer = visible(Array.from(m.querySelectorAll(".arco-modal-footer button")));
        const pool = footer.length ? footer : visible(Array.from(m.querySelectorAll("button")));
        const ok = pool.find((b) => /确定|确认|提交|发布/.test(b.textContent || "")) || pool[pool.length - 1];
        if (!ok)
            return false;
        ok.click();
        return true;
    }), 20000, 1200));
}
/** 点「存草稿」，等待其发出 cover/v0 请求并返回是否成功 */
async function saveDraft(page) {
    const saveSel = await firstMatch(page, SHORT_SELECTORS.saveDraft);
    const done = new Promise((resolve) => {
        const onResp = async (resp) => {
            if (resp.url().includes(API.shortArticleCover) && resp.request().method() === "POST") {
                try {
                    const j = JSON.parse(await resp.text());
                    resolve(j?.code === 0);
                }
                catch {
                    resolve(true);
                }
            }
        };
        page.on("response", onResp);
        setTimeout(() => resolve(false), 20000);
    });
    if (saveSel)
        await page
            .evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.scrollIntoView({ block: "center" });
                el.click();
                return true;
            }
            return false;
        }, saveSel)
            .catch(() => { });
    else
        await jsClickButton(page, "存草稿");
    const ok = await done;
    await sleep(1000);
    return ok;
}
/** 在编辑页内读线上现状（标题 / 字数 / 发布状态 / 封面）；只读，不填充任何内容 */
async function readShortInPage(page, itemId) {
    return page
        .evaluate(async (id) => {
        try {
            const r = await fetch(`https://fanqienovel.com/api/author/short_article/edit/v1/?aid=2503&app_name=muye_novel&item_id=${id}&image_fmt_list=270x480`, { credentials: "include" });
            const j = await r.json();
            return {
                title: String(j?.data?.multi_title ?? ""),
                wordNumber: Number(j?.data?.word_number ?? 0),
                publishStatus: Number(j?.data?.publish_status ?? 0),
                displayStatus: Number(j?.data?.display_status ?? 0),
                bookThumbUri: String(j?.data?.book_thumb_uri ?? ""),
            };
        }
        catch {
            return { title: "", wordNumber: 0, publishStatus: 0, displayStatus: 0, bookThumbUri: "" };
        }
    }, itemId)
        .catch(() => ({ title: "", wordNumber: 0, publishStatus: 0, displayStatus: 0, bookThumbUri: "" }));
}
/** 复核草稿：edit/v1 是否已带标题或正文 */
async function verifyDraft(page, itemId) {
    const snap = await readShortInPage(page, itemId);
    return { saved: snap.title.length > 0 || snap.wordNumber > 0 };
}
/**
 * 上传封面（2026-10 实测链路，由页面自身调 `cover/v0` 签名）：
 * 点「封面设置」区开抽屉 → 切「本地上传」tab → 勾「我已阅读并同意《字体许可使用协议》《图片上传协议》」
 * → 塞文件 → 点「确认上传」→（部分版本还要点「确定」）→ 校验封面已设置。
 *
 * ⚠️ 两点坑：① 抽屉 tab 不是 `.arco-tabs-tab`，而是 `div[role="tab"].arco-tabs-header-title`；
 * ② 抽屉关闭后残留遮罩会吃掉后续**真实鼠标点击**，所以本方法应排在「发布协议」之后执行。
 */
async function uploadCover(page, filePath) {
    try {
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await coverIsSet(page))
                return true;
            // ① 开抽屉
            await page
                .evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.scrollIntoView({ block: "center" });
                    el.click();
                }
            }, SHORT_PUBLISH_SELECTORS.coverTrigger)
                .catch(() => { });
            // ② 切「本地上传」tab（等它渲染出来）
            const tabOk = await waitFor(() => page.evaluate((sel) => {
                const t = Array.from(document.querySelectorAll(sel)).find((e) => /本地上传/.test(e.textContent || ""));
                if (!t)
                    return false;
                t.setAttribute("data-autopub-cover-tab", "1");
                return true;
            }, SHORT_PUBLISH_SELECTORS.drawerTab), 12000, 1000);
            if (!tabOk)
                continue;
            await page.click('[data-autopub-cover-tab="1"]').catch(() => { });
            // ③ 等文件输入框（切到「本地上传」后才渲染）
            const hasInput = await waitFor(async () => (await page.$('input[type="file"]')) !== null, 15000, 1000);
            if (!hasInput)
                continue;
            // ④ 勾抽屉里的图片上传协议
            await waitFor(() => page.evaluate(() => {
                const lab = Array.from(document.querySelectorAll("label.arco-checkbox")).find((l) => /我已阅读并同意/.test(l.textContent || ""));
                if (!lab)
                    return false;
                const input = lab.querySelector("input");
                if (input && !input.checked)
                    input.click();
                return !!input?.checked;
            }), 12000, 1000);
            // ⑤ 塞文件 → 点「确认上传」
            const inputs = await page.$$('input[type="file"]');
            if (!inputs.length)
                continue;
            await inputs[0].uploadFile(filePath);
            const uploaded = await waitFor(() => jsClickButton(page, "确认上传"), 30000, 1500);
            if (!uploaded)
                continue;
            await sleep(4000);
            if (await coverIsSet(page))
                return true;
            // ⑥ 部分版本「确认上传」后还有一层「确定」
            await jsClickButton(page, "确定");
            await sleep(3000);
            if (await coverIsSet(page))
                return true;
            logger.warn(`[short] 封面第 ${attempt} 次上传后仍未读到已设置状态，重试`);
        }
        return false;
    }
    catch (e) {
        logger.warn(`上传封面失败: ${e.message}`);
        return false;
    }
}
/**
 * 发布短故事。
 * 若给 itemId：打开 /publish-short/{itemId}，按需补正文/信息后走发布。
 * 若不给 itemId 而给 title/content：先在空白页建 item 再填再发。
 * confirm=false 只填表；confirm=true 才补齐必填门 → 存草稿 → 下一步 →（发布提示）→ 提交确认 → 发布。
 *
 * `下一步` 的必填门（2026-10 逆向 `PublishShort.*.js` 的 `handleClickPublish` 实测）：
 * 标题（空/空格/超长/查重）→ 字数 → 封面 → 分类（含主分类）→ 试读比例 → 发布协议 → 是否使用AI。
 * 缺项只会弹 3 秒即消失的 toast，所以本方法先补齐、再用 `readPublishGates` 自检，缺项直接给出明确原因。
 * 封面与「是否使用AI」是内容/合规决策，工具不替用户猜：封面靠 cover_path（或沿用已有），AI 必须显式传 useAI。
 * ⚠️ 发布可能触发实名/人脸验证，命中时只提示、不硬闯。
 */
export async function publishShortStory(opts) {
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
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
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
            if (titleSel)
                await fillTitle(page, titleSel, opts.title.trim());
        }
        if (content) {
            const bodySel = await firstMatch(page, SHORT_SELECTORS.body);
            if (bodySel)
                await fillBody(page, bodySel, toPlainText(content));
        }
        await sleep(800);
        if (opts.categories?.length) {
            const cat = await selectCategories(page, opts.categories);
            if (cat.missing.length)
                warnings.push(`未找到分类：${cat.missing.join("、")}`);
        }
        if (!opts.confirm) {
            if (typeof opts.useAI === "boolean")
                await chooseUseAI(page, opts.useAI);
            if (opts.coverPath && !(await uploadCover(page, opts.coverPath))) {
                warnings.push("封面文件未能上传。");
            }
            const file = await shot(page, "short-publish-filled");
            return {
                ok: true,
                action: "filled-not-submitted",
                message: `已打开 item_id=${itemId} 并填入信息（未发布，confirm=false）。` +
                    (content ? `正文字数≈${wordCount}。` : "仅校验作品信息，未改动正文。") +
                    "确认后传 confirm=true 执行发布。",
                itemId,
                wordCount: content ? wordCount : undefined,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // ---- confirm=true：把「下一步」的四个必填门逐个补齐（2026-10 逆向 PublishShort.*.js + 真机实测）----
        // 顺序有讲究：①「发布协议」只有**真实鼠标点协议文字**才勾得上，且必须排在打开封面抽屉**之前**，
        // 因为抽屉关掉后残留的遮罩会吃掉后续所有真实鼠标点击（JS click 不受影响，故其它步骤照旧能跑）。
        if (typeof opts.useAI !== "boolean") {
            const file = await shot(page, "short-useai-missing");
            return {
                ok: false,
                action: "aborted",
                message: "平台强制要求声明「是否使用AI」：发布必须显式指定 use_ai（true=是 / false=否），工具不替你猜。",
                itemId,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        if (!(await acceptPublishTerms(page)))
            warnings.push("未能勾上「发布协议」，发布可能被拦（已重试 3 次）。");
        if (!(await chooseUseAI(page, opts.useAI)))
            warnings.push("未能选中「是否使用AI」。");
        if (!(await ensurePayNode(page)))
            warnings.push("未能设置「试读比例」（点「去设置」后未出现试读线）。");
        if (opts.coverPath && !(await uploadCover(page, opts.coverPath))) {
            warnings.push("封面文件未能上传。");
        }
        // 存草稿把 标题/正文/分类/封面 落库
        await saveDraft(page);
        await sleep(1500);
        // 发布前自检：没补齐的门只会让「下一步」弹一个 3 秒即消失的 toast，先查出来省得白跑
        const gates = await readPublishGates(page);
        const missingGates = [];
        if (!gates.license)
            missingGates.push("发布协议未勾选");
        if (!gates.useAI)
            missingGates.push("是否使用AI 未选");
        if (!gates.payNode)
            missingGates.push("试读比例未设置");
        if (!gates.cover)
            missingGates.push("未上传封面（传 cover_path 上传）");
        if (missingGates.length) {
            const file = await shot(page, "short-gates-missing");
            return {
                ok: false,
                action: "aborted",
                message: `发布必填项未补齐：${missingGates.join("；")}。正文/信息已存草稿（item_id=${itemId}），补齐后再发布。`,
                itemId,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // 「下一步」会先打 short_article/check_pre 做前置校验（标题查重等）。
        // 校验不过时页面只弹红条、不跳转 → 必须抓这个响应，否则会误报「已发布」。
        let precheck = null;
        const onPrecheck = async (resp) => {
            if (!/short_article\/check_pre/.test(resp.url()))
                return;
            try {
                const j = JSON.parse(await resp.text());
                const hit = (j?.data?.check_resp_list || []).find((c) => c?.is_hit);
                if (hit)
                    precheck = String(hit.hit_message || "前置校验未通过");
            }
            catch {
                /* 响应非 JSON 时忽略 */
            }
        };
        page.on("response", onPrecheck);
        const clickedNext = (await jsClickButton(page, "下一步")) || (await clickNextBySelector(page));
        if (!clickedNext) {
            page.off("response", onPrecheck);
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
        // 必填门没补齐时页面只弹 3 秒即消失的 toast（「请上传封面」/「请选择是否使用 AI」…），先抓下来
        const gateToasts = (await readToasts(page)).filter((t) => !/审核工作时间/.test(t));
        if (gateToasts.length)
            warnings.push(`发布前页面提示：${gateToasts.join(" / ")}`);
        page.off("response", onPrecheck);
        if (precheck) {
            const file = await shot(page, "short-precheck-blocked");
            return {
                ok: false,
                action: "aborted",
                message: `发布前置校验未通过：${precheck}。正文/信息已存草稿（item_id=${itemId}），` +
                    `改掉该项后再发布（例如换标题），或用 publish_short_story_tomato 传新 title 重试。`,
                itemId,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // 「下一步」后平台可能弹「发布提示」（章节格式 / 错别字等自检）→ 点「继续发布」才进「提交确认」
        if (await waitFor(async () => (await jsClickButton(page, "继续发布")) || (await clickButtonByText(page, "继续发布")), 10000, 1000)) {
            warnings.push("平台弹出「发布提示」（章节格式/错别字自检），已点「继续发布」继续。");
            await sleep(6000);
        }
        // 实名/人脸：命中就停手，不硬闯
        const needAuth = await page
            .evaluate(() => /实名|人脸|认证|身份验证/.test(document.body?.innerText || ""))
            .catch(() => false);
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
        // 「提交确认」弹窗 → 点页脚主按钮（确定）才是真正提交
        if (!(await clickConfirmModalOk(page))) {
            const file = await shot(page, "short-confirm-missing");
            return {
                ok: false,
                action: "aborted",
                message: `未等到「提交确认」弹窗，未提交发布。` +
                    `正文/信息已存草稿（item_id=${itemId}），可到草稿箱手动完成发布（草稿箱 → 下一步 → 确定）。`,
                itemId,
                url: page.url(),
                screenshotPath: file,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        // 复核：edit/v1 的 publish_status 变 1 才算真发布（成功页会出现「返回短故事管理 / 再写一篇」）
        const verified = await waitFor(async () => {
            const snap = await readShortInPage(page, itemId);
            return snap.publishStatus === 1 ? snap : null;
        }, 30000, 3000);
        const file = await shot(page, verified ? "short-published" : "short-publish-result");
        return {
            ok: !!verified,
            action: verified ? "published" : "error",
            message: verified
                ? `已发布 item_id=${itemId}（后台 publish_status=1）。` +
                    `⚠️ 番茄审核工作时间 7:00-24:00：夜间提交会卡在「审核中」直至次日早上 7-9 点。`
                : `发布流程已走完，但 edit/v1 的 publish_status 仍未变为 1，请到短故事列表/草稿箱核对。`,
            itemId,
            url: page.url(),
            screenshotPath: file,
            warnings: warnings.length ? warnings : undefined,
        };
    }
    catch (e) {
        await browser.close().catch(() => { });
        logger.error(`发布短故事异常: ${e.message}`);
        return { ok: false, action: "error", message: `发布短故事失败: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
async function clickNextBySelector(page) {
    const sel = await firstMatch(page, SHORT_SELECTORS.next);
    if (!sel)
        return false;
    await page.click(sel).catch(() => { });
    return true;
}
/* ------------------------------ 封面 ------------------------------ */
/**
 * 为已有短故事设置封面：打开其编辑页，走「封面设置 → 本地上传」抽屉上传本地图片
 * （由页面自身调用 cover/v0 签名；抽屉的 tab / 协议勾选 / 确认上传 细节见 `uploadCover`）。
 * confirm=false 只上传预览不改库；confirm=true 上传后再点「存草稿」持久化。
 */
export async function setShortStoryCover(itemId, opts) {
    const readiness = automationReadiness();
    if (!readiness.ready) {
        return { ok: false, action: "aborted", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    }
    if (!itemId)
        return { ok: false, action: "aborted", message: "缺少 item_id。" };
    if (!opts.coverPath)
        return { ok: false, action: "aborted", message: "缺少 cover_path（本地图片路径）。" };
    if (!fs.existsSync(opts.coverPath))
        return { ok: false, action: "aborted", message: `封面文件不存在：${opts.coverPath}` };
    const session = await openSession(opts.headless ?? true, shortPublishUrl(itemId));
    if (isError(session))
        return { ok: false, action: "aborted", message: session.error };
    const { browser, page } = session;
    try {
        await sleep(2000);
        const uploaded = await uploadCover(page, opts.coverPath);
        if (!uploaded) {
            const file = await shot(page, "short-cover-missing");
            return {
                ok: false,
                action: "aborted",
                message: "封面未能上传（重试 3 次仍失败）。多为「封面设置 → 本地上传」抽屉结构变化，或图片格式/尺寸不符。",
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
    }
    catch (e) {
        return { ok: false, action: "error", message: `设置封面失败: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
/* ------------------------------ 删除 ------------------------------ */
/**
 * 删除短故事/草稿。
 * 注意：delete/v0 是写接口，需页面 JS 的签名（手工 fetch 会返回 -2 参数有误），
 * 因此这里驱动草稿箱真实 UI：hover 卡片 → 点删除图标 → 确认弹窗 → 监听 delete 响应。
 * 默认 confirm=false 只做预览。
 */
export async function deleteShortStory(itemId, opts = {}) {
    if (!itemId)
        return { ok: false, action: "error", message: "缺少 item_id。" };
    if (!opts.confirm) {
        return {
            ok: true,
            action: "preview",
            message: `将删除短故事 item_id=${itemId}（confirm=false，未执行）。确认后传 confirm=true。`,
        };
    }
    const readiness = automationReadiness();
    if (!readiness.ready)
        return { ok: false, action: "error", message: `前置条件未满足：\n- ${readiness.reasons.join("\n- ")}` };
    const session = await openSession(opts.headless ?? true, "/main/writer/short-draft");
    if (isError(session))
        return { ok: false, action: "error", message: session.error };
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
        const ids = (list?.data?.item_list ?? []).map((x) => String(x.item_id));
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
        const rect = await page.evaluate((id) => {
            const rows = Array.from(document.querySelectorAll(".short-draft-table-item"));
            const hit = rows.find((r) => Array.from(r.querySelectorAll("a")).some((a) => String(a.getAttribute("href") || "").includes(id)));
            if (!hit)
                return null;
            hit.scrollIntoView({ block: "center" });
            const icon = hit.querySelector(".serial-icon-general_delete");
            if (!icon)
                return null;
            const b = icon.getBoundingClientRect();
            if (b.width === 0 && b.height === 0)
                return null;
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
        const respPromise = new Promise((resolve) => {
            const onResp = async (resp) => {
                if (resp.url().includes(API.shortArticleDelete)) {
                    try {
                        const j = JSON.parse(await resp.text());
                        resolve({ code: j?.code, message: j?.message });
                    }
                    catch {
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
        if (confirmed)
            await sleep(1500);
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
    }
    catch (e) {
        return { ok: false, action: "error", message: `删除失败: ${e.message}` };
    }
    finally {
        await browser.close().catch(() => { });
    }
}
/** 点确认弹窗里的确认按钮（番茄为「提示 / 确认删除作品？…」+ 取消/确认） */
async function clickModalConfirm(page) {
    const labels = ["确认", "确定", "确认删除", "确定删除", "删除", "是的"];
    // 等待弹窗出现
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        const has = await page
            .evaluate((ls) => {
            const btns = Array.from(document.querySelectorAll("button"));
            return btns.some((b) => b.offsetParent !== null && ls.includes((b.textContent || "").trim()));
        }, labels)
            .catch(() => false);
        if (has)
            break;
        await sleep(400);
    }
    return page
        .evaluate((ls) => {
        // 只在弹窗容器内找，避免误点页面上的同名按钮
        const scopes = Array.from(document.querySelectorAll('.arco-modal:not(.arco-modal-mask),.arco-modal-wrapper,[role="dialog"]'));
        for (const scope of scopes) {
            if (!scope.getClientRects().length)
                continue;
            const btns = Array.from(scope.querySelectorAll("button"));
            for (const l of ls) {
                const b = btns.find((x) => x.offsetParent !== null && (x.textContent || "").trim() === l);
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
export async function countShortStories() {
    const r = await listShortStories({ pageCount: 200 });
    return r.ok ? r.total : undefined;
}
export function shortManageLink() {
    return `${authorApiBase()}/main/writer/short-manage`;
}
