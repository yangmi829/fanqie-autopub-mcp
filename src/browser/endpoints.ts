import { logger } from "../core/logger.js";

/* ------------------------------ 常量与地址 ------------------------------ */

/** 番茄作者后台 API 根（与 cookies 同源；从页面上下文 fetch 即带会话） */
export function authorApiBase(): string {
  return process.env.FANQIE_AUTHOR_API_BASE || "https://fanqienovel.com";
}

/** 番茄作家专区登录页 */
export function authorLoginUrl(): string {
  return process.env.FANQIE_AUTHOR_URL || "https://fanqienovel.com/main/writer/login";
}

/** 作品管理（小说） */
export function bookManageUrl(): string {
  return `${authorApiBase()}/main/writer/book-manage`;
}

/** 建书页 */
export function createBookUrl(): string {
  return `${authorApiBase()}/main/writer/create`;
}

/** 短故事管理页 */
export function shortManageUrl(): string {
  return process.env.FANQIE_SHORT_MANAGE_URL || `${authorApiBase()}/main/writer/short-manage`;
}

/** 短故事草稿箱 */
export function shortDraftUrl(): string {
  return `${authorApiBase()}/main/writer/short-draft`;
}

/**
 * 短故事编辑/发布页。
 * 传入 itemId 打开已有作品；不传则打开空白编辑页（番茄会自动 POST new/v0 建一条草稿 item）。
 */
export function shortPublishUrl(itemId?: string | number): string {
  const base = `${authorApiBase()}/main/writer/publish-short/`;
  const tail = itemId !== undefined && itemId !== null && `${itemId}` !== "" ? String(itemId) : "";
  return `${base}${tail}?enter_from=NEWCHAPTER_1`;
}

/** 章节发布页（番茄「创建章节」锚点取到的真实地址） */
export function chapterUrlTemplate(): string {
  return (
    process.env.FANQIE_CHAPTER_URL_TEMPLATE ||
    `${authorApiBase()}/main/writer/{bookId}/publish/?enter_from=newchapter_1`
  );
}

/**
 * 改「已发布章节」的编辑器地址：与新建章节同一个编辑器，
 * 靠路径里的 chapterId + `enter_from=modifychapter` 区分（列表页每章的编辑图标指向这里）。
 */
export function modifyChapterPath(bookId: string, chapterId: string): string {
  return `/main/writer/${bookId}/publish/${chapterId}/?enter_from=modifychapter`;
}

/** 番茄后台通用的 aid / app_name 参数（所有 author 接口都带） */
export const AID = process.env.FANQIE_AID || "2503";
export const APP_NAME = process.env.FANQIE_APP_NAME || "muye_novel";

/** author API 路径（来自前端 bundle 逆向） */
export const API = {
  bookList: "/api/author/book/book_list/v0/",
  bookDetail: "/api/author/book/book_detail/v0/",
  bookCreate: "/api/author/book/create/v0/",
  bookCheckFrequency: "/app/book/check_frequency/v0/",
  chapterList: "/api/author/chapter/chapter_list/v1",
  shortArticleNew: "/api/author/short_article/new/v0/",
  shortArticleList: "/api/author/short_article/list/v0/",
  shortArticleDraftList: "/api/author/short_article/draft_list/v0/",
  shortArticleEditV1: "/api/author/short_article/edit/v1/",
  shortArticleEditV0: "/api/author/short_article/edit/v0/",
  shortArticlePublish: "/api/author/short_article/publish/v0/",
  shortArticleCover: "/api/author/short_article/cover/v0/",
  shortArticleCheckPre: "/api/author/short_article/check_pre/v0",
  shortArticleCategoryV1: "/api/author/short_article/get_category_list/v1/",
  shortArticleDelete: "/api/author/short_article/delete/v0/",
} as const;

export function withParams(pathname: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(authorApiBase() + pathname);
  url.searchParams.set("aid", AID);
  url.searchParams.set("app_name", APP_NAME);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && `${v}` !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/* ------------------------------ 会话 ------------------------------ */

export interface AuthorSession {
  browser: any;
  page: any;
}

export type SessionResult = AuthorSession | { error: string };

/** 是否被重定向到登录页（cookies 失效） */
export function onLoginPage(url: string): boolean {
  return /\/writer\/login|passport|sso/i.test(url);
}

/**
 * 起浏览器 + 注入 cookies + 打开指定页面。
 * 若被重定向到登录页，返回 error（调用方提示重新登录）。
 */
export async function openSession(
  headless: boolean,
  targetPath: string,
  driverBundle?: any
): Promise<SessionResult> {
  let browser: any;
  try {
    const { launchBrowser } = await import("./driver.js");
    browser = await launchBrowser(headless, driverBundle);
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const { loadCookies } = await import("./cookies.js");
    const cookies = loadCookies();
    await page.goto("about:blank");
    await page.setCookie(...cookies);

    const url = targetPath.startsWith("http") ? targetPath : `${authorApiBase()}${targetPath}`;
    logger.debug(`打开页面: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    if (onLoginPage(page.url())) {
      await browser.close().catch(() => {});
      return { error: "cookies 已失效（被重定向到登录页）。请先执行 login_tomato 重新登录。" };
    }
    return { browser, page };
  } catch (e) {
    await browser.close().catch(() => {});
    return { error: `打开作者后台失败: ${(e as Error).message}` };
  }
}

export function isError(r: SessionResult): r is { error: string } {
  return (r as { error?: string }).error !== undefined;
}

/**
 * 在已登录页面上下文里调用 author GET 接口。
 * GET 接口不需要 a_bogus/msToken 签名，从页面上下文 fetch（带 cookies）即可。
 */
export async function apiGet(page: any, pathname: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const url = withParams(pathname, params);
  return page.evaluate(async (u: string) => {
    try {
      const r = await fetch(u, { credentials: "include" });
      return await r.json();
    } catch (e) {
      return { error: String(e) };
    }
  }, url);
}
