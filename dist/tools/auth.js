import { z } from "zod";
import fs from "node:fs";
import { ok, fail } from "../core/result.js";
import { logger } from "../core/logger.js";
import { automationReadiness, interactiveLogin, checkLogin, importCookies } from "../services/auth.js";
import { cookiesSummary } from "../browser/cookies.js";
export function registerAuthTools(server) {
    server.registerTool("login_tomato", {
        title: "登录番茄作者后台（半自动）",
        description: "打开真实浏览器窗口，你在窗口里扫码/过验证码完成登录，服务只轮询登录态并保存 cookies。全程不接触账号密码。",
        inputSchema: {
            timeout_seconds: z.number().int().positive().max(1800).optional().describe("等待登录的超时秒数，默认 300"),
        },
    }, async ({ timeout_seconds }) => {
        const r = await interactiveLogin((timeout_seconds ?? 300) * 1000);
        if (!r.ok)
            return fail(r.message, r.screenshotPath ? `截图：${r.screenshotPath}` : undefined);
        return ok(r);
    });
    server.registerTool("set_tomato_cookies", {
        title: "导入番茄 cookies（备用）",
        description: "手动导入 cookies 文本或文件路径。cookies 需为数组或 {cookies:[...]} 格式（浏览器插件导出格式均可）。",
        inputSchema: {
            cookies: z.string().optional().describe("cookies 的 JSON 文本"),
            file_path: z.string().optional().describe("cookies JSON 文件路径（与 cookies 二选一）"),
        },
    }, async ({ cookies, file_path }) => {
        try {
            let raw = cookies;
            if (!raw && file_path) {
                if (!fs.existsSync(file_path))
                    return fail(`文件不存在：${file_path}`);
                raw = fs.readFileSync(file_path, "utf-8");
            }
            if (!raw)
                return fail("需提供 cookies 或 file_path。");
            const saved = importCookies(raw);
            return ok({ message: `已导入 ${saved.count} 条 cookies`, path: saved.path });
        }
        catch (e) {
            logger.error(`导入 cookies 失败: ${e.message}`);
            return fail(`导入 cookies 失败: ${e.message}`);
        }
    });
    server.registerTool("get_publish_status", {
        title: "发布环境自检",
        description: "检查 cookies / 浏览器驱动 / 后台可达性，并返回补齐指引。verify_login=true 时会真开一次无头浏览器校验登录态。",
        inputSchema: {
            verify_login: z.boolean().optional().describe("是否实开浏览器校验登录态，默认 true"),
        },
    }, async ({ verify_login }) => {
        const readiness = automationReadiness();
        const verify = verify_login ?? true;
        const login = verify && readiness.ready ? await checkLogin() : undefined;
        const ready = readiness.ready && (login ? login.loggedIn : true);
        return ok({
            ready,
            reasons: readiness.reasons,
            details: readiness.details,
            cookies: cookiesSummary(),
            login_check: login ?? "跳过（前置条件未满足或 verify_login=false）",
            hint: ready
                ? "环境就绪，可以直接使用发布类工具。"
                : readiness.reasons.length
                    ? "请先按 reasons 补齐环境（安装 puppeteer-core / 提供 Chrome 路径 / 执行 login_tomato）。"
                    : "cookies 已失效，请执行 login_tomato 重新登录。",
        });
    });
}
