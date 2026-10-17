import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
/**
 * cwd 在 MCP 子进程里是不可靠的（WorkBuddy 拉起时目录不确定），
 * 因此所有路径一律基于模块自身位置解析，绝不使用 process.cwd()。
 * dist/core/paths.js -> ../../ 即项目根目录。
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(MODULE_DIR, "..", "..");
export const DATA_DIR = process.env.FANQIE_DATA_DIR || path.join(PROJECT_ROOT, "data");
export const EXPORT_DIR = process.env.FANQIE_EXPORT_DIR || path.join(DATA_DIR, "export");
export const SHOT_DIR = path.join(DATA_DIR, "screenshots");
export function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
export function ensureDirs() {
    ensureDir(DATA_DIR);
    ensureDir(EXPORT_DIR);
    ensureDir(SHOT_DIR);
}
