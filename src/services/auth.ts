import { sleep, loadPuppeteer, launchBrowser, browserEnabled, puppeteerAvailable, driverName, shot } from "../browser/driver.js";
import { cookiesExist, cookiesPath, cookiesSummary, saveCookies, loadCookies } from "../browser/cookies.js";
import { authorLoginUrl, bookManageUrl, apiGet, API, isError, openSession } from "../browser/endpoints.js";
import { logger } from "../core/logger.js";
import { DATA_DIR, DATA_DIR_SOURCE } from "../core/paths.js";

/* ------------------------------ 前置检查 ------------------------------ */

export interface Readiness {
  ready: boolean;
  reasons: string[];
  details: Record<string, unknown>;
}

export function automationReadiness(): Readiness {
  const reasons: string[] = [];

  if (!browserEnabled()) reasons.push("浏览器能力已被 FANQIE_ENABLE_BROWSER=0 关闭");
  if (!puppeteerAvailable()) reasons.push("未安装浏览器驱动：在项目目录执行 `npm i puppeteer-core`，或 `npm i puppeteer`");
  if (!cookiesExist()) reasons.push(`缺少 cookies 文件：${cookiesPath()}（执行 login_tomato 登录，或 set_tomato_cookies 导入）`);

  return {
    ready: reasons.length === 0,
    reasons,
    details: {
      browser_enabled: browserEnabled(),
      puppeteer_installed: puppeteerAvailable(),
      driver: driverName(),
      data_dir: DATA_DIR,
      data_dir_source: DATA_DIR_SOURCE,
      cookies_file: cookiesPath(),
      cookies: cookiesSummary(),
      login_url: authorLoginUrl(),
      book_manage_url: bookManageUrl(),
      chrome_path: process.env.FANQIE_CHROME_PATH ?? null,
    },
  };
}

/* ------------------------------ 半自动登录 ------------------------------ */

/**
 * 半自动登录：打开真实浏览器窗口，用户在窗口里完成扫码/验证码登录，
 * 本服务只轮询登录状态并在成功后保存 cookies。全程不接触账号密码。
 */
export async function interactiveLogin(
  timeoutMs = 5 * 60 * 1000
): Promise<{ ok: boolean; message: string; cookieCount?: number; path?: string; screenshotPath?: string }> {
  if (!browserEnabled()) {
    return { ok: false, message: "浏览器能力已被 FANQIE_ENABLE_BROWSER=0 关闭。" };
  }

  let browser: any;
  try {
    browser = await launchBrowser(false);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const loginUrl = authorLoginUrl();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 60000 });
    logger.info(`已打开登录页: ${loginUrl}，等待用户完成登录`);

    const deadline = Date.now() + timeoutMs;
    let lastCookieCount = 0;

    while (Date.now() < deadline) {
      await sleep(2000);
      let cookies: any[] = [];
      try {
        cookies = await page.cookies();
      } catch {
        break; // 窗口被关闭
      }
      lastCookieCount = cookies.length;

      const url = page.url();
      const hasSession = cookies.some(
        (c) => c.value && c.value.length > 20 && !/^_|analytics|logger/i.test(c.name)
      );
      if (!/\/writer\/login|passport/i.test(url) && hasSession && cookies.length >= 2) {
        const saved = saveCookies(JSON.stringify(cookies));
        await browser.close().catch(() => {});
        return {
          ok: true,
          message: `登录成功，已保存 ${saved.count} 条 cookies。`,
          cookieCount: saved.count,
          path: saved.path,
        };
      }
    }

    const screenshotPath = await shot(page, "login-timeout");
    await browser.close().catch(() => {});
    return {
      ok: false,
      message:
        `等待登录超时（${Math.round(timeoutMs / 1000)} 秒内未检测到登录成功，当前 cookies 数=${lastCookieCount}）。` +
        "请重试并在弹出的浏览器窗口中完成登录。",
      screenshotPath,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, message: `登录流程异常: ${(e as Error).message}` };
  }
}

/* ------------------------------ 登录态校验 ------------------------------ */

export interface LoginCheck {
  ok: boolean;
  loggedIn: boolean;
  message: string;
  user?: string;
  url?: string;
  bookCount?: number;
}

/**
 * 校验 cookies 是否仍然有效：打开作品管理页，读取账号信息与真实作品数。
 * 这是判断「是否需要重新登录」的权威方式。
 */
export async function checkLogin(): Promise<LoginCheck> {
  const readiness = automationReadiness();
  if (!readiness.ready) {
    return { ok: false, loggedIn: false, message: `前置条件未满足：${readiness.reasons.join("；")}` };
  }

  const session = await openSession(true, "/main/writer/book-manage");
  if (isError(session)) {
    return { ok: false, loggedIn: false, message: session.error };
  }
  const { browser, page } = session;
  try {
    const account = await apiGet(page, "/api/author/account/info/v0/");
    const books = await apiGet(page, API.bookList, {
      page_count: 50,
      page_index: 0,
      image_fmt_list: "270x480",
    });
    const bookCount = Array.isArray(books?.data?.book_list) ? books.data.book_list.length : undefined;
    const user =
      account?.data?.author_name ||
      account?.data?.nick_name ||
      account?.data?.name ||
      account?.data?.author_info?.author_name;
    await browser.close().catch(() => {});
    return {
      ok: true,
      loggedIn: true,
      message: "cookies 有效，当前处于登录态。",
      user: user ? String(user) : undefined,
      url: bookManageUrl(),
      bookCount,
    };
  } catch (e) {
    await browser.close().catch(() => {});
    return { ok: false, loggedIn: false, message: `校验登录态失败: ${(e as Error).message}` };
  }
}

/** 供工具层使用：导入 cookies 文本/文件 */
export function importCookies(raw: string): { count: number; path: string } {
  const saved = saveCookies(raw);
  // 立即确认格式可加载
  loadCookies();
  return saved;
}
