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

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function ensureDirs(): void {
  ensureDir(DATA_DIR);
  ensureDir(EXPORT_DIR);
  ensureDir(SHOT_DIR);
}

/**
 * 解析用户传入的文件/目录路径（工作稿在仓库外，所以不能用 cwd 兜底）。
 * 绝对路径原样返回；相对路径依次按「项目根」「项目根的上一级（工作区根）」尝试，
 * 命中即返回，都不存在则返回第一个候选，交由调用方报错时展示。
 */
export function resolveLoosePath(p: string): string {
  if (path.isAbsolute(p)) return p;
  const candidates = [path.resolve(PROJECT_ROOT, p), path.resolve(PROJECT_ROOT, "..", p)];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}
